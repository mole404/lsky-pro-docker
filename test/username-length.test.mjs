#!/usr/bin/env node
/**
 * 用户名长度规则（1-20 字符、首尾空白裁切、纯空白拒绝、文案）的静态 tripwire。
 *
 * 三个入口必须同口径，缺一处就会出现「注册能过、改名能过、后台改不了」这类不一致：
 *   ① 注册            app/Http/Controllers/Auth/RegisteredUserController.php
 *   ② 个人资料改名     app/Http/Requests/UserSettingRequest.php
 *   ③ 后台编辑用户     app/Http/Requests/Admin/UserRequest.php
 * 三处共用 app/Support/Username.php 里的字符集（EDGE_PATTERN / BLANK_PATTERN），
 * 因此这里同时钉住「三处都调用它」与「它确实覆盖全角空格、NBSP、零宽字符」。
 *
 * 全是文本级断言，不依赖 PHP/Laravel，也不 import 任何 node_modules 包。
 * 运行：node test/username-length.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

const REGISTER_PATH = 'app/Http/Controllers/Auth/RegisteredUserController.php';
const PROFILE_PATH = 'app/Http/Requests/UserSettingRequest.php';
const ADMIN_PATH = 'app/Http/Requests/Admin/UserRequest.php';
const HELPER_PATH = 'app/Support/Username.php';

const REGISTER = read(REGISTER_PATH);
const PROFILE = read(PROFILE_PATH);
const ADMIN = read(ADMIN_PATH);
const HELPER = read(HELPER_PATH);

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}
const section = (name) => console.log(`\n[${name}]`);

const lines = (text) => text.split('\n');
const lineWith = (text, needle) => lines(text).find((l) => l.includes(needle)) || '';
const indexOf = (text, needle) => (text.includes(needle) ? text.indexOf(needle) : -1);
// 只认「数组键形式」的规则行：$request->merge(['name' => ...]) 不是规则，要排除掉
const nameRuleLine = (text) => (text.match(/^[ \t]*'name' =>[^\n]*/m) || [''])[0];
// 只认 const 声明行，避免命中注释里提到的常量名
const constLine = (text, name) =>
    lines(text).find((l) => new RegExp(`^[ \\t]*(public )?const ${name} =`).test(l)) || '';
const MESSAGE = '名称必须在 1-20 个字符之间';

section('三处 name 规则都收窄为 1-20 字符');
{
    const sites = [
        ['注册', REGISTER],
        ['个人资料', PROFILE],
        ['后台编辑用户', ADMIN],
    ];
    for (const [label, text] of sites) {
        const rule = nameRuleLine(text);
        check(`${label}：name 规则含 between:1,20`, rule.includes("'between:1,20'"), rule.trim());
        check(`${label}：name 规则仍是数组形式（含逗号的正则参数不会被管道符切碎）`,
            /'name'\s*=>\s*\[/.test(text) && !/'name'\s*=>\s*'required\|/.test(text));
        check(`${label}：name 规则只有一个上下限`, (text.match(/between:1,20/g) || []).length === 1,
            `count=${(text.match(/between:1,20/g) || []).length}`);
        check(`${label}：name 规则要求 string（between 才能按字符数计）`, rule.includes("'string'"));
    }
}

section('全仓 src/ 下再没有 between:2,20 作用在 name 上');
{
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
                walk(full);
            } else if (entry.name.endsWith('.php')) {
                lines(fs.readFileSync(full, 'utf8')).forEach((line, i) => {
                    if (/'name'\s*=>/.test(line) && /between:2,20/.test(line)) {
                        offenders.push(`${path.relative(SRC, full)}:${i + 1}`);
                    }
                });
            }
        }
    };
    walk(SRC);
    check('没有 name 规则还在用 between:2,20', offenders.length === 0, offenders.join(', ') || '无');
    check('整仓 src/ 里 between:2,20 字面量已清零',
        [REGISTER, PROFILE, ADMIN].every((t) => !/between:2,20/.test(t)));
}

section('提示文案统一为「名称必须在 1-20 个字符之间」');
{
    check('个人资料：name.between 文案已改为 1-20',
        lineWith(PROFILE, "'name.between'") .includes(MESSAGE) ||
        PROFILE.includes(`'name.between' => '${MESSAGE}'`));
    check('后台编辑用户：name.between 文案已改为 1-20',
        ADMIN.includes(`'name.between' => '${MESSAGE}'`));
    check('注册：补上了同一条 name.between 文案',
        REGISTER.includes(`'name.between' => '${MESSAGE}'`));
    check('三处都不再出现 2-20 的旧文案',
        [REGISTER, PROFILE, ADMIN].every((t) => !/2-20/.test(t)));
    check('三处都有纯空白拒绝的提示 key（name.not_regex）',
        [REGISTER, PROFILE, ADMIN].every((t) => t.includes("'name.not_regex'")));
}

section('注册处不再用 max:255，email 的 255 保留');
{
    const nameRule = nameRuleLine(REGISTER);
    const emailRule = lineWith(REGISTER, "'email' =>");
    check('注册 name 规则里没有 max:255', !nameRule.includes('max:255'), nameRule.trim());
    check('注册 email 规则仍保留 max:255', emailRule.includes('max:255'), emailRule.trim());
    check('注册 name 规则不再单独放宽到 255', !/'name'\s*=>[^\n]*255/.test(REGISTER));
    check('email 的 unique 校验没被顺手改动', emailRule.includes("'unique:users'"));
}

