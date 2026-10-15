/**
 * 看图器「顶屏」（工具栏自定义键 fit-edge）回归测试。
 *
 * 两类断言：
 *   A. 真实执行 —— 从 blade 源码里按花括号配对抠出 `applyFitEdgeToImageData` 的真身，
 *      用 new Function 还原成函数，喂假 viewer 调，逐条核对尺寸/位置/返回值与幂等性。
 *      （不手抄产品代码：抠出来的是什么就跑什么。）
 *   B. 源码文本 —— 工具栏键、CSS 图标、renderImage 包装守卫、全屏钩子、重置键没被覆盖。
 *
 * 跑法：cd tree/test && node fit-edge.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const BLADE = path.join(SRC, 'resources', 'views', 'user', 'images.blade.php');
const src = fs.readFileSync(BLADE, 'utf8');

// ---------------------------------------------------------------- 汇总
const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}
const APPROX = (a, b, eps = 1e-6) =>
    typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;
const show = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(6)) : JSON.stringify(v));

// ================================================================ A. 真实执行
// 从源码抠出 applyFitEdgeToImageData：定位 `const NAME =` 取其后第一个 `{`，花括号配对到闭合。
function extractArrowFn(text, name) {
    const marker = `const ${name} = `;
    const start = text.indexOf(marker);
    if (start < 0) throw new Error(`源码里找不到 ${marker}`);
    const brace = text.indexOf('{', start);
    if (brace < 0) throw new Error(`${name} 后面没有 {`);
    let depth = 0, i = brace;
    for (; i < text.length; i++) {
        const c = text[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    if (depth !== 0) throw new Error(`${name} 花括号没配对`);
    return text.slice(start, i);            // 含收尾的 `}`
}

let fitSrc = '';
try { fitSrc = extractArrowFn(src, 'applyFitEdgeToImageData'); } catch (e) { /* 下面断言报错 */ }

// 注意：new Function('viewer', ...) 必须**带上实参**调用，被测函数引用的 'viewer' 是它外层作用域里的
// 那个参数；只 build 不传参 ⇒ 里面读到 undefined（实测踩过）。
const buildFit = (viewer) => new Function('viewer', `${fitSrc};\nreturn applyFitEdgeToImageData;`)(viewer);

// 假 viewer / imageData
function makeViewer({ cw, ch, natW, natH, rotate = 0, init = {} }) {
    const imageData = Object.assign({
        naturalWidth: natW,
        naturalHeight: natH,
        width: 0, height: 0, x: 0, y: 0, left: 0, top: 0,
        ratio: 1, rotate,
    }, init);
    return { canvas: { clientWidth: cw, clientHeight: ch }, imageData };
}
function runFit(viewer) {
    // viewer 必须作为 new Function 的实参传进去：被测函数引用的是它外层作用域里的 viewer，
    // 不是箭头函数自己的参数（箭头函数不接参数，传进去会被忽略、里面读到 undefined）。
    let ret = undefined, err = null;
    try { ret = buildFit(viewer)(); } catch (e) { err = e; }
    return { ret, err };
}

console.log('\n[A0] 抠出来的函数真身');
{
    check('从 blade 里抠到 applyFitEdgeToImageData（未手抄）', fitSrc.startsWith('const applyFitEdgeToImageData = '),
        fitSrc.slice(0, 48).replace(/\n/g, ' '));
    check('抠出的片段含 min/ratio/isFinite（是那段算法）',
        fitSrc.includes('Math.min') && fitSrc.includes('isFinite') && fitSrc.includes('naturalWidth'));
    check('抠出的片段不含其它函数（边界切得干净）',
        ! fitSrc.includes('fitEdgeNow') && ! fitSrc.includes('return applyFitEdgeToImageData'));
}

console.log('\n[A1] 宽先够着：canvas 1000×800，nat 4000×2000（左右贴边、上下留空）');
const c1v = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 2000 });
const c1 = runFit(c1v);
{
    check('返回 true', c1.ret === true, `ret=${show(c1.ret)} err=${c1.err}`);
    check('ratio === 0.25', APPROX(c1v.imageData.ratio, 0.25), `ratio=${show(c1v.imageData.ratio)}`);
    check('width/height === 1000/500', APPROX(c1v.imageData.width, 1000) && APPROX(c1v.imageData.height, 500),
        `w=${show(c1v.imageData.width)} h=${show(c1v.imageData.height)}`);
    check('x/y === 0/150', APPROX(c1v.imageData.x, 0) && APPROX(c1v.imageData.y, 150),
        `x=${show(c1v.imageData.x)} y=${show(c1v.imageData.y)}`);
    check('左右贴边、上下留空（宽=画布宽）', APPROX(c1v.imageData.width, 1000) && c1v.imageData.height < 800,
        `w=${show(c1v.imageData.width)} / ch=800`);
    check('oldRatio 保留旧值（1）', c1v.imageData.oldRatio === 1, `oldRatio=${show(c1v.imageData.oldRatio)}`);
}

