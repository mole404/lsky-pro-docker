/*
 * 侧栏 store 的行为测试（jsdom）
 *
 * 用途：折叠状态有三个必须成立的契约，错了就是"刷新后抖一下"或"手机上侧栏没了"：
 *   1. 首屏脚本的契约：localStorage 里存着 collapsed 时，模块加载就要把类贴到 <html> 上
 *   2. 折叠 = 加/去 <html class="sidebar-collapsed"> + 写 localStorage + 派发 lsky:sidebar-toggled
 *   3. 手机端（<640px）点同一个按钮只能开关抽屉，绝不能把桌面折叠状态改掉
 *
 * 运行：npm test（或 node sidebar.test.mjs）
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const STORE = path.join(here, '..', 'src', 'resources', 'js', 'stores', 'sidebar.js');

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};

// 每个场景一个全新的模块实例（import 加 query 破缓存）+ 全新的 jsdom
let seq = 0;
async function boot({ stored = null, wide = true } = {}) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://lsky.test/' });
    dom.window.matchMedia = (query) => ({
        matches: wide && query.includes('640px'),
        media: query,
        addEventListener() {}, removeEventListener() {},
    });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = dom.window.localStorage;
    globalThis.CustomEvent = dom.window.CustomEvent;

    if (stored !== null) {
        dom.window.localStorage.setItem('lsky-sidebar', stored);
    }

    const events = [];
    dom.window.addEventListener('lsky:sidebar-toggled', (e) => events.push(e.detail));

    const mod = await import(`${new URL('file://' + STORE).href}?v=${++seq}`);
    return { store: mod.default, dom, events };
}

const hasClass = (dom) => dom.window.document.documentElement.classList.contains('sidebar-collapsed');

// 1. 默认：没存过 → 展开，不加类
{
    const { store, dom } = await boot();
    check('默认展开：collapsed=false 且 <html> 没有折叠类', store.collapsed === false && ! hasClass(dom),
        `collapsed=${store.collapsed} class=${hasClass(dom)}`);
}

// 2. 首屏契约：存了 collapsed → 模块加载即贴类（app.blade.php 首屏脚本之外的第二道保险）
{
    const { store, dom } = await boot({ stored: 'collapsed' });
    check('存过 collapsed：加载即 collapsed=true 且类已贴上', store.collapsed === true && hasClass(dom),
        `collapsed=${store.collapsed} class=${hasClass(dom)}`);
}

// 3. 折叠：加类 + 写存储 + 派发事件
{
    const { store, dom, events } = await boot();
    store.toggleCollapsed();
    check('折叠：加类、写 localStorage、派发事件',
        hasClass(dom)
        && dom.window.localStorage.getItem('lsky-sidebar') === 'collapsed'
        && events.length === 1 && events[0].collapsed === true,
        `class=${hasClass(dom)} stored=${dom.window.localStorage.getItem('lsky-sidebar')} events=${JSON.stringify(events)}`);
}

// 4. 再点一次：还原
{
    const { store, dom } = await boot({ stored: 'collapsed' });
    store.toggleCollapsed();
    check('展开：去类、存储改为 expanded',
        ! hasClass(dom) && dom.window.localStorage.getItem('lsky-sidebar') === 'expanded',
        `class=${hasClass(dom)} stored=${dom.window.localStorage.getItem('lsky-sidebar')}`);
}

// 5. 手机端（<640px）：按钮走抽屉，不能碰桌面折叠状态 —— 这是最容易被写错的一条
{
    const { store, dom, events } = await boot({ wide: false });
    store.toggleSmart();
    check('手机端点按钮：只开抽屉，不动折叠状态',
        store.open === true && store.collapsed === false && ! hasClass(dom) && events.length === 0,
        `open=${store.open} collapsed=${store.collapsed} class=${hasClass(dom)}`);
}

// 6. 桌面端（>=640px）：同一个按钮走折叠
{
    const { store } = await boot({ wide: true });
    store.toggleSmart();
    check('桌面端点按钮：走折叠（open 不受影响）',
        store.collapsed === true && store.open === false,
        `collapsed=${store.collapsed} open=${store.open}`);
}

// ---------------------------------------------------------------- 抽屉遮罩的点击契约（读文件断言）
/*
 * 为什么钉这条：手机端关抽屉只该有两个入口 —— 遮罩自己的 @click、侧栏里那个 × 按钮。
 * 另外两个「看起来能用」的做法都会让手机端误关：
 *   · 在遮罩上挂 @click.outside —— 遮罩是 fixed inset-0、盖住除侧栏以外整屏，而侧栏
 *     <nav id="app-sidebar">（z-10）是它的**兄弟节点**、不在它的子树里；Alpine 的 .outside
 *     语义是「点击目标不在本元素内就执行表达式」，于是点侧栏**内部**的空白也被算成点了外侧
 *     → 随手点一下侧栏空白，抽屉就没了。（桌面端复现不了：遮罩 sm:hidden，x-show 为假时
 *     Alpine 会跳过该处理器。）
 *   · 在侧栏容器上挂 @click.self / @click.outside —— 同理，点侧栏自身即触发。
 *
 * 为什么这里只做「读文件断言」而不上 jsdom 行为测试：Alpine 的 .outside 处理器自带
 * 「元素零尺寸就不执行」的守卫（offsetWidth < 1 && offsetHeight < 1 → return），而 jsdom 里
 * 所有元素的 offsetWidth/offsetHeight 恒为 0 —— 这个 bug 在 jsdom 里**根本复现不出来**，
 * 行为测试会两边都绿（假绿）。真机/真浏览器才是终判，这里钉住结构契约防回归。
 */
{
    const LAYOUTS = path.join(here, '..', 'src', 'resources', 'views', 'layouts');
    const appBlade = fs.readFileSync(path.join(LAYOUTS, 'app.blade.php'), 'utf8');
    const sidebarBlade = fs.readFileSync(path.join(LAYOUTS, 'sidebar.blade.php'), 'utf8');

    const at = appBlade.indexOf('x-show="$store.sidebar.open"');
    check('找得到遮罩元素（x-show="$store.sidebar.open"）', at !== -1, `index=${at}`);
    const tagStart = at === -1 ? -1 : appBlade.lastIndexOf('<div', at);
    const tag = at === -1 ? '' : appBlade.slice(tagStart, appBlade.indexOf('>', at) + 1);

    check('遮罩上没有 @click.outside（有它 → 点侧栏内部空白也会关抽屉）',
        ! /@click\.outside/.test(tag), tag.replace(/\s+/g, ' ').slice(0, 90) + ' …');
    check('遮罩自己带 @click（点遮罩仍能关抽屉）', /@click=/.test(tag));
    check('侧栏是遮罩的兄弟节点（不在遮罩子树里，所以「点侧栏内部」≠「点外侧」）',
        appBlade.indexOf("@include('layouts.sidebar')") < tagStart
        && ! tag.includes('app-sidebar')
        && sidebarBlade.includes('id="app-sidebar"'));
    check('侧栏里只有右上角 × 会关抽屉（别处不许直接改 store）',
        (sidebarBlade.match(/\$store\.sidebar\.open\s*=\s*false/g) || []).length === 1,
        String((sidebarBlade.match(/\$store\.sidebar\.open\s*=\s*false/g) || []).length));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
