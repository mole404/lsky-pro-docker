/*
 * 筛选面板「N 张」的口径与请求竞态（fork 修复）—— 行为测试（jsdom + 真实 jQuery）。
 *
 * 守三件事（都是用户看得到的错）：
 *   ① 面板数字取「已提交的搜索词」：列表只在搜索框回车时才带关键词，面板也跟着它走；
 *      输入框里敲着还没回车的字不能影响面板（否则面板先变、列表没变 ⇒ 张数对不上）。
 *   ② 请求序号守卫：上下文连点几下会有多个分面请求在路上，先发后到的旧响应必须被丢弃。
 *   ③ 失败兜底：分面请求失败/非 status 时 strategiesLoaded 必须回到「未加载」，
 *      下次打开面板还会重试（旧实现是在请求发出之前就置 true ⇒ 一次失败永久不重取）。
 *
 * 运行：node strategy-facets-behavior.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const blade = fs.readFileSync(path.join(SRC, 'resources', 'views', 'user', 'images.blade.php'), 'utf8');
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');

// 三段内联脚本（与 images-modal-dom.test.mjs 同一套取法）；blade 表达式换成桩串
function inlineScripts() {
    const tail = blade.slice(blade.indexOf("@push('scripts')"));
    const out = [];
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(tail))) {
        out.push(m[1].replace(/\{\{[\s\S]*?\}\}/g, '/stub').replace(/\{!![\s\S]*?!!\}/g, ''));
    }
    return out;
}

function deferred() {
    let resolve, reject;
    const p = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { p, resolve, reject };
}

const IMAGE = {
    id: 7, filename: 'beach.jpg', origin_name: 'IMG_0001.HEIC', url: 'https://i.example.com/beach.jpg',
    thumb_url: 'https://i.example.com/beach-thumb.jpg', width: 4000, height: 3000, size: 2048,
    mimetype: 'image/jpeg', md5: 'abcdef', sha1: '123456', uploaded_ip: '1.2.3.4',
    created_at: '2026-09-01 10:00:00', album: { name: '旧相册' }, strategy: { name: '本地' }, links: {}, tags: [],
};

function boot() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <span id="header-title"></span>
        <div id="images-scroll"><div id="images-grid">
            <a class="images-item" data-id="7" href="javascript:void(0)"
               data-json='${JSON.stringify(IMAGE).replace(/'/g, '&#39;')}'>
                <img alt="beach.jpg" data-original="https://i.example.com/beach.jpg" src="https://i.example.com/beach-thumb.jpg">
            </a>
        </div></div>
        <input id="search">
        <a id="tag-filter" href="javascript:void(0)"><span>筛选</span></a>
        <div id="tag-filter-menu">
            <div id="filter-scroll">
                <div id="strategy-filter-section" class="hidden"><div id="strategy-filter-list"></div></div>
                <div id="tag-filter-list"></div>
            </div>
            <a id="tag-filter-clear" class="hidden" href="javascript:void(0)">清除筛选</a>
        </div>
        <div id="image-detail-modal" class="hidden"><div id="image-detail-content"></div></div>
        <div id="image-movements-modal" class="hidden"><div id="image-movements-content"></div></div>
        <div id="album-switch-modal" class="hidden"><div id="album-switch-content"></div></div>
        <a data-operate="movements" class="hidden" href="javascript:void(0)">移动到相册</a>
        <a data-operate="detail" class="hidden" href="javascript:void(0)">详细信息</a>
        <a data-operate="refresh" class="hidden" href="javascript:void(0)">刷新</a>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });

    window.eval(JQUERY_SRC);
    const $ = window.jQuery;
    $.fn.justifiedGallery = function () { return this; };
    // jsdom 没实现 scrollTo（resetImages 里那次「先回顶部」会打一条 Not implemented 噪声）
    window.scrollTo = () => {};

    // 分面请求（带 config.params 的 GET）= 队列化，由测试决定何时/以什么内容响应
    const facetCalls = [];
    const facetPending = [];
    const calls = { refreshes: [], toasts: [] };

    window.axios = {
        get: (url, config) => {
            if (config && config.params && Object.prototype.hasOwnProperty.call(config.params, 'keyword')) {
                facetCalls.push({ url, params: config.params });
                const d = deferred();
                facetPending.push(d);
                return d.p;
            }
            return Promise.resolve({ data: { status: true, data: { image: IMAGE, tags: [] } } });
        },
        put: () => Promise.resolve({ data: { status: true } }),
        post: () => Promise.resolve({ data: { status: true } }),
        delete: () => Promise.resolve({ data: { status: true } }),
    };

    window.DragSelect = class {
        constructor() { this._sel = []; }
        getSelection() { return this._sel; }
        subscribe() {} setSelectables() {} addSelection() {} toggleSelection() {}
        clearSelection() {} stop() {} break() {}
    };
    window.Viewer = class { update() {} };
    window.ClipboardJS = class { on() { return this; } };
    window.context = { init() {}, attach() {}, isMenuOpen: () => false };
    window.toastr = {
        success: (m) => calls.toasts.push(['success', m]),
        warning: (m) => calls.toasts.push(['warning', m]),
        error: (m) => calls.toasts.push(['error', m]),
    };
    window.Swal = { fire: () => Promise.resolve({ isConfirmed: false }) };
    window.Alpine = { store: () => ({ open() {}, close() {}, isOpen: () => false }) };
    window.utils = {
        formatSize: (bytes) => `${bytes} B`,
        isMobile: () => false,
        setCapacityProgress() {},
        infiniteScroll(selector, options) {
            const record = { selector, options };
            calls.refreshes = calls.refreshes || [];
            return {
                refresh(params) { record.lastParams = params; calls.refreshes.push(params); },
                reset() {},
                destroy() {},
            };
        },
    };

    window.eval(inlineScripts().join('\n') + `
        window.__t = {
            loadStrategies,
            resetImages,
            isStrategiesLoaded() { return strategiesLoaded; },
            getCommittedKeyword() { return committedKeyword; },
            getStrategies() { return allStrategies.slice(); },
            facetParams() { return strategyFacetParams(); },
        };
    `);

    return { window, $, calls, facetCalls, facetPending, t: window.__t };
}

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${!pass && detail ? '  → ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------ ① 已提交的搜索词 */
console.log('\n[1] 面板数字取「已提交」的搜索词，不读输入框实时值');
{
    const { $, calls, facetCalls, facetPending, t } = boot();

    // 搜索框回车 = 提交
    $('#search').val('a_b').trigger($.Event('keydown', { keyCode: 13 }));
    await sleep(10);
    check('回车提交后：图片列表带上搜索词', calls.refreshes.at(-1)?.keyword === 'a_b', JSON.stringify(calls.refreshes.at(-1)));
    check('回车提交后：已提交搜索词被记住', t.getCommittedKeyword() === 'a_b', t.getCommittedKeyword());

    // 输入框里继续敲、但**不回车**
    $('#search').val('a_bcd');
    const p = t.loadStrategies();
    facetPending.at(-1).resolve({ data: { status: true, data: { strategies: [{ id: 1, name: '本地', total: 2 }] } } });
    await p;
    check('未回车的输入不进入分面参数（facet 的 keyword 仍是已提交那一份）',
        facetCalls.at(-1)?.params.keyword === 'a_b', JSON.stringify(facetCalls.at(-1)?.params));
    check('分面参数形状：album_id / tags / keyword 三项都在',
        ['album_id', 'tags', 'keyword'].every((k) => Object.prototype.hasOwnProperty.call(facetCalls.at(-1).params, k)),
        JSON.stringify(facetCalls.at(-1)?.params));

    // 换成「不按关键字筛」再回车（清空搜索词）
    $('#search').val('').trigger($.Event('keydown', { keyCode: 13 }));
    await sleep(10);
    const p2 = t.loadStrategies();
    facetPending.at(-1).resolve({ data: { status: true, data: { strategies: [] } } });
    await p2;
    check('清空搜索词回车后：分面不再带 keyword', facetCalls.at(-1)?.params.keyword === undefined,
        JSON.stringify(facetCalls.at(-1)?.params));
}

