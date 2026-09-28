@section('title', '系统控制台')

<x-app-layout>
    @if(config('app.debug'))
        <p class="mt-4 p-2 rounded-md text-sm bg-red-500 text-white">
            <i class="fas fa-exclamation-triangle"></i>
            当前系统 debug 已被打开，敏感信息暴露在外，可能会被利用从而影响系统稳定性，生产环境中请务必关闭！
        </p>
    @endif
    <div class="my-6 md:my-9">
        <p class="mb-3 font-semibold text-lg text-ink">概览</p>
        <div class="relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-red-700 truncate">
                        {{ \App\Utils::shortenNumber(\App\Models\Image::query()->count()) }}
                    </p>
                    <p class="text-md text-ink-2">图片数量</p>
                </div>
                <i class="fas fa-images text-danger text-2xl"></i>
            </div>
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-lime-700 truncate">
                        {{ \App\Utils::shortenNumber(\App\Models\Album::query()->count()) }}
                    </p>
                    <p class="text-md text-ink-2">相册数量</p>
                </div>
                <i class="fas fa-tags text-lime-600 text-2xl"></i>
            </div>
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-brand truncate">
                        {{ \App\Utils::shortenNumber(\App\Models\User::query()->count()) }}
                    </p>
                    <p class="text-md text-ink-2">用户数量</p>
                </div>
                <i class="fas fa-users text-brand text-2xl"></i>
            </div>
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-cyan-700 truncate">
                        {{ \App\Utils::formatSize(\App\Models\Image::query()->sum('size') * 1024) }}
                    </p>
                    <p class="text-md text-ink-2">占用储存</p>
                </div>
                <i class="fas fa-server text-cyan-600 text-2xl"></i>
            </div>

            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-ink-2 truncate">{{ \App\Utils::shortenNumber($numbers['today']) }}</p>
                    <p class="text-md text-ink-2">今日上传</p>
                </div>
                <i class="fas fa-upload text-ink-3 text-2xl"></i>
            </div>
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-ink-2 truncate">{{ \App\Utils::shortenNumber($numbers['yesterday']) }}</p>
                    <p class="text-md text-ink-2">昨日上传</p>
                </div>
                <i class="fas fa-upload text-ink-3 text-2xl"></i>
            </div>
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-ink-2 truncate">{{ \App\Utils::shortenNumber($numbers['week']) }}</p>
                    <p class="text-md text-ink-2">本周上传</p>
                </div>
                <i class="fas fa-upload text-ink-3 text-2xl"></i>
            </div>
            <div class="flex justify-between rounded-md bg-surface p-3 overflow-hidden shadow-card">
                <div class="flex flex-col justify-between space-y-2 w-[80%]">
                    <p class="font-bold text-2xl text-ink-2 truncate">{{ \App\Utils::shortenNumber($numbers['month']) }}</p>
                    <p class="text-md text-ink-2">本月上传</p>
                </div>
                <i class="fas fa-upload text-ink-3 text-2xl"></i>
            </div>
        </div>

        <p class="mb-3 font-semibold text-lg text-ink">趋势</p>
        {{-- ECharts 自己会往容器里建画布，这里不用手写 canvas --}}
        <div class="relative p-4 rounded-md bg-surface h-80 mb-8 shadow-card" id="chart"></div>

        <p class="mb-3 font-semibold text-lg text-ink">系统情况</p>
        <div class="relative rounded-md bg-surface mb-8 overflow-hidden shadow-card">
            <dl>
                <div class="bg-surface-2 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">操作系统</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        {{ php_uname() }}
                    </dd>
                </div>
                <div class="bg-surface px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">运行环境</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        {{ request()->server('SERVER_SOFTWARE') }}
                    </dd>
                </div>
                <div class="bg-surface-2 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">PHP 版本</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        {{ phpversion() }}
                    </dd>
                </div>
                <div class="bg-surface px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">文件上传限制</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        {{ ini_get("upload_max_filesize") }}
                    </dd>
                </div>
                <div class="bg-surface-2 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">POST 数据最大限制</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        {{ ini_get('post_max_size') }}
                    </dd>
                </div>
            </dl>
        </div>

        <p class="mb-3 font-semibold text-lg text-ink">软件信息</p>
        <div class="relative rounded-md bg-surface mb-8 overflow-hidden shadow-card">
            <dl>
                <div class="bg-surface-2 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">软件版本</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        {{ config('app.version') }}@if(\App\Utils::shortCommit()) <span class="font-mono">{{ \App\Utils::shortCommit() }}</span>@endif
                    </dd>
                </div>
                {{-- fork：上游的官方网站/使用手册两项已删除（官方早已停更），仓库地址指向本仓库 --}}
                <div class="bg-surface px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-ink-2">仓库地址</dt>
                    <dd class="mt-1 text-sm text-ink sm:mt-0 sm:col-span-2">
                        <a target="_blank" class="hover:text-brand" href="https://github.com/mole404/lsky-pro-docker">https://github.com/mole404/lsky-pro-docker</a>
                    </dd>
                </div>
            </dl>
        </div>
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
