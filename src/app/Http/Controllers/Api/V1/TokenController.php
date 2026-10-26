<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Middleware\EnsureEmailIsVerifiedIfRequired;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class TokenController extends Controller
{
    public function store(Request $request): Response
    {
        try {
            $request->validate([
                'email' => 'required|email',
                'password' => 'required',
            ]);
        } catch (ValidationException $e) {
            return $this->fail($e->validator->errors()->first());
        }

        /** @var User|null $user */
        $user = User::query()->where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            return $this->fail('The email address or password is incorrect.');
        }

        // 后台开了邮箱验证时，未验证用户不许换 token —— 这条路由是公开的，
        // 挂不上 verified.if-required 中间件，必须在这里用同一个判断卡住。
        if (EnsureEmailIsVerifiedIfRequired::blocks($user)) {
            return $this->fail('请先验证您的邮箱');
        }

        $token = $user->createToken($user->email)->plainTextToken;

        return $this->success('success', compact('token'));
    }

    public function clear(): Response
    {
        /** @var User $user */
        $user = Auth::user();
        $user->tokens()->delete();
        return $this->success();
    }
}
