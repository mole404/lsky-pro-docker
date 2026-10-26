/*
 * 会话与邮箱验证的静态契约测试。
 *
 * 只读源码做断言（不跑 jsdom / 不起 PHP）：
 *   A. 邮箱验证门禁 —— 中间件按「后台开关 + 管理员豁免 + 已验证」放行，登录后的站内路由挂上它，
 *      验证页自身不挂（否则自己把自己锁死），注册流程在开关打开时确实发了验证邮件；
 *   B. 退出登录 —— 默认只注销当前设备；设置页有独立的「退出所有登录会话」模块，
 *      后端轮换 remember token 并按 session 驱动清会话；
 *   C. 文案 —— 注销统一叫「退出登录」；验证页说明是新文案且不再有重复的「在开始之前」；
 *   D. 样式 —— .ls-btn-danger 在源码与构建产物里都在（构建期不跑 npm，产物必须手改）。
 *
 * 运行：node session-verification.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(SRC, ...p));

const routes = read('routes', 'web.php');
const apiRoutes = read('routes', 'api.php');
const apiTokenController = read('app', 'Http', 'Controllers', 'Api', 'V1', 'TokenController.php');
const apiImageController = read('app', 'Http', 'Controllers', 'Api', 'V1', 'ImageController.php');
const authRoutes = read('routes', 'auth.php');
const kernel = read('app', 'Http', 'Kernel.php');
const middleware = read('app', 'Http', 'Middleware', 'EnsureEmailIsVerifiedIfRequired.php');
const userController = read('app', 'Http', 'Controllers', 'User', 'UserController.php');
const sessionController = read('app', 'Http', 'Controllers', 'Auth', 'AuthenticatedSessionController.php');
const registerController = read('app', 'Http', 'Controllers', 'Auth', 'RegisteredUserController.php');
const settingsBlade = read('resources', 'views', 'user', 'settings.blade.php');
const verifyBlade = read('resources', 'views', 'auth', 'verify-email.blade.php');
const navBlade = read('resources', 'views', 'layouts', 'user-nav.blade.php');
// 注意：Laravel 的 JSON 翻译读的是 lang/<locale>.json（= lang/zh_CN.json）。
// lang/zh_CN/zh_CN.json 是随包进来的死副本，改它线上没有任何变化 —— 两个都要断言，别再改错。
const zh = JSON.parse(read('lang', 'zh_CN', 'zh_CN.json'));
const zhLive = JSON.parse(read('lang', 'zh_CN.json'));
const settingBlade = read('resources', 'views', 'admin', 'setting', 'index.blade.php');
const appCss = read('resources', 'css', 'app.css');
const builtCss = read('public', 'css', 'app.css');

let passed = 0;
let failed = 0;
const test = (name, fn) => {
    try {
        fn();
        passed++;
        console.log('  ✓ ' + name);
    } catch (e) {
        failed++;
        console.log('  ✗ ' + name);
        console.log('    ' + e.message.split('\n').join('\n    '));
    }
};
const section = (title) => console.log('\n' + title);

/* ---------------------------------------------------------------- A 门禁 */

section('A. 邮箱验证门禁');

test('中间件文件存在', () => {
    assert.ok(exists('app', 'Http', 'Middleware', 'EnsureEmailIsVerifiedIfRequired.php'));
});

test('中间件只在后台开着「需要验证邮箱」时拦人', () => {
    assert.match(middleware, /Utils::config\(ConfigKey::IsUserNeedVerify\)/);
});

test('中间件放行管理员（避免把自己锁在门外）', () => {
    assert.match(middleware, /\$user->is_adminer/);
});

test('中间件放行已验证账号', () => {
    assert.match(middleware, /\$user->hasVerifiedEmail\(\)/);
});

