<!-- Profile dropdown -->
<x-dropdown>
    <x-slot name="trigger">
        <button type="button" class="flex items-center justify-center gap-2 h-10 w-10 p-0 rounded-full border border-line hover:bg-surface-2 text-[14px] text-ink sm:w-auto sm:pl-1 sm:pr-2" id="user-menu-button" aria-expanded="false" aria-haspopup="true">
            <span class="sr-only">Open user menu</span>
            <img class="h-7 w-7 rounded-full object-cover" src="{{ Auth::user()->avatar }}" alt="">
            <span class="px-1 sm:block hidden text-ink-2">{{ Auth::user()->name }}</span>
        </button>
    </x-slot>

    <x-slot name="content">
        <!-- Authentication -->
        <form method="POST" action="{{ route('logout') }}">
            @csrf
            <x-dropdown-link href="{{ route('images') }}">我的图片</x-dropdown-link>
            <x-dropdown-link href="{{ route('dashboard') }}">仪表盘</x-dropdown-link>
            <x-dropdown-link href="{{ route('settings') }}">用户设置</x-dropdown-link>
            <x-dropdown-link :href="route('logout')" onclick="event.preventDefault(); this.closest('form').submit();">
                {{ __('Log Out') }}
            </x-dropdown-link>
        </form>
    </x-slot>
</x-dropdown>
