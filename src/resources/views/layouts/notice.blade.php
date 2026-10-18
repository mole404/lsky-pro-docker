@if($_is_notice)
    <button type="button" class="ls-btn ls-btn-sm h-10 w-10 rounded-full px-0 justify-center gap-2 border-line sm:w-auto sm:px-3" id="open-notice" aria-haspopup="dialog" aria-controls="notice-modal">
        <span class="sr-only">公告</span>
        <i class="fas fa-envelope text-ink-2 text-[13.5px]"></i>
        <span class="ls-notice-label sm:block hidden" aria-hidden="true">公告</span>
    </button>
    @push('scripts')
        <script>
            $('#open-notice').click(function () {
                openNotice();
            });
        </script>
    @endpush
@endif
