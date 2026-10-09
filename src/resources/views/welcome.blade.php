@push('styles')
    <link rel="stylesheet" href="{{ asset('css/markdown-css/github-markdown-light.css') }}">
@endpush

<x-guest-layout :floating-theme-switch="false">
    <div class="py-14">
        {{-- 这一行与 app 布局顶栏同一套几何：左侧标题吃掉剩余宽度（min-w-0 + truncate，窄屏自动截断，
             绝不与右侧抢位）、右侧一组 shrink-0。
             外观切换以前是 guest 布局里「贴视口右上角」的浮动版，与这一行差 8px（纵向，顶栏 56px 内
             居中 vs top-4+40px）与 24px 以上（横向，图标贴视口 16px vs 容器内边距 40/240px）——
             现在它排进这一行里，浮动版由 floating-theme-switch=false 关掉。 --}}
        <header class="w-full h-14 bg-surface border-b border-line text-ink flex justify-center fixed top-0 z-[9]">
            <div class="container mx-auto px-5 sm:px-10 md:px-10 lg:px-10 xl:px-10 2xl:px-60 flex items-center gap-3 justify-between">
                <div class="flex min-w-0 flex-1 justify-start items-center">
                    {{-- fork 2026-10-09：品牌区补上 LOGO 图案（与侧栏/登录页同一张图）。
                         尺寸经手 28 → 32 → 30，最终定回 **28px**（= w-7 h-7，产物里有这档工具类，
                         不必再走 inline style）；站名保持 18px（text-lg）。
                         顶栏高 56px、右侧按钮 h-10=40px ⇒ 28px 的图案不会把顶栏撑高。
                         窄屏仍由 min-w-0 + truncate 吃掉剩余宽度（图标 shrink-0），不与右侧那组抢位。 --}}
                    <a href="{{ route('/') }}" class="flex items-center gap-2 min-w-0 text-ink text-lg">
                        <img src="{{ asset('static/lsky-logo.png') . '?v=' . \App\Utils::assetVersion('static/lsky-logo.png') }}"
                             alt="" width="28" height="28" decoding="async" class="w-7 h-7 shrink-0 select-none">
                        <span class="min-w-0 truncate">{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</span>
                    </a>
                </div>
                <div class="flex shrink-0 justify-end items-center space-x-2 sm:space-x-4">
                    <x-theme-switch />
                    @includeWhen($_is_notice, 'layouts.notice')
                    @includeWhen($_group->strategies->isNotEmpty(), 'layouts.strategies')

                    @if(Auth::check())
                        @include('layouts.user-nav')
                    @else
                        {{-- 登录 = 强调色**实心整块**按钮（不是只把文字染色），h-10 与同排其它按钮同一档 --}}
                        <a href="{{ route('login') }}" class="ls-btn ls-btn-primary h-10 px-4">登录</a>
                        @if(\App\Utils::config(\App\Enums\ConfigKey::IsEnableRegistration))
                        <a href="{{ route('register') }}" class="text-ink-2 hover:bg-surface-2 hover:text-ink px-3 py-2 rounded-lg text-[13.5px] font-medium whitespace-nowrap">注册</a>
                        @endif
                    @endif
                </div>
            </div>
        </header>
        <div class="mt-10 container mx-auto px-5 sm:px-10 md:px-10 lg:px-10 xl:px-10 2xl:px-60">
            <x-upload/>
        </div>
        <footer class="absolute bottom-0 left-0 right-0 w-full bg-surface-3">
            <p class="container mx-auto py-2 px-5 sm:px-10 md:px-10 lg:px-10 xl:px-10 2xl:px-60 text-ink-2 text-sm">
                Copyright © 2018 - present Lsky Pro. All rights reserved. &nbsp;<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">{{ \App\Utils::config(\App\Enums\ConfigKey::IcpNo) }}</a>&nbsp;请勿上传违反中国大陆和香港法律的图片，违者后果自负。
            </p>
        </footer>
    </div>

    @include('common.notice')

</x-guest-layout>
