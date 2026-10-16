/**
 * 看图器「顶屏」（图片初始状态：等比缩放到先够得着的边贴住画布）回归测试。
 *
 * 两类断言：
 *   A. 真实执行 —— 从 blade 源码里按花括号配对抠出 `applyFitEdgeToImageData` 的真身（[A12] 另外抠 `isFit`），
 *      用 new Function 还原成函数，喂假 viewer 调，逐条核对尺寸/位置/返回值、幂等性、
 *      贴边那一维的上限夹紧、initialImageData 快照镜像，以及模拟库的 reset() 之后是否仍落回顶屏；
 *      [A12] 专测 isFit 的「完整装下」判据（边界是画布、不是 viewerData）。
 *      （不手抄产品代码：抠出来的是什么就跑什么。）
 *   B. 源码文本 —— 工具栏（download 在最左、fit-edge 已删）、CSS 图标、renderImage 包装
 *      （不再有 fsFitMode 前置条件）、全屏钩子、快照镜像、非全屏自隐、灵敏度常量、重置键没被覆盖。
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

console.log('\n[A9] 行为断言：贴边那一维夹到 viewerData 以内 + 快照镜像 + 模拟库的 reset()');
{
    // 假 viewer：canvas / viewerData / imageData / initialImageData 都给全（与库真实的字段形状一致）
    const makeLive = ({ cw, ch, vw, vh, natW, natH, rotate = 0, ini }) => ({
        canvas: { clientWidth: cw, clientHeight: ch },
        viewerData: { width: vw, height: vh },
        imageData: { naturalWidth: natW, naturalHeight: natH, width: 0, height: 0,
            x: 0, y: 0, left: 0, top: 0, ratio: 1, rotate: rotate, oldRatio: 1 },
        initialImageData: Object.assign({ width: 0, height: 0, x: 0, y: 0, left: 0, top: 0,
            ratio: 1, oldRatio: 1, rotate: 0, scaleX: 1, scaleY: 1 }, ini),
    });

    // ① 需求里点名的尺寸：canvas 715×695、viewerData 723×695、原图 1000×4000（高先够着，零余量）
    {
        const v = makeLive({ cw: 715, ch: 695, vw: 723, vh: 695, natW: 1000, natH: 4000,
            ini: { rotate: 90, scaleX: -1, scaleY: 1 } });
        const r = runFit(v);
        check('① 返回 true', r.ret === true, `ret=${show(r.ret)} err=${r.err ? r.err.message : 'null'}`);
        check('① 贴边那一维（高）<= viewerData.height', v.imageData.height <= v.viewerData.height,
            `h=${show(v.imageData.height)} vh=${v.viewerData.height}`);
        check('① 宽也 <= viewerData.width 且 <= canvas.clientWidth',
            v.imageData.width <= v.viewerData.width && v.imageData.width <= v.canvas.clientWidth,
            `w=${show(v.imageData.width)} vw=${v.viewerData.width} cw=${v.canvas.clientWidth}`);
    }

    // ② 真有夹紧效果的一例：raw = 146 * (600/146) = 600.0000000000001 > 画布 600（不夹就溢出画布）
    {
        const raw = 146 * (600 / 146);
        check('② 前置事实：这一类尺寸不夹会算出 > 画布的值', raw > 600, `raw=${show(raw)}`);
        const v = makeLive({ cw: 600, ch: 800, vw: 601, vh: 800, natW: 146, natH: 194 });
        const r = runFit(v);
        check('② 夹到 <= canvas.clientWidth（不溢出画布）', r.ret === true && v.imageData.width <= 600,
            `w=${show(v.imageData.width)} cw=600`);
        check('② 夹后就是贴边值 600（不是 600.0000000000001）', v.imageData.width === 600,
            `w=${show(v.imageData.width)}`);
    }

    // ③ 快照镜像：几何跟着顶屏，rotate/scaleX/scaleY 原样保留，且不是整份替换对象
    {
        const v = makeLive({ cw: 715, ch: 695, vw: 723, vh: 695, natW: 1000, natH: 4000,
            ini: { rotate: 90, scaleX: -1, scaleY: 1 } });
        const snap = v.initialImageData;
        runFit(v);
        const d = v.imageData;
        const s = v.initialImageData;
        check('③ initialImageData 还是同一个对象（没被整份替换）', s === snap, s === snap ? '同一引用' : '对象被换掉了');
        check('③ 几何镜像成顶屏值（width/height/ratio/x/y/left/top）',
            s.width === d.width && s.height === d.height && s.ratio === d.ratio
            && s.x === d.x && s.y === d.y && s.left === d.left && s.top === d.top,
            `ini w=${show(s.width)} h=${show(s.height)} x=${show(s.x)} / img w=${show(d.width)} h=${show(d.height)} x=${show(d.x)}`);
        check('③ rotate/scaleX/scaleY 一个都没被动过',
            s.rotate === 90 && s.scaleX === -1 && s.scaleY === 1,
            `rotate=${show(s.rotate)} scaleX=${show(s.scaleX)} scaleY=${show(s.scaleY)}`);
    }

    // ④ 模拟库的 reset()：imageData = { ...initialImageData } 之后，几何仍是顶屏值
    {
        const v = makeLive({ cw: 715, ch: 695, vw: 723, vh: 695, natW: 1000, natH: 4000 });
        runFit(v);
        const fit = { w: v.imageData.width, h: v.imageData.height, x: v.imageData.x,
            y: v.imageData.y, r: v.imageData.ratio };
        // 库的 reset() 干的就是这一句（viewer.js: a = l({}, this.initialImageData)）
        v.imageData = Object.assign({}, v.initialImageData);
        check('④ reset 后宽高仍是顶屏值',
            v.imageData.width === fit.w && v.imageData.height === fit.h,
            `w=${show(v.imageData.width)} h=${show(v.imageData.height)}（顶屏 ${show(fit.w)}×${show(fit.h)}）`);
        check('④ reset 后位置/比例仍是顶屏值',
            v.imageData.x === fit.x && v.imageData.y === fit.y && v.imageData.ratio === fit.r,
            `x=${show(v.imageData.x)} y=${show(v.imageData.y)} ratio=${show(v.imageData.ratio)}`);
        check('④ reset 后贴边那一维仍 <= viewerData.height', v.imageData.height <= 695, `h=${show(v.imageData.height)}`);
    }
}

console.log('\n[A10] 旋转态等比：盒子 w/h 比恒等于 natW/natH（夹紧只乘一个系数，不把图拉扁）');
{
    const cases = [
        { label: '500×500 画布 + 1000×500 + rotate90', cw: 500, ch: 500, natW: 1000, natH: 500, expW: 500, expH: 250 },
        { label: '390×695 画布 + 1000×500 + rotate90', cw: 390, ch: 695, natW: 1000, natH: 500, expW: 695, expH: 347.5 },
        { label: '700×800 画布 + 1000×4000 + rotate90', cw: 700, ch: 800, natW: 1000, natH: 4000, expW: 175, expH: 700 },
    ];
    for (const c of cases) {
        const v = makeViewer({ cw: c.cw, ch: c.ch, natW: c.natW, natH: c.natH, rotate: 90 });
        v.viewerData = { width: c.cw, height: c.ch };   // viewerData 与画布同
        const r = runFit(v);
        const d = v.imageData;
        check(`${c.label}：返回 true 且写回盒子 ${c.expW}×${c.expH}`,
            r.ret === true && APPROX(d.width, c.expW) && APPROX(d.height, c.expH),
            `ret=${show(r.ret)} w=${show(d.width)} h=${show(d.height)} ${c.expW}×${c.expH}`);
        check(`${c.label}：width/height == naturalWidth/naturalHeight（1e-9 内）`,
            Math.abs(d.width / d.height - d.naturalWidth / d.naturalHeight) <= 1e-9,
            `box=${show(d.width / d.height)} nat=${show(d.naturalWidth / d.naturalHeight)}`);
    }
}

console.log('\n[A11] 旋转态贴边：按旋转后的视觉包围盒，至少有一对边顶住画布');
{
    // 390×695 画布 + 1000×500 横图 + rotate90 ⇒ 未旋转盒子 695×347.5，视觉占位 347.5×695
    const v = makeViewer({ cw: 390, ch: 695, natW: 1000, natH: 500, rotate: 90 });
    v.viewerData = { width: 390, height: 695 };
    const r = runFit(v);
    const d = v.imageData;
    const visW = d.height, visH = d.width;                 // 旋转 90°：视觉占位 = 高 × 宽
    const cx = d.x + d.width / 2, cy = d.y + d.height / 2; // 旋转不改中心
    const left = cx - visW / 2, right = cx + visW / 2, top = cy - visH / 2, bottom = cy + visH / 2;
    check('盒子 695×347.5', r.ret === true && APPROX(d.width, 695) && APPROX(d.height, 347.5),
        `w=${show(d.width)} h=${show(d.height)}`);
    check('视觉占位 347.5×695：上下两条边顶住画布（top≈0、bottom≈ch）',
        APPROX(top, 0, 0.5) && APPROX(bottom, 695, 0.5),
        `top=${show(top)} bottom=${show(bottom)} ch=695`);
    check('左右不超出画布（居中、留白）',
        left >= -0.5 && right <= 390 + 0.5, `left=${show(left)} right=${show(right)}`);
}

console.log('\n[A12] isFit 真实执行：抠出真身；边界是**画布**（不是 viewerData）、按视觉包围盒判「完整装下」');
{
    let isFitSrc = '';
    try { isFitSrc = extractArrowFn(src, 'isFit'); } catch (e) { /* 下面断言报错 */ }
    const buildIsFit = (viewer) => new Function('viewer', `${isFitSrc};\nreturn isFit;`)(viewer);
    check('从 blade 里抠到 isFit（未手抄）', isFitSrc.startsWith('const isFit = '), isFitSrc.slice(0, 32).replace(/\n/g, ' '));
    check('抠出的判据读的是 viewer.canvas 的 clientWidth/clientHeight（边界=画布，不再读 viewerData）',
        (() => {
            // 注释里会解释「为什么不用 viewerData」，先去掉注释再判，避免把说明文字当成代码
            const body = isFitSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
            return /const canvas = viewer\.canvas;/.test(body)
                && /canvas\.clientWidth/.test(body) && /canvas\.clientHeight/.test(body)
                && ! /viewerData/.test(body);
        })(),
        /const canvas = viewer\.canvas;/.test(isFitSrc) ? '读 canvas' : '没读到 canvas');
    check('抠出的判据是「中心 ± 视觉占位/2」四条比较 + ±0.5 容差（旋转不改中心）',
        /cx - w \/ 2 >= -0\.5 && cy - h \/ 2 >= -0\.5/.test(isFitSrc)
        && /cx \+ w \/ 2 <= bw \+ 0\.5 && cy \+ h \/ 2 <= bh \+ 0\.5/.test(isFitSrc));

    // ① 用真函数跑出来的 rotate90 顶屏几何（x 天生为负），连画布一起喂给 isFit
    const v = makeViewer({ cw: 390, ch: 695, natW: 1000, natH: 500, rotate: 90 });
    v.viewerData = { width: 390, height: 695 };
    runFit(v);
    const box390 = { imageData: v.imageData, canvas: { clientWidth: 390, clientHeight: 695 }, viewerData: v.viewerData };
    check('顶屏盒 x = -152.5（旋转态就是负值）', APPROX(v.imageData.x, -152.5), `x=${show(v.imageData.x)}`);
    check('① isFit() === true（按视觉包围盒判；直接拿未旋转 x/y 当左上角会误判成「放大态」）',
        buildIsFit(box390)() === true, `isFit=${buildIsFit(box390)()}`);

    // ② ★ 边界就是画布：画布 800×600 比 viewerData 700×600 宽 ⇒ 同一份**真跑**几何，两种口径结论相反
    const v2 = makeViewer({ cw: 800, ch: 600, natW: 4000, natH: 2000 });
    v2.viewerData = { width: 700, height: 600 };
    const r2 = runFit(v2);
    const d2 = v2.imageData;
    const box800 = { imageData: d2, canvas: { clientWidth: 800, clientHeight: 600 }, viewerData: v2.viewerData };
    check('② 真跑几何 = 700×350 @ (50,125)（宽度被 viewerData 夹到 700，居中却是按**画布**算的）',
        r2.ret === true && APPROX(d2.width, 700) && APPROX(d2.height, 350)
        && APPROX(d2.x, 50) && APPROX(d2.y, 125),
        `w=${show(d2.width)} h=${show(d2.height)} x=${show(d2.x)} y=${show(d2.y)}`);
    // 旧口径（上限拿 viewerData 当边界）：同一份几何
    const oldFit = (d, vw, vh) => {
        const rot = ((d.rotate || 0) % 180 + 180) % 180 === 90;
        const w = rot ? d.height : d.width;
        const h = rot ? d.width : d.height;
        const cx = d.x + d.width / 2;
        const cy = d.y + d.height / 2;
        return cx - w / 2 >= -0.5 && cy - h / 2 >= -0.5 && cx + w / 2 <= vw + 0.5 && cy + h / 2 <= vh + 0.5;
    };
    check('② 同一几何：旧口径（上限 = viewerData 700×600）判 false ⇒ 右边缘 750 > 700.5',
        oldFit(d2, v2.viewerData.width, v2.viewerData.height) === false,
        `cx+w/2=${show(d2.x + d2.width)} vw=${v2.viewerData.width}`);
    check('★ ② 新口径（上限 = 画布 800×600）判 true ⇒ 边界是画布，不是 viewerData',
        buildIsFit(box800)() === true, `isFit=${buildIsFit(box800)()}`);
    check('② 连 viewerData 都不给也照样判（isFit 已与 viewerData 解耦）',
        buildIsFit({ imageData: d2, canvas: { clientWidth: 800, clientHeight: 600 } })() === true);

    // ③ 明显溢出：x 不动、width 再 ×1.5
    const d3 = Object.assign({}, v.imageData, { width: v.imageData.width * 1.5 });
    check('③ width ×1.5（x 不动、明显溢出）⇒ isFit() === false',
        buildIsFit({ imageData: d3, canvas: { clientWidth: 390, clientHeight: 695 }, viewerData: v.viewerData })() === false,
        `w=${show(d3.width)} isFit=${buildIsFit({ imageData: d3, canvas: { clientWidth: 390, clientHeight: 695 } })()}`);

    // ④ 缺画布 / 画布零尺寸 ⇒ false（早退，不抛异常）
    const noCanvas = [
        ['没有 canvas 字段', { imageData: v.imageData, viewerData: v.viewerData }],
        ['canvas.clientWidth = 0', { imageData: v.imageData, canvas: { clientWidth: 0, clientHeight: 695 } }],
        ['canvas.clientHeight = 0', { imageData: v.imageData, canvas: { clientWidth: 390, clientHeight: 0 } }],
        ['没有 imageData', { canvas: { clientWidth: 390, clientHeight: 695 } }],
    ];
    for (const [label, box] of noCanvas) {
        let got = null, err = null;
        try { got = buildIsFit(box)(); } catch (e) { err = e; }
        check(`④ ${label} ⇒ false 且不抛异常`, got === false && err === null,
            `isFit=${got} err=${err ? err.message : 'null'}`);
    }

    // ⑤ 还装在画布内（缩到 0.9×）⇒ 仍是 true
    const smaller = Object.assign({}, v.imageData, { width: v.imageData.width * 0.9, height: v.imageData.height * 0.9 });
    check('⑤ 缩到 0.9×（仍在画布内）⇒ true',
        buildIsFit({ imageData: smaller, canvas: { clientWidth: 390, clientHeight: 695 } })() === true,
        `w=${show(smaller.width)} h=${show(smaller.height)}`);
}

