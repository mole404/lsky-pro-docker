<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * 「取消导出」旗标。
 *
 * 为什么不用连接状态来判断取消：导出走的是浏览器原生下载（大文件不进内存），客户端没法掐断
 * 这一侧的 HTTP 流 —— 用户点了取消，服务端仍在继续打包。所以取消做成「服务端旗标」：
 * 客户端请求取消 → 流式循环在下一张图的边界上看到旗标就自己停下，和网络断开走同一条收尾路径
 * （占位释放 + 结果记为已中断），连接随后自然断开。
 *
 * 旗标带 run：从「点下载」到「worker 认领这笔请求」之间有一段空窗，那时占位还没建、
 * ExportConcurrency::isActive() 还是 false。若取消只在 isActive 时才置旗标，空窗里点的取消
 * 会直接丢掉；若旗标又不带 run，导出一开始的那句清理还会把刚置的旗标抹掉。带上 run 之后，
 * 「谁的取消」和「哪一笔导出」能对上，清理也就能只清别人的残留。
 *
 * 缓存里只放一个小数组（run + 时间戳）：导出收尾清掉自己的，另有 TTL 兜底，不留垃圾。
 * 旧版本写的是裸时间戳，读的时候统一归一成「没带 run 的旗标」，滚动升级期间不会读岔。
 */
final class ExportCancel
{
    private const PREFIX = 'image-export:cancel:';

    /** 旗标 TTL（秒）：只需比一次导出活得久，够用即可 */
    private const TTL = 900;

    /**
     * 用户点了取消：下一次图片边界就停。
     *
     * $run 非 null ⇒ 只对那一笔导出生效（导出侧按同一个 run 认领，别人不会误伤）；
     * $run 为 null ⇒ 退回旧语义，任何一笔导出都认这个旗标（兼容没传 run 的调用）。
     */
    public static function request(int $userId, ?string $run = null): void
    {
        Cache::put(self::key($userId), ['run' => $run, 'at' => time()], self::TTL);
    }

    /**
     * 这个旗标对 $run 这一笔导出生效吗？
     *
     * $run 为 null（调用方没传）⇒ 任何旗标都算数，保持旧行为；
     * 旗标自己没带 run（老的裸时间戳，或取消时没传 run）⇒ 也视为「任何一笔都认」。
     */
    public static function requested(int $userId, ?string $run = null): bool
    {
        $flag = self::flag($userId);

        return $flag !== null && self::matches($flag, $run);
    }

    /** 清掉旗标，不区分 run（旧接口，语义不变） */
    public static function clear(int $userId): void
    {
        Cache::forget(self::key($userId));
    }

    /**
     * 只清「$run 这一笔不认」的残留 —— 导出开始时用。
     *
     * 属于本次导出的旗标必须留着：用户完全可能抢在 worker 认领之前就点了取消，
     * 那时旗标已经是「给这一笔的」了，无条件 clear() 会把它抹掉（取消丢失）。
     * 上一轮留下的、run 对不上的旗标则照旧清掉，免得误掐新一轮。
     */
    public static function clearStale(int $userId, ?string $run = null): void
    {
        $flag = self::flag($userId);

        if ($flag !== null && ! self::matches($flag, $run)) {
            Cache::forget(self::key($userId));
        }
    }

    /**
     * 只清属于 $run 的旗标 —— 导出收尾用。
     *
     * 收尾时这一笔已经结束，它的旗标（无论带不带 run）都没用了；但此刻要是有另一笔导出
     * 的旗标刚落下来，顺手清掉就等于又丢了一次取消。
     */
    public static function clearRun(int $userId, ?string $run = null): void
    {
        $flag = self::flag($userId);

        if ($flag === null) {
            return;
        }

        // 旗标带的是另一笔导出的 run：那是别人的取消，别动
        if ($flag['run'] !== null && $flag['run'] !== $run) {
            return;
        }

        Cache::forget(self::key($userId));
    }

    /**
     * 旗标是否适用于 $run 这一笔导出。
     * $run 没传（null）或旗标自己没带 run ⇒ 一律适用，就是旧版「一个时间戳管所有」的语义。
     *
     * @param  array{run: string|null, at: int}  $flag
     */
    private static function matches(array $flag, ?string $run): bool
    {
        return $run === null || $flag['run'] === null || $flag['run'] === $run;
    }

    /**
     * 读出旗标并归一到固定形状；没有旗标返回 null。
     *
     * @return array{run: string|null, at: int}|null
     */
    private static function flag(int $userId): ?array
    {
        $raw = Cache::get(self::key($userId));

        if ($raw === null) {
            return null;
        }

        if (! is_array($raw)) {
            // 旧版本（或升级瞬间的残留）写的是裸时间戳：当成没带 run 的旗标
            return ['run' => null, 'at' => is_numeric($raw) ? (int) $raw : 0];
        }

        $run = $raw['run'] ?? null;

        return [
            'run' => is_string($run) && $run !== '' ? $run : null,
            'at'  => (int) ($raw['at'] ?? 0),
        ];
    }

    private static function key(int $userId): string
    {
        return self::PREFIX.$userId;
    }

    private function __construct()
    {
    }
}
