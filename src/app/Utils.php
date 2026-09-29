<?php

namespace App;

use App\Enums\ConfigKey;
use App\Models\Config;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class Utils
{
    public static function e(\Throwable $e, $message = '', $level = 'error')
    {
        Log::{$level}($message, [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'message' => $e->getMessage(),
            'trace' => $e->getTraceAsString(),
        ]);
    }

    /**
     * 获取头像地址
     *
     * fork：改为返回本地默认头像（public/images/default-avatar.svg）。
     * 全站没有换头像功能 —— 所有用户都是同一个固定图标，为一个静态图标每次请求
     * 都去 cravatar.cn 拉一次（外站，实测 376B / 0.85~0.96s，还多一次重定向，
     * 慢的时候整页的 load 都跟着等）没有任何收益。改成同源静态文件后是零外站依赖：
     * 快（本地文件，可缓存）、稳（外站挂了也照样出图）。
     *
     * $s / $d / $r 是远程服务（尺寸 / 默认图类型 / 分级过滤）的参数，本地图标用不上，
     * 保留形参只为兼容既有调用方。
     */
    public static function getAvatar($email, int $s = 96, string $d = 'mp', string $r = 'g'): string
    {
        $path = 'images/default-avatar.svg';

        return asset($path).'?v='.self::assetVersion($path);
    }

    /**
     * 获取系统配置，获取全部配置时将返回
     *
     * @param  string  $name
     * @param  mixed|null  $default
     *
     * @return mixed
     */
    public static function config(string $name = '', mixed $default = null): mixed
    {
        /** @var Collection $configs */
        $configs = Cache::rememberForever('configs', function () {
            return Config::query()->pluck('value', 'name')->transform(function ($value, $key) {
                switch ($key) {
                    case ConfigKey::IsAllowGuestUpload:
                    case ConfigKey::IsEnableApi:
                    case ConfigKey::IsEnableRegistration:
                    case ConfigKey::IsUserNeedVerify:
                        $value = (bool) $value;
                        break;
                    case ConfigKey::Mail:
                    case ConfigKey::Group:
                        $value = collect(json_decode($value, true));
                        break;
                    case ConfigKey::UserInitialCapacity:
                        $value = sprintf('%.2f', $value);
                        break;
                    default:
                }
                return $value;
            });
        });
        return '' === $name ? $configs : $configs->get($name, $default);
    }

    /**
     * 生成连续日期.
     * @param  string  $start  开始日期
     * @param  string  $end  结束日期
     * @param  string  $unit  day=日，month=月，year=年
     * @return array
     */
    public static function makeDateRange(string $start, string $end, string $unit = 'day'): array
    {
        $array = [];
        $format = ['day' => 'Y-m-d', 'month' => 'Y-m', 'year' => 'Y'][$unit] ?? 'Y-m-d';
        Carbon::create($start)->range($end, 1, $unit)->forEach(function (Carbon $item) use (&$array, $format) {
            $array[] = $item->format($format);
        });
        return $array;
    }

    /**
     * 转换字段单位
     *
     * @param  int|float  $size  字节b
     * @return string
     */
    public static function formatSize(int|float $size): string
    {
        if ($size <= 0) {
            return "0.00 Bytes";
        }
        $unit = ['', 'K', 'M', 'G', 'T', 'P'];
        $base = 1024;
        $i = floor(log($size, $base));
        $n = count($unit);
        if ($i >= $n) {
            $i = $n - 1;
        }

        return sprintf("%.2f", $size / pow($base, $i)).' '.$unit[$i].'B';
    }

    /**
     * 格式化数字
     *
     * @param int|string $n 数字
     * @param int $precision 精度
     * @return int|string
     */
    public static function shortenNumber(int|string $n, int $precision = 1): int|string
    {
        if ($n < 1e+3) {
            return number_format($n);
        } else if ($n < 1e+6) {
            return number_format($n / 1e+3, $precision) . 'k';
        } else if ($n < 1e+9) {
            return number_format($n / 1e+6, $precision) . 'm';
        } else if ($n < 1e+12) {
            return number_format($n / 1e+9, $precision) . 'b';
        }

        return $n;
    }

    /**
     * 递归过滤数组元素
     *
     * @param  array  $array
     * @param  callable|null  $callback
     * @param  int  $mode
     * @return array
     */
    public static function filter(array $array, callable $callback = null, int $mode = 0): array
    {
        foreach ($array as &$value) {
            if (is_array($value)) {
                $value = self::filter($value, $callback, $mode);
            }
        }
        return array_filter($array, $callback, $mode);
    }

    /**
     * 格式化配置，设置默认配置以及将字符串数字转换为数字
     *
     * @param  array  $defaults  默认配置
     * @param  array  $configs  新配置
     * @return array
     */
    public static function parseConfigs(array $defaults, array $configs): array
    {
        array_walk_recursive($configs, function (&$item) {
            if (ctype_digit($item)) {
                $item += 0;
            }
            if (is_null($item)) {
                unset($item);
            }
        });
        return self::array_merge_recursive_distinct($defaults, $configs);
    }

    /**
     * @param array<int|string, mixed> $array1
     * @param array<int|string, mixed> $array2
     *
     * @return array<int|string, mixed>
     */
    private static function array_merge_recursive_distinct(array $array1, array &$array2): array
    {
        $merged = $array1;
        foreach ($array2 as $key => &$value) {
            if (is_array($value) && isset($merged[$key]) && is_array($merged[$key]) && ! array_is_list($value)) {
                $merged[$key] = self::array_merge_recursive_distinct($merged[$key], $value);
            } else {
                $merged[$key] = $value;
            }
        }

        return $merged;
    }

    /**
     * fork：给静态资源生成版本号（用于 ?v= 打缓存失效）。
     *
     * 用文件修改时间：镜像每次构建、卷每次同步都会刷新它 —— 前端资源一改，
     * 浏览器立刻拿到新的，不会像写死 ?t=20260928ui 那样一直吃旧 app.js
     * （曾经因此出现"侧栏折叠按钮点了没反应"：新按钮调用的函数在旧的 bundle 里不存在）。
     */
    public static function assetVersion(string $path): string
    {
        $full = public_path($path);

        return file_exists($full) ? (string) filemtime($full) : '0';
    }

    /**
     * fork：取镜像内记录的短 commit（7 位）。
     *
     * 值来自镜像里的 .code-revision 标记（Dockerfile 构建时写入 fork_sha=…，
     * entrypoint 首次启动时同步进数据卷）。没有标记文件（例如本地开发环境）返回空串。
     * 后台「关于」与控制台「软件版本」都用它，避免各自读文件、各写一份逻辑。
     */
    public static function shortCommit(): string
    {
        $marker = base_path('.code-revision');

        if (! is_readable($marker)) {
            return '';
        }

        if (! preg_match('/^fork_sha=([0-9a-f]{7,40})/m', (string) file_get_contents($marker), $matches)) {
            return '';
        }

        return substr($matches[1], 0, 7);
    }

}