console.log('\n[A13] 快照是未旋转口径：initialImageData 用 fitFor(false)，reset 后仍等比且不超 viewerData');
{
    // 715×695 画布 + 1000×4000 + rotate90 ⇒ imageData 178.75×715，快照应 173.75×695
    const v = makeViewer({ cw: 715, ch: 695, natW: 1000, natH: 4000, rotate: 90 });
    v.viewerData = { width: 715, height: 695 };
    v.initialImageData = { width: 0, height: 0, x: 0, y: 0, left: 0, top: 0, ratio: 1, oldRatio: 1,
        rotate: 0, scaleX: 1, scaleY: 1 };
    const r = runFit(v);
    const d = v.imageData, s = v.initialImageData;
    check('imageData（当前旋转口径）盒子 178.75×715',
        r.ret === true && APPROX(d.width, 178.75) && APPROX(d.height, 715),
        `w=${show(d.width)} h=${show(d.height)}`);
    check('快照是未旋转口径 173.75×695（≠ imageData 的 178.75×715）',
        APPROX(s.width, 173.75) && APPROX(s.height, 695) && (s.width !== d.width || s.height !== d.height),
        `ini w=${show(s.width)} h=${show(s.height)} / img w=${show(d.width)} h=${show(d.height)}`);
    check('快照仍等比（w/h == natW/natH）', Math.abs(s.width / s.height - 1000 / 4000) <= 1e-9,
        `ini aspect=${show(s.width / s.height)}`);

    // 模拟库的 reset()：imageData = { ...initialImageData }
    v.imageData = Object.assign({}, v.initialImageData);
    const d2 = v.imageData;
    check('reset 后仍等比', Math.abs(d2.width / d2.height - 1000 / 4000) <= 1e-9, `aspect=${show(d2.width / d2.height)}`);
    check('reset 后不超出 viewerData', d2.width <= v.viewerData.width && d2.height <= v.viewerData.height,
        `w=${show(d2.width)} vw=${v.viewerData.width} / h=${show(d2.height)} vh=${v.viewerData.height}`);
    check('reset 后位置/比例即快照值（与快照逐字段相等）',
        d2.x === s.x && d2.y === s.y && d2.ratio === s.ratio && d2.left === s.left && d2.top === s.top,
        `x=${show(d2.x)} y=${show(d2.y)} ratio=${show(d2.ratio)}`);
}

