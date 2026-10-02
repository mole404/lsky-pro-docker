<?php

namespace App\Http\Requests;

class TagRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array
     */
    /**
     * fork：校验前先去掉首尾空白。
     * 只输入空格时 trim 后为空串，会被下面的 required 拦下（否则会建出一个空名标签）。
     *
     * @return void
     */
    protected function prepareForValidation()
    {
        $name = $this->input('name');
        if (is_scalar($name)) {
            $this->merge(['name' => trim((string) $name)]);
        }
    }

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
