#!/usr/bin/env node
/**
 * 侧栏「存储用量」在上传/删图之后能不能正确更新。
 *
 * 背景（真实故障）：侧栏那条用量条从 <progress> 换成了「按策略分段的条」，模板里已经没有
 * <progress> 元素，而 utils.setCapacityProgress 还在用 $progress.find('progress').val()
 * 取基准 ⇒ 拿到 undefined ⇒ used 变 NaN ⇒ 右侧「已用」显示成 "NaN undefined"，
 * 而且一直挂到整页刷新才恢复（上传一张图就当场可见）。
 *
 * 这个测试不重抄一遍公式，而是把两处**真身**抠出来在 jsdom 里跑：
 *   · src/resources/js/app.js —— 源码
 *   · src/public/js/app.js    —— 浏览器真正加载的那份压缩产物
 * 同一组断言跑两遍：源码↔产物不许漂；另外核对模板侧的契约（id / data-used-kb /
 * data-capacity-kb / data-share），那几项就是 JS 能否拿到基准与占比的全部依赖。
 *
 * 依赖：jsdom + jquery（见 test/package.json）。运行：node test/sidebar-capacity.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');
const read = (p) => fs.readFileSync(p, 'utf8');
const JQUERY_SRC = read(path.join(here, 'node_modules/jquery/dist/jquery.js'));

let pass = 0;
let fail = 0;
const assert = (cond, label, detail = '') => {
    if (cond) {
        pass++;
        console.log(`  PASS  ${label}`);
    } else {
        fail++;
        console.log(`  FAIL  ${label}${detail ? '  → ' + detail : ''}`);
    }
};
const section = (name) => console.log(`\n[${name}]`);

/* ── 从真身里抠出 formatSize + setCapacityProgress（不做任何改写） ────────────── */
const sliceBetween = (text, startAnchor, endAnchor, what) => {
    const a = text.indexOf(startAnchor);
    const b = text.indexOf(endAnchor, a + startAnchor.length);
    if (a < 0 || b < 0 || b <= a) throw new Error(`抠不出 ${what}：锚点 ${startAnchor} / ${endAnchor}`);
    return text.slice(a, b);
};

// 分段条的类名从组件里抠（不硬编码）：类名被改掉时下面的真跑用例会一起红，
// 而不是「模板改了、测试还在测一个模板里不存在的类名」那种假绿。
const segComponent = read(path.join(srcRoot, 'resources/views/components/storage-segments.blade.php'));
const SEG_CLASS = (segComponent.match(/class="([^"]*\bls-seg\b[^"]*)"/) || [])[1] || 'ls-seg';

const sourceJs = read(path.join(srcRoot, 'resources/js/app.js'));
const bundleJs = read(path.join(srcRoot, 'public/js/app.js'));

// 源码：两个方法紧挨着，直接从第一个方法头切到 guid()
const SOURCE_METHODS = sliceBetween(sourceJs, 'formatSize(bytes, decimal) {', 'guid() {', '源码方法体');
// 产物：压缩后是对象属性写法，同样从 formatSize 切到 guid
const BUNDLE_METHODS = sliceBetween(bundleJs, 'formatSize:function', ',guid:function', '产物方法体');
assert((bundleJs.match(/setCapacityProgress:function/g) || []).length === 1,
    '产物里 setCapacityProgress 仍存在且唯一（抠之前先确认锚点没被改名）');

// 关键：对象字面量必须在**窗口自己的作用域里**求值 —— 源码里 $ 是全局 jQuery，
// 而 setCapacityProgress 内部又调 utils.formatSize（utils 就是它自己所在的这个对象）。
// 用外层 new Function 建出来的话 $ 会解析成 undefined（实测踩过：TypeError: $ is not a function）。
const buildUtils = (win, methods, label) => {
    let obj;
    try {
        obj = win.eval(`({ ${methods} })`);
    } catch (e) {
        throw new Error(`${label} 抠出的方法建不起来：${e.message}`);
    }
    if (typeof obj.formatSize !== 'function' || typeof obj.setCapacityProgress !== 'function') {
        throw new Error(`${label} 抠出来的对象缺少方法`);
    }
    win.utils = obj; // 源码里的 utils.formatSize 走全局 utils

    return obj;
};