console.log('\n[A14] 浮点夹紧有区分力：natW*(cw/natW) 会算出 > 画布，必须夹回 ≤ 画布');
{
    const raw = 146 * (600 / 146);
    check('前置事实：146*(600/146) = 600.0000000000001 > 600（不夹就溢出画布）',
        raw > 600 && raw === 600.0000000000001, `raw=${raw}`);
    const v = makeViewer({ cw: 600, ch: 800, natW: 146, natH: 194 });
    v.viewerData = { width: 601, height: 800 };
    const r = runFit(v);
    check('实现写回 width <= 600（不溢出画布）', r.ret === true && v.imageData.width <= 600,
        `w=${show(v.imageData.width)} cw=600`);
    check('且写回 width <= viewerData.width', v.imageData.width <= v.viewerData.width,
        `w=${show(v.imageData.width)} vw=${v.viewerData.width}`);
}

// ================================================================ B. 源码文本
console.log('\n[B1] 工具栏：download 在最左、fit-edge / one-to-one 都已移除、reset 没被覆盖');
{
    const tbStart = src.indexOf('toolbar: {');
    const tbEnd = src.indexOf('slideOnTouch', tbStart);
    const toolbar = (tbStart >= 0 && tbEnd > tbStart) ? src.slice(tbStart, tbEnd) : '';
    check('定位到工具栏区间', toolbar.length > 200, `toolbar 区间 ${toolbar.length} 字符`);

    const dlKey = /download\s*:\s*\{\s*show:\s*true\s*,\s*click:\s*\(\)\s*=>\s*downloadViewerImage\(\)\s*\}/.exec(toolbar);
    check("工具栏最左是 download: { show: true, click: () => downloadViewerImage() }", !!dlKey,
        dlKey ? dlKey[0] : '未匹配');

    check('「顶屏」键（fit-edge）已从工具栏移除', ! toolbar.includes('fit-edge'));
    check('fitEdgeNow 这个函数在全文件里也已删掉', ! src.includes('fitEdgeNow'));

    const oneToOneCount = (toolbar.match(/one-to-one/g) || []).length;
    check('工具栏区间内已无 one-to-one', oneToOneCount === 0, `出现 ${oneToOneCount} 次`);
    check('全文件都不再有 one-to-one', ! src.includes('one-to-one'));

    check('「重置」键没被覆盖：工具栏里仍是 reset: true', /\breset\s*:\s*true\b/.test(toolbar),
        (/\breset\s*:\s*true\b/.exec(toolbar) || ['未找到 reset: true'])[0]);
}