console.log('\n[A2] 高先够着：canvas 1000×800，nat 4000×8000（上下贴边）');
const c2v = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 8000 });
const c2 = runFit(c2v);
{
    check('返回 true', c2.ret === true, `ret=${show(c2.ret)} err=${c2.err}`);
    check('ratio === 0.1', APPROX(c2v.imageData.ratio, 0.1), `ratio=${show(c2v.imageData.ratio)}`);
    check('width/height === 400/800', APPROX(c2v.imageData.width, 400) && APPROX(c2v.imageData.height, 800),
        `w=${show(c2v.imageData.width)} h=${show(c2v.imageData.height)}`);
    check('x/y === 300/0', APPROX(c2v.imageData.x, 300) && APPROX(c2v.imageData.y, 0),
        `x=${show(c2v.imageData.x)} y=${show(c2v.imageData.y)}`);
    check('上下贴边（高=画布高）', APPROX(c2v.imageData.height, 800));
}

console.log('\n[A3] 旋转 90°：canvas 1000×800，nat 4000×2000（未旋转盒子 800×400，视觉占位 400×800 顶上下边）');
const c3v = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 2000, rotate: 90 });
const c3 = runFit(c3v);
{
    check('返回 true', c3.ret === true, `ret=${show(c3.ret)} err=${c3.err}`);
    check('ratio === 0.2（按视觉占位 2000×4000 算）', APPROX(c3v.imageData.ratio, 0.2), `ratio=${show(c3v.imageData.ratio)}`);
    check('width/height === 800/400（未旋转盒子尺寸）',
        APPROX(c3v.imageData.width, 800) && APPROX(c3v.imageData.height, 400),
        `w=${show(c3v.imageData.width)} h=${show(c3v.imageData.height)}`);
    check('x/y === 100/200', APPROX(c3v.imageData.x, 100) && APPROX(c3v.imageData.y, 200),
        `x=${show(c3v.imageData.x)} y=${show(c3v.imageData.y)}`);
    check('视觉占位 400×800 ⇒ 顶住上下边',
        APPROX(c3v.imageData.width / 2, 400) && APPROX(c3v.imageData.height * 2, 800));
}

console.log('\n[A4] rotate 270 / -90 / 450 等价于 90°（同一结果）');
{
    const variants = [270, -90, 450].map((r) => {
        const v = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 2000, rotate: r });
        return { r, ret: runFit(v).ret, d: v.imageData };
    });
    const same = (d) => APPROX(d.ratio, c3v.imageData.ratio) && APPROX(d.width, c3v.imageData.width)
        && APPROX(d.height, c3v.imageData.height) && APPROX(d.x, c3v.imageData.x) && APPROX(d.y, c3v.imageData.y);
    check('rotate=270 与 rotate=90 同结果', variants[0].ret === true && same(variants[0].d),
        `ratio=${show(variants[0].d.ratio)} w=${show(variants[0].d.width)} x=${show(variants[0].d.x)}`);
    check('rotate=-90 与 rotate=90 同结果', variants[1].ret === true && same(variants[1].d),
        `ratio=${show(variants[1].d.ratio)} w=${show(variants[1].d.width)} x=${show(variants[1].d.x)}`);
    check('rotate=450 与 rotate=90 同结果', variants[2].ret === true && same(variants[2].d),
        `ratio=${show(variants[2].d.ratio)} w=${show(variants[2].d.width)} x=${show(variants[2].d.x)}`);
}

