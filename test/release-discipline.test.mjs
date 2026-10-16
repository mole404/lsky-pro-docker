#!/usr/bin/env node
/**
 * 发布纪律与「踩过的坑」的静态 tripwire。
 *
 * 这里守的不是业务功能，而是三类**只能在发布链路上出事**的规则：
 *   ① 镜像指纹：改了 app/ resources/ public/ 却不算进 .code-revision，就会出现「镜像看着是新的、
 *      里面其实是旧模板」；find/sort 不钉 LC_ALL=C 则排序随 locale 变，同一份源码算出两个指纹。
 *   ② CI 纪律：paths-ignore 写 '**.md' 会把 src/ 下真进镜像的 md 一起忽略；两个零依赖 PHP 测试
 *      （zip 写入器 / 导出并发表）必须留在流水线里，且 concat 顺序不能错（首文件必须带 <?php）。
 *   ③ 导出后端与用量统计里几条**安全/一致性契约**：导出只能查自己的图、占位判定必须在写响应头之前、
 *      归档内文件名净化要覆盖路径分隔符、条目名 trim 口径必须与 zip 写入器一致（否则重名去重会错开）、
 *      临时流必须是 php://memory（php://temp 超 2MB 会溢写到容器 /tmp，而导出要求零落盘）。
 *
 * 全是文本级断言，不依赖 PHP/Laravel。运行：node test/release-discipline.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');          // 仓库根：Dockerfile / .github / test
const srcRoot = path.join(repoRoot, 'src');         // Laravel 根：app / routes / resources / public
const read = (p) => fs.readFileSync(path.join(srcRoot, p), 'utf8');
const readRepo = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

let pass = 0;
let fail = 0;
const assert = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? '  → ' + detail : ''}`); }
};
const section = (name) => console.log(`\n[${name}]`);

const DOCKERFILE = readRepo('Dockerfile');
const WORKFLOW = readRepo('.github/workflows/build-image.yaml');
const ROUTES = read('routes/web.php');
const CONTROLLER = read('app/Http/Controllers/User/ExportController.php');
const WRITER = read('app/Support/StreamedZipWriter.php');
const USAGE = read('app/Support/StorageUsage.php');
const lines = (text) => text.split('\n');
const lineOf = (text, needle) => lines(text).findIndex((l) => l.includes(needle));
const lineIndexOf = (text, needle) => {
    const i = text.indexOf(needle);
    return i < 0 ? -1 : text.slice(0, i).split('\n').length;
};

/* ── ① 镜像指纹 ─────────────────────────────────────────────────────────────── */
section('镜像指纹（Dockerfile）');
assert((DOCKERFILE.match(/LC_ALL=C find/g) || []).length >= 3,
    'app/config/routes、resources、public 三处哈希都钉了 LC_ALL=C（否则指纹随 locale 漂）',
    `实际 ${(DOCKERFILE.match(/LC_ALL=C find/g) || []).length} 处`);
['app config routes', 'resources', 'public'].forEach((tree) => {
    assert(new RegExp(`LC_ALL=C find ${tree} `).test(DOCKERFILE), `${tree} 被算进指纹`);
});
assert(/RESOURCES_MD5=/.test(DOCKERFILE) && /PUBLIC_MD5=/.test(DOCKERFILE), 'resources/public 各算一份 md5');
assert(/"resources_md5=\$\{RESOURCES_MD5\}"/.test(DOCKERFILE) && /"public_md5=\$\{PUBLIC_MD5\}"/.test(DOCKERFILE),
    '.code-revision 里确实写了 resources_md5 / public_md5（改了模板能看出来）');
assert(/\[ -n "\$RESOURCES_MD5" \] \|\| RESOURCES_MD5=none/.test(DOCKERFILE),
    '目录为空时有 none 兜底，不会写进空串');

// 钉的真实写法：RUN printf '%s\n' 里每行 'hash  ./path'（有缩进，行尾还有续行反斜杠）
const pinPairs = lines(DOCKERFILE).map((l) => l.match(/'([0-9a-f]{32}) {2}(\.\/[^']+)'/)).filter(Boolean).map((m) => ({ md5: m[1], file: m[2] }));
assert(pinPairs.length >= 9, `Dockerfile 里的 md5 钉住（文件: 哈希）共 ${pinPairs.length} 条，且哈希都是完整 32 位`);
assert(pinPairs.every((p) => p.file.trim().length > 0), '每条钉都带文件路径');
assert((DOCKERFILE.match(/md5sum -c -/g) || []).length >= 4, 'md5 校验步骤还在（>= 4 处 md5sum -c）');

/* ── ② CI 纪律 ─────────────────────────────────────────────────────────────── */
section('CI 纪律（build-image.yaml）');
assert(/- '\*\.md'/.test(WORKFLOW), "paths-ignore 用的是根目录一级 '*.md'");
assert(!/- '\*\*\.md'/.test(WORKFLOW), "paths-ignore 里没有 '**.md'（那会连 src/ 下真进镜像的 md 一起忽略）");
assert(/cache: npm/.test(WORKFLOW), 'node 依赖开了 npm 缓存');

