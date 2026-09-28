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

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
