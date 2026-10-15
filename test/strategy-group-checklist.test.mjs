/**
 * 储存策略「选择角色组」多选的结构回归网（读文件断言，不跑浏览器）。
 *
 * 背景：这一栏原来是原生 <select multiple> —— 桌面必须按住 Ctrl/⌘ 点选，手机上几乎没法多选。
 * 现改成打勾清单（一行一个角色组，点一下勾上/取消），组多时框内滚动。
 *
 * 覆盖：
 *   1  新建/编辑两页都不再出现原生多选，且都改用 group-checklist 组件
 *   2  组件本身：复选框 name 与后端同形（groups[]）、按 Group 全量列出、编辑页回显已关联的组
 *   3  滚动能力：.ls-checklist 必须有最大高度 + 纵向滚动（组多了不能撑破表单），
 *      LESS 源码与提交的 public/css/common.css 都要有，且 lessc 真编译后不能丢
 *   4  LESS 与提交的 CSS 逐条对账：只改一边（漏了编译产物）会在这里红
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

const add = read('resources', 'views', 'admin', 'strategy', 'add.blade.php');
const edit = read('resources', 'views', 'admin', 'strategy', 'edit.blade.php');
// 注释里会出现「原生 <select multiple>」这种字样（说明为什么改），断言前先去掉注释，
// 否则匹配到的是注释文本而不是真的标签。
const stripComments = (t) => t.replace(/\{\{--[\s\S]*?--\}\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
const component = read('resources', 'views', 'components', 'group-checklist.blade.php');
const less = read('resources', 'css', 'common.less');
const css = read('public', 'css', 'common.css');

// ---------------------------------------------------------------- 1 两页都换掉了
console.log('\n[页面] 原生多选已全部退役');
{
    for (const [label, page] of [['新建储存策略', add], ['编辑储存策略', edit]]) {
        const body = stripComments(page);
        check(`${label}：没有原生 <select multiple>（不再要 Ctrl/⌘ 点选）`,
            ! /<select\b[^>]*\bmultiple\b/.test(body) && ! body.includes('form-multiselect'),
            /<select\b[^>]*\bmultiple\b/.test(body) ? '仍有 multiple 的 select' : '干净');
        check(`${label}：改用 <x-group-checklist />`,
            /<x-group-checklist\b/.test(page));
    }
}

// ---------------------------------------------------------------- 2 组件本身
console.log('\n[组件] 打勾清单');
{
    check('每行是一个复选框，name 与后端同形 groups[]',
        component.includes('type="checkbox"') && /name="\{\{ \$name \}\}\[\]"/.test(component));
    check('默认 name = groups（不传参时也是 groups[]）',
        /'name'\s*=>\s*'groups'/.test(component));
    check('列出全部角色组（与原来 <select> 里那段等价）',
        component.includes('\\App\\Models\\Group::query()'));
    check('已选状态用 @checked 输出（编辑页回显）',
        component.includes('@checked(') && component.includes('$checked'));
    check('组件根元素带角色组语义（role=group + aria-label）',
        component.includes("'role' => 'group'") && component.includes('aria-label'));
    check('没有角色组时有占位文案，不会渲染成一个空框',
        component.includes('ls-checklist__empty'));
}

// ---------------------------------------------------------------- 3 编辑页回显
console.log('\n[回显] 编辑页勾上该策略已关联的组');
{
    check('编辑页传 selected（该策略已关联的组 id）',
        /<x-group-checklist[^>]*:selected="\$strategy->groups->pluck\('id'\)->all\(\)"/.test(edit),
        /<x-group-checklist[^>]*:selected=.*/.exec(edit)?.[0]?.slice(0, 90) || '没找到 :selected');
    check('新建页不传 selected（默认谁也不勾）',
        /<x-group-checklist\s*\/>/.test(add) && ! /<x-group-checklist[^>]*:selected/.test(add));
}

// ---------------------------------------------------------------- 4 滚动能力 + LESS/CSS 对账
console.log('\n[滚动] 组多了在框内滚，不撑破表单');
{
    const scrollProps = ['max-height', 'overflow-y', 'overscroll-behavior'];
    check('LESS 源码里 .ls-checklist 有最大高度 + 纵向滚动',
        /\.ls-checklist \{[\s\S]{0,400}?max-height:[\s\S]{0,400}?overflow-y: auto;/.test(less)
        && scrollProps.every((p) => less.includes(p)));
    check('提交的 common.css 里也有（浏览器加载的是这份）',
        /\.ls-checklist\{[^}]*max-height:[^}]*overflow-y:auto/.test(css)
        && scrollProps.every((p) => css.includes(p)));

    // 真编译一遍：语法错、或者以后有人把这几条从 LESS 里删掉，这里都红
    const lessc = path.join(here, 'node_modules', '.bin', 'lessc');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsky-checklist-'));
    const entry = path.join(tmp, 'common.less');
    fs.writeFileSync(entry, less.replace("@import '~toastr';", '// stub'));   // ~toastr 是 webpack 写法，lessc 不认
    const out = path.join(tmp, 'common.css');
    execFileSync(lessc, [entry, out]);
    const compiledOut = fs.readFileSync(out, 'utf8');

    check('lessc 真编译通过，且编译产物里带这几条滚动声明',
        /\.ls-checklist\s*\{[\s\S]{0,400}?overflow-y: auto;/.test(compiledOut));

    // ---- LESS 编译产物 vs 提交的 common.css：逐条、逐值对账（压缩写法差异先归一化）
    const norm = (d) => {
        const [prop, ...rest] = d.split(':');
        let v = rest.join(':').trim().replace(/\s+/g, ' ')
            .replace(/(^|[\s(,])0\.(\d)/g, '$1.$2');   // 0.5rem → .5rem（cssnano 的写法）
        return `${prop.trim().toLowerCase()}:${v}`;
    };
    const declsOf = (text, sel) => {
        const body = [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
            .filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel))
            .map((m) => m[2]).join(';');
        return new Set(body.split(';').map((s) => s.trim()).filter(Boolean).map(norm));
    };
    for (const sel of ['.ls-checklist', '.ls-checklist__item', '.ls-checklist__item:hover',
                       '.ls-checklist__item:focus-within', '.ls-checklist__name', '.ls-checklist__empty']) {
        const a = declsOf(compiledOut, sel);
        const b = declsOf(css, sel);
        const same = a.size > 0 && b.size > 0 && a.size === b.size && [...a].every((d) => b.has(d));
        check(`LESS 编译产物与提交的 CSS 一致：${sel}`, same,
            same ? `${a.size} 条` : `编译产物 ${a.size} 条 / 提交 css ${b.size} 条；` +
                `差异 ${[...a].filter((d) => !b.has(d)).concat([...b].filter((d) => !a.has(d))).join(' | ')}`);
    }
}

// ---------------------------------------------------------------- 汇总
const failed = results.filter((r) => ! r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
