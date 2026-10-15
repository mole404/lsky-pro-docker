/**
 * 「菜单开着时点菜单外 = 只关菜单、不触发别的」的回归网（只有「我的图片」这一页有这套守卫）。
 *
 * 背景：两族菜单的关闭都不吞事件 —— 下拉菜单（.ls-menu）靠 Alpine 的 @click.outside（只置 open=false，
 * 既不 preventDefault 也不 stopPropagation），右键/长按菜单（.dropdown-context）靠 context-js 自己的逻辑；
 * 而「点图片开预览」绑在内容容器冒泡阶段、选中/框选发生在 mousedown 族 ⇒ 同一发操作会既关菜单又开图/勾选。
 * 本页因此只做两件事，都在 document 捕获阶段：① mousedown 守卫挡住选中/框选起点；② click 守卫在
 * 「有菜单 && 目标不在菜单面板内」时关掉下拉菜单并吞掉这一发。目标是面板内的元素则**完全放行**。
 *
 * 覆盖面：
 *   一、结构契约：盾牌及其时间窗已彻底撤除、只留两个守卫、click 守卫是捕获阶段且面板内放行、关菜单走
 *       Alpine 状态（不用合成点击）、触摸事件一个都不碰（上一版的 bug 就出在触碰 touchstart 编排上）
 *   二、作用域：别的页面/布局不许出现这套守卫
 *   三、行为（jsdom 真跑页内那段 JS）：无菜单放行 / 下拉菜单外一点只关菜单不点穿 / 面板内点击放行 /
 *       右键菜单开着时面板内放行、面板外被吞 / 关掉后立刻恢复 / Alpine 缺席不报错 / 加载时不误判
 *
 * 真机必测（jsdom 覆盖不到）：手机端长按菜单的选项与二级菜单（复制链接）逐项可用、手机上点菜单外只关菜单、
 * 桌面端拖动不再拖出选择框、菜单开着时右键另一张图仍能直接换菜单。
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
const m = blade.match(/\/\* MENU-GUARD-BEGIN \*\/([\s\S]*?)\/\* MENU-GUARD-END \*\//);
const js = m ? m[1] : '';

// ---------------------------------------------------------------- 一、结构契约
console.log('\n[结构] 只剩两个守卫，盾牌与时间窗必须撤干净');
{
    check('页内那段 JS 有 BEGIN/END 标记（本用例靠它取代码）', !!m);

    check('盾牌已彻底撤除（标记、CSS、常量、时间窗一个都不留）',
        ! blade.includes('ls-menu-shield') && ! /TOUCH_SUPPRESS_MS|suppressClickUntil/.test(blade)
        && ! /shieldOpen|MENU-SHIELD/.test(blade));

    check('click 守卫存在，且注册在 document 的捕获阶段',
        /document\.addEventListener\('click', \(event\) => \{/.test(js) && /\}, true\);/.test(js));

    check('click 守卫只在「屏幕上有菜单」时动手（无菜单直接 return）',
        /if \(! menusOpen\) \{\s*return;\s*\}/.test(js));

    check('目标在菜单面板内 ⇒ 完全放行（菜单项与二级菜单归它们自己）',
        /target\.closest\(MENU_PANELS\)/.test(js));

    check('面板选择器同时含两族（.ls-menu 与 .dropdown-context）',
        /const MENU_PANELS = '\.ls-menu, \.dropdown-context';/.test(js));

    check('吞掉那发点击时做了 preventDefault + stopPropagation',
        /closeDropdowns\(\);\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/s.test(js));

    check('关下拉菜单走 Alpine 状态，不用合成点击（合成点击会再进守卫、也可能踩别的监听）',
        /alpine\.\$data\(panel\)/.test(js) && /data\.open = false;/.test(js)
        && ! /dispatchEvent\(new MouseEvent\('click'/.test(js));

    check('★ 一段触摸事件都不碰（上一版 bug 的根源：插队 context-js 的 touchstart 编排）',
        ! /touch(start|move|end|cancel)/.test(js));

    check('「屏幕上有菜单」用 DOM 可见性判据（优先 checkVisibility，旧浏览器回退 display/visibility）',
        /typeof el\.checkVisibility === 'function'/.test(js)
        && /cs\.display !== 'none' && cs\.visibility !== 'hidden'/.test(js));

    // mousedown 守卫还在，且与 click 守卫共用同一个判据
    const md = blade.slice(blade.indexOf("document.addEventListener('mousedown'"),
                           blade.indexOf("document.addEventListener('mousemove'"));
    check('框选/点选的 mousedown 守卫仍在，且用同一个判据函数',
        /typeof lsMenusOnScreen === 'function' && lsMenusOnScreen\(\)/.test(md));
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
    const leaked = others.filter((p) => read('resources', 'views', ...p).includes('lsMenusOnScreen')).map((p) => p.join('/'));
    check('其它页面/布局里没有这套守卫', leaked.length === 0, leaked.join(', '));
}

// ---------------------------------------------------------------- 三、行为（jsdom 真跑那段 JS）
console.log('\n[行为] jsdom 跑页内那段 JS');
{
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div class="relative" x-data="{ open: false }"><div class="ls-menu" style="display: none">下拉菜单</div></div>
        <div class="dropdown-context" style="display: none">右键菜单<div class="dropdown-context-sub" style="display: none">二级</div></div>
        <img id="pic" src="x.png">
    </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
    const { window } = dom;
    const { document } = window;

    // Alpine 替身：本页只用到 $data(el) 拿最近一个 x-data 组件的数据并写 open
    const root = document.querySelector('[x-data]');
    root.__data = { open: false };
    window.Alpine = { $data: (el) => el.closest('[x-data]').__data };

    window.eval(js);

    const menu = document.querySelector('.ls-menu');
    const ctx = document.querySelector('.dropdown-context');
    const pic = document.getElementById('pic');
    const tick = () => new Promise((r) => window.setTimeout(r, 0));

    let bubbled = 0;
    document.addEventListener('click', () => { bubbled += 1; });

    const clickOn = (el) => {
        const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return ev;
    };
    const menuOpen = () => root.__data.open;

    check('初始（没有菜单可见）：click 放行、判据为 false',
        window.lsMenusOnScreen() === false
        && (() => { const n = bubbled; const ev = clickOn(pic); return ! ev.defaultPrevented && bubbled === n + 1; })());

    // ---- 下拉菜单（.ls-menu）----
    root.__data.open = true;
    menu.style.display = 'block';
    await tick();
    check('下拉菜单开着：判据为 true', window.lsMenusOnScreen() === true);

    let n = bubbled;
    let ev = clickOn(menu);
    await tick();
    check('点下拉菜单面板内部：完全放行（不 preventDefault、不关菜单、照常冒泡）',
        ! ev.defaultPrevented && menuOpen() && bubbled === n + 1);

    n = bubbled;
    ev = clickOn(pic);
    await tick();
    check('点菜单外面：吞掉这一发（不冒泡到页面）+ 菜单关掉 ⇒ 只关菜单、不点穿',
        ev.defaultPrevented === true && bubbled === n && menuOpen() === false);
    check('（同一发里）没有别的东西被顺手触发 —— picture 自己的 click 也没收到',
        (() => { let hit = 0; pic.addEventListener('click', () => { hit += 1; }); const e2 = clickOn(pic); return hit === 0 && e2.defaultPrevented === true; })());

    menu.style.display = 'none';
    await tick();
    n = bubbled;
    ev = clickOn(pic);
    await tick();
    check('菜单关掉后：点击立刻恢复正常（不再有"死区"）',
        ! ev.defaultPrevented && bubbled === n + 1 && window.lsMenusOnScreen() === false);

    // ---- 右键/长按菜单（.dropdown-context）----
    ctx.style.display = 'block';
    await tick();
    check('右键菜单开着：判据为 true', window.lsMenusOnScreen() === true);

    n = bubbled;
    ev = clickOn(document.querySelector('.dropdown-context-sub'));
    await tick();
    check('点右键菜单（含二级菜单）内部：放行 —— 菜单项与二级菜单的展开都归 context-js 自己',
        ! ev.defaultPrevented && bubbled === n + 1);

    root.__data.open = true;
    menu.style.display = 'block';
    await tick();
    n = bubbled;
    ev = clickOn(pic);
    await tick();
    check('两族同时开着、点菜单外：吞掉 + 关掉下拉菜单（右键那族由 context-js 自己关）',
        ev.defaultPrevented === true && bubbled === n && menuOpen() === false);

    menu.style.display = 'none';
    ctx.style.display = 'none';
    await tick();

    // ---- 加载时机（x-cloak）与 Alpine 缺席 ----
    {
        // 真实路径：面板带着 x-cloak，页面样式里 [x-cloak]{display:none!important} ⇒ 加载那一刻根本不画，
        // 不会被算成"菜单开着"（先确认线上 CSS 真有这条，否则这套说法不成立）
        check('线上 CSS 里 [x-cloak] 是 display:none（加载时机这条结论的前提）',
            /\[x-cloak\]\s*\{\s*display:\s*none/.test(read('public', 'css', 'common.css')));

        const d = new JSDOM(`<!DOCTYPE html><html><head><style>[x-cloak] { display: none; }</style></head><body>
            <div class="relative" x-data x-cloak><div class="ls-menu" x-cloak>还没被 Alpine 接管的面板</div></div>
            <img id="pic" src="x.png">
        </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
        d.window.eval(js);
        const e = new d.window.MouseEvent('click', { bubbles: true, cancelable: true });
        d.window.document.getElementById('pic').dispatchEvent(e);
        check('加载那一刻不误判（x-cloak 时面板不画出来 ⇒ 判据 false、点击照常放行）',
            e.defaultPrevented === false && d.window.lsMenusOnScreen() === false);
    }

    {
        // 面板真画着、但 window.Alpine 还没上场：不许抛异常；那一发依旧按"菜单开着"处理（判据只看 DOM 可见性）
        const d2 = new JSDOM(`<!DOCTYPE html><html><body>
            <div class="relative"><div class="ls-menu" style="display: block">菜单</div></div>
            <img id="pic" src="x.png">
        </body></html>`, { url: 'http://localhost/', runScripts: 'outside-only' });
        d2.window.eval(js);
        const e = new d2.window.MouseEvent('click', { bubbles: true, cancelable: true });
        d2.window.document.getElementById('pic').dispatchEvent(e);
        check('没有 window.Alpine 时不报错：拿不到组件就跳过关闭，这一发仍被吞',
            e.defaultPrevented === true && d2.window.lsMenusOnScreen() === true);
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
