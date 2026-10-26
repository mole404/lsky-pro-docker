/*
 * 后台分页可见性 + 「清空存储策略图片」的静态契约测试。
 *
 * A. 分页：四个后台列表页必须用自写的 <x-pagination>，且组件里用到的每一个工具类
 *    都要在提交进仓库的 public/css/app.css 里真实存在。
 *    —— 这条是本轮的根因守卫：Laravel 自带分页模板靠 `sm:flex` / `sm:flex-1` 这类
 *    只出现在 vendor 视图里的类，Tailwind 扫不到、产物里没有 ⇒ 桌面端整块 display:none。
 *    只要有人把 `sm:` 前缀写回组件、或用了产物里没有的类，这里就会红。
 *
 * B. 清空策略：路由、控制器口径（游标 / 快照 / 输入式确认）、UserService 的
 *    $deleteFiles 分支与「用户计数只算一次」都要在。
 *
 * 运行：node admin-pagination-and-purge.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

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

/* ---------------- A. 分页组件 ---------------- */

const blades = {
    'admin/image/index.blade.php': read('resources', 'views', 'admin', 'image', 'index.blade.php'),
    'admin/user/index.blade.php': read('resources', 'views', 'admin', 'user', 'index.blade.php'),
    'admin/strategy/index.blade.php': read('resources', 'views', 'admin', 'strategy', 'index.blade.php'),
    'admin/group/index.blade.php': read('resources', 'views', 'admin', 'group', 'index.blade.php'),
};

const component = read('resources', 'views', 'components', 'pagination.blade.php');

console.log('A. 后台分页');

for (const [name, text] of Object.entries(blades)) {
    check(`${name} 使用 <x-pagination>`, /<x-pagination\s+:paginator="\$\w+"\s*\/>/.test(text));
    check(`${name} 不再调用 links()`, !/->links\(\)/.test(text));
}

check('组件不接受分页器以外的入参（避免又走回默认模板）', /@props\(\['paginator'\]\)/.test(component));
check('组件保留查询串（翻页不丢筛选/关键字）', /withQueryString\(\)/.test(component));

const classes = new Set();
for (const m of component.matchAll(/class="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
        if (cls && !cls.includes('{{') && !cls.includes('}}')) {
            classes.add(cls);
        }
    }
}

const css = read('public', 'css', 'app.css');
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

/* ---------------- B. 清空存储策略图片 ---------------- */

console.log('B. 清空存储策略');

