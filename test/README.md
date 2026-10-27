# 补丁行为测试（node + jsdom）

没有 iPhone 也能先把补丁的每条分支跑一遍：用真实的 DOM + jQuery 事件复刻
`resources/views/user/images.blade.php` 的用法，验证

1. **iOS 长按**：只在 iOS 生效、其它平台长按相关代码一行都不执行；
2. **菜单收放**：点菜单之外只关菜单、不点穿到页面（点别的图片不再顺手开预览），滚动/缩放/Esc 关闭；
3. **看得见就不许点穿**：菜单还画在屏幕上的任何时刻（含刚打开、含刚关掉还在淡出的 100ms、含状态被别的路径
   提前置 false 但元素还在）点击都不许直通页面；
4. **触摸端二级菜单**：点击展开/收起，不再"闪一下就整个菜单消失"；有鼠标的设备继续走 hover。

## 运行

```bash
cd test
npm install
npm test                       # 全量：依次跑本目录下所有 *.test.mjs，任一个失败就非 0 退出
node longpress.test.mjs /path/to/other/context-js.js   # 单跑一个文件；这份还支持指定被测 JS（例如未打补丁的原版）
node repro-clickthrough.mjs /path/to/context-js.js     # 最小复现：滚动关菜单后紧接着点图片，会不会点穿
```

> **Node 需要 ≥ 22.22**（jsdom 30 的 `engines`：`^22.22.2 || ^24.15.0 || >=26`）。
> 用 Node 18 跑会在加载 jsdom 时直接报 `ERR_REQUIRE_ESM`（它的依赖是 ESM-only）——那不是用例失败，
> 是压根跑不起来；换一份更新的 node 就行，例如 `PATH=/usr/local/bin:$PATH npm test`。

`repro-clickthrough.mjs` 是实测的那个"偶尔点穿"的最小复现：它把"菜单插入引发的那一发滚动 →
关菜单 → 紧接着点别的图片"这条时序压成确定性的三步。对着旧版跑会打印 ❌ 点穿了、对着新版跑打印 ✅。

## 覆盖到的用例（`longpress.test.mjs`）

- **iPhone Safari（长按）**：长按 ≥250ms 弹出图床自己的菜单；内容包含"图片操作/复制链接"；`beforeOpen` / `afterOpen` 回调照旧被调用并拿到元素与菜单节点；菜单用触摸坐标定位；注入 `-webkit-touch-callout` 抑制样式；抬手补发的 `click` 被吞掉（不会误开图片预览）；**且那一发 click 不会把刚打开的菜单关掉**（回归：菜单"刚开就自己关"的陷阱）
- **iPhone Safari（菜单收放）**：菜单开着时点别的图片 → 只关菜单、不开预览；菜单关掉后正常点击照旧生效（不会一直吞点击）
- **iPhone Safari（二级菜单）**：长按菜单后点"复制链接" → 二级菜单展开、整个菜单**不**关闭、父项默认行为被阻止、没有点穿到页面；再点一次收起（菜单仍开着）；点二级菜单里的叶子项（模拟 ClipboardJS 的 `.copy`）→ 复制逻辑照旧执行、菜单关闭；注入了与 hover 等价的触摸展开样式
- **取消条件**：手指移动 >10px（滚动/框选）、多指触摸、短按（<250ms 抬手）都不触发菜单；按住 160ms 抬手不出现、320ms 抬手出现（钉住 250ms 这个分界线）
- **菜单收放（Windows）**：点图片（菜单外）→ 菜单关闭 + 页面收不到这发 click（预览没开）+ 没有冒泡到 document；菜单内部项点击照旧执行并关闭菜单；页面滚动 / 窗口缩放 / Esc / 内部滚动容器（`#images-scroll`）滚动都关菜单；菜单自身滚动不误关
- **有鼠标的设备**：即使 UA 是 Windows，只要 `matchMedia('(hover: none)')` 为假，点"复制链接"就不会展开（继续 hover），保持"点菜单项即关闭"的老行为
- **iPad 请求桌面网站**（UA 伪装成 Mac、`maxTouchPoints=5`）：仍走长按分支
- **Mac（含苹果 M 系列）**（`MacIntel` 但 `maxTouchPoints=0`）：不触发长按，右键 `contextmenu` 照旧
- **Android Chrome**：长按不触发新分支、不注入 iOS 样式，`contextmenu` 照旧打开菜单且阻止浏览器默认菜单；**长按抬手补发的 click 不会关掉刚打开的菜单**；真手指点别处 → 只关菜单、不开预览
- **Windows 桌面**：只有右键路径，连续右键仍能开菜单（去重窗口不误伤）
- **回归：看得见的菜单必须拦得住**（实测的偶发点穿）：A) 被滚动关掉后元素还在淡出时点别的图片 → 不点穿、不开预览；B) 状态已 false、淡出窗也过了，但 DOM 实测菜单仍可见（把高度桩成 120，因为 jsdom 高度恒为 0）→ 点击照样被吞；C) 菜单刚打开 300ms 内的滚动（它自己引发的）不关菜单、过了 300ms 用户滚动照旧关；D) 菜单彻底消失后点击恢复正常（不会一直吞点击）；E) `context.debugDump()` 含打开记录与关闭原因

