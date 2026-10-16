/**
 * 看图器工具栏图标：库内嵌的 1x 位图雪碧图 → 同款内联 SVG（读文件 + jsdom 解析断言，不跑浏览器）。
 *
 * 背景：viewer.min.css 给 14 个内置键的图标用的是一张 **280×20 的 1x 位图雪碧图**（每格 20×20），
 * 高分屏（手机 2x/3x）放大后发糊；页面里自绘的「裁剪 / 全屏」是内联 SVG，所以两者清晰度肉眼可见地不同。
 * 现在把其中 12 个键也换成内联 SVG：24×24 viewBox、无填充、2.5 描边、圆头圆角，盒子仍 20×20、
 * li 仍 24×24（热区不变），字形统一 16px（background-position:2px 2px + background-size:16px 16px）。
 *
 * 这份测试守的硬约束：
 *   ① 12 个键的选择器齐全，且都带 `html ` 前缀（(0,2,4) > 库的 .viewer-xxx:before (0,1,1)，改了页面顺序也不翻车）；
 *   ② 每条规则的 7 条声明（content/display/盒子/背景图/位置/重复/尺寸）都齐，缺一条就会退回「空黑圆底」；
 *   ③ 一律内联 data URI，**不许外链**（本块里 `http` 只能出现在 xmlns 声明里）；
 *   ④ 每个 data URI 都能被 XML 解析、纯 ASCII、转义只用 %3C/%3E/%23；
 *   ⑤ 字形坐标必须落在 0..24 的 viewBox 内（含 2.5 描边的一半），且不能小到看不出（防手滑画成点）；
 *   ⑥ 「关闭 ×」那条不许碰库的定位声明（.viewer-button:before{bottom:15px;left:15px;position:absolute}），
 *      并同时挂 viewer-close 与 [data-viewer-action="mix"] 两个选择器（1.10.4 里前者是不存在的类）；
 *   ⑦ 不删库的雪碧图规则本身（我们只做覆盖，不动压缩产物）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const blade = read('resources', 'views', 'user', 'images.blade.php');

// 抠出图标块：从「工具栏图标：」那段注释起，到最后一个规则（close）的右花括号
const marker = 'html .viewer-toolbar > ul > li.viewer-zoom-in:before';
const mIdx = blade.indexOf(marker);
const commentStart = blade.lastIndexOf('/* 工具栏图标：', mIdx);
const closeIdx = blade.indexOf('data-viewer-action="mix"]:before {', mIdx);
const blockEnd = blade.indexOf('\n        }', blade.indexOf('background-size: 16px 16px;', closeIdx)) + '\n        }'.length;
const block = commentStart >= 0 && blockEnd > commentStart ? blade.slice(commentStart, blockEnd) : '';

console.log('\n[1] 图标块本身');
{
    check('① 抠到图标块真身（未手抄，长度合理）', block.length > 3000 && block.includes('280×20'), `${block.length} 字符`);
    const rules = [...block.matchAll(/(html [^{}]+?):before\s*\{([^}]*)\}/g)]
        .map((m) => ({ sel: m[1].replace(/\s+/g, ' ').trim(), decl: m[2] }));
    check('② 一共 12 条规则（close 一条挂两个选择器）', rules.length === 12, `实得 ${rules.length} 条`);

    const KEYS = ['zoom-in', 'zoom-out', 'one-to-one', 'reset', 'prev', 'play', 'next',
        'rotate-left', 'rotate-right', 'flip-horizontal', 'flip-vertical'];
    const missing = KEYS.filter((k) => ! rules.some((r) => r.sel.endsWith(`li.viewer-${k}`)));
    check('③ 工具栏里实际会用到的 11 个键都各有一条', missing.length === 0, missing.length ? '缺：' + missing.join(', ') : '齐');
    const closeRule = rules.find((r) => r.sel.includes('viewer-close'));
    check('④ 关闭按钮：viewer-close 与 [data-viewer-action="mix"] 两个选择器都在',
        !! closeRule && closeRule.sel.includes('.viewer-button.viewer-close')
        && closeRule.sel.includes('[data-viewer-action="mix"]'), closeRule ? closeRule.sel : '未找到');

    const need = ["content: ''", 'display: block', 'width: 20px', 'height: 20px',
        'background-image: url("data:image/svg+xml,', 'background-position: 2px 2px',
        'background-repeat: no-repeat', 'background-size: 16px 16px'];
    const bad = [];
    for (const r of rules) {
        const lack = need.filter((d) => ! r.decl.includes(d));
        if (lack.length) { bad.push(`${r.sel} 缺 ${lack.join(' / ')}`); }
    }
    check('⑤ 每条规则的 7 条声明都齐（缺一条就退回空黑圆底）', bad.length === 0, bad.length ? bad.join('；') : `${rules.length} 条全齐`);
    check('⑥ 每条选择器都带 html 前缀（特异性压过库的 .viewer-xxx:before）',
        rules.every((r) => r.sel.startsWith('html ')) && rules.every((r) => r.sel.includes('viewer-')));
    check('⑦ 「关闭 ×」不碰库的定位：规则体里没有 position/bottom/left/top/right',
        !! closeRule && ! /(?<!background-)\b(position|bottom|left|top|right)\s*:/.test(closeRule.decl), closeRule ? closeRule.decl.replace(/\s+/g, ' ').slice(0, 90) : '');
}

console.log('\n[2] 内联 SVG 的转义与几何');
{
    const uris = [...block.matchAll(/url\("(data:image\/svg\+xml,([^"]*))"\)/g)].map((m) => ({ uri: m[1], body: m[2] }));
    check('① 12 条内联 SVG（不含 crop/fullscreen 那 3 条）', uris.length === 12, `实得 ${uris.length} 条`);

    const externals = [];
    for (const { uri } of uris) {
        // 去掉 xmlns（唯一允许出现 http 的地方）后不许再有 http/https 或外链元素
        const stripped = uri.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, '');
        if (/https?:\/\//.test(stripped) || /<image|xlink:href|<use/.test(stripped)) { externals.push(uri.slice(0, 60)); }
    }
    check('② 一律内联、零外链（http 只出现在 xmlns 声明里）', externals.length === 0, externals.join(' | '));

    // 只看**没解码的**原文：里面有裸 < > # " 就会让 CSS 的 data URI 断在奇怪的地方；
    // 允许的转义只有 %3C / %3E / %23（解码后当然会出现 < > #，那是正常的 SVG 本体）
    const badEsc = uris.filter(({ uri }) => {
        const body = uri.replace(/^data:image\/svg\+xml,/, '');
        return /%(?!(3C|3E|23))/.test(body) || /[<>#"]/.test(body);
    });
    check('③ 转义只用 %3C / %3E / %23，未解码原文里没有裸 < > # "', badEsc.length === 0,
        badEsc.length ? `${badEsc.length} 条有问题` : '12 条干净');

    const dom = new JSDOM('');
    const DP = dom.window.DOMParser;
    const parseFails = [], nonAscii = [], tiny = [], outside = [];
    for (const { body } of uris) {
        const svg = decodeURIComponent(body);
        if (/[^\x00-\x7F]/.test(svg)) { nonAscii.push(svg.slice(0, 50)); }
        const doc = new DP().parseFromString(svg, 'image/svg+xml');
        if (doc.querySelector('parsererror')) { parseFails.push(svg.slice(0, 60)); continue; }
        if (doc.documentElement.getAttribute('viewBox') !== '0 0 24 24') { outside.push('viewBox=' + doc.documentElement.getAttribute('viewBox')); }
        // 几何：把 path 里的数字当坐标采样，取范围的保守近似（弧的参数也一并算进去，只会更宽松）
        const nums = [...svg.matchAll(/d='([^']*)'/g)].flatMap((m) => [...m[1].matchAll(/-?\d+(?:\.\d+)?/g)].map((x) => parseFloat(x[0])));
        const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
        const lo = Math.min(...nums), hi = Math.max(...nums);
        const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
        if (lo < 0 || hi > 24) { outside.push(`坐标 ${lo}..${hi} 越出 0..24`); }
        if (Math.max(spanX, spanY) < 6) { tiny.push(`${svg.match(/'([^']*)'/)}`); }
    }
    check('④ 12 个 data URI 全部能被 XML 解析（jsdom DOMParser 第二意见）', parseFails.length === 0, parseFails.length ? parseFails.join(' | ') : '12/12');
    check('⑤ 规则本体纯 ASCII（不留中文/控制字符）', nonAscii.length === 0, nonAscii.join(' | '));
    check('⑥ viewBox 一律 0 0 24 24 且字形坐标落在盒内', outside.length === 0, outside.join(' | '));
    check('⑦ 没有"小到看不出"的字形（最长边 ≥ 6 单位）', tiny.length === 0, tiny.join(' | '));
}

console.log('\n[3] 旧图标同步 + 不动库文件');
{
    const cropRule = /li\.viewer-crop:before \{[\s\S]{0,900}?background-position: 2px 2px;[\s\S]{0,200}?background-size: 16px 16px;/.test(blade);
    const fsRule = /li\.viewer-fullscreen:before \{[\s\S]{0,1200}?background-size: 16px 16px;/.test(blade);
    check('① 已有的「裁剪」「全屏」两条也统一到 16px/2px（全排按钮一致）', cropRule && fsRule);
    check('② 全屏态那条仍只换图、不重复声明盒子/位置',
        /li\.viewer-fullscreen\.is-fs:before \{\s*\n\s*background-image: url\("data:image\/svg\+xml,[^"]*"\);\s*\n\s*\}/.test(blade));
    const libCss = read('public', 'css', 'viewer-js', 'viewer.min.css');
    check('③ 没有去改压缩产物：库的雪碧图规则仍在 viewer.min.css 里',
        /\.viewer-zoom-in:before\{background-position:0 0/.test(libCss) && /data:image\/png;base64,/.test(libCss));

    // ④ 结构守卫：整个 <style> 块里普通规则之间**不许嵌套**（@media/@supports 这种 at 规则除外）
    //    —— 这条是踩过坑加的：把新规则插到上一条规则的右花括号**之前**，就会整体嵌进那条规则里，
    //    而 LESS 容忍嵌套、lessc 一声不吭地编过，只有真浏览器才会把内层规则整片丢掉。
    const styleStart = blade.lastIndexOf('<style', blade.indexOf('li.viewer-crop:before'));
    const styleBlock = blade.slice(blade.indexOf('>', styleStart) + 1, blade.indexOf('</style>', styleStart));
    const nestProblems = [];
    {
        const stack = [];
        let buf = '';
        for (const ch of styleBlock) {
            if (ch === '{') {
                const opener = buf.trim().split('\n').pop().trim();
                if (stack.length && ! stack[stack.length - 1].startsWith('@')) {
                    nestProblems.push(`${stack[stack.length - 1].slice(0, 40)} ⊃ ${opener.slice(0, 40)}`);
                }
                stack.push(opener);
                buf = '';
            } else if (ch === '}') {
                if (stack.length) { stack.pop(); } else { nestProblems.push('多余的右花括号'); }
                buf = '';
            } else { buf += ch; }
        }
        if (stack.length) { nestProblems.push(`有 ${stack.length} 个块没闭合`); }
    }
    check('④ 样式块里普通规则零嵌套、花括号配平（插错位置会被这条抓住）',
        nestProblems.length === 0 && styleBlock.split('{').length === styleBlock.split('}').length,
        nestProblems.length ? nestProblems.join('；') : `${styleBlock.split('{').length - 1} 个块全部闭合`);
}


console.log('\n[4] 全屏右上角关闭键的几何（手机物理圆角不切 × 的数学约束）');
{
    // 现场解析真值：不留硬编码副本（改错了断言就跟着算出来打脸）
    const ruleBody = (sel) => {
        const i = blade.indexOf(sel);
        if (i < 0) { return ''; }
        return blade.slice(blade.indexOf('{', i) + 1, blade.indexOf('}', i));
    };
    const num = (body, prop) => {
        const m = new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(body);
        return m ? parseFloat(m[1]) : NaN;
    };
    // 注意：`html.ls-viewer-fs .viewer-button` 这个选择器现在有**两条**规则（先是最早那三条
    // opacity/visibility 收起规则，后是本块的几何规则）⇒ 要挑「带 width」的那条，不能取第一条。
    const fsBtn = [...blade.matchAll(/html\.ls-viewer-fs \.viewer-button \{([^}]*)\}/g)]
        .map((m) => m[1]).find((b) => /width\s*:/.test(b)) || '';
    const fsIcon = ruleBody('html.ls-viewer-fs .viewer-button:before {');
    const iconRule = ruleBody('html .viewer-button[data-viewer-action="mix"]:before {');
    // 全屏专用的「× 放大」覆盖：挂第二个类把权重提到 (0,3,1)（见下面 ⑧ 的算法断言）
    const fsBigRule = ruleBody('html.ls-viewer-fs .viewer-button[data-viewer-action="mix"]:before {');

    const W = num(fsBtn, 'width'), H = num(fsBtn, 'height');
    const right = num(fsBtn, 'right'), top = num(fsBtn, 'top');
    const insetBottom = num(fsIcon, 'bottom'), insetLeft = num(fsIcon, 'left');
    // 全屏态真正的盒子/字形 = 覆盖值优先（覆盖把 width/height/background-size 都写在全屏作用域里）
    const boxFs = num(fsBigRule, 'width') || num(iconRule, 'width');
    const bgPos = num(fsBigRule, 'background-position') || num(iconRule, 'background-position');
    const bgSize = num(fsBigRule, 'background-size') || num(iconRule, 'background-size');
    const R = W / 2;                                   // 可见四分之一圆的半径
    const glyphNear = R - (insetLeft + bgPos + bgSize); // × 靠角那一侧：距右边/上边多少 px
    const glyphFar = R - (insetLeft + bgPos);           // × 外角那一侧
    const rimGap = R - glyphFar * Math.SQRT2;           // × 外角离那圈黑底边缘还有多少余量
    const boxNear = R - (insetLeft + boxFs);             // 图标盒最靠角那条边距屏幕右/上边多少 px

    check('① 解析到全屏那两条规则与图标盒（未手抄）',
        W > 0 && H > 0 && insetLeft > 0 && bgPos > 0 && bgSize > 0,
        `按钮 ${W}×${H} right/top ${right}/${top}，图标 inset ${insetLeft}/${insetBottom}，盒内字形 ${bgPos}+${bgSize}`);
    check('② 圆心仍正好压在屏幕角上（宽 = 2×偏移；否则可见的就不是四分之一圆了）',
        W === 2 * Math.abs(right) && H === 2 * Math.abs(top), `${W} vs ${2 * Math.abs(right)} / ${H} vs ${2 * Math.abs(top)}`);
    check('③ × 靠角那一侧距右边/上边 ≥ 10px —— 物理圆角半径 30px 也切不到',
        glyphNear >= 10, `实际 ${glyphNear}px（旧库值 7px，这就是被切的原因）`);
    check('④ × 的外角仍落在那圈黑底里，且留 ≥ 4px 余量（否则会戳出黑圆、露在照片上）',
        glyphFar * Math.SQRT2 <= R && rimGap >= 4,
        `外角半径 ${(glyphFar * Math.SQRT2).toFixed(1)} ≤ 圆半径 ${R}，余量 ${rimGap.toFixed(1)}px`);
    check('⑤ 只改尺寸/位置，不动库画的那个圆的形状（不碰 position / border-radius / overflow）',
        ! /(position|border-radius|overflow)\s*:/.test(fsBtn));
    check('⑥ 非全屏不动：页面里对 .viewer-button 几何的覆盖全部只在 html.ls-viewer-fs 作用域内',
        ! /(^|\n)\s*(html\s+)?\.viewer-button\s*\{\s*\n\s*(width|height|right|top):/m.test(blade));
    check('⑦ 图标盒的外角必须仍落在那圈黑底里（否则 × 会戳出黑圆、露在照片上）',
        boxNear * Math.SQRT2 <= R, `盒外角 ${(boxNear * Math.SQRT2).toFixed(1)} ≤ 圆半径 ${R}`);
    check('⑧ × 只在全屏放大：共享规则仍是 20×20/16px，全屏覆盖 22×22/18px（窗口模式库原样不动）',
        num(iconRule, 'width') === 20 && num(iconRule, 'height') === 20
        && num(iconRule, 'background-size') === 16 && num(iconRule, 'background-position') === 2
        && boxFs === 22 && num(fsBigRule, 'height') === 22 && bgSize === 18 && bgPos === 2,
        `共享 ${num(iconRule, 'width')}×${num(iconRule, 'height')}/${num(iconRule, 'background-size')}px`
        + ` → 全屏 ${boxFs}×${num(fsBigRule, 'height')}/${bgSize}px`);
    // 权重必须**算**出来，不能靠文件顺序：共享图标规则的 (0,2,1) 与全屏那条 (0,2,1) 相等，
    // 而共享规则在文件里更靠后 ⇒ 不挂第二个类的话，靠顺序压不住（改错就红）。
    const specOf = (sel) => {
        const m = sel.replace(/:before/g, '');                       // 伪元素不记权重
        const ids = (m.match(/#[\w-]+/g) || []).length;
        const cls = (m.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
        const el = (m.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?!\()/g, ' ')
            .match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
        return ids * 10000 + cls * 100 + el;
    };
    const sharedSel = 'html .viewer-button[data-viewer-action="mix"]';
    const fsSel = 'html.ls-viewer-fs .viewer-button[data-viewer-action="mix"]';
    check('⑨ 「× 放大」那条的权重必须严格大于共享图标规则（挂第二个类 ⇒ 3 类 vs 2 类）',
        specOf(fsSel) > specOf(sharedSel)
        && blade.includes(fsSel + ':before {')
        && blade.includes('html.ls-viewer-fs .viewer-button.viewer-close:before,'),
        `全屏 ${specOf(fsSel)} > 共享 ${specOf(sharedSel)}（简化为 ids*10000+cls*100+el）`);
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => ! r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
