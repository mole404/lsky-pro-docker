/*
 * utils.infiniteScroll 的请求竞态回归测试（jsdom + 真实 jQuery）
 *
 * 背景（老师实测）：「我的图片」页快速连点筛选项 —— 比如先点「清除筛选」、立刻再点另一个
 * 存储策略 —— 图片墙上会把「未筛选的图」和「筛选后的图」混在同一屏里。
 *
 * 真因：refresh() 用 force 绕过了 props.loading 这道锁，两次筛选各发一个请求；两个响应都走
 * 同一个 success，谁都往 $photos 里 append。于是「先发、后到」的那份被拼在新结果后面。
 * 连带 complete 里的 page++ 会跑两次 —— 下次翻页直接跳号。
 *
 * 修法：每次 load/refresh 记一个递增代号，只有「最新那一次」的 success/error/complete 能落地。
 * 这个文件把这条钉住（正序、逆序、以及旧请求不许改分页计数/按钮文案）。
 *
 * 运行：node infinite-scroll-race.test.mjs [要测的 app.js 路径]
 * 传路径时测的是那份文件（用来验证「改前会失败」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
const APP_JS = process.argv[2] || path.join(here, '..', 'src', 'resources', 'js', 'app.js');
const APP_SRC = fs.readFileSync(APP_JS, 'utf8');

// 与 infinite-scroll-destroy.test.mjs 同一套抽取法：花括号配对，跳过字符串/注释
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

// 每个请求都返回一个可以手动 resolve/reject 的 promise（模拟「在路上」的请求）
function boot() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="wall"><div id="grid"></div></div>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    window.eval(JQUERY_SRC);

    const pending = [];
    window.axios = {
        get: (url, config) => new Promise((resolve, reject) => {
            pending.push({ url, params: config && { ...config.params }, resolve, reject });
        }),
    };

    window.eval(`window.utils = { infiniteScroll(selector, options) ${METHOD_BODY} };`);

    return { window, pending };
}

console.log('[前置] 抽到的是仓库里这份实现');
{
    check('infiniteScroll 里带请求代号闸门（seq / mySeq）',
        /let seq = 0;/.test(METHOD_BODY) && /const mySeq = \+\+seq;/.test(METHOD_BODY)
        && /if \(mySeq !== seq\) return;/.test(METHOD_BODY),
        APP_JS);
}

console.log('\n[正向] 先取消筛选、立刻点另一个策略：只有最新的响应能落地');
{
    const { window, pending } = boot();
    const applied = [];

    const wall = window.utils.infiniteScroll('#grid', {
        url: '/wall',
        success(response) { applied.push(response.data.tag); },
        complete() { applied.push('complete'); },
    });
    await sleep(0);

    // 首次加载（建实例时自动发的那个）：先落地，避免干扰
    pending[0].resolve({ data: { status: true, data: { tag: 'first' } } });
    await sleep(0);
    applied.length = 0;
    const baseCount = pending.length;

    // ① 清除筛选（未筛选）→ ② 立刻点策略（已筛选）
    wall.refresh({ page: 1, strategy_ids: [], tags: [] });
    wall.refresh({ page: 1, strategy_ids: [7], tags: [] });
    const reqA = pending[baseCount];      // 未筛选那次
    const reqB = pending[baseCount + 1];  // 已筛选那次

    check('两次 refresh 都真的发出去了（force 绕过 loading 锁）',
        pending.length === baseCount + 2, `pending=${pending.length}`);

    // 逆序落地：先发的那次后到（正是老师遇到的时序）
    reqB.resolve({ data: { status: true, data: { tag: 'filtered' } } });
    await sleep(0);
    reqA.resolve({ data: { status: true, data: { tag: 'unfiltered' } } });
    await sleep(0);

    check('旧的响应被丢弃：success 只跑了一次，拿到的是最新的那份',
        applied.filter((x) => x !== 'complete').join(',') === 'filtered',
        JSON.stringify(applied));

    check('complete 也只跑了一次（旧请求不会再把按钮/分页改一遍）',
        applied.filter((x) => x === 'complete').length === 1, JSON.stringify(applied));

    // 分页计数只该 +1：上次 complete 后 page 应为 2，而不是 3
    const before = pending.length;
    // 点列表底部那条哨兵触发下一页（比在 jsdom 里伪造滚动位置稳）
    window.jQuery('#grid .infinite-scroll span').trigger('click');
    await sleep(0);
    check('旧请求不改分页计数：下一次翻页仍然是第 2 页（不跳号）',
        pending.length === before + 1 && pending[before].params.page === 2,
        pending.length === before + 1 ? `page=${pending[before].params.page}` : '没发请求');
}

console.log('\n[反向] 旧请求报错也不能覆盖新请求的界面状态');
{
    const { window, pending } = boot();
    const events = [];

    const wall = window.utils.infiniteScroll('#grid', {
        url: '/wall',
        success(response) { events.push('success:' + response.data.tag); },
        error() { events.push('error'); },
        complete() { events.push('complete'); },
    });
    await sleep(0);
    pending[0].resolve({ data: { status: true, data: { tag: 'first' } } });
    await sleep(0);
    events.length = 0;

    const baseCount = pending.length;
    wall.refresh({ page: 1, strategy_ids: [7] });   // 旧
    wall.refresh({ page: 1, strategy_ids: [8] });   // 新

    pending[baseCount + 1].resolve({ data: { status: true, data: { tag: 'new' } } });
    await sleep(0);
    pending[baseCount].reject(new Error('aborted'));  // 旧的迟到且失败
    await sleep(0);

    check('迟到失败的旧请求不触发 error、也不影响已完成的新请求',
        events.join(',') === 'success:new,complete', JSON.stringify(events));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);