## 其余测试文件

`npm test` 会依次跑本目录下所有 `*.test.mjs`（以前只跑 `longpress` + `sidebar`，另外几个文件从来不在自动路径上）。
除上面那份长按/菜单测试外：

| 文件 | 钉住什么 |
| --- | --- |
| `images-modal.test.mjs` | 图片页三个弹窗的静态契约：钩子齐全、抽屉残留物为零、字段顺序、请求 payload、设计令牌 |
| `images-modal-dom.test.mjs` | 同上的行为面：把 blade 里三段内联脚本在 jsdom + 真实 jQuery 里跑起来（移动 / 详情 / 相册列表 / 操作条分发——空选中时「刷新」仍生效、其余操作仍被守卫挡住） |
| `swal-theme.test.mjs` | 样式层：哨兵隐藏、footer 横线、sweetalert2 皮肤有没有真的压过它运行时注入的默认样式 |
| `infinite-scroll-bottom-mobile.test.mjs` | 手机整页滚到底第一次就要自动加载（地址栏收起前后的视口高度差） |
| `infinite-scroll-destroy.test.mjs` | `infiniteScroll.destroy()` 谁注册谁解绑（别顺手摘掉图片墙挂在 window 上的监听） |
| `infinite-scroll-click-delegate.test.mjs` | 哨兵 click 委托判据收窄 + 事件命名空间 |
| `image-selection-ring.test.mjs` | 图片墙那圈蓝框**只在被勾选时**出现：编译产物与 LESS 源码都只认 `ds-selected`、任何 `:hover` 染色都不许存在、悬停的小圆勾与选中染色原样、模板保留透明 outline（上色不重排） |
| `menu-guard.test.mjs` | 「菜单开着时点菜单外只关菜单、不触发别的」的两个守卫（仅图片页）：盾牌与 touch 时间窗已撤除、click 守卫是捕获阶段且面板内放行、关菜单走 Alpine 状态、一段 touch 事件都不碰、两族菜单同时开着的行为 |
| `ui-tweaks.test.mjs` | 一批 UI / 文案契约：单位大小写、顶栏收拢、外观切换共用下拉、用量条 8px、**各策略占用百分比已下线（图例与气泡都不留，只保留仪表盘右上角的总占比）与「存储用量」用词** |
| `sidebar.test.mjs` | 侧栏折叠三契约（首屏贴类、切换写 localStorage、<640px 只开关抽屉） |
| `admin-pagination-and-purge.test.mjs` | 后台分页组件（用到的类都必须在产物里、`nav`/`aria-current`/`aria-disabled`、44px 命中区、页码越界夹回最后一页）+ 清空策略后端契约（两阶段删除的**顺序**、`delete_files` 取自请求而非写死、同策略互斥锁、物理文件成功/失败都计数）+ 每个破坏性弹窗逐块配对危险样式 + 亮暗两套对比度真算 |
| `purge-dialog-behavior.test.mjs` | 清空弹窗的行为面：把策略页那段 `<script>` 在 jsdom + 真实 jQuery 里跑起来（问号按钮点两下状态来回、勾选值真的进请求、完成弹窗分别写记录数与物理文件数、没进展时停手报错、服务端重置游标时继续） |

只跑某一个：`node <文件名>`。

## 已知局限

- jsdom 没有 `matchMedia`，代码里有能力检测兜底（没有 `matchMedia` 时退回 `'ontouchstart' in window`）；测试里"有鼠标的设备"那条是显式 stub 出来的
- `ImagePurgeService`（清空策略的两阶段删除）依赖 Laravel 运行时（Eloquent / 语言包 / Flysystem），本目录没有 `vendor/`，所以只做到「源码结构契约 + 前端行为」两层，**没有**在这里真跑一次删库删文件；那一步要在能 `composer install` 的镜像里做一次实测（详见 PR/task 里的验证记录）
- jsdom 没有排版引擎（元素高度恒为 0，`fadeIn/fadeOut` 也不产生可见的 opacity/display 变化），所以只校验菜单的 `left` 与数值型 `top`；菜单开合状态用补丁新增的 `context.isMenuOpen()` 观测
- `menuOnScreen()` 的 **DOM 实测那条分支**（`getBoundingClientRect().height > 0`）在 jsdom 里恒为假，只能靠桩高度来测（见回归用例 B）；它真正的价值在真浏览器里 —— 那是"菜单还看得见就拦得住"的最后一道保险
- 同理：真机上"哪一发浏览器行为把状态提前置 false"（滚动锚定 / 懒加载重排 / 平台差异）无法在 jsdom 里完全复刻，所以补丁新增了 `context.debugDump()` 常驻诊断转储：真机再遇到时导出即可定位
- 原生 callout 是否真的被压掉、`touchend` 的 `preventDefault` 是否真的省掉了原生 click、`matchMedia` 在真机上的实际取值，这些属于浏览器行为，**必须真机验证**（本测试只能证明代码路径与事件处理逻辑正确）
