# Lsky Pro Docker 镜像（含 iOS 长按菜单修复）

本仓库是 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker) 的个人 fork，
用来给 [lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（兰空图床）打前端补丁：
**修复 iOS Safari 上长按图片无法弹出图床自定义菜单的问题**，顺带修菜单的交互问题。

**应用源码就在本仓库的 `src/` 里**（上游 commit `38d52c46…` 的完整快照），构建直接用它、
不再联网拉 GitHub —— 上游已明示停止维护，这样既防上游仓库消失，也方便之后直接改 PHP 代码。

- 本 fork 镜像：`ghcr.io/mole404/lsky-pro-docker:latest`
  （另有按本仓库提交命名的 tag，如 `:sha-3a1136c924c42eaf4dc23203d8f09163fc4ea063`）
- 上游镜像：`halcyonazure/lsky-pro-docker:latest`

## 与上游的差异

1. **应用源码 vendored 在 `src/`**（= 上游 `38d52c46…`，2025-11-24 的 master 完整树，304 个文件、约 8MB），
   构建直接 `COPY src/`，**不再联网拉 GitHub archive**。上游 README 已写明「开源版本已停止维护」，
   所以「跟不上上游」这个风险基本为零；这么做的收益是：上游仓库哪天被删/归档/改名，你照样能重建镜像，
   而且之后要改 PHP 代码，直接改 `src/` 下的文件、提交即可（不用再维护 overlay 叠加）。
   为什么钉在 2025-11-24 这个 commit：它是上游最后一个提交，比原先钉的 `911275c`（2023-05-16）
   多吃了三个真实修复 —— 图片格式转换时**不同图片共用同一个临时文件、会变成同一张图**、
   加水印后丢质量参数、SVG 支持 —— 外加 laravel / phpseclib / commonmark 等一串安全升级。
2. **前端补丁就地落在 `src/` 里**：`resources/js/context-js.js` 与 `public/js/context-js/context-js.js`
   （同一份内容的两处拷贝，必须一致）+ `resources/views/user/images.blade.php`（脚本版本串）。
   「我们相对上游改了什么」见 `patches/ios-longpress.patch`（存档，不参与构建），可用
   `bash tools/diff-vs-upstream.sh` 随时重新生成与核对。
3. 基础镜像显式写成 Debian **bookworm** 变体（与 2024-04 那版镜像同一 Debian 大版本），
   `install-php-extensions` 钉到具体版本（不再用 `latest`）。
4. **构建期自证**：① 我们从不修改的上游文件（`ImageService.php` / `convention.php` / `public/index.php` /
   `routes/web.php` / `composer.lock`）按上游 md5 校验 —— 保证 vendored 快照没被动过；
   ② 补丁产物按预期 md5 校验 —— 改了就构建失败（见 Dockerfile「自证 1/2」）。
5. CI 推到 GHCR（用仓库自带 `GITHUB_TOKEN`，不需要任何 secret）。**构建前**先跑 `test/` 里的 jsdom
   行为测试（补丁的每条分支），构建后把镜像拉回来做真机自证：核 md5 + 断言补丁标记 + 记录
   PHP/扩展/Debian 版本 + 真起容器 curl 安装页 + 核 Apache 实际吐出的 JS md5。
   上游的「每天定时重建」已去掉（源码钉死后定时重建没有意义）。
6. **入口脚本按「代码版本标记」自动同步**（`entrypoint.sh`）：镜像里带一个 `.code-revision`
   （源码 commit + 补丁 md5），卷里也存一份；**两者不一致（= 换了镜像）才同步代码**，
   一致就跳过（不换镜像重启零开销）。站点数据（`.env` / `database/` / `storage/` /
   `bootstrap/cache/` / `public/i`）任何情况下都不碰。
   于是「升级 = 换镜像」，不需要人工 cp 文件、也不需要手动清视图缓存。

## 代码在仓库的哪里、怎么改

```
src/                                    ← 上游应用源码完整快照（= 实际构建出来的东西，改这里就是改产品）
├── app/ config/ routes/ ...            ← PHP 后端：直接改、提交，CI 重建镜像即可，不用打补丁
├── resources/js/context-js.js          ← 我们的补丁（可读源码那份）
├── public/js/context-js/context-js.js  ← 我们的补丁（浏览器实际加载那份，内容必须与上面一致）
└── resources/views/user/images.blade.php
Dockerfile / entrypoint.sh              ← 构建与启动脚本（entrypoint 负责按版本标记把代码同步进卷）
patches/ tools/ test/                   ← 补丁存档、维护脚本、jsdom 行为测试
.github/workflows/build-image.yaml      ← 推 master 自动：跑测试 → 构建 → 真容器自证 → 推 GHCR
```

改代码的姿势：

1. 直接编辑 `src/` 下对应文件（改 PHP 也一样，改完就是普通 commit）
2. 若动了那三个补丁文件中的任何一个 → 同步更新 Dockerfile「自证 2」的 md5、`.code-revision`
   里对应的行、workflow 的 `CONTEXT_JS_MD5` / `BLADE_MD5`，并把 blade 里的 `?v=ios-longpressN`
   递增一位（击穿 Safari 的启发式缓存）
3. `cd test && npm ci && npm test` 跑补丁的行为测试
4. 提交 → 推 master → CI 跑测试 + 构建 + 真容器三场景自证；全绿才会 promote `latest`
5. 服务器上 `docker compose pull && docker compose up -d --force-recreate`：入口脚本靠版本标记
   自动把新代码同步进卷，站点数据一律不碰

## 这个补丁修的是什么

**根因**：iOS 上的 WebKit **永远不会派发 `contextmenu` 事件**
（[WebKit bug 213953](https://bugs.webkit.org/show_bug.cgi?id=213953)），长按图片只会弹系统 callout。
而图床的右键菜单完全挂在 `contextmenu` 上（`resources/js/context-js.js` 里的
`$(document).on('contextmenu', selector, ...)`，由 `resources/views/user/images.blade.php`
的 `context.attach()` 注册），于是 iPhone/iPad 上那段处理函数**一次都不会执行**，
"我的图片"页的长按菜单彻底不可用。

**补法**（三层，缺一层都会残留问题）：

- **长按识别**：`touchstart` + **250ms** 定时器，复用同一段开菜单逻辑 —— 因为 iOS 收不到 `contextmenu`，只能自己判长按。
  （iOS 原生 callout 约 500ms；这里取一半让响应更快，靠「手指移动 >10px 即取消」抵消阈值变短的误触风险）
- **样式压制**：注入 `-webkit-touch-callout: none` / `user-select: none`（只作用于本库绑定的元素范围）
  —— 不压掉的话会「系统菜单 + 自定义菜单」同时冒出来
- **点击兜底**：抬手时 `preventDefault`，并在捕获阶段吞掉紧随其后的那发 `click`
  —— 否则长按抬手会顺手触发图片预览

**跨平台隔离**：判定函数 `isIOSWebKit()` 只在 `iPad|iPhone|iPod`（或 iPadOS 桌面模式伪装的
`MacIntel + maxTouchPoints > 1`）上返回真。

- Android 的长按本来就会派发 `contextmenu`（三星浏览器、各家 WebView 同理）→ 判定为假，**新代码一行都不执行**
- Windows 只有鼠标右键 → 只走 `contextmenu`
- 真 Mac（**包括苹果 M 系列**）的 `navigator.maxTouchPoints` 是 `0` → 不会被误判成 iPad
- 即使判定算错也没有副作用：长按逻辑挂在 `touchstart` 上，没有触摸屏的设备永远不会启动那个定时器
- 长按与 `contextmenu` 之间加了 700ms 去重窗口，将来 iOS 支持该事件也不会弹两次菜单

**改动文件**：

- `src/resources/js/context-js.js` 与 `src/public/js/context-js/context-js.js`（同一内容两份，必须一致）
  （上游 `webpack.mix.js` 里本来也是 `mix.copy('resources/js/context-js.js', 'public/js/context-js')`，
  但仓库里 `public/` 下那份是旧工具链留下的压缩产物，一直没跟着源码更新，所以两个位置都要覆盖）
- `src/resources/views/user/images.blade.php`，只改一行（加资源版本串）：
  给脚本加 `?v=ios-longpress4`，避免 iOS/Safari 的启发式缓存把旧版 JS 一直喂给老用户（每次改补丁就递增这个串）
- 完整 diff 见 `patches/ios-longpress.patch`（存档用，构建实际走 `overlay/`）

## 第二个补丁：菜单收放与触摸端二级菜单（2026-09-28 追加）

前一个补丁解决"菜单**能不能**弹出来"，这个解决"菜单**好不好用**"。两处都是上游 `context-js.js` 的交互设计问题：

**问题 1：点菜单之外会点穿。** 上游的关闭逻辑只在 `document` 的**冒泡阶段** `fadeOut`，既不
`preventDefault` 也不 `stopPropagation` —— 点别的图片时"关菜单"和"开预览"同时发生（Viewer.js 的 click
挂在图片网格上）；手机上想关菜单只能去点浏览器地址栏，而地址栏又窄又难点。

**问题 2：手机上二级菜单一点就没。** 二级菜单靠 CSS `:hover` 显示
（`.dropdown-context .dropdown-submenu:hover>.dropdown-menu{display:block}`），而手机没有光标：
手指点"复制链接"时浏览器补发的合成 mouseenter 让二级菜单闪一下，紧接着那发 click 撞上关闭逻辑，
整个菜单消失 —— "复制链接"里的 Url / Html / BBCode / Markdown 在手机上根本点不到。

**问题 3：偶尔还会点穿（Windows 上偶发，2026-09-28 老师报的）。** 症状是"菜单还在屏幕上，点一下别的图片就透了"。
根因是**判断"拦不拦这一发点击"只看了一个内存状态 `menuVisible`**，而有好几条路径会把它提前置 false ——
外部滚动、`resize`、`Esc`、以及关菜单后的 100ms 淡出期。而 `scroll` 恰恰很容易被**非用户操作**触发：
菜单是绝对定位插进 `body` 的，**插入这个动作本身**就可能改变页面高度/滚动条，让浏览器自己滚动
（滚动锚定、图片懒加载重排、justified-gallery 重新布局），于是"菜单刚打开就被自己引发的滚动关掉"，
紧接着元素淡出的那 100ms 里菜单看着还在、状态已经是关 —— 这时点别的图片就直通了。这也解释了它为什么"偶尔"：
取决于菜单落在哪里、要不要出滚动条、浏览器是否触发滚动锚定。

**改法**（都在 `src/` 下的 `context-js.js` 里，不动主题 CSS）：

- **菜单守卫**（`installMenuGuard()`，装在 `document` 的**捕获阶段**）：菜单打开时，点菜单之外的任何位置
  → 关菜单 + `preventDefault` + `stopPropagation`。捕获阶段拦下 = 这一发事件永远不会到达页面自己的处理器
  （不开预览、不跳链接）。菜单**内部**的点击照旧放行，复制/重命名/删除等功能不受影响。
- **跟手一点**：手机上是"手指按下"（`touchstart`）就收起来，随后补发的 click 用 700ms 时间窗吞掉。
  拦截打在 click 上、**不拦 touchstart**，所以页面滚动与缩放完全不受影响。
- **刚打开的保护窗**（`MENU_OPEN_GRACE = 800ms`）：菜单是手指还按着时就弹出来的，抬手补发的那发 click
  目标正是刚被长按的图 —— 只吞掉它、**不关菜单**（否则菜单会"刚开就自己关"）。这条只对"紧随一次触摸"
  的 click 生效，鼠标点击不受影响（`lastTouchAt` 判定）。
- **触摸端二级菜单**：`matchMedia('(hover: none)')` 为真的设备上，点带二级菜单的父项 → 给它的 `<li>`
  加 `touch-open` 类，并注入一条与 hover 那条等价的 CSS；再点一次收起，同层只留一个展开。
  有鼠标/触摸板的设备继续用 hover，**桌面行为零改动**。
- **收得干净**：滚动 / 旋转缩放（含 `#images-scroll` 这类内部滚动容器）、`Esc` 都关菜单；
  菜单自身滚动不误关。
- **判据改成"屏幕上是否真有菜单"**（`menuOnScreen()`，问题 3 的修法）：`状态打开` → 在；
  `刚关掉但还在淡出（fadeSpeed + 50ms 窗口）` → 还在屏幕上；再用 **DOM 实测**兜底
  （元素存在且 `getBoundingClientRect().height > 0`）。这样**任何一条把状态提前置 false 的路径
  都不会让"看得见的菜单"失去拦截能力** —— "看得见就不许点穿"成了硬保证，而不再依赖某个变量是否同步。
- **菜单刚打开的 300ms 内忽略 `scroll`/`resize`**（`MENU_OPEN_IGNORE_INPUT`）：这一小段里的滚动/缩放
  多半是菜单自己插入引发的（滚动锚定、懒加载重排），拿它关菜单就是上面那条链路的起点。过了 300ms
  用户自己滚，照旧关。
- **诊断转储**（`context.debugDump()`）：常驻记录最近 240 条与菜单有关的事件（打开/关闭**原因**/每次点击的
  判定），出问题时在控制台执行 `copy(context.debugDump())` 就能把现场证据复制出来；`context.debug = true`
  会实时打到控制台。上游没有这套东西。

**验证**：`test/longpress.test.mjs` 覆盖了以上每条（包含"长按抬手那发 click 不能把刚开的菜单关掉"、
"淡出期间点击不许点穿"、"状态已 false 但菜单还看得见时点击仍被吞"这些回归 —— 都是这次最容易踩的坑）；
`test/repro-clickthrough.mjs` 是问题 3 的最小复现（可指定任意一版 JS 跑，用来确认"旧版点穿、新版不点穿"）；
CI 的镜像自证还会断言 `installMenuGuard` / `MENU_OPEN_GRACE` / `touch-open` / `isMenuOpen` /
`MENU_OPEN_IGNORE_INPUT` / `menuOnScreen` / `debugDump` 这些标记真的在镜像里。

## 使用方法

```docker
docker run -d \
    --name lsky-pro \
    --restart unless-stopped \
    -p 8089:8089 \
    -v $PWD/lsky:/var/www/html \
    -e WEB_PORT=8089 \
    ghcr.io/mole404/lsky-pro-docker:latest
```

### GHCR 包可见性（只需做一次）

GHCR 的包**默认私有**，匿名拉取会 401。到 GitHub → 右侧头像 → **Packages** →
`lsky-pro-docker` → **Package settings** → **Change visibility** → **Public**。
（保持私有的话就得在目标机器上 `docker login ghcr.io`，用带 `read:packages` 的 token。）

### 如果要使用Nginx反向代理配置HTTPS，则使用HTTPS访问容器

```docker
docker run -d \
    --name lsky-pro \
    --restart unless-stopped \
    -p 8088:8088 \
    -p 8089:8089 \
    -v $PWD/lsky:/var/www/html \
    -e HTTPS_PORT=8088 \
    -e WEB_PORT=8089 \
    ghcr.io/mole404/lsky-pro-docker:latest
```

Nginx配置文件示例：

```nginx
location ^~ /
{
    proxy_pass https://127.0.0.1:8088;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header REMOTE-HOST $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_http_version 1.1;
}
```

## 已有部署升级（现在只需换镜像）

入口脚本 `entrypoint.sh` 有三种分支，靠**代码版本标记**判断该走哪条：

| 卷的状态 | 行为 |
| --- | --- |
| 空卷（首次部署） | 全量播种，与上游逐字一致（刻意**不**复制镜像里的 `.env`——带进空卷会让安装向导 500，实测踩过） |
| 已有部署 + 标记不同（换了镜像） | 把镜像应用代码同步进卷，并清掉编译视图缓存 |
| 已有部署 + 标记相同（没换镜像） | 跳过同步，零开销 |

- 标记 = 镜像里的 `.code-revision`（源码 commit + 补丁 md5）。**只有代码/补丁变化才会让它变**，
  所以"换镜像"必然触发同步、"重启容器"不会白写整棵应用树。
- 同步时卷里被手工改过的代码会被镜像版本覆盖（「换镜像 = 代码也换」）。
- 因模板改动而失效的编译视图缓存会自动清掉（不用再手打 `rm storage/framework/views/*`）。
- **绝不覆盖**：`.env`（APP_KEY / 数据库 / S3 密钥）、`database/`（SQLite 数据库）、
  `storage/`（上传文件、日志、会话）、`bootstrap/cache/`（Laravel 运行时缓存）、`public/i`（本地存储软链）。

```bash
# 1) 备份（老习惯，SQLite 用户先停容器再打包最稳）
docker stop lsky-pro
tar czf ~/lsky-pro-backup-$(date +%F-%H%M).tar.gz -C /root lsky-pro
docker start lsky-pro

# 2) compose 里 image 改成 ghcr.io/mole404/lsky-pro-docker:latest，然后
docker compose pull
docker compose up -d --force-recreate

# 3) 验证（核「Apache 实际吐给浏览器」的那份，比看磁盘文件更硬）
curl -s http://127.0.0.1:8089/js/context-js/context-js.js | md5sum
# 期望：e114c840101d021aa416239196925624
docker inspect lsky-pro --format '{{index .Config.Labels "org.opencontainers.image.source"}}'
# 期望：https://github.com/mole404/lsky-pro-docker
```

### 代价与影响

1. **换镜像时，卷里对代码的手工修改会失效**（被镜像版本覆盖）。要长期保留的改动请改 `src/` 并提交，
   让镜像带上，别在卷里改。**不换镜像重启不会碰你的手改**（标记一致就跳过）。
2. **回滚 = 连镜像一起回滚**（compose 的 image 换回旧 tag/digest → `up -d --force-recreate`）：
   旧镜像的标记与卷里的不同 → 会自动把代码同步回那一版。升级和回滚都因此是"换一行 image"，
   但请保留旧镜像的 tag 或 digest（如 `ghcr.io/mole404/lsky-pro-docker@sha256:...`）。

   > ⚠️ **回滚请用 `:sha-<本仓库提交>` 这类不可变 tag（或直接写 digest）。**
   > 早期 CI 里把上游 pin 硬编码写死过，Dockerfile 升 pin 后它没跟着改，
   > 于是新镜像被贴上了 `:911275c13b03…` 这个"旧快照"tag —— 那个 tag 现在指向的其实是新代码，
   > **不要拿它当旧版本回滚**。该漂移问题已修（pin 改为从 Dockerfile 解析，CI 会断言镜像里的
   > `lsky_commit` 与 Dockerfile 一致），但那批历史 tag 不会自动修正。
3. **同步只在换镜像时发生**（不换镜像重启零拷贝）。要量体积/耗时：CI 的
   `Verify code sync (revision-gated) and data safety` 步骤每次构建都会打印实测值，见 Actions 日志。
4. **只增改、不删除**：新版镜像里删掉的旧文件不会从卷里消失。真要清干净得手动处理。
5. **站点数据不受影响，且有机器盯着**：CI 里那个自证步骤用真实 docker 跑三个场景 ——
   A) 空卷播种（并断言卷里**没有** `.env`、安装页 200）；
   B) 已有卷 + 旧标记（塞入旧代码 + `.env` / 数据库 / 上传 / 编译缓存，断言代码被同步、
      数据与配置一项不被碰、`.env` 内容不变 —— 不比对权限位：上游 entrypoint 的
      `chmod -R 755` 与我们的断言并发，实测会 640/755 自己飘）；
   C) 已有卷 + 同标记（断言跳过同步、手动修补保留、对外服务的 JS 仍是补丁版）。
   任一条件不满足就构建失败，不会 promote 到 `latest`。

