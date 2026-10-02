基于 [Lsky Pro](https://github.com/lsky-org/lsky-pro) 开源版大幅改动，全面面向个人自用优化，但仍保留多用户支持。
**适配 iOS 图片长按，UI 全面焕新，适配亮色/暗色模式，升级 PHP 8.3 依赖，新增图片标签功能，去除画廊，去除图片公开/私有设置**

> 这是自维护镜像（非官方）。应用源码 vendored 在本仓库 `src/` 里，构建不联网拉上游。

镜像地址：`ghcr.io/mole404/lsky-pro-docker:latest`

---

## 特性

- **全平台适配**：兼容所有平台浏览器，修复上游开源版无法在 iOS 长按的问题，优化交互。
- **开箱即用**：默认用 SQLite，不需要额外跑一个数据库服务；容器首次部署后浏览器打开就是安装向导。
- **低配友好**：默认 Web 服务并发参数专为低配服务器优化，参数都可以通过环境变量单项覆盖。
- **安全加固**：登录/注册等认证接口增加限流，不采信客户端伪造的转发头，移除了 SVG 上传，并淘汰了一批带 CVE 的依赖。
- **界面清爽**：整套前端 UI 重做，简洁风格 + 亮色/暗色/跟随系统。
- **图库功能**：支持**图片标签** —— 给单张或多张图片打标、在图片墙上按标签筛选、卡片上直接显示标签；标签按用户隔离，互相不可见。

---

## 快速开始

Docker Compose（推荐）：

```yaml
services:
  lsky-pro:
    image: ghcr.io/mole404/lsky-pro-docker:latest
    container_name: lsky-pro
    restart: unless-stopped
    ports:
      - "127.0.0.1:8089:8089"                 # 宿主端口:容器端口（WEB_PORT）
    volumes:
      - $PWD/lsky-pro/data:/var/www/html      # 站点数据全在这个目录里（$PWD = 你执行 compose 时所在的目录）
    environment:
      - WEB_PORT=8089
```

或使用等价的 `docker run`：

```bash
docker run -d --name lsky-pro --restart unless-stopped \
    -p 127.0.0.1:8089:8089 \
    -v "$PWD/lsky-pro/data:/var/www/html" \
    -e WEB_PORT=8089 \
    ghcr.io/mole404/lsky-pro-docker:latest
```

容器挂载卷路径可按你的实际情况改（上例是 `$PWD/lsky-pro/data`，`$PWD` 就是你执行命令时所在目录）。  
上面把端口只绑到 `127.0.0.1`：生产环境推荐这样，再在前面放一层 Nginx 反代来终结 TLS，容器本身不用直接对外。

### 首次安装

1. 容器首次部署后访问 `http://<主机>:8089/`，会自动跳到安装向导，**更推荐设置反代访问**。
2. 按向导填写数据库（默认 SQLite，路径可留空）与管理员账号密码。

### 从上游开源版 Lsky-Pro V2.1 升级

1. **完整备份数据目录（必做）**
2. docker stop 旧容器名（如 lsky-pro）
3. docker rm 旧容器名（如 lsky-pro）
4. 根据旧版镜像数据挂载路径，编辑新镜像挂载卷路径，新版与上游旧版读取路径完全兼容，**务必确保挂载卷与旧版一致，挂载错误进去会报500（数据不会丢）**
5. 挂载卷路径设置完成后，拉取本仓库镜像部署即可完成升级

---

## 常见配置

### 端口

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `8089` | 容器内 Web 服务的 HTTP 端口 |
| `HTTPS_PORT` | `8088` | 容器内 HTTPS 端口（自签证书，仅供内网调试） |

自签证书不随镜像发放、也不进数据卷：每个容器首次启动自己生成。想用自己的证书，把 `.crt` / `.key` 挂到容器内 `/etc/apache2/ssl/lsky-selfsigned.crt` 与 `.key` 覆盖即可。

### 并发与内存

镜像默认内置一套面向小内存单用户的参数。每一项都能用环境变量单独覆盖：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APACHE_START_SERVERS` | `2` | 启动时预建的子进程数 |
| `APACHE_MIN_SPARE_SERVERS` | `1` | 空闲子进程下限 |
| `APACHE_MAX_SPARE_SERVERS` | `3` | 空闲子进程上限 |
| `APACHE_MAX_REQUEST_WORKERS` | `5` | 并发请求上限（内存占用的主要来源） |
| `APACHE_MAX_CONNECTIONS_PER_CHILD` | `5` | 单个子进程处理多少个请求后回收（`0` = 永不回收） |
| `APACHE_KEEP_ALIVE` | `Off` | 只接受 `On` / `Off`；`Off` 最省内存 |

如果您不知道这些参数起什么作用，请不要随意修改，否则有爆内存风险。  
面向个人自用以上参数保持默认值即可，多用户场景下可增大。

---

## 关于这个仓库

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

**非官方镜像，自用为主**  
**使用前请自行判断是否符合你的需求与合规要求**  
**如果有其他需求，请自行 Fork 修改，本人不提供维护保障，不保证处理 issue 和 PR**
