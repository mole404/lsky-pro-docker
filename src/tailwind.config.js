const defaultTheme = require('tailwindcss/defaultTheme');

/*
 | 主题说明：
 |   · darkMode: 'class' —— 由 <html class="dark"> 决定暗色（上游原本就是这么配的，只是一直没用起来）
 |   · 颜色全部指向 resources/css/app.css 里的 CSS 变量：同一份 class 在亮/暗下都正确
 |     （写 bg-surface / text-ink / border-line 就够了，不必逐个写 dark: 变体；
 |      代价是 var() 颜色不能用 /50 这种透明度写法 —— 需要透明时改用 rgb(... / .5) 或 ring 类）
 |   · 字体改成系统字体栈：不再从 Google Fonts 拉 Nunito（那个 CDN 在国内慢，中文也用不上）
 */
module.exports = {
    darkMode: 'class',
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './storage/framework/views/*.php',
        './resources/views/**/*.blade.php',
    ],

    theme: {
        extend: {
            colors: {
                bg: 'var(--lsky-bg)',
                surface: {
                    DEFAULT: 'var(--lsky-surface)',
                    2: 'var(--lsky-surface-2)',
                    3: 'var(--lsky-surface-3)',
                },
                line: {
                    DEFAULT: 'var(--lsky-border)',
                    2: 'var(--lsky-border-2)',
                },
                ink: {
                    DEFAULT: 'var(--lsky-text)',
                    2: 'var(--lsky-text-2)',
                    3: 'var(--lsky-text-3)',
                },
                brand: {
                    DEFAULT: 'var(--lsky-accent)',
                    hover: 'var(--lsky-accent-hover)',
                    soft: 'var(--lsky-accent-soft)',
                },
                danger: {
                    DEFAULT: 'var(--lsky-danger)',
                    soft: 'var(--lsky-danger-soft)',
                },
            },
            fontFamily: {
                sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC',
                       'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', ...defaultTheme.fontFamily.sans],
            },
            boxShadow: {
                // 上游遗留，保留以免别处引用报错
                custom: '0px 4px 6px -1px rgba(0, 0, 0, 0.04)',
                card: 'var(--lsky-shadow-card)',
                pop: 'var(--lsky-shadow-pop)',
                modal: 'var(--lsky-shadow-modal)',
            },
            borderRadius: {
                xl2: '12px',
            },
            /*
             | 断点整体 ×1.1（桌面默认 110% 缩放的配套修正，2026-10-01）
             |
             | 背景：`resources/css/common.less` 里 `@media (min-width:768px){html{zoom:1.1}}`。
             | 实测（真 Chromium 153）：`zoom` 只改布局尺寸（布局宽度变成 窗口宽/1.1），
             | **不改 media query 的判定宽度** —— MQ 仍按真实窗口宽 W 判。而浏览器整页缩放到
             | 110% 时，布局宽度和 MQ 判定宽度**都是** W/1.1。于是同一套断点会在两种模式下
             | 于不同宽度"翻牌"，排版对不上：
             |   · W=1600：CSS zoom 下仍命中 2xl(1536) → 2xl:px-60 生效（内容两侧各多 220px 留白）；
             |     浏览器 110% 下布局宽度只有 1454，2xl 不生效 → xl:px-10（几乎贴满）。
             |   · W∈[768,845)：CSS zoom 下 md 生效（px-10），浏览器 110% 下布局宽 <768 不生效（px-6）。
             | 修法：把断点阈值 ×1.1，使「A 用真实宽 W 判、B 用布局宽 W/1.1 判」两者等价
             | （A 命中 T ⟺ W≥1.1·T ⟺ W/1.1≥T ⟺ B 命中原阈值 T）。
             |
             | sm 保持 640px 不动：它低于 768，改它会波及真实视口 <768 的手机/平板竖屏
             | （640~704 之间的设备会整片换样），违反"手机端零变化"。
             | md/lg/xl/2xl 全部 >768，只会影响"开了缩放"的档位，<768 的真实视口零变化。
             | 注意 `md:` 因此不再等于 768：凡"随缩放一起开"的补偿类（blade 里的
             | min-h/h calc(100vh/1.1)）已改用 common.less 里的 `ls-zoom-*` 类（@media(min-width:768px)）。
            */
            screens: {
                md: '844.8px',      // 768  * 1.1
                lg: '1126.4px',     // 1024 * 1.1
                xl: '1408px',       // 1280 * 1.1
                '2xl': '1689.6px',  // 1536 * 1.1
            },
        },
    },

    plugins: [require('@tailwindcss/forms')],
};
