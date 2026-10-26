/*
 * 「有图片的存储策略禁止删除」的静态契约测试。
 *
 * 规则：策略里还有图片就拒绝删除（后端在事务内复查图片数，前端有图时只弹提示不发请求），
 * 且不再把该策略下图片的 strategy_id 置 null（那是绕过新规则的口子）。
 *
 * 运行：node test/strategy-delete-guard.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const controller = read('app', 'Http', 'Controllers', 'Admin', 'StrategyController.php');
const blade = read('resources', 'views', 'admin', 'strategy', 'index.blade.php');

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

// 注释里会写「原来是把 strategy_id 置 null」这类说明，去掉注释再判断「这句已不存在」
const controllerCode = controller
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const bladeCode = blade
    .replace(/\{\{--[\s\S]*?--\}\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// 只取 delete() 方法体，避免被 create()/update() 里的 DB::transaction 干扰
const deleteStart = controllerCode.indexOf('public function delete(');
const deleteBody = deleteStart === -1 ? '' : controllerCode.slice(deleteStart);
check('控制器存在 delete() 方法', deleteStart !== -1);

// ① 删除前有图片数检查
const hasImageCheck = /images\(\)->(exists|count)\(\)/.test(deleteBody);
check('delete() 里检查了策略下的图片数量', hasImageCheck,
    hasImageCheck ? '' : '缺 images()->exists() / images()->count()');

// 检查必须落在事务内（防确认框打开期间刚好有人上传的竞态）
const txStart = deleteBody.indexOf('DB::transaction(');
const checkIdx = deleteBody.search(/images\(\)->(exists|count)\(\)/);
const txEnd = deleteBody.indexOf('});', txStart);
check('图片数检查发生在 DB::transaction 内部',
    txStart !== -1 && checkIdx > txStart && (txEnd === -1 || checkIdx < txEnd),
    `transaction@${txStart} check@${checkIdx} transactionEnd@${txEnd}`);

// ② 不再把图片的 strategy_id 置 null
check('不再把图片的 strategy_id 置为 null',
    !/update\(\s*\[\s*['"]strategy_id['"]\s*=>\s*null\s*\]\s*\)/.test(controllerCode));

// 有图时必须返回失败，且提示里带上图片数量
const failIdx = deleteBody.indexOf('$this->fail(');
check('有图片时返回失败（$this->fail）', failIdx !== -1);
check('失败提示包含图片数量与「请先删除」',
    /fail\([^)]*张图片/.test(deleteBody) && /fail\([^)]*请先删除/.test(deleteBody));

// 只有空策略才真正删除：delete() 调用必须在图片数检查之后
const deleteCallIdx = deleteBody.indexOf('$strategy->delete()');
check('$strategy->delete() 在图片数检查之后执行',
    deleteCallIdx > checkIdx && checkIdx !== -1,
    `check@${checkIdx} delete@${deleteCallIdx}`);

// 找不到策略时的行为保持原样：仍然 success
check('找不到策略时仍返回 success', /\$this->success\('删除成功'\)/.test(deleteBody));

// ③ 每行带上图片数量
check('blade 的 <tr> 带 data-images-count',
    /<tr\b[\s\S]{0,200}?data-images-count="\{\{\s*\$strategy->images_count\s*\}\}"/.test(bladeCode));

// ④ 有图时的提示文案
check('blade 含「无法删除存储策略」提示', bladeCode.includes('无法删除存储策略'));
check('blade 含「请先清空」指引（清空图片入口出现后口径改了）', bladeCode.includes('请先清空'));
check('blade 有图时用的是 html 提示块（含加粗数量）',
    /html:\s*`[^`]*<b>\$\{imagesCount\}<\/b>/.test(bladeCode));

// 有图分支不发请求：警告框出现在 axios.delete 之前，且该分支直接 return
const guardIdx = bladeCode.indexOf('无法删除存储策略');
const axiosIdx = bladeCode.indexOf('axios.delete');
check('有图分支在 axios.delete 之前并提前返回',
    guardIdx !== -1 && axiosIdx !== -1 && guardIdx < axiosIdx &&
    /return;\s*}/.test(bladeCode.slice(guardIdx, axiosIdx)));

// ⑤ 原来那句「图片将无法在系统中预览」已删除
check('blade 不再出现「已上传至该存储的图片将无法在系统中预览」',
    !bladeCode.includes('已上传至该存储的图片将无法在系统中预览'));

// 空策略仍走原确认框
check('空策略仍弹确认框（showCancelButton: true + 确认删除）',
    /showCancelButton:\s*true/.test(bladeCode) && bladeCode.includes('确认删除'));
check('确认框正文仍保留「无法上传图片」提醒',
    bladeCode.includes('该组下面的用户将无法上传图片'));

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
    console.error(`\n失败 ${failed.length} 项：${failed.map(f => f.name).join('、')}`);
    process.exit(1);
}
