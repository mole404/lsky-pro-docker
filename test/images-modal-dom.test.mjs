/*
 * 图片页三个弹窗（移动到相册 / 详细信息 / 相册列表）的行为测试（jsdom + 真实 jQuery）
 *
 * 与 images-modal.test.mjs（静态断言）互补：这里把 images.blade.php 里 @push('scripts')
 * 的三段内联脚本真的跑起来（周边依赖打桩），然后驱动新代码路径：
 *   1. methods.movements() → 打开居中卡片弹窗（modal.open），列表渲染进 #movements-albums
 *   2. 点一行 = 只选中（单选、高亮、「当前」标记、≥44px 的行），不发请求
 *   3. 点「移动」才发请求，且 payload 与原来完全一致（selected / id / album_id）
 *   4. 「取消」只关弹窗
 *   5. methods.detail() → 内容渲染进 #image-detail-content，字段顺序 上传时间 → 图片名称
 *   6. getAlbums()（顶部工具栏「相册」）→ 打开 #album-switch-modal：外壳/列表渲染、本地搜索、
 *      点行立即切换并关弹窗、空状态、创建（POST /user/albums + 报错展示）、重命名（PUT）、
 *      删除（原地重拉列表，不关弹窗）、「完成」只关弹窗
 *   7. 右侧抽屉已经从页面里连根删除（测试 DOM 里也没有 #drawer / #drawer-content）
 *
 * 运行：node images-modal-dom.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const blade = fs.readFileSync(path.join(SRC, 'resources', 'views', 'user', 'images.blade.php'), 'utf8');
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');

// 三段内联脚本（按出现顺序）；blade 表达式换成桩串（route() 之类）
function inlineScripts() {
    const tail = blade.slice(blade.indexOf("@push('scripts')"));
    const out = [];
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(tail))) {
        out.push(m[1].replace(/\{\{[\s\S]*?\}\}/g, '/stub').replace(/\{!![\s\S]*?!!\}/g, ''));
    }
    return out;
}

function tpl(id) {
    const start = blade.indexOf(`<script type="text/html" id="${id}">`);
    const end = blade.indexOf('</script>', start);
    return blade.slice(blade.indexOf('>', start) + 1, end);
}

const IMAGE = {
    id: 7, filename: 'beach.jpg', origin_name: 'IMG_0001.HEIC', url: 'https://i.example.com/beach.jpg',
    thumb_url: 'https://i.example.com/beach-thumb.jpg', width: 4000, height: 3000, size: 2048,
    mimetype: 'image/jpeg', md5: 'abcdef', sha1: '123456', permission: 0, uploaded_ip: '1.2.3.4',
    created_at: '2026-09-01 10:00:00', album: { name: '旧相册' }, strategy: { name: '本机' }, links: {},
};

// boot 的选项：
//   putResponse   —— PUT（移动 / 重命名）的响应
//   postResponse  —— POST（创建相册）的响应，默认失败：用来验证「校验报错展示」这条路径
//   swalConfirmed —— Swal 确认框是否点了「确认」（删除相册那条路径）
function boot({ putResponse = { status: true, message: '移动成功' },
                postResponse = { status: false, message: '名称已存在' },
                swalConfirmed = false } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <span id="header-title"></span>
        <div id="images-scroll"><div id="images-grid">
            <a class="images-item" data-id="7" href="javascript:void(0)"
               data-json='${JSON.stringify(IMAGE).replace(/'/g, '&#39;')}'>
                <img alt="beach.jpg" data-original="https://i.example.com/beach.jpg" src="https://i.example.com/beach-thumb.jpg">
            </a>
        </div></div>
        <div id="image-detail-modal" class="hidden"><div id="image-detail-content"></div></div>
        <div id="image-movements-modal" class="hidden"><div id="image-movements-content"></div></div>
        <div id="album-switch-modal" class="hidden"><div id="album-switch-content"></div></div>
        <a data-operate="movements" class="hidden" href="javascript:void(0)">移动到相册</a>
        <a data-operate="detail" class="hidden" href="javascript:void(0)">详细信息</a>
        <input id="search">
        <script type="text/html" id="image-detail-tpl">${tpl('image-detail-tpl')}</script>
        <script type="text/html" id="movements-container-tpl">${tpl('movements-container-tpl')}</script>
        <script type="text/html" id="movements-album-item-tpl">${tpl('movements-album-item-tpl')}</script>
        <script type="text/html" id="album-switch-tpl">${tpl('album-switch-tpl')}</script>
        <script type="text/html" id="albums-container-tpl">${tpl('albums-container-tpl')}</script>
        <script type="text/html" id="albums-item-tpl">${tpl('albums-item-tpl')}</script>
        <script type="text/html" id="album-update-tpl">${tpl('album-update-tpl')}</script>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });

    window.eval(JQUERY_SRC);
    const $ = window.jQuery;
    $.fn.justifiedGallery = function () { return this; };

    const calls = { modalOpen: [], modalClose: [], puts: [], posts: [], deletes: [], gets: [], toasts: [], infiniteScroll: [], attaches: [], refreshes: [] };

    const stores = {
        modal: {
            open: (id) => calls.modalOpen.push(id),
            close: (id) => calls.modalClose.push(id),
            isOpen: () => false,
        },
    };
    window.Alpine = { store: (n) => stores[n] };

    window.axios = {
        put: (url, data) => { calls.puts.push({ url, data }); return Promise.resolve({ data: putResponse }); },
        post: (url, data) => { calls.posts.push({ url, data }); return Promise.resolve({ data: postResponse }); },
        get: (url) => { calls.gets.push(url); return Promise.resolve({ data: { status: true, data: { image: IMAGE } } }); },
        delete: (url) => { calls.deletes.push(url); return Promise.resolve({ data: { status: true, message: 'ok' } }); },
    };

    window.DragSelect = class {
        constructor() { window.DragSelect.last = this; this._sel = []; }
        getSelection() { return this._sel; }
        subscribe() {} setSelectables() {} addSelection() {} toggleSelection() {} clearSelection() {}
        stop() {} break() {}
    };
    window.Viewer = class { update() {} };
    window.ClipboardJS = class { on() { return this; } };
    window.context = { init() {}, attach: (s) => calls.attaches.push(s), isMenuOpen: () => false };
    window.toastr = {
        success: (m) => calls.toasts.push(['success', m]),
        warning: (m) => calls.toasts.push(['warning', m]),
        error: (m) => calls.toasts.push(['error', m]),
    };
    window.Swal = { fire: () => Promise.resolve({ isConfirmed: swalConfirmed }) };
    window.utils = {
        formatSize: (bytes) => `${bytes} B`,
        isMobile: () => false,
        setCapacityProgress() {},
        infiniteScroll(selector, options) {
            // 每个实例单独记账：这样能区分「相册列表」和「图片墙」两条无限加载
            const record = { selector, options, refreshes: [], destroyed: 0 };
            calls.infiniteScroll.push(record);
            return {
                refresh(params) { record.refreshes.push(params); calls.refreshes.push(params); },
                reset() {},
                destroy() { record.destroyed++; },
            };
        },
    };

    // jsdom 的 window.eval 每次都是独立的词法作用域（浏览器里 classic script 之间共享全局词法
    // 环境的行为在 vm 里没有），所以三段脚本拼成一个源一起跑，并在同一作用域里把内部引用抛出来。
    window.eval(inlineScripts().join('\n') + `
        window.__t = {
            methods,
            getAlbums,
            ds,
            setSelectedAlbum(v) { selectedAlbum = v; },
            getSelectedAlbum() { return selectedAlbum; },
        };
    `);

    return { window, $, calls, t: window.__t };
}

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================================================================ 移动到相册
console.log('\n[移动到相册] 弹窗路径走通，抽屉一点没碰');
{
    const { $, calls, t } = boot();
    t.ds._sel = [$('.images-item').get(0)];
    // 当前所在相册（用来验证「当前」标记 + album_id 原值）
    t.setSelectedAlbum({ id: 9, name: '旧相册' });

    t.methods.movements();

    check('打开了新弹窗（modal.open("image-movements-modal")）',
        calls.modalOpen.length === 1 && calls.modalOpen[0] === 'image-movements-modal', JSON.stringify(calls.modalOpen));
    check('内容渲染进 #image-movements-content，标题带已选数量',
        $('#image-movements-content').text().includes('移动到相册') && $('#image-movements-content').text().includes('已选择 1 张图片'));
    check('相册列表挂载在 #movements-albums（没串进相册弹窗）',
        $('#movements-albums').length === 1 && $('#album-switch-content').html() === '',
        `album-switch-content=${JSON.stringify($('#album-switch-content').html())}`);
    check('相册弹窗没有被打开（modal.open 里只有 movements）',
        ! calls.modalOpen.includes('album-switch-modal'), JSON.stringify(calls.modalOpen));
    check('底部「移动」「取消」在，且「移动」默认 disabled',
        $('#movements-confirm').length === 1 && $('#movements-confirm').prop('disabled') === true && $('#movements-cancel').length === 1);

    const scroll = calls.infiniteScroll.at(-1);
    check('相册列表走 utils.infiniteScroll，容器是 #movements-albums',
        scroll?.selector === '#movements-albums', String(scroll?.selector));

    // 喂一页相册数据（模拟 user.albums 的响应）
    scroll.options.success.call({ finished: false }, {
        status: true,
        data: { albums: { data: [{ id: 1, name: '三亚', image_num: 2 }, { id: 9, name: '旧相册', image_num: 0 }], current_page: 1, last_page: 1 } },
    });

    const rows = $('#movements-albums .movements-album');
    check('渲染出两行相册，data-id 正确', rows.length === 2 && rows.eq(0).data('id') === 1 && rows.eq(1).data('id') === 9,
        `${rows.length} 行`);
    check('每行整行可点（min-h-[44px] 的手机点击区）', rows.eq(0).attr('class').includes('min-h-[44px]'));
    check('当前所在相册（id=9）带「当前」标记，别的行没有',
        rows.eq(1).find('.ls-badge').text() === '当前' && rows.eq(0).find('.ls-badge').length === 0,
        rows.eq(1).text().trim());
    check('行里没有 span（避免命中「点 span 加载更多」的委托）', rows.eq(0).find('span').length === 0);

    rows.eq(0).trigger('click');
    check('点一行：选中（data-selected=true + 品牌色高亮 + 对勾出现）',
        rows.eq(0).attr('data-selected') === 'true'
        && rows.eq(0).attr('class').includes('bg-brand-soft')
        && ! rows.eq(0).find('.selected-mark').attr('class').includes('opacity-0'));
    check('点一行：没有立刻发请求（等底部「移动」）', calls.puts.length === 0);
    check('点一行：「移动」变为可用', $('#movements-confirm').prop('disabled') === false);

    rows.eq(1).trigger('click');
    check('单选：点第二行后第一行回到未选中',
        rows.eq(0).attr('data-selected') === 'false' && rows.eq(1).attr('data-selected') === 'true'
        && ! rows.eq(0).attr('class').includes('bg-brand-soft'));
    check('单选：对勾也跟着切换',
        rows.eq(0).find('.selected-mark').attr('class').includes('opacity-0')
        && ! rows.eq(1).find('.selected-mark').attr('class').includes('opacity-0'));

    $('#movements-confirm').trigger('click');
    check('点「移动」：请求沿用原实现（同一 route + selected/id/album_id）',
        calls.puts.length === 1 && calls.puts[0].url === '/stub'
        && JSON.stringify(calls.puts[0].data) === JSON.stringify({ selected: [7], id: 9, album_id: 9 }),
        JSON.stringify(calls.puts[0]));

    await sleep(20);
    check('移动成功后：关弹窗 + toastr.success',
        calls.modalClose.includes('image-movements-modal') && calls.toasts.some((t) => t[0] === 'success'),
        JSON.stringify(calls.toasts));
}

// ================================================================ 取消
console.log('\n[移动到相册] 「取消」只关弹窗');
{
    const { $, calls, t } = boot();
    t.ds._sel = [$('.images-item').get(0)];
    t.methods.movements();
    $('#movements-cancel').trigger('click');
    check('点「取消」：关弹窗且没有发任何请求',
        calls.modalClose.includes('image-movements-modal') && calls.puts.length === 0,
        JSON.stringify(calls.modalClose));
}

// ================================================================ 详细信息
console.log('\n[详细信息] 弹窗路径 + 字段顺序（上传时间第一、图片名称第二）');
{
    const { $, calls, t } = boot();
    t.methods.detail($('.images-item').get(0));
    await sleep(20);

    check('请求走原接口（/user/images/:id）', calls.gets.length === 1 && calls.gets[0] === '/user/images/7', JSON.stringify(calls.gets));
    check('渲染进 #image-detail-content 并打开 #image-detail-modal',
        $('#image-detail-content').text().includes('beach.jpg')
        && calls.modalOpen.includes('image-detail-modal'), JSON.stringify(calls.modalOpen));
    check('内容没有串进相册弹窗（#album-switch-content 仍是空的）', $('#album-switch-content').html() === '');

    const labels = $('#image-detail-content dt').map(function () { return $(this).text().trim(); }).get();
    check('字段一个不少（12 项，与改前一致）', labels.length === 12, labels.join(' / '));
    check('顺序：上传时间 第一、图片名称 第二', labels[0] === '上传时间' && labels[1] === '图片名称', labels.join(' / '));
    check('其余字段保持原有相对顺序',
        JSON.stringify(labels.slice(2)) === JSON.stringify(['相册名称', '使用策略', '图片原始名称', '图片大小', '图片类型', '尺寸', 'MD5', 'SHA-128', '权限', '上传 IP']),
        labels.slice(2).join(' / '));
    check('小缩略图用的是 thumb_url', $('#image-detail-content img').attr('src') === IMAGE.thumb_url);
    check('值是渲染后的真实内容（不是占位符）',
        $('#image-detail-content').text().includes('2026-09-01 10:00:00') && $('#image-detail-content').text().includes('2097152 B')
        && ! $('#image-detail-content').text().includes('__'));
    check('标签 13px、值 14px（text-[13px] / text-[14px]）',
        $('#image-detail-content dt').first().attr('class').includes('text-[13px]')
        && $('#image-detail-content dd').first().attr('class').includes('text-[14px]'));
    check('弹窗里没有复制链接/下载/删除这类快捷操作',
        !/复制|下载|删除/.test($('#image-detail-content').text()));
}


// ================================================================ 相册弹窗：外壳 + 列表 + 搜索
console.log('\n[相册弹窗] 顶部工具栏的「相册」入口：渲染、本地搜索、≥44px 行、当前徽标、点行即切换');
{
    const { $, calls, t } = boot();
    // 当前所在相册（用来验证「当前」徽标 + 高亮）
    t.setSelectedAlbum({ id: 9, name: '旧相册' });
    t.getAlbums();

    check('打开的是相册弹窗（modal.open("album-switch-modal")）',
        calls.modalOpen.length === 1 && calls.modalOpen[0] === 'album-switch-modal', JSON.stringify(calls.modalOpen));
    check('外壳渲染进 #album-switch-content（标题「相册」+ 搜索框 + 列表容器 + 「完成」）',
        $('#album-switch-content p').first().text() === '相册' && $('#album-switch-search').length === 1
        && $('#album-switch-scroll').length === 1 && $('#album-switch-done').length === 1);
    check('列表挂在 #album-switch-scroll > #albums-container，无限加载容器就是它',
        $('#album-switch-scroll #albums-container').length === 1
        && calls.infiniteScroll.at(-1)?.selector === '#album-switch-scroll', String(calls.infiniteScroll.at(-1)?.selector));
    check('旧的 #drawer / #drawer-content 在页面里已不存在', $('#drawer').length === 0 && $('#drawer-content').length === 0);
    check('接口回来之前先显示「加载中...」',
        $('#album-switch-loading').length === 1 && ! $('#album-switch-loading').hasClass('hidden'));

    const albumScroll = calls.infiniteScroll.at(-1);
    albumScroll.options.success.call({ finished: false }, {
        status: true,
        data: { albums: { data: [{ id: 1, name: '三亚', image_num: 2, intro: '夏天' }, { id: 9, name: '旧相册', image_num: 0, intro: '' }], current_page: 1, last_page: 1 } },
    });
    albumScroll.options.complete.call({ finished: false });

    const rows = $('#albums-container > a.albums-item');
    check('渲染两行相册（.albums-item 旧标记没变），data-id 正确',
        rows.length === 2 && rows.eq(0).data('id') === 1 && rows.eq(1).data('id') === 9, `${rows.length} 行`);
    check('每行点击区 ≥44px（min-h-[44px]）', rows.eq(0).attr('class').includes('min-h-[44px]'));
    check('左侧相册名（第一个直接子 span）、右侧图片数',
        rows.eq(0).find('>span').first().text() === '三亚' && rows.eq(0).find('.albums-count').text() === '2 张',
        rows.eq(0).text().trim());
    check('当前相册（id=9）高亮 + 「当前」徽标，别的行没有',
        rows.eq(1).find('.ls-badge').text() === '当前' && rows.eq(1).attr('class').includes('bg-brand-soft')
        && ! rows.eq(1).attr('class').includes('bg-surface-2')
        && rows.eq(0).find('.ls-badge').length === 0 && rows.eq(0).attr('class').includes('bg-surface-2'));
    check('加载完收起「加载中...」，有行时不显示空状态',
        $('#album-switch-loading').hasClass('hidden') && $('#album-switch-empty').hasClass('hidden'));

    // 搜索：本地过滤（一个请求都不发）
    const getsBefore = calls.gets.length;
    $('#album-switch-search').val('三').trigger('input');
    check('搜索「三」：命中的行留下、其余隐藏',
        ! rows.eq(0).hasClass('hidden') && rows.eq(1).hasClass('hidden'));
    check('搜索不发任何请求（本地过滤）', calls.gets.length === getsBefore, `${calls.gets.length} vs ${getsBefore}`);
    $('#album-switch-search').val('zzz').trigger('input');
    check('搜索没命中：空状态换成「没有匹配的相册」',
        ! $('#album-switch-empty').hasClass('hidden') && $('#album-switch-empty-text').text() === '没有匹配的相册');
    $('#album-switch-search').val('').trigger('input');
    check('清空搜索：两行都回来、空状态收起',
        ! rows.eq(0).hasClass('hidden') && ! rows.eq(1).hasClass('hidden') && $('#album-switch-empty').hasClass('hidden'));

    // 点一行 = 立即切换（沿用旧的那一套：selectedAlbum + resetImages → 关弹窗）
    calls.refreshes.length = 0;
    rows.eq(0).trigger('click');
    check('点一行：按该相册筛选图片（imagesInfinite.refresh 带 album_id=1）',
        calls.refreshes.length === 1 && calls.refreshes[0].album_id === 1, JSON.stringify(calls.refreshes));
    check('点一行：相册弹窗关掉 + 相册列表的无限加载被销毁（= 旧的 drawer.close）',
        calls.modalClose.includes('album-switch-modal') && albumScroll.destroyed === 1,
        `modalClose=${JSON.stringify(calls.modalClose)} destroyed=${albumScroll.destroyed}`);
}

// ================================================================ 相册弹窗：空状态 / 创建 / 重命名 / 删除 / 完成
console.log('\n[相册弹窗] 空状态、创建相册（同一表单/接口/报错）、重命名、删除、完成');
{
    // ---- 空状态 + 创建（接口失败路径：报错展示在表单里）
    const { $, calls, t } = boot();
    t.getAlbums();
    const albumScroll = calls.infiniteScroll.at(-1);
    albumScroll.options.success.call({ finished: false }, {
        status: true,
        data: { albums: { data: [], current_page: 1, last_page: 1 } },
    });
    albumScroll.options.complete.call({ finished: false });

    check('一个相册都没有：显示「还没有相册」+ 创建按钮，且「加载中...」已收起',
        ! $('#album-switch-empty').hasClass('hidden') && $('#album-switch-empty-text').text() === '还没有相册'
        && $('#album-switch-empty button').length === 1 && $('#album-switch-loading').hasClass('hidden'));
    check('列表里也有「创建相册」入口（同一个机制：切换 #album-add）',
        $('#album-switch-create').length === 1 && String($('#album-switch-create').attr('onclick')).includes('#album-add'),
        String($('#album-switch-create').attr('onclick')));

    $('#album-add input[name=name]').val('新相册');
    $('#album-add form').trigger('submit');
    await sleep(20);
    check('创建相册：POST 同一个接口（/user/albums）',
        calls.posts.length === 1 && calls.posts[0].url === '/user/albums', JSON.stringify(calls.posts[0] || null));
    // 注意：报错那段 <.error-message> 上的 class="hidden" 一直都在（上游标记），
    // jQuery 的 .show() 是用内联 display 把 class 的 display:none 顶掉 —— 所以这里断言
    // 「文案进去了 + 内联 display 不再是 none」，而不是断言 class 里没有 hidden。
    check('创建失败：接口 message 写进表单的 .error-message 并显示（校验报错展示没变）',
        $('#album-add .error-message').text().includes('名称已存在')
        && $('#album-add .error-message').css('display') !== 'none',
        `text=${JSON.stringify($('#album-add .error-message').text())} display=${$('#album-add .error-message').css('display')}`);

    // ---- 重命名相册（#album-update-tpl 那一套）
    const second = boot();
    second.t.getAlbums();
    const s2 = second.calls.infiniteScroll.at(-1);
    s2.options.success.call({ finished: false }, {
        status: true,
        data: { albums: { data: [{ id: 3, name: '旅行', image_num: 5, intro: '海边' }], current_page: 1, last_page: 1 } },
    });
    s2.options.complete.call({ finished: false });

    second.$('#albums-container > a.albums-item .update').trigger('click');
    check('点编辑：插入 #album-edit 表单，名称/简介预填（沿用 #album-update-tpl）',
        second.$('#album-edit').length === 1 && second.$('#album-edit input[name=name]').val() === '旅行'
        && second.$('#album-edit textarea[name=intro]').val() === '海边');
    second.$('#album-edit input[name=name]').val('新名字');
    second.$('#album-edit form').trigger('submit');
    await sleep(20);
    check('重命名：PUT /user/albums/3（同一个接口）',
        second.calls.puts.length === 1 && second.calls.puts[0].url === '/user/albums/3',
        JSON.stringify(second.calls.puts[0] || null));
    check('重命名成功后行内名称更新、编辑表单收起',
        second.$('#albums-container > a.albums-item .name').text() === '新名字' && second.$('#album-edit').length === 0);

    // ---- 删除相册：原地重拉列表，不关弹窗（旧抽屉是 300ms 后整个收起来）
    const third = boot({ swalConfirmed: true });
    third.t.getAlbums();
    const s3 = third.calls.infiniteScroll.at(-1);
    s3.options.success.call({ finished: false }, {
        status: true,
        data: { albums: { data: [{ id: 5, name: '待删', image_num: 1, intro: '' }], current_page: 1, last_page: 1 } },
    });
    s3.options.complete.call({ finished: false });
    third.$('#albums-container > a.albums-item .delete').trigger('click');
    await sleep(20);

    check('删除相册：DELETE /user/albums/5', third.calls.deletes[0] === '/user/albums/5', JSON.stringify(third.calls.deletes));
    check('删除后：弹窗不关、列表原地回第一页重拉、当前相册清空',
        ! third.calls.modalClose.includes('album-switch-modal')
        && s3.refreshes.some((params) => params && params.page === 1)
        && JSON.stringify(third.t.getSelectedAlbum()) === '{}',
        `modalClose=${JSON.stringify(third.calls.modalClose)} refreshes=${JSON.stringify(s3.refreshes)}`);

    // ---- 底部「完成」只关弹窗（顺手收掉相册列表的无限加载）
    const fourth = boot();
    fourth.t.getAlbums();
    const s4 = fourth.calls.infiniteScroll.at(-1);
    fourth.$('#album-switch-done').trigger('click');
    check('点「完成」：关弹窗 + 收掉相册列表的无限加载',
        fourth.calls.modalClose.includes('album-switch-modal') && s4.destroyed === 1,
        `modalClose=${JSON.stringify(fourth.calls.modalClose)} destroyed=${s4.destroyed}`);

    // ---- 「移出当前相册」的收尾：等价于旧的 drawer.close()
    const fifth = boot();
    fifth.t.ds._sel = [fifth.$('.images-item').get(0)];
    fifth.t.methods.remove();
    await sleep(20);
    check('移出当前相册成功后：关相册弹窗（旧实现顺手收抽屉）',
        fifth.calls.modalClose.includes('album-switch-modal'), JSON.stringify(fifth.calls.modalClose));
}


// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
