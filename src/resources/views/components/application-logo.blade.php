{{-- 站点品牌：LOGO 图案（透明底 PNG，与侧栏/顶栏用的是同一个文件）+ 站点名称，整体居中。
     尺寸（图案 40×40）在这里定，调用方只传文字上的类（字号/颜色），例如 class="text-ink-2 text-4xl"。
     ⚠ 别再给调用方传 w-20 h-20 这种固定宽高：那会把整个 <span> 撑成 80×80、文字溢出、居中就散了。
     ⚠ 2026-10-09：文字那层必须给足行高（inline line-height:1.2）。外层 leading-none 把行盒压成 1em，
        而本套字体一个行框要 ascent+descent ≈ 1.14em（实测 36px 字号：行框 41px、墨迹底落在盒顶下
        42.5px），再叠上 truncate 的 overflow:hidden ⇒ 英文 descender 被切（"Lsky Pro" 的 y 下半截）。
        行高用 inline style 而不是 leading-tight / leading-snug 这类 Tailwind 类：产物 app.css 里没有那些类
        （前端 CSS 是预编译入库的，构建期不跑 npm ⇒ 新类不会生效）。 --}}
<span {{ $attributes->merge(['class' => 'inline-flex items-center justify-center gap-3 leading-none']) }}>
    <img src="{{ asset('static/lsky-logo.png') . '?v=' . \App\Utils::assetVersion('static/lsky-logo.png') }}"
         alt="" width="40" height="40" decoding="async" class="h-10 w-10 shrink-0 select-none">
    <span class="truncate" style="line-height: 1.2">{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</span>
</span>