## 验证清单

镜像里这些文件的 md5（补丁之外的每个文件都应当与线上那份旧镜像一致）：

- `public/js/context-js/context-js.js`：原始 `bab81ff5e43b50a760935c7b3ae6475c` → 补丁后 `e114c840101d021aa416239196925624`
- `resources/js/context-js.js`：原始 `c8e57f6232848ca8277341ddf1a3a7a6` → 补丁后 `e114c840101d021aa416239196925624`（两份必须一致）
- `resources/views/user/images.blade.php`：原始 `22c896eb7322ec2ff37d5eddd7ca0dec` → 补丁后 `f4e100c87d4becdcce163800db535775`
- `app/Services/ImageService.php`：`a7bcd8549c656501a057214637f10b45`（旧 pin）→ `9fb843806abd6b778d8acd3366e2f0f1`（新 pin，含上游三个修复）
- `config/convention.php`：`674975e4e5561cc15c27626cb1ce5233`（旧 pin）→ `c1adde95924944e07bd72e87bd5db2f7`（新 pin，默认允许 svg）
- 除这三个补丁文件外，`src/` 里其他文件都应等于上游 `38d52c46…` 的原值（CI「自证 1」每次构建都会验）

功能上要过的用例：

- iOS Safari 长按图片 → 弹图床自己的菜单（系统菜单不冒头）→ 抬手不会顺手弹出大图预览
- 菜单开着时点别处（含另一张图片）→ **只关菜单**，不开预览、不跳转；再点一次才恢复普通点击
- **菜单还在屏幕上的任何时刻点别的图片都不许点穿**（含刚打开、以及刚关掉还在淡出的那 100ms）
- 手机上点"复制链接" → 二级菜单展开（不再闪一下就没）→ 点 Url / Html / Markdown 能正常复制
- 菜单开着时滚动、缩放、按 Esc → 菜单收起（刚打开 300ms 内它自己引发的滚动不算）
- Windows 右键、Android Chrome 长按 → 菜单照旧
- 单击看大图、拖拽多选、复制链接、重命名、删除、上传、原图与缩略图访问、登录、API

