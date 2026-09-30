<header class="transition-all duration-300 w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
    {{-- relative 是必需的：下面那个按钮用 absolute 贴到顶栏最左侧 = 这个容器的盒左缘。 --}}
    {{-- ⚠ 这里显式再写一次 md:px-10：x-container 在 images/admin.images 两条路由上会切成
         「全宽变体」（去掉全部水平内边距，图片墙铺满），而顶栏不是全宽页 —— 那两条路由下
         顶栏容器只剩 px-6（24px），标题右缘就落进按钮 [0,32] 里面（实测标题 280 < 按钮右缘 288，
         差 −8px，就是老师截图里 ‹ 压在「我」上的样子）。补上 md:px-10 后顶栏在 ≥768px
         所有路由下内边距恒为 40px（普通路由本来就有，等于空操作），与按钮/标题的距离无关路由。
         只补到 md（不写 lg/xl/2xl）：图片页在 2xl 仍是「宽屏全宽页」，顶栏保持 40px 内缩比
         跟着 2xl:px-60（240px）缩进更贴合该页形态，且两种取值下都不会碰到按钮。 --}}
    <x-container class="relative w-full px-6 md:px-10 flex justify-between items-center">
        {{-- 折叠/展开侧栏（同一语义：开关侧栏），手机仍是抽屉开关。
             用绝对定位而不是负 margin：容器左外边距随侧栏宽度（16rem / 折叠 4rem）和断点变，
             负 margin 得逐断点手算，贴容器自身左缘则展开收起两态都对 ——
             桌面贴内容区左缘（侧栏右边缘那道线），手机（无偏移）贴视口左缘。
             w-8 h-8 = 32×32 悬浮方块：桌面内容区左缘在容器左缘右侧 40px（px-10），
             36（老师原来的 w-9）只剩 4px 间隙、视觉上贴到标题上，32 才留够 8px；
             同时与侧栏里同款小按钮（w-8 h-8 rounded-lg hover:bg-surface-2）尺寸一致。
             mt-3 让它在 56px 顶栏里垂直居中（(56-32)/2 = 12px），实测中心偏差 < 0.5px。
             ⚠ 按钮「占位区间」= [容器左缘 + 3, 容器左缘 + 35]（absolute left-[3px] 相对的是容器的
             padding box，内边距不会把它推开；3px 是老师要的「别顶到边上」的内缩，上限 4px），
             所以任何情况下标题左缘都不得小于 容器左缘 + 43（= 3 + 32 + 8）。 --}}
        <a href="javascript:void(0)" @click="$store.sidebar.toggleSmart()" title="开关侧栏"
           class="absolute left-[3px] top-0 mt-3 w-8 h-8 rounded-lg flex justify-center items-center text-ink-2 hover:bg-surface-2">
            {{-- 手机：抽屉（☰）；桌面：箭头，方向表示侧栏会往哪边收 --}}
            <i class="fas fa-bars text-lg sm:hidden"></i>
            <i class="hidden sm:inline-block fas text-sm"
               :class="$store.sidebar.collapsed ? 'fa-chevron-right' : 'fa-chevron-left'"></i>
        </a>
        {{-- 标题位置 = 按钮右缘 + 13px（实测，真 Chromium + 真 app.css，32 种情形全部 gap=13）：
             容器内边距 <768px 是 px-6(24)、768~1535px 是 md:px-10(40)，差 16px；标题左边距
             pl-6(24) → md:pl-2(8) 也正好差 16px，两者相抵 ⇒ 标题绝对 x = 容器左缘 + 48
             在 <768 与 768~1535 两段是同一个值（跨 768px 不跳）。≥1536px（2xl）容器内边距
             跟着 2xl:px-60 变 240，标题 = 容器左缘 + 248，仍比该断点的内容左缘右 8px。
             普通页（示例 1440 / 侧栏展开）：内容左缘 296 → 标题 304，比内容右 8px（老师要的 4~8px）；
                                          按钮右缘 291 → 间隙 13 ✅
             图片页（同一 1440）：该页内容左缘 256 落在按钮区间 [259,291] 里，物理上无法对齐；
                                 标题最小安全位 259+32+8 = 299，取 304 =「不重叠」与
                                 「与普通页标题同 x」两个约束的交点。
             窄屏（390）：容器左缘 0、按钮 [3,35]、标题 48 → 间隙同样 13px。 --}}
        <div class="flex justify-start items-center max-w-[70%] pl-6 md:pl-2">
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
