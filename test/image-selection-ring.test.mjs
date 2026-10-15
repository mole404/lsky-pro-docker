/**
 * 「我的图片」图片墙那圈蓝框：**只在被勾选时**出现（读文件断言，不跑浏览器）。
 *
 * 背景：卡片在模板里就常驻 outline（2px、外扩 2px、颜色透明），真正染蓝它的只有一条规则。
 * 原来那条是 `#images-grid a.ds-selected, #images-grid a:hover` —— 鼠标扫过一排图片就一路蓝框，
 * 手机上浏览器「粘住」的 :hover 还会在最后点过的那张上留框。现在改成只认 `.ds-selected`
 * （DragSelect 给选中项加的类，页面没有自定义 selectedClass ⇒ 就是默认值）。
 *
 * 硬约束（改这条规则时一起守）：
 *   ① 描边染色只能认选中态，任何位置都不许再出现「:hover + outline-color」；
 *   ② 悬停的其它反馈**不许动**：右上角小圆勾仍悬停显示（选中时额外染品牌色）；
 *   ③ 模板里那串透明 outline 必须留着 —— 它是「上色不引起重排」的唯一保证（outline 不占布局，
 *      但若把类删干净、改天用 border 来画框，就会挤动 justifiedGallery 的排版）；
 *   ④ 作用域只在 #images-grid（别的页面没有这条规则）。
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const css = read('public', 'css', 'common.css');
const less = read('resources', 'css', 'common.less');
const blade = read('resources', 'views', 'user', 'images.blade.php');
const dsBundle = read('public', 'js', 'dragselect', 'ds.min.js');

// 只取 #images-grid 这一段（三条规则，紧邻 .switch）
const gridCss = css.slice(css.indexOf('#images-grid'), css.indexOf('.switch{'));
const gridLess = less.slice(less.indexOf('// 我的图片'), less.indexOf('// 开关样式'));

console.log('\n[编译产物] 描边只在选中态染色');
{
    check('选中态染色规则在（ds-selected → 品牌色描边）',
        /#images-grid a\.ds-selected\{outline-color:var\(--lsky-accent\)\}/.test(gridCss),
        gridCss.slice(0, 60));
    check('这段里 outline-color 只出现一次（没有第二条抢先染色）',
        (gridCss.match(/outline-color/g) || []).length === 1,
        `count=${(gridCss.match(/outline-color/g) || []).length}`);
    check('★ 任何「:hover 染色描边」的规则都不复存在',
        ! /a:hover[^{}]*\{[^{}]*outline-color/.test(gridCss) && ! /a:hover\{outline-color/.test(gridCss),
        (gridCss.match(/[^{}]*:hover[^{}]*\{[^{}]*outline-color[^{}]*\}/) || ['未命中'])[0]);
}

console.log('\n[编译产物] 悬停的其它反馈一个字没动');
{
    check('小圆勾仍悬停显示（a:hover .image-selector{display:block} 原样）',
        /#images-grid a\.ds-selected \.image-selector,#images-grid a:hover \.image-selector\{display:block\}/.test(css));
    check('选中时小圆勾染品牌色那条原样（含它自己的 a:hover 分支）',
        /#images-grid a\.ds-selected\.ds-selected \.image-selector i,#images-grid a:hover\.ds-selected \.image-selector i\{border-color:#fff;color:var\(--lsky-accent\)\}/.test(css));
    check('#images-grid 一共三条规则（不多不少，没顺手增删）',
        (gridCss.match(/\}/g) || []).length === 3,
        `rules=${(gridCss.match(/\}/g) || []).length}`);
}

console.log('\n[LESS 源码] 与产物同义（两处都必须改）');
{
    check('源码里描边染色挂在 a.ds-selected 下',
        /a\.ds-selected \{\s*\n\s*outline-color: var\(--lsky-accent\);/.test(gridLess));
    check('源码这段里 outline-color 也只出现一次',
        (gridLess.match(/outline-color/g) || []).length === 1,
        `count=${(gridLess.match(/outline-color/g) || []).length}`);
    check('源码里小圆勾那块仍是 a:hover, a.ds-selected（悬停反馈保留）',
        /a:hover, a\.ds-selected \{\s*\n\s*\.image-selector \{/.test(gridLess));
}

console.log('\n[模板与库] 选中态的定义与「上色不重排」的保证');
{
    check('卡片仍常驻透明 outline（2px / 外扩 2px）—— 染色不引起任何重排',
        /class="images-item [^"]*outline outline-2 outline-offset-2 outline-transparent/.test(blade),
        (blade.match(/class="images-item[^"]*"/) || ['未找到'])[0].slice(0, 110));
    check('ds-selected 就是 DragSelect 默认的选中类（库里带这个字符串）', dsBundle.includes('ds-selected'));
    check('页面没有自定义 selectedClass（染色锚点必然等于「被勾选」）',
        ! /selectedClass/.test(blade) && /new DragSelect\(\{\s*area:/.test(blade));
    check('渲染出的图片墙容器就是 #images-grid（规则作用域对得上）', /id="images-grid"/.test(blade));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
