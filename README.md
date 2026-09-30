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
   而且之后要改 PHP 代码，直接改 `src/` 下的文件、提交即可。
   为什么钉在 2025-11-24 这个 commit：它是上游最后一个提交，比原先钉的 `911275c`（2023-05-16）
   多吃了三个真实修复 —— 图片格式转换时**不同图片共用同一个临时文件、会变成同一张图**、
   加水印后丢质量参数、SVG 支持（**本 fork 已移除 SVG 上传，见下「与上游的差异」第 7 条**） —— 外加 laravel / phpseclib / commonmark 等一串安全升级。
2. **前端补丁就地落在 `src/` 里**：`resources/js/context-js.js` 与 `public/js/context-js/context-js.js`
   （同一份内容的两处拷贝，必须一致）+ `resources/views/user/images.blade.php`（脚本版本串）。
   「我们相对上游改了什么」见 `patches/ios-longpress.patch`（存档，不参与构建），可用
   `bash tools/diff-vs-upstream.sh` 随时重新生成与核对。
   该脚本内置一份**已知偏离清单**（`KNOWN_DEVIATIONS`，当前 94 个文件，按「为什么偏离」分组：
   补丁产物 / 移除画廊与系统升级 / 移除 SVG / 依赖安全升级 / 前端换新与迭代 / 前端构建产物 /
   sqlite 并发参数 / 认证端点节流 / 收窄信任代理（`TrustProxies` 不再信任所有转发头，否则伪造
   `X-Forwarded-For` 就能重置按 IP 的限流））：src/ 相对上游的「内容不同」清单必须**恰好**落在清单内 ——
   出现清单之外的改动就 exit 1 报警（要么登记进清单并写一句理由，要么就是手滑）。
3. 基础镜像显式写成 Debian **bookworm** 变体（与 2024-04 那版镜像同一 Debian 大版本），
   `install-php-extensions` 钉到具体版本（不再用 `latest`）。
4. **构建期自证**：① 「**从不修改**的上游文件」（`public/index.php`）按上游 md5 校验 —— 保证 vendored
   快照没被动过；② 「**有意偏离**上游」的文件（`config/convention.php` / `routes/web.php` /
   `routes/auth.php` / `app/Services/ImageService.php` / `composer.lock`）按预期 md5 校验 —— 改了就构建失败；
   ③ 补丁产物按预期 md5 校验（见 Dockerfile「自证 1 / 1b / 2」）。
5. CI 推到 GHCR（用仓库自带 `GITHUB_TOKEN`，不需要任何 secret）。**构建前**先跑 `test/` 里的 jsdom
   行为测试（补丁的每条分支），构建后把镜像拉回来做真机自证：核 md5 + 断言补丁标记 + 记录
   PHP/扩展/Debian 版本 + 真起容器 curl 安装页 + 核 Apache 实际吐出的 JS md5 +
   **断言真实响应头里没有 `X-Powered-By`、`Server` 头不带具体版本号**（F23 加固的端到端自证）。
   上游的「每天定时重建」已去掉（源码钉死后定时重建没有意义）。
6. **入口脚本按「代码版本标记」自动同步**（`entrypoint.sh`）：镜像里带一个 `.code-revision`
   （源码 commit + 补丁 md5），卷里也存一份；**两者不一致（= 换了镜像）才同步代码**，
   一致就跳过（不换镜像重启零开销）。站点数据（`.env` / `database/` / `storage/` /
   `bootstrap/cache/` / `public/i`）任何情况下都不碰。
   于是「升级 = 换镜像」，不需要人工 cp 文件、也不需要手动清视图缓存。
