@props([
    'segments' => [],
    'usedPercent' => 0,
    'barClass' => 'h-1.5',
])

@php
    // 第 13 个策略起是程序化补色（调色板只有 12 个），变量在这儿现生成
    $extraStyle = \App\Support\StorageUsage::extraStyle($segments);

    // 悬浮气泡挂到「整条」上定位，而不是挂在那一小段上：
    // 彩色段常常只占条最左边几十像素（用量 3% 时三段全挤在 30px 内），
    // 气泡有 210px 宽，挂在小段上会直接跑到条外被容器裁掉（实测：左侧被切）。
    // start = 该段在已用部分里的累计宽度（%），再用 min() 夹住上限，气泡永远留在条内；
    // 这里的宽度要和 CSS 里的 --ls-tip-w 一致，改一个就得改另一个。
    $tipWidth = 212;
    $laid = [];
    $offset = 0.0;
    foreach ($segments as $segment) {
        $laid[] = ['segment' => $segment, 'start' => $offset];
        $offset += $usedPercent * $segment['share'] / 100;
    }
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
        @foreach ($laid as $item)
            @php
                $segment = $item['segment'];
                // 段宽 = 该策略占「已用量」的比例 × 整条填充比例 —— 整条长度仍表示 已用 / 配额
                $width = $usedPercent * $segment['share'] / 100;
            @endphp
            <div class="ls-seg" style="width: {{ round($width, 4) }}%; background: {{ $segment['color'] }}">
                {{-- 气泡一律在条上方（侧栏放下方会盖住「已用/总量」那行字）；左右由内联的 min() 夹在条内 --}}
                <span class="ls-seg__tip"
                      style="left: min({{ round($item['start'], 4) }}%, calc(100% - {{ $tipWidth }}px))">
                    <span class="ls-seg__tip-name">{{ $segment['name'] }}</span>
                    <span class="ls-seg__tip-num">{{ \App\Utils::formatSize($segment['kb'] * 1024) }} · {{ $segment['images'] }} 张 · {{ round($segment['share'], 1) }}%</span>
                </span>
            </div>
        @endforeach
    </div>
@endif