console.log('\n[A5] 已经顶屏 ⇒ 返回 false 且一个字段都不改（幂等）');
{
    const fields = ['width', 'height', 'x', 'y', 'left', 'top', 'ratio', 'oldRatio', 'rotate', 'naturalWidth', 'naturalHeight'];
    const v = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 2000, init: { width: 1000, height: 500, x: 0, y: 150, left: 0, top: 150, ratio: 0.25 } });
    const before = JSON.stringify(v.imageData);
    const r = runFit(v);
    check('返回 false', r.ret === false, `ret=${show(r.ret)} err=${r.err}`);
    const changed = fields.filter((k) => ! Object.is(v.imageData[k], JSON.parse(before)[k]));
    check('未改动任何字段', changed.length === 0, changed.length ? 'changed=' + changed.join(',') : '全部原样');
    check('oldRatio 也没被写（早退在写字段之前）', ! ('oldRatio' in v.imageData) || v.imageData.oldRatio === undefined,
        `oldRatio=${show(v.imageData.oldRatio)}`);

    // 差 0.4px（< 0.5）也算已经顶屏 ⇒ false
    const v2 = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 2000, init: { width: 1000.4, height: 500 } });
    check('差 0.4px（<0.5）⇒ false（不算没顶屏）', runFit(v2).ret === false, `ret=${show(runFit(v2).ret)}`);

    // 差 0.6px（≥ 0.5）⇒ 视为没顶屏 ⇒ true，并写成目标值
    const v3 = makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 2000, init: { width: 1000.6, height: 500 } });
    const r3 = runFit(v3);
    check('差 0.6px（≥0.5）⇒ true 且写回 1000/500',
        r3.ret === true && APPROX(v3.imageData.width, 1000),
        `ret=${show(r3.ret)} w=${show(v3.imageData.width)}`);
}

console.log('\n[A6] 画布没尺寸 / nat 为 0 / 缺字段 ⇒ false 且不抛异常');
{
    const bad = [
        ['cw=0', makeViewer({ cw: 0, ch: 800, natW: 4000, natH: 2000 })],
        ['ch=0', makeViewer({ cw: 1000, ch: 0, natW: 4000, natH: 2000 })],
        ['naturalWidth=0', makeViewer({ cw: 1000, ch: 800, natW: 0, natH: 2000 })],
        ['naturalHeight=0', makeViewer({ cw: 1000, ch: 800, natW: 4000, natH: 0 })],
        ['缺 naturalWidth 字段', { canvas: { clientWidth: 1000, clientHeight: 800 }, imageData: { naturalHeight: 2000, width: 7, height: 7 } }],
        ['缺 imageData', { canvas: { clientWidth: 1000, clientHeight: 800 } }],
        ['缺 canvas', { imageData: { naturalWidth: 4000, naturalHeight: 2000, width: 7, height: 7 } }],
    ];
    for (const [label, v] of bad) {
        const r = runFit(v);
        const untouched = ! v.imageData || ! ('oldRatio' in v.imageData);
        check(`${label} ⇒ false 且不抛异常且未写字段`, r.ret === false && r.err === null && untouched,
            `ret=${show(r.ret)} err=${r.err ? r.err.message : 'null'}`);
    }
}

console.log('\n[A7] 极小图不越过库上限：canvas 1000×800，nat 2×1 ⇒ ratio===100（不是 500）');
const c7v = makeViewer({ cw: 1000, ch: 800, natW: 2, natH: 1 });
const c7 = runFit(c7v);
{
    check('ratio === 100', c7v.imageData.ratio === 100, `ratio=${show(c7v.imageData.ratio)}`);
    check('width/height === 200/100（按 100 倍，不是 500 倍）',
        APPROX(c7v.imageData.width, 200) && APPROX(c7v.imageData.height, 100),
        `w=${show(c7v.imageData.width)} h=${show(c7v.imageData.height)}`);
    check('返回 true', c7.ret === true, `ret=${show(c7.ret)}`);
}

console.log('\n[A8] 居中：x === (cw-width)/2、y === (ch-height)/2，且 left/top 同步等于 x/y');
{
    const cases = [
        ['用例1 宽先够着', c1v, 1000, 800],
        ['用例2 高先够着', c2v, 1000, 800],
        ['用例3 旋转 90°', c3v, 1000, 800],
        ['用例7 极小图', c7v, 1000, 800],
    ];
    for (const [label, v, cw, ch] of cases) {
        const d = v.imageData;
        const okCentered = APPROX(d.x, (cw - d.width) / 2) && APPROX(d.y, (ch - d.height) / 2);
        const okLeftTop = APPROX(d.left, d.x) && APPROX(d.top, d.y);
        check(`${label}：水平居中 x===(cw-width)/2`, okCentered || APPROX(d.x, (cw - d.width) / 2),
            `x=${show(d.x)} expect=${show((cw - d.width) / 2)}`);
        check(`${label}：left/top 同步等于 x/y`, okLeftTop, `left=${show(d.left)} top=${show(d.top)}`);
    }
}

