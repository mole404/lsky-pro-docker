/*
 * 标签功能（第二步：图库页标签适配 + 「公开/私有」界面全部下线）的回归测试。
 *
 * 两半：
 *   A. 静态契约 —— 四个被改的 blade 里「公开/私有」一个不剩；图库页的标签落点（筛选 /
 *      详情行 / 卡片角标 / 批量打标两套入口）都在；请求形状与后端契约一致。
 *   B. 行为 —— 把 images.blade.php 的三段内联脚本在 jsdom + 真实 jQuery 里跑起来
 *      （周边依赖打桩），驱动标签相关路径：筛选（多选 AND + 清除）、详情卡增/删/新建、
 *      批量打标（添加/移除/新建）、卡片角标。
 *
 * 运行：node tag-feature.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const blade = read('resources', 'views', 'user', 'images.blade.php');
const settingsBlade = read('resources', 'views', 'user', 'settings.blade.php');
const adminImageBlade = read('resources', 'views', 'admin', 'image', 'index.blade.php');
const apiBlade = read('resources', 'views', 'common', 'api.blade.php');
const settingRequest = read('app', 'Http', 'Requests', 'UserSettingRequest.php');
const controller = read('app', 'Http', 'Controllers', 'User', 'ImageController.php');
const contextJs = read('resources', 'js', 'context-js.js');
const contextJsPub = read('public', 'js', 'context-js', 'context-js.js');
const dockerfile = fs.readFileSync(path.join(here, '..', 'Dockerfile'), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

// 结构断言先去掉注释：注释里会写「这里原来是权限下拉」这类说明，会把「字样一个不剩」的检查带偏
const bladeCode = blade
    .replace(/\{\{--[\s\S]*?--\}\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

function tpl(id) {
    const start = blade.indexOf(`<script type="text/html" id="${id}">`);
    if (start < 0) return '';
    const end = blade.indexOf('</script>', start);
    if (end < 0) return '';
    // Blade 注释在真实渲染时会被编译掉；这里取原始 blade 也要先剥掉，
    // 否则注释里出现的尖括号标签会被 jsdom 当成真元素解析（把外层 <a> 提前闭合）。
    return blade.slice(blade.indexOf('>', start) + 1, end).replace(/\{\{--[\s\S]*?--\}\}/g, '');
}

// ================================================================ A. 静态契约
console.log('\n[A. 静态] 「公开 / 私有」的界面临口一个不剩（图文页 / 设置页 / 后台图片页 / 接口文档）');
{
    const files = {
        'user/images.blade.php': blade,
        'user/settings.blade.php': settingsBlade,
        'admin/image/index.blade.php': adminImageBlade,
        'common/api.blade.php': apiBlade,
    };
    const residue = [];
    for (const [name, text] of Object.entries(files)) {
        if (/公开|私有/.test(text)) residue.push(`${name}: 公开/私有`);
        if (/__permission__|设置权限|is:public|is:private/.test(text)) residue.push(`${name}: 权限入口/占位符`);
    }
    check('四个页面的源码里没有「公开 / 私有」与旧权限入口（含注释）', residue.length === 0, residue.join(' | '));

    check('设置页的「图片默认权限」整块已删（连带 ImagePermission 引用）',
        ! settingsBlade.includes('default_permission') && ! settingsBlade.includes('ImagePermission')
        && ! settingsBlade.includes('图片默认权限'));

    check('参数文档里「获取图片列表」的 permission 行已删',
        ! apiBlade.includes('public=公开的') && ! /<td class="px-3 py-2 whitespace-nowrap">permission<\/td>/.test(apiBlade));

    const adminCtrl = read('app', 'Http', 'Controllers', 'Admin', 'ImageController.php');
    check('后台后端也不再支持 is:public / is:private 语法（match 分支已删、无 ImagePermission 引用）',
        ! /'is:public'\s*=>/.test(adminCtrl) && ! /'is:private'\s*=>/.test(adminCtrl)
        && ! adminCtrl.includes('ImagePermission')
        && adminCtrl.includes('原 \'is:public\' / \'is:private\' 两条语法已删除'));
    check('后台支持的其他语法一个没少（is:unhealthy / is:guest / is:adminer / ip: / order:）',
        ['is:unhealthy', 'is:guest', 'is:adminer', "'ip'", 'order:least']
            .every((k) => read('app', 'Http', 'Controllers', 'Admin', 'ImageController.php').includes(k)));
    check('后台图片页的「权限」详情行 / 搜索语法 is:public|is:private 帮助行已删',
        ! adminImageBlade.includes('>权限</dt>') && ! adminImageBlade.includes('is:public') && ! adminImageBlade.includes('is:private'));

    check('图库页里没有任何 permission / 公开 / 私有 残留（去注释后）',
        ! /permission|公开|私有|setPermission/i.test(bladeCode));
}

console.log('\n[A. 静态] 设置页校验的连带修复（保存设置不能再报错）');
{
    check('UserSettingRequest 的 default_permission 不再 required（放宽成 nullable|in:1,0）',
        /'configs\.default_permission'\s*=>\s*'nullable\|in:1,0'/.test(settingRequest)
        && ! /'configs\.default_permission'\s*=>\s*'required/.test(settingRequest));
    check('后端仍然保留 default_permission（permission 列与接口按决策不动）',
        controller.includes("'permission'") && settingRequest.includes('default_permission'));
}

console.log('\n[A. 静态] 标签落点：筛选（多选 AND + 清除）');
{
    check('筛选下拉换成标签：#tag-filter 触发 + #tag-filter-list 容器 + #tag-filter-clear 清除',
        blade.includes('id="tag-filter"') && blade.includes('id="tag-filter-list"')
        && blade.includes('id="tag-filter-clear"') && blade.includes('>清除筛选</a>'));
    check('筛选参数沿用 resetImages({tags:[...]})（后端 tags[] 多值 AND）',
        /resetImages\(\{page: 1, tags: selectedTagIds\.slice\(\)\}\)/.test(blade));
    check('工具栏没有新增第三个下拉（仍然是「排序 + 标签」两个）',
        (bladeCode.match(/<x-dropdown direction="left">/g) || []).length === 2);
    check('标签多选项有 44px 点击区（手机上点得中）',
        /tag-filter-item[^']*min-h-\[44px\]/.test(blade));
    check('标签列表来自 GET user/tags（route user.tags）', /axios\.get\('\{\{ route\('user\.tags'\) \}\}'\)/.test(blade));
}

console.log('\n[A. 静态] 标签落点：详情行 / 卡片角标 / 批量打标（桌面 + 手机）');
{
    const detailTpl = tpl('image-detail-tpl');
    check('详情卡的「权限」行换成「标签」行（字段数仍是 12）',
        detailTpl.includes('>标签</dt>') && ! detailTpl.includes('__permission__')
        && (detailTpl.match(/<dt /g) || []).length === 12);
    check('详情行有标签容器 + 现场新建入口（input + datalist + 添加按钮）',
        detailTpl.includes('id="detail-tags"') && detailTpl.includes('id="detail-tag-input"')
        && detailTpl.includes('id="detail-tag-options"') && detailTpl.includes('id="detail-tag-add"'));
    check('详情行是 flex-wrap（N 个标签在窄屏不会撑破卡片）',
        /id="detail-tags"[^>]*class="[^"]*flex-wrap/.test(detailTpl));

    const itemTpl = tpl('images-item-tpl');
    check('卡片角标：.image-tags + __tags__ 占位 + pointer-events-none',
        itemTpl.includes('class="image-tags pointer-events-none') && itemTpl.includes('__tags__'));
    check('卡片角标避开右上角的 .image-selector（贴左下 bottom-0 left-0，z-[1]）',
        /bottom-0[^"]*z-\[1\]/.test(itemTpl) && /left-0/.test(itemTpl));
    check('角标内容由列表返回的 tags 渲染（前 3 个、长名截断）',
        /cardTagsHtml\(images\[i\]\.tags\)/.test(blade) && /slice\(0, 3\)/.test(blade) && /max-w-\[7rem\] truncate/.test(blade));

    check('弹窗标题是「修改标签」（不是「打标签」）',
        /<p class="text-\[16px\] font-semibold leading-6 text-ink">修改标签<\/p>/.test(tpl('image-tags-tpl'))
        && ! blade.includes('打标签'));
    check('文案已标准化：标题「修改标签」、副标题「点击标签切换」、输入框「请输入…」',
        tpl('image-tags-tpl').includes('点击标签切换')
        && ! tpl('image-tags-tpl').includes('· 点标签切换')
        && tpl('image-tags-tpl').includes('请输入新标签名称')
        && detailTpl.includes('请输入标签名称，回车即可添加')
        && blade.includes('暂无标签'));
    check('批量修改标签弹窗：桌面工具栏 data-operate="tag"',
        /<a data-operate="tag"[^>]*>修改标签<\/a>/.test(blade));
    check('批量打标弹窗：手机 ⋯ 菜单里也有 data-operate="tag"',
        (blade.match(/data-operate="tag"/g) || []).length === 2);
    check('operates 白名单（单选 / 多选）都换成 tag',
        /operates = \['refresh', 'movements', 'tag', 'detail', 'rename', 'delete', 'deselect'\];/.test(blade)
        && /operates = \['refresh', 'movements', 'tag', 'delete', 'deselect'\];/.test(blade));
    check('右键菜单里也能进「管理标签」（紧跟「修改标签」注入到图片菜单）',
        /manageTags: \{\s*text: '管理标签',/.test(blade)
        && /actions\.tag,\s*actions\.manageTags,\s*actions\.detail,/.test(blade)
        && /action: _ => openTagManage\(\)/.test(blade));
    check('右键菜单：actions.tag + 注入 + switch 落地都在',
        /tag: \{\s*text: '修改标签',/.test(blade) && blade.includes('actions.tag,') && /case 'tag':/.test(blade));
    check('批量弹窗模板：标签行 44px 点击区 + 底部取消/确定（默认禁用）',
        /id="image-tags-item-tpl"/.test(blade) && /min-h-\[44px\]/.test(tpl('image-tags-item-tpl'))
        && /id="image-tags-confirm"[^>]*disabled/.test(tpl('image-tags-tpl')));
    check('批量打标请求形状：ids + tags + remove_tags（同一 route user.images.tags）',
        /axios\.put\('\{\{ route\('user\.images\.tags'\) \}\}', payload\)/.test(blade)
        && blade.includes('payload.tags = addIds;') && blade.includes('payload.remove_tags = removeIds;'));
}

console.log('\n[A. 静态] 标签管理（标签本身的新建 / 重命名 / 删除）');
{
    check('入口在标签筛选下拉底部（#tag-manage-open「管理标签」）',
        blade.includes('id="tag-manage-open"') && blade.includes('>管理标签</a>'));
    check('钩子齐全：<x-modal id="tag-manage-modal"> + #tag-manage-content + 三个模板',
        blade.includes('<x-modal id="tag-manage-modal">') && blade.includes('id="tag-manage-content"')
        && ['tag-manage-tpl', 'tag-manage-item-tpl', 'tag-manage-edit-tpl'].every((id) => tpl(id).length > 0));

    const rowTpl = tpl('tag-manage-item-tpl');
    check('行内分区：≥44px 行 + 两个常显 44×44 按钮（模板里没有 hidden / group-hover）',
        rowTpl.includes('min-h-[44px]') && (rowTpl.match(/class="(?:update|delete) flex h-11 w-11/g) || []).length === 2
        && ! /class="[^"]*\bhidden\b/.test(rowTpl) && ! rowTpl.includes('group-hover')   // aria-hidden 不算
        && rowTpl.includes('aria-label="重命名标签"') && rowTpl.includes('aria-label="删除标签"'));

    check('三个请求形状：POST user/tags 新建 / PUT user/tags/{id} 重命名 / DELETE user/tags/{id} 删除',
        /axios\.post\(\$form\.attr\('action'\), \$form\.serialize\(\)\)/.test(blade)
        && /axios\.put\(\$form\.attr\('action'\), \$form\.serialize\(\)\)/.test(blade)
        && /axios\.delete\('\/user\/tags\/' \+ tag\.id\)/.test(blade));

    check('删除有二次确认，文案说明会从所有图片上移除、不可恢复',
        blade.includes("title: '确认删除该标签?'") && blade.includes('删除后将从所有图片上移除标签「')
        && blade.includes('且不可恢复') && blade.includes("confirmButtonText: '确认'"));

    check('重命名是行内展开，名称用 .val() 填（标签名里的引号不会破坏属性）',
        blade.includes("$edit.find('input[name=name]').val($row.find('.name').text());"));

    check('改动后同步三个消费方（筛选下拉 / 详情候选 / 图片墙）',
        /const refreshAfterTagChange = \(\) => loadTags\(\)\.then\(\(\) => setTags\(\)\);/.test(blade));

    check('文案标准化：标题「标签管理」、按钮「新建标签」「确认修改」、空状态「暂无标签」',
        tpl('tag-manage-tpl').includes('标签管理') && tpl('tag-manage-tpl').includes('请输入标签名称')
        && tpl('tag-manage-tpl').includes('>新建标签</button>')
        && tpl('tag-manage-edit-tpl').includes('确认修改') && tpl('tag-manage-edit-tpl').includes('请输入标签名称'));
}

console.log('\n[A. 静态] 钉住的产物没被碰');
{
    const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
    const pinned = (dockerfile.match(/^\s*'?([0-9a-f]{32})\s+\.\/(?:public|resources)\/js\/context-js(?:\/context-js)?\.js'?\s*\\?$/gm) || [])
        .map((l) => l.trim().replace(/^'?/, '').split(/\s+/)[0]);
    check('Dockerfile 仍钉着两份 context-js.js 的 md5',
        pinned.length === 2 && pinned.includes(md5(contextJs)) && pinned.includes(md5(contextJsPub)),
        pinned.join(' / '));
}

// ================================================================ B. 行为（jsdom）
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');

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

const TAGS = [{ id: 11, name: '风景', images_count: 3 }, { id: 12, name: '壁纸', images_count: 1 }];
const IMAGE = {
    id: 7, filename: 'beach.jpg', origin_name: 'IMG_0001.HEIC', url: 'https://i.example.com/beach.jpg',
    thumb_url: 'https://i.example.com/beach-thumb.jpg', width: 4000, height: 3000, size: 2048,
    mimetype: 'image/jpeg', md5: 'abcdef', sha1: '123456', uploaded_ip: '1.2.3.4',
    created_at: '2026-09-01 10:00:00', album: { name: '旧相册' }, strategy: { name: '本机' }, links: {},
    tags: [{ id: 11, name: '风景' }],
};

// boot({ gridItems }) —— gridItems > 0 时预先放好图片墙的卡片（默认 1 张）
function boot({ gridItems = 1, putStatus = true, postStatus = true, swalConfirmed = false } = {}) {
    const items = [];
    for (let i = 0; i < gridItems; i++) {
        const json = JSON.stringify({ ...IMAGE, id: 7 + i, tags: [{ id: 11, name: '风景' }] }).replace(/'/g, '&#39;');
        items.push(`<a class="images-item" data-id="${7 + i}" href="javascript:void(0)" data-json='${json}'>
            <div class="image-tags pointer-events-none absolute left-0 right-0 bottom-0 z-[1]"></div>
            <img alt="beach.jpg" src="https://i.example.com/beach-thumb.jpg"></a>`);
    }

    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <span id="header-title"></span>
        <a id="tag-filter" href="javascript:void(0)"><span>标签</span><i class="fas fa-tags"></i></a>
        <div id="tag-filter-menu"><div id="tag-filter-list"></div>
            <a id="tag-filter-clear" class="ls-menu-item hidden text-brand" href="javascript:void(0)" x-data>清除筛选</a></div>
        <div id="images-scroll"><div id="images-grid">${items.join('')}</div></div>
        <div id="image-detail-modal" class="hidden"><div id="image-detail-content"></div></div>
        <div id="image-tags-modal" class="hidden"><div id="image-tags-content"></div></div>
        <div id="tag-manage-modal" class="hidden"><div id="tag-manage-content"></div></div>
        <a id="tag-manage-open" href="javascript:void(0)">管理标签</a>
        <a data-operate="tag" class="hidden" href="javascript:void(0)">修改标签</a>
        <input id="search">
        <script type="text/html" id="images-item-tpl">${tpl('images-item-tpl')}</script>
        <script type="text/html" id="image-detail-tpl">${tpl('image-detail-tpl')}</script>
        <script type="text/html" id="image-tags-tpl">${tpl('image-tags-tpl')}</script>
        <script type="text/html" id="image-tags-item-tpl">${tpl('image-tags-item-tpl')}</script>
        <script type="text/html" id="tag-manage-tpl">${tpl('tag-manage-tpl')}</script>
        <script type="text/html" id="tag-manage-item-tpl">${tpl('tag-manage-item-tpl')}</script>
        <script type="text/html" id="tag-manage-edit-tpl">${tpl('tag-manage-edit-tpl')}</script>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://lsky.test/user/images' });

    const { window } = dom;
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });

    window.eval(JQUERY_SRC);
    const $ = window.jQuery;
    $.fn.justifiedGallery = function () { return this; };

    const calls = { modalOpen: [], modalClose: [], puts: [], posts: [], gets: [], deletes: [], swals: [], toasts: [], infiniteScroll: [], refreshes: [], attaches: [] };
    // 标签库按 boot 实例持有：POST 新建会真的进库，后续 GET 能读回来（与后端行为一致）
    const tagStore = TAGS.map((t) => ({ ...t }));
    let nextTagId = 13;
    const stores = { modal: { open: (id) => calls.modalOpen.push(id), close: (id) => calls.modalClose.push(id), isOpen: () => false } };
    window.Alpine = { store: (n) => stores[n] };

    window.axios = {
        get: (url) => {
            calls.gets.push(url);
            if (url === '/stub') {
                return Promise.resolve({ data: { status: true, data: { tags: tagStore.map((t) => ({ ...t })) } } });
            }
            return Promise.resolve({ data: { status: true, data: { image: { ...IMAGE } } } });
        },
        put: (url, data) => {
            calls.puts.push({ url, data });
            // 标签重命名走 /user/tags/{id}（body 是 form.serialize() 的字符串）
            const m = /^\/user\/tags\/(\d+)$/.exec(url);
            if (m) {
                const tag = tagStore.find((x) => x.id === Number(m[1]));
                if (tag) {
                    tag.name = typeof data === 'string' ? (new URLSearchParams(data).get('name') || tag.name) : data.name;
                }
                return Promise.resolve({ data: putStatus ? { status: true, message: '修改成功' } : { status: false, message: '标签已存在' } });
            }
            return Promise.resolve({ data: putStatus ? { status: true, message: '设置成功' } : { status: false, message: '设置失败' } });
        },
        post: (url, data) => {
            calls.posts.push({ url, data });
            const name = typeof data === 'string' ? (new URLSearchParams(data).get('name') || '') : data.name;
            if (! postStatus) {
                return Promise.resolve({ data: { status: false, message: '标签已存在' } });
            }
            const created = { id: nextTagId++, name, images_count: 0 };
            tagStore.unshift(created);
            return Promise.resolve({ data: { status: true, message: '创建成功', data: { id: created.id, name: created.name } } });
        },
        delete: (url) => {
            calls.deletes.push(url);
            const m = /^\/user\/tags\/(\d+)$/.exec(url);
            if (m) {
                const i = tagStore.findIndex((x) => x.id === Number(m[1]));
                if (i !== -1) tagStore.splice(i, 1);
            }
            return Promise.resolve({ data: { status: true, message: '删除成功' } });
        },
    };

    window.DragSelect = class {
        constructor() { this._sel = []; window.DragSelect.last = this; }
        getSelection() { return this._sel; }
        subscribe() {} setSelectables() {} addSelection() {} toggleSelection() {} clearSelection() { this._sel = []; } stop() {} break() {}
    };
    window.Viewer = class { update() {} };
    window.ClipboardJS = class { on() { return this; } };
        window.context = { init() {}, attach: (selector, options) => calls.attaches.push({ selector, options: options || {} }), isMenuOpen: () => false };
    window.toastr = {
        success: (m) => calls.toasts.push(['success', m]),
        warning: (m) => calls.toasts.push(['warning', m]),
        error: (m) => calls.toasts.push(['error', m]),
    };
    window.Swal = { fire: (opts) => { calls.swals.push(opts || {}); return Promise.resolve({ isConfirmed: swalConfirmed }); } };
    window.utils = {
        formatSize: (bytes) => `${bytes} B`,
        isMobile: () => false,
        setCapacityProgress() {},
        infiniteScroll(selector, options) {
            const record = { selector, options };
            calls.infiniteScroll.push(record);
            return { refresh(params) { calls.refreshes.push(params); }, reset() {}, destroy() {} };
        },
    };

    window.eval(inlineScripts().join('\n') + `
        window.__t = { methods, ds, toggleTagFilter, getTags() { return allTags; }, getSelectedTagIds() { return selectedTagIds; } };
    `);

    return { window, $, calls, t: window.__t };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n[B. 行为] 顶部标签筛选（多选 AND + 清除）');
{
    const { $, calls, t } = boot();
    await sleep(20);

    check('页面加载即拉标签列表（GET user/tags）', calls.gets.includes('/stub'), JSON.stringify(calls.gets));
    check('当前用户的标签缓存已就绪', JSON.stringify(t.getTags().map((x) => x.id)) === '[11,12]');

    const rows = () => $('#tag-filter-list .tag-filter-item');
    check('筛选下拉渲染出标签行（名称 + 使用数量）', rows().length === 2
        && rows().eq(0).text().includes('风景') && rows().eq(0).text().includes('3'), rows().eq(0).text().trim());
    check('标签行是 44px 点击区（手机点得中）', rows().eq(0).attr('class').includes('min-h-[44px]'));
    check('没有选中时「清除筛选」是隐藏的', $('#tag-filter-clear').hasClass('hidden'));

    rows().eq(0).trigger('click');
    check('勾一个标签 → 图片墙按 {page:1, tags:[11]} 重拉',
        JSON.stringify(calls.refreshes.at(-1)) === JSON.stringify({ page: 1, tags: [11] }),
        JSON.stringify(calls.refreshes.at(-1)));
    check('触发文案变成「标签 (1)」+ 勾选态图标换成 check-square',
        $('#tag-filter span').text() === '标签（1）' && rows().eq(0).find('i').hasClass('fa-check-square'));
    check('「清除筛选」出现了', ! $('#tag-filter-clear').hasClass('hidden'));

    $('#tag-filter-list .tag-filter-item').eq(1).trigger('click');
    check('再勾一个 → 两个标签按 AND 一起带上 {tags:[11,12]}',
        JSON.stringify(calls.refreshes.at(-1)) === JSON.stringify({ page: 1, tags: [11, 12] }),
        JSON.stringify(calls.refreshes.at(-1)));

    $('#tag-filter-list .tag-filter-item').eq(0).trigger('click');
    check('取消一个 → 只剩 {tags:[12]}',
        JSON.stringify(calls.refreshes.at(-1)) === JSON.stringify({ page: 1, tags: [12] }));

    $('#tag-filter-clear').trigger('click');
    // ⚠ 清空时也必须显式带上 tags（空数组）：utils.infiniteScroll 是 $.extend 进内部 data 的，
    //    只传 {page:1} 会让上一次的 tags 残留 —— 浏览器实测踩过「点清除没反应」。
    check('点「清除筛选」→ 显式传空 tags（axios 序列化后查询串里没有 tags 参数，回到全部）',
        JSON.stringify(calls.refreshes.at(-1)) === JSON.stringify({ page: 1, tags: [] })
        && t.getSelectedTagIds().length === 0 && $('#tag-filter span').text() === '标签',
        JSON.stringify(calls.refreshes.at(-1)));
}

console.log('\n[B. 行为] 卡片角标（列表接口带 tags → 角标显示，且不抢点击）');
{
    const { $, calls } = boot({ gridItems: 0 });
    await sleep(20);

    const listCall = calls.infiniteScroll.find((c) => c.selector === '#images-scroll');
    listCall.options.success.call({ finished: false }, {
        status: true,
        data: {
            images: {
                data: [
                    { ...IMAGE, id: 7, tags: [{ id: 11, name: '风景' }, { id: 12, name: '壁纸' }] },
                    { ...IMAGE, id: 8, tags: [] },
                ], current_page: 1, last_page: 1,
            },
        },
    });

    const items = $('#images-grid .images-item');
    check('渲染两张卡片，占位符一个不剩', items.length === 2 && ! $('#images-grid').html().includes('__'), `${items.length} 张`);
    check('第一张卡片的角标显示两个标签', items.eq(0).find('.image-tags .truncate').length === 2
        && items.eq(0).find('.image-tags').text().includes('风景'));
    check('第二张（没有标签）角标是空的', items.eq(1).find('.image-tags').text().trim() === '');
    check('角标容器 pointer-events-none（不抢 DragSelect 的选中与点开预览）',
        items.eq(0).find('.image-tags').hasClass('pointer-events-none'));
    check('标签名做了转义（XSS 防线）', /escapeHtml\(tag\.name\)/.test(blade));
}

console.log('\n[B. 行为] 详情卡：显示 / 移除 / 添加已有 / 现场新建');
{
    const { $, calls, t } = boot();
    await sleep(20);

    t.methods.detail($('.images-item').get(0));
    await sleep(20);

    check('详情卡渲染出这张图的标签 chip', $('#detail-tags .ls-badge').length === 1
        && $('#detail-tags').text().includes('风景'), $('#detail-tags').text().trim());

    $('#detail-tags .detail-tag-remove').eq(0).trigger('click');
    await sleep(20);
    check('点 × 移除 → PUT user/images/tags（ids + remove_tags）',
        JSON.stringify(calls.puts.at(-1)) === JSON.stringify({ url: '/stub', data: { ids: [7], remove_tags: [11] } }),
        JSON.stringify(calls.puts.at(-1)));
    check('移除后就地更新 chip（变成「暂无标签」）+ 卡片角标同步清空',
        $('#detail-tags').text().includes('暂无标签') && $('.images-item .image-tags').text().trim() === '');

    $('#detail-tag-input').val('壁纸');
    $('#detail-tag-add').trigger('click');
    await sleep(20);
    check('添加一个已有标签 → 不再 POST 新建，直接 PUT tags',
        calls.posts.length === 0
        && JSON.stringify(calls.puts.at(-1).data) === JSON.stringify({ ids: [7], tags: [12] }),
        JSON.stringify(calls.puts.at(-1).data));

    const ev = $.Event('keydown'); ev.keyCode = 13; ev.which = 13;
    $('#detail-tag-input').val('新标签');
    $('#detail-tag-input').trigger(ev);
    await sleep(20);
    check('输入新名字回车 → 先 POST user/tags 新建，再 PUT tags 挂上',
        calls.posts.length === 1 && calls.posts.at(-1).data.name === '新标签'
        && JSON.stringify(calls.puts.at(-1).data) === JSON.stringify({ ids: [7], tags: [13] }),
        JSON.stringify(calls.puts.at(-1).data));
    check('新标签就地补进筛选下拉与候选（不用刷新页面）',
        $('#tag-filter-list').text().includes('新标签') && $('#detail-tag-options').html().includes('新标签'));
    check('两个标签都挂上后 chip 有两个', $('#detail-tags .ls-badge').length === 2);
}

console.log('\n[B. 行为] 批量打标：添加 / 移除 / 新建（桌面与手机共用同一弹窗）');
{
    const { $, calls, t } = boot({ gridItems: 2 });
    await sleep(20);

    t.ds._sel = $('.images-item').get();
    t.methods.tag();

    check('打开批量打标弹窗（#image-tags-modal）', calls.modalOpen.at(-1) === 'image-tags-modal');
    check('标题 + 已选数量（两支图片）',
        $('#image-tags-content').text().includes('修改标签') && $('#image-tags-content').text().includes('已选择 2 张图片'));
    const rows = () => $('#image-tags-list .image-tag-row');
    check('标签行渲染出来，且是 44px 点击区', rows().length === 2 && rows().eq(0).attr('class').includes('min-h-[44px]'));
    check('没做任何选择时「确定」是禁用的', $('#image-tags-confirm').prop('disabled') === true);

    rows().eq(0).trigger('click');
    check('点一下 → 添加（品牌色 + 文案「添加」）', $('#image-tags-list .image-tag-row').eq(0).attr('data-state') === 'add'
        && $('#image-tags-list .image-tag-row').eq(0).text().includes('添加')
        && $('#image-tags-list .image-tag-row').eq(0).attr('class').includes('bg-brand-soft'));
    check('「确定」变成可用', $('#image-tags-confirm').prop('disabled') === false);

    $('#image-tags-list .image-tag-row').eq(0).trigger('click');
    check('再点一下 → 移除（危险色 + 文案「移除」）',
        $('#image-tags-list .image-tag-row').eq(0).attr('data-state') === 'remove'
        && $('#image-tags-list .image-tag-row').eq(0).text().includes('移除')
        && $('#image-tags-list .image-tag-row').eq(0).attr('class').includes('text-danger'));

    $('#image-tags-list .image-tag-row').eq(1).trigger('click');
    $('#image-tags-confirm').trigger('click');
    await sleep(20);

    check('确定 → PUT ids + tags + remove_tags（两个标签不会既加又移）',
        JSON.stringify(calls.puts.at(-1).data) === JSON.stringify({ ids: [7, 8], tags: [12], remove_tags: [11] }),
        JSON.stringify(calls.puts.at(-1).data));
    check('成功后关弹窗 + toastr.success + 卡片角标就地同步',
        calls.modalClose.includes('image-tags-modal') && calls.toasts.some((x) => x[0] === 'success')
        && $('.images-item').eq(0).find('.image-tags').text().includes('壁纸')
        && ! $('.images-item').eq(0).find('.image-tags').text().includes('风景'));
}

console.log('\n[B. 行为] 批量打标：现场新建标签后直接置为「添加」');
{
    const { $, calls, t } = boot({ gridItems: 1 });
    await sleep(20);

    t.ds._sel = $('.images-item').get();
    t.methods.tag();
    $('#image-tags-new').val('新标签');
    $('#image-tags-create').trigger('click');
    await sleep(20);

    check('POST user/tags 新建成功', calls.posts.at(-1)?.data.name === '新标签');
    check('新行渲染出来并直接处于「添加」态',
        $('#image-tags-list .image-tag-row[data-id="13"]').attr('data-state') === 'add'
        && $('#image-tags-list .image-tag-row[data-id="13"]').text().includes('添加'));

    $('#image-tags-confirm').trigger('click');
    await sleep(20);
    check('确定 → 只带 tags（没有 remove_tags）',
        JSON.stringify(calls.puts.at(-1).data) === JSON.stringify({ ids: [7], tags: [13] }),
        JSON.stringify(calls.puts.at(-1).data));
}

console.log('\n[B. 行为] 标签管理：新建 / 重命名 / 删除（标签本身）');
{
    const { $, calls } = boot({ swalConfirmed: true });
    await sleep(20);

    $('#tag-manage-open').trigger('click');
    check('点「管理标签」打开 #tag-manage-modal', calls.modalOpen.at(-1) === 'tag-manage-modal', JSON.stringify(calls.modalOpen));
    await sleep(30);

    const rows = () => $('#tag-manage-list .tag-manage-row');
    check('列出当前标签（名称 + 使用数量 + 重命名/删除两个按钮）',
        rows().length === 2 && $('#tag-manage-list').text().includes('风景')
        && $('#tag-manage-list').text().includes('3 张')
        && rows().eq(0).find('.update').length === 1 && rows().eq(0).find('.delete').length === 1,
        rows().eq(0).text().trim().replace(/\s+/g, ' '));

    // 新建
    $('#tag-manage-create input[name=name]').val('临时标签');
    $('#tag-manage-create form').trigger('submit');
    await sleep(40);
    check('新建 → POST 到 user/tags（表单序列化）',
        calls.posts.length === 1 && decodeURIComponent(calls.posts.at(-1).data).includes('name=临时标签'),
        calls.posts.at(-1).data);
    check('新建后列表刷新出这一行（3 行）', rows().length === 3 && $('#tag-manage-list').text().includes('临时标签'));

    // 重命名
    let $row = $('#tag-manage-list .tag-manage-row').filter(function () { return $(this).text().includes('临时标签'); });
    $row.find('.update').trigger('click');
    check('点「编辑」→ 行下方展开表单，输入框带出原名称',
        $('#tag-manage-edit').length === 1 && $('#tag-manage-edit input[name=name]').val() === '临时标签');

    $('#tag-manage-edit input[name=name]').val('改名后的标签');
    $('#tag-manage-edit form').trigger('submit');
    await sleep(40);
    check('重命名 → PUT /user/tags/{id}',
        calls.puts.at(-1).url === '/user/tags/13' && decodeURIComponent(calls.puts.at(-1).data).includes('name=改名后的标签'),
        calls.puts.at(-1).url);
    check('重命名后列表与筛选下拉都显示新名字（详情候选也刷新）',
        $('#tag-manage-list').text().includes('改名后的标签') && ! $('#tag-manage-list').text().includes('临时标签')
        && $('#tag-filter-list').text().includes('改名后的标签'));

    // 删除
    $row = $('#tag-manage-list .tag-manage-row').filter(function () { return $(this).text().includes('改名后的标签'); });
    $row.find('.delete').trigger('click');
    await sleep(40);
    check('删除弹二次确认，文案说明会从所有图片上移除、不可恢复',
        calls.swals.length === 1 && calls.swals.at(-1).html.includes('所有图片')
        && calls.swals.at(-1).html.includes('不可恢复') && calls.swals.at(-1).title === '确认删除该标签?',
        calls.swals.at(-1).html);
    check('确认后 → DELETE /user/tags/{id}，行消失、筛选下拉同步',
        calls.deletes.at(-1) === '/user/tags/13' && rows().length === 2
        && ! $('#tag-filter-list').text().includes('改名后的标签'));

    // 取消删除不该发请求
    const { $: $2, calls: c2 } = boot({ swalConfirmed: false });
    await sleep(20);
    $2('#tag-manage-open').trigger('click');
    await sleep(20);
    $2('#tag-manage-list .tag-manage-row').eq(0).find('.delete').trigger('click');
    await sleep(40);
    check('二次确认里点「取消」→ 不发 DELETE、行还在',
        c2.deletes.length === 0 && $2('#tag-manage-list .tag-manage-row').length === 2);
}

console.log('\n[B. 行为] 图片右键菜单：能跳到「管理标签」');
{
    const { $, calls } = boot();
    await sleep(20);

    const itemMenu = calls.attaches.find((a) => a.selector === '.images-item');
    const labels = (itemMenu?.options?.data || []).map((d) => d && d.text).filter(Boolean);
    check('图片右键菜单里注册了「管理标签」', labels.includes('管理标签'), labels.join(' / '));
    check('「管理标签」紧跟在「修改标签」后面',
        labels.indexOf('管理标签') === labels.indexOf('修改标签') + 1,
        labels.join(' / '));

    const manage = itemMenu.options.data.find((d) => d && d.text === '管理标签');
    manage.action($('.images-item').get(0));
    await sleep(30);
    check('点它 → 打开的是标签管理弹窗（不是逐图的打标弹窗）',
        calls.modalOpen.at(-1) === 'tag-manage-modal' && ! calls.modalOpen.includes('image-tags-modal'),
        JSON.stringify(calls.modalOpen));
    check('管理弹窗内容渲染出来了（标签行 + 新建表单）',
        $('#tag-manage-list .tag-manage-row').length === 2 && $('#tag-manage-create form').length === 1);
}

console.log('\n[B. 行为] 渲染出来的页面里搜不到「公开 / 私有」');
{
    const { window, $, t } = boot();
    await sleep(20);
    t.methods.detail($('.images-item').get(0));
    await sleep(20);
    t.ds._sel = $('.images-item').get();
    t.methods.tag();

    const text = window.document.body.textContent + ' ' + $('#image-detail-content').html() + ' ' + $('#image-tags-content').html();
    check('全页文本 + 弹窗 HTML 里没有「公开」「私有」', ! /公开|私有/.test(text));
}

// ================================================================ 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
