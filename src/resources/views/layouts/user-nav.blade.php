<!-- Profile dropdown -->
<x-dropdown>
    <x-slot name="trigger">
        <button type="button" class="flex items-center justify-center gap-2 h-10 w-10 p-0 rounded-full border border-line hover:bg-surface-2 text-[14px] text-ink sm:w-auto sm:pl-2 sm:pr-2" id="user-menu-button" aria-expanded="false" aria-haspopup="true">
            <span class="sr-only">Open user menu</span>
            {{-- 头像占位框：固定 28×28（h-7 w-7 + width/height 属性），图片没到/挂了都不抖动。
                 里面两层：底下的「名字首字」色块圆圈（兜底）与盖在它上面的 img。
                 真地址放在 data-avatar-src —— 由文件末尾的内联脚本在页面 load 之后再接上，
                 这样外站头像（cravatar）再慢也不会拖住整页的 load（之前的「页面一直没加载完」）。
                 img 加载失败/被阻 → onerror 把自己撤掉，露出首字圆圈；加载成功 → 去掉首字（防透明图透字）。 --}}
            {{-- overflow-hidden 是必需的：flex 项的 min-width:auto 会按内容最小宽度撑开，
                 名字首字要是被换成长字符串（或字体异常），整个按钮会被顶宽 —— 加了它之后
                 内容再大也只在这个 28×28 的圆圈里裁掉，按钮尺寸不受影响。 --}}
            <span class="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-[11px] font-medium text-ink-2" id="user-avatar">
                <span aria-hidden="true" data-avatar-fallback>{{ mb_substr(trim(Auth::user()->name), 0, 1) ?: '?' }}</span>
                <img class="absolute inset-0 h-7 w-7 rounded-full object-cover opacity-0 transition-opacity duration-200"
                     id="user-avatar-img" alt="" width="28" height="28" decoding="async"
                     data-avatar-src="{{ Auth::user()->avatar }}"
                     onload="this.previousElementSibling && this.previousElementSibling.remove(); this.classList.remove('opacity-0');"
                     onerror="this.remove();">
            </span>
            <span class="ls-user-name sm:block hidden text-ink-2">{{ Auth::user()->name }}</span>
        </button>
    </x-slot>

    <x-slot name="content">
        <!-- Authentication -->
        <form method="POST" action="{{ route('logout') }}">
            @csrf
            <x-dropdown-link href="{{ route('images') }}">我的图片</x-dropdown-link>
            <x-dropdown-link href="{{ route('dashboard') }}">仪表盘</x-dropdown-link>
            <x-dropdown-link href="{{ route('settings') }}">用户设置</x-dropdown-link>
            <x-dropdown-link :href="route('logout')" onclick="event.preventDefault(); this.closest('form').submit();">
                {{ __('Log Out') }}
            </x-dropdown-link>
        </form>
    </x-slot>
</x-dropdown>

{{-- 头像的延迟加载：等页面 load 完（其它资源都好了）再把 data-avatar-src 接到 img.src 上。
     不引入任何依赖；header / welcome 都会 include 本文件，重复 include 也安全（一个 flag + querySelectorAll 幂等）。 --}}
<script>
    (function () {
        if (window.__userNavAvatarInit) {
            return;
        }
        window.__userNavAvatarInit = true;
        var fill = function () {
            document.querySelectorAll('img[data-avatar-src]').forEach(function (img) {
                img.src = img.getAttribute('data-avatar-src');
            });
        };
        if (document.readyState === 'complete') {
            fill();
        } else {
            window.addEventListener('load', fill);
        }
    })();
</script>