// ================================================================ B. 源码文本
console.log('\n[B1] 工具栏：fit-edge 在、one-to-one 已无、reset 没被覆盖');
{
    const tbStart = src.indexOf('toolbar: {');
    const tbEnd = src.indexOf('slideOnTouch', tbStart);
    const toolbar = (tbStart >= 0 && tbEnd > tbStart) ? src.slice(tbStart, tbEnd) : '';
    check('定位到工具栏区间', toolbar.length > 200, `toolbar 区间 ${toolbar.length} 字符`);

    const fitEdgeKey = /'fit-edge'\s*:\s*\{\s*show:\s*true\s*,\s*click:\s*\(\)\s*=>\s*fitEdgeNow\(\)\s*\}/.exec(toolbar);
    check("工具栏有 'fit-edge': { show: true, click: () => fitEdgeNow() }", !!fitEdgeKey,
        fitEdgeKey ? fitEdgeKey[0] : '未匹配');

    const oneToOneCount = (toolbar.match(/one-to-one/g) || []).length;
    check('工具栏区间内已无 one-to-one', oneToOneCount === 0, `出现 ${oneToOneCount} 次`);
    check('全文件都不再有 one-to-one', ! src.includes('one-to-one'));

    check('「重置」键没被覆盖：工具栏里仍是 reset: true', /\breset\s*:\s*true\b/.test(toolbar),
        (/\breset\s*:\s*true\b/.exec(toolbar) || ['未找到 reset: true'])[0]);
}

console.log('\n[B2] CSS：li.viewer-fit-edge:before 图标规则');
{
    const m = /html\s+\.viewer-toolbar\s*>\s*ul\s*>\s*li\.viewer-fit-edge:before\s*\{([\s\S]*?)\}/.exec(src);
    const body = m ? m[1] : '';
    check('存在 li.viewer-fit-edge:before 规则', !!m);
    check("含 content: ''", /content:\s*''/.test(body));
    check('20×20 盒子', /width:\s*20px/.test(body) && /height:\s*20px/.test(body));
    check('background-size: 14px 14px', /background-size:\s*14px\s+14px/.test(body));
    check('内联 SVG data URI', /background-image:\s*url\("data:image\/svg\+xml/.test(body));
    const paths = (body.match(/%3Cpath\b/g) || []).length;
    check('SVG 里有 8 条 path（四个箭头）', paths === 8, `path ${paths} 条`);
}

console.log('\n[B3] viewer.renderImage 包装的守卫');
{
    const s = src.indexOf('const rawRenderImage');
    const e = src.indexOf('「重置」键不用改', s);
    const wrap = (s >= 0 && e > s) ? src.slice(s, e) : '';
    check('定位到 rawRenderImage 包装区间', wrap.length > 100, `${wrap.length} 字符`);
    check('用 rawRenderImage 包住原函数', wrap.includes('const rawRenderImage = viewer.renderImage.bind(viewer)')
        && /viewer\.renderImage\s*=\s*function/.test(wrap));
    for (const token of ['fsFitMode', '! viewer.zooming', '! viewer.moving', '! viewer.rotating', '! viewer.scaling', '! viewer.played']) {
        check(`包装里出现守卫 ${token}`, wrap.includes(token));
    }
    check('全屏模式下才改尺寸（fsFitMode 是首要条件）', /if\s*\(\s*fsFitMode\s*&&/.test(wrap));
}

console.log('\n[B4] 全屏钩子：两族事件 + 进入/退出两条分支');
{
    check('挂在 fullscreenchange 上', src.includes("document.addEventListener('fullscreenchange', onViewerFullscreenResize)"));
    check('挂在 webkitfullscreenchange 上', src.includes("document.addEventListener('webkitfullscreenchange', onViewerFullscreenResize)"));

    const s = src.indexOf('const onViewerFullscreenResize');
    const e = src.indexOf('全屏里鼠标动一下', s);
    const fn = (s >= 0 && e > s) ? src.slice(s, e) : '';
    check('定位到 onViewerFullscreenResize 函数体', fn.length > 100, `${fn.length} 字符`);
    check('进入分支：250ms 兜底计时', /setTimeout\(/.test(fn) && /\b250\b/.test(fn),
        (/setTimeout\([\s\S]*?\},\s*(\d+)\)/.exec(fn) || [, '?'])[1] + 'ms');
    check('进入分支：置 fsFitMode 为 true', /fsFitMode\s*=\s*on\b/.test(fn) && /if\s*\(on\)\s*\{/.test(fn));
    check('退出分支：走 viewer.initImage 重算', /viewer\.initImage\(/.test(fn));
    check('退出分支：requestAnimationFrame 后再重算', /requestAnimationFrame\(/.test(fn));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => ! r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
