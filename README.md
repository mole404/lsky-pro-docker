# Lsky Pro Docker 镜像（含 iOS 长按菜单修复）

本仓库是 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker) 的个人 fork，
用来给 [lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（兰空图床）打个前端补丁：
**修复 iOS Safari 上长按图片无法弹出图床自定义菜单的问题**。

- 本 fork 镜像：`ghcr.io/mole404/lsky-pro-docker:latest`
  （另有按源码 commit 命名的 tag，如 `:911275c13b038c7a8b710de44664f23887eeb6f6`）
- 上游镜像：`halcyonazure/lsky-pro-docker:latest`

## 与上游的差异

1. **源码钉死在 `911275c`**，不再在构建时拉 `master.zip`。
   证据：`halcyonazure/lsky-pro-docker:latest` 在 Docker Hub 上最后更新于 2024-04-29，
   而当时 lsky-pro 的 `master` HEAD 正是 `911275c`（2023-05-16，之后停更到 2024-12）。
   也就是说**这个镜像 = 当前线上那份代码 + 前端补丁**，除补丁外行为逐字节不变。
2. **叠加 `overlay/` 前端补丁**：`context-js.js`（iOS 长按）+ `images.blade.php`（脚本版本串）。
3. 基础镜像显式写成 Debian **bookworm** 变体（与 2024-04 那版镜像同一 Debian 大版本），
   `install-php-extensions` 钉到具体版本（不再用 `latest`）。
4. **构建期自证**：源码快照与补丁产物都用 md5 断言，对不上直接构建失败（见 Dockerfile「自证 1/2」）。
5. CI 推到 GHCR（用仓库自带 `GITHUB_TOKEN`，不需要任何 secret），构建后把镜像拉回来做真机自证：
   核 md5 + 记录 PHP/扩展/Debian 版本 + 真起容器 curl 安装页。
   上游的「每天定时重建」已去掉（源码钉死后定时重建没有意义）。

## 这个补丁修的是什么

**根因**：iOS 上的 WebKit **永远不会派发 `contextmenu` 事件**
（[WebKit bug 213953](https://bugs.webkit.org/show_bug.cgi?id=213953)），长按图片只会弹系统 callout。
而图床的右键菜单完全挂在 `contextmenu` 上（`resources/js/context-js.js` 里的
`$(document).on('contextmenu', selector, ...)`，由 `resources/views/user/images.blade.php`
的 `context.attach()` 注册），于是 iPhone/iPad 上那段处理函数**一次都不会执行**，
"我的图片"页的长按菜单彻底不可用。

**补法**（三层，缺一层都会残留问题）：

- **长按识别**：`touchstart` + 500ms 定时器，复用同一段开菜单逻辑 —— 因为 iOS 收不到 `contextmenu`，只能自己判长按
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

- `overlay/context-js.js` → 同时写入 `resources/js/context-js.js` 与 `public/js/context-js/context-js.js`
  （上游 `webpack.mix.js` 里本来也是 `mix.copy('resources/js/context-js.js', 'public/js/context-js')`，
  但仓库里 `public/` 下那份是旧工具链留下的压缩产物，一直没跟着源码更新，所以两个位置都要覆盖）
- `overlay/images.blade.php` → 写入 `resources/views/user/images.blade.php`，只改一行：
  给脚本加 `?v=ios-longpress`，避免 iOS/Safari 的启发式缓存把旧版 JS 一直喂给老用户
- 完整 diff 见 `patches/ios-longpress.patch`（存档用，构建实际走 `overlay/`）

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

## 已有部署升级（重点：**别只 pull 换镜像**）

容器启动脚本 `entrypoint.sh` 只在卷里**还没有 `public/index.php`** 时才把 `/var/www/lsky/*`
播种到 `/var/www/html`。也就是说：**换镜像不会更新已有卷里的代码**，
只 `docker pull && up -d` 会得到一个「镜像换了、代码还是旧的」的假象。

因此升级是「只替换补丁涉及的文件」：数据库、`.env`（APP_KEY）、`storage/app/uploads`
里的图片、`public/i` 软链一个字节都不动。

```bash
# 1) 备份（SQLite 用户：先停容器再打包，保证数据库文件一致）
docker stop lsky-pro
tar czf ~/lsky-pro-backup-$(date +%F-%H%M).tar.gz -C /root lsky-pro
docker start lsky-pro

# 2) 拉新镜像，先对比基础层（PHP / 扩展 / Debian 是否与现在一致）
docker pull ghcr.io/mole404/lsky-pro-docker:latest
docker run --rm --entrypoint sh ghcr.io/mole404/lsky-pro-docker:latest \
  -c 'grep PRETTY_NAME /etc/os-release; php -v | head -1; php -m | sort | tr "\n" " "'
docker exec lsky-pro sh \
  -c 'grep PRETTY_NAME /etc/os-release; php -v | head -1; php -m | sort | tr "\n" " "'

# 3) 把补丁文件写进卷（下面假定卷挂在 /root/lsky-pro/data，按实际情况改）
docker run --rm --entrypoint cp -v /root/lsky-pro/data:/dst \
  ghcr.io/mole404/lsky-pro-docker:latest \
  /var/www/lsky/public/js/context-js/context-js.js /dst/public/js/context-js/context-js.js

# 4) blade 改过一行，清掉编译视图缓存（只删缓存，不碰数据）
docker exec lsky-pro rm -rf /var/www/html/storage/framework/views/*

# 5) 切换镜像并重建（compose 里 image 改成 ghcr.io/mole404/lsky-pro-docker:latest）
docker compose up -d --force-recreate

# 6) 验证
docker exec lsky-pro md5sum /var/www/html/public/js/context-js/context-js.js
# 期望：5e4426728badb7fad4805383f72a0604
```

### 回滚（两步，都在一分钟内）

```bash
# a. 代码回滚：从备份里解出那个文件
tar xzf ~/lsky-pro-backup-*.tar.gz -C /root lsky-pro/data/public/js/context-js/context-js.js
docker exec lsky-pro rm -rf /var/www/html/storage/framework/views/*
# b. 镜像回滚：compose 的 image 改回 halcyonazure/lsky-pro-docker:latest，然后
docker compose up -d --force-recreate
```

## 验证清单

镜像里这些文件的 md5（补丁之外的每个文件都应当与线上那份旧镜像一致）：

- `public/js/context-js/context-js.js`：补丁前 `bab81ff5e43b50a760935c7b3ae6475c` → 补丁后 `5e4426728badb7fad4805383f72a0604`
- `resources/js/context-js.js`：补丁前 `c8e57f6232848ca8277341ddf1a3a7a6` → 补丁后 `5e4426728badb7fad4805383f72a0604`
- `resources/views/user/images.blade.php`：补丁前 `22c896eb7322ec2ff37d5eddd7ca0dec` → 补丁后 `864b0bad9c2b65161861d228776bb92f`
- `app/Services/ImageService.php` `a7bcd8549c656501a057214637f10b45`、`config/convention.php` `674975e4e5561cc15c27626cb1ce5233`：**不变**

功能上要过的用例：

- iOS Safari 长按图片 → 弹图床自己的菜单（系统菜单不冒头）→ 抬手不会顺手弹出大图预览
- Windows 右键、Android Chrome 长按 → 菜单照旧
- 单击看大图、拖拽多选、复制链接、重命名、删除、上传、原图与缩略图访问、登录、API

`test/` 下有一个 node + jsdom 的行为测试（`cd test && npm install && npm test`），
可以在没有 iPhone 的情况下先把每条分支跑一遍；真机行为（原生 callout 是否被压掉）仍需真机确认。

## 维护

**想跟上游更新**（例如吃进 master 上的 SVG 支持等修复）：

1. 改 `Dockerfile` 里的 `LSKY_COMMIT` 为新 commit
2. 重新生成 `overlay/`：取出新 commit 的 `resources/js/context-js.js` 与
   `resources/views/user/images.blade.php`，重新应用 `patches/ios-longpress.patch`
3. 同步更新 Dockerfile「自证 1/2」里的 md5，以及 `.github/workflows/build-image.yaml` 里的 `CONTEXT_JS_MD5`
4. 推 master，等 CI 自证通过

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

使用`MySQL`来作为数据库的话可以参考原项目 [#256](https://github.com/lsky-org/lsky-pro/issues/256) 来创建`docker-compose.yaml`，本仓库的 `docker-compose.yaml` 是其参考内容（镜像地址已指向本 fork）。

原项目：[☁️兰空图床(Lsky Pro) - Your photo album on the cloud.](https://github.com/lsky-org/lsky-pro)

## 构建您自己的镜像

Dockerfile 已经是多段构建，无需手动拉源码，也不需要 Node 工具链（补丁直接覆盖编译好的前端文件）：

```bash
docker build -t lsky-pro-docker .
```

多架构：

```bash
docker buildx create --use
docker buildx build --platform linux/amd64,linux/arm64 -t lsky-pro-docker .
```

## 手动备份/升级

如果需要迁移数据库/手动升级`Lsky-Pro`，可以参考官方文档：[升级｜Lsky Pro](https://docs.lsky.pro/docs/free/v2/quick-start/upgrade.html)，来备份主要文件以进行恢复/升级

## 致谢与许可

- 应用本体：[lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（GPL-3.0）
- Docker 打包：fork 自 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker)（AGPL-3.0）
- `resources/js/context-js.js` 源自 Jacob Kelley 的 Context.js（MIT），上游由 WispX 修改

本仓库保留上游 `LICENSE`（AGPL-3.0）与全部署名，未删除任何版权与致谢信息。
