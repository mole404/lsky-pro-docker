/*
 * 四项安全/健壮性修复的回归测试（jsdom + jQuery）
 *
 * 覆盖：
 *   1. context-js.js buildMenu 的 click 委托不再无界累积
 *      （openMenu 开头按 menuActionIds 精确注销上一批 #event-xxx 委托）
 *   2. closeMenus 的清理定时器不再误伤下一轮菜单
 *      （openMenu 开头 clearTimeout(menuCleanupTimers) 后重开新菜单）
 *   3. images.blade.php 相册渲染转义（相册名里的 ' / <img onerror> 进不了属性）
 *   4. ImageService.php 的 sanitizeFilename（{filename} 里 URL 危险字符 → _）
 *
 * 运行：
 *   node security-fixes.test.mjs [要测的 context-js.js 路径]
 *
 * 时序说明（照抄 longpress.test.mjs）：
 *   - 库的时序窗口用 Date.now() 卡，真实 sleep 会抽奖 → pinClock() 把 window.Date.now
 *     换成测试可推进的假时钟；jsdom 的 setTimeout 仍走真实时间（本文件第 2 条要用到）。
 *   - 阈值/常量从源码正则读出来，不写死（源码一改，用例跟着动）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
// 默认测"浏览器实际加载的那份"
const LIB_PATH = process.argv[2] || path.join(here, '..', 'src', 'public', 'js', 'context-js', 'context-js.js');
const LIB_SRC = fs.readFileSync(LIB_PATH, 'utf8');
const BLADE = fs.readFileSync(path.join(here, '..', 'src', 'resources', 'views', 'user', 'images.blade.php'), 'utf8');
const IMAGE_SERVICE = fs.readFileSync(path.join(here, '..', 'src', 'app', 'Services', 'ImageService.php'), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const NUM = (re) => Number((LIB_SRC.match(re) || [])[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 可控假时钟
// 只影响被替换的那个 jsdom window；jsdom 的 setTimeout 仍走真实时间。
function pinClock(window, start = 1700000000000) {
    const realNow = window.Date.now.bind(window.Date);
    let fake = start;
    window.Date.now = () => fake;
    return {
        now: () => fake,
        advance: (ms) => { fake += ms; return fake; },
        unpin: () => { window.Date.now = realNow; },
    };
}

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// 复刻 images.blade.php 的结构与用法；menuData 为 .images-item 的菜单数据。
function boot({ ua, platform = 'Win32', maxTouchPoints = 0, hasTouch = false, menuData }) {
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
        <div id="images-scroll"><div id="images-grid">
            <a class="images-item" data-id="1" href="javascript:void(0)">
                <img alt="a" src="https://img.example.com/a-thumb.jpg"></a>
            <a class="images-item" data-id="2" href="javascript:void(0)">
                <img alt="b" src="https://img.example.com/b-thumb.jpg"></a>
        </div></div>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://img.example.com/images' });

    const { window } = dom;
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
    if (hasTouch) {
        Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true });
    }

    window.eval(JQUERY_SRC);
    window.eval(LIB_SRC);
    const $ = window.jQuery;

    window.eval('context.init({ fadeSpeed: 100, above: "auto", preventDoubleContext: true });');
    window.eval(`context.attach('#images-scroll', { data: [{ text: '刷新' }] });`);

    const data = menuData || [
        { header: '图片操作' },
        { text: '复制链接', subMenu: [{ text: 'Url', classes: ['copy'] }] },
        { text: '删除', action: function () {} },
    ];
    window.context.attach('.images-item', { data });

    return { dom, window, $, $item: $('.images-item').first() };
}

// jsdom 没实现 TouchEvent 构造器，手工造一个带 touches 的原生事件
function touch(window, type, x, y, target) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    const t = { clientX: x, clientY: y, identifier: 0 };
    ev.touches = (type === 'touchend' || type === 'touchcancel') ? [] : [t];
    ev.changedTouches = [t];
    target.dispatchEvent(ev);
    return ev;
}

const open = (window) => window.context.isMenuOpen();
const subLink = (window) => window.document.querySelector('.dropdown-submenu > a');
const subOpen = (window) => !!window.document.querySelector('.dropdown-submenu.touch-open');

// 统计 document 上 jQuery 的 click 委托中，选择器形如 `#event-xxx` 的条数。
// 每个带 action 的菜单项 buildMenu 时注册一条 `$(document).on('click', '#event-xxx', fn)`；
// jQuery 会为每个唯一选择器在 events.click 里建一个 handler 对象 → 条数即"当前挂着的委托数"。
function countActionDelegates($, doc) {
    const events = $._data(doc, 'events');
    if (!events || !events.click) {
        return 0;
    }
    return events.click.filter((h) => h.selector && String(h.selector).startsWith('#event-')).length;
}

// ================================================================ 1. 委托不再无界累积
console.log('\n[修复1] buildMenu 的 click 委托不再随"开菜单次数"线性增长');
{
    const N = 5;
    const { window, $, $item } = boot({
        ua: UA_WINDOWS,
        menuData: [
            { text: 'A', action: function () {} },
            { text: 'B', action: function () {} },
            { text: 'C', action: function () {} },
        ],
    });
    const doc = window.document;

    const counts = [];
    for (let n = 0; n < N; n++) {
        $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
        counts.push(countActionDelegates($, doc));
        check(`  第 ${n + 1} 次开菜单：菜单确实打开（公开入口可用）`, open(window) === true && !!window.document.querySelector('.dropdown-context'));
    }

    check(`连续开菜单 ${N} 次后，document 上的 #event-* 委托不再线性增长`,
        counts[counts.length - 1] <= counts[0] * 1.5 + 2,
        `每轮计数 = [${counts.join(', ')}]（不修复时应为 3,6,9,12,15）`);
    check('第 5 次的委托数与第 1 次相同（上一批被精确注销）',
        counts[counts.length - 1] === counts[0],
        `第1次=${counts[0]} 第5次=${counts[counts.length - 1]}`);
}

// ================================================================ 2. 清理定时器不误伤下一轮菜单
console.log('\n[修复2] closeMenus 的清理定时器不再误伤下一轮菜单');
{
    // —— 静态断言（永远可靠，钉住"钩子存在"这一契约） ——
    const pushTimers = (LIB_SRC.match(/menuCleanupTimers\.push\(setTimeout\(/g) || []).length;
    const clearLoop = /for \(let t = 0; t < menuCleanupTimers\.length; t\+\+\) \{\s*clearTimeout\(menuCleanupTimers\[t\]\);/.test(LIB_SRC);
    check('静态：closeMenus 的两个 setTimeout 句柄都被推进 menuCleanupTimers',
        pushTimers >= 2, `push(setTimeout( 出现 ${pushTimers} 次`);
    check('静态：openMenu 开头 clearTimeout 掉 menuCleanupTimers 里的句柄',
        clearLoop, clearLoop ? '' : 'openMenu 里找不到 clearTimeout(menuCleanupTimers[t]) 循环');

    // —— 行为断言：开菜单→开二级→关闭（排下清理定时器）→同步重开新菜单并展开二级 ——
    //    若 openMenu 不取消旧定时器，旧的 fade+60 定时器到点后会实时查 DOM 并
    //    `$('.dropdown-context .touch-open').removeClass('touch-open')`，把**新菜单**的二级收起。
    const { window, $, $item } = boot({ ua: UA_IPHONE, platform: 'iPhone', maxTouchPoints: 5, hasTouch: true });
    const clock = pinClock(window);
    const TOUCH_FADE = NUM(/TOUCH_FADE\s*=\s*(\d+)/) || 320;

    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    clock.advance(NUM(/MENU_OPEN_IGNORE_INPUT\s*=\s*(\d+)/) + 50);   // 越过"菜单刚打开"的忽略窗
    touch(window, 'touchstart', 200, 200, subLink(window));
    check('第 1 轮：二级菜单已就地展开（.touch-open）', subOpen(window) === true);

    // 关闭（滚动）→ closeMenus 排下两个清理定时器（真实 setTimeout）
    window.document.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('关闭触发：菜单状态已关（清理定时器已排下）', open(window) === false);

    // 同步重开并再次展开二级 —— 此刻距定时器到点（真实时间 TOUCH_FADE+60ms）还有充足时间
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    clock.advance(NUM(/MENU_OPEN_IGNORE_INPUT\s*=\s*(\d+)/) + 50);
    touch(window, 'touchstart', 200, 200, subLink(window));
    check('第 2 轮：重开后二级菜单也展开', open(window) === true && subOpen(window) === true);

    // 真等过旧定时器原本的触发点（fade+150 也一起跨过去）
    await sleep(TOUCH_FADE + 250);
    check('★ 跨过旧定时器触发点后，新菜单的二级菜单仍在（旧定时器已被取消）',
        open(window) === true && subOpen(window) === true,
        `等待 ${TOUCH_FADE + 250}ms 后 touch-open=${subOpen(window)}（不修复时应被旧定时器抹掉 → false）`);
    clock.unpin();
}

// ================================================================ 3. 相册渲染转义
console.log('\n[修复3] images.blade.php 相册列表渲染转义（data-json 单引号属性）');
{
    // —— 从 blade 抽真实源码，别自己另写一份 ——
    const escM = BLADE.match(/const escapeHtml = (\(value\) =>[\s\S]*?\.replace\(\/'\/g, '&#39;'\));/);
    const escapeHtmlSrc = escM && escM[1];
    const tplM = BLADE.match(/<script type="text\/html" id="albums-item-tpl">([\s\S]*?)<\/script>/);
    const albumTpl = tplM && tplM[1].replace(/\{\{--[\s\S]*?--\}\}/g, '');
    const renderLine = BLADE.split('\n').find((l) => l.includes('__json__') && l.includes('escapeHtml(JSON.stringify(albums[i]))'));

    check('blade 里能抽出 escapeHtml 定义与相册模板', !!escapeHtmlSrc && !!albumTpl,
        `escapeHtml=${!!escapeHtmlSrc} tpl=${!!albumTpl}`);
    check('相册模板的 data-json 用单引号属性', !!albumTpl && albumTpl.includes(`data-json='__json__'`));
    check('相册渲染行确实包了 escapeHtml(JSON.stringify(albums[i]))',
        !!renderLine, renderLine ? renderLine.trim() : '(找不到该行)');

    // escapeHtml 源码必须覆盖 & < > " ' 五个字符
    const covers = ['&', '<', '>', '"', "'"].filter((c) => {
        const re = c === '&' ? /\.replace\(\/&\/g, '&amp;'\)/
            : c === '<' ? /\.replace\(\/<\/g, '&lt;'\)/
            : c === '>' ? /\.replace\(\/>\/g, '&gt;'\)/
            : c === '"' ? /\.replace\(\/"\/g, '&quot;'\)/
            : /\.replace\(\/'\/g, '&#39;'\)/;
        return re.test(escapeHtmlSrc || '');
    });
    check("escapeHtml 源码覆盖 & < > \" ' 五个字符", covers.length === 5, `覆盖 ${covers.length}/5：${covers.join(' ')}`);

    // 用抽出来的 escapeHtml 源码在 jsdom 里跑（等价于浏览器加载到的那段）
    const escapeHtml = new Function('return (' + escapeHtmlSrc + ')')();

    // 复刻渲染行：把相册名/JSON 塞进模板（与 blade 同一条链，含 $ 转义）
    const renderAlbum = (album) => albumTpl
        .replace(/__id__/g, String(album.id))
        .replace(/__name__/g, escapeHtml(album.name).replace(/\$/g, '$$$$'))
        .replace(/__intro__/g, escapeHtml(album.intro).replace(/\$/g, '$$$$'))
        .replace(/__image_num__/g, String(album.image_num))
        .replace(/__current_badge__/g, '')
        .replace(/__json__/g, escapeHtml(JSON.stringify(album)).replace(/\$/g, '$$$$'));

    // 用一份带 jQuery 的 jsdom 解析生成的 HTML，读回 dataset / .data('json')
    const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { runScripts: 'outside-only', url: 'https://img.example.com/' });
    dom.window.eval(JQUERY_SRC);
    const $ = dom.window.jQuery;
    const host = dom.window.document.getElementById('host');
    const parse = (album) => {
        const html = renderAlbum(album);
        host.innerHTML = html;
        const row = host.querySelector('.albums-row');
        return { html, row, raw: row.getAttribute('data-json'), ds: row.dataset.json, jq: $(row).data('json') };
    };

    const MALICIOUS = `x' onerror='alert(1)<img src=x onerror=alert(2)>`;
    const album = { id: 7, name: MALICIOUS, intro: `it's <b>`, image_num: 3 };
    const { html, row, raw, ds, jq } = parse(album);

    let parsed = null, parseOk = false;
    try { parsed = JSON.parse(ds); parseOk = true; } catch (e) { parseOk = false; }
    check('恶意相册名：data-json 仍能 JSON.parse 成功', parseOk, ds);
    check('恶意相册名：解析出来的 name 与原始值逐字相等', parseOk && parsed.name === MALICIOUS,
        parseOk ? JSON.stringify(parsed.name) : '(parse 失败)');
    check("恶意相册名：jQuery $(el).data('json') 也解析为同一对象",
        !!jq && jq.name === MALICIOUS, jq ? JSON.stringify(jq.name) : String(jq));
    check('恶意相册名：没有注入额外的属性（onerror/onmouseover 等）',
        row.getAttribute('onerror') === null && row.getAttribute('onmouseover') === null
        && row.getAttributeNames().every((a) => ['class', 'data-id', 'data-json'].includes(a)),
        'attributes=' + JSON.stringify(row.getAttributeNames()));
    check('恶意相册名：没有注入额外的元素（<img> 被转义成文本）',
        host.querySelector('img') === null && !html.includes('<img') && html.includes('&lt;img'),
        `img 元素=${host.querySelectorAll('img').length} 原始 <img 出现=${html.includes('<img')}`);

    // 对照：正常名（不含 & < > " ' 任一被转义字符）转义前后逐字相同 —— "零行为变化"的关键证据
    for (const normal of ['相册A', 'trip-2026', 'déjà vu']) {
        check(`正常名「${normal}」escapeHtml 前后逐字相同`, escapeHtml(normal) === normal,
            JSON.stringify(escapeHtml(normal)));
    }
    // 带 & 的名字：HTML 属性里的 &amp; 在解析时会解码回 &，读回来的数据逐字不变
    const ampAlbum = { id: 2, name: 'A & B', intro: '', image_num: 1 };
    const { ds: ads } = parse(ampAlbum);
    check('含 & 的名字经属性编码后读回来仍逐字等于原值', JSON.parse(ads).name === 'A & B', ads);
    const { ds: nds } = parse({ id: 1, name: '相册A', intro: '', image_num: 5 });
    check('正常名：data-json 解析回来仍是原始相册对象',
        JSON.parse(nds).name === '相册A' && JSON.parse(nds).image_num === 5, nds);
}

// ================================================================ 4. {filename} 危险字符清洗（PHP）
console.log('\n[修复4] ImageService.php sanitizeFilename：{filename} 的 URL 危险字符 → _');
{
    const fnM = IMAGE_SERVICE.match(/protected function sanitizeFilename\(string \$name\): string\s*\{([\s\S]*?)\n    \}/);
    const body = fnM && fnM[1];
    check('能抽出 sanitizeFilename 方法体', !!body);

    // 从源码里解析出被替换的字符集合（PHP 的单引号字面量可直接当 JS 单引号字面量求值）
    const arrM = body && body.match(/\[\s*'\?'[\s\S]*?\]/);
    let danger = null;
    try { danger = arrM && new Function('return ' + arrM[0])(); } catch (e) { danger = null; }
    const required = ['?', '#', '%', '+', '/', '\\', '"', "'", '<', '>', '|', '*', ':', ' '];
    check('sanitizeFilename 覆盖了要求的危险字符集合',
        Array.isArray(danger) && required.every((c) => danger.includes(c)),
        'danger=' + JSON.stringify(danger));
    const hasControl = /preg_replace\(\s*'\/\[\\x00-\\x1F\\x7F\]\/'/.test(body || '');
    check('sanitizeFilename 另外把控制字符（\\x00-\\x1F \\x7F）→ _', hasControl);

    // JS 等价实现（字符集来自 PHP 源码；控制字符等同 PCRE 的 [\x00-\x1F\x7F]）
    const sanitizeFilename = (name) => {
        let out = String(name);
        for (const ch of (danger || [])) { out = out.split(ch).join('_'); }
        return out.replace(/[\x00-\x1F\x7F]/g, '_');
    };

    check('a?b.jpg → a_b.jpg', sanitizeFilename('a?b.jpg') === 'a_b.jpg', sanitizeFilename('a?b.jpg'));
    check('a#b → a_b', sanitizeFilename('a#b') === 'a_b', sanitizeFilename('a#b'));
    check('a%b → a_b', sanitizeFilename('a%b') === 'a_b', sanitizeFilename('a%b'));
    check('正常名「trip-2026_照片」逐字不变', sanitizeFilename('trip-2026_照片') === 'trip-2026_照片',
        sanitizeFilename('trip-2026_照片'));

    // {filename} 那一行确实包了 $this->sanitizeFilename(...)
    const fnameLine = IMAGE_SERVICE.split('\n').find((l) => l.includes("'{filename}'"));
    check('PHP 源码：{filename} 那一行包了 $this->sanitizeFilename(...)',
        !!fnameLine && fnameLine.includes('$this->sanitizeFilename('),
        fnameLine ? fnameLine.trim() : '(找不到)');
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
