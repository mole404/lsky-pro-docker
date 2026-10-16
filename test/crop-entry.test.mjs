/*
 * 「编辑图片（裁剪）」入口与规则的静态契约测试（不需要浏览器）
 *  + [10]：把 openFromViewer 从 blade 抠出真身、注入假环境**真跑**
 *  + [11]：把「UI 自动收起 + 收起状态下第一下点击」那段从 blade 抠出真身，放进 jsdom 里
 *    用真实 DOM 事件（pointerdown / 库补发的 click）驱动，逐条核对吞不吞那一下。
 *
 * 背景：目标是「看图器里能裁图」，且入口不止一处 —— 看图器工具栏、选中单张时的操作条、
 * 右键/长按菜单都要有「编辑图片」；只有 jpg/jpeg/png 给入口；导出格式跟随原图
 * （png → PNG 无损、jpg/jpeg → JPEG q0.95）；不设长边上限；结果作为**新图**上传、不改原图。
 * 这个文件把上面这些决定钉住，避免以后被人「顺手」改回去（真机行为仍需人工验收）。
 *
 * 运行：node crop-entry.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

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
    // 注意：+ / − （zoom-in / zoom-out）已按要求去掉，原位换成自定义的「全屏」键；
    // 「1:1」（one-to-one）按「与改动前一致」归位到全屏之后、重置之前；
    // 「下载原图」整条链路（键 + downloadViewerImage + CSS 图标）已删除
    // ⇒ 自定义键只剩 crop / fullscreen，内置键是这 9 个（含归位后的 1:1）。
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
    check('内置按钮按原顺序全部列全（否则自定义模式下不渲染）', ordered, `keys=${builtins.length}`);
    check('toolbar 里追加了 crop 按钮', /crop:\s*\{\s*show:\s*true,\s*click:/.test(toolbarBlock));
    check('crop 按钮的 click 调 cropEditor.openFromViewer', toolbarBlock.includes('cropEditor.openFromViewer()'));
    check('+ / − 已去掉（自定义 toolbar 里不再有 zoom-in / zoom-out）',
        !/'zoom-in'/.test(toolbarBlock) && !/'zoom-out'/.test(toolbarBlock));
    check('原 +/− 的位置换成了「全屏」自定义键（click 调 toggleViewerFullscreen）',
        /fullscreen:\s*\{\s*show:\s*true,\s*click:\s*\(\)\s*=>\s*toggleViewerFullscreen\(\)/.test(toolbarBlock));
    check('全屏按钮紧随「裁剪」之后（= 原来 +/− 的位置）',
        toolbarBlock.indexOf('fullscreen:') > toolbarBlock.indexOf('crop: {')
        && toolbarBlock.indexOf('fullscreen:') < toolbarBlock.indexOf('reset:'),
        `crop@${toolbarBlock.indexOf('crop: {')} fullscreen@${toolbarBlock.indexOf('fullscreen:')}`);
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
        check('「裁剪」排最左、「全屏」其次（= 原来 +/− 的位置）',
            cropIdx > -1 && fsIdx > -1 && cropIdx < fsIdx, `crop@${cropIdx} fullscreen@${fsIdx}`);
        check('工具栏里已无「顶屏」（fit-edge）键', toolbarBlock.indexOf('fit-edge') === -1);
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
    // 「1:1」按「与改动前一致」归位（全屏之后、重置之前）；「下载原图」整条链路（键 + 函数 + 图标）已删除。
    {
        const fsIdx = toolbarBlock.indexOf('fullscreen:');
        const otoIdx = toolbarBlock.indexOf("'one-to-one'");
        const resetIdx = toolbarBlock.indexOf('reset:');
        check("「1:1」已归位：'one-to-one' 在 fullscreen 之后、reset 之前",
            otoIdx > -1 && otoIdx > fsIdx && otoIdx < resetIdx, `fs@${fsIdx} one-to-one@${otoIdx} reset@${resetIdx}`);
        check('「下载原图」键已从工具栏删除（工具栏区间里没有 download 键）',
            ! /\bdownload\s*:/.test(toolbarBlock));
    }
    {
        check('「下载原图」的图标规则已整条删除（全文件不见 .viewer-download）', ! /viewer-download/.test(blade));
        check('自定义键的图标规则只剩 crop / fullscreen 两条（download 那条没留下空壳）',
            (blade.match(/li\.viewer-(crop|fullscreen):before/g) || []).length === 2);
    }
    check('「下载原图」的实现函数已删除（downloadViewerImage 全文件不见）',
        ! blade.includes('downloadViewerImage') && ! code.includes('downloadViewerImage'));
    check('cropEditor 对外暴露 viewerUrl / infoOf（裁剪入口的「当前图」取值口径仍在）',
        /viewerUrl: viewerUrl, infoOf: infoOf \}/.test(code)
        && /const viewerUrl = \(\) => \{[\s\S]{0,400}\.viewer-canvas img/.test(code));

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
console.log('\n[3] 拍板的规则被钉住');
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
    // 2026-10-08：这条原先钉死「context-js 的 md5 不许变」（那时改裁剪不该碰它）。长按健壮性修复
    // 确实改了 context-js ⇒ 换成「与当前文件实算值一致」，免得又变成一份会漂移的副本。
    const ctxJsSrc = read('public', 'js', 'context-js', 'context-js.js');
    check('Dockerfile 里 context-js 的 md5 与当前文件一致（实算，出现 3 处）',
        (dockerfile.match(new RegExp(require_md5(ctxJsSrc), 'g')) || []).length === 3);
    check('Dockerfile 里 images.blade.php 的 md5 与当前文件一致（实算）',
        dockerfile.includes(blade && require_md5(blade)));
}

// 实算 blade 的 md5（避免手抄值）
import crypto from 'node:crypto';
function require_md5(text) {
    return crypto.createHash('md5').update(Buffer.from(text, 'utf8')).digest('hex');
}

// ---------------------------------------------------------------- 6. 全屏观感 / 打开不重排 / 缩略图条滚轮
console.log('\n[6] 看图器：全屏观感 / 打开不漏重排 / 缩略图条滚轮');
{
    check('① 库写的那份 body padding-right 被按回 0（@supports 保住旧浏览器）',
        /@supports \(scrollbar-gutter: stable\) \{\s*\n\s*body\.viewer-open \{ padding-right: 0 !important; \}/.test(blade));
    check('② 全屏时背景纯黑 + UI 全隐（toolbar / navbar / title / button）',
        /html\.ls-viewer-fs \.viewer-backdrop,\s*\n\s*html\.ls-viewer-fs \.viewer-container \{ background-color: #000; \}/.test(blade)
        && /html\.ls-viewer-fs \.viewer-toolbar,[\s\S]{0,260}html\.ls-viewer-fs \.viewer-button \{/.test(blade)
        && /html\.ls-viewer-fs:not\(\.ls-fs-ui\) \.viewer-toolbar,[\s\S]{0,300}pointer-events: none;/.test(blade));
    check('② 全屏里页面自己那条滚动条 + 留给它的空白一起收掉',
        /html\.ls-viewer-fs \{ overflow: hidden; scrollbar-gutter: auto; \}/.test(blade));
    check('② 延迟重置的触发：鼠标移动 / 滚轮 / 点击 / 触摸 / 按键 全都算',
        /\[('mousemove', 'wheel', 'pointerdown', 'touchstart', 'touchmove', 'keydown'|'mousemove'.*)\]\.forEach\(\(ev\) => \{/.test(code)
        && ['mousemove', 'wheel', 'pointerdown', 'touchstart', 'touchmove', 'keydown']
            .every((ev) => code.includes(`'${ev}'`)));
    check('② 全屏里鼠标动/轻触临时淡入 UI（.ls-fs-ui + 到点自动收）—— 两模式共用 flashViewerUI',
        /const flashViewerUI = \(e\) => \{[\s\S]{0,500}classList\.add\('ls-fs-ui'\)/.test(code)
        && /document\.addEventListener\(ev, flashViewerUI, \{capture: true, passive: true\}\)/.test(code)
        && /const FS_UI_MS = \d+;/.test(code),
        (/const FS_UI_MS = \d+;/.exec(code) || ['FS_UI_MS 未找到'])[0]);
    check('② scheduleViewerUiHide 两条分支：全屏收 ls-fs-ui / 非全屏（看图器开着）加 ls-ui-idle',
        /const scheduleViewerUiHide = \(\) => \{[\s\S]{0,500}if \(inFullscreenClass\(\)\) \{ html\.classList\.remove\('ls-fs-ui'\); return; \}[\s\S]{0,200}classList\.add\(UI_IDLE_CLASS\)/.test(code));
    check('④ 不再给图片墙加左侧内边距（上一版加过 18px，否掉了，已回退）',
        !/#images-scroll \{ padding-left: 18px; \}/.test(blade));
    check('② 全屏状态挂/去 html.ls-viewer-fs（与按钮图标在同一处同步）',
        /syncFullscreenIcon[\s\S]{0,600}classList\.toggle\('ls-viewer-fs', on\)/.test(code));
    check('② 关掉看图器时顺手退出全屏（点背景 = 彻底退出）',
        /addEventListener\('hidden',[\s\S]{0,300}fullscreenElement[\s\S]{0,300}exitFullscreen/.test(code));
    check('③ 缩略图条滚轮：非 passive + preventDefault（否则页面跟着一起滚）',
        /const onBarWheel = \(e\) => \{[\s\S]{0,400}e\.preventDefault\(\)/.test(code)
        && /addEventListener\('wheel', onBarWheel, \{capture: true, passive: false\}\)/.test(code));
    check('③ 这个非 passive 监听只在看图器打开期间挂（shown 挂 / hidden 摘）',
        /addEventListener\('shown',[\s\S]{0,240}addEventListener\('wheel', onBarWheel/.test(code)
        && /addEventListener\('hidden',[\s\S]{0,240}removeEventListener\('wheel', onBarWheel/.test(code));
    check('③ 老的常驻 passive wheel 监听已移除（passive 拦不住默认滚动）',
        !/addEventListener\('wheel'[\s\S]{0,80}\{capture: true, passive: true\}/.test(code));
}

// ---------------------------------------------------------------- 7. 侧栏上起框 / 全屏操作不消失
console.log('\n[7] 区域外（侧栏）起框 + 全屏操作期间 UI 不消失');
{
    check('② 全屏里鼠标停在 UI 上就不收起（只续期）—— 矩形判定，不依赖 pointer-events；非全屏收的是同样那四块',
        /const FS_UI_ZONES = \['\.viewer-toolbar', '\.viewer-navbar', '\.viewer-title', '\.viewer-button'\]/.test(code)
        && /const WINDOWED_UI_ZONES = \['\.viewer-toolbar', '\.viewer-navbar', '\.viewer-title', '\.viewer-button'\]/.test(code)
        && /const pointerOverZones = \(zones, x, y\) => zones\.some/.test(code)
        && /pointerOverZones\(fs \? FS_UI_ZONES : WINDOWED_UI_ZONES,[\s\S]{0,160}clearTimeout\(fsUiTimer\)/.test(code));
    check('② 手指按住期间不收起，抬起才开始计时（触屏端同样"操作中不消失"）',
        /type\.indexOf\('touch'\) === 0[\s\S]{0,120}clearTimeout\(fsUiTimer\)/.test(code)
        && /addEventListener\('touchend',[\s\S]{0,400}scheduleViewerUiHide\(\)/.test(code));
    check('④ 允许"区域外（侧栏上）"起框，并在松手时自己落选中',
        /const outOfAreaOk = !! ar && e\.clientX <= ar\.right && e\.clientY >= ar\.top/.test(code)
        && /dsBox\.selfSelect = ! inArea/.test(code)
        && /dsBox\.selfSelect[\s\S]{0,800}ds\.clearSelection\(\)[\s\S]{0,200}ds\.addSelection\(el\)/.test(code)
        && /bindOperates\(\)/.test(code.slice(code.indexOf('dsBox.selfSelect &&'), code.indexOf('dsBox.selfSelect &&') + 900)));
    // 2026-10-08：定「框选只在电脑端生效」（手机上拖框会和滚页面手势打架）。
    // 契约：mousemove 里必须先判 utils.isMobile() 再更新框 —— 只让框不再长大，不动 mousedown 那一发
    //（库的点选正是靠按下时的点状框），否则手机端连点选都没了。
    // 2026-10-08 追加：只按 utils.isMobile()（= 移动 UA **且 screen.width < 768**）判断会漏 ——
    // iPad 这类宽屏 iOS 设备上它直接返回 false（实测「手机端滑动页面仍会触发框选」）。
    // 所以必须同时有第二道与设备无关的闸：本页最近发生过触摸（touchJustNow）。
    check('⑨ 手机端不拖框：mousemove 里同时有 utils.isMobile() 与「最近发生过触摸」两道守卫',
        /addEventListener\('mousemove',[\s\S]{0,900}utils\.isMobile\(\) \|\| touchJustNow\(\)[\s\S]{0,120}return;[\s\S]{0,200}dsBox\.x1 = e\.clientX/.test(code));
    check('⑨ 触摸时间窗已实现：三个 touch 事件都刷新 lastTouchAt，且监听是 passive（不能让 Chrome 失去滚动快路径）',
        /touchstart', \(\) => \{ lastTouchAt = Date\.now\(\); \}, \{capture: true, passive: true\}/.test(code)
        && /touchmove', \(\) => \{ lastTouchAt = Date\.now\(\); \}, \{capture: true, passive: true\}/.test(code)
        && /touchend', \(\) => \{ lastTouchAt = Date\.now\(\); \}, \{capture: true, passive: true\}/.test(code)
        && /const touchJustNow = \(\) => \(Date\.now\(\) - lastTouchAt\) < TOUCH_GRACE_MS/.test(code));
    // 2026-10-08 追加（真机根因）：光挡住「我们自己扩框」不够 —— 真机上库会被 touchstart 启动、自己画蓝框
    //（实测：蓝框出现但图选不上）。所以必须从库的判据下手。read ds.min.js: start(e) 里
    // `_canInteract(e) && (isInteracting = !0, ..., publish("Interaction:start"))` —— 状态在 publish 之前
    // 就置上，回调里 break 来不及；且这条路径发 "Interaction:start"，订阅名 predragstart 收不到。
    check('⑩ 手机端不让库启动触摸交互：包装 _canInteract，touch 来源一律返回 false 且保留原函数',
        /_canInteract = \(e\) => \{[\s\S]{0,400}'touchstart'[\s\S]{0,300}return false;[\s\S]{0,400}origCanInteract\(e\)/.test(code));
    check('⑩ 拦截对「没有真实库」的环境（单元测试的桩）要静默跳过，不能抛错',
        /const interaction = ds\.Interaction;[\s\S]{0,200}typeof interaction\._canInteract !== 'function'[\s\S]{0,120}return;/.test(code));
    check('⑨ 鼠标松手后的「区域外自选」也带同样两道守卫',
        /dsBox\.selfSelect && ! utils\.isMobile\(\) && ! touchJustNow\(\)/.test(code));
    check('⑨ 手机端不靠拖动落选：mouseup 的自选分支也带 utils.isMobile() 守卫',
        /dsBox\.selfSelect && ! utils\.isMobile\(\)/.test(code));
    check('④ 区域外的单击不算框选（框任一边 > 4px 才算拖动）',
        /if \(r\.width > 4 \|\| r\.height > 4\)/.test(code));
    check('④ 网格内部起始的拖动仍走库原路径（selfSelect 只在区域外为 true）',
        /const inArea = !! e\.target\.closest\(IMAGES_SCROLL \+ ', ' \+ IMAGES_ITEM\)/.test(code));
    check('① syncFullscreenIcon 必须幂等：只在"真的刚进全屏"那一下清 ls-fs-ui',
        /const wasFs = document\.documentElement\.classList\.contains\('ls-viewer-fs'\)/.test(code)
        && /if \(on && ! wasFs\) \{[\s\S]{0,200}classList\.remove\('ls-fs-ui'\)/.test(code));
    check('④ 库的判定矩形每帧/每次按下都刷成当前真实矩形（不然"某些位置拖不出框"）',
        /const dsSyncAreaRect = \(\) => \{[\s\S]{0,900}ds\.SelectorArea\._rect = \{[\s\S]{0,220}left: r\.left, top: r\.top, right: r\.right, bottom: r\.bottom/.test(code)
        && /dsSyncAreaRect\(\);[\s\S]{0,200}const inArea = !! e\.target\.closest\(IMAGES_SCROLL/.test(code)
        && /dsBoxRect\(\);[\s\S]{0,160}dsSyncAreaRect\(\)/.test(code));
}

// ---------------------------------------------------------------- 8. 点空白（拖后不关 / 全屏显示 UI）
console.log('\n[8] 看图器「点空白」：拖动后不算点击 + 全屏改成显示 UI');
{
    check('⑧ 非全屏：拖动后松手的那一下不算点击（不关看图器）',
        /const MOVE_SLOP = \d+;/.test(code)
        && /const DRAG_WINDOW = \d+;/.test(code)
        && /addEventListener\('pointerup'[\s\S]{0,140}dragEndAt = Date\.now\(\)/.test(code)
        && /Date\.now\(\) - dragEndAt < DRAG_WINDOW[\s\S]{0,120}e\.stopPropagation\(\)/.test(code));
    check('⑧ 全屏：点空白不再关闭，改成显示 UI（坐标取自 detail.originalEvent）',
        /document\.documentElement\.classList\.contains\('ls-viewer-fs'\)[\s\S]{0,200}e\.stopPropagation\(\)[\s\S]{0,300}flashViewerUI\(\{type: 'click'/.test(code)
        && /const src = \(e\.detail && e\.detail\.originalEvent\) \|\| e;/.test(code));
    check('⑧ 拦截点是 document 捕获阶段 + 只认 .viewer-canvas（不然会误伤工具栏按钮）',
        /const isCanvas = \(el\) => el instanceof Element && el\.classList\.contains\('viewer-canvas'\)/.test(code)
        && /addEventListener\('click', \(e\) => \{[\s\S]{0,2000}if \(! isCanvas\(e\.target\)\) \{ return; \}[\s\S]{0,9000}\}, true\)/.test(code));
    check('⑧ 新增的「非全屏 + UI 收着」守卫在 click 捕获处理里、排在 isCanvas 判定之前',
        (() => {
            const iDef = code.indexOf('const isCanvas = (el) =>');
            const iGuard = code.indexOf('if (hiddenAtDown) {');
            const iCall = code.indexOf('if (! isCanvas(e.target)) { return; }');
            return iDef > -1 && iGuard > iDef && iCall > iGuard;
        })());
    check('⑧ 标记是一次性取值：先读进局部量、随即复位（没有前置 pointerdown 的合成 click 不许沿用旧值）',
        /const hiddenAtDown = windowedUiHiddenAtDown;[\s\S]{0,240}windowedUiHiddenAtDown = false;/.test(code)
        && /const downTouch = windowedUiHiddenAtDownTouch;[\s\S]{0,240}windowedUiHiddenAtDownTouch = false;/.test(code));
    check('⑧ 只有触屏/笔才补排收起（鼠标停在 UI 上时不该被收走）',
        /windowedUiHiddenAtDownTouch = windowedUiHiddenAtDown[\s\S]{0,160}e\.pointerType === 'touch' \|\| e\.pointerType === 'pen'/.test(code)
        && /if \(downTouch\) \{ scheduleViewerUiHide\(\); \}/.test(code));
    check('⑧ 触屏也记"拖动"（pointermove 在部分安卓上会被 preventDefault 吃掉）',
        /addEventListener\('touchmove'[\s\S]{0,220}dragged = true/.test(code));
}

// ---------------------------------------------------------------- 9. 「下载原图」已彻底移除
console.log('\n[9] 「下载原图」整条链路已移除（键 / 函数 / 图标 / 提示语 都钉住）');
{
    const tbStart = code.indexOf('toolbar: {');
    const toolbar = tbStart < 0 ? '' : code.slice(tbStart, code.indexOf("'flip-vertical': true", tbStart) + 400);
    check('工具栏区间里没有 download 键', !! toolbar && ! /\bdownload\s*:/.test(toolbar));
    check('全文件没有 downloadViewerImage（定义或调用都没有）',
        ! blade.includes('downloadViewerImage') && ! code.includes('downloadViewerImage'));
    check('CSS 里没有 .viewer-download 图标规则（连空壳都没留）', ! blade.includes('viewer-download'));
    check('页面上没有残留的「下载原图」文案（注释之外）', ! code.includes('下载原图'));
    check('下载路径专用的跨域提示也没留下（原图在新标签页打开）', ! code.includes('原图在新标签页打开'));
    check('下载路径专用的 iOS 提示也没留下（存储到照片）', ! code.includes('存储到照片'));
}

// ---------------------------------------------------------------- 10. 裁剪入口的反查同源行为（真跑）
// 把 openFromViewer 从 blade 里按花括号配对抠出真身（不手抄），用 new Function 注入假
// document / toastr / open 直接跑，逐条核对「命中 / 兜底 / 空图」三条路径。
function extractArrowFn(text, name) {
    const marker = `const ${name} = `;
    const start = text.indexOf(marker);
    if (start < 0) throw new Error(`源码里找不到 ${marker}`);
    const brace = text.indexOf('{', start);
    let depth = 0, i = brace;
    for (; i < text.length; i++) {
        const c = text[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    if (depth !== 0) throw new Error(`${name} 花括号没配对`);
    return text.slice(start, i);
}

const IMAGES_ITEM_VAL = (/const IMAGES_ITEM = '([^']+)';/.exec(blade) || [null, ''])[1];
const GALLERY_HREF = 'https://gallery.example.com/#/user/images';
const GALLERY_ORIGIN = 'https://gallery.example.com';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const CROSS_URL = 'https://cdn.other.example.com/storage/2026/10/IMG_0002.jpg';
const CROSS_HINT = '原图在新标签页打开';
const IOS_HINT = '存储到照片';

// 假环境：document（querySelectorAll 返回带 getAttribute 的假元素）、toastr、viewerUrl。
function makeEnv(opts) {
    const env = {
        url: opts.url,
        els: (opts.cards || []).map((c) => ({
            __card: true, __url: c.url, __name: c.name,
            getAttribute: (k) => (k === 'data-original' ? c.url : null),
        })),
        selector: null,
        toastrCalls: [], opened: [], threw: null,
    };
    env.doc = {
        querySelectorAll(sel) { env.selector = sel; return env.els; },
    };
    env.toastr = {
        warning: (m) => env.toastrCalls.push(['warning', m]),
        info: (m) => env.toastrCalls.push(['info', m]),
    };
    env.open = (item) => env.opened.push(item);
    env.viewerUrl = () => opts.url;
    env.toasts = () => env.toastrCalls.map((c) => c[0] + ':' + c[1]);
    env.runOpenFromViewer = (viewerUrlFn) => {
        try {
            const fn = new Function('viewerUrl', 'open', 'toastr', 'document', 'IMAGES_ITEM',
                `${ovSrc};\nreturn openFromViewer;`)(viewerUrlFn || env.viewerUrl, env.open, env.toastr, env.doc, IMAGES_ITEM_VAL);
            fn();
        } catch (e) { env.threw = e; }
        return env;
    };
    return env;
}

let ovSrc = '';
try { ovSrc = extractArrowFn(blade, 'openFromViewer'); } catch (e) { /* 下面断言报错 */ }

