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
 * 缓存里只放一个时间戳：新导出开始、导出收尾都会清掉，另有 TTL 兜底，不留垃圾。
 */
final class ExportCancel
{
    private const PREFIX = 'image-export:cancel:';

    /** 旗标 TTL（秒）：只需比一次导出活得久，够用即可 */
    private const TTL = 900;

    /** 用户点了取消：下一次图片边界就停 */
    public static function request(int $userId): void
    {
        Cache::put(self::key($userId), time(), self::TTL);
    }

    public static function requested(int $userId): bool
    {
        return Cache::has(self::key($userId));
    }

    public static function clear(int $userId): void
    {
        Cache::forget(self::key($userId));
    }

    private static function key(int $userId): string
    {
        return self::PREFIX.$userId;
    }

    private function __construct()
    {
    }
}
