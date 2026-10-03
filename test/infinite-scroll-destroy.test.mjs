/*
 * utils.infiniteScroll 的 destroy() 回归测试（jsdom + 真实 jQuery）
 *
 * 背景：同一页面上有两个无限加载实例 —— 图片墙（{root:'window'}，跟整页滚动）与
 * 相册弹窗列表（默认，跟容器自己的滚动）。老的 destroy() 里 `$(window).off('scroll.infiniteScroll')`
 * 是无条件执行的：只要相册弹窗开一次再关掉（closeAlbums() → albumsInfinite.destroy()），
 * 挂在 window 上的图片墙监听就被顺手解绑 → 「我的图片」页滚到底不再自动加载，
 * 必须手动点列表底部那行哨兵文字。这个文件把「谁注册谁解绑」这条钉住。
 *
 * 做法：把 app.js 里的 infiniteScroll 方法原样抽出来（花括号配对，不是抄一份），
 * 塞进 jsdom + 真实 jQuery 里跑，其余依赖（axios）打桩 —— 与 images-modal-dom.test.mjs
 * 同一套路（读源码 → 在 jsdom 里 eval → 驱动真实代码路径）。
 *
 * 运行：
 *   node infinite-scroll-destroy.test.mjs [要测的 app.js 路径]
 * 传路径时测的是那份文件（用来验证「改前会失败」，默认测仓库里这份）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
const APP_JS = process.argv[2] || path.join(here, '..', 'src', 'resources', 'js', 'app.js');
const APP_SRC = fs.readFileSync(APP_JS, 'utf8');

// 把 `infiniteScroll(selector, options) { … }` 的函数体（含外层花括号）从源码里切出来：
// 花括号配对，跳过字符串/模板串/注释，避免 ${…} 之类的干扰。
function extractMethodBody(src, signature) {
    const start = src.indexOf(signature);
    if (start < 0) throw new Error(`app.js 里找不到 ${signature}`);
    let depth = 0;
    let quote = null;
    let i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === '\\') { i++; continue; }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) throw new Error('花括号没配平：抽 infiniteScroll 的函数体失败');
    return src.slice(src.indexOf('{', start), i + 1);
}

const METHOD_BODY = extractMethodBody(APP_SRC, 'infiniteScroll(selector, options)');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

// app.js 是 ESM（顶部 import Alpine 之类），不能在 jsdom 里整份跑；只把 infiniteScroll
// 这一段装进 window.utils，函数体里引用的 $ / axios / toastr 由 jsdom 全局提供。
function boot() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="images-scroll"><div id="images-grid"></div></div>
        <div id="album-switch-scroll"><div id="albums-container"></div></div>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    window.eval(JQUERY_SRC);
    const $ = window.jQuery;

    const calls = { gets: [] };
    window.axios = {
        // params 拷一份：opts.data 是同一个对象的引用（page 会被实现自己 ++），不拷会看到改后的值
        get: (url, config) => { calls.gets.push({ url, params: config && { ...config.params } }); return Promise.resolve({ data: {} }); },
    };

    window.eval(`window.utils = { infiniteScroll(selector, options) ${METHOD_BODY} };`);

    const scrollEvents = (el) => ($._data(el, 'events') || {}).scroll || [];
    const fireScroll = (el) => { el.dispatchEvent(new window.Event('scroll')); };

    return { window, $, calls, scrollEvents, fireScroll };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 前置自检
// 抽出来的那段必须真的是仓库里这份 app.js 的实现（别哪天被换成手抄的假货）
{
    check('抽到的 infiniteScroll 就是 app.js 里那份（含 useWindowScroll 与两个分支）',
        METHOD_BODY.includes("const useWindowScroll = options.root === 'window';")
        && METHOD_BODY.includes("$(window).on('scroll.infiniteScroll', onScroll)")
        && METHOD_BODY.includes("$(selector).on('scroll.infiniteScroll', onScroll)")
        // fork：这两条改成链式绑定了（后面多挂了一层 .on(ARM_EVENTS, arm)，见下方"重排后临时锁"），
        // 所以断言不再要求以分号结尾，只要求确实绑在那个命名空间上。
        && METHOD_BODY.includes('ARM_EVENTS'),
        `${APP_JS}`);
}

// ---------------------------------------------------------------- 两种实例各挂在哪
{
    const { window, $, calls, scrollEvents, fireScroll } = boot();

    const wall = window.utils.infiniteScroll('#images-grid', { root: 'window', url: '/wall' });
    const album = window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
    // 建实例时会立刻拉第一页；等它落地（props.loading 复位），后面的「滚动触发」才作数
    await sleep(0);

    check('window 版（图片墙，root:\'window\'）把监听挂在 window 上',
        scrollEvents(window).some((h) => h.namespace === 'infiniteScroll'),
        `window scroll 监听 ${scrollEvents(window).length} 条`);
    check('容器版（相册弹窗列表）的监听挂在自己身上，window 上没有多挂',
        scrollEvents(window).length === 1
        && scrollEvents($('#album-switch-scroll').get(0)).some((h) => h.namespace === 'infiniteScroll'),
        `window=${scrollEvents(window).length} container=${scrollEvents($('#album-switch-scroll').get(0)).length}`);

    // 两个实例各在建的时候立刻拉了一次第一页
    const afterCreate = calls.gets.length;
    check('两个实例各自都先拉了第一页（各 1 个请求）', afterCreate === 2, JSON.stringify(calls.gets));

    await sleep(0);
    fireScroll(window);
    check('window 版：整页滚到底触发加载', calls.gets.length === afterCreate + 1,
        `gets=${calls.gets.length}（期望 ${afterCreate + 1}）`);
}

// ---------------------------------------------------------------- 核心回归
console.log('\n[回归] 销毁容器版实例不能连带解绑 window 版（相册弹窗开→关之后图片墙还能自动加载）');
{
    const { window, $, calls, scrollEvents, fireScroll } = boot();

    const wall = window.utils.infiniteScroll('#images-grid', { root: 'window', url: '/wall' });
    const album = window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
    await sleep(0);   // 等首屏那次请求落地（否则 props.loading 还是 true，滚动不会触发）

    const before = calls.gets.length;
    album.destroy();   // ← 相册弹窗关闭时走的就是这一步（closeAlbums() → albumsInfinite.destroy()）

    check('销毁容器版后：window 上的 scroll.infiniteScroll 监听仍在（没被顺手 off 掉）',
        scrollEvents(window).some((h) => h.namespace === 'infiniteScroll'),
        `window scroll 监听 ${scrollEvents(window).length} 条`);

    fireScroll(window);
    check('销毁容器版后：整页滚到底仍然会自动加载（图片墙没死）',
        calls.gets.length === before + 1, `gets=${calls.gets.length}（期望 ${before + 1}）`);

    check('销毁容器版后：它自己的 selector 仍被解绑（滚容器不再触发它）',
        ! scrollEvents($('#album-switch-scroll').get(0)).some((h) => h.namespace === 'infiniteScroll'));
    const afterContainerScroll = calls.gets.length;
    fireScroll($('#album-switch-scroll').get(0));
    check('销毁容器版后：滚它自己的容器不再发请求',
        calls.gets.length === afterContainerScroll, `gets=${calls.gets.length}`);
}

// ---------------------------------------------------------------- 反向：销毁 window 版
console.log('\n[反向] 销毁 window 版时确实解绑 window（别改成谁都不解）');
{
    const { window, $, calls, scrollEvents, fireScroll } = boot();

    const wall = window.utils.infiniteScroll('#images-grid', { root: 'window', url: '/wall' });
    const album = window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
    await sleep(0);

    wall.destroy();

    check('销毁 window 版：window 上的 scroll.infiniteScroll 被解绑',
        scrollEvents(window).length === 0, JSON.stringify(scrollEvents(window).map((h) => h.namespace)));

    const before = calls.gets.length;
    fireScroll(window);
    check('销毁 window 版：整页滚动不再触发它加载（不多发请求）',
        calls.gets.length === before, `gets=${calls.gets.length}（期望 ${before}）`);

    fireScroll($('#album-switch-scroll').get(0));
    check('销毁 window 版：容器版实例不受影响（滚容器照常加载）',
        calls.gets.length === before + 1, `gets=${calls.gets.length}（期望 ${before + 1}）`);
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
