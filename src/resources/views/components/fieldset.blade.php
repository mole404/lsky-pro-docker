<fieldset>
    <legend class="text-[15px] font-semibold text-ink">{{ $title }}</legend>
    @isset($faq)
        <p class="text-[13px] text-ink-2">{!! $faq !!}</p>
    @endisset
    <div class="flex flex-wrap mt-4">
        {{ $slot }}
    </div>
</fieldset>
