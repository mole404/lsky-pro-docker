#!/bin/bash
set -eu

WEB_PORT=${WEB_PORT:-8089}
HTTPS_PORT=${HTTPS_PORT:-8088}

envsubst '${WEB_PORT} ${HTTPS_PORT}' < /etc/apache2/sites-enabled/000-default.conf.template > /etc/apache2/sites-enabled/000-default.conf
envsubst '${WEB_PORT} ${HTTPS_PORT}' < /etc/apache2/ports.conf.template > /etc/apache2/ports.conf

# ---------------------------------------------------------------- Apache MPM（低配单用户默认值 + APACHE_* 逐项覆盖）
# 背景：Debian/php-apache 的出厂 MPM 是 prefork（StartServers 5 / MinSpareServers 5 /
# MaxSpareServers 10 / MaxRequestWorkers 150 / MaxConnectionsPerChild 0），对低配单用户机太重。
# apache2.conf 先 include mods-enabled（出厂 mpm_prefork.conf）、再 include conf-enabled，后者覆盖前者 ——
# 所以把轻量值渲染进 /etc/apache2/conf-enabled/mpm.conf 就能生效。
# 每次启动都按当前环境变量重新渲染（幂等，以 compose/环境变量为准）。
# 脏值处理原则：只把「出问题的那一项」退回默认值并打警告 —— 绝不整份回退，更不让容器启动失败。
MPM_DEF_START_SERVERS=2
MPM_DEF_MIN_SPARE_SERVERS=1
MPM_DEF_MAX_SPARE_SERVERS=3
MPM_DEF_MAX_REQUEST_WORKERS=5
MPM_DEF_MAX_CONNECTIONS_PER_CHILD=5
MPM_DEF_KEEP_ALIVE=Off
MPM_TEMPLATE=/etc/apache2/mpm.conf.template
MPM_TARGET=/etc/apache2/conf-enabled/mpm.conf

mpm_warn() { echo "[lsky] 警告：Apache MPM $*"; }

# 数值项：必须是不小于下限的十进制整数，否则只把这一项退回默认值（回显合法值）
mpm_num() { # $1=变量名 $2=值 $3=下限 $4=默认值
    case "$2" in
        ''|*[!0-9]*)
            mpm_warn "$1=\"$2\" 不是非负整数，已退回默认值 $4" >&2
            printf '%s' "$4"
            return 0
            ;;
    esac
    local val=$((10#$2))
    if [ "$val" -lt "$3" ]; then
        mpm_warn "$1=$val 小于下限 $3，已退回默认值 $4" >&2
        printf '%s' "$4"
        return 0
    fi
    printf '%s' "$val"
}

MPM_START_SERVERS=$(mpm_num APACHE_START_SERVERS "${APACHE_START_SERVERS:-$MPM_DEF_START_SERVERS}" 1 "$MPM_DEF_START_SERVERS")
MPM_MIN_SPARE_SERVERS=$(mpm_num APACHE_MIN_SPARE_SERVERS "${APACHE_MIN_SPARE_SERVERS:-$MPM_DEF_MIN_SPARE_SERVERS}" 1 "$MPM_DEF_MIN_SPARE_SERVERS")
MPM_MAX_SPARE_SERVERS=$(mpm_num APACHE_MAX_SPARE_SERVERS "${APACHE_MAX_SPARE_SERVERS:-$MPM_DEF_MAX_SPARE_SERVERS}" 1 "$MPM_DEF_MAX_SPARE_SERVERS")
MPM_MAX_REQUEST_WORKERS=$(mpm_num APACHE_MAX_REQUEST_WORKERS "${APACHE_MAX_REQUEST_WORKERS:-$MPM_DEF_MAX_REQUEST_WORKERS}" 1 "$MPM_DEF_MAX_REQUEST_WORKERS")
# MaxConnectionsPerChild 的 0 是合法值（= 永不回收），所以它的下限是 0 而不是 1
MPM_MAX_CONNECTIONS_PER_CHILD=$(mpm_num APACHE_MAX_CONNECTIONS_PER_CHILD "${APACHE_MAX_CONNECTIONS_PER_CHILD:-$MPM_DEF_MAX_CONNECTIONS_PER_CHILD}" 0 "$MPM_DEF_MAX_CONNECTIONS_PER_CHILD")

# KeepAlive：只接受 On/Off（大小写不敏感），渲染时统一写成 On / Off；其它值退回 Off
case "$(printf '%s' "${APACHE_KEEP_ALIVE:-$MPM_DEF_KEEP_ALIVE}" | tr '[:upper:]' '[:lower:]')" in
    on)  MPM_KEEP_ALIVE=On ;;
    off) MPM_KEEP_ALIVE=Off ;;
    *)
        mpm_warn "APACHE_KEEP_ALIVE=\"${APACHE_KEEP_ALIVE:-}\" 不是 On/Off，已退回 Off"
        MPM_KEEP_ALIVE=Off
        ;;
