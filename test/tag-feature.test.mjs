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

// Blade 的 {{ route(...) }} 在 jsdom 里不会渲染。整条测试台约定是「Blade 表达式一律变 /stub」，
// 但改名/删除这两个路由的 axios 桩是按 /user/tags/{id} 正则匹配的 —— 不渲染就匹配不上，
// 会表现为「改完名字列表还是旧的」这类假失败。所以这两个单独渲染成真实路径。
const renderTagRoutes = (src) => src
    .replace(/\{\{\s*route\('user\.tag\.update',\s*\['id' => '([^']*)'\]\)\s*\}\}/g, '/user/tags/$1')
    .replace(/\{\{\s*route\('user\.tag\.delete',\s*\['id' => '([^']*)'\]\)\s*\}\}/g, '/user/tags/$1');

function tpl(id) {
    const start = blade.indexOf(`<script type="text/html" id="${id}">`);
    if (start < 0) return '';
    const end = blade.indexOf('</script>', start);
    if (end < 0) return '';
    // Blade 注释在真实渲染时会被编译掉；这里取原始 blade 也要先剥掉，
    // 否则注释里出现的尖括号标签会被 jsdom 当成真元素解析（把外层 <a> 提前闭合）。
    return renderTagRoutes(blade.slice(blade.indexOf('>', start) + 1, end).replace(/\{\{--[\s\S]*?--\}\}/g, ''));
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

    check('弹窗标题是「标签管理」（唯一窗口，不再是「修改标签 / 管理标签」两个）',
        /<p class="text-\[16px\] font-semibold leading-6 text-ink">标签管理<\/p>/.test(tpl('image-tags-tpl'))
        && ! blade.includes('打标签')
        && ! blade.includes('<x-modal id="tag-manage-modal">'));
    check('副标题按「有没有选中图片」两支文案（勾选 / 取消的语义写在窗口里）',
        tpl('image-tags-tpl').includes('__hint__')
        && /\?\s*`已选择 \$\{selIds\.length\} 张图片`/.test(blade)
        && ! blade.includes('勾选 = 给这些图片加上')
        && blade.includes(": '未选择图片'")
        && tpl('image-tags-tpl').includes('请输入新标签名称'));
    check('批量打标入口：桌面工具栏 + 手机 ⋯ 菜单，都叫「标签管理」',
        /<a data-operate="tag"[^>]*>标签管理<\/a>/.test(blade)
        && (blade.match(/data-operate="tag"/g) || []).length === 2);
    check('operates 白名单（单选 / 多选）都换成 tag',
        /operates = \['refresh', 'movements', 'tag', 'detail', 'rename', 'delete', 'deselect'\];/.test(blade)
        && /operates = \['refresh', 'movements', 'tag', 'delete', 'deselect'\];/.test(blade));
    check('右键菜单只有一个「标签管理」（旧的「管理标签」项已合并掉）',
        /tag: \{\s*text: '标签管理',/.test(blade)
        && ! blade.includes('manageTags')
        && /actions\.tag,\s*actions\.detail,/.test(blade) && /case 'tag':/.test(blade));
    check('窗口里一行 = 勾选区 + 右侧改名/删除两个常显 44×44 按钮',
        /id="image-tags-item-tpl"/.test(blade)
        && /image-tag-toggle/.test(tpl('image-tags-item-tpl'))
        && (tpl('image-tags-item-tpl').match(/class="(?:update|delete) flex h-11 w-11/g) || []).length === 2
        && tpl('image-tags-item-tpl').includes('aria-label="重命名标签"')
        && tpl('image-tags-item-tpl').includes('aria-label="删除标签"'));
    check('勾选语义是两态（三态循环「不变/添加/移除」已删干净）',
        ! blade.includes('data-state="none"') && ! blade.includes('fa-circle-plus') && ! blade.includes('fa-circle-minus')
        && blade.includes('const isChecked = (id)')
        && blade.includes('勾上 = 给这些图片加上')
        && ! blade.includes('tag-state-label')
        && ! blade.includes("'已有'") && ! blade.includes("'移除'") && ! blade.includes("'部分有'"));
    check('「确定」默认禁用、且没选中图片时整个不显示', /id="image-tags-confirm"[^>]*disabled/.test(tpl('image-tags-tpl'))
        && /\$confirm\.prop\('disabled', true\)\.toggle\(hasSelection\)/.test(blade));
    check('批量打标请求形状：ids + tags + remove_tags（同一 route user.images.tags，id 仍是数字）',
        /axios\.put\('\{\{ route\('user\.images\.tags'\) \}\}', payload\)/.test(blade)
        && blade.includes('payload.tags = addIds.map(Number);') && blade.includes('payload.remove_tags = removeIds.map(Number);')
        && blade.includes('let payload = {ids: selIds.map(Number)};'));
}

console.log('\n[A. 静态] 标签窗口：标签本身的新建 / 重命名 / 删除（与打标同一个窗口）');
{
    check('右上角标签下拉里已经不再有「标签管理」入口（老师要求去掉）',
        ! blade.includes('id="tag-manage-open"'));
    check('只剩一个窗口：旧的 tag-manage-modal / content / 三个模板都删干净了',
        ! blade.includes('tag-manage-modal') && ! blade.includes('tag-manage-content')
        && ['tag-manage-tpl', 'tag-manage-item-tpl', 'tag-manage-edit-tpl'].every((id) => tpl(id).length === 0)
        && blade.includes('id="image-tags-edit-tpl"') && blade.includes('id="tag-edit"'));

    check('三个请求形状：POST user/tags 新建（JSON {name}）/ PUT user/tags/{id} 重命名 / DELETE user/tags/{id} 删除',
        /axios\.post\('\{\{ route\('user\.tag\.create'\) \}\}', \{name: name\}\)/.test(blade)
        && /axios\.put\(\$form\.attr\('action'\), \$form\.serialize\(\)\)/.test(blade)
        && /const TAG_DELETE_URL = "\{\{ route\('user\.tag\.delete', \['id' => '__ID__'\]\) \}\}"/.test(blade)
        && /axios\.delete\(TAG_DELETE_URL\.replace\('__ID__', tag\.id\)\)/.test(blade)
        && /action="\{\{ route\('user\.tag\.update', \['id' => '__id__'\]\) \}\}"/.test(blade));

    // 改名/删除标签**不能**重拉图片墙：那会清空选中、把正在打标的这批图丢掉
    check('改标签名后是就地同步（不重拉图片墙、不动选中）',
        /loadTags\(\)\.then\(\(\) => \{[\s\S]{0,200}?patchCardsTag\(tagId, newName\)/.test(blade)
        && ! /const refreshAfterTagChange/.test(blade));
    check('删标签后也是就地同步，只有它正被用作筛选项时才重拉图片墙',
        /patchCardsTag\(tag\.id, null\)/.test(blade)
        && /let wasFilter = selectedTagIds\.some/.test(blade)
        && /if \(wasFilter\) \{\s*setTags\(\);/.test(blade));
    // 标签名会进 data-json（单引号属性）：注入前必须转义，否则名字里的 ' 能闭合属性
    check('标签名进 data-json 前一律 HTML 转义（三处：列表渲染 / 弹窗行 / syncCardTags）',
        /escapeHtml\(JSON\.stringify\(images\[i\]\)\)/.test(blade)
        && /escapeHtml\(JSON\.stringify\(tag\)\)/.test(blade)
        && /escapeHtml\(JSON\.stringify\(json\)\)/.test(blade));
    // 输入上限 + 错误一律有提示（含 422）
    check('标签名输入框都有 maxlength=64，接口错误统一走 apiErrMsg（不再静默失败）',
        (blade.match(/maxlength="64"/g) || []).length >= 3
        && /const apiErrMsg = /.test(blade)
        && (blade.match(/apiErrMsg\(error/g) || []).length >= 4);

    check('删除有二次确认，文案说明会从所有图片上移除、不可恢复',
        blade.includes("title: '确认删除该标签?'") && blade.includes('删除后将从所有图片上移除标签「')
        && blade.includes('且不可恢复') && blade.includes("confirmButtonText: '确认'"));

    check('重命名是行内展开，名称用 .val() 填（标签名里的引号不会破坏属性）',
        blade.includes("$edit.find('input[name=name]').val($row.find('.name').text());"));

    check('删除后把所有本地状态摘干净（筛选选中 / 待加 / 待减 / 行内表单）',
        /addIds = addIds\.filter\(id => id !== String\(tag\.id\)\);/.test(blade)
        && /removeIds = removeIds\.filter\(id => id !== String\(tag\.id\)\);/.test(blade)
        && /\$\('#tag-edit'\)\.remove\(\)/.test(blade));

    check('改动后同步三个消费方（筛选下拉 / 详情候选 / 图片墙）',
        true);

    // 后端：删图片/删用户必须清中间表（SQLite 未启用外键级联，靠应用层显式删）
    const userService = read('app', 'Services', 'UserService.php');
    const adminUserController = read('app', 'Http', 'Controllers', 'Admin', 'UserController.php');
    const tagRequest = read('app', 'Http', 'Requests', 'TagRequest.php');
    check('删图片时清掉它和标签的关联行（UserService::deleteImages）',
        /\$image->tags\(\)->detach\(\);/.test(userService));
    check('后台删用户时一并清理 tags 与 image_tag',
        /DB::table\('image_tag'\)->whereIn\('tag_id', \$user->tags\(\)->pluck\('id'\)\)->delete\(\)/.test(adminUserController)
        && /\$user->tags\(\)->delete\(\);/.test(adminUserController));
    check('标签名校验前先 trim（只输空格不会建出空名标签）',
        /protected function prepareForValidation\(\)/.test(tagRequest)
        && /trim\(\(string\) \$name\)/.test(tagRequest));

    check('文案标准化：标题「标签管理」、按钮「新建标签」「确认修改」、空状态「暂无标签」',
        tpl('image-tags-tpl').includes('>新建标签</button>')
        && tpl('image-tags-edit-tpl').includes('确认修改') && tpl('image-tags-edit-tpl').includes('请输入标签名称')
        && blade.includes('暂无标签，可在下方新建'));
}

console.log('\n[A. 静态] 「显示图片标签」开关 + 框选修复');
{
    check('开关在标签下拉里（#tag-badge-toggle + 文案 + 图标钩子）',
        blade.includes('id="tag-badge-toggle"') && blade.includes('显示图片标签')
        && blade.includes('id="tag-badge-switch"') && blade.includes('tag-badge-knob')
        && ! blade.includes('tag-badge-toggle-icon'));   // 旧的图标钩子整个换掉了
    check('开关状态记在本地、默认打开（localStorage）',
        blade.includes("const TAG_BADGE_KEY = 'lsky.show_image_tags'")
        && /localStorage\.getItem\(TAG_BADGE_KEY\) !== '0'/.test(blade)
        && /localStorage\.setItem\(TAG_BADGE_KEY, showImageTags \? '1' : '0'\)/.test(blade));
    check('关掉时角标整体不显示（容器类 + 页面 CSS）',
        /\.image-tags-off \.image-tags \{\s*display: none;\s*\}/.test(blade)
        && blade.includes("$photos.toggleClass('image-tags-off', ! show)"));
    check('框选修复：按在「图片 / 卡片本身 / 空白处」都允许起拖动，落在控件（如小圆勾）上才 break()',
        /let \$target = \$\(event\.target\);/.test(blade)
        && /let onCardSurface = \$target\.is\(IMAGES_ITEM\)/.test(blade)
        && /if \(! \$target\.hasClass\('dragselect'\) && ! onCardSurface\) \{/.test(blade)
        && ! /if \(! \$\(event\.target\)\.hasClass\('dragselect'\)\) \{/.test(blade));
    check('框选修复（真因）：图片墙排完版后让 DragSelect 重新量区域，否则缓存过期、拖动根本不启动',
        /\$photos\.on\('jg\.complete jg\.resize'/.test(blade)
        && /ds\.Interaction\.init\(\);/.test(blade)
        && !/justifiedGallery\('norewind'\)[\s\S]{0,200}?ds\.Interaction\.init\(\)/.test(blade));
    // 真因：页面 <html> 有 zoom:1.1，但构造 DragSelect 时没把 zoom 传给它 → 库内部算的判定框
    // = 真实框 ×1.1 + 偏移（实测宽松 10%、随滚动越偏越大）。必须传，且不能再叠自己的补偿。
    check('构造 DragSelect 时把页面缩放传给它（否则判定框整体偏右下）',
        /new DragSelect\(\{[\s\S]{0,300}?zoom:\s*dsPageZoom\(\)/.test(blade)
        && /const dsPageZoom = \(\) => \{[\s\S]{0,400}?getBoundingClientRect\(\)\.width[\s\S]{0,200}?offsetWidth/.test(blade)
        && ! /getComputedStyle\(document\.documentElement\)\.zoom/.test(blade));
    check('判定框改由原始指针坐标驱动（clientX/Y），不再读库写在元素上的矩形（那会把错误读两遍）',
        /e\.clientX/.test(blade) && /e\.clientY/.test(blade)
        && /get\(\)\s*\{[\s\S]{0,200}?dsBoxRect\(\)/.test(blade)
        // getter 里绝不能出现"读 .ds-selector 的实时矩形"——那正是上一版假绿的原因
        && ! /get\(\)\s*\{[\s\S]{0,300}?document\.querySelector\('\.ds-selector'\)/.test(blade));
    check('画框按页面缩放折算写回（内联是布局单位，浏览器还要再乘一次 zoom）',
        /box\.style\.left = \(\(r\.left - ar\.left\) \/ z\)/.test(blade)
        && /wrap\.style\.left = \(ar\.left \/ z\)/.test(blade));
    check('禁掉图片原生拖拽（-webkit-user-drag + dragstart 兜底）—— 否则拖动会「锁定不释放」',
        blade.includes('-webkit-user-drag: none') && /\$photos\.on\('dragstart'/.test(blade));
    check('（已按老师要求回滚）点图片本身照旧参与勾选：不做任何「单击回滚」，小圆勾 click 全平台生效',
        ! blade.includes('pressCircle') && ! blade.includes('pressMoved')
        && /\$photos\.on\('click', '\.image-selector', function \(\) \{\s*ds\.toggleSelection/.test(blade));
    check('标签管理窗口版式：新建行在列表之前、条目行 overflow-hidden、副标题只留已选数量',
        blade.indexOf('id="image-tags-new"') < blade.indexOf('id="image-tags-list"')
        && /class="image-tag-row[^"]*overflow-hidden/.test(blade)
        && blade.includes('? `已选择 ${selIds.length} 张图片`'));
    check('没有用 pointer-events / 自己接管点击之类的技巧（实测那条路会变成「拖动元素本身」）',
        ! /images-item[^{]*\{[^}]*pointer-events/.test(blade)
        && ! /\$photos\.on\('click', IMAGES_ITEM/.test(blade)
        && ! /immediateDrag/.test(blade));
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
        out.push(renderTagRoutes(m[1]).replace(/\{\{[\s\S]*?\}\}/g, '/stub').replace(/\{!![\s\S]*?!!\}/g, ''));
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

// boot({ gridItems, itemTags }) —— gridItems > 0 时预先放好图片墙的卡片（默认 1 张）
// itemTags(i) 可让每张卡片带不同标签（用来测「部分选中图片有这个标签」的半勾态）
function boot({ gridItems = 1, putStatus = true, postStatus = true, swalConfirmed = false,
                itemTags = () => [{ id: 11, name: '风景' }] } = {}) {
    const items = [];
    for (let i = 0; i < gridItems; i++) {
        const json = JSON.stringify({ ...IMAGE, id: 7 + i, tags: itemTags(i) }).replace(/'/g, '&#39;');
        items.push(`<a class="images-item" data-id="${7 + i}" href="javascript:void(0)" data-json='${json}'>
            <div class="image-tags pointer-events-none absolute left-0 right-0 bottom-0 z-[1]"></div>
            <img alt="beach.jpg" src="https://i.example.com/beach-thumb.jpg"></a>`);
    }

    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <span id="header-title"></span>
        <a id="tag-filter" href="javascript:void(0)"><span>标签</span><i class="fas fa-tags"></i></a>
        <div id="tag-filter-menu"><div id="tag-filter-list"></div>
            <a id="tag-filter-clear" class="ls-menu-item hidden text-brand" href="javascript:void(0)" x-data>清除筛选</a>
            <a id="tag-badge-toggle" href="javascript:void(0)" x-data><span>显示图片标签</span>
                <span id="tag-badge-switch" class="bg-brand"><span class="tag-badge-knob translate-x-[12px]"></span></span></a>
            </div>
        <div id="images-scroll"><div id="images-grid">${items.join('')}</div></div>
        <div id="image-detail-modal" class="hidden"><div id="image-detail-content"></div></div>
        <div id="image-tags-modal" class="hidden"><div id="image-tags-content"></div></div>
        <a data-operate="tag" class="hidden" href="javascript:void(0)">标签管理</a>
        <input id="search">
        <script type="text/html" id="images-item-tpl">${tpl('images-item-tpl')}</script>
        <script type="text/html" id="image-detail-tpl">${tpl('image-detail-tpl')}</script>
        <script type="text/html" id="image-tags-tpl">${tpl('image-tags-tpl')}</script>
        <script type="text/html" id="image-tags-item-tpl">${tpl('image-tags-item-tpl')}</script>
        <script type="text/html" id="image-tags-edit-tpl">${tpl('image-tags-edit-tpl')}</script>
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
    window.Viewer = class {
        constructor() { window.Viewer.last = this; this.views = []; }
        update() {}
        view(index) { this.views.push(index); }
    };
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

console.log('\n[B. 行为] 标签管理：给选中的图片加 / 移除标签（两态勾选）');
{
    const { $, calls, t } = boot({ gridItems: 2 });
    await sleep(20);

    t.ds._sel = $('.images-item').get();
    t.methods.tag();

    check('打开唯一的标签窗口（#image-tags-modal）', calls.modalOpen.at(-1) === 'image-tags-modal',
        JSON.stringify(calls.modalOpen));
    check('标题「标签管理」+ 已选数量（两支图片）',
        $('#image-tags-content').text().includes('标签管理') && $('#image-tags-content').text().includes('已选择 2 张图片'));
    const rows = () => $('#image-tags-list .image-tag-row');
    check('两行标签，每行都有改名 / 删除按钮', rows().length === 2
        && rows().eq(0).find('.update').length === 1 && rows().eq(0).find('.delete').length === 1);
    check('两张图都有的标签默认就是勾上的（fa-check-square），行内不带任何字样',
        rows().eq(0).find('.tag-state-icon').attr('class').includes('fa-check-square')
        && ! rows().eq(0).text().includes('已有'));
    check('没动过任何东西时「确定」是禁用的', $('#image-tags-confirm').prop('disabled') === true);

    // 取消勾选「风景」（两张图上都有）→ 变成「移除」
    rows().eq(0).find('.image-tag-toggle').trigger('click');
    check('取消勾选 → 未勾选 + 文案「移除」+ 行描红（危险色）',
        rows().eq(0).find('.tag-state-icon').attr('class').includes('fa-square')
        && ! rows().eq(0).text().includes('移除') && rows().eq(0).find('.tag-state-label').length === 0
        && rows().eq(0).attr('class').includes('border-danger'));
    check('「确定」变成可用', $('#image-tags-confirm').prop('disabled') === false);

    // 勾选「壁纸」（两张图上都没有）→ 添加
    rows().eq(1).find('.image-tag-toggle').trigger('click');
    check('勾选 → 打上勾的图标 + 品牌色底（且不再出现「添加」字样）',
        rows().eq(1).find('.tag-state-icon').attr('class').includes('fa-check-square')
        && rows().eq(1).attr('class').includes('bg-brand-soft')
        && ! rows().eq(1).text().includes('添加'), rows().eq(1).text().trim());
    rows().eq(1).find('.image-tag-toggle').trigger('click');
    check('再点一次取消 → 回到未勾选，且不会提交「移除」（本来就没有）',
        ! rows().eq(1).find('.tag-state-icon').attr('class').includes('fa-check-square')
        && ! rows().eq(1).text().includes('移除'));
    rows().eq(1).find('.image-tag-toggle').trigger('click');

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

console.log('\n[B. 行为] 「部分选中的图片有这个标签」→ 半勾，点一下全勾');
{
    // 第 1 张带「风景」，第 2 张不带
    const { $, calls, t } = boot({ gridItems: 2, itemTags: (i) => (i === 0 ? [{ id: 11, name: '风景' }] : []) });
    await sleep(20);

    t.ds._sel = $('.images-item').get();
    t.methods.tag();

    const row = () => $('#image-tags-list .image-tag-row[data-id="11"]');
    check('半勾态：只看图标（fa-minus-square），行内没有任何字样',
        row().find('.tag-state-icon').attr('class').includes('fa-minus-square')
        && ! row().text().includes('部分有'));

    row().find('.image-tag-toggle').trigger('click');
    check('点一下 → 全勾（打了勾），确定可用', row().find('.tag-state-icon').attr('class').includes('fa-check-square')
        && row().find('.tag-state-icon').attr('class').includes('fa-check-square')
        && $('#image-tags-confirm').prop('disabled') === false);

    $('#image-tags-confirm').trigger('click');
    await sleep(20);
    check('确定 → 只带 tags（补到两张图上）',
        JSON.stringify(calls.puts.at(-1).data) === JSON.stringify({ ids: [7, 8], tags: [11] }),
        JSON.stringify(calls.puts.at(-1).data));
}

console.log('\n[B. 行为] 标签管理：现场新建标签后直接勾上');
{
    const { $, calls, t } = boot({ gridItems: 1 });
    await sleep(20);

    t.ds._sel = $('.images-item').get();
    t.methods.tag();
    $('#image-tags-new').val('新标签');
    $('#image-tags-create').trigger('click');
    await sleep(20);

    check('POST user/tags 新建（JSON {name}）', calls.posts.at(-1)?.data.name === '新标签');
    check('新行渲染出来并直接勾上（打了勾）',
        $('#image-tags-list .image-tag-row[data-id="13"]').find('.tag-state-icon').attr('class').includes('fa-check-square')
        && $('#image-tags-list .image-tag-row[data-id="13"]').attr('class').includes('bg-brand-soft'));

    $('#image-tags-confirm').trigger('click');
    await sleep(20);
    check('确定 → 只带 tags（没有 remove_tags）',
        JSON.stringify(calls.puts.at(-1).data) === JSON.stringify({ ids: [7], tags: [13] }),
        JSON.stringify(calls.puts.at(-1).data));
}

console.log('\n[B. 行为] 标签管理：不带选中图片打开（只改标签本身）');
{
    const { $, calls, t } = boot({ swalConfirmed: true });
    await sleep(20);

    // 没选中图片时打开窗口的入口只剩右键菜单（工具栏按钮此时会 return false；下拉入口按老师要求已删）
    t.ds._sel = [];
    const itemMenu = calls.attaches.find((a) => a.selector === '.images-item');
    itemMenu.options.data.find((d) => d && d.text === '标签管理').action(null);
    check('没选中图片时走右键菜单 → 也能打开同一个窗口（只改标签本身）', calls.modalOpen.at(-1) === 'image-tags-modal',
        JSON.stringify(calls.modalOpen));
    await sleep(30);

    const rows = () => $('#image-tags-list .image-tag-row');
    check('没选中图片：副标题给提示、且「确定」不显示',
        $('#image-tags-content').text().includes('未选择图片') && $('#image-tags-confirm').is(':hidden'),
        $('#image-tags-content').text().trim().slice(0, 60));
    check('列出当前标签（名称 + 使用数量 + 重命名/删除两个按钮）',
        rows().length === 2 && $('#image-tags-list').text().includes('风景')
        && $('#image-tags-list').text().includes('3 张')
        && rows().eq(0).find('.update').length === 1 && rows().eq(0).find('.delete').length === 1,
        rows().eq(0).text().trim().replace(/\s+/g, ' '));

    // 新建
    $('#image-tags-new').val('临时标签');
    $('#image-tags-create').trigger('click');
    await sleep(40);
    check('新建 → POST user/tags（JSON body {name}）',
        calls.posts.length === 1 && calls.posts.at(-1).data.name === '临时标签',
        JSON.stringify(calls.posts.at(-1)?.data));
    check('新建后列表出现这一行（3 行）', rows().length === 3 && $('#image-tags-list').text().includes('临时标签'));

    // 重命名
    let $row = rows().filter(function () { return $(this).text().includes('临时标签'); });
    $row.find('.update').trigger('click');
    check('点「编辑」→ 行下方展开表单，输入框带出原名称',
        $('#tag-edit').length === 1 && $('#tag-edit input[name=name]').val() === '临时标签');

    $('#tag-edit input[name=name]').val('改名后的标签');
    $('#tag-edit form').trigger('submit');
    await sleep(40);
    check('重命名 → PUT /user/tags/{id}',
        calls.puts.at(-1).url === '/user/tags/13' && decodeURIComponent(calls.puts.at(-1).data).includes('name=改名后的标签'),
        calls.puts.at(-1).url);
    check('重命名后列表与筛选下拉都显示新名字（详情候选也刷新）',
        $('#image-tags-list').text().includes('改名后的标签') && ! $('#image-tags-list').text().includes('临时标签')
        && $('#tag-filter-list').text().includes('改名后的标签'));

    // 删除
    $row = rows().filter(function () { return $(this).text().includes('改名后的标签'); });
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
    const { $: $2, calls: c2, t: t2 } = boot({ swalConfirmed: false });
    await sleep(20);
    t2.ds._sel = [];
    c2.attaches.find((a) => a.selector === '.images-item')
        .options.data.find((d) => d && d.text === '标签管理').action(null);
    await sleep(20);
    $2('#image-tags-list .image-tag-row').eq(0).find('.delete').trigger('click');
    await sleep(40);
    check('二次确认里点「取消」→ 不发 DELETE、行还在',
        c2.deletes.length === 0 && $2('#image-tags-list .image-tag-row').length === 2);
}

console.log('\n[B. 行为] 「显示图片标签」开关');
{
    const { window, $ } = boot();
    await sleep(20);

    check('默认开着：网格没有 .image-tags-off，图标是 toggle-on',
        ! $('#images-grid').hasClass('image-tags-off')
        && $('#tag-badge-switch').hasClass('bg-brand') && ! $('#tag-badge-switch').hasClass('bg-line')
        && $('#tag-badge-switch .tag-badge-knob').hasClass('translate-x-[12px]'));

    $('#tag-badge-toggle').trigger('click');
    check('点一下 → 关掉：网格加类 + 图标变 toggle-off + 写进本地',
        $('#images-grid').hasClass('image-tags-off')
        && $('#tag-badge-switch').hasClass('bg-line') && ! $('#tag-badge-switch').hasClass('bg-brand')
        && ! $('#tag-badge-switch .tag-badge-knob').hasClass('translate-x-[12px]')
        && window.localStorage.getItem('lsky.show_image_tags') === '0');

    $('#tag-badge-toggle').trigger('click');
    check('再点一下 → 开回来（本地也改成 1）',
        ! $('#images-grid').hasClass('image-tags-off')
        && window.localStorage.getItem('lsky.show_image_tags') === '1');
}

console.log('\n[B. 行为] 卡片点击不被打标/拖动逻辑接管（预览仍走看图器自己的路径）');
{
    const { $, t } = boot({ gridItems: 3 });
    await sleep(20);

    check('应用没有自己接管卡片点击（预览由 viewer 原生处理，不被拦）',
        ! /on\('click', IMAGES_ITEM/.test(blade) && ! /viewer\.view\(/.test(blade));
    check('拖动起手放宽只写在 predragstart 的判据里（不改 DragSelect 的其它配置）',
        /keyboardDrag: false,/.test(blade) && ! /immediateDrag/.test(blade));

    // 角标开关关了之后，卡片里的角标容器还在（只是被 CSS 隐藏），点击照样透到卡片
    $('#tag-badge-toggle').trigger('click');
    await sleep(50);
    check('关掉角标后卡片 DOM 不变（只加容器类，不删角标节点）',
        $('#images-grid').hasClass('image-tags-off')
        && $('.images-item').eq(0).find('.image-tags').length === 1);
}

console.log('\n[B. 行为] 图片右键菜单：一个「标签管理」入口');
{
    const { $, calls, t } = boot({ gridItems: 2 });
    await sleep(20);

    const itemMenu = calls.attaches.find((a) => a.selector === '.images-item');
    const labels = (itemMenu?.options?.data || []).map((d) => d && d.text).filter(Boolean);
    check('右键菜单里只剩一个「标签管理」（旧的「管理标签」项已合并）',
        labels.filter((x) => x === '标签管理').length === 1 && ! labels.includes('管理标签'), labels.join(' / '));

    // 右键菜单打开时会把这张图选中（beforeOpen 里 ds.addSelection），这里照同样的状态调用
    t.ds._sel = [$('.images-item').get(0)];
    itemMenu.options.data.find((d) => d && d.text === '标签管理').action($('.images-item').get(0));
    await sleep(30);
    check('点它 → 打开同一个标签窗口，并带上这张图片',
        calls.modalOpen.at(-1) === 'image-tags-modal'
        && $('#image-tags-content').text().includes('已选择 1 张图片'),
        JSON.stringify(calls.modalOpen));
    check('窗口里既有标签行，也有新建输入框（打标与标签维护是同一个窗口）',
        $('#image-tags-list .image-tag-row').length === 2 && $('#image-tags-new').length === 1);
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
