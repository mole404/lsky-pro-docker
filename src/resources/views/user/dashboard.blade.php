@section('title', '仪表盘')

@php
    // 概览数字：图标块 + 弱化标签 + 大号数字（原来是一排 5xl 大图标挤着文字，视觉很乱）
    $cards = [
        ['图片数量', $user->image_num, 'fa-images'],
        ['使用储存', \App\Utils::formatSize($user->use_capacity * 1024), 'fa-database'],
        ['可用储存', \App\Utils::formatSize(($user->capacity - $user->use_capacity) * 1024), 'fa-hdd'],
        ['总储存', \App\Utils::formatSize($user->capacity * 1024), 'fa-server'],
    ];
    // 储存用量进度（capacity 单位是 KB；容量为 0 时不做除法）
    $usedPercent = $user->capacity > 0
        ? min(100, round($user->use_capacity / $user->capacity * 100, 1))
        : 0;
    // 上传限制：原来 8 行竖着堆，改成紧凑的小格子，一眼扫完
    $limits = [
        ['并发', \App\Enums\GroupConfigKey::ConcurrentUploadNum, '张'],
        ['每分钟', \App\Enums\GroupConfigKey::LimitPerMinute, '张'],
        ['每小时', \App\Enums\GroupConfigKey::LimitPerHour, '张'],
        ['每天', \App\Enums\GroupConfigKey::LimitPerDay, '张'],
        ['每周', \App\Enums\GroupConfigKey::LimitPerWeek, '张'],
        ['每月', \App\Enums\GroupConfigKey::LimitPerMonth, '张'],
    ];
@endphp

<x-app-layout>
    <div class="my-6 md:my-9 space-y-4 md:space-y-6">
        {{-- ① 概览数字 --}}
        <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
            @foreach($cards as [$label, $value, $icon])
                <div class="bg-surface rounded-xl p-4 shadow-card">
                    <div class="flex items-center gap-2.5">
                        <span class="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                            <i class="fas {{ $icon }} text-[13px]"></i>
                        </span>
                        <p class="text-ink-2 text-[12.5px] truncate">{{ $label }}</p>
                    </div>
                    <p class="mt-3 text-ink text-[21px] font-semibold tabular-nums truncate">{{ $value }}</p>
                </div>
            @endforeach
        </div>

        {{-- ② 储存用量（侧栏折叠时那块容量信息会藏起来，这里正好补上） --}}
        <div class="bg-surface rounded-xl p-4 md:p-5 shadow-card">
            <div class="flex items-center justify-between gap-4">
                <p class="text-ink text-[13.5px] font-semibold">储存用量</p>
                <p class="text-ink-3 text-[12.5px] tabular-nums">
                    <span class="text-ink font-semibold">{{ \App\Utils::formatSize($user->use_capacity * 1024) }}</span>
                    <span class="mx-0.5">/</span>{{ \App\Utils::formatSize($user->capacity * 1024) }}
                    <span class="ml-2 text-ink-2">{{ $usedPercent }}%</span>
                </p>
            </div>
            <div class="mt-3 h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                <div class="h-full rounded-full bg-brand" style="width: {{ $usedPercent }}%"></div>
            </div>
        </div>

        {{-- ③ 可使用的策略 + 我的信息 --}}
        <div class="grid md:grid-cols-2 gap-4 md:gap-6">
            <x-box>
                <x-slot name="title">可使用的策略</x-slot>
                <x-slot name="content">
                    @if($strategies->isEmpty())
                        <x-no-data message="您所在的组还没有可用的储存策略，请联系管理员。" />
                    @else
                        <p class="px-4 pt-3 text-ink-3 text-[12.5px]">共 {{ $strategies->count() }} 个可用</p>
                        <div class="divide-y divide-line">
                            @foreach ($strategies as $strategy)
                                <div class="w-full px-4 py-3">
                                    <p class="text-ink text-[13.5px] font-medium">{{ $strategy->name }}</p>
                                    @if($strategy->intro)
                                        <p class="mt-0.5 text-ink-3 text-[12.5px]">{{ $strategy->intro }}</p>
                                    @endif
                                </div>
                            @endforeach
                        </div>
                    @endif
                </x-slot>
            </x-box>

            <x-box>
                <x-slot name="title">我的信息</x-slot>
                <x-slot name="content">
                    <div class="px-4 py-3">
                        <div class="divide-y divide-line">
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13px]">姓名</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13px]">{{ $user->name }}</p>
                            </div>
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13px]">邮箱</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13px]">{{ $user->email }}</p>
                            </div>
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13px]">注册时间</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13px] tabular-nums">{{ $user->created_at }}</p>
                            </div>
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13px]">注册 IP</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13px] tabular-nums">{{ $user->registered_ip }}</p>
                            </div>
                        </div>
                        @if(\App\Utils::config(\App\Enums\ConfigKey::IsUserNeedVerify) && !$user->email_verified_at)
                            <p class="mt-3 rounded-lg bg-danger-soft p-3 text-[12.5px] text-danger">
                                你的账号尚未激活，功能受限，请根据激活邮件指引激活账号；如果没有收到邮件，可以点
                                <a id="send-verify-email" href="javascript:void(0)" class="font-semibold underline">这里</a>
                                重新发送。
                            </p>
                        @endif
                    </div>
                </x-slot>
            </x-box>
        </div>

        {{-- ④ 角色组信息 --}}
        <x-box>
            <x-slot name="title">角色组信息</x-slot>
            <x-slot name="content">
                <div class="px-4 py-3">
                    <div class="divide-y divide-line">
                        <div class="flex items-center gap-4 py-2.5">
                            <p class="w-28 shrink-0 text-ink-3 text-[13px]">组名</p>
                            <p class="min-w-0 flex-1 truncate text-ink text-[13px]">{{ $user->group ? $user->group->name : '系统默认组' }}</p>
                        </div>
                        <div class="flex items-center gap-4 py-2.5">
                            <p class="w-28 shrink-0 text-ink-3 text-[13px]">最大文件大小</p>
                            <p class="min-w-0 flex-1 truncate text-ink text-[13px] tabular-nums">{{ \App\Utils::formatSize($configs->get(\App\Enums\GroupConfigKey::MaximumFileSize) * 1024) }}</p>
                        </div>
                    </div>

                    <p class="mt-4 mb-2 text-ink-3 text-[12.5px]">上传限制</p>
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        @foreach($limits as [$label, $key, $unit])
                            <div class="rounded-lg bg-surface-2 px-3 py-2">
                                <p class="text-ink-3 text-[11.5px]">{{ $label }}</p>
                                <p class="mt-0.5 text-ink text-[14px] font-semibold tabular-nums">
                                    {{ $configs->get($key) }}<span class="ml-0.5 text-ink-3 text-[11.5px] font-normal">{{ $unit }}</span>
                                </p>
                            </div>
                        @endforeach
                    </div>
                </div>
            </x-slot>
        </x-box>
    </div>

    @if(\App\Utils::config(\App\Enums\ConfigKey::IsUserNeedVerify) && !$user->email_verified_at)
        @push('scripts')
            <script>
                $('#send-verify-email').click(function () {
                    if (! $(this).attr('disabled')) {
                        $(this).text('发送中...').attr('disabled');
                        axios.post('{{ route('verification.send') }}').then(response => {
                            toastr.success('发送成功，请注意查收。');
                        }).catch(error => {
                            if (error.response.status === 429) {
                                toastr.error('操作频繁，请稍后再试');
                            }
                        }).finally(_ => {
                            $(this).text('这里').attr('disabled');
                        });
                    }
                });
            </script>
        @endpush
    @endif
</x-app-layout>
