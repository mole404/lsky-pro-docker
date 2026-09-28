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
        },
    },

    plugins: [require('@tailwindcss/forms')],
};
