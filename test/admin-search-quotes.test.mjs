/*
 * 后台「图片管理」高级搜索：双引号包裹的值 + 关键字 OR 逃逸 的静态契约测试。
 *
 * 纯 node:fs 静态断言，不起 PHP、不连库 —— 只锁住三件事的源码形状：
 *   1. 分词对引号敏感（`strategy:"AWS S3"` 不被空格切开）；
 *   2. 限定符的值按首个冒号切分，并剥掉外层双引号；
 *   3. 裸关键字的 orWhere 被包进闭包，不能与限定符条件平铺在同一布尔层级。
 * 外加搜索语法说明里的双引号提示与 strategy 示例。
 *
 * 运行：node admin-search-quotes.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const controller = read('app', 'Http', 'Controllers', 'Admin', 'ImageController.php');
const blade = read('resources', 'views', 'admin', 'image', 'index.blade.php');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${!pass && detail ? '  → ' + detail : ''}`);
}

// 去掉 PHP 注释再看代码，避免注释里写的「原来是 explode(' ', ...)」这类说明把断言带偏。
const controllerCode = controller
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const fail = (label) => `未找到 ${label}`;

console.log('[1] 分词：引号感知');
{
    check('ImageController 用 preg_match_all 分词',
        controllerCode.includes('preg_match_all('),
        fail('preg_match_all'));

    check('分词模式里带 "[^"]*" 这一支（引号内的空格不切）',
        controllerCode.includes('"\\S+:\\"[^\\"]*\\"|\\S+"') || controllerCode.includes('"[^"]*"'),
        fail('"[^"]*"'));

    check('不再按空格硬切（explode(\' \', $keywords) 已消失）',
        !controllerCode.includes("explode(' ', $keywords)"),
        '仍有 explode(\' \', $keywords)');

    check('分词仍以 $matched[0] 作为 token 来源',
        controllerCode.includes('$matched[0]'),
        fail('$matched[0]'));
}

console.log('\n[2] 值切分与去引号');
{
    check("explode(':', $filter, 2) —— 值里允许出现冒号",
        controllerCode.includes("explode(':', $filter, 2)"),
        fail("explode(':', $filter, 2)"));

    check('值两端的双引号会被剥掉',
        controllerCode.includes('substr($value, 1, -1)'),
        fail('substr($value, 1, -1)'));

    check('剥引号受「以双引号开头且以双引号结尾」双重保护',
        /Str::startsWith\(\$value,\s*'"'\)/.test(controllerCode)
        && /Str::endsWith\(\$value,\s*'"'\)/.test(controllerCode),
        '缺少 startsWith/endsWith 保护');

    check('空值仍走 if ($value) 跳过（order:/is: 匹配分支语义未改）',
        controllerCode.includes('if ($value) {')
        && controllerCode.includes("'order:earliest' => $builder->orderBy('created_at')"),
        '限定符分支形状变了');
}

console.log('\n[3] 关键字 OR 不得逃逸');
{
    check('orWhere 挂在闭包的 $q 上，而不是最外层 $builder',
        // 修复 LIKE 元字符转义后，这三条改成 Like::orWhereContains($q, …)（内部就是
        // $q->orWhereRaw(…)，带显式 ESCAPE 子句）。判据跟着换成「$q 必须是第一个实参」，
        // 守的东西没变：OR 组仍挂在闭包自己的 builder 上，不会与限定符条件平铺。
        controllerCode.includes('Like::orWhereContains($q,') && ! /->orWhere\(/.test(controllerCode),
        fail('Like::orWhereContains($q, …)'));

    check('关键字组被 where(function (Builder $q) 包住',
        controllerCode.includes('$builder->where(function (Builder $q) use ($words)'),
        fail('$builder->where(function (Builder $q) use ($words)'));

    check('最外层不再出现 $builder->where(\'name\')->orWhere 的平铺写法',
        !/\$builder->where\('name',\s*'like'/.test(controllerCode),
        '仍有关键字条件直接挂在外层');

    // 顺序断言：闭包必须出现在限定符 each() 之后，避免把限定符一起包进 OR 组。
    const packAt = controllerCode.indexOf('$builder->where(function (Builder $q) use ($words)');
    const eachAt = controllerCode.indexOf('->each(function ($filter) use ($builder)');
    check('包闭包的位置在限定符 each() 之后（限定符不会被卷进 OR 组）',
        packAt > -1 && eachAt > -1 && packAt > eachAt,
        `packAt=${packAt} eachAt=${eachAt}`);
}

console.log('\n[4] 搜索语法说明');
{
    const tpl = (blade.match(/id="search-grammar-tpl"[\s\S]*?<\/script>/) || [''])[0];
    check('取到了 search-grammar-tpl 段', tpl.length > 0, fail('search-grammar-tpl'));

    check('说明里提到「值里含空格时用双引号包住」',
        tpl.includes('双引号') && tpl.includes('空格'),
        fail('双引号说明'));

    check('strategy 一行的示例列有 strategy:"Cloudflare R2"',
        tpl.includes('strategy:"Cloudflare R2"'),
        fail('strategy:"Cloudflare R2"'));

    check('示例旁不再带「请替换成自己的策略名」这类旁注',
        ! /替换成自己的策略名/.test(tpl),
        '仍残留「（示例，请替换成自己的策略名）」');
}

console.log('\n[5] LIKE 元字符转义（后台图片搜索 + 后台用户列表共用）');
{
    const like = read('app', 'Support', 'Like.php');
    const userController = read('app', 'Http', 'Controllers', 'Admin', 'UserController.php');
    const userCode = userController.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    check('转义工具在 app/Support/Like.php', like.includes('final class Like'), fail('final class Like'));

    check('escape() 把 \\ % _ 三个元字符换成带转义符的字面量',
        like.includes(String.raw`['\\', '%', '_']`) && like.includes(String.raw`['\\\\', '\\%', '\\_']`),
        fail("str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], …)"));

    check('反斜杠第一个换（否则后面换出的 \\% 会被再翻一倍）',
        like.indexOf(String.raw`['\\', '%', '_']`) < like.indexOf(String.raw`['\\\\', '\\%', '\\_']`),
        '替换顺序不对');

    check('ESCAPE 子句是显式写出来的（SQLite 没有默认转义符，靠 where(...,\'like\',?) 拼不出来）',
        like.includes("' like ? '") && like.includes('whereRaw(') && like.includes('orWhereRaw('));

    {
        check('MySQL 用 escape \'\\\\\'（SQL 文本两个字面反斜杠 = 一个字符；写 \'\\\' 会把引号吃掉）',
            like.includes(String.raw`? "escape '\\\\'"`), fail(String.raw`? "escape '\\\\'"`));
        check('SQLite / PostgreSQL 用 escape \'\\\'（两个字符会被拒：ESCAPE 只接受单字符）',
            like.includes(String.raw`"escape '\\'"`), fail(String.raw`"escape '\\'"`));
    }

    check('后台图片搜索：三处 name/origin_name/alias_name like 都走转义工具',
        (controllerCode.match(/Like::orWhereContains\(\$q, '(name|origin_name|alias_name)', \$word\)/g) || []).length === 3,
        fail('3 处 Like::orWhereContains'));
    check('后台图片搜索：不再有 %{$word}% 裸拼进 like',
        ! /'like',\s*"%\{\$word\}%"/.test(controllerCode), '仍有裸拼的关键字 like');
    check('限定符等值查询不动（extension: 仍是等值）',
        /'extension' => \$builder->where\('extension', \$value\)/.test(controllerCode));

    check('后台用户列表：两个 like 包进闭包（否则 status 被邮箱那一支绕过）',
        /\$builder->where\(function \(Builder \$q\) use \(\$keywords\) \{[\s\S]{0,400}Like::whereContains\(\$q, 'name', \$keywords\);[\s\S]{0,160}Like::orWhereContains\(\$q, 'email', \$keywords\);/.test(userCode),
        fail('$builder->where(function (Builder $q) use ($keywords) …'));
    check('后台用户列表：外层不再有平铺的 orWhere（status=? and name like ? or email like ?）',
        ! /\$builder->where\('name', 'like'.*orWhere\('email', 'like'/.test(userCode)
        && ! /'like',\s*"%\{\$keywords\}%"/.test(userCode),
        '仍有平铺或裸拼的 like');

    // 顺序：闭包必须挂在 status 的 when 之后 —— when 是链式，靠源码顺序即可保证
    const statusAt = userCode.indexOf("$builder->where('status', $status)");
    const groupAt = userCode.indexOf('$builder->where(function (Builder $q) use ($keywords)');
    check('用户列表：status 条件仍在关键字组之前（括号组挂在它后面）',
        statusAt > -1 && groupAt > statusAt, `statusAt=${statusAt} groupAt=${groupAt}`);
}

// ================================================================ 汇总
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? '  → ' + f.detail : ''}`));
}
process.exit(failed.length ? 1 : 0);
