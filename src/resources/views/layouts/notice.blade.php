@if($_is_notice)
    <button type="button" class="ls-btn ls-btn-sm h-10 rounded-full px-1.5 gap-2" id="open-notice" aria-expanded="false" aria-haspopup="true">
        <div class="h-7 w-7 rounded-full flex items-center justify-center bg-surface-2 border border-line">
            <i class="fas fa-envelope text-ink-2 text-[13.5px]"></i>
        </div>
        <span class="px-2 sm:block hidden">公告</span>
    </button>
    @push('scripts')
        <script>
            $('#open-notice').click(function () {
                openNotice();
            });
        </script>
    @endpush
@endif
