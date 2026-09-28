<pre {{ $attributes->merge(['class' => 'my-2 rounded-lg p-4 text-[12.5px] leading-relaxed bg-surface-3 text-ink-2 border border-line overflow-x-auto']) }}>
{{ $slot ?? '' }}
</pre>
