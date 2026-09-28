const STORAGE_KEY = 'lsky-sidebar';

const readCollapsed = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'collapsed';
    } catch (e) {
        return false; // localStorage 不可用（隐私模式等）时按展开处理
    }
};

const applyCollapsed = (collapsed) => {
    const root = document.documentElement;

    if (collapsed) {
        root.classList.add('sidebar-collapsed');
    } else {
        root.classList.remove('sidebar-collapsed');
    }
};

// 模块加载时就贴一次类：app.blade.php 的首屏内联脚本会在样式之前贴（防抖），
// 这里兜底（例如首屏脚本被 CSP 拦掉的情况）。两处都是幂等的。
applyCollapsed(readCollapsed());

export default {
    // 手机端抽屉
    open: false,

    // 桌面端折叠（宽度 4rem、只留图标）
    collapsed: readCollapsed(),

    init() {
        applyCollapsed(this.collapsed);
    },

    toggle() {
        this.open = ! this.open;
    },

    toggleCollapsed() {
        this.collapsed = ! this.collapsed;
        applyCollapsed(this.collapsed);

        try {
            localStorage.setItem(STORAGE_KEY, this.collapsed ? 'collapsed' : 'expanded');
        } catch (e) {
            // 存不了就算了，本次会话内照常工作
        }

        // 通知需要"重新测量"的页面（例如我的图片页的图片墙）在动画结束后重排
        window.dispatchEvent(new CustomEvent('lsky:sidebar-toggled', {
            detail: { collapsed: this.collapsed }
        }));
    },

    // 桌面端 = 折叠/展开，手机端 = 抽屉。同一个按钮，同一个语义（开关侧栏）
    toggleSmart() {
        if (window.matchMedia && window.matchMedia('(min-width: 640px)').matches) {
            this.toggleCollapsed();
        } else {
            this.toggle();
        }
    }
};
