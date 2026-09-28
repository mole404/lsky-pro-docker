<header class="transition-all duration-300 w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
    <x-container class="w-full px-6 flex justify-between items-center">
        <div class="flex justify-start items-center max-w-[70%]">
            <a href="javascript:void(0)" @click="$store.sidebar.toggle()" class="w-9 h-9 rounded-lg sm:hidden -ml-1 mr-2 flex justify-center items-center text-ink-2 hover:bg-surface-2">
                <i class="fas fa-bars text-lg"></i>
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
