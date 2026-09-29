@props(['id' => 'modal'])

{{-- 高度一律用动态视口单位 dvh：手机地址栏可见时 100vh 比"看得见的区域"高，越界那一截就是底部空带。
     100dvh 跟着地址栏收起/展开实时变，两种情形都刚好铺满。--}}
{{-- overscroll-contain（= overscroll-behavior:contain）加在弹窗自己的滚动容器上：弹窗里滚到尽头后
     不再把滚动"接力"给背后的页面。安卓上滚动一旦传给页面，地址栏会跟着收起、可视视口变高，
     弹窗底部就空出一块——这条"接力"才是那块空带的入口。
     触发链：弹窗内滚到底 → 滚动接力到页面 → 地址栏收起/视口变高 → 弹窗底部露出空带（已实测复现）。--}}
<div {{ $attributes->merge(['id' => $id, 'class' => "fixed z-10 inset-0 h-[100dvh] overflow-y-auto overscroll-contain"]) }} role="dialog" aria-modal="true" x-data x-cloak x-show="$store.modal.isOpen('{{ $id }}')">
    {{-- 内层 min-height 用「vh 声明在前、dvh 声明在后」的内联写法：同一对大括号里后者胜，
         与 Tailwind 的生成顺序无关（两个工具类同名属性谁赢取决于样式表顺序，不稳）。
         支持 dvh 的浏览器用 dvh（= 真实可见视口）；不认识的旧浏览器整条 dvh 声明作废，
         自动退回紧邻的 100vh（= 旧行为）。桌面上 100dvh === 100vh，函数等价。 --}}
    <div class="flex text-center md:block md:px-2 lg:px-4" style="font-size: 0; min-height: 100vh; min-height: 100dvh">
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
        {{-- 桌面端垂直居中的撑高符同样走「vh 在前、dvh 在后」，链路上不再留 md:h-screen(100vh)。 --}}
        <span class="hidden md:inline-block md:align-middle" style="height: 100vh; height: 100dvh" aria-hidden="true">&#8203;</span>

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
