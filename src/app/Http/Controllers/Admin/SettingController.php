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
