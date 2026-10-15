@props([
    'segments' => [],
    'usedPercent' => 0,
    'tip' => 'above',      // above：气泡在条上方（仪表盘卡片里）；below：气泡在条下方（侧栏容器内不会被裁）
    'barClass' => 'h-1.5',
])

@php
    // 第 13 个策略起是程序化补色（调色板只有 12 个），变量在这儿现生成
    $extraStyle = \App\Support\StorageUsage::extraStyle($segments);
@endphp

@if ($extraStyle !== '')
    <style>{!! $extraStyle !!}</style>
@endif

@if ($segments === [])
    {{-- 没有可用分段（没图、或占用为 0）：退回原来的单色条 --}}
    <div class="w-full rounded-full bg-surface-3 overflow-hidden {{ $barClass }}">
        <div class="h-full rounded-full bg-brand" style="width: {{ $usedPercent }}%"></div>
    </div>
@else
    <div class="ls-segbar {{ $barClass }}" role="img" aria-label="储存用量按存储策略分布">
        @foreach ($segments as $segment)
            @php
                // 段宽 = 该策略占「已用量」的比例 × 整条填充比例 —— 整条长度仍表示 已用 / 配额
                $width = $usedPercent * $segment['share'] / 100;
            @endphp
            <div class="ls-seg" style="width: {{ round($width, 4) }}%; background: {{ $segment['color'] }}">
                <span class="ls-seg__tip @if ($tip === 'below') ls-seg__tip--below @endif">
                    <span class="ls-seg__tip-name">{{ $segment['name'] }}</span>
                    <span class="ls-seg__tip-num">{{ \App\Utils::formatSize($segment['kb'] * 1024) }} · {{ $segment['images'] }} 张 · {{ round($segment['share'], 1) }}%</span>
                </span>
            </div>
        @endforeach
    </div>
@endif