7. **移除 SVG 上传支持**（F3，老师不用 SVG，也确认**不需要为「万一 svg 回来」写任何防御代码**）：
   SVG 不再被当作「可上传 / 可存储 / 可内联展示的图片格式」。
   - `config/convention.php` 的 `AcceptedFileSuffixes` 后缀白名单去掉 `svg`
     （`app/Http/Requests/Admin/GroupRequest.php` 里那份 `in:` 校验同步去掉）。
   - **读取侧硬过滤**：`app/Models/Group.php` 在读取组配置时对 `AcceptedFileSuffixes` 做白名单清洗，
     所以**升级后即使不去后台重新保存组配置**（数据库里仍存着带 svg 的旧值），也不会再接受 SVG 上传。
   - **防御性代码已全部撤除**（老师确认不必兜底）：
     - `Controller::output()` 里那段「`svg`/`svgz` 改成 `Content-Disposition: attachment` +
       `X-Content-Type-Options: nosniff`」的守卫（连同 `$headers` 变量与 fork 注释）已删掉，
       `output()` 恢复成改动前的原样（`headers: ['Content-type' => $mimetype]`）。
     - `000-default.conf.template` 里两个 vhost 的 `<LocationMatch "(?i)^/(i|thumbnails)/.*\.svgz?$">`
       加固段（以及它上面那段 fork 注释）已删掉。
     - `Dockerfile` 里为上述两段服务的 `RUN a2enmod headers` 与对应的四条构建期断言
       （`ForceType text/plain` / `Header set Content-Disposition` / `Header set Content-Security-Policy` /
       `Header set X-Content-Type-Options` 各 `= 2`）一并删掉；健康检查要用的 `command -v curl` 断言保留。
   - 静态图标 SVG（`public/fonts/vendor/@fortawesome/**` 的字体、`public/static/default-avatar.svg`、
     blade 里内联的图标）**不受影响**，正常保留。
   - **死代码清理**：移除 SVG 后，几条「只可能因为 svg 数据而命中」的分支永远不可达，已连同判据一起删掉：
     `app/Services/ImageService.php` 的上传跳过图片处理 / 跳过违规扫描的 `in_array(..., 'svg')`、
     `makeThumbnail()` 里 `extension === 'svg'` 直接拷原文件的特例；`app/Http/Controllers/Controller.php`
     里 `output()` 的两处 svg 例外（动态水印跳过名单、ico/svg 直出名单）；`app/Models/Image.php`
     的 `getThumbnailPathname()` 由 `extension === 'svg' ? 'svg' : 'png'` 简化为常量 `png`。
     据此 `app/Services/ImageService.php` 也成了 **fork 有意修改**的文件（它原本在「从不修改的上游文件」
     名单里），md5 `9fb843806abd6b778d8acd3366e2f0f1` → `e7edc0fc9dc8c654c4debca0e1d2eac4`；
     Dockerfile 的构建期自证已把它从「自证 1（从不修改）」移到「自证 1b（有意偏离上游）」并同步期望值。
8. **认证类 POST 端点加路由级节流（F23，2026-09-30 安全加固）**：`routes/auth.php` 里
   `/login`、`/register`、`/forgot-password`、`/confirm-password` 四个 POST 各加 `throttle`
   （登录/注册/密码确认 `5,1`、找回密码 `6,1`，即每 IP 每分钟 5/6 次，超出 429）。
   原来这四个端点**一个路由级节流都没有**（全仓只有 `verification.verify` 的 `6,1`、
   `verification.send` 的 `3,1`、`api/v1/tokens` 的 `3,1`，那三条没动）。
   应用里 Breeze 自带的 `RateLimiter`（`LoginRequest`）是按 **(邮箱|IP)** 计数的、5 次失败 / 60 秒衰减，
   只能挡「盯着同一个账号撞库」——换着邮箱撒网、或轮换 IP 的批量请求它挡不住，所以两者互补：
   一个防单账号被撞，一个防同 IP 批量请求（邮箱枚举 / 注册滥用 / 邮件轰炸）。
   **已知取舍**：`TrustProxies` 是 `$proxies = '*'`，`$request->ip()` 取自 `X-Forwarded-For`；
   前面有反向代理（并且由代理覆写该头）时拿到的是真实客户端 IP，**若站点直接暴露在公网、没有代理
   覆写这个头，攻击者能伪造 `X-Forwarded-For` 绕过按 IP 的限流**。这一条没有一并改（改它会牵动
   所有取 IP 的地方，属单独一步）。该文件同样被钉进 `Dockerfile` 自证 1b 的 md5。
