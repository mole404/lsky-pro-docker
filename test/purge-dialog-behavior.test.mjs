/*
 * 「清空存储策略图片」弹窗与批处理循环的**行为**测试（不是字符串存在性检查）。
 *
 * 为什么要这样测：之前那几条断言只匹配源码里出现过某个函数名，于是
 *   · 把问号按钮的 onclick 改成「只能展开不能收起」；
 *   · 把 $(#purge-delete-files) 的勾选值写死成 true；
 *   · 把结果文案里的物理文件计数删掉；
 * 都能照样通过。这里把后台页那段 <script> 原样取出来，在 jsdom 里用真的 jQuery 跑，
 * Swal / axios 换成记录用的桩，直接断言「点两下显示状态有没有来回」「完成弹窗写了什么」。
 *
 * 运行：node purge-dialog-behavior.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import jqueryFactory from 'jquery';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const blade = fs.readFileSync(path.join(SRC, 'resources/views/admin/strategy/index.blade.php'), 'utf8');

let failures = 0;
const check = (name, ok, detail = '') => {
    if (ok) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const match = blade.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
    console.log('  ✗ 策略页里找不到 <script> 块');
    process.exit(1);
}
const source = match[1];

/* ---------- 搭一个能跑这段脚本的最小浏览器环境 ---------- */

const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div></body></html>', {
    runScripts: 'dangerously',
    url: 'https://example.test/admin/strategies',
});
const { window } = dom;
const $ = jqueryFactory(window);
window.$ = window.jQuery = $;
// 成功弹窗最后会 history.go(0) 刷新页面，jsdom 里没有导航实现，换成空函数。
// jsdom 的 history 是只读属性：直接改写 go()，成功弹窗最后那句刷新就不会抛错。
try { window.history.go = () => {}; } catch { /* 忽略：不同 jsdom 版本实现差异 */ }

// setTimeout 换成手动队列：批处理循环靠 setTimeout(step, 60) 推进，
// 用真实定时器会和后面的用例互相干扰（上一轮还在跑，断言读到的是别人的状态）。
const timers = [];
window.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
};

const drain = async () => {
    for (let guard = 0; guard < 500; guard++) {
        for (let k = 0; k < 8; k++) {
            await Promise.resolve();
        }
        if (!timers.length) {
            await new Promise((resolve) => setImmediate(resolve));
            if (!timers.length) {
                return;
            }
        }
        timers.shift()();
    }
};

const swal = [];
window.Swal = {
    fire(options) {
        swal.push({ kind: 'fire', options });
        return Promise.resolve({ isConfirmed: false });
    },
    update(options) {
        swal.push({ kind: 'update', options });
    },
    showLoading() {},
    showValidationMessage(message) {
        swal.push({ kind: 'validation', message });
    },
};

// axios 桩：responses 数组按顺序出队，用完后重复最后一条。
const requests = [];
let responses = [];
window.axios = {
    post(url, payload) {
        requests.push({ url, payload });
        const body = responses.length > 1 ? responses.shift() : responses[0];
        return Promise.resolve({ data: body });
    },
};

window.eval(source);

const lastFire = () => [...swal].reverse().find((c) => c.kind === 'fire');

console.log('A. 清空弹窗');

check('脚本能在这里跑起来（函数都挂上了）',
    typeof window.purgeStrategyImages === 'function' && typeof window.runPurge === 'function');

window.purgeStrategyImages($('<tr data-id="7" data-images-count="5"><td class="name">S3</td></tr>'));
const dialog = lastFire();
const html = dialog?.options?.html || '';

check('弹窗确认键挂了危险样式', dialog?.options?.customClass?.confirmButton === 'ls-swal-danger');
check('弹窗里写了本次要删的张数', html.includes('<b>5</b> 张图片'), html.slice(0, 80));
check('弹窗里有「先取消角色组」的引导', html.includes('把该策略关联的角色组全部取消'), '缺少竞态提示');
check('说明默认收起', /id="purge-help"[^>]*display:none/.test(html));

/* ---------- 问号按钮：真的点两下 ---------- */

const stage = window.document.getElementById('stage');
stage.innerHTML = html;

const helpBtn = stage.querySelector('#purge-help-btn');
const helpBox = stage.querySelector('#purge-help');
const displayOf = () => window.getComputedStyle(helpBox).display;

check('问号按钮与说明都在渲染出来的 HTML 里', !!helpBtn && !!helpBox);

