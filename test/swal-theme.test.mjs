/*
 * 「移动到相册 / 详细信息」两个新弹窗的收尾（去哨兵、去横线、统一排版字号）+ 右键菜单里
 * 「删除 / 重命名」两个旧弹窗（sweetalert2）与新弹窗统一观感 —— 回归测试。
 * （原来的第三个 Swal 弹窗「设置权限」已随图片权限口径一起下线，改成标签的 x-modal。）
 *
 * 与另外两套的关系：
 *   · images-modal.test.mjs      —— 新弹窗的静态契约（钩子、字段顺序、请求 payload）
 *   · images-modal-dom.test.mjs  —— 新弹窗的行为（jsdom + jQuery 跑三条内联脚本）
 *   · 这一套                      —— 样式层：哨兵隐藏是否只影响弹窗、footer 横线是否真的没了、
 *                                  sweetalert2 那套皮肤有没有真的压过它自己运行时注入的默认样式。
 *
 * 关键点：sweetalert2 的 CSS 是运行时由 JS 注入到 <head> 末尾的（排在 common.css 之后），
 * 所以「写了没有用」是这个任务最容易翻车的地方。这里把编译出来的 common.css 放前面、
 * sweetalert2 自己的 CSS 放后面，用 jsdom 的层叠算出真实生效值来验证（不靠 !important）。
 *
 * 运行：node swal-theme.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const blade = read('resources', 'views', 'user', 'images.blade.php');
// 断言只该看「代码」：注释里会出现 .swal2-xxx / !important / 12px 这些字样，会把检查带偏
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const lessRaw = read('resources', 'css', 'common.less');
const less = stripComments(lessRaw);

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

function tpl(id) {
    const start = blade.indexOf(`<script type="text/html" id="${id}">`);
    if (start < 0) return '';
    const end = blade.indexOf('</script>', start);
    return end < 0 ? '' : blade.slice(start, end + '</script>'.length);
}

const movementsTpl = tpl('movements-container-tpl');
const movementsItemTpl = tpl('movements-album-item-tpl');

// ---------------------------------------------------------------- 编译 common.less
// 依赖解析：sweetalert2 / less 由 **test/package.json 正经声明**（`npm ci` 之后就在
// test/node_modules 里）。../src/node_modules 只作本地开发时的后备 —— CI 新拉的 checkout
// 里没有它，以前直接读那里会让这条测试「换个环境就跑不起来」。
const DEP_ROOTS = [path.join(here, 'node_modules'), path.join(SRC, 'node_modules')];
function depResolve(rel, label) {
    const tried = [];
    for (const root of DEP_ROOTS) {
        const p = path.join(root, rel);
        tried.push(p);
        if (fs.existsSync(p)) {
            if (root !== DEP_ROOTS[0]) {
                console.log(`  （提示）${label} 取自后备路径 ${p} —— 在 test/ 里 npm ci 之后会从 test/node_modules 取`);
            }
            return { root, path: p };
        }
    }
    throw new Error(`找不到 ${label}（${rel}）。在 test/ 里 npm ci（依赖已声明在 test/package.json）\n  找过：\n  - ${tried.join('\n  - ')}`);
}
const depPath = (rel, label) => depResolve(rel, label).path;

function compiledCommonCss() {
    const lessc = depPath(path.join('.bin', 'lessc'), 'lessc（less 包）');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsky-less-'));
    const entry = path.join(tmp, 'common.less');
    // '~toastr' 是 webpack 的解析写法，lessc 不认；换成一行注释即可（内容与本测试无关）
    fs.writeFileSync(entry, lessRaw.replace("@import '~toastr';", '// stub'));
    const out = path.join(tmp, 'common.css');
    execFileSync(lessc, [entry, out]);
    return fs.readFileSync(out, 'utf8');
}

const css = compiledCommonCss();
const swalCss = fs.readFileSync(depPath(path.join('sweetalert2', 'dist', 'sweetalert2.css'), 'sweetalert2 的 CSS'), 'utf8');

// 一致性自检：test 侧装的 sweetalert2 / less 与**应用构建期实际用的那份**（src/package-lock.json）
// 必须逐版本一致 —— 否则「CSS 层叠 / LESS 编译」这套断言测的就不是应用真正用到的东西了。
// （实测过代价：sweetalert2 11.26 的默认 CSS 与 11.4 不同，输入框高度、border 简写都变了 → 3 条断言红。
//   所以 test/package.json 对这两个包是**精确版本**，不是范围；src 一升级，这里要同步跟着升。）
{
    const appLock = JSON.parse(read('package-lock.json'));
    const locked = (name) => ((appLock.packages || {})[`node_modules/${name}`] || {}).version || '';
    for (const name of ['sweetalert2', 'less']) {
        const installed = JSON.parse(fs.readFileSync(
            depResolve(path.join(name, 'package.json'), `${name} 的 package.json`).path, 'utf8'));
        check(`test 侧 ${name} 与应用锁定的版本逐字一致（src/package-lock.json ↔ test/package.json）`,
            installed.version === locked(name) && !!locked(name),
            `test=${installed.version} src 锁定=${locked(name) || '(缺)'}`);
    }
}

// ---------------------------------------------------------------- ① 哨兵 & 横线
console.log('\n[① 去哨兵] 「移动到相册」「相册」两个弹窗里都不再出现「我也是有底线的~」');
{
    check('less 里按弹窗 id 收窄：只有 #image-movements-modal 里的 .infinite-scroll 被藏',
        /#image-movements-modal\s*\{\s*\.infinite-scroll\s*\{\s*display:\s*none;?\s*\}\s*\}/.test(less));
    check('不是一刀切地隐藏 .infinite-scroll（图片墙的哨兵要照旧显示）',
        !/(^|\})\s*\.infinite-scroll\s*{\s*display:\s*none/.test(less));
    // 相册列表从右侧抽屉搬进 #album-switch-modal 后，哨兵也要在这个弹窗里藏掉。
    // 那条规则写在 images.blade.php 自己的 <style> 里（本仓库的补丁只改这一个文件，common.less 不动），
    // 所以这里做静态断言（编译出来的 common.css 里当然没有它）。
    check('相册弹窗（#album-switch-modal）里同样藏掉哨兵，且 common.less 里那条一个字没动',
        /#album-switch-modal \.infinite-scroll \{\s*display: none;\s*\}/.test(blade)
        && /#image-movements-modal\s*\{\s*\.infinite-scroll\s*\{\s*display:\s*none;?\s*\}\s*\}/.test(less));
    check('列表容器仍可滚动（#movements-albums 保留 overflow-y-auto + max-h-[50vh]）',
        /id="movements-albums"[^>]*class="[^"]*overflow-y-auto[^"]*"[^>]*>/.test(movementsTpl)
        && movementsTpl.includes('max-h-[50vh]'));

    // 用真实层叠验证：同一个 .infinite-scroll，在「移动到相册」弹窗里 display:none、在图片墙里 display:flex
    const dom = new JSDOM(`<!DOCTYPE html><html><head><style>${css}</style></head><body>
        <div id="image-movements-modal"><div id="movements-albums">
            <div class="infinite-scroll"><span>我也是有底线的~</span></div>
        </div></div>
        <div id="images-scroll">
            <div class="infinite-scroll"><span>我也是有底线的~</span></div>
        </div>
    </body></html>`);
    const display = (sel) => dom.window.getComputedStyle(dom.window.document.querySelector(sel)).display;
    check('弹窗里的哨兵 display=none（那行「我也是有底线的~」看不见了）',
        display('#image-movements-modal .infinite-scroll') === 'none',
        display('#image-movements-modal .infinite-scroll'));
    check('图片墙的哨兵不受影响（display=flex，还是原来的样式）',
        display('#images-scroll .infinite-scroll') === 'flex', display('#images-scroll .infinite-scroll'));
    dom.window.close?.();
}

console.log('\n[① 去横线] 底部按钮区上方那条横线（footer 的 border-t）没了');
{
    const footer = movementsTpl.slice(movementsTpl.indexOf('mt-4 flex justify-end'));
    const footerTag = footer.slice(0, footer.indexOf('>'));
    check('footer 容器不再带 border-t / border-line', !/border(-t)?(-\w+)?\b/.test(footerTag), footerTag);
    check('footer 里也没有 <hr>', !/<hr/i.test(movementsTpl));
    check('按钮只剩上间距（mt-4），不再有 pt-3 撑起的分隔带', !/pt-3/.test(footerTag), footerTag);
    check('「取消」「移动」两个按钮还在（钩子没动）',
        movementsTpl.includes('id="movements-cancel"') && /id="movements-confirm"[^>]*disabled/.test(movementsTpl));
}

// ---------------------------------------------------------------- ② 新弹窗排版
console.log('\n[② 排版] 新弹窗：标题 15~16px semibold / 标签 13px / 值 14px / 令牌色 / 底部按钮全局一致');
{
    const detailTpl = tpl('image-detail-tpl');
    check('移动弹窗标题 16px semibold',
        /text-\[16px\] font-semibold[^"]*text-ink/.test(movementsTpl.slice(0, movementsTpl.indexOf('__count__'))));
    check('移动弹窗副标题 13px text-ink-3（文案一字未改）',
        movementsTpl.includes('已选择 __count__ 张图片') && /text-\[13px\][^"]*text-ink-3/.test(movementsTpl));
    check('详细信息弹窗也有 16px semibold 标题', /text-\[16px\] font-semibold/.test(detailTpl));
    check('标签 13px text-ink-3 ×12、值 14px text-ink ×12（字号没被改乱）',
        (detailTpl.match(/text-\[13px\] leading-6 text-ink-3/g) || []).length === 12
        && (detailTpl.match(/text-\[14px\] leading-6 text-ink/g) || []).length === 12);
    check('字段之间等距（每行 py-3 + divide-y 分割线；分区间距一致）',
        /<dl class="divide-y divide-line[^"]*">/.test(detailTpl)
        && (detailTpl.match(/gap-0\.5 py-3 sm:flex-row sm:gap-4/g) || []).length === 12);
    check('底部按钮沿用全局 ls-btn / ls-btn-primary',
        movementsTpl.includes('id="movements-cancel" class="ls-btn ') && movementsTpl.includes('id="movements-confirm" class="ls-btn ls-btn-primary '));
    check('两个新弹窗模板里没有硬编码颜色（只用设计令牌）',
        !/#[0-9a-fA-F]{3,8}\b/.test(detailTpl + movementsTpl + movementsItemTpl)
        && !/\b(?:text|bg|border)-(?:white|black|gray-\d+|red-\d+|blue-\d+)\b/.test(detailTpl + movementsTpl + movementsItemTpl));
    check('相册行基础态仍留 border-line bg-surface-2 text-ink（JS 的 toggleClass 才有东西可换）',
        /class="movements-album [^"]*border-line\b[^"]*bg-surface-2\b[^"]*text-ink\b/.test(movementsItemTpl));
}

// ---------------------------------------------------------------- ③ sweetalert2 皮肤
console.log('\n[③ 旧弹窗] 两个确认框改用与新弹窗同一套皮肤（改的只有样式，功能/确认流程一字未动）');
{
    // fork：原来这里是「删除 / 重命名 / 设置权限」三个 Swal 弹窗；「设置权限」已按要求
    // 连同「公开/私有」口径一起下线（换成了标签，走 x-modal 而不是 Swal），剩这两个照旧。
    check('剩下的两个旧弹窗实现还在原地（methods.delete/rename 走 Swal.fire）',
        blade.includes("title: '确认要删除选中的图片？'")
        && blade.includes("title: '请输入图片名称'"));
    check('「设置权限」那个 Swal 弹窗已彻底下线（公开/私有 文案一个不剩）',
        !blade.includes('选择一个权限') && !blade.includes('设置权限') && !blade.includes("input: 'select'")
        && !blade.includes('公开') && !blade.includes('私有'));
    check('确认框选项没被改（没塞 customClass 之类，纯靠 CSS 统一）', !blade.includes('customClass'));
    check('校验/提交流程一字未改（preConfirm + showValidationMessage + inputValue）',
        blade.includes('inputValue: item.filename') && blade.includes('preConfirm: (value) => {')
        && blade.includes("Swal.showValidationMessage('服务异常，请稍后重试。')"));

    check('皮肤在同一份 common.less 里升级（没有另起一套文件）',
        fs.readdirSync(path.join(SRC, 'resources', 'css')).filter((f) => /swal/i.test(f)).length === 0);
    // 皮肤段 = 代码里的 `html:root { … }`（sweetalert2 主题）到 `html.dark { … }` 之间
    const swalSection = less.slice(less.indexOf('html:root {'), less.indexOf('html.dark {'));
    check('旧的「只在 html.dark 里覆盖」已升级成亮/暗共用（html.dark 里不再有 swal2 规则）',
        !/html\.dark\s*\{[\s\S]*?\.swal2-/.test(less));
    check('皮肤段里没有 !important（靠 html 前缀提权重；文件原有的 [x-cloak] 那条不算）',
        swalSection.includes('.swal2-popup') && !/!\s*important/.test(swalSection));
    check('卡片圆角 12px（与 x-modal 的 rounded-xl2 一致）', /\.swal2-popup\s*\{[\s\S]*?border-radius:\s*12px/.test(less));
    check('标题 16px / 600', /\.swal2-title\s*\{[\s\S]*?font-size:\s*16px[\s\S]*?font-weight:\s*600/.test(less));
    check('正文 14px、按钮 13.5px、输入框 14px（13/14px 一档）',
        /\.swal2-html-container\s*\{[\s\S]*?font-size:\s*14px/.test(less)
        && /\.swal2-styled[\s\S]*?font-size:\s*13\.5px/.test(less)
        && /\.swal2-input[\s\S]*?font-size:\s*14px/.test(less));
    check('按钮区右对齐（与弹窗的 justify-end 一致）', /\.swal2-actions\s*\{[\s\S]*?justify-content:\s*flex-end/.test(less));
    check('颜色全部走设计令牌（除按钮白字 #fff 外没有写死的颜色）',
        !/#(?!fff\b)[0-9a-fA-F]{3,8}\b/.test(swalSection)
        && /var\(--lsky-accent\)/.test(swalSection) && /var\(--lsky-surface\)/.test(swalSection)
        && /var\(--lsky-text-2\)/.test(swalSection));
}

// ---------------------------------------------------------------- ③ 层叠：真的压过默认样式
console.log('\n[③ 层叠] 复刻运行时注入顺序（common.css 在前、sweetalert2 在后）后，关键属性真的生效');
{
    const dom = new JSDOM(`<!DOCTYPE html><html><head>
        <style>${css}</style>
        <style>${swalCss}</style>
    </head><body>
        <div class="swal2-container swal2-center swal2-backdrop-show">
          <div class="swal2-popup" role="dialog">
            <div class="swal2-icon swal2-warning"><div class="swal2-icon-content">!</div></div>
            <h2 class="swal2-title">确认要删除选中的图片？</h2>
            <div class="swal2-html-container">删除后不可恢复</div>
            <input class="swal2-input" value="beach.jpg">
            <select class="swal2-select"><option>公开</option></select>
            <div class="swal2-validation-message">请选择正确的权限</div>
            <div class="swal2-actions">
              <button class="swal2-styled swal2-confirm">确认删除</button>
              <button class="swal2-styled swal2-cancel">取消</button>
            </div>
          </div>
        </div>
    </body></html>`);
    const val = (sel, prop) => {
        const el = dom.window.document.querySelector(sel);
        return el ? String(dom.window.getComputedStyle(el).getPropertyValue(prop)) : '<no node>';
    };
    const expect = (name, sel, prop, want) =>
        check(name, val(sel, prop) === want, `${prop}=${JSON.stringify(val(sel, prop))}（期望 ${want}）`);

    expect('弹窗卡片：圆角 12px', '.swal2-popup', 'border-radius', '12px');
    expect('弹窗卡片：内边距 20px', '.swal2-popup', 'padding-top', '20px');
    // 边框这条不能靠 jsdom 的层叠：它跨规则处理「简写 vs 长写」是错的
    // （实测 `.a { border: none }` 会盖掉权重更高的 `html .a { border-width: 1px }`）。
    // 换成两条等价的、可验证的说法：① 只有我们的样式时确实是 1px；② 我们的权重高过 sweetalert2 那条。
    const onlyOurs = new JSDOM(`<!DOCTYPE html><html><head><style>${css}</style></head>
        <body><div class="swal2-popup"></div></body></html>`);
    check('弹窗卡片：只有我们的样式时 border-top-width = 1px（sweetalert2 默认是 border:none）',
        onlyOurs.window.getComputedStyle(onlyOurs.window.document.querySelector('.swal2-popup')).borderTopWidth === '1px',
        onlyOurs.window.getComputedStyle(onlyOurs.window.document.querySelector('.swal2-popup')).borderTopWidth);
    onlyOurs.window.close?.();

    // 选择器权重（本测试只用得到 元素/类 这几种，够用了）
    // `:where(...)` 内部**不计分**（CSS 规定，jsdom 也照此实现）—— 先剥掉再数。
    const spec = (sel) => {
        const s = sel.trim().replace(/:where\([^()]*\)/g, '');
        const ids = (s.match(/#[\w-]+/g) || []).length;
        const cls = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]+\]/g) || []).length
            + (s.match(/(?<!:):[a-z-]+/g) || []).length;
        const els = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
        return ids * 10000 + cls * 100 + els;
    };
    // sweetalert2 11.22 起：默认边框从字面量 `border: none` 改成变量声明
    // （`:root { --swal2-border: none }`），基础卡片规则写成
    // `div:where(.swal2-container) div:where(.swal2-popup) { border: var(--swal2-border); … }`。
    check('sweetalert2 默认无边框：:root 里 `--swal2-border: none`，基础卡片规则用 `border: var(--swal2-border)`',
        /--swal2-border:\s*none/.test(swalCss)
        && /div:where\(\.swal2-container\)\s+div:where\(\.swal2-popup\)\s*\{[^}]*border:\s*var\(--swal2-border\)/.test(swalCss));
    check('权重：我们的 `html:root .swal2-popup`（(0,2,1)）压过它那条基础规则 `div:where(…) div:where(…)`（(0,0,2)）',
        spec('html:root .swal2-popup') > spec('div:where(.swal2-container) div:where(.swal2-popup)'),
        `ours=${spec('html:root .swal2-popup')} swal=${spec('div:where(.swal2-container) div:where(.swal2-popup)')}`);
    // 输入框是这场「权重竞赛」里最吃紧的一处：11.22 的
    // `div:where(.swal2-container) .swal2-input { height: 2.625em; padding: 0 .75em }` 是 (0,1,1)，
    // 与旧的 `html .swal2-input` 平权重、靠后注入取胜 —— 所以前缀必须抬到 `html:root`（(0,2,1)）。
    check('权重：我们的 `html:root .swal2-input`（(0,2,1)）压过它 `div:where(.swal2-container) .swal2-input`（(0,1,1)）',
        spec('html:root .swal2-input') > spec('div:where(.swal2-container) .swal2-input'),
        `ours=${spec('html:root .swal2-input')} swal=${spec('div:where(.swal2-container) .swal2-input')}`);
    expect('弹窗卡片：文字左对齐', '.swal2-popup', 'text-align', 'left');
    expect('标题 16px（默认 30px）', '.swal2-title', 'font-size', '16px');
    expect('标题 semibold 600', '.swal2-title', 'font-weight', '600');
    expect('正文 14px', '.swal2-html-container', 'font-size', '14px');
    expect('按钮区右对齐（默认居中）', '.swal2-actions', 'justify-content', 'flex-end');
    expect('确认按钮高 36px（= ls-btn 的 h-9）', '.swal2-styled.swal2-confirm', 'height', '36px');
    expect('确认按钮 13.5px / 500 / 圆角 8px（= ls-btn 的字号字重圆角）', '.swal2-styled.swal2-confirm', 'font-size', '13.5px');
    check('确认按钮字重 500', val('.swal2-styled.swal2-confirm', 'font-weight') === '500', val('.swal2-styled.swal2-confirm', 'font-weight'));
    check('确认按钮圆角 8px', val('.swal2-styled.swal2-confirm', 'border-radius') === '8px', val('.swal2-styled.swal2-confirm', 'border-radius'));
    expect('取消按钮高 36px、圆角 8px', '.swal2-styled.swal2-cancel', 'height', '36px');
    check('取消按钮圆角 8px', val('.swal2-styled.swal2-cancel', 'border-radius') === '8px', val('.swal2-styled.swal2-cancel', 'border-radius'));
    expect('输入框高 38px（= ls-input 的 h-9 一档）', '.swal2-input', 'height', '38px');
    expect('输入框圆角 8px', '.swal2-input', 'border-radius', '8px');
    expect('校验提示 13px', '.swal2-validation-message', 'font-size', '13px');
    check('警示图标缩到 55px（默认 80px）', val('.swal2-icon', 'width') === '55px', val('.swal2-icon', 'width'));

    // 反证：前缀只加一位（`html `）的写法会输给 sweetalert2 的
    // `div:where(.swal2-container) .swal2-input`（(0,1,1) 平权重 + 它的样式后注入 → 它赢），
    // 说明把前缀抬到 `html:root `（(0,2,1)）不是白加的。卡片那条早先还有平权重问题，
    // 11.22 起它的基础规则换成 `div:where(…) div:where(…)`（(0,0,2)），纯类覆盖本来就够 —— 换成输入框这条更贴现实。
    const weak = new JSDOM(`<!DOCTYPE html><html><head>
        <style>html .swal2-input { height: 38px; }</style>
        <style>${swalCss}</style></head><body>
        <div class="swal2-container"><div class="swal2-popup"><input class="swal2-input" value="x"></div></div></body></html>`);
    const weakVal = weak.window.getComputedStyle(weak.window.document.querySelector('.swal2-input')).height;
    check('（对照）只带 `html ` 前缀的 .swal2-input 覆盖不住 sweetalert2 注入的默认值',
        weakVal !== '38px', `height=${JSON.stringify(weakVal)}`);
    dom.window.close?.();
    weak.window.close?.();
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
