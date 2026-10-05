<!-- Profile dropdown -->
<x-dropdown>
    <x-slot name="trigger">
        {{-- 左内边距 6px、右 12px（故意不等）：default-avatar.svg 里的人形自带 ~5.8px 透明留白
             （那颗脑袋+身体只占画布 58%，左右各留 ~20%）。这个文件**保持原样、不许改**（老师明确
             要以前那个样式），所以两边的视觉间距只能靠按钮 padding 补 —— 左 6px 正好让头像
             「可见左缘」≈12.8px（实测估算 13.3，与策略胶囊 12.9 对齐），与文字右侧（≈13px）、旁边策略胶囊（≈13.6px）对齐。
             换头像图 / 换那个 SVG 时，这个补偿值要重新量（原来不补偿时是 20px vs 15px，肉眼能看出不齐）。 --}}
        <button type="button" class="flex items-center justify-center gap-2 h-10 w-10 p-0 rounded-full border border-line hover:bg-surface-2 text-[14px] text-ink sm:w-auto sm:pl-1.5 sm:pr-3" id="user-menu-button" aria-expanded="false" aria-haspopup="true">
            <span class="sr-only">Open user menu</span>
            {{-- 头像占位框：固定 28×28（h-7 w-7 + width/height 属性），图片没到/挂了都不抖动。
                 里面两层：底下的「名字首字」色块圆圈（兜底）与盖在它上面的 img。
                 真地址放在 data-avatar-src —— 由文件末尾的内联脚本在页面 load 之后再接上，
                 这样外站头像（cravatar）再慢也不会拖住整页的 load（之前的「页面一直没加载完」）。
                 img 加载失败/被阻 → onerror 把自己撤掉，露出首字圆圈；加载成功 → 去掉首字（防透明图透字）。 --}}
            {{-- overflow-hidden 是必需的：flex 项的 min-width:auto 会按内容最小宽度撑开，
                 名字首字要是被换成长字符串（或字体异常），整个按钮会被顶宽 —— 加了它之后
                 内容再大也只在这个 28×28 的圆圈里裁掉，按钮尺寸不受影响。 --}}
            {{-- 头像保持**几何居中**（老师 2026-10-05 终裁，别再改回去）：
                 这个 SVG 的人形自己画偏下（头顶 18/96、底边贴 96/96，重心比画布中线低 ~2.7px），
                 但「用 -top-0.5 把 img 抬 2px 做视觉居中」和「抬整个 span」两种做法老师都否决了 ——
                 他实测后认定头像应当几何居中：28×28 方框上留白 = 下留白。
                 所以这里**不许再加任何垂直偏移 / transform / 尺寸补偿**；人形偏下是那张图自带的，
                 老师要的就是原图原样 + 方框居中。 --}}
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
