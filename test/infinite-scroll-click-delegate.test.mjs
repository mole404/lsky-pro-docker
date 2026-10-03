/*
 * F14 回归测试：infiniteScroll 的 click 委托判据「收窄」+ 事件命名空间
 *
 * 背景：
 *   老的实现是 `$(selector).off('click').on('click', 'span:not(.disabled)', () => load())`
 *   —— 判据是「容器内任意 span」。列表里任何一个 span（相册名、徽标…）被点都会被
 *   当成「点了加载更多」，顺手多发一页请求。真正「有意」的触发器只有本方法自己插在
 *   列表末尾的那条哨兵（.infinite-scroll > span，文案「加载更多 / 我也是有底线的~」）。
 *   修法：给哨兵一个专属类 js-infinite-scroll-trigger，click 判据收窄到它；点哨兵里的
 *   子元素（图标/文字）仍算点了哨兵。.disabled 语义保留（加载中/到底/出错点了不加载）。
 *
 *   另外：destroy() 原来写的是 `.unbind('click')`（无命名空间），会把绑在同一个容器上
 *   别人的 click 委托一起摘掉（图片页容器上还有一条 .image-selector 委托）。本次改成
 *   `click.infiniteScroll` 命名空间，谁注册谁解绑。
 *
 * 做法沿用 infinite-scroll-destroy.test.mjs：把 app.js 里的 infiniteScroll 方法原样
 * 抽出来（花括号配对，不是抄一份），塞进 jsdom + 真实 jQuery 里跑，axios 打桩。
 *
 * 运行：
 *   node infinite-scroll-click-delegate.test.mjs [要测的 app.js 路径]
 * 传路径时测的是那份文件（用来验证「改前会失败」，默认测仓库里这份）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
const APP_JS = process.argv[2] || path.join(here, '..', 'src', 'resources', 'js', 'app.js');
const APP_SRC = fs.readFileSync(APP_JS, 'utf8');

// 插件那条哨兵 span 的专属类（与源码里保持一致；下面「前置自检」会核对源码里真有它，
// 不是手抄一份假货）
const SENTINEL_CLASS = 'js-infinite-scroll-trigger';

// 与另外两个 infinite-scroll 测试同一个抽取器：`infiniteScroll(selector, options) { … }`
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
        get: (url, config) => { calls.gets.push({ url, params: config && { ...config.params } }); return Promise.resolve({ data: {} }); },
    };

    window.eval(`window.utils = { infiniteScroll(selector, options) ${METHOD_BODY} };`);

    const fireScroll = (el) => { el.dispatchEvent(new window.Event('scroll')); };
    return { window, $, calls, fireScroll };
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
    check(`哨兵生成时就带上专属类 .${SENTINEL_CLASS}`,
        METHOD_BODY.includes(SENTINEL_CLASS),
        METHOD_BODY.includes(SENTINEL_CLASS) ? '' : '源码里没找到这个类');
    check('click 委托判据收窄到哨兵类、并且带命名空间 click.infiniteScroll',
        METHOD_BODY.includes(SENTINEL_CLASS)
        && METHOD_BODY.includes('click.infiniteScroll')
        && ! METHOD_BODY.includes("'span:not(.disabled)'"));
    check('destroy() 只解绑自己的命名空间（有 off/unbind click.infiniteScroll）',
        /\.(off|unbind)\('click\.infiniteScroll'\)/.test(METHOD_BODY));
}

// ---------------------------------------------------------------- 判据收窄
console.log('\n[判据收窄] 只有插件自己插的那条哨兵（及其子元素）才算「点了加载更多」');
{
    // (A) 点容器内一个非哨兵 span → 不该加载（改前必红）
    {
        const { window, $, calls } = boot();
        window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
        await sleep(0); // 等首屏那发请求落地，props.loading 复位

        // 模拟相册名那种行内 span（真实模板里现在没有，但老委托会把它当触发器）
        $('#albums-container').append('<div class="albums-row"><span class="album-name">三亚</span></div>');
        const before = calls.gets.length;
        $('#albums-container .album-name').trigger('click');
        check('点容器内一个非哨兵 span（相册名那种）：不触发加载',
            calls.gets.length === before, `gets=${calls.gets.length}（期望 ${before}）`);
    }

    // (B) 点哨兵本身 → 照旧加载（行为保持）
    {
        const { window, $, calls } = boot();
        window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
        await sleep(0);
        const before = calls.gets.length;
        $('#album-switch-scroll .infinite-scroll span').trigger('click');
        check('点哨兵本身：照旧加载下一页',
            calls.gets.length === before + 1, `gets=${calls.gets.length}（期望 ${before + 1}）`);
    }

    // (C) 点哨兵里的子元素（图标/文字）→ 也算点了哨兵（行为保持）
    {
        const { window, $, calls } = boot();
        window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
        await sleep(0);
        const $sentinel = $('#album-switch-scroll .infinite-scroll span');
        $sentinel.append('<i class="js-infinite-scroll-icon">↻</i>');
        const before = calls.gets.length;
        $('#album-switch-scroll .infinite-scroll span i.js-infinite-scroll-icon').trigger('click');
        check('点哨兵里的子元素（图标）：也算点了哨兵，照旧加载',
            calls.gets.length === before + 1, `gets=${calls.gets.length}（期望 ${before + 1}）`);
    }

    // (D) .disabled 态点了不加载（行为保持）
    {
        const { window, $, calls } = boot();
        window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
        await sleep(0);
        const $sentinel = $('#album-switch-scroll .infinite-scroll span');
        $sentinel.addClass('disabled');
        const before = calls.gets.length;
        $sentinel.trigger('click');
        check('.disabled 态（加载中/到底/出错）点哨兵：不加载',
            calls.gets.length === before, `gets=${calls.gets.length}（期望 ${before}）`);
    }
}

// ---------------------------------------------------------------- 命名空间
console.log('\n[命名空间] destroy() 不得连带摘掉同一容器上别人的 click 委托');
{
    const { window, $, calls } = boot();
    const album = window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
    await sleep(0);

    // 同容器上另有一条（非命名空间的）click 委托 —— 例如图片页容器上的 .image-selector
    let otherClicks = 0;
    $('#album-switch-scroll').on('click', '.image-selector', () => { otherClicks++; });
    $('#albums-container').append('<a class="image-selector">点我</a>');

    album.destroy();

    check('destroy() 之后：同一容器上另一条（非命名空间）click 委托仍然有效',
        (() => { $('#albums-container .image-selector').trigger('click'); return otherClicks === 1; })(),
        `otherClicks=${otherClicks}（期望 1）`);

    const before = calls.gets.length;
    $('#album-switch-scroll .infinite-scroll span').trigger('click');
    check('destroy() 之后：它自己的哨兵点击已被解绑（不再加载）',
        calls.gets.length === before, `gets=${calls.gets.length}（期望 ${before}）`);
}

// ---------------------------------------------------------------- 滚到底自动加载（两分支）
console.log('\n[滚动] 跳到底自动加载（window 版与容器版）不被本次改动破坏');
{
    const { window, $, calls, fireScroll } = boot();
    window.utils.infiniteScroll('#images-grid', { root: 'window', url: '/wall' });
    window.utils.infiniteScroll('#album-switch-scroll', { url: '/albums' });
    await sleep(0);

    const before = calls.gets.length;
    fireScroll(window);
    check('window 版：整页滚到底仍然自动加载',
        calls.gets.length === before + 1, `gets=${calls.gets.length}（期望 ${before + 1}）`);

    fireScroll($('#album-switch-scroll').get(0));
    check('容器版：滚自己的容器到底仍然自动加载',
        calls.gets.length === before + 2, `gets=${calls.gets.length}（期望 ${before + 2}）`);
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
