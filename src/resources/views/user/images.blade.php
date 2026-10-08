@section('title', '我的图片')

@push('styles')
    <link rel="stylesheet" href="{{ asset('css/justified-gallery/justifiedGallery.min.css') }}">
    <link rel="stylesheet" href="{{ asset('css/viewer-js/viewer.min.css') }}">
    <link rel="stylesheet" href="{{ asset('css/context-js/context-js.css') }}">
    <link rel="stylesheet" href="{{ asset('css/cropper-js/cropper.min.css') }}?v={{ \App\Utils::assetVersion('css/cropper-js/cropper.min.css') }}">
    {{-- fork：相册弹窗（#album-switch-modal）自己的样式。本仓库这个补丁只改这一个文件
         （common.less 不动，所以写在页面里）：
         1) 哨兵文案：与 common.less 里「只在这个弹窗里藏掉 .infinite-scroll」那条同一思路
            —— utils.infiniteScroll 往列表末尾插的那行（「加载中.../加载更多/我也是有底线的~」）
            在相册弹窗里藏掉。列表容器仍 overflow-y-auto，「滚到底继续加载下一页」靠容器自己的
            scroll 监听，能力没丢（代价同「移动到相册」弹窗：那三种文案在这个弹窗里不再显示，
            接口 status=false 时仍有 toastr.error）。
         2) 桌面宽度：x-modal 的卡片宽度是给「详细信息」那类宽内容定的（md:max-w-2xl / lg:max-w-4xl），
            相册列表在窄卡片里更好看 —— 按弹窗 id 把卡片收窄到约 520px（原来 420px，用户反馈
            「稍微加宽一些」）。手机上 x-modal 是底部抽屉
            （<640px 贴底），这条 media query 不生效，抽屉行为不受影响。
         3) 相册行的编辑/删除是**行内常显的 44×44 按钮**（不再靠 hover 才出现），所以这里
            不再需要 @media (hover: none) 那条「给触摸设备常显操作按钮」的补丁 —— 已删掉，
            别再写回来：按钮本来就常显，触摸端与桌面端行为一套。--}}
    <style>
            /* 让"切图过渡"的起点稳定在屏幕中心。
             * 库每切一张都新建 <img>：刚插进画布时用的是默认 CSS（满宽、贴顶，来自库自带的
             * .viewer-container img{width:100%;height:auto} + margin:15px auto）。之后图片加载完成，
             * 库才写内联样式：先写成"屏幕中心的一个点"，再写最终尺寸，靠 CSS 过渡补间。
             * 而过渡的起点 = 浏览器「上一次真正渲染过的样式」：若只渲染到"满宽贴顶"那一帧，
             * 动画就从屏幕上方飞进来。哪一帧被渲染由缓存/网速/主线程决定 —— 这就是"忽上忽下"。
             * 对策：用 :not([style]) 只命中"还没有内联样式"的那一瞬（库一写内联样式立刻失效，
             * 因此绝不影响最终显示、也不会和库打架），把这一瞬做成"屏幕中心的小点" ——
             * 无论渲染到哪一帧，起点都是中心。过渡照旧用库自带的，所以动画保留。 */
            /* ★ 关掉浏览器「滚动锚定」（scroll anchoring）：换排序/刷新后列表清空重排，
             *   浏览器会把哨兵当锚点、上方内容变高就自动往下补 scrollTop，于是哨兵又进视口、
             *   又触发下一页 —— 连锁滚到底。安卓 Edge 上尤其明显（安卓 Chrome / iOS 不这样）。 */
            html, body, #images-scroll, #images-scroll .infinite-scroll { overflow-anchor: none; }
            /* 注：#images-scroll 的左侧内边距曾加过 18px，老师否掉了（图库左侧不该空出一条）——
             * "左侧拖不出框"要从侧栏/判定那边解决，不能靠给网格加空白。 */
            /* ★ 让滚动条的位置**永远被预留**（桌面端）。
             *   看图器打开时库会给 body 加 .viewer-open{overflow:hidden}，滚动条消失 ⇒
             *   布局宽度凭空多出 9px（Win11 细滚动条）⇒ 内容右移/重排，关闭时再跳一次。
             *   预留 gutter 后，滚动条即使消失，那 9px 也还在 ⇒ 布局宽度不变 ⇒ 不重排。
             *   与库量到多少无关：viewerjs 的 scrollbarWidth 只在建实例那一刻量一次
             *   （render.js initBody），那时文档还没溢出，量到的是 0，所以它补的 paddingRight
             *   恒为 0px（真机实测确认过），指望它补是不行的。 */
            html { scrollbar-gutter: stable; }
            /* ★ 但真机（不同浏览器/滚动条实现）上仍偶发"抽一下"⇒ 再上一层保险，跟 sweetalert
             *   那套一致：不让库动 body。看图器打开时 .viewer-open{overflow:hidden} 会拿走滚动条，
             *   这里用更高的权重（body.viewer-open 权重 (0,1,1) > 库的 .viewer-open (0,1,0)）
             *   把它按回 visible ⇒ 滚动条一直在、可用宽度不变 ⇒ 必然不重排。
             *   看图器自身是 fixed 全屏覆盖 + touch-action:none，指针/触摸不会漏到后面；
             *   滚轮被库自己的 zoomOnWheel 处理（非 passive + preventDefault），背景也不会被滚走。 */
            body.viewer-open { overflow: visible; }
            /* ★ 再把库写的那份 body padding-right 按回 0。真机实测（老师浏览器打印）：
             *   打开看图器时 body 的 padding-right 会变成 8px —— 那正是**槽位**的宽度
             *   （库 initBody 量的就是 innerWidth − documentElement.clientWidth），
             *   而槽位已经把空间预留住了，再补一次就把内容挤窄 8px ⇒ 卡片重排
             *   （实测首卡宽度 123 → 121）。行内样式只能用 CSS !important 盖；
             *   用 @supports 兜住不支持 gutter 的旧浏览器 —— 那里这份 padding 是必需的。 */
            @supports (scrollbar-gutter: stable) {
                body.viewer-open { padding-right: 0 !important; }
            }
                        .viewer-canvas > img:not([style]) {
                width: 1px;
                height: 1px;
                margin-left: 50vw;
                margin-top: 50vh;
                opacity: 0;
            }


        #album-switch-modal .infinite-scroll {
            display: none;
        }

        @media (min-width: 768px) {
            #album-switch-modal [class*="md:max-w-2xl"] {
                max-width: 520px;
            }
        }

        /* 「显示图片标签」开关关掉时，卡片角标整体不显示（角标是每次翻页重新渲染的，
           所以用容器上的一个类来控制，而不是去改每一张卡片的 DOM）。 */
        .image-tags-off .image-tags {
            display: none;
        }

        /* ── fork：图片裁剪层（Cropper.js v1.6.3）──────────────────────────────
           桌面 html{zoom:1.1}（common.less）下给这一层套「反向缩放」，让它内部的
           布局单位 == 屏幕像素 —— 与 .viewer-container 用的是同一招，避免 Cropper
           把视觉坐标当布局坐标用（Viewer.js 当年就是这么整体偏的）。 */
        #crop-layer {
            position: fixed;
            inset: 0;
            z-index: 60;
            display: none;
            flex-direction: column;
            background: rgba(10, 12, 15, .94);
        }
        #crop-layer.is-open { display: flex; }
        @media (min-width: 768px) {
            /* 桌面 html{zoom:1.1}（common.less）下的反制，与 .viewer-container 同一招：
               · 容器自身反向缩放 ⇒ 内部「布局单位 == 屏幕像素」，Cropper 的指针坐标才不偏 10%
                 （实测：不套它时拖动选框恒定偏 +10%、不跟手）；
               · 同时把 inset:0 换成显式 width/height —— inset 版在 zoom 下只铺 90.9% 屏
                 （当年 .viewer-container 踩的就是这个坑）；注意不能用 100vw（会溢出 10%）。 */
            html #crop-layer {
                zoom: calc(1 / 1.1);
                right: auto;
                bottom: auto;
                width: 100%;
                height: 100%;
            }
        }
        #crop-layer .crop-head {
            display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
            padding: 10px 14px; color: #e6e9ee; font-size: 14px;
        }
        #crop-layer .crop-hint { color: #9aa4b2; font-size: 12.5px; }
        #crop-layer .crop-stage {
            flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
            overflow: hidden; padding: 0 8px;
        }
        #crop-layer .crop-stage img { max-width: 100%; max-height: 100%; display: block; }

        /* 框外变暗：**不用**库的 .cropper-modal。
           库那套是「半透明黑盖住整图 + 往 .cropper-view-box 里再塞一张克隆图把框内提亮」——
           真机实测那一步在 iOS(WebKit) 上不生效，表现就是整张（含框内）都是灰的
           （老师截图按像素量：框外 127、框内 140，140 正是 127 又叠了库那层 10% 白 highlight）。
           改成：关闭 modal（Cropper 选项 modal:false），用裁剪框自己的大范围 box-shadow 压暗框外 ——
           框内直接就是原图本体，没有任何遮罩压在它上面 ⇒ 各平台一致；容器裁掉阴影溢出，
           工具栏与页面其它部分不受影响。 */
        #crop-layer .cropper-container { overflow: hidden; }
        #crop-layer .cropper-view-box { box-shadow: 0 0 0 9999px rgba(0, 0, 0, .5); }
        #crop-layer .crop-bar {
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
            flex-wrap: wrap; padding: 10px 14px 14px;
        }
        #crop-layer .crop-group { display: flex; align-items: center; gap: 6px; }
        #crop-layer .crop-group a {
            color: #e6e9ee; font-size: 13.5px; line-height: 1; padding: 8px 12px;
            border-radius: 8px; background: rgba(255, 255, 255, .08);
        }
        #crop-layer .crop-group a:hover { background: rgba(255, 255, 255, .16); }
        #crop-layer .crop-group a.active { background: var(--lsky-accent, #3b82f6); color: #fff; }
        #crop-layer .crop-primary { background: var(--lsky-accent, #3b82f6) !important; color: #fff !important; }
        #crop-layer.is-busy .crop-bar { opacity: .45; pointer-events: none; }

        /* 桌面：工具组这一层等于没包（子元素直接参与底栏的三列网格） */
        #crop-layer .crop-tools { display: contents; }

        @media (min-width: 768px) {
            /* 电脑端底栏改三列网格：左右各占 1fr、中间 auto ⇒「比例」永远正居中。
               原来用 flex 的 space-between 时，左边那组多出「左右/上下翻转」两个按钮，
               中间那组就被挤得偏左了。 */
            #crop-layer .crop-bar {
                display: grid;
                grid-template-columns: 1fr auto 1fr;
                align-items: center;
            }
            #crop-layer .crop-actions { justify-content: flex-end; }
        }

        /* 手机（<768px）：
           · 「取消 / 裁剪并上传」挪到顶栏右侧（顶栏本来只放标题与尺寸提示，右边空着）；
           · 底栏只剩两组工具，自然折成两行（比例一行、旋转/翻转一行），不再横向滑动；
           · 右下角手柄从库的 20×20 收到 14×14 —— 它同时是唯一热区，但库给它配了一层
             200% 的透明 :before，所以视觉缩小后热区仍有 28×28，手感不变。 */
        @media (max-width: 767.98px) {
            #crop-layer .crop-head { padding-right: 168px; }
            #crop-layer .crop-tools { display: flex; flex-wrap: wrap; gap: 6px; }
            #crop-layer .crop-tools > .crop-group { flex: none; }
            #crop-layer .crop-actions { position: absolute; top: 9px; right: 12px; }
            #crop-layer .cropper-point.point-se { width: 14px; height: 14px; }
        }

        /* ── fork：看图器「全屏」的观感（老师要的"进去只剩图"）─────────────────
           进全屏时 JS 给 <html> 加 .ls-viewer-fs：UI 全藏、背景压成纯黑，缩放手势/拖动/切图一概不动。
           鼠标动一下或轻触一下临时淡入（.ls-fs-ui，2.5s 后自动隐）；点背景关掉看图器即彻底退出全屏。 */
        html.ls-viewer-fs .viewer-backdrop,
        html.ls-viewer-fs .viewer-container { background-color: #000; }
        /* 顺手把**页面自己**那条右侧滚动条也收掉（全屏里页面本来也不该滚），
           连"给滚动条留出来的那块空白"一起收 —— 只是 overflow:hidden 的话，
           scrollbar-gutter: stable 仍会在右边留一条 8px 的空白（老师截图里能看到）。
           全屏期间没有滚动条，也就不需要槽位 ⇒ 两条一起写。 */
        html.ls-viewer-fs { overflow: hidden; scrollbar-gutter: auto; }
        html.ls-viewer-fs .viewer-toolbar,
        html.ls-viewer-fs .viewer-navbar,
        html.ls-viewer-fs .viewer-title,
        html.ls-viewer-fs .viewer-button {
            opacity: 0 !important;
            visibility: hidden;
            transition: opacity .25s ease, visibility .25s ease;
        }
        html.ls-viewer-fs.ls-fs-ui .viewer-toolbar,
        html.ls-viewer-fs.ls-fs-ui .viewer-navbar,
        html.ls-viewer-fs.ls-fs-ui .viewer-title,
        html.ls-viewer-fs.ls-fs-ui .viewer-button {
            opacity: 1 !important;
            visibility: visible;
        }
        /* 藏起来的时候别接住指针：否则会挡住"点背景退出"和拖动 */
        html.ls-viewer-fs:not(.ls-fs-ui) .viewer-toolbar,
        html.ls-viewer-fs:not(.ls-fs-ui) .viewer-navbar,
        html.ls-viewer-fs:not(.ls-fs-ui) .viewer-title,
        html.ls-viewer-fs:not(.ls-fs-ui) .viewer-button {
            pointer-events: none;
        }

        /* 看图器工具栏的「裁剪」按钮图标。
           库的图标是一张 280px 宽的雪碧图，而且只给 14 个内置键分别写了规则
           （.viewer-zoom-in:before{content:"Zoom In";background-position:0 0} 这种）——
           自定义键不在那张枚举表里，既没有 content（伪元素根本不生成）也没有 20×20 的盒子，
           于是只剩 li 那圈黑底、看着「有按钮没图标」。这里把库那套声明补齐，图标换成风格一致的内联 SVG。 */
        html .viewer-toolbar > ul > li.viewer-crop:before {
            content: '';
            display: block;
            width: 20px;
            height: 20px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 2v14a2 2 0 0 0 2 2h14'/%3E%3Cpath d='M18 22V8a2 2 0 0 0-2-2H2'/%3E%3C/svg%3E");
            /* 图形比盒子小一圈（14px 配 3px 居中偏移）；盒子仍 20×20、按钮仍 24×24 ⇒ 热区不变。 */
            background-position: 3px 3px;
            background-repeat: no-repeat;
            background-size: 14px 14px;
        }

        /* 看图器工具栏的「全屏」按钮图标。库 1.10.4 的工具栏里**没有**"只全屏"的键
           （只有「播放」会顺带全屏），所以它也是自定义键，图标同样要自己补 content 与 20×20 盒子。
           全屏状态下 JS 会给这个 li 加 .is-fs，图标换成「退出全屏」。 */
        html .viewer-toolbar > ul > li.viewer-fullscreen:before {
            content: '';
            display: block;
            width: 20px;
            height: 20px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 3H5a2 2 0 0 0-2 2v3'/%3E%3Cpath d='M16 3h3a2 2 0 0 1 2 2v3'/%3E%3Cpath d='M21 16v3a2 2 0 0 1-2 2h-3'/%3E%3Cpath d='M3 16v3a2 2 0 0 0 2 2h3'/%3E%3C/svg%3E");
            background-position: 3px 3px;
            background-repeat: no-repeat;
            background-size: 14px 14px;
        }
        html .viewer-toolbar > ul > li.viewer-fullscreen.is-fs:before {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 3v3a2 2 0 0 1-2 2H3'/%3E%3Cpath d='M21 8h-3a2 2 0 0 1-2-2V3'/%3E%3Cpath d='M3 16h3a2 2 0 0 1 2 2v3'/%3E%3Cpath d='M16 21v-3a2 2 0 0 1 2-2h3'/%3E%3C/svg%3E");
        }
    </style>
@endpush

<x-app-layout>
    {{-- 整页滚动后工具栏要吸在固定顶栏下面（top-14 = 56px），否则一滚就没了 --}}
    <div class="sticky top-14 flex justify-between items-center px-2 py-2 z-[3] left-0 right-0 bg-surface border-solid border-b">
        <div class="space-x-2 flex justify-between items-center">
            <a class="whitespace-nowrap text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:getAlbums()"><i class="fas fa-bars text-brand"></i> 相册</a>
            {{-- 这排 7 项一行约需 1000px 布局宽（≈1360px 窗口），lg(1126px) 会把文字挤成两行，
                 故断点抬到 xl(1408px)；并给每个文字按钮加 whitespace-nowrap，保证永不折行。 --}}
            <div class="flex-row hidden xl:flex">
                <a data-operate="movements" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">移动到相册</a>
                <a data-operate="remove" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">移出当前相册</a>
                <a data-operate="tag" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">标签管理</a>
                <a data-operate="edit" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">编辑图片</a>
                <a data-operate="rename" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">重命名</a>
                <a data-operate="delete" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">删除</a>
                <a data-operate="detail" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">详细信息</a>
                <a data-operate="deselect" class="whitespace-nowrap hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">取消选择</a>
            </div>
            {{-- 与上排互斥：<xl 才收起成一格「⋯」菜单 --}}
            <div class="block xl:hidden">
                <x-dropdown direction="right">
                    <x-slot name="trigger">
                        <a class="text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)"><i class="fas fa-ellipsis-h text-brand"></i></a>
                    </x-slot>

                    <x-slot name="content">
                        <x-dropdown-link data-operate="refresh" href="javascript:void(0)" @click="open = false">刷新</x-dropdown-link>
                        <x-dropdown-link data-operate="movements" class="hidden" href="javascript:void(0)" @click="open = false">移动到相册</x-dropdown-link>
                        <x-dropdown-link data-operate="remove" class="hidden" href="javascript:void(0)" @click="open = false">移出当前相册</x-dropdown-link>
                        <x-dropdown-link data-operate="tag" class="hidden" href="javascript:void(0)" @click="open = false">标签管理</x-dropdown-link>
                        <x-dropdown-link data-operate="edit" class="hidden" href="javascript:void(0)" @click="open = false">编辑图片</x-dropdown-link>
                        <x-dropdown-link data-operate="rename" class="hidden" href="javascript:void(0)" @click="open = false">重命名</x-dropdown-link>
                        <x-dropdown-link data-operate="delete" class="hidden" href="javascript:void(0)" @click="open = false">删除</x-dropdown-link>
                        <x-dropdown-link data-operate="detail" class="hidden" href="javascript:void(0)" @click="open = false">详细信息</x-dropdown-link>
                        <x-dropdown-link data-operate="deselect" class="hidden" href="javascript:void(0)" @click="open = false">取消选择</x-dropdown-link>
                    </x-slot>
                </x-dropdown>
            </div>
        </div>
        <div class="flex space-x-2 items-center">
            <input type="text" id="search" class="px-2.5 py-1.5 border-0 outline-none rounded bg-surface-3 text-sm transition-all duration-300 hidden md:block md:w-36 md:hover:w-52 md:focus:w-52" placeholder="输入关键字搜索...">
            <x-dropdown direction="left">
                <x-slot name="trigger">
                    <a id="order" class="text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">
                        <span>最新</span>
                        <i class="fas fa-sort-alpha-up text-brand"></i>
                    </a>
                </x-slot>

                <x-slot name="content">
                    <x-dropdown-link href="javascript:void(0)" @click="setOrderBy('newest'); open = false">最新
                    </x-dropdown-link>
                    <x-dropdown-link href="javascript:void(0)" @click="setOrderBy('earliest'); open = false">最早
                    </x-dropdown-link>
                    <x-dropdown-link href="javascript:void(0)" @click="setOrderBy('utmost'); open = false">最大
                    </x-dropdown-link>
                    <x-dropdown-link href="javascript:void(0)" @click="setOrderBy('least'); open = false">最小
                    </x-dropdown-link>
                </x-slot>
            </x-dropdown>
            {{-- fork：标签筛选（多选，后端 AND 语义）。这里原来是「权限」下拉，
                 已按老师要求整体下线、换成标签 —— 只替换这一个下拉，不新增第三个，
                 免得 <768px 时工具栏换行、把 sticky top-14 的吸顶高度撑高。
                 标签按用户隔离，列表来自 GET user/tags，由 JS（loadTags → renderTagFilter）
                 渲染进 #tag-filter-list；勾选任意一项立刻 resetImages({page:1, tags:[...]})。
                 多选项沿用本页约定 min-h-[44px]，手机上点得中。--}}
            <x-dropdown direction="left">
                <x-slot name="trigger">
                    {{-- 图标与文字改成 flex 居中对齐：原来纯 inline 时图标盒 14px、文字盒 16px 靠基线
                         对齐，实测图标中心比文字中心高 0.3px、底部高 1.6px（看着往上飘）。
                         py 由 2 收到 1.5 是补偿 flex 带来的高度增量，保证按钮总高与原来一致
                         （否则会顶动 sticky 吸顶工具栏那一行）。--}}
                    <a id="tag-filter" class="inline-flex items-center gap-1.5 text-sm py-1.5 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">
                        <span>标签</span>
                        {{-- 实测：图标墨迹中心比文字高 0.5px（文字 90.0 / 图标 89.5，截图按像素量的），
                             用 relative+top 精确压下去 0.5px。--}}
                        <i class="fas fa-tags text-brand relative top-[0.5px]"></i>
                    </a>
                </x-slot>

                <x-slot name="content">
                    <div id="tag-filter-menu">
                        <div id="tag-filter-list" class="max-h-[50vh] overflow-y-auto"></div>
                        <a id="tag-filter-clear" class="ls-menu-item hidden text-brand" href="javascript:void(0)" @click="open = false">清除筛选</a>
                        {{-- 卡片角标开关：控制图库里图片上的标签显不显示，状态记在本地（默认显示） --}}
                        <a id="tag-badge-toggle" class="ls-menu-item flex items-center justify-between gap-3 border-t border-line text-ink-2" href="javascript:void(0)" @click="open = false">
                            {{-- 之前按 canvas 字体度量把文字压低了 1.5px，实测过头（像素法：文字比行中心低 1.49px，
                                 反倒显得开关偏上）→ 撤回，恢复成自然行高。现在文字/开关都在行中心 ±0.2px 内。--}}
                            <span>显示图片标签</span>
                            {{-- 自己画的开关：两态形状完全一样，只变颜色与滑块位置（不用 FontAwesome 的
                                 fa-toggle-on/off —— 那两个字形一粗一细，切起来画风不统一）。 --}}
                            <span id="tag-badge-switch" aria-hidden="true"
                                  class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-brand transition-colors duration-150">
                                <span class="tag-badge-knob absolute left-[2px] h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150"></span>
                            </span>
                        </a>
                    </div>
                </x-slot>
            </x-dropdown>
        </div>
    </div>
    {{-- 布局容器已从「绝对定位、确定高度」改成正常流（为让手机浏览器能收起地址栏），
         所以这里不能再靠祖先的高度：h-full 的百分比会解析成 auto，里面的
         #images-scroll（absolute inset-0）就跟着算成 0 高 —— 图片墙整片消失。
         改成 flex-1（容器是 flex flex-col + min-h-screen），自己吃掉除工具栏外的剩余高度。--}}
    {{-- 图片墙改成随内容长高、由整页滚动承载（手机地址栏才能收起）。
         -mb-14 抵消布局容器的 pb-14（56px）：不留底栏、图片直接铺到页面底。
         注意：这里不能再有 overflow-hidden —— 弹窗/遮罩已是 fixed，不需要它裁切。--}}
    <div class="relative -mb-14">
        <!-- content -->
        {{-- 原来是 absolute inset-0 + overflow-y-scroll 的自滚容器；改成普通块随内容长高，
             无限加载由 utils.infiniteScroll(..., {root:'window'}) 跟随整页滚动 --}}
        <div id="images-scroll" class="relative dragselect select-none">
            <div id="images-grid" class="dragselect"></div>
        </div>
    </div>

    {{-- fork：图片「详细信息」「移动到相册」「相册列表」全部走居中卡片弹窗（复用 components/modal.blade.php，
         手机上它就是「底部抽屉式」——弹窗容器在 <640px 时贴底、不依赖 hover）。
         旧的右侧抽屉 #drawer / #drawer-mask（markup、JS 状态、无限加载容器）已整块删除：
         顶部工具栏的「相册」入口现在打开 #album-switch-modal。 --}}
    <x-modal id="image-detail-modal">
        <div id="image-detail-content"></div>
    </x-modal>

    <x-modal id="image-movements-modal">
        <div id="image-movements-content"></div>
    </x-modal>

    {{-- fork：相册弹窗 —— 相册列表从右侧抽屉搬进来，用的是同一个 x-modal 机制 --}}
    <x-modal id="album-switch-modal">
        <div id="album-switch-content"></div>
    </x-modal>

    {{-- fork：「标签管理」弹窗 —— 全站唯一的标签窗口，一次管两件事：
         ① 给「选中的这几张图」打标：勾选 = 加上该标签，取消 = 从这些图移除；
         ② 标签本身的新建 / 重命名 / 删除。
         入口三处：桌面工具栏 / 手机 ⋯ 菜单的「标签管理」、图片右键菜单、顶部「标签」下拉底部。
         （原来「修改标签」和「管理标签」是两个窗口，已按老师要求合并成一个。）--}}
    <x-modal id="image-tags-modal">
        <div id="image-tags-content"></div>
    </x-modal>

    {{-- fork：图片裁剪层（Cropper.js v1.6.3）。三个入口共用它：
         ① 看图器工具栏的「裁剪」按钮 ② 选中操作条（单选时才出现）③ 右键 / 长按菜单的「编辑图片」。
         规则：只有 jpg/jpeg/png 给入口；导出格式跟随原图（png → PNG 无损、jpg/jpeg → JPEG q0.95）；
         结果作为一张**新图**上传，不改动原图。 --}}
    <div id="crop-layer" aria-hidden="true">
        <div class="crop-head">
            <span>裁剪图片</span>
            <span class="crop-hint" id="crop-hint"></span>
        </div>
        <div class="crop-stage">
            <img id="crop-image" alt="">
        </div>
        {{-- 工具组（旋转/翻转 + 比例）：桌面用 display:contents ⇒ 两组仍是底栏三列网格里的项；
             手机（<768px）折成两行显示、动作按钮挪到顶栏右侧。 --}}
        <div class="crop-bar">
          <div class="crop-tools">
            <div class="crop-group">
                <a href="javascript:void(0)" data-crop-action="rotate-left">左转 90°</a>
                <a href="javascript:void(0)" data-crop-action="rotate-right">右转 90°</a>
                <a href="javascript:void(0)" data-crop-action="flip-x">左右翻转</a>
                <a href="javascript:void(0)" data-crop-action="flip-y">上下翻转</a>
            </div>
            <div class="crop-group" id="crop-ratios">
                <a href="javascript:void(0)" data-crop-ratio="free" class="active">自由</a>
                <a href="javascript:void(0)" data-crop-ratio="1:1">1:1</a>
                <a href="javascript:void(0)" data-crop-ratio="4:3">4:3</a>
                <a href="javascript:void(0)" data-crop-ratio="16:9">16:9</a>
            </div>
          </div>
            <div class="crop-group crop-actions">
                <a href="javascript:void(0)" data-crop-action="cancel">取消</a>
                <a href="javascript:void(0)" data-crop-action="crop" class="crop-primary">保存并上传</a>
            </div>
        </div>
    </div>

    <script type="text/html" id="images-item-tpl">
        <a href="javascript:void(0)" data-id="__id__" data-json='__json__' class="images-item relative cursor-default rounded outline outline-2 outline-offset-2 outline-transparent">
            <div class="image-selector absolute z-[2] top-0 right-0 overflow-hidden cursor-pointer sm:hidden group-hover:block">
                <div class="p-1 text-xl sm:text-2xl">
                    <i class="fas fa-check-circle block rounded-full bg-white text-white border border-line-2"></i>
                </div>
            </div>
            {{-- 缩略图上的名称/时间遮罩：老师要求先隐藏（不要删代码，以后可能改回来）。
                 要恢复：把下面这个 hidden 去掉即可，其余一个字没动。
                 注意：遮罩隐藏后点击落在 img 上，看图器照旧正常打开（原来靠这里的 onclick 转发）。--}}
            <div class="image-mask hidden absolute left-0 right-0 bottom-0 h-20 z-[1] bg-gradient-to-t from-black" onclick="$(this).siblings('img').trigger('click')">
                <div class="absolute left-2 bottom-2 text-white z-[2] w-[90%]">
                    <p class="text-sm truncate filename" title="__name__">__name__</p>
                    <p class="text-[13.5px] date" title="__human_date__">__date__</p>
                </div>
            </div>
            {{-- fork：卡片角标 = 这张图的标签（少量、长名截断）。右上角被 .image-selector 占着，
                 所以贴左下；pointer-events-none 是必须的 —— .images-item 本身就是链接，
                 角标一旦接住点击，DragSelect 的选中与「点开预览」都会被抢掉。
                 （这里别写尖括号标签名：这段模板会被静态测试当纯文本取出来渲染。）--}}
            <div class="image-tags pointer-events-none absolute left-0 right-0 bottom-0 z-[1] flex flex-wrap items-end gap-1 p-2">__tags__</div>
            <img alt="__name__" data-original="__url__" src="__thumb_url__" width="__width__" height="__height__">
        </a>
    </script>

    {{-- fork：「相册」弹窗的外壳（内容在 getAlbums() 里渲染进 #album-switch-content）。
         标题 16px/600；搜索框按相册名**本地**即时过滤已加载的行（不打接口）；
         #album-switch-scroll 是无限加载容器（每页 40 条、滚到底自动加载下一页），
         里面放的是 #albums-container-tpl（创建表单 + 相册行 + 加载中/空状态）。
         列表是弹窗里**唯一的主体**：底部那个「完成」按钮已删掉（右上角 ✕ 关弹窗就够），
         所以 max-h-[50vh] + overflow-y-auto 这条限高/滚动规则仍然只归列表自己，别再往底部加东西。
         桌面约 520px 宽见文件顶部 @push('styles') 里那条规则。 --}}
    <script type="text/html" id="album-switch-tpl">
        <div class="mx-auto flex w-full flex-col">
            <p class="text-[16px] font-semibold leading-6 text-ink">__title__</p>
            {{-- 副标题（样式与「标签管理」窗口那行 __hint__ 同一套）：说明这一行两态的语义 --}}
            <p class="mt-1 text-[13px] leading-5 text-ink-3">点击进入相册，再次点击退出相册</p>
            <input type="text" id="album-switch-search" class="ls-input mt-3" placeholder="搜索相册">
            <div id="album-switch-scroll" class="mt-3 flex max-h-[50vh] w-full flex-col overflow-y-auto pr-1"></div>
        </div>
    </script>

    <script type="text/html" id="albums-container-tpl">
        <div id="albums-container" class="flex flex-col justify-center items-center w-full p-3 space-y-2">
            {{-- fork：加载中（转圈）——第一页回来之前显示，无限加载的 complete 里收起来 --}}
            <div id="album-switch-loading" class="flex w-full items-center justify-center py-4">
                <x-loading-spin />
                <div class="text-[13px] text-ink-3">加载中...</div>
            </div>
            {{-- fork：空状态——一个相册都没有时「还没有相册」+ 创建按钮；
                 有相册但被搜索过滤光了换成「没有匹配的相册」 --}}
            <div id="album-switch-empty" class="hidden flex w-full flex-col items-center justify-center gap-3 py-4">
                <p id="album-switch-empty-text" class="text-[14px] text-ink-3">还没有相册</p>
                <button type="button" class="ls-btn h-11 px-4 sm:h-9" onclick="$('#album-add').toggleClass('hidden')">创建相册</button>
            </div>
            {{-- fork：创建相册入口（原抽屉标题上的 + 号，机制一字未改：切换 #album-add 的显示） --}}
            <button type="button" id="album-switch-create" class="flex min-h-[44px] w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-[14px] text-brand hover:bg-surface-3" onclick="$('#album-add').toggleClass('hidden')">
                <i class="fas fa-plus w-4 shrink-0 text-center" aria-hidden="true"></i>
                <div class="min-w-0 flex-1 truncate">创建相册</div>
            </button>
            <div id="album-add" class="flex flex-col w-full hidden border rounded p-2">
                <p class="error-message text-white p-2 mb-2 text-sm bg-red-500 rounded hidden"></p>
                <form class="w-full space-y-2" action="/user/albums">
                    <input type="text" class="w-full rounded px-2.5 py-1.5 text-sm border-0 bg-surface-3" name="name" placeholder="请输入名称">
                    <textarea class="w-full resize-y rounded-md text-sm border-0 bg-surface-3" name="intro" placeholder="请输入简介"></textarea>
                    <button class="w-full py-1 px-2 bg-brand text-white text-sm text-center tracking-wider font-semibold rounded-md">创建相册</button>
                </form>
            </div>
        </div>
    </script>

    {{-- fork：相册行（列表从抽屉搬进弹窗、再重做成「行内分区」）：
         外层 .albums-row（承载 border/bg + 当前相册高亮 + data-id/data-json）里分两块 ——
         左边 <a class="albums-item"> 是切换区（min-h-[44px]，名称 + 「当前」徽标 + 张数），
         右边 .albums-actions 是**常显的两个 44×44 按钮**（编辑/删除）。
         为什么按钮要移出 <a>：它们原来长在行链接里，图标可点区只有十几像素，点不中就落到
         <a> 上直接跳进相册 —— 移出来 + 给足 44px 才点得中（顺带不用 group-hover 切换，
         张数也不再被按钮顶掉，行内容不再抽动）。
         名称是 <a> 里的 <div class="name">（**原来这里是 <span>**：utils.infiniteScroll 对列表
         容器挂的是「点里面的 span 就加载更多」的委托，相册名是 span 时点一下名字就顺手多拉
         一页相册 —— 现在行内除哨兵外一个 span 都没有；编辑面板按 class 找的 .name 照旧）。
         张数保持 <div class="albums-count">。
         基础态必须留着 border-line bg-surface，toggleClass 才有东西可换。

         ⚠ 列表末尾那条「我也是有底线的~」哨兵是 utils.infiniteScroll 自己插进去的
         `.infinite-scroll > span`，那才是**有意的**触发器，必须保持 span、不要动。 --}}
    <script type="text/html" id="albums-item-tpl">
        {{-- overflow-hidden 是必需的：右边两个 44×44 常显按钮的 hover 底色是**方形**的，
             行的圆角是 rounded-lg —— 不裁的话方块会盖住圆角，选中（当前相册）时那条品牌色
             边框的两个右角看着就像缺角（老师反馈）。标签行（#image-tags-item-tpl）一直是这么写的。 --}}
        <div class="albums-row flex items-stretch min-h-[44px] w-full overflow-hidden rounded-lg border border-line bg-surface" data-id="__id__" data-json='__json__'>
            <a href="javascript:void(0)" data-id="__id__" data-json='__json__' title="__intro__" class="albums-item group flex min-w-0 flex-1 items-center gap-2.5 rounded-l-lg px-3 py-1">
                <div class="min-w-0 flex-1 truncate text-[14px] name">__name__</div>
                __current_badge__
                <div class="albums-count shrink-0 text-[13px] text-ink-3">__image_num__ 张</div>
            </a>
            <div class="albums-actions flex shrink-0 items-center border-l border-line">
                <button type="button" class="update flex h-11 w-11 items-center justify-center text-ink-2 hover:bg-surface-3 hover:text-brand" aria-label="重命名相册"><i class="fas fa-edit text-[15px]"></i></button>
                <button type="button" class="delete flex h-11 w-11 items-center justify-center text-danger hover:bg-surface-3" aria-label="删除相册"><i class="fas fa-trash-alt text-[15px]"></i></button>
            </div>
        </div>
    </script>

    <script type="text/html" id="album-update-tpl">
        <div id="album-edit" data-id="__id__" class="flex flex-col w-full border rounded p-2">
            <p class="error-message text-white p-2 mb-2 text-sm bg-red-500 rounded hidden"></p>
            <form class="w-full space-y-2" action="/user/albums/__id__">
                <input type="text" class="w-full rounded px-2.5 py-1.5 text-sm border-0 bg-surface-3" placeholder="请输入名称" name="name" value="__name__">
                <textarea class="w-full resize-y rounded-md text-sm border-0 bg-surface-3" name="intro" placeholder="请输入简介">__intro__</textarea>
                <button class="w-full py-1 px-2 bg-brand text-white text-sm text-center tracking-wider font-semibold rounded-md">确认修改</button>
            </form>
        </div>
    </script>

    {{-- 图片「详细信息」：居中卡片弹窗（不再渲染进右侧抽屉）。
         字段顺序按老师要求：**上传时间第一、图片名称紧跟其后**，其余字段一个没删、只换了位置
         （相册名称 / 使用策略 / 图片原始名称 / 图片大小 / 图片类型 / 尺寸 / MD5 / SHA-128 / 权限 / 上传 IP）。
         排版（老师二次验收提「排版、字号、字体颜色都优化一下」后统一成这一套）：
         顶部＝小缩略图 + 16px semibold 标题；下面一整块圆角卡片（rounded-lg + border-line + bg-surface-2），
         字段之间用 divide-line 细线分隔、每行等距 py-3（所以分区间距一致）；
         标签 13px text-ink-3 在左（sm:w-28 定宽对齐）、值 14px text-ink 在右（窄屏 flex-col 自动上下堆叠），行高 leading-6。
         颜色全部走设计令牌（surface / ink / line），亮暗两套自动正确。
         这里不放任何快捷操作（复制链接/下载/删除都不进这个弹窗）。 --}}
    <script type="text/html" id="image-detail-tpl">
        <div class="mx-auto w-full max-w-2xl">
            <div class="mb-4 flex items-center gap-3">
                <img src="__thumb_url__" alt="__filename__" class="h-16 w-16 shrink-0 rounded-lg border border-line bg-surface-2 object-cover">
                <p class="min-w-0 truncate text-[16px] font-semibold leading-6 text-ink">图片详细信息</p>
            </div>
            <dl class="divide-y divide-line rounded-lg border border-line bg-surface-2 px-4">
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">上传时间</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__created_at__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">图片名称</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__filename__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">相册名称</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__album_name__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">使用策略</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__strategy_name__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">图片原始名称</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__origin_name__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">图片大小</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__size__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">图片类型</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__mimetype__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">尺寸</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__width__ * __height__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">MD5</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__md5__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">SHA-128</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__sha1__</dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">标签</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">
                        {{-- fork：这一行原来显示「权限」，已下线换成标签 ——
                             可以现场增删，也可以直接输入新名字回车新建（JS 渲染 + 绑定）。 --}}
                        <div id="detail-tags" class="flex flex-wrap items-center gap-1.5"></div>
                        <div class="mt-2 flex items-center gap-2">
                            <input type="text" id="detail-tag-input" list="detail-tag-options" class="ls-input h-11 min-w-0 flex-1 text-[14px] sm:h-9" placeholder="请输入标签名称，回车即可添加" maxlength="64">
                            <button type="button" id="detail-tag-add" class="ls-btn h-11 shrink-0 px-4 sm:h-9">添加</button>
                        </div>
                        <datalist id="detail-tag-options"></datalist>
                    </dd>
                </div>
                <div class="flex flex-col gap-0.5 py-3 sm:flex-row sm:gap-4">
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">上传 IP</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__uploaded_ip__</dd>
                </div>
            </dl>
        </div>
    </script>

    {{-- 「移动到相册」弹窗：相册列表（单选）+ 底部「移动」「取消」。
         列表数据与顶部工具栏的「相册列表」同一个接口；点一行只选中，底部「移动」才提交。
         每行 min-h-[44px]（手机点击区 ≥44px），当前所在相册带「当前」标记（__current_badge__）。
         排版（老师二次验收「排版/字号/字体颜色」统一）：标题 16px semibold、副标题 13px text-ink-3、
         列表行 14px / 数量 13px text-ink-3，间距统一用 mt-4 + gap-1.5；颜色只走设计令牌。
         底部**不要横线**：老师看到的那条就是 footer 的 border-t，已去掉，只留上间距。
         按钮沿用全局 ls-btn / ls-btn-primary（与弹窗、页面其它按钮同一套）。
         ⚠ 列表底部那条「我也是有底线的~」是 utils.infiniteScroll 自动插进 #movements-albums 的哨兵，
         在这个弹窗里用 CSS 隐藏（见 common.less：#image-movements-modal .infinite-scroll { display: none }），
         别的列表（图片墙那个哨兵）照旧显示、不受影响；列表容器仍 overflow-y-auto，
         「滚到底继续加载下一页相册」的能力没丢（每页 40 条，列表实际总是可滚动的）。 --}}
    <script type="text/html" id="movements-container-tpl">
        <div class="mx-auto flex w-full max-w-xl flex-col">
            <p class="text-[16px] font-semibold leading-6 text-ink">移动到相册</p>
            <p class="mt-1 text-[13px] leading-5 text-ink-3">已选择 __count__ 张图片</p>
            <div id="movements-albums" class="mt-4 flex max-h-[50vh] w-full flex-col gap-1.5 overflow-y-auto pr-1"></div>
            <div class="mt-4 flex justify-end gap-2">
                <button type="button" id="movements-cancel" class="ls-btn h-11 px-4 sm:h-9">取消</button>
                <button type="button" id="movements-confirm" class="ls-btn ls-btn-primary h-11 px-4 sm:h-9" disabled>移动</button>
            </div>
        </div>
    </script>

    {{-- 相册列表行：整行是一个点击区（min-h-[44px]），**行内一个 span 都不用** —— 名称是 <div>、
         「当前」徽标（JS 拼的 .ls-badge）也是 <div>，免得被无限加载「点 span 加载更多」的委托命中
         （点一下相册名就多拉一页相册）。列表末尾那条哨兵是 utils.infiniteScroll 插的
         `.infinite-scroll > span`，那个必须保持 span。选中态由 JS 切换 border-brand/bg-brand-soft/text-brand
         （所以基础态必须留着 border-line bg-surface-2 text-ink，toggleClass 才有东西可换）。 --}}
    <script type="text/html" id="movements-album-item-tpl">
        <a href="javascript:void(0)" data-id="__id__" data-selected="false" class="movements-album flex min-h-[44px] w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink transition-colors duration-150 hover:bg-surface-3">
            <i class="selected-mark fas fa-check-circle w-4 shrink-0 text-brand opacity-0" aria-hidden="true"></i>
            <div class="min-w-0 flex-1 truncate text-[14px]">__name__</div>
            __current_badge__
            <div class="shrink-0 text-[13px] text-ink-3">__image_num__ 张</div>
        </a>
    </script>

    {{-- 「标签管理」窗口的外壳：一行一个标签（勾选框 + 名称 + 张数 + 重命名/删除两个常显按钮），
         底部新建输入框与「取消 / 确定」。#image-tags-list 在手机上可滚（max-h-[50vh]），
         输入框与按钮在 <640px 用 h-11（点击区 ≥44px），≥640px 收成 h-9 与页面其它按钮同一档。
         副标题由 JS 按「有没有选中图片」填 __hint__。--}}
    <script type="text/html" id="image-tags-tpl">
        <div class="mx-auto flex w-full max-w-xl flex-col">
            <p class="text-[16px] font-semibold leading-6 text-ink">标签管理</p>
            <p class="mt-1 text-[13px] leading-5 text-ink-3">__hint__</p>
            {{-- 新建标签放在首行（老师要求）：进窗口第一眼就能建新标签 --}}
            <div class="mt-3 flex items-center gap-2">
                <input type="text" id="image-tags-new" maxlength="64" class="ls-input h-11 min-w-0 flex-1 text-[14px] sm:h-9" placeholder="请输入新标签名称">
                <button type="button" id="image-tags-create" class="ls-btn h-11 shrink-0 px-4 sm:h-9">新建标签</button>
            </div>
            <div id="image-tags-list" class="mt-3 flex max-h-[50vh] w-full flex-col gap-1.5 overflow-y-auto pr-1"></div>
            <div class="mt-4 flex justify-end gap-2">
                <button type="button" id="image-tags-cancel" class="ls-btn h-11 px-4 sm:h-9">取消</button>
                <button type="button" id="image-tags-confirm" class="ls-btn ls-btn-primary h-11 px-4 sm:h-9" disabled>确定</button>
            </div>
        </div>
    </script>

    {{-- 标签重命名的行内表单（在那一行下方就地展开，再点一次收起）。
         名称不写进模板 —— 由 JS 用 .val() 填，避免标签名里的引号/尖括号破坏属性。 --}}
    <script type="text/html" id="image-tags-edit-tpl">
        <div id="tag-edit" class="flex w-full flex-col rounded-lg border border-line p-2">
            <p class="error-message text-white p-2 mb-2 text-sm bg-red-500 rounded hidden"></p>
            <form class="flex w-full items-center gap-2" action="{{ route('user.tag.update', ['id' => '__id__']) }}" method="POST">
                <input type="text" name="name" maxlength="64" class="ls-input h-11 min-w-0 flex-1 text-[14px] sm:h-9" placeholder="请输入标签名称">
                <button type="submit" class="ls-btn h-11 shrink-0 px-4 sm:h-9">确认修改</button>
            </form>
        </div>
    </script>

    {{-- 「标签管理」窗口里的一行：左边是勾选区（整块 ≥44px 点击区），右边两个常显的 44×44
         「重命名 / 删除」按钮（改标签本身，不影响图片）。
         勾选语义（按老师定的两态）：勾上 = 给选中的这些图片加上该标签；取消勾选 = 从这些图片移除。
         如果该标签只在「部分选中的图片」上有，就显示成半勾表示现状，点一下变全勾（加上）。 --}}
    <script type="text/html" id="image-tags-item-tpl">
        <div class="image-tag-row flex min-h-[44px] w-full items-stretch overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-150" data-id="__id__" data-json='__json__'>
            <a href="javascript:void(0)" class="image-tag-toggle flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 px-3 py-2 hover:bg-surface-2">
                <i class="tag-state-icon fas fa-square w-4 shrink-0 text-ink-3" aria-hidden="true"></i>
                <div class="min-w-0 flex-1 truncate text-[14px] name">__name__</div>
                <div class="shrink-0 text-[13px] text-ink-3"><span class="images-count">__images_count__</span> 张</div>
            </a>
            <div class="tag-row-actions flex shrink-0 items-center border-l border-line">
                <button type="button" class="update flex h-11 w-11 items-center justify-center text-ink-2 hover:bg-surface-3 hover:text-brand" aria-label="重命名标签"><i class="fas fa-edit text-[15px]"></i></button>
                <button type="button" class="delete flex h-11 w-11 items-center justify-center text-danger hover:bg-surface-3" aria-label="删除标签"><i class="fas fa-trash-alt text-[15px]"></i></button>
            </div>
        </div>
    </script>

    @push('styles')
        <style>
            /* 按在图片上拖动时，浏览器会启动 <img> 的原生拖拽、把 mousemove 变成 drag 事件 ——
               框选的选择框不跟随、松手也不会结束互动（实测「锁定不释放」）。Chromium/Safari 用
               -webkit-user-drag 关掉原生拖拽（Firefox 不看这条，由脚本里的 dragstart 兜底）。 */
            /* 注意卡片本身也要：<a href> 默认就是可拖拽元素，只禁 img 没用（实测 dragstart 照样发） */
            /* iOS 的「点一下灰闪」（-webkit-tap-highlight-color）：fork 2026-10-08 ——
               触摸端不再让 DragSelect preventDefault 之后，iOS 恢复了这个默认高亮，
               点图片会闪一下灰。这里只在**图片墙范围内**关掉它（页面其它地方没被本次改动影响，
               不动它们）。它是继承属性，写在卡片上即可覆盖卡片里的 img 与右上角小圆勾。 */
            #images-scroll .images-item {
                -webkit-tap-highlight-color: transparent;
            }

            #images-grid .images-item,
            #images-grid .images-item img {
                -webkit-user-drag: none;
            }
        </style>
    @endpush

    @push('scripts')
        <script src="{{ asset('js/justified-gallery/jquery.justifiedGallery.min.js') }}"></script>
        <script src="{{ asset('js/viewer-js/viewer.min.js') }}"></script>
        <script src="{{ asset('js/cropper-js/cropper.min.js') }}?v={{ \App\Utils::assetVersion('js/cropper-js/cropper.min.js') }}"></script>
        <script src="{{ asset('js/dragselect/ds.min.js') }}"></script>
        {{-- fork 补丁：加版本串，避免 iOS/Safari 的启发式缓存把旧版 context-js.js 一直喂给老用户 --}}
        <script src="{{ asset('js/context-js/context-js.js') }}?v={{ \App\Utils::assetVersion('js/context-js/context-js.js') }}"></script>
        <script src="{{ asset('js/clipboard/index.browser.js') }}"></script>
        <script src="{{ asset('js/clipboard/clipboard.min.js') }}"></script>
        <script>
            let gridConfigs = {
                rowHeight: 180,
                margins: 16,
                captions: false,
                border: 10,
                waitThumbnailsLoad: false,
            };

            let selectedAlbum = {}; // 选择的相册

            const HEADER_TITLE = '#header-title';
            const IMAGES_SCROLL = '#images-scroll';
            // ★ 关掉浏览器「刷新时恢复滚动位置」：刷新图库时我们要的是回到顶部从头看，
            //   而恢复机制会把页面拽回原位置，配合无限加载就是又一轮连锁。
            try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
            const IMAGES_GRID = '#images-grid';
            const IMAGES_ITEM = '.images-item';

            /* iPhone 的 Safari 没有元素全屏 API（Fullscreen API 在 iOS 上只给了 iPad），
               看图器工具栏的「全屏」键在那里点了必然**静默无反应**：库内部那句
                 documentElement.requestFullscreen ? … : webkitRequestFullscreen ? … : moz ? … : ms …
               会整条落空，既不报错也不生效。所以按能力探测决定**渲不渲染这个键**
               （老师 2026-10-08 拍板：不支持就不显示，免得留一个点了没反应的按钮）。
               判据优先看 document.fullscreenEnabled（iPhone Safari 上是 false）；
               没有该属性的老浏览器再退回按元素上那几个 API 是否存在来判断。 */
            const canViewerFullscreen = () => {
                if (typeof document.fullscreenEnabled === 'boolean') {
                    return document.fullscreenEnabled;
                }
                const de = document.documentElement;
                return !!(de.requestFullscreen || de.webkitRequestFullscreen
                    || de.mozRequestFullScreen || de.msRequestFullscreen);
            };
            // 相册行容器（承载 data-id / data-json + 当前相册高亮）。
            // 行不再是「整行一个 <a>」，而是 .albums-row 里「左边切换链接 + 右边常显按钮」，
            // 所以按钮往上找 id 要 closest 到这一层，不能再用 .albums-item（那是 <a> 自己）。
            const ALBUM_ROW = '.albums-row';

            const $headerTitle = $(HEADER_TITLE);
            const $photos = $(IMAGES_GRID);
            // 居中卡片弹窗（复用 components/modal.blade.php 的 Alpine store，用法同 admin 页）
            const modal = Alpine.store('modal');
            // 「移动到相册」弹窗里的相册列表容器 / 底部按钮
            const MOVEMENTS_MODAL = 'image-movements-modal';
            const DETAIL_MODAL = 'image-detail-modal';
            const ALBUM_MODAL = 'album-switch-modal';
            // 标签窗口（全站唯一）：桌面工具栏 / 手机 ⋯ 菜单 / 图片右键菜单 / 标签下拉共用
            const TAGS_MODAL = 'image-tags-modal';
            // 「显示图片标签」开关的本地记忆键（与页面其它偏好一致，存 localStorage）
            const TAG_BADGE_KEY = 'lsky.show_image_tags';
            // 删除标签的地址（模板里给个占位符，运行时替换真实 id）
            const TAG_DELETE_URL = "{{ route('user.tag.delete', ['id' => '__ID__']) }}";

            /* ---------------- 标签（fork 新增） ----------------
             * 标签按用户隔离：列表来自 GET user/tags，打标/移除走 PUT user/images/tags。
             * allTags 是本页唯一的标签缓存（顶部筛选、详情卡候选、打标弹窗都用它）。
             * -------------------------------------------------- */
            let allTags = [];
            let selectedTagIds = [];   // 顶部筛选选中的标签 id（多选，后端是 AND 语义）

            // 标签名来自用户输入，塞进 innerHTML 之前一律先转义
            const escapeHtml = (value) => String(value === null || value === undefined ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');

            // 统一的接口错误文案：优先用后端返回的 message（含 422 校验失败），其次 Error.message
            const apiErrMsg = (error, fallback) => (error && error.response && error.response.data
                && error.response.data.message) || (error && error.message) || fallback;

            // 图片墙卡片角标：只显示前几个，长名字截断（角标容器是 pointer-events-none，不抢点击）
            const cardTagsHtml = (tags) => {
                if (! tags || ! tags.length) {
                    return '';
                }
                return tags.slice(0, 3).map(tag =>
                    '<span class="max-w-[7rem] truncate rounded-full bg-black/60 px-2 py-0.5 text-[11px] leading-4 text-white">'
                    + escapeHtml(tag.name) + '</span>'
                ).join('');
            };
            const viewer = new Viewer(document.getElementById('images-grid'), {
                url: 'data-original',
                // fork：自定义工具栏。注意 —— 传对象进入「自定义」模式后，内置按钮**只渲染你列出的键**，
                // 所以这里把库里那 11 个内置按钮按原顺序照抄一遍（`true` 与原默认行为等价），
                // 末尾追加「裁剪」（点击回调见 cropEditor；只有当前图是 jpg/jpeg/png 时才显示）。
                toolbar: {
                    // 放最左（库按这里的键顺序渲染）。
                    crop: { show: true, click: () => cropEditor.openFromViewer() },
                    // 「全屏」：库里没有这个键，点击自己调库的 requestFullscreen()/exitFullscreen()。
                    // 按能力探测决定要不要渲染这个键：不支持元素全屏的浏览器（iPhone Safari）
                    // 干脆不显示，免得更成一个点了没反应的死按钮。
                    ...(canViewerFullscreen()
                        ? { fullscreen: { show: true, click: () => toggleViewerFullscreen() } }
                        : {}),
                    'one-to-one': true,
                    reset: true,
                    prev: true,
                    play: true,
                    next: true,
                    'rotate-left': true,
                    'rotate-right': true,
                    'flip-horizontal': true,
                    'flip-vertical': true,
                },
                    slideOnTouch: false,   // 关掉库自带的触摸切图：单指动作永远是 move ⇒ 库自己的平移就是跟手拖动

                // 到头不再绕回（老师明确不要循环：第一张向右滑会绕到最后一张，且那一下会让
                // 控件重建画布/缩略图条 ⇒ iOS 整个界面左偏、安卓缩略图全空，见后续修复记录）
                loop: false,
                // focus: false —— Claude 定位 + 真机对照验证：
                // view() 在摆放缩略图条之前会先对目标缩略图的 <li> 调 .focus()（源码 s.focus&&h.focus()），
                // 而 .viewer-navbar 虽然 overflow:hidden 但仍是滚动容器 ⇒ 浏览器为了"让焦点可见"把导航条
                // 滚走（scrollLeft 推到最大）；随后 renderList() 再叠一层 translateX ⇒ 位置被偏移两次，
                // 整条列表跑到屏幕外，只剩空黑底。表现就是"从靠前的图跳到很靠后的图（或关掉再打开靠后的图）后，
                // 缩略图条里后面那批不显示，前面的还在"——因为前面那批本来就在初始可视区，不触发滚动。
                // 加 focus:false 后：navScrollLeft 由 2439 → 0，可见缩略图 0 → 43（真 Chromium 实测）。
                // 代价：关掉"打开后聚焦容器 + 焦点陷阱"，对鼠标/触屏无影响，仅纯键盘 Tab 导航有差别
                //（键盘切图与 Esc 关闭实测不受影响）。
                focus: false,
            });

            /* 修 Viewer.js 的另一个坑：update() 重建缩略图条却不重算它的位置。
             * Claude 定位 + jsdom 复现（我核对了源码与线上压缩产物）：
             *   update() 会把 .viewer-list 的 width 设成 auto 并重建所有 <li>，
             *   但当前图没变时不会调 renderList() ⇒ 位置（width + translateX((容器宽-30)/2 - 31*index)）
             *   还是旧值。图越靠后这个负偏移越大，超过一屏宽后整个列表被推出导航条可视区，
             *   只剩一条空的黑底 —— 就是老师看到的"缩略图条不显示"；手指一滑（goTo → view → renderList）
             *   位置被重算，缩略图立刻回来。
             * 谁会在看图时调 update()：images.blade.php 里无限滚动每次请求结束的 complete 回调
             * （看图时后台正好加载完一批就会触发），以及侧栏折叠。所以是"偶尔"。
             * 修法：包一层 update()，让它跑完补一次 renderList()，并把丢失的 active 状态找回来。
             * 注意不要依赖 viewer.items / isShown —— 线上压缩产物里查不到这两个名字（可能被改名），
             * 改成查 DOM，稳。
             * 注意这是 fork 侧的自证：Dockerfile 里钉的 images.blade.php md5 不变的话构建会失败。 */
            (function () {
                if (typeof viewer.update !== 'function' || typeof viewer.renderList !== 'function') {
                    return;                                 // 产物变了就安静退出，不折腾
                }
                const rawUpdate = viewer.update.bind(viewer);
                viewer.update = function () {
                    const ret = rawUpdate.apply(null, arguments);
                    try {
                        const list = document.querySelector('.viewer-navbar .viewer-list');
                        if (!list || !viewer.ready) return ret;
                        // 重建出来的 <li> 会丢掉 active 状态，按当前 index 补回去
                        if (!list.querySelector('li.viewer-active') && list.children[viewer.index]) {
                            list.children[viewer.index].classList.add('viewer-active');
                        }
                        viewer.renderList();                // 重算 width 与 translateX
                    } catch (e) { /* 兜底：绝不因为补一刀而让看图界面挂掉 */ }
                    return ret;
                };
            })();

            /* 图片裁剪（Cropper.js v1.6.3）—— 三个入口共用这一个模块：
             *   · 看图器工具栏的「裁剪」按钮（cropEditor.openFromViewer）
             *   · 选中操作条的 [data-operate="edit"]（只有单选 jpg/jpeg/png 时出现）
             *   · 右键 / 长按菜单的「编辑图片」
             * 规则（老师拍板）：
             *   · 只有 jpg/jpeg/png 给入口，其它格式一律不出现；
             *   · 导出格式跟随原图：png → PNG 无损；jpg/jpeg → JPEG q0.95；
             *   · 不设长边上限（按原图尺寸导出，绝不放大），框选 >30MP 时在标题栏提示体积；
             *   · 结果作为**一张新图**上传（复用 /upload，字段与页面表单一致），不改原图。
             * 坐标注意：桌面 html{zoom:1.1} 下由本页 <style> 给 #crop-layer 套了反向缩放，
             * 让 Cropper 内部的布局单位与屏幕像素一致（与 .viewer-container 同一招）。 */
            /* 「全屏」按钮（工具栏自定义键）：库 1.10.4 的工具栏里没有"只全屏"的键
             * （只有「播放」会顺带全屏），所以点击时自己调库的 requestFullscreen()/exitFullscreen()；
             * 全屏状态一变就给 li 加/去 .is-fs（CSS 换成「退出全屏」图标）。
             * ★ 必须定义在**这一层**（与 viewer 同级）：工具栏的 click 回调在外层作用域里跑，
             *   塞进 cropEditor 的 IIFE 里会变成 is not defined（当年 viewer.on 那次同款事故）。
             * 注意：库的 requestFullscreen() 作用在 documentElement 上，退出要走 document 的 API。 */
            const toggleViewerFullscreen = () => {
                const d = document;
                if (d.fullscreenElement || d.webkitFullscreenElement) {
                    const exit = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen || d.mozCancelFullScreen;
                    if (exit) { exit.call(d); }
                } else if (viewer && typeof viewer.requestFullscreen === 'function') {
                    viewer.requestFullscreen();
                }
            };
            /* 全屏状态一变：① 换工具栏按钮的图标 ② 给 <html> 挂/去 .ls-viewer-fs
             * （那一层负责"只留图 + 纯黑 + UI 全隐"，见本页 <style>）。 */
            const syncFullscreenIcon = () => {
                const d = document;
                const on = !!(d.fullscreenElement || d.webkitFullscreenElement);
                document.querySelectorAll('.viewer-toolbar li.viewer-fullscreen').forEach((li) => {
                    li.classList.toggle('is-fs', on);
                });
                /* ★ 只在"全屏状态真的从关变开"那一下把 UI 清干净。
                 * 这个函数会被库的每次切图/重绘带着跑一遍（viewer.view → syncViewerButton → 它），
                 * 早先写成 `if (on) remove(...)` ⇒ 点 toolbar 的 next/prev、或在缩略图条上滚轮切图时，
                 * 库一重绘就把刚淡出来的 ls-fs-ui 摘掉，看着就是"一操作 UI 立刻消失"。
                 * 探针实测的调用栈钉死了这条路径。 */
                const wasFs = document.documentElement.classList.contains('ls-viewer-fs');
                document.documentElement.classList.toggle('ls-viewer-fs', on);
                if (on && ! wasFs) {
                    document.documentElement.classList.remove('ls-fs-ui');   // 刚进全屏先干干净净
                }
            };
            document.addEventListener('fullscreenchange', syncFullscreenIcon);
            document.addEventListener('webkitfullscreenchange', syncFullscreenIcon);

            /* 全屏里鼠标动一下 / 轻触一下 ⇒ 临时把 UI 淡出来（只看，不改任何状态） */
            const FS_UI_MS = 2500;
            let fsUiTimer = 0;
            /* 全屏里"人还在 UI 上"就不收起 —— 老师第七轮要的：
             * "我正操作着呢 UI 自己没了，这多烦人"。原来的实现只做了"每次操作重新计时"，
             * 但鼠标停在 toolbar/缩略图条上不动时没有任何事件，计时照样走完 ⇒ UI 在手指底下消失
             * （而且此刻它们是 pointer-events:none，点下去还会穿透、甚至误关看图器）。
             * 这里改成：只要指针落在这些 UI 的矩形内（隐藏时它们仍是 visibility:hidden、布局还在，
             * 所以量得到矩形；不能用 :hover —— pointer-events:none 时命中测试拿不到它们），
             * 就只"续期"不排收起；手指按住期间同理。移开/松手后从那一刻重新计时。 */
            const FS_UI_ZONES = ['.viewer-toolbar', '.viewer-navbar', '.viewer-title', '.viewer-button'];
            const pointerOverViewerUI = (x, y) => FS_UI_ZONES.some((sel) => {
                const el = document.querySelector(sel);
                if (! el) { return false; }
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
            });
            const scheduleFsHide = () => {
                clearTimeout(fsUiTimer);
                fsUiTimer = setTimeout(() => document.documentElement.classList.remove('ls-fs-ui'), FS_UI_MS);
            };
            const flashFullscreenUI = (e) => {
                if (! document.documentElement.classList.contains('ls-viewer-fs')) { return; }
                document.documentElement.classList.add('ls-fs-ui');
                const type = (e && e.type) || '';
                if (type.indexOf('touch') === 0) {
                    clearTimeout(fsUiTimer);            // 手指还按着 ⇒ 别收
                    return;
                }
                if (type !== 'keydown' && pointerOverViewerUI((e && e.clientX) || 0, (e && e.clientY) || 0)) {
                    clearTimeout(fsUiTimer);            // 鼠标停在 UI 上 ⇒ 只续期
                    return;
                }
                scheduleFsHide();
            };
            document.addEventListener('touchend', () => {
                if (document.documentElement.classList.contains('ls-fs-ui')) {
                    scheduleFsHide();                   // 手指抬起才开始计时
                }
            }, {capture: true, passive: true});
            /* 这些操作都算"人还在"，一律刷新那 2.5s：
               移动鼠标 / 滚轮切图 / 点 toolbar 或缩略图条 / 触摸拖动 / 按键。
               （全部 passive：我们只看不拦，不影响任何默认行为。） */
            ['mousemove', 'wheel', 'pointerdown', 'touchstart', 'touchmove', 'keydown'].forEach((ev) => {
                document.addEventListener(ev, flashFullscreenUI, {capture: true, passive: true});
            });

            /* 老师第八轮：① 非全屏"拖动后松手"不该被当成点击；② 全屏点空白不许关、改成显示 UI。
             * 库里这条链路（压缩产物实读）：
             *   pointerup 里，若手势 < 500ms、松手目标是 canvas、backdrop 未被关掉，
             *   就向 .viewer-canvas 派发一个 'click'（常量 S = "click"）；
             *   库自己的 onClick 是 wt(viewer, 'click', ...) —— 注册在 **.viewer-container 的冒泡阶段**
             *   （没有 capture）⇒ 我们在 document 捕获阶段一定比它先跑，可以把这一下拦下来。
             * 注意：那个 click 是 CustomEvent，坐标在 e.detail.originalEvent 里，不在 e.clientX 上。 */
            (function () {
                const MOVE_SLOP = 6;        // 按下到松手超过它就当"拖动"（触屏手势同样按这个判）
                const DRAG_WINDOW = 400;    // 拖动结束后这么久内到达的 canvas 点击，算"这一下的尾巴"
                let downX = 0;
                let downY = 0;
                let dragged = false;
                let dragEndAt = 0;
                const isCanvas = (el) => el instanceof Element && el.classList.contains('viewer-canvas');
                const moved = (x, y) => Math.abs(x - downX) > MOVE_SLOP || Math.abs(y - downY) > MOVE_SLOP;
                document.addEventListener('pointerdown', (e) => {
                    downX = e.clientX;
                    downY = e.clientY;
                    dragged = false;
                }, true);
                document.addEventListener('pointermove', (e) => {
                    if (! dragged && e.buttons && moved(e.clientX, e.clientY)) { dragged = true; }
                }, true);
                /* 触屏：安卓上控件在指针处理里 preventDefault 之后 pointermove 可能收不到，
                 * 所以 touchmove 也记一份（与页面上双击判定用的是同一套经验）。 */
                document.addEventListener('touchmove', (e) => {
                    const t = e.changedTouches && e.changedTouches[0];
                    if (! dragged && t && moved(t.clientX, t.clientY)) { dragged = true; }
                }, true);
                document.addEventListener('pointerup', () => {
                    if (dragged) { dragEndAt = Date.now(); }
                }, true);
                document.addEventListener('pointercancel', () => {
                    if (dragged) { dragEndAt = Date.now(); }
                }, true);
                document.addEventListener('click', (e) => {
                    if (! isCanvas(e.target)) { return; }
                    if (Date.now() - dragEndAt < DRAG_WINDOW) {
                        e.stopPropagation();        // ① 拖动之后的那一下不算点击 ⇒ 不关看图器
                        return;
                    }
                    if (document.documentElement.classList.contains('ls-viewer-fs')) {
                        e.stopPropagation();        // ② 全屏：干掉"点空白关闭"
                        const src = (e.detail && e.detail.originalEvent) || e;
                        flashFullscreenUI({type: 'click', clientX: src.clientX || 0, clientY: src.clientY || 0});
                    }
                }, true);
            })();

            /* 点背景 / 按 × 关掉看图器时，若还在全屏就顺手退出全屏 —— 即"点一下彻底退出" */
            document.addEventListener('hidden', () => {
                const d = document;
                if (d.fullscreenElement || d.webkitFullscreenElement) {
                    const exit = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen || d.mozCancelFullScreen;
                    if (exit) { exit.call(d); }
                }
            });

            const cropEditor = (function () {
                const SUPPORTED = ['jpg', 'jpeg', 'png'];
                const UPLOAD_URL = '{{ route('upload') }}';
                let cropper = null;
                let current = null;
                let flipX = 1;                      // 翻转态：每次打开/关闭都归零（本来就每次重建实例）
                let flipY = 1;

                const $layer = () => $('#crop-layer');
                const $image = () => $('#crop-image');

                const extOf = (url) => {
                    const path = String(url || '').split('?')[0].split('#')[0];
                    const m = path.match(/\.([A-Za-z0-9]+)$/);
                    return m ? m[1].toLowerCase() : '';
                };

                // 允许传入：卡片元素 / 卡片里的 img / jQuery 对象 / 纯 {url, name} 对象
                const infoOf = (item) => {
                    if (item && typeof item === 'object' && ! item.jquery && ! (item instanceof Element) && item.url) {
                        return { url: item.url, name: item.name || '', ext: extOf(item.url) };
                    }
                    const $item = $(item);
                    let $card = $();
                    if ($item.is(IMAGES_ITEM)) { $card = $item; }
                    else if ($item.closest(IMAGES_ITEM).length) { $card = $item.closest(IMAGES_ITEM); }
                    const json = ($card.length ? $card.data('json') : $item.data('json')) || {};
                    let url = json.url || '';
                    if (! url) {
                        url = $card.find('img[data-original]').attr('data-original')
                            || $item.find('img[data-original]').attr('data-original')
                            || '';
                    }
                    const name = json.origin_name || json.name || (url ? decodeURIComponent(url.split('/').pop() || '') : '');
                    return { url: url, name: name, ext: extOf(url) };
                };

                const supported = (item) => {
                    const info = infoOf(item);
                    return !! info.url && SUPPORTED.indexOf(info.ext) !== -1;
                };

                const refreshHint = () => {
                    if (! cropper) { return; }
                    let text = '';
                    try {
                        const d = cropper.getData(true);
                        const mp = (d.width * d.height) / 1e6;
                        text = d.width + ' × ' + d.height + '（约 ' + mp.toFixed(1) + 'MP';
                        text += current && current.ext === 'png' ? '，无损 PNG' : '';
                        text += '）';
                        if (mp >= 30) { text += ' · 这张比较大，上传要几秒'; }
                    } catch (e) { text = ''; }
                    $('#crop-hint').text(text);
                };

                const close = () => {
                    if (cropper) { try { cropper.destroy(); } catch (e) {} cropper = null; }
                    current = null;
                    flipX = 1;
                    flipY = 1;
                    $layer().removeClass('is-open is-busy').attr('aria-hidden', 'true');
                    $image().removeAttr('src');
                    $('#crop-ratios a').removeClass('active').filter('[data-crop-ratio="free"]').addClass('active');
                };

                const open = (item) => {
                    const info = infoOf(item);
                    if (! info.url) { toastr.warning('没有找到这张图片的地址'); return; }
                    if (SUPPORTED.indexOf(info.ext) === -1) { toastr.warning('该格式不支持编辑'); return; }
                    // 看图器开着就先关掉：两层叠在一起会互相抢手势
                    try {
                        if (document.body.classList.contains('viewer-open') && viewer && typeof viewer.hide === 'function') {
                            viewer.hide();
                        }
                    } catch (e) {}
                    if (cropper) { try { cropper.destroy(); } catch (e) {} cropper = null; }
                    current = info;
                    flipX = 1;
                    flipY = 1;
                    $layer().addClass('is-open').attr('aria-hidden', 'false');
                    $('#crop-hint').text('加载中…');
                    const img = $image().get(0);
                    img.onload = () => {
                        cropper = new Cropper(img, {
                            viewMode: 1,                    // 裁剪框不超出图片
                            dragMode: 'move',
                            autoCropArea: 0.8,
                            background: false,
                            modal: false,                   // 框外变暗改由 #crop-layer 里的 box-shadow 负责，见本页 <style>
                            checkOrientation: true,         // 带 EXIF 旋转的手机图按显示方向处理
                            rotatable: true,
                            scalable: true,                 // 翻转要 scaleX/scaleY（Cropper 里 scale() 受这一项开关）；
                                                            // 放大缩小手势仍由 zoomable/zoomOnTouch/zoomOnWheel 管
                            zoomOnTouch: true,
                            zoomOnWheel: true,
                            toggleDragModeOnDblclick: false,
                            ready: refreshHint,
                            crop: refreshHint,
                        });
                        refreshHint();
                    };
                    img.onerror = () => {
                        close();
                        toastr.warning('图片加载失败（跨域被拦或网络问题）');
                    };
                    img.src = info.url;
                };

                // 看图器里当前显示的那张：url: 'data-original' ⇒ canvas 里最后插入的 img 的 src 就是原图地址
                const viewerUrl = () => {
                    const imgs = document.querySelectorAll('.viewer-canvas img');
                    for (let i = imgs.length - 1; i >= 0; i--) {
                        const src = imgs[i].getAttribute('src');
                        if (src) { return src; }
                    }
                    return '';
                };

                const openFromViewer = () => {
                    const url = viewerUrl();
                    if (! url) { toastr.warning('没有找到当前图片'); return; }
                    const card = document.querySelector(IMAGES_ITEM + ' img[data-original="' + url.replace(/"/g, '\\"') + '"]');
                    open(card || { url: url });
                };

                // 看图器里切图后，按当前图格式显示/隐藏「裁剪」按钮（其它格式不给入口）
                const syncViewerButton = () => {
                    const url = viewerUrl();
                    const ok = !! url && SUPPORTED.indexOf(extOf(url)) !== -1;
                    document.querySelectorAll('.viewer-toolbar li.viewer-crop').forEach((li) => {
                        li.style.display = ok ? '' : 'none';
                    });
                    syncFullscreenIcon();      // 工具栏可能刚被重建，全屏图标状态跟着补一次
                };
                document.addEventListener('viewed', syncViewerButton);
                document.addEventListener('shown', syncViewerButton);

                const upload = (file) => {
                    const fd = new FormData();
                    fd.append('file', file);
                    const $strategy = $('#strategy-selected');
                    if ($strategy.length && $strategy.data('id')) { fd.append('strategy_id', $strategy.data('id')); }
                    const token = $('meta[name="csrf-token"]').attr('content');
                    $layer().addClass('is-busy');
                    $('#crop-hint').text('上传中…');
                    return $.ajax({
                        url: UPLOAD_URL,
                        type: 'POST',
                        data: fd,
                        processData: false,
                        contentType: false,
                        headers: token ? { 'X-CSRF-TOKEN': token } : {},
                        dataType: 'json',
                    }).done((response) => {
                        if (response && response.status === false) {
                            toastr.error(response.message || '上传失败');
                            return;
                        }
                        close();
                        toastr.success('已保存并上传');
                        try { if (typeof resetImages === 'function') { resetImages(); } } catch (e) {}
                    }).fail((xhr) => {
                        const data = xhr && xhr.responseJSON;
                        let msg = (data && (data.message || data.data)) || ('上传失败（HTTP ' + (xhr ? xhr.status : '?') + '）');
                        if (data && data.errors) { msg = '上传失败：' + Object.values(data.errors).flat().join('；'); }
                        toastr.error(msg);
                        $('#crop-hint').text('上传失败，可重试');
                    }).always(() => {
                        $layer().removeClass('is-busy');
                    });
                };

                const doCrop = () => {
                    if (! cropper || ! current) { return; }
                    const isPng = current.ext === 'png';
                    const mime = isPng ? 'image/png' : 'image/jpeg';
                    let canvas = null;
                    try {
                        // 不设 maxWidth/maxHeight：按原图尺寸导出（绝不放大）
                        canvas = cropper.getCroppedCanvas({ imageSmoothingQuality: 'high' });
                    } catch (e) { canvas = null; }
                    if (! canvas || ! canvas.width || ! canvas.height) { toastr.warning('裁剪失败，请重试'); return; }
                    const base = (current.name || 'image').replace(/\.[^.]*$/, '');
                    const name = base + (isPng ? '.png' : '.jpg');
                    const done = (blob) => {
                        if (! blob) { toastr.warning('导出失败，请重试'); return; }
                        upload(new File([blob], name, { type: mime }));
                    };
                    if (typeof canvas.toBlob === 'function') {
                        canvas.toBlob(done, mime, isPng ? undefined : 0.95);
                    } else {
                        const dataUrl = canvas.toDataURL(mime, isPng ? undefined : 0.95);
                        const bin = atob(dataUrl.split(',')[1]);
                        const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
                        done(new Blob([arr], { type: mime }));
                    }
                };

                if ($('#crop-layer').length) {
                    $layer().on('click', '[data-crop-action]', function () {
                        const action = $(this).data('crop-action');
                        if (action === 'cancel') { return close(); }
                        if (action === 'crop') { return doCrop(); }
                        if (! cropper) { return; }
                        if (action === 'rotate-left') { cropper.rotate(-90); }
                        if (action === 'rotate-right') { cropper.rotate(90); }
                        if (action === 'flip-x') { flipX = -flipX; cropper.scale(flipX, flipY); }
                        if (action === 'flip-y') { flipY = -flipY; cropper.scale(flipX, flipY); }
                        refreshHint();
                    });
                    $layer().on('click', '[data-crop-ratio]', function () {
                        const ratio = $(this).data('crop-ratio');
                        if (! cropper) { return; }
                        $(this).siblings().removeClass('active');
                        $(this).addClass('active');
                        if (ratio === '1:1') { cropper.setAspectRatio(1); }
                        else if (ratio === '4:3') { cropper.setAspectRatio(4 / 3); }
                        else if (ratio === '16:9') { cropper.setAspectRatio(16 / 9); }
                        else { cropper.setAspectRatio(NaN); }
                        refreshHint();
                    });
                }

                return { open: open, openFromViewer: openFromViewer, supported: supported, close: close };
            })();

            /* 底部缩略图条上的快捷切图（老师要的功能）。
             *   · 电脑：光标在缩略图条上滚轮 ⇒ 滚一格切一张。
             *     控件自己在外层容器上绑了"滚轮缩放"（捕获阶段），所以这里也在 document 捕获
             *     阶段抢在它之前，并且**只对落在缩略图条上的滚轮生效**：图上滚轮依旧是缩放。
             *   · 手机：在缩略图条上左右拖动 ⇒ 连续切图（每滑过 DRAG_STEP 像素切一张，
             *     拖回来也会切回去）。缩略图条被库设成 touch-action:none、本来就划不动，
             *     所以不存在"抢走缩略图条自己的滚动"这个问题（它靠自动跟随当前图）。
             * 一律从外面调它的对外 API viewer.view(index)，不改库；到头即止（loop 已关）。 */
            (function () {
                const BAR = '.viewer-navbar';
                const WHEEL_GAP = 260;   // 滚轮节流：一格切一张，别被惯性滚轮连着切
                const DRAG_STEP = 40;    // 手机上每滑过这么多像素切一张
                let lastWheel = 0;
                let navDown = false;
                let dragStartX = 0;
                let dragBaseIndex = 0;
                const inBar = (el) => el instanceof Element && !!el.closest(BAR);
                const count = () => document.querySelectorAll(BAR + ' .viewer-list > li').length;
                const goTo = (i) => {
                    const n = count();
                    if (!n || !Number.isFinite(i)) return;
                    const target = Math.max(0, Math.min(n - 1, i));
                    if (target !== viewer.index) viewer.view(target);
                };
                /* 滚轮切图：这里**必须**能 preventDefault，否则页面会跟着一起滚
                 * （老师报的"缩略图条滚轮切图的同时整页也在滚"）。
                 * 代价：document 上的非 passive wheel 会让浏览器失去"不等 JS 就滚动"的快路径 ⇒
                 * 只在看图器打开期间挂它（shown 挂 / hidden 摘），平时整页滚动一点不受影响。
                 * 仍然要 stopPropagation：控件"把滚轮当缩放"是在外层容器的捕获阶段做的，
                 * 不拦住它，图上滚轮就会被同时当成缩放。 */
                const onBarWheel = (e) => {
                    if (!inBar(e.target)) return;
                    e.stopPropagation();
                    e.preventDefault();
                    const now = Date.now();
                    if (now - lastWheel < WHEEL_GAP) return;
                    lastWheel = now;
                    goTo(viewer.index + (e.deltaY > 0 ? 1 : -1));
                };
                let barWheelOn = false;
                document.addEventListener('shown', () => {
                    if (barWheelOn) return;
                    barWheelOn = true;
                    document.addEventListener('wheel', onBarWheel, {capture: true, passive: false});
                });
                document.addEventListener('hidden', () => {
                    if (!barWheelOn) return;
                    barWheelOn = false;
                    document.removeEventListener('wheel', onBarWheel, {capture: true});
                });
                document.addEventListener('touchstart', (e) => {
                    navDown = inBar(e.target);
                    const t = e.changedTouches && e.changedTouches[0];
                    if (navDown && t) {
                        dragStartX = t.clientX;
                        dragBaseIndex = viewer.index;
                    }
                }, true);
                /* 注意：这个监听器**必须**是 passive，绝不能 preventDefault。
                 * 在 document 上注册「非 passive 的 touchmove」会让 Chrome 失去"不等 JS 就滚动/绘制"
                 * 的快路径 —— 表现是远离手指的元素（比如屏幕底部的缩略图条）不重绘：一直空白，
                 * 手指一碰它才突然画出来（安卓上尤其明显）。老师说"像被什么卡住了"就是这个。
                 * 而缩略图条本来就是 touch-action:none、浏览器不会滚它，所以根本不用 preventDefault。 */
                document.addEventListener('touchmove', (e) => {
                    if (!navDown) return;
                    const t = e.changedTouches && e.changedTouches[0];
                    if (!t) return;
                    // 往左拖 = 下一张，往右拖 = 上一张；按"已经滑过的距离"连续跟随，拖回来也切回去
                    goTo(dragBaseIndex + Math.trunc((dragStartX - t.clientX) / DRAG_STEP));
                }, {capture: true, passive: true});
                document.addEventListener('touchend', () => { navDown = false; }, true);
                document.addEventListener('touchcancel', () => { navDown = false; }, true);
            })();

                                    /* 触摸端切图判定（接管 slideOnTouch 后的配套逻辑）：
             * 库里 slideOnTouch:false ⇒ 单指动作永远是 'move'，库自己的平移就是跟手拖动，
             * 不再出现 'switch' 动作 ⇒ 1px 判据与"闩锁"都不存在。切图还是回弹由松手时决定。
             * 为什么不拦事件：库用 HAS_POINTER_EVENT ? 'pointermove' : 'touchmove' 选通道，
             * 拦 pointermove 在真机上可能整段失效（踩过）。这里只读 viewer.action 判定是否放权，
             * 一个字都不写库的内部状态 —— 捏合/双击/过渡因此完全不受影响。 */
            (function () {
                const FAR_RATIO = 0.18;    // 够远：视口宽的这个比例
                const FAR_MIN = 56;        // 或至少这么多 px
                const FAST_SPEED = 0.5;    // 够快：px/ms
                let g = null;
                let guardClick = 0;   // 刚切过图的时刻：用来吞掉随后那发背景 click
                const inCanvas = (el) => el instanceof Element && !!el.closest('.viewer-canvas');
                const isFit = () => {
                    const d = viewer.imageData;
                    const v = viewer.viewerData;
                    if (!d || !v) return false;
                    return d.x >= 0 && d.y >= 0 && d.width <= v.width && d.height <= v.height;
                };
                document.addEventListener('pointerdown', (e) => {
                    if (!e.isPrimary) { if (g) g.multi = true; return; }   // 第二指 ⇒ 捏合，放权给库
                    g = (e.pointerType !== 'mouse' && inCanvas(e.target))
                        ? { x: e.clientX, y: e.clientY, t: e.timeStamp, fit: isFit(), multi: false }
                        : null;
                }, true);
                document.addEventListener('pointerup', (e) => {
                    if (!g || !e.isPrimary) return;
                    const s = g;
                    g = null;
                    if (!s.fit || s.multi) return;                        // 放大态 / 捏合：一律交给库
                    const dx = e.clientX - s.x;
                    const dy = e.clientY - s.y;
                    const dt = Math.max(1, e.timeStamp - s.t);
                    const far = Math.abs(dx) > Math.max(FAR_MIN, window.innerWidth * FAR_RATIO);
                    const fast = Math.abs(dx) / dt > FAST_SPEED && Math.abs(dx) > 30;
                    if ((far || fast) && Math.abs(dx) > Math.abs(dy) * 1.5) {
                        if (dx < 0) viewer.next(false); else viewer.prev(false);
                        guardClick = Date.now();                          // 标记：刚刚切过图
                    } else if (dx !== 0 || dy !== 0) {
                        viewer.reset();                                   // 带动画的回弹
                    }
                }, false);
                /* 手指在图片外空白处结束时，浏览器会补一发 click 落到背景上，库因此关闭查看器 ——
                 * 于是"切图成功"和"退出查看"同时发生。这里只吞紧跟切图之后那 400ms 内的背景 click，
                 * 且点在图片上的不算，避免误伤正常点击关闭。 */
                document.addEventListener('click', (e) => {
                    if (Date.now() - guardClick > 400) return;
                    if (e.target instanceof Element && e.target.closest('.viewer-canvas img')) return;
                    guardClick = 0;
                    e.stopPropagation();
                    e.preventDefault();
                }, true);
            })();

            /* 双击放大：库里的「模拟双击」（handlers.js:424-451）只看两次抬手的间隔（硬编码 500ms），
             * 完全不检查中间有没有拖动 ⇒ 连续拖动两下也会被当成双击放大。这里在外面收口（不改库）：
             *   1. 抬手时用「起点→终点」的位移判断这一下是轻点还是拖动。阈值 30px 的依据是实测：
             *      真滑动位移 130~300px（中位 214px），轻点抖动一般 <15px，30px 正好把两者分开。
             *   2. 是拖动 ⇒ 立刻清掉库的 imageClicked，让拖动永远不能充当"第一次轻点"；
             *      若这一下之前已经有"第一次轻点"了（imageClicked 曾被置位），说明是"轻点+拖动"，
             *      那发 50ms 后要派发的合成 dblclick 也一并拦掉。
             *   3. 两次都不动的轻点 ⇒ 真双击，放行；并按老师要求把有效期从 500ms 收到 300ms
             *      （300ms 后清掉库的 imageClicked，等效于缩短双击判定窗口）。
             * 注意必须用 touchstart/touchend 的坐标差，**不能**靠 touchmove：安卓上控件在指针处理里
             * preventDefault 之后 touchmove 可能根本收不到。 */
            (function () {
                const TAP_SLOP = 30;      // 超过它就当"拖动"
                const TAP_WINDOW = 300;   // 等效双击窗口（老师定）
                let startX = 0;
                let startY = 0;
                let tapTimer = 0;
                let swallowDblUntil = 0;
                const isViewer = (el) => el instanceof Element && !!el.closest('.viewer-container');
                document.addEventListener('touchstart', (e) => {
                    const t = e.changedTouches && e.changedTouches[0];
                    if (t) { startX = t.clientX; startY = t.clientY; }
                }, true);
                document.addEventListener('touchend', (e) => {
                    const t = e.changedTouches && e.changedTouches[0];
                    if (!t || !isViewer(e.target)) return;
                    const moved = Math.abs(t.clientX - startX) > TAP_SLOP
                        || Math.abs(t.clientY - startY) > TAP_SLOP;
                    clearTimeout(tapTimer);
                    if (moved) {
                        if (viewer.imageClicked) swallowDblUntil = Date.now() + 150;   // 轻点+拖动 ≠ 双击
                        viewer.imageClicked = false;
                    } else if (viewer.imageClicked) {
                        tapTimer = setTimeout(() => { viewer.imageClicked = false; }, TAP_WINDOW);
                    }
                }, true);
                document.addEventListener('dblclick', (e) => {
                    if (Date.now() < swallowDblUntil && isViewer(e.target)) e.stopPropagation();
                }, true);
            })();

            /* 修 Viewer.js 的「闩锁」bug（真机打点 + 源码逐行核对 + jsdom 复现确认）：
             *   others.js:216-223  change() 里
             *       case ACTION_SWITCH: {
             *         this.action = 'switched';                       // ← 第一次 pointermove 就先上闩
             *         if (|offsetX| > 1 && |offsetX| > |offsetY|) { … this.view(index) }
             *   上闩之后 action 成了字符串 'switched'，而外层 switch 没有这个分支 ⇒ 之后
             *   每一次 pointermove 全部落空：不切图、不平移、不放大 =「纹丝不动」。
             *   判据又只看开头那次采样，真手指刚落下天然带纵向抖动（dy ≥ dx）⇒ 大多数手势
             *   一开始就被闩死，偶尔开头偏横向才成功 —— 这就是「大多数失败、少数成功、无规律」。
             * 从外面把闩松开：手势期间发现 action 变成那个闩值，就恢复成刚才那个动作值，
             * 后续采样继续参与判定（切图判据看的是"最近一次位移"，所以横滑一定能切到）。
             * 不改 viewer.min.js（压缩产物，改了没法维护）。 */
            (function () {
                let inViewer = false;
                let lastAction = null;
                let switchAction = null;
                const isViewer = (el) => el instanceof Element && !!el.closest('.viewer-container');
                document.addEventListener('pointerdown', (e) => {
                    inViewer = isViewer(e.target);
                    lastAction = null;
                }, true);
                document.addEventListener('pointermove', (e) => {
                    if (!inViewer) return;
                    const a = viewer.action;
                    if (a === 'switched') {
                        // 学到切图动作的真值后，把闩松开
                        if (!switchAction && lastAction) switchAction = lastAction;
                        if (switchAction && viewer.action !== switchAction) viewer.action = switchAction;
                    } else if (a) {
                        lastAction = a;      // 手势开始时 Viewer 刚算出来的动作值
                    }
                }, true);
                document.addEventListener('pointerup', () => { inViewer = false; }, true);
                document.addEventListener('pointercancel', () => { inViewer = false; }, true);
            })();

            
            /* 桌面 110% 缩放下看图控件（Viewer.js）的整体偏移：**不在这里用 JS 打补丁**。
             * 真因：<html>{zoom:1.1} 让 Viewer 内部「以为的 1px」只有屏幕上的 1/1.1 ——
             *   它按视觉尺寸（window.innerWidth = 1280）算居中与适配，却把结果当【布局值】
             *   写进内联样式（布局空间只有 1164），渲染时浏览器又乘 1.1 ⇒
             *   ① 图片整体偏右下（1280 宽下约 +64px）；
             *   ② 按视觉算出的适配尺寸偏大，图片会盖住下方导航条/缩略图，且放大后拖不动。
             * 正解在外壳上做**反向缩放**（common.less 的 `html .viewer-container { zoom: ... }`）：
             *   让 Viewer 的子坐标系与屏幕 1:1，它自己的居中/适配/平移数学就全对了 ——
             *   点开、键盘 ←→ 切图、滚轮放大、拖拽平移都不必再各修一遍。
             * （教训：第三方控件遇到根节点 zoom，就把它那层缩回去，别逐条路径打补丁。） */


            $photos.justifiedGallery(gridConfigs);

            let albumsInfinite = null;
            // 相册弹窗：渲染内容（外壳 + 列表）→ 跑初始化回调 → 打开弹窗。
            // 职责与旧的 drawer.open(title, content, callback) 一一对应，只是换成 Alpine 的 modal store。
            const openAlbums = (content, callback) => {
                $('#album-switch-content').html(content);
                $('#album-switch-scroll').html($('#albums-container-tpl').html());
                callback && callback();
                modal.open(ALBUM_MODAL);
            };
            // 相册弹窗的「收起来」= 旧的 drawer.close()：先收掉相册列表的无限加载，再关弹窗
            const closeAlbums = () => {
                albumsInfinite && albumsInfinite.destroy();
                modal.close(ALBUM_MODAL);
            };
            const imagesInfinite = utils.infiniteScroll(IMAGES_SCROLL, {
                url: '{{ route('user.images') }}',
                classes: ['dragselect'],
                root: 'window',                     // 图片墙已是整页滚动（见上面的容器注释）
                success: function (response) {
                    if (!response.status) {
                        return toastr.error(response.message);
                    }

                    let images = response.data.images.data;
                    if (images.length <= 0 || response.data.images.current_page === response.data.images.last_page) {
                        this.finished = true;
                    }

                    let html = '';
                    for (const i in images) {
                        html += $('#images-item-tpl').html()
                            .replace(/__id__/g, images[i].id)
                            .replace(/__name__/g, images[i].filename.replace(/\$/g, '$$$$'))
                            .replace(/__human_date__/g, images[i].human_date)
                            .replace(/__date__/g, images[i].date)
                            .replace(/__url__/g, images[i].url)
                            .replace(/__thumb_url__/g, images[i].thumb_url)
                            .replace(/__width__/g, images[i].width)
                            .replace(/__height__/g, images[i].height)
                            // 卡片角标 = 这张图的标签（列表接口已带 tags）
                            .replace(/__tags__/g, cardTagsHtml(images[i].tags).replace(/\$/g, '$$$$'))
                            // 标签名会进这里的 JSON，而 data-json 是单引号属性 —— 名字里带 '
                            // 就能把属性提前闭合（自伤型 XSS 面），所以先按 HTML 转义再注入
                            .replace(/__json__/g, escapeHtml(JSON.stringify(images[i])).replace(/\$/g, '$$$$'))
                    }

                    $photos.append(html);
                    ds.setSelectables($photos.find(IMAGES_ITEM));
                },
                complete: function () {
                    if ($photos.html() !== '') {
                        // 由于 justifiedGallery 创建后占高度(无论是否有内容或内容被清空)，导致加载过程中在没有数据的情况下高度被拉开
                        // 所以需要在重置前销毁，重置数据后重新构建 justifiedGallery
                        if ($photos.hasClass('reset')) {
                            $photos.justifiedGallery(gridConfigs).removeClass('reset');
                        }

                        $photos.justifiedGallery('norewind')
                        viewer.update();
                    } else {
                        // 没有任何数据时销毁 justifiedGallery
                        $photos.justifiedGallery('destroy')
                    }
                    $headerTitle.text('我的图片')
                }
            });

            // ★ B 保险：告诉无限加载「用户是不是真的在往下滚 + 是不是刚重置过」。
            //   浏览器为了维持滚动位置偷偷补的那一滚，不满足这两个条件，于是不会连锁。
            {
                // 只做记录、不做拦截。
                // ★ 教训：曾经这里做过一道「必须由用户手指驱动（touchmove/wheel）才放行」的闸，
                //   结果把真实滑到底一起堵死了 —— 用户滑到底那一刻可能刚处在窗口边缘，当场被拦
                //   后又不再有 scroll 事件 ⇒ 永远不加载；程序化滚动（测试、浏览器补滚）更是永远
                //   挤不进这条路径。守卫测试 infinite-scroll 三套当时全红，失败项正是「到底了不
                //   触发」。说明那道闸方向就是错的，别再往这里加法。
                //   拦截只保留 app.js 里那一道「重置窗口」。
                window.__lskyScrollGate = window.__lskyScrollGate || { lastY: window.scrollY };
                window.addEventListener('scroll', function () {
                    window.__lskyScrollGate.lastY = window.scrollY;
                }, { passive: true });
            }   // ★ 重置窗口的截止时间戳（见 resetImages）
            const resetImages = (params) => {
                // ★ 顺序很重要：清空内容之前先回顶部。
                //   清空后页面高度塌缩，浏览器的滚动位置会被夹到某个浅位置，再叠加重排补滚，
                //   就是「无脑滚到底」的起点。换排序/刷新本来也该从头看。
                try { window.scrollTo(0, 0); } catch (e) {}
                $photos.addClass('reset').html('').justifiedGallery('destroy');
                ds.clearSelection();
                params = $.extend({page: 1}, params)
                // ★ 重置窗口：从清空到第一页真正落地这段时间里，忽略滚动触发的加载。
                //   这段时间页面高度剧烈变化（塌缩 → 逐页长回来），最容易被补齐/重排带着连发。
                resetGuardUntil = Date.now() + 800;
                try { window.__lskyResetGuardUntil = resetGuardUntil; } catch (e) {}
                imagesInfinite.refresh(params);
            }

            const getAlbums = (options, callback) => {
                // 相册列表从右侧抽屉搬进居中卡片弹窗（与「移动到相册」同一套 x-modal）：
                // 外壳（标题 + 本地搜索框 + 列表容器 —— 底部的「完成」按钮已删）进 #album-switch-content，
                // 列表内容（#albums-container：创建/重命名表单 + 相册行）进无限加载容器 #album-switch-scroll。
                // 创建入口也从抽屉标题的 + 号搬进了列表里（见 #albums-container-tpl）。
                let content = $('#album-switch-tpl').html().replace(/__title__/g, (options || {}).title || '相册');
                openAlbums(content, function () {
                    let $albums = $('#albums-container');
                    const CREATE_ID = '#album-add';
                    const UPDATE_ID = '#album-edit';

                    // 空状态：一行都没有 → 「还没有相册」；有相册但被搜索过滤光了 → 「没有匹配的相册」
                    const updateEmpty = () => {
                        let total = $albums.find('> ' + ALBUM_ROW).length;
                        let visible = $albums.find('> ' + ALBUM_ROW + ':not(.hidden)').length;
                        $('#album-switch-empty').toggleClass('hidden', visible > 0);
                        $('#album-switch-empty-text').text(total === 0 ? '还没有相册' : '没有匹配的相册');
                    };

                    // 搜索框：只在已加载的相册里按名称即时过滤（本地过滤，不打接口）
                    const applyFilter = () => {
                        let keyword = ($('#album-switch-search').val() || '').trim().toLowerCase();
                        $albums.find('> ' + ALBUM_ROW).each(function () {
                            $(this).toggleClass('hidden', keyword !== '' && $(this).find('.name').text().toLowerCase().indexOf(keyword) === -1);
                        });
                        updateEmpty();
                    };

                    // 上一轮打开留下的无限加载实例先收掉（旧实现是在 drawer.close() 里做的）
                    albumsInfinite && albumsInfinite.destroy();
                    albumsInfinite = utils.infiniteScroll('#album-switch-scroll', {
                        url: '{{ route('user.albums') }}',
                        complete: function () {
                            // 首屏「加载中...」收起（接口报错也收起，不留一个转不完的圈）
                            $('#album-switch-loading').addClass('hidden');
                            updateEmpty();
                        },
                        success: function (response) {
                            if (!response.status) {
                                return toastr.error(response.message);
                            }

                            let albums = response.data.albums.data;
                            if (albums.length <= 0 || response.data.albums.current_page === response.data.albums.last_page) {
                                this.finished = true;
                            }

                            let html = '';
                            for (const i in albums) {
                                html += $('#albums-item-tpl').html()
                                    .replace(/__id__/g, albums[i].id)
                                    .replace(/__name__/g, albums[i].name)
                                    .replace(/__intro__/g, albums[i].intro)
                                    .replace(/__image_num__/g, albums[i].image_num)
                                    // 当前所在相册标出来（与「移动到相册」弹窗同一个徽标）
                                    .replace(/__current_badge__/g, albums[i].id === selectedAlbum.id
                                        ? '<div class="ls-badge shrink-0 bg-brand-soft text-brand">当前</div>'
                                        : '')
                                    .replace(/__json__/g, JSON.stringify(albums[i]))
                            }

                            $albums.append(html);

                            // 当前相册高亮：与「移动到相册」弹窗同一套令牌切换。
                            // 打在行容器（.albums-row）上 —— 高亮边框要包住右边的两个按钮；
                            // 基础态就是模板里的 border-line bg-surface，on 时一起摘掉换成品牌色。
                            $albums.find('> ' + ALBUM_ROW).each(function () {
                                let on = $(this).data('id') === selectedAlbum.id;
                                $(this)
                                    .toggleClass('border-brand bg-brand-soft text-brand', on)
                                    .toggleClass('border-line bg-surface', ! on);
                            });

                            // 新追加的页也要跟上当前的搜索词
                            applyFilter();

                            callback && callback.call(this, $albums.get(0));
                        }
                    });

                    // 切换只挂在行内的 <a class="albums-item"> 上：编辑/删除按钮现在是 <a> 的兄弟节点，
                    // 点它们冒泡到不了这里（这正是「点不中就跳进相册」的修法）。
                    $albums.off('click', '.albums-item').on('click', '.albums-item', function () {
                        // 如果当前已经为选中状态则清除
                        if (selectedAlbum.id === $(this).data('id')) {
                            selectedAlbum = {};
                        } else {
                            selectedAlbum = $(this).data('json');
                        }
                        resetImages({page: 1, album_id: selectedAlbum.id || null});
                        // 选中即切换：与旧抽屉一样，切换后把相册弹窗收起来
                        closeAlbums();
                        ds.clearSelection();
                    });

                    const resetAlbums = () => {
                        $albums.find('> ' + ALBUM_ROW).remove();
                        $albums.find(CREATE_ID).addClass('hidden');
                        $albums.find(UPDATE_ID).remove();
                        albumsInfinite.refresh({page: 1});
                    }

                    $albums.off('click', '.update').on('click', '.update', function (e) {
                        e.stopPropagation();
                        let selectedId = $albums.find(UPDATE_ID).data('id');
                        // 按钮在 <a> 外面，id / 名称 / 简介都要从外层行容器再往下取
                        let $item = $(this).closest(ALBUM_ROW);
                        $albums.find(UPDATE_ID).remove();
                        if (selectedId !== $item.data('id')) {
                            $item.after($('#album-update-tpl').html()
                                .replace(/__id__/g, $item.data('id'))
                                .replace(/__name__/g, $item.find('.name').html())
                                .replace(/__intro__/g, $item.find('a.albums-item').attr('title'))
                            );
                        }
                    });

                    $albums.off('click', '.delete').on('click', '.delete', function (e) {
                        e.stopPropagation();
                        Swal.fire({
                            // 与新弹窗（x-modal）一套：不动背景页面。
                            // heightAuto 关掉 html/body 上的 swal2-height-auto；scrollbarPadding 关掉
                            // sweetalert2 往 body 写 padding-right 的那一步（它按「滚动条宽度」补内边距，
                            // 手机上明明没有占位滚动条，补 8px 却真的会把内容挤窄 → 工具栏换行、整页下移）。
                            heightAuto: false,
                            scrollbarPadding: false,
                            title: '确认删除该相册?',
                            text: "删除后相册中的图片将会被移出。",
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonColor: '#3085d6',
                            cancelButtonColor: '#d33',
                            confirmButtonText: '确认',
                        }).then((result) => {
                            if (result.isConfirmed) {
                                let id = $(this).closest(ALBUM_ROW).data('id');
                                axios.delete(`/user/albums/${id}`).then(response => {
                                    if (response.data.status) {
                                        selectedAlbum = {};
                                        resetImages();
                                        // 旧实现是 300ms 后把抽屉整个收掉；弹窗里改成原地刷新列表
                                        // —— 删掉的那一行立刻消失、图片数跟着重算，用户还能接着挑别的相册
                                        resetAlbums();
                                    } else {
                                        toastr.error(response.data.message);
                                    }
                                });
                            }
                        })
                    });

                    // confirm create
                    $albums.off('submit', CREATE_ID + ' form').on('submit', CREATE_ID + ' form', function (e) {
                        e.preventDefault();
                        let $form = $(this);
                        axios.post($form.attr('action'), $form.serialize()).then(response => {
                            let $errorMessage = $albums.find(CREATE_ID + ' .error-message').html('').hide();
                            if (response.data.status) {
                                $form.get(0).reset();
                                resetAlbums()
                            } else {
                                $errorMessage.html('<i class="fas fa-exclamation-circle"></i> ' + response.data.message).show();
                            }
                        });
                    });

                    // confirm update
                    $albums.off('submit', UPDATE_ID + ' form').on('submit', UPDATE_ID + ' form', function (e) {
                        e.preventDefault();
                        let $form = $(this);
                        axios.put($form.attr('action'), $form.serialize()).then(response => {
                            let $errorMessage = $albums.find(UPDATE_ID + ' .error-message').html('').hide();
                            if (response.data.status) {
                                let $editContainer = $(this).closest(UPDATE_ID);
                                let $row = $albums.find(`> ${ALBUM_ROW}[data-id=${$editContainer.data('id')}]`);
                                $row.find('a.albums-item').attr('title', $form.find('textarea').val());
                                $row.find('.name').text($form.find('input').val());
                                $editContainer.remove();
                            } else {
                                $errorMessage.html('<i class="fas fa-exclamation-circle"></i> ' + response.data.message).show();
                            }
                        });
                    });

                    // 搜索框：输入即过滤（本地，不打接口）
                    $('#album-switch-search').off('input').on('input', _ => applyFilter());
                });
            }

            const setOrderBy = function (sort) {
                resetImages({page: 1, order: sort})
                $('#order span').text({newest: '最新', earliest: '最早', utmost: '最大', least: '最小'}[sort]);
            };

            // 顶部「标签」下拉的内容由这里渲染：点一下即筛选（多选 AND），不等下拉收起。
            // 多选项沿用本页 44px 点击区约定（min-h-[44px]），手机上才点得中。
            const renderTagFilter = () => {
                let $list = $('#tag-filter-list');
                if (! $list.length) {
                    return;
                }

                let html = '';
                if (! allTags.length) {
                    html = '<div class="px-3.5 py-3 text-[13px] text-ink-3">暂无标签</div>';
                } else {
                    for (const tag of allTags) {
                        let on = selectedTagIds.indexOf(tag.id) !== -1;
                        html += '<a href="javascript:void(0)" data-tag-id="' + tag.id + '"'
                            + ' class="tag-filter-item flex min-h-[44px] items-center gap-2 px-3.5 py-2 text-[13.5px] cursor-pointer '
                            + (on ? 'text-brand font-medium' : 'text-ink-2')
                            + ' hover:bg-surface-2 hover:text-ink">'
                            + '<i class="fas ' + (on ? 'fa-check-square text-brand' : 'fa-square text-ink-3') + ' w-3.5 shrink-0"></i>'
                            + '<span class="min-w-0 flex-1 truncate">' + escapeHtml(tag.name) + '</span>'
                            + '<span class="shrink-0 text-[12px] text-ink-3">' + tag.images_count + ' 张</span>'
                            + '</a>';
                    }
                }
                $list.html(html);
                $('#tag-filter-clear').toggleClass('hidden', selectedTagIds.length === 0);
                $('#tag-filter span').text(selectedTagIds.length ? `标签（${selectedTagIds.length}）` : '标签');
            };

            // 拉一次标签列表（页面加载时、以及增删标签之后）
            const loadTags = () => axios.get('{{ route('user.tags') }}').then(response => {
                if (! response.data.status) {
                    return;
                }
                allTags = response.data.data.tags || [];
                renderTagFilter();
                renderDetailTagOptions();
            });

            // 按当前选中的标签重拉图片墙（多标签 AND；没有选中就是不筛）
            const setTags = function () {
                // ⚠ 这里**必须每次都显式带 tags**（清空时给空数组）：utils.infiniteScroll 是把参数
                // $.extend 进它内部那份 data 的，只传 {page:1} 的话上一次的 tags 会残留下来 ——
                // 表现就是「点了清除筛选，结果还是被标签筛着」。空数组会被 axios 序列化成零个参数，
                // 所以清空时查询串里不会出现任何 tags（后端也就不用处理「空值」这种形状）。
                resetImages({page: 1, tags: selectedTagIds.slice()});
            };

            // 勾/取消一个标签
            const toggleTagFilter = function (id) {
                let index = selectedTagIds.indexOf(id);
                if (index === -1) {
                    selectedTagIds.push(id);
                } else {
                    selectedTagIds.splice(index, 1);
                }
                renderTagFilter();
                setTags();
            };

            $('#tag-filter-menu').off('click', '.tag-filter-item').on('click', '.tag-filter-item', function () {
                toggleTagFilter($(this).data('tag-id'));
            });

            $('#tag-filter-clear').off('click').on('click', function () {
                selectedTagIds = [];
                renderTagFilter();
                setTags();
            });

            /* ---------------- 标签管理（全站唯一的标签窗口） ----------------
             * 一个窗口管两件事：
             *   ① 给「选中的这几张图」打标：勾上 = 给它们加上该标签，取消勾选 = 从它们移除；
             *   ② 标签本身：新建 / 重命名 / 删除（行右侧两个常显的 44×44 按钮）。
             * 入口：桌面工具栏 / 手机 ⋯ 菜单（有选中图片时出现）、图片右键菜单、顶部标签下拉底部。
             * 没选中图片也能打开（此时只有第 ② 件事可做）。
             * 任何一处改动都会刷新三个消费方：筛选下拉、详情卡候选、图片墙（角标 + 筛选结果）。
             * ------------------------------------------------------------------ */

            /* 注：这里原有一个 refreshAfterTagChange()（改名/删除后 loadTags + setTags）。
             * setTags() 会通过 resetImages() 清空图片墙并 ds.clearSelection() —— 把用户正在打标的
             * 这批选中图片连同弹窗勾选态一起丢掉（老师报的「编辑/删除会整页刷新」就是这个）。
             * 已删除：改名/删除改成 patchCardsTag() 就地同步；只有「被删的标签正用作筛选项」
             * 那种结果集真的变了的情况，才单独调一次 setTags()。 */

            // 打开标签管理窗口。selIds 是当前选中的图片 id（可能为空）
            const openTagManager = (selIds) => {
                selIds = (selIds || []).map(String);   // 与 data-id / JSON 里的 id 统一成字符串比较

                // 选中的这些图片各自带了哪些标签：直接读卡片上的 data-json（列表接口已带 tags）
                // tagId -> 命中张数，用来区分「全有 / 只有部分有 / 都没有」
                const hitCount = {};
                $photos.find(IMAGES_ITEM).each(function () {
                    const json = $(this).data('json') || {};
                    if (selIds.indexOf(String(json.id)) === -1) {
                        return;
                    }
                    for (const tag of (json.tags || [])) {
                        hitCount[String(tag.id)] = (hitCount[String(tag.id)] || 0) + 1;
                    }
                });

                const hasSelection = selIds.length > 0;
                const allHave = (id) => hasSelection && hitCount[String(id)] === selIds.length;
                const someHave = (id) => (hitCount[String(id)] || 0) > 0;

                let addIds = [];      // 要加上去的标签
                let removeIds = [];   // 要从这些图片上移除的标签

                $('#image-tags-content').html(
                    $('#image-tags-tpl').html().replace(/__hint__/g, hasSelection
                        ? `已选择 ${selIds.length} 张图片`
                        : '未选择图片')
                );

                const $list = $('#image-tags-list');
                const $confirm = $('#image-tags-confirm');
                // 没选中图片时，「确定」没有可提交的内容 —— 直接不显示它
                $confirm.prop('disabled', true).toggle(hasSelection);
                // 有实际改动（要加或要移除至少一项）才让「确定」可点
                const refreshConfirm = () => $confirm.prop('disabled', addIds.length === 0 && removeIds.length === 0);

                // 勾选态 = 「确定后这些图片都会有这个标签」
                const isChecked = (id) => addIds.indexOf(String(id)) !== -1
                    || (removeIds.indexOf(String(id)) === -1 && allHave(id));

                // 每一行按状态上色/换图标；标签名一律转义后再进 innerHTML
                const renderRows = () => {
                    if (! allTags.length) {
                        // 空态跟菜单项一样厚（原来 py-4 比别的行高一倍，肉眼看整块偏下）
                        $list.html('<div class="w-full py-2 text-center text-[13px] leading-5 text-ink-3">暂无标签，可在下方新建</div>');
                        return;
                    }
                    let html = '';
                    for (const tag of allTags) {
                        let $row = $($('#image-tags-item-tpl').html()
                            .replace(/__id__/g, tag.id)
                            .replace(/__name__/g, escapeHtml(tag.name).replace(/\$/g, '$$$$'))
                            .replace(/__images_count__/g, tag.images_count)
                            .replace(/__json__/g, escapeHtml(JSON.stringify(tag)).replace(/\$/g, '$$$$')));

                        let id = String(tag.id);
                        let checked = isChecked(id);
                        let pendingAdd = addIds.indexOf(id) !== -1;
                        let pendingRemove = removeIds.indexOf(id) !== -1;
                        let partial = ! checked && ! pendingRemove && someHave(id) && ! allHave(id);

                        // 行内只留左边那个勾表达状态（老师要求：不要「已有 / 移除」这类字样，太误导）
                        let icon = 'fa-square text-ink-3';
                        if (checked) {
                            icon = 'fa-check-square text-brand';
                        } else if (pendingRemove) {
                            icon = 'fa-square text-danger';
                        } else if (partial) {
                            icon = 'fa-minus-square text-brand';
                        }
                        $row.find('.tag-state-icon').attr('class', 'tag-state-icon fas w-4 shrink-0 ' + icon);
                        if (pendingAdd) {
                            $row.addClass('border-brand bg-brand-soft');
                        } else if (pendingRemove) {
                            $row.addClass('border-danger');
                        }

                        html += $row.get(0).outerHTML;
                    }
                    $list.html(html);
                };

                // 勾选 / 取消勾选：两态语义（勾上=加上，取消=移除）；「部分有」点一下变全勾
                $list.off('click', '.image-tag-toggle').on('click', '.image-tag-toggle', function (e) {
                    e.preventDefault();
                    let id = String($(this).closest('.image-tag-row').data('id'));
                    let checked = isChecked(id);
                    addIds = addIds.filter(item => item !== id);
                    removeIds = removeIds.filter(item => item !== id);
                    if (! checked) {
                        addIds.push(id);                  // 变勾上 = 给这些图片加上
                    } else if (someHave(id)) {
                        removeIds.push(id);               // 变不勾 = 从这些图片移除（本来就没有的不必提交）
                    }
                    renderRows();
                    refreshConfirm();
                });

                // 新建标签：有选中图片时，建好就直接算「给这些图片加上」
                $('#image-tags-create').off('click').on('click', function () {
                    let $input = $('#image-tags-new');
                    let name = ($input.val() || '').trim();
                    if (! name) {
                        return $input.trigger('focus');
                    }
                    const attach = (id) => {
                        $input.val('');
                        if (hasSelection) {
                            id = String(id);
                            if (addIds.indexOf(id) === -1) {
                                addIds.push(id);
                            }
                            removeIds = removeIds.filter(item => item !== id);
                            renderRows();
                            refreshConfirm();
                        }
                    };
                    let exists = allTags.find(tag => tag.name === name);
                    if (exists) {
                        return attach(exists.id);         // 同名幂等：不重复建，直接勾上它
                    }
                    axios.post('{{ route('user.tag.create') }}', {name: name}).then(response => {
                        if (! response.data.status) {
                            return toastr.warning(response.data.message);
                        }
                        allTags.unshift({id: response.data.data.id, name: response.data.data.name, images_count: 0});
                        renderTagFilter();
                        renderDetailTagOptions();
                        renderRows();
                        toastr.success(response.data.message);
                        attach(response.data.data.id);
                    }).catch(error => toastr.warning(apiErrMsg(error, '创建标签失败')));
                });

                // 重命名：点行右侧「编辑」在那一行下方就地展开表单（再点一次收起）
                $list.off('click', '.update').on('click', '.update', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    let $row = $(this).closest('.image-tag-row');
                    let opened = $('#tag-edit').data('id');
                    $('#tag-edit').remove();
                    if (String(opened) !== String($row.data('id'))) {
                        let $edit = $($('#image-tags-edit-tpl').html().replace(/__id__/g, $row.data('id')));
                        $edit.data('id', $row.data('id'));
                        $edit.find('input[name=name]').val($row.find('.name').text());
                        $row.after($edit);
                        $edit.find('input[name=name]').trigger('focus').trigger('select');
                    }
                });

                $list.off('submit', '#tag-edit form').on('submit', '#tag-edit form', function (e) {
                    e.preventDefault();
                    let $form = $(this);
                    let $error = $('#tag-edit .error-message').html('').hide();
                    axios.put($form.attr('action'), $form.serialize()).then(response => {
                        if (! response.data.status) {
                            return $error.html('<i class="fas fa-exclamation-circle"></i> ' + response.data.message).show();
                        }
                        let $row = $form.closest('#tag-edit').prev('.image-tag-row');
                        let tagId = $row.data('id');
                        let newName = ($form.find('input[name=name]').val() || '').trim();
                        $('#tag-edit').remove();
                        toastr.success(response.data.message);
                        // 局部更新：重拉标签缓存（筛选下拉 / 详情卡候选 / 行内名字），
                        // 再就地改写卡片角标与 data-json —— 不重拉图片墙，选中不丢。
                        loadTags().then(() => {
                            patchCardsTag(tagId, newName);
                            renderRows();
                        });
                    }).catch(error => $error.html('<i class="fas fa-exclamation-circle"></i> '
                        + apiErrMsg(error, '修改失败')).show());
                });

                // 删除标签：二次确认（明确说明会从所有图片上移除，且不可恢复）
                $list.off('click', '.delete').on('click', '.delete', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    let tag = $(this).closest('.image-tag-row').data('json') || {};
                    Swal.fire({
                        // 与新弹窗（x-modal）一套：不动背景页面
                        heightAuto: false,
                        scrollbarPadding: false,
                        title: '确认删除该标签?',
                        html: '删除后将从所有图片上移除标签「' + escapeHtml(tag.name) + '」，且不可恢复。',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#3085d6',
                        cancelButtonColor: '#d33',
                        confirmButtonText: '确认',
                        cancelButtonText: '取消',
                    }).then(result => {
                        if (! result.isConfirmed) {
                            return;
                        }
                        axios.delete(TAG_DELETE_URL.replace('__ID__', tag.id)).then(response => {
                            if (! response.data.status) {
                                return toastr.warning(response.data.message);
                            }
                            // 这个标签要从所有本地状态里摘干净：筛选选中、待添加、待移除、行内编辑表单
                            // 它是不是正被用作筛选项 —— 决定要不要重拉图片墙（见下）
                            let wasFilter = selectedTagIds.some(id => String(id) === String(tag.id));
                            selectedTagIds = selectedTagIds.filter(id => String(id) !== String(tag.id));
                            addIds = addIds.filter(id => id !== String(tag.id));
                            removeIds = removeIds.filter(id => id !== String(tag.id));
                            $('#tag-edit').remove();
                            refreshConfirm();
                            toastr.success(response.data.message);
                            loadTags().then(() => {
                                patchCardsTag(tag.id, null);
                                renderRows();
                                // 只有它正被当筛选项时结果集才真的变了，那时才有必要重拉图片墙
                                if (wasFilter) {
                                    setTags();
                                }
                            });
                        }).catch(error => toastr.warning(apiErrMsg(error, '删除失败')));
                    });
                });

                $('#image-tags-cancel').off('click').on('click', _ => modal.close(TAGS_MODAL));

                $confirm.off('click').on('click', function () {
                    if (! addIds.length && ! removeIds.length) {
                        return false;
                    }

                    // 内部一律用字符串比较 id；提交给后端时转回数字（与原来的请求形状一致）
                    let payload = {ids: selIds.map(Number)};
                    if (addIds.length) {
                        payload.tags = addIds.map(Number);
                    }
                    if (removeIds.length) {
                        payload.remove_tags = removeIds.map(Number);
                    }

                    axios.put('{{ route('user.images.tags') }}', payload).then(response => {
                        if (! response.data.status) {
                            return toastr.warning(response.data.message);
                        }

                        modal.close(TAGS_MODAL);

                        // 就地同步这些图片的卡片角标（含刚新建的标签）
                        let nameOf = {};
                        for (const tag of allTags) {
                            nameOf[tag.id] = tag.name;
                        }
                        for (const id of selIds) {
                            let $item = $photos.find(`${IMAGES_ITEM}[data-id="${id}"]`);
                            let json = $item.data('json') || {};
                            let tags = (json.tags || []).filter(tag => removeIds.indexOf(String(tag.id)) === -1);
                            for (const addId of addIds) {
                                if (! tags.some(tag => String(tag.id) === addId)) {
                                    tags.push({id: Number(addId), name: nameOf[addId] || ''});
                                }
                            }
                            syncCardTags(json.id, tags);
                        }

                        toastr.success(response.data.message);
                        // 正在按标签筛选时结果集可能变了；标签张数也变了 —— 都重拉一次
                        if (selectedTagIds.length) {
                            setTags();
                        }
                        loadTags();
                    }).catch(error => toastr.warning(apiErrMsg(error, '设置失败')));
                });

                renderRows();
                refreshConfirm();
                modal.open(TAGS_MODAL);

                // 打开时静默对齐一次服务端（别的标签页刚改过也能看到最新的）
                loadTags().then(renderRows);
            };

            $('#search').keydown(function (e) {
                if (e.keyCode === 13) {
                    resetImages({page: 1, keyword: $(this).val()});
                }
            });

            $(document).keydown(e => {
                if (e.keyCode === 65 && (e.altKey || e.metaKey)) {
                    e.preventDefault();
                    ds.setSelection($(IMAGES_ITEM));
                }
            });
        </script>
        <script>
            /* ---- 页面缩放必须告诉 DragSelect（fork 修复，这是"框选判定整体偏右下"的真因）----
             * 页面 <html> 带着 common.less 的 zoom:1.1。DragSelect **自带**缩放支持（zoom 选项，
             * 内部 _zoom 就是为它准备的），但不传就会按"无缩放"算：
             *   实测它的「内部判定框」= 用户看到的那只框 × 1.1 + 偏移(-28, +55)，
             *   尺寸大 10%（411×312 → 452×343），位置偏差随滚动量增大 ——
             *   于是"框住上一行、下面一整行却被选中"、"误差随滚动变大"（老师报的正是这个）。
             * 之前 fork 里叠的那层手工补偿（把内联坐标除以 zoom 再写回去）是**第二个补偿**，
             * 与库自身的算法互相打架，已整体删除 —— 交给库自己算。
             * 倍数用「视觉尺寸 ÷ 布局尺寸」的比值求，不读 getComputedStyle(html).zoom：
             * 浏览器自身的页面缩放（Ctrl+±）也会折进那个值里，读数会偏大。 */
            const dsPageZoom = () => {
                const el = document.querySelector(IMAGES_SCROLL);
                if (! el) {
                    return 1;
                }
                const visual = el.getBoundingClientRect().width;
                const layout = el.offsetWidth;
                return (visual > 0 && layout > 0) ? visual / layout : 1;
            };

            const ds = new DragSelect({
                area: $(IMAGES_SCROLL).get(0),
                keyboardDrag: false,
                zoom: dsPageZoom(),
            });

            /* ---------------- 触摸端不让 DragSelect 取消默认行为（2026-10-08 老师拍板） ----------------
             * 为什么必须处理：库的 Interaction._start 第一句就是**无条件**的
             *     if (e.type === 'touchstart') e.preventDefault();
             * 而且它排在「能不能开始拖动」的判断**之前** ⇒ 图片区域内（#images-scroll 里）的触摸
             * 默认行为一律被否掉，Chromium 因此**不合成 mousedown/mouseup/click**。两个后果：
             *   ① 库的「点选」发生在 **mousedown**（Interaction:start → Selection 拿页面覆盖的
             *      Selector.rect 与卡片矩形相交 → SelectedSet.add）⇒ 手机端「点图片」不勾选，
             *      和桌面端不一致（老师报的正是这条）；
             *   ② Viewer 的 click 也收不到（安卓上「点图片打不开大图」的隐患）。
             * 做法：在 document 的**捕获阶段**（早于一切监听器）把落在区域内**那一发** touchstart 的
             * preventDefault 换成空函数 —— 事件照常往下传（卡片自己的长按菜单、页面其它触摸逻辑
             * 一个字都不动），但谁也别想取消这次触摸的默认行为。
             * ⚠ 别改成 stopPropagation 拦事件：那样卡片元素上的 touchstart 也收不到，长按菜单直接失灵
             *   （实测「长按不弹菜单、反而打开看图器」）。
             * 屏蔽之后，触摸走的是**与桌面完全相同**的一条路：浏览器正常合成 mousedown/mouseup/click
             * → 库的点选 + Viewer 打开 + 我们自己那套框选判定 ⇒ 两端行为一致。
             * 实测（真站点副本 + CDP 真触摸 + iPhone UA）：点图片 → 勾选 + 打开大图；点右上角小圆勾 →
             * 单选/多选（连点两张 = 2 张）；桌面鼠标逐项不变。
             * ----------------------------------------------------------------------------------------- */
            document.addEventListener('touchstart', (e) => {
                const t = e.target;
                if (! t || typeof t.closest !== 'function') {
                    return;
                }
                if (t.closest(IMAGES_SCROLL)) {
                    /* 把这一发事件上的 preventDefault 暂时换成空函数：事件照常往下传（卡片自己的
                     * 长按菜单、页面其它触摸逻辑一个字不动），但**谁也别想取消这次触摸的默认行为**
                     * ⇒ 浏览器正常合成 mousedown/mouseup/click。
                     * ⚠ 别改成 stopPropagation：那样卡片元素上的 touchstart 也收不到，长按菜单直接失灵
                     *   （实测「长按不弹菜单、反而打开看图器」）。 */
                    try { e.preventDefault = function () {}; } catch (err) { /* 覆盖失败就退回原行为 */ }
                }
            }, true);

            /* ---------------- 框选失效的真因与修法（fork 修复） ----------------
             * 现象：图片墙上按住左键拖动，怎么拖都框不出选择框（按在图片上、按在缝隙上都不行）。
             * 真因：DragSelect 会给区域套一层 .ds-selector-area 包装盒，并把这个盒子的矩形**缓存**下来
             *      （SelectorArea.rect，只在 reset 时失效）。构造 DragSelect 时图片还没渲染，量到的
             *      高度只有几十像素；图片墙长高后缓存没刷新，于是 mousedown 的位置被判成「在区域之外」
             *      （Interaction._canInteract 里 SelectorArea.isClicked 为 false），拖动直接不启动。
             *      实测：缓存 59px vs 实际 1697px。
             * 修法：图片墙每次排完版（justifiedGallery 触发 jg.complete / jg.resize）就调一次
             *      ds.Interaction.init()，让它重新测量 —— 实测恢复后按在图片上、按在缝隙上都能框选。
             * 注意：不能用 justifiedGallery('norewind') 之后立刻调用，那时排版还没跑完（norewind 本身
             *      是空操作），量到的还是旧高度，必须挂在 jg.complete / jg.resize 事件上。
             * ---------------------------------------------------------------- */
            $photos.on('jg.complete jg.resize', () => {
                try {
                    ds.Interaction.init();
                    // 顺手让库的缓存矩形失效（它就是当初"拖不动"的元凶：构造时图片没渲染，量到几十像素）
                    ds.Area && (ds.Area._rect = undefined);
                    ds.SelectorArea && (ds.SelectorArea._rect = undefined);
                } catch (e) {
                    console.warn('ds re-measure skipped:', e);
                }
            });

            /* ---- 自己记选择框：让"库的判定矩形"与"屏幕上那只框"都绑到原始指针坐标上 ----
             * 真因（实测，别再走回头路）：
             *  页面 = <html>{zoom:1.1} + 整页滚动。DragSelect 内部把**布局单位**的滚动量混进了
             *  **视觉**指针坐标里，算出的判定框 = 真实框 ×1.1 + 随滚动增大的偏移
             *  （滚动 670 时偏 (28,−55) 量级；误差 ≈ scroll×(1−1/zoom)，所以"不滚动就不偏"）。
             *  它的 zoom 选项只影响尺寸、不修指针坐标 —— 喂给它 zoom:1.1 也没用（实测照旧 ×1.1）。
             *  于是"框住上一行、下面一整行被选中"，而且框越大偏得越离谱。
             * 之前的错法：覆盖 Selector.rect 时读 .ds-selector 的实时矩形 —— 那正是库刚写进去的
             *  错误值，等于把错误读了两遍（验收因此假绿）。
             * 正解：clientX/clientY 与 getBoundingClientRect() 同属**视觉**坐标，这里按原始指针
             *  路径自己记框，然后 ① 覆盖 Selector.rect 给库判定用 ② 每帧把屏幕上的框也摆到同一处。
             * ------------------------------------------------------------------------ */
            /* ★ 库的硬门（源码 Interaction._canInteract）：
             *     !( e.button===2 || isInteracting
             *        || (e.target && !SelectorArea.isInside(e.target))
             *        || (!t && !SelectorArea.isClicked(e)) )
             *   ⇒ **指针位置必须落在 SelectorArea.rect 里**，按在卡片上还是缝隙上都不例外。
             *   而 SelectorArea.rect 的实现是
             *     get rect(){ return this._rect ? this._rect : this._rect = this.HTMLNode.getBoundingClientRect() }
             *   —— **算一次就永久缓存**。原来只在 jg.complete / jg.resize 清过，于是滚动、切侧栏、
             *   懒加载新图、窗口变化之后它全过期 ⇒ 症状就是"某些位置能拖、某些位置怎么拖都不出框"
             *   （老师实测：同一页里换个起点就成一个不成）。
             * 这里每帧/每次按下都把它刷成**当前真实矩形**，库那一刻读到的就是活值 —— 不再依赖
             * 猜"哪种操作会让它过期"。 */
            const dsSyncAreaRect = () => {
                try {
                    const area = document.querySelector(IMAGES_SCROLL);
                    if (! area) { return; }
                    const r = area.getBoundingClientRect();
                    ds.Area && (ds.Area._rect = undefined);
                    if (ds.SelectorArea) {
                        ds.SelectorArea._rect = {
                            left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                            width: r.width, height: r.height,
                        };
                    }
                } catch (err) { /* 库内部结构若变，最多回到旧行为，不影响拖动本身 */ }
            };

            const dsBox = {on: false, x0: 0, y0: 0, x1: 0, y1: 0, selfSelect: false};
            /* 最近一次触摸手势的时刻（2026-10-08）。判「这是不是触摸操作」不靠设备/UA：
             * 老师实测「手机端滑动页面还是会触发框选」——因为 utils.isMobile() 是
             * 「移动 UA **且 screen.width < 768**」，iPad 这类宽屏 iOS 设备上它直接返回 false，
             * 只按它判断的守卫等于没有。改成「本页最近发生过触摸」：与设备无关，
             * 桌面鼠标用户永远不会命中（他们根本不会有 touchstart）。 */
            const TOUCH_GRACE_MS = 1500;      // 覆盖 touchend 之后浏览器补发的那串合成 mouse 事件
            let lastTouchAt = 0;
            const touchJustNow = () => (Date.now() - lastTouchAt) < TOUCH_GRACE_MS;
            document.addEventListener('touchstart', () => { lastTouchAt = Date.now(); }, {capture: true, passive: true});
            document.addEventListener('touchmove', () => { lastTouchAt = Date.now(); }, {capture: true, passive: true});
            document.addEventListener('touchend', () => { lastTouchAt = Date.now(); }, {capture: true, passive: true});
            let dsRaf = 0;
            const dsBoxRect = () => {
                const l = Math.min(dsBox.x0, dsBox.x1), t = Math.min(dsBox.y0, dsBox.y1);
                const r = Math.max(dsBox.x0, dsBox.x1), b = Math.max(dsBox.y0, dsBox.y1);
                return {left: l, top: t, right: r, bottom: b, width: r - l, height: b - t};
            };
            const dsPaint = () => {
                if (! dsBox.on) {
                    dsRaf = 0;
                    return;
                }
                const z = dsPageZoom() || 1;
                const area = document.querySelector(IMAGES_SCROLL);
                const wrap = document.querySelector('.ds-selector-area');
                const box = document.querySelector('.ds-selector');
                const ar = area ? area.getBoundingClientRect() : null;
                if (wrap && ar) {
                    // 外壳：库也把它摆错（内联 281.59 渲染成 310）→ 按区域矩形重铺
                    wrap.style.left = (ar.left / z) + 'px';
                    wrap.style.top = (ar.top / z) + 'px';
                    wrap.style.width = (ar.width / z) + 'px';
                    wrap.style.height = (ar.height / z) + 'px';
                }
                if (box && ar && getComputedStyle(box).display !== 'none') {
                    const r = dsBoxRect();
                    dsSyncAreaRect();          // 拖的过程中布局也可能变（自动滚动/缩放），一并刷新
                    // 框是外壳的子元素 → 坐标必须相对区域原点，否则会再叠一层外壳的偏移（实测差 310px）
                    box.style.left = ((r.left - ar.left) / z) + 'px';
                    box.style.top = ((r.top - ar.top) / z) + 'px';
                    box.style.width = (r.width / z) + 'px';
                    box.style.height = (r.height / z) + 'px';
                }
                dsRaf = requestAnimationFrame(dsPaint);
            };
            // 必须用**捕获阶段**：DragSelect 在 mousedown 的冒泡阶段就做判定，
            // 注册在后的话它那一刻读到的是"还没开始的空框" → 单击卡片不会勾选（实测 0 张）。
            document.addEventListener('mousedown', e => {
                if (e.button !== 0 || ! e.target || ! e.target.closest) {
                    return;
                }
                /* 必须在这里就先刷：本监听器是捕获阶段，库的 mousedown 在冒泡阶段，
                 * 顺序上我们一定先跑，库判定时读到的才是刷新后的矩形。 */
                dsSyncAreaRect();
                const inArea = !! e.target.closest(IMAGES_SCROLL + ', ' + IMAGES_ITEM);
                /* 老师第六轮的期待：「从窗口最左边按下拖动也要能框选」。
                 * 侧栏是 fixed 元素、盖在网格左边（展开时 256px 宽），它上面的 mousedown 根本到不了
                 * DragSelect 的区域 ⇒ 库不会启动。所以这种"区域外起始"的拖动由我们接管：
                 * 只要按点落在**网格所在的水平范围与垂直范围**内（x ≤ 网格右缘、y ≥ 网格上缘），
                 * 就算框选开始；松手时由我们自己落选中（见下面的 mouseup）。
                 * 网格内部起始的拖动一行都不改，仍走库原来的路径。 */
                const area = document.querySelector(IMAGES_SCROLL);
                const ar = area ? area.getBoundingClientRect() : null;
                const outOfAreaOk = !! ar && e.clientX <= ar.right && e.clientY >= ar.top;
                if (! inArea && ! outOfAreaOk) {
                    return;
                }
                dsBox.on = true;
                dsBox.selfSelect = ! inArea;      // 区域外起始 ⇒ 选中由我们自己落
                dsBox.x0 = dsBox.x1 = e.clientX;
                dsBox.y0 = dsBox.y1 = e.clientY;
                if (! dsRaf) {
                    dsRaf = requestAnimationFrame(dsPaint);
                }
            }, true);
            document.addEventListener('mousemove', e => {
                if (! dsBox.on) {
                    return;
                }
                /* 手机端不跟手扩框（老师 2026-10-08 定：**框选只在电脑端生效**）——
                 * 手指在图片墙上滑动应当是滚页面，不该顺带把沿途的图都框上、和滚动手势打架。
                 * ★ 只让框「不再长大」，不取消 mousedown 那一发：库的**点选**正是靠按下时的
                 *   点状框与卡片相交来落选的（见上面 Selector.rect 的说明）⇒ 点图片/点圆勾照常。 */
                if (utils.isMobile() || touchJustNow()) {
                    return;
                }
                dsBox.x1 = e.clientX;
                dsBox.y1 = e.clientY;
            }, true);
            document.addEventListener('mouseup', () => {
                /* 区域外起始（侧栏上按下）的拖动：库完全没参与，选中由我们自己落。
                 * 只认"真的是拖动"（框任一边 > 4px）—— 侧栏上单击导航仍然是单击。
                 * 用库的对外 API 落选，这样 elementselect / elementunselect 事件照常发，
                 * 顶部的「已选择 N 张」操作栏也照常更新（bindOperates 再兜一次）。 */
                if (dsBox.on && dsBox.selfSelect && ! utils.isMobile() && ! touchJustNow()) {
                    const r = dsBoxRect();
                    if (r.width > 4 || r.height > 4) {
                        try {
                            const hit = [].slice.call(document.querySelectorAll(IMAGES_ITEM)).filter((el) => {
                                const b = el.getBoundingClientRect();
                                return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
                            });
                            if (hit.length) {
                                ds.clearSelection();
                                hit.forEach((el) => ds.addSelection(el));
                                bindOperates();
                            }
                        } catch (err) {
                            console.warn('outside-area select skipped:', err);
                        }
                    }
                }
                dsBox.on = false;
                dsBox.selfSelect = false;
            }, true);
            // 库判定用的矩形 = 原始指针坐标下的框（与卡片矩形同属视觉坐标，比较才成立）
            try {
                Object.defineProperty(ds.Selector, 'rect', {
                    configurable: true,
                    get() {
                        return dsBox.on ? dsBoxRect()
                                        : {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0};
                    },
                });
            } catch (e) {
                console.warn('ds selector rect override skipped:', e);
            }

            // 让图片不再被浏览器当成可拖拽元素：否则按在图片上拖动会起原生拖拽，
            // mousemove 被 drag 事件吃掉 —— 选择框不跟随、松手也不结束互动（实测「锁定不释放」）。
            // -webkit-user-drag 管 Chromium/Safari（见样式块），dragstart 拦一发兜住 Firefox。
            $photos.on('dragstart', e => {
                if ($(e.target).closest(IMAGES_ITEM).length) {
                    e.preventDefault();
                }
            });

            // 单击（没拖动）不改变勾选 —— 见上面 ②
            // 兜底：万一库没收到 mouseup（拖到窗口外等），松手也要解锁，别让界面卡在拖动状态
            document.addEventListener('mouseup', () => {
                if (ds.Interaction && ds.Interaction.isInteracting) {
                    ds.Interaction.reset({});
                }
            });


            /* ===================== 临时诊断打点（只在 ?dbg=1 时启用） =====================
             * 用途：定位「手机端滑动仍会触发框选」（2026-10-08 老师报，iOS/安卓都有）。
             * 只读：只挂监听 + fetch 打点，不改任何状态；不带 ?dbg=1 时整段不执行。
             * 数据落在容器访问日志里（fetch 到 /dbg-… 路径），我在远程 docker logs 里读。
             * 用完即删（连同 Dockerfile 的 md5 重钉）。 */
            (function () {
                if (! /[?&]dbg=1\b/.test(location.search)) { return; }
                const SID = 'dbg' + Date.now().toString(36);
                let seq = 0;
                let lastBox = '';
                let lastEvt = '';
                const send = (tag, detail) => {
                    if (seq > 500) { return; }
                    seq += 1;
                    const url = '/dbg-' + SID + '/' + seq + '/' + tag
                        + '-' + encodeURIComponent(String(detail));
                    try { fetch(url, {mode: 'no-cors', keepalive: true}); } catch (e) {}
                };
                const boxState = () => {
                    try {
                        const b = dsBoxRect();
                        return Math.round(b.width) + 'x' + Math.round(b.height);
                    } catch (e) { return 'na'; }
                };
                const selState = () => {
                    try { return ds.getSelection().length; } catch (e) { return 'na'; }
                };
                const touchAge = () => (Date.now() - lastTouchAt);

                ['touchstart', 'touchmove', 'touchend', 'touchcancel',
                    'mousedown', 'mousemove', 'mouseup', 'click'].forEach((type) => {
                    document.addEventListener(type, (e) => {
                        // move 类事件量大：每 3 条只留 1 条（够看出轨迹，又不刷爆日志）
                        if ((type === 'touchmove' || type === 'mousemove') && seq % 3 !== 0) { return; }
                        lastEvt = type;
                        const p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
                        send('e', type
                            + '|x' + Math.round(p.clientX || 0) + '|y' + Math.round(p.clientY || 0)
                            + '|pd' + (e.defaultPrevented ? 1 : 0)
                            + '|tgt' + String((e.target && (e.target.className || e.target.tagName)) || '?').slice(0, 20)
                            + '|box' + boxState() + '|sel' + selState()
                            + '|mob' + (utils.isMobile() ? 1 : 0)
                            + '|lt' + touchAge());
                    }, true);
                });
                // 框尺寸变化（100ms 采样，变了才发）
                setInterval(() => {
                    const b = boxState();
                    if (b !== lastBox) {
                        lastBox = b;
                        send('box', b + '|lastEvt' + lastEvt + '|sel' + selState() + '|lt' + touchAge());
                    }
                }, 100);
                // 选择变化
                ds.subscribe('elementselect', () => send('sel+', 'n' + selState() + '|lastEvt' + lastEvt + '|box' + boxState()));
                ds.subscribe('elementunselect', () => send('sel-', 'n' + selState() + '|lastEvt' + lastEvt + '|box' + boxState()));
                send('boot', 'sid' + SID + '|cards' + document.querySelectorAll('.images-item').length + '|mob' + (utils.isMobile() ? 1 : 0));
            })();

            const bindOperates = () => {
                let selected = ds.getSelection();
                if (selected.length) {
                    $headerTitle.text(`已选择 ${selected.length} 张图片`);
                } else {
                    $headerTitle.text('我的图片');
                }
                $('[data-operate]').hide();
                let operates = [];
                if (selected.length === 0) {
                    operates = ['refresh'];
                }
                if (selected.length === 1) {
                    operates = ['refresh', 'movements', 'tag', 'detail', 'rename', 'delete', 'deselect'];
                    // 「编辑图片」只在 jpg/jpeg/png 时给入口（其它格式一律不出现）
                    if (cropEditor.supported(selected[0])) {
                        operates.splice(operates.indexOf('rename'), 0, 'edit');
                    }
                }
                if (selected.length > 1) {
                    operates = ['refresh', 'movements', 'tag', 'delete', 'deselect'];
                }
                if (selected.length && selectedAlbum.id !== undefined) {
                    operates.push('remove');
                }
                $(operates.map(item => `[data-operate=${item}]`).toString()).css('display', 'block');
            };

            ds.subscribe('predragstart', ({ event }) => {
                /* 【2026-10-08】这里原来有一句 `if (utils.isMobile()) ds.stop();`（手机端不拖框），
                 * 它把库的整个交互停掉 ⇒ 手机端「点图片」只剩打开大图、不勾选，与桌面端不一致
                 *（这正是老师报的那条的直接原因）。现在触摸端由上面那段「不让库取消默认行为」
                 * 统一成与桌面相同的路径，这句已删。 */

                // 能起拖动的目标：网格/空白（带 dragselect 类）、卡片 <a> 本身、卡片里的 <img>。
                // 别的（右上角小圆勾等控件）一律 break()，保持它们原来的点选行为 ——
                // 不这么做的话，点小圆勾会被 DragSelect 当成一次拉框，顺带把旁边那张也选上。
                // 注：实测不能退回上游「不是 .dragselect 就 break()」的判据 —— 卡片带 10px 内边距，
                //     卡片之间的缝隙其实落在卡片自己的盒子里，按下去的目标是卡片而不是空白网格，
                //     一 break 就连「从缝隙起手」也框不出来了（实测 0 张）。
                let $target = $(event.target);
                let onCardSurface = $target.is(IMAGES_ITEM)
                    || ($target.is('img') && $target.closest(IMAGES_ITEM).length > 0);
                if (! $target.hasClass('dragselect') && ! onCardSurface) {
                    ds.break();
                }
            });
            ds.subscribe('elementselect', _ => bindOperates());
            ds.subscribe('elementunselect', _ => bindOperates());

            // 侧栏折叠/展开会改变图片墙的可用宽度：justifiedGallery 是按容器宽度算布局的，
            // 不重排就会挤成一团或留一大块空白。等 300ms 的宽度动画结束再重排，期间不动它，
            // 免得按"动画中间"的宽度算。viewer（看图器）与框选目标也要跟着更新。
            window.addEventListener('lsky:sidebar-toggled', () => {
                setTimeout(() => {
                    if (! $photos.find(IMAGES_ITEM).length) {
                        return; // 没数据时 justifiedGallery 是销毁状态，重排会报错
                    }

                    try {
                        $photos.justifiedGallery('norewind');
                        viewer.update();
                        ds.setSelectables($photos.find(IMAGES_ITEM));
                    } catch (e) {
                        // 重排失败也不影响页面：下次翻页/切相册会重新走一遍布局
                        console.warn('sidebar re-layout skipped:', e);
                    }
                }, 320);
            });

            $photos.on('click', '.image-selector', function () {
                ds.toggleSelection($(this).closest('a'));
                bindOperates();
            })

            /* ---------------- 卡片角标开关（显示图片标签） ---------------- */

            // 默认显示。关掉后给网格加一个类（.image-tags-off），角标整体不渲染显示 ——
            // 角标是每次翻页重新生成的，所以用容器上的类控制，不去改每张卡片的 DOM。
            const applyTagBadgeVisibility = (show) => {
                $photos.toggleClass('image-tags-off', ! show);
                $('#tag-badge-switch')
                    .toggleClass('bg-brand', show)
                    .toggleClass('bg-line', ! show)
                    .attr('aria-checked', show ? 'true' : 'false');
                $('#tag-badge-switch .tag-badge-knob')
                    .toggleClass('translate-x-[12px]', show);      // 开：滑块滑到右边（28 - 12 - 2*2 = 12）
            };
            let showImageTags = localStorage.getItem(TAG_BADGE_KEY) !== '0';
            applyTagBadgeVisibility(showImageTags);

            $('#tag-badge-toggle').off('click').on('click', function () {
                showImageTags = ! showImageTags;
                localStorage.setItem(TAG_BADGE_KEY, showImageTags ? '1' : '0');
                applyTagBadgeVisibility(showImageTags);
            });
        </script>
        <script>
            context.init({
                fadeSpeed: 100,
                filter: function ($obj) {},
                above: 'auto',
                preventDoubleContext: true,
                compress: false
            });

            new ClipboardJS('.dropdown-menu li a.copy', {
                text: function(trigger) {
                    return $(trigger).data('copy-value');
                }
            }).on('success', _ => {
                toastr.success('复制成功');
            }).on('error', _ => {
                toastr.warning('复制失败')
            });

            /* ---------------- 标签（fork 新增） ----------------
             * 详情卡里的标签：本地态 detailImageTags 保存当前这张图的标签，
             * 增/删成功后立刻回写弹窗与图片墙上的卡片角标，并顺手刷新标签使用数量。
             * -------------------------------------------------- */
            let detailImageId = null;
            let detailImageTags = [];

            // 把当前图片的标签画成一排 chip（每个 chip 带一个「移除」小按钮）
            const renderDetailTags = () => {
                let $box = $('#detail-tags');
                if (! $box.length) {
                    return;
                }
                if (! detailImageTags.length) {
                    $box.html('<span class="text-[13px] text-ink-3">暂无标签</span>');
                    return;
                }
                let html = '';
                for (const tag of detailImageTags) {
                    html += '<span class="ls-badge gap-1 bg-brand-soft text-brand">' + escapeHtml(tag.name)
                        + '<button type="button" class="detail-tag-remove -mr-0.5 leading-none text-ink-3 hover:text-danger"'
                        + ' data-tag-id="' + tag.id + '" aria-label="移除标签">&times;</button></span>';
                }
                $box.html(html);
            };

            // 详情卡输入框的候选 = 已有标签（datalist），输入框里没见过的名字回车即现场新建
            const renderDetailTagOptions = () => {
                let $options = $('#detail-tag-options');
                if (! $options.length) {
                    return;
                }
                $options.html(allTags.map(tag => `<option value="${escapeHtml(tag.name)}"></option>`).join(''));
            };

            /* 标签「改名 / 删除」后就地同步所有卡片与详情卡 —— **绝不重拉图片墙**。
             * 重拉（setTags → resetImages）会清空图片墙并 ds.clearSelection()，把用户正在打标的
             * 这批选中图片丢掉，弹窗里的勾选态也随之失真（老师报过的「编辑/删除会整页刷新」）。
             * newName 传 null 表示这个标签已被删除。 */
            const patchCardsTag = (tagId, newName) => {
                tagId = String(tagId);
                $photos.find(IMAGES_ITEM).each(function () {
                    let $item = $(this);
                    let json = $item.data('json');
                    if (! json || ! (json.tags || []).some(t => String(t.id) === tagId)) {
                        return;
                    }
                    let next = (json.tags || [])
                        .filter(t => newName !== null || String(t.id) !== tagId)
                        .map(t => String(t.id) === tagId ? {id: t.id, name: newName} : {id: t.id, name: t.name});
                    syncCardTags(json.id, next);
                });
                // 详情卡正开着这张图时，它的 chip 也要跟着换
                if (detailImageTags.some(t => String(t.id) === tagId)) {
                    detailImageTags = newName === null
                        ? detailImageTags.filter(t => String(t.id) !== tagId)
                        : detailImageTags.map(t => String(t.id) === tagId ? {id: t.id, name: newName} : t);
                    renderDetailTags();
                }
            };

            // 同步图片墙上某张图的卡片角标（连同它的 data-json，右键菜单/详情读的是这份）
            const syncCardTags = (imageId, tags) => {
                let $item = $photos.find(`${IMAGES_ITEM}[data-id="${imageId}"]`);
                if (! $item.length) {
                    return;
                }
                let json = $item.data('json');
                if (json) {
                    json.tags = tags.map(tag => ({id: tag.id, name: tag.name}));
                    // 属性值同样要转义（浏览器解码后仍是合法 JSON，jQuery 读到的内容不变）
                    $item.data('json', json).attr('data-json', escapeHtml(JSON.stringify(json)));
                }
                $item.find('.image-tags').html(cardTagsHtml(tags));
            };

            // 单图打标/移除（详情卡用）：成功后就地更新本地态 + 卡片角标
            const submitImageTags = (imageId, addIds, removeIds) => {
                let payload = {ids: [imageId]};
                if (addIds.length) {
                    payload.tags = addIds;
                }
                if (removeIds.length) {
                    payload.remove_tags = removeIds;
                }
                return axios.put('{{ route('user.images.tags') }}', payload).then(response => {
                    if (! response.data.status) {
                        throw new Error(response.data.message);
                    }

                    let nameOf = {};
                    for (const tag of allTags) {
                        nameOf[tag.id] = tag.name;
                    }
                    for (const id of addIds) {
                        if (! detailImageTags.some(tag => tag.id === id)) {
                            detailImageTags.push({id: id, name: nameOf[id] || ''});
                        }
                    }
                    detailImageTags = detailImageTags.filter(tag => removeIds.indexOf(tag.id) === -1);

                    renderDetailTags();
                    syncCardTags(imageId, detailImageTags);
                    loadTags();     // 使用数量变了，顺手刷新（顶部筛选与候选同步更新）
                    toastr.success(response.data.message);
                }).catch(error => toastr.warning(apiErrMsg(error, '设置失败')));
            };

            // 详情卡里「添加」：已有同名标签就直接挂上，没有就先 POST 新建
            const addDetailTagFromInput = () => {
                let $input = $('#detail-tag-input');
                let name = ($input.val() || '').trim();
                if (! name || detailImageId === null) {
                    return;
                }

                let exists = allTags.find(tag => tag.name === name);
                let pending = exists ? Promise.resolve(exists.id) : axios.post('{{ route('user.tag.create') }}', {name: name})
                    .then(response => {
                        if (! response.data.status) {
                            throw new Error(response.data.message);
                        }
                        allTags.unshift({id: response.data.data.id, name: response.data.data.name, images_count: 0});
                        renderTagFilter();
                        renderDetailTagOptions();
                        return response.data.data.id;
                    });

                pending.then(tagId => {
                    $input.val('');
                    if (detailImageTags.some(tag => tag.id === tagId)) {
                        return;
                    }
                    return submitImageTags(detailImageId, [tagId], []);
                }).catch(error => toastr.warning(apiErrMsg(error, '添加失败')));
            };

            // 详情弹窗里的标签按钮/回车（委托绑在常驻容器上，弹窗内容每次重渲染都不用重绑）
            $('#image-detail-content')
                .off('click', '.detail-tag-remove').on('click', '.detail-tag-remove', function () {
                    submitImageTags(detailImageId, [], [$(this).data('tag-id')]);
                })
                .off('click', '#detail-tag-add').on('click', '#detail-tag-add', _ => addDetailTagFromInput())
                .off('keydown', '#detail-tag-input').on('keydown', '#detail-tag-input', function (e) {
                    if (e.key === 'Enter' || e.keyCode === 13) {
                        e.preventDefault();
                        addDetailTagFromInput();
                    }
                });

            const methods = {
                edit(item) {
                    // 编辑图片（裁剪）—— 三个入口最终都走 cropEditor
                    cropEditor.open(item);
                },
                movements() {
                    // 「移动到相册」走居中卡片弹窗（相册列表也在 #album-switch-modal 里，
                    // 页面里已经没有右侧抽屉了）。
                    // 相册列表仍走同一个 user.albums 接口 + 同一个 utils.infiniteScroll；
                    // 弹窗内是单选列表（当前所在相册带「当前」标记），底部「移动」「取消」。
                    let selected = ds.getSelection().map(item => $(item).data('id'));
                    if (! selected.length) {
                        return false;
                    }

                    $('#image-movements-content').html(
                        $('#movements-container-tpl').html().replace(/__count__/g, selected.length)
                    );

                    const $movementsAlbums = $('#movements-albums');
                    const $movementsConfirm = $('#movements-confirm');
                    let targetId = null; // 本次要移动到的相册（单选）

                    // 单选：点一行只选中并高亮，不发请求；底部「移动」才提交
                    const selectRow = ($row) => {
                        targetId = $row.length ? $row.data('id') : null;
                        $movementsAlbums.find('.movements-album').each(function () {
                            let on = targetId !== null && $(this).data('id') === targetId;
                            $(this)
                                .toggleClass('border-brand bg-brand-soft text-brand', on)
                                .toggleClass('border-line bg-surface-2 text-ink', ! on)
                                .attr('data-selected', on ? 'true' : 'false')
                                .find('.selected-mark').toggleClass('opacity-0', ! on);
                        });
                        $movementsConfirm.prop('disabled', targetId === null);
                    };

                    utils.infiniteScroll('#movements-albums', {
                        url: '{{ route('user.albums') }}',
                        success: function (response) {
                            if (! response.status) {
                                return toastr.error(response.message);
                            }

                            let albums = response.data.albums.data;
                            if (albums.length <= 0 || response.data.albums.current_page === response.data.albums.last_page) {
                                this.finished = true;
                            }

                            let html = '';
                            for (const i in albums) {
                                html += $('#movements-album-item-tpl').html()
                                    .replace(/__id__/g, albums[i].id)
                                    .replace(/__name__/g, albums[i].name)
                                    .replace(/__image_num__/g, albums[i].image_num)
                                    // 当前所在相册标出来
                                    .replace(/__current_badge__/g, albums[i].id === selectedAlbum.id
                                        ? '<div class="ls-badge shrink-0 bg-brand-soft text-brand">当前</div>'
                                        : '')
                            }

                            $movementsAlbums.append(html);
                        }
                    });

                    $movementsAlbums.off('click', '.movements-album').on('click', '.movements-album', function () {
                        selectRow($(this));
                    });

                    $('#movements-cancel').off('click').on('click', _ => modal.close(MOVEMENTS_MODAL));

                    // 移动请求沿用原实现（同一个 route、同一份 payload），
                    // 唯一区别：原来「点哪行就移动哪行」，现在是「选中后点移动」
                    $movementsConfirm.off('click').on('click', function () {
                        if (targetId === null) {
                            return false;
                        }

                        axios.put('{{ route('user.images.movement') }}', {
                            selected: selected,
                            id: targetId,
                            album_id: selectedAlbum.id || 0,
                        }).then(response => {
                            if (response.data.status) {
                                modal.close(MOVEMENTS_MODAL);
                                resetImages();
                                toastr.success(response.data.message);
                            } else {
                                toastr.warning(response.data.message);
                            }
                        })
                    });

                    modal.open(MOVEMENTS_MODAL);
                },
                remove() {
                    let selected = ds.getSelection().map(item => $(item).data('id'));
                    $headerTitle.text(`移出 ${selected.length} 张图片`)
                    axios.put('{{ route('user.images.movement') }}', {
                        selected: selected,
                        album_id: selectedAlbum.id || null, // 原相册ID
                        id: null,
                    }).then(response => {
                        if (response.data.status) {
                            // 旧实现顺手把右侧抽屉收掉；语义照旧 —— 相册面板这时是脏的（图片数变了），
                            // 收起来（弹窗开着时点不到工具栏上的操作，这里是防御性关闭）
                            closeAlbums();
                            resetImages();
                            toastr.success(response.data.message);
                        } else {
                            toastr.warning(response.data.message);
                        }
                    });
                },
                tag() {
                    // 工具栏 / 手机 ⋯ 菜单 / 图片右键菜单的「标签管理」：带上当前选中的图片打开这个窗口。
                    // 窗口本身也能做标签的新建 / 重命名 / 删除（与下拉里那个入口是同一个窗口、同一份代码）。
                    let selected = ds.getSelection().map(item => $(item).data('id'));
                    openTagManager(selected);
                },
                rename(e) {
                    let item = $(e).data('json');
                    Swal.fire({
                        // 与新弹窗（x-modal）一套：不动背景页面（heightAuto 去 swal2-height-auto，
                        // scrollbarPadding 去 body 的 padding-right 注入 —— 否则整页会有细微位移）
                        heightAuto: false,
                        scrollbarPadding: false,
                        title: '请输入图片名称',
                        input: 'text',
                        inputValue: item.filename,
                        inputAttributes: {
                            autocapitalize: 'off'
                        },
                        showCancelButton: true,
                        confirmButtonText: '确认',
                        showLoaderOnConfirm: true,
                        preConfirm: (value) => {
                            return axios.put('{{ route('user.images.rename') }}', {
                                id: item.id,
                                name: value,
                            }).then(response => {
                                if (! response.data.status) {
                                    throw new Error(response.data.message)
                                }
                                return response.data;
                            }).catch(error => Swal.showValidationMessage('服务异常，请稍后重试。'));
                        },
                        allowOutsideClick: () => !Swal.isLoading()
                    }).then((result) => {
                        if (result.isConfirmed) {
                            if (result.value.status) {
                                $(e).find('p.filename').attr('title', result.value.data.filename).text(result.value.data.filename)
                                item.filename = result.value.data.filename;
                                $(e).data('json', item);
                                toastr.success(result.value.message);
                            } else {
                                toastr.error(result.value.message);
                            }
                        }
                    })
                },
                delete() {
                    Swal.fire({
                        // 与新弹窗（x-modal）一套：不动背景页面（heightAuto 去 swal2-height-auto，
                        // scrollbarPadding 去 body 的 padding-right 注入 —— 否则整页会有细微位移）
                        heightAuto: false,
                        scrollbarPadding: false,
                        title: '确认要删除选中的图片？',
                        text: "删除后不可恢复，记录和文件同时删除",
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: '确认删除',
                        cancelButtonText: '取消',
                    }).then((result) => {
                        if (result.isConfirmed) {
                            let selected = ds.getSelection().map(item => $(item).data('id'));
                            axios.delete('{{ route('user.images.delete') }}', {
                                data: selected,
                            }).then(response => {
                                if (response.data.status) {
                                    // ★ 删除后必须把卡片**也从 DragSelect 里摘干净**（2026-10-04 修）：
                                    //   只做 $(item).remove() 的话，库的 SelectedSet / SelectableSet 里会留下
                                    //   「已不在 DOM 的幽灵卡片」—— DS 的 getSelection() 实现就是
                                    //   `return SelectedSet.elements`，它从不检查元素是否还在文档里（全库没有一处
                                    //   isConnected 判断）。于是之后任何一次 elementselect / elementunselect 触发的
                                    //   bindOperates() 都会把幽灵算进去：顶部又显示「已选择 N 张图片」、操作栏不收回、
                                    //   再选一张时计数虚高（实测：屏幕上 1 张却显示「已选择 2 张图片」）。
                                    let selected = ds.getSelection();
                                    let size = 0;
                                    selected.forEach(item => {
                                        size += $(item).data('json').size;
                                        $(item).remove();
                                    });
                                    ds.removeSelectables(selected);   // 从「可选集合」摘掉（第二个参数默认 false，不动选中集合）
                                    ds.removeSelection(selected);     // 从「选中集合」摘掉（发 Selected:removed → elementunselect → 自动重画顶部）
                                    bindOperates();                   // 兜底：标题与操作栏统一回到「未选中」形态
                                    utils.setCapacityProgress(-size);
                                    $photos.justifiedGallery(gridConfigs).removeClass('reset');
                                    toastr.success(response.data.message);
                                } else {
                                    toastr.warning(response.data.message);
                                }
                            });
                        }
                    });
                },
                detail(e) {
                    let item = $(e).data('json');
                    axios.get(`/user/images/${item.id}`).then(response => {
                        if (response.data.status) {
                            let image = response.data.data.image;
                            // 这张图的标签（详情卡里可以现场增删）
                            detailImageId = image.id;
                            detailImageTags = (image.tags || []).map(tag => ({id: tag.id, name: tag.name}));
                            let content = $('#image-detail-tpl').html()
                                .replace(/__thumb_url__/g, image.thumb_url)
                                .replace(/__album_name__/g, image.album ? image.album.name : '-')
                                .replace(/__strategy_name__/g, image.strategy ? image.strategy.name : '-')
                                .replace(/__filename__/g, image.filename.replace(/\$/g, '$$$$'))
                                .replace(/__origin_name__/g, image.origin_name.replace(/\$/g, '$$$$'))
                                .replace(/__size__/g, utils.formatSize(image.size * 1024))
                                .replace(/__mimetype__/g, image.mimetype)
                                .replace(/__width__/g, image.width)
                                .replace(/__height__/g, image.height)
                                .replace(/__md5__/g, image.md5)
                                .replace(/__sha1__/g, image.sha1)
                                .replace(/__uploaded_ip__/g, image.uploaded_ip)
                                .replace(/__created_at__/g, image.created_at)
                            // 「详细信息」改成居中卡片弹窗（原来画进右侧抽屉）
                            $('#image-detail-content').html(content);
                            renderDetailTags();
                            renderDetailTagOptions();
                            modal.open(DETAIL_MODAL);
                        } else {
                            toastr.error(response.data.message);
                        }
                    })
                }
            };
            // right click actions
            const actions = {
                copy: {
                    text: '复制图片',
                    action: e => {
                        let src = $(e).find('img').attr('src');
                        CopyImageClipboard.copyImageToClipboard(src).then(() => {
                            toastr.success('复制成功')
                        }).catch(e => {
                            toastr.warning('复制失败, ' + e.message)
                        });
                    },
                    visible: () => ds.getSelection().length === 1,
                },
                refresh: {text: '刷新', action: _ => resetImages()},
                edit: {
                    text: '编辑图片',
                    visible: () => ds.getSelection().length === 1 && cropEditor.supported(ds.getSelection()[0]),
                    action: e => methods.edit(e),
                },
                rename: {
                    text: '重命名',
                    visible: () => ds.getSelection().length === 1,
                    action: e => methods.rename(e),
                },
                open: {
                    text: '新窗口打开',
                    action: e => window.open($(e).data('json').url),
                    visible: () => ds.getSelection().length === 1,
                },
                copies: {
                    text: '复制链接',
                    subMenu: [
                        {
                            text: 'Url',
                            classes: ['copy'],
                            attributes: {"data-link-type": "url"},
                        },
                        {
                            text: 'Html',
                            classes: ['copy'],
                            attributes: {"data-link-type": "html"},
                        },
                        {
                            text: 'BBCode',
                            classes: ['copy'],
                            attributes: {"data-link-type": "bbcode"},
                        },
                        {
                            text: 'Markdown',
                            classes: ['copy'],
                            attributes: {"data-link-type": "markdown"},
                        },
                        {
                            text: 'Markdown with link',
                            classes: ['copy'],
                            attributes: {"data-link-type": "markdown_with_link"},
                        },
                        {
                            text: 'Thumbnail url',
                            classes: ['copy'],
                            attributes: {"data-link-type": "thumbnail_url"},
                        },
                    ],
                    visible: () => ds.getSelection().length === 1,
                },
                movements: {
                    text: '移动到相册',
                    action: _ => methods.movements(),
                },
                remove: {
                    text: '移出当前相册',
                    action: _ => methods.remove(),
                    visible: _ => selectedAlbum.id !== undefined,
                },
                detail: {
                    text: '详细信息',
                    visible: () => ds.getSelection().length === 1,
                    action: e => methods.detail(e)
                },
                delete: {
                    text: '删除',
                    action: _ => methods.delete(),
                },
                tag: {
                    text: '标签管理',
                    action: _ => methods.tag(),
                },
            };
            // right click 'images scroll' container
            context.attach(IMAGES_SCROLL, {
                data: [actions.refresh],
                beforeOpen: () => ds.clearSelection(),
            });
            // right click image
            context.attach(IMAGES_ITEM, {
                data: [
                    {header: '图片操作'},
                    actions.refresh,
                    actions.copy,
                    actions.copies,
                    actions.open,
                    actions.movements,
                    actions.remove,
                    actions.tag,
                    actions.detail,
                    {divider: true},
                    actions.edit,
                    actions.rename,
                    actions.delete,
                ],
                beforeOpen: function (item) {
                    // 选中当前项目
                    if (ds.getSelection().length <= 1) ds.clearSelection();
                    ds.addSelection($(item));
                },
                afterOpen: function (item, dropdown) {
                    let data = $(item).data('json');
                    // 追加链接
                    $(dropdown).find('a.copy').each(function () {
                        $(this).data('copy-value', data.links[$(this).data('link-type')])
                    });
                }
            });
            // the operates functions
            $('[data-operate]').click(function () {
                let operate = $(this).data('operate');
                let selected = ds.getSelection();

                if (selected.length === 0) {
                    return false;
                }

                switch (operate) {
                    case 'refresh': // 刷新
                        resetImages();
                        break;
                    case 'movements': // 移动到相册
                        methods.movements();
                        break;
                    case 'remove': // 移出当前相册
                        methods.remove();
                        break;
                    case 'rename': // 重命名
                        methods.rename(selected[0]);
                        break;
                    case 'tag': // 标签管理（可增可减，支持现场新建；标签本身也能在这里改名/删除）
                        methods.tag();
                        break;
                    case 'detail':
                        methods.detail(selected[0]);
                        break;
                    case 'edit': // 编辑图片（裁剪）
                        methods.edit(selected[0]);
                        break;
                    case 'delete': // 删除
                        methods.delete();
                        break;
                    case 'deselect': // 取消选择（清空当前选中的图片）
                        ds.clearSelection();
                        bindOperates();
                        break;
                }
            });

            // 标签列表最后拉：此时 renderDetailTagOptions / renderTagFilter 都已定义（避免 TDZ）
            loadTags();
        </script>
    @endpush
</x-app-layout>
