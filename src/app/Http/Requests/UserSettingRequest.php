<?php

namespace App\Http\Requests;

use App\Support\Username;

class UserSettingRequest extends FormRequest
{
    /**
     * 校验前先裁掉名称两端的空白（含全角空格、NBSP 等多字节空白）。
     */
    protected function prepareForValidation()
    {
        $this->merge(['name' => Username::normalize($this->input('name'))]);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'name' => ['required', 'string', 'between:1,20', 'not_regex:' . Username::BLANK_PATTERN],
            'url' => 'nullable|url',
            'password' => 'nullable|between:8,32|confirmed',
            'password_confirmation' => 'nullable|required_with:password',
            'configs' => 'array',
            'configs.default_album' => 'required|numeric',
            'configs.default_strategy' => 'required|numeric',
            // fork：用户设置页里的「图片默认权限」这项设置已下线（界面口径随之移除），
            // 表单不再提交这一项 —— 所以这里从 required 放宽成 nullable，否则保存设置会直接
            // 校验失败（422）。上传时的默认权限照旧取 $user->configs 里已有的值（UserController
            // 用 merge 保存，缺这一项时旧值原样保留），行为不变。
            'configs.default_permission' => 'nullable|in:1,0',
            'configs.pasted_action' => 'required|in:1,2',
            'configs.is_auto_clear_preview' => 'nullable|boolean'
        ];
    }

    public function messages()
    {
        return [
            'name.required' => '名称不能为空',
            'name.between' => '名称必须在 1-20 个字符之间',
            'name.not_regex' => '名称不能为空白字符',
            'url.url' => '个人主页地址格式不正确',
            'password.between' => '密码必须为 8-32 个字符',
            'password.confirmed' => '两次输入的密码不一致',
            'password_confirmation.required_with' => '请再输入一次密码',
            'configs.array' => '配置值不正确',
            'configs.default_album.required' => '默认相册选择错误',
            'configs.default_album.numeric' => '默认相册选择错误',
            'configs.default_strategy.required' => '默认策略选择错误',
            'configs.default_strategy.numeric' => '默认策略选择错误',
            'configs.default_permission.in' => '权限值不正确',
            'configs.pasted_action.required' => '粘贴动作值选择错误',
            'configs.pasted_action.in' => '粘贴动作值不正确',
            'configs.is_auto_clear_preview.boolean' => '是否自动清除预览选择错误'
        ];
    }
}
