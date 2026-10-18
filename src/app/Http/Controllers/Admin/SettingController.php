<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Mail\Test;
use App\Models\Config;
use App\Utils;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\View\View;

class SettingController extends Controller
{
    public function index(): View
    {
        $configs = Utils::config();

        // fork：版本号来自代码（config/app.php），commit 来自镜像标记（.code-revision）。
        // 不再读取数据库里的 app_version，也不再联网检查上游更新（上游早已停更）。
        return view('admin.setting.index', [
            'configs' => $configs,
            'version' => config('app.version'),
            'author'  => config('app.author'),
            'commit'  => Utils::shortCommit(),
        ]);
    }

    public function save(Request $request): Response
    {
        // fork：本端点被页面 4 个表单共用（通用/控制/用户/邮件），只有「邮件配置」表单会提交 mail[*]。
        // 仅在该表单下校验 From 相关字段：发件人地址/名称为空会写进 DB 的 mail.from.*，
        // 覆盖 .env 默认值并让 Laravel 跳过 From 头，导致测试发信抛异常、找回密码 500。
        if ($request->has('mail')) {
            $validator = Validator::make($request->all(), [
                'mail.from.address' => 'required|email|max:255',
                'mail.from.name'    => 'required|string|max:60',
            ], [
                'mail.from.address.required' => '发件人地址不能为空',
                'mail.from.address.email'    => '发件人地址格式不正确',
                'mail.from.address.max'      => '发件人地址长度不能超过 255 个字符',
                'mail.from.name.required'    => '发件人名称不能为空',
                'mail.from.name.string'      => '发件人名称格式不正确',
                'mail.from.name.max'         => '发件人名称长度不能超过 60 个字符',
            ]);

            // 用 fail() 手动返回：$request->validate() 会把失败转成 422，而前端只 toastr 提示、没有 catch。
            if ($validator->fails()) {
                return $this->fail($validator->errors()->first());
            }
        }

        foreach ($request->all() as $key => $value) {
            Config::query()->where('name', $key)->update(['value' => $value]);
        }
        Cache::flush();
        return $this->success('保存成功');
    }

    public function mailTest(Request $request): Response
    {
        try {
            Mail::to($request->post('email'))->send(new Test());
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage());
        }
        return $this->success('发送成功');
    }
}
