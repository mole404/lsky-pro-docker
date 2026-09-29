/*
 * 「详细信息 / 移动到相册」新弹窗的行为测试（jsdom + 真实 jQuery）
 *
 * 与 images-modal.test.mjs（静态断言）互补：这里把 images.blade.php 里 @push('scripts')
 * 的三段内联脚本真的跑起来（周边依赖打桩），然后驱动新代码路径：
 *   1. methods.movements() → 打开居中卡片弹窗（modal.open），列表渲染进 #movements-albums
 *   2. 点一行 = 只选中（单选、高亮、「当前」标记、≥44px 的行），不发请求
 *   3. 点「移动」才发请求，且 payload 与原来完全一致（selected / id / album_id）
 *   4. 「取消」只关弹窗
 *   5. methods.detail() → 内容渲染进 #image-detail-content，字段顺序 上传时间 → 图片名称
 *   6. 全程右侧抽屉一点没被这两项用上（#drawer-content 保持空、抽屉没被推开）
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

function boot() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <span id="header-title"></span>
        <div id="images-scroll"><div id="images-grid">
            <a class="images-item" data-id="7" href="javascript:void(0)"
               data-json='${JSON.stringify(IMAGE).replace(/'/g, '&#39;')}'>
                <img alt="beach.jpg" data-original="https://i.example.com/beach.jpg" src="https://i.example.com/beach-thumb.jpg">
            </a>
        </div></div>
        <div id="drawer-mask" class="hidden"></div>
        <div id="drawer"><span id="drawer-title"></span><div id="drawer-content"></div></div>
        <div id="image-detail-modal" class="hidden"><div id="image-detail-content"></div></div>
        <div id="image-movements-modal" class="hidden"><div id="image-movements-content"></div></div>
        <a data-operate="movements" class="hidden" href="javascript:void(0)">移动到相册</a>
        <a data-operate="detail" class="hidden" href="javascript:void(0)">详细信息</a>
        <input id="search">
        <script type="text/html" id="image-detail-tpl">${tpl('image-detail-tpl')}</script>
        <script type="text/html" id="movements-container-tpl">${tpl('movements-container-tpl')}</script>
        <script type="text/html" id="movements-album-item-tpl">${tpl('movements-album-item-tpl')}</script>
        <script type="text/html" id="albums-container-tpl"><div id="albums-container"></div></script>
        <script type="text/html" id="albums-item-tpl"><a class="albums-item" data-id="__id__" data-json='__json__' title="__intro__"><span class="name">__name__</span></a></script>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });

    window.eval(JQUERY_SRC);
    const $ = window.jQuery;
    $.fn.justifiedGallery = function () { return this; };

    const calls = { modalOpen: [], modalClose: [], puts: [], gets: [], toasts: [], infiniteScroll: [], attaches: [], refreshes: [] };

    const stores = {
        modal: {
            open: (id) => calls.modalOpen.push(id),
            close: (id) => calls.modalClose.push(id),
            isOpen: () => false,
        },
    };
    window.Alpine = { store: (n) => stores[n] };

    window.axios = {
        put: (url, data) => { calls.puts.push({ url, data }); return Promise.resolve({ data: { status: true, message: '移动成功' } }); },
        get: (url) => { calls.gets.push(url); return Promise.resolve({ data: { status: true, data: { image: IMAGE } } }); },
        delete: () => Promise.resolve({ data: { status: true, message: 'ok' } }),
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
    window.Swal = { fire: () => Promise.resolve({ isConfirmed: false }) };
    window.utils = {
        formatSize: (bytes) => `${bytes} B`,
        isMobile: () => false,
        setCapacityProgress() {},
        infiniteScroll(selector, options) {
            calls.infiniteScroll.push({ selector, options });
            return { refresh(params) { calls.refreshes.push(params); }, reset() {}, destroy() {} };
        },
    };

    // jsdom 的 window.eval 每次都是独立的词法作用域（浏览器里 classic script 之间共享全局词法
    // 环境的行为在 vm 里没有），所以三段脚本拼成一个源一起跑，并在同一作用域里把内部引用抛出来。
    window.eval(inlineScripts().join('\n') + `
        window.__t = {
            methods,
            getAlbums,
            drawer,
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
    check('相册列表挂载在 #movements-albums（不是 #drawer-content）',
        $('#movements-albums').length === 1 && $('#drawer-content').html() === '',
        `drawer-content=${JSON.stringify($('#drawer-content').html())}`);
    check('抽屉没有被推开（#drawer 的 right 没被动过）',
        $('#drawer').css('right') !== '0px' && $('#drawer').css('right') !== '0', String($('#drawer').css('right')));
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
    check('内容没有进右侧抽屉（#drawer-content 仍是空的）', $('#drawer-content').html() === '');

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


// ================================================================ 抽屉本职
console.log('\n[抽屉] 顶部工具栏的「相册列表」入口照旧走右侧抽屉');
{
    const { $, calls, t } = boot();
    t.getAlbums();

    check('getAlbums() 打开的是抽屉（right 推到 0）而不是弹窗',
        String($('#drawer').css('right')) === '0px' && calls.modalOpen.length === 0,
        `right=${$('#drawer').css('right')} modalOpen=${JSON.stringify(calls.modalOpen)}`);
    check('相册列表内容渲染进 #drawer-content（#albums-container 在抽屉里）',
        $('#drawer-content #albums-container').length === 1 && $('#image-movements-content').html() === '');
    check('抽屉标题带「我的相册」',
        $('#drawer-title').text().includes('我的相册'), $('#drawer-title').text());
    check('抽屉里的列表仍挂在 #drawer-content 上做无限加载',
        calls.infiniteScroll.at(-1)?.selector === '#drawer-content', String(calls.infiniteScroll.at(-1)?.selector));

    calls.infiniteScroll.at(-1).options.success.call({ finished: false }, {
        status: true,
        data: { albums: { data: [{ id: 3, name: '旅行', image_num: 5, intro: '' }], current_page: 1, last_page: 1 } },
    });
    check('抽屉里渲染出相册行（.albums-item，旧标记没变）',
        $('#drawer-content .albums-item').length === 1 && $('#drawer-content .albums-item').data('id') === 3);

    // 点相册 → 筛选图片（resetImages），行为与改前一致
    calls.refreshes.length = 0;
    $('#drawer-content .albums-item').trigger('click');
    check('点抽屉里的相册：按该相册筛选图片（imagesInfinite.refresh 带上 album_id）',
        calls.refreshes.length === 1 && calls.refreshes[0].album_id === 3, JSON.stringify(calls.refreshes));
    check('点抽屉里的相册：抽屉关闭（right 回到 -1000px）',
        String($('#drawer').css('right')) === '-1000px', String($('#drawer').css('right')));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
