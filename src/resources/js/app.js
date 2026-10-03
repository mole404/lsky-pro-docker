require('./bootstrap');

import Alpine from 'alpinejs';
import Sidebar from './stores/sidebar';
import Modal from './stores/modal';
import Theme from './stores/theme';

Alpine.store('sidebar', Sidebar);
Alpine.store('modal', Modal);
Alpine.store('theme', Theme);

window.Alpine = Alpine;

Alpine.start();

window.utils = {
    formatSize(bytes, decimal) {
        if (bytes === 0) return '0 B';

        let c = 1024,
            d = decimal || 2,
            e = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
            f = Math.floor(Math.log(bytes) / Math.log(c));

        return parseFloat((bytes / Math.pow(c, f)).toFixed(d)) + " " + e[f];
    },
    /**
     * 更新进度条
     * @param size 增加的字节(kb)
     * @param total 总共有多少字节(kb)
     */
    setCapacityProgress(size, total) {
        let $progress = $('#capacity-progress');
        if ($progress.length) {
            let used = parseFloat($progress.find('progress').val()) + size;
            $progress.find('progress').val(used);
            $progress.find('span.used').text(utils.formatSize(used * 1024));

            if (total !== undefined && typeof total === 'number') {
                total = parseFloat($progress.find('progress').attr('max')) + total;
                $progress.find('progress').attr('max', total);
                $progress.find('span.total').text(utils.formatSize(total * 1024));
            }
        }
    },
    guid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },
    isMobile() {
        if (navigator.userAgent.match(/Android/i)
            || navigator.userAgent.match(/webOS/i)
            || navigator.userAgent.match(/iPhone/i)
            || navigator.userAgent.match(/iPad/i)
            || navigator.userAgent.match(/iPod/i)
            || navigator.userAgent.match(/BlackBerry/i)
            || navigator.userAgent.match(/Windows Phone/i)
        ) {
            return window.screen.width < 768;
        }
        return false;
    },
    infiniteScroll(selector, options) {
        if ($(selector).length > 0) {
            let classes = options.classes || {};
            let loadingText = options.loadingText || '加载中...';
            let finishedText = options.finishedText || '我也是有底线的~';
            let errorText = options.errorText || '加载失败';
            let offset = options.offset || 30;
            let props = {
                loading: false,
                finished: false,
            };
            // 「用户是否已经有过真实输入」。滚动到底自动加载依赖「哨兵进入视口」这一个判据，
            // 而图墙被清空重排（换筛选/换排序/刷新）时页面会瞬间变极短，哨兵必然落在视口里，
            // 此后每一次滚动事件都满足条件 ⇒ 一页接一页连着拉，表现就是「无脑滚到底」
            // （安卓 Edge 重排期间滚动事件更密，只有它中招）。
            // 对策：重排之后必须先有用户的真实输入（滚轮/触摸滑动/按键）才恢复自动加载；
            // 程序化滚动与重排自身引发的 scroll 事件不算数。点哨兵手动加载不受影响。
            // 初始必须为 true：页面正常加载后用户下滑就该自动加载，不能一进页面就锁住。
            // 只在重排（refresh/reset）之后才置 false。
            let armed = true;
            const arm = () => { armed = true; };
            // 哨兵（列表末尾那行「加载更多 / 我也是有底线的~」）的专属类：click 委托只认它，
            // 不再用「容器内任意 span」—— 否则列表行里任何一个 span（相册名、徽标…）被点都会
            // 误触发加载。模板一行都不用改：哨兵是这里自己插进容器的。
            // （外层 .infinite-scroll 容器类保留 —— CSS 靠它控制弹窗里隐藏/显示，别动。）
            const sentinelClass = 'js-infinite-scroll-trigger';
            $(selector).append(`<div class="infinite-scroll"><span class="${sentinelClass}">${loadingText}</span></div>`);
            for (const classesKey in classes) {
                $(selector).find('.infinite-scroll').addClass(classes[classesKey]);
            }
            let $btn = $(selector + ' .infinite-scroll span');

            let opts = {
                url: options.url || '',
                data: {
                    page: 1,
                },
                beforeSend() {
                    props.loading = true;
                    props.finished = false;
                    $btn.text(loadingText).addClass('disabled')
                },
                success(response) {
                    options.success && options.success.call(props, response.data);
                },
                complete(data) {
                    props.loading = false;
                    if (props.finished) {
                        // no more
                        $btn.text(finishedText).addClass('disabled')
                    } else {
                        $btn.text('加载更多').removeClass('disabled')
                    }
                    if (opts.data.page !== undefined) {
                        opts.data.page++;
                    }
                    options.complete && options.complete.call(props, data)
                },
                error(error) {
                    console.log(error)
                    // response = error.response
                    $btn.text(errorText).addClass('disabled')
                    setTimeout(() => $btn.text(errorText).removeClass('disabled'), 3000)
                }
            };

            let load = (params, force) => {
                if (!force) {
                    if (props.loading || props.finished) return;
                    if (!armed) return;      // 重排/恢复位置引起的程序化滚动不算数，等用户真实滚动一次
                }
                if (typeof options.data === 'function') {
                    opts.data = options.data(opts.data) || {};
                }
                if (params) {
                    opts.data = $.extend(opts.data, params)
                }

                opts.beforeSend();
                axios.get(opts.url, {params: opts.data}).then(opts.success).catch(opts.error).finally(opts.complete);
            };

            // 首次加载
            load();
            // 点哨兵加载下一页。判据收窄到本方法自己插的那条哨兵（专属类 sentinelClass）；
            // 用 closest 而不是 is —— 点哨兵里的子元素（图标/文字）也算点了哨兵，行为不变。
            // .disabled 语义保留：加载中/到底/出错时哨兵带 .disabled，那时点了不加载。
            // 事件带命名空间（click.infiniteScroll）：destroy() 只解绑自己这一条，不再把绑在
            // 同一个容器上别人的 click 委托一起摘掉（图片页容器上还有一条 .image-selector）。
            $(selector).off('click.infiniteScroll').on('click.infiniteScroll', (e) => {
                const $trigger = $(e.target).closest('.' + sentinelClass);
                if ($trigger.length === 0 || $trigger.hasClass('disabled')) return;
                load();
            });

            // 滚动到底自动加载。默认跟「容器自己的滚动条」（抽屉这类固定高度面板）；
            // options.root = 'window' 时跟整页滚动 —— 图片墙已改成整页滚动（手机地址栏才会收起）。
            const useWindowScroll = options.root === 'window';
            const onScroll = function () {
                if (useWindowScroll) {
                    // 用哨兵（本方法自己插在列表末尾的 .infinite-scroll）相对「可视视口」的位置判断。
                    // 不能再用 scrollTop + innerHeight >= document.height() - offset：移动浏览器
                    // （安卓/Edge）的可滚动高度是按「地址栏收起后的大视口」算的，而 innerHeight 报的
                    // 是「地址栏可见时的小视口」，两者差 50~60px > offset 默认那 30px 余量 —— 真滑到
                    // 底那一发条件仍不成立（第一次不加载），得再拖一下让地址栏收起才刚好成立。
                    // getBoundingClientRect().top 是对当前可视视口量的，天然免疫这个不一致。
                    // 回归测试：infinite-scroll-bottom-mobile.test.mjs
                    const $sentinel = $(selector).find('.infinite-scroll').last();
                    if ($sentinel.length > 0) {
                        const top = $sentinel[0].getBoundingClientRect().top;
                        // 哨兵已经不在视口里（页面重新长高／用户滚上去了）⇒ 解除重排后的临时锁，
                        // 之后凡是滑到底都照常自动加载。这样既不误伤正常下滑，也不让重排后的
                        // 「页面极短 + 任何 scroll 事件」连拉到底。
                        if (top > window.innerHeight + offset) {
                            armed = true;
                        }
                        if (top <= window.innerHeight + offset && armed) {
                            load();
                        }
                        return;
                    }
                    // 兜底：哨兵是本方法自己插的，理论上不会找不到；真找不到也别把自己搞死，
                    // 退回原来的公式（桌面端这套是准的）。
                    if ($(window).scrollTop() + $(window).height() >= $(document).height() - offset) {
                        load();
                    }
                    return;
                }
                if (this.scrollTop + $(selector).height() < this.scrollHeight - offset) {
                    armed = true;      // 没到底 ⇒ 解锁（同 window 版的语义）
                    return;
                }
                if (armed) {
                    load();
                }
            };
            const ARM_EVENTS = 'wheel.infiniteScroll touchmove.infiniteScroll keydown.infiniteScroll';
            if (useWindowScroll) {
                $(window).on('scroll.infiniteScroll', onScroll).on(ARM_EVENTS, arm);
            } else {
                $(selector).on('scroll.infiniteScroll', onScroll).on(ARM_EVENTS, arm);
            }

            return {
                refresh(params) {
                    armed = false;              // 重排后要求用户再真实滚动一次
                    load(params, true);
                },
                reset() {
                    armed = false;              // 同上
                    opts.data = {page: 1};
                    props.loading = false;
                    props.finished = false;
                    load(undefined, true);
                },
                destroy() {
                    $(selector).off('scroll.infiniteScroll').off('click.infiniteScroll')
                        .off('wheel.infiniteScroll touchmove.infiniteScroll keydown.infiniteScroll')
                    $(window).off('wheel.infiniteScroll touchmove.infiniteScroll keydown.infiniteScroll')
                    // 谁注册谁解绑：window 版把监听挂在 window 上，容器版（相册弹窗/移动到相册
                    // 列表）挂在自己的 selector 上。原来这行是无条件的 —— 容器版一 destroy
                    // 就把图片墙的整页滚动监听一起摘掉了（相册弹窗开→关之后，滚到底不再自动
                    // 加载，只能手点列表底部那行哨兵）。回归测试：infinite-scroll-destroy.test.mjs
                    if (useWindowScroll) {
                        $(window).off('scroll.infiniteScroll')
                    }
                }
            }
        }
    }
}
