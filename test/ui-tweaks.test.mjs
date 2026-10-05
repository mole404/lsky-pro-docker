/**
 * 2026-10-05 那批 UI / 文案修正的结构回归网（老师报的 8 件事）。
 *
 * 覆盖：
 *   1~3  单位大小写（用户初始容量 / 总容量 / 最大文件大小）
 *   4    顶栏「开关侧栏」按钮换成侧栏图案
 *   5    相册行 overflow-hidden + 弹窗副标题 → 在 images-modal.test.mjs 里断言
 *   6    顶栏在 640~1080px 的收拢（策略名/用户名收起 + 标题宽度上限）
 *   7    游客首页：外观切换排进顶栏、站名不再白字白底、登录按钮整块强调色、窄屏适配
 *   8    登录/注册等页：品牌区 = LOGO 图案 + 站名，整体居中
 *
 * 这些都是「读文件断言」，不跑浏览器 —— 视觉/几何的最终判据仍以真机截图为准。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const header = read('resources', 'views', 'layouts', 'header.blade.php');
const userNav = read('resources', 'views', 'layouts', 'user-nav.blade.php');
const guest = read('resources', 'views', 'layouts', 'guest.blade.php');
const welcome = read('resources', 'views', 'welcome.blade.php');
const appLogo = read('resources', 'views', 'components', 'application-logo.blade.php');
const commonLess = read('resources', 'css', 'common.less');
const guestLayoutPhp = read('app', 'View', 'Components', 'GuestLayout.php');
const setting = read('resources', 'views', 'admin', 'setting', 'index.blade.php');
const userEdit = read('resources', 'views', 'admin', 'user', 'edit.blade.php');
const groupAdd = read('resources', 'views', 'admin', 'group', 'add.blade.php');
const groupEdit = read('resources', 'views', 'admin', 'group', 'edit.blade.php');
const authNames = ['login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'confirm-password'];
const authPages = authNames.map((n) => [n, read('resources', 'views', 'auth', `${n}.blade.php`)]);

// 编译 common.less（与 swal-theme.test.mjs 同一套做法）：`~toastr` 是 webpack 的解析写法，
// lessc 不认，换成一行注释（与本次断言无关）。编不过 = 这次改的 LESS 语法有问题，会红。
const compiledCommon = (() => {
    const lessc = path.join(here, 'node_modules', '.bin', 'lessc');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsky-uicheck-'));
    const entry = path.join(tmp, 'common.less');
    fs.writeFileSync(entry, commonLess.replace("@import '~toastr';", '// stub'));
    const out = path.join(tmp, 'common.css');
    execFileSync(lessc, [entry, out]);
    return fs.readFileSync(out, 'utf8');
})();

// ---------------------------------------------------------------- 1~3 单位大小写
console.log('\n[单位] 中文标签/占位符里的 KB 一律大写');
{
    check('系统设置：用户初始容量(KB) 两处（label + placeholder），没有残留 (kb)',
        setting.includes('用户初始容量(KB)') && setting.includes('请输入用户初始容量(KB)') && ! setting.includes('(kb)'));
    check('编辑用户：总容量(KB) 两处（label + placeholder），没有残留 (kb)',
        userEdit.includes('总容量(KB)') && userEdit.includes('请输入总容量(KB)') && ! userEdit.includes('(kb)'));
    check('角色组（新建/编辑）：占位符「单位 KB」与同一字段的 label「最大文件大小(KB)」一致',
        groupAdd.includes('单位 KB') && ! groupAdd.includes('单位kb')
        && groupEdit.includes('单位 KB') && ! groupEdit.includes('单位kb'));

    // 全量扫一遍视图目录：以后新写的页面若又用小写单位，这条会红
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
    });
    const hits = walk(path.join(SRC, 'resources', 'views'))
        .filter((f) => f.endsWith('.blade.php') && /\(kb\)|单位kb/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(SRC, f));
    check('resources/views 下再没有任何 (kb) / 单位kb 写法', hits.length === 0, hits.join(', '));
    check('PHP 注释里的单位也一并规范（迁户口注释不动：迁移不会重跑）',
        ! read('app', 'Enums', 'ConfigKey.php').includes('(kb)')
        && ! read('app', 'Services', 'ImageService.php').includes('5mb'));
}

// ---------------------------------------------------------------- 4 侧栏图案
console.log('\n[顶栏] 桌面换「左侧栏」图案，手机仍是 ☰ 抽屉');
{
    const toggle = header.slice(header.indexOf('toggleSmart'), header.indexOf('</a>', header.indexOf('toggleSmart')));
    check('手机：还是 fa-bars（抽屉语义不变）', toggle.includes('fas fa-bars text-lg sm:hidden'));
    check('桌面：矩形 + 靠左的栏分隔线（不是裸箭头了）',
        toggle.includes('<rect x="2.5" y="3.5" width="15" height="13" rx="2.6"/>') && toggle.includes('M9.2 3.5v13'));
    check('旧的 chevron 图标已完全移除', ! header.includes('fa-chevron-left') && ! header.includes('fa-chevron-right'));
    check('方向提示仍在：两条箭头路径按 $store.sidebar.collapsed 互斥显示（折叠态那条带 x-cloak 防闪）',
        toggle.includes('x-show="! $store.sidebar.collapsed"')
        && toggle.includes('x-cloak x-show="$store.sidebar.collapsed"'));
    check('图标尺寸用已编译过的 w-5 h-5（不是任意值类）', /class="hidden sm:block w-5 h-5"/.test(toggle));
}

// ---------------------------------------------------------------- 6 窄桌面收拢
console.log('\n[顶栏] 640~1080px：右上角那组不再压住折叠按钮与标题');
{
    check('顶栏根元素带 .ls-app-header（CSS 只作用于 app 布局）', /<header class="ls-app-header/.test(header));
    check('标题容器带 .ls-header-title；用户名带 .ls-user-name', header.includes('ls-header-title') && userNav.includes('ls-user-name'));
    check('common.less 里有 640~1079.98px 的区间规则（策略名 + 用户名收起、标题宽度上限）',
        /@media \(min-width: 640px\) and \(max-width: 1079\.98px\)/.test(commonLess)
        && commonLess.includes('html .ls-app-header #strategy-selected')
        && commonLess.includes('html .ls-app-header .ls-user-name')
        && commonLess.includes('max-width: calc(100% - 18rem)'));
    check('编译后的 common.css 里这三条都在（LESS 真的编出来了；lessc 是未压缩输出，空白要放宽）',
        /\.ls-app-header\s*#strategy-selected/.test(compiledCommon)
        && /\.ls-app-header\s*\.ls-user-name/.test(compiledCommon)
        && /max-width:\s*calc\(100% - 18rem\)/.test(compiledCommon));
    // 手机端零变化：区间从 640 起，<640 的策略名/用户名本来就由 sm:block hidden 管着
    check('区间下界是 640（手机端 <640 不受影响）',
        /@media \(min-width: 640px\) and \(max-width: 1079\.98px\)/.test(commonLess));
}

// ---------------------------------------------------------------- 7 游客首页
console.log('\n[游客首页] 外观切换归位 / 站名可见 / 登录整块强调色 / 窄屏适配');
{
    check('guest 布局：浮动版外观切换改成受 $floatingThemeSwitch 控制',
        guest.includes('@if($floatingThemeSwitch)') && guest.includes('<x-theme-switch />'));
    check('GuestLayout 组件新增 $floatingThemeSwitch（**构造器参数**，默认 true；只写 public 属性不生效）',
        guestLayoutPhp.includes('public function __construct(public bool $floatingThemeSwitch = true)')
        && welcome.includes(':floating-theme-switch="false"'));
    check('游客首页把浮动版关掉、把按钮排进顶栏那一行',
        welcome.includes(':floating-theme-switch="false"') && welcome.includes('<x-theme-switch />'));
    check('顶栏那行仍在「公告 / 策略 / 登录注册」之前渲染外观切换（顺序：主题 → 公告 → 策略 → 账号）',
        welcome.indexOf('<x-theme-switch />') < welcome.indexOf("@includeWhen($_is_notice"));
    check('站名不再白字白底（text-white 已去掉）', ! welcome.includes('text-white') && welcome.includes('text-ink text-xl truncate'));
    check('登录 = 强调色实心整块按钮（ls-btn-primary + h-10），不是只染文字',
        /class="ls-btn ls-btn-primary h-10 px-4">登录<\/a>/.test(welcome));
    check('窄屏适配：标题 min-w-0 flex-1 + 右侧 shrink-0，间距手机 2 / 桌面 4',
        welcome.includes('min-w-0 flex-1 justify-start items-center')
        && welcome.includes('flex shrink-0 justify-end items-center space-x-2 sm:space-x-4'));
    check('登录/注册等 6 个 auth 页没有关掉浮动版（它们没有自己的顶栏）',
        authPages.every(([, src]) => ! src.includes('floating-theme-switch')));
}

// ---------------------------------------------------------------- 8 登录页 LOGO
console.log('\n[登录页] 品牌区 = LOGO 图案（透明底）+ 站名，整体居中');
{
    check('application-logo 组件带 LOGO 图案（static/lsky-logo.png，与侧栏同一个文件 + assetVersion 版本串）',
        appLogo.includes("asset('static/lsky-logo.png')") && appLogo.includes("assetVersion('static/lsky-logo.png')"));
    check('图案与文字用一个 inline-flex + items-center + justify-center 的容器居中（gap 3）',
        appLogo.includes('inline-flex items-center justify-center gap-3'));
    check('站名仍在组件里（读取 AppName 配置）', appLogo.includes('ConfigKey::AppName'));
    check('6 个 auth 页统一传「只给文字用的类」，不再塞固定宽高（w-20 h-20 会把整块撑歪）',
        authPages.every(([, src]) => src.includes('<x-application-logo class="text-ink-2 text-4xl" />'))
        && authPages.every(([, src]) => ! src.includes('w-20 h-20')));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