9. **运行时加固：响应头不再泄露精确版本（F23，2026-09-30）**：镜像里加两份配置，只改镜像自身的
   PHP/Apache 配置、不碰应用代码：
   - `/usr/local/etc/php/conf.d/zz-lsky-hardening.ini`：`expose_php=0`（不再发 `X-Powered-By: PHP/8.3.x`）、
     `display_errors=0`（错误不直出响应体）。官方 php 镜像不带 `php.ini`，编译默认值就是 1；
     文件名用 `zz-` 前缀是因为 `conf.d` 的 ini 按文件名字母序加载、后加载者覆盖先者，`zz-` 排最后就
     不会被别的 ini 盖掉。
   - `/etc/apache2/conf-enabled/zz-lsky-hardening.conf`：`ServerTokens Prod`（`Server` 头只留 `Apache`，
     原来是 `Apache/2.4.68 (Debian)`）+ `ServerSignature Off`。**放 `conf-enabled` 而不是那个 vhost 模板
     （`000-default.conf.template`）**：`ServerTokens` 是全局（主配置上下文）指令，写进 `<VirtualHost>` 里
     Apache 会直接拒绝加载；模板整份是 vhost、还管着 HTTPS vhost 与目录权限，动它风险面大得多。
   两处都有**构建期断言**（ini 那条是用 `php -r` 真读回 `ini_get()` 断言，不是 grep 文件内容），
   CI 的「Verify published image」再对**真 Apache 吐出来的响应头**断言一次。

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
   里对应的行、workflow 的 `CONTEXT_JS_MD5` / `BLADE_MD5`
   （静态资源的版本串不用手动递增：blade 里走 `\App\Utils::assetVersion()`，按文件时间自动算）
3. `cd test && npm ci && npm test` 跑补丁的行为测试（要 Node ≥ 22.22，见 `test/README.md`）
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
  `{{ asset('js/context-js/context-js.js') }}?v={{ \App\Utils::assetVersion('js/context-js/context-js.js') }}`
  —— 版本号取自该文件的修改时间（镜像构建、卷同步都会刷新它），补丁一改浏览器就拿新版 JS，
  不需要手动递增任何版本号
- 完整 diff 见 `patches/ios-longpress.patch`（存档用，不参与构建）

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

容器内的 `8088`（`HTTPS_PORT`）是 Apache 的 **HTTPS vhost**，证书是容器**首次启动时用 openssl 自签**的
（`/etc/apache2/ssl/lsky-selfsigned.crt`，CN=lsky-pro，RSA 2048 / 3650 天）—— 浏览器一定会报「不受信任」，
**仅供本机 / 内网调试**。对外提供服务请走下面的 Nginx 反向代理（由 Nginx 持有真正的证书），
或者干脆只映射 `8089` 的 HTTP 端口、由 Nginx 来终结 TLS。

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

> 自签证书**不随镜像发货、也不进数据卷**（镜像里没有任何证书/私钥文件）：每个容器首次启动时自己生成一份，
> 重建容器会重新生成。想用自己的证书，把 `.crt` / `.key` 挂到上面那两个路径覆盖掉自签的那份即可
> —— 入口脚本看到文件已存在就跳过生成（幂等）。

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
# 1) 备份（下面是最短路径，完整说明见「备份与恢复」一节）
docker compose stop lskypro
tar -C web -czf ~/lsky-pro-backup-$(date +%F-%H%M).tar.gz .
docker compose start lskypro

# 2) compose 里 image 改成 ghcr.io/mole404/lsky-pro-docker:latest，然后
docker compose pull
docker compose up -d --force-recreate

# 3) 验证（核「Apache 实际吐给浏览器」的那份，比看磁盘文件更硬）
#    端口/容器名按你的映射改：compose 默认 9080:8089、容器名 lskypro；上面的 docker run 例子是 8089:8089、lsky-pro
curl -s http://127.0.0.1:8089/js/context-js/context-js.js | md5sum
# 期望：b13fc1e4fede8c55c25862eb13cfcfcf
docker inspect lskypro --format '{{index .Config.Labels "org.opencontainers.image.source"}}'
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

