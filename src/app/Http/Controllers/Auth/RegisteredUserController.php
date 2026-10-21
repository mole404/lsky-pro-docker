<?php

namespace App\Http\Controllers\Auth;

use App\Enums\ConfigKey;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Providers\RouteServiceProvider;
use App\Support\Username;
use App\Utils;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

class RegisteredUserController extends Controller
{
    /**
     * Display the registration view.
     *
     * @return \Illuminate\View\View
     */
    public function create()
    {
        return view('auth.register');
    }

    /**
     * Handle an incoming registration request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\RedirectResponse
     *
     * @throws \Illuminate\Validation\ValidationException
     */
    public function store(Request $request)
    {
        // 校验前先裁掉名称两端的空白（含全角空格、NBSP 等多字节空白）。
        $request->merge(['name' => Username::normalize($request->input('name'))]);

        $request->validate([
            'name' => ['required', 'string', 'between:1,20', 'not_regex:' . Username::BLANK_PATTERN],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'password' => ['required', 'string', 'between:8,32', 'confirmed'],
        ], [
            'name.between' => '名称必须在 1-20 个字符之间',
            'name.not_regex' => '名称不能为空白字符',
            'password.between' => '密码必须为 8-32 个字符',
            'password.confirmed' => '两次输入的密码不一致',
        ]);

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'registered_ip' => $request->ip(),
        ]);

        if (Utils::config(ConfigKey::IsUserNeedVerify)) {
            event(new Registered($user));
        }

        Auth::login($user);

        return redirect(RouteServiceProvider::HOME);
    }
}