if (helpBtn && helpBox) {
    helpBtn.click();
    const afterFirst = displayOf();
    helpBtn.click();
    const afterSecond = displayOf();
    check('点一下展开', afterFirst === 'block', `实际 ${afterFirst}`);
    check('再点一下收起', afterSecond === 'none', `实际 ${afterSecond}`);
}

/* ---------- 勾选框的值真的进到请求里 ---------- */

window.purgeStrategyImages($('<tr data-id="7" data-images-count="5"><td class="name">S3</td></tr>'));
const second = lastFire();
const stage2 = window.document.getElementById('stage');
stage2.innerHTML = second.options.html;
stage2.querySelector('#purge-delete-files').checked = true;

const preConfirm = second.options.preConfirm;
check('输入不对时不放行', preConfirm('随便写的') === false
    && swal.some((c) => c.kind === 'validation' && c.message.includes('确认删除')));
check('输入正确时带出勾选状态', (() => {
    const value = preConfirm('确认删除');
    return value && value.deleteFiles === true;
})(), JSON.stringify(preConfirm('确认删除')));

stage2.querySelector('#purge-delete-files').checked = false;
check('不勾选时 deleteFiles 为 false', (() => {
    const value = preConfirm('确认删除');
    return value && value.deleteFiles === false;
})(), JSON.stringify(preConfirm('确认删除')));

console.log('B. 分批请求与完成文案');

const ok = (payload) => ({ status: true, message: '已删除', data: payload });

/* B1. 两批删完，其中 1 张物理文件失败 */
requests.length = 0;
swal.length = 0;
responses = [
    ok({ deleted: 3, files_deleted: 2, files_failed: 1, remaining: 2, cursor: 3, snapshot: 5, done: false }),
    ok({ deleted: 2, files_deleted: 2, files_failed: 0, remaining: 0, cursor: 5, snapshot: 5, done: true }),
];
window.runPurge(7, 5, true);
await drain();

check('第一批之后带着 cursor/snapshot 继续请求', requests.length === 2
    && requests[0].payload.cursor === 0 && requests[0].payload.snapshot === 0
    && requests[1].payload.cursor === 3 && requests[1].payload.snapshot === 5, JSON.stringify(requests.map((r) => r.payload)));
check('请求带上了 delete_files / confirm', requests[0].payload.delete_files === true && requests[0].payload.confirm === '确认删除');

const done = lastFire();
check('完成弹窗标题是「已清空」', done?.options?.title === '已清空');
check('完成弹窗分别写了记录数与物理文件数',
    done?.options?.html?.includes('删除数据库记录 <b>5</b> 张') && done?.options?.html?.includes('物理文件 <b>4</b> 张'),
    done?.options?.html);
check('失败的文件张数有单独提示', done?.options?.html?.includes('<b>1</b> 张物理文件删除失败'), done?.options?.html);

/* B2. 只删记录模式 */
requests.length = 0;
swal.length = 0;
responses = [ok({ deleted: 5, files_deleted: 0, files_failed: 0, remaining: 0, cursor: 5, snapshot: 5, done: true })];
window.runPurge(7, 5, false);
await drain();

check('只删记录模式请求里 delete_files 为 false', requests[0]?.payload?.delete_files === false);
check('只删记录模式说明物理文件没动',
    lastFire()?.options?.html?.includes('物理文件没有动'), lastFire()?.options?.html);

/* B3. 一批一张都没删、游标也没动 → 停手报错 */
requests.length = 0;
swal.length = 0;
responses = [ok({ deleted: 0, files_deleted: 0, files_failed: 0, remaining: 3, cursor: 0, snapshot: 5, done: false })];
window.runPurge(7, 5, true);
await drain();

check('没有进展时弹「清空中断」而不是死循环',
    lastFire()?.options?.title === '清空中断' && requests.length === 1, JSON.stringify({ title: lastFire()?.options?.title, n: requests.length }));

/* B4. 后端把游标归零重扫时不算「没有进展」 */
requests.length = 0;
swal.length = 0;
responses = [
    ok({ deleted: 2, files_deleted: 2, files_failed: 0, remaining: 3, cursor: 0, snapshot: 5, done: false }),
    ok({ deleted: 3, files_deleted: 3, files_failed: 0, remaining: 0, cursor: 5, snapshot: 5, done: true }),
];
window.runPurge(7, 5, true);
await drain();

check('游标被服务端重置时继续跑而不是报错',
    requests.length === 2 && lastFire()?.options?.title === '已清空',
    JSON.stringify({ n: requests.length, title: lastFire()?.options?.title }));

console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
