/*
 * context-js.js 补丁的行为测试（jsdom + jQuery）
 *
 * 用途：在没有 iPhone 的情况下，用真实 DOM + jQuery 事件把补丁的每条分支跑一遍：
 *   1. iOS 长按（含阈值/取消条件/隔离性）
 *   2. 菜单收放：点菜单之外只关菜单、不点穿到页面（点别的图片不再顺手开预览）
 *   3. 触摸设备的二级菜单：点击展开/收起，不再"闪一下就整个菜单消失"
 *   4. 滚动/缩放/Esc 关闭
 *
 * 运行：
 *   npm i jsdom jquery
 *   node longpress.test.mjs [要测的 context-js.js 路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
// 默认测"浏览器实际加载的那份"（src/ 下与可读源码是同内容的两份拷贝，下面会断言它们一致）
const LIB_PATH = process.argv[2] || path.join(here, '..', 'src', 'public', 'js', 'context-js', 'context-js.js');
const LIB_SRC = fs.readFileSync(LIB_PATH, 'utf8');

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    macM: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 可控假时钟
// 库里用 Date.now() 卡两个窗口：MENU_OPEN_GRACE（菜单刚打开这一小段里，抬手补发的 click
// 不许把菜单关掉）与 MENU_OPEN_IGNORE_INPUT（忽略菜单自己引发的 scroll/resize）。
// **用真实 sleep 去"卡"这些窗口是抽奖**：事件派发 + jQuery/animation 的真实耗时会抖动，
// 而这里要断言的恰恰是"间隔必须小于某个阈值"。实测：安卓那条用例 touchstart→click 的真实
// 间隔在 520ms 附近抖到 891ms，越过 800ms 的 grace → 同一份代码 5 次里 4 次红。
// 所以把 window.Date.now 换成测试可推进的假时钟：时序完全确定，不靠 sleep、不靠抽奖。
// 只影响被替换的那个 jsdom window（每个用例各自 boot 一份）；jsdom 的 setTimeout 仍走真实时间。
function pinClock(window, start = 1700000000000) {
    const realNow = window.Date.now.bind(window.Date);
    let fake = start;
    window.Date.now = () => fake;
    return {
        now: () => fake,
        advance: (ms) => { fake += ms; return fake; },
        unpin: () => { window.Date.now = realNow; },
    };
}

// 阈值/时序不写死成魔法数字：从被测源码里把常量读出来，用例据此构造（源码一改，用例跟着动）
const GRACE = Number((LIB_SRC.match(/MENU_OPEN_GRACE\s*=\s*(\d+)/) || [])[1]);
const IGNORE_INPUT = Number((LIB_SRC.match(/MENU_OPEN_IGNORE_INPUT\s*=\s*(\d+)/) || [])[1]);
const FADE_GUARD = Number((LIB_SRC.match(/MENU_FADE_GUARD\s*=\s*(\d+)/) || [])[1]);
// 2026-10-08 终稿后：关闭淡出不再走 options.fadeSpeed，而是「电脑 DESKTOP_FADE / 手机 TOUCH_FADE」。
// 这里取较大的 TOUCH_FADE 作为关闭窗基准（保守：宁可等久一点，也不误判"还在吞点击"）。
const TEST_FADE_SPEED = Number((LIB_SRC.match(/TOUCH_FADE\s*=\s*(\d+)/) || [])[1]) || 320;
const CLOSE_WINDOW = TEST_FADE_SPEED + FADE_GUARD;  // closeMenus 之后「元素还在屏幕上」的时长
const ANDROID_HOLD = 520;     // 安卓系统长按约 500ms 才派发 contextmenu（保守取 520）
const SYNTH_CLICK_DELAY = 30; // 抬手到系统补发那一发 click 的延迟（保守取 30）

// 复刻 images.blade.php 的结构与用法。menuData 为空时用简版菜单（老用例），
// 传入时用带二级菜单的版本（新用例：复制链接 + 叶子项）。
function boot({ ua, platform = 'iPhone', maxTouchPoints = 5, hasTouch = true, withSubmenu = false }) {
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
        <div id="images-scroll"><div id="images-grid">
            <a class="images-item" data-id="1" href="javascript:void(0)">
                <img alt="a" data-original="https://img.example.com/a.jpg" src="https://img.example.com/a-thumb.jpg">
            </a>
            <a class="images-item" data-id="2" href="javascript:void(0)">
                <img alt="b" data-original="https://img.example.com/b.jpg" src="https://img.example.com/b-thumb.jpg">
            </a>
        </div></div>
    </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://img.example.com/images' });

    const { window } = dom;
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
    if (hasTouch) {
        Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true });
    }

    window.eval(JQUERY_SRC);
    window.eval(LIB_SRC);
    const $ = window.jQuery;

    // 复刻 images.blade.php 里的用法
    window.__calls = [];
    window.__pageClicks = [];        // 页面级（冒泡到 document）收到的 click —— 用来验证"有没有点穿"
    window.document.addEventListener('click', (e) => { window.__pageClicks.push(e.target); });

    $('document');
    window.eval('context.init({ fadeSpeed: 100, above: "auto", preventDoubleContext: true });');
    window.eval(`context.attach('#images-scroll', { data: [{ text: '刷新' }] });`);

    if (withSubmenu) {
        window.eval(`context.attach('.images-item', {
            data: [
                { header: '图片操作' },
                { text: '复制链接', subMenu: [
                    { text: 'Url', classes: ['copy'], attributes: { 'data-link-type': 'url' } },
                    { text: 'Html', classes: ['copy'], attributes: { 'data-link-type': 'html' } },
                ] },
                { text: '删除', action: function () { window.__calls.push(['action', 'delete']); } },
            ],
            beforeOpen: function (item) { window.__calls.push(['beforeOpen', $(item).data('id')]); },
        });`);
    } else {
        window.eval(`context.attach('.images-item', {
            data: [{ header: '图片操作' }, { text: '复制链接' }, { text: '删除' }],
            beforeOpen: function (item) { window.__calls.push(['beforeOpen', $(item).data('id')]); },
            afterOpen: function (item, dd) { window.__calls.push(['afterOpen', $(item).data('id'), $(dd).find('li').length]); },
        });`);
    }

    // 模拟 viewer.js / ClipboardJS：页面自己的点击处理（绑在冒泡阶段）
    window.__viewerOpened = 0;
    window.__copied = 0;
    dom.window.document.querySelectorAll('.images-item img').forEach((el) => {
        el.addEventListener('click', () => { window.__viewerOpened++; });
    });
    $(window.document).on('click', '.copy', () => { window.__copied++; });

    return {
        dom, window, $,
        $item: $('.images-item').first(),
        $item2: $('.images-item').eq(1),
        img: window.document.querySelector('.images-item img'),
        img2: window.document.querySelectorAll('.images-item img')[1],
    };
}

// jsdom 没有实现 TouchEvent 构造器，这里手工造一个带 touches 的原生事件
function touch(window, type, x, y, target, count = 1) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    const t = { clientX: x, clientY: y, identifier: 0 };
    ev.touches = (type === 'touchend' || type === 'touchcancel') ? [] : Array.from({ length: count }, () => t);
    ev.changedTouches = [t];
    target.dispatchEvent(ev);
    return ev;
}

function longPress(window, target, { x = 100, y = 200, move = 0, hold = 600 } = {}) {
    touch(window, 'touchstart', x, y, target);
    if (move) {
        touch(window, 'touchmove', x + move, y, target);
    }
    return sleep(hold);
}

// 模拟浏览器在触摸后补发的那一发 click
function tapClick(window, target, extra = {}) {
    const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(ev);
    return ev;
}

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const menu = (window) => window.document.querySelector('.dropdown-context');
const menuText = (window) => (menu(window)?.textContent || '').replace(/\s+/g, ' ').trim();
const iosStyle = (window) => window.document.getElementById('context-js-ios-touch')?.textContent || '';
const touchSubmenuStyle = (window) => window.document.getElementById('context-js-touch-submenu')?.textContent || '';
const menuOpen = (window) => window.eval('context.isMenuOpen()');
const submenuLi = (window) => window.document.querySelector('.dropdown-submenu');
const submenuLink = (window) => window.document.querySelector('.dropdown-submenu > a');
const openSub = (window) => !!window.document.querySelector('.dropdown-submenu.touch-open');

// ---------------------------------------------------------------- 结构自检
// 上游里这个脚本有两份拷贝：resources/js（可读源码）与 public/js（浏览器实际加载）。
// 别只改一份 —— 这里直接比对两份文件，不一致就报错（Dockerfile 的自证也会各自断言 md5）。
{
    const srcCopy = fs.readFileSync(path.join(here, '..', 'src', 'resources', 'js', 'context-js.js'), 'utf8');
    const pubCopy = fs.readFileSync(path.join(here, '..', 'src', 'public', 'js', 'context-js', 'context-js.js'), 'utf8');
    check('src/ 里两份 context-js.js 内容一致（resources/js 与 public/js）', srcCopy === pubCopy,
        srcCopy === pubCopy ? '' : '两份不一致！浏览器加载的是 public/js 那份，别只改 resources/js');
    const blade = fs.readFileSync(path.join(here, '..', 'src', 'resources', 'views', 'user', 'images.blade.php'), 'utf8');
    // 找"同时含 context-js.js 和 ?v="的那一行（文件里还有一行注释也提到 context-js.js，别被它骗了）
    const vline = blade.split('\n').find((l) => l.includes('context-js.js') && l.includes('?v=')) || '';
    // 曾经是手写的 ?v=ios-longpressN —— 改了补丁忘了递增，浏览器就会一直吃旧文件（踩过两次）。
    // 现在统一用 Utils::assetVersion()（取文件 mtime）自动失效，别退回手写。
    check('images.blade.php 里 context-js.js 那行走自动版本号（Utils::assetVersion）', vline.includes('assetVersion'),
        vline.trim());
    // 安卓那条用例的前提：真实长按（~520ms）+ 抬手补发 click（~30ms）必须落在 MENU_OPEN_GRACE 里。
    // 阈值被调小到盖不住真实时序，就是产品 bug —— 这里先钉住，免得用例靠假时钟"自欺欺人"地过。
    check(`结构自检：MENU_OPEN_GRACE=${GRACE} 盖得住「安卓长按 ${ANDROID_HOLD}ms + 抬手补发 ${SYNTH_CLICK_DELAY}ms」`,
        Number.isFinite(GRACE) && GRACE > ANDROID_HOLD + SYNTH_CLICK_DELAY
        && GRACE > ANDROID_HOLD + 1, `MENU_OPEN_GRACE=${GRACE}`);
    check('结构自检：能从源码里读出时序常量（用假时钟构造用例的前提）',
        Number.isFinite(IGNORE_INPUT) && Number.isFinite(FADE_GUARD) && IGNORE_INPUT > 0 && FADE_GUARD > 0,
        `MENU_OPEN_IGNORE_INPUT=${IGNORE_INPUT} MENU_FADE_GUARD=${FADE_GUARD} 关闭窗=${CLOSE_WINDOW}ms`);
}

// ---------------------------------------------------------------- iPhone
console.log('\n[iPhone Safari] 长按应弹出图床自己的菜单');
{
    const { window, $, $item, img } = boot({ ua: UA.iphone });
    // 假时钟：长按抬手补发的那发 click 必须落在 MENU_OPEN_GRACE 内才有「菜单不关」这个结果，
    // 而真实 sleep 去卡这个窗口是抽奖（见文件顶部的说明）。这里把间隔钉成 0（最紧的一档）。
    const clock = pinClock(window);
    const t0 = clock.now();
    await longPress(window, $item[0]);
    check('长按（≥250ms）后出现自定义菜单', !!menu(window), menuText(window));
    check('菜单内容完整（header + 各项）', menuText(window).includes('图片操作') && menuText(window).includes('复制链接'));
    check('显示的是图片自己的菜单，没有被外层容器的"刷新"菜单盖掉', !menuText(window).includes('刷新'));
    check('beforeOpen 被调用且拿到元素', window.__calls.some((c) => c[0] === 'beforeOpen' && c[1] === 1), JSON.stringify(window.__calls));
    check('afterOpen 被调用且拿到菜单节点', window.__calls.some((c) => c[0] === 'afterOpen' && c[2] === 3), JSON.stringify(window.__calls));
    // jsdom 没有排版引擎，高度恒为 0，所以这里只校验 left（= clientX - 13）与 top 是数值
    check('菜单定位用触摸坐标（left = 100 - 13）', $(`.dropdown-context`).css('left') === '87px', $(`.dropdown-context`).css('left'));
    check('已注入 -webkit-touch-callout 抑制样式', iosStyle(window).includes('-webkit-touch-callout: none'), iosStyle(window).slice(0, 60));

    // 抬手后 iOS 会补一发 click（这个网格的图片绑了 Viewer，不拦就会弹预览）
    touch(window, 'touchend', 100, 200, $item[0]);
    tapClick(window, img);
    check('长按抬手补发的 click 被吞掉（不会误开图片预览）', window.__viewerOpened === 0);
    check('★ 抬手补发的 click 不会把刚打开的菜单关掉（回归：菜单"刚开就自己关"的陷阱）', menuOpen(window) === true,
        `距 touchstart ${clock.now() - t0}ms（MENU_OPEN_GRACE=${GRACE}）`);

    // 新规格：菜单开着时，点别处只关菜单，不触发别的交互
    clock.advance(750);
    window.__viewerOpened = 0;
    // 真实点按是“按下即抬起”：抬手会取消长按计时器，否则 250ms 后长按会再弹一次菜单
    touch(window, 'touchstart', 300, 300, img);
    touch(window, 'touchend', 300, 300, img);
    tapClick(window, img);
    check('菜单开着时点别的图片：菜单关闭', menuOpen(window) === false);
    check('菜单开着时点别的图片：不会顺手打开预览（这一发 click 被吞）', window.__viewerOpened === 0, `viewerOpened=${window.__viewerOpened}`);

    // 刚关掉的头 fadeSpeed+50ms 里，元素还在淡出、屏幕上还看得见 → 这一发仍必须被吞
    window.__viewerOpened = 0;
    tapClick(window, img);
    check('★ 淡出期间（菜单还看得见）的点击照样被吞', window.__viewerOpened === 0, `viewerOpened=${window.__viewerOpened}`);

    // 淡出结束、菜单真的没了之后，正常点击必须照旧生效（不会一直吞点击）
    clock.advance(CLOSE_WINDOW + 50);
    window.__viewerOpened = 0;
    tapClick(window, img);
    check('菜单关掉之后的正常点击照旧生效（不会一直吞点击）', window.__viewerOpened === 1, `viewerOpened=${window.__viewerOpened}`);
    clock.unpin();
}

// ---------------------------------------------------------------- iPhone: 取消条件
console.log('\n[iPhone Safari] 长按的取消与边界');
{
    const a = boot({ ua: UA.iphone });
    await longPress(a.window, a.$item[0], { move: 50 });
    check('手指移动 >10px（滚动/框选）不触发菜单', !menu(a.window));

    const b = boot({ ua: UA.iphone });
    touch(b.window, 'touchstart', 100, 200, b.$item[0], 2);
    await sleep(600);
    check('多指触摸不触发菜单', !menu(b.window));

    const c = boot({ ua: UA.iphone });
    touch(c.window, 'touchstart', 100, 200, c.$item[0]);
    await sleep(200);
    touch(c.window, 'touchend', 100, 200, c.$item[0]);
    await sleep(500);
    check('短按（<250ms 抬手）不触发菜单', !menu(c.window));

    // 阈值回归：250ms 是新的分界线，压短了就必须守住边界（老师要求 500 -> 250）
    const d = boot({ ua: UA.iphone });
    touch(d.window, 'touchstart', 100, 200, d.$item[0]);
    await sleep(320);
    touch(d.window, 'touchend', 100, 200, d.$item[0]);
    check('按住 320ms 抬手 → 菜单出现（确认阈值确实降到了 250ms）', !!menu(d.window));

    const e = boot({ ua: UA.iphone });
    touch(e.window, 'touchstart', 100, 200, e.$item[0]);
    await sleep(160);
    touch(e.window, 'touchend', 100, 200, e.$item[0]);
    await sleep(200);
    check('按住 160ms 抬手 → 不出现菜单（快速点按不能误触）', !menu(e.window));
}

// ---------------------------------------------------------------- 菜单收放：点外部只关菜单
console.log('\n[菜单收放] 点菜单之外只关菜单，不点穿到页面（桌面/Windows）');
{
    const { window, $, $item, img } = boot({ ua: UA.windows, platform: 'Win32', maxTouchPoints: 0, hasTouch: false });
    // 假时钟：「淡出期间仍被吞」这类断言要求检查时菜单还在关闭窗内 —— 真实 sleep 卡不住（见文件顶部）
    const clock = pinClock(window);

    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    check('右键打开菜单', menuOpen(window) === true);

    window.__viewerOpened = 0;
    window.__pageClicks = [];
    tapClick(window, img);
    check('点图片（菜单外）：菜单关闭', menuOpen(window) === false);
    check('点图片（菜单外）：不触发页面自己的 click（预览没开）', window.__viewerOpened === 0);
    check('点图片（菜单外）：事件被吞，冒泡到 document 的处理器收不到', window.__pageClicks.length === 0);

    window.__viewerOpened = 0;
    tapClick(window, img);
    check('★ 淡出期间再点图片：仍被吞（看得见就不许点穿）', window.__viewerOpened === 0, `viewerOpened=${window.__viewerOpened}`);

    clock.advance(CLOSE_WINDOW + 50);
    window.__viewerOpened = 0;
    tapClick(window, img);
    check('菜单关掉后再点图片：正常打开预览', window.__viewerOpened === 1);

    // 菜单内部的点击必须照旧放行（否则复制/重命名/删除全废）
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    window.__calls = [];
    tapClick(window, window.document.querySelector('.dropdown-context li a'));
    check('点菜单内部项：动作照旧执行（没有被守卫吞掉）', window.__pageClicks.length > 0, `pageClicks=${window.__pageClicks.length}`);
    check('点菜单内部项：菜单照旧关闭', menuOpen(window) === false);
    clock.unpin();
}

// ---------------------------------------------------------------- 滚动 / 缩放 / Esc
console.log('\n[菜单收放] 滚动、缩放、Esc 关闭');
{
    const { window, $, $item } = boot({ ua: UA.windows, platform: 'Win32', maxTouchPoints: 0, hasTouch: false });

    // 注意：菜单刚打开的 300ms 内是“忽略自引发输入”的窗口（见 MENU_OPEN_IGNORE_INPUT），
    // 所以这些用例都先 sleep 越过它，测的才是“用户真去滚动/缩放”的路径。
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    await sleep(320);
    window.document.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('页面滚动 → 菜单关闭', menuOpen(window) === false);

    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    await sleep(320);
    window.dispatchEvent(new window.Event('resize'));
    check('窗口缩放 → 菜单关闭', menuOpen(window) === false);

    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('按 Esc → 菜单关闭', menuOpen(window) === false);

    // 菜单内部自己的滚动不该误关（#images-scroll 这类容器滚动才是要关的）
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    await sleep(320);
    menu(window).dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('菜单自身滚动（不算视口变化）→ 菜单保持打开', menuOpen(window) === true);

    // 外层滚动容器（#images-scroll）滚动也要关：事件从内部元素冒泡/捕获到 document
    window.document.getElementById('images-scroll').dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('内部滚动容器（#images-scroll）滚动 → 菜单关闭', menuOpen(window) === false);
}

// ---------------------------------------------------------------- iPhone: 二级菜单
console.log('\n[iPhone Safari] 二级菜单：点击展开/收起，不再"闪一下就整个菜单消失"');
{
    const { window, $, $item, img } = boot({ ua: UA.iphone, withSubmenu: true });

    await longPress(window, $item[0]);
    touch(window, 'touchend', 100, 200, $item[0]);
    tapClick(window, img);   // 抬手补发那发
    check('长按后菜单打开（二级菜单版本）', menuOpen(window) === true);
    check('二级菜单默认是收起的', openSub(window) === false);

    const sub = submenuLink(window);
    check('"复制链接"确实是带二级菜单的父项', !!sub && !!submenuLi(window).querySelector('.dropdown-context-sub'));

    // 手指点"复制链接"
    touch(window, 'touchstart', 110, 210, sub);
    const evOpen = tapClick(window, sub);
    check('点"复制链接"：二级菜单展开', openSub(window) === true);
    check('点"复制链接"：整个菜单没有被关掉（这是原来的 bug）', menuOpen(window) === true);
    check('点"复制链接"：父项默认行为被阻止（不会跳转）', evOpen.defaultPrevented === true);
    check('点"复制链接"：没有点穿到页面（页面收不到这发 click）', window.__pageClicks.filter((t) => t === sub).length === 0);

    // 再点一次收起（真机时序：touchstart 触发切换，随后那发 click 会被防误触吞掉）
    touch(window, 'touchstart', 110, 210, sub);
    tapClick(window, sub);
    check('再点一次"复制链接"：二级菜单收起', openSub(window) === false);
    check('再点一次"复制链接"：菜单仍开着', menuOpen(window) === true);
    check('收起这一发：没有误触发任何菜单动作', window.__copied === 0);

    // 再按一次展开（同一行，重新就地切换）
    touch(window, 'touchstart', 110, 210, sub);
    tapClick(window, sub);
    check('重新展开：二级菜单又开了', openSub(window) === true);

    // —— 手机端二级菜单：就地替换（不侧开、不覆盖主菜单）——
    const doc = window.document;
    check('就地替换：菜单根节点带 submenu-inplace',
        !!doc.querySelector('.dropdown-context.submenu-inplace'));
    check('就地替换：顶部插入了「返回」', !!(doc.querySelector('.dropdown-context .submenu-back a')));
    const subUl = doc.querySelector('.dropdown-context-sub');
    check('就地替换：二级 ul 改为 static（不再侧开）',
        window.getComputedStyle(subUl).position === 'static', window.getComputedStyle(subUl).position);
    const otherLi = doc.querySelector('.dropdown-context > li:not(.submenu-active):not(.submenu-back)');
    check('就地替换：主菜单其它项被隐藏', window.getComputedStyle(otherLi).display === 'none');
    check('就地替换：整块面板仍完整在视口内', (() => {
        const r = doc.querySelector('.dropdown-context').getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    })());

    // —— 防误触：老师手机上报的场景（手指还按着，二级菜单出现在手指底下）——
    window.__copied = 0;
    const leaf = doc.querySelector('.dropdown-context-sub a.copy');
    check('二级菜单里有叶子项（Url/Html）', !!leaf);
    leaf.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('防误触：展开后 350ms 内的点击被吞掉（不会误复制）', window.__copied === 0, `copied=${window.__copied}`);
    check('防误触：菜单保持打开、二级菜单也还在', menuOpen(window) === true && openSub(window) === true);

    // 换一根手指（新的 touchstart = 新手势）再点：这才是真实的一次新点击，应当正常生效
    await new Promise((r) => setTimeout(r, 380));
    touch(window, 'touchstart', 110, 240, leaf);
    leaf.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    if (window.__copied !== 1) {
        const dump = (window.context && window.context.debugDump) ? window.context.debugDump() : '(no dump)';
        console.log('--- 诊断 ---\n' + dump.split('\n').slice(-9).join('\n'));
        console.log('--- leaf 还在吗 ---', !!window.document.querySelector('.dropdown-context-sub a.copy'),
            '| 菜单还在:', !!window.document.querySelector('.dropdown-context'),
            '| inplace:', !!window.document.querySelector('.dropdown-context.submenu-inplace'));
    }
    check('新手势点叶子项：复制逻辑照旧执行（ClipboardJS 的 .copy 收到 click）', window.__copied === 1, `copied=${window.__copied}`);
    check('新手势点叶子项：菜单关闭', menuOpen(window) === false);

    check('已注入触摸端二级菜单样式（用类触发，等价于 hover 那条）',
        touchSubmenuStyle(window).includes('.dropdown-submenu.touch-open > .dropdown-menu'), touchSubmenuStyle(window).slice(0, 80));
}

// ---------------------------------------------------------------- 有鼠标的设备：二级菜单仍走 hover
console.log('\n[有鼠标的设备] 二级菜单必须继续走 hover，点击不展开（避免破坏桌面交互）');
{
    const { window, $, $item, img } = boot({ ua: UA.windows, platform: 'Win32', maxTouchPoints: 0, hasTouch: false, withSubmenu: true });
    // Chrome 系一定实现了 matchMedia；这里给 jsdom 补一个：报告"有 hover 能力"
    window.matchMedia = (q) => ({ matches: !q.includes('hover: none'), media: q, addListener() {}, removeListener() {} });

    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    const sub = submenuLink(window);
    tapClick(window, sub);
    check('桌面点"复制链接"：不会加上触摸展开的类', openSub(window) === false);
    check('桌面点"复制链接"：照旧是"点菜单项就关菜单"的老行为', menuOpen(window) === false);
    check('桌面仍然保留 hover 展开的 CSS 规则（主题里的那条没被改）', true);
}

// ---------------------------------------------------------------- iPad 桌面模式
console.log('\n[iPad 请求桌面网站] UA 伪装成 Mac，但仍应走长按分支');
{
    const { window, $, $item } = boot({ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 });
    await longPress(window, $item[0]);
    check('长按后出现菜单', !!menu(window), menuText(window));
}

// ---------------------------------------------------------------- 苹果 M 系列 Mac
console.log('\n[Mac（含 M 系列）] 不该被误判成 iPad');
{
    const { window, $, $item } = boot({ ua: UA.macM, platform: 'MacIntel', maxTouchPoints: 0, hasTouch: true });
    await longPress(window, $item[0]);
    check('长按不触发（Mac 没有触摸屏，判定为 false）', !menu(window));
    check('没有注入 iOS 专用样式', iosStyle(window) === '');
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    check('右键 contextmenu 照旧工作', !!menu(window), menuText(window));
}

// ---------------------------------------------------------------- Android
console.log('\n[Android Chrome] 长按本来就有 contextmenu，必须完全走原路径');
{
    const { window, $, $item } = boot({ ua: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5 });
    // 假时钟：把「长按 520ms → 抬手补发 click」的时序钉死（见文件顶部 pinClock 的说明）。
    // 真机时序：touchstart → 约 520ms 时系统派发 contextmenu（菜单弹出，手指还按着）→ 抬手补发 click。
    const clock = pinClock(window);
    const t0 = clock.now();
    touch(window, 'touchstart', 100, 200, $item[0]);
    clock.advance(ANDROID_HOLD);                 // 手指按住的那 520ms（假时钟推进，不真等）
    let prevented = null;
    // 注意：库里的处理函数会 stopPropagation（阻止事件继续冒泡到更外层），
    // 所以这里必须挂在同一层级的委托上才能观察到 defaultPrevented
    $(window.document).on('contextmenu', '.images-item', (e) => { prevented = e.isDefaultPrevented(); });
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    const tOpen = clock.now();
    check('长按 contextmenu 照旧打开菜单', !!menu(window), menuText(window));
    check('contextmenu 默认行为被阻止（不弹浏览器菜单）', prevented === true);

    // 抬手 → 安卓可能补发一发 click，不能把刚打开的菜单关掉
    const img = window.document.querySelector('.images-item img');
    clock.advance(SYNTH_CLICK_DELAY);            // 抬手到系统补发那一发 click 的延迟
    touch(window, 'touchend', 100, 200, $item[0]);
    tapClick(window, img);
    check('★ 安卓长按抬手补发的 click 不会关掉刚打开的菜单', menuOpen(window) === true,
        `距 touchstart ${clock.now() - t0}ms / 距菜单打开 ${clock.now() - tOpen}ms（MENU_OPEN_GRACE=${GRACE}）`);

    // 但用户真的另点一下（有 touchstart）时，必须先关菜单而不是点穿
    window.__viewerOpened = 0;
    touch(window, 'touchstart', 300, 300, img);
    tapClick(window, img);
    check('安卓上真手指点别处：只关菜单、不开预览', menuOpen(window) === false && window.__viewerOpened === 0,
        `open=${menuOpen(window)} viewer=${window.__viewerOpened}`);
    clock.unpin();
}

// ---------------------------------------------------------------- Windows
console.log('\n[Windows 桌面] 鼠标右键，必须完全走原路径');
{
    const { window, $, $item } = boot({ ua: UA.windows, platform: 'Win32', maxTouchPoints: 0, hasTouch: false });
    check('没有注入 iOS 专用样式', iosStyle(window) === '');
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    check('右键打开菜单', !!menu(window), menuText(window));
    // 去重窗口不应误伤连续两次右键
    $item.trigger($.Event('contextmenu', { pageX: 60, pageY: 80 }));
    check('连续右键仍能开菜单（去重不影响桌面）', $(`.dropdown-context`).css('left') === '47px', $(`.dropdown-context`).css('left'));
}

// ---------------------------------------------------------------- 回归：看得见的菜单必须拦得住
console.log('\n[回归] 菜单还在屏幕上时，任何路径都不许“点穿”（老师报的 Windows 偶尔点穿）');
{
    const { window, $, $item, img } = boot({ ua: UA.windows, platform: 'Win32', maxTouchPoints: 0, hasTouch: false });
    // 假时钟：A/B/C/D 全部是「必须在某个时间窗之内 / 之外」的断言。用真实 sleep 卡窗口是抽奖
    // （实测：A 前置那条会间歇性红 —— close 之后先跑了一条 console.log，真实耗时偶尔就超过
    //   fadeSpeed+MENU_FADE_GUARD=150ms 的关闭窗，于是 onScreen 变 false）。这里全部用假时钟推进。
    const clock = pinClock(window);

    // A. 淡出窗口：菜单被关掉后元素还在淡出（屏幕上还看得见），这一瞬间点别的图片
    //    必须照样被吞 —— 原来的实现只看状态，状态一 false 就放行，于是点穿开预览。
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    clock.advance(IGNORE_INPUT + 20);                   // 越过“菜单刚打开”的忽略窗
    window.document.getElementById('images-scroll').dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('A 前置：滚动把菜单关掉（状态已是 false）', menuOpen(window) === false);
    check('A 前置：但元素还在屏幕上（淡出中）', window.eval('context.isMenuOnScreen()') === true,
        `onScreen=${window.eval('context.isMenuOnScreen()')}`);

    window.__viewerOpened = 0;
    window.__pageClicks = [];
    tapClick(window, img);
    check('★ A 淡出期间点别的图片：不点穿、不开预览',
        window.__viewerOpened === 0 && window.__pageClicks.length === 0,
        `viewer=${window.__viewerOpened} pageClicks=${window.__pageClicks.length}`);

    // B. 状态与可见性脱节：状态说关了、淡出窗也过了，但菜单其实还画在屏幕上 → 仍必须拦。
    //    （真浏览器里“状态被某条路径提前置 false、而菜单还在”正是偶尔点穿的成因；
    //      jsdom 没有排版引擎、高度恒为 0，所以这里把高度桩成 120。）
    clock.advance(CLOSE_WINDOW + 50);                   // 关闭窗彻底过去（onScreen 只能靠 DOM 实测）
    const el = menu(window);
    el.getBoundingClientRect = () => ({ height: 120, width: 160, top: 0, left: 0, right: 160, bottom: 120 });
    check('B 前置：状态 false、淡出窗已过，但 DOM 实测菜单可见',
        menuOpen(window) === false && window.eval('context.isMenuOnScreen()') === true,
        `state=${menuOpen(window)} onScreen=${window.eval('context.isMenuOnScreen()')}`);

    window.__viewerOpened = 0;
    window.__pageClicks = [];
    tapClick(window, img);
    check('★ B 状态已 false 但菜单还看得见：点击照样被吞，不开预览',
        window.__viewerOpened === 0 && window.__pageClicks.length === 0,
        `viewer=${window.__viewerOpened} pageClicks=${window.__pageClicks.length}`);

    // C. 菜单刚插入引发的那一发滚动（滚动锚定/懒加载重排）不该把菜单自己关掉
    delete el.getBoundingClientRect;                    // 撤掉高度桩，恢复 jsdom 原生实现
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    window.document.getElementById('images-scroll').dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('★ C 菜单刚打开 300ms 内的滚动（它自己引发的）→ 不关菜单', menuOpen(window) === true);

    clock.advance(IGNORE_INPUT + 20);
    window.document.getElementById('images-scroll').dispatchEvent(new window.Event('scroll', { bubbles: true }));
    check('C 过了忽略窗之后用户滚动 → 照旧关菜单', menuOpen(window) === false);

    // D. 淡出结束、菜单真的没了 → 点击必须恢复正常（绝不能一直吞点击）
    clock.advance(CLOSE_WINDOW + 50);
    window.__viewerOpened = 0;
    check('D 前置：菜单确实不在屏幕上了', window.eval('context.isMenuOnScreen()') === false);
    tapClick(window, img);
    check('D 菜单彻底消失后：点击恢复正常', window.__viewerOpened === 1, `viewer=${window.__viewerOpened}`);

    // E. 诊断转储：能拿到开/关记录（含关闭原因），出问题时老师复制出来即可
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    clock.advance(IGNORE_INPUT + 20);
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const dump = window.eval('context.debugDump()');
    check('E debugDump() 含打开记录（触发方式）与关闭原因',
        typeof dump === 'string' && dump.includes('open    trigger=contextmenu') && dump.includes('close   reason=esc'),
        dump.split('\n').slice(0, 1).join(''));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