`test/` 下有一个 node + jsdom 的行为测试（`cd test && npm install && npm test`），
可以在没有 iPhone 的情况下先把每条分支跑一遍；真机行为（原生 callout 是否被压掉）仍需真机确认。
出问题时页面控制台执行 `copy(context.debugDump())` 可导出菜单事件的诊断转储（含每次关闭的原因），
`test/repro-clickthrough.mjs <某版 context-js.js>` 是最小复现脚本，用来核对"旧版点穿、新版不点穿"。

## 维护

**上游已停止维护**（README 明示，最后一个提交是 2025-11-24），正常情况下不需要跟上上游。
真要有新提交想跟：

1. `bash tools/vendor-upstream.sh <新 commit>` —— 拉来上游那棵树替换 `src/`，自动保留我们那三个补丁文件，
   并把上游版本打印出来供比对；脚本结尾会列出接下来必须同步的东西
2. 更新 `Dockerfile` 的 `ARG LSKY_COMMIT` 与「自证 1/2」的 md5 期望值
3. `bash tools/diff-vs-upstream.sh` 生成 diff 存进 `patches/ios-longpress.patch`；它还会做白名单校验，
   告诉你 `src/` 相对上游是不是只动了预期那三个文件
4. 同步 `workflow` 的 `CONTEXT_JS_MD5` / `BLADE_MD5`；动了补丁就把 blade 的 `?v=ios-longpressN` 递增一位
5. `cd test && npm test`，然后推 master 等 CI 全绿

