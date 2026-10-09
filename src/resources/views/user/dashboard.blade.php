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
                            <i class="fas {{ $icon }} text-[13.5px]"></i>
                        </span>
                        <p class="text-ink-2 text-[13.5px] truncate">{{ $label }}</p>
                    </div>
                    <p class="mt-3 text-ink text-[21px] font-semibold tabular-nums truncate">{{ $value }}</p>
                </div>
            @endforeach
        </div>

        {{-- ② 储存用量（侧栏折叠时那块容量信息会藏起来，这里正好补上） --}}
        <div class="bg-surface rounded-xl p-4 md:p-5 shadow-card">
            <div class="flex items-center justify-between gap-4">
                <p class="text-ink text-[14px] font-semibold">储存用量</p>
                <p class="text-ink-3 text-[13.5px] tabular-nums">
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
                        <p class="px-4 pt-3 text-ink-3 text-[13.5px]">共 {{ $strategies->count() }} 个可用</p>
                        {{-- 手机上不内滚（一列全展开，靠整页滚动即可）；≥md 与「我的信息」并排，才需要限高。
                             max-height 由页尾脚本按右侧卡片高度动态计算，这里的 18rem 只作无 JS 兜底。 --}}
                        <div class="divide-y divide-line md:max-h-[18rem] md:overflow-y-auto md:overscroll-contain ls-strategy-list">
                            @foreach ($strategies as $strategy)
                                <div class="w-full px-4 py-3">
                                    <p class="text-ink text-[14px] font-medium">{{ $strategy->name }}</p>
                                    @if($strategy->intro)
                                        <p class="mt-0.5 text-ink-3 text-[13.5px]">{{ $strategy->intro }}</p>
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
                    {{-- 锚点类给页尾脚本量高度用（本层底边即卡片底边，且不受 grid 拉伸影响） --}}
                    <div class="ls-info-card px-4 py-3">
                        <div class="divide-y divide-line">
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13.5px]">名称</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13.5px]">{{ $user->name }}</p>
                            </div>
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13.5px]">邮箱</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13.5px]">{{ $user->email }}</p>
                            </div>
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13.5px]">注册时间</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13.5px] tabular-nums">{{ $user->created_at }}</p>
                            </div>
                            <div class="flex items-center gap-4 py-2.5">
                                <p class="w-20 shrink-0 text-ink-3 text-[13.5px]">注册 IP</p>
                                <p class="min-w-0 flex-1 truncate text-ink text-[13.5px] tabular-nums">{{ $user->registered_ip }}</p>
                            </div>
                        </div>
                        @if(\App\Utils::config(\App\Enums\ConfigKey::IsUserNeedVerify) && !$user->email_verified_at)
                            <p class="mt-3 rounded-lg bg-danger-soft p-3 text-[13.5px] text-danger">
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
                            <p class="w-28 shrink-0 text-ink-3 text-[13.5px]">组名</p>
                            <p class="min-w-0 flex-1 truncate text-ink text-[13.5px]">{{ $user->group ? $user->group->name : '系统默认组' }}</p>
                        </div>
                        <div class="flex items-center gap-4 py-2.5">
                            <p class="w-28 shrink-0 text-ink-3 text-[13.5px]">最大文件大小</p>
                            <p class="min-w-0 flex-1 truncate text-ink text-[13.5px] tabular-nums">{{ \App\Utils::formatSize($configs->get(\App\Enums\GroupConfigKey::MaximumFileSize) * 1024) }}</p>
                        </div>
                    </div>

                    <p class="mt-4 mb-2 text-ink-3 text-[13.5px]">上传限制</p>
                    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        @foreach($limits as [$label, $key, $unit])
                            @php $limitValue = (int) $configs->get($key); @endphp
                            <div class="rounded-lg bg-surface-2 px-3 py-2">
                                <p class="text-ink-2 text-[13px]">{{ $label }}</p>
                                {{-- 值为 0 表示该维度不限量（含「并发」）；灰字「无限制」且不带单位 --}}
                                <p class="mt-0.5 {{ $limitValue === 0 ? 'text-ink-3' : 'text-ink' }} text-[14px] font-semibold tabular-nums">
                                    @if($limitValue === 0)
                                        无限制
                                    @else
                                        {{ $configs->get($key) }}<span class="ml-0.5 text-ink-2 text-[13px] font-normal">{{ $unit }}</span>
                                    @endif
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

    @push('scripts')
        <script>
            // 「可使用的策略」列表 ≥md（844.8px，与 tailwind 的 md 断点一致）时按右侧「我的信息」
            // 卡片高度限高，超出在卡片内滚动；窄屏/竖屏清掉内联 max-height，保持一列全展开。
            (function () {
                var mq = window.matchMedia('(min-width: 844.8px)');
                var list = document.querySelector('.ls-strategy-list');
                var info = document.querySelector('.ls-info-card');
                if (! list || ! info) { return; }

                var infoCard = info.closest('.ls-card');
                var strategyCard = list.closest('.ls-card') || list;

                // zoom:1.1 下 rect 给的是视觉 px，style.maxHeight 要布局 px → 除以 z
                function zoom() {
                    var el = document.documentElement;
                    var z = el.getBoundingClientRect().width / el.offsetWidth;
                    return z > 1.0001 ? z : 1;
                }

                function sync() {
                    if (! mq.matches) {
                        list.style.maxHeight = ''; // 竖屏/窄屏：一列全展开，交给整页滚动
                        return;
                    }
                    var z = zoom();
                    var iRect = info.getBoundingClientRect();
                    var cRect = infoCard.getBoundingClientRect();
                    // 「我的信息」自然高度 = 内容底边 − 卡片顶边（grid 只拉伸底边，不影响此值）
                    var infoH = (iRect.bottom - cRect.top) / z;
                    var sRect = strategyCard.getBoundingClientRect();
                    var lRect = list.getBoundingClientRect();
                    // 布局还没铺好时（页面刚解析、[x-cloak] 还罩着 → 内容 display:none）所有 rect 都是 0：
                    // 这一帧必须直接放弃，否则会算出 maxHeight:0 把列表压没（本地实测正是这样量到 0px 的）。
                    // 取舍：宁可不限高（等于现状），也绝不把卡片压空。
                    if (! (infoH > 0) || ! (lRect.top > 0) || ! (sRect.top > 0)) { return; }
                    // 列表「上方」占掉的高度（卡片头 + 「共 N 个可用」）+ 卡片底部内边距。
                    // ⚠ 不能用 (卡片底边 − 列表底边) 那一项：卡片是 grid item，会被拉伸到与右侧同高，
                    //    这一项里含「被拉伸出来的空白」——列表一被限高它就跟着变大 → 自我放大把 maxHeight 压成 0（本地量到过 0px）。
                    var padB = parseFloat(getComputedStyle(list.parentElement).paddingBottom) || 0;
                    var chrome = (lRect.top - sRect.top) / z + padB;
                    if (! (chrome > 0)) { return; }
                    list.style.maxHeight = Math.max(0, Math.round(infoH - chrome)) + 'px';
                }

                // 解析期这一帧多半量不到（见上面的护栏），真正生效靠下面这几次调用
                if (document.readyState === 'complete') { sync(); } else { window.addEventListener('load', sync); }
                window.addEventListener('resize', sync);
                // 侧栏折叠动画约 300ms，等结束再量，避免拿到过渡中的高度
                window.addEventListener('lsky:sidebar-toggled', function () { setTimeout(sync, 320); });
                if (mq.addEventListener) { mq.addEventListener('change', sync); } else { mq.addListener(sync); }
            })();
        </script>
    @endpush
</x-app-layout>
