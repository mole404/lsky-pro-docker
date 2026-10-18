@section('title', '用户设置')

<x-app-layout>
    <div class="my-6 md:my-9">
        <p class="mb-3 font-semibold text-lg text-ink">用户设置</p>
        <form action="{{ route('settings.update') }}" method="POST">
            @csrf
            <div class="overflow-hidden sm:rounded-md shadow-card">
                <div class="px-3 py-4 bg-surface sm:p-6">
                    <div class="grid grid-cols-6 gap-6">
                        <div class="col-span-6 sm:col-span-3">
                            <label for="email" class="block text-sm font-medium text-ink">邮箱</label>
                            <x-input type="text" id="email" autocomplete="email" value="{{ Auth::user()->email }}" disabled readonly/>
                        </div>

                        <div class="col-span-6 sm:col-span-3">
                            <label for="name" class="block text-sm font-medium text-ink">名称</label>
                            <x-input type="text" name="name" id="name" autocomplete="name" value="{{ Auth::user()->name }}"/>
                        </div>

                        <div class="col-span-6 sm:col-span-3">
                            <label for="default_strategy" class="block text-sm font-medium text-ink">默认上传策略</label>
                            <x-select id="default_strategy" name="configs[default_strategy]" autocomplete="default-strategy">
                                @if(Auth::user()->group)
                                    <option value="0">未选择</option>
                                    @foreach(Auth::user()->group->strategies as $strategy)
                                        <option value="{{ $strategy->id }}" @selected(Auth::user()->configs->get('default_strategy') == $strategy->id)>{{ $strategy->name }}</option>
                                    @endforeach
                                @else
                                    <option value="0">系统默认</option>
                                @endif
                            </x-select>
                        </div>

                        <div class="col-span-6 sm:col-span-3">
                            <label for="default_album" class="block text-sm font-medium text-ink">默认上传相册</label>
                            <x-select id="default_album" name="configs[default_album]" autocomplete="default-album">
                                @if(Auth::user()->albums->isNotEmpty())
                                    <option value="0">未选择</option>
                                    @foreach(Auth::user()->albums as $album)
                                        <option value="{{ $album->id }}" @selected(Auth::user()->configs->get('default_album') == $album->id)>{{ $album->name }}</option>
                                    @endforeach
                                @else
                                    <option value="0">没有可用相册</option>
                                @endif
                            </x-select>
                        </div>

                        <div class="col-span-6">
                            <label for="url" class="block text-sm font-medium text-ink">个人主页</label>
                            <x-input type="url" name="url" id="url" autocomplete="url" value="{{ Auth::user()->url }}" placeholder="个人主页地址，http(s)://"/>
                        </div>

                        <div class="col-span-6">
                            <label for="password" class="block text-sm font-medium text-ink">密码</label>
                            <x-input type="password" name="password" id="password" placeholder="不修改请留空" autocomplete="new-password" />
                        </div>

                        <div class="col-span-6">
                            <label for="password_confirmation" class="block text-sm font-medium text-ink">确认密码</label>
                            <x-input type="password" name="password_confirmation" id="password_confirmation" placeholder="再次输入新密码" autocomplete="new-password" />
                        </div>

                        <div class="col-span-6">
                            <x-fieldset title="是否自动清除预览" faq="设置上传时，文件上传完成以后是否自动清除预览图片">
                                <x-fieldset-radio id="is_auto_clear_preview_yes" name="configs[is_auto_clear_preview]" value="1" :checked="Auth::user()->configs->get('is_auto_clear_preview')">是</x-fieldset-radio>
                                <x-fieldset-radio id="is_auto_clear_preview_no" name="configs[is_auto_clear_preview]" value="0" :checked="! Auth::user()->configs->get('is_auto_clear_preview')">否</x-fieldset-radio>
                            </x-fieldset>
                        </div>

                        <div class="col-span-6">
                            <x-fieldset title="图片粘贴后动作" faq="设置上传页面粘贴图片后的动作">
                                <x-fieldset-radio id="pasted_action_upload" name="configs[pasted_action]" value="{{ \App\Enums\PastedAction::Upload }}" :checked="Auth::user()->configs->get('pasted_action') == \App\Enums\PastedAction::Upload">直接上传</x-fieldset-radio>
                                <x-fieldset-radio id="pasted_action_waiting" name="configs[pasted_action]" value="{{ \App\Enums\PastedAction::Waiting }}" :checked="Auth::user()->configs->get('pasted_action') == \App\Enums\PastedAction::Waiting">等待上传</x-fieldset-radio>
                            </x-fieldset>
                        </div>
                    </div>
                    <div class="px-4 py-3 text-right sm:px-6">
                        <x-button>保存设置</x-button>
                    </div>
                </div>
            </div>
        </form>

        {{-- 批量导出：标题排在外面（与上面「用户设置」同款）；卡片本体不放进那个 settings.update 表单
             （页面脚本按 form 选择器统一接管提交） --}}
        <p class="mt-6 mb-3 font-semibold text-lg text-ink">批量导出</p>
        <div class="overflow-hidden sm:rounded-md shadow-card">
            <div class="px-3 py-4 bg-surface sm:p-6">
                @php
                    // 下拉选项先在服务端拼好（含每项的数量），前端只负责渲染与交互
                    $albumOptions = [['v' => '0', 't' => '未分类 ('.$uncategorizedNum.')']];
                    foreach (Auth::user()->albums as $album) {
                        $albumOptions[] = ['v' => (string) $album->id, 't' => $album->name.' ('.$album->image_num.')'];
                    }

                    $tagOptions = [];
                    foreach (Auth::user()->tags as $tag) {
                        $tagOptions[] = ['v' => (string) $tag->id, 't' => $tag->name.' ('.($tagCounts[$tag->id] ?? 0).')'];
                    }

                    $strategyOptions = [];
                    if (Auth::user()->group) {
                        foreach (Auth::user()->group->strategies as $strategy) {
                            $strategyOptions[] = ['v' => (string) $strategy->id, 't' => $strategy->name.' ('.($strategyCounts[$strategy->id] ?? 0).')'];
                        }
                    }
                @endphp
                {{-- 一句说明放在筛选区上方：不占网格，也就不跟控件抢行 --}}
                <p class="mb-4 text-sm text-ink-2">不选择任何条件 = 导出全部图片</p>

                {{-- 控件的 name 就是导出接口的参数名，空值不传 ⇒ 该维度不限 --}}
                <div id="export-filters" class="grid grid-cols-6 gap-6">
                    <div class="col-span-6 sm:col-span-3">
                        <span class="block text-sm font-medium text-ink">相册</span>
                        {{-- 自绘多选下拉：选项数据在 script[type=application/json] 里，交互由内联脚本渲染 --}}
                        <div id="export-dropdown-albums" class="export-dropdown" data-name="album_ids[]" data-placeholder="全部相册">
                            <script type="application/json" class="export-dropdown-options">@json($albumOptions, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS)</script>
                        </div>
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <span class="block text-sm font-medium text-ink">标签</span>
                        <div id="export-dropdown-tags" class="export-dropdown" data-name="tag_ids[]" data-placeholder="选择标签" data-empty-label="暂无标签">
                            <script type="application/json" class="export-dropdown-options">@json($tagOptions, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS)</script>
                        </div>
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <span class="block text-sm font-medium text-ink">存储策略</span>
                        <div id="export-dropdown-strategies" class="export-dropdown" data-name="strategy_ids[]" data-placeholder="全部策略" data-empty-label="暂无策略">
                            <script type="application/json" class="export-dropdown-options">@json($strategyOptions, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS)</script>
                        </div>
                    </div>

                    <div class="col-span-6">
                        <span class="block text-sm font-medium text-ink">上传日期</span>
                        {{-- 月历：data-days 是「有图的日子 → 张数」，前端据此标出哪几天存过图片；
                             两个 date 输入是表单真值来源（区间由月历写入），平时隐藏。
                             属性里的 JSON 只能走 json_encode()：@json 输出裸引号，会在第一个引号处截断属性，
                             浏览器只读到 "{" ⇒ 月历标记会静默失效（实测） --}}
                        <div id="export-calendar"
                             data-days="{{ json_encode($dayCounts) }}"
                             data-from="#export-date-from"
                             data-to="#export-date-to"></div>
                        <div id="export-date-quick" class="flex items-center gap-2 mt-2">
                            <button type="button" class="cursor-pointer text-sm text-ink-2" data-quick="today">今天</button>
                            <button type="button" class="cursor-pointer text-sm text-ink-2" data-quick="week">本周</button>
                            <button type="button" class="cursor-pointer text-sm text-ink-2" data-quick="month">本月</button>
                            <button type="button" class="cursor-pointer text-sm text-ink-2" data-quick="year">今年</button>
                            <button type="button" class="cursor-pointer text-sm text-ink-2 ml-2" data-quick="clear">清除日期</button>
                        </div>
                        {{-- 起始/结束两行常驻显示（原来是点「自定义日期」展开的） --}}
                        <input type="date" id="export-date-from" name="date_from" class="ls-input mt-1">
                        <input type="date" id="export-date-to" name="date_to" class="ls-input mt-1">
                        <p id="export-date-summary" class="mt-1 text-sm text-ink-2"></p>
                    </div>

                    <div class="col-span-6">
                        <p id="export-preview-summary" class="text-sm font-medium text-ink"></p>
                    </div>

                    <div class="col-span-6 text-sm text-ink-2">
                        <p class="font-medium text-ink">导出说明</p>
                        <p>· 原图导出，系统自动打包为 zip 压缩包。</p>
                        <p>· 导出采用流式传输，导出期间请不要关闭或刷新页面，确保网络稳定。中途中断或网络波动需要重新导出，不支持断点续传。</p>
                        <p>· 同一账号同时只能有一个导出任务在进行。</p>
                        <p>· 图片较多时下载比较久，大批量导出请预留充足时间。导出时的下载行为可能因文件大小和浏览器不同而略有差异。</p>
                    </div>
                </div>
                <div class="px-4 py-3 text-right sm:px-6">
                    <x-button type="button" id="export-submit">导出</x-button>
                </div>
            </div>
        </div>
    </div>

    @push('scripts')
        <script>
            $('form').submit(function (e) {
                e.preventDefault();

                // 密码是可选的（留空＝不修改），所以不加 required：只在新密码真的填了的时候做配对校验，
                // 否则光改名称/策略也会被浏览器拦下来。
                const password = $('#password').val() || '';
                const passwordConfirmation = $('#password_confirmation').val() || '';

                if (password !== '' && passwordConfirmation === '') {
                    toastr.warning('请再输入一次密码');
                    return;
                }

                if (password !== '' && password !== passwordConfirmation) {
                    toastr.warning('两次输入的密码不一致');
                    return;
                }

                axios.put(this.action, $(this).serialize()).then(response => {
                    toastr[response.data.status ? 'success' : 'warning'](response.data.message);
                });
            });
        </script>
    @endpush

    @push('scripts')
        <script>
            // 批量导出：预检数量与体积 → 二次确认 → 浏览器原生下载（大文件不进内存）
            //          → 进行中弹窗（可「取消导出」）+ 轮询结果 → 结果弹窗
            (function () {
                const EXPORT_PREVIEW_URL = '{{ route('settings.export.preview') }}';
                const EXPORT_URL = '{{ route('settings.export') }}';
                const EXPORT_RESULT_URL = '{{ route('settings.export.result') }}';
                const EXPORT_CANCEL_URL = '{{ route('settings.export.cancel') }}';
                const CSRF_TOKEN = '{{ csrf_token() }}';

                const POLL_FIRST_MS = 1500;          // 头一次查：导出很快时不用干等
                const POLL_INTERVAL = 2000;          // 常规轮询间隔（一次缓存读取，很轻）
                const POLL_MAX = 900;                // 最多轮询次数（≈30 分钟，够大包跑完）
                const CANCEL_POLL_INTERVAL = 1000;   // 点了取消后加密轮询，尽快看到「已中断」
                const CANCEL_POLL_MAX = 30;
                const STALL_MS = 8000;               // 发起后这么久还没见过自己的进度 ⇒ 当作没起来
                const BUTTON_DISABLE_MS = 3000;      // 发起后按钮禁用时长
                // 小包阈值：整包取回内存再让浏览器保存（blob 地址），下载管理器没有可回源的地址可截
                const SMALL_LIMIT = 128 * 1024 * 1024;

                // 大包优先「流式写盘」：要安全上下文（https / localhost）且浏览器给了文件系统访问 API。
                // http、Safari、Firefox 都没有这两个条件 —— 一律回退到 iframe 导发（行为与今天一致）。
                const canStreamToDisk = () => Boolean(window.isSecureContext)
                    && typeof window.showSaveFilePicker === 'function';

                // 统一造一个 AbortError：取消之后仍要走同一条 catch，不能只靠 error.name 猜
                const abortError = () => {
                    try {
                        return new DOMException('Aborted', 'AbortError');
                    } catch (e) {
                        const error = new Error('Aborted');
                        error.name = 'AbortError';
                        return error;
                    }
                };

                const $button = $('#export-submit');

                // 本次导出的标识：服务端把它写进结果记录，前端只认自己这一个。于是页面
                // 不必在打开时读「上次的结果」来区分本次与上次 —— 历史结果一次都不会显示。
                let run = null;
                let frame = null;        // 下载用的隐藏 iframe（见 startDownload）
                let pollTimer = null;
                let pollCount = 0;
                let pollInterval = POLL_INTERVAL;
                let pollMax = POLL_MAX;
                let exporting = false;   // 本次导出是否还在进行（决定取消按钮是否有意义）
                let startedMs = 0;       // 发起时刻，用于判断这次任务有没有真的起来
                let sawProgress = false; // 是否见过服务端上报的进度
                // 点过取消的 run 集合（不是布尔单槽）：blob / 写盘的回调各自拿发起时的 run 比对。
                // 用集合而不是「最后一次取消的 run」：新一笔开始时不必清空，上一笔迟到的响应
                // 依然认得出自己是取消过的，不会在新一笔里再存一次半截包
                const cancelRequestedRuns = new Set();
                let abortController = null;   // 取回/写盘那条连接：取消时直接掐断

                // 控件 name 即接口参数名；空值一律不传（= 该维度不限）
                const collectSearch = () => {
                    const search = new URLSearchParams();
                    $('#export-filters').find('select, input').each(function () {
                        if (! this.name) { return; }
                        const value = $(this).val();
                        if (value === null || value === undefined || value === '') { return; }
                        if ($.isArray(value)) {
                            for (let i = 0; i < value.length; i++) { search.append(this.name, value[i]); }
                            return;
                        }
                        search.append(this.name, value);
                    });
                    return search;
                };

                const formatSize = (bytes) => {
                    const mb = (parseInt(bytes, 10) || 0) / 1048576;
                    if (mb >= 100) { return Math.round(mb) + ' MB'; }
                    if (mb >= 1) { return mb.toFixed(1) + ' MB'; }
                    return Math.round(mb * 1024) + ' KB';
                };

                const resultText = (data) => {
                    const ok = parseInt(data.ok, 10) || 0;
                    const failed = parseInt(data.failed, 10) || 0;
                    const bytes = parseInt(data.bytes, 10) || 0;
                    if (data.aborted) {
                        return '本次导出已中断（取消或网络断开），已完成 ' + ok + ' 张，需要重新导出。';
                    }
                    if (failed > 0) {
                        return '本次导出已完成：' + ok + ' 张成功，' + failed + ' 张失败 —— 详见包内 _export_failures.txt';
                    }
                    return '本次导出已完成：' + ok + ' 张（约 ' + formatSize(bytes) + '）';
                };

                // 结果接口无记录时返回 null；这里再兜一层：字段全空的对象同样当作没有记录
                const hasRecord = (data) => Boolean(data) && Boolean(
                    data.started_at || data.finished_at || data.total || data.ok || data.failed || data.bytes || data.aborted
                );

                // 页面其它弹窗的既有写法：不动背景页面的高度与滚动条
                const dialog = (options) => Object.assign({heightAuto: false, scrollbarPadding: false}, options);

                const stopPolling = () => {
                    if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null; }
                };

                const schedulePoll = (delay) => {
                    stopPolling();
                    pollTimer = window.setTimeout(pollOnce, delay);
                };

                const settle = (data) => {
                    exporting = false;
                    stopPolling();
                    // 结果只出现在弹窗里：页面上不留任何「上次导出」的残影
                    resultDialog(data);
                };

                const pollOnce = () => {
                    axios.get(EXPORT_RESULT_URL).then(response => {
                        const data = response.data || {};
                        const record = data.record;
                        const progress = data.progress;

                        // 只认 run 与本次一致的结果：历史记录、别人那笔都不会误报
                        if (hasRecord(record) && record.run === run) {
                            settle(record);
                            return;
                        }

                        if (progress && progress.run === run) {
                            sawProgress = true;
                            updateBar(progress.done, progress.total, progress.bytes);
                        } else if (! sawProgress && Date.now() - startedMs > STALL_MS) {
                            // 发起后一直没见过自己的进度 ⇒ 这次导出压根没跑起来（被拒/出错）
                            exporting = false;
                            stopPolling();
                            stallDialog();
                            return;
                        }

                        if (++pollCount >= pollMax) {
                            exporting = false;
                            stopPolling();
                            timeoutDialog();
                            return;
                        }

                        schedulePoll(pollInterval);
                    }).catch(() => {
                        if (++pollCount >= pollMax) {
                            exporting = false;
                            stopPolling();
                            timeoutDialog();
                            return;
                        }
                        schedulePoll(pollInterval);
                    });
                };

                // 进度条：服务端每写一张图回报一次，这里把宽度推上去（不需要新接口）
                const barHtml = (count, bytes) =>
                    '<p>正在打包 <b>' + count + '</b> 张图片（约 ' + formatSize(bytes) + '）。</p>'
                    // 颜色全走主题令牌：进度槽原来的 rgba(0,0,0,.12) 压在暗色卡面上几乎看不见，
                    // 蓝/红也写死了亮色主题的值（与页面其它弹窗不一致）
                    + '<div style="margin-top:.75rem;height:.5rem;border-radius:9999px;background:var(--lsky-surface-3);overflow:hidden">'
                    + '<div id="export-bar" style="height:100%;width:0%;border-radius:9999px;background:var(--lsky-accent);transition:width .4s ease"></div>'
                    + '</div>'
                    + '<p id="export-bar-text" style="margin-top:.375rem;font-size:.875rem;opacity:.75">'
                    + '已完成 0 / ' + count + ' 张（0%）</p>'
                    // 取消键自己做：swal 自带那个按钮一点就把弹窗关掉，进度条会跟着一起消失
                    + '<button type="button" id="export-cancel" class="swal2-styled swal2-cancel"'
                    + ' style="margin-top:.9rem">取消导出</button>';

                const updateBar = (done, total, bytes) => {
                    const container = Swal.getHtmlContainer();
                    if (! container) { return; }
                    const bar = container.querySelector('#export-bar');
                    const text = container.querySelector('#export-bar-text');
                    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(done * 100 / total))) : 0;
                    if (bar) { bar.style.width = percent + '%'; }
                    if (text) {
                        text.textContent = '已完成 ' + done + ' / ' + total + ' 张（' + percent + '%'
                            + (bytes > 0 ? '，' + formatSize(bytes) : '') + '）';
                    }
                };

                // 进行中：只有「取消导出」一个按钮 —— 导出期间页面被它占住，避免误操作打断
                const progressDialog = (count, bytes) => {
                    Swal.fire(dialog({
                        title: '导出进行中',
                        html: barHtml(count, bytes),
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                        showConfirmButton: false,
                        // 全局 mixin 默认开着「取消」键（app.js 里的 Swal.mixin），这里必须显式关掉：
                        // 取消键由 progressHtml 自己提供，弹窗不关，进度条原地留到结果出来
                        showCancelButton: false,
                    }));
                };

                // 取消键是页面自己的（见 barHtml 里的 #export-cancel）：一点不关弹窗，
                // 就地改成「正在取消导出…」，进度条与已完成数字留在原地
                $(document).on('click', '#export-cancel', function () {
                    if (! exporting || $(this).prop('disabled')) { return; }
                    $(this).prop('disabled', true).text('正在取消…');
                    cancelDialog();
                });

                // 发起后任务没起来（被拒/出错）：与其干等到超时，不如早点说清楚
                const stallDialog = () => {
                    Swal.fire(dialog({
                        icon: 'warning',
                        title: '导出没能开始',
                        text: '服务端没有接到这次导出，可能被拒绝了，请再试一次。',
                        confirmButtonColor: '#3085d6',
                        confirmButtonText: '知道了',
                        showCancelButton: false,
                    }));
                };

                // 服务端说没有在跑的任务（active:false）：旗标落不到任何东西上，取消未必生效。
                // 这不是 500 级错误，给一条能照着做的提示就够，别让「正在取消…」一直演下去。
                const cancelFailedDialog = () => {
                    Swal.fire(dialog({
                        icon: 'warning',
                        title: '未能通知到服务端',
                        text: '本地下载已经停下，但服务端此刻没有在进行的导出：取消可能没生效，也可能这笔已经结束。请稍后重试。',
                        confirmButtonColor: '#3085d6',
                        confirmButtonText: '知道了',
                        showCancelButton: false,
                    }));
                };

                const resultDialog = (data) => {
                    const failed = parseInt(data.failed, 10) || 0;
                    const aborted = Boolean(data.aborted);
                    Swal.fire(dialog({
                        icon: aborted ? 'info' : (failed > 0 ? 'warning' : 'success'),
                        title: aborted ? '导出已中断' : (failed > 0 ? '导出完成，有图片未成功' : '导出完成'),
                        html: '<p>' + resultText(data) + '</p>',
                        confirmButtonColor: '#3085d6',
                        confirmButtonText: '知道了',
                        showCancelButton: false,
                    }));
                };

                const timeoutDialog = () => {
                    Swal.fire(dialog({
                        icon: 'info',
                        title: '导出仍在进行',
                        text: '结果暂时查不到。导出可能仍在服务端继续，可以等它跑完后再试一次。',
                        confirmButtonColor: '#3085d6',
                        confirmButtonText: '知道了',
                        showCancelButton: false,
                    }));
                };

                // 取消：给服务端置个旗标，循环会在下一张图的边界停下（原生下载没法在客户端掐断）
                const cancelDialog = () => {
                    // 只改标题文本，不用 Swal.update：update 会把 html 容器整个重渲染，
                    // 进度条节点被换新、宽度与「已完成 N 张」都会被打回 0，视觉上等于清零重来。
                    // 直接改文本 + 停用取消键，进度条、数字、loader 全部原地保留。
                    const title = document.querySelector('.swal2-title');
                    if (title) { title.textContent = '正在取消导出…'; }

                    const button = document.querySelector('#export-cancel');
                    if (button) { button.disabled = true; button.textContent = '正在取消…'; }

                    // 按 run 记，不按布尔：这一笔的点取消只影响这一笔
                    const cancelRun = run;
                    cancelRequestedRuns.add(cancelRun);

                    if (abortController) {
                        try { abortController.abort(); } catch (e) { /* 已经结束了就算了 */ }
                    }

                    axios.post(EXPORT_CANCEL_URL, {_token: CSRF_TOKEN, run: cancelRun}).then(response => {
                        const data = response.data || {};

                        // active 只说明「此刻有没有在跑」；armed 才是「取消有没有记下来」。
                        // 导出请求还没被 worker 认领时 active=false 而 armed=true —— 那正是
                        // 「刚点开始就取消」要救的场景，不能当失败处理。
                        // 只有确实没记下（armed=false）才提示重试，否则继续等「已中断」记录。
                        if (data.armed === false) {
                            axios.get(EXPORT_RESULT_URL).then(res => {
                                const result = res.data || {};
                                if (hasRecord(result.record) && result.record.run === cancelRun) {
                                    settle(result.record);
                                    return;
                                }
                                exporting = false;
                                stopPolling();
                                cancelFailedDialog();
                            }).catch(() => {
                                exporting = false;
                                stopPolling();
                                cancelFailedDialog();
                            });
                            return;
                        }

                        // 转去等那条「已中断」的结果记录
                        pollCount = 0;
                        pollInterval = CANCEL_POLL_INTERVAL;
                        pollMax = CANCEL_POLL_MAX;
                        schedulePoll(CANCEL_POLL_INTERVAL);
                    }).catch(() => {
                        exporting = false;
                        Swal.fire(dialog({
                            icon: 'warning',
                            title: '取消请求没发出去',
                            text: '导出可能仍在服务端进行，请稍后重新发起确认。',
                            confirmButtonColor: '#3085d6',
                            confirmButtonText: '知道了',
                            showCancelButton: false,
                        }));
                    });
                };

                // 从响应的 Content-Disposition 取文件名（同源请求能读到该头）；取不到就用服务端同款格式
                const filenameFrom = (header) => {
                    if (! header) { return null; }
                    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
                    if (star) { try { return decodeURIComponent(star[1]); } catch (e) { return star[1]; } }
                    const plain = /filename="?([^";]+)"?/i.exec(header);
                    return plain ? plain[1] : null;
                };

                const fallbackFilename = () => {
                    const d = new Date();
                    const pad = n => (n < 10 ? '0' : '') + n;
                    return 'lsky-images-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
                        + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.zip';
                };

                // 小包：页面自己把整包取回内存，再用 blob 地址交给浏览器保存。
                // 下载管理器截的是「浏览器的下载事件 + 可回源重发的服务端地址」——blob 两条都不成立：
                // 没有服务端地址可重发，它们既截不走，也不会再用自己的引擎慢慢爬。
                const startBlobDownload = (query, runId) => {
                    abortController = new AbortController();
                    const url = EXPORT_URL + (query === '' ? '' : '?' + query);

                    window.fetch(url, {credentials: 'same-origin', signal: abortController.signal})
                        .then(response => {
                            if (! response.ok) { throw new Error('HTTP ' + response.status); }
                            const name = filenameFrom(response.headers.get('Content-Disposition')) || fallbackFilename();
                            return response.blob().then(blob => ({blob: blob, name: name}));
                        })
                        .then(result => {
                            // 这笔自己点过取消就别存了：此刻拿到的只是半截数据。
                            // 只认本笔的 run —— 上一笔迟到的响应不会被新一笔的取消误伤
                            if (cancelRequestedRuns.has(runId)) { return; }
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(result.blob);
                            link.download = result.name;
                            document.body.appendChild(link);
                            link.click();
                            window.setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 4000);
                        })
                        .catch(error => {
                            if (cancelRequestedRuns.has(runId) || (error && error.name === 'AbortError')) { return; }
                            exporting = false;
                            stopPolling();
                            stallDialog();
                        });
                };

                // 大包：隐藏 iframe 流式下载（不替换当前页面，万一是错误响应也只落在看不见的框里），
                // 由浏览器直接落盘、不经过内存。
                const startDownload = (url) => {
                    if (! frame) {
                        frame = document.createElement('iframe');
                        frame.style.display = 'none';
                        frame.title = 'export-download';
                        document.body.appendChild(frame);
                    }
                    frame.src = url;
                };

                // 三条路径共用的「开跑」收尾：按钮禁用期、进度弹窗、结果轮询
                const beginProgress = (count, bytes) => {
                    exporting = true;
                    sawProgress = false;
                    startedMs = Date.now();
                    pollCount = 0;
                    pollInterval = POLL_INTERVAL;
                    pollMax = POLL_MAX;
                    progressDialog(count, bytes);
                    schedulePoll(POLL_FIRST_MS);
                };

                // 大包 + 浏览器支持文件系统访问 API：边读边写。调用时「另存为」已经弹过并拿到句柄，
                // 这里只负责搬字节与收尾 —— 弹框那一步留在 beginStreamExport（用户手势）。
                const startStreamDownload = async (query, handle, runId, count, bytes) => {
                    abortController = new AbortController();
                    const signal = abortController.signal;
                    const url = EXPORT_URL + (query === '' ? '' : '?' + query);
                    let writer = null;       // createWritable() 之后才有
                    let committed = false;   // close() 是否已提交：提交后的文件是完整的，不能再删
                    let existed = false;     // 用户是不是选了个已有的文件；只有 getFile() 成功才算「有」

                    // 异常/中断的收尾：abort() 丢掉尚未提交的 swap 文件（半截 zip 不会落盘）；
                    // 选的是新文件名时再 remove() 兜一次，确保磁盘上干干净净。
                    // 若覆盖的是已存在的文件，abort 已经把它还原 —— 这时 remove 等于删用户的旧数据。
                    const discard = async () => {
                        if (writer && ! committed) {
                            try { await writer.abort(); } catch (e) { /* 已经结束 */ }
                        }
                        if (committed || existed || typeof handle.remove !== 'function') { return; }
                        // 兜底：abort() 之后还能读到有内容的文件，说明它是用户原有的文件被还原了 —— 不能删。
                        try { const current = await handle.getFile(); if (current && current.size > 0) { return; } } catch (e) { /* 读不到就按新建处理 */ }
                        // abort() 返回不代表文件句柄已经释放：紧接着 remove() 常常抛错，
                        // 于是一次失败就放弃、磁盘上留一个打不开的半截 zip（实测踩到）。
                        // 这里退避重试几次；NotFound 说明文件本就不在了，也算清干净。
                        for (let i = 0; i < 5; i++) {
                            try {
                                await handle.remove();
                                if (window.console && console.info) { console.info('[export] 已删除未完成的导出文件'); }
                                return;
                            } catch (e) {
                                if (e && e.name === 'NotFoundError') { return; } // 本来就没落盘，算清干净
                            }
                            await new Promise((resolve) => window.setTimeout(resolve, 120 * (i + 1)));
                        }
                        // 仍删不掉就直说，别让用户以为是浏览器的锅
                        window.console && console.warn && console.warn('[export] 未能删除未完成的导出文件，请手动清理：' + (handle.name || ''));
                    };

                    beginProgress(count, bytes);

                    try {
                        const response = await window.fetch(url, {credentials: 'same-origin', signal: signal});
                        if (! response.ok || ! response.body) { throw new Error('HTTP ' + response.status); }
                        // 先看这个文件原来在不在：**只有 getFile() 成功才算存在**。
                        // 以前把「非 NotFoundError 的失败」也当成存在，于是取消时永远跳过 remove，
                        // 磁盘上就留一个打不开的半截 zip（实测踩到）。
                        try { await handle.getFile(); existed = true; } catch (e) { existed = false; }
                        writer = await handle.createWritable();
                        const reader = response.body.getReader();
                        for (;;) {
                            const step = await reader.read();
                            if (step.done) { break; }
                            await writer.write(step.value);
                        }
                        // 取消之后服务端可能只是「停下不写了」，流会正常 end：这时绝不能 close，
                        // 否则半截 zip 会被当成成品提交
                        if (cancelRequestedRuns.has(runId)) { throw abortError(); }
                        await writer.close();
                        committed = true;
                    } catch (error) {
                        await discard();
                        // 主动取消：本地已停、文件已清，结果记录由轮询那边的「已中断」来说
                        if (cancelRequestedRuns.has(runId) || (error && error.name === 'AbortError')) { return; }
                        exporting = false;
                        stopPolling();
                        stallDialog();
                    }
                };

                // 点完二次确认后的第一步：先在用户手势里弹出系统「另存为」，拿到句柄再发请求。
                // 顺序不能反 —— 等 fetch 回来再调 picker，浏览器会以「需要用户手势」直接拒绝。
                const beginStreamExport = (query, runId, count, bytes) => {
                    let picker;
                    try {
                        picker = window.showSaveFilePicker({suggestedName: fallbackFilename()});
                    } catch (error) {
                        // 被策略/环境拦掉：退回 iframe 流式下载，与今天一致
                        startDownload(EXPORT_URL + (query === '' ? '' : '?' + query));
                        beginProgress(count, bytes);
                        return;
                    }

                    Promise.resolve(picker).then(handle => {
                        startStreamDownload(query, handle, runId, count, bytes);
                    }).catch(error => {
                        if (error && error.name === 'AbortError') {
                            // 用户在「另存为」里点了取消：当作根本没开始导出 —— 不发请求、
                            // 不建任何下载、不弹进度框，按钮立刻恢复可用。
                            $button.prop('disabled', false);
                            return;
                        }
                        // 其余失败（没有手势、被策略拦掉、磁盘没权限）：退回 iframe 导发，
                        // 行为与今天一致，别让用户点了导出却什么都没发生
                        startDownload(EXPORT_URL + (query === '' ? '' : '?' + query));
                        beginProgress(count, bytes);
                    });
                };

                $button.on('click', () => {
                    const search = collectSearch();
                    // 本次导出的标识：服务端写进结果记录，轮询只认它
                    run = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
                    search.append('run', run);
                    const query = search.toString();
                    $button.prop('disabled', true);
                    axios.get(EXPORT_PREVIEW_URL, {params: search}).then(response => {
                        const data = response.data || {};
                        const count = parseInt(data.count, 10) || 0;
                        const bytes = parseInt(data.bytes, 10) || 0;
                        if (data.busy) {
                            // 同一账号同时只能有一个导出：先说清楚，别让用户跳到 429 的纯文本页
                            toastr.warning('已有导出任务在进行中，请等它结束');
                            $button.prop('disabled', false);
                            return;
                        }
                        if (count <= 0) {
                            toastr.warning('没有符合条件的图片');
                            $button.prop('disabled', false);
                            return;
                        }
                        Swal.fire(dialog({
                            title: '确认导出',
                            text: '共 ' + count + ' 张 / 约 ' + formatSize(bytes) + '。导出期间请保持页面开启与网络稳定，中途中断需要重新导出。',
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonColor: '#3085d6',
                            cancelButtonColor: '#d33',
                            confirmButtonText: '开始导出',
                            cancelButtonText: '取消',
                        })).then(result => {
                            if (! result.isConfirmed) {
                                $button.prop('disabled', false);
                                return;
                            }
                            // 按钮保持禁用一段时间，避免连点重复发起
                            window.setTimeout(() => $button.prop('disabled', false), BUTTON_DISABLE_MS);

                            if (bytes <= SMALL_LIMIT) {
                                // 小包：页面取回内存后由浏览器保存（blob 地址，第三方下载器截不到）
                                startBlobDownload(query, run);
                                beginProgress(count, bytes);
                            } else if (canStreamToDisk()) {
                                // 大包 + 支持写盘：先弹「另存为」，拿到句柄再流式写；
                                // 后续的进度/轮询由 beginStreamExport 里那一步接手
                                beginStreamExport(query, run, count, bytes);
                            } else {
                                // 大包、浏览器不支持：浏览器原生流式下载，不占内存（与今天一致）
                                startDownload(EXPORT_URL + (query === '' ? '' : '?' + query));
                                beginProgress(count, bytes);
                            }
                        });
                    }).catch(() => {
                        toastr.warning('导出预检失败，请稍后再试');
                        $button.prop('disabled', false);
                    });
                });
            })();
        </script>
    @endpush

    @push('scripts')
        <script>
