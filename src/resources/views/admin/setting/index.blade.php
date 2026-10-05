@section('title', '系统设置')

@push('styles')
    <link rel="stylesheet" href="{{ asset('css/markdown-css/github-markdown-light.css') }}">
@endpush

<x-app-layout>
    <div class="my-6 md:my-9">
        <p class="mb-3 font-semibold text-lg text-ink">通用</p>
        <form action="{{ route('admin.settings.save') }}">
            <div class="relative p-4 rounded-md bg-surface mb-8 space-y-4 shadow-card">
                <div>
                    <label for="app_name" class="block text-sm font-medium text-ink"><span class="text-danger">*</span>应用名称</label>
                    <x-input type="text" name="app_name" id="app_name" value="{{ $configs->get('app_name') }}" placeholder="请输入应用名称"/>
                </div>
                <div>
                    <label for="site_keywords" class="block text-sm font-medium text-ink">网站关键字</label>
                    <x-textarea type="text" name="site_keywords" id="site_keywords" placeholder="请输入网站关键字">{{ $configs->get('site_keywords') }}</x-textarea>
                </div>
                <div>
                    <label for="site_description" class="block text-sm font-medium text-ink">网站描述</label>
                    <x-textarea type="text" name="site_description" id="site_description" placeholder="请输入网站描述">{{ $configs->get('site_description') }}</x-textarea>
                </div>
                <div>
                    <label for="icp_no" class="block text-sm font-medium text-ink">备案号</label>
                    <x-input type="text" name="icp_no" id="icp_no" value="{{ $configs->get('icp_no') }}" placeholder="请输入备案号"/>
                </div>
                <div>
                    <label for="site_notice" class="block text-sm font-medium text-ink">网站公告</label>
                    <x-textarea type="text" name="site_notice" id="site_notice" placeholder="首页弹出公告，支持 Markdown，不设置请留空。" rows="7">{{ $configs->get('site_notice') }}</x-textarea>
                </div>

                <div class="text-right">
                    <x-button type="submit">保存更改</x-button>
                </div>
            </div>
        </form>

        <p class="mb-3 font-semibold text-lg text-ink">控制</p>
        <form action="{{ route('admin.settings.save') }}">
            <div class="relative p-4 rounded-md bg-surface mb-8 space-y-4 shadow-card">
                <x-fieldset title="是否启用注册" faq="启用或关闭系统注册功能">
                    <x-switch name="is_enable_registration" value="1" :checked="(bool) $configs->get('is_enable_registration')" />
                </x-fieldset>
                <x-fieldset title="是否启用接口" faq="启用或关闭接口功能，关闭后将无法通过接口上传图片、管理图片等操作。">
                    <x-switch name="is_enable_api" value="1" :checked="(bool) $configs->get('is_enable_api')" />
                </x-fieldset>
                <x-fieldset title="是否允许游客上传" faq="启用或关闭游客上传功能，游客上传受「系统默认组」控制。">
                    <x-switch name="is_allow_guest_upload" value="1" :checked="(bool) $configs->get('is_allow_guest_upload')" />
                </x-fieldset>
                <x-fieldset title="账号验证" faq="是否强制用户验证邮箱，开启后用户必须经过验证邮箱后才能上传图片，请确保邮件配置正常。">
                    <x-switch name="is_user_need_verify" value="1" :checked="(bool) $configs->get('is_user_need_verify')" />
                </x-fieldset>
                <div class="text-right">
                    <x-button type="submit">保存更改</x-button>
                </div>
            </div>
        </form>

        <p class="mb-3 font-semibold text-lg text-ink">用户</p>
        <form action="{{ route('admin.settings.save') }}">
            <div class="relative p-4 rounded-md bg-surface mb-8 space-y-4 shadow-card">
                <div>
                    <label for="user_initial_capacity" class="block text-sm font-medium text-ink">用户初始容量(KB)</label>
                    <x-input type="number" name="user_initial_capacity" id="user_initial_capacity" step="0.01" value="{{ $configs->get('user_initial_capacity') }}" placeholder="请输入用户初始容量(KB)"/>
                </div>

                <div class="text-right">
                    <x-button type="submit">保存更改</x-button>
                </div>
            </div>
        </form>

        <p class="mb-3 font-semibold text-lg text-ink">邮件配置</p>
        <div class="relative p-4 rounded-md bg-surface mb-8 space-y-4 shadow-card">
            <x-fieldset title="发信驱动">
                <x-fieldset-radio id="mail[default]" name="mail[default]" data-select="mailer" value="smtp" checked>SMTP</x-fieldset-radio>
            </x-fieldset>

            <div class="mb-4 hidden" data-mailer-driver="smtp">
                <form action="{{ route('admin.settings.save') }}" class="space-y-4">
                    <div>
                        <label for="mail[mailers][smtp][host]" class="block text-sm font-medium text-ink"><span class="text-danger">*</span>主机地址</label>
                        <x-input type="text" name="mail[mailers][smtp][host]" id="mail[mailers][smtp][host]" value="{{ $configs['mail']['mailers']['smtp']['host'] ?? '' }}" placeholder="请输入 SMTP 主机地址"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][port]" class="block text-sm font-medium text-ink"><span class="text-danger">*</span>连接端口</label>
                        <x-input type="number" name="mail[mailers][smtp][port]" id="mail[mailers][smtp][port]" value="{{ $configs['mail']['mailers']['smtp']['port'] ?? 587 }}" placeholder="请输入 SMTP 主机连接端口"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][username]" class="block text-sm font-medium text-ink"><span class="text-danger">*</span>用户名</label>
                        <x-input type="text" name="mail[mailers][smtp][username]" id="mail[mailers][smtp][username]" value="{{ $configs['mail']['mailers']['smtp']['username'] ?? '' }}" placeholder="请输入用户名"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][password]" class="block text-sm font-medium text-ink"><span class="text-danger">*</span>密码</label>
                        <x-input type="password" name="mail[mailers][smtp][password]" id="mail[mailers][smtp][password]" value="{{ $configs['mail']['mailers']['smtp']['password'] ?? '' }}" placeholder="请输入密码"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][encryption]" class="block text-sm font-medium text-ink">加密方式</label>
                        <x-input type="text" name="mail[mailers][smtp][encryption]" id="mail[mailers][smtp][encryption]" value="{{ $configs['mail']['mailers']['smtp']['encryption'] ?? '' }}" placeholder="请输入加密方式(ssl, tls)"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][timeout]" class="block text-sm font-medium text-ink">连接超时时间(秒)</label>
                        <x-input type="number" name="mail[mailers][smtp][timeout]" id="mail[mailers][smtp][timeout]" value="{{ $configs['mail']['mailers']['smtp']['timeout'] ?? 10 }}" placeholder="请输入连接超时时间(秒)"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][from_address]" class="block text-sm font-medium text-ink">发件人地址</label>
                        <x-input type="email" name="mail[from][address]" id="mail[from][address]" value="{{ $configs['mail']['from']['address'] ?? '' }}" placeholder="请输入发件人邮箱地址"/>
                    </div>
                    <div>
                        <label for="mail[mailers][smtp][from_name]" class="block text-sm font-medium text-ink">发件人名称</label>
                        <x-input type="text" name="mail[from][name]" id="mail[from][name]" value="{{ $configs['mail']['from']['name'] ?? '' }}" placeholder="请输入发件人名称"/>
                    </div>

                    <input type="hidden" name="mail[default]" value="smtp">
                    <input type="hidden" name="mail[mailers][smtp][transport]" value="smtp">

                    <div class="text-right">
                        <x-button type="button" id="mail-test" class="bg-yellow-500">测试</x-button>
                        <x-button type="submit">保存更改</x-button>
                    </div>
                </form>
            </div>
        </div>

        <p class="mb-3 font-semibold text-lg text-ink">关于</p>
        <div class="relative p-4 rounded-md bg-surface mb-8 shadow-card">
            <p class="text-center pt-2 text-ink">
                {{ $version }}@if($commit) <span class="text-ink-2 font-mono">{{ $commit }}</span>@endif
            </p>
            <p class="text-center pb-2 text-sm text-ink-2">By {{ $author }}</p>
        </div>
    </div>


    @push('scripts')
        <script>
            // 设置选中驱动
            let setSelected = function () {
                $('[data-select]').each(function () {
                    $(`[data-${$(this).data('select')}-driver=${$(this).val()}]`)[this.checked ? 'show' : 'hide']();
                });
            };

            setSelected();

            $('[data-select]').click(function () {
                setSelected();
            });

            $('form').submit(function (e) {
                e.preventDefault();
                axios.put(this.action, $(this).serialize()).then(function (response) {
                    toastr[response.data.status ? 'success' : 'error'](response.data.message)
                });
            });

            $('#mail-test').click(function () {
                Swal.fire({
                    title: '请输入接收测试邮件的邮箱',
                    input: 'text',
                    inputValue: '',
                    inputAttributes: {
                        type: 'email',
                        autocapitalize: 'off'
                    },
                    showCancelButton: true,
                    confirmButtonText: '确认',
                    showLoaderOnConfirm: true,
                    preConfirm: (value) => {
                        return axios.post('{{ route('admin.settings.mail.test') }}', {
                            email: value,
                        }).then(response => {
                            if (! response.data.status) {
                                throw new Error(response.data.message)
                            }
                            return response.data;
                        }).catch(error => Swal.showValidationMessage(error));
                    },
                    allowOutsideClick: () => !Swal.isLoading()
                }).then((result) => {
                    if (result.isConfirmed) {
                        toastr[result.value.status ? 'success' : 'warning'](result.value.message);
                    }
                })
            });

        </script>
    @endpush

</x-app-layout>
