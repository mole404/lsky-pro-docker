@props([
    'classes' => ['left' => 'origin-top-right right-0', 'right' => 'origin-top-left left-0'],
    'direction' => 'left',
    // 面板宽度：默认 w-48（条目长的菜单）；内容短的（如外观切换只有三个词）传 w-36
    'panelClass' => 'w-48',
    // 触发器按钮的 id —— 面板的 aria-labelledby 指向它。
    // 不传就不输出这个属性（老版本把它写死成 user-menu-button，于是除用户菜单外全指向错的元素）。
    'labelledby' => null,
])

<div class="relative" x-data="{ open: false }" @click.outside="open = false" x-cloak>
    <div @click="open = ! open">
        {{ $trigger }}
    </div>

    {{-- 面板动画只在这里定义一处：6 个使用点（用户菜单 / 存储策略 / 图片页三个 / 外观切换）共用同一套，
         改动画只改这六行；任何一个使用点都不要再写自己的 x-transition（否则又是第二套动画）。 --}}
    <div x-show="open"
         x-transition:enter="transition ease-out duration-200"
         x-transition:enter-start="transform opacity-0 translate-y-9"
         x-transition:enter-end="transform opacity-100 translate-y-0"
         x-transition:leave="transition ease-in duration-75"
         x-transition:leave-start="transform opacity-100 translate-y-0"
         x-transition:leave-end="transform opacity-0 translate-y-9"
         class="ls-menu absolute z-[9] {{ $classes[$direction] }} mt-2 {{ $panelClass }}"
         role="menu"
         aria-orientation="vertical"
         @if ($labelledby) aria-labelledby="{{ $labelledby }}" @endif
         tabindex="-1"
         style="display: none"
    >
        {{ $content }}
    </div>
</div>
