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
                </td>
            </tr>
            @endforeach
        </x-table>
        @if($strategies->isEmpty())
            <x-no-data message="没有找到任何存储策略"/>
        @else
            <div class="mt-4">
                {{ $strategies->links() }}
            </div>
        @endif
    </div>

    @push('scripts')
        <script>
            $('[data-operate="delete"]').click(function () {
                let $row = $(this).closest('tr');
                let name = $row.find('td.name').text();
                let imagesCount = parseInt($row.attr('data-images-count'), 10) || 0;

                // 策略里还有图片就只提示、不发请求，避免删掉策略后图片失去归属
                if (imagesCount > 0) {
                    Swal.fire({
                        icon: 'warning',
                        title: `无法删除存储策略【${name}】`,
                        html: `该存储策略内已有 <b>${imagesCount}</b> 张图片，无法直接删除。<br>如需删除，请先删除该存储策略内的所有图片。`,
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