/* ── 夹具与期望值（期望值在测试里独立算一遍，不复用被测公式） ────────────────── */
const FIXTURE = (usedKb, capKb, shares) => `
<div id="capacity-progress" data-used-kb="${usedKb}" data-capacity-kb="${capKb}">
    <div class="ls-segbar">
${shares.map((s) => `        <div class="${SEG_CLASS}" data-share="${s}" style="width:0%"></div>`).join('\n')}
    </div>
    <p class="meta"><span class="used">x</span> / <span class="total">y</span></p>
</div>`;
const LEGACY_FIXTURE = `
<div id="capacity-progress">
    <progress value="100" max="1000"></progress>
    <p class="meta"><span class="used">x</span> / <span class="total">y</span></p>
</div>`;

const KB = 1024;
const EXPECT_UNITS = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
// "893.16 MB" → { value: 893.16, bytes: 936529920 }
const parseSize = (text) => {
    const m = String(text).trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
    if (!m) return null;
    const unit = m[2].toUpperCase();
    return { value: parseFloat(m[1]), unit, bytes: parseFloat(m[1]) * EXPECT_UNITS[unit] };
};
const expectBytes = (kb) => kb * KB;
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function runVariant(label, methods) {
    section(label);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    const { window } = dom;
    window.eval(JQUERY_SRC);
    const $ = window.jQuery;
    assert(typeof $ === 'function', 'jQuery 在 jsdom 里可用');
    const utils = buildUtils(window, methods, label);

    const boot = (html) => { window.document.body.innerHTML = html; return $('#capacity-progress'); };

    // ① 上传一张图（+2048 KB）：已用数字必须跟着涨，且不许出现 NaN
    const used0 = 912532;
    const cap0 = 31457280;
    const shares = [88.86, 7.48, 3.66];
    let $box = boot(FIXTURE(used0, cap0, shares));
    utils.setCapacityProgress.call(utils, 2048);

    const usedText = $box.find('span.used').text();
    const totalText = $box.find('span.total').text();
    assert(!/NaN|undefined/.test(usedText + totalText), '上传后不出现 "NaN/undefined"（这次修复的核心）',
        `已用="${usedText}" 总量="${totalText}"`);
    const usedParsed = parseSize(usedText);
    assert(usedParsed !== null, '已用文案可解析成「数值 + 单位」', `已用="${usedText}"`);
    if (usedParsed) {
        assert(near(usedParsed.bytes, expectBytes(used0 + 2048), 0.005),
            '已用 = (原基准 + 本次上传)（顺着涨，不是 NaN 也不是原地不动）',
            `${usedText} vs 期望 ≈ ${expectBytes(used0 + 2048)} B`);
    }
    const totalParsed = parseSize(totalText);
    assert(totalParsed !== null && near(totalParsed.bytes, expectBytes(cap0), 0.01),
        '总量按 data-capacity-kb 渲染', `总量="${totalText}"`);

    // ② 分段条宽度 = 新占比 × data-share（这层是给侧栏那条彩色分段用的）
    const pct = Math.min(100, (used0 + 2048) / cap0 * 100);
    $box.find('.ls-seg').each(function (idx) {
        const want = (pct * shares[idx] / 100).toFixed(4) + '%';
        const got = (this.style.width || '').trim();
        assert(got === want, `第 ${idx + 1} 段宽度 = 新占比 × share（${shares[idx]}%）`, `期望 ${want}，实际 ${got || '(空)'}`);
    });

    // ③ data-* 被就地更新（下次再调用要接着这个基准走）
    assert(parseFloat($box.attr('data-used-kb')) === used0 + 2048, 'data-used-kb 就地更新');

    // ④ 删图（负数）：数字要降下来
    utils.setCapacityProgress.call(utils, -1024);
    const afterDel = parseSize($box.find('span.used').text());
    assert(afterDel !== null && near(afterDel.bytes, expectBytes(used0 + 2048 - 1024), 0.005),
        '删图后已用跟着降', `已用="${$box.find('span.used').text()}"`);

    // ⑤ 老模板（还有 <progress>）仍要能跑：data-* 是首选，progress 是兜底
    $box = boot(LEGACY_FIXTURE);
    utils.setCapacityProgress.call(utils, 100);
    const legacy = parseSize($box.find('span.used').text());
    assert(legacy !== null && near(legacy.bytes, expectBytes(200), 0.01),
        '老模板走 <progress> 兜底也不炸（100 + 100）', `已用="${$box.find('span.used').text()}"`);

    // ⑥ 容量为 0（新站/异常值）：不许 NaN，段宽 0
    $box = boot(FIXTURE(0, 0, shares));
    utils.setCapacityProgress.call(utils, 0);
    assert(!/NaN/.test($box.text()), '容量为 0 时不出 NaN', $box.text().replace(/\s+/g, ' ').slice(0, 80));
    // 按数值判（jsdom 的 CSS 解析会把 "0.0000%" 归一成 "0%"，别写死字符串）
    assert(parseFloat($box.find('.ls-seg').eq(0)[0].style.width) === 0, '容量为 0 时段宽 0');

    // ⑦ 侧栏不在页面上时静默返回（别抛错打断上传流程）
    window.document.body.innerHTML = '<div id="other"></div>';
    let threw = null;
    try {
        utils.setCapacityProgress.call(utils, 10);
    } catch (e) {
        threw = e;
    }
    assert(threw === null, '页面上没有侧栏用量条时静默返回', threw ? String(threw.message) : '');

    dom.window.close();
}

