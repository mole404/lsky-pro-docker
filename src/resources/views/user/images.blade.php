@section('title', '我的图片')

@push('styles')
    <link rel="stylesheet" href="{{ asset('css/justified-gallery/justifiedGallery.min.css') }}">
    <link rel="stylesheet" href="{{ asset('css/viewer-js/viewer.min.css') }}">
    <link rel="stylesheet" href="{{ asset('css/context-js/context-js.css') }}">
@endpush

<x-app-layout>
    {{-- 整页滚动后工具栏要吸在固定顶栏下面（top-14 = 56px），否则一滚就没了 --}}
    <div class="sticky top-14 flex justify-between items-center px-2 py-2 z-[3] left-0 right-0 bg-surface border-solid border-b">
        <div class="space-x-2 flex justify-between items-center">
            <a class="text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:getAlbums()"><i class="fas fa-bars text-brand"></i> 相册</a>
            <div class="flex-row hidden lg:flex">
                <a data-operate="movements" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">移动到相册</a>
                <a data-operate="remove" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">移出当前相册</a>
                <a data-operate="permission" class="hidden text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">设置权限</a>
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
                        <x-dropdown-link data-operate="permission" class="hidden" href="javascript:void(0)" @click="open = false">设置权限</x-dropdown-link>
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
            <x-dropdown direction="left">
                <x-slot name="trigger">
                    <a id="permission" class="text-sm py-2 px-3 hover:bg-surface-3 rounded text-ink" href="javascript:void(0)">
                        <span>全部</span>
                        <i class="fas fa-eye text-brand"></i>
                    </a>
                </x-slot>

                <x-slot name="content">
                    <x-dropdown-link href="javascript:void(0)" @click="open = false; setPermission('all')">全部
                    </x-dropdown-link>
                    <x-dropdown-link href="javascript:void(0)" @click="open = false; setPermission('public')">公开
                    </x-dropdown-link>
                    <x-dropdown-link href="javascript:void(0)" @click="open = false; setPermission('private')">私有
                    </x-dropdown-link>
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
         注意：这里不能再有 overflow-hidden —— 抽屉/遮罩已改 fixed，不需要它裁切。--}}
    <div class="relative -mb-14">
        <!-- content -->
        {{-- 原来是 absolute inset-0 + overflow-y-scroll 的自滚容器；改成普通块随内容长高，
             无限加载由 utils.infiniteScroll(..., {root:'window'}) 跟随整页滚动 --}}
        <div id="images-scroll" class="relative dragselect select-none">
            <div id="images-grid" class="dragselect"></div>
        </div>
        <!-- right drawer -->
        <div id="drawer-mask" class="fixed hidden inset-0 bg-surface-2 bg-opacity-50 z-[2]" onclick="drawer.close()"></div>
        <div id="drawer" class="fixed bg-surface w-64 md:w-72 top-14 -right-[1000px] bottom-0 z-[2] flex flex-col transition-all duration-300">
            <div class="flex justify-between items-center text-md px-3 py-1 border-b">
                <span class="text-ink-2 truncate" id="drawer-title"></span>
                <a href="javascript:drawer.close()" class="p-2"><i class="fas fa-times text-brand"></i></a>
            </div>
            <div id="drawer-content" class="overflow-y-auto"></div>
        </div>
    </div>

    {{-- 图片「详细信息」与「移动到相册」改用居中卡片弹窗（复用 components/modal.blade.php，
         手机上它就是「底部抽屉式」——弹窗容器在 <640px 时贴底、不依赖 hover）。
         右侧抽屉 #drawer 保留它原来的本职：顶部工具栏的「相册列表」入口照旧走抽屉。 --}}
    <x-modal id="image-detail-modal">
        <div id="image-detail-content"></div>
    </x-modal>

    <x-modal id="image-movements-modal">
        <div id="image-movements-content"></div>
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
            <img alt="__name__" data-original="__url__" src="__thumb_url__" width="__width__" height="__height__">
        </a>
    </script>

    <script type="text/html" id="albums-container-tpl">
        <div id="albums-container" class="flex flex-col justify-center items-center w-full p-3 space-y-2">
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

    <script type="text/html" id="albums-item-tpl">
        <a href="javascript:void(0)" data-id="__id__" data-json='__json__' title="__intro__" class="albums-item flex justify-between items-center group px-2 h-7 rounded-lg w-full bg-surface-2 text-ink hover:bg-surface-3 hover:text-ink">
            <span class="text-sm truncate w-[80%] name">__name__</span>
            <div class="flex items-center justify-center space-x-1 hidden group-hover:block">
                <span class="update"><i class="fas fa-edit text-[13.5px]"></i></span>
                <span class="delete"><i class="fas fa-trash-alt text-[13.5px] text-danger"></i></span>
            </div>
            <span class="group-hover:hidden text-[13.5px]">__image_num__</span>
        </a>
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
                    <dt class="shrink-0 text-[13px] leading-6 text-ink-3 sm:w-28">权限</dt>
                    <dd class="min-w-0 break-words text-[14px] leading-6 text-ink">__permission__</dd>
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
         抽屉里的相册列表照旧显示、不受影响；列表容器仍 overflow-y-auto，
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

    {{-- 相册列表行：整行是一个点击区（min-h-[44px]），不用 span（避免被无限加载的
         "点 span 加载更多"委托命中）。选中态由 JS 切换 border-brand/bg-brand-soft/text-brand
         （所以基础态必须留着 border-line bg-surface-2 text-ink，toggleClass 才有东西可换）。 --}}
    <script type="text/html" id="movements-album-item-tpl">
        <a href="javascript:void(0)" data-id="__id__" data-selected="false" class="movements-album flex min-h-[44px] w-full items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink transition-colors duration-150 hover:bg-surface-3">
            <i class="selected-mark fas fa-check-circle w-4 shrink-0 text-brand opacity-0" aria-hidden="true"></i>
            <div class="min-w-0 flex-1 truncate text-[14px]">__name__</div>
            __current_badge__
            <div class="shrink-0 text-[13px] text-ink-3">__image_num__ 张</div>
        </a>
    </script>

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
            const ALBUM_ITEM = '.albums-item';

            const $headerTitle = $(HEADER_TITLE);
            const $photos = $(IMAGES_GRID);
            const $drawer = $("#drawer");
            const $drawerMask = $('#drawer-mask');
            // 居中卡片弹窗（复用 components/modal.blade.php 的 Alpine store，用法同 admin 页）
            const modal = Alpine.store('modal');
            // 「移动到相册」弹窗里的相册列表容器 / 底部按钮
            const MOVEMENTS_MODAL = 'image-movements-modal';
            const DETAIL_MODAL = 'image-detail-modal';
            const viewer = new Viewer(document.getElementById('images-grid'), {url: 'data-original'});
            const drawer = {
                open(title, content, callback) {
                    $drawerMask.fadeIn();
                    $drawer.css('right', 0);
                    $drawer.find('#drawer-title').html(title);
                    $drawer.find('#drawer-content').html(content);
                    callback && callback();
                },
                close(callback) {
                    $drawerMask.fadeOut();
                    $drawer.css('right', '-1000px');
                    albumsInfinite && albumsInfinite.destroy();
                    callback && callback();
                },
                toggle(title, content, callback) {
                    if ($drawerMask.is(':hidden')) {
                        this.open(title, content, callback);
                    } else {
                        this.close(callback);
                    }
                }
            }

            $photos.justifiedGallery(gridConfigs);

            let albumsInfinite = null;
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
                            .replace(/__json__/g, JSON.stringify(images[i]).replace(/\$/g, '$$$$'))
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
                let title = '__title__ <i class="cursor-pointer fas fa-plus text-brand" onclick="$(\'#album-add\').toggleClass(\'hidden\')"></i>'.replace(/__title__/g, (options || {}).title || '我的相册');
                let content = $('#albums-container-tpl').html();
                drawer.toggle(title, content, function () {
                    let $albums = $('#albums-container');
                    const CREATE_ID = '#album-add';
                    const UPDATE_ID = '#album-edit';
                    albumsInfinite = utils.infiniteScroll('#drawer-content', {
                        url: '{{ route('user.albums') }}',
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
                                let item = $('#albums-item-tpl').html()
                                    .replace(/__id__/g, albums[i].id)
                                    .replace(/__name__/g, albums[i].name)
                                    .replace(/__intro__/g, albums[i].intro)
                                    .replace(/__image_num__/g, albums[i].image_num)
                                    .replace(/__json__/g, JSON.stringify(albums[i]))
                                if (albums[i].id === selectedAlbum.id) {
                                    // 选中的相册高亮
                                    item = item
                                        .replace(/bg-surface-2/g, 'bg-brand')
                                        .replace(/text-ink/g, 'text-white')
                                }

                                html += item;
                            }

                            $albums.append(html);

                            callback && callback.call(this, $albums.get(0));
                        }
                    });

                    $albums.off('click', '>a').on('click', '>a', function () {
                        // 如果当前已经为选中状态则清除
                        if (selectedAlbum.id === $(this).data('id')) {
                            selectedAlbum = {};
                        } else {
                            selectedAlbum = $(this).data('json');
                        }
                        resetImages({page: 1, album_id: selectedAlbum.id || null});
                        drawer.close();
                        ds.clearSelection();
                    });

                    const resetAlbums = () => {
                        $albums.find('>a').remove();
                        $albums.find(CREATE_ID).addClass('hidden');
                        $albums.find(UPDATE_ID).remove();
                        albumsInfinite.refresh({page: 1});
                    }

                    $albums.off('click', '.update').on('click', '.update', function (e) {
                        e.stopPropagation();
                        let selectedId = $albums.find(UPDATE_ID).data('id');
                        let $item = $(this).closest('a.albums-item');
                        $albums.find(UPDATE_ID).remove();
                        if (selectedId !== $item.data('id')) {
                            $item.after($('#album-update-tpl').html()
                                .replace(/__id__/g, $item.data('id'))
                                .replace(/__name__/g, $item.find('>span').html())
                                .replace(/__intro__/g, $item.attr('title'))
                            );
                        }
                    });

                    $albums.off('click', '.delete').on('click', '.delete', function (e) {
                        e.stopPropagation();
                        Swal.fire({
                            title: '确认删除该相册?',
                            text: "删除后相册中的图片将会被移出。",
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonColor: '#3085d6',
                            cancelButtonColor: '#d33',
                            confirmButtonText: '确认',
                        }).then((result) => {
                            if (result.isConfirmed) {
                                let id = $(this).closest(ALBUM_ITEM).data('id');
                                axios.delete(`/user/albums/${id}`).then(response => {
                                    if (response.data.status) {
                                        selectedAlbum = {};
                                        resetImages();
                                        setTimeout(_ => drawer.close(), 300)
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
                                $albums.find(`>a[data-id=${$editContainer.data('id')}]`)
                                    .attr('title', $form.find('textarea').val())
                                    .find('.name').text($form.find('input').val());
                                $editContainer.remove();
                            } else {
                                $errorMessage.html('<i class="fas fa-exclamation-circle"></i> ' + response.data.message).show();
                            }
                        });
                    });
                });
            }

            const setOrderBy = function (sort) {
                resetImages({page: 1, order: sort})
                $('#order span').text({newest: '最新', earliest: '最早', utmost: '最大', least: '最小'}[sort]);
            };

            const setPermission = function (permission) {
                resetImages({page: 1, permission: permission})
                $('#permission span').text({public: '公开', private: '私有', all: '全部'}[permission]);
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
            const ds = new DragSelect({
                area: $(IMAGES_SCROLL).get(0),
                keyboardDrag: false,
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
                    operates = ['refresh', 'movements', 'permission', 'detail', 'rename', 'delete', 'deselect'];
                }
                if (selected.length > 1) {
                    operates = ['refresh', 'movements', 'permission', 'delete', 'deselect'];
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

                if (! $(event.target).hasClass('dragselect')) {
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

            const methods = {
                movements() {
                    // 「移动到相册」改用居中卡片弹窗（不再渲染进右侧抽屉 ——
                    // 抽屉只留给顶部工具栏的「相册列表」入口）。
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
                            drawer.close();
                            resetImages();
                            toastr.success(response.data.message);
                        } else {
                            toastr.warning(response.data.message);
                        }
                    });
                },
                permission() {
                    Swal.fire({
                        title: '选择一个权限',
                        text: '选择公开后所有用户都能看到这张图片',
                        input: 'select',
                        inputOptions: {
                            public: '公开',
                            private: '私有',
                        },
                        confirmButtonText: '确认设置',
                        inputPlaceholder: '请选择一个权限',
                        showCancelButton: true,
                        inputValidator: (value) => {
                            return new Promise((resolve) => {
                                if (value === '') {
                                    resolve('请选择正确的权限')
                                } else {
                                    resolve();
                                }
                            })
                        }
                    }).then(result => {
                        if (result.isConfirmed) {
                            let selected = ds.getSelection().map(item => $(item).data('id'));
                            axios.put('{{ route('user.images.permission') }}', {
                                ids: selected,
                                permission: result.value,
                            }).then(response => {
                                if (response.data.status) {
                                    ds.clearSelection();
                                    toastr.success(response.data.message);
                                } else {
                                    toastr.warning(response.data.message);
                                }
                            });
                        }
                    });
                },
                rename(e) {
                    let item = $(e).data('json');
                    Swal.fire({
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
                                .replace(/__permission__/g, image.permission === 1 ? '公开' : '私有')
                                .replace(/__uploaded_ip__/g, image.uploaded_ip)
                                .replace(/__created_at__/g, image.created_at)
                            // 「详细信息」改成居中卡片弹窗（原来画进右侧抽屉）
                            $('#image-detail-content').html(content);
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
                permission: {
                    text: '设置权限',
                    action: _ => methods.permission(),
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
                    actions.permission,
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
                    case 'permission': // 设置权限
                        methods.permission();
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
        </script>
    @endpush
</x-app-layout>
