{{-- 老师 2026-10-08：登录框要**自己**几何居中。
     原来 LOGO 与卡片同处一个 justify-center 的列里 ⇒ 居中基准是「LOGO + 卡片」这个整体，
     卡片必然被压到中线以下（线上实测：390×844 偏下 35.5px、1280×720 偏下 38.9px）。
     注意这与右上角的「外观切换」无关 —— 它是 absolute，不占布局（实测只在 16→56 那条带里）。
     现在把 LOGO 改成悬在卡片正上方的绝对定位元素，居中基准只剩卡片本身。
     ★ 定位用 inline style，不用 bottom-full / inset-x-0 这类 Tailwind 类：产物里可能还没生成，
       新类不重建 CSS 就不生效（本机预览时因此当场露馅一次）。

     老师 2026-10-09：窗口高度变矮时 LOGO 会被视口顶部裁掉而且**永远滚不到** —— 绝对定位元素向
     「上」溢出的部分不进入 scrollable overflow region（只有向下/向右的溢出能滚到），所以页面要等
     卡片自己都放不下（视口高 < 卡片高 + py-6×2）才出滚动条，中间有约 157px 的死区。
     修法：容器上下各留出「LOGO 块高 + 间距」的空间（上下**对称** ⇒ 卡片依旧精确居中，几何不变）：
       ① 视口不够高时立刻出滚动条（比原来早 157px）
       ② 滚到顶时 LOGO 顶距容器顶正好 24px（py-6 那点呼吸感），完整可见
     LOGO 块高 = max(图标 40px, 文字行盒 36px×1.4 + 上下各 2px padding) = 54.4px，**与系统字体无关**
     （行高按 em 折算成固定 px，不像字形度量那样随字体走）；间距 = 1.5rem(24px) ⇒ 共 78.4px = 4.9rem。
     ⚠ 若改了品牌组件的字号 / 行高 / 图标尺寸，要同步改这两个 calc 里的 4.9rem。 --}}
<div class="min-h-screen ls-zoom-minh-screen flex flex-col justify-center items-center py-6 bg-bg px-4"
     style="padding-top: calc(1.5rem + 4.9rem); padding-bottom: calc(1.5rem + 4.9rem)">
    <div class="relative w-full flex flex-col items-center">
        <div class="absolute flex justify-center" style="left: 0; right: 0; bottom: 100%; margin-bottom: 1.5rem;">
            {{ $logo }}
        </div>

        <div class="ls-card w-full sm:max-w-md px-6 py-5 overflow-hidden sm:rounded-xl2">
            {{ $slot }}
        </div>
    </div>
</div>
