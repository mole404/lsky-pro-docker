/*
 * utils.infiniteScroll「整页滚到底就自动加载」的回归测试（jsdom + 真实 jQuery）
 *
 * 真机现象（手机端「我的图片」页，安卓/Edge）：图片墙走 {root:'window'} 的整页滚动，
 * 滑到最底部第一次不自动加载更多，要再往下拖一下才加载。桌面端正常。
 *
 * 根因：老判断是 `scrollTop + innerHeight >= document.height() - offset`。移动浏览器的
 * 「可滚动高度」是按地址栏收起后的大视口算的，而 innerHeight 报的是地址栏可见时的小视口，
 * 两者差 50~60px > offset 默认那 30px 余量 —— 真滑到底那一发条件仍不成立，得再拖一下让
 * 地址栏收起、innerHeight 变大，条件才刚好成立。
 *
 * 本文件用桩几何精确复刻这个不一致（数字见下面的 stubWallGeometry）：
 *   地址栏可见时的小视口（innerHeight / documentElement.clientHeight） = 700
 *   地址栏收起后的大视口                                              = 760
 *   可滚动高度（documentElement.scrollHeight / $(document).height()）  = 1000
 *   → 大视口下真的滑到底：scrollY = 1000 - 760 = 240
 *   → 老公式：240 + 700 = 940 < 1000 - 30 = 970 ⇒ **到底了却不加载**（红线）
 *   → 新判断：哨兵 getBoundingClientRect().top = 660 <= innerHeight(700) + offset(30) ⇒ 加载
 *
 * 做法沿用 infinite-scroll-destroy.test.mjs：把 app.js 里的 infiniteScroll 方法原样抽出来
 * （花括号配对，不是手抄一份），塞进 jsdom + 真实 jQuery 里跑，axios 打桩记账。
 *
 * 运行：
 *   node infinite-scroll-bottom-mobile.test.mjs [要测的 app.js 路径]
 * 传路径时测的是那份文件（用来验证「改前会失败，失败原因正是『到底了但没触发』」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
const APP_JS = process.argv[2] || path.join(here, '..', 'src', 'resources', 'js', 'app.js');
const APP_SRC = fs.readFileSync(APP_JS, 'utf8');

// 与 infinite-scroll-destroy.test.mjs 同一个抽取器：`infiniteScroll(selector, options) { … }`
// 的函数体（含外层花括号），花括号配对、跳过字符串/模板串/注释。
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 安卓那套「大小视口不一致」的几何桩。jsdom 没有排版引擎，所有几何量本来都是 0，
// 所以只能显式桩；桩完下面会先自检一遍「老公式在这一发确实不成立」，防止桩没生效
// 导致 RED 是假的。
function stubWallGeometry(window) {
    const doc = window.document;
    const define = (obj, prop, value) =>
        Object.defineProperty(obj, prop, { value, configurable: true, writable: true });

    define(window, 'innerHeight', 700);   // 地址栏可见时的小视口（浏览器回报的值）
    define(window, 'innerWidth', 390);
    define(window, 'pageYOffset', 240);   // 大视口(760)下真的滑到底：1000 - 760
    define(window, 'scrollY', 240);

    define(doc.documentElement, 'clientHeight', 700);   // $(window).height() 读的就是它
    define(doc.documentElement, 'scrollHeight', 1000);  // 可滚动高度按大视口算
    define(doc.documentElement, 'offsetHeight', 700);
    define(doc.body, 'scrollHeight', 1000);
    define(doc.body, 'offsetHeight', 700);
    define(doc.body, 'clientHeight', 700);
}

// jsdom 里 getBoundingClientRect 恒为 0，哨兵位置同样只能桩。
function stubSentinelTop(el, top) {
    el.getBoundingClientRect = () => ({
        top, bottom: top + 40, left: 0, right: 390, width: 390, height: 40, x: 0, y: top,
    });
}

function boot({ wallGeometry = true } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="images-scroll"><div id="images-grid"></div></div>
        <div id="album-switch-scroll"><div id="albums-container"></div></div>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    if (wallGeometry) stubWallGeometry(window);

    window.eval(JQUERY_SRC);
    const $ = window.jQuery;

    const calls = { gets: [] };
    window.axios = {
        get: (url, config) => {
            calls.gets.push({ url, params: config && { ...config.params } });
            return Promise.resolve({ data: {} });
        },
    };

    window.eval(`window.utils = { infiniteScroll(selector, options) ${METHOD_BODY} };`);

    const fireScroll = (el) => el.dispatchEvent(new window.Event('scroll'));

    return { window, $, calls, fireScroll };
}

// ---------------------------------------------------------------- 前置自检
// 抽出来的那段必须真的是仓库里这份 app.js 的实现，不能是手抄的假货。
{
    check('抽到的 infiniteScroll 就是 app.js 里那份（含 useWindowScroll 与两个分支）',
        METHOD_BODY.includes("const useWindowScroll = options.root === 'window';")
        && METHOD_BODY.includes("$(window).on('scroll.infiniteScroll', onScroll);")
        && METHOD_BODY.includes("$(selector).on('scroll.infiniteScroll', onScroll);"),
        `${APP_JS}`);
    check('window 分支改用哨兵相对可视视口的位置（getBoundingClientRect().top <= innerHeight + offset）',
        METHOD_BODY.includes("$(selector).find('.infinite-scroll').last()")
        && METHOD_BODY.includes('getBoundingClientRect().top <= window.innerHeight + offset'));
    check('容器滚动分支原封不动（this.scrollTop + $(selector).height() >= this.scrollHeight - offset）',
        METHOD_BODY.includes('if (this.scrollTop + $(selector).height() >= this.scrollHeight - offset) {'));
    check('找不到哨兵时退回老公式（别把自己搞死），offset 默认值仍为 30',
        METHOD_BODY.includes('$(document).height() - offset')
        && METHOD_BODY.includes('let offset = options.offset || 30;'));
}

// ---------------------------------------------------------------- 核心回归
console.log('\n[核心] 安卓几何：真滑到底那一发（老公式不成立）必须触发自动加载');
{
    const { window, $, calls, fireScroll } = boot();

    // 先钉住桩：这一发的几何就是「到底了」，但按老公式不成立。
    const geom = {
        innerHeight: window.innerHeight,
        scrollTop: $(window).scrollTop(),
        jqWindowHeight: $(window).height(),
        documentHeight: $(window.document).height(),
    };
    check('几何桩生效：innerHeight=700、scrollTop=240、$(window).height()=700、$(document).height()=1000',
        geom.innerHeight === 700 && geom.scrollTop === 240
        && geom.jqWindowHeight === 700 && geom.documentHeight === 1000,
        JSON.stringify(geom));
    const oldFormula = $(window).scrollTop() + $(window).height() >= $(window.document).height() - 30;
    check('复刻的是「到底了却不加载」：老公式 240 + 700 = 940 < 1000 - 30 = 970',
        oldFormula === false, `oldFormula=${oldFormula}`);

    const wall = window.utils.infiniteScroll('#images-scroll', { root: 'window', url: '/wall' });
    await sleep(0);   // 等首屏那次请求落地（否则 props.loading 还是 true，滚动不触发）

    const $sentinel = $('#images-scroll').find('.infinite-scroll').last();
    check('哨兵存在：utils.infiniteScroll 自己插在列表末尾的 .infinite-scroll',
        $sentinel.length === 1, `count=${$sentinel.length}`);

    stubSentinelTop($sentinel.get(0), 660);   // 位于可视视口内（700 高），在 offset 余量内
    const before = calls.gets.length;
    fireScroll(window);
    check('★ 到底了自动加载（安卓第一次滑动就加载，不用再拖一下）',
        calls.gets.length === before + 1,
        `gets=${calls.gets.length}（期望 ${before + 1}；没增加即“到底了但没触发”）`);

    // 加载后 props.loading 会被置起，等它回来，下一个用例才算数
    await sleep(0);

    // 边界：哨兵刚好落在 innerHeight + offset 上算“到”了
    stubSentinelTop($sentinel.get(0), 730);
    const atBoundary = calls.gets.length;
    fireScroll(window);
    check('边界：哨兵 top == innerHeight + offset（730）算到，触发加载',
        calls.gets.length === atBoundary + 1, `gets=${calls.gets.length}（期望 ${atBoundary + 1}）`);
    await sleep(0);

    // 边界：差 1px 就不算
    stubSentinelTop($sentinel.get(0), 731);
    const pastBoundary = calls.gets.length;
    fireScroll(window);
    check('边界：哨兵 top == innerHeight + offset + 1（731）不算到，不触发',
        calls.gets.length === pastBoundary, `gets=${calls.gets.length}（期望 ${pastBoundary}）`);
}

// ---------------------------------------------------------------- 反向
console.log('\n[反向] 哨兵不在可视视口内（还离得远）不应该触发加载');
{
    const { window, $, calls, fireScroll } = boot();

    const wall = window.utils.infiniteScroll('#images-scroll', { root: 'window', url: '/wall' });
    await sleep(0);

    const $sentinel = $('#images-scroll').find('.infinite-scroll').last();
    stubSentinelTop($sentinel.get(0), 5000);   // 远在视口下方
    const before = calls.gets.length;
    fireScroll(window);
    check('哨兵 rect.top 很大（5000）+ 同一套安卓几何 → 不发请求',
        calls.gets.length === before, `gets=${calls.gets.length}（期望 ${before}）`);

    stubSentinelTop($sentinel.get(0), 900);    // 一屏之下（> 700 + 30）
    const before2 = calls.gets.length;
    fireScroll(window);
    check('哨兵刚滑出视口下方（900 > 730）→ 不发请求',
        calls.gets.length === before2, `gets=${calls.gets.length}（期望 ${before2}）`);
}

// ---------------------------------------------------------------- 容器分支不许被改坏
console.log('\n[容器分支] 弹窗里的相册列表照旧跟自己的滚动条（没有地址栏那套问题）');
{
    // 这一支不走 wallGeometry：容器版读的是元素自身的 scrollTop/scrollHeight/height
    const { window, $, calls, fireScroll } = boot({ wallGeometry: false });

    const container = $('#album-switch-scroll').get(0);
    Object.defineProperty(container, 'scrollTop', { value: 500, configurable: true, writable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 900, configurable: true, writable: true });
    // jsdom 没有排版引擎：$(el).height() 读的是计算样式，只能靠内联样式把高度给出来
    container.style.height = '400px';

    const album = window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
    await sleep(0);

    const before = calls.gets.length;
    fireScroll(container);
    check('容器滚到底（500 + 400 >= 900 - 30）仍照旧自动加载',
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
