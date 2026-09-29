<header class="transition-all duration-300 w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
    {{-- relative 是必需的：下面那个按钮用 absolute 贴到顶栏最左侧 = 这个容器的盒左缘。 --}}
    <x-container class="relative w-full px-6 flex justify-between items-center">
        {{-- 折叠/展开侧栏（同一语义：开关侧栏），手机仍是抽屉开关。
             用绝对定位而不是负 margin：容器左外边距随侧栏宽度（16rem / 折叠 4rem）和断点变，
             负 margin 得逐断点手算，贴容器自身左缘则展开收起两态都对 ——
             桌面贴内容区左缘（侧栏右边缘那道线），手机（无偏移）贴视口左缘。
             w-11 h-11 = 44×44 点击区（原来 36×36），mt-1.5 让它在 56px 顶栏里垂直居中。 --}}
        <a href="javascript:void(0)" @click="$store.sidebar.toggleSmart()" title="开关侧栏"
           class="absolute left-0 top-0 mt-1.5 w-11 h-11 rounded-lg flex justify-center items-center text-ink-2 hover:bg-surface-2">
            {{-- 手机：抽屉（☰）；桌面：箭头，方向表示侧栏会往哪边收 --}}
            <i class="fas fa-bars text-lg sm:hidden"></i>
            <i class="hidden sm:inline-block fas text-sm"
               :class="$store.sidebar.collapsed ? 'fa-chevron-right' : 'fa-chevron-left'"></i>
        </a>
        {{-- pl-10 = 44（按钮宽）－ 4（原来的 -ml-1）+ 8（原来的 mr-2）：按钮脱流后把标题顶回原来的
             视觉 x，长标题被 truncate 截断也不会影响按钮（按钮已不在文档流里）。 --}}
        <div class="flex justify-start items-center max-w-[70%] pl-10">
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
