<?php

namespace App\Http\Requests;

class TagRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    public function rules()
    {
        return [
            'name' => 'required|string|max:64',
        ];
    }

    public function messages()
    {
        return [
            'name.required' => '请输入标签名称',
            'name.string' => '标签名称格式不正确',
            'name.max' => '标签名称长度不能超过 64 个字符',
        ];
    }
}
