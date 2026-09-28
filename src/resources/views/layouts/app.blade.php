<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="keywords" content="{{ \App\Utils::config(\App\Enums\ConfigKey::SiteKeywords) }}"/>
    <meta name="description" content="{{ \App\Utils::config(\App\Enums\ConfigKey::SiteDescription) }}"/>
    <meta name="color-scheme" content="light dark">

    <title>{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</title>

    {{-- 首屏主题 + 侧栏折叠状态：必须在样式之前执行，否则暗色会先闪白屏、
         折叠的侧栏会先展开再收起地抖一下。这里只做"读 + 加类"这一件事，
         真正的状态管理在 resources/js/stores/{theme,sidebar}.js --}}
    <script>
        (function () {
            try {
                var mode = localStorage.getItem('lsky-theme') || 'system';
                var dark = mode === 'dark' ||
                    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (dark) {
                    document.documentElement.classList.add('dark');
                }
            } catch (e) {
                // localStorage 不可用（隐私模式等）时静默降级为亮色
            }

            try {
                // 手机端不受影响：折叠样式整段都在 @media (min-width: 640px) 里
                if (localStorage.getItem('lsky-sidebar') === 'collapsed') {
                    document.documentElement.classList.add('sidebar-collapsed');
                }
            } catch (e) {
                // 同上，读不到就当展开
            }
        })();
    </script>

    <!-- Fonts -->
    <link rel="stylesheet" href="{{ asset('css/fontawesome.css') }}">
    @stack('styles')

    <!-- Styles -->
    <link rel="stylesheet" href="{{ asset('css/common.css') }}?v={{ \App\Utils::assetVersion('css/common.css') }}">
    <link rel="stylesheet" href="{{ asset('css/app.css') }}?v={{ \App\Utils::assetVersion('css/app.css') }}">
</head>
<body class="font-sans antialiased">
<div class="min-h-screen bg-bg text-ink" x-data x-cloak>
    @include('layouts.sidebar')
    @include('layouts.header')
    <div
        x-transition:enter="ease-in-out duration-500"
        x-transition:enter-start="opacity-0"
        x-transition:enter-end="opacity-100"
        x-transition:leave="ease-in-out duration-500"
        x-transition:leave-start="opacity-100"
        x-transition:leave-end="opacity-0"
        class="z-[9] bg-black/60 backdrop-blur-[2px] transition-opacity h-full w-full fixed inset-0 sm:hidden"
        x-show="$store.sidebar.open"
        @click.outside="$store.sidebar.open = false"
        @close.stop="$store.sidebar.open = false"
        @click="$store.sidebar.toggle()"
        style="display: none"
    >

    </div>
    <x-container class="flex flex-col pt-14 pb-14 min-h-screen transition-all duration-300">
        {{ $slot }}
    </x-container>
</div>
</body>
<!-- Scripts -->
<script src="{{ asset('js/app.js') }}?v={{ \App\Utils::assetVersion('js/app.js') }}"></script>
@include('common.notice')
<script>
    // 开关组件默认值
    let setSwitch = function (e) {
        if (e.checked) {
            $(e).closest('.switch').find('input[type=hidden]').remove();
        } else {
            $(e).before('<input type="hidden" name="'+e.name+'" value="0" />');
        }
    }
    $('.switch input[type=checkbox]').each(function () {
        setSwitch(this);
    }).click(function () {
        setSwitch(this);
    });
</script>
@if(file_exists(public_path('js/custom.js')))
<script src="{{ asset('js/custom.js') }}"></script>
@endif
@stack('scripts')
</html>
