<?php

namespace App\Http\Requests;

class UserSettingRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'name' => 'required|between:2,20',
            'url' => 'nullable|url',
            'password' => 'nullable|between:6,32',
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
            'name.required' => '昵称不能为空',
            'name.between' => '昵称必须在 2-20 个字符之间',
            'url.url' => '个人主页地址格式不正确',
            'password.between' => '密码必须在 6-32 个字符之间',
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