/* ------------------------------------------------ ② 请求竞态 */
console.log('\n[2] 分面请求序号守卫：过期的响应不落地');
{
    const { $, facetPending, t } = boot();

    const first = t.loadStrategies();          // 旧上下文（先发）
    const second = t.loadStrategies();         // 新上下文（后发）

    // 先让**后发**的那个回来（最新）→ 正常渲染 9 张
    facetPending.at(-1).resolve({ data: { status: true, data: { strategies: [{ id: 1, name: '最新策略', total: 9 }] } } });
    await second;
    check('最新响应渲染进面板', $('#strategy-filter-list').text().includes('9 张'), $('#strategy-filter-list').text().trim());

    // 再让**先发**的那个回来（过期）→ 必须被丢弃，面板仍是 9 张
    facetPending.at(-2).resolve({ data: { status: true, data: { strategies: [{ id: 1, name: '过期策略', total: 3 }] } } });
    await first;
    await sleep(10);
    check('过期响应被丢弃（面板张数/策略名都没被旧响应覆盖）',
        $('#strategy-filter-list').text().includes('9 张') && ! $('#strategy-filter-list').text().includes('过期策略'),
        $('#strategy-filter-list').text().trim());
}

/* ------------------------------------------------ ③ 失败兜底 */
console.log('\n[3] 失败兜底：不预设「已加载」，失败后可重试');
{
    const { facetPending, t } = boot();

    // 第一次：网络错误
    const p1 = t.loadStrategies();
    facetPending.at(-1).reject(new Error('network down'));
    await p1;
    check('请求失败后回到「未加载」状态（可以再试）', t.isStrategiesLoaded() === false);

    // 第二次：接口回 status:false
    const p2 = t.loadStrategies();
    facetPending.at(-1).resolve({ data: { status: false, message: 'boom' } });
    await p2;
    check('status:false 也算没加载到（不置 true）', t.isStrategiesLoaded() === false);

    // 第三次：成功
    const p3 = t.loadStrategies();
    facetPending.at(-1).resolve({ data: { status: true, data: { strategies: [{ id: 2, name: '本地', total: 4 }] } } });
    await p3;
    check('成功落地后才置「已加载」', t.isStrategiesLoaded() === true);
    check('失败两次没有影响第三次的渲染', t.getStrategies().length === 1 && t.getStrategies()[0].total === 4,
        JSON.stringify(t.getStrategies()));
}

/* ------------------------------------------------ ④ 失败时不在面板里留半截状态 */
console.log('\n[4] 打开面板那条重试路径仍挂着（失败后点开面板会再取一次）');
{
    const { $, facetCalls, facetPending, t } = boot();

    // 预取失败（模拟首屏那一次）
    const p = t.loadStrategies();
    facetPending.at(-1).reject(new Error('offline'));
    await p;
    const before = facetCalls.length;

    // 之后点开「筛选」→ 应再发一次
    $('#tag-filter').trigger('click');
    await sleep(10);
    check('失败后打开面板会重试（请求数 +1）', facetCalls.length === before + 1,
        `before=${before} after=${facetCalls.length}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