### 界面（2026-09-28 换新）

- 风格：清爽极简（白底卡片 + 细边框 + 蓝色强调色），支持 **亮色 / 暗色 / 跟随系统** 三态，
  顶栏和登录页右上角可切换，选择记在浏览器本地（`localStorage['lsky-theme']`）。
- 实现要点：颜色全部来自 `resources/css/app.css` 里的 CSS 变量，页面只写语义化 class
  （`bg-surface` / `text-ink` / `border-line`），所以同一份标记在亮暗下都正确，不会出现"某个角落忘了改"。
- **功能逻辑一行未改**：iOS 长按菜单（`context-js.js`，md5 被构建自证钉住）、点击防护、
  上传队列、图片选择、拖拽排序等交互全部保持原样；只改样式与排版。
- 上游原来从 Google Fonts 拉 Nunito，已改为系统字体栈（国内加载更快，中文也更自然）。

### 重建前端资源

产物（`public/css/*.css`、`public/js/app.js`）是**提交进仓库**的，Docker 构建不跑 npm。
改样式/模板后需要本地重建，**Node 请用 18 或 20**（Node 22+ 会因 laravel-mix 6 的依赖链报
`require is not defined in ES module scope`）：

```bash
cd src
npm ci && npm run prod      # 产物直接覆盖 public/ 下的文件
```

