@props(['disabled' => false])

<textarea {{ $disabled ? 'disabled' : '' }} {!! $attributes->merge(['class' => 'ls-input mt-1 h-auto py-2 leading-relaxed']) !!}>{{ $slot ?? '' }}</textarea>
