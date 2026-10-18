<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\FormRequest;

class UserRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'group_id' => 'required',
            'name' => 'required|between:2,20',
            'capacity' => 'required|numeric',
            // 确认密码排在密码之前：它为 implicit 规则，先校验才能让空确认框
            // 命中 required_with 的提示，而不是先报 password.confirmed。
            'password_confirmation' => ['nullable', 'required_with:password'],
            'password' => ['nullable', 'between:8,32', 'confirmed'],
            'status' => 'in:1,0'
        ];
    }

    public function attributes()
    {
        return [
            'group_id' => '角色组',
            'name' => '名称',
            'capacity' => '总容量',
            'password' => '密码',
            'password_confirmation' => '确认密码',
            'status' => '状态',
        ];
    }

    public function messages()
    {
        return [
            'name.required' => '名称不能为空',
            'name.between' => '名称必须在 2-20 个字符之间',
            'password.confirmed' => '两次输入的密码不一致',
            'password_confirmation.required_with' => '请再输入一次密码',
            'password.between' => '密码必须为 8-32 个字符',
        ];
    }
}
