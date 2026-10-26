@section('title', '存储策略管理')

<x-app-layout>
    <div class="my-6 md:my-9">
        <form action="{{ route('admin.strategies') }}" method="get">
            <div class="mb-3 flex justify-between w-full gap-4">
                <x-button type="button" onclick="window.location.href = '{{ route('admin.strategy.create') }}'">创建存储策略</x-button>
                <input class="px-2 text-sm rounded-md ls-input h-9 text-[13px]" name="keywords" placeholder="输入名称回车搜索..." value="{{ request('keywords') }}" />
            </div>
        </form>

        <x-table :columns="['ID', '名称', '驱动', '图片数量', '已使用存储', '操作']">
            @foreach($strategies as $strategy)
            <tr data-id="{{ $strategy->id }}" data-images-count="{{ $strategy->images_count }}">
                <td class="px-6 py-4 whitespace-nowrap">{{ $strategy->id }}</td>
                <td class="px-6 py-4 whitespace-nowrap name">{{ $strategy->name }}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="rounded-md bg-sky-500 text-sm text-white py-1 px-4">
                        {{ \App\Models\Strategy::DRIVERS[$strategy->key] }}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">{{ $strategy->images_count }}</td>
                <td class="px-6 py-4 whitespace-nowrap">{{ \App\Utils::formatSize($strategy->images_sum_size * 1024) }}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                    <a href="{{ route('admin.strategy.edit', ['id' => $strategy->id]) }}" class="text-brand hover:opacity-80">编辑</a>
                    <a href="javascript:void(0)" data-operate="delete" class="text-danger hover:opacity-80">删除</a>
                    @if($strategy->images_count > 0)
                        <a href="javascript:void(0)" data-operate="purge" class="text-danger hover:opacity-80">清空图片</a>
                    @endif
                </td>
            </tr>
            @endforeach
        </x-table>
        @if($strategies->isEmpty())
            <x-no-data message="没有找到任何存储策略"/>
        @else
            <div class="mt-4">
                <x-pagination :paginator="$strategies" />
            </div>
        @endif
    </div>

    @push('scripts')
        <script>
            // 清空某个存储策略内的全部图片（为下线策略做准备）
            function purgeStrategyImages($row) {
                let id = $row.data('id');
                let name = $row.find('td.name').text();
                let total = parseInt($row.attr('data-images-count'), 10) || 0;

                Swal.fire({
                    icon: 'warning',
                    title: `清空存储策略【${name}】的图片？`,
                    html: `<div style="text-align:left">该策略内共有 <b>${total}</b> 张图片，删除后无法恢复。<br><br>`
                        + '<div style="display:flex;align-items:center;justify-content:flex-start;gap:6px">'
                        + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">'
                        + '<input type="checkbox" id="purge-delete-files"> 同时删除存储里的物理文件</label>'
                        + '<button type="button" id="purge-help-btn" title="不勾选则只删图床数据库记录，适合存储已不可达或希望保留存储内图片的情况" aria-label="说明"'
                        + ' style="flex:0 0 auto;width:16px;height:16px;padding:0;border-radius:50%;border:1px solid var(--lsky-border-2);'
                        + 'background:transparent;color:var(--lsky-text-3);font-size:11px;line-height:1;cursor:pointer"'
                        + ' onclick="var h=document.getElementById(\'purge-help\');h.style.display=(h.style.display===\'none\'?\'block\':\'none\')">?</button>'
                        + '</div>'
                        + '<div id="purge-help" style="display:none;margin-top:6px;font-size:13px;color:var(--lsky-text-2)">'
                        + '不勾选则只删图床数据库记录，适合存储已不可达或希望保留存储内图片的情况</div>'
                        + '<div style="margin-top:12px">请输入 <b>确认删除</b> 后继续</div></div>'
                        + '<style>#purge-delete-files{outline:none!important;box-shadow:none!important}'
                        + '#purge-delete-files:focus,#purge-delete-files:focus-visible{outline:none!important;box-shadow:none!important}</style>',
                    input: 'text',
                    inputPlaceholder: '确认删除',
                    showCancelButton: true,
                    customClass: {confirmButton: 'ls-swal-danger'},
                    confirmButtonText: '开始清空',
                    cancelButtonText: '取消',
                    preConfirm: function (value) {
                        if ((value || '').trim() !== '确认删除') {
                            Swal.showValidationMessage('请输入「确认删除」');
                            return false;
                        }
                        return {deleteFiles: $('#purge-delete-files').prop('checked')};
                    }
                }).then(function (result) {
                    if (!result.isConfirmed) {
                        return;
                    }
                    runPurge(id, total, result.value.deleteFiles);
                });
            }

            function runPurge(id, total, deleteFiles) {
                let cursor = 0;
                let snapshot = 0;
                let deleted = 0;
                let lastCursor = -1;
                let limit = deleteFiles ? 20 : 200;

                Swal.fire({
                    title: '正在清空…',
                    html: `已删除 <b>0</b> / ${total} 张`,
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: function () {
                        Swal.showLoading();
                    }
                });

                let step = function () {
                    axios.post(`/admin/strategies/${id}/purge-images`, {
                        confirm: '确认删除',
                        delete_files: deleteFiles,
                        cursor: cursor,
                        snapshot: snapshot,
                        limit: limit
                    }).then(function (response) {
                        if (!response.data.status) {
                            throw new Error(response.data.message || '删除失败');
                        }

                        let data = response.data.data;
                        deleted += data.deleted;
                        lastCursor = cursor;
                        cursor = data.cursor;
                        snapshot = data.snapshot;

                        Swal.update({html: `已删除 <b>${deleted}</b> / ${total} 张`});

                        // 有一批一张都没删掉、游标也没前进 => 停手，别在这里空转
                        if (data.deleted === 0 && cursor === lastCursor) {
                            throw new Error('删除没有进展，已停止。请刷新页面后重试。');
                        }

                        if (data.done) {
                            Swal.fire({
                                icon: 'success',
                                title: '已清空',
                                html: `共删除 <b>${deleted}</b> 张图片。<br>该存储策略的图片数量已归零，现在可以删除它了。`,
                                showCancelButton: false,
                                confirmButtonText: '刷新页面'
                            }).then(function () {
                                history.go(0);
                            });
                            return;
                        }

                        setTimeout(step, 60);
                    }).catch(function (error) {
                        let message = error.response && error.response.data && error.response.data.message
                            ? error.response.data.message
                            : (error.message || '删除失败');
                        Swal.fire({
                            icon: 'error',
                            title: '清空中断',
                            text: `${message}（已删除 ${deleted} 张，刷新后可继续）`,
                            showCancelButton: false,
                            confirmButtonText: '刷新页面'
                        }).then(function () {
                            history.go(0);
                        });
                    });
                };

                step();
            }

            $('[data-operate="purge"]').click(function () {
                purgeStrategyImages($(this).closest('tr'));
            });

            $('[data-operate="delete"]').click(function () {
                let $row = $(this).closest('tr');
                let name = $row.find('td.name').text();
                let imagesCount = parseInt($row.attr('data-images-count'), 10) || 0;

                // 策略里还有图片就只提示、不发请求，避免删掉策略后图片失去归属
                if (imagesCount > 0) {
                    Swal.fire({
                        icon: 'warning',
                        title: `无法删除存储策略【${name}】`,
                        html: `该存储策略内已有 <b>${imagesCount}</b> 张图片，无法直接删除。<br>如需删除，请先清空该存储策略内的所有图片。`,
                        showCancelButton: false,
                        confirmButtonText: '知道了'
                    });
                    return;
                }

                Swal.fire({
                    title: `确认删除存储策略【${name}】吗?`,
                    text: "如果某个组下面没有存储策略，该组下面的用户将无法上传图片。",
                    icon: 'warning',
                    showCancelButton: true,
                    customClass: {confirmButton: 'ls-swal-danger'},
                    confirmButtonText: '确认删除',
                }).then((result) => {
                    if (result.isConfirmed) {
                        let id = $row.data('id');
                        axios.delete(`/admin/strategies/${id}`).then(response => {
                            if (response.data.status) {
                                history.go(0);
                            } else {
                                toastr.error(response.data.message);
                            }
                        });
                    }
                })
            });
        </script>
    @endpush

</x-app-layout>