section('三处都在校验前裁空白，并拒绝纯空白');
{
    check('注册：validate 之前先 merge 规范化后的 name',
        indexOf(REGISTER, '$request->merge([\'name\' => Username::normalize(') >= 0 &&
        indexOf(REGISTER, '$request->merge([\'name\' => Username::normalize(') < indexOf(REGISTER, '$request->validate(['));
    check('个人资料：prepareForValidation 里调用 normalize，且位于 rules() 之前',
        indexOf(PROFILE, 'prepareForValidation') >= 0 &&
        indexOf(PROFILE, 'prepareForValidation') < indexOf(PROFILE, 'public function rules()'));
    check('后台编辑用户：prepareForValidation 里调用 normalize，且位于 rules() 之前',
        indexOf(ADMIN, 'prepareForValidation') >= 0 &&
        indexOf(ADMIN, 'prepareForValidation') < indexOf(ADMIN, 'public function rules()'));

    const trimStmt = "$this->merge(['name' => Username::normalize($this->input('name'))]);";
    check('个人资料：裁空白语句与另一处 FormRequest 完全一致', PROFILE.includes(trimStmt));
    check('后台编辑用户：裁空白语句与另一处 FormRequest 完全一致', ADMIN.includes(trimStmt));
    check('注册：注册用的是 Request，规范化同一份 helper（未另写一套）',
        REGISTER.includes('Username::normalize($request->input(\'name\'))'));

    const sites = [['注册', REGISTER], ['个人资料', PROFILE], ['后台编辑用户', ADMIN]];
    for (const [label, text] of sites) {
        check(`${label}：name 规则挂了 not_regex + BLANK_PATTERN`, /'not_regex:'\s*\.\s*Username::BLANK_PATTERN/.test(text));
        check(`${label}：import 了 App\\Support\\Username`, /use App\\Support\\Username;/.test(text));
    }
}

section('Username helper 的字符集覆盖多字节空白');
{
    const edgeDecl = constLine(HELPER, 'EDGE_PATTERN');
    const blankDecl = constLine(HELPER, 'BLANK_PATTERN');
    check('两个 pattern 的 const 声明都在', edgeDecl !== '' && blankDecl !== '');
    check('两个 pattern 都带 /u 修饰符（按字符而非字节匹配）',
        edgeDecl.endsWith("/u';") && blankDecl.endsWith("/u';"),
        `${edgeDecl.slice(-5)} / ${blankDecl.slice(-5)}`);
    for (const [label, esc] of [
        ['ASCII 空白 \\s', '\\s'],
        ['全角空格 U+3000', '\\x{3000}'],
        ['NBSP U+00A0', '\\x{00A0}'],
        ['U+2000–U+200B 区间的空格与零宽字符', '\\x{2000}-\\x{200B}'],
        ['BOM/零宽 U+FEFF', '\\x{FEFF}'],
    ]) {
        check(`两个 pattern 都显式包含 ${label}`, edgeDecl.includes(esc) && blankDecl.includes(esc),
            `edge=${edgeDecl.includes(esc)} blank=${blankDecl.includes(esc)}`);
    }
    check('EDGE_PATTERN 只裁两端（首尾各一组字符类，中间用 | 分开）',
        edgeDecl.includes("'/^[") && edgeDecl.includes('|') && edgeDecl.includes('+$'));
    check('BLANK_PATTERN 用 * 允许空串（required 失败时优先报「不能为空」）',
        blankDecl.includes("'/^[") && blankDecl.includes('*$'));
    check('BLANK_PATTERN 不含 | （作为规则参数拼接时不会被误读）', !blankDecl.includes('|'), blankDecl.trim());
    check('helper 对非字符串原样返回（交给 string 规则报类型错）',
        HELPER.includes('if (! is_string($value))') && HELPER.includes('return $value;'));

    // 把 PHP 字符类翻译成 JS 正则，验证「全角空格 / NBSP / 零宽」确实被判为纯空白
    const cls = blankDecl.match(/\[[^\]]+\]/)[0]
        .replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, hex) => '\\u{' + hex.toLowerCase() + '}');
    const blank = new RegExp('^' + cls + '*$', 'u');
    const edge = new RegExp('^' + cls + '+|' + cls + '+$', 'gu');
    const CASES = [
        ['半角空格', '   ', true],
        ['全角空格', '　　', true],
        ['NBSP', '\u00A0\u00A0', true],
        ['零宽字符', '\u200B', true],
        ['BOM', '\uFEFF', true],
        ['空串', '', true],
        ['单个汉字', '名', false],
        ['汉字加全角空格', '名　', false],
    ];
    for (const [label, value, expected] of CASES) {
        check(`纯空白判定：${label} → ${expected ? '拒绝' : '放行'}`, blank.test(value) === expected);
    }
    check('两端裁切：全角空格 / NBSP / 半角空格混排只剩名称本体',
        '　 name \u00A0'.replace(edge, '') === 'name',
        JSON.stringify('　 name \u00A0'.replace(edge, '')));
    check('两端裁切不动中间的空格', ' a b '.replace(edge, '') === 'a b',
        JSON.stringify(' a b '.replace(edge, '')));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
