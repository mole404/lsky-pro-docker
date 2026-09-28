/*
 * Context.js
 * Copyright Jacob Kelley, Modified by WispX
 * MIT License
 *
 * ===== fork 补丁（mole404/lsky-pro-docker）=====
 * 背景：iOS 上的 WebKit 永远不会派发 contextmenu 事件（WebKit bug 213953），
 * 长按图片只会弹出系统 callout，于是"我的图片"里的自定义菜单在 iPhone/iPad 上完全不可用。
 *
 * 本补丁的处理：在**不改动原有 contextmenu 路径**的前提下，新增一条仅 iOS 生效的长按分支：
 *   1. 自己用 touchstart + 定时器识别长按，复用同一段开菜单逻辑（beforeOpen/afterOpen 照旧生效）
 *   2. 注入 -webkit-touch-callout: none 压掉 iOS 的原生菜单/放大镜（只作用于本库绑定的元素范围）
 *   3. 吞掉 iOS 抬手补发的那一发 click（否则会顺手触发图片预览等点击行为）
 *
 * 隔离性：判定函数只在 iPad/iPhone/iPod（含 iPadOS 伪装成 Mac）上返回真。
 * Android 的长按本来就会派发 contextmenu、Windows 是鼠标右键，它们继续走原路径，
 * 新增代码一行都不会执行。
 */
window.context = window.context || (function () {

    const LONG_PRESS_DELAY = 250;   // 长按判定阈值（毫秒）。iOS 原生 callout 约 500ms，这里减半更快响应；
                                    // 手指移动超过 LONG_PRESS_MOVE 即取消，用来抵消阈值变短带来的误触风险
    const LONG_PRESS_MOVE = 10;     // 手指移动超过这个像素数就取消长按，让位给滚动/框选
    const DEDUPE_WINDOW = 700;      // 长按已开菜单后，忽略紧随其后的 contextmenu（防将来 iOS 支持该事件后弹两次）
    const NEXT_CLICK_WINDOW = 700;  // 长按之后要吞掉的第一发 click

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
    // 也确认长按手势已经结束。
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

    function initialize(opts) {

        options = $.extend({}, options, opts);

        $(document).on('click', 'html', function () {
            $('.dropdown-context').fadeOut(options.fadeSpeed, function () {
                $('.dropdown-context').css({display: ''}).find('.drop-left').removeClass('drop-left');
            });
        });
        if (options.preventDoubleContext) {
            $(document).on('contextmenu', '.dropdown-context', function (e) {
                e.preventDefault();
            });
        }
        $(document).on('mouseenter', '.dropdown-submenu', function () {
            let $sub = $(this).find('.dropdown-context-sub:first'),
                subWidth = $sub.width(),
                subLeft = $sub.offset().left,
                collision = (subWidth + subLeft) > window.innerWidth;
            if (collision) {
                $sub.addClass('drop-left');
            }
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

            let $dd = $("#dropdown-" + id);

            if (typeof options.above == 'boolean' && options.above) {
                $dd.addClass('dropdown-context-up').css({
                    top: pageY - 20 - $('#dropdown-' + id).height(),
                    left: pageX - 13
                }).fadeIn(options.fadeSpeed);
            } else if (typeof options.above == 'string' && options.above === 'auto') {
                $dd.removeClass('dropdown-context-up');
                let autoH = $dd.height() + 12;
                if ((pageY + autoH) > $('html').height()) {
                    $dd.addClass('dropdown-context-up').css({
                        top: pageY - 20 - autoH,
                        left: pageX - 13
                    }).fadeIn(options.fadeSpeed);
                } else {
                    $dd.css({
                        top: pageY + 10,
                        left: pageX - 13
                    }).fadeIn(options.fadeSpeed);
                }
            }

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

    return {
        init: initialize,
        settings: updateOptions,
        attach: addContext,
        destroy: destroyContext
    };
})();
