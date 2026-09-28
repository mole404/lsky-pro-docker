<div class="flex flex-col">
    <div class="-my-2 sm:-mx-6 lg:-mx-8">
        <div class="py-2 align-middle inline-block w-full sm:px-6 lg:px-8">
            <div class="overflow-x-auto sm:rounded-[10px] bg-surface w-full border border-line shadow-card">
                <table class="min-w-full w-full divide-y divide-line">
                    <thead class="bg-surface-2">
                    <tr>
                        @foreach($columns as $column)
                            <th scope="col" class="ls-th">
                                {{ $column }}
                            </th>
                        @endforeach
                    </tr>
                    </thead>
                    <tbody class="bg-surface divide-y divide-line">
                    {{ $slot }}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>
