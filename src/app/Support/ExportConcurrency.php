<?php

namespace App\Support;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * 导出并发占位表：同一张表同时管三件事 ——
 *   ① 同一账号同时只能有一个导出；② 整机的全局并发上限；③ 当前导出写到第几张（前端进度条）。
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
 * 条目形状（user_id => 条目）：
 *   ['beat' => 心跳时间戳, 'done' => 已写张数, 'total' => 总张数, 'bytes' => 已写字节, 'run' => 本次导出标识]
 * 旧版本写的是裸时间戳，read() 里统一归一，升级过程中不会因为读写形状不一致而误判。
 *
 * 表本身只是缓存里的几十字节（file 驱动 → storage/framework/cache 下一个文件），
 * 导出结束后由 release() 立即删掉；进程被 SIGKILL 时由 TTL / 心跳过期兜底，不留垃圾。
 *
 * 关于容错：缓存目录一旦不可写（例如属主被人改成 root），这里的每次写都会失败。
 * 那种情况下宁可「降级到不设并发限制」也不能把整次导出打成 500 —— 所以读写的失败都在
 * 内部吃掉，每个请求最多留一行日志（$warned 保证不会按张数刷屏）。
 */
final class ExportConcurrency
{
    /** 占位表键 */
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

    /** 每个请求最多留一行「缓存不可用」的日志，避免按张数刷屏 */
    private static bool $warned = false;

    private function __construct()
    {
    }

    /**
     * 尝试占位。
     *
     * @param  int  $total  本次要导出的图片总数（只用于前端进度显示）
     * @param  string|null  $run  本次导出的标识（前端生成，用来认领结果记录）
     * @return string|null null = 占位成功；'busy' = 本账号已有导出在进行；'full' = 全局并发已满
     */
    public static function acquire(int $userId, int $total = 0, ?string $run = null): ?string
    {
        return self::underMutex(function () use ($userId, $total, $run) {
            $active = self::read();

            if (isset($active[$userId])) {
                return 'busy';
            }

            if (count($active) >= self::cap()) {
                return 'full';
            }

            $active[$userId] = self::entry($total, $run);
            self::write($active);

            return null;
        }, 'full');
    }

    /**
     * 心跳 + 进度：导出还在跑，别把我的位置回收掉；顺手记下写到第几张了。
     * 每张图刷一次，和原来同一笔写入 —— 前端读进度不额外增加任何服务端开销。
     */
    public static function touch(int $userId, array $progress = []): void
    {
        self::underMutex(function () use ($userId, $progress) {
            $active = self::read();
            // 条目意外不在了（被当成死占位回收）也要能续上，别把心跳写丢
            $entry = $active[$userId] ?? self::entry((int) ($progress['total'] ?? 0), $progress['run'] ?? null);
            $entry['beat'] = time();

            foreach (['done', 'bytes', 'total'] as $field) {
                if (isset($progress[$field])) {
                    $entry[$field] = max(0, (int) $progress[$field]);
                }
            }

            if (isset($progress['run']) && is_string($progress['run'])) {
                $entry['run'] = $progress['run'];
            }

            $active[$userId] = $entry;
            self::write($active);
        });
    }

    /** 进度参数的形状（控制器按这个传） */
    public static function progressPayload(int $done, int $bytes, int $total, ?string $run): array
    {
        return ['done' => $done, 'bytes' => $bytes, 'total' => $total, 'run' => $run];
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

    /**
     * 某个账号此刻那一笔导出的进度；没有（或已过期回收）返回 null。
     *
     * @return array{done:int,total:int,bytes:int,run:string|null}|null
     */
    public static function progress(int $userId): ?array
    {
        $entry = self::read()[$userId] ?? null;

        if ($entry === null) {
            return null;
        }

        return [
            'done'  => (int) $entry['done'],
            'total' => (int) $entry['total'],
            'bytes' => (int) $entry['bytes'],
            'run'   => $entry['run'],
        ];
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

    /**
     * 读表（顺手剔掉心跳过期的条目：它们对应的进程已经不在了）。
     * 兼容两种形状：本版本的数组条目，以及旧版本的裸时间戳。
     */
    private static function read(): array
    {
        try {
            $active = Cache::get(self::KEY, []);
        } catch (\Throwable $e) {
            // 缓存不可用：当作「没有活跃导出」。宁可少一层并发保护，也不要把导出打成 500。
            self::warn($e);

            return [];
        }

        if (! is_array($active)) {
            return [];
        }

        $deadline = time() - self::STALE;
        $live = [];

        foreach ($active as $userId => $entry) {
            $entry = self::normalize($entry);

            if ($entry !== null && $entry['beat'] >= $deadline) {
                $live[$userId] = $entry;
            }
        }

        return $live;
    }

    private static function write(array $active): void
    {
        try {
            Cache::put(self::KEY, $active, self::TTL);
        } catch (\Throwable $e) {
            self::warn($e);
        }
    }

    /** 旧版裸时间戳 / 新版数组条目 → 统一形状；无法识别的返回 null（当它是死人） */
    private static function normalize($entry): ?array
    {
        if (is_int($entry)) {
            return ['beat' => $entry, 'done' => 0, 'total' => 0, 'bytes' => 0, 'run' => null];
        }

        if (! is_array($entry) || ! isset($entry['beat']) || ! is_int($entry['beat'])) {
            return null;
        }

        return [
            'beat'  => $entry['beat'],
            'done'  => (int) ($entry['done'] ?? 0),
            'total' => (int) ($entry['total'] ?? 0),
            'bytes' => (int) ($entry['bytes'] ?? 0),
            'run'   => isset($entry['run']) && is_string($entry['run']) ? $entry['run'] : null,
        ];
    }

    private static function entry(int $total, ?string $run): array
    {
        return ['beat' => time(), 'done' => 0, 'total' => max(0, $total), 'bytes' => 0, 'run' => $run];
    }

    /**
     * 用短锁包住一次读改写。
     *
     * file 驱动的 add() 走 LockableFile 的独占文件锁，是原子的（vendor 里 FileStore::add 的实现），
     * 而 increment() 是 get → put（不原子），所以这里不用 increment。
     * 拿不到短锁就等最多 MUTEX_WAIT 秒；仍然拿不到时退回 $fallback（acquire 传的是保守的 'full'）。
     * 缓存层本身报错（不是等锁超时）时也退回 $fallback —— 但 acquire 那一路会传 null，
     * 即「缓存坏了就别拦着用户导出，只是这层并发保护失效」。
     */
    private static function underMutex(callable $callback, $fallback = null)
    {
        try {
            return Cache::lock(self::MUTEX, 10)->block(self::MUTEX_WAIT, $callback);
        } catch (LockTimeoutException $e) {
            // 真的有人在写：退回调用方给的保守值
            return $fallback;
        } catch (\Throwable $e) {
            // 缓存层本身坏了：这层并发保护失效，但不能因此拦下用户的导出
            self::warn($e);

            return null;
        }
    }

    /** 缓存不可用只记一次，按张数的循环里不会刷屏 */
    private static function warn(\Throwable $e): void
    {
        if (self::$warned) {
            return;
        }

        self::$warned = true;

        try {
            Log::warning('export cache unavailable', [
                'reason' => class_basename($e).': '.$e->getMessage(),
            ]);
        } catch (\Throwable $ignored) {
            // 连日志都写不了就算了：不能因为记日志把导出打断
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
