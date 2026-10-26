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
 *      归档内文件名净化要覆盖路径分隔符、条目名归一化必须复用 zip 写入器那一个函数（否则重名去重会错开）、
 *      包内索引流必须带 maxmemory 上限（裸 php://temp 超 2MB 就溢写到容器 /tmp，而导出要求零落盘；
 *      裸 php://memory 在超大 manifest 下又可能 OOM ⇒ 两者折中成 php://temp/maxmemory:32M）。
 *   ④ 指纹的命令形态：`xargs -0 -r md5sum | md5sum`（把文件名也哈希进去）。写成 `xargs -0 -r cat`
 *      时，重命名文件或新增空文件都不改变指纹 ⇒ 只增不删的卷同步会让老卷拿着旧名字。
 *
 * 全是文本级断言，不依赖 PHP/Laravel。运行：node test/release-discipline.test.mjs
 */
import crypto from 'node:crypto';
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
const IMAGE_MODEL = read('app/Models/Image.php');
const lines = (text) => text.split('\n');
const lineOf = (text, needle) => lines(text).findIndex((l) => l.includes(needle));
const lineIndexOf = (text, needle) => {
    const i = text.indexOf(needle);
    return i < 0 ? -1 : text.slice(0, i).split('\n').length;
};

/* ── ① 镜像指纹 ─────────────────────────────────────────────────────────────── */
section('镜像指纹（Dockerfile）');
assert((DOCKERFILE.match(/LC_ALL=C find/g) || []).length >= 3,
    'app/config/routes+lang、resources、public 三处哈希都钉了 LC_ALL=C（否则指纹随 locale 漂）',
    `实际 ${(DOCKERFILE.match(/LC_ALL=C find/g) || []).length} 处`);
['app config routes lang', 'resources', 'public'].forEach((tree) => {
    assert(new RegExp(`LC_ALL=C find ${tree} `).test(DOCKERFILE), `${tree} 被算进指纹`);
});
assert(/RESOURCES_MD5=/.test(DOCKERFILE) && /PUBLIC_MD5=/.test(DOCKERFILE), 'resources/public 各算一份 md5');
assert(/"resources_md5=\$\{RESOURCES_MD5\}"/.test(DOCKERFILE) && /"public_md5=\$\{PUBLIC_MD5\}"/.test(DOCKERFILE),
    '.code-revision 里确实写了 resources_md5 / public_md5（改了模板能看出来）');
assert(/"app_src_md5=\$\{APP_SRC_MD5\}"/.test(DOCKERFILE), 'lang/ 与 app/ 一起进了 app_src_md5（用户可见文案也是行为）');
assert(/\[ -n "\$RESOURCES_MD5" \] \|\| RESOURCES_MD5=none/.test(DOCKERFILE),
    '变量为空时有 none 兜底（注意：空目录不算失败 —— 空输入的 md5 是常量 d41d8cd9…）');
assert(!/xargs -0 -r cat/.test(DOCKERFILE) && (DOCKERFILE.match(/xargs -0 -r md5sum/g) || []).length >= 3,
    '三处指纹都是 `xargs md5sum | md5sum`（把文件名一起哈希，否则改名/新增空文件指纹不变）',
    `cat 写法 ${(DOCKERFILE.match(/xargs -0 -r cat/g) || []).length} 处、md5sum 写法 ${(DOCKERFILE.match(/xargs -0 -r md5sum/g) || []).length} 处`);

// 续行纪律：shell 里 `\` 后面**不能**跟空格（那条命令会被拆开，另一半变成一行垃圾。
// 这个坑真踩过：`md5sum -c - \    | md5sum` 之类会让 .code-revision 多出一行 ` $`，
// 而 buildkit 只警告不报错 ⇒ 构建照绿。）所以这里是纯文本的硬约束。
assert(!/\\[ \t]+\S/.test(DOCKERFILE), 'Dockerfile 里没有「反斜杠 + 空格 + 同行内容」的坏续行',
    (DOCKERFILE.match(/[^\n]*\\[ \t]+\S[^\n]*/) || [])[0]?.trim().slice(0, 100));
assert(!/\\[ \t]+\n/.test(DOCKERFILE), 'Dockerfile 里没有「反斜杠 + 尾随空格」的坏续行');