test('拦下来时普通请求跳验证页、AJAX 回 403 JSON', () => {
    assert.match(middleware, /\$request->expectsJson\(\)/);
    assert.match(middleware, /response\(\)->json\(\[[^\]]*'status' => false/);
    assert.match(middleware, /redirect\(\)->guest\(route\('verification\.notice'\)\)/);
});

test('Kernel 里注册了 verified.if-required 别名', () => {
    assert.match(kernel, /'verified\.if-required' => \\App\\Http\\Middleware\\EnsureEmailIsVerifiedIfRequired::class/);
});

test('登录后的站内路由组挂上了门禁', () => {
    assert.match(routes, /Route::group\(\['middleware' => \['auth', 'verified\.if-required'\]\]/);
    // 组内确实是要保护的功能页，而不是空组
    const gated = routes.split("['auth', 'verified.if-required']")[1] || '';
    assert.match(gated, /Route::get\('dashboard'/);
    assert.match(gated, /'settings'/);
});

test('验证页自身不挂门禁（否则自己把自己锁死）', () => {
    const at = authRoutes.indexOf("'/verify-email', [");
    assert.ok(at > -1, '找不到 verify-email 路由');
    const block = authRoutes.slice(at, authRoutes.indexOf(';', at));
    assert.match(block, /middleware\('auth'\)/);
    assert.doesNotMatch(block, /verified/);
    assert.match(block, /name\('verification\.notice'\)/);
});

test('注册时开关打开才发验证邮件（沿用上游行为）', () => {
    assert.match(registerController, /IsUserNeedVerify/);
    assert.match(registerController, /event\(new Registered\(\$user\)\)/);
});

/* ------------------------------------------------------- B 退出登录 */

section('B. 退出登录 / 退出所有登录会话');

test('默认注销只踢当前设备', () => {
    assert.match(sessionController, /logoutCurrentDevice\(\)/);
    assert.doesNotMatch(sessionController, /Auth::guard\('web'\)->logout\(\);/);
});

test('设置页有 logout-all-sessions 路由', () => {
    assert.match(routes, /Route::post\('logout-all-sessions', \[UserController::class, 'logoutAllSessions'\]\)->name\('user\.logout-all'\)/);
    const gatedIndex = routes.indexOf("['auth', 'verified.if-required']");
    assert.ok(routes.indexOf("logout-all-sessions") > gatedIndex, '路由必须在登录组内');
});

test('后端先轮换 remember token 再清会话', () => {
    assert.match(userController, /function logoutAllSessions/);
    assert.match(userController, /'remember_token' => Str::random\(60\)/);
    const fn = userController.slice(userController.indexOf('function logoutAllSessions'));
    assert.ok(
        fn.indexOf("'remember_token'") < fn.indexOf('purgeUserSessions'),
        'remember token 必须先轮换，否则「记住我」cookie 会把人自动登回来'
    );
});

test('会话清理覆盖 database 与 file 两种驱动，其余记日志', () => {
    assert.match(userController, /\$driver === 'database'/);
    assert.match(userController, /->where\('user_id', \$userId\)/);
    assert.match(userController, /\$driver === 'file'/);
    assert.match(userController, /allowed_classes' => false/);
    assert.match(userController, /Log::warning\('logout-all/);
});

test('设置页模块：说明 + 按钮 + 二次确认 + 成功后回登录页', () => {
    const text = '立即使您的账号在所有设备上退出登录，需要重新输入密码登录账号。';
    // 页面上和弹窗里都要有这句（老师明确要求两处都改）
    assert.equal(settingsBlade.split(text).length - 1, 2, '页面说明与弹窗文案各要出现一次');
    assert.match(settingsBlade, /id="logout-all-sessions"/);
    assert.match(settingsBlade, /<button type="button" id="logout-all-sessions"/);
    assert.match(settingsBlade, /Swal\.fire\(\{/);
    assert.match(settingsBlade, /focusCancel: true/);
    assert.match(settingsBlade, /axios\.post\('\{\{ route\('user\.logout-all'\) \}\}'\)/);
    assert.match(settingsBlade, /window\.location\.href = '\{\{ route\('login'\) \}\}'/);
});

test('退出按钮不在 settings 表单里（页面用 $(\'form\').submit 接管保存）', () => {
    const formStart = settingsBlade.indexOf('<form');
    const formEnd = settingsBlade.indexOf('</form>');
    const btn = settingsBlade.indexOf('id="logout-all-sessions" class="ls-btn ls-btn-danger"');
    assert.ok(btn > formEnd && btn > formStart, '按钮必须落在 settings 表单结束之后');
});

/* ---------------------------------------------------------- C 文案 */

section('C. 文案');

test('「Log Out」中文是「退出登录」（线上生效的那份）', () => {
    assert.equal(zhLive['Log Out'], '退出登录');
    assert.equal(zhLive['Logout'], '退出登录');
});

test('死副本与线上那份在这些 key 上保持一致', () => {
    for (const k of ['Log Out', 'Logout', 'Log Out Other Browser Sessions']) {
        assert.equal(zh[k], zhLive[k], 'key 不一致：' + k);
    }
});

test('线上语言包里不再出现「注销」', () => {
    for (const [k, v] of Object.entries(zhLive)) {
        if (typeof v === 'string') assert.ok(!v.includes('注销'), '还有注销：' + k);
    }
});

test('导航与验证页的退出链接都走这个 key', () => {
    assert.match(navBlade, /__\('Log Out'\)/);
    assert.match(verifyBlade, /__\('Log Out'\)/);
});

test('验证页说明是新文案', () => {
    const key = "Thanks for signing up! Before getting started, could you verify your email address by clicking on the link we just emailed to you? If you didn't receive the email, we will gladly send you another.";
    assert.equal(
        zhLive[key],
        '感谢您的注册！我们刚刚向您的邮箱内发送了一封验证邮件，请查看您的收件箱，完成验证后即可开始使用。如果收件箱内未收到验证邮件，请检查垃圾邮件，或重新发送验证邮件。'
    );
});

test('不再有重复的「在开始之前，在开始之前」', () => {
    for (const [k, v] of Object.entries(zh)) {
        if (typeof v !== 'string') continue;
        assert.ok(!/在开始之前，在开始之前/.test(v), '重复文案：' + k);
    }
});

/* ---------------------------------------------------------- D 样式 */

section('D. 样式');

test('.ls-btn-danger 在源码里', () => {
    assert.match(appCss, /\.ls-btn-danger \{/);
});

test('.ls-btn-danger 在构建产物里（构建期不跑 npm）', () => {
    assert.match(builtCss, /\.ls-btn-danger/);
});

/* --------------------------------------------------- E 后台邮件设置 */

section('E. 后台邮件设置');

test('发件人地址下方有示例注释', () => {
    const at = settingBlade.indexOf('id="mail[from][address]"');
    assert.ok(at > -1, '找不到发件人地址输入框');
    const chunk = settingBlade.slice(at, at + 400);
    assert.match(chunk, /例如：noreply@your\.lsky-domain\.com/);
});

test('注释就在输入框和「发件人名称」之间', () => {
    const addr = settingBlade.indexOf('id="mail[from][address]"');
    const name = settingBlade.indexOf('id="mail[from][name]"');
    const tip = settingBlade.indexOf('例如：noreply@your.lsky-domain.com');
    assert.ok(addr < tip && tip < name, '注释位置不对');
});

/* ------------------------------------------------------- F API 侧门禁 */

section('F. API 侧门禁');

test('token 组挂了 verified.if-required', () => {
    assert.match(apiRoutes, /'middleware' => \['auth:sanctum', 'verified\.if-required'\]/);
});

test('换 token 的公开路由在控制器里单独卡（中间件挂不上它）', () => {
    const at = apiTokenController.indexOf('function store');
    assert.ok(at > -1);
    const body = apiTokenController.slice(at, at + 1200);
    assert.match(body, /EnsureEmailIsVerifiedIfRequired::blocks\(\$user\)/);
    assert.match(body, /请先验证您的邮箱/);
    // 必须在发 token 之前
    assert.ok(body.indexOf('blocks(') < body.indexOf('createToken('), '判断要早于签发 token');
});

test('带头部的 API 上传也卡住了', () => {
    const at = apiImageController.indexOf('function upload');
    const body = apiImageController.slice(at, at + 1600);
    assert.match(body, /EnsureEmailIsVerifiedIfRequired::blocks\(Auth::user\(\)\)/);
    assert.match(body, /请先验证您的邮箱/);
});

test('两处都用同一个判断，没有各写一份条件', () => {
    assert.match(middleware, /public static function blocks\(\?User \$user\): bool/);
});

test('/api/* 回 200 + status:false，不 redirect、不回 401/403', () => {
    assert.match(middleware, /\$request->is\('api\/\*'\)/);
    const at = middleware.indexOf("$request->is('api/*')");
    const end = middleware.indexOf('expectsJson', at);
    const body = middleware.slice(at, end > at ? end : at + 220);
    assert.match(body, /\$this->fail\('请先验证您的邮箱'\)/);
    assert.ok(!/redirect|403/.test(body), 'api 分支不该 redirect 或带 403');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
