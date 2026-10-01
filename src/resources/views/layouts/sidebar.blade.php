{{-- 高度：这里保留 h-screen 只为手机（<768px）口径与原样一致；桌面端真正生效的是
     resources/css/common.less 里 #app-sidebar 的 height:100dvh（id 权重压过这个 class），
     而桌面默认 110% 缩放的补偿（calc(100vh/1.1)）也加在那条 id 规则上 —— 所以别在这里补
     md:h-[...]，那是死代码。 --}}
<nav id="app-sidebar" class="transition-all duration-300 -left-[600px] sm:left-0 w-3/4 sm:w-64 h-screen bg-surface border-r border-line fixed z-10" :class="{
    '-left-[600px]': ! $store.sidebar.open,
    'left-0': $store.sidebar.open
}">
    <div class="ls-brand px-5 h-14 flex justify-between items-center border-b border-line">
        <a href="/" class="flex items-center gap-2.5 truncate">
            {{-- fork：左上角改用 Lsky Pro 官方 logo（透明底，不套背景方块）--}}
            <img src="{{ asset('static/lsky-logo.png') . '?v=' . \App\Utils::assetVersion('static/lsky-logo.png') }}"
                 alt="" width="28" height="28" decoding="async" class="w-7 h-7 shrink-0 select-none">
            <span class="ls-brand-name text-[15px] font-semibold text-ink truncate">{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</span>
        </a>
        <a href="javascript:void(0)" class="sm:hidden block w-8 h-8 rounded-lg flex items-center justify-center text-ink-2 hover:bg-surface-2"
           @click="$store.sidebar.open = false"><i class="fas fa-times"></i></a>
    </div>

    <div class="flex flex-col justify-between container mx-auto px-3 py-4 pb-12 h-full overflow-scroll overscroll-contain scrollbar-none">
        <div>
            <div class="flex flex-col space-y-1 mb-5">
                <p class="ls-group-title">我的</p>
                {{-- fork：仪表盘不再单独占一组，并入「我的」；组内顺序 仪表盘 → 我的图片 → 上传图片 → 用户设置 --}}
                <x-nav-link :href="route('dashboard')" :active="request()->routeIs('dashboard')">
                    <x-slot name="icon"><i class="fas fa-tachometer-alt fa-fw"></i></x-slot>
                    <x-slot name="name">仪表盘</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('images')" :active="request()->routeIs('images')">
                    <x-slot name="icon"><i class="fas fa-images fa-fw"></i></x-slot>
                    <x-slot name="name">我的图片</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('upload')" :active="request()->routeIs('upload')">
                    <x-slot name="icon"><i class="fas fa-cloud-upload-alt fa-fw"></i></x-slot>
                    <x-slot name="name">上传图片</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('settings')" :active="request()->routeIs('settings')">
                    <x-slot name="icon"><i class="fas fa-user-cog fa-fw"></i></x-slot>
                    <x-slot name="name">用户设置</x-slot>
                </x-nav-link>
            </div>
            @if(\App\Utils::config(\App\Enums\ConfigKey::IsEnableApi))
            <div class="flex flex-col space-y-1 mb-5">
                <p class="ls-group-title">公共</p>
                @if(\App\Utils::config(\App\Enums\ConfigKey::IsEnableApi))
                <x-nav-link :href="route('api')" :active="request()->routeIs('api')">
                    <x-slot name="icon"><i class="fas fa-link fa-fw"></i></x-slot>
                    <x-slot name="name">接口</x-slot>
                </x-nav-link>
                @endif
            </div>
            @endif
            @if(Auth::user()->is_adminer)
            <div class="flex flex-col space-y-1 mb-5">
                <p class="ls-group-title">系统</p>
                <x-nav-link :href="route('admin.console')" :active="request()->is('admin/console*')">
                    <x-slot name="icon"><i class="fas fa-terminal fa-fw"></i></x-slot>
                    <x-slot name="name">控制台</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('admin.groups')" :active="request()->is('admin/groups*')">
                    <x-slot name="icon"><i class="fas fa-users fa-fw"></i></x-slot>
                    <x-slot name="name">角色组</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('admin.users')" :active="request()->is('admin/users*')">
                    <x-slot name="icon"><i class="fas fa-users-cog fa-fw"></i></x-slot>
                    <x-slot name="name">用户管理</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('admin.images')" :active="request()->is('admin/images*')">
                    <x-slot name="icon"><i class="fas fa-images fa-fw"></i></x-slot>
                    <x-slot name="name">图片管理</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('admin.strategies')" :active="request()->is('admin/strategies*')">
                    <x-slot name="icon"><i class="fas fa-hdd fa-fw"></i></x-slot>
                    <x-slot name="name">储存策略</x-slot>
                </x-nav-link>
                <x-nav-link :href="route('admin.settings')" :active="request()->is('admin/settings*')">
                    <x-slot name="icon"><i class="fas fa-cogs fa-fw"></i></x-slot>
                    <x-slot name="name">系统设置</x-slot>
                </x-nav-link>
            </div>
            @endif
        </div>

        {{-- 底部留出空间：原来 mb-5 时容量文字会被浏览器左下角的链接预览挡住（老师反馈）--}}
        {{-- 桌面端把这块整体上移（老师反馈 110% 缩放下它「稍微被下边缘裁掉一点」，
             后又反馈「完整可见了，但被浏览器自己的预览小条挡住了一点」）。
             实测（真 CSS + 真 Chromium 153、1440 宽、物理 px）：
               mt-10(40px) → 容量块底边比视口底低 23.4px（被裁）
               mt-2 (8px)  → 底边余量 +11.8px（H=800 时；上一轮的形态）
               mt-1 (4px)  → 底边余量 +16.2px（只压线，留 0.2px 余量，不可靠）
               mt-0 (0px)  → 底边余量 +20.6px  ← 取这一档
             故桌面档从 mt-2 再上移 8px（局部）= 8.8px 物理，底部余量 ≥16px 且有余量。
             断点/写法：用 common.less 的 ls-zoom-mt-0（@media(min-width:768px) 内，带 html 前缀压过
             .mt-10），而不是 Tailwind 的 md: / min-[768px]: —— md 已随断点 ×1.1 变成 844.8px，
             而 Tailwind 3.0.23 还没有任意值变体。语义与缩放阈值 768 严格对齐。
             窗口更高时（内容放得下）flex 的 justify-between 会把这块吸到容器底部，
             所以高窗口（≥864 实测余量 61.6px）观感与改动前逐像素一致 —— 只有「会溢出」的窗口才整体上移。
             手机档（<768px）保持 mt-10 原样（老师要求手机端零变化）。--}}
        <div id="capacity-progress" class="flex flex-col space-y-2 mb-16 px-2 w-full mt-10 ls-zoom-mt-0">
            <p class="text-ink-2 text-[13.5px]">容量使用</p>
            <progress class="w-full h-1.5" value="{{ Auth::user()->use_capacity }}" max="{{ Auth::user()->capacity }}"></progress>
            <p class="text-ink-3 text-[13.5px] truncate">
                <span class="used">{{ \App\Utils::formatSize(Auth::user()->use_capacity * 1024) }}</span>
                /
                <span class="total">{{ \App\Utils::formatSize(Auth::user()->capacity * 1024) }}</span>
            </p>
        </div>
    </div>
</nav>

@push('scripts')
    <script>
        let $progress = $('#capacity-progress progress');
        let value = $progress.attr('value') / $progress.attr('max') * 100;
        let str = 'green';
        if (value > 90) {
            str = 'red';
        } else if (value > 70) {
            str = 'orange';
        } else if (value > 60) {
            str = 'yellow';
        } else if (value > 40) {
            str = 'yellowgreen';
        }
        $progress.addClass(str)
    </script>
@endpush
