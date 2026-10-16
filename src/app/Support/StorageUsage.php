<?php

namespace App\Support;

use App\Models\Strategy;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * 按存储策略拆分的用量统计（仪表盘与侧栏共用）。
 *
 * 为什么要拆：原来只有「一共用了多少」—— 侧栏每个页面都跑一次 User::useCapacity
 * 访问器（images 表 SUM(size) 聚合），仪表盘一页里更是访问 4 次。
 * 这里一次 GROUP BY strategy_id 就同时拿到总量与每个策略的占用，把那些重复聚合替掉；
 * 同一个请求里结果记在静态数组里，仪表盘与侧栏只会真正查一次。
 *
 * 单位：images.size 列是 KB、users.capacity 也是 KB，本类一律以 KB 返回；
 * 视图要字节时自己 ×1024 交给 App\Utils::formatSize（沿用站内唯一那套格式化，不另造）。
 *
 * 颜色：前 12 个用调色板固定色（css/app.css 里的 --lsky-seg-1..12，亮/暗各一套）；
 * 第 13 个起按黄金角程序化生成色相（亮/暗各自的饱和度、明度在 extraStyle() 里生成）
 * —— 永不循环复用，策略再多也不会出现两条同色。
 * 色号按 strategy_id 升序固定映射，所以刷新、切页颜色都不变。
 */
final class StorageUsage
{
    /** 调色板里固定色的个数（--lsky-seg-1..12） */
    private const PALETTE = 12;

    /** 黄金角：第 13 个起补色的色相步进；任意数量下相邻序号的色相都离得远 */
    private const GOLDEN_ANGLE = 137.508;

    /** 同一个请求里只查一次 */
    private static array $memo = [];

    /**
     * @param  array<int,string>|null  $names  strategy_id => 策略名；给了就不再单独查
     * @return array{total:int, segments:array<int,array{index:int,name:string,kb:int,images:int,share:float,color:string}>}
     */
    public static function forUser(?User $user, ?array $names = null): array
    {
        if ($user === null) {
            return self::empty();
        }

        if (isset(self::$memo[$user->id])) {
            return self::$memo[$user->id];
        }

        $rows = DB::table('images')
            ->where('user_id', $user->id)
            ->selectRaw('strategy_id, sum(size) as kb, count(*) as images')
            ->groupBy('strategy_id')
            ->get();

        $total = 0;
        $buckets = [];

        foreach ($rows as $row) {
            $kb = (int) round((float) $row->kb);

            // 没用到的策略不显示；strategy_id 为空（策略被删过）归到 0 这一档
            if ($kb <= 0) {
                continue;
            }

            $buckets[(int) ($row->strategy_id ?? 0)] = ['kb' => $kb, 'images' => (int) $row->images];
            $total += $kb;
        }

        if ($total <= 0) {
            return self::$memo[$user->id] = self::empty();
        }

        // 传进来的名字可能不全（仪表盘只传「当前组」的策略名，策略被从组里解绑后就会缺）——
        // 缺的那些补一次查询，否则同一策略在仪表盘显示成「策略 #3」、在侧栏显示真名。
        $names = $names ?? [];
        $missing = array_diff(array_keys($buckets), array_keys($names));

        if ($missing !== []) {
            $names += self::names($missing);
        }

        // 色号按 strategy_id 升序定，跟占用排序无关 —— 保证颜色不随用量变化
        $order = array_keys($buckets);
        sort($order);

        $colors = [];
        foreach ($order as $index => $id) {
            $colors[$id] = 'var(--lsky-seg-'.($index + 1).')';
        }

        $segments = [];
        foreach ($buckets as $id => $bucket) {
            $segments[] = [
                'index'  => array_search($id, $order, true),
                'name'   => $names[$id] ?? ($id === 0 ? '未指定策略' : '策略 #'.$id),
                'kb'     => $bucket['kb'],
                'images' => $bucket['images'],
                'share'  => $bucket['kb'] / $total * 100,
                'color'  => $colors[$id],
            ];
        }

        // 展示顺序：占用从大到小（与图例同序）；颜色只认 strategy_id 定的那个号，与顺序无关
        usort($segments, static fn (array $a, array $b) => $b['kb'] <=> $a['kb']);

        return self::$memo[$user->id] = ['total' => $total, 'segments' => $segments];
    }

    /**
     * 第 13 个策略起那段补色：按黄金角给色相，亮/暗各一套饱和度明度。
     * 返回可直接塞进 <style> 的 CSS；没有超出的策略时返回空串。
     */
    public static function extraStyle(array $segments): string
    {
        $extra = array_filter($segments, static fn (array $s) => $s['index'] >= self::PALETTE);

        if ($extra === []) {
            return '';
        }

        $light = [];
        $dark = [];

        foreach ($extra as $segment) {
            $hue = fmod($segment['index'] * self::GOLDEN_ANGLE, 360);
            $var = '--lsky-seg-'.($segment['index'] + 1);
            $light[] = $var.': hsl('.round($hue, 1).' 62% 47%)';
            $dark[] = $var.': hsl('.round($hue, 1).' 68% 62%)';
        }

        return ':root{'.implode(';', $light).'}html.dark{'.implode(';', $dark).'}';
    }

    /** 策略名：只取用到的那几个 id，主键命中，很轻 */
    private static function names(array $ids): array
    {
        $ids = array_values(array_filter($ids, static fn ($id) => $id > 0));

        if ($ids === []) {
            // 只用到「未指定策略」这一档，名字在 forUser 里兜底
            return [];
        }

        return Strategy::query()->whereIn('id', $ids)->pluck('name', 'id')->all();
    }

    private static function empty(): array
    {
        return ['total' => 0, 'segments' => []];
    }
}
