<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" class="relative min-full">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="csrf-token" content="{{ csrf_token() }}">
        <meta name="keywords" content="{{ \App\Utils::config(\App\Enums\ConfigKey::SiteKeywords) }}"/>
        <meta name="description" content="{{ \App\Utils::config(\App\Enums\ConfigKey::SiteDescription) }}"/>
        <meta name="color-scheme" content="light dark">

        <title>{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</title>

        {{-- 首屏主题：必须在样式之前执行，避免暗色下先闪白（与 layouts/app.blade.php 里同一段逻辑）--}}
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
                    // localStorage 不可用时静默降级为亮色
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
        <div class="min-h-screen text-ink bg-bg">
            {{-- 登录/注册这类页面也放一个外观切换（右上角浮动）--}}
            <div class="absolute top-4 right-4 z-10" x-data>
                <x-theme-switch />
            </div>
            {{ $slot }}
        </div>
    </body>
    <!-- Scripts -->
    <script src="{{ asset('js/app.js') }}?v={{ \App\Utils::assetVersion('js/app.js') }}"></script>
    @if(file_exists(public_path('js/custom.js')))
        <script src="{{ asset('js/custom.js') }}"></script>
    @endif
    @stack('scripts')
</html>