- `public/js/context-js/context-js.js`：原始 `bab81ff5e43b50a760935c7b3ae6475c` → 补丁后 `b13fc1e4fede8c55c25862eb13cfcfcf`
- `resources/js/context-js.js`：原始 `c8e57f6232848ca8277341ddf1a3a7a6` → 补丁后 `b13fc1e4fede8c55c25862eb13cfcfcf`（两份必须一致）
- `resources/views/user/images.blade.php`：原始 `22c896eb7322ec2ff37d5eddd7ca0dec` → 补丁后 `cab1ae9abf815ae3ca30a63608dbf004`
- `app/Services/ImageService.php`：`a7bcd8549c656501a057214637f10b45`（旧 pin）→ `9fb843806abd6b778d8acd3366e2f0f1`（上游 `38d52c46…` 的值）→ `e7edc0fc9dc8c654c4debca0e1d2eac4`（F3：移除 SVG 支持时删掉 svg 分支）
- `config/convention.php`：`674975e4e5561cc15c27626cb1ce5233`（旧 pin）→ `ee439977cfcb2e4d3545b25689198c71`（允许 svg 那版）→ `8136e73b50315d783f105dd4ac9971bb`（F3：后缀白名单去掉 svg）
- 除补丁产物（`context-js.js` 两份 + `images.blade.php`）外，**有意偏离上游**的还有 5 个文件：
  `config/convention.php`、`routes/web.php`、`app/Services/ImageService.php`（上一条，F3 移除 SVG 支持时删了 svg 分支）、
  `routes/auth.php`（F23 给认证类 POST 端点加节流）、`composer.lock`（安全升级）。`src/` 里**其他**文件都应等于上游 `38d52c46…` 的原值
  （CI「自证 1 / 1b」每次构建都会验）

功能上要过的用例：

- iOS Safari 长按图片 → 弹图床自己的菜单（系统菜单不冒头）→ 抬手不会顺手弹出大图预览
- 菜单开着时点别处（含另一张图片）→ **只关菜单**，不开预览、不跳转；再点一次才恢复普通点击
- **菜单还在屏幕上的任何时刻点别的图片都不许点穿**（含刚打开、以及刚关掉还在淡出的那 100ms）
- 手机上点"复制链接" → 二级菜单展开（不再闪一下就没）→ 点 Url / Html / Markdown 能正常复制
- 菜单开着时滚动、缩放、按 Esc → 菜单收起（刚打开 300ms 内它自己引发的滚动不算）
- Windows 右键、Android Chrome 长按 → 菜单照旧
- 单击看大图、拖拽多选、复制链接、重命名、删除、上传、原图与缩略图访问、登录、API
- F23：`curl -sI http://<站点>/` 的响应头里**没有 `X-Powered-By`**，且 `Server` 只写 `Apache`（不带版本号）；
  同一分钟内 `POST /login` 打第 6 次返回 **429**（`/register`、`/confirm-password` 同理，`/forgot-password` 是 6 次）

`test/` 下有一个 node + jsdom 的行为测试（`cd test && npm install && npm test`，会依次跑全量
`*.test.mjs`，任一个失败就非 0 退出），可以在没有 iPhone 的情况下先把每条分支跑一遍；
**Node 需要 ≥ 22.22**（jsdom 30 的 `engines` 要求；Node 18 会在加载 jsdom 时报 `ERR_REQUIRE_ESM`，不是测试失败而是跑不起来）；
真机行为（原生 callout 是否被压掉）仍需真机确认。
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
4. 同步 `workflow` 的 `CONTEXT_JS_MD5` / `BLADE_MD5`（资源版本串走 `Utils::assetVersion()`，不用手改）
5. `cd test && npm test`，然后推 master 等 CI 全绿

### 基镜像 digest 与「试构建」路径（2026-09-30）

Dockerfile 两个 `FROM` 都写成 `php:${PHP_VERSION}-cli|apache-${DEBIAN_RELEASE}@${PHP_*_IMAGE_DIGEST}`，
digest 走 `ARG`（默认值 = 当前 PHP 8.3 对应的 index digest）。

