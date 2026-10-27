/*
 * 后台分页可见性 + 「清空存储策略图片」的契约测试。
 *
 * A. 分页：四个后台列表页必须用自写的 <x-pagination>，且组件里用到的每一个工具类
 *    都要在提交进仓库的 public/css/app.css 里真实存在；无障碍属性、44px 命中区、
 *    页码越界兜底也在这里钉住。
 *    —— 「类名必须存在」是本轮的根因守卫：Laravel 自带分页模板靠 `sm:flex` / `sm:flex-1`
 *    这类只出现在 vendor 视图里的类，Tailwind 扫不到、产物里没有 ⇒ 桌面端整块 display:none。
 *
 * B. 清空策略后端：两阶段删除（事务里只删数据库、提交后才删物理文件）、
 *    delete_files 取自请求、同策略互斥锁、游标参数校验、文件删除成功/失败都计数。
 *
 * C. 图片页筛选面板：切换「清除筛选」后要重算面板高度。
 *
 * D. 危险确认键：源码里每一个「确认删除 / 开始清空」的弹窗都必须挂 ls-swal-danger，
 *    且源 less 与提交进仓库的产物 CSS 逐条一致、白字对比度达标。
 *
 * E. 图片管理页每页 36 张 + 网格恒为 6 列（36 = 6×6）。
 *
 * F. 清空弹窗的「?」说明按钮（交互行为在 purge-dialog-behavior.test.mjs 里真跑）。
 *
 * 运行：node admin-pagination-and-purge.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (ok) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const blades = {
    'admin/image/index.blade.php': read('resources', 'views', 'admin', 'image', 'index.blade.php'),
    'admin/user/index.blade.php': read('resources', 'views', 'admin', 'user', 'index.blade.php'),
    'admin/strategy/index.blade.php': read('resources', 'views', 'admin', 'strategy', 'index.blade.php'),
    'admin/group/index.blade.php': read('resources', 'views', 'admin', 'group', 'index.blade.php'),
};

const component = read('resources', 'views', 'components', 'pagination.blade.php');
const css = read('public', 'css', 'app.css');

/* ---------------- A. 分页组件 ---------------- */

console.log('A. 后台分页');

for (const [name, text] of Object.entries(blades)) {
    check(`${name} 使用 <x-pagination>`, /<x-pagination\s+:paginator="\$\w+"\s*\/>/.test(text));
    check(`${name} 不再调用 links()`, !/->links\(\)/.test(text));
}

check('组件不接受分页器以外的入参（避免又走回默认模板）', /@props\(\['paginator'\]\)/.test(component));
check('组件保留查询串（翻页不丢筛选/关键字）', /withQueryString\(\)/.test(component));