/* Export filter multi-select dropdown - zero dependency, native DOM only.
 *
 * MOUNT CONTRACT (one block per filter group; already in the markup):
 *   A div carrying class "export-dropdown" plus:
 *     data-name          e.g. "album_ids[]"
 *     data-placeholder   e.g. "全部相册"
 *     data-empty-label   optional, e.g. "暂无标签"
 *   Inside that div, a JSON payload element selected by
 *   ".export-dropdown-options" whose text is the choice list, e.g.
 *   [{"v":"0","t":"未分类 (415)"},{"v":"1","t":"素材 (6)"}].
 *
 * OUTPUT CONTRACT (what a collector walking "#export-filters select, input"
 * can rely on):
 *   - one hidden input per selected value, rebuilt on every change:
 *       <input type="hidden" name="{data-name}" value="{v}">
 *     Living in .export-dropdown-values inside the block. An empty selection
 *     emits nothing at all, so an untouched filter disappears from the query.
 *   - the visible checkboxes deliberately carry no name attribute, so a
 *     collector must skip nameless inputs - "if (!f.name) continue;" - or it
 *     will append an empty query key.
 *   - every selection change (including "nothing selected" again) dispatches
 *     one CustomEvent named 'export:filters-changed' on document.
 *
 * Optional extra attribute:
 *   data-summary-full="1" - keep the trailing " (123)" count in the trigger
 *   summary instead of stripping it.
 *
 * Public surface: window.LskyExportDropdown = { init, summary }. Nothing else
 * is added to global scope and nothing outside #export-filters is touched.
 */
