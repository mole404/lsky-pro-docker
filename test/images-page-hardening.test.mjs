#!/usr/bin/env node
/**
 * 「我的图片」页的注入与触屏收口：用**页面里那份真模板 + 真替换链**在 jsdom 里渲染，
 * 而不是在测试里重写一遍拼串逻辑。
 *
 * 为什么需要：
 *   ① 卡片上的文件名/标签名、详情卡里的相册名都是**用户/管理员可控字符串**，而它们的落点是
 *      `title="..."` / `alt="..."` / 单引号包着的 `data-json='...'`。少一层转义就能提前闭合属性、
 *      把 `<img onerror>` 注进页面（自伤型 XSS：受害者点自己的图）。这类回归在 jsdom 里能当场复现，
 *      在真机上只能靠肉眼。
 *   ② document 上的 touchmove 若忘了 passive，Chrome 会丢掉「不等 JS 就滚动/绘制」的快路径 ——
 *      真机上表现为「手指碰一下画面才突然画出来」，很难回查。这类只能靠静态 tripwire 守。
 *
 * 手法：把 <script type="text/html" id="..."> 模板与 `.replace(/__x__/g, ...)` 链**逐行解析**出来，
 * 再用真实的 escapeHtml 求值、按生产同样的顺序替换、渲染进 jsdom。负控（把某处 escapeHtml 拆掉）
 * 必须能红 —— 否则这个测试只是装饰。
 *
 * 依赖：jsdom + jquery。运行：node test/images-page-hardening.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');
const read = (p) => fs.readFileSync(p, 'utf8');
const JQUERY_SRC = read(path.join(here, 'node_modules/jquery/dist/jquery.js'));
const BLADE = read(path.join(srcRoot, 'resources/views/user/images.blade.php'));

let pass = 0;
let fail = 0;
const assert = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? '  → ' + detail : ''}`); }
};
const section = (name) => console.log(`\n[${name}]`);

/* ── 从页面里取真身 ─────────────────────────────────────────────────────────── */
const extractTemplate = (id) => {
    const m = BLADE.match(new RegExp(`<script type="text/html" id="${id}">([\\s\\S]*?)</script>`));
    if (!m) throw new Error(`取不到模板 #${id}`);
    return m[1];
};

const extractEscapeHtml = () => {
    const start = BLADE.indexOf('const escapeHtml = (value) =>');
    if (start < 0) throw new Error('取不到 escapeHtml');
    const end = BLADE.indexOf(';\n', start);
    if (end < 0) throw new Error('escapeHtml 表达式没有终止符');
    return BLADE.slice(start + 'const escapeHtml = '.length, end);
};

