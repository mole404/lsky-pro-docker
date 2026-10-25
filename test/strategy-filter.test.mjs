/*
 * 「我的图片」页：筛选下拉加入「存储策略」（单选）的静态契约测试。
 *
 * 只读源码做断言（不进 jsdom 跑行为，那部分由 images-modal / tag-feature 那批覆盖）：
 *   A. 前端落点 —— 面板两段（存储策略 / 标签）、唯一滚动区、单选切换、清除两者全清、
 *      按钮不显示数量而是「启用态」、策略名换行不截断、面板高度按视口算；
 *   B. 后端落点 —— GET user/image-strategies 路由 + 控制器复用列表的 filter() 取分面数；
 *   C. 样式 —— 面板宽度类在 common.less 与提交进仓库的 public/css/common.css 里都有
 *      （构建期不跑 npm，产物必须手改）。
 *
 * 运行：node strategy-filter.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const SRC = path.join(here, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const blade = read('resources', 'views', 'user', 'images.blade.php');
const controller = read('app', 'Http', 'Controllers', 'User', 'ImageController.php');
const routes = read('routes', 'web.php');
const less = read('resources', 'css', 'common.less');
const css = read('public', 'css', 'common.css');

let failed = 0;
const check = (name, ok) => {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`);
    if (!ok) failed++;
};

console.log('[A. 前端] 筛选面板：存储策略 + 标签');
{
    check('面板里有存储策略段与标签段两个容器',
        blade.includes('id="strategy-filter-list"') && blade.includes('id="tag-filter-list"'));

    check('滚动区只有一层（#filter-scroll），两段都在里面',
        /id="filter-scroll"[\s\S]{0,1200}id="strategy-filter-list"[\s\S]{0,600}id="tag-filter-list"/.test(blade));

    check('滚动区带 overscroll-contain（滚到底不带动整页）',
        /id="filter-scroll" class="[^"]*overflow-y-auto[^"]*overscroll-contain/.test(blade));

    check('策略是单选：再点已选项取消',
        /selectedStrategyId === id\) \? null : id/.test(blade));

    check('请求参数形状：strategy_ids 单选数组 + tags 多选数组一起传',
        /strategy_ids: selectedStrategyId === null \? \[\] : \[selectedStrategyId\]/.test(blade)
        && /tags: selectedTagIds\.slice\(\)/.test(blade));

    check('清除筛选 = 策略与标签一起清空',
        /const clearHandler|#tag-filter-clear'\)\.off\('click'\)[\s\S]{0,400}selectedTagIds = \[\];[\s\S]{0,200}selectedStrategyId = null;/.test(blade));

    check('按钮文案改成「筛选」且图标换成 fa-filter（不再有 fa-tags）',
        blade.includes('<span>筛选</span>') && blade.includes('fa-filter text-brand')
        && !blade.includes('fa-tags text-brand'));

    check('按钮不再显示数量（没有 `标签（N）` 这类文案）',
        !/标签（\$\{/.test(blade) && !/筛选（\$\{/.test(blade));

    check('启用态用浅品牌底（bg-brand-soft）在 updateFilterButton 里切换',
        /updateFilterButton = \(\) => \{[\s\S]{0,400}bg-brand-soft text-brand/.test(blade));

    check('策略名允许换行、不截断（break-words，且策略项里没有 truncate）',
        /class="min-w-0 flex-1 break-words"/.test(blade)
        && !/strategy-filter-item[\s\S]{0,300}truncate/.test(blade));

    check('面板高度按视口算（fitFilterPanel 用 innerHeight）',
        /fitFilterPanel[\s\S]{0,900}window\.innerHeight/.test(blade));

    check('策略清单懒加载：第一次打开面板才取（strategiesLoaded 闸门）',
        /if \(! strategiesLoaded\) \{[\s\S]{0,120}strategiesLoaded = true;[\s\S]{0,120}loadStrategies\(\)/.test(blade));

    check('每次重拉列表后同步刷新分面张数（resetImages 里）',
        /imagesInfinite\.refresh\(params\);[\s\S]{0,200}if \(strategiesLoaded\) \{[\s\S]{0,120}loadStrategies\(\)/.test(blade));

    check('面板宽度走自定义类（w-64 之类在编译产物里不存在）',
        /panel-class="ls-filter-panel"/.test(blade));
}

console.log('\n[B. 后端] 取数端点');
{
    check('路由存在：GET user/image-strategies',
        /Route::get\('image-strategies', \[ImageController::class, 'strategies'\]\)->name\('user\.image-strategies'\)/.test(routes));

    check('控制器方法复用列表的 filter()（分面数必须与列表同条件）',
        /public function strategies\(Request \$request\): Response[\s\S]{0,900}->filter\(\$request\)/.test(controller));

    check('GROUP BY strategy_id 前先 reorder()（避免把列表排序带进聚合查询）',
        /->filter\(\$request\)[\s\S]{0,200}->reorder\(\)[\s\S]{0,200}->groupBy\('strategy_id'\)/.test(controller));

    check('返回结构是 [{id, name, total}]',
        /'id' => \(int\) \$id,[\s\S]{0,120}'name' =>[\s\S]{0,120}'total' => \(int\) \$total/.test(controller));

    check('strategy_id 为 null 的图不返回（id > 0 且名字非空才留下）',
        /\$row\['id'\] > 0 && \$row\['name'\] !== ''/.test(controller));
}

console.log('\n[C. 样式] 面板宽度（less 与提交的产物各一份）');
{
    check('common.less 有 .ls-filter-panel 宽度规则', /\.ls-filter-panel\s*\{[\s\S]{0,80}width:\s*17rem/.test(less));
    check('public/css/common.css 里有同一条（构建期不跑 npm）', /\.ls-filter-panel\{width:17rem\}/.test(css));
}

console.log('');
if (failed > 0) {
    console.log(`${failed} 项未通过`);
    process.exit(1);
}
console.log('全部通过');
