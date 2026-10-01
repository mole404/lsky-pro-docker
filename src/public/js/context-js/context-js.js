/*
 * Context.js
 * Copyright Jacob Kelley, Modified by WispX
 * MIT License
 *
 * ===== fork 补丁（mole404/lsky-pro-docker）=====
 * 背景一：iOS 上的 WebKit 永远不会派发 contextmenu 事件（WebKit bug 213953），
 * 长按图片只会弹出系统 callout，于是"我的图片"里的自定义菜单在 iPhone/iPad 上完全不可用。
 * 处理：在**不改动原有 contextmenu 路径**的前提下，新增一条仅 iOS 生效的长按分支：
 *   1. 自己用 touchstart + 定时器识别长按，复用同一段开菜单逻辑（beforeOpen/afterOpen 照旧生效）
 *   2. 注入 -webkit-touch-callout: none 压掉 iOS 的原生菜单/放大镜（只作用于本库绑定的元素范围）
 *   3. 吞掉 iOS 抬手补发的那一发 click（否则会顺手触发图片预览等点击行为）
 *
 * 背景二（菜单收放，2026-09-28 追加）：
 *   原库只在 document 的冒泡阶段 fadeOut，既不阻止事件传播；二级菜单又只靠 CSS :hover 显示。于是
 *   (a) 点"菜单之外"会点穿到页面（点别的图片顺手开了预览、点链接会跳转）；
 *   (b) 手机上没有光标，点"复制链接"这种带二级菜单的项时，合成鼠标事件让二级菜单闪一下，
 *       紧接着那发 click 撞上关闭逻辑，整个菜单直接消失。
 * 处理：(a) 在 document 的**捕获阶段**装一层菜单守卫 —— 只关菜单、并吞掉这一发事件；
 *       (b) 触摸设备（(hover: none)）改成点击展开/收起二级菜单，有鼠标的设备继续用 hover；
 *       另外支持滚动/缩放/Esc 关闭菜单（都是老师要的"收得优雅"）。
 *
 * 隔离性：长按分支只在 iPad/iPhone/iPod（含 iPadOS 伪装成 Mac）上返回真，Android/Windows 继续走
 * contextmenu 原路径，长按相关代码一行都不执行。菜单守卫是通用行为，但其中"点击展开二级菜单"
 * 只在没有鼠标/触摸板的设备上生效，桌面端交互与上游一致。
 */