const routes = read('routes', 'web.php');
check(
    'POST admin/strategies/{id}/purge-images 路由存在',
    /Route::post\('\{id\}\/purge-images'.*?StrategyController::class, 'purgeImages'/.test(routes)
);

const controller = read('app', 'Http', 'Controllers', 'Admin', 'StrategyController.php');
check('控制器要求输入「确认删除」', /\$request->input\('confirm'\)\s*!==\s*'确认删除'/.test(controller));
check('控制器用 id 游标分批', /'cursor'/.test(controller) && /orderBy\('id'\)/.test(controller));
check('控制器第一次请求取 max(id) 做快照', /max\('id'\)/.test(controller) && /'snapshot'/.test(controller));
check('控制器有时间预算并返回下一段游标', /microtime\(true\)/.test(controller) && /'remaining'/.test(controller));
check('控制器把 delete_files 传给删除服务', /\$service->deleteImages\(\$chunk, null, 'id', \$deleteFiles\)/.test(controller));
check('控制器只删本策略的图', /where\('strategy_id', \$strategy->id\)/.test(controller));

const service = read('app', 'Services', 'UserService.php');
check('deleteImages 支持只删记录', /bool \$deleteFiles = true/.test(service) && /Image::withoutEvents/.test(service));
check('用户图片计数在循环外只算一次', /foreach \(\$touchedUsers as \$touched\)/.test(service));

const strategyBlade = blades['admin/strategy/index.blade.php'];
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
check('勾选框默认不勾选（只删记录为默认行为）', /id="purge-delete-files"[^-]*?>/s.test(strategyBlade) && !/id="purge-delete-files"\s+checked/.test(strategyBlade));
check('说明文案为「只删图床数据库记录 / 希望保留存储内图片」', /只删图床数据库记录[\s\S]{0,40}希望保留存储内图片/.test(strategyBlade));
check('勾选框去掉蓝色焦点框', /#purge-delete-files\{outline:none!important/.test(strategyBlade));

/* ---------------- C. 图片页筛选面板：清除筛选出现后要重算高度 ---------------- */

console.log('C. 图片页筛选面板');
const userBlade = read('resources', 'views', 'user', 'images.blade.php');
check(
    'updateFilterButton 切换「清除筛选」后重算面板高度',
    /\$\('#tag-filter-clear'\)\.toggleClass\('hidden', ! on\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*fitFilterPanel\(\);/.test(userBlade)
);


/* ---------------- D. 危险确认键（红底白字） ---------------- */

console.log('D. 危险确认键');

const dangerDialogs = {
    'admin/user/index.blade.php': 1,
    'admin/image/index.blade.php': 1,
    'admin/strategy/index.blade.php': 2,
    'admin/group/index.blade.php': 1,
    'user/images.blade.php': 3,
};
for (const [name, expected] of Object.entries(dangerDialogs)) {
    const text = name.startsWith('user/') ? read('resources', 'views', 'user', 'images.blade.php')
        : blades[name];
    const hits = (text.match(/customClass: \{confirmButton: 'ls-swal-danger'\}/g) || []).length;
    check(`${name} 的 ${expected} 个删除确认键都挂了危险样式`, hits === expected, `实际 ${hits}`);
}

check('「退出所有登录会话」的 deny 键也挂了危险样式',
    /customClass: \{denyButton: 'ls-swal-danger'\}/.test(read('resources', 'views', 'user', 'settings.blade.php')));

const lessCss = read('resources', 'css', 'common.less');
check('common.less 定义了 .ls-swal-danger', /\.swal2-styled\.swal2-confirm\.ls-swal-danger[\s\S]{0,400}?ls-swal-danger:focus/.test(lessCss));
check('危险键的红底/白字由令牌驱动', /ls-swal-danger[\s\S]{0,200}?background-color: var\(--lsky-danger-btn\)/.test(lessCss));
check('危险键 hover 只换颜色（不用 filter / opacity）', (() => {
    const m = lessCss.match(/ls-swal-danger:hover[\s\S]{0,200}?\}/);
    return !!m && !/filter|opacity|transform/.test(m[0]);
})());

// 产物必须和源同步（构建期不跑 npm，产物是提交进仓库的）
const commonArtifact = read('public', 'css', 'common.css');
check('public/css/common.css 里也有危险键规则（产物没落盘就等于没生效）',
    commonArtifact.includes('html:root .swal2-styled.swal2-confirm.ls-swal-danger'));

// 暗色按钮底色必须能和白字过 AA（≥4.5:1）
const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const darkTokens = read('resources', 'css', 'app.css').split('html.dark')[1] || '';
const darkBtn = (darkTokens.match(/--lsky-danger-btn:\s*(#[0-9a-f]{6})/) || [])[1];
check('暗色危险按钮底色与白字对比度 ≥ 4.5:1', !!darkBtn && contrast(darkBtn, '#ffffff') >= 4.5,
    `底色 ${darkBtn} 对比度 ${darkBtn ? contrast(darkBtn, '#ffffff').toFixed(2) : '?'}`);

/* ---------------- E. 图片管理页每页 36 张 ---------------- */

console.log('E. 每页张数');
check('图片管理页每页 36 张', /\)->latest\(\)->paginate\(36\);/.test(read('app', 'Http', 'Controllers', 'Admin', 'ImageController.php')));

/* ---------------- F. 清空弹窗的说明改成问号按钮 ---------------- */

console.log('F. 清空弹窗说明');
check('勾选项后面有问号按钮', /id="purge-help-btn"/.test(strategyBlade));
check('说明默认收起（display:none）', /id="purge-help"[^>]*display:none/.test(strategyBlade));
check('问号按钮点击切换显示', /getElementById\(\\?'purge-help\\?'\)/.test(strategyBlade));
check('说明文字仍在（问号按钮的 title 与展开内容）', (strategyBlade.match(/不勾选则只删图床数据库记录/g) || []).length >= 2);


console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
