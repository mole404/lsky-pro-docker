<div class="flex items-center mr-4">
    <input type="radio" {{ $attributes->merge(['id' => $id, 'name' => $name, 'class' => 'h-4 w-4 text-brand border-line-2 bg-surface focus:ring-brand', 'value' => $value ?? 0]) }}>
    <label for="{{ $id }}" class="ml-2.5 block text-[13px] font-medium text-ink-2">{{ $slot }}</label>
</div>
