/*
 * context-js.js 长按补丁的行为测试（jsdom + jQuery）
 *
 * 用途：在没有 iPhone 的情况下，用真实 DOM + jQuery 事件把补丁的每条分支跑一遍，
 *       并验证"只在 iOS 生效、其它平台一行新代码都不执行"这条隔离性。
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
const LIB_PATH = process.argv[2] || path.join(here, '..', 'overlay', 'context-js.js');
const LIB_SRC = fs.readFileSync(LIB_PATH, 'utf8');

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    macM: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot({ ua, platform = 'iPhone', maxTouchPoints = 5, hasTouch = true }) {
    const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
        <div id="images-scroll"><div id="images-grid">
            <a class="images-item" data-id="1" href="javascript:void(0)">
                <img alt="a" data-original="https://img.example.com/a.jpg" src="https://img.example.com/a-thumb.jpg">
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
    $('document');
    window.eval('context.init({ fadeSpeed: 100, above: "auto", preventDoubleContext: true });');
    window.eval(`context.attach('#images-scroll', { data: [{ text: '刷新' }] });`);
    window.eval(`context.attach('.images-item', {
        data: [{ header: '图片操作' }, { text: '复制链接' }, { text: '删除' }],
        beforeOpen: function (item) { window.__calls.push(['beforeOpen', $(item).data('id')]); },
        afterOpen: function (item, dd) { window.__calls.push(['afterOpen', $(item).data('id'), $(dd).find('li').length]); },
    });`);

    return { dom, window, $, $item: $('.images-item'), img: window.document.querySelector('.images-item img') };
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

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const menu = (window) => window.document.querySelector('.dropdown-context');
const menuText = (window) => (menu(window)?.textContent || '').replace(/\s+/g, ' ').trim();
const iosStyle = (window) => window.document.getElementById('context-js-ios-touch')?.textContent || '';

// ---------------------------------------------------------------- iPhone
console.log('\n[iPhone Safari] 长按应弹出图床自己的菜单');
{
    const { window, $, $item, img } = boot({ ua: UA.iphone });
    await longPress(window, $item[0]);
    check('长按 500ms 后出现自定义菜单', !!menu(window), menuText(window));
    check('菜单内容完整（header + 各项）', menuText(window).includes('图片操作') && menuText(window).includes('复制链接'));
    check('显示的是图片自己的菜单，没有被外层容器的"刷新"菜单盖掉', !menuText(window).includes('刷新'));
    check('beforeOpen 被调用且拿到元素', window.__calls.some((c) => c[0] === 'beforeOpen' && c[1] === 1), JSON.stringify(window.__calls));
    check('afterOpen 被调用且拿到菜单节点', window.__calls.some((c) => c[0] === 'afterOpen' && c[2] === 3), JSON.stringify(window.__calls));
    // jsdom 没有排版引擎，高度恒为 0，所以这里只校验 left（= clientX - 13）与 top 是数值
    check('菜单定位用触摸坐标（left = 100 - 13）', $(`.dropdown-context`).css('left') === '87px', $(`.dropdown-context`).css('left'));
    check('已注入 -webkit-touch-callout 抑制样式', iosStyle(window).includes('-webkit-touch-callout: none'), iosStyle(window).slice(0, 60));

    // 抬手后 iOS 会补一发 click（这个网格的图片绑了 Viewer，不拦就会弹预览）
    let viewerOpened = false;
    img.addEventListener('click', () => { viewerOpened = true; });
    touch(window, 'touchend', 100, 200, $item[0]);
    img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('长按抬手补发的 click 被吞掉（不会误开图片预览）', viewerOpened === false);

    // 时间窗过了以后，正常点击必须照旧生效
    await sleep(750);
    viewerOpened = false;
    img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('时间窗过后的正常点击照旧生效', viewerOpened === true);
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
    check('短按（<500ms 抬手）不触发菜单', !menu(c.window));
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
    await longPress(window, $item[0]);
    check('长按不触发新分支（新代码一行都不执行）', !menu(window));
    check('没有注入 iOS 专用样式', iosStyle(window) === '');
    let prevented = null;
    // 注意：库里的处理函数会 stopPropagation（阻止事件继续冒泡到更外层），
    // 所以这里必须挂在同一层级的委托上才能观察到 defaultPrevented
    $(window.document).on('contextmenu', '.images-item', (e) => { prevented = e.isDefaultPrevented(); });
    $item.trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
    check('长按 contextmenu 照旧打开菜单', !!menu(window), menuText(window));
    check('contextmenu 默认行为被阻止（不弹浏览器菜单）', prevented === true);
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

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