// 钉的真实写法：RUN printf '%s\n' 里每行 'hash  ./path'（有缩进，行尾还有续行反斜杠）
const pinPairs = lines(DOCKERFILE).map((l) => l.match(/'([0-9a-f]{32}) {2}(\.\/[^']+)'/)).filter(Boolean).map((m) => ({ md5: m[1], file: m[2] }));
assert(pinPairs.length >= 9, `Dockerfile 里的 md5 钉住（文件: 哈希）共 ${pinPairs.length} 条，且哈希都是完整 32 位`);
assert(pinPairs.every((p) => p.file.trim().length > 0), '每条钉都带文件路径');
assert((DOCKERFILE.match(/md5sum -c -/g) || []).length >= 4, 'md5 校验步骤还在（>= 4 处 md5sum -c）');

// 真验一遍：钉住的文件必须存在、且内容 md5 与钉的一致。
// 之前只查「条数 ≥ 9 且形状像 md5」⇒ 改了被钉住的文件却忘了换哈希时，CI 照样绿，
// 等到构建时才在 `md5sum -c -` 那步红（白等十几分钟，而且这行本来就是拿来防手改的）。
pinPairs.forEach(({ md5, file }) => {
    const abs = path.join(srcRoot, file.replace(/^\.\//, ''));
    if (!fs.existsSync(abs)) { assert(false, `钉住的文件存在：${file}`, '文件不在 src/ 下'); return; }
    const got = crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex');
    assert(got === md5, `钉住的哈希与文件一致：${file}`, `钉 ${md5.slice(0, 8)}… / 实际 ${got.slice(0, 8)}…`);
});

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

// 先剥掉注释行：注释里提到方法名会把「第一次出现」的位置带偏（顺序断言就白做了）
const controllerCode = CONTROLLER.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const acquireLine = lineIndexOf(controllerCode, 'ExportConcurrency::acquire');
const headerLine = lineIndexOf(controllerCode, "'X-Accel-Buffering'");
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
// 条目名归一化必须**复用写入器那一个函数**：控制器自己再洗一遍就会分叉
// （历史坑：控制器把 `相册A/. . .` 洗成 `相册A/.`，而写入器把「只剩点号」的段整段丢掉
//  ⇒ 两个不同的去重键写出同一个条目名，解压时后者覆盖前者，用户静默丢图）。
assert(/public static function normalizeName\(/.test(WRITER),
    'StreamedZipWriter::normalizeName() 是 public static（控制器算去重键要调它）');
assert(CONTROLLER.includes('StreamedZipWriter::normalizeName('),
    '导出控制器的去重键用的是写入器的同一个归一化函数');
{
    const entry = CONTROLLER.slice(CONTROLLER.indexOf('private function entryName'));
    const body = entry.slice(0, entry.indexOf('\n    }'));
    const assigns = body.split('\n').filter((l) => /\$name\s*=/.test(l) && !/\$name\s*=\s*=/.test(l));
    assert(assigns.length >= 2 && assigns.every((l) => l.includes('StreamedZipWriter::normalizeName(')),
        'entryName() 里给 $name 的每一处赋值都过了一遍归一化（没有「直接拼名字」的旁路）',
        assigns.map((l) => l.trim()).join(' | ').slice(0, 160));
    assert(/#\^\\\.\+\$#/.test(CONTROLLER) && CONTROLLER.includes("trim($value, '.')"),
        '控制器自身的清洗仍在（控制字符/分隔符/纯点号），最后交给归一化函数收口');
}

// 包内索引流：必须带 maxmemory 上限。
//   裸 php://temp：超 2MB 就溢写到容器 /tmp ⇒ 违反「零落盘」；
//   裸 php://memory：超大 manifest（约 20 万张图）内存里同时留着拼好的串与这份缓冲 ⇒ 可能 OOM。
{
    const openLine = lines(WRITER).find((l) => /fopen\(.*maxmemory/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) || '';
    const m = openLine.match(/maxmemory:(\d+)/);
    assert(!!m && Number(m[1]) >= 16 * 1024 * 1024,
        '包内索引流用 php://temp/maxmemory（上限 ≥ 16MiB：小包全程在内存，超了才溢写）', openLine.trim().slice(0, 120));
    const bareCode = lines(WRITER).filter((l) => /php:\/\/(memory|temp)'/.test(l)
        && !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert(bareCode.length === 0, '代码里没有裸 php://memory / php://temp 写法（无上限的那种）',
        bareCode.join(' | ').slice(0, 120));
}

// 上传完成面板把 links()['html'] 当 HTML 插进页面（.append()），而 origin_name 是用户可控的原始文件名
// ⇒ 属性值必须先 e() 转义，否则名字里一个双引号就能闭合 alt 注进 <img onerror=（自伤型 XSS）。
{
    const htmlLine = lines(IMAGE_MODEL).find((l) => l.includes("'html' =>")) || '';
    const escapes = (htmlLine.match(/e\(\$this->origin_name\)/g) || []).length;
    assert(escapes === 2 && !/\{\$this->origin_name\}/.test(htmlLine),
        'links.html 的 alt/title 两处 origin_name 都走了 e() 转义（没有裸插）',
        `转义 ${escapes} 处；行：${htmlLine.trim().slice(0, 110)}`);
    assert(/"!\[\{\$this->origin_name\}\]\(\{\$this->url\}\)"/.test(IMAGE_MODEL),
        'markdown 那份仍用原始名（复制粘贴用，不需要 HTML 转义）—— 改动别把这条也带上');
}

const exportRoutes = lines(ROUTES).filter((l) => l.includes('ExportController::class'));
assert(exportRoutes.length === 4, `导出路由 4 条（实际 ${exportRoutes.length}）`);
assert(exportRoutes.every((l) => !l.includes('{')), '导出路由都不带路由参数（不会被 /user/images/{id} 抢走）');
// 登录组现在挂两个中间件（auth + verified.if-required），按前缀匹配，别钉死整串
const authGroupLine = lines(ROUTES).find((l) => /Route::group\(\['middleware' => \['auth'/.test(l)) || '';
const authGroup = authGroupLine ? lineOf(ROUTES, authGroupLine) : -1;
assert(authGroup > 0 && exportRoutes.every((l) => lineOf(ROUTES, l) > authGroup), '导出路由都在 auth 组内');

/* ── ④ 用量统计兜底 ─────────────────────────────────────────────────────────── */
section('存储用量统计（StorageUsage）');
assert(USAGE.includes("'未指定策略'"), "strategy_id=0 有「未指定策略」兜底（不然侧栏显示空名）");
assert(USAGE.includes("'策略 #'"), '查不到名字的策略仍给出 `策略 #id` 兜底（数据库里删了策略也不会崩）');
assert(USAGE.includes('array_diff(array_keys($buckets), array_keys($names))'),
    '只为缺失的名字补一次查询（已有的名字不重复查）');

/* ── ⑤ 扫描目录排除 ─────────────────────────────────────────────────────────── */
section('测试自身（扫描目录排除）');
const uiTweaks = fs.readFileSync(path.join(here, 'ui-tweaks.test.mjs'), 'utf8');
// 钉住「遍历时真的跳过了这三个目录」，而不是「文件里出现过这三个词」
// （旧写法里 node_modules 只出现在 lessc 的路径拼接上，断言照样绿）
assert(/\[\s*'node_modules',\s*'vendor',\s*'\.git'\s*\]\s*\.includes\(e\.name\)/.test(uiTweaks),
    '仓库遍历里显式跳过了 node_modules / vendor / .git（否则 CI 会扫进依赖树）');

/* ── ⑥ 流水线里真的跑了行为测试 ────────────────────────────────────────────── */
section('CI 行为测试步骤');
{
    const stepStart = WORKFLOW.indexOf('Behavior tests (jsdom)');
    const stepBody = stepStart < 0 ? '' : WORKFLOW.slice(stepStart, WORKFLOW.indexOf('\n      - name:', stepStart + 10));
    assert(stepStart > 0 && /cd test/.test(stepBody), 'CI 里有跑 jsdom 行为测试的步骤');
    assert(/npm ci/.test(stepBody) && /npm test/.test(stepBody),
        '那一步真的执行了 npm ci + npm test（只写个名字不算数）',
        stepBody.replace(/\s+/g, ' ').trim().slice(0, 140));
}

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
