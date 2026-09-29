{{--
 | 外观切换（三态：跟随系统 / 亮色 / 暗色）
 | 纯 Alpine + 一个 store，不碰任何既有交互逻辑；状态存在 localStorage，首屏由 layouts 里的内联脚本恢复。
--}}
<div class="relative" x-data="{ open: false }" x-cloak @click.outside="open = false">
    <button type="button" @click="open = !open"
            class="ls-btn ls-btn-sm px-0 w-10 h-10 rounded-full border-line"
            :title="'外观：' + ($store.theme.mode === 'system' ? '跟随系统' : ($store.theme.mode === 'dark' ? '暗色' : '亮色'))">
        <span class="sr-only">切换外观</span>
        {{-- 跟随系统 --}}
        <svg x-show="$store.theme.mode === 'system'" class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2.5" y="3.5" width="15" height="10" rx="1.8"/>
            <path d="M7 16.5h6M10 13.5v3"/>
        </svg>
        {{-- 亮色 --}}
        <svg x-show="$store.theme.mode === 'light'" class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="10" cy="10" r="3.4"/>
            <path d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8"/>
        </svg>
        {{-- 暗色 --}}
        <svg x-show="$store.theme.mode === 'dark'" class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15.5 12.4A5.8 5.8 0 0 1 8 4.6a6 6 0 1 0 7.5 7.8z"/>
        </svg>
    </button>

    <div x-show="open"
         x-transition:enter="transition ease-out duration-150"
         x-transition:enter-start="opacity-0 -translate-y-1"
         x-transition:enter-end="opacity-100 translate-y-0"
         x-transition:leave="transition ease-in duration-100"
         x-transition:leave-start="opacity-100"
         x-transition:leave-end="opacity-0"
         class="absolute right-0 mt-2 w-36 z-[10] ls-menu"
         style="display: none">
        <a class="ls-menu-item flex items-center gap-2"
           :class="$store.theme.mode === 'system' ? 'text-brand font-semibold' : ''"
           @click="$store.theme.set('system'); open = false">
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round">
                <rect x="2.5" y="3.5" width="15" height="10" rx="1.8"/>
                <path d="M7 16.5h6M10 13.5v3"/>
            </svg>
            <span>跟随系统</span>
        </a>
        <a class="ls-menu-item flex items-center gap-2"
           :class="$store.theme.mode === 'light' ? 'text-brand font-semibold' : ''"
           @click="$store.theme.set('light'); open = false">
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round">
                <circle cx="10" cy="10" r="3.4"/>
                <path d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8"/>
            </svg>
            <span>亮色</span>
        </a>
        <a class="ls-menu-item flex items-center gap-2"
           :class="$store.theme.mode === 'dark' ? 'text-brand font-semibold' : ''"
           @click="$store.theme.set('dark'); open = false">
            <svg class="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round">
                <path d="M15.5 12.4A5.8 5.8 0 0 1 8 4.6a6 6 0 1 0 7.5 7.8z"/>
            </svg>
            <span>暗色</span>
        </a>
    </div>
</div>
