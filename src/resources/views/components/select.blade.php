@props(['disabled' => false])

<select {{ $disabled ? 'disabled' : '' }} {!! $attributes->merge(['class' => 'ls-input mt-1']) !!}>
    {{ $slot }}
</select>
