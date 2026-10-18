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
        /#export-cancel\s*\{[^}]*background-color:\s*var\(--lsky-danger\)/.test(less)
        && /#export-cancel\{[^}]*background-color:var\(--lsky-danger\)/.test(css)
        && ! /id="export-cancel"[\s\S]{0,160}?background:/.test(settings));
    // 只许换颜色：filter / opacity / transform 都会作用在整层（含 swal2 那圈 3px 阴影），
    // 暗色区域会溢到按钮轮廓之外，看起来「比按钮大一圈」。
    check('取消导出按钮有可见的 hover 反馈（只换填充色，不用 filter）',
        /#export-cancel:hover\s*\{[^}]*background-color:\s*var\(--lsky-danger-hover\)/.test(less)
        && ! /#export-cancel:hover\s*\{[^}]*\bfilter\b/.test(less)
        && ! /#export-cancel:hover\{[^}]*\bfilter\b/.test(css));
    check('按钮显式清掉 swal2 的 3px 外环阴影', /#export-cancel\s*\{[^}]*box-shadow:\s*none/.test(less));
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => ! r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