## 本 fork 的版本号 & 已移除的上游功能（2026-09-29）

### 版本号
后台「设置 → 关于」和控制台「软件信息 → 软件版本」显示的是：

```
v3.0 <7 位 commit>
by mole404
```

- 版本号/作者来自 `config/app.php` 的 `version` / `author` —— **不走数据库配置**（原来读的是
  `app_version` 配置项，改代码默认值对已装好的站点无效，坑过一次），改版本号就改这一行。
- 后面那串是镜像里 `.code-revision` 标记的 `fork_sha` 前 7 位（Dockerfile 构建时写入、
  entrypoint 首次启动同步进卷），读不到就只显示版本号，不会报错。**每次构建自动跟随 commit。**
- 不再联网检查上游更新：上游已停更，这个 fork 自己维护。

### 已移除的上游功能
| 移除项 | 涉及位置 |
| --- | --- |
| 画廊 | 路由 `gallery`、`GalleryController`、`CheckIsEnableGallery` 中间件、`common/gallery.blade.php`、设置项 `is_enable_gallery`、侧栏入口、`ConfigKey::IsEnableGallery` |
| 系统升级 | 设置页整块 UI 与轮询 JS、路由 `admin.settings.{check.update,upgrade,upgrade.progress}`、`SettingController` 的 3 个方法、`lsky:upgrade` 命令、`UpgradeService`、`ConfigKey::AppVersion` |

