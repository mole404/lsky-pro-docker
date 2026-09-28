@props(['active'])

@php
$classes = "ls-nav-item" . (($active ?? false) ? ' is-active' : '');
@endphp

<a {{ $attributes->merge(['class' => $classes, 'title' => $name]) }}>
    {{ $icon }}
    <span class="truncate">{{ $name }}</span>
</a>