window.context = window.context || (function () {

    const LONG_PRESS_DELAY = 250;   // 长按判定阈值（毫秒）。iOS 原生 callout 约 500ms，这里减半更快响应；
                                    // 手指移动超过 LONG_PRESS_MOVE 即取消，用来抵消阈值变短带来的误触风险
    const LONG_PRESS_MOVE = 10;     // 手指移动超过这个像素数就取消长按，让位给滚动/框选
    const DEDUPE_WINDOW = 700;      // 长按已开菜单后，忽略紧随其后的 contextmenu（防将来 iOS 支持该事件后弹两次）
    const NEXT_CLICK_WINDOW = 700;  // 长按之后要吞掉的第一发 click
    const MENU_CLOSE_CLICK_WINDOW = 700; // 因"点了菜单外"而关菜单时，要吞掉随后那一发 click 的时间窗
    const MENU_OPEN_GRACE = 800;    // 菜单刚打开的这一小段时间里，抬手补发的 click 不许把菜单关掉
                                    // （iOS/Android 长按抬手都可能补发一发 click，目标正是刚被长按的那张图；
                                    //  菜单是手指还按着时就弹出来的，抬手到补发 click 的延迟通常 <500ms，
                                    //  所以留 800ms 余量。真手指再点一次必定先有 touchstart，那条路径另有处理）
    const MENU_OPEN_IGNORE_INPUT = 300; // 菜单刚打开的这一小段时间里，忽略 scroll/resize/orientation。
                                    // 为什么需要它：菜单是绝对定位插进 body 的，**插入这个动作本身**就可能
                                    // 让页面高度/滚动条变化，触发浏览器自己的滚动（滚动锚定、图片懒加载重排、
                                    // justified-gallery 重新布局）。这些“非用户操作”的滚动会把菜单刚开就关掉，
                                    // 而关掉之后元素还要淡出，屏幕上看着菜单还在 —— 那一瞬间的点击就会点穿。
    const MENU_FADE_GUARD = 50;     // 关菜单后，元素还要淡出 fadeSpeed 毫秒；这段时间它在屏幕上，
                                    // 点击必须照样被吞（否则就是“看得见菜单却点穿了”）。这里再加一点余量。
    const DEBUG_BUFFER_SIZE = 240;  // 诊断环缓冲长度（context.debugDump() 用）

    let options = {
        fadeSpeed: 100,
        filter: function ($obj) {
            // Modify $obj, Do not return
        },
        above: 'auto',
        preventDoubleContext: true,
        compress: false
    };

    // ===== fork 补丁：iOS 长按支持（开始）=====

    // 是否 iOS/iPadOS 上的 WebKit。注意只判 iOS 不判浏览器：iOS 上 Chrome/Edge/Firefox 内核同样是 WebKit。
    // iPadOS 13+ 的"请求桌面网站"会把 UA 伪装成 Mac（platform === 'MacIntel'），
    // 而真 Mac —— 包括苹果 M 系列 —— 的 maxTouchPoints 是 0，据此区分，不会误判。
    function isIOSWebKit() {
        if (! ('ontouchstart' in window)) {
            return false;
        }

        return /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    let touchSelectors = [];        // 已经接上长按分支的选择器
    let stylesInjected = false;
    let swipeClickUntil = 0;        // 需要吞掉 click 的时间窗
    let lastOpenAt = 0;             // 上一次由长按打开菜单的时间（用于与 contextmenu 去重）
    let guardInstalled = false;

    // 压掉 iOS 的原生长按菜单与放大镜。只作用于本库绑定的元素范围 + 菜单本身，
    // 不碰页面其它地方的链接/文字，保证其它长按能力不受影响。
    function injectTouchStyles() {
        if (stylesInjected) {
            return;
        }
        stylesInjected = true;

        let rules = touchSelectors.map(function (selector) {
            return selector + ', ' + selector + ' *';
        }).join(', ') + ', .dropdown-context, .dropdown-context *';

        $('<style id="context-js-ios-touch">').appendTo('head').text(
            rules + ' { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }'
        );
    }

    // 捕获阶段吞掉长按之后 iOS 补发的那一发 click。
    // 用 preventDefault + stopPropagation：既不触发元素自身的点击行为（例如打开图片预览），
    // 也确认长按手势已经结束。同时在事件上打标，菜单守卫据此知道"这一发已经处理过了"。
    function installClickGuard() {
        if (guardInstalled) {
            return;
        }
        guardInstalled = true;

        document.addEventListener('click', function (e) {
            if (Date.now() > swipeClickUntil) {
                return;
            }
            swipeClickUntil = 0;

            for (let i = 0; i < touchSelectors.length; i++) {
                if (e.target.closest && e.target.closest(touchSelectors[i])) {
                    e.__contextjsClickSwallowed = true;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
        }, true);
    }

    // 给某个选择器接上长按识别。仅 iOS 调用。
    function installLongPress(selector, openMenu) {
        injectTouchStyles();
        installClickGuard();

        let timer = null,
            startX = 0,
            startY = 0,
            triggered = false;

        function cancel() {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        }

        $(document).on('touchstart', selector, function (e) {
            let nativeEvent = e.originalEvent,
                touch = nativeEvent.touches[0];

            cancel();
            triggered = false;

            // 多指（缩放等）不参与长按
            if (! touch || nativeEvent.touches.length > 1) {
                return;
            }

            // 与桌面端 stopPropagation 的语义保持一致：一次长按只交给最内层（最具体）的那个
            // attach 处理。jQuery 的委托分发是从目标向上逐层调用，所以这里是"先到先得"，
            // 外层容器（例如 #images-scroll 的"刷新"菜单）不会再抢走图片自己的菜单。
            if (nativeEvent.__contextjsLongPressTaken) {
                return;
            }
            nativeEvent.__contextjsLongPressTaken = true;

            startX = touch.clientX;
            startY = touch.clientY;

            let item = this;
            timer = setTimeout(function () {
                timer = null;
                triggered = true;
                lastOpenAt = Date.now();
                openMenu(item, touch.clientX, touch.clientY);
            }, LONG_PRESS_DELAY);
        });

        $(document).on('touchmove', selector, function (e) {
            let touch = e.originalEvent.touches[0];

            if (timer === null || ! touch) {
                return;
            }

            if (Math.abs(touch.clientX - startX) > LONG_PRESS_MOVE
                || Math.abs(touch.clientY - startY) > LONG_PRESS_MOVE) {
                cancel();
            }
        });

        $(document).on('touchend touchcancel', selector, function (e) {
            cancel();

            if (triggered) {
                swipeClickUntil = Date.now() + NEXT_CLICK_WINDOW;
                e.preventDefault();
            }
        });
    }

    // ===== fork 补丁：iOS 长按支持（结束）=====

    // ===== fork 补丁：菜单收放 + 触摸端二级菜单（开始）=====

    let menuVisible = false;        // 菜单是否打开（状态）。**“拦不拦这一发点击”不能只看它**：
                                    // scroll/resize/Esc/淡出等多条路径都会把它提前置 false，而菜单可能还在屏幕上。
                                    // 一律走 menuOnScreen()，那里以“真实可见性”为准。
    let menuOpenedAt = 0;           // 菜单打开时刻，用于 MENU_OPEN_GRACE / MENU_OPEN_IGNORE_INPUT
    let menuClosingUntil = 0;       // 关菜单后到这一刻为止，元素仍在淡出、还在屏幕上
    let lastMenuEventAt = 0;        // 最近一次菜单相关事件的时刻（诊断用：只记“与菜单有关”的点击）
    let debugBuffer = [];           // 诊断环缓冲
    let debugToConsole = false;     // context.debug = true 时实时打控制台
    let lastTouchAt = 0;            // 最近一次触摸开始时刻：用来区分"触摸补发的 click"和"真鼠标点击"
    let suppressClickUntil = 0;
    let submenuInplaceAt = 0;       // 二级菜单就地替换的时刻（诊断/短窗用）
    let touchGestureId = 0;         // 每一次「手指按下」算一个新手势
    let armedGestureId = 0;         // 二级菜单是在哪一次手势里被打开的
    let submenuArmingTimer = null;  // 「刚弹出、先别高亮」的收尾定时器     // 因"点了菜单外"而关菜单后，要吞掉的那一发 click
    let armedMenuGestureId = 0;     // 主菜单是在哪一次手势里被打开的
    let menuArmingTimer = null;     // 主菜单「刚弹出、先别高亮」的收尾定时器
    let fingerOnScreen = false;     // 屏幕上还有没有手指按着（主菜单 arming 窗口据此跟手势续期，而不是死定时器）
    let menuStylesInjected = false;
    let menuGuardInstalled = false;

    // 有鼠标/触摸板的设备（(hover: none) 为假）继续用 hover 展开二级菜单；手机/平板改成点击展开。
    // jsdom 之类没有 matchMedia 的环境，退回"有没有触摸能力"判定。
    function isTouchInput() {
        if (window.matchMedia) {
            return !! window.matchMedia('(hover: none)').matches;
        }
        return ('ontouchstart' in window);
    }

    function injectMenuStyles() {
        if (menuStylesInjected) {
            return;
        }
        menuStylesInjected = true;

        // 与主题里这条等价，只是改成用类触发（手机上没有 hover）：
        //   .dropdown-context .dropdown-submenu:hover>.dropdown-menu{display:block}
        // 桌面端永远不会加上这个类，所以那条路径零影响。
        $('<style id="context-js-touch-submenu">').appendTo('head').text(
            '.dropdown-context .dropdown-submenu.touch-open > .dropdown-menu { display: block; }'
            // 手机：二级菜单就地在面板里展开（不侧开、不覆盖、不占额外宽度）
            + '.dropdown-context.submenu-inplace > li { display: none !important; }'
            + '.dropdown-context.submenu-inplace > li.submenu-active,'
            + ' .dropdown-context.submenu-inplace > li.submenu-back { display: block !important; }'
            + '.dropdown-context.submenu-inplace > li.submenu-active > a { display: none !important; }'
            + '.dropdown-context.submenu-inplace > li.submenu-active > .dropdown-menu {'
            + ' position: static !important; float: none !important; display: block !important;'
            + ' min-width: 0 !important; margin: 0 !important; padding: 0 !important;'
            + ' border: 0 !important; border-radius: 0 !important; box-shadow: none !important;'
            + ' background: transparent !important; }'
            // 主菜单版（与下面二级菜单那份同一套 arming 机制，见 armMenuHoverGuard）：
            // 长按弹出的主菜单同样会顶在手指底下，真机触摸的粘滞 hover 会把手指底下那一项当成 hover 目标
            // → 弹出瞬间那项就跳高亮（老师截图里的「复制图片」）。这里连 li 一起关指针事件：
            // 只关 a 的话，主题里的 `.dropdown-submenu:hover > a` 仍会因为 li 被 hover 而给「复制链接」上色。
            // 另外 hover 那套是「底色 + 文字变白」两件一起上（见 context-js.less 的 li>a:hover），
            // 所以文字色也一并还原 —— 万一 :hover/:focus 还是粘住了，那一项也保持原样，不会变成白底白字。
            //
            // ⚠ color / background-color 这两条强制覆盖只准落在「真正的菜单项」(`> li > a`) 上，不能落在 li 层：
            //   标题是 `> li.nav-header`，自带灰色（.nav-header{color:var(--lsky-text-3)}），
            //   被 `color:inherit` 压成面板继承来的近黑（--lsky-text）→ 守卫窗口内「图片操作」黑一下、
            //   窗口一过又弹回灰色 = 老师看到的闪烁；
            //   同理分隔线 `> li.divider` 有自己的底色，也会被 `background-color:transparent` 打掉又弹回来。
            // 防误触真正的关键是 li 上的 pointer-events:none（配合 a 上那份），把强制换色的声明收窄到 a
            // 不会削弱任何一层守卫：li 层原本也不需要靠换色来防误触。
            + '.dropdown-context.menu-arming > li { pointer-events: none !important; }'
            + '.dropdown-context.menu-arming > li > a {'
            + ' pointer-events: none !important; background-color: transparent !important; color: inherit !important; }'
            // 刚弹出的一瞬间：项不接受指针事件（浏览器就不会把它当成 hover 目标 → 不会高亮），
            // 同时把 hover 底色压平做双保险；不改变任何尺寸/位置，面板本身照旧接收点击（由守卫吞掉）。
            + '.dropdown-context.submenu-inplace.submenu-arming > li.submenu-active > .dropdown-menu > li > a,'
            + ' .dropdown-context.submenu-inplace.submenu-arming > li.submenu-back > a {'
            + ' pointer-events: none !important; background-color: transparent !important; }'
            + '.dropdown-context.submenu-inplace > li.submenu-active > .dropdown-menu:before,'
            + ' .dropdown-context.submenu-inplace > li.submenu-active > .dropdown-menu:after { display: none !important; }'
        );
    }

    // ===== 诊断（fork 新增）=====
    // 常驻记录“与菜单有关”的事件：开、关（含原因）、以及菜单牵涉到的点击判定。
    // 万一现场还出问题，老师说一句 context.debugDump() 就能把证据拿出来，不用再猜。
    function describeNode(node) {
        if (! node || ! node.tagName) {
            return String(node);
        }
        let id = node.id ? '#' + node.id : '',
            cls = (typeof node.className === 'string' && node.className.trim())
                ? '.' + node.className.trim().split(/\s+/).join('.')
                : '';
        return node.tagName.toLowerCase() + id + cls;
    }

    function logMenuEvent(text) {
        lastMenuEventAt = Date.now();
        let line = '[' + new Date().toISOString().slice(11, 23) + '] ' + text;
        debugBuffer.push(line);
        if (debugBuffer.length > DEBUG_BUFFER_SIZE) {
            debugBuffer = debugBuffer.slice(-DEBUG_BUFFER_SIZE);
        }
        if (debugToConsole && window.console && window.console.log) {
            window.console.log('[context-js] ' + line);
        }
    }

    // 菜单到底还在不在屏幕上？判据顺序：
    //   1) 状态就是打开 → 在；
    //   2) 状态刚被置 false 但还没淡出完 → 也在（否则这段时间就是“看得见却点穿”的窗口）；
    //   3) DOM 实测兜底：元素还画着（高度 > 0）就按“在”算。
    // 第 3 条是关键：真浏览器里它才是唯一可信的判据 —— 任何一条把状态提前置 false 的路径，
    // 都不该让“屏幕上明明看得见的菜单”失去拦截能力。
    function menuOnScreen() {
        if (menuVisible) {
            return true;
        }
        if (Date.now() <= menuClosingUntil) {
            return true;
        }

        let nodes = document.querySelectorAll('.dropdown-context');
        for (let i = 0; i < nodes.length; i++) {
            let el = nodes[i];
            if (el.style && el.style.display === 'none') {
                continue;
            }
            if (typeof el.getBoundingClientRect === 'function' && el.getBoundingClientRect().height > 0) {
                return true;
            }
        }

        return false;
    }

    // 菜单刚打开？用来忽略“菜单自己引发的”scroll/resize（见 MENU_OPEN_IGNORE_INPUT）
    function justOpenedMenu() {
        return (Date.now() - menuOpenedAt) < MENU_OPEN_IGNORE_INPUT;
    }

    function closeMenus(reason) {
        if (menuVisible) {
            logMenuEvent('close   reason=' + (reason || 'unknown')
                + ' openFor=' + (Date.now() - menuOpenedAt) + 'ms');
        }

        menuVisible = false;
        // 淡出期间元素仍在屏幕上：这段时间的点击必须照样被吞
        menuClosingUntil = Date.now() + options.fadeSpeed + MENU_FADE_GUARD;

        exitSubmenuInplace(true);       // 就地替换状态跟着菜单一起清掉（不重夹，元素正在淡出）

        $('.dropdown-context').fadeOut(options.fadeSpeed, function () {
            $('.dropdown-context').css({ display: '' });
            $('.dropdown-context .drop-left').removeClass('drop-left');
            $('.dropdown-context .touch-open').removeClass('touch-open');
        });
    }

    function isInsideMenu(node) {
        return !! (node && node.closest && node.closest('.dropdown-context'));
    }

    // 触摸设备：点"带二级菜单的父项" → 展开/收起它的二级菜单，且**不关闭**整个菜单。
    // 返回 true 表示这次点击已被消费（守卫不要再往下走）。
    // 注意父项本身没有 action（只是个容器），所以拦下它不会影响复制等功能：
    // 真正干活的叶子项（.copy，ClipboardJS 绑的就是它们）在二级菜单里，点击照旧放行。
    // ---------- fork 补丁：菜单/子菜单的视口边界钳制 ----------
    // 上游只做了「纵向翻转」（above:'auto'）和子菜单「右溢出就左翻」，横向从来没有钳制过：
    // 靠近右边缘的图片，主菜单会被切掉一半；「复制链接」这类二级菜单固定往右展开，直接飞出屏幕。
    // 纵向也没人管，所以子菜单"有时候跑有时候不跑"——取决于菜单开在页面什么高度。
    // 这里统一收口：菜单与子菜单在展开后按视口夹回来，装不下就给内部滚动，保证每一项都点得到。
    // 只改定位，不碰显示/隐藏逻辑 —— 长按与点击防护依赖 CSS :hover 的真实可见性，动不得。
    const EDGE_MARGIN = 8;
    const SUBMENU_GUARD = 350;      // 二级菜单「就地替换」后这段毫秒内，触摸点击一律吞掉（防按住误选）
    const SUBMENU_ARM_MS = 420;     // 二级菜单刚弹出的这段毫秒内，先别接受指针指向（防那一下高亮跳色）
    const MENU_ARM_MS = 420;        // 主菜单（长按弹出）同理：弹出后这段时间内的项不接受指针指向
    const MENU_ARM_TAIL_MS = 260;   // 抬手之后再压这么多毫秒 —— 老师原话「手抬起来的那一瞬间留冗余」，
                                    // 与二级菜单那份抬手冗余同一个数（见 armMenuHoverGuard / touchend）

    function viewportSize() {
        const de = document.documentElement;

        return {
            w: de.clientWidth || window.innerWidth,
            h: de.clientHeight || window.innerHeight,
            sx: window.pageXOffset || de.scrollLeft || 0,
            sy: window.pageYOffset || de.scrollTop || 0
        };
    }

    // 主菜单是 <body> 下的绝对定位元素，它的 left/top/max-height 是**元素本地长度**；
    // 桌面端 html{zoom:1.1}（common.less）会让这棵树里的长度在渲染时再乘一次 zoom，
    // 而 MouseEvent 的 pageX/clientX、getBoundingClientRect、documentElement.clientWidth
    // 用的都是**视口物理 px** —— 两套单位差一个 zoom。写 style 前除以它即可对齐。
    // 运行时读实际生效的 zoom（不写死 1.1）：取不到 / "normal" → fallback 1，手机端（<768px
    // 不命中该 @media）读到的就是 1，全部换算退化为原样，观感零变化。
    function zoomFactor() {
        try {
            const z = parseFloat(window.getComputedStyle(document.documentElement).zoom);
            return (isFinite(z) && z > 0) ? z : 1;
        } catch (e) {
            return 1;
        }
    }

    // 菜单的真实盒子（视口物理 px）。display:none 时量不出尺寸 → 临时显形量一次，
    // 量完原样还原（只动 display/visibility，不碰定位）。
    function measureBox($el) {
        const node = $el.get(0);
        let rect = node.getBoundingClientRect();
        if (! rect.width || ! rect.height) {
            const prevDisplay = node.style.display, prevVisibility = node.style.visibility;
            node.style.display = 'block';
            node.style.visibility = 'hidden';
            rect = node.getBoundingClientRect();
            node.style.display = prevDisplay;
            node.style.visibility = prevVisibility;
        }
        return rect;
    }

    // 主菜单是 <body> 下的绝对定位元素，top/left 用的是**页面坐标**。
    // 夹取全部在**元素本地单位**里做：凡是物理 px 的量（viewportSize / outerWidth /
    // outerHeight / getBoundingClientRect）都先除以实际 zoom，写回 style 的也就是本地值。
    // zoom === 1 时每一步都退化成改动前的算式（逐字节同样的结果）→ <768px 手机端零变化。
    function clampMenu($el) {
        if (! $el || ! $el.length || ! $el.get(0) || ! $el.get(0).parentNode) {
            return;
        }

        const margin = EDGE_MARGIN;
        const vp = viewportSize();
        const z = zoomFactor();

        // 先看 DOM 里的真实盒子（物理 px，含 display:none 的临时显形测量），再换算成本地长度
        const box = measureBox($el);
        let w = box.width / z, h = box.height / z;
        if (! w || ! h) {
            return;                       // 真量不到就别乱动定位
        }

        // 视口 / 滚动量换算到元素本地单位
        const vw = vp.w / z, vh = vp.h / z, sx = vp.sx / z, sy = vp.sy / z;
        const m = margin / z;

        // 比视口还高（手机上常见）→ 内部滚动，而不是被裁掉
        const maxHeight = vh - m * 2;
        if (h > maxHeight) {
            $el.css({maxHeight: Math.round(maxHeight) + 'px', overflowY: 'auto'});
            h = maxHeight;
        }

        let left = parseFloat($el.css('left'));
        let top = parseFloat($el.css('top'));
        left = isNaN(left) ? (sx + m) : left;
        top = isNaN(top) ? (sy + m) : top;

        if (left + w > sx + vw - m) {
            left = sx + vw - m - w;
        }
        if (left < sx + m) {
            left = sx + m;
        }
        if (top + h > sy + vh - m) {
            top = sy + vh - m - h;
        }
        if (top < sy + m) {
            top = sy + m;
        }

        $el.css({left: Math.round(left) + 'px', top: Math.round(top) + 'px'});
    }

    // 子菜单相对父 li 定位（left:100% / .drop-left 时 -100%）。调用时它必须是可见的
    // （hover 路径靠 CSS :hover，触摸路径靠 .touch-open），否则量不出尺寸。
    function fitSubmenu($li) {
        const $sub = $li.find('.dropdown-context-sub:first');
        if (! $sub.length || ! $sub.get(0)) {
            return;
        }

        // 每次都从「默认右开、无内联约束」重算，避免上一次留下的类/内联样式
        $sub.removeClass('drop-left').css({left: '', top: '', maxHeight: '', overflowY: ''});

        const node = $sub.get(0);
        if (! node.getBoundingClientRect().width) {
            return;                        // 此刻不可见，别乱改
        }

        const margin = EDGE_MARGIN;
        const vp = viewportSize();

        // ① 横向：右开溢出就翻到左边；翻过去更糟（窄屏）就退回右开
        let rect = node.getBoundingClientRect();
        if (rect.right > vp.w - margin) {
            $sub.addClass('drop-left');
            rect = node.getBoundingClientRect();
            if (rect.left < margin) {
                $sub.removeClass('drop-left');
                rect = node.getBoundingClientRect();
            }
        }

        // ② 横向兜底：两边都不够时用内联 left 把子菜单夹进视口（坐标相对父 li）
        //    rect/liRect/vp 都是视口物理 px；写回的 left 是元素本地长度 → 除以 zoom。
        const z = zoomFactor();
        const liRect = $li.get(0).getBoundingClientRect();
        let shiftX = 0;
        if (rect.right > vp.w - margin) {
            shiftX = (vp.w - margin) - rect.right;
        }
        if (rect.left + shiftX < margin) {
            shiftX = margin - rect.left;
        }
        if (shiftX) {
            $sub.css({left: Math.round(((rect.left - liRect.left) + shiftX) / z) + 'px'});
            rect = node.getBoundingClientRect();
        }

        // ③ 纵向：溢出上下边就用内联 top 拉回来
        const baseTop = parseFloat($sub.css('top'));
        let shiftY = 0;
        if (rect.bottom > vp.h - margin) {
            shiftY = (vp.h - margin) - rect.bottom;
        }
        if (rect.top + shiftY < margin) {
            shiftY = margin - rect.top;
        }
        if (shiftY) {
            $sub.css({top: Math.round((isNaN(baseTop) ? 0 : baseTop) + shiftY / z) + 'px'});
        }

        // ④ 比视口还高 → 内部滚动
        rect = node.getBoundingClientRect();
        const maxHeight = vp.h - margin * 2;
        if (rect.height > maxHeight) {
            $sub.css({maxHeight: Math.round(maxHeight / z) + 'px', overflowY: 'auto'});
        }
    }

    // 手机窄屏没有空间放「侧开」的二级菜单：一开就盖住主菜单，手指还没抬起就会压到第一项上。
    // 做法：把面板就地换成二级菜单（顶部插一行「返回」），既不需要额外宽度也不会重叠；
    // 再配合 SUBMENU_GUARD 时间窗，按住不放那一发绝不可能选中任何一项。
    function rootMenuFor($li) {
        return $li.closest('.dropdown-context:not(.dropdown-context-sub)');
    }

    // 刚弹出的一瞬间先别让任何一项成为指针目标（否则浏览器会把手指底下那项判成 hover → 跳高亮）。
    // 窗口从「本次按下」起算，并在抬手时续到抬手之后 —— 按住不动超过窗口也照样不跳色。
    function armSubmenuHoverGuard(ms) {
        $('.dropdown-context').addClass('submenu-arming');
        clearTimeout(submenuArmingTimer);
        submenuArmingTimer = setTimeout(function () {
            $('.dropdown-context').removeClass('submenu-arming');
        }, ms);
    }

    function clearSubmenuHoverGuard() {
        clearTimeout(submenuArmingTimer);
        $('.dropdown-context').removeClass('submenu-arming');
    }

    // 主菜单版（同一套机制，老师要求「复用到长按弹出的主菜单」）：
    // 主菜单弹在手指底下时，那一项会被浏览器判成 hover 目标 → 弹出瞬间跳高亮，功能和以前一样、就是看着脏。
    // 做法与二级菜单那份一致：挂 .menu-arming（里面的项不接受指针事件 + hover 底色压平），
    // 抬手后由 touchend 再续 MENU_ARM_TAIL_MS —— 窗口跟着手势走，不是弹出时定死的一个定时器。
    // 只在「这一发菜单确实是紧随一次触摸打开」时才挂（判据见 openMenu）：桌面右键路径因此一行都不动。
    function armMenuHoverGuard(ms) {
        $('.dropdown-context:not(.dropdown-context-sub)').addClass('menu-arming');
        clearTimeout(menuArmingTimer);
        menuArmingTimer = setTimeout(function () {
            // 手指还按着（而且就是按出这个菜单的那次手势）→ 续期：按住多久都不跳色；
            // 抬手那条路径会再压 MENU_ARM_TAIL_MS 收尾。
            if (fingerOnScreen && armedMenuGestureId && armedMenuGestureId === touchGestureId) {
                armMenuHoverGuard(MENU_ARM_MS);
                return;
            }
            $('.dropdown-context').removeClass('menu-arming');
        }, ms);
    }

    function clearMenuHoverGuard() {
        clearTimeout(menuArmingTimer);
        $('.dropdown-context').removeClass('menu-arming');
    }

    // arming 生效时面板里的项不接受指针事件（这正是"不跳高亮"的关键），于是手指按在菜单项上时
    // e.target 拿到的是面板本身 —— 「按一下就展开二级菜单」这条触摸路径会被吃掉。
    // 这里按触摸坐标把手指底下那一行找回来，只给这一个分支用，保证窗口内的第一次点按与平时一致。
    function rowUnderTouch(e) {
        if (! e || ! e.touches || ! e.touches.length) {
            return null;
        }

        const t = e.touches[0], x = t.clientX, y = t.clientY;
        const rows = document.querySelectorAll('.dropdown-context:not(.dropdown-context-sub) > li');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (r.width && r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                return rows[i];
            }
        }

        return null;
    }

    // 打开某个父项的二级菜单：手机惯例是「按下就开」，这样抬手那发合成 click 也有东西可吞。
    function openSubmenuFor($li) {
        $li.siblings('.dropdown-submenu').removeClass('touch-open');
        $li.addClass('touch-open');
        enterSubmenuInplace($li);
    }

    function enterSubmenuInplace($li) {
        const $menu = rootMenuFor($li);
        if (! $menu.length) {
            return;
        }

        exitSubmenuInplace(true);                       // 先清掉上一次的
        $menu.addClass('submenu-inplace');
        $li.addClass('submenu-active');
        $li.find('.dropdown-context-sub:first').removeClass('drop-left')
            .css({left: '', top: '', maxHeight: '', overflowY: ''});

        if (! $menu.children('.submenu-back').length) {
            $menu.prepend($('<li class="submenu-back"><a href="javascript:void(0)" tabindex="-1">' +
                '<i class="fas fa-chevron-left mr-1"></i>返回</a></li>'));
        }

        // 刚弹出的一瞬间，手指还压在同一位置上：浏览器会把「手指底下那个元素」当成 hover 目标，
        // 于是二级菜单里会有一项立刻跳成高亮 —— 功能上不误触，但观感很脏。
        // 弹出后 SUBMENU_ARM_MS 内给面板挂 .submenu-arming：里面的项不接受指针事件、hover 底色也压平，
        // 手指不动就不会有高亮；过了这段时间（或者手指动/再点）恢复如常。
        armSubmenuHoverGuard(SUBMENU_ARM_MS);

        submenuInplaceAt = Date.now();
        clampMenu($menu);                               // 面板高度变了，重新夹一次视口
    }

    function exitSubmenuInplace(keepGuard) {
        const $menu = $('.dropdown-context.submenu-inplace');
        if (! $menu.length) {
            return;
        }

        clearSubmenuHoverGuard();
        $menu.removeClass('submenu-inplace').children('.submenu-back').remove();
        $menu.children('.submenu-active').removeClass('submenu-active touch-open')
            .find('.dropdown-context-sub:first').removeClass('drop-left')
            .css({left: '', top: '', maxHeight: '', overflowY: ''});

        if (! keepGuard) {
            clampMenu($menu);
        }
    }

    function handleSubmenuTap(e) {
        if (! isTouchInput()) {
            return false;
        }

        let $a = $(e.target).closest('a');
        if (! $a.length) {
            return false;
        }

        let $li = $a.parent();
        if (! $li.length || ! $li.hasClass('dropdown-submenu')) {
            return false;
        }

        e.preventDefault();
        e.stopPropagation();

        let wasOpen = $li.hasClass('touch-open');

        // 同一层级只留一个展开的
        $li.siblings('.dropdown-submenu').removeClass('touch-open');

        if (wasOpen) {
            $li.removeClass('touch-open');
            exitSubmenuInplace(false);
            return true;
        }

        openSubmenuFor($li);

        return true;
    }

    // 菜单守卫。全部装在 document 的**捕获阶段**：jQuery 的委托与 viewer.js 都挂在冒泡阶段，
    // 捕获阶段拦下 = 这一发事件永远不会到达页面自己的处理器。
    // 它在 context.init() 时就装好（不是等第一次开菜单），因为守卫要记录"最近一次触摸开始时刻"——
    // 第一次长按的 touchstart 必须被记到，否则那次抬手补发的 click 会被误判成真点击、把菜单关掉。
    function installMenuGuard() {
        if (menuGuardInstalled) {
            return;
        }
        menuGuardInstalled = true;

        injectMenuStyles();

        document.addEventListener('click', function (e) {
            if (e.__contextjsClickSwallowed) {
                return;                     // 同一发事件已被长按分支吞过
            }
            if (Date.now() <= swipeClickUntil) {
                return;                     // 长按刚开过菜单，抬手那发 click 归长按分支处理
            }
            // 因"点了菜单外"而关菜单时，菜单在**手指按下**的瞬间就已经关掉了（见下面的
            // touchstart），所以这一发必须排在 menuVisible 判断之前，否则漏吞、点击会点穿到页面。
            if (Date.now() <= suppressClickUntil) {
                suppressClickUntil = 0;
                e.__contextjsClickSwallowed = true;
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (! menuOnScreen()) {
                // 连“刚关不久、还在淡出”都算不上 → 与菜单无关的普通点击，照旧放行
                if (Date.now() - lastMenuEventAt < 3000) {
                    logMenuEvent('click   target=' + describeNode(e.target) + ' → 放行（屏幕上没有菜单）');
                }
                return;
            }

            if (isInsideMenu(e.target)) {
                logMenuEvent('click   target=' + describeNode(e.target) + ' → 菜单内部，放行（交给原有逻辑）');
                const sameGesture = armedGestureId && armedGestureId === touchGestureId;
                if (isTouchInput() && (sameGesture || (Date.now() - submenuInplaceAt) < SUBMENU_GUARD)) {
                    logMenuEvent('click   target=' + describeNode(e.target) + ' → 吞掉（防误触：'
                        + (sameGesture ? '同一根手指那一发' : (Date.now() - submenuInplaceAt) + 'ms 内') + '）');
                    e.__contextjsClickSwallowed = true;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                if (handleSubmenuTap(e)) {   // 点的是带二级菜单的父项：展开/收起，已消费
                    return;
                }

                // 防误触（必须排在父项处理与「返回」之前）：真机触摸带粘滞 :hover，二级菜单会先于
                // 抬手出现，抬手那发合成 click 就落在菜单项上（老师实测点「复制链接」被判成「Url」，
                // 按住久一点（实测 700ms）也照样中招 —— 所以判据是「同一根手指那一发」而不是时长）。
                // 判据：这次 click 属于「打开二级菜单的那次手指按下」→ 一律吞掉，什么都不做。

                // 二级菜单顶部的「返回」：切回主菜单，这一发到此为止
                if ($(e.target).closest('.submenu-back').length) {
                    e.__contextjsClickSwallowed = true;
                    e.preventDefault();
                    e.stopPropagation();
                    exitSubmenuInplace(false);
                    return;
                }

                return;                     // 其它内部点击照旧（执行动作 + 原有逻辑关菜单）
            }

            // 菜单刚打开 + 这一发 click 紧随一次触摸 → 认定是长按抬手补发的那一发 click
            // （目标正是刚被长按的图片）。吞掉它，但**不**关菜单，否则菜单会"刚开就自己关掉"。
            // 桌面鼠标点击不满足"紧随触摸"这个条件（lastTouchAt 是 0 或很久以前），照常关菜单。
            if ((Date.now() - lastTouchAt) < MENU_OPEN_GRACE
                && (Date.now() - menuOpenedAt) < MENU_OPEN_GRACE) {
                logMenuEvent('click   target=' + describeNode(e.target)
                    + ' → 吞掉（长按抬手补发的那一发，菜单保持打开）');
                e.__contextjsClickSwallowed = true;
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            logMenuEvent('click   target=' + describeNode(e.target)
                + ' → 关菜单 + 吞掉（state=' + menuVisible + ' closing='
                + Math.max(0, menuClosingUntil - Date.now()) + 'ms）');

            // 点击菜单之外的任何位置：只关闭菜单，绝不把这发事件放给页面
            // （否则会顺手打开图片预览、跳转链接）
            closeMenus('click-outside');
            e.preventDefault();
            e.stopPropagation();
        }, true);

        // 触摸：手指一按下就把菜单收起来，比等抬手更跟手。
        // **不拦截 touchstart 本身**（没有 preventDefault），所以页面滚动/缩放完全不受影响；
        // 随后补发的那发 click 用时间窗吞掉。
        // 手指一按到「带二级菜单的父项」上：立刻就地切换 + 武装防误触窗口。
        // 这一步必须在 touchstart 做 —— 真机的粘滞 :hover 会让二级菜单先出现，
        // 等抬手才处理就晚了（那时 click 已经落在菜单项上了）。
        // 抬手：面板若还在「刚弹出」窗口内，把窗口续到抬手之后 —— 按住再久，那一刻也不跳高亮。
        ['touchend', 'touchcancel'].forEach(function (evt) {
            document.addEventListener(evt, function (e) {
                // 屏幕上还有手指按着吗（多指时抬手一根不算）——主菜单 arming 窗口据此决定要不要续期
                fingerOnScreen = !! (e && e.touches && e.touches.length);

                // 判据是「这一发手指就是打开二级菜单的那一发」——不能看 .submenu-arming 还在不在：
                // 按住超过 SUBMENU_ARM_MS 时，那个类早就被定时器摘掉了（踩过）。
                if (armedGestureId && armedGestureId === touchGestureId
                    && $('.dropdown-context.submenu-inplace').length) {
                    armSubmenuHoverGuard(260);      // 抬手后再压 260ms，抬手那一刻也不会跳色
                }

                // 主菜单同理（老师原话：「只要给我手抬起来的那一瞬间留冗余就够」）——
                // 判据同样是「这一发手指就是打开主菜单的那一发」，按住再久也不会在抬手那一刻跳色。
                if (armedMenuGestureId && armedMenuGestureId === touchGestureId
                    && $('.dropdown-context:not(.dropdown-context-sub)').length) {
                    armMenuHoverGuard(MENU_ARM_TAIL_MS);
                }
            }, true);
        });

        document.addEventListener('touchstart', function (e) {
            touchGestureId++;                       // 新手势：上一发的防误触自动失效

            // 只看「手指底下这个 a 的直接父级」—— 二级菜单的项嵌在父 li 里面，
            // 用 closest('li.dropdown-submenu') 会把二级菜单里的项也误判成父行。
            let $a = $(e.target).closest('a');
            // 主菜单 arming 窗口里，项不接受指针事件 → 手指按在「复制链接」上时 e.target 只是面板，
            // 这一发就按不到那个 a。按坐标把行找回来，只补「按一下就展开二级菜单」这一条路
            // （叶子项靠抬手补发的那发 click，本来就不受影响；就地替换态不兜底，那时的行高/内容都变了）。
            if (! $a.length && $('.dropdown-context.menu-arming').length) {
                const row = rowUnderTouch(e);
                if (row && row.classList.contains('dropdown-submenu')
                    && ! row.classList.contains('submenu-active')) {
                    $a = $(row).children('a');
                }
            }
            const $row = $a.parent();
            if ($row.hasClass('dropdown-submenu') && $row.closest('.dropdown-context').length) {
                if ($row.hasClass('submenu-active')) {
                    exitSubmenuInplace(false);      // 再按一次同一行 → 收起
                } else {
                    openSubmenuFor($row);
                }
                submenuInplaceAt = Date.now();
                armedGestureId = touchGestureId;    // 武装到本次手势：这根手指抬起来的那发 click 必吞
            } else {
                // 手指挪去点别的东西了（包括点菜单项、滑菜单）：立刻恢复正常 hover/点击。
                // 两套 arming 都清 —— 它们各自只对「按出它来的那一次手势」负责，新手势一律失效。
                clearSubmenuHoverGuard();
                clearMenuHoverGuard();
            }
        }, true);

        document.addEventListener('touchstart', function (e) {
            lastTouchAt = Date.now();
            fingerOnScreen = true;                  // 手指按下：主菜单 arming 窗口可以跟手势续期

            if (! menuOnScreen() || isInsideMenu(e.target)) {
                return;
            }

            logMenuEvent('touch   target=' + describeNode(e.target) + ' → 关菜单 + 吞掉随后的 click');
            closeMenus('touch-outside');
            suppressClickUntil = Date.now() + MENU_CLOSE_CLICK_WINDOW;
        }, true);

        // 手指动了说明是滚动/拖拽手势，别把随后那一发 click 也吞掉
        document.addEventListener('touchmove', function () {
            suppressClickUntil = 0;
        }, true);

        // 滚动 / 旋转缩放：菜单用的是页面坐标，视口一动它就会粘在错的地方，直接收起来。
        // 监听装在 document 且用捕获，是为了连 #images-scroll 这类内部滚动容器也能收到。
        document.addEventListener('scroll', function (e) {
            if (! menuVisible || isInsideMenu(e.target)) {
                return;
            }

            if (justOpenedMenu()) {
                // 菜单刚插进 body，浏览器自己可能来一发滚动（滚动锚定 / 懒加载重排 / 画廊重排）——
                // 这一发不是用户滚的，别拿它把菜单关掉：关掉之后元素还要淡出，
                // 屏幕上看着菜单还在，那一瞬间的点击就会点穿。
                logMenuEvent('scroll  target=' + describeNode(e.target)
                    + ' → 忽略（菜单刚打开 ' + (Date.now() - menuOpenedAt) + 'ms）');
                return;
            }

            closeMenus('scroll');
        }, true);

        window.addEventListener('resize', function () {
            if (menuVisible && ! justOpenedMenu()) {
                closeMenus('resize');
            }
        }, true);

        window.addEventListener('orientationchange', function () {
            if (menuVisible) {
                closeMenus('orientationchange');
            }
        }, true);

        // 桌面端顺手：Esc 关闭（不 preventDefault，免得抢走其它 UI 的 Esc）
        document.addEventListener('keydown', function (e) {
            let key = e.key || '';
            if (menuVisible && (key === 'Escape' || key === 'Esc' || e.keyCode === 27)) {
                closeMenus('esc');
            }
        }, true);
    }

    // ===== fork 补丁：菜单收放 + 触摸端二级菜单（结束）=====

    function initialize(opts) {

        options = $.extend({}, options, opts);

        installMenuGuard();

        $(document).on('click', 'html', function () {
            // 菜单内部的点击照旧关闭菜单（菜单外的点击在守卫里处理，事件已经被吞掉、到不了这里）
            if (menuVisible) {
                closeMenus();
            }
        });
        if (options.preventDoubleContext) {
            $(document).on('contextmenu', '.dropdown-context', function (e) {
                e.preventDefault();
            });
        }
        $(document).on('mouseenter', '.dropdown-submenu', function () {
            // 此刻 CSS :hover 已经把它展开（有尺寸），再按视口夹一次
            fitSubmenu($(this));
        });

    }

    function updateOptions(opts) {
        options = $.extend({}, options, opts);
    }

    function buildMenu(event, data, id, subMenu) {
        let subClass = (subMenu) ? ' dropdown-context-sub' : '',
            compressed = options.compress ? ' compressed-context' : '',
            $menu = $('<ul class="dropdown-menu dropdown-context' + subClass + compressed + '" id="dropdown-' + id + '"></ul>');
        let i = 0, linkTarget = '';
        for (i; i < data.length; i++) {
            if (typeof data[i].divider !== 'undefined') {
                $menu.append('<li class="divider"></li>');
            } else if (typeof data[i].header !== 'undefined') {
                $menu.append('<li class="nav-header">' + data[i].header + '</li>');
            } else {
                if (typeof data[i].href == 'undefined') {
                    data[i].href = 'javascript:void(0)';
                }
                if (typeof data[i].target !== 'undefined') {
                    linkTarget = ' target="' + data[i].target + '"';
                }
                let $sub;
                if (typeof data[i].subMenu !== 'undefined') {
                    $sub = $('<li class="dropdown-submenu"><a tabindex="-1" href="' + data[i].href + '">' + data[i].text + '</a></li>');
                } else {
                    $sub = $('<li><a tabindex="-1" href="' + data[i].href + '"' + linkTarget + '>' + data[i].text + '</a></li>');
                }
                // show or hide?
                if (typeof data[i].visible === 'function') {
                    if (! data[i].visible(event)) {
                        $sub.hide();
                    }
                }
                let $a = $sub.find('a');
                // custom classes
                if (typeof data[i].classes !== 'undefined') {
                    for (const classKey in data[i].classes) {
                        $a.addClass(data[i].classes[classKey]);
                    }
                }
                // custom attributes
                if (typeof data[i].attributes !== 'undefined') {
                    for (const attributesKey in data[i].attributes) {
                        $a.attr(attributesKey, data[i].attributes[attributesKey]);
                    }
                }
                // click callback
                if (typeof data[i].action !== 'undefined') {
                    let actionID = 'event-' + new Date().getTime() * Math.floor(Math.random() * 100000),
                        eventAction = data[i].action;
                    $a.attr('id', actionID);
                    $('#' + actionID).addClass('context-event');
                    $(document).on('click', '#' + actionID, function () {
                        eventAction.call(this, event);
                    });
                }
                $menu.append($sub);
                if (typeof data[i].subMenu != 'undefined') {
                    let subMenuData = buildMenu(event, data[i].subMenu, id, true);
                    $menu.find('li:last').append(subMenuData);
                }
            }
            if (typeof options.filter == 'function') {
                options.filter($menu.find('li:last'));
            }
        }
        return $menu;
    }

    /**
     * 添加菜单
     * @param selector 被右击元素
     * @param opts 参数 {
     *     data: Array[Object] {
     *         text: String, // 文本
     *         classes: Array, // class
     *         attributes: Object, // 属性
     *         action: Function, // 点击后的回调 function (e) {}
     *         visible: Function, // 函数返回bool类型，表示显示或隐藏按钮 function (e) {}
     *     }
     *     beforeOpen: Function, // 打开前 function (item) {}
     *     afterOpen: Function, // 打开后 function (item, dropdown) {}
     * }
     */
    function addContext(selector, opts) {
        opts = opts || {};
        let data = opts.data || {};
        let id = new Date().getTime();

        // fork 补丁：把"打开菜单"从 contextmenu 回调里抽出来，
        // 让桌面/安卓的 contextmenu 与 iOS 的长按共用同一段逻辑。
        // item 为匹配到的元素，pageX/pageY 为菜单定位坐标，evt 用于回调里的 this（长按时为 null）。
        function openMenu(item, pageX, pageY, evt) {
            if (! item) {
                return;
            }

            typeof opts.beforeOpen === 'function' && opts.beforeOpen.call(evt || item, item);

            let $menu = buildMenu(item, data, id);
            // clear dropdowns
            $('body .dropdown-menu.dropdown-context').remove();
            // create dropdown
            $('body').append($menu);

            $('.dropdown-context:not(.dropdown-context-sub)').hide();
            exitSubmenuInplace(true);   // 兜底：别把上一次的就地替换状态带进新菜单

            let $dd = $("#dropdown-" + id);

            // fork 补丁：菜单是 <body> 下的绝对定位元素，left/top 是**元素本地长度**，会被
            // html{zoom} 再乘一次；而 pageX/pageY 是视口物理 px。写 style 前除以实际生效的
            // zoom（zoomFactor，取不到则 1）→ 菜单左上角与鼠标点对齐。（<768px 无 zoom，退化为原值。）
            const z = zoomFactor();

            if (typeof options.above == 'boolean' && options.above) {
                $dd.addClass('dropdown-context-up').css({
                    top: (pageY - 20 - $('#dropdown-' + id).height()) / z,
                    left: (pageX - 13) / z
                }).fadeIn(options.fadeSpeed);
            } else if (typeof options.above == 'string' && options.above === 'auto') {
                $dd.removeClass('dropdown-context-up');
                let autoH = $dd.height() + 12;
                if ((pageY + autoH) > $('html').height()) {
                    $dd.addClass('dropdown-context-up').css({
                        top: (pageY - 20 - autoH) / z,
                        left: (pageX - 13) / z
                    }).fadeIn(options.fadeSpeed);
                } else {
                    $dd.css({
                        top: (pageY + 10) / z,
                        left: (pageX - 13) / z
                    }).fadeIn(options.fadeSpeed);
                }
            }

            // fork 补丁：不管上面走了哪个分支，最后统一按视口夹一次
            // （上游只在 above:'auto' 时做了纵向翻转，横向完全没有处理）
            clampMenu($dd);

            menuVisible = true;
            menuOpenedAt = Date.now();
            menuClosingUntil = 0;

            // 刚弹出的主菜单会顶在手指底下：那一项马上会被当成 hover 目标 → 弹出瞬间就跳高亮。
            // 复用二级菜单那套 arming：挂 .menu-arming（项不接受指针事件 + hover 底色压平），抬手后再续 260ms。
            // **只在「这一发菜单确实紧随一次触摸」时才挂**：鼠标右键路径（lastTouchAt 是 0 或很久以前）
            // 与上游完全一致 —— 桌面本来没有粘滞 hover，不该为此改动付出任何代价。
            if ((Date.now() - lastTouchAt) < MENU_OPEN_GRACE) {
                armedMenuGestureId = touchGestureId;
                armMenuHoverGuard(MENU_ARM_MS);
            }

            logMenuEvent('open    trigger=' + (evt ? 'contextmenu' : 'longpress')
                + ' item=' + describeNode(item)
                + ' at=' + Math.round(pageX) + ',' + Math.round(pageY));

            typeof opts.afterOpen === 'function' && opts.afterOpen.call(evt || item, item, $dd.get(0));
        }

        $(document).on('contextmenu', selector, function (e) {
            e.preventDefault();
            e.stopPropagation();

            // 长按刚开过菜单就忽略这一发（避免重复弹菜单）
            if (Date.now() - lastOpenAt < DEDUPE_WINDOW) {
                return;
            }

            openMenu(e.target.closest(selector), e.pageX, e.pageY, e);
        });

        // fork 补丁：iOS 上 contextmenu 永远不来，改由长按触发。仅 iOS 生效。
        if (isIOSWebKit()) {
            touchSelectors.push(selector);
            installLongPress(selector, function (item, clientX, clientY) {
                openMenu(item, clientX + window.pageXOffset, clientY + window.pageYOffset, null);
            });
        }
    }

    function destroyContext(selector) {
        $(document).off('contextmenu', selector).off('click', '.context-event');
    }

    let api = {
        init: initialize,
        settings: updateOptions,
        attach: addContext,
        destroy: destroyContext,
        // fork 补丁：暴露菜单开合状态，供测试与诊断用（上游没有这个）
        isMenuOpen: function () {
            return menuVisible;
        },
        // fork 补丁：菜单此刻是否“在屏幕上”（状态 + 淡出窗口 + DOM 实测），诊断用
        isMenuOnScreen: function () {
            return menuOnScreen();
        },
        // fork 补丁：诊断转储。出问题时在控制台执行 copy(context.debugDump()) 即可复制出来。
        debugDump: function () {
            let head = [
                '# context-js 诊断转储 ' + new Date().toISOString(),
                'url: ' + window.location.href,
                'ua: ' + navigator.userAgent,
                'fadeSpeed: ' + options.fadeSpeed + ' | 触摸输入(hover:none): ' + isTouchInput(),
                'menuVisible: ' + menuVisible + ' | menuOnScreen: ' + menuOnScreen()
                    + ' | 淡出剩余: ' + Math.max(0, menuClosingUntil - Date.now()) + 'ms',
                '--- 事件（时间升序，最多 ' + DEBUG_BUFFER_SIZE + ' 条）---'
            ];
            return head.concat(debugBuffer).join('\n');
        }
    };

    Object.defineProperty(api, 'debug', {
        get: function () {
            return debugToConsole;
        },
        set: function (v) {
            debugToConsole = !! v;
            logMenuEvent('debug   控制台实时输出 = ' + debugToConsole);
        }
    });

    return api;
})();