console.log('\n[10] 看图器「裁剪」入口 openFromViewer 真跑：异常 URL 不抛异常 + 命中 / 兜底 / 空图');
{
    const NL_URL = 'https://gallery.example.com/storage/a\nb.HEIC';
    {
        const env = makeEnv({ url: NL_URL, cards: [{ url: NL_URL, name: 'a b.HEIC' }] });
        env.runOpenFromViewer();
        check('⑩ 含换行的 URL：不抛异常（旧写法拼选择器会 SyntaxError ⇒ 按钮点了没反应）',
            env.threw === null, env.threw ? env.threw.message : 'null');
        check('⑩ 含换行的 URL：反查命中 ⇒ open 收到的就是那张卡片元素',
            env.opened.length === 1 && env.opened[0] === env.els[0],
            `opened=${env.opened.length} 同一元素? ${env.opened[0] === env.els[0]}`);
        check('⑩ 反查选择器是常量（未把 URL 拼进去）',
            env.selector === IMAGES_ITEM_VAL + ' img[data-original]', `selector=${env.selector}`);
    }
    {
        const env = makeEnv({ url: NL_URL, cards: [{ url: 'https://gallery.example.com/storage/other.jpg', name: 'other.jpg' }] });
        env.runOpenFromViewer();
        const arg = env.opened[0] || {};
        check('⑩ 反查落空 ⇒ 兜底对象 {url}（不抛异常、也不会把 undefined 递给 open）',
            env.threw === null && env.opened.length === 1 && arg !== env.els[0] && arg.url === NL_URL,
            `arg.url=${arg.url}`);
        check('⑩ 兜底对象只有 url 一个字段', Object.keys(arg).join(',') === 'url', Object.keys(arg).join(','));
    }
    {
        const env = makeEnv({ url: CROSS_URL, cards: [{ url: CROSS_URL, name: 'x.jpg' }] });
        env.runOpenFromViewer();
        check('⑩ 跨域原图也照样反查命中（裁剪入口与存储域无关）',
            env.threw === null && env.opened[0] === env.els[0]);
    }
    {
        const env = makeEnv({ url: '', cards: [] });
        env.runOpenFromViewer();
        check('⑩ 当前图为空 ⇒ 只弹一条 warning、不调 open',
            env.toastrCalls.length === 1 && env.toastrCalls[0][0] === 'warning' && env.opened.length === 0,
            JSON.stringify(env.toasts()));
    }
}

