<?php

namespace App\Http\Middleware;

use App\Enums\ConfigKey;
use App\Utils;
use Closure;
use Illuminate\Http\Request;

/**
 * 「后台开了邮箱验证」时才把未验证用户挡在站内功能之外。
 *
 * 与 Laravel 自带 verified 中间件的差别：那个不看站点开关、一律拦。本站的邮箱验证是
 * 后台可开可关的配置（ConfigKey::IsUserNeedVerify），关掉时必须恢复成「登进来就能用」。
 *
 * 三条豁免：
 *   ① 配置关着 —— 直接放行（与关掉开关之前的站点行为一致）
 *   ② 管理员（is_adminer）—— 否则一旦开了开关又没验证，管理员本人也被挡在设置页外，无法自救
 *   ③ 已经验证过（email_verified_at 非空）
 *
 * 拦下来时：普通请求 302 到 /verify-email（那页能重发验证邮件、也能退出登录）；
 * AJAX / JSON 请求回 403 + {status, message}，与站内其它接口同形（前端 toastr 能直接显示）。
 */
class EnsureEmailIsVerifiedIfRequired
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();

        if (! $user
            || ! Utils::config(ConfigKey::IsUserNeedVerify)
            || $user->is_adminer
            || $user->hasVerifiedEmail()) {
            return $next($request);
        }

        if ($request->expectsJson()) {
            return response()->json(['status' => false, 'message' => '请先验证您的邮箱'], 403);
        }

        return redirect()->guest(route('verification.notice'));
    }
}