// 类名扫描：单双引号都收。只认双引号的话，把 class 改成单引号就能让整组断言「安静通过」
// （扫到的类变少，但每条都「存在」），原始 bug 就能原样回来。
const classes = new Set();
const addClasses = (chunk) => {
    for (const cls of chunk.split(/\s+/)) {
        if (cls && !cls.includes('{{') && !cls.includes('}}')) {
            classes.add(cls);
        }
    }
};
for (const m of component.matchAll(/class=(["'])([\s\S]*?)\1/g)) {
    if (!m[2].includes('{{')) addClasses(m[2]);
}
// 组件把几串类名存在 PHP 变量里复用（$linkClass / $disabledClass …）：
// 这些也必须进扫描集合，否则把类名挪进变量就等于绕过了「类必须在产物里存在」这条守卫。
const classVars = new Set();
for (const m of component.matchAll(/\$(\w+Class)\s*=\s*'([^']*)'/g)) {
    classVars.add(m[1]);
    addClasses(m[2]);
}
check('组件里 class="{{ $xxx }}" 用到的变量都在 @php 里声明过（否则类名扫描会漏）',
    [...component.matchAll(/class="\{\{\s*\$(\w+)\s*\}\}"/g)].every((m) => classVars.has(m[1])),
    [...component.matchAll(/class="\{\{\s*\$(\w+)\s*\}\}"/g)].map((m) => m[1]).filter((v) => !classVars.has(v)).join(' '));
check('组件没有用 @class([...]) 拼类名（同上）', !/@class\s*\(/.test(component));
check(`组件里扫到足够多的工具类（${classes.size} 个，少于 18 个说明扫描方式被绕过）`, classes.size >= 18);

const missing = [];
for (const cls of classes) {
    const escaped = cls.replace(/:/g, '\\:');
    const re = new RegExp('\\.' + escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    if (!re.test(css)) {
        missing.push(cls);
    }
}
check(`组件用到的 ${classes.size} 个工具类都在 app.css 里`, missing.length === 0, missing.join(' '));

// 真因守卫：断点前缀类（sm:/md:/lg:…）只出现在 Laravel 自带视图里，Tailwind 扫不到，
// 产物里没有它们 ⇒ 依赖它们的布局会整块 display:none。组件刻意一律不用。
const breakpointClasses = [...classes].filter((cls) => /^(sm|md|lg|xl|2xl):/.test(cls));
check('组件不用断点前缀类', breakpointClasses.length === 0, breakpointClasses.join(' '));

check('分页包在 nav 里并带 aria-label（读屏能定位）',
    /<nav[^>]*role="navigation"[^>]*aria-label="[^"]+"/.test(component));
check('当前页有 aria-current="page"', /aria-current="page"/.test(component));
check('禁用的上一页/下一页有 aria-disabled="true"', (component.match(/aria-disabled="true"/g) || []).length === 2);
check('省略号对读屏隐藏', (component.match(/aria-hidden="true"/g) || []).length === 2);
check('上一页/下一页带 rel=prev/next', /rel="prev"/.test(component) && /rel="next"/.test(component));
check('翻页项用 h-11/w-11（44px 命中区，与站内其它交互一致）',
    /h-11/.test(component) && /w-11/.test(component));
check('「共 N 条」在翻页判断之外（只有一页时也显示）', (() => {
    const total = component.indexOf('共 {{ $total }} 条');
    const gate = component.indexOf('@if($last > 1)');
    return total !== -1 && gate !== -1 && total < gate;
})());

/* 页码越界：控制器要把 ?page= 夹回最后一页，否则列表空、分页条也不渲染 */
const baseController = read('app', 'Http', 'Controllers', 'Controller.php');
check('基类提供越界页码的兜底方法', /function redirectOutOfRangePage\(LengthAwarePaginator \$paginator\): \?RedirectResponse/.test(baseController));
for (const name of ['Image', 'User', 'Group', 'Strategy']) {
    const text = read('app', 'Http', 'Controllers', 'Admin', `${name}Controller.php`);
    check(`${name}Controller 页码越界时回最后一页`,
        /redirectOutOfRangePage\(/.test(text) && /public function index\(Request \$request\): View\|RedirectResponse/.test(text));
}

/* ---------------- B. 清空存储策略图片（后端） ---------------- */

console.log('B. 清空存储策略');

const routes = read('routes', 'web.php');
check(
    'POST admin/strategies/{id}/purge-images 路由存在',
    /Route::post\('\{id\}\/purge-images',\s*\[[^\]]*StrategyController::class,\s*'purgeImages'\]/.test(routes)
);

const controller = read('app', 'Http', 'Controllers', 'Admin', 'StrategyController.php');
const purgeService = read('app', 'Services', 'ImagePurgeService.php');

check('控制器要求输入「确认删除」', /\$request->input\('confirm'\)\s*!==\s*'确认删除'/.test(controller));
check('控制器用 id 游标分批', /'cursor'/.test(controller) && /orderBy\('id'\)/.test(controller));
check('控制器第一次请求取 max(id) 做快照', /max\('id'\)/.test(controller) && /'snapshot'/.test(controller));
check('控制器有时间预算并返回下一段游标', /microtime\(true\)/.test(controller) && /'remaining'/.test(controller));
check('控制器只删本策略的图', /where\('strategy_id', \$strategy->id\)/.test(controller));

// 最关键的一条：delete_files 必须来自请求。写死成 true 就等于「勾选框形同虚设、物理文件被无条件删除」。
check('delete_files 取自请求而不是写死',
    /\$deleteFiles = \$request->boolean\('delete_files'\);/.test(controller) && !/\$deleteFiles = true;/.test(controller));
check('控制器把 delete_files 传给删除服务', /->purge\(\$chunk->values\(\), \$deleteFiles\)/.test(controller));
check('同一策略同一时间只允许一路清空（避免双标签页互抢行锁）',
    /Cache::lock\(\$lockKey, 600\)/.test(controller) && /\$lockKey = "purge-strategy:\{\$strategy->id\}"/.test(controller));
// 默认缓存驱动是 file；换成不支持原子锁的驱动（没建 cache_locks 表的 database、array）时
// Cache::lock() 会抛异常。没有这条兜底，整个清空功能在那种部署上直接 500。
check('缓存驱动不支持锁时退化成 Cache::add（否则整个功能 500）',
    /catch \(\\Throwable \$e\) \{\s*\$lock = null;\s*\$acquired = Cache::add\(\$lockKey, 1, 600\);/.test(controller)
    && /\$lock \? \$lock->release\(\) : Cache::forget\(\$lockKey\);/.test(controller));
check('游标/snapshot 有语义校验', /if \(\$snapshot > 0 && \$cursor > \$snapshot\)/.test(controller));
check('响应里分别回报记录数/文件成功数/文件失败数',
    /'files_deleted' => \$filesDeleted/.test(controller) && /'files_failed'\s*=> \$filesFailed/.test(controller));
check('批量查行只取需要的列（不依赖关联，避免 N+1）',
    /->get\(\['id', 'user_id', 'album_id', 'strategy_id', 'md5', 'sha1', 'pathname', 'key'\]\)/.test(controller));

// 两阶段：DB 事务先提交，物理文件在事务之后删。顺序反了就回到「回滚后记录还在、文件没了」。
const txnReturn = purgeService.indexOf('return $deleted;');
const fileStage = purgeService.indexOf('$this->deleteFiles($images)');
check('物理文件删除在数据库事务之后（不是事务内）',
    txnReturn !== -1 && fileStage !== -1 && fileStage > txnReturn,
    `txn=${txnReturn} files=${fileStage}`);
check('批量删除走查询构造器（不触发 deleting 钩子里的文件删除）',
    /Image::query\(\)->whereIn\('id', \$ids\)->delete\(\)/.test(purgeService));
check('只删记录模式下也清图片缓存（否则原图保护 TTL 内还能读到已删图）',
    /if \(! \$deleteFiles\) \{\s*foreach \(\$images as \$image\) \{\s*Cache::forget/.test(purgeService));
check('物理文件删除失败逐张计数并记日志（不静默吞掉）',
    /\$failed\+\+;[\s\S]{0,160}?Log::warning\('清空存储策略：删除物理文件失败'/.test(purgeService));
// 真凶记录：League\Flysystem\Filesystem 并没有实现 Illuminate\Contracts\Filesystem\Filesystem，
// 把 filesystem() 的返回类型声明成后者会在**每次**返回时抛 TypeError，被 catch 吃掉之后
// 表现成「勾了删物理文件，一个都删不掉、日志里全是同一句 TypeError」。
// 这条把它钉住：返回类型必须是 League 的类（或者干脆不写类型）。
check('filesystem() 返回类型是 League\Flysystem\Filesystem（不是 Illuminate 契约，否则必抛 TypeError）',
    /private function filesystem\(int \$strategyId\): Flysystem/.test(purgeService)
    && !/Illuminate\\Contracts\\Filesystem\\Filesystem/.test(purgeService));
check('删文件失败时把首条原因回给前端（否则只知道失败、不知道为什么）',
    /\$firstError \?\?= \$e->getMessage\(\)/.test(purgeService)
    && /'first_error'\s*=> \$firstError/.test(purgeService)
    && /'error'\s*=> \$firstFileError/.test(controller));

check('文件系统客户端按策略记忆化，并把超时收紧到 5 秒',
    /private array \$filesystems/.test(purgeService) && /'connect_timeout' => 5, 'timeout' => 5/.test(purgeService));
check('用户图片计数在行锁内重算（与上传路径的 increment 串行）',
    /lockForUpdate\(\)->first\(\)/.test(purgeService));

const strategyBlade = blades['admin/strategy/index.blade.php'];
check('清空完成的文案不再提「写入日志」和「再执行一次」', (() => {
    const seg = strategyBlade.slice(strategyBlade.indexOf('let summary ='), strategyBlade.indexOf('history.go(0);'));
    return seg.length > 0 && !/已写入日志/.test(seg) && !/重新执行一次清空/.test(seg);
})());
check('策略列表有「清空图片」入口', /data-operate="purge"/.test(strategyBlade));
check('入口只在有图片时出现', /@if\(\$strategy->images_count > 0\)[\s\S]{0,200}data-operate="purge"/.test(strategyBlade));
check('前端提交输入式确认', /confirm: '确认删除'/.test(strategyBlade));
check('前端按游标循环并有防空转保护', /data\.deleted === 0 && cursor === lastCursor/.test(strategyBlade));
check('前端有"只删记录"开关', /purge-delete-files/.test(strategyBlade));
check('「清空图片」排在「删除」之后', (() => {
    const del = strategyBlade.indexOf('data-operate="delete"');
    const purge = strategyBlade.indexOf('data-operate="purge"');
    return del !== -1 && purge !== -1 && del < purge;
})());
check('有图时的删除提示改口径（清空而不是删除）', /请先清空该存储策略内的所有图片/.test(strategyBlade));
check('勾选框默认不勾选（只删记录为默认行为）',
    /id="purge-delete-files"[^-]*?>/s.test(strategyBlade) && !/id="purge-delete-files"\s+checked/.test(strategyBlade));
check('说明文案为「只删图床数据库记录 / 希望保留存储内图片」', /只删图床数据库记录[\s\S]{0,40}希望保留存储内图片/.test(strategyBlade));
check('勾选框去掉蓝色焦点框', /#purge-delete-files\{outline:none!important/.test(strategyBlade));
check('弹窗里提示先取消角色组（避免清空期间继续上传）',
    /把该策略关联的角色组全部取消/.test(strategyBlade));

/* ---------------- C. 图片页筛选面板：清除筛选出现后要重算高度 ---------------- */

console.log('C. 图片页筛选面板');
const userBlade = read('resources', 'views', 'user', 'images.blade.php');
check(
    'updateFilterButton 切换「清除筛选」后重算面板高度',
    /\$\('#tag-filter-clear'\)\.toggleClass\('hidden', ! on\);\s*(?:\/\/[^\n]*\n\s*)*fitFilterPanel\(\);/.test(userBlade)
);

/* ---------------- D. 危险确认键（红底白字） ---------------- */

console.log('D. 危险确认键');

// 括号配对地切出每个 Swal.fire(...)：只数「出现次数」的话，把类从真删除框搬到提示框、
// 或者新增一个删除框忘了加类，计数都不变 —— 那样的断言语义上是空的。
const swalBlocks = (text) => {
    const blocks = [];
    let i = 0;
    while ((i = text.indexOf('Swal.fire(', i)) !== -1) {
        let depth = 0;
        let j = i + 'Swal.fire'.length;
        for (; j < text.length; j++) {
            if (text[j] === '(') depth++;
            else if (text[j] === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        blocks.push(text.slice(i, j + 1));
        i = j + 1;
    }
    return blocks;
};

const dialogSources = {
    'admin/user/index.blade.php': blades['admin/user/index.blade.php'],
    'admin/image/index.blade.php': blades['admin/image/index.blade.php'],
    'admin/strategy/index.blade.php': strategyBlade,
    'admin/group/index.blade.php': blades['admin/group/index.blade.php'],
    'user/images.blade.php': userBlade,
    'user/settings.blade.php': read('resources', 'views', 'user', 'settings.blade.php'),
};

// 判定标准：弹窗里出现「删除/清空/退出/移除」这类字样，并且按钮是行动型
// （确认/开始/全部退出）—— 这样「无法删除存储策略」「正在清空…」这类纯提示框不会被误判，
// 而新增一个删除弹窗却忘了加类，这里会当场红。
let destructive = 0;
const notDanger = [];
const notDeny = [];
let logoutAllDanger = false;
for (const [name, text] of Object.entries(dialogSources)) {
    for (const block of swalBlocks(text)) {
        const confirmText = (block.match(/confirmButtonText:\s*['"]([^'"]*)['"]/) || [])[1] || '';
        const denyText = (block.match(/denyButtonText:\s*['"]([^'"]*)['"]/) || [])[1] || '';
        const actionButton = /^(确认|开始|全部)/.test(confirmText) || denyText.trim() !== '';
        const destructiveWord = /删除|清空|退出|移除/.test(block);
        if (!actionButton || !destructiveWord) {
            continue;
        }
        destructive++;
        const hasDangerConfirm = /customClass:\s*\{[^}]*confirmButton:\s*'ls-swal-danger'/.test(block);
        const hasDangerDeny = /customClass:\s*\{[^}]*denyButton:\s*'ls-swal-danger'/.test(block);
        // 「全部退出」这类动作挂在 deny 键上，只要那颗键是红的就行。
        const denyIsAction = /删除|清空|退出|移除/.test(denyText);
        // 例外：用户设置页「退出所有登录会话」的「全部退出」键保持 Swal 默认色（老师看过实际
        // 效果后定的），这里反过来断言它没被挂类 —— 免得以后又被「顺手补上」。
        if (denyText.trim() === '全部退出') {
            logoutAllDanger = hasDangerDeny;
            continue;
        }
        if (denyIsAction ? !hasDangerDeny : !hasDangerConfirm) {
            notDanger.push(`${name}（${denyIsAction ? denyText : confirmText}）：${block.slice(0, 50)}…`);
        }
        if (denyText.trim() !== '' && denyIsAction && !hasDangerDeny) {
            notDeny.push(`${name}（${denyText}）`);
        }
    }
}
check(`扫到 ${destructive} 个破坏性确认弹窗（预期 ≥ 9，太少说明解析或写法变了）`, destructive >= 9, `实际 ${destructive}`);
check('每一个破坏性确认键都挂了 ls-swal-danger', notDanger.length === 0, notDanger.join(' | '));
check('带 denyButton 的破坏性弹窗也挂了危险样式', notDeny.length === 0, notDeny.join(' '));
check('「退出所有登录会话」的「全部退出」保持 Swal 默认色（不挂 ls-swal-danger）', logoutAllDanger === false,
    '被重新挂上了 ls-swal-danger');

const lessRaw = read('resources', 'css', 'common.less');
const lessCss = lessRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
check('common.less 定义了 .ls-swal-danger 的四态', [':hover', ':focus', ':focus:not(:focus-visible)']
    .every((suffix) => lessCss.includes(`ls-swal-danger${suffix}`)));
check('危险键的红底/白字由令牌驱动', /ls-swal-danger[\s\S]{0,200}?background-color: var\(--lsky-danger-btn\)/.test(lessCss));
check('危险键 hover 只换颜色（不用 filter / opacity）', (() => {
    const m = lessCss.match(/ls-swal-danger:hover[\s\S]{0,200}?\}/);
    return !!m && !/filter|opacity|transform/.test(m[0]);
})());

/* 产物必须和源逐条一致：构建期不跑 npm，public/css/common.css 是提交进仓库的产物。
   只断言「字符串存在」的话，把产物里的颜色改成浅粉底浅红字也照样绿。 */
const DEP_ROOTS = [path.join(here, 'node_modules'), path.join(SRC, 'node_modules')];
const depPath = (rel, label) => {
    for (const root of DEP_ROOTS) {
        const p = path.join(root, rel);
        if (fs.existsSync(p)) return p;
    }
    throw new Error(`找不到 ${label}（${rel}）：在 test/ 里 npm ci`);
};
const compiled = (() => {
    const lessc = depPath(path.join('.bin', 'lessc'), 'lessc');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsky-purge-'));
    const entry = path.join(tmp, 'common.less');
    fs.writeFileSync(entry, lessRaw.replace("@import '~toastr';", '// stub'));
    const out = path.join(tmp, 'common.css');
    execFileSync(lessc, [entry, out]);
    return fs.readFileSync(out, 'utf8');
})();
const artifact = read('public', 'css', 'common.css');

// 取某条规则（按选择器 + 状态后缀）的声明集合，压缩空白后比较。
const declarations = (text, suffix) => {
    const out = new Set();
    let matchedRules = 0;
    for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selectors = m[1].split(',').map((sel) => sel.trim().replace(/\s+/g, ''));
        if (!selectors.some((sel) => sel.endsWith(`.ls-swal-danger${suffix}`))) {
            continue;
        }
        matchedRules++;
        for (const decl of m[2].split(';')) {
            const normalized = decl.replace(/\s+/g, '').toLowerCase();
            if (normalized) out.add(normalized);
        }
    }
    return matchedRules > 0 ? [...out].sort() : null;
};

const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
for (const state of ['', ':hover', ':focus', ':focus:not(:focus-visible)']) {
    const fromLess = declarations(stripCssComments(compiled), state);
    const fromArtifact = declarations(stripCssComments(artifact), state);
    const label = state || '基础态';
    check(`产物与 less 一致：${label}`,
        !!fromLess && !!fromArtifact && fromLess.join('|') === fromArtifact.join('|'),
        `less=${JSON.stringify(fromLess)} 产物=${JSON.stringify(fromArtifact)}`);
}

// 对比度（WCAG 相对亮度，真算不是估）
const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
// 按「选择器 + 花括号配对」取令牌块：不依赖块内顺序或文件里第几次出现。
const appCss = read('resources', 'css', 'app.css');
const themeBlock = (selector) => {
    const start = appCss.indexOf(selector);
    if (start === -1) return '';
    let depth = 0;
    for (let i = appCss.indexOf('{', start); i < appCss.length; i++) {
        if (appCss[i] === '{') depth++;
        else if (appCss[i] === '}') {
            depth--;
            if (depth === 0) return appCss.slice(start, i + 1);
        }
    }
    return '';
};
const themeTokens = (selector) => {
    const block = themeBlock(selector);
    return { token: (name) => (block.match(new RegExp(`--lsky-${name}:\\s*(#[0-9a-f]{6})`)) || [])[1], block };
};
const light = themeTokens(':root');
const dark = themeTokens('html.dark');

for (const [themeName, theme] of [['亮色', light], ['暗色', dark]]) {
    const btn = theme.token('danger-btn');
    const hover = theme.token('danger-btn-hover');
    const border = theme.token('danger-btn-border');
    const surface = theme.token('surface');
    const ring = theme.token('danger-ring');

    check(`${themeName}：文字与按钮底色对比度 ≥ 4.5:1`, !!btn && contrast(btn, '#ffffff') >= 4.5,
        `${btn} → ${btn ? contrast(btn, '#ffffff').toFixed(2) : '?'}`);
    check(`${themeName}：hover 态对比度也 ≥ 4.5:1`, !!hover && contrast(hover, '#ffffff') >= 4.5,
        `${hover} → ${hover ? contrast(hover, '#ffffff').toFixed(2) : '?'}`);
    check(`${themeName}：按钮边框与弹窗底色对比度 ≥ 3:1（按钮轮廓看得见）`,
        !!border && !!surface && contrast(border, surface) >= 3,
        `${border} vs ${surface} → ${border && surface ? contrast(border, surface).toFixed(2) : '?'}`);
    check(`${themeName}：焦点环与弹窗底色对比度 ≥ 3:1`,
        !!ring && !!surface && contrast(ring, surface) >= 3,
        `${ring} vs ${surface} → ${ring && surface ? contrast(ring, surface).toFixed(2) : '?'}`);
}

check('焦点环不再用 --lsky-danger-soft（亮色 1.09:1，等于没有焦点提示）',
    /ls-swal-danger:focus[\s\S]{0,300}?--lsky-danger-ring/.test(lessCss)
    && !/ls-swal-danger:focus[\s\S]{0,120}?--lsky-danger-soft/.test(lessCss));

/* ---------------- E. 图片管理页每页 36 张 ---------------- */

console.log('E. 每页张数');
check('图片管理页每页 36 张', /\)->latest\(\)->paginate\(36\);/.test(read('app', 'Http', 'Controllers', 'Admin', 'ImageController.php')));

const imageBlade = blades['admin/image/index.blade.php'];
check('图片网格不再有 8 列断点（大屏也是 6 列，36 = 6×6 恒成立）', !/2xl:grid-cols-8/.test(imageBlade));
check('图片网格保留 6 列断点', /xl:grid-cols-6/.test(imageBlade));

/* ---------------- F. 清空弹窗的说明按钮 ---------------- */

console.log('F. 清空弹窗说明');
check('勾选项后面有问号按钮', /id="purge-help-btn"/.test(strategyBlade));
check('说明默认收起（display:none）', /id="purge-help"[^>]*display:none/.test(strategyBlade));
check('说明文字仍在（问号按钮的 title 与展开内容）', (strategyBlade.match(/不勾选则只删图床数据库记录/g) || []).length >= 2);

console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
