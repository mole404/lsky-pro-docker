@props(['id' => 'modal'])

{{-- 高度一律用动态视口单位 dvh：手机地址栏可见时 100vh 比"看得见的区域"高，
     弹窗会伸出屏幕外（下滑就能看到底下一块空白）。100dvh 跟着地址栏收起/展开实时变，
     两种情形都刚好铺满。--}}
<div {{ $attributes->merge(['id' => $id, 'class' => "fixed z-10 inset-0 h-[100dvh] overflow-y-auto"]) }} role="dialog" aria-modal="true" x-data x-cloak x-show="$store.modal.isOpen('{{ $id }}')">
    {{-- min-h-screen(100vh) 保留在前面当兜底：浏览器不认识 dvh 时整条声明作废，退回 100vh（旧行为）。
         桌面上 100dvh === 100vh，所以这一行对桌面零影响。 --}}
    <div class="flex min-h-screen min-h-[100dvh] text-center md:block md:px-2 lg:px-4" style="font-size: 0">
        <div x-transition:enter="transition ease-out duration-300"
             x-transition:enter-start="transform opacity-0"
             x-transition:enter-end="transform opacity-100"
             x-transition:leave="transition ease-in duration-200"
             x-transition:leave-start="transform opacity-100"
             x-transition:leave-end="transform opacity-0"
             x-show="$store.modal.isOpen('{{ $id }}')"
             @click="$store.modal.close('{{ $id }}')"
             class="hidden fixed inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity md:block"
             aria-hidden="true"
        >
        </div>
        <span class="hidden md:inline-block md:align-middle md:h-screen" aria-hidden="true">&#8203;</span>

        <div x-transition:enter="transition ease-out duration-300"
             x-transition:enter-start="transform opacity-0 translate-y-4 md:translate-y-0 md:scale-95"
             x-transition:enter-end="transform opacity-100 translate-y-0 md:scale-100"
             x-transition:leave="transition ease-in duration-200"
             x-transition:leave-start="transform opacity-100 translate-y-0 md:scale-100"
             x-transition:leave-end="transform opacity-0 translate-y-4 md:translate-y-0 md:scale-95"
             x-show="$store.modal.isOpen('{{ $id }}')"
             class="flex text-base text-left transform transition w-full md:inline-block md:max-w-2xl md:px-4 md:my-8 md:align-middle lg:max-w-4xl"
        >
            <div class="w-full relative flex bg-surface border border-line px-4 pt-14 pb-8 overflow-hidden sm:px-6 sm:pt-8 md:p-6 lg:p-8 md:rounded-xl2" style="box-shadow: var(--lsky-shadow-modal)">
                <button type="button" class="absolute top-2 right-2 text-ink-3 hover:text-ink sm:top-4 sm:right-4 md:top-3 md:right-3 lg:top-4 lg:right-4" @click="$store.modal.close('{{ $id }}')">
                    <span class="sr-only">Close</span>
                    <svg class="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div class="flex items-center justify-center h-24 w-full" x-show="$store.modal.isLoading('{{ $id }}')">
                    <x-loading-spin />
                </div>

                <div class="w-full" x-show="! $store.modal.isLoading('{{ $id }}')">
                    {{ $slot ?? '' }}
                </div>
            </div>
        </div>
    </div>
</div>