**关键坑**：带 `@digest` 时 **digest 优先、tag 只是装饰**。所以只把 `PHP_VERSION` 改成 8.2、
不同时换 digest，拉到的仍是 8.3 那份内容 —— 构建不会报错，但镜像里是 8.3，随后会被 CI 的
「PHP 版本校验」判红（等于白等一次构建）。这就是 CI「试构建」以前必然失败的根因。

- **试构建怎么用**：Actions → `Build and push image to GHCR` → Run workflow，填 `php_version`
  （如 `8.2`）。CI 的 Resolve 步骤会**自动**按该版本从 Docker Hub 解析出 cli / apache 两个 index digest
  并覆盖 Dockerfile 的 `ARG`。自动解析不可用时，可另填 `php_cli_digest` / `php_apache_digest` 手工指定。
  试构建只推不可变 `sha-<commit>` tag，**不会**动 `latest`。
- **怎么手工更新 digest**（例如上游发了安全修复、或本地/离线构建）：见 `Dockerfile` 顶部
  「F15：基镜像钉 digest」那段注释（Registry API 取 `Docker-Content-Digest` 的两步命令），
  把新值填进 `ARG PHP_CLI_IMAGE_DIGEST` / `ARG PHP_APACHE_IMAGE_DIGEST`。

### 依赖漏洞门禁（OSV，2026-09-30）

CI 在构建前跑一个 `deps-scan` job（`build` 依赖它，门禁不过不构建、更不会推进 `latest`）：

- 工具：官方 `google/osv-scanner` 容器镜像，**钉到版本 + image digest**（可复现，与基镜像同理）。
  更新方式：`docker buildx imagetools inspect ghcr.io/google/osv-scanner:<新版本>` 取顶层 digest，
  改 `.github/workflows/build-image.yaml` 里 `SCANNER=` **那一行**（只有这一处）。
- 扫描对象：`src/composer.lock` 与 `test/package-lock.json`。
- **白名单**：仓库根的 `osv-scanner.toml`（`[[IgnoredVulns]]`）。只有写进去的告警会被过滤
  （日志会打印 `…filtered out because: <reason>`）；**没写进去的新漏洞会让 CI 失败**。
  每条都要有 `reason` 与 `ignoreUntil`（到期自动失效、逼你复审），别当永久豁免。

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
`cab1ae9abf815ae3ca30a63608dbf004`（实测 `md5sum src/resources/views/user/images.blade.php`）。改它就要同步 `Dockerfile` 里那两处（CI 会拦）。

## 运行时版本与依赖（2026-09-28 复核）

- **PHP：8.3**（`Dockerfile` 的 `ARG PHP_VERSION`）。理由：8.1 已 EOL（2025-12-31），8.2 的 EOL 是
  2026-12-31，8.3 支持到 2027-12-31。配套把依赖升到同线最新：`laravel/framework` **9.52.22**
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
- `HTTPS_PORT`：容器内 HTTPS 端口，默认 `8088`。证书是启动时**自签**的（见上面「Nginx 反向代理」一节），
  仅供本机 / 内网调试；对外请用 Nginx 反代，或直接用 `WEB_PORT` 走 HTTP