数据库里遗留的 `is_enable_gallery` / `app_version` 配置行**不会被读取、也无需清理**（留着无害）。
图片列表用的 `justified-gallery` / `viewer.js` / `dragselect` 是「我的图片」页的网格与多选库，与画廊功能无关，保留。

### 另外两个小改动
- **上传结果行带缩略图**：多图上传后，每个链接（URL / HTML / BBCode / Markdown…）左边带一张 40×40
  缩略图，一眼看出哪个链接对应哪张图；非图片文件或取不到缩略图时自动不显示（`onerror` 兜底）。
- **「我的图片」页新增「取消选择」**：在「删除」后面（手机端在折叠菜单里），一键清空当前多选。

### 动过 `user/images.blade.php` 的注意
该文件是 fork 补丁的一部分，md5 被 Dockerfile / CI 核对 —— 当前期望值
`298b1164e827f973707b3b2b78bfbbb9`。改它就要同步 `Dockerfile` 里那两处（CI 会拦）。

## 运行时版本与依赖（2026-09-28 复核）

- **PHP：8.3**（`Dockerfile` 的 `ARG PHP_VERSION`）。理由：8.1 已 EOL（2025-12-31），8.2 的 EOL 是
  2026-12-31，8.3 支持到 2027-12-31。配套把依赖升到同线最新：`laravel/framework` **9.52.21**
  （9.x 最后一个补丁）+ `symfony/*` **6.4 LTS**（Laravel 9 的 `^6.0` 正好允许，6.4 是 LTS，支持到 2027-11）。
