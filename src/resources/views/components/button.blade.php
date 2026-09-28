<button {{ $attributes->merge(['type' => 'submit', 'class' => 'ls-btn']) }}>
    {{ $slot }}
</button>
