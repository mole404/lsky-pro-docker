/**
 * 批量导出「上传日期」选择器的结构回归网（读文件断言，不跑浏览器；视觉终判仍以真机实测为准）。
 *
 * 覆盖：
 *   1  起止两个 date 输入常驻显示（早先是「自定义日期」展开出来的两行，已取消折叠）
 *   2  快捷区间：清除按钮文案 = 「清除日期」，且相对前四档稍作右移
 *   3  大日历年月快选：文字旁的下拉箭头不能是迷你号（9px 那版看不清），年月共用同一套按钮
 *
 * 这些都是「看一眼就知道对不对」的样式细节，很容易在后续微调里被顺手改回去，所以钉住。
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const settings = fs.readFileSync(path.join(SRC, 'resources', 'views', 'user', 'settings.blade.php'), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

// ---------------------------------------------------------------- 1 起止日期常驻
console.log('\n[日期输入] 起始/结束两行常驻显示');
{
    const from = /<input[^>]*id="export-date-from"[^>]*>/.exec(settings);
    const to = /<input[^>]*id="export-date-to"[^>]*>/.exec(settings);
    const visible = (m) => !!m && ! /hidden|display:\s*none/.test(m[0]);
    check('起始日期输入存在且可见', visible(from), from ? from[0].slice(0, 60) : '未找到');
    check('结束日期输入存在且可见', visible(to), to ? to[0].slice(0, 60) : '未找到');
    check('没有「自定义日期」折叠按钮（已改常驻，不再可收起）',
        ! /<button[^>]*>\s*自定义日期\s*<\/button>/.test(settings));
}

// ---------------------------------------------------------------- 2 快捷区间
console.log('\n[快捷区间] 五档区间 + 清除按钮文案与位置');
{
    const kinds = ['today', 'week', 'month', 'year', 'clear'];
    check('五档都在（今天/本周/本月/今年/清除日期）',
        kinds.every((k) => settings.includes(`data-quick="${k}"`)),
        kinds.filter((k) => ! settings.includes(`data-quick="${k}"`)).join(',') || '齐全');

    const clear = /<button[^>]*data-quick="clear"[^>]*>([^<]*)<\/button>/.exec(settings);
    check('清除按钮文案 = 「清除日期」（早先叫「不选日期」）',
        !!clear && clear[1].trim() === '清除日期', clear ? clear[1].trim() : '未找到该按钮');
    check('旧文案「不选日期」没有残留', ! settings.includes('不选日期'));
    // 需求是「稍微右移」：与前面四档拉开一点距离 ⇒ 按钮自带 margin-left，而不是靠整行的 gap
    check('清除按钮相对前四档右移（自带 margin-left 类）',
        !!clear && /\bclass="[^"]*\bml-\d/.test(clear[0]),
        clear ? clear[0].slice(0, 80) : '未找到该按钮');
}

// ---------------------------------------------------------------- 3 年月快选箭头
console.log('\n[年月快选] 下拉箭头尺寸');
{
    // 年月两个按钮由同一个 pickButton() 生成，箭头样式只有一处定义
    const caret = /el\('span', null, '([^']*font-size:[^']*)', '\\u25be'\)/.exec(settings);
    const size = caret ? parseFloat(/font-size:([\d.]+)px/.exec(caret[1])[1]) : 0;
    check('箭头字号 ≥ 12px（9px 那版太迷你）', size >= 12, `font-size:${size}px`);
    check('箭头样式只有一处定义（年月共用，不会只改到一半）',
        (settings.match(/\\u25be/g) || []).length === 1,
        `出现 ${(settings.match(/\\u25be/g) || []).length} 次`);
}

// ---------------------------------------------------------------- 导出进度弹窗的配色（暗色卡面上也要看得见）
{
    // 只看代码行：解释「原来是 rgba(0,0,0,.12)」的注释不该被判为违规
    const codeLines = settings.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    check('进度槽用主题令牌（原来的 rgba(0,0,0,.12) 压在暗色卡面上几乎看不见）',
        !/rgba\(0,0,0,\.12\)/.test(codeLines), '应改用 var(--lsky-surface-3)');
    check('进度条用强调色令牌', settings.includes('background:var(--lsky-accent)'));
    // 红底与 hover 现在由样式表提供（内联 style 只剩 margin-top）：
    // 内联 background 会压死主题里所有 :hover 规则，所以这张卡片的配色必须落在 CSS 里。
    const less = fs.readFileSync(path.join(SRC, 'resources', 'css', 'common.less'), 'utf8');
    const css = fs.readFileSync(path.join(SRC, 'public', 'css', 'common.css'), 'utf8');
    check('取消导出按钮用危险色令牌（由样式表提供，不在内联 style 里）',
        /#export-cancel\s*\{[^}]*background-color:\s*var\(--lsky-danger-btn\)/.test(less)
        && /#export-cancel\{[^}]*background-color:var\(--lsky-danger-btn\)/.test(css)
        && ! /id="export-cancel"[\s\S]{0,160}?background:/.test(settings));
    // 只许换颜色：filter / opacity / transform 都会作用在整层（含 swal2 那圈 3px 阴影），
    // 暗色区域会溢到按钮轮廓之外，看起来「比按钮大一圈」。
    check('取消导出按钮有可见的 hover 反馈（只换填充色，不用 filter）',
        /#export-cancel:hover(?::not\(:disabled\))?\s*\{[^}]*background-color:\s*var\(--lsky-danger-btn-hover\)/.test(less)
        && ! /#export-cancel:hover\s*\{[^}]*\bfilter\b/.test(less)
        && ! /#export-cancel:hover\{[^}]*\bfilter\b/.test(css));
    // 取消中按钮会被 disable（「正在取消…」），此时不该还有悬停反馈 —— 别让 :hover 对禁用态继续生效。
    check('取消导出按钮的 hover 排除了 disabled',
        /#export-cancel:hover:not\(:disabled\)/.test(less)
        && /#export-cancel:hover:not\(:disabled\)/.test(css));
    check('按钮显式清掉 swal2 的 3px 外环阴影', /#export-cancel\s*\{[^}]*box-shadow:\s*none/.test(less));

    // 令牌定义本身也要在：上面只断言「谁用了 var(--lsky-danger-btn…)」，把 app.css 里的令牌删掉/改名，
    // 全仓没有任何测试会红（导出取消按钮会退化成一圈透明底）。app.css 是压缩过的单行文件，
    // 所以按主题块取声明再取值，不用固定字符数窗口。
    const appCss = fs.readFileSync(path.join(SRC, 'public', 'css', 'app.css'), 'utf8');
    const appSrc = fs.readFileSync(path.join(SRC, 'resources', 'css', 'app.css'), 'utf8');

    // 按选择器收集所有规则体（大括号配平；源文件里这两条包在 @layer base 里，所以左边界也允许 `{`）
    const bodies = (css, selector) => {
        const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?:^|[{};,])\\s*${esc}\\s*\\{`, 'g');
        const out = [];
        let m;
        while ((m = re.exec(css))) {
            const start = m.index + m[0].length;
            let depth = 1;
            for (let i = start; i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}' && --depth === 0) { out.push(css.slice(start, i)); break; }
            }
            re.lastIndex = start;
        }
        return out;
    };
    // 名字后面必须紧跟「:」—— 否则查 `--lsky-danger-btn` 会命中 `--lsky-danger-btn-hover`
    const token = (css, selector, name) => {
        const body = bodies(css, selector).find((b) => new RegExp(`${name}\\s*:`).test(b)) || '';
        const m = new RegExp(`${name}\\s*:\\s*([^;}]+)`).exec(body);
        return m ? m[1].trim() : '';
    };
    const luma = (hex) => {
        const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
        if (! m) return NaN;
        const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
        return [0.2126, 0.7152, 0.0722]
            .reduce((sum, w, i) => sum + w * parseInt(h.slice(i * 2, i * 2 + 2), 16), 0);
    };

    const light = [token(appCss, ':root', '--lsky-danger-btn'), token(appCss, ':root', '--lsky-danger-btn-hover')];
    const dark = [token(appCss, 'html.dark', '--lsky-danger-btn'), token(appCss, 'html.dark', '--lsky-danger-btn-hover')];
    check('app.css 亮色主题（:root）里两个危险按钮令牌都有定义',
        !!light[0] && !!light[1], `btn=${light[0] || '缺失'} hover=${light[1] || '缺失'}`);
    check('app.css 暗色主题（html.dark）里两个危险按钮令牌都有定义',
        !!dark[0] && !!dark[1], `btn=${dark[0] || '缺失'} hover=${dark[1] || '缺失'}`);
    // 暗色的悬停方向是「往上提一档」：只断言令牌存在看不出方向反没反
    check('暗色 hover 与静止值不同且更亮（悬停确实是提亮，不是压暗）',
        !!dark[0] && !!dark[1] && dark[1] !== dark[0] && luma(dark[1]) > luma(dark[0]),
        `${dark[0]} → ${dark[1]}`);
    check('旧名 --lsky-danger-hover 已不存在（源与产物都不留，避免只改到一半）',
        ! /--lsky-danger-hover(?![\w-])/.test(appCss) && ! /--lsky-danger-hover(?![\w-])/.test(appSrc));
    // 源文件里也得有：只改产物的话，下次重编 app.css 又会把令牌弄丢
    check('resources/css/app.css（令牌源）亮/暗两套也都定义了这两个令牌',
        !!token(appSrc, ':root', '--lsky-danger-btn') && !!token(appSrc, ':root', '--lsky-danger-btn-hover')
        && !!token(appSrc, 'html.dark', '--lsky-danger-btn') && !!token(appSrc, 'html.dark', '--lsky-danger-btn-hover'));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => ! r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
