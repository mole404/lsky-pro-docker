@props(['selected' => [], 'name' => 'groups'])

@php
    // 已选集合：编辑页传该策略已关联的组 id；一律按 int 比对
    $checked = collect($selected)->map(fn ($id) => (int) $id)->all();
    // 与原来一样：列出全部角色组（组本身不多，一次取完就够了）
    $groups = \App\Models\Group::query()->orderBy('id')->get();
@endphp

{{-- fork：角色组多选改成打勾清单。
     原生 <select multiple> 在桌面必须按住 Ctrl/⌘ 点选，手机上几乎没法多选；
     一行一个复选框则是「点一下 = 勾上/取消」，桌面与触摸端一致。
     组多了不撑破表单：.ls-checklist 有最大高度 + 框内纵向滚动（样式见 css/common.css）。

     表单是 axios 提交 + $(form).serialize()：复选框只在勾选时进串，
     name 用 name="groups[]" ⇒ 与原来的 <select multiple> 完全同形，后端无需改动
     （StrategyRequest 的 'groups' => 'array'，控制器 attach()/sync()）。 --}}
<div {{ $attributes->merge(['class' => 'ls-checklist', 'role' => 'group', 'aria-label' => '选择角色组']) }}>
    @forelse ($groups as $group)
        <label class="ls-checklist__item">
            <input type="checkbox"
                   name="{{ $name }}[]"
                   value="{{ $group->id }}"
                   @checked(in_array((int) $group->id, $checked, true))
                   class="h-4 w-4 rounded text-brand border-line-2 bg-surface focus:ring-brand">
            <span class="ls-checklist__name">{{ $group->name }}</span>
        </label>
    @empty
        <p class="ls-checklist__empty">还没有任何角色组，请先到「角色组」里创建。</p>
    @endforelse
</div>