- **已知且无法在本仓库内修复的**：Laravel 9 框架自身的安全公告（9.x 线没有修复版本）。
  Composer 2.10 起默认会**拒绝**安装任何带未修公告的版本，而整条 Laravel 9 线都被覆盖 ——
  这就是为什么**重新解析依赖时必须显式关闭**该策略（CI 的 lock 任务用 `composer config --global
  policy.advisories.block false`，带显式开关与说明）。注意这**不新增风险**：线上本来就跑在这条线上，
  只是把既有事实写明。真正的根治是把 Lsky 升到 Laravel 11/12（工程量：breeze / sanctum /
  fruitcake-cors / intervention-image v3 / 各家云存储 SDK 全要动），属于另立项的事。
- 其余依赖的已知公告已经跟进（guzzle / psr7 / phpseclib / commonmark / aws-sdk / diactoros）。
- **镜像用 `composer install --no-dev`**（2026-09-28 起）：开发包（debugbar / ignition / whoops /
  phpunit / faker / sail / mockery / collision 等约 40 个）不进镜像 —— 对线上没有用途，留着既占体积
  也是暴露面（debugbar 那类在调试模式下会漏内部信息）。
  **连带项（重要）**：升级时 entrypoint 会作废卷里的 `bootstrap/cache/packages.php` 与 `services.php`
  —— 那是"旧镜像当时装着开发包"生成的清单，里面记着这些包的 ServiceProvider 类名，不作废的话
  Laravel 引导时加载它就会 Class not found、整站 500。CI 里有专门回归（故意种一份引用 debugbar 的
  过期清单，断言同步后已作废）。真要临时用 debugbar 排查，自己 `composer install`（不带 --no-dev）
  构建一个临时镜像，别动线上。

