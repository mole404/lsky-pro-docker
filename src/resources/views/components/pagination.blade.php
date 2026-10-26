@props(['paginator'])

@php
    // 只使用 public/css/app.css 里**确实存在**的工具类：Laravel 自带的分页模板里
    // 那些 `sm:flex` / `sm:flex-1` / `sm:items-center` / `sm:justify-between` 只出现在
    // vendor 视图里，Tailwind 只扫 resources/views，从来不会生成它们 ⇒ 桌面端那一整块
    // 永远停在 display:none，分页看起来"没有"。这个组件刻意不用任何 `sm:` 前缀，
    // 一套 flex-wrap 布局同时适配手机和桌面。
    $paginator = $paginator->withQueryString();
    $last = $paginator->lastPage();
    // 越界的 ?page=（例如停在最后一页删掉最后几张后刷新）夹回最后一页，
    // 免得出现「当前页 99、列表空、分页条整块消失」这种自己走不回来的状态。
    $current = min(max(1, (int) $paginator->currentPage()), $last);
    $total = $paginator->total();
    $start = max(1, $current - 2);
    $end = min($last, $current + 2);

    // 命中区 44px（h-11 / w-11），与站内其它交互元素的最小尺寸约定一致。
    $linkClass = 'h-11 px-3 inline-flex items-center justify-center rounded-md bg-surface text-ink hover:text-brand';
    $numberClass = 'h-11 w-11 inline-flex items-center justify-center rounded-md bg-surface text-ink hover:text-brand';
    $currentClass = 'h-11 w-11 inline-flex items-center justify-center rounded-md bg-brand-soft text-brand';
    // 禁用态不着底色 + 灰字 + 不可选中：只靠一点点色差区分，触屏上会被当成可点。
    $disabledClass = 'h-11 px-3 inline-flex items-center justify-center rounded-md text-ink-3 select-none cursor-not-allowed';
@endphp

<nav role="navigation" aria-label="分页导航" {{ $attributes->merge(['class' => 'mt-4']) }}>
    <div class="flex flex-wrap items-center justify-center gap-2 text-sm">
        {{-- 总数放在翻页判断之外：只有一页时也该看得出「全部就这些」。 --}}
        <span class="text-ink-2">共 {{ $total }} 条</span>

        @if($last > 1)
            @if($current <= 1)
                <span aria-disabled="true" class="{{ $disabledClass }}">上一页</span>
            @else
                <a href="{{ $paginator->url($current - 1) }}" rel="prev" class="{{ $linkClass }}">上一页</a>
            @endif

            @if($start > 1)
                <a href="{{ $paginator->url(1) }}" class="{{ $numberClass }}">1</a>
                @if($start > 2)
                    <span aria-hidden="true" class="h-11 w-11 inline-flex items-center justify-center text-ink-2 select-none">…</span>
                @endif
            @endif

            @for($page = $start; $page <= $end; $page++)
                @if($page === $current)
                    <span aria-current="page" class="{{ $currentClass }}">{{ $page }}</span>
                @else
                    <a href="{{ $paginator->url($page) }}" class="{{ $numberClass }}">{{ $page }}</a>
                @endif
            @endfor

            @if($end < $last)
                @if($end < $last - 1)
                    <span aria-hidden="true" class="h-11 w-11 inline-flex items-center justify-center text-ink-2 select-none">…</span>
                @endif
                <a href="{{ $paginator->url($last) }}" class="{{ $numberClass }}">{{ $last }}</a>
            @endif

            @if($current >= $last)
                <span aria-disabled="true" class="{{ $disabledClass }}">下一页</span>
            @else
                <a href="{{ $paginator->url($current + 1) }}" rel="next" class="{{ $linkClass }}">下一页</a>
            @endif
        @endif
    </div>
</nav>
