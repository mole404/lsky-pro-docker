/*
 * 图片页「详细信息 / 移动到相册」改成居中卡片弹窗、以及「相册列表」从右侧抽屉搬进弹窗后的
 * 回归测试（纯静态断言，不需要浏览器）
 *
 * 背景：这两项原来是画进右侧抽屉 #drawer 的；老师要求换成复用 x-modal 的居中卡片弹窗。
 * 后续又一次改造：连「相册列表」也从抽屉搬进了 #album-switch-modal，抽屉整块删除。
 * 这个文件把这两次改动的契约钉住：
 *   1. 三个新弹窗的钩子都在，且没有任何一项再走抽屉（抽屉的 markup / JS / 无限加载容器一个不剩）
 *   2. 页面该有的钩子一个都没被改名/删除（菜单绑定、data-operate、相册列表模板…）
 *   3. 「详细信息」字段顺序：上传时间第一、图片名称第二，其余字段一个不少
 *   4. 弹窗内容只用设计令牌（不出现硬编码颜色）
 *   5. 「移动」的请求沿用原实现（同一个 route、同一份 payload）
 *   6. 相册弹窗：本地搜索、行内分区（≥44px 切换区 + 行内常显的 44×44 编辑/删除按钮，按钮在 <a> 外面）、
 *      当前相册高亮+徽标、创建/重命名、加载中/空状态；底部的「完成」按钮已删（不回退）
 *   7. 钉住的 context-js.js（两份拷贝）没被碰过 —— 直接对 Dockerfile 里钉的 md5
 *   8. 二级菜单「返回」的箭头与文字之间留了 6~8px 间距（改的是 .less，不是钉住的 context-js.js）
 *
 * 运行：node images-modal.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const blade = read('resources', 'views', 'user', 'images.blade.php');
const less = read('resources', 'css', 'context-js.less');
const contextJs = read('resources', 'js', 'context-js.js');
const contextJsPub = read('public', 'js', 'context-js', 'context-js.js');
const dockerfile = fs.readFileSync(path.join(here, '..', 'Dockerfile'), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

// 结构断言先去掉注释：注释里会写「旧的 drawer.close()」这类说明，会把「一个都不剩」的检查带偏
const bladeCode = blade
    .replace(/\{\{--[\s\S]*?--\}\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

// 取出一整块 <script type="text/html" id="xxx"> … </script>
function tpl(id) {
    const start = blade.indexOf(`<script type="text/html" id="${id}">`);
    if (start < 0) return '';
    const end = blade.indexOf('</script>', start);
    return end < 0 ? '' : blade.slice(start, end + '</script>'.length);
}

const detailTpl = tpl('image-detail-tpl');
const movementsContainerTpl = tpl('movements-container-tpl');
const movementsItemTpl = tpl('movements-album-item-tpl');
// 相册弹窗（列表从右侧抽屉搬进弹窗）的三个模板
const albumShellTpl = tpl('album-switch-tpl');
const albumContainerTpl = tpl('albums-container-tpl');
const albumItemTpl = tpl('albums-item-tpl');
// 创建/重命名失败时把接口返回的 message 写进表单里的 .error-message 展示（创建与重命名两处共用这一行）
const FORM_ERROR_SHOW = "$errorMessage.html('<i class=\"fas fa-exclamation-circle\"></i> ' + response.data.message).show();";

// ---------------------------------------------------------------- 新弹窗钩子
console.log('\n[新弹窗] 两个居中卡片弹窗（复用 x-modal）的钩子');
{
    check('详细信息弹窗：<x-modal id="image-detail-modal"> + #image-detail-content',
        blade.includes('<x-modal id="image-detail-modal">') && blade.includes('id="image-detail-content"'));
    check('移动到相册弹窗：<x-modal id="image-movements-modal"> + #image-movements-content',
        blade.includes('<x-modal id="image-movements-modal">') && blade.includes('id="image-movements-content"'));
    check('弹窗按钮/容器：movements-albums / movements-confirm / movements-cancel',
        blade.includes('id="movements-albums"') && blade.includes('id="movements-confirm"') && blade.includes('id="movements-cancel"'));
    check('JS 里通过 Alpine 的 modal store 打开（modal.open(...)）',
        /const modal = Alpine\.store\('modal'\);/.test(blade) && blade.includes('modal.open(MOVEMENTS_MODAL)') && blade.includes('modal.open(DETAIL_MODAL)'));
}

// ---------------------------------------------------------------- 不再走抽屉
console.log('\n[换实现] 两项都不再渲染进右侧抽屉，但「移动」的请求实现没被重写');
{
    check('详细信息不再调 drawer.open（原调用已消失）',
        !blade.includes('drawer.open(item.filename, content)') && blade.includes("$('#image-detail-content').html(content);"));
    check('移动到相册不再借用抽屉的相册列表（原 getAlbums({title: \'选择相册\'}) 已消失）',
        !blade.includes("getAlbums({title: '选择相册'}"));
    check('移动请求沿用原实现：同一个 route + selected/id/album_id 三个字段',
        /axios\.put\('\{\{ route\('user\.images\.movement'\) \}\}', \{\s*selected: selected,\s*id: targetId,\s*album_id: selectedAlbum\.id \|\| 0,/.test(blade));
    check('第一版就带「取消」按钮，取消只关弹窗',
        /#movements-cancel'\)\.off\('click'\)\.on\('click', _ => modal\.close\(MOVEMENTS_MODAL\)\)/.test(blade));
    check('移动成功后关弹窗 + resetImages + toastr（沿用原来的收尾）',
        /modal\.close\(MOVEMENTS_MODAL\);\s*resetImages\(\);\s*toastr\.success\(response\.data\.message\);/.test(blade));
}

// ---------------------------------------------------------------- 抽屉已连根删除
console.log('\n[换实现] 右侧抽屉连根删除：markup、JS 状态、无限加载容器一个都不剩');
{
    const drawerGone = [
        'id="drawer-mask"', 'id="drawer"', 'id="drawer-title"', 'id="drawer-content"',
        'const drawer = {', 'const $drawer', '$drawerMask', 'drawer.close()', 'drawer.toggle(', 'drawer.open(',
        "utils.infiniteScroll('#drawer-content'", '#drawer-content',
    ];
    const left = drawerGone.filter((h) => bladeCode.includes(h));
    check('抽屉那一套一个都不剩（markup / $drawer / drawer 对象 / 无限加载容器）', left.length === 0, left.join(' | '));

    check('顶部工具栏「相册列表」入口改为打开相册弹窗（ALBUM_MODAL + openAlbums + modal.open）',
        blade.includes('href="javascript:getAlbums()"')
        && blade.includes("const ALBUM_MODAL = 'album-switch-modal';")
        && blade.includes('openAlbums(content, function () {')
        && blade.includes('modal.open(ALBUM_MODAL);'));

    check('相册弹窗钩子：<x-modal id="album-switch-modal"> + #album-switch-content + 外壳模板',
        blade.includes('<x-modal id="album-switch-modal">') && blade.includes('id="album-switch-content"')
        && blade.includes('id="album-switch-tpl"'));

    check('「移动到相册 / 详细信息」两个弹窗的钩子没被这次改动碰坏',
        blade.includes('<x-modal id="image-detail-modal">') && blade.includes('<x-modal id="image-movements-modal">')
        && blade.includes('modal.open(MOVEMENTS_MODAL)') && blade.includes('modal.open(DETAIL_MODAL)'));

    const menuHooks = [
        'href="javascript:getAlbums()"',
        'data-operate="movements"', 'data-operate="detail"', 'data-operate="remove"',
        'data-operate="delete"', "case 'movements':", "case 'detail':",
        'context.attach(IMAGES_ITEM', 'context.attach(IMAGES_SCROLL',
        "id=\"images-grid\"", "id=\"images-scroll\"", 'class="images-item',
        "id=\"albums-container-tpl\"", "id=\"albums-item-tpl\"", "id=\"album-update-tpl\"", "id=\"image-detail-tpl\"",
        'methods.movements()', 'methods.detail(selected[0])',
        "new ClipboardJS('.dropdown-menu li a.copy'",
    ];
    const missingMenu = menuHooks.filter((h) => !blade.includes(h));
    check('菜单/工具栏绑定一个不少（data-operate、右键菜单 actions、相册列表模板）', missingMenu.length === 0, missingMenu.join(' | '));
}

// ---------------------------------------------------------------- 相册弹窗
console.log('\n[相册弹窗] 标题/搜索/行内分区（44px 切换区 + 常显 44×44 按钮）/当前徽标/加载中/空状态（无底部「完成」）');
{
    const shellTpl = albumShellTpl;
    const containerTpl = albumContainerTpl;
    const itemTpl = albumItemTpl;

    check('标题 16px/600 的「相册」（右上角关闭 ✕ 由 <x-modal> 自带）',
        /<p class="text-\[16px\] font-semibold[^"]*text-ink">__title__<\/p>/.test(shellTpl));
    check('搜索框：按名称本地过滤（#album-switch-search + applyFilter 只切已加载行的 hidden，不打接口）',
        shellTpl.includes('id="album-switch-search"')
        && blade.includes('const applyFilter = () =>')
        && blade.includes("$albums.find('> ' + ALBUM_ROW).each(function ()")
        && blade.includes("$('#album-switch-search').off('input').on('input', _ => applyFilter());"));
    check('列表容器 max-h-[50vh] + overflow-y-auto（滚到底自动加载下一页）',
        /id="album-switch-scroll"[^>]*class="[^"]*overflow-y-auto[^"]*"/.test(shellTpl) && shellTpl.includes('max-h-[50vh]'));
    // 名称从 <span> 改成 <div>（保留 class name）：app.js 的无限加载对列表容器挂的是
    // 「点里面的 span 就加载更多」的委托，相册名是 span 时点一下名字会顺手多拉一页相册。
    // 行内除哨兵（utils.infiniteScroll 自己插的 .infinite-scroll > span）外不能有 span。
    check('每行点击区 ≥44px、左名右数（名称是 <div class="name">、张数 <div>，行内除哨兵外没有 span）',
        itemTpl.includes('min-h-[44px]')
        && /<div class="min-w-0 flex-1 truncate text-\[14px\] name">__name__<\/div>/.test(itemTpl)
        && /<div class="albums-count shrink-0 text-\[13px\] text-ink-3">__image_num__ 张<\/div>/.test(itemTpl)
        && ! /<span/.test(itemTpl));

    const linkPart = itemTpl.slice(itemTpl.indexOf('<a '), itemTpl.indexOf('</a>') + 4);
    const actionsPart = itemTpl.slice(itemTpl.indexOf('albums-actions'));
    check('编辑/删除按钮移出 <a>（点按钮不会再跳进相册），行容器与 <a> 都带 data-id',
        linkPart.length > 0 && ! linkPart.includes('class="update') && ! linkPart.includes('class="delete')
        && actionsPart.includes('class="update') && actionsPart.includes('class="delete')
        && (itemTpl.match(/data-id="__id__"/g) || []).length === 2
        && (itemTpl.match(/data-json='__json__'/g) || []).length === 2);
    check('两个操作按钮 44×44（h-11 w-11）+ 无障碍标签，且常显（模板里没有 hidden / group-hover）',
        (actionsPart.match(/class="(?:update|delete) flex h-11 w-11 items-center justify-center/g) || []).length === 2
        && (actionsPart.match(/aria-label="(?:重命名|删除)相册"/g) || []).length === 2
        && ! itemTpl.includes('hidden') && ! itemTpl.includes('group-hover'));
    // 注意用 bladeCode（已去掉注释）：注释里会写「那条 @media (hover: none) 已删」这类说明
    check('触摸端「常显操作按钮」的媒体查询已删（按钮本来就常显，不留无用/矛盾规则）',
        ! bladeCode.includes('hover: none')
        && ! /#album-switch-modal \.albums-item \.albums-actions/.test(bladeCode));
    check('当前相册：高亮打在行容器 .albums-row 上（边框包得住两个按钮）+ 「当前」徽标',
        itemTpl.includes('__current_badge__')
        && blade.includes("$albums.find('> ' + ALBUM_ROW).each(function ()")
        && blade.includes("toggleClass('border-brand bg-brand-soft text-brand', on)")
        && blade.includes("toggleClass('border-line bg-surface', ! on)")
        && blade.includes('<div class="ls-badge shrink-0 bg-brand-soft text-brand">当前</div>'));
    check('点切换区立即切换（委托到 .albums-item + selectedAlbum + resetImages）',
        blade.includes("$albums.off('click', '.albums-item').on('click', '.albums-item', function () {")
        && /resetImages\(\{page: 1, album_id: selectedAlbum\.id \|\| null\}\);\s*\/\/ 选中即切换[\s\S]{0,160}closeAlbums\(\);/.test(blade));
    check('创建相册：同一个表单 / 接口 / 校验报错展示',
        containerTpl.includes('action="/user/albums"')
        && blade.includes("$albums.off('submit', CREATE_ID + ' form')")
        && blade.includes(FORM_ERROR_SHOW));
    check('重命名相册：仍走 #album-update-tpl 那一套',
        blade.includes("$('#album-update-tpl').html()") && blade.includes("$albums.off('submit', UPDATE_ID + ' form')"));
    check('无限加载容器换成 #album-switch-scroll（每页 40 的接口调用没变：同一个 route）',
        blade.includes("albumsInfinite = utils.infiniteScroll('#album-switch-scroll', {")
        && blade.includes("url: '{{ route('user.albums') }}'"));
    check('空状态：默认隐藏 + 「还没有相册」+ 创建按钮',
        /id="album-switch-empty" class="hidden /.test(containerTpl)
        && containerTpl.includes('还没有相册')
        && /id="album-switch-empty"[\s\S]*?<button[^>]*>创建相册<\/button>/.test(containerTpl));
    check('加载中：转圈（x-loading-spin）+ 文案，加载完收起',
        containerTpl.includes('<x-loading-spin />') && containerTpl.includes('加载中...')
        && blade.includes("$('#album-switch-loading').addClass('hidden');"));
    check('底部「完成」删干净（markup / 事件绑定 / 外层空包裹 div 一个都不剩）',
        ! blade.includes('album-switch-done') && ! shellTpl.includes('album-switch-done')
        && ! /mt-4 flex justify-end/.test(shellTpl));
    check('哨兵在相册弹窗里藏掉（同思路写了新的一条，common.less 那条没动）',
        /#album-switch-modal \.infinite-scroll \{\s*display: none;\s*\}/.test(blade)
        && /#image-movements-modal\s*\{\s*\.infinite-scroll\s*\{\s*display:\s*none;?\s*\}\s*\}/.test(read('resources', 'css', 'common.less')));
    // 桌面宽度：420px → 520px（保持「只按弹窗 id 收窄 md:max-w-2xl 那档」这个思路，别的档不动）
    check('桌面宽度从 420px 加宽到 520px（仍然是 @media min-width:768px + 按弹窗 id 收窄 md:max-w-2xl）',
        /@media \(min-width: 768px\)\s*\{\s*#album-switch-modal \[class\*="md:max-w-2xl"\] \{\s*max-width: 520px;\s*\}\s*\}/.test(blade)
        && ! blade.includes('max-width: 420px'));
}


// ---------------------------------------------------------------- 详细信息字段顺序
console.log('\n[详细信息] 字段顺序与一个都不能少');
{
    const labels = ['上传时间', '图片名称', '相册名称', '使用策略', '图片原始名称', '图片大小', '图片类型',
        '尺寸', 'MD5', 'SHA-128', '标签', '上传 IP'];
    const missing = labels.filter((l) => !detailTpl.includes(`>${l}</dt>`));
    check('12 个字段全在（与改前一致，一个没删）', missing.length === 0, missing.join(' | '));

    const at = (l) => detailTpl.indexOf(`>${l}</dt>`);
    check('顺序：上传时间 排第一', at('上传时间') > -1 && at('上传时间') === Math.min(...labels.map(at)));
    check('顺序：图片名称 紧跟在 上传时间 之后（第二个字段）',
        at('图片名称') === labels.map(at).sort((a, b) => a - b)[1]);
    check('其余字段保持原有相对顺序（相册名称 → 使用策略 → … → 上传 IP）',
        ['相册名称', '使用策略', '图片原始名称', '图片大小', '图片类型', '尺寸', 'MD5', 'SHA-128', '标签', '上传 IP']
            .every((l, i, arr) => i === 0 || at(arr[i - 1]) < at(l)));

    check('顶部有小缩略图（__thumb_url__，JS 里也做了替换）',
        detailTpl.includes('src="__thumb_url__"') && blade.includes('.replace(/__thumb_url__/g, image.thumb_url)'));
    check('标签 13px / 值 14px，行高宽松（leading-6）',
        (detailTpl.match(/text-\[13px\] leading-6 text-ink-3/g) || []).length === 12
        && (detailTpl.match(/text-\[14px\] leading-6 text-ink/g) || []).length === 12);
    check('标签在左、值在右，窄屏可堆叠（12 行都是 flex-col → sm:flex-row + sm:gap-4，行内等距 py-3）',
        // 原来的断言钉的是 class 串一字不差：`flex flex-col gap-0.5 sm:flex-row sm:gap-4`。
        // 二次验收加了行内竖直内边距（py-3，让分区间距一致），class 串里多了这一段，
        // 所以改成按顺序匹配（12 行都要命中），验证的仍然是「窄屏上下堆叠、sm 起左右并排」这个行为。
        (detailTpl.match(/class="flex flex-col gap-0\.5[^"]*sm:flex-row[^"]*sm:gap-4[^"]*"/g) || []).length === 12
        && (detailTpl.match(/class="flex flex-col gap-0\.5 py-3 sm:flex-row sm:gap-4"/g) || []).length === 12
        && detailTpl.includes('<dt class="shrink-0') && detailTpl.includes('<dd class="min-w-0'));
    check('弹窗里没有「复制链接/下载/删除」这类快捷操作',
        !/copy|Clipboard|download|delete|删除|复制链接/.test(detailTpl));
}

// ---------------------------------------------------------------- 移动弹窗
console.log('\n[移动到相册] 单选 + 当前相册标记 + 手机点击区 ≥44px');
{
    check('列表是单选：点击只选中（selectRow），不立刻发请求',
        blade.includes('const selectRow = ($row) =>') && !/on\('click', '\.movements-album', function \(\) \{\s*axios/.test(blade));
    check('当前所在相册标出来（__current_badge__ + selectedAlbum.id 比较）',
        movementsItemTpl.includes('__current_badge__') && blade.includes('albums[i].id === selectedAlbum.id'));
    check('每行点击区 ≥44px（min-h-[44px]）', movementsItemTpl.includes('min-h-[44px]'));
    // 同一个原因：行里别放 span（名称/「当前」徽标都是 <div>），否则点相册名会被
    // app.js 那条「点 span 加载更多」的委托命中、顺手多拉一页相册。
    check('行内一个 span 都没有（名称 <div>、「当前」徽标也是 <div class="ls-badge">）',
        ! /<span/.test(movementsItemTpl)
        && movementsItemTpl.includes('<div class="min-w-0 flex-1 truncate text-[14px]">__name__</div>')
        && /\? '<div class="ls-badge shrink-0 bg-brand-soft text-brand">当前<\/div>'/.test(blade));
    check('底部「移动」「取消」都在，移动默认禁用（没选相册不许提交）',
        /id="movements-confirm"[^>]*disabled/.test(movementsContainerTpl) && movementsContainerTpl.includes('id="movements-cancel"'));
    check('列表数据源与抽屉里的相册列表同一个接口（route user.albums）',
        blade.includes("url: '{{ route('user.albums') }}'"));
}

// ---------------------------------------------------------------- 只用设计令牌
console.log('\n[样式] 弹窗内容只用设计令牌，不硬编码颜色');
{
    // 说明：'albums-container-tpl' 不参与这项检查 —— 它里面那行 .error-message（bg-red-500 / text-white）
    // 是上游原有的创建表单标记，这次没动它（只往里加了新元素）。
    const blocks = {
        'image-detail-tpl': detailTpl, 'movements-container-tpl': movementsContainerTpl,
        'movements-album-item-tpl': movementsItemTpl,
        'album-switch-tpl': albumShellTpl, 'albums-item-tpl': albumItemTpl,
    };
    const bad = [];
    for (const [name, text] of Object.entries(blocks)) {
        if (/#[0-9a-fA-F]{3,8}\b/.test(text)) bad.push(`${name}: hex`);
        if (/\b(?:rgb|rgba|hsl)\(/.test(text)) bad.push(`${name}: rgb/hsl`);
        const hardcoded = text.match(/\b(?:text|bg|border)-(?:white|black|gray-\d+|red-\d+|green-\d+|blue-\d+|slate-\d+|zinc-\d+)\b/g);
        if (hardcoded) bad.push(`${name}: ${[...new Set(hardcoded)].join(',')}`);
    }
    check('三个模板里没有硬编码颜色', bad.length === 0, bad.join(' | '));

    const tokens = ['bg-surface', 'bg-surface-2', 'bg-surface-3', 'text-ink', 'text-ink-3', 'border-line', 'bg-brand-soft', 'text-brand'];
    check('用到的都是设计令牌（surface / ink / line / brand）',
        tokens.filter((t) => (detailTpl + movementsContainerTpl + movementsItemTpl).includes(t)).length >= 6);
    check('选中态用令牌切换（border-brand / bg-brand-soft / text-brand）',
        blade.includes(".toggleClass('border-brand bg-brand-soft text-brand', on)"));
}

// ---------------------------------------------------------------- 二级菜单「返回」
console.log('\n[二级菜单] 「＜ 返回」的箭头与文字之间留了 6~8px');
{
    const m = less.match(/\.dropdown-context \.submenu-back > a > i\s*\{\s*margin-right:\s*(\d+)px;\s*\}/);
    const px = m ? Number(m[1]) : NaN;
    check('.less 里给了 .dropdown-context .submenu-back > a > i 一个 6~8px 的 margin-right',
        !!m && px >= 6 && px <= 8, m ? `${px}px` : '没找到规则');
    check('改的是样式（.less），没有动钉住的 context-js.js 里的「返回」标记',
        contextJs.includes('<i class="fas fa-chevron-left mr-1"></i>返回'));
    // 选择器权重（0,3,2）压过工具类 .mr-1（0,1,0），所以不依赖打包顺序
    check('选择器权重高于工具类 .mr-1（3 个类 + 2 个元素 > 1 个类）', true, '.dropdown-context .submenu-back > a > i');
}

// ---------------------------------------------------------------- 钉住的补丁产物没被碰
console.log('\n[钉住的产物] context-js.js（两份拷贝）与 Dockerfile 里钉的 md5 完全一致');
{
    const pinned = (dockerfile.match(/^\s*'?([0-9a-f]{32})\s+\.\/(?:public|resources)\/js\/context-js(?:\/context-js)?\.js'?\s*\\?$/gm) || [])
        .map((l) => l.trim())
        .map((l) => l.replace(/^'?/, '').split(/\s+/)[0]);
    const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
    check('Dockerfile 里钉着两份 context-js.js 的 md5', pinned.length === 2, pinned.join(' / '));
    check('resources/js/context-js.js 未改动', pinned.includes(md5(contextJs)), md5(contextJs));
    check('public/js/context-js/context-js.js 未改动', pinned.includes(md5(contextJsPub)), md5(contextJsPub));
    check('那三个「资源版本串」标记还在（isIOSWebKit / LONG_PRESS_DELAY = 250 / submenu-inplace）',
        contextJs.includes('isIOSWebKit') && contextJs.includes('LONG_PRESS_DELAY = 250') && contextJs.includes('submenu-inplace'));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
