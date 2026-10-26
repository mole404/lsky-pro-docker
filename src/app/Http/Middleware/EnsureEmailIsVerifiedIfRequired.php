<?php

namespace App\Http\Middleware;

use App\Enums\ConfigKey;
use App\Http\Result;
use App\Models\User;
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
 * 拦下来时视请求来源给不同的壳：
 *   · /api/* —— {status:false, message}，HTTP 200（本站接口的错误一律是 200 + status:false，
 *     回 401/403 会被调用方当成「token 过期」去反复重新取 token）
 *   · 其它 AJAX / JSON —— 403 + 同形 body（前端 toastr 能直接显示）
 *   · 普通页面请求 —— 302 到 /verify-email（那页能重发验证邮件、也能退出登录）
 */
class EnsureEmailIsVerifiedIfRequired
{
    use Result;

    /**
     * 该用户此刻是否应当被「未验证邮箱」挡住。
     *
     * 公开路由（如 POST /api/v1/tokens 换 token、带头部的 POST /api/v1/upload）挂不上中间件，
     * 那里直接用这一个判断，保证规则只有一处，改动不会漏。
     */
    public static function blocks(?User $user): bool
    {
        return $user
            && Utils::config(ConfigKey::IsUserNeedVerify)
            && ! $user->is_adminer
            && ! $user->hasVerifiedEmail();
    }

    public function handle(Request $request, Closure $next)
    {
        if (! static::blocks($request->user())) {
            return $next($request);
        }

        if ($request->is('api/*')) {
            return $this->fail('请先验证您的邮箱');
        }

        if ($request->expectsJson()) {
            return response()->json(['status' => false, 'message' => '请先验证您的邮箱'], 403);
        }

        return redirect()->guest(route('verification.notice'));
    }
}
