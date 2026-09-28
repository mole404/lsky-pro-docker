# 补丁行为测试（node + jsdom）

没有 iPhone 也能先把补丁的每条分支跑一遍：用真实的 DOM + jQuery 事件复刻
`resources/views/user/images.blade.php` 的用法，验证"**只在 iOS 生效、其它平台一行新代码都不执行**"。

## 运行

```bash
cd test
npm install
npm test                       # 测 ../overlay/context-js.js
node longpress.test.mjs /path/to/other/context-js.js   # 测指定的文件（例如未打补丁的原版）
```

## 覆盖到的用例

- **iPhone Safari**：长按 500ms 弹出图床自己的菜单；内容包含"图片操作/复制链接"；`beforeOpen` / `afterOpen` 回调照旧被调用并拿到元素与菜单节点；菜单用触摸坐标定位；注入了 `-webkit-touch-callout` 抑制样式；抬手补发的 `click` 被吞掉（不会误开图片预览）；时间窗过后的正常点击照旧生效
- **取消条件**：手指移动 >10px（滚动/框选）、多指触摸、短按（<500ms 抬手）都不触发菜单
- **iPad 请求桌面网站**（UA 伪装成 Mac、`maxTouchPoints=5`）：仍走长按分支
- **Mac（含苹果 M 系列）**（`MacIntel` 但 `maxTouchPoints=0`）：不触发长按，右键 `contextmenu` 照旧
- **Android Chrome**：长按不触发新分支、不注入 iOS 样式，`contextmenu` 照旧打开菜单且阻止浏览器默认菜单
- **Windows 桌面**：只有右键路径，连续右键仍能开菜单（去重窗口不误伤）

## 已知局限

- jsdom 没有排版引擎（元素高度恒为 0），所以只校验菜单的 `left` 与数值型 `top`，真实定位要靠真机
- 原生 callout 是否真的被压掉、`touchend` 的 `preventDefault` 是否真的省掉了原生 click，这些属于浏览器行为，**必须真机验证**（本测试只能证明代码路径与事件处理逻辑正确）
