@props(['value'])

<label {{ $attributes->merge(['class' => 'ls-label']) }}>
    {{ $value ?? $slot }}
</label>