(function () {
  'use strict';

  var EVENT_NAME = 'export:filters-changed';

  /* @pure:begin */
  /*
   * Pure block: no DOM, no window, no closure over outer variables. It is
   * sliced out verbatim by selfcheck.mjs and evaluated stand-alone.
   */

  // Parse the embedded options payload. Accepts a JSON string or an already
  // parsed value shaped [{ "v": "...", "t": "..." }]. Returns [] rather than
  // throwing on malformed input, and skips entries with no usable value.
  function pdParseOptions(raw) {
    if (raw === null || raw === undefined) return [];
    var data = raw;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (err) {
        return [];
      }
    }
    if (!Array.isArray(data)) return [];
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      if (!item || typeof item !== 'object') continue;
      if (item.v === null || item.v === undefined) continue;
      var value = String(item.v);
      var text = (item.t === null || item.t === undefined) ? value : String(item.t);
      out.push({ v: value, t: text });
    }
    return out;
  }

  // Trigger summary uses the bare option name: a trailing " (123)" row count
  // is dropped so the line stays short. "相册 (旧)" is left untouched.
  function pdDisplayName(text) {
    var s = (text === null || text === undefined) ? '' : String(text);
    return s.replace(/\s*\(\d+\)\s*$/, '');
  }

  // Trigger summary line.
  //   total 0          -> emptyLabel (falling back to placeholder)
  //   nothing selected -> placeholder
  //   1 or 2 selected  -> the names joined by a full-width comma
  //   3+ selected      -> first two names + " 等 n 项"
  function pdSummaryText(names, opts) {
    var o = opts || {};
    var placeholder = (o.placeholder === null || o.placeholder === undefined) ? '' : String(o.placeholder);
    var emptyLabel = (o.emptyLabel === null || o.emptyLabel === undefined) ? '' : String(o.emptyLabel);
    var total = (typeof o.total === 'number') ? o.total : 0;
    var list = names || [];
    if (total <= 0) return emptyLabel.length ? emptyLabel : placeholder;
    var n = list.length;
    if (n <= 0) return placeholder;
    var first = String(list[0]);
    if (n === 1) return first;
    var second = String(list[1]);
    if (n === 2) return first + '、' + second;
    return first + '、' + second + ' 等 ' + n + ' 项';
  }
  /* @pure:end */

  // Fire the change signal consumed by any external summary / collector.
  function dispatchChanged() {
    var evt;
    try {
      evt = new CustomEvent(EVENT_NAME);
    } catch (err) {
      evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(EVENT_NAME, false, false, null);
    }
    document.dispatchEvent(evt);
  }

  function make(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // Build one block. Idempotent: a block carrying data-initialized="1" is left
  // alone, so repeated init() calls never duplicate the widget.
  function build(container) {
    if (!container || container.getAttribute('data-initialized') === '1') return false;
    container.setAttribute('data-initialized', '1');

    var fieldName = container.getAttribute('data-name') || '';
    var placeholder = container.getAttribute('data-placeholder') || '';
    var emptyLabel = container.getAttribute('data-empty-label') || '';
    var keepCount = container.getAttribute('data-summary-full') === '1';

    var payload = container.querySelector('script.export-dropdown-options');
    var options = pdParseOptions(payload ? payload.textContent : null);
    var disabled = options.length === 0;

    // The panel is absolutely positioned below the trigger, so the block has
    // to be the positioning context.
    container.style.position = 'relative';
    container.style.marginTop = '0.25rem';

    // --- trigger: looks like a text input ---
    var trigger = make('div', 'ls-input cursor-pointer flex items-center justify-between');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (disabled) {
      trigger.setAttribute('aria-disabled', 'true');
      trigger.style.opacity = '0.5';
      trigger.style.cursor = 'not-allowed';
    } else {
      trigger.setAttribute('tabindex', '0');
    }

    var summary = make('span', 'export-dropdown-summary truncate');
    summary.style.flex = '1 1 auto';
    summary.style.minWidth = '0';

    var caret = make('span', 'text-ink-2');
    caret.style.flexShrink = '0';
    caret.style.marginLeft = '0.5rem';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';

    // .ls-input sets display:block, and the utility that flips it back to flex
    // is emitted after .ls-input in the built stylesheet. Pin it inline so the
    // summary/caret layout holds whatever the source order turns out to be.
    trigger.style.display = 'flex';

    trigger.appendChild(summary);
    trigger.appendChild(caret);

    // --- panel: pinned under the trigger, scrolled past 16rem ---
    var panel = make('div', 'rounded-md shadow-card bg-surface border p-2 overflow-y-auto');
    panel.style.position = 'absolute';
    panel.style.left = '0';
    panel.style.right = '0';
    panel.style.top = '100%';
    panel.style.marginTop = '0.25rem';
    panel.style.zIndex = '30';
    panel.style.maxHeight = '16rem';
    panel.style.display = 'none';
    panel.style.borderColor = 'var(--lsky-border, #e9ecf0)';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-multiselectable', 'true');

    var boxes = [];

    function addRow(opt) {
      var row = make('label', 'flex items-center gap-2 cursor-pointer text-sm');
      row.style.padding = '0.375rem 0.5rem';
      row.style.borderRadius = '0.375rem';
      row.addEventListener('mouseenter', function () {
        row.style.background = 'var(--lsky-surface-2, #fafbfc)';
      });
      row.addEventListener('mouseleave', function () {
        row.style.background = '';
      });

      var box = make('input', 'w-5 h-5');
      box.type = 'checkbox';
      box.value = opt.v;
      box.setAttribute('data-label', opt.t);
      // 点选时浏览器会在勾框外面画一圈聚焦环 —— 去掉它，勾没勾上本身就够清楚了
      box.style.outline = 'none';
      box.style.boxShadow = 'none';

      var text = make('span', 'truncate');
      text.style.minWidth = '0';
      text.textContent = opt.t;

      row.appendChild(box);
      row.appendChild(text);
      panel.appendChild(row);
      boxes.push(box);
    }

    for (var i = 0; i < options.length; i++) addRow(options[i]);

    // --- hidden inputs mirroring the selection ---
    var values = make('div', 'export-dropdown-values');

    function rebuildValues() {
      while (values.firstChild) values.removeChild(values.firstChild);
      for (var j = 0; j < boxes.length; j++) {
        if (!boxes[j].checked) continue;
        var hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = fieldName;
        hidden.value = boxes[j].value;
        values.appendChild(hidden);
      }
    }

    function selectedNames() {
      var names = [];
      for (var k = 0; k < boxes.length; k++) {
        if (!boxes[k].checked) continue;
        var raw = boxes[k].getAttribute('data-label') || boxes[k].value;
        names.push(keepCount ? raw : pdDisplayName(raw));
      }
      return names;
    }

    function renderSummary() {
      var names = selectedNames();
      summary.textContent = pdSummaryText(names, {
        placeholder: placeholder,
        emptyLabel: emptyLabel,
        total: options.length
      });
      if (names.length === 0) {
        summary.classList.remove('text-ink');
        summary.classList.add('text-ink-2');
      } else {
        summary.classList.remove('text-ink-2');
        summary.classList.add('text-ink');
      }
    }

    function sync() {
      rebuildValues();
      renderSummary();
      dispatchChanged();
    }

    function openPanel() {
      if (disabled) return;
      panel.style.display = 'block';
      trigger.setAttribute('aria-expanded', 'true');
      container.setAttribute('data-open', '1');
    }

    function closePanel() {
      panel.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      container.removeAttribute('data-open');
    }

    function togglePanel() {
      if (panel.style.display === 'block') closePanel();
      else openPanel();
    }

    function isOpen() {
      return panel.style.display === 'block';
    }

    // Toggling the trigger opens/closes; it must not be treated as an
    // outside click by the document listener below.
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      if (!disabled) togglePanel();
    });

    trigger.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        if (!disabled) togglePanel();
      } else if (key === 'Escape') {
        closePanel();
      }
    });

    // Row clicks toggle the checkbox through the wrapping <label> and keep the
    // panel open, which is what multi-select needs.
    panel.addEventListener('change', function () {
      sync();
    });

    document.addEventListener('click', function (event) {
      if (isOpen() && !container.contains(event.target)) closePanel();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen()) closePanel();
    });

    // The embedded JSON payload element stays in place; it renders as nothing.
    container.appendChild(trigger);
    container.appendChild(panel);
    container.appendChild(values);

    renderSummary();
    rebuildValues();
    return true;
  }

  function init(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('.export-dropdown');
    var built = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (build(nodes[i])) built++;
    }
    return built;
  }

  // Debug helper: current trigger text for a block (element or element id).
  function summary(target) {
    var container = target;
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container || !container.querySelector) return '';
    var node = container.querySelector('.export-dropdown-summary');
    return node ? node.textContent : '';
  }

  window.LskyExportDropdown = {
    init: init,
    summary: summary
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    });
  } else {
    init(document);
  }
})();

        </script>
        <script>
