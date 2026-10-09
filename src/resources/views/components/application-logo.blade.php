{{-- 站点品牌：LOGO 图案（透明底 PNG，与侧栏/顶栏用的是同一个文件）+ 站点名称，整体居中。
     尺寸（图案 40×40）在这里定，调用方只传文字上的类（字号/颜色），例如 class="text-ink-2 text-4xl"。
     ⚠ 别再给调用方传 w-20 h-20 这种固定宽高：那会把整个 <span> 撑成 80×80、文字溢出、居中就散了。
     ⚠ 2026-10-09：文字那层必须给足行高（inline line-height —— 别用 Tailwind 类：产物 app.css 里没有
        leading-tight / leading-snug / leading-normal，前端 CSS 预编译入库、构建期不跑 npm ⇒ 新类不生效）。
        外层 leading-none 把行盒压成 1em（调用方 text-4xl = 36px ⇒ 行盒 36px），而内层 truncate 的
        overflow:hidden 会按行盒切掉英文 descender 的尾端（"Lsky Pro" 的 y 下半截；中文无 descender 不受影响）。
        ★ 行框高度**随字体走**，同一份 CSS 在不同系统表现不同：本站字体栈是 system-ui → Windows 取
        Segoe UI（行框 ≈1.33em = 47.9px @36px），而 Linux 无头 Chrome 的 fallback 只有 ≈1.14em（41px）。
        所以 1.2（43.2px）在 Linux 复现里「不裁」、在 Windows 上仍差 ≈0.9px（真机实测「还是有一点
        被遮住」）。现在给到 1.4（50.4px）+ 上下 2px padding（overflow 的裁切边界是 padding box）：
        Segoe UI 下墨迹底 ≈47.7px、余量 ≈7px，常见字体行框（≤1.5em）都装得下。
        （量法：零高 inline-block 探针测布局基线 + 造一份 overflow:visible 的复制品取像素真值。）
     ⚠ 2026-10-09 晚：调用方字号 text-4xl(36px) → **text-3xl(30px)**，图标与文字的 gap 3(12px) →
        2(8px)。⇒ 品牌块高 = max(图标 40px, 文字行盒 30×1.4 + 上下 2px padding = 46px) = **46px**。
        ★ auth-card.blade.php 里那对 `calc(1.5rem + 4.375rem)` 的预留空间就是按 46 + 24 = 70px 算的：
          改这里的字号 / 行高 / padding / 图标尺寸 / gap，必须同步改那边。 --}}
<span {{ $attributes->merge(['class' => 'inline-flex items-center justify-center gap-2 leading-none']) }}>
    <img src="{{ asset('static/lsky-logo.png') . '?v=' . \App\Utils::assetVersion('static/lsky-logo.png') }}"
         alt="" width="40" height="40" decoding="async" class="h-10 w-10 shrink-0 select-none">
    <span class="truncate" style="line-height: 1.4; padding: 2px 0">{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</span>
</span>
