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
                            <label for="name" class="block text-sm font-medium text-ink">昵称</label>
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

        {{-- 批量导出：独立卡片，不放进上面那个 settings.update 表单（页面脚本按 form 选择器统一接管提交） --}}
        <div class="mt-6 overflow-hidden sm:rounded-md shadow-card">
            <div class="px-3 py-4 bg-surface sm:p-6">
                <p class="mb-3 font-semibold text-lg text-ink">批量导出</p>
                {{-- 控件的 name 就是导出接口的参数名，空值不传 ⇒ 该维度不限 --}}
                <div id="export-filters" class="grid grid-cols-6 gap-6">
                    <div class="col-span-6">
                        <p class="text-sm text-ink-2">不选择任何条件 = 导出全部图片</p>
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <label for="export-album-ids" class="block text-sm font-medium text-ink">相册</label>
                        <x-select id="export-album-ids" name="album_ids[]" multiple size="6">
                            <option value="0">未分类 ({{ $uncategorizedNum }})</option>
                            @foreach(Auth::user()->albums as $album)
                                <option value="{{ $album->id }}">{{ $album->name }} ({{ $album->image_num }})</option>
                            @endforeach
                        </x-select>
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <label for="export-tag-ids" class="block text-sm font-medium text-ink">标签</label>
                        @if(Auth::user()->tags->isEmpty())
                            <p class="mt-1 text-sm text-ink-2">暂无标签</p>
                        @else
                            <x-select id="export-tag-ids" name="tag_ids[]" multiple size="6">
                                @foreach(Auth::user()->tags as $tag)
                                    <option value="{{ $tag->id }}">{{ $tag->name }} ({{ $tagCounts[$tag->id] ?? 0 }})</option>
                                @endforeach
                            </x-select>
                        @endif
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <label for="export-strategy-ids" class="block text-sm font-medium text-ink">存储策略</label>
                        @if(Auth::user()->group && Auth::user()->group->strategies->isNotEmpty())
                            <x-select id="export-strategy-ids" name="strategy_ids[]" multiple size="6">
                                @foreach(Auth::user()->group->strategies as $strategy)
                                    <option value="{{ $strategy->id }}">{{ $strategy->name }} ({{ $strategyCounts[$strategy->id] ?? 0 }})</option>
                                @endforeach
                            </x-select>
                        @else
                            <p class="mt-1 text-sm text-ink-2">暂无策略</p>
                        @endif
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <label for="export-date-from" class="block text-sm font-medium text-ink">上传日期（起）</label>
                        <x-input type="date" id="export-date-from" name="date_from"/>
                    </div>

                    <div class="col-span-6 sm:col-span-3">
                        <label for="export-date-to" class="block text-sm font-medium text-ink">上传日期（止）</label>
                        <x-input type="date" id="export-date-to" name="date_to"/>
                    </div>

                    <div class="col-span-6 text-sm text-ink-2">
                        <p class="font-medium text-ink">导出说明</p>
                        <p>· 原图导出，系统自动打包为 zip 压缩包。</p>
                        <p>· 导出采用流式传输，导出期间请不要关闭或刷新页面，确保网络稳定。中途中断或网络波动需要重新导出，不支持断点续传。</p>
                        <p>· 同一账号同时只能有一个导出任务在进行。</p>
                        <p>· 图片较多时下载比较久，大批量导出请预留充足时间。中断后浏览器可能残留未完成的临时下载文件，请自行清理。</p>
                        <p id="export-result" class="hidden mt-2 font-medium text-ink"></p>
                    </div>
                </div>
                <div class="px-4 py-3 text-right sm:px-6">
                    <x-button type="button" id="export-submit">打包下载</x-button>
                </div>
            </div>
        </div>
    </div>

    @push('scripts')
        <script>
            $('form').submit(function (e) {
                e.preventDefault();
                axios.put(this.action, $(this).serialize()).then(response => {
                    toastr[response.data.status ? 'success' : 'warning'](response.data.message);
                });
            });
        </script>
    @endpush

    @push('scripts')
        <script>
            // 批量导出：预检数量与体积 → 二次确认 → 浏览器原生下载 → 轮询导出结果
            (function () {
                const EXPORT_PREVIEW_URL = '{{ route('settings.export.preview') }}';
                const EXPORT_URL = '{{ route('settings.export') }}';
                const EXPORT_RESULT_URL = '{{ route('settings.export.result') }}';
                const POLL_INTERVAL = 15000;      // 轮询间隔 15 秒
                const POLL_MAX = 60;              // 最多轮询 60 次
                const BUTTON_DISABLE_MS = 3000;   // 发起后按钮禁用时长

                const $button = $('#export-submit');
                const $result = $('#export-result');

                // 展示中的那条结果是哪一次导出：轮询靠它区分「本次」与进页面时读到的旧记录
                let lastStartedAt = null;
                let pollTimer = null;
                let pollCount = 0;

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
                        return '本次导出已中断（取消或网络断开），已完成 ' + ok + ' 张。需要重新导出。';
                    }
                    if (failed > 0) {
                        return '本次导出已完成：' + ok + ' 张成功，' + failed + ' 张失败 —— 详见包内 _export_failures.txt';
                    }
                    return '本次导出已完成：' + ok + ' 张（约 ' + formatSize(bytes) + '）';
                };

                const showResult = (text) => { $result.text(text).removeClass('hidden'); };

                // 结果接口无记录时返回 null；这里再兜一层：字段全空的对象同样当作没有记录
                const hasRecord = (data) => Boolean(data) && Boolean(
                    data.started_at || data.finished_at || data.total || data.ok || data.failed || data.bytes || data.aborted
                );

                const stopPolling = () => {
                    if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null; }
                };

                const pollOnce = () => {
                    axios.get(EXPORT_RESULT_URL).then(response => {
                        const data = response.data;
                        // 进页面时已有记录 ⇒ 只有 started_at 变了才是本次导出
                        if (hasRecord(data) && (lastStartedAt === null || data.started_at !== lastStartedAt)) {
                            lastStartedAt = data.started_at || lastStartedAt;
                            showResult(resultText(data));
                            stopPolling();
                            return;
                        }
                        scheduleNextPoll();
                    }).catch(() => scheduleNextPoll());
                };

                const scheduleNextPoll = () => {
                    pollCount += 1;
                    if (pollCount >= POLL_MAX) {
                        stopPolling();
                        showResult('导出仍在进行或结果暂不可查，稍后刷新本页查看');
                        return;
                    }
                    pollTimer = window.setTimeout(pollOnce, POLL_INTERVAL);
                };

                // 进页面时先展示上一次的导出结果；没有记录就什么都不显示
                axios.get(EXPORT_RESULT_URL).then(response => {
                    const data = response.data;
                    if (! hasRecord(data)) { return; }
                    lastStartedAt = data.started_at || null;
                    showResult(resultText(data));
                }).catch(() => {});

                $button.on('click', () => {
                    const search = collectSearch();
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
                        Swal.fire({
                            // 与页面其它弹窗一致：不动背景页面
                            heightAuto: false,
                            scrollbarPadding: false,
                            title: '确认导出',
                            text: '共 ' + count + ' 张 / 约 ' + formatSize(bytes) + '。导出期间请保持页面开启与网络稳定；中途中断需要重新导出。',
                            icon: 'question',
                            showCancelButton: true,
                            confirmButtonColor: '#3085d6',
                            cancelButtonColor: '#d33',
                            confirmButtonText: '开始导出',
                            cancelButtonText: '取消',
                        }).then(result => {
                            if (! result.isConfirmed) {
                                $button.prop('disabled', false);
                                return;
                            }
                            // 按钮保持禁用一段时间，避免连点重复发起
                            window.setTimeout(() => $button.prop('disabled', false), BUTTON_DISABLE_MS);
                            pollCount = 0;
                            // 用浏览器原生下载（不走 axios blob，大文件不进内存）
                            window.location = EXPORT_URL + (query === '' ? '' : '?' + query);
                            pollTimer = window.setTimeout(pollOnce, POLL_INTERVAL);
                        });
                    }).catch(() => {
                        toastr.warning('导出预检失败，请稍后再试');
                        $button.prop('disabled', false);
                    });
                });
            })();
        </script>
    @endpush

</x-app-layout>
