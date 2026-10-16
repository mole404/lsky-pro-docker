# patches/ 说明

本目录只有一份存档：`ios-longpress.patch`（iOS 长按菜单 + 菜单交互修复 + 菜单边界钳制 + 手机端二级菜单）。
**它不参与构建、不进镜像**，构建用的是仓库里 `src/` 下的文件本身。这个 README 说明它的定位、怎么重生成、怎么验证。

## 1. 定位与权威口径

- **权威口径是 `tools/diff-vs-upstream.sh` 里的 `KNOWN_DEVIATIONS` 清单**：它跑全树 `diff -rq`（同样参数、
  同样 `--exclude`），只要出现清单外的「内容不同」文件就 `exit 1`。`src/` 相对上游"改了哪些"以它为准。
- `ios-longpress.patch` 是那份清单的**子集**：只收下面这 6 个与长按菜单 / 菜单样式相关的文件——
  `resources/js/context-js.js`、`public/js/context-js/context-js.js`、`resources/css/context-js.less`、
  `public/css/context-js/context-js.css`、`resources/views/user/images.blade.php`、
  `resources/views/components/auth-card.blade.php`（注意不止 Dockerfile 里说的"这三个文件"）。
- 它不含"只在上游存在"的删除项（Gallery / Upgrade 等），也不含 fork 新增文件（`public/static`、`App\Support\*` …）。
- 头部那一大段注释是**人工维护的变更史与实测记录**（各轮改动理由、实测数值、踩过的坑），不参与比对，别机械覆盖。
  下面的 `---- src/<path>` / `--- lsky-pro@38d52c46/<path>` / `+++ src/<path>` 起才是可机械重生成的 diff 段。

## 2. 重生成（recipe）

上游基线：`lsky-org/lsky-pro @ 38d52c4609eb85236b45ac75acac2ced55174953`（2025-11-24 的 master，此后停更）。

```bash
# ① 取上游快照（与 tools/diff-vs-upstream.sh 里 [1/3] 步完全相同的做法）
UP=$(mktemp -d)
git init -q "$UP" && git -C "$UP" remote add origin https://github.com/lsky-org/lsky-pro.git
git -C "$UP" fetch -q --depth 1 origin 38d52c4609eb85236b45ac75acac2ced55174953
git -C "$UP" checkout -q FETCH_HEAD

# ② 逐文件生成一段：这三行 + diff -u（参数与 tools/diff-vs-upstream.sh 里那行 `diff -u` 一致）
rel=resources/js/context-js.js          # ← 替换成上面 6 个路径之一
printf -- '---- src/%s\n--- lsky-pro@38d52c46/%s\t（上游原文件）\n+++ src/%s\t（本 fork）\n' "$rel" "$rel" "$rel"
diff -u "$UP/$rel" "src/$rel" | tail -n +3

# ③ 把 patch 里对应 `---- src/<rel>` 那一段换成它的输出；段与段之间空一行；头部注释块与段落顺序不动。
rm -rf "$UP"
```

（相对 `HEAD` 的改动不在本档范围内；本档只对「相对上游」负责，与提交与否无关。）

## 3. 回放验证（改了 / 重生成完建议跑一次）

把 patch 的 diff 段回放到上游快照上，结果应与仓库里的文件**逐字节相同**。用 `git apply`（本机不一定有 `patch(1)`）：

```bash
W=$(mktemp -d); cd "$W"; git init -q .; git config user.email a@b.c; git config user.name a
# 把上面 6 个上游原文件按相对路径拷进来（内容取自 $UP），git add/commit 之后逐段回放：
#   取某段的第 1 行（---- src/<rel>）里的 rel；把 `--- lsky-pro@…/<rel>` 改写成 `--- a/<rel>`、
#   `+++ src/<rel>` 改写成 `+++ b/<rel>`，其余原样存成 sec.patch，然后
git apply -p1 sec.patch && cmp "$rel" "<repo>/src/$rel" && echo IDENTICAL
```

## 4. 过时记录（2026-10-16 重生成前的事实）

重生成前，这份存档只在 2026-10-07/08 那批改动时刻正确；此后 `src/` 又改了，回放出来的结果与当时的 tree 不一致：

| 文件 | 回放结果 vs 当时 tree | 差在哪 |
| --- | --- | --- |
| `resources/js/context-js.js` | 差 75 行 | `LEAF_FADE_WINDOW` / `lastLeafTapAt`（按"是否刚点过叶子项"决定淡出时长）整段删除，改成一律按设备给时长；新增 `menuCleanupTimers` / `menuActionIds`：开新菜单前先取消上一轮的清理定时器、注销上一批 `document` 委托 |
| `public/js/context-js/context-js.js` | 差 75 行 | 同上（两份必须逐字节一致） |
| `resources/views/user/images.blade.php` | 差 730 行 | 标签 / 裁剪 / 导出 / 看图器等后续若干轮改动都没并进来 |
| `resources/views/components/auth-card.blade.php` | 差 18 行 | 缺 2026-10-09「视口变矮时 LOGO 被裁且滚不到」的 `calc(1.5rem + 4.375rem)` 上下预留 |
| `resources/css/context-js.less` | 一致 | —— |
| `public/css/context-js/context-js.css` | 一致 | —— |

另外头部记的 md5 也过期了（旧值 `c1b339b1…` / `5ddf0eed…` / `c0e51e96…`，现值见 patch 头部与 Dockerfile「自证 2」）。

**2026-10-16 已按第 2 节 recipe 重生成**，并按第 3 节回放验证：6 个文件全部与仓库内文件逐字节相同。
⚠ 这只在生成那一刻成立——`src/` 里这 6 个文件（或清单里任何文件）之后再改，本档就重新变旧：要么按第 2 节重生成，
要么只把它当历史存档读（改动的权威记录始终是 `tools/diff-vs-upstream.sh` 的清单 + git 历史）。

## 5. Dockerfile「自证 2」那段注释该怎么写

现措辞把「钉 md5」和「重新生成 patch」并列成同一件必做动作，暗示 `tools/diff-vs-upstream.sh` 会产出这份 patch
（它不会：那个脚本只打印全树 diff，也不做逐段重标头）。建议替换为：

```
# 自证 2：补丁内容与预期完全一致，blade 的资源版本串也在。
# 改 src/ 里这三个文件后必须同步更新这里的 md5（故意做成"改了不更新就构建失败"）；
# patches/ios-longpress.patch 只是给人看的存档、不参与构建 —— 需要刷新时按 patches/README.md 重生成（可选）。
```