esac

# 两个可选行（本身没有默认值）：只在 APACHE_KEEP_ALIVE=On 且显式设置时才各写一行，
# 不设就整行不出现 —— 即跟随 Apache 发行版默认（KeepAliveTimeout 5 秒 / MaxKeepAliveRequests 100）。
# 值的校验与 KeepAlive 无关：显式设了非法值一律警告并忽略该行。
mpm_opt_num() { # $1=变量名 $2=值 → 回显正整数；非法则回显空串
    case "$2" in
        ''|*[!0-9]*)
            mpm_warn "$1=\"$2\" 不是正整数，已忽略该行（跟随 Apache 默认）" >&2
            printf ''
            return 0
            ;;
    esac
    local val=$((10#$2))
    if [ "$val" -lt 1 ]; then
        mpm_warn "$1=$val 不是正整数，已忽略该行（跟随 Apache 默认）" >&2
        printf ''
        return 0
    fi
    printf '%s' "$val"
}

MPM_KEEPALIVE_TIMEOUT=''
MPM_MAX_KEEPALIVE_REQUESTS=''
if [ -n "${APACHE_KEEPALIVE_TIMEOUT:-}" ]; then
    MPM_KEEPALIVE_TIMEOUT=$(mpm_opt_num APACHE_KEEPALIVE_TIMEOUT "$APACHE_KEEPALIVE_TIMEOUT")
fi
if [ -n "${APACHE_MAX_KEEPALIVE_REQUESTS:-}" ]; then
    MPM_MAX_KEEPALIVE_REQUESTS=$(mpm_opt_num APACHE_MAX_KEEPALIVE_REQUESTS "$APACHE_MAX_KEEPALIVE_REQUESTS")
fi
if [ "$MPM_KEEP_ALIVE" != "On" ]; then
    MPM_KEEPALIVE_TIMEOUT=''
    MPM_MAX_KEEPALIVE_REQUESTS=''
fi

# 一致性：MaxRequestWorkers ≥ MaxSpareServers ≥ MinSpareServers ≥ 1（默认值天然满足）。
# 不满足时只把「出问题的那一项」退回默认值并警告；逐项回退仍修不好（极端值）再全部退回默认值兜底。
mpm_consistent() {
    [ "$MPM_MAX_REQUEST_WORKERS" -ge "$MPM_MAX_SPARE_SERVERS" ] &&
        [ "$MPM_MAX_SPARE_SERVERS" -ge "$MPM_MIN_SPARE_SERVERS" ] &&
        [ "$MPM_MIN_SPARE_SERVERS" -ge 1 ]
}
mpm_pass=0
while ! mpm_consistent && [ "$mpm_pass" -lt 8 ]; do
    mpm_pass=$((mpm_pass + 1))
    if [ "$MPM_MAX_SPARE_SERVERS" -lt "$MPM_MIN_SPARE_SERVERS" ]; then
        if [ "$MPM_MAX_SPARE_SERVERS" != "$MPM_DEF_MAX_SPARE_SERVERS" ]; then
            mpm_warn "MaxSpareServers=$MPM_MAX_SPARE_SERVERS < MinSpareServers=$MPM_MIN_SPARE_SERVERS，MaxSpareServers 退回默认值 $MPM_DEF_MAX_SPARE_SERVERS"
            MPM_MAX_SPARE_SERVERS=$MPM_DEF_MAX_SPARE_SERVERS
        else
            mpm_warn "MaxSpareServers=$MPM_MAX_SPARE_SERVERS < MinSpareServers=$MPM_MIN_SPARE_SERVERS，MinSpareServers 退回默认值 $MPM_DEF_MIN_SPARE_SERVERS"
            MPM_MIN_SPARE_SERVERS=$MPM_DEF_MIN_SPARE_SERVERS
        fi
        continue
    fi
    if [ "$MPM_MAX_REQUEST_WORKERS" -lt "$MPM_MAX_SPARE_SERVERS" ]; then
        if [ "$MPM_MAX_REQUEST_WORKERS" != "$MPM_DEF_MAX_REQUEST_WORKERS" ]; then
            mpm_warn "MaxRequestWorkers=$MPM_MAX_REQUEST_WORKERS < MaxSpareServers=$MPM_MAX_SPARE_SERVERS，MaxRequestWorkers 退回默认值 $MPM_DEF_MAX_REQUEST_WORKERS"
            MPM_MAX_REQUEST_WORKERS=$MPM_DEF_MAX_REQUEST_WORKERS
        else
            mpm_warn "MaxRequestWorkers=$MPM_MAX_REQUEST_WORKERS < MaxSpareServers=$MPM_MAX_SPARE_SERVERS，MaxSpareServers 退回默认值 $MPM_DEF_MAX_SPARE_SERVERS"
            MPM_MAX_SPARE_SERVERS=$MPM_DEF_MAX_SPARE_SERVERS
        fi
        continue
    fi
    break
done
if ! mpm_consistent; then
    mpm_warn "逐项回退仍无法满足 MaxRequestWorkers ≥ MaxSpareServers ≥ MinSpareServers ≥ 1，三项全部退回默认值（保证 Apache 能起）"
    MPM_MIN_SPARE_SERVERS=$MPM_DEF_MIN_SPARE_SERVERS
    MPM_MAX_SPARE_SERVERS=$MPM_DEF_MAX_SPARE_SERVERS
    MPM_MAX_REQUEST_WORKERS=$MPM_DEF_MAX_REQUEST_WORKERS
fi

# 渲染 + 落盘。任何一步失败都只打警告（|| 守卫），绝不因它中断入口脚本。
mpm_render() {
    local tmp
    # 目标被目录占住时 `mv` 会把文件搬进去、还返回 0（静默假成功）—— 先挡掉
    if [ -d "$MPM_TARGET" ]; then
        mpm_warn "$MPM_TARGET 已存在且是目录（预期是文件），放弃写入"
        return 1
    fi
    tmp=$(mktemp) || return 1
    if ! APACHE_START_SERVERS="$MPM_START_SERVERS" \
        APACHE_MIN_SPARE_SERVERS="$MPM_MIN_SPARE_SERVERS" \
        APACHE_MAX_SPARE_SERVERS="$MPM_MAX_SPARE_SERVERS" \
        APACHE_MAX_REQUEST_WORKERS="$MPM_MAX_REQUEST_WORKERS" \
        APACHE_MAX_CONNECTIONS_PER_CHILD="$MPM_MAX_CONNECTIONS_PER_CHILD" \
        APACHE_KEEP_ALIVE="$MPM_KEEP_ALIVE" \
        envsubst '${APACHE_START_SERVERS} ${APACHE_MIN_SPARE_SERVERS} ${APACHE_MAX_SPARE_SERVERS} ${APACHE_MAX_REQUEST_WORKERS} ${APACHE_MAX_CONNECTIONS_PER_CHILD} ${APACHE_KEEP_ALIVE}' \
            <"$MPM_TEMPLATE" >"$tmp" 2>/dev/null; then
        rm -f "$tmp"
        return 1
    fi
    if [ -n "$MPM_KEEPALIVE_TIMEOUT" ]; then
        printf 'KeepAliveTimeout %s\n' "$MPM_KEEPALIVE_TIMEOUT" >>"$tmp"
    fi
    if [ -n "$MPM_MAX_KEEPALIVE_REQUESTS" ]; then
        printf 'MaxKeepAliveRequests %s\n' "$MPM_MAX_KEEPALIVE_REQUESTS" >>"$tmp"
    fi
    mv "$tmp" "$MPM_TARGET" || { rm -f "$tmp"; return 1; }
    return 0
}

MPM_WRITTEN=no
if [ ! -r "$MPM_TEMPLATE" ]; then
    mpm_warn "找不到模板 $MPM_TEMPLATE，跳过 MPM 配置（Apache 继续用发行版出厂值）"
elif mpm_render && [ -f "$MPM_TARGET" ]; then
    MPM_WRITTEN=yes
else
    mpm_warn "渲染 $MPM_TARGET 失败，沿用镜像里已有的配置（没有该文件则用 Apache 出厂值）"
fi

# 自查用摘要：docker compose logs 里能看到生效的 6 个值（及 KeepAlive 附加的两行是否写入）
mpm_summary="StartServers=$MPM_START_SERVERS MinSpareServers=$MPM_MIN_SPARE_SERVERS MaxSpareServers=$MPM_MAX_SPARE_SERVERS MaxRequestWorkers=$MPM_MAX_REQUEST_WORKERS MaxConnectionsPerChild=$MPM_MAX_CONNECTIONS_PER_CHILD KeepAlive=$MPM_KEEP_ALIVE"
if [ "$MPM_KEEP_ALIVE" = "On" ]; then
    mpm_summary="$mpm_summary（附加行：KeepAliveTimeout=${MPM_KEEPALIVE_TIMEOUT:-未设→跟随 Apache 默认 5 秒} MaxKeepAliveRequests=${MPM_MAX_KEEPALIVE_REQUESTS:-未设→跟随 Apache 默认 100}）"
else
    mpm_summary="$mpm_summary（KeepAlive=Off，未写 KeepAliveTimeout / MaxKeepAliveRequests）"
fi
if [ "$MPM_WRITTEN" = "yes" ]; then
    echo "[lsky] Apache MPM 已写入 $MPM_TARGET：$mpm_summary"
else
    echo "[lsky] Apache MPM 未写入（原因见上一行警告），原计划生效值：$mpm_summary"
fi

IMAGE_MARKER=/var/www/lsky/.code-revision
VOLUME_MARKER=/var/www/html/.code-revision

if [ ! -e '/var/www/html/public/index.php' ]; then
    # ---------------------------------------------------------------- 空卷：首次部署
    # 与上游逐字一致地全量播种。
    #
    # 刻意**不**复制镜像里的 .env：镜像是带 .env 的（构建时由 .env.example 生成、
    # APP_KEY 为空），把它带进空卷会让 Lsky 的安装向导（自己生成 .env 的流程）直接 500。
    # 这条是实测踩过的坑，别"顺手"改成 cp -a /var/www/lsky/. 。
    # 用 tar 而不是 `cp -a /var/www/lsky/*`：cp 的通配符**不带顶层点文件**
    # （.env.example、.code-revision 都得单独补拷，以后新增别的顶层点文件就会静默漏掉），
    # 而 tar 会完整带上，行为也与下面的「同步分支」完全一致。
    # 只排除 .env：库里那份是构建期生成的空壳（APP_KEY 为空），带进空卷会让安装向导 500。
    ( cd /var/www/lsky && tar cf - --exclude=./.env --exclude=./.code-revision . ) | ( cd /var/www/html && tar xf - )
    # 版本标记**最后**写：它同时是"播种完成"的信号（CI 就盯它），必须等其它文件都落盘之后再写
    cp -a "$IMAGE_MARKER" "$VOLUME_MARKER"
    echo "[lsky] 空卷首次部署：已把镜像应用播种到 /var/www/html"
elif [ ! -f "$VOLUME_MARKER" ] || [ "$(cat "$IMAGE_MARKER" 2>/dev/null)" != "$(cat "$VOLUME_MARKER" 2>/dev/null)" ]; then
    # ---------------------------------------------------------------- 已有部署：代码版本变了
    # 「换镜像 = 代码也换」：把镜像里的应用代码同步进卷，理由是版本标记不一致。
    # 不需要任何环境变量，也不需要人工 cp；标记一致时（没换镜像）会跳过，零开销。
    #
    # 绝不能覆盖（这些属于站点自己的东西，是数据/配置，不是镜像代码）：
    #   ./.env             站点配置：APP_KEY、数据库、S3 密钥；覆盖会导致登录态失效/数据读不出
    #   ./storage          上传文件、日志、会话、编译视图缓存
    #   ./database         SQLite 数据库文件（覆盖 = 直接丢数据）
    #   ./bootstrap/cache  Laravel 运行时缓存（config/route 缓存由应用自己生成）
    #   ./public/i        本地存储策略的软链/目录，属于部署产物
    #
    # 注意：只增改、不删除。新版镜像里删掉的旧文件不会从卷里消失（需要人工清理）。
    ( cd /var/www/lsky && tar cf - \
        --exclude=./.env \
        --exclude=./storage \
        --exclude=./database \
        --exclude=./bootstrap/cache \
        --exclude=./public/i \
        . ) | ( cd /var/www/html && tar xf - )

    # 模板可能刚被覆盖（例如 blade 里改了资源版本串），要清掉编译后的视图缓存，
    # 否则浏览器拿到的还是旧 HTML。Laravel 会按需重新编译，代价可忽略。
    rm -f /var/www/html/storage/framework/views/*.php

    # 包发现缓存同样必须作废：卷里的 packages.php / services.php 记录的是"旧镜像当时装着
    # 哪些包"的 ServiceProvider 类名（含 debugbar / ignition 这类开发包）。镜像现在用
    # composer install --no-dev，这些类已经不存在 —— 不清掉的话 Laravel 引导时加载这份清单
    # 会 Class not found，整站 500。两个文件都是纯缓存：下次请求会按当前 vendor/ 重新生成，
    # 删掉没有副作用（权限已在上面的 chown 里归一化，www-data 可写）。
    rm -f /var/www/html/bootstrap/cache/packages.php /var/www/html/bootstrap/cache/services.php

    echo "[lsky] 检测到镜像代码版本变化，已同步进卷：$(head -1 "$VOLUME_MARKER" 2>/dev/null || echo '标记缺失')"
else
    # ---------------------------------------------------------------- 已有部署：同一版本
    # 标记一致 → 卷里的代码就是当前镜像这一版，跳过同步（免得每次重启白写整棵应用树）。
    echo "[lsky] 卷里的代码已是当前镜像版本，跳过同步（$(head -1 "$VOLUME_MARKER")）"
fi

    chown -R www-data /var/www/html
    chgrp -R www-data /var/www/html
    chmod -R 755 /var/www/html/

# ---------------------------------------------------------------- fork 修复（2026-09-29）
# 曾把默认头像放在 public/images/，而 /images 是应用路由：Apache 遇到真实目录会 301 到
# /images/（那里没有 index → 403），于是首页 / → 302 → /images → 301 整站打不开。
# 卷同步是「只增不删」，所以从旧镜像升级上来的卷里会残留这个目录 —— 这里无条件清掉。
# 只删我们自己放过的那一个文件（目录空了再删目录），其余一律不碰。
rm -f /var/www/html/public/images/default-avatar.svg 2>/dev/null || true
rmdir /var/www/html/public/images 2>/dev/null || true

exec "$@"
