@props(['paginator'])

@php
    // 只使用 public/css/app.css 里**确实存在**的工具类：Laravel 自带的分页模板里
    // 那些 `sm:flex` / `sm:flex-1` / `sm:items-center` / `sm:justify-between` 只出现在
    // vendor 视图里，Tailwind 只扫 resources/views，从来不会生成它们 ⇒ 桌面端那一整块
    // 永远停在 display:none，分页看起来"没有"。这个组件刻意不用任何 `sm:` 前缀，
    // 一套 flex-wrap 布局同时适配手机和桌面。
    $paginator = $paginator->withQueryString();
    $current = $paginator->currentPage();
    $last = $paginator->lastPage();
    $total = $paginator->total();
    $start = max(1, $current - 2);
    $end = min($last, $current + 2);
@endphp

@if($last > 1)
    <div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span class="text-ink-2">共 {{ $total }} 条</span>

        @if($paginator->onFirstPage())
            <span class="px-3 py-1 rounded-md bg-surface-2 text-ink-2 cursor-not-allowed">上一页</span>
        @else
            <a href="{{ $paginator->previousPageUrl() }}" class="px-3 py-1 rounded-md bg-surface text-ink hover:text-brand">上一页</a>
        @endif

        @if($start > 1)
            <a href="{{ $paginator->url(1) }}" class="px-3 py-1 rounded-md bg-surface text-ink hover:text-brand">1</a>
            @if($start > 2)
                <span class="px-3 py-1 text-ink-2">…</span>
            @endif
        @endif

        @for($page = $start; $page <= $end; $page++)
            @if($page === $current)
                <span class="px-3 py-1 rounded-md bg-brand-soft text-brand">{{ $page }}</span>
            @else
                <a href="{{ $paginator->url($page) }}" class="px-3 py-1 rounded-md bg-surface text-ink hover:text-brand">{{ $page }}</a>
            @endif
        @endfor

        @if($end < $last)
            @if($end < $last - 1)
                <span class="px-3 py-1 text-ink-2">…</span>
            @endif
            <a href="{{ $paginator->url($last) }}" class="px-3 py-1 rounded-md bg-surface text-ink hover:text-brand">{{ $last }}</a>
        @endif

        @if($paginator->hasMorePages())
            <a href="{{ $paginator->nextPageUrl() }}" class="px-3 py-1 rounded-md bg-surface text-ink hover:text-brand">下一页</a>
        @else
            <span class="px-3 py-1 rounded-md bg-surface-2 text-ink-2 cursor-not-allowed">下一页</span>
        @endif
    </div>
@endif
