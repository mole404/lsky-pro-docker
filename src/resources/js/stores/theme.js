/*
 | 主题（亮 / 暗 / 跟随系统）
 |
 | 交互约定：
 |   · 三态：system（默认，跟随系统） / light / dark
 |   · 选择存在 localStorage['lsky-theme']，刷新后保持
 |   · 真正生效的是 <html> 上的 .dark 类；首屏防闪由 layouts 里的内联脚本负责
 |     （内联脚本必须在 CSS 之前跑，否则暗色下会先闪一下白屏）
 |   · 系统主题变化时，只有 system 模式跟着变
 */
const KEY = 'lsky-theme';

export default {
    mode: 'system',
    resolved: 'light',

    init() {
        let saved = null;
        try {
            saved = localStorage.getItem(KEY);
        } catch (e) {
            // 隐私模式下 localStorage 可能不可用，忽略即可
        }
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
            this.mode = saved;
        }
        this.apply();

        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            if (this.mode === 'system') {
                this.apply();
            }
        };
        if (mq.addEventListener) {
            mq.addEventListener('change', onChange);
        } else if (mq.addListener) {
            mq.addListener(onChange);
        }
    },

    systemPrefersDark() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    apply() {
        this.resolved = this.mode === 'system' ? (this.systemPrefersDark() ? 'dark' : 'light') : this.mode;
        document.documentElement.classList.toggle('dark', this.resolved === 'dark');
    },

    set(mode) {
        this.mode = mode;
        try {
            localStorage.setItem(KEY, mode);
        } catch (e) {
            // 存不进去也不影响本次会话生效
        }
        this.apply();
    },
};
