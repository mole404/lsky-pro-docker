# Lsky Pro Docker 镜像

把 [Lsky Pro](https://github.com/lsky-org/lsky-pro) 图床打包成**一条命令就能跑起来、配置和数据都收在一个目录里**的 Docker 镜像。

用途很直白：你有自己的服务器，想要一个能传图、能管图、能对外分享链接的私人图床，但不想为了它去折腾 PHP 版本、依赖、数据库、证书这一串东西。

> 这是自维护镜像（非官方）。应用源码 vendored 在本仓库 `src/` 里，构建不联网拉上游。

镜像地址：`ghcr.io/mole404/lsky-pro-docker:latest`
（每次构建同时发布一个不可变的 `ghcr.io/mole404/lsky-pro-docker:sha-<完整 commit>`）

---

## 这个镜像能给你什么

- **开箱即用**：默认用 SQLite，不需要额外跑一个数据库服务；容器起来后浏览器打开就是安装向导。
- **数据 = 一个目录**：配置、数据库、上传的图片全在同一个卷里 —— 备份这个目录就等于备份了整个图床，换机器解压回去就能继续用。
- **版本可追溯**：每次构建都会发布一个永不变化的 `sha-<commit>` 镜像，随时能回到任意历史版本，不怕"最新版翻车回不去"。
- **低配机器友好**：默认的 Web 服务并发参数是按小内存服务器调过的，也都可以用环境变量单项覆盖。
- **安全上做过一轮加固**：登录/注册等认证接口有限流，不采信客户端伪造的转发头，移除了 SVG 上传，并升级了一批带 CVE 的依赖。
- **界面清爽**：整套前端重做过，简洁风格 + 亮色/暗色/跟随系统。
- **图库功能**：支持**图片标签** —— 给单张或多张图片打标、在图片墙上按标签筛选、卡片上直接显示标签；标签按用户隔离，互相看不见。

---

## 快速开始

`compose.yaml`：

```yaml
services:
  lsky-pro:
    image: ghcr.io/mole404/lsky-pro-docker:latest
    container_name: lsky-pro
    restart: unless-stopped
    ports:
      - "127.0.0.1:8089:8089"                 # 宿主端口:容器端口（WEB_PORT）
    volumes:
      - /root/lsky-pro/data:/var/www/html     # 站点数据全在这个目录里
    environment:
      - WEB_PORT=8089
```

等价的 `docker run`：

```bash
docker run -d --name lsky-pro --restart unless-stopped \
    -p 127.0.0.1:8089:8089 \
    -v /root/lsky-pro/data:/var/www/html \
    -e WEB_PORT=8089 \
    ghcr.io/mole404/lsky-pro-docker:latest
```

卷路径按你的实际情况改（上例是宿主 `/root/lsky-pro/data`）。上面把端口只绑到 `127.0.0.1`：生产环境推荐这样，再在前面放一层 Nginx 反代来终结 TLS，容器本身不用直接对外。

### 首次安装

1. 容器起来后访问 `http://<主机>:8089/`，会自动跳到安装向导。
2. 按向导填写数据库（默认 SQLite，镜像自带驱动）与管理员账号。
3. 安装结果写进卷里的 `.env` 与 `database/`。

---

## 升级

```bash
docker compose pull
docker compose up -d          # 不需要 --force-recreate
```

只要镜像的 digest 变了，compose 就会自己重建容器。入口脚本会把新版本代码同步进卷，并清掉编译视图缓存；`.env` / `database/` / `storage/` 这些站点数据保持不动。

**想稳妥一点，就把版本钉死**：把 `image:` 那行换成某个 `sha-<完整 commit>` tag，它就永远拉那个版本，升级与否完全由你决定；想升级再改成新的 sha —— 这也正是回滚的用法。

> `:latest` 只在 master 分支的构建通过镜像自证后才会被指过去；测试分支的构建只产出 `sha-` 镜像，不会影响 `latest`。

---

## 备份与恢复

### 备份

备份**整个卷目录**，别只抓 `database.sqlite` 一个文件：

```bash
docker compose stop lsky-pro
tar -C /root/lsky-pro/data -czf ~/lsky-backup-$(date +%F-%H%M).tar.gz .
docker compose start lsky-pro
```

为什么要整目录：数据库开了 WAL 模式，写入过程中的新数据会短暂落在同目录的 `database.sqlite-wal` 伴生文件里，只拷主文件可能拿到不一致的快照。先停容器再打包最稳。

卷里哪些是数据、哪些是可替换代码：

- **丢了不可再生，务必备份**：`.env`（配置与密钥）、`database/`（SQLite 数据库）、`storage/`（上传的图片、日志、会话）、`bootstrap/cache/`、`public/thumbnails/`、`public/i`（本地存储策略的目录）、`installed.lock`（已安装标记）。
- **可重建，不用备份**：`app/`、`config/`、`resources/`、`routes/`、`public/js`、`public/css`、`vendor/` 等 —— 它们就是镜像里的代码，换镜像时入口脚本会同步回去。

### 恢复

```bash
docker compose stop lsky-pro
mkdir -p /root/lsky-pro/data
tar -C /root/lsky-pro/data -xzf ~/lsky-backup-YYYY-MM-DD-HHMM.tar.gz
docker compose up -d
```

属主不用管：入口脚本每次启动都会把整个卷的属主和权限理顺。换机器迁移 = 把归档解到新机器的卷目录 + 复用同一份 `compose.yaml`。

---

## 常见配置

### 端口

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `8089` | 容器内 Web 服务的 HTTP 端口 |
| `HTTPS_PORT` | `8088` | 容器内 HTTPS 端口（自签证书，仅供内网调试） |

自签证书不随镜像发货、也不进数据卷：每个容器首次启动自己生成。想用自己的证书，把 `.crt` / `.key` 挂到容器内 `/etc/apache2/ssl/lsky-selfsigned.crt` 与 `.key` 覆盖即可。

### 并发与内存（低配机器重点看）

镜像内置一套面向小内存单用户的参数。每一项都能用环境变量单独覆盖，写哪个改哪个：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APACHE_START_SERVERS` | `2` | 启动时预建的子进程数 |
| `APACHE_MIN_SPARE_SERVERS` | `1` | 空闲子进程下限 |
| `APACHE_MAX_SPARE_SERVERS` | `3` | 空闲子进程上限 |
| `APACHE_MAX_REQUEST_WORKERS` | `5` | 并发请求上限（内存占用的主要来源） |
| `APACHE_MAX_CONNECTIONS_PER_CHILD` | `5` | 单个子进程处理多少个请求后回收（`0` = 永不回收） |
| `APACHE_KEEP_ALIVE` | `Off` | 只接受 `On` / `Off`；`Off` 最省内存 |

取值按「一个 Web 子进程跑起应用后 ≈ 30–50MB」估算，让 `MaxRequestWorkers × 单进程内存 ≤ 机器可用内存`，宁小勿大 —— 并发开太大被系统 OOM 杀掉，比多排一会儿队糟得多。写了非法值只会把那一项退回默认并在日志里警告，不会让容器起不来。

---

## 关于这个仓库本身

- `src/` 是 vendored 的上游应用源码（上游已声明停止维护），本仓库在自己的分支上做了维护性修改与功能补充。
- **相对上游改了哪些文件、为什么改**，全部登记在一份清单里，可随时自查：

  ```bash
  bash tools/diff-vs-upstream.sh
  ```

  它会把仓库里的 `src/` 与上游快照逐文件对比，并校验所有偏差都落在"已知偏离清单"内 —— 只要它不报错，改动就恰好是清单里那些。
- **标签数据自检**（只读，检查有没有残留的关联行）：

  ```bash
  docker cp tools/check-tag-integrity.php lsky-pro:/tmp/
  docker exec lsky-pro php /tmp/check-tag-integrity.php
  ```
- **本地测试**：`cd test && npm test`（用 jsdom + 真实 jQuery 跑图片页的交互路径）。
- `patches/` 里是一份"给人看的"补丁存档（不参与构建 —— 构建用的就是 `src/` 里的文件）。

---

## 许可与致谢

- 应用本体：[lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（GPL-3.0）；`src/` 保留上游的 `LICENSE` 与全部署名。
- Docker 打包：fork 自 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker)（AGPL-3.0），本仓库自身的打包脚本沿用该许可。

非官方镜像，自用为主。使用前请自行判断是否符合你的需求与合规要求。
