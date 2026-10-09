// 最小复现：菜单打开 → 来了滚动把它关掉 → 紧接着点别的图片
// 期望：这一发点击被吞、不开预览。旧版（HEAD）应当点穿 → 证明新用例不是空的。
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const LIB = process.argv[2] || path.join(here, '..', 'src', 'public', 'js', 'context-js', 'context-js.js');
const JQUERY_SRC = fs.readFileSync(path.join(here, 'node_modules/jquery/dist/jquery.js'), 'utf8');
const LIB_SRC = fs.readFileSync(LIB, 'utf8');
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <div id="images-scroll"><div id="images-grid">
        <a class="images-item" data-id="1" href="javascript:void(0)">
            <img alt="a" data-original="https://img.example.com/a.jpg" src="https://img.example.com/a-thumb.jpg">
        </a>
    </div></div>
</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://img.example.com/images' });
const { window } = dom;
Object.defineProperty(window.navigator, 'userAgent', { value: UA_WIN, configurable: true });
Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true });
Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 0, configurable: true });
window.eval(JQUERY_SRC);
window.eval(LIB_SRC);
const $ = window.jQuery;
window.eval('context.init({ fadeSpeed: 100, above: "auto", preventDoubleContext: true });');
window.eval(`context.attach('.images-item', { data: [{ header: '图片操作' }, { text: '复制链接' }, { text: '删除' }] });`);

window.__viewerOpened = 0;      // 模拟 Viewer：点图片就开预览
window.__pageClicks = 0;        // 冒泡到 document 的点击 = 点穿
window.document.querySelectorAll('.images-item img').forEach((el) => el.addEventListener('click', () => { window.__viewerOpened++; }));
window.document.addEventListener('click', () => { window.__pageClicks++; });

const img = window.document.querySelector('.images-item img');
const item = window.document.querySelector('.images-item');

$(item).trigger($.Event('contextmenu', { pageX: 30, pageY: 40 }));
console.log('菜单已打开:', window.eval('typeof context.isMenuOpen === "function" ? context.isMenuOpen() : "(旧版无此 API)"'));

await sleep(320);
// 菜单插入后浏览器自己可能来的那一发滚动（滚动锚定/懒加载重排）
window.document.getElementById('images-scroll').dispatchEvent(new window.Event('scroll', { bubbles: true }));
console.log('滚动后 menuOpen:', window.eval('typeof context.isMenuOpen === "function" ? context.isMenuOpen() : "(旧版无此 API)"'));

// 紧接着点别的图片（这一瞬间菜单还在淡出、屏幕上还看得见）
img.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
console.log(`\n结果：viewer 打开次数=${window.__viewerOpened}  冒泡到 document 的点击=${window.__pageClicks}`);
console.log(window.__viewerOpened === 0 && window.__pageClicks === 0 ? '✅ 没点穿（新行为）' : '❌ 点穿了：预览被打开（这就是实测遇到的 bug）');
