<header class="transition-all duration-300 w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
    {{-- relative 是必需的：下面那个按钮用 absolute 贴到顶栏最左侧 = 这个容器的盒左缘。 --}}
    <x-container class="relative w-full px-6 flex justify-between items-center">
        {{-- 折叠/展开侧栏（同一语义：开关侧栏），手机仍是抽屉开关。
             用绝对定位而不是负 margin：容器左外边距随侧栏宽度（16rem / 折叠 4rem）和断点变，
             负 margin 得逐断点手算，贴容器自身左缘则展开收起两态都对 ——
             桌面贴内容区左缘（侧栏右边缘那道线），手机（无偏移）贴视口左缘。
             w-8 h-8 = 32×32 悬浮方块：桌面内容区左缘在容器左缘右侧 40px（px-10），
             36（老师原来的 w-9）只剩 4px 间隙、视觉上贴到标题上，32 才留够 8px；
             同时与侧栏里同款小按钮（w-8 h-8 rounded-lg hover:bg-surface-2）尺寸一致。
             mt-3 让它在 56px 顶栏里垂直居中（(56-32)/2 = 12px），实测中心偏差 < 0.5px。 --}}
        <a href="javascript:void(0)" @click="$store.sidebar.toggleSmart()" title="开关侧栏"
           class="absolute left-0 top-0 mt-3 w-8 h-8 rounded-lg flex justify-center items-center text-ink-2 hover:bg-surface-2">
            {{-- 手机：抽屉（☰）；桌面：箭头，方向表示侧栏会往哪边收 --}}
            <i class="fas fa-bars text-lg sm:hidden"></i>
            <i class="hidden sm:inline-block fas text-sm"
               :class="$store.sidebar.collapsed ? 'fa-chevron-right' : 'fa-chevron-left'"></i>
        </a>
        {{-- 标题左缘 = 页面内容左缘。顶栏与页面内容是同一个 x-container，同一断点下内边距相同
             （<768px: px-6 = 24px；≥768px: md:px-10 = 40px），所以 md 起 pl-0 即精确对齐：
             实测 1440px 展开态标题 296.0 == 仪表盘卡片左缘 296.0（Δ0.0），侧栏折叠态 104.0 == 104.0。
             上一轮的 pl-10 是"位置补偿"（让标题视觉 x 不变），代价就是永远比内容右 40px —— 去掉。
             手机/窄屏（<768px）内容左缘 24px 落在按钮（0..32）下面，物理上无法对齐，
             退回"按钮右缘 + 8px" = 32 + 8 = 40 = 24（容器内边距）+ pl-4（16px）。 --}}
        <div class="flex justify-start items-center max-w-[70%] pl-4 md:pl-0">
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
