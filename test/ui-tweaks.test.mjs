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
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const dockerfile = fs.readFileSync(path.join(here, '..', 'Dockerfile'), 'utf8');

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
console.log('\n[顶栏] 侧栏开关图案：桌面与竖屏共用一个「左侧栏」图案（2026-10-05 起竖屏也换掉 ☰）');
{
    const toggle = header.slice(header.indexOf('toggleSmart'), header.indexOf('</a>', header.indexOf('toggleSmart')));
    check('竖屏不再用 ☰：fa-bars 已整段移除（含 header 全部）', ! toggle.includes('fa-bars') && ! header.includes('fa-bars'));
    check('共用一个图案：矩形 + 靠左的栏分隔线，且不再按断点隐藏（旧的 hidden sm:block 分叉已去掉）',
        toggle.includes('<svg class="w-5 h-5"') && toggle.includes('<rect x="2.5" y="3.5" width="15" height="13" rx="2.6"/>')
        && toggle.includes('M9.2 3.5v13'));
    check('旧的 chevron 图标已完全移除', ! header.includes('fa-chevron-left') && ! header.includes('fa-chevron-right'));
    const toggleNoComment = toggle.replace(/\{\{--[\s\S]*?--\}\}/g, ''); // 注释里也会提到 x-show/x-cloak，别误判
    check('方向提示改由 CSS 切：两条箭头带类名，不再用 Alpine 的 x-show/x-cloak（JS 没起来也正确）',
        toggle.includes('class="ls-sidebar-arrow-left"') && toggle.includes('class="ls-sidebar-arrow-right"')
        && ! /\sx-show=/.test(toggleNoComment) && ! /\sx-cloak/.test(toggleNoComment));
    check('图标尺寸用已编译过的 w-5 h-5（不是任意值类）', /<svg class="w-5 h-5"/.test(toggle));
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
        && commonLess.includes('max-width: calc(100% - 14rem)'));
    check('编译后的 common.css 里这三条都在（LESS 真的编出来了；lessc 是未压缩输出，空白要放宽）',
        /\.ls-app-header\s*#strategy-selected/.test(compiledCommon)
        && /\.ls-app-header\s*\.ls-user-name/.test(compiledCommon)
        && /max-width:\s*calc\(100% - 14rem\)/.test(compiledCommon));
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

