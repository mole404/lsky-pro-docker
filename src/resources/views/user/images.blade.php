@section('title', '我的图片')

@push('styles')
    <link rel="stylesheet" href="{{ asset('css/justified-gallery/justifiedGallery.min.css') }}">
    <link rel="stylesheet" href="{{ asset('css/viewer-js/viewer.min.css') }}">
    <link rel="stylesheet" href="{{ asset('css/context-js/context-js.css') }}">
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
    </style>
@endpush

<x-app-layout>
    {{-- 整页滚动后工具栏要吸在固定顶栏下面（top-14 = 56px），否则一滚就没了 --}}
    <div class="sticky top-14 flex justify-between items-center px-2 py-2 z-[3] left-0 right-0 bg-surface border-solid border-b">
        <div class="space-x-2 flex justify-between items-center">
            <a class="text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:getAlbums()"><i class="fas fa-bars text-brand"></i> 相册</a>
            <div class="flex-row hidden lg:flex">
                <a data-operate="movements" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">移动到相册</a>
                <a data-operate="remove" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">移出当前相册</a>
                <a data-operate="tag" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">标签管理</a>
                <a data-operate="detail" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">详细信息</a>
                <a data-operate="rename" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">重命名</a>
                <a data-operate="delete" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">删除</a>
                <a data-operate="deselect" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">取消选择</a>
            </div>
            <div class="block lg:hidden">
                <x-dropdown direction="right">
                    <x-slot name="trigger">
                        <a class="text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)"><i class="fas fa-ellipsis-h text-brand"></i></a>
                    </x-slot>

                    <x-slot name="content">
                        <x-dropdown-link data-operate="refresh" href="javascript:void(0)" @click="open = false">刷新</x-dropdown-link>
                        <x-dropdown-link data-operate="movements" class="hidden" href="javascript:void(0)" @click="open = false">移动到相册</x-dropdown-link>
                        <x-dropdown-link data-operate="remove" class="hidden" href="javascript:void(0)" @click="open = false">移出当前相册</x-dropdown-link>
                        <x-dropdown-link data-operate="tag" class="hidden" href="javascript:void(0)" @click="open = false">标签管理</x-dropdown-link>
                        <x-dropdown-link data-operate="detail" class="hidden" href="javascript:void(0)" @click="open = false">详细信息</x-dropdown-link>
                        <x-dropdown-link data-operate="rename" class="hidden" href="javascript:void(0)" @click="open = false">重命名</x-dropdown-link>
                        <x-dropdown-link data-operate="delete" class="hidden" href="javascript:void(0)" @click="open = false">删除</x-dropdown-link>
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
        <div class="albums-row flex items-stretch min-h-[44px] w-full rounded-lg border border-line bg-surface" data-id="__id__" data-json='__json__'>
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
            #images-grid .images-item,
            #images-grid .images-item img {
                -webkit-user-drag: none;
            }
        </style>
    @endpush

    @push('scripts')
        <script src="{{ asset('js/justified-gallery/jquery.justifiedGallery.min.js') }}"></script>
        <script src="{{ asset('js/viewer-js/viewer.min.js') }}"></script>
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
            const IMAGES_GRID = '#images-grid';
            const IMAGES_ITEM = '.images-item';
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
            const viewer = new Viewer(document.getElementById('images-grid'), {url: 'data-original'});

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

            const resetImages = (params) => {
                $photos.addClass('reset').html('').justifiedGallery('destroy');
                ds.clearSelection();
                params = $.extend({page: 1}, params)
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
            const dsBox = {on: false, x0: 0, y0: 0, x1: 0, y1: 0};
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
                if (! e.target.closest(IMAGES_SCROLL + ', ' + IMAGES_ITEM)) {
                    return;
                }
                dsBox.on = true;
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
                dsBox.x1 = e.clientX;
                dsBox.y1 = e.clientY;
            }, true);
            document.addEventListener('mouseup', () => {
                dsBox.on = false;
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
                if (utils.isMobile()) {
                    ds.stop();
                }

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
                                    let size = 0;
                                    ds.getSelection().map(item => {
                                        size += $(item).data('json').size;
                                        $(item).remove();
                                    });
                                    utils.setCapacityProgress(-size);
                                    $headerTitle.text('我的图片');
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
