@section('title', '系统控制台')

<x-app-layout>
    @if(config('app.debug'))
        <p class="mt-4 p-3 rounded-xl text-[13.5px] bg-danger-soft text-danger">
            <i class="fas fa-exclamation-triangle"></i>
            当前系统 debug 已被打开，敏感信息暴露在外，可能会被利用从而影响系统稳定性，生产环境中请务必关闭！
        </p>
    @endif
    <div class="my-6 md:my-9">
        <p class="mb-3 font-semibold text-lg text-ink">概览</p>

        {{-- 四张主卡：图标块 + 弱化标签 + 大数字；手机两列，lg 起一行四张 --}}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div class="bg-surface rounded-xl p-4 shadow-card">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                        <i class="fas fa-images text-[13.5px]"></i>
                    </span>
                    <p class="text-ink-2 text-[13px] truncate">图片数量</p>
                </div>
                <p class="mt-3 text-ink text-[21px] font-semibold tabular-nums truncate">
                    {{ \App\Utils::shortenNumber(\App\Models\Image::query()->count()) }}
                </p>
            </div>

            <div class="bg-surface rounded-xl p-4 shadow-card">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                        <i class="fas fa-tags text-[13.5px]"></i>
                    </span>
                    <p class="text-ink-2 text-[13px] truncate">相册数量</p>
                </div>
                <p class="mt-3 text-ink text-[21px] font-semibold tabular-nums truncate">
                    {{ \App\Utils::shortenNumber(\App\Models\Album::query()->count()) }}
                </p>
            </div>

            <div class="bg-surface rounded-xl p-4 shadow-card">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                        <i class="fas fa-users text-[13.5px]"></i>
                    </span>
                    <p class="text-ink-2 text-[13px] truncate">用户数量</p>
                </div>
                <p class="mt-3 text-ink text-[21px] font-semibold tabular-nums truncate">
                    {{ \App\Utils::shortenNumber(\App\Models\User::query()->count()) }}
                </p>
            </div>

            <div class="bg-surface rounded-xl p-4 shadow-card">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center shrink-0">
                        <i class="fas fa-server text-[13.5px]"></i>
                    </span>
                    <p class="text-ink-2 text-[13px] truncate">占用储存</p>
                </div>
                <p class="mt-3 text-ink text-[21px] font-semibold tabular-nums truncate">
                    {{ \App\Utils::formatSize(\App\Models\Image::query()->sum('size') * 1024) }}
                </p>
            </div>
        </div>

        {{-- 上传统计卡：今日 / 昨日 / 本周 / 本月 四个小格子 --}}
        <div class="mt-3 md:mt-4 mb-8">
            <x-box>
                <x-slot name="title">上传统计</x-slot>
                <x-slot name="content">
                    <div class="px-4 py-3">
                        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div class="rounded-lg bg-surface-2 px-3 py-2">
                                <p class="text-ink-2 text-[13px] truncate">今日上传</p>
                                <p class="mt-0.5 text-ink text-[17px] font-semibold tabular-nums truncate">{{ \App\Utils::shortenNumber($numbers['today']) }}</p>
                            </div>
                            <div class="rounded-lg bg-surface-2 px-3 py-2">
                                <p class="text-ink-2 text-[13px] truncate">昨日上传</p>
                                <p class="mt-0.5 text-ink text-[17px] font-semibold tabular-nums truncate">{{ \App\Utils::shortenNumber($numbers['yesterday']) }}</p>
                            </div>
                            <div class="rounded-lg bg-surface-2 px-3 py-2">
                                <p class="text-ink-2 text-[13px] truncate">本周上传</p>
                                <p class="mt-0.5 text-ink text-[17px] font-semibold tabular-nums truncate">{{ \App\Utils::shortenNumber($numbers['week']) }}</p>
                            </div>
                            <div class="rounded-lg bg-surface-2 px-3 py-2">
                                <p class="text-ink-2 text-[13px] truncate">本月上传</p>
                                <p class="mt-0.5 text-ink text-[17px] font-semibold tabular-nums truncate">{{ \App\Utils::shortenNumber($numbers['month']) }}</p>
                            </div>
                        </div>
                    </div>
                </x-slot>
            </x-box>
        </div>

        <p class="mb-3 font-semibold text-lg text-ink">趋势</p>
        {{-- ECharts 自己会往容器里建画布，这里不用手写 canvas --}}
        <div class="relative p-4 rounded-md bg-surface h-80 mb-8 shadow-card" id="chart"></div>

        {{-- 系统信息：原「系统情况」与「软件信息」合并成一张卡，去掉斑马纹 --}}
        <x-box>
            <x-slot name="title">系统信息</x-slot>
            <x-slot name="content">
                <div class="px-4 py-3">
                    <dl class="divide-y divide-line">
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">操作系统</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                {{ php_uname() }}
                            </dd>
                        </div>
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">运行环境</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                {{ request()->server('SERVER_SOFTWARE') }}
                            </dd>
                        </div>
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">PHP 版本</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                {{ phpversion() }}
                            </dd>
                        </div>
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">文件上传限制</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                {{ ini_get("upload_max_filesize") }}
                            </dd>
                        </div>
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">POST 数据最大限制</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                {{ ini_get('post_max_size') }}
                            </dd>
                        </div>
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">软件版本</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                {{ config('app.version') }}@if(\App\Utils::shortCommit()) <span class="font-mono text-ink-2">{{ \App\Utils::shortCommit() }}</span>@endif
                            </dd>
                        </div>
                        {{-- fork：上游的官方网站/使用手册两项已删除（官方早已停更），仓库地址指向本仓库 --}}
                        <div class="py-2.5 sm:grid sm:grid-cols-4 sm:gap-4">
                            <dt class="text-ink-3 text-[13.5px]">仓库地址</dt>
                            <dd class="mt-0.5 text-ink text-[13.5px] break-words sm:mt-0 sm:col-span-3">
                                <a target="_blank" class="text-brand break-all hover:underline" href="https://github.com/mole404/lsky-pro-docker">https://github.com/mole404/lsky-pro-docker</a>
                            </dd>
                        </div>
                    </dl>
                </div>
            </x-slot>
        </x-box>
    </div>

    @push('scripts')
        <script src="{{ asset('js/echarts/echarts.min.js') }}"></script>
        <script>
            $(function () {
                'use strict'
                let chartDom = document.getElementById('chart');
                let myChart = echarts.init(chartDom);
                // fork 补丁 1：字色跟随主题。ECharts 默认文字是深灰，暗色下几乎看不清 ——
                // 这里统一读应用的设计令牌（--lsky-*），亮/暗两套配色自动对上。
                // fork 补丁 2：侧栏折叠改的是**容器宽度**，不会触发 window.resize，画布会留在旧宽度上
                // （图表跟卡片边框对不上）；改用侧栏 hook，在 300ms 宽度动画结束后再 resize。
                function chartColors() {
                    let css = getComputedStyle(document.documentElement);
                    let token = function (name, fallback) {
                        let value = css.getPropertyValue(name);
                        return (value && value.trim()) || fallback;
                    };
                    return {
                        text: token('--lsky-text', '#16191d'),
                        text2: token('--lsky-text-2', '#5a6472'),
                        text3: token('--lsky-text-3', '#8b95a3'),
                        border: token('--lsky-border', '#e9ecf0'),
                        border2: token('--lsky-border-2', '#dde2e8'),
                        surface: token('--lsky-surface', '#ffffff')
                    };
                }

                function chartOptions() {
                    let c = chartColors();
                    return {
                        textStyle: {color: c.text2},
                        title: {
                            text: '近 30 天内统计',
                            textStyle: {color: c.text}
                        },
                        tooltip: {
                            trigger: 'axis',
                            backgroundColor: c.surface,
                            borderColor: c.border2,
                            textStyle: {color: c.text}
                        },
                        legend: {
                            top: '10%',
                            type: 'scroll',
                            data: @json($fields),
                            textStyle: {color: c.text2},
                            inactiveColor: c.text3,
                            pageTextStyle: {color: c.text2},
                            pageIconColor: c.text2,
                            pageIconInactiveColor: c.text3
                        },
                        grid: {
                            left: '3%',
                            right: '3%',
                            bottom: '3%',
                            containLabel: true
                        },
                        toolbox: {
                            show: true,
                            iconStyle: {borderColor: c.text3},
                            feature: {
                                magicType: {
                                    type: ["line", "bar"]
                                },
                                saveAsImage: {}
                            }
                        },
                        xAxis: {
                            type: 'category',
                            boundaryGap: false,
                            data: @json($dates),
                            axisLabel: {color: c.text2},
                            axisLine: {lineStyle: {color: c.border2}}
                        },
                        yAxis: {
                            type: 'value',
                            minInterval: 1,
                            axisLabel: {color: c.text2},
                            axisLine: {lineStyle: {color: c.border2}},
                            splitLine: {lineStyle: {color: c.border}}
                        },
                        series: @json($datasets)
                    };
                }

                myChart.setOption(chartOptions());

                // 亮/暗/跟随系统切换 → 重画（颜色是读 CSS 变量来的，不重画就还是旧色）
                window.addEventListener('lsky:theme-changed', function () {
                    myChart.setOption(chartOptions(), true);
                });

                // 侧栏折叠/展开 → 容器宽度变了，等过渡动画结束再同步画布
                window.addEventListener('lsky:sidebar-toggled', function () {
                    setTimeout(function () {
                        myChart.resize();
                    }, 320);
                });

                // 窗口缩放照旧；用 addEventListener，window.onresize = 会覆盖别人挂的处理
                window.addEventListener('resize', function () {
                    myChart.resize();
                });
            })
        </script>
    @endpush

</x-app-layout>