/* Export date filter: single-month calendar + quick range buttons.
 *
 * Zero dependency (native DOM only). No library, no build step.
 *
 * Mount contract (all selectors are configurable through data attributes):
 *   #export-calendar[data-days][data-from][data-to]  calendar host
 *   #export-date-quick  [data-quick]                 quick range buttons
 *   data-from / data-to                              the two <input type=date>
 *   #export-date-summary                             human readable summary
 *
 * Image counts: data-days is a JSON object { "Y-m-d": count }. An empty object
 * (or invalid JSON) is tolerated: the calendar still works and every day stays
 * clickable, only the per-day count badges are absent.
 *
 * Any range change (including clear) dispatches on document:
 *   new CustomEvent('export:filters-changed', { detail: { from, to } })
 *
 * Public API: window.LskyExportCalendar = { init(), setRange(from, to), clear(), state() }
 */
(function () {
  'use strict';

  // #region pure-date-helpers
  // Pure date helpers: no DOM, no globals, no side effects. selfcheck.mjs
  // extracts this exact region and asserts behaviour against it.
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // Local 'Y-m-d'. Never use toISOString(): that returns UTC and would shift
  // the day by one for positive UTC offsets.
  function formatLocalDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseYmd(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  // Monday-first column index of a Date: 0 = Monday ... 6 = Sunday.
  function mondayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  // Weeks for one month (month = 1..12, Monday-first). Returns an array of
  // weeks; each week is 7 cells. A cell is null (padding) or { day, ymd }.
  function monthGrid(year, month) {
    var lead = mondayIndex(new Date(year, month - 1, 1));
    var daysInMonth = new Date(year, month, 0).getDate();
    var cells = [];
    var i, day;
    for (i = 0; i < lead; i++) cells.push(null);
    for (day = 1; day <= daysInMonth; day++) {
      cells.push({ day: day, ymd: formatLocalDate(new Date(year, month - 1, day)) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    var weeks = [];
    for (i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  // Inclusive range stats between two 'Y-m-d' bounds (either may be null).
  // Returns { days, photos }: calendar days in the range and the summed image
  // count of every day that has data. Reversed bounds are sorted first.
  function rangeOf(daysMap, from, to) {
    var a = parseYmd(from);
    var b = parseYmd(to);
    if (!a || !b) return { days: 0, photos: 0 };
    if (a > b) { var swap = a; a = b; b = swap; }
    var map = daysMap || {};
    var days = 0, photos = 0;
    var cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    while (cur <= b) {
      days += 1;
      var n = Number(map[formatLocalDate(cur)]);
      if (isFinite(n) && n > 0) photos += n;
      cur = addDays(cur, 1);
    }
    return { days: days, photos: photos };
  }

  // Quick range boundaries. kind is one of today|week|month|year|clear and
  // today is a local 'Y-m-d' string. Returns [from, to]; clear yields [null, null].
  // week / month / year all end at today and start at the period boundary.
  function quickRange(kind, today) {
    var t = parseYmd(today);
    if (!t) return [null, null];
    var y = t.getFullYear(), m = t.getMonth();
    switch (kind) {
      case 'today':
        return [today, today];
      case 'week':
        return [formatLocalDate(addDays(t, -mondayIndex(t))), today];
      case 'month':
        return [formatLocalDate(new Date(y, m, 1)), today];
      case 'year':
        return [formatLocalDate(new Date(y, 0, 1)), today];
      default:
        return [null, null];
    }
  }
  // #endregion pure-date-helpers

  // ---- presentation constants (inline styles only, see CSS note below) ----
  // The theme does not expose the utility classes for grid gaps, hover or
  // disabled opacity, so every one of those is written as an inline style.
  var ACCENT = '#2563eb';
  var ACCENT_TINT = 'rgba(37, 99, 235, 0.14)';
  var ACCENT_HOVER = 'rgba(37, 99, 235, 0.08)';
  var ACCENT_RING = 'rgba(37, 99, 235, 0.55)';

  var WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  var current = null;

  // Parse data-days defensively; anything unusable degrades to "no counts".
  function toDaysMap(raw) {
    var out = {};
    if (!raw) return out;
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return out; }
    if (!obj || typeof obj !== 'object') return out;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      var n = Number(obj[k]);
      if (isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  }

  // Latest 'Y-m-d' key, or null. ISO strings sort lexicographically.
  function latestYmd(map) {
    var best = null;
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (best === null || k > best) best = k;
    }
    return best;
  }

  function el(tag, attrs, css, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var a in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, a)) node.setAttribute(a, attrs[a]);
      }
    }
    if (css) node.style.cssText = css;
    if (text != null) node.textContent = text;
    return node;
  }

  function createInstance(root) {
    var daysMap = toDaysMap(root.getAttribute('data-days'));
    var hasData = Object.keys(daysMap).length > 0;

    var fromInput = document.querySelector(root.getAttribute('data-from') || '#export-date-from');
    var toInput = document.querySelector(root.getAttribute('data-to') || '#export-date-to');
    var summaryEl = document.getElementById('export-date-summary');
    var quickRoot = document.getElementById('export-date-quick');

    var from = null, to = null;
    var view; // { year, month } month shown in the grid

    // Default view: the most recent month that has images, else this month.
    var seedYmd = latestYmd(daysMap);
    var seed = seedYmd ? parseYmd(seedYmd) : new Date();
    view = { year: seed.getFullYear(), month: seed.getMonth() + 1 };

    // ---- skeleton (rebuilt once; the grid is repainted on every change) ----
    root.innerHTML = '';

    var header = el('div', null,
      'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;');
    var prevBtn = el('button', { type: 'button', 'data-nav': '-1', 'aria-label': '上一月' },
      'background:transparent;border:0;padding:2px 10px;border-radius:6px;font-size:16px;line-height:1;',
      '\u2039');
    prevBtn.className = 'cursor-pointer text-ink-2';
    // 年月快选：年份/月份文字本身就是按钮，点开就地列出可选项（文案旁边带下拉箭头）
    var titleWrap = el('div', null, 'position:relative;display:flex;align-items:center;gap:2px;');
    titleWrap.className = 'text-sm font-medium text-ink';
    var PICK_BTN_CSS = 'display:inline-flex;align-items:center;gap:4px;background:transparent;border:0;' +
      'padding:2px 5px;border-radius:6px;font:inherit;color:inherit;line-height:1.5;';
    // white-space:nowrap：否则 4 列布局里「10月/11月/12月」会被折成两行
    var PICK_CELL_CSS = 'background:transparent;border:0;padding:5px 6px;border-radius:6px;cursor:pointer;' +
      'font-size:12.5px;line-height:1.35;color:inherit;white-space:nowrap;';
    var PICK_PANEL_CSS = 'position:absolute;top:calc(100% + 4px);left:0;z-index:30;display:none;padding:6px;' +
      'border-radius:10px;background:var(--lsky-surface);border:1px solid var(--lsky-border);' +
      'box-shadow:var(--lsky-shadow-pop);gap:4px;';
    var yearText = el('span', null, null, '');
    var monthText = el('span', null, null, '');
    function pickButton(kind, label, textNode) {
      var btn = el('button', { type: 'button', 'data-pick': kind, 'aria-haspopup': 'true',
        'aria-expanded': 'false', 'aria-label': label }, PICK_BTN_CSS);
      btn.className = 'cursor-pointer text-ink';
      btn.appendChild(textNode);
      btn.appendChild(el('span', null, 'font-size:12px;line-height:1;opacity:.75;', '\u25be'));
      return btn;
    }
    var yearBtn = pickButton('year', '选择年份', yearText);
    var monthBtn = pickButton('month', '选择月份', monthText);
    var yearPanel = el('div', { 'data-pick-panel': 'year' },
      PICK_PANEL_CSS + 'grid-template-columns:repeat(3,1fr);max-height:164px;overflow-y:auto;');
    var monthPanel = el('div', { 'data-pick-panel': 'month' },
      PICK_PANEL_CSS + 'grid-template-columns:repeat(4,1fr);');
    titleWrap.appendChild(yearBtn);
    titleWrap.appendChild(monthBtn);
    titleWrap.appendChild(yearPanel);
    titleWrap.appendChild(monthPanel);
    var openPick = null;
    var nextBtn = el('button', { type: 'button', 'data-nav': '1', 'aria-label': '下一月' },
      'background:transparent;border:0;padding:2px 10px;border-radius:6px;font-size:16px;line-height:1;',
      '\u203a');
    nextBtn.className = 'cursor-pointer text-ink-2';
    header.appendChild(prevBtn);
    header.appendChild(titleWrap);
    header.appendChild(nextBtn);

    var weekRow = el('div', null, 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;');
    weekRow.className = 'grid';
    for (var i = 0; i < WEEKDAY_LABELS.length; i++) {
      var label = el('div', null, 'text-align:center;font-size:11px;line-height:2;', WEEKDAY_LABELS[i]);
      label.className = 'text-ink-2';
      weekRow.appendChild(label);
    }

    var grid = el('div', null,
      'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:2px;');
    grid.className = 'grid';

    var hint = el('div', null, 'font-size:11px;line-height:1.6;margin-top:4px;color:currentColor;opacity:.6;',
      '有数字的日期表示当天存过图片');
    hint.className = 'text-ink-2';

    root.appendChild(header);
    root.appendChild(weekRow);
    root.appendChild(grid);
    root.appendChild(hint);

    function todayYmd() {
      return formatLocalDate(new Date());
    }

    function dayCell(ymd, day) {
      var clickable = hasData ? !!daysMap[ymd] : true;
      var isEdge = (from !== null && ymd === from) || (to !== null && ymd === to);
      var inRange = from !== null && to !== null && ymd >= from && ymd <= to;

      var node = document.createElement('div');
      node.setAttribute('data-ymd', ymd);
      node.setAttribute('data-clickable', clickable ? '1' : '0');
      node.setAttribute('data-selected', isEdge ? '1' : '0');
      node.setAttribute('role', 'button');

      var css = 'position:relative;height:32px;border-radius:6px;display:flex;' +
        'align-items:center;justify-content:center;font-size:13px;line-height:1;' +
        'user-select:none;transition:background .12s ease;';
      var baseBg = 'transparent';
      if (isEdge) {
        css += 'background:' + ACCENT + ';color:#fff;font-weight:600;';
        baseBg = ACCENT;
      } else if (inRange) {
        css += 'background:' + ACCENT_TINT + ';';
        baseBg = ACCENT_TINT;
      } else if (clickable) {
        css += 'cursor:pointer;';
      } else {
        css += 'opacity:.3;cursor:default;';
      }
      node.dataset.baseBg = baseBg;
      node.style.cssText = css;

      if (!isEdge && ymd === todayYmd()) {
        node.style.boxShadow = 'inset 0 0 0 1px ' + ACCENT_RING;
      }
      if (clickable) node.setAttribute('tabindex', '0');

      node.appendChild(el('span', null, null, String(day)));

      if (hasData && daysMap[ymd] > 0) {
        var badge = el('span', null,
          'position:absolute;right:3px;bottom:1px;font-size:10px;line-height:1;',
          String(daysMap[ymd]));
        badge.className = 'text-ink-2';
        if (isEdge) badge.style.color = 'rgba(255,255,255,.85)';
        node.appendChild(badge);
      }
      return node;
    }

    function paint() {
      yearText.textContent = view.year + '年';
      monthText.textContent = view.month + '月';
      var weeks = monthGrid(view.year, view.month);
      grid.innerHTML = '';
      for (var w = 0; w < weeks.length; w++) {
        for (var c = 0; c < weeks[w].length; c++) {
          var cell = weeks[w][c];
          if (!cell) { grid.appendChild(document.createElement('div')); continue; }
          grid.appendChild(dayCell(cell.ymd, cell.day));
        }
      }
    }

    function writeInputs() {
      if (fromInput) fromInput.value = from || '';
      if (toInput) toInput.value = to || '';
    }

    function writeSummary() {
      if (!summaryEl) return;
      var text;
      if (!from && !to) {
        text = '未选择日期';
      } else if (from && !to) {
        text = from + ' 之后';
      } else if (!from && to) {
        text = to + ' 之前';
      } else {
        var r = rangeOf(daysMap, from, to);
        text = from + ' ~ ' + to + '，共 ' + r.days + ' 天';
        if (hasData) text += '（含 ' + r.photos + ' 张图）';
      }
      summaryEl.textContent = text;
    }

    function getState() {
      return { from: from, to: to };
    }

    function emit() {
      try {
        document.dispatchEvent(new CustomEvent('export:filters-changed', { detail: getState() }));
      } catch (e) { /* CustomEvent unsupported: nothing to do */ }
    }

    function commit(moveView) {
      if (moveView && from) {
        var d = parseYmd(from);
        if (d) view = { year: d.getFullYear(), month: d.getMonth() + 1 };
      }
      writeInputs();
      paint();
      writeSummary();
      emit();
    }

    function applyRange(f, t, moveView) {
      from = parseYmd(f) ? f : null;
      to = parseYmd(t) ? t : null;
      if (from && to && from > to) { var s = from; from = to; to = s; }
      commit(!!moveView);
    }

    // Click progression: 1st click = start, 2nd click = end (sorted),
    // 3rd click restarts with a fresh start.
    function pickDay(ymd) {
      if (from === null && to === null) {
        from = ymd;
        to = null;
      } else if (from !== null && to === null) {
        if (ymd < from) { to = from; from = ymd; } else { to = ymd; }
      } else {
        from = ymd;
        to = null;
      }
      commit(false);
    }

    function shiftMonth(delta) {
      var m = view.month - 1 + delta;
      var y = view.year + Math.floor(m / 12);
      m = ((m % 12) + 12) % 12;
      view = { year: y, month: m + 1 };
      paint();
    }

    // 年份候选：有上传记录的年份范围 ∪ 当前视图年 ∪ 今年（没有记录时给视图年 ±3）
    function yearOptions() {
      var min = null, max = null;
      for (var k in daysMap) {
        if (!Object.prototype.hasOwnProperty.call(daysMap, k)) continue;
        var y = Number(k.slice(0, 4));
        if (min === null || y < min) min = y;
        if (max === null || y > max) max = y;
      }
      var thisYear = new Date().getFullYear();
      if (min === null) { min = view.year - 3; max = view.year + 3; }
      min = Math.min(min, view.year, thisYear);
      max = Math.max(max, view.year, thisYear);
      var out = [];
      for (var yy = max; yy >= min; yy--) out.push({ value: yy, label: yy + '年', selected: yy === view.year });
      return out;
    }

    function monthOptions() {
      var out = [];
      for (var mm = 1; mm <= 12; mm++) out.push({ value: mm, label: mm + '月', selected: mm === view.month });
      return out;
    }

    function fillPanel(panel, items) {
      panel.innerHTML = '';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var cell = el('button', { type: 'button', 'data-pick-value': String(it.value) }, PICK_CELL_CSS, it.label);
        if (it.selected) {
          cell.style.background = ACCENT;
          cell.style.color = '#fff';
          cell.style.fontWeight = '600';
          cell.setAttribute('aria-selected', 'true');
        }
        cell.addEventListener('mouseenter', function () {
          if (this.getAttribute('aria-selected') === 'true') return;
          this.style.background = ACCENT_HOVER;
        });
        cell.addEventListener('mouseleave', function () {
          if (this.getAttribute('aria-selected') === 'true') return;
          this.style.background = 'transparent';
        });
        panel.appendChild(cell);
      }
    }

    function closePicks() {
      yearPanel.style.display = 'none';
      monthPanel.style.display = 'none';
      yearBtn.setAttribute('aria-expanded', 'false');
      monthBtn.setAttribute('aria-expanded', 'false');
      openPick = null;
    }

    function togglePick(kind) {
      var wasOpen = openPick === kind;
      closePicks();
      if (wasOpen) return;
      var panel = kind === 'year' ? yearPanel : monthPanel;
      var btn = kind === 'year' ? yearBtn : monthBtn;
      fillPanel(panel, kind === 'year' ? yearOptions() : monthOptions());
      panel.style.display = 'grid';
      btn.setAttribute('aria-expanded', 'true');
      openPick = kind;
    }

    function closestFrom(target, selector) {
      if (!target || !target.closest) return null;
      return target.closest(selector);
    }

    grid.addEventListener('click', function (e) {
      var cell = closestFrom(e.target, '[data-ymd]');
      if (!cell) return;
      var ymd = cell.getAttribute('data-ymd');
      if (hasData && !daysMap[ymd]) return;
      pickDay(ymd);
    });

    grid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var cell = closestFrom(e.target, '[data-ymd]');
      if (!cell) return;
      var ymd = cell.getAttribute('data-ymd');
      if (hasData && !daysMap[ymd]) return;
      e.preventDefault();
      pickDay(ymd);
    });

    grid.addEventListener('mouseover', function (e) {
      var cell = closestFrom(e.target, '[data-ymd]');
      if (!cell) return;
      if (cell.getAttribute('data-selected') === '1') return;
      if (cell.getAttribute('data-clickable') === '0') return;
      cell.style.background = ACCENT_HOVER;
    });

    grid.addEventListener('mouseout', function (e) {
      var cell = closestFrom(e.target, '[data-ymd]');
      if (!cell) return;
      if (e.relatedTarget && cell.contains(e.relatedTarget)) return;
      if (cell.getAttribute('data-selected') === '1') return;
      cell.style.background = cell.dataset.baseBg || '';
    });

    root.addEventListener('click', function (e) {
      var nav = closestFrom(e.target, '[data-nav]');
      if (nav) {
        shiftMonth(Number(nav.getAttribute('data-nav')) || 0);
        return;
      }
      var pick = closestFrom(e.target, '[data-pick]');
      if (pick) {
        togglePick(pick.getAttribute('data-pick'));
        return;
      }
      var pickCell = closestFrom(e.target, '[data-pick-value]');
      if (pickCell) {
        // 年月快选只跳视图，不动已选区间
        if (openPick === 'year') view.year = Number(pickCell.getAttribute('data-pick-value'));
        else if (openPick === 'month') view.month = Number(pickCell.getAttribute('data-pick-value'));
        closePicks();
        paint();
        return;
      }
      closePicks();   // 点日历空白处收起快选面板
    });

    // 点日历外面 / 按 Esc 也收起
    document.addEventListener('click', function (e) {
      if (openPick && !titleWrap.contains(e.target)) closePicks();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closePicks();
    });

    if (quickRoot) {
      quickRoot.addEventListener('click', function (e) {
        var btn = closestFrom(e.target, '[data-quick]');
        if (!btn) return;
        var bounds = quickRange(btn.getAttribute('data-quick'), todayYmd());
        applyRange(bounds[0], bounds[1], true);
      });
    }

    function onInputChange() {
      applyRange(
        fromInput && fromInput.value ? fromInput.value : null,
        toInput && toInput.value ? toInput.value : null,
        false
      );
    }
    if (fromInput) fromInput.addEventListener('change', onInputChange);
    if (toInput) toInput.addEventListener('change', onInputChange);

    // Initial render.
    paint();
    writeInputs();
    writeSummary();

    return {
      root: root,
      setRange: function (f, t) { applyRange(f, t, true); },
      clear: function () { applyRange(null, null, false); },
      state: getState,
      refresh: function () { paint(); writeSummary(); }
    };
  }

  // Idempotent: repeated calls return the instance bound to the host element.
  function init() {
    var root = document.getElementById('export-calendar');
    if (!root) return null;
    if (root.__lskyExportCalendar) return root.__lskyExportCalendar;
    var inst = createInstance(root);
    root.__lskyExportCalendar = inst;
    current = inst;
    return inst;
  }

  // Emit one baseline event so listeners can render the initial summary line.
  function boot() {
    var inst = init();
    if (!inst) return;
    try {
      document.dispatchEvent(new CustomEvent('export:filters-changed', { detail: inst.state() }));
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.LskyExportCalendar = {
    init: init,
    setRange: function (from, to) { if (current) current.setRange(from, to); },
    clear: function () { if (current) current.clear(); },
    state: function () { return current ? current.state() : { from: null, to: null }; }
  };
})();

        </script>
    @endpush

    @push('scripts')
        <script>
            // 筛选条件一变就刷新「共 N 张 / 约 X」的摘要（防抖 400ms，复用预检接口）
            (function () {
                const EXPORT_PREVIEW_URL = '{{ route('settings.export.preview') }}';
                const $summary = $('#export-preview-summary');
                if (! $summary.length) { return; }

                let debounceTimer = null;
                let requestSeq = 0;

                const prettySize = (bytes) => {
                    if (! bytes) { return '0 B'; }
                    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
                    let value = bytes;
                    let index = 0;
                    while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
                    return (index === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[index];
                };

                // 与导出用的是同一套参数名：控件 name → URLSearchParams，空值一律不传
                const collectSearch = () => {
                    const search = new URLSearchParams();
                    $('#export-filters').find('select, input').each(function () {
                        if (! this.name) { return; }
                        const value = $(this).val();
                        if (value === null || value === undefined || value === '') { return; }
                        if (Array.isArray(value)) {
                            const name = this.name;
                            value.forEach(item => search.append(name, item));
                            return;
                        }
                        search.append(this.name, value);
                    });
                    return search;
                };

                const refresh = () => {
                    const seq = ++requestSeq;
                    axios.get(EXPORT_PREVIEW_URL, {params: collectSearch()}).then(response => {
                        // 只认最后一次请求的结果：先发后到的响应直接丢掉
                        if (seq !== requestSeq) { return; }
                        const data = response.data || {};
                        if (data.busy) {
                            $summary.text('已有导出任务在进行中，等它结束再导出');
                            return;
                        }
                        $summary.text('共 ' + (parseInt(data.count, 10) || 0) + ' 张 / 约 ' + prettySize(parseInt(data.bytes, 10) || 0));
                    }).catch(() => {
                        if (seq === requestSeq) { $summary.text(''); }
                    });
                };

                // 下拉与月历改完值都会派发这个事件
                document.addEventListener('export:filters-changed', () => {
                    window.clearTimeout(debounceTimer);
                    debounceTimer = window.setTimeout(refresh, 400);
                });

                refresh();
            })();
        </script>
    @endpush

</x-app-layout>
