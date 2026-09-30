<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\ConfirmablePasswordController;
use App\Http\Controllers\Auth\EmailVerificationNotificationController;
use App\Http\Controllers\Auth\EmailVerificationPromptController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\Auth\VerifyEmailController;
use App\Http\Middleware\CheckIsEnableRegistration;
use Illuminate\Support\Facades\Route;

Route::get('/register', [
    RegisteredUserController::class, 'create'
])->middleware('guest')->middleware(CheckIsEnableRegistration::class)->name('register');

// ---------------------------------------------------------------------------
// fork 加固（防爆破）：认证类 POST 端点加路由级节流。
// 背景：这些路由原来**一个 throttle 都没有**（全仓只有 verification.verify 的 6,1、
// verification.send 的 3,1、api 的 3,1）。Breeze 的 LoginRequest 里那个 RateLimiter 是
// 按 (邮箱|IP) 计数的（5 次失败 / 60 秒衰减），只能挡「盯着同一个账号撞库」；
// 换着邮箱撒网、或每个 IP 轮着来，它一点不挡。下面的 throttle 是**按路由+IP** 的硬上限，
// 两个限流互补：前者防单账号被撞，后者防同 IP 批量请求（邮箱枚举 / 注册滥用 / 邮件轰炸）。
// 注意（已知取舍，见 README）：应用里 TrustProxies 是 $proxies='*'，IP 取自
// X-Forwarded-For —— 前面有反向代理时拿到的是真实客户端 IP；**若站点直接暴露、没有代理
// 覆写这个头，攻击者能伪造它绕过按 IP 的限流**。这一条不改（改它会影响所有取 IP 的地方）。
// ---------------------------------------------------------------------------

Route::post('/register', [
    RegisteredUserController::class, 'store'
])->middleware(['guest', CheckIsEnableRegistration::class, 'throttle:5,1']);

Route::get('/login', [
    AuthenticatedSessionController::class, 'create',
])->middleware('guest')->name('login');

Route::post('/login', [
    AuthenticatedSessionController::class, 'store'
])->middleware(['guest', 'throttle:5,1']);

Route::get('/forgot-password', [
    PasswordResetLinkController::class, 'create',
])->middleware('guest')->name('password.request');

Route::post('/forgot-password', [
    PasswordResetLinkController::class, 'store',
])->middleware(['guest', 'throttle:6,1'])->name('password.email');

Route::get('/reset-password/{token}', [
    NewPasswordController::class, 'create',
])->middleware('guest')->name('password.reset');

Route::post('/reset-password', [
    NewPasswordController::class, 'store',
])->middleware('guest')->name('password.update');

Route::get('/verify-email', [
    EmailVerificationPromptController::class, '__invoke',
])->middleware('auth')->name('verification.notice');

Route::get('/verify-email/{id}/{hash}', [
    VerifyEmailController::class, '__invoke',
])->middleware(['auth', 'signed', 'throttle:6,1'])->name('verification.verify');

Route::post('/email/verification-notification', [
    EmailVerificationNotificationController::class, 'store',
])->middleware(['auth', 'throttle:3,1'])->name('verification.send');

Route::get('/confirm-password', [
    ConfirmablePasswordController::class, 'show',
])->middleware('auth')->name('password.confirm');

// 同样是「验密码」的端点（Breeze 的密码确认），登录态下可无限次提交密码 —— 一并加节流。
Route::post('/confirm-password', [
    ConfirmablePasswordController::class, 'store',
])->middleware(['auth', 'throttle:5,1']);

Route::post('/logout', [
    AuthenticatedSessionController::class, 'destroy',
])->middleware('auth')->name('logout');
