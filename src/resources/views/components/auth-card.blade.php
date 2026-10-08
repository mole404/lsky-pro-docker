{{-- 老师 2026-10-08：登录框要**自己**几何居中。
     原来 LOGO 与卡片同处一个 justify-center 的列里 ⇒ 居中基准是「LOGO + 卡片」这个整体，
     卡片必然被压到中线以下（线上实测：390×844 偏下 35.5px、1280×720 偏下 38.9px）。
     注意这与右上角的「外观切换」无关 —— 它是 absolute，不占布局（实测只在 16→56 那条带里）。
     现在把 LOGO 改成悬在卡片正上方的绝对定位元素，居中基准只剩卡片本身。
     ★ 定位用 inline style，不用 bottom-full / inset-x-0 这类 Tailwind 类：产物里可能还没生成，
       新类不重建 CSS 就不生效（本机预览时因此当场露馅一次）。 --}}
<div class="min-h-screen ls-zoom-minh-screen flex flex-col justify-center items-center py-6 bg-bg px-4">
    <div class="relative w-full flex flex-col items-center">
        <div class="absolute flex justify-center" style="left: 0; right: 0; bottom: 100%; margin-bottom: 1.5rem;">
            {{ $logo }}
        </div>

        <div class="ls-card w-full sm:max-w-md px-6 py-5 overflow-hidden sm:rounded-xl2">
            {{ $slot }}
        </div>
    </div>
</div>