// ---------------------------------------------------------------- 11. 非全屏 UI 收起时的「第一下点击」（jsdom 真跑）
// 把 blade 里「UI 自动收起 + 第一下点击守卫」那一整段（常量、pointerOverZones、flashViewerUI、
// scheduleViewerUiHide、windowedUiHiddenAtDown 记录器、第八轮那个 IIFE）按位置抠出来，注入 jsdom 的
// document / Element **直接运行**，再用真实 DOM 事件（PointerEvent / 库补发的 CustomEvent click）驱动。
// 库那一侧用一个注册在 .viewer-container 冒泡阶段的监听代理（与压缩产物里 wt(viewer, 'click', ...) 的
// 落点一致）：点在缩略图上 ⇒ 记一次 view（库会切图）；点在画布上 ⇒ 记一次 close（库会关掉看图器）。
console.log('\n[11] 收起状态下的第一下点击：真 DOM 事件驱动（jsdom）');
const UI_ZONES = ['.viewer-toolbar', '.viewer-navbar', '.viewer-title', '.viewer-button'];
const UI_RECTS = {
    '.viewer-toolbar': { left: 100, top: 8, right: 290, bottom: 48 },
    '.viewer-navbar': { left: 0, top: 600, right: 390, bottom: 660 },   // 390px 视口下的缩略图条
    '.viewer-title': { left: 8, top: 24, right: 120, bottom: 48 },
    '.viewer-button': { left: 350, top: 8, right: 382, bottom: 40 },
};
const IDLE_SRC = (() => {
    const a = blade.indexOf("const VIEWER_OPEN_CLASS = 'ls-viewer-open';");
    const b = blade.indexOf('/* 点背景 / 按 × 关掉看图器时', a);
    return (a >= 0 && b > a) ? blade.slice(a, b) : '';
})();

