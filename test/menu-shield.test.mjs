/**
 * 菜单盾牌（只有「我的图片」这一页有）的结构 + 行为回归网。
 *
 * 背景：下拉菜单的关闭都靠 Alpine 的 @click.outside —— 它注册在 document 冒泡阶段，只执行 `open = false`，
 * 既不 preventDefault 也不 stopPropagation；而「点图片开预览」是 viewer.js 绑在 #images-grid 上的冒泡监听
 * ⇒ 同一发点击两个都跑（先开图、后关菜单）。本页因此放一块 fixed 全屏透明层（#ls-menu-shield，z-8）
 * 把那一发点击结构性吃掉；关闭仍然由 @click.outside 完成（所以盾牌上不许挂 click / stopPropagation）。
 *
 * 覆盖面：
 *   一、结构契约：盾牌只在本页、层级夹在 z-8、手机（hover:none）不渲染、框选处理器有守卫、盾牌上不挂 click
 *   二、作用域：别的页面/布局里不许出现它（本轮约定：点穿修复只落在这一页）
 *   三、行为（jsdom 真跑页内那段 JS）：菜单开合驱动盾牌显隐、点击照常冒泡到 document（关闭路径不被掐断）、
 *      右击只关菜单并拦掉原生菜单、触屏「碰一下即关 + 700ms 时间窗吞掉补发的那一发 click」、滚动清窗
 *
 * 真机必测（jsdom 覆盖不到，因为无排版引擎）：手机上菜单开着时划图片墙（应当照常滚动且不开图）、
 * 盾牌与双击缩放/长按菜单的共存、以及吸顶工具栏那三个按钮「要点两下」的观感是否可接受。
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const blade = read('resources', 'views', 'user', 'images.blade.php');
const MARKUP = '<div id="ls-menu-shield" aria-hidden="true"></div>';

// ---------------------------------------------------------------- 一、结构契约
console.log('\n[结构] 盾牌标记、层级与渲染条件');
{
    check('本页有盾牌标记，且只出现一次',
        blade.includes(MARKUP) && (blade.match(/id="ls-menu-shield"/g) || []).length === 1);

    const atShield = blade.indexOf(MARKUP);
    const atLayout = blade.indexOf('<x-app-layout>');
    const atGrid = blade.indexOf('<div id="images-scroll"');
    check('盾牌在 <x-app-layout> 之内，且**不在** #images-scroll 里（否则它自己会被 DragSelect 当成网格）',
        atLayout !== -1 && atShield > atLayout && atGrid > atShield,
        `layout=${atLayout} shield=${atShield} grid=${atGrid}`);

    const css = blade.slice(blade.indexOf('#ls-menu-shield {'), blade.indexOf('#ls-menu-shield {') + 600);
    check('盾牌：fixed 全屏 + z-index 8 + 默认 display:none',
        /position:\s*fixed/.test(css) && /inset:\s*0/.test(css) && /z-index:\s*8\b/.test(css)
        && /#ls-menu-shield\s*\{[^}]*display:\s*none/.test(css), css.split('\n').find((l) => l.includes('z-index')) || '');

    const mq = blade.slice(blade.indexOf('@media (hover: hover) and (pointer: fine)'));
    check('.is-visible 只在「有鼠标的设备」那条 media query 里生效（手机不渲染 ⇒ 不挡滚动）',
        /@media \(hover: hover\) and \(pointer: fine\)[^}]*\{[^}]*#ls-menu-shield\.is-visible[^}]*\}/.test(mq.slice(0, 400)));
    check('没有媒体查询之外的 #ls-menu-shield.is-visible 规则（否则手机上也会显示）',
        (blade.match(/#ls-menu-shield\.is-visible/g) || []).length === 1);

    check('盾牌上不挂 click 监听（关了它菜单就关不掉了 —— 关闭靠点击冒泡到 document）',
        ! /shield\.addEventListener\('click'/.test(blade));

    // 框选那条捕获 mousedown：必须带守卫，否则按住盾牌拖一下 / 点右键菜单外的图片都会落选中
    const md = blade.slice(blade.indexOf("document.addEventListener('mousedown'"),
                           blade.indexOf("document.addEventListener('mousemove'"));
    check('框选 mousedown 处理器里有「屏幕上有菜单就退出」的守卫',
        /typeof lsMenusOnScreen === 'function' && lsMenusOnScreen\(\)/.test(md));
    check('守卫用的是广义判据（右键/长按菜单也拦得住），不是只认盾牌',
        /const MENU_PANELS = '\.ls-menu, \.dropdown-context';/.test(blade));
    check('盾牌显隐仍然只认 .ls-menu（扩成广义会把"右键另一张图"的目标一起吃掉）',
        /const PANEL = '\.ls-menu';/.test(blade) && /const s = anyVisible\(PANEL\);/.test(blade));
}

// ---------------------------------------------------------------- 二、作用域
console.log('\n[作用域] 只落在这一页，别的页面/布局不许有');
{
    const others = [
        ['layouts', 'app.blade.php'], ['layouts', 'header.blade.php'], ['layouts', 'sidebar.blade.php'],
        ['layouts', 'guest.blade.php'], ['layouts', 'user-nav.blade.php'], ['layouts', 'strategies.blade.php'],
        ['user', 'dashboard.blade.php'], ['user', 'settings.blade.php'], ['user', 'upload.blade.php'],
        ['admin', 'console', 'index.blade.php'], ['welcome.blade.php'],
    ];
    const leaked = others.filter((p) => read('resources', 'views', ...p).includes('ls-menu-shield'))
                         .map((p) => p.join('/'));
    check('其它页面/布局里没有 ls-menu-shield（本轮约定：只改「我的图片」页）', leaked.length === 0, leaked.join(', '));
}

// ---------------------------------------------------------------- 三、行为（jsdom 真跑那段 JS）
console.log('\n[行为] jsdom 跑页内那段 JS');
{
    const m = blade.match(/\/\* MENU-SHIELD-BEGIN \*\/([\s\S]*?)\/\* MENU-SHIELD-END \*\//);
    check('页内那段 JS 有 BEGIN/END 标记（本用例靠它取代码）', !!m);
    check('可见性判据：优先 checkVisibility（把祖先的 display 一起算），旧浏览器回退 display/visibility',
        /typeof el\.checkVisibility === 'function'/.test(m[1])
        && /cs\.display !== 'none' && cs\.visibility !== 'hidden'/.test(m[1]));

    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div class="relative"><div class="ls-menu" style="display: none">菜单</div></div>
        <div class="dropdown-context" style="display: none">右键菜单</div>
        <div id="ls-menu-shield" aria-hidden="true"></div>
        <img id="pic" src="x.png">
    </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
    const { window } = dom;
    const { document } = window;
    window.eval(m[1]);

    const shield = document.getElementById('ls-menu-shield');
    const panel = document.querySelector('.ls-menu');
    const pic = document.getElementById('pic');
    const shown = () => shield.classList.contains('is-visible');
    const tick = () => new Promise((r) => window.setTimeout(r, 0));
    const clickOn = (el) => {
        const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return ev;
    };

    // 冒泡监听：模拟 Alpine 的 @click.outside（它监听 document 冒泡阶段）
    let bubbled = 0;
    document.addEventListener('click', () => { bubbled += 1; });

    check('初始（没有菜单可见）：盾牌不显示、状态为 false',
        ! shown() && window.lsMenusOnScreen() === false);

    panel.style.display = 'block';
    await tick();
    check('菜单打开后：盾牌显示、状态为 true', shown() && window.lsMenusOnScreen() === true);

    const before = bubbled;
    clickOn(shield);
    await tick();
    check('点盾牌：这一发照常冒泡到 document（Alpine 能收到 ⇒ 菜单关得掉）',
        bubbled === before + 1, `bubbled=${bubbled}`);

    panel.style.display = 'none';
    await tick();
    check('菜单关掉后：盾牌不显示、状态回到 false', ! shown() && window.lsMenusOnScreen() === false);

    checkedContextMenu: {
        panel.style.display = 'block';
        await tick();
        const clicks = bubbled;
        const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        shield.dispatchEvent(ev);
        await tick();
        check('右击盾牌：拦掉浏览器原生菜单（defaultPrevented）+ 只关菜单（合成一发 click 冒泡出去）',
            ev.defaultPrevented === true && bubbled === clicks + 1, `preventDefault=${ev.defaultPrevented}`);
        panel.style.display = 'none';
        await tick();
    }

    // 触屏：碰一下即关菜单，并吞掉紧接着补发的那一发 click；滚动（touchmove）要把这个窗清掉
    panel.style.display = 'block';
    await tick();
    const clicksBeforeTouch = bubbled;
    pic.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
    await tick();
    check('触屏 touchstart：只关菜单（合成 click 冒泡出去）',
        bubbled === clicksBeforeTouch + 1, `bubbled=${bubbled}`);

    const eaten = clickOn(pic);
    await tick();
    check('触屏紧随的那一发 click 被吞掉（图片收不到 ⇒ 不会误开预览）',
        eaten.defaultPrevented === true && bubbled === clicksBeforeTouch + 1,
        `defaultPrevented=${eaten.defaultPrevented} bubbled=${bubbled}`);

    pic.dispatchEvent(new window.Event('touchmove', { bubbles: true }));
    const afterScroll = clickOn(pic);
    await tick();
    check('touchmove 清窗后：点击恢复正常（滚动后照常点图）',
        afterScroll.defaultPrevented === false && bubbled === clicksBeforeTouch + 2);

    // 时间窗过期的分支（不真等 700ms：把 jsdom 那个 window 里的 Date.now 推后）
    panel.style.display = 'block';
    await tick();
    pic.dispatchEvent(new window.Event('touchstart', { bubbles: true }));
    await tick();
    const realNow = window.Date.now;
    window.Date.now = () => realNow() + 1000;
    const afterWindow = clickOn(pic);
    window.Date.now = realNow;
    await tick();
    check('时间窗过期（>700ms）后：点击不再被吞（不会一直吃掉用户的点击）',
        afterWindow.defaultPrevented === false);

    // checkVisibility 分支 + resize 兜底：给 jsdom 缺的这个 API 打桩，模拟「菜单的整块容器被断点藏掉」
    {
        window.Element.prototype.checkVisibility = function () { return this.getAttribute('data-hidden') !== 'yes'; };
        panel.style.display = 'block';
        await tick();
        check('（打了桩）走 checkVisibility 分支：面板可见 → 盾牌出现', shown());

        panel.setAttribute('data-hidden', 'yes');   // 面板自己的 style 没变，只是整块容器被藏了
        window.dispatchEvent(new window.Event('resize'));
        await tick();
        check('整块容器被响应式藏掉（面板自身 style 未变）：resize 兜底把盾牌收回去', ! shown());

        panel.removeAttribute('data-hidden');
        window.dispatchEvent(new window.Event('resize'));
        await tick();
        check('容器再显示出来：盾牌跟着回来', shown());

        delete window.Element.prototype.checkVisibility;   // 恢复「老浏览器」状态
        panel.style.display = 'none';
        await tick();
        check('回退分支仍有效（没有 checkVisibility 的浏览器）：菜单关掉盾牌就收起', ! shown());
    }

    // 右键/长按菜单：判据要认它（守卫据此拦住选中/框选的起点），但盾牌**不许**跟着举
    {
        const ctx = document.querySelector('.dropdown-context');
        ctx.style.display = 'block';
        await tick();
        check('右键/长按菜单开着：lsMenusOnScreen() 为真（守卫据此拦掉选中/框选的起点）',
            window.lsMenusOnScreen() === true);
        check('…但盾牌不举（否则右键另一张图的目标会被盾牌吃掉、菜单换不过去）', ! shown());

        ctx.style.display = 'none';
        await tick();
        check('右键菜单关掉：判据回到 false', window.lsMenusOnScreen() === false);
    }

    // 初始化时机：单独一个实例，面板一开始就是可见的（= Alpine 还没启动的那一瞬间）
    {
        const d = new JSDOM(`<!DOCTYPE html><html><body>
            <div class="relative"><div class="ls-menu">菜单</div></div>
            <div id="ls-menu-shield" aria-hidden="true"></div>
        </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
        d.window.eval(m[1]);
        const shield2 = d.window.document.getElementById('ls-menu-shield');
        const panel2 = d.window.document.querySelector('.ls-menu');
        const shown2 = () => shield2.classList.contains('is-visible');
        const tick2 = () => new Promise((r) => d.window.setTimeout(r, 0));

        check('加载的那一刻不做初始同步（此时面板还没被 Alpine 设成 display:none，别误判成菜单开着、白盖一层盾牌）',
            ! shown2());

        panel2.style.display = 'none';
        await tick2();
        panel2.style.display = 'block';
        await tick2();
        check('该实例里状态机照常工作（不靠那一次初始同步）：菜单打开 → 盾牌出现', shown2());
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
