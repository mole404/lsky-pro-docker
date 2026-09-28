# 补丁行为测试（node + jsdom）

没有 iPhone 也能先把补丁的每条分支跑一遍：用真实的 DOM + jQuery 事件复刻
`resources/views/user/images.blade.php` 的用法，验证

1. **iOS 长按**：只在 iOS 生效、其它平台长按相关代码一行都不执行；
2. **菜单收放**：点菜单之外只关菜单、不点穿到页面（点别的图片不再顺手开预览），滚动/缩放/Esc 关闭；
3. **触摸端二级菜单**：点击展开/收起，不再"闪一下就整个菜单消失"；有鼠标的设备继续走 hover。

## 运行

```bash
cd test
npm install
npm test                       # 测 ../overlay/context-js.js
node longpress.test.mjs /path/to/other/context-js.js   # 测指定的文件（例如未打补丁的原版）
```

## 覆盖到的用例

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

## 已知局限

- jsdom 没有 `matchMedia`，代码里有能力检测兜底（没有 `matchMedia` 时退回 `'ontouchstart' in window`）；测试里"有鼠标的设备"那条是显式 stub 出来的
- jsdom 没有排版引擎（元素高度恒为 0，`fadeIn/fadeOut` 也不产生可见的 opacity/display 变化），所以只校验菜单的 `left` 与数值型 `top`；菜单开合状态用补丁新增的 `context.isMenuOpen()` 观测
- 原生 callout 是否真的被压掉、`touchend` 的 `preventDefault` 是否真的省掉了原生 click、`matchMedia` 在真机上的实际取值，这些属于浏览器行为，**必须真机验证**（本测试只能证明代码路径与事件处理逻辑正确）
