#!/usr/bin/env node
/**
 * 上传拖拽区的按压高亮：安卓 Chrome 上点内层按钮时，外层虚线框不许闪蓝（读文件断言，不跑浏览器）。
 *
 * 背景：安卓 Chrome 把按压高亮（tap highlight）画在「最近的带 click 处理器的祖先元素」上 ——
 * 上传页那个虚线大框 #picker-dnd 的 onclick 就是触发 #picker 的处理器，所以点「选择文件」
 * 「上传全部」时，整块拖拽区会跟着闪一下蓝。修法只有一条 CSS：在该区块内把
 * -webkit-tap-highlight-color 置为 transparent。
 *
 * 硬约束（改这条规则时一起守）：
 *   ① 源码（resources/css/app.css）与构建产物（public/css/app.css）必须**同时**有这条规则，
 *      否则改源码的人看不到效果、只改产物的人一构建就丢；
 *   ② 作用域只在 #picker-dnd 内部，不许出现全局（*、html、body、:root）的 tap-highlight 关断，
 *      也不许顺手写 pointer-events / cursor / display —— 那会改掉点击与拖拽行为；
 *   ③ 模板回归护栏：#picker-dnd 的 onclick、隐藏的 file input、两个按钮都必须原样在。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(srcRoot, ...p), 'utf8');

let pass = 0;
let fail = 0;
const assert = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? '  → ' + detail : ''}`); }
};
const section = (name) => console.log(`\n[${name}]`);

const SOURCE = read('resources', 'css', 'app.css');
const BUILT = read('public', 'css', 'app.css');
const BLADE = read('resources', 'views', 'components', 'upload.blade.php');

// 取「含 -webkit-tap-highlight-color 的那条规则块」（两个文件写法不同：一个跨行、一个单行压缩，
// 但都不含嵌套花括号）。先剥注释，才能把选择器部分截干净 —— 规则上方就是解释性注释。
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = (css) => {
    const c = stripComments(css);
    const i = c.indexOf('-webkit-tap-highlight-color');
    if (i < 0) return '';
    const open = c.lastIndexOf('{', i);
    const close = c.indexOf('}', i);
    if (open < 0 || close < 0) return '';
    const start = Math.max(c.lastIndexOf('}', open), 0); // 上一条规则结尾
    return c.slice(start + 1, close + 1);
};

section('源码 resources/css/app.css');
{
    const rule = ruleOf(SOURCE);
    assert(/-webkit-tap-highlight-color:\s*transparent/.test(rule),
        '-webkit-tap-highlight-color: transparent 在（源码）', rule.slice(0, 80).replace(/\n/g, ' '));
    assert(/#picker-dnd #upload-container/.test(rule) && /#picker-dnd #upload-container \*/.test(rule),
        '选择器覆盖拖拽框本身 + 内层容器 + 容器内所有元素', rule.split('{')[0].trim().replace(/\s+/g, ' '));
    assert((SOURCE.match(/webkit-tap-highlight-color/g) || []).length === 1,
        '整个 app.css 里只此一处（没波及别的页面）',
        `count=${(SOURCE.match(/webkit-tap-highlight-color/g) || []).length}`);
}

section('构建产物 public/css/app.css（没有 node_modules，规则是手工追加的等价压缩形态）');
{
    const rule = ruleOf(BUILT);
    assert(/-webkit-tap-highlight-color:\s*transparent/.test(rule),
        '-webkit-tap-highlight-color:transparent 在（产物）', rule.slice(0, 80).replace(/\n/g, ' '));
    assert(/#picker-dnd #upload-container/.test(rule) && /#picker-dnd #upload-container \*/.test(rule),
        '产物里的选择器与源码等价（含内层容器及其子元素）', rule.split('{')[0].trim());
    assert(BUILT.trimEnd().endsWith('}'),
        '追加内容没有截断/破坏压缩文件（仍以规则块收尾）');
    assert((BUILT.match(/webkit-tap-highlight-color/g) || []).length === 1,
        '产物里同样只有这一处',
        `count=${(BUILT.match(/webkit-tap-highlight-color/g) || []).length}`);
    // 追加段的形态：一个闭合注释 + 一条完整规则（注释若没闭合，选择器就被吞掉、部署后不生效）
    const tail = BUILT.slice(BUILT.lastIndexOf('/*'));
    assert(/^\/\*[\s\S]*?\*\/#picker-dnd,#picker-dnd #upload-container,#picker-dnd #upload-container \*\{-webkit-tap-highlight-color:transparent\}/.test(tail),
        '追加段是「闭合注释 + 完整规则」（没被注释吞掉）', tail.slice(0, 70));
}

section('作用域与「只改高亮」的边界');
{
    for (const [tag, css] of [['源码', SOURCE], ['产物', BUILT]]) {
        const rule = ruleOf(css);
        const decl = rule.slice(rule.indexOf('{'));
        assert(!/pointer-events/.test(decl), `${tag}：规则里没有 pointer-events（点击不会被穿透/吞掉）`);
        assert(!/(^|[;{\s])cursor\s*:/.test(decl), `${tag}：规则没动 cursor`);
        assert(!/(^|[;{\s])display\s*:/.test(decl), `${tag}：规则没动 display`);
        const selectors = rule.slice(0, rule.indexOf('{')).split(',').map((s) => s.trim()).filter(Boolean);
        assert(selectors.length > 0 && selectors.every((s) => s.startsWith('#picker-dnd')),
            `${tag}：每个选择器都锚在 #picker-dnd 上（作用域不外溢）`, selectors.join(' | ').slice(0, 100));
        assert(!/(^|,)\s*(\*|html|body|:root)\b[^{]*\{[^{}]*-webkit-tap-highlight-color/.test(css),
            `${tag}：没有全局关断 tap highlight 的规则`);
    }
}

section('模板回归护栏（upload.blade.php 一个字没动）');
{
    assert(/id="picker-dnd" onclick="\$\('#picker'\)\.click\(\)"/.test(BLADE)
        || /onclick="\$\('#picker'\)\.click\(\)"[^>]*id="picker-dnd"/.test(BLADE),
        '点大框仍会触发 #picker（onclick 原样）',
        (BLADE.match(/<div[^>]*id="picker-dnd"[^>]*>/) || ['未找到'])[0].slice(0, 120));
    assert(/<input type="file" id="picker"[^>]*class="hidden"/.test(BLADE),
        '隐藏的 file input（id="picker"）仍在');
    assert(/id="upload-all"/.test(BLADE), '「上传全部」按钮（id="upload-all"）仍在');
    assert(/选择文件/.test(BLADE), '「选择文件」按钮仍在');
    assert(/id="upload-container"/.test(BLADE), '内层 #upload-container 仍在（选择器对得上）');
}

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
