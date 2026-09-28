<div class="flex items-center h-5 space-x-2 mr-4">
    <input type="checkbox" {{ $attributes->merge(['name' => $name, 'class' => 'h-4 w-4 rounded text-brand border-line-2 bg-surface focus:ring-brand']) }}/>
    <label {{ isset($id) ? "for={$id}" : '' }} class="font-medium text-[13px] text-ink-2">{{ $slot }}</label>
</div>
