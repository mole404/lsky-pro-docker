# Lsky Pro Docker 镜像

基于 [Lsky Pro](https://github.com/lsky-org/lsky-pro) 的自维护 Docker 镜像：
应用源码 vendored 在本仓库的 `src/` 里，构建不联网拉上游，直接用本仓库内的源码。

- 镜像：`ghcr.io/mole404/lsky-pro-docker:latest`
  （同一提交另发布不可变 tag：`ghcr.io/mole404/lsky-pro-docker:sha-<完整 commit>`）
- 本仓库源码相对上游的偏离清单维护在 `tools/diff-vs-upstream.sh`，可随时用
  `bash tools/diff-vs-upstream.sh` 自行核对。

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

卷目录按你的实际情况改（上例是宿主 `/root/lsky-pro/data`）。上面把端口只绑到 `127.0.0.1`，
生产环境推荐这样，再在前面放一层 Nginx 反代终结 TLS。

## 首次安装与访问

1. 容器起来后访问 `http://<主机>:8089/`，会自动跳到安装向导。
2. 按向导填写数据库（默认 SQLite，镜像自带驱动，不需要额外数据库服务）与管理员账号。
3. 安装结果写进卷里的 `.env` 与 `database/` —— 也就是说**备份卷就等于备份了配置与数据**。

## 升级

```bash
docker compose pull
docker compose up -d          # 不需要 --force-recreate
```

同一个 tag 下镜像 digest 变了，compose 会自己重建容器。入口脚本会按版本标记把新代码同步进卷、
并作废编译视图缓存；`.env` / `database/` / `storage/` 等站点数据保持不变。

## 备份与恢复

### 备份

备份整个卷目录，别只抓 `database.sqlite` 一个文件：

```bash
docker compose stop lsky-pro
tar -C /root/lsky-pro/data -czf ~/lsky-backup-$(date +%F-%H%M).tar.gz .
docker compose start lsky-pro
```

为什么整目录：SQLite 开了 WAL（`journal_mode=WAL`），写入过程中的新数据会短暂落在同目录的
`database.sqlite-wal` / `-shm` 伴生文件里。只拷主文件可能拿到不一致的快照，整个目录一起打包
才是完整的。先停容器再拷最稳（单文件数据库运行中直拷最容易翻车）。

卷里哪些是数据、哪些是可替换代码：

- **丢了不可再生，务必备份**：`.env`（配置与密钥）、`database/`（SQLite 数据库）、
  `storage/`（上传的图片、日志、会话）、`bootstrap/cache/`、`public/thumbnails/`、
  `public/i`（本地存储策略的软链/目录）、`installed.lock`（已安装标记）。
- **可重建，不用备份**：`app/`、`config/`、`resources/`、`routes/`、`public/js`、`public/css`、
  `vendor/` 等 —— 它们就是镜像里的代码，换镜像时入口脚本会同步回去。

### 恢复

```bash
docker compose stop lsky-pro
mkdir -p /root/lsky-pro/data
tar -C /root/lsky-pro/data -xzf ~/lsky-backup-YYYY-MM-DD-HHMM.tar.gz
docker compose up -d
```

属主不用管：入口脚本每次启动都会对整卷做 `chown -R www-data` + `chmod -R 755`。
换机器迁移 = 把归档解到新机器的卷目录 + 复用同一份 `compose.yaml`。

## 常见配置

### 端口与证书

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `8089` | 容器内 Apache 的 HTTP 监听端口 |
| `HTTPS_PORT` | `8088` | 容器内 HTTPS 端口（自签证书，仅供内网调试） |

自签证书落在容器里的 `/etc/apache2/ssl/lsky-selfsigned.crt` 与 `.key`（CN=lsky-pro，RSA 2048，
3650 天），**不随镜像发货、也不进数据卷**：每个容器首次启动自己生成，重建容器会重新生成。
想用自己的证书，把 `.crt` / `.key` 挂载到这两个路径覆盖即可（入口脚本见到文件已存在就跳过生成）。

### Apache MPM（并发与内存）

镜像内置一套面向低配单用户的参数，覆盖 Apache 的出厂值。每一项都能**逐项**用环境变量覆盖，
写哪个改哪个、没写的保持默认：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APACHE_START_SERVERS` | `2` | 启动时预建的子进程数 |
| `APACHE_MIN_SPARE_SERVERS` | `1` | 空闲子进程下限 |
| `APACHE_MAX_SPARE_SERVERS` | `3` | 空闲子进程上限 |
| `APACHE_MAX_REQUEST_WORKERS` | `5` | 并发请求上限（内存占用的主要来源） |
| `APACHE_MAX_CONNECTIONS_PER_CHILD` | `5` | 单个子进程处理多少个请求后回收（`0` = 永不回收） |
| `APACHE_KEEP_ALIVE` | `Off` | 只接受 `On` / `Off`；`Off` 时连接用完即关，最省内存 |

另有两个**可选**变量，只在 `APACHE_KEEP_ALIVE=On` 且显式设置时才各多写一行，不设就跟随
Apache 发行版默认（`KeepAliveTimeout` 5 秒 / `MaxKeepAliveRequests` 100）：

| 环境变量 | 渲染出的行 |
| --- | --- |
| `APACHE_KEEPALIVE_TIMEOUT` | `KeepAliveTimeout <值>`（仅 `KeepAlive On` 时） |
| `APACHE_MAX_KEEPALIVE_REQUESTS` | `MaxKeepAliveRequests <值>`（仅 `KeepAlive On` 时） |

写了非法值只会把**那一项**退回默认值并在日志打一行警告，不会让容器起不来。取值按
「一个 Apache 子进程跑起 Laravel 后 ≈ 30–50MB」估算 `MaxRequestWorkers × 单进程内存 ≤ 机器可用内存`，
宁小勿大 —— 超了被 OOM 杀掉比排队慢得多。

## 许可与致谢

- 应用本体：[lsky-org/lsky-pro](https://github.com/lsky-org/lsky-pro)（GPL-3.0）；
  `src/` 保留上游的 `LICENSE` 与全部署名。
- Docker 打包：fork 自 [HalcyonAzure/lsky-pro-docker](https://github.com/HalcyonAzure/lsky-pro-docker)
  （AGPL-3.0），本仓库自身的打包脚本沿用该许可。