const zipStep = "{ cat src/app/Support/StreamedZipWriter.php; tail -n +2 test/php/zip-writer.test.php; } | php /dev/stdin";
assert(WORKFLOW.includes(zipStep), 'zip 写入器的零依赖测试仍在流水线里');
const concStep = "{ cat test/php/export-concurrency.stubs.php; tail -n +2 src/app/Support/ExportConcurrency.php; tail -n +2 test/php/export-concurrency.test.php; } | php /dev/stdin";
assert(WORKFLOW.includes(concStep), '导出并发表的零依赖测试在流水线里，且 concat 顺序正确（首文件带 <?php）');
assert(!WORKFLOW.includes('cat test/php/export-concurrency.stubs.php src/app/Support/ExportConcurrency.php'),
    '没有留下「类源码夹在中间」的错误 concat 写法（那样是 Parse error）');
['test/php/export-concurrency.stubs.php', 'test/php/export-concurrency.test.php', 'test/sidebar-capacity.test.mjs',
    'test/images-page-hardening.test.mjs', 'test/release-discipline.test.mjs']
    .forEach((f) => assert(fs.existsSync(path.join(repoRoot, f)), `${f} 在仓库里（CI 找不到文件会直接红）`));

/* ── ③ 导出后端契约 ─────────────────────────────────────────────────────────── */
section('导出后端契约（安全 / 一致性）');
assert(CONTROLLER.includes('$user->images()->filter($request)'),
    '导出查询挂在 $user->images() 上（不是 Image::query()：否则能导出别人的图）');
assert(!/Image::query\(\)/.test(CONTROLLER) && !/\bImage::where\(/.test(CONTROLLER),
    '导出控制器里没有绕过用户范围的 Image 查询');

const acquireLine = lineIndexOf(CONTROLLER, 'ExportConcurrency::acquire');
const headerLine = lineIndexOf(CONTROLLER, "'X-Accel-Buffering'");
assert(acquireLine > 0 && headerLine > 0 && acquireLine < headerLine,
    '占位判定在写响应头之前（被拒的请求不会先发 200 再断流）', `acquire@${acquireLine} headers@${headerLine}`);

assert(/'X-Accel-Buffering'\s*=>\s*'no'/.test(CONTROLLER), '响应带 X-Accel-Buffering: no（反代不缓冲，边压边发）');
assert(/Cache-Control.*no-store/.test(CONTROLLER), '响应不可缓存');
assert(/attachment; filename=/.test(CONTROLLER) && /filename\*=UTF-8''/.test(CONTROLLER), '中文文件名走 RFC 5987 双写');

{
    const sanitizeLine = lines(CONTROLLER).find((l) => l.includes('str_replace([')) || '';
    // PHP 源码里那个数组首项是两个字符：反斜杠 + 反斜杠（表示一个反斜杠）
    assert(sanitizeLine.includes("'\\\\'") && sanitizeLine.includes("'/'"),
        '归档内文件名净化把路径分隔符（\\ 与 /）一并换成 _（防止 ../../ 之类的名字把条目写出根目录）',
        sanitizeLine.trim().slice(0, 120));
}
assert(/preg_replace\('\/\[\\x00-\\x1F\\x7F\]\/u'/.test(CONTROLLER), '控制字符被剥掉');
assert(/#\^\\\.\+\$#/.test(CONTROLLER), '纯点号（. / ..）被收成 _');
assert(CONTROLLER.includes('trim($this->sanitize('),
    '条目名 trim 口径与 zip 写入器一致（否则重名去重与磁盘上的名字会错开）');

assert(/php:\/\/memory/.test(WRITER), '压缩用的临时流是 php://memory');
{
    const tempCodeLines = lines(WRITER).filter((l) => /php:\/\/temp/.test(l)
        && !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert(tempCodeLines.length === 0, '代码里没有用 php://temp（超 2MB 会溢写到容器 /tmp，导出要求零落盘）',
        tempCodeLines.join(' | ').slice(0, 120));
    assert(lines(WRITER).some((l) => /php:\/\/temp/.test(l)), '注释里保留了「为什么不用 php://temp」的原因');
}

const exportRoutes = lines(ROUTES).filter((l) => l.includes('ExportController::class'));
assert(exportRoutes.length === 4, `导出路由 4 条（实际 ${exportRoutes.length}）`);
assert(exportRoutes.every((l) => !l.includes('{')), '导出路由都不带路由参数（不会被 /user/images/{id} 抢走）');
const authGroup = lineOf(ROUTES, "Route::group(['middleware' => ['auth']]");
assert(authGroup > 0 && exportRoutes.every((l) => lineOf(ROUTES, l) > authGroup), '导出路由都在 auth 组内');

/* ── ④ 用量统计兜底 ─────────────────────────────────────────────────────────── */
section('存储用量统计（StorageUsage）');
assert(USAGE.includes('未指定策略'), "strategy_id=0 有「未指定策略」兜底（不然侧栏显示空名）");
assert(/策略 #/.test(USAGE), '查不到名字的策略仍给出 `策略 #id` 兜底（数据库里删了策略也不会崩）');
assert(USAGE.includes('array_diff(array_keys($buckets), array_keys($names))'),
    '只为缺失的名字补一次查询（已有的名字不重复查）');

/* ── ⑤ 扫描目录排除 ─────────────────────────────────────────────────────────── */
section('测试自身（扫描目录排除）');
const uiTweaks = fs.readFileSync(path.join(here, 'ui-tweaks.test.mjs'), 'utf8');
assert(/node_modules/.test(uiTweaks) && /vendor/.test(uiTweaks) && /\.git/.test(uiTweaks),
    '仓库扫描类测试排掉了 node_modules / vendor / .git（否则 CI 里会扫进依赖树）');

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