// 逐行解析锚点之后的 `.replace(/__x__/g, 表达式)` 链（注释与空行跳过，遇到别的代码就停）
const extractChain = (anchor) => {
    const lines = BLADE.split('\n');
    const start = lines.findIndex((l) => l.includes(anchor));
    if (start < 0) throw new Error(`找不到锚点：${anchor}`);
    const chain = [];
    for (let k = start + 1; k < lines.length; k++) {
        const s = lines[k].trim();
        if (s === '' || s.startsWith('//') || s.startsWith('/*') || s.startsWith('*')) continue;
        if (!s.startsWith('.replace(')) break;
        const body = s.replace(/^\.replace\(\//, '');
        const g = body.indexOf('/g, ');
        if (g < 0) throw new Error(`解析不了替换行：${s}`);
        const placeholder = body.slice(0, g);
        let expr = body.slice(g + 4);
        if (expr.endsWith(')')) expr = expr.slice(0, -1);
        chain.push({ placeholder, expr });
    }
    if (!chain.length) throw new Error(`锚点之后没有 .replace 链：${anchor}`);
    return chain;
};

/* ── 夹具 ───────────────────────────────────────────────────────────────────── */
// ① 闭合 title/alt 属性并注入一个 <img onerror>；② 夹杂单引号与标签（考验 data-json 的单引号属性）
const NASTY_BREAK = 'x"><img src=y onerror="window.__pwned=1">.jpg';
const NASTY_MIXED = 'it\'s "quoted" & <b>bold</b>.png';
const NASTY_TAG = 'it\'s <b>tag</b>';
const BENIGN = 'normal-name.png';

const bootWindow = () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    const { window } = dom;
    window.eval(JQUERY_SRC);
    window.escapeHtml = window.eval(`(${extractEscapeHtml()})`);
    window.utils = { formatSize: () => '1.00 MB' };
    window.cardTagsHtml = () => '';
    return { dom, window };
};

// 按生产同样的顺序、同样的 String.replace 语义（含 $ 展开）跑一遍替换链
const render = (window, tpl, chain, vars) => {
    Object.keys(vars).forEach((k) => { window[k] = vars[k]; });
    let out = tpl;
    for (const { placeholder, expr } of chain) {
        const value = String(window.eval(`(${expr})`));
        out = out.replace(new RegExp(placeholder, 'g'), value);
    }
    const holder = window.document.createElement('div');
    holder.innerHTML = out;
    return holder;
};

// 结构指纹：标签名 + 属性名（不含属性值）—— 注入一个元素/属性必然改变指纹
const signature = (root) => Array.from(root.querySelectorAll('*'))
    .map((el) => `${el.tagName.toLowerCase()}[${Array.from(el.attributes).map((a) => a.name).sort().join(',')}]`)
    .join('|');

const imageVars = (filename) => ({
    images: [{ id: 7, filename, url: '/i/7.png', thumb_url: '/t/7.png', width: 100, height: 80, date: '2026-01-01', human_date: '1 天前', tags: [{ id: 3, name: NASTY_TAG }] }],
    i: '0',
});

/* ── ① 列表卡片 ─────────────────────────────────────────────────────────────── */
section('列表卡片（images-item-tpl）');
const cardTpl = extractTemplate('images-item-tpl');
const cardChain = extractChain("html += $('#images-item-tpl').html()");
assert(cardChain.length >= 9, `解析出替换链（${cardChain.length} 项）`);

{
    const { dom, window } = bootWindow();
    const benign = render(window, cardTpl, cardChain, imageVars(BENIGN));
    const injected = render(window, cardTpl, cardChain, imageVars(NASTY_BREAK));
    const mixed = render(window, cardTpl, cardChain, imageVars(NASTY_MIXED));

    assert(benign.querySelectorAll('img').length === injected.querySelectorAll('img').length,
        '恶意文件名不会多出 <img>（属性没被提前闭合）',
        `正常 ${benign.querySelectorAll('img').length} 个 vs 恶意 ${injected.querySelectorAll('img').length} 个`);
    assert(injected.querySelectorAll('[onerror]').length === 0, '恶意文件名不会落地 onerror 属性');
    assert(signature(benign) === signature(injected) && signature(benign) === signature(mixed),
        '正常名 / 闭合攻击名 / 混合符号名的 DOM 结构指纹完全一致');

    const p = mixed.querySelector('p.filename');
    assert(p !== null, '卡片里找得到文件名节点');
    assert(p.textContent === NASTY_MIXED, '文件名文本按原样显示（用户看到的还是他自己起的名字）',
        `实际 ${JSON.stringify(p && p.textContent)}`);
    assert(p.getAttribute('title') === NASTY_MIXED, 'title 属性里是完整的原始文件名（没被截断/闭合）',
        `实际 ${JSON.stringify(p.getAttribute('title'))}`);
    const img = mixed.querySelector('img');
    assert(img.getAttribute('alt') === NASTY_MIXED, '缩略图 alt 同样是完整原名');

    // 单引号包着的 data-json：名字里带 ' 也必须还是合法 JSON
    const holder = mixed.querySelector('[data-json]');
    let parsed = null;
    try { parsed = JSON.parse(holder.getAttribute('data-json')); } catch (e) { parsed = null; }
    assert(parsed !== null, 'data-json 仍是合法 JSON（名字里的单引号没把属性截断）');
    assert(parsed && parsed.filename === NASTY_MIXED, 'data-json 往返后文件名无损');
    assert(parsed && parsed.tags && parsed.tags[0].name === NASTY_TAG, 'data-json 里的标签名也无损');

    dom.window.close();
}

/* ── ② 详情卡 ──────────────────────────────────────────────────────────────── */
section('详情卡（image-detail-tpl，相册名/策略名来自管理员）');
const detailTpl = extractTemplate('image-detail-tpl');
const detailChain = extractChain("let content = $('#image-detail-tpl').html()");
assert(detailChain.length >= 10, `解析出替换链（${detailChain.length} 项）`);

{
    const { dom, window } = bootWindow();
    const detailVars = (albumName) => ({
        image: {
            id: 9, thumb_url: '/t/9.png', filename: NASTY_BREAK, origin_name: NASTY_MIXED,
            album: { name: albumName }, strategy: { name: albumName }, size: 10, mimetype: 'image/png',
            width: 100, height: 80, md5: 'm', sha1: 's', uploaded_ip: '1.2.3.4', created_at: '2026-01-01', tags: [],
        },
    });
    const benign = render(window, detailTpl, detailChain, detailVars('相册A'));
    const injected = render(window, detailTpl, detailChain, detailVars(NASTY_MIXED));

    assert(signature(benign) === signature(injected), '详情卡结构指纹不受相册名影响（没有注入元素）');
    assert(injected.querySelectorAll('[onerror]').length === 0, '详情卡没有落地 onerror');
    const dds = Array.from(injected.querySelectorAll('dd')).map((d) => d.textContent);
    assert(dds.includes(NASTY_MIXED), '相册名以纯文本出现在详情卡里（未被当 HTML 解释）',
        `dd 文本：${JSON.stringify(dds.slice(0, 6))}`);
    assert(dds.includes(NASTY_BREAK) && dds.includes(NASTY_MIXED),
        '文件名/原始名都是纯文本落地（不是 HTML）');
    assert(injected.querySelector('dd b') === null, '没有把 <b> 之类标签真的建出来');

    dom.window.close();
}

/* ── ③ 负控：拆掉 escapeHtml 后，上面那两条「多出元素」必须真的红 ────────────── */
section('负控（拆掉 __name__ 的 escapeHtml）');
{
    const { dom, window } = bootWindow();
    const brokenChain = cardChain.map((c) => (c.placeholder === '__name__'
        ? { ...c, expr: c.expr.replace('escapeHtml(String(images[i].filename))', 'String(images[i].filename)') }
        : c));
    assert(brokenChain.some((c, idx) => c.expr !== cardChain[idx].expr), '负控确实改动了替换表达式');
    const broken = render(window, cardTpl, brokenChain, imageVars(NASTY_BREAK));
    const injectedImgs = broken.querySelectorAll('img[src="y"], [onerror]');
    assert(injectedImgs.length > 0,
        '去掉转义后注入的 <img onerror> 真的出现在 DOM 里（说明上面的断言是有效的，不是空转）',
        `注入元素数 ${injectedImgs.length}`);
    dom.window.close();
}

/* ── ④ 静态 tripwire：触屏收口那几处不许回退 ────────────────────────────────── */
section('静态 tripwire（被动监听与收口豁免）');
{
    const tm = [];
    const re = /document\.addEventListener\('touchmove'/g;
    let m;
    while ((m = re.exec(BLADE)) !== null) tm.push(m.index);
    assert(tm.length >= 3, `document 上的 touchmove 监听有 ${tm.length} 处`);
    tm.forEach((idx, n) => {
        const region = BLADE.slice(idx, idx + 700);
        assert(/passive:\s*true/.test(region),
            `第 ${n + 1} 处 touchmove 是 passive（否则安卓上会「碰一下才画出来」）`,
            region.split('\n').slice(0, 3).join(' ').slice(0, 90));
    });

    const guard = BLADE.match(/e\.target\.closest\('([^']*viewer-canvas img[^']*)'\)/);
    assert(guard !== null, '切图后 400ms 的背景 click 守卫还在');
    if (guard) {
        ['.viewer-canvas img', '.viewer-toolbar', '.viewer-navbar', '.viewer-title', '.viewer-button']
            .forEach((sel) => assert(guard[1].includes(sel),
                `守卫豁免里含 ${sel}（少了它，滑完图 400ms 内点 UI 会没反应）`));
    }

    const zones = BLADE.match(/const WINDOWED_UI_ZONES = \[([^\]]*)\]/);
    assert(zones !== null, 'WINDOWED_UI_ZONES 定义还在');
    if (zones) {
        ['.viewer-toolbar', '.viewer-navbar', '.viewer-title', '.viewer-button']
            .forEach((sel) => assert(zones[1].includes(`'${sel}'`), `非全屏收起的区域含 ${sel}`));
    }
    assert(/const FS_UI_MS = \d+;/.test(BLADE), 'FS_UI_MS 仍在且是数字（没被写成 0/表达式）');

    // 各处转义调用是「防回归 tripwire」：即便有人不跑上面的 DOM 断言，删掉转义这里也会红
    [['列表卡文件名', "escapeHtml(String(images[i].filename))"],
        ['列表卡 data-json', 'escapeHtml(JSON.stringify(images[i]))'],
        ['相册行名字', 'escapeHtml(albums[i].name)'],
        ['详情卡相册名', "escapeHtml(image.album ? image.album.name : '-')"],
        ['详情卡文件名', 'escapeHtml(String(image.filename))']]
        .forEach(([label, needle]) => assert(BLADE.includes(needle), `${label} 仍走 escapeHtml`));
}

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
