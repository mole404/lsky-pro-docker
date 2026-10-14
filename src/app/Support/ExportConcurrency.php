<?php

namespace App\Support;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;

/**
 * 导出并发占位表：同一张表同时管两件事 ——
 *   ① 同一账号同时只能有一个导出；② 整机的全局并发上限。
 *
 * 为什么不用 Cache::lock 直接当导出锁：
 *   本项目锁在 Illuminate\Cache\CacheLock 上，它只有 get() / block() / release()，
 *   **没有 refresh()** —— 长导出没法给锁续期，只能给一个足够长的 TTL，
 *   于是进程被 SIGKILL 后该用户要被锁到 TTL 到期（以小时计）才好。
 * 换成「带心跳的占位表」：
 *   - 占位即加锁（同一个 user_id 重复占位会被拒）；
 *   - 每写一张图刷新一次心跳，只要还在跑就不会被误判为死；
 *   - 心跳过期（STALE 秒没更新）即视为那个导出已经死了，别人可以回收它的位置
 *     —— 被硬杀后最坏 STALE 秒自愈，不会把账号卡住；
 *   - 读改写用短锁包住（毫秒级），避免并发请求互相覆盖这张小表。
 *
 * 表本身只是缓存里的几十字节（file 驱动 → storage/framework/cache 下一个文件），
 * 导出结束后由 release() 立即删掉；进程被 SIGKILL 时由 TTL / 心跳过期兜底，不留垃圾。
 */
final class ExportConcurrency
{
    /** 占位表键：user_id => 最近一次心跳时间戳 */
    public const KEY = 'image-export:active';

    /** 读改写用的短锁键 */
    private const MUTEX = 'image-export:active-mutex';

    /** 短锁最多等多久（秒）；等不到说明有人在写，保守拒绝 */
    private const MUTEX_WAIT = 3;

    /** 占位表 TTL（秒）：心跳会不断刷新，这里只是兜底不留下永久垃圾 */
    private const TTL = 900;

    /** 心跳超过这么久没更新 ⇒ 认为那个导出已经死了，可回收占位 */
    private const STALE = 300;

    /** 全局并发上限：拿不到机器信息时的默认值 / 无论如何不超过的硬上限 */
    private const DEFAULT_CAP = 2;
    private const MAX_CAP = 4;

    private function __construct()
    {
    }

    /**
     * 尝试占位。
     *
     * @return string|null null = 占位成功；'busy' = 本账号已有导出在进行；'full' = 全局并发已满
     */
    public static function acquire(int $userId): ?string
    {
        return self::underMutex(function () use ($userId) {
            $active = self::read();

            if (isset($active[$userId])) {
                return 'busy';
            }

            if (count($active) >= self::cap()) {
                return 'full';
            }

            $active[$userId] = time();
            self::write($active);

            return null;
        }, 'full');
    }

    /** 心跳：导出还在跑，别把我的位置回收掉 */
    public static function touch(int $userId): void
    {
        self::underMutex(function () use ($userId) {
            $active = self::read();
            $active[$userId] = time();
            self::write($active);
        });
    }

    /** 主动让位：正常结束、用户取消、服务端出错都会走到这里 */
    public static function release(int $userId): void
    {
        self::underMutex(function () use ($userId) {
            $active = self::read();

            if (isset($active[$userId])) {
                unset($active[$userId]);
                self::write($active);
            }
        });
    }

    /** 当前活跃（心跳未过期）的导出数，供自查/日志用 */
    public static function active(): int
    {
        return count(self::read());
    }

    /**
     * 某个账号此刻是否有导出在进行。
     * 设置页在跳转下载前用它先提示一句 —— 否则用户会直接撞到 429 的纯文本页。
     */
    public static function isActive(int $userId): bool
    {
        return isset(self::read()[$userId]);
    }

    /** 全局并发上限 */
    public static function cap(): int
    {
        $env = trim((string) getenv('EXPORT_MAX_CONCURRENCY'));

        if ($env !== '' && ctype_digit($env) && (int) $env > 0) {
            // 显式覆盖优先：部署者最可控的一条路径
            return max(1, min(8, (int) $env));
        }

        $workers = self::workers();

        if ($workers !== null) {
            // 留一半 worker 给站点正常请求（页面/上传/接口）
            return max(1, min(self::MAX_CAP, intdiv($workers, 2)));
        }

        return self::DEFAULT_CAP;
    }

    /** 读表（顺手剔掉心跳过期的条目：它们对应的进程已经不在了） */
    private static function read(): array
    {
        $active = Cache::get(self::KEY, []);

        if (! is_array($active)) {
            return [];
        }

        $deadline = time() - self::STALE;

        return array_filter($active, static function ($beat) use ($deadline) {
            return is_int($beat) && $beat >= $deadline;
        });
    }

    private static function write(array $active): void
    {
        Cache::put(self::KEY, $active, self::TTL);
    }

    /**
     * 用短锁包住一次读改写。
     *
     * file 驱动的 add() 走 LockableFile 的独占文件锁，是原子的（vendor 里 FileStore::add 的实现），
     * 而 increment() 是 get → put（不原子），所以这里不用 increment。
     * 拿不到短锁就等最多 MUTEX_WAIT 秒；仍然拿不到时退回 $fallback（acquire 传的是保守的 'full'）。
     */
    private static function underMutex(callable $callback, $fallback = null)
    {
        try {
            return Cache::lock(self::MUTEX, 10)->block(self::MUTEX_WAIT, $callback);
        } catch (LockTimeoutException $e) {
            return $fallback;
        }
    }

    /**
     * 机器上能并行处理请求的 worker 数；拿不到返回 null（调用方用默认值）。
     */
    private static function workers(): ?int
    {
        // ① entrypoint 启动时写的 world-readable 标记。
        //    Apache 下这是唯一能拿到「最终生效值」的途径：容器里 www-data 身份读不了
        //    /etc/apache2/conf-enabled/mpm.conf（该文件 root 600，实测 Permission denied）。
        $marker = '/tmp/lsky-mpm-workers';

        if (is_readable($marker)) {
            $value = trim((string) @file_get_contents($marker));

            if (ctype_digit($value) && (int) $value > 0) {
                return (int) $value;
            }
        }

        // ② php-fpm 部署：解析 pm.max_children
        foreach (glob('/usr/local/etc/php-fpm.d/*.conf') ?: [] as $conf) {
            $contents = (string) @file_get_contents($conf);

            if (preg_match('/^\s*pm\.max_children\s*=\s*(\d+)/m', $contents, $matches)) {
                return (int) $matches[1];
            }
        }

        // ③ 其它 SAPI / 容器编排：交给默认值
        return null;
    }
}
