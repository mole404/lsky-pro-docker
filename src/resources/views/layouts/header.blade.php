<header class="ls-app-header transition-all duration-300 w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
    {{-- relative 是必需的：下面那个按钮用 absolute 贴到顶栏最左侧 = 这个容器的盒左缘。 --}}
    {{-- ⚠ 顶栏容器「只传 px-6」，绝不能再在这里补 md:px-10 —— 补过一次，是回归：
         x-container 的默认类在 images/admin.images 两条路由上会切成「全宽变体」（去掉全部
         水平内边距，图片墙铺满），因此顶栏内边距是「图片页 24px、普通页 40px」（后者来自容器
         默认类的 px-6 md:px-10 lg/xl:px-10 2xl:px-60）。这是有意的路由差异，不是 bug。
         在这里再补 md:px-10 会把图片页的右内边距也顶成 40，把右上角那组图标整体往里推 16px
         （实测里的回归）。路由差异一律交给容器默认类 + 下面标题组的 routeIs 分支处理。 --}}
    <x-container class="relative w-full px-6 flex justify-between items-center">
        {{-- 折叠/展开侧栏（同一语义：开关侧栏），手机仍是抽屉开关。
             用绝对定位而不是负 margin：容器左外边距随侧栏宽度（16rem / 折叠 4rem）和断点变，
             负 margin 得逐断点手算，贴容器自身左缘则展开收起两态都对 ——
             桌面贴内容区左缘（侧栏右边缘那道线），手机（无偏移）贴视口左缘。
             w-8 h-8 = 32×32 悬浮方块：桌面内容区左缘在容器左缘右侧 40px（px-10），
             36（原来的 w-9）只剩 4px 间隙、视觉上贴到标题上，32 才留够 8px；
             同时与侧栏里同款小按钮（w-8 h-8 rounded-lg hover:bg-surface-2）尺寸一致。
             mt-3 让它在 56px 顶栏里垂直居中（(56-32)/2 = 12px），实测中心偏差 < 0.5px。
             ⚠ 按钮「占位区间」= [容器左缘 + 3, 容器左缘 + 35]（absolute left-[3px] 相对的是容器的
             padding box，内边距不会把它推开；8px 是需要的「别顶到边上」的内缩，左右相等），
             所以任何情况下标题左缘都不得小于 容器左缘 + 43（= 3 + 32 + 8）。 --}}
        <a href="javascript:void(0)" @click="$store.sidebar.toggleSmart()" title="开关侧栏"
           class="absolute left-2 top-0 mt-3 w-8 h-8 rounded-lg flex justify-center items-center text-ink-2 hover:bg-surface-2">
            {{-- 侧栏图案（矩形 + 靠左的栏分隔线）：桌面与竖屏共用同一个图标。
                 栏里那个小箭头表示点下去侧栏会往哪边收，两态由 CSS 按 <html> 上的 .sidebar-collapsed 切换
                 （规则在 resources/css/common.less；store 的 applyCollapsed() 一直在贴这个类）——
                 不用 Alpine 的 x-show/x-cloak：JS 没起来时图标也一定正确。
                 方向：桌面展开态朝左（点它往左收起）、折叠态朝右；竖屏是抽屉，固定用朝右那个
                 （点它把侧栏从左边拉出来，朝右才符合直觉）—— 见 common.less 的媒体查询。 --}}
            <svg class="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="2.5" y="3.5" width="15" height="13" rx="2.6"/>
                <path d="M9.2 3.5v13"/>
                <path class="ls-sidebar-arrow-left" d="M14.1 8.3 12.6 10l1.5 1.7"/>
                <path class="ls-sidebar-arrow-right" d="M12.6 8.3 14.1 10l-1.5 1.7"/>
            </svg>
        </a>
        {{-- 标题左边距「按路由区分」，与 x-container 的 routeIs 分支同源（一行三元，保持可读）：
             容器内边距图片页恒为 24（该页是全宽变体，水平内边距只剩顶栏自己传的 px-6），
             普通页 <768px 为 24(px-6)、≥768px 为 40(md:px-10)，两者差 16px。
             - 图片页：pl-6(24) → 标题 = 容器左缘 + 48，容器内边距不随断点变，恒成立。
             - 普通页：pl-6 md:pl-2（24/8）与容器内边距 24/40 逐段差 16、正好相抵
                      ⇒ 标题同为容器左缘 + 48，跨 768px 不跳。
             两路由标题绝对 x 都是容器左缘 + 48，恒 > 按钮右缘（容器左缘 + 35），间距恒 13px，
             满足硬指标「标题左缘 − 按钮右缘 ≥ 8」。（≥1536px 普通页容器内边距变 2xl:px-60
             = 240，标题 = 左缘 + 248；图片页仍是 +48，离右侧图标组还很远。）
             反例：若统一写 pl-6 md:pl-2，图片页 ≥768px 会按「容器 40」的假设把标题压到
             容器左缘 + 32，比按钮右缘还左 3px —— 就是实测里 ‹ 压在「我」上的样子。 --}}
        <div class="ls-header-title flex justify-start items-center max-w-[70%] {{ request()->routeIs('images', 'admin.images') ? 'pl-6' : 'pl-6 md:pl-2' }}">
            <a href="" class="text-[15px] font-semibold truncate text-ink" id="header-title">@yield('title', \App\Utils::config(\App\Enums\ConfigKey::AppName))</a>
        </div>
        {{-- 与左侧折叠按钮对称：绝对定位贴容器盒右缘内缩 8px。absolute 相对容器的
             padding box，所以容器内边距（图片页 24 / 普通页 40 / 2xl 240）推不动它 ——
             左右两端因此在同一套规则下对齐（各内缩 8px）。 --}}
        <div class="absolute right-2 inset-y-0 flex items-center space-x-3">
            <x-theme-switch />
            @includeWhen($_is_notice, 'layouts.notice')
            @includeWhen($_group->strategies->isNotEmpty(), 'layouts.strategies')
            @include('layouts.user-nav')
        </div>
    </x-container>
</header>