// ---------------------------------------------------------------- 第八批（2026-10-05）
console.log('\n[后台文案] 「填 0 表示…」提示 16 处（系统设置 1 / 编辑角色组 7 / 新建角色组 7 / 编辑用户 1）');
{
    const count = (src) => (src.match(/text-ink-3">填 0/g) || []).length;
    const ids = [
        ['admin/setting/index.blade.php', 'user_initial_capacity'], ['admin/user/edit.blade.php', 'capacity'],
    ];
    check('系统设置：用户初始容量下 1 行「填 0 表示不可上传」',
        count(setting) === 1 && setting.includes('填 0 表示不可上传')
        && /user_initial_capacity[\s\S]{0,220}?text-ink-3">填 0 表示不可上传/.test(setting));
    check('编辑用户：总容量下 1 行「填 0 表示不可上传」',
        count(userEdit) === 1 && userEdit.includes('填 0 表示不可上传')
        && /id="capacity"[\s\S]{0,220}?text-ink-3">填 0 表示不可上传/.test(userEdit));

    const want = [
        ['configs[maximum_file_size]', '填 0 表示不可上传'],
        ['configs[concurrent_upload_num]', '填 0 表示不限制并发数（不推荐）'],
        ['configs[limit_per_minute]', '填 0 表示无限制'],
        ['configs[limit_per_hour]', '填 0 表示无限制'],
        ['configs[limit_per_day]', '填 0 表示无限制'],
        ['configs[limit_per_week]', '填 0 表示无限制'],
        ['configs[limit_per_month]', '填 0 表示无限制'],
    ];
    for (const [file, src] of [['编辑角色组', groupEdit], ['新建角色组', groupAdd]]) {
        check(`${file}：7 处提示、每处紧跟对应字段且文案逐字正确`,
            count(src) === 7 && want.every(([name, text]) =>
                new RegExp(name.replace(/[[\]]/g, '\\$&') + '[\\s\\S]{0,240}?text-ink-3">' + text).test(src)));
    }
    check('没有把「最大文件大小」写成无限制（0 的语义是「不可上传」）',
        ! /maximum_file_size[\s\S]{0,240}?填 0 表示无限制/.test(groupEdit));
}

console.log('\n[仪表盘] 0 → 灰色「无限制」（含并发）+ 策略列表按右侧卡片限高');
{
    const dash = read('resources', 'views', 'user', 'dashboard.blade.php');
    check('限额格子：六个键统一用 (int) 取值判 0，0 → 灰字「无限制」且不带单位',
        dash.includes('@php $limitValue = (int) $configs->get($key); @endphp')
        && dash.includes("@if($limitValue === 0)")
        && dash.includes('无限制')
        && dash.includes("{{ $limitValue === 0 ? 'text-ink-3' : 'text-ink' }}"));
    check('并发也在同一循环里（不再特判排除）', dash.includes('GroupConfigKey::ConcurrentUploadNum'));
    check('策略列表/我的信息两个锚点类都在',
        dash.includes('ls-strategy-list') && dash.includes('ls-info-card'));
    check('限高脚本：只在 ≥844.8px 生效（<844.8 清空 → 竖屏全展开）',
        dash.includes("window.matchMedia('(min-width: 844.8px)')") && dash.includes("list.style.maxHeight = ''"));
    check('限高脚本：处理了 zoom（视觉 px / 布局 px 换算）',
        dash.includes('getBoundingClientRect().width / el.offsetWidth') && dash.includes('z > 1.0001'));
    check('限高脚本：挂了 resize 与侧栏折叠事件（后者延迟 320ms）',
        dash.includes("window.addEventListener('resize', sync)") && dash.includes('lsky:sidebar-toggled') && dash.includes('setTimeout(sync, 320)'));
    check('限高脚本：chrome 只算「列表上方 + 卡片底部内边距」，不含会被 grid 拉伸污染的「卡片底边−列表底边」',
        dash.includes('getComputedStyle(list.parentElement).paddingBottom') && ! dash.includes('(sRect.bottom - lRect.bottom)'));
    check('限高脚本：量不到布局（x-cloak 罩着 / 所有 rect 为 0）时直接放弃，绝不把列表压成 0px',
        dash.includes('if (! (infoH > 0) || ! (lRect.top > 0) || ! (sRect.top > 0)) { return; }')
        && dash.includes("if (document.readyState === 'complete') { sync(); } else { window.addEventListener('load', sync); }"));
}

console.log('\n[顶栏/登录页] 两个胶囊居中 + 所有宽度竖向居中');
{
    check('存储策略胶囊：去掉多余的 px-2（两侧都剩按钮自己的 12px）',
        /<span class="sm:block hidden" id="strategy-selected"/.test(read('resources', 'views', 'layouts', 'strategies.blade.php'))
        && ! /<span class="px-2 sm:block hidden" id="strategy-selected"/.test(read('resources', 'views', 'layouts', 'strategies.blade.php')));
    check('用户胶囊：用 左8/右12 补偿头像图自带的 ~5.8px 透明留白（可见左缘 ≈13.3 ≈ 策略胶囊 12.9）',
        userNav.includes('sm:pl-1.5 sm:pr-3') && ! userNav.includes('sm:pl-3 sm:pr-3')
        && userNav.includes('class="ls-user-name sm:block hidden text-ink-2"'));
    const authCard = read('resources', 'views', 'components', 'auth-card.blade.php');
    check('登录页卡片：所有宽度都竖向居中（去掉 sm: 限制）+ 上下留白 py-6',
        authCard.includes('flex flex-col justify-center items-center py-6')
        && ! authCard.includes('sm:justify-center') && ! authCard.includes('pt-6 sm:pt-0'));
}

console.log('\n[工具栏] 断点 lg→xl + 永不折行');
{
    const imgs = read('resources', 'views', 'user', 'images.blade.php');
    check('桌面那排开关断点抬到 xl（<1408 走「⋯」菜单，正是老师要的语义）',
        imgs.includes('flex-row hidden xl:flex') && imgs.includes('block xl:hidden')
        && ! imgs.includes('flex-row hidden lg:flex') && ! imgs.includes('block lg:hidden'));
    const nowrap = (imgs.match(/class="whitespace-nowrap[^"]*"[^>]*>(?:移动到相册|移出当前相册|标签管理|详细信息|重命名|删除|取消选择)</g) || []).length;
    check('7 个操作项都带 whitespace-nowrap；「相册」也一样（共 8 处）',
        nowrap === 7 && /class="whitespace-nowrap text-sm[^"]*"[^>]*>[\s\S]{0,60}?相册</.test(imgs));
}

console.log('\n[镜像上限] post_max_size 512M（upload_max_filesize 与 max_execution_time 都不动）');
{
    check('Dockerfile：post_max_size 与 upload_max_filesize 都是 512M（都抬到 512M；前者是请求体、后者是单文件）',
        dockerfile.includes("echo 'post_max_size = 512M;'") && dockerfile.includes("echo 'upload_max_filesize = 512M;'"));
    check('Dockerfile：max_execution_time 维持 600S（老师 2026-10-05 拍板不动，别写成 300）',
        dockerfile.includes("echo 'max_execution_time = 600S;'") && ! dockerfile.includes("echo 'max_execution_time = 300"));
    check('构建期自证：真读回 post_max_size（不是只 grep 文件）',
        dockerfile.includes('post_max_size 自证失败') && dockerfile.includes('ini_get("post_max_size")'));
    // 「事实的副本」守卫：Dockerfile 里钉的 images.blade.php md5 必须等于当前文件实算值
    // （两处：自证段的 '<md5>  ./resources/views/…' 行 + .code-revision 生成段的 images_blade_md5=）
    const pinnedImgs = (dockerfile.match(/([0-9a-f]{32})\s+\.\/resources\/views\/user\/images\.blade\.php/g) || []).map((l) => l.slice(0, 32));
    const realImgs = crypto.createHash('md5').update(read('resources', 'views', 'user', 'images.blade.php')).digest('hex');
    const revisionPin = (dockerfile.match(/images_blade_md5=([0-9a-f]{32})/) || [])[1];
    check('Dockerfile 钉的 images.blade.php md5 == 文件实算值（自证段 + .code-revision 两处都要）',
        pinnedImgs.includes(realImgs) && revisionPin === realImgs,
        `自证段=${pinnedImgs.join('/')} code-revision=${revisionPin} 实算=${realImgs}`);
}

console.log('\n[第九批] 默认保存质量 100 / 侧栏图标桌面竖屏统一 / 用户胶囊可见间距对称');
{
    const conv = read('config', 'convention.php');
    check('convention.php：默认保存质量 75 → 100（新建角色组 + 全新安装都取这里；存量组取库里存的值，不受影响）',
        /GroupConfigKey::ImageSaveQuality => 100,/.test(conv) && ! /ImageSaveQuality => 75/.test(conv));

    const less = read('resources', 'css', 'common.less');
    check('common.less：折叠态按 html.sidebar-collapsed 切箭头 + 竖屏 <640 固定「朝右」箭头（!important 压过桌面态）',
        less.includes('html .ls-sidebar-arrow-right {') && less.includes('html.sidebar-collapsed .ls-sidebar-arrow-left {')
        && less.includes('html.sidebar-collapsed .ls-sidebar-arrow-right {')
        && /@media \(max-width: 639\.98px\) \{[\s\S]{0,200}?ls-sidebar-arrow-left \{\s*display: none !important/.test(less)
        && /ls-sidebar-arrow-right \{\s*display: inline !important/.test(less));
    // 产物里必须有这三段（LESS 写了但没重建 = 等于没写，第 67 条）
    const commonCss = fs.readFileSync(path.join(SRC, 'public', 'css', 'common.css'), 'utf8');
    check('重建后的 common.css 真含这三段（选择器合并允许：折叠两条会并成一条 display:none）',
        commonCss.includes('.ls-sidebar-arrow-left') && commonCss.includes('.sidebar-collapsed .ls-sidebar-arrow-right')
        && commonCss.includes('max-width:639.98px'));
}

console.log('\n[第十批] 两个胶囊同一节奏 / 用户名收起时按钮保持正圆 / 竖屏箭头朝右 / 后台搜索框留白');
{
    const nav = read('resources', 'views', 'layouts', 'user-nav.blade.php');
    const strat = read('resources', 'views', 'layouts', 'strategies.blade.php');
    check('用户胶囊：左 6 / 右 12 补偿头像图自带的 ~5.8px 留白；两个按钮图文间距都是 gap-2 = 8px',
        nav.includes('sm:pl-1.5 sm:pr-3') && nav.includes('gap-2') && strat.includes('gap-2'));
    check('两个按钮都靠 justify-center 让内容居中（不是靠左右 padding 凑）',
        nav.includes('justify-center') && strat.includes('justify-center'));

    const less = read('resources', 'css', 'common.less');
    check('640~1080px：两个胶囊的文字收起后强制 40×40 + 无内边距（都保持正圆，不再被撑成椭圆）',
        /html \.ls-app-header #user-menu-button,\s*\n\s*html \.ls-app-header #strategy-menu-button \{\s*width: 2\.5rem;\s*padding: 0;/.test(less)
        && read('resources', 'views', 'layouts', 'strategies.blade.php').includes('id="strategy-menu-button"'));
    check('竖屏箭头固定「朝右」（ls-sidebar-arrow-right），桌面展开态仍是「朝左」',
        less.includes('html .ls-sidebar-arrow-right {') && less.includes('html.sidebar-collapsed .ls-sidebar-arrow-left {'));
    const commonCss = fs.readFileSync(path.join(SRC, 'public', 'css', 'common.css'), 'utf8');
    check('重建后的 common.css 含正圆规则 + 两个方向的箭头类',
        commonCss.includes('#user-menu-button') && commonCss.includes('.ls-sidebar-arrow-left') && commonCss.includes('.ls-sidebar-arrow-right'));

    for (const [f, label] of [['group', '角色组'], ['user', '用户管理'], ['strategy', '存储策略']]) {
        check(`后台「${label}」页：搜索框那一行加了 gap-4（与左侧元素留出 16px，不再紧贴）`,
            /class="mb-3 flex justify-between[^"]*gap-4"/.test(read('resources', 'views', 'admin', f, 'index.blade.php')));
    }

    // 默认头像：造型保持原样（同一个头 + 同一个身体圆），只整体等比放大 —— 老师说「格式可以了、但头像样式变了」
    const svg = fs.readFileSync(path.join(SRC, 'public', 'static', 'default-avatar.svg'), 'utf8');
    check('default-avatar.svg：保持老师要的那一版原样（头 cy34 r16 + 身体 cy84 r28、无 transform、无椭圆、不缩放）',
        svg.includes('<circle cx="48" cy="34" r="16"') && svg.includes('<circle cx="48" cy="84" r="28"')
        && svg.includes('clip-path="url(#avatar-clip)"')
        && ! svg.includes('transform=') && ! svg.includes('<ellipse'));
    check('头像 img 单独抬 2px（-top-0.5）做视觉居中：人形居中、方框/圆圈仍几何居中（不许改 SVG）',
        nav.includes('absolute inset-0 -top-0.5 h-7 w-7') && nav.includes('relative flex h-7 w-7 shrink-0')
        && ! nav.includes('relative -top-0.5 flex h-7 w-7'));
    check('头像 img 仍是 28×28 铺满（只做 -top-0.5 的垂直视觉补偿，不靠 transform / 负偏移放大尺寸）',
        nav.includes('absolute inset-0 -top-0.5 h-7 w-7 rounded-full object-cover')
        && ! nav.includes('scale-150') && ! nav.includes('-top-2 -left-2'));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