顺带一提：CI 支持**试构建**——在 Actions 里手动 `Run workflow` 时填一个 `php_version`（如 `8.2` / `8.3`），
就会用那个 PHP 版本构建并跑完整自证（不改仓库里的默认值），用来验证版本兼容性再决定要不要落进 Dockerfile。
另外 CI 会硬断言「上游迁移文件个数」与基线一致 —— 换 pin 时若上游新增了数据库迁移，会直接报红提醒
（entrypoint 不会自动跑 `migrate`，这类变更必须人工处理）。

## 环境变量

跟上游一致：

- `WEB_PORT`：容器内 `Apache` 监听端口，默认 `8089`（`-e WEB_PORT=8089` 可改）
- `HTTPS_PORT`：HTTPS 端口，默认 `8088`（用 Nginx 反代 HTTPS 时才需要）

### Windows内以`WSL`的方式部署`Docker`容器

按照 [#13](https://github.com/HalcyonAzure/lsky-pro-docker/issues/13) 的反馈来看，如果在`Windows`内创建容器出现了将文件挂载于`WSL`内，然后出现了重启系统文件未识别的情况，可以将映射目录修改为类似 `\\wsl$\Ubuntu\path-mount-lsky\` 的形式

## 反代HTTPS

### 使用非443端口反代服务

如果是在自家宽带进行图床的部署，无法使用`443`端口，在`Nginx`的配置文件需要进行一些修改，可以参考：Docker部署后，[非443端口域名反代图床服务配置问题](https://github.com/HalcyonAzure/lsky-pro-docker/issues/7)

## Docker-Compose部署参考

默认用 **SQLite**（镜像自带，不需要额外数据库服务，本 fork 线上就是这么跑的）。
要用 MySQL 的话，`docker-compose.yaml` 里留了一份注释掉的参考 service —— 注意密码别写死在 yaml 里（用环境变量），
镜像也别用已 EOL 的 `mysql:5.7`（原项目 issue [#256](https://github.com/lsky-org/lsky-pro/issues/256) 里有更多讨论）。

原项目：[☁️兰空图床(Lsky Pro) - Your photo album on the cloud.](https://github.com/lsky-org/lsky-pro)

## 构建您自己的镜像

Dockerfile 是多段构建：应用源码取自仓库里的 `src/`，不需要 Node 工具链（补丁直接改编译好的前端文件）。
构建时只有 `composer install` 需要联网（依赖版本由 `src/composer.lock` 钉死）：

```bash
docker build -t lsky-pro-docker .
```

指定平台（CI 只构建 amd64 —— 部署机是 x86_64，arm64 白烧一半构建时间；要 arm64 就把
下面这行改成 `--platform linux/amd64,linux/arm64`，同时改 `.github/workflows/build-image.yaml`
里的 `platforms:`）：

```bash
docker buildx create --use
docker buildx build --platform linux/amd64 -t lsky-pro-docker .
```

## 手动备份/升级

如果需要迁移数据库/手动升级`Lsky-Pro`，可以参考官方文档：[升级｜Lsky Pro](https://docs.lsky.pro/docs/free/v2/quick-start/upgrade.html)，来备份主要文件以进行恢复/升级

## 致谢与许可

- 应用本体：[lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（GPL-3.0）
- Docker 打包：fork 自 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker)（AGPL-3.0）
- `resources/js/context-js.js` 源自 Jacob Kelley 的 Context.js（MIT），上游由 WispX 修改

- vendored 的应用源码保留上游 `src/LICENSE`（**GPL-3.0**）与全部署名；本仓库自身的打包脚本沿用
  HalcyonAzure 那份 `LICENSE`（AGPL-3.0）。均未删除任何版权与致谢信息。
