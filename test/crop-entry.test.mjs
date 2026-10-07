/*
 * 「编辑图片（裁剪）」入口与规则的静态契约测试（不需要浏览器）
 *
 * 背景：老师要的是「看图器里能裁图」，且入口不止一处 —— 看图器工具栏、选中单张时的操作条、
 * 右键/长按菜单都要有「编辑图片」；只有 jpg/jpeg/png 给入口；导出格式跟随原图
 * （png → PNG 无损、jpg/jpeg → JPEG q0.95）；不设长边上限；结果作为**新图**上传、不改原图。
 * 这个文件把上面这些决定钉住，避免以后被人「顺手」改回去（真机行为仍需人工验收）。
 *
 * 运行：node crop-entry.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(SRC, ...p));

const blade = read('resources', 'views', 'user', 'images.blade.php');
// 去注释后再做结构断言（注释里会写「以前是 4096 上限」这类说明，容易把「不出现」的断言带偏）
const code = blade
    .replace(/\{\{--[\s\S]*?--\}\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

// ---------------------------------------------------------------- 1. vendored 库
console.log('\n[1] Cropper.js v1.6.3 已 vendored 且被 blade 正确引入');
{
    check('public/js/cropper-js/cropper.min.js 存在', exists('public', 'js', 'cropper-js', 'cropper.min.js'));
    check('public/css/cropper-js/cropper.min.css 存在', exists('public', 'css', 'cropper-js', 'cropper.min.css'));
    const js = read('public', 'js', 'cropper-js', 'cropper.min.js');
    const css = read('public', 'css', 'cropper-js', 'cropper.min.css');
    check('库版本是 v1.6.3（不是 v2 组件化那套）', js.includes('Cropper.js v1.6.3'), js.slice(0, 40).replace(/\n/g, ' '));
    check('CSS 里有 .cropper-container 规则', css.includes('.cropper-container'));
    check('CSS 无外部资源引用（只有内联 data URI）',
        (css.match(/url\((?!"?data:)/g) || []).length === 0);
    check('blade 引入 JS（带 assetVersion 版本串，避免静态资源被启发式缓存）',
        code.includes("asset('js/cropper-js/cropper.min.js')")
        && /asset\('js\/cropper-js\/cropper\.min\.js'\)[\s\S]{0,60}\?v=\{\{[\s\S]{0,80}assetVersion\('js\/cropper-js\/cropper\.min\.js'\)/.test(blade));
    check('blade 引入 CSS（带 assetVersion 版本串）',
        code.includes("asset('css/cropper-js/cropper.min.css')")
        && /asset\('css\/cropper-js\/cropper\.min\.css'\)[\s\S]{0,60}\?v=\{\{[\s\S]{0,80}assetVersion\('css\/cropper-js\/cropper\.min\.css'\)/.test(blade));
}

// ---------------------------------------------------------------- 2. 三处入口
console.log('\n[2] 三处入口都在，且都指向同一个 cropEditor');
{
    // ① 看图器工具栏（自定义 toolbar 必须把要用的内置按钮照抄，否则它们会消失）
    // 注意：+ / − （zoom-in / zoom-out）已按老师要求去掉，原位换成自定义的「全屏」键。
    const builtins = ['one-to-one', 'reset', 'prev', 'play', 'next', 'rotate-left', 'rotate-right', 'flip-horizontal', 'flip-vertical'];
    const toolbarStart = code.indexOf('toolbar: {');
    // 注意：不能拿第一个 '},' 当结尾 —— crop 那行自己的结尾就是 `},`（它现在排在最前）。
    const toolbarBlock = toolbarStart < 0 ? '' : code.slice(toolbarStart, code.indexOf("'flip-vertical': true", toolbarStart) + 400);
    check('看图器用了自定义 toolbar（对象形式）', toolbarStart > -1);
    let idx = -1, ordered = true;
    for (const b of builtins) {
        const key = b.includes('-') ? `'${b}'` : b;
        const i = toolbarBlock.indexOf(`${key}:`);
        if (i < 0 || i < idx) { ordered = false; }
        idx = i;
    }
    check('11 个内置按钮按原顺序全部列全（否则自定义模式下不渲染）', ordered, `keys=${builtins.length}`);
    check('toolbar 里追加了 crop 按钮', /crop:\s*\{\s*show:\s*true,\s*click:/.test(toolbarBlock));
    check('crop 按钮的 click 调 cropEditor.openFromViewer', toolbarBlock.includes('cropEditor.openFromViewer()'));
    check('+ / − 已去掉（自定义 toolbar 里不再有 zoom-in / zoom-out）',
        !/'zoom-in'/.test(toolbarBlock) && !/'zoom-out'/.test(toolbarBlock));
    check('原 +/− 的位置换成了「全屏」自定义键（click 调 toggleViewerFullscreen）',
        /fullscreen:\s*\{\s*show:\s*true,\s*click:\s*\(\)\s*=>\s*toggleViewerFullscreen\(\)/.test(toolbarBlock));
    check('全屏按钮紧随「裁剪」之后（= 原来 +/− 的位置）',
        toolbarBlock.indexOf('fullscreen:') > toolbarBlock.indexOf('crop: {')
        && toolbarBlock.indexOf('fullscreen:') < toolbarBlock.indexOf("'one-to-one': true"));
    check('全屏开关实现：全屏时走 document 的 exit，否则调库的 viewer.requestFullscreen()',
        /toggleViewerFullscreen[\s\S]{0,700}viewer\.requestFullscreen\(\)/.test(code)
        && /exitFullscreen \|\| d\.webkitExitFullscreen/.test(code));
    check('全屏状态变化时同步图标（fullscreenchange / webkitfullscreenchange → .is-fs）',
        code.includes("document.addEventListener('fullscreenchange', syncFullscreenIcon)")
        && code.includes("document.addEventListener('webkitfullscreenchange', syncFullscreenIcon)")
        && /li\.classList\.toggle\('is-fs', on\)/.test(code));
    check('★ 全屏回调定义在 viewer 同级作用域（不在 cropEditor 的 IIFE 里）—— 否则工具栏点了会 is not defined',
        code.indexOf('const toggleViewerFullscreen') > -1
        && code.indexOf('const toggleViewerFullscreen') < code.indexOf('const cropEditor = (function ()')
        && code.indexOf('const syncFullscreenIcon') > -1
        && code.indexOf('const syncFullscreenIcon') < code.indexOf('const cropEditor = (function ()'));
    {
        const cropIdx = toolbarBlock.indexOf('crop: {');
        const fsIdx = toolbarBlock.indexOf('fullscreen: {');
        const oneIdx = toolbarBlock.indexOf("'one-to-one': true");
        check('crop 按钮排最左、全屏紧随其后（= 原 +/− 的位置）',
            cropIdx > -1 && fsIdx > -1 && oneIdx > -1 && cropIdx < fsIdx && fsIdx < oneIdx,
            `crop@${cropIdx} fullscreen@${fsIdx} one-to-one@${oneIdx}`);
    }
    // 自定义键的画廊图标：库只给 14 个内置键写了规则（含 content 与 20×20 盒子），
    // 自定义键不补这几条就只剩 li 的黑底 ⇒「有按钮没图标」。
    check('自定义键的图标补齐了库缺的声明（content + 20×20 盒子）',
        /li\.viewer-crop:before \{[\s\S]{0,500}content: ''[\s\S]{0,500}width: 20px[\s\S]{0,200}height: 20px/.test(blade));
    check('图标图形比盒子小一圈 —— 裁剪键 14px + 3px 居中偏移（盒子/热区不变）',
        /li\.viewer-crop:before \{[\s\S]{0,900}background-position: 3px 3px;[\s\S]{0,200}background-size: 14px 14px;/.test(blade));
    check('「全屏」键同样是自定义键：补了 content + 20×20 盒子 + 14px 图标',
        /li\.viewer-fullscreen:before \{[\s\S]{0,500}content: ''[\s\S]{0,500}width: 20px[\s\S]{0,200}height: 20px[\s\S]{0,1200}background-size: 14px 14px;/.test(blade));
    check('全屏时换成「退出全屏」图标（.viewer-fullscreen.is-fs:before 另一张 SVG）',
        /li\.viewer-fullscreen\.is-fs:before \{\s*\n\s*background-image: url\("data:image\/svg\+xml,/.test(blade));

    // ② 选中操作条（顶部那排 + < xl 的「⋯」下拉各一份）
    const editAnchors = (code.match(/data-operate="edit"/g) || []).length;
    check('data-operate="edit" 恰好两处（顶部工具条 + 「⋯」下拉）', editAnchors === 2, `count=${editAnchors}`);
    {
        const order = (code.match(/data-operate="(movements|remove|tag|edit|rename|delete|detail|deselect)"/g) || []).join(' ');
        const want = ['movements', 'remove', 'tag', 'edit', 'rename', 'delete', 'detail', 'deselect']
            .map((o) => `data-operate="${o}"`).join(' ');
        check('操作条顺序：详细信息 夹在 删除 与 取消选择 之间（横排与「⋯」下拉两处一致）',
            order === want + ' ' + want, order.replace(/data-operate="|"/g, ' ').replace(/\s+/g, ' ').trim());
    }
    check('「编辑图片」文案存在', blade.includes('>编辑图片<'));
    check('bindOperates 里按格式决定是否给入口',
        /if \(selected\.length === 1\)[\s\S]{0,400}cropEditor\.supported\(selected\[0\]\)[\s\S]{0,200}operates\.splice\(/.test(code));
    check('多选分支里没有 edit（只有单选才有）',
        !/if \(selected\.length > 1\)[\s\S]{0,200}'edit'/.test(code));
    check('操作条点击的 switch 里有 case \'edit\' → methods.edit',
        /case 'edit':[\s\S]{0,120}methods\.edit\(selected\[0\]\)/.test(code));
    check('methods.edit 走 cropEditor.open',
        /edit\(item\)[\s\S]{0,200}cropEditor\.open\(item\)/.test(code));

    // ③ 右键 / 长按菜单
    check('actions 里定义了 edit（文案 + 单选 + 格式判断）',
        /edit:\s*\{[\s\S]{0,240}text: '编辑图片'[\s\S]{0,240}ds\.getSelection\(\)\.length === 1[\s\S]{0,240}cropEditor\.supported/.test(code));
    check('edit 在分隔线后的「重命名 / 删除」那组最上面',
        /\{divider: true\},\s*\n\s*actions\.edit,\s*\n\s*actions\.rename,\s*\n\s*actions\.delete,/.test(code));
    check('edit 不再出现在前半段菜单里', !/actions\.copy,\s*\n\s*actions\.edit,/.test(code));
}

// ---------------------------------------------------------------- 3. 规则
console.log('\n[3] 老师拍板的规则被钉住');
{
    check('只允许 jpg/jpeg/png', /const SUPPORTED = \['jpg', 'jpeg', 'png'\]/.test(code));
    check('png → image/png（无损）', /isPng \? 'image\/png' : 'image\/jpeg'/.test(code));
    check('jpeg → 质量 0.95', /toBlob\(done, mime, isPng \? undefined : 0\.95\)/.test(code));
    check('导出不设长边上限（getCroppedCanvas 里没有 maxWidth/maxHeight）',
        /getCroppedCanvas\(\{ imageSmoothingQuality: 'high' \}\)/.test(code) && !/getCroppedCanvas\([^)]*max(Width|Height)/.test(code));
    check('>30MP 时给体积提示', /mp >= 30/.test(code));
    check('上传走现有 /upload（route + CSRF + strategy_id）',
        /const UPLOAD_URL = '\{\{ route\('upload'\) \}\}'/.test(blade) &&
        code.includes("'X-CSRF-TOKEN'") && code.includes("fd.append('strategy_id'"));
    check('上传成功后会刷新列表（resetImages）', /resetImages\(\)/.test(code.slice(code.indexOf('const upload ='), code.indexOf('const doCrop ='))));
    check('不改原图：全篇没有对原图发 DELETE/PUT', !/type: 'DELETE'|type: 'PUT'/.test(code));
}

// ---------------------------------------------------------------- 4. 裁剪层与交互
console.log('\n[4] 裁剪层的标记与交互钩子齐全');
{
    check('#crop-layer / #crop-image 存在', blade.includes('id="crop-layer"') && blade.includes('id="crop-image"'));
    check('旋转两个按钮（左/右 90°）', blade.includes('data-crop-action="rotate-left"') && blade.includes('data-crop-action="rotate-right"'));
    check('翻转两个按钮（左右 / 上下）', blade.includes('data-crop-action="flip-x"') && blade.includes('data-crop-action="flip-y"'));
    check('比例四档（自由 / 1:1 / 4:3 / 16:9）',
        ['free', '1:1', '4:3', '16:9'].every((r) => blade.includes(`data-crop-ratio="${r}"`)));
    check('4:3 排在 1:1 之后', /data-crop-ratio="1:1"[\s\S]{0,240}data-crop-ratio="4:3"/.test(blade));
    check('比例处理里 4:3 走 setAspectRatio(4 / 3)', code.includes('cropper.setAspectRatio(4 / 3)'));
    check('确认/取消按钮', blade.includes('data-crop-action="crop"') && blade.includes('data-crop-action="cancel"'));
    check('旋转走 cropper.rotate(±90)、比例走 setAspectRatio（自由档用 NaN）',
        code.includes('cropper.rotate(-90)') && code.includes('cropper.rotate(90)') && code.includes('cropper.setAspectRatio(NaN)'));
    check('翻转走 cropper.scale(flipX, flipY)，且翻转态在打开/关闭时都归零',
        /flip-x'\) \{ flipX = -flipX; cropper\.scale\(flipX, flipY\); \}/.test(code)
        && /flip-y'\) \{ flipY = -flipY; cropper\.scale\(flipX, flipY\); \}/.test(code)
        && (code.match(/flipX = 1;/g) || []).length >= 2);
    check('scalable 已打开（库的 scale() 受这一项开关）', /scalable: true/.test(code));
    check('缩放/手势开关没被顺手改掉', /zoomOnTouch: true/.test(code) && /zoomOnWheel: true/.test(code));
    check('手机布局钩子：工具组 + 两个动作按钮（.crop-tools / .crop-actions）',
        blade.includes('class="crop-tools"') && blade.includes('crop-group crop-actions'));
    check('桌面布局与原来一致（.crop-tools 在桌面 display: contents）',
        /#crop-layer \.crop-tools \{ display: contents; \}/.test(blade));
    check('电脑端底栏改三列网格 ⇒ 比例组正居中（不再是会被挤偏的 space-between）',
        /@media \(min-width: 768px\) \{[\s\S]{0,700}grid-template-columns: 1fr auto 1fr;/.test(blade));
    check('手机端：动作按钮挪到顶栏右侧（绝对定位，不再占用底栏、也不再横滑）',
        /@media \(max-width: 767\.98px\) \{[\s\S]{0,800}\.crop-head \{ padding-right: 168px; \}[\s\S]{0,400}\.crop-actions \{ position: absolute; top: 9px; right: 12px; \}/.test(blade));
    check('手机端工具组折行显示（flex-wrap: wrap，且移动端媒体查询里没有 overflow-x 横滑）',
        /@media \(max-width: 767\.98px\) \{[\s\S]{0,800}\.crop-tools \{ display: flex; flex-wrap: wrap; gap: 6px; \}/.test(blade)
        && !/@media \(max-width: 767\.98px\) \{[\s\S]{0,900}overflow-x: auto/.test(blade));
    check('手机端手柄 20px→14px 仍在（热区靠库的 200% :before 保持 28px）',
        /@media \(max-width: 767\.98px\) \{[\s\S]{0,900}\.cropper-point\.point-se \{ width: 14px; height: 14px; \}/.test(blade));
    check('iOS 整张灰的根治：停用库的 modal，框外变暗改用 view-box 的 box-shadow',
        /modal: false,/.test(code)
        && /#crop-layer \.cropper-container \{ overflow: hidden; \}/.test(blade)
        && /#crop-layer \.cropper-view-box \{ box-shadow: 0 0 0 9999px rgba\(0, 0, 0, \.5\); \}/.test(blade));
    check('没有再依赖库的 .cropper-modal（我们自己不给它写样式）',
        !/#crop-layer \.cropper-modal/.test(blade));
    check('EXIF 方向交给库处理（checkOrientation: true）', code.includes('checkOrientation: true'));
    check('关闭时销毁实例（v1 同一元素不能重复 init）', /close = \(\) => \{[\s\S]{0,160}cropper\.destroy\(\)/.test(code));
    check('打开裁剪层前先关掉看图器（两层不叠）',
        /document\.body\.classList\.contains\('viewer-open'\)[\s\S]{0,120}viewer\.hide\(\)/.test(code));
    check('桌面 110% 缩放下给裁剪层套了反向缩放 + 显式宽高（与 .viewer-container 同源）',
        /@media \(min-width: 768px\) \{[\s\S]{0,600}html #crop-layer \{[\s\S]{0,200}zoom: calc\(1 \/ 1\.1\)[\s\S]{0,200}width: 100%[\s\S]{0,80}height: 100%/.test(blade));
    check('看图器里的「裁剪」按钮按当前图格式显示/隐藏',
        /syncViewerButton[\s\S]{0,400}viewer-toolbar li\.viewer-crop/.test(code));
    check('没有用 viewer.on(…)（1.10.4 没有这个 API），改用 document 上的原生事件',
        !/viewer\.on\(/.test(code) && code.includes("document.addEventListener('viewed', syncViewerButton)"));
}

// ---------------------------------------------------------------- 5. 没碰坏既有行为
console.log('\n[5] 看图器原有选项与钉住的产物没被改动');
{
    for (const opt of ["url: 'data-original'", 'slideOnTouch: false', 'loop: false', 'focus: false']) {
        check(`原有选项仍在：${opt}`, code.includes(opt));
    }
    check('缩略图条的滚轮/拖动切图还在', code.includes("const BAR = '.viewer-navbar'"));
    check('看图器不再动 body 的滚动锁（滚动条不消失 ⇒ 打开时页面不漏重排）；槽位规则仍在',
        /html \{ scrollbar-gutter: stable; \}/.test(blade)
        && /body\.viewer-open \{ overflow: visible; \}/.test(blade));
    check('「飞入」CSS 兜底还在', blade.includes('.viewer-canvas > img:not([style])'));
    const dockerfile = fs.readFileSync(path.join(here, '..', 'Dockerfile'), 'utf8');
    check('Dockerfile 里 context-js 的两个 md5 未被改动（本轮不该碰它）',
        (dockerfile.match(/c0e513ec8e93fd81b34b3c6de5cf5eb8/g) || []).length === 3);
    check('Dockerfile 里 images.blade.php 的 md5 与当前文件一致（实算）',
        dockerfile.includes(blade && require_md5(blade)));
}

// 实算 blade 的 md5（避免手抄值）
import crypto from 'node:crypto';
function require_md5(text) {
    return crypto.createHash('md5').update(Buffer.from(text, 'utf8')).digest('hex');
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