console.log('\n[B2] CSS：li.viewer-download:before 图标规则（原 fit-edge 图标已换掉）');
{
    const m = /html\s+\.viewer-toolbar\s*>\s*ul\s*>\s*li\.viewer-download:before\s*\{([\s\S]*?)\}/.exec(src);
    const body = m ? m[1] : '';
    check('存在 li.viewer-download:before 规则', !!m);
    check("含 content: ''", /content:\s*''/.test(body));
    check('20×20 盒子', /width:\s*20px/.test(body) && /height:\s*20px/.test(body));
    check('background-size: 14px 14px', /background-size:\s*14px\s+14px/.test(body));
    check('内联 SVG data URI', /background-image:\s*url\("data:image\/svg\+xml/.test(body));
    const paths = (body.match(/%3Cpath\b/g) || []).length;
    check('SVG 里有 3 条 path（下箭头 + 底线）', paths === 3, `path ${paths} 条`);
    check('老的 li.viewer-fit-edge:before 规则已删干净', ! /li\.viewer-fit-edge/.test(src));
}

console.log('\n[B3] viewer.renderImage 包装：渲染前一律改成顶屏（不再有全屏前置条件）');
{
    const s = src.indexOf('const rawRenderImage');
    const e = src.indexOf('「重置」键不用改', s);
    const wrap = (s >= 0 && e > s) ? src.slice(s, e) : '';
    check('定位到 rawRenderImage 包装区间', wrap.length > 100, `${wrap.length} 字符`);
    check('用 rawRenderImage 包住原函数', wrap.includes('const rawRenderImage = viewer.renderImage.bind(viewer)')
        && /viewer\.renderImage\s*=\s*function/.test(wrap));
    for (const token of ['! viewer.zooming', '! viewer.moving', '! viewer.rotating', '! viewer.scaling', '! viewer.played']) {
        check(`包装里出现守卫 ${token}`, wrap.includes(token));
    }
    check('包装里出现 applyFitEdgeToImageData（渲染前改尺寸）', wrap.includes('applyFitEdgeToImageData()'));
    check('★ 包装里不再有 fsFitMode 这个前置条件（顶屏对全屏/非全屏一视同仁）',
        ! wrap.includes('fsFitMode') && ! /if\s*\(\s*fsFitMode\s*&&/.test(wrap),
        wrap.includes('fsFitMode') ? '包装里仍出现 fsFitMode' : 'fsFitMode 已不在包装里');
    check('全文件里 fsFitMode 不再当开关用（没有 fsFitMode && 这类渲染条件）', ! /fsFitMode\s*&&/.test(src));
}

console.log('\n[B4] 全屏钩子：两族事件 + 进入/退出两条分支（fsFitMode 只给兜底判据用）');
{
    check('挂在 fullscreenchange 上', src.includes("document.addEventListener('fullscreenchange', onViewerFullscreenResize)"));
    check('挂在 webkitfullscreenchange 上', src.includes("document.addEventListener('webkitfullscreenchange', onViewerFullscreenResize)"));

    const s = src.indexOf('const onViewerFullscreenResize');
    const endMark = "document.addEventListener('fullscreenchange', onViewerFullscreenResize)";
    const e = src.indexOf(endMark, s + 1);
    const fn = (s >= 0 && e > s) ? src.slice(s, e) : '';
    check('定位到 onViewerFullscreenResize 函数体', fn.length > 100, `${fn.length} 字符`);
    check('进入/退出由 document 的全屏元素判定（不依赖库内部状态）',
        /const on = !!\(d\.fullscreenElement \|\| d\.webkitFullscreenElement\)/.test(fn)
        && /if \(on === fsFitMode\) \{ return; \}[\s\S]{0,60}fsFitMode = on;/.test(fn));
    check('进入分支：250ms 兜底计时', /setTimeout\(/.test(fn) && /\b250\b/.test(fn),
        (/setTimeout\([\s\S]*?\},\s*(\d+)\)/.exec(fn) || [, '?'])[1] + 'ms');
    check('进入分支：兜底到点直接调 viewer.renderImage()（不再有 fitEdgeNow，也不自己改尺寸）',
        /viewer\.viewed && ! viewer\.played[\s\S]{0,60}viewer\.renderImage\(\)/.test(fn)
        && ! fn.includes('applyFitEdgeToImageData')
        && ! fn.includes('fitEdgeNow'));
    check('进入分支：置 fsFitMode 为 true（只当兜底判据，不是渲染开关）',
        /fsFitMode\s*=\s*on\b/.test(fn) && /if\s*\(on\)\s*\{/.test(fn));
    check('退出分支：走 viewer.initImage 重算', /viewer\.initImage\(/.test(fn));
    check('退出分支：requestAnimationFrame 后再重算', /requestAnimationFrame\(/.test(fn));
}

console.log('\n[B5] 顶屏几何镜像进 viewer.initialImageData（库的 reset() 天然落回顶屏）');
{
    const s = src.indexOf('const applyFitEdgeToImageData');
    const e = src.indexOf('(function () {', s);
    const body = (s >= 0 && e > s) ? src.slice(s, e) : (s >= 0 ? src.slice(s, s + 3500) : '');
    check('顶屏函数里出现 viewer.initialImageData（镜像目标）', body.includes('viewer.initialImageData'));
    // 镜像块边界：从存在判断那一行到随后的 return true;
    const iniStart = body.indexOf('if (viewer.initialImageData');
    const iniEnd = body.indexOf('return true;', iniStart);
    const iniBlock = (iniStart >= 0 && iniEnd > iniStart) ? body.slice(iniStart, iniEnd) : '';
    check('写回走 ini.xxx = 逐个赋值（未旋转口径 fitFor(false)，width/height/ratio/oldRatio/x/y/left/top 全覆盖，且在存在判断里面）',
        iniBlock.length > 0
        && /const ini0 = fitFor\(false\);/.test(iniBlock)
        && /const ini = viewer\.initialImageData;/.test(iniBlock)
        && /ini\.width = ini0\.width;/.test(iniBlock) && /ini\.height = ini0\.height;/.test(iniBlock)
        && /ini\.ratio = ini0\.ratio;/.test(iniBlock) && /ini\.oldRatio = 1;/.test(iniBlock)
        && /ini\.x = ini0\.x;/.test(iniBlock) && /ini\.y = ini0\.y;/.test(iniBlock)
        && /ini\.left = ini0\.x;/.test(iniBlock) && /ini\.top = ini0\.y;/.test(iniBlock),
        iniBlock ? iniBlock.replace(/\s+/g, ' ').trim().slice(0, 120) : '未定位到镜像块');
    check('★ 不是整体替换快照对象（整份替换会把 rotate/scaleX/scaleY 一起抹掉）',
        ! /viewer\.initialImageData\s*=(?!=)/.test(src) && /const ini = viewer\.initialImageData;/.test(body));
    check('镜像前先判存在（库没给快照时安静跳过，不抛错）',
        /if \(viewer\.initialImageData && typeof viewer\.initialImageData === 'object'\) \{/.test(body));
}

console.log('\n[B6] 非全屏自隐：ls-viewer-open / ls-ui-idle 生命周期 + 缩略图条自动隐');
{
    const rule = /html\.ls-viewer-open\.ls-ui-idle:not\(\.ls-viewer-fs\) \.viewer-navbar \{([\s\S]*?)\}/.exec(src);
    check('CSS 有 html.ls-viewer-open.ls-ui-idle:not(.ls-viewer-fs) .viewer-navbar 规则', !!rule);
    {
        const body = rule ? rule[1] : '';
        check('该规则只写 opacity: 0，且不写 visibility / pointer-events（条子藏着但仍接指针，落在上面的第一下点击不被白吞）',
            /opacity:\s*0(?![\d.])/.test(body) && ! /visibility\s*:/.test(body) && ! /pointer-events\s*:/.test(body),
            body.replace(/\s+/g, ' ').trim().slice(0, 80));
    }
    // 全屏那套三条规则仍完整（非全屏这条不许抢它们）
    {
        const pick = (re) => { const m = re.exec(src); return m ? m[1] : ''; };
        const fsHide = pick(/html\.ls-viewer-fs \.viewer-toolbar,[\s\S]*?\{([\s\S]*?)\}/);
        check('全屏①：默认 opacity: 0 !important + visibility: hidden',
            /opacity:\s*0\s*!important/.test(fsHide) && /visibility:\s*hidden/.test(fsHide),
            fsHide.replace(/\s+/g, ' ').trim().slice(0, 80));
        const fsShow = pick(/html\.ls-viewer-fs\.ls-fs-ui \.viewer-toolbar,[\s\S]*?\{([\s\S]*?)\}/);
        check('全屏②：.ls-fs-ui 时 opacity: 1 !important + visibility: visible',
            /opacity:\s*1\s*!important/.test(fsShow) && /visibility:\s*visible/.test(fsShow),
            fsShow.replace(/\s+/g, ' ').trim().slice(0, 80));
        const fsPe = pick(/html\.ls-viewer-fs:not\(\.ls-fs-ui\) \.viewer-toolbar,[\s\S]*?\{([\s\S]*?)\}/);
        check('全屏③：:not(.ls-fs-ui) 时 pointer-events: none',
            /pointer-events:\s*none/.test(fsPe),
            fsPe.replace(/\s+/g, ' ').trim().slice(0, 80));
    }
    check('配套过渡规则也排除全屏（不抢全屏那三条）',
        /html\.ls-viewer-open:not\(\.ls-viewer-fs\) \.viewer-navbar \{[\s\S]{0,200}transition:/.test(src));
    check("shown：挂 ls-viewer-open 并排一次收起计时",
        /addEventListener\('shown',[\s\S]{0,200}classList\.add\(VIEWER_OPEN_CLASS\)[\s\S]{0,200}scheduleViewerUiHide\(\)/.test(src));
    check('hidden：两个类一起摘（不把「已收起」留给下一次打开）',
        /addEventListener\('hidden',[\s\S]{0,200}classList\.remove\(VIEWER_OPEN_CLASS, UI_IDLE_CLASS\)/.test(src));
    check('scheduleViewerUiHide 有全屏 / 非全屏两条分支',
        /const scheduleViewerUiHide = \(\) => \{[\s\S]{0,600}if \(inFullscreenClass\(\)\) \{ html\.classList\.remove\('ls-fs-ui'\); return; \}[\s\S]{0,200}classList\.add\(UI_IDLE_CLASS\)/.test(src));
    check('进出全屏时额外摘一次 ls-ui-idle（与全屏那套 ls-fs-ui 互不干扰）',
        /\['fullscreenchange', 'webkitfullscreenchange'\]\.forEach\([\s\S]{0,200}classList\.remove\(UI_IDLE_CLASS\)/.test(src));
    check('常量定义齐全：VIEWER_OPEN_CLASS / UI_IDLE_CLASS / WINDOWED_UI_ZONES',
        /const VIEWER_OPEN_CLASS = 'ls-viewer-open';/.test(src)
        && /const UI_IDLE_CLASS = 'ls-ui-idle';/.test(src)
        && /const WINDOWED_UI_ZONES = \['\.viewer-navbar'\];/.test(src));
}

console.log('\n[B7] 手机滑动灵敏度：三个常量与「够快」那一档的位移下限');
{
    check('FAR_RATIO = 0.21（原 0.18，压灵敏度）', /const FAR_RATIO = 0\.21;/.test(src));
    check('FAST_SPEED = 0.65（原 0.5）', /const FAST_SPEED = 0\.65;/.test(src));
    check('「够快」那一档的位移下限是 38（原 30）',
        /Math\.abs\(dx\) \/ dt > FAST_SPEED && Math\.abs\(dx\) > 38;/.test(src));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => ! r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