function bootViewerUi() {
    const dom = new JSDOM(`<!DOCTYPE html><html class="ls-viewer-open"><body>
        <div class="viewer-container">
            <div class="viewer-canvas"><img alt="cur"></div>
            <ul class="viewer-toolbar"><li class="viewer-crop"></li></ul>
            <ul class="viewer-navbar"><li class="thumb">thumb</li></ul>
            <div class="viewer-title">t</div>
            <button class="viewer-button"></button>
        </div></body></html>`, { pretendToBeVisual: true });
    const w = dom.window;
    Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true });      // 手机宽度
    // jsdom 不做布局 ⇒ 矩形要自己钉（pointerOverZones 要求 width/height > 0）
    for (const sel of UI_ZONES) {
        const el = w.document.querySelector(sel);
        const r = UI_RECTS[sel];
        el.getBoundingClientRect = () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top });
    }
    // 库那一侧的 click 处理（冒泡阶段，与库里 wt(viewer, 'click', ...) 的落点一致）
    const lib = [];
    w.document.querySelector('.viewer-container').addEventListener('click', (e) => {
        const thumb = e.target.closest && e.target.closest('.viewer-navbar li');
        lib.push(thumb ? 'view' : 'close');
    });
    // 真跑被测代码：抠出来的原文整段塞进去，只用 jsdom 的 document / Element
    // 计时器换成记账版：用来断言「触屏唤醒后确实补排了一次 2500ms 的收起」，不必真等 2.5s
    const timerLog = { set: [], clear: [] };
    const api = new Function('document', 'Element', 'setTimeout', 'clearTimeout',
        IDLE_SRC + '\n' + 'return { zones: WINDOWED_UI_ZONES, fsZones: FS_UI_ZONES, hiddenAtDown: () => windowedUiHiddenAtDown, downTouch: () => windowedUiHiddenAtDownTouch };')(
        w.document, w.Element,
        (fn, ms) => { timerLog.set.push(ms); return w.setTimeout(fn, ms); },
        (id) => { timerLog.clear.push(id); return w.clearTimeout(id); });
    const center = (sel) => {
        const r = UI_RECTS[sel];
        return [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    };
    const fire = (sel, xy, kind, libClick, pointerType) => {
        const el = w.document.querySelector(sel);
        if (kind === 'click') {
            el.dispatchEvent(libClick
                // 库里那条链路：pointerup 时若目标是画布，它向画布补发一个 CustomEvent('click')，
                // 坐标在 detail.originalEvent 里（不在 e.clientX 上）
                ? new w.CustomEvent('click', { bubbles: true, detail: { originalEvent: { clientX: xy[0], clientY: xy[1] } } })
                : new w.MouseEvent('click', { bubbles: true, clientX: xy[0], clientY: xy[1] }));
        } else {
            el.dispatchEvent(new w.PointerEvent('pointerdown', {
                bubbles: true, clientX: xy[0], clientY: xy[1], buttons: 1,
                pointerType: pointerType || 'mouse',       // 真机一定是 mouse/touch/pen 之一
            }));
        }
    };
    return {
        dom, w, lib, api, center, fire,
        html: w.document.documentElement,
        idle: () => w.document.documentElement.classList.contains('ls-ui-idle'),
        timerLog,
        // 「收起时按在 UI 上」的完整链路：指针落在画布（收起时 UI 不接指针）→ 库补发 click 到画布
        tapHiddenZone: (sel) => {
            const xy = center(sel);
            fire('.viewer-canvas', xy, 'pointerdown');
            fire('.viewer-canvas', xy, 'click', true);
        },
    };
}

