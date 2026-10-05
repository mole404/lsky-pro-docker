{{-- 站点品牌：LOGO 图案（透明底 PNG，与侧栏/顶栏用的是同一个文件）+ 站点名称，整体居中。
     尺寸（图案 40×40）在这里定，调用方只传文字上的类（字号/颜色），例如 class="text-ink-2 text-4xl"。
     ⚠ 别再给调用方传 w-20 h-20 这种固定宽高：那会把整个 <span> 撑成 80×80、文字溢出、居中就散了。 --}}
<span {{ $attributes->merge(['class' => 'inline-flex items-center justify-center gap-3 leading-none']) }}>
    <img src="{{ asset('static/lsky-logo.png') . '?v=' . \App\Utils::assetVersion('static/lsky-logo.png') }}"
         alt="" width="40" height="40" decoding="async" class="h-10 w-10 shrink-0 select-none">
    <span class="truncate">{{ \App\Utils::config(\App\Enums\ConfigKey::AppName) }}</span>
</span>