本 fork 另有一组 `APACHE_*`（Apache MPM 并发/内存相关），默认值面向低配单用户、可逐项覆盖，
见下面「[Apache MPM（并发与内存占用）](#apache-mpm并发与内存占用2026-09-30)」一节。

### Windows内以`WSL`的方式部署`Docker`容器

按照 [#13](https://github.com/HalcyonAzure/lsky-pro-docker/issues/13) 的反馈来看，如果在`Windows`内创建容器出现了将文件挂载于`WSL`内，然后出现了重启系统文件未识别的情况，可以将映射目录修改为类似 `\\wsl$\Ubuntu\path-mount-lsky\` 的形式

## Apache MPM（并发与内存占用，2026-09-30）

镜像内置了一套**面向低配单用户**的 Apache MPM（prefork）参数，覆盖 Debian/php-apache 的出厂值
（出厂是 `StartServers 5` / `MinSpareServers 5` / `MaxSpareServers 10` / `MaxRequestWorkers 150` /
`MaxConnectionsPerChild 0` —— 光常驻就 5 个进程、空闲下限 5 个，对只有自己在用的小机器太重）。

默认值（不设任何 `APACHE_*` 时渲染进 `/etc/apache2/conf-enabled/mpm.conf`）：

```apache
StartServers 2
MinSpareServers 1
MaxSpareServers 3
MaxRequestWorkers 5
MaxConnectionsPerChild 5
KeepAlive Off
```

每一项都能**逐项**用环境变量覆盖（写哪个改哪个，没写的保持默认）：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `APACHE_START_SERVERS` | `2` | 启动时预建的子进程数 |
| `APACHE_MIN_SPARE_SERVERS` | `1` | 空闲子进程下限 |
| `APACHE_MAX_SPARE_SERVERS` | `3` | 空闲子进程上限 |
| `APACHE_MAX_REQUEST_WORKERS` | `5` | 并发请求上限（内存占用的主要来源） |
| `APACHE_MAX_CONNECTIONS_PER_CHILD` | `5` | 单个子进程处理多少个请求后回收；`0` = 永不回收（合法，但内存只涨不落） |
| `APACHE_KEEP_ALIVE` | `Off` | 只接受 `On` / `Off`（大小写不敏感）；`Off` 时连接用完即关，最省内存 |

两个**可选**变量本身没有默认值，只在 `APACHE_KEEP_ALIVE=On` 且显式设置时才各多写一行；
不设就整行不出现，即**跟随 Apache 发行版默认：`KeepAliveTimeout` 5 秒 / `MaxKeepAliveRequests` 100**：

| 环境变量 | 渲染出的行 |
|---|---|
| `APACHE_KEEPALIVE_TIMEOUT` | `KeepAliveTimeout <值>`（仅 `KeepAlive On` 时） |
| `APACHE_MAX_KEEPALIVE_REQUESTS` | `MaxKeepAliveRequests <值>`（仅 `KeepAlive On` 时） |

> 开了 KeepAlive 又想省内存，建议显式写 `APACHE_KEEPALIVE_TIMEOUT=2`；
> **别写 `0`** —— 在 Apache 里 0 不是「更省」而是「不限制」，长连接会一直挂着占进程和内存。
> `APACHE_MAX_KEEPALIVE_REQUESTS` 同理（单条连接最多复用多少次），也别写 0。
> 两个变量写了非法值（非正整数）只会被忽略并打警告，不会让容器起不来。

**值写错不会让容器起不来**：任何一项写了非法值（非整数、越界、`APACHE_KEEP_ALIVE` 不是 On/Off、
两个可选值不是正整数），都只把**那一项**退回默认值并在日志打一行 `[lsky] 警告：…`，其余项照常生效；
`MaxRequestWorkers ≥ MaxSpareServers ≥ MinSpareServers ≥ 1` 不满足时同样只回退出问题的那一项。
渲染彻底失败（模板缺失 / 目标不可写）也只打警告，容器照常启动。

每次启动都按当前环境变量重新渲染（幂等，以 compose/环境变量为准），启动日志里有摘要：

```
[lsky] Apache MPM 已写入 /etc/apache2/conf-enabled/mpm.conf：StartServers=2 MinSpareServers=1 MaxSpareServers=3 MaxRequestWorkers=5 MaxConnectionsPerChild=5 KeepAlive=Off（KeepAlive=Off，未写 KeepAliveTimeout / MaxKeepAliveRequests）
```

自查：`docker compose logs lskypro | grep '\[lsky\]'`，或进容器 `cat /etc/apache2/conf-enabled/mpm.conf`。

**人多/高配的参考值**（加进 compose 的 `environment`；示例：8 核 8G、十来个人同时用）：

```yaml
environment:
  - APACHE_START_SERVERS=5
  - APACHE_MIN_SPARE_SERVERS=5
  - APACHE_MAX_SPARE_SERVERS=10
  - APACHE_MAX_REQUEST_WORKERS=25
  - APACHE_MAX_CONNECTIONS_PER_CHILD=5000
  - APACHE_KEEP_ALIVE=On
  - APACHE_KEEPALIVE_TIMEOUT=2
  - APACHE_MAX_KEEPALIVE_REQUESTS=50
```

按「一个 prefork 子进程跑起 Laravel 后 ≈ 30–50MB」估算 `MaxRequestWorkers × 单进程内存 ≤ 机器可用内存`，
**宁小勿大** —— 超了被 OOM 杀掉比排队慢得多。

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

## 备份与恢复

备份只关心**一个东西**：映射到容器 `/var/www/html` 的那个数据卷
（`docker-compose.yaml` 里是 `$PWD/web:/var/www/html/`；上面 `docker run` 例子里是 `$PWD/lsky:/var/www/html`）。
卷里的应用代码丢了无所谓 —— 重新 pull 镜像就有、入口脚本会自己同步回去；下面这些才是**站点数据，丢了不可再生**：

| 卷内路径 | 是什么 |
| --- | --- |
| `.env` | 站点配置：`APP_KEY`、数据库连接、云存储密钥（**丢了 = 登录态失效 / 读不出数据**） |
| `database/` | SQLite 单文件数据库，默认 `<卷>/database/database.sqlite` |
| `storage/` | 上传的图片、日志、会话、编译视图缓存 |
| `installed.lock` | 「已安装」标记；缺失会被当成没装过，跳回安装向导 |
| `public/thumbnails/` | 生成的缩略图 |
| `public/i` | 本地存储策略的软链/目录（部署产物） |
| `bootstrap/cache/` | 站点自己的运行时缓存（`config.php` 等站内配置缓存；`packages.php` / `services.php` 启动时按当前镜像重建） |

其余路径（`app/` `resources/` `public/js/` `vendor/` …）都是镜像里那份代码，属于**可重建**的部分：
换镜像时入口脚本会按版本标记把它们覆盖回卷里（见上面「已有部署升级」）。

### 备份

```bash
cd <docker-compose.yaml 所在目录>
docker compose stop lskypro     # 先停：SQLite 是单文件，运行中直拷可能拿到「事务进行到一半」的状态
tar -C web -czf ~/lsky-backup-$(date +%F-%H%M).tar.gz .   # 卷目录按你自己的映射改（compose 默认 web，docker run 例子里是 lsky）
docker compose start lskypro
```

不停容器也能打包（Linux 上正在被写的文件照样拷得下来），但那样别指望 `database/` 里那份 SQLite
快照是干净的 —— 单文件数据库先停容器再拷，这一点最容易翻车。

### 恢复

```bash
docker compose stop lskypro
mkdir -p web && tar -C web -xzf ~/lsky-backup-2026-10-01-1200.tar.gz   # 卷目录同上；先清空再解更稳
docker compose up -d --force-recreate
```

- **属主不用管**：入口脚本每次启动都会对整卷 `chown -R www-data` + `chmod -R 755`
  （只有你在容器**外**手工改文件时才需要自己 `chown -R www-data <卷目录>`；属主不对的表现是上传/改设置失败）。
- 归档里带着 `.code-revision`：它和当前镜像的标记一致就跳过代码同步（原样跑）；不一致（归档来自旧镜像）
  就会把镜像版本同步进卷 —— 两种都是预期行为，不用手动干预。
- 换机器迁移 = 把归档解开到新机器的卷目录 + 同一份 `docker-compose.yaml` 起容器，不需要改任何代码。

> 上游有一份自己的备份/升级说明（[升级｜Lsky Pro](https://docs.lsky.pro/docs/free/v2/quick-start/upgrade.html)，
> 上游文档、可能变动；上游已停止维护，链接随时可能失效）。它讲的是**上游应用本身**，跟本镜像的卷布局、
> 入口脚本行为都对不上 —— 以本节为准；本节是按本仓库 `entrypoint.sh` 与 `docker-compose.yaml` 的实际行为写的。

## 致谢与许可

- 应用本体：[lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（GPL-3.0）
- Docker 打包：fork 自 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker)（AGPL-3.0）
- `resources/js/context-js.js` 源自 Jacob Kelley 的 Context.js（MIT），上游由 WispX 修改

- vendored 的应用源码保留上游 `src/LICENSE`（**GPL-3.0**）与全部署名；本仓库自身的打包脚本沿用
  HalcyonAzure 那份 `LICENSE`（AGPL-3.0）。均未删除任何版权与致谢信息。
