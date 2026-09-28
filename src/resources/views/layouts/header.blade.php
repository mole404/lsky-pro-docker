<header class="transition-all duration-300 w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
    <x-container class="w-full px-6 flex justify-between items-center">
        <div class="flex justify-start items-center max-w-[70%]">
            {{-- 桌面上这个按钮折叠/展开侧栏，手机上仍开关抽屉（同一个语义：开关侧栏） --}}
            <a href="javascript:void(0)" @click="$store.sidebar.toggleSmart()" title="开关侧栏"
               class="w-9 h-9 rounded-lg -ml-1 mr-2 flex justify-center items-center text-ink-2 hover:bg-surface-2">
                {{-- 手机：抽屉（☰）；桌面：箭头，方向表示侧栏会往哪边收 --}}
                <i class="fas fa-bars text-lg sm:hidden"></i>
                <i class="hidden sm:inline-block fas text-sm"
                   :class="$store.sidebar.collapsed ? 'fa-chevron-right' : 'fa-chevron-left'"></i>
            </a>
            <a href="" class="text-[15px] font-semibold truncate text-ink" id="header-title">@yield('title', \App\Utils::config(\App\Enums\ConfigKey::AppName))</a>
        </div>
        <div class="flex justify-end items-center space-x-3">
            <x-theme-switch />
            @includeWhen($_is_notice, 'layouts.notice')
            @includeWhen($_group->strategies->isNotEmpty(), 'layouts.strategies')
            @include('layouts.user-nav')
        </div>
    </x-container>
</header>