{
    check('抠到「UI 收起 + 第一下点击」那段真身（未手抄）',
        IDLE_SRC.length > 3000 && IDLE_SRC.includes('const pointerOverZones')
        && IDLE_SRC.includes('let windowedUiHiddenAtDown = false;') && IDLE_SRC.includes('if (! isCanvas(e.target))'),
        `${IDLE_SRC.length} 字符`);
    check('抠出来的那段和源码里那四块常量对得上（真跑的就是生产代码）',
        IDLE_SRC.includes("const WINDOWED_UI_ZONES = ['.viewer-toolbar', '.viewer-navbar', '.viewer-title', '.viewer-button']"));

    // ① 非全屏 + ls-ui-idle + 落在缩略图条矩形内（pointer-events:none ⇒ 命中的是画布）
    {
        const x = bootViewerUi();
        x.html.classList.add('ls-ui-idle');
        check('① 前置：非全屏（无 .ls-viewer-fs）+ 看图器开着 + UI 已收起',
            ! x.html.classList.contains('ls-viewer-fs') && x.html.classList.contains('ls-viewer-open') && x.idle());
        const xy = x.center('.viewer-navbar');
        x.fire('.viewer-canvas', xy, 'pointerdown');
        check('① 按下这一下就把「刚才还收着」记下来了（记录器确实排在刷新 UI 的名单之前）',
            x.api.hiddenAtDown() === true);
        check('① 同一个 pointerdown 也把 ls-ui-idle 摘掉 ⇒ UI 立刻淡回来（唤出）', x.idle() === false);
        check('① 记录器读到的四块矩形表就是生产代码里那份',
            Array.isArray(x.api.zones) && x.api.zones.join('|') === UI_ZONES.join('|'), `zones=${x.api.zones}`);
        x.fire('.viewer-canvas', xy, 'click', true);
        check('① 库的 click 回调一次都没被调到（stopPropagation 真生效）', x.lib.length === 0, JSON.stringify(x.lib));
        check('① 那一下也没被当成「点空白退出」（既不切图也不关看图器）',
            ! x.lib.includes('view') && ! x.lib.includes('close'));
        x.fire('.viewer-navbar li', xy, 'pointerdown');
        check('① UI 已可见后再按一下，记录器回到 false（每次按下都重算，不是一次性的）',
            x.api.hiddenAtDown() === false);
        x.dom.window.close();
    }

    // ② 触屏唤醒后自己排一次收起（鼠标只续期）；标记一次性
    {
        const x = bootViewerUi();
        x.html.classList.add('ls-ui-idle');
        const xy = x.center('.viewer-navbar');
        x.fire('.viewer-canvas', xy, 'pointerdown', false, 'touch');
        check('② 触屏按下：记下「刚才收着」且认得出是触屏', x.api.hiddenAtDown() === true && x.api.downTouch() === true);
        x.timerLog.set.length = 0;
        x.fire('.viewer-canvas', xy, 'click', true);
        check('② 触屏收起态点底部：吞掉那一下 + 补排一次 2500ms 的收起（否则 UI 会一直挂着）',
            x.lib.length === 0 && x.timerLog.set.length === 1 && x.timerLog.set[0] === 2500,
            `lib=${JSON.stringify(x.lib)} timers=${JSON.stringify(x.timerLog.set)}`);
        x.dom.window.close();
    }
    {
        const x = bootViewerUi();
        x.html.classList.add('ls-ui-idle');
        const xy = x.center('.viewer-navbar');
        x.fire('.viewer-canvas', xy, 'pointerdown', false, 'mouse');
        check('② 鼠标按下：同样记下「刚才收着」，但不判为触屏', x.api.hiddenAtDown() === true && x.api.downTouch() === false);
        x.timerLog.set.length = 0;
        x.fire('.viewer-canvas', xy, 'click', true);
        check('② 鼠标收起态点底部：也吞掉那一下，但只续期、不补排（指针停在 UI 上不该被收走）',
            x.lib.length === 0 && x.timerLog.set.length === 0,
            `lib=${JSON.stringify(x.lib)} timers=${JSON.stringify(x.timerLog.set)}`);
        x.dom.window.close();
    }
    {
        const x = bootViewerUi();
        x.html.classList.add('ls-ui-idle');
        const xy = x.center('.viewer-navbar');
        x.fire('.viewer-canvas', xy, 'pointerdown', false, 'mouse');
        x.fire('.viewer-canvas', xy, 'click', true);          // 第一次：被吞
        check('② 第一次确实被吞了', x.lib.length === 0, JSON.stringify(x.lib));
        x.fire('.viewer-canvas', xy, 'click', true);          // 没有前置 pointerdown 的合成 click
        check('② 一次性：合成 click 不再沿用旧标记（否则会被当成第二次「第一下」再吞一次）',
            x.lib.includes('close'), JSON.stringify(x.lib));
        x.dom.window.close();
    }

    // ② UI 可见时点缩略图 ⇒ 照常切图
    {
        const x = bootViewerUi();
        const xy = x.center('.viewer-navbar');
        x.fire('.viewer-navbar li', xy, 'pointerdown');
        x.fire('.viewer-navbar li', xy, 'click');
        check('② UI 可见时点缩略图：库的 view 照常被调到（没被守卫吞掉）',
            x.lib.length === 1 && x.lib[0] === 'view', JSON.stringify(x.lib));
        x.dom.window.close();
    }

    // ③ UI 可见时点画布空白 ⇒ 照常退出看图器
    {
        const x = bootViewerUi();
        x.fire('.viewer-canvas', [195, 300], 'pointerdown');
        x.fire('.viewer-canvas', [195, 300], 'click');
        check('③ UI 可见时点画布空白：库收到 close（原有「点空白退出」没被破坏）',
            x.lib.length === 1 && x.lib[0] === 'close', JSON.stringify(x.lib));
        x.dom.window.close();
    }

    // ④ 全屏点空白 ⇒ 只唤出，不退出
    {
        const x = bootViewerUi();
        x.html.classList.add('ls-viewer-fs');
        x.fire('.viewer-canvas', [195, 300], 'pointerdown');
        check('④ 全屏下记录器恒为 false（③ 只管非全屏，全屏仍走它自己那条分支）',
            x.api.hiddenAtDown() === false);
        x.fire('.viewer-canvas', [195, 300], 'click');
        check('④ 全屏点空白：库没收到 close（不许关掉看图器）', x.lib.length === 0, JSON.stringify(x.lib));
        check('④ 同时把 UI 唤出来（加了 ls-fs-ui）', x.html.classList.contains('ls-fs-ui'));
        x.dom.window.close();
    }

    // ⑤ 收起状态下点在四块之外 ⇒ 该退还是退（守卫只认那几块矩形，没有扩大成整屏）
    {
        const x = bootViewerUi();
        x.html.classList.add('ls-ui-idle');
        x.fire('.viewer-canvas', [195, 300], 'pointerdown');     // 画布中部：四块都不覆盖
        x.fire('.viewer-canvas', [195, 300], 'click', true);
        check('⑤ UI 收着时点四块之外：库照常收到 close（守卫没把整屏都吞掉）',
            x.lib.length === 1 && x.lib[0] === 'close', JSON.stringify(x.lib));
        x.dom.window.close();
    }

    // ⑥ 四块逐块真跑：收起时落在任何一块矩形里的第一下都被吞掉
    for (const sel of UI_ZONES) {
        const x = bootViewerUi();
        x.html.classList.add('ls-ui-idle');
        x.tapHiddenZone(sel);
        check(`⑥ 收起时落在 ${sel} 矩形内的第一下：被吞掉且 UI 被唤出`,
            x.lib.length === 0 && x.idle() === false, `lib=${JSON.stringify(x.lib)} idle=${x.idle()}`);
        x.dom.window.close();
    }
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
