<?php

/**
 * ExportConcurrency 测试用的最小依赖桩。
 *
 * 为什么需要：ExportConcurrency 走 Laravel 门面（Cache / Log），而 CI 只起一个
 * php:8.3-cli 容器（没有 vendor/），真框架在这套零依赖装置里不可用。
 * 这里只实现被测代码真正用到的那几个方法：
 *   Cache::get / put / lock（lock 在单进程里立刻执行回调，不真互斥）
 *   Log::warning（记行数，「缓存坏掉不许刷屏」那条断言靠它）
 * 桩里带一个内存 store，测试可以预置/篡改条目，造出「心跳过期」「旧版裸时间戳」「畸形条目」。
 *
 * 注意（踩过的坑）：这里必须用**非括号式** namespace —— 被测源码那个文件用的是
 * `namespace App\Support;`，同一份文件里两种写法不能混（PHP 会直接报
 * "Cannot mix bracketed namespace declarations with unbracketed..."），
 * 而本文件要跟源码 concat 成一个文件跑。
 */

namespace Illuminate\Contracts\Cache;

class LockTimeoutException extends \Exception
{
}

namespace Illuminate\Support\Facades;

class Cache
{
    /** 内存里的假缓存（键 => 值） */
    public static array $store = [];

    /** true = 读写一律抛错，用来测「缓存不可用就降级，绝不拦着用户导出」 */
    public static bool $fail = false;

    public static function get(string $key, $default = null)
    {
        if (self::$fail) {
            throw new \RuntimeException('cache down');
        }

        return self::$store[$key] ?? $default;
    }

    public static function put(string $key, $value, $ttl = null): bool
    {
        if (self::$fail) {
            throw new \RuntimeException('cache down');
        }

        self::$store[$key] = $value;

        return true;
    }

    public static function lock(string $name, int $seconds = 0)
    {
        if (self::$fail) {
            throw new \RuntimeException('cache down');
        }

        // 单进程测试不需要真互斥：block() 直接执行回调并透传返回值
        return new class {
            public function block(int $wait, callable $callback)
            {
                return $callback();
            }
        };
    }

    public static function reset(): void
    {
        self::$store = [];
        self::$fail = false;
    }
}

class Log
{
    /** 记下来的日志行数（只留 message，够断言用） */
    public static array $lines = [];

    public static function warning($message, array $context = []): void
    {
        self::$lines[] = (string) $message;
    }
}