runVariant('源码 src/resources/js/app.js', SOURCE_METHODS);
runVariant('产物 src/public/js/app.js（线上加载的那份）', BUNDLE_METHODS);

/* ── 模板契约：JS 依赖的那几个钩子必须在模板里 ──────────────────────────────── */
section('模板契约（JS ↔ 模板）');
const sidebarRaw = read(path.join(srcRoot, 'resources/views/layouts/sidebar.blade.php'));
// 断言先剥掉 blade 注释：注释里为了说明历史会提到 <progress> / #capacity-progress 这类字样，
// 直接搜全文会把「解释为什么改」的一句注释当成「还在用旧元素」判红（实测踩过）。
const sidebar = sidebarRaw.replace(/\{\{--[\s\S]*?--\}\}/g, '');
assert(/id="capacity-progress"/.test(sidebar), '侧栏有 #capacity-progress');
assert(/data-used-kb="\{\{/.test(sidebar), '侧栏给了 data-used-kb 基准');
assert(/data-capacity-kb="\{\{/.test(sidebar), '侧栏给了 data-capacity-kb 基准');
assert(/<progress/.test(sidebar) === false,
    '侧栏已不再使用 <progress>（换成分段条后，基准只能走 data-*）',
    (sidebar.match(/[^\n]*<progress[^\n]*/) || [''])[0].trim().slice(0, 100));
assert(/<progress/.test(sidebarRaw), '（附带确认：上面剥掉的注释里确实提到了旧元素，说明这条断言不是空转）');

assert(/data-share=/.test(segComponent), '分段条组件为每段输出 data-share');
assert(segComponent.includes(`class="${SEG_CLASS}"`), `上面真跑用例用的就是组件里的类名 ${SEG_CLASS}（不是硬编码的另一套）`);
assert(/data-share="\{\{ round\(\$segment\['share'\], \d+\) \}\}"/.test(segComponent),
    'data-share 绑的是算出来的占比（写死 100 之类会让容量条永远满格而测试照绿）',
    (segComponent.match(/data-share="[^"]*"/) || [''])[0]);
assert(/style="width: \{\{ round\(\$width, \d+\) \}\}%/.test(segComponent),
    '段宽同样绑的是算出来的值');

const layoutsApp = read(path.join(srcRoot, 'resources/views/layouts/app.blade.php'));
assert(/js\/app\.js/.test(layoutsApp), '页面加载的确实是 src/public/js/app.js（测的就是线上那份）');

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
