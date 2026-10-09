#!/bin/bash
set -eu

# ---------------------------------------------------------------- 监听端口（WEB_PORT / HTTPS_PORT）
# 这两行原来直接 envsubst 渲染 000-default.conf / ports.conf：既没有值校验，也没有 || 守卫。
# compose 里写了空值或非数字，生成出来的就是 `Listen `（空）/ `<VirtualHost *:>` 这种废配置 →
# Apache 起不来 → exec "$@" 非 0，配合 `restart: unless-stopped` 就变成无限重启。
# 处理原则与下面的 MPM 段完全一致：只把「出问题的那一项」退回镜像默认值（与 Dockerfile 的 ENV 一致）
# 并打一行警告，绝不让容器起不来；渲染本身失败也只警告（沿用镜像里已有的配置）。
PORT_DEF_WEB=8089
PORT_DEF_HTTPS=8088

port_warn() { echo "[lsky] 警告：$*"; }

# 端口项：必须是 1-65535 的十进制整数（去掉前导零后比大小），否则退回默认值（回显合法值）
port_num() { # $1=变量名 $2=值 $3=默认值
    case "$2" in
        ''|*[!0-9]*)
            port_warn "$1=\"$2\" 不是 1-65535 的十进制整数，已退回默认值 $3" >&2
            printf '%s' "$3"
            return 0
            ;;
    esac
    # 位数先挡一道：超过 5 位必然越界，也避免 $((10#...)) 在超长数字上溢出算出一个「假的合法值」
    if [ "${#2}" -gt 5 ]; then
        port_warn "$1=$2 超出 1-65535 范围，已退回默认值 $3" >&2
        printf '%s' "$3"
        return 0
    fi
    local val=$((10#$2))
    if [ "$val" -lt 1 ] || [ "$val" -gt 65535 ]; then
        port_warn "$1=$2 超出 1-65535 范围，已退回默认值 $3" >&2
        printf '%s' "$3"
        return 0
    fi
    printf '%s' "$val"
}

# 注意用 `${VAR-DEF}`（不是 `:-`）：变量**未设**时才静默取默认值；显式设成空串是配置错误，
# 交给 port_num 打警告并兜底（日志里能看出是"写了空值"而不是"没写"）。
WEB_PORT=$(port_num WEB_PORT "${WEB_PORT-$PORT_DEF_WEB}" "$PORT_DEF_WEB")
HTTPS_PORT=$(port_num HTTPS_PORT "${HTTPS_PORT-$PORT_DEF_HTTPS}" "$PORT_DEF_HTTPS")

# 渲染 vhost / ports.conf。与 MPM 段的 mpm_render 同样先写临时文件再 mv：失败时上一条配置原样留着。
# （直接 `> 目标` 在失败时会把目标截成空文件 —— 那本身就是一份废配置，等于把要防的事故换了个触发点。）
# 注意 envsubst 只看得见**导出**的环境变量，校验后的值此刻只是 shell 变量，必须显式喂进去，
# 否则"变量未设"时渲染出来的就是空的 `Listen`。
render_conf() { # $1=模板 $2=目标
    local tmp
    # 目标被目录占住时 `mv` 会把文件搬进去、还返回 0（静默假成功）—— 先挡掉
    if [ -d "$2" ]; then
        return 1
    fi
    tmp=$(mktemp) || return 1
    if ! WEB_PORT="$WEB_PORT" HTTPS_PORT="$HTTPS_PORT" \
        envsubst '${WEB_PORT} ${HTTPS_PORT}' <"$1" >"$tmp" 2>/dev/null; then
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$2" || { rm -f "$tmp"; return 1; }
    return 0
}

render_conf /etc/apache2/sites-enabled/000-default.conf.template /etc/apache2/sites-enabled/000-default.conf \
    || port_warn "渲染 000-default.conf 失败，沿用镜像里已有的配置（Apache 可能起不来）"
render_conf /etc/apache2/ports.conf.template /etc/apache2/ports.conf \
    || port_warn "渲染 ports.conf 失败，沿用镜像里已有的配置（Apache 可能起不来）"

# ---------------------------------------------------------------- 运行期自签 HTTPS 证书（F21）
# 镜像里**不再发货**证书：原来 `COPY ./ssl /etc/ssl` 把一对 Debian snakeoil 证书（含私钥、
# 在 GitHub 上人人可见）拷进镜像，模板的 HTTPS vhost 直接引用 —— 每个使用者共用同一份公开私钥。
# 现在改成首次启动时用 openssl 自签一份，落到下面的固定路径（模板已指向这里），之后复用。
# 与上面的端口 / MPM 段同样的原则：幂等（已存在就跳过）+ 失败只警告 + 绝不让入口脚本（set -eu）挂掉。
SSL_DIR=/etc/apache2/ssl
SSL_CRT=$SSL_DIR/lsky-selfsigned.crt
SSL_KEY=$SSL_DIR/lsky-selfsigned.key

ssl_warn() { echo "[lsky] 警告：$*" >&2; }

# -s：文件存在且非空才算「已就绪」；空文件（上次生成中途死掉）会被当成不存在而重新生成。
if [ -s "$SSL_CRT" ] && [ -s "$SSL_KEY" ]; then
    echo "[lsky] HTTPS 自签证书已就绪（$SSL_CRT），跳过生成"
elif ! command -v openssl > /dev/null 2>&1; then
    # 正常构建出来的镜像一定带 openssl（Dockerfile 有构建期护栏）；走到这里说明镜像被人动过。
    ssl_warn "找不到 openssl 且没有现成证书，无法自签 HTTPS 证书；HTTPS vhost（端口 ${HTTPS_PORT}）会因此起不来，其它功能不受影响"
elif ! mkdir -p "$SSL_DIR" 2>/dev/null; then
    # 真实失败路径：$SSL_DIR 被一个同名文件占住 → mkdir -p 失败。
    ssl_warn "$SSL_DIR 无法创建（可能被同名文件占住），未生成自签证书；HTTPS vhost（端口 ${HTTPS_PORT}）会因此起不来，其它功能不受影响"
elif openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj '/CN=lsky-pro' \
        -keyout "$SSL_KEY" -out "$SSL_CRT" > /dev/null 2>&1; then
    # 私钥权限收紧到 600（组/其他不可读）；chmod 失败不影响启动，只提示。
    chmod 600 "$SSL_KEY" 2>/dev/null || ssl_warn "无法把 $SSL_KEY 权限设为 600（不影响启动）"
    echo "[lsky] 已生成 HTTPS 自签证书：$SSL_CRT（RSA 2048 / 3650 天 / CN=lsky-pro）"
else
    # 生成中途失败：把可能留下的半个文件清掉，避免下次被 -s 误判为「已就绪」。
    rm -f "$SSL_KEY" "$SSL_CRT" 2>/dev/null || true
    ssl_warn "openssl 自签证书失败，未生成证书；HTTPS vhost（端口 ${HTTPS_PORT}）会因此起不来，其它功能不受影响"
fi

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
# MaxConnectionsPerChild 默认 5（2026-10-01 从 30 改回 5）：本站流量极低（约 3 请求/分钟），
# 按这个速率每个 worker 大约 3 分钟才换一次班 —— 换班（fork/退出/再 fork）的开销在这点流量下
# 可忽略；而换班越勤，长跑 worker 累积的内存碎片/潜在泄漏越少。低流量场景下取「最严的内存纪律」。
# （中途试过 30：少换班对低流量站没多少收益，不如 5 稳。历史值 30。）
# 仍然保留 APACHE_MAX_CONNECTIONS_PER_CHILD 覆盖（0 = 永不回收，合法值）。
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

# ---------------------------------------------------------------- PHP memory_limit（可运行时覆盖，默认 64M）
# 现状（先量后改）：PHP 编译期默认 128M，但镜像里 docker-php-upload.ini 只设上传项、
# （上游）memory-limit.ini 设的是 512M —— 生效值是 512M。本段把收紧后的 memory_limit 收进
# zz-lsky-hardening.ini（文件名 zz- 前缀 → conf.d 里排最后 → 覆盖前面所有同名项），
# 并支持用环境变量 PHP_MEMORY_LIMIT 在**运行期**渲染进去：在 compose 里改一个 env 就能回
# 128M/256M，**不用重建镜像**（与上面 MPM / 端口两段完全同一套路：临时文件 + mv、失败只警告）。
# 默认 64M 的理由：面向低内存环境（1 vCPU / 965MB），内存是瓶颈；Lsky 单请求实际远用不到 64M，
# 需要做大图处理/批量时用 PHP_MEMORY_LIMIT 临时抬高即可。
# 脏值处理原则同上：只忽略这一项并警告，绝不让容器启动失败。
# ⚠ 注意：post_max_size 与 upload_max_filesize 都已调到 **512M**（见 docker-php-upload.ini）
#   —— 前者是「整个请求体」上限（控制台里显示的那条），后者才是「单个上传文件」的上限。
#   但主机 nginx 的 client_max_body_size 仍是 100m ⇒ 真要传 >100MB 的图，nginx 侧也得放宽（属另一个服务，未经允许不要动）。
#   处理大图若撞到 64M 内存上限，用 PHP_MEMORY_LIMIT 抬高（或调低上面那两个上传上限）。
PHP_DEF_MEMORY_LIMIT=64M
PHP_HARDENING_INI=/usr/local/etc/php/conf.d/zz-lsky-hardening.ini

php_warn() { echo "[lsky] 警告：PHP $*" >&2; }

# 合法形状：<数字>[KMG]（大小写不敏感），例如 64M / 256M / 1G。其它一律视为脏值。
# 归一化：数字原样 + 单个大写单位字母（1g → 1G）。
php_mem_limit() { # $1=变量名 $2=值 $3=默认值
    if [[ "$2" =~ ^([0-9]+)([KMGkmg])$ ]]; then
        printf '%s%s' "${BASH_REMATCH[1]}" "$(printf '%s' "${BASH_REMATCH[2]}" | tr '[:lower:]' '[:upper:]')"
        return 0
    fi
    php_warn "$1=\"$2\" 不是 <数字>[KMG] 形状（如 64M / 256M / 1G），已忽略该项并沿用默认值 $3" >&2
    printf '%s' "$3"
}

# 注意用 ${VAR-DEF}（不是 :-）：变量**未设**才静默取默认值；显式设成空串是配置错误，
# 交给 php_mem_limit 打警告并兜底（日志里能看出是"写了空值"而不是"没写"）。
PHP_MEMORY_LIMIT_VAL=$(php_mem_limit PHP_MEMORY_LIMIT "${PHP_MEMORY_LIMIT-$PHP_DEF_MEMORY_LIMIT}" "$PHP_DEF_MEMORY_LIMIT")

# 渲染进 zz-lsky-hardening.ini：保留 expose_php / display_errors 等既有行，**只替换 memory_limit 这一项**。
# 幂等：重启时先删掉旧的 memory_limit 行再追加，不会越写越多行。
php_ini_render() {
    local tmp
    # 目标被目录占住时 `mv 文件 目录` 会静默假成功还返回 0 —— 先挡掉
    if [ -d "$PHP_HARDENING_INI" ]; then
        php_warn "$PHP_HARDENING_INI 已存在且是目录（预期是文件），放弃写入"
        return 1
    fi
    [ -f "$PHP_HARDENING_INI" ] || return 1
    tmp=$(mktemp) || return 1
    grep -v '^[[:space:]]*memory_limit[[:space:]]*=' "$PHP_HARDENING_INI" > "$tmp" 2>/dev/null || true
    printf 'memory_limit=%s\n' "$PHP_MEMORY_LIMIT_VAL" >> "$tmp" || { rm -f "$tmp"; return 1; }
    mv "$tmp" "$PHP_HARDENING_INI" || { rm -f "$tmp"; return 1; }
    return 0
}

PHP_INI_WRITTEN=no
if php_ini_render; then
    PHP_INI_WRITTEN=yes
else
    php_warn "渲染 $PHP_HARDENING_INI 失败，沿用镜像里已有的 memory_limit"
fi

PHP_MEMORY_SUMMARY="memory_limit=$PHP_MEMORY_LIMIT_VAL（PHP_MEMORY_LIMIT 可覆盖，默认 $PHP_DEF_MEMORY_LIMIT）"
if [ "$PHP_INI_WRITTEN" = "yes" ]; then
    echo "[lsky] PHP $PHP_MEMORY_SUMMARY 已写入 $PHP_HARDENING_INI"
else
    echo "[lsky] PHP $PHP_MEMORY_SUMMARY 未写入（原因见上一行警告），实际沿用镜像里已有的值"
fi

IMAGE_MARKER=/var/www/lsky/.code-revision
VOLUME_MARKER=/var/www/html/.code-revision

# ---------------------------------------------------------------- 运行时缓存作废（两条分支共用）
# 换镜像、或卷里缺 public/index.php 被重新播种之后，卷里这两类缓存都必须作废，否则：
#   storage/framework/views/*.php             编译后的 blade：模板已换，不清的话浏览器拿到的还是旧 HTML；
#   bootstrap/cache/packages.php|services.php 包发现清单：记录的是「旧镜像当时装着哪些包」的
#     ServiceProvider 类名（含 debugbar / ignition 这类开发包）。镜像现在 composer install --no-dev，
#     这些类已经不存在，Laravel 引导时加载这份清单会 Class not found → 整站 500。
# 两者都是纯缓存：Laravel 会按当前 blade/vendor 按需重新生成，删掉没有副作用。
# 刻意**不**动 bootstrap/cache/config.php —— 那是站点自己的配置缓存（CI 有断言必须保留）。
# 播种分支原来漏了这一步：它在「卷里缺 public/index.php」时也会对**已有卷**触发，
# 那条路径上旧 packages.php 的 Class not found 照样整站 500 —— 所以两条分支都必须调这个函数。
invalidate_runtime_caches() {
    rm -f /var/www/html/storage/framework/views/*.php
    rm -f /var/www/html/bootstrap/cache/packages.php /var/www/html/bootstrap/cache/services.php
}

# ---------------------------------------------------------------- 自动补迁移（fork 专属，2026-10-02）
# 为什么需要它：上面的同步分支**故意排除 ./database**（保护线上 SQLite 文件），于是镜像里
#   新增的迁移文件永远进不了卷 —— 卷里 database/migrations/ 一直是老那份，用户按 README
#   只做 `pull && up -d` 时新表不会出现（`php artisan migrate` 报 Nothing to migrate）→ 新功能 500。
#   于是「从上游 v2.1 / 旧版镜像升级上来」原来必须人工拷迁移文件再手跑 migrate。
#
# 现在自动做掉（每次启动跑一遍；幂等，无待办时秒回）：
#   ① 只把**缺失**的迁移文件补进卷（逐个判存在再 cp -p，绝不覆盖用户自己改过的那份）
#   ② 守卫：只有 `php artisan migrate:status` 能正常跑（= 真 Laravel 站点、库里有 migrations
#      记账表）才继续 —— 空卷 / 手搓库 / 非标安装一律跳过，绝不自作主张建表
#   ③ 迁移前备份：只对 SQLite（database.sqlite + -wal + -shm 三件套），保留最近 3 份；
#      MySQL / Postgres 请自行确保有备份，这里不动它
#   ④ 一律以 www-data 身份执行 —— root 跑会把 -wal / -shm 造成 root 属主，站点就写不进库了
#   ⑤ 最后把 database/ 属主归一化
#
# ⚠️ 铁律：**任何失败都只打日志，绝不 exit / 非 0 返回给调用点**。
#    本脚本是 `set -eu`，一旦非 0 冒泡出去容器就起不来，配合 `restart: unless-stopped`
#    会变成无限重启 —— 迁移失败不该让整站停摆。失败时下次启动会自动重试。
# 开关：AUTO_MIGRATE=0 关闭（默认开）。
auto_migrate() {
    local APP=/var/www/html SRC=/var/www/lsky
    local added=0 f b stamp out rc=0 conn dbpath probe pending status

    if [ "${AUTO_MIGRATE-1}" = "0" ]; then
        echo "[lsky] AUTO_MIGRATE=0：跳过自动补迁移"
        return 0
    fi
    [ -d "$APP/database/migrations" ] || return 0

    # ① 守卫（先确认卷里是「真装好的站点」，再谈动任何东西）：
    #    · SQLite 走**只读**探测（`file:...?mode=ro`）—— 不启 Laravel、不写库文件；
    #    · 其它数据库（MySQL/Postgres）读 .env 后走 migrate:status（纯只读查询）。
    #    判据 = migrations 记账表存在且已有记录；空卷 / 手搓库 / 非标安装一律跳过。
    conn=$(sed -n 's/^[[:space:]]*DB_CONNECTION[[:space:]]*=[[:space:]]*//p' "$APP/.env" 2>/dev/null | tail -1 | tr -d '"'"'" | tr -d ' ')
    conn=${conn:-sqlite}
    if [ "$conn" = "sqlite" ]; then
        dbpath=$(sed -n 's/^[[:space:]]*DB_DATABASE[[:space:]]*=[[:space:]]*//p' "$APP/.env" 2>/dev/null | tail -1 | tr -d '"'"'" | tr -d ' ')
        case "$dbpath" in
            "")   dbpath="$APP/database/database.sqlite" ;;
            /*)   : ;;
            *)    dbpath="$APP/$dbpath" ;;
        esac
        probe=$(runuser -u www-data -- php -r '
            $p = $argv[1];
            if (!is_file($p)) { echo "-1"; exit; }
            try {
                $db = new PDO("sqlite:file:" . $p . "?mode=ro", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                echo (string) $db->query("SELECT COUNT(*) FROM migrations")->fetchColumn();
            } catch (Throwable $e) { echo "-1"; }
        ' "$dbpath" 2>/dev/null) || probe=-1
        case "$probe" in ''|*[!0-9]*) probe=-1 ;; esac
        if [ "$probe" -lt 1 ]; then
            echo "[lsky] 跳过自动迁移：卷里的 SQLite 还没有装好的站点（读不到 migrations 记账表）"
            return 0
        fi
    elif ! runuser -u www-data -- sh -c 'cd /var/www/html && php artisan migrate:status' >/dev/null 2>&1; then
        echo "[lsky] 跳过自动迁移：读不到 Laravel 迁移记账表（非标准安装）"
        return 0
    fi

    # ② 确认是真站点之后，才把**缺失**的迁移文件补进卷
    #    （逐个判存在再 cp -p：保时间戳，且绝不覆盖用户自己改过的那份）
    for f in "$SRC"/database/migrations/*.php; do
        [ -e "$f" ] || continue
        b=$(basename "$f")
        if [ ! -e "$APP/database/migrations/$b" ]; then
            cp -p "$f" "$APP/database/migrations/$b" 2>/dev/null && added=$((added + 1)) || true
        fi
    done
    if [ "$added" -gt 0 ]; then
        chown www-data:www-data "$APP"/database/migrations/*.php 2>/dev/null || true
        echo "[lsky] 自动补入 $added 个新迁移文件到 database/migrations"
    fi

    # ③ 真的有 pending 才备份 + 迁移（否则每次重启都白备份一份库，纯属糟蹋磁盘）
    #    · SQLite：直接**只读**比对「盘上的迁移文件」vs「记账表里的行」——
    #      刻意不走 Laravel：站点自己的 bootstrap/cache/config.php 一旦是坏的/外来的，
    #      任何 artisan 命令都会报 "Target class [files] does not exist"（CI 的真升级用例
    #      里那个哨兵配置缓存就是这么把 migrate:status 打死的，实测踩到）。
    #    · 其它库：走 migrate:status（纯只读查询）。
    if [ "$conn" = "sqlite" ]; then
        pending=$(runuser -u www-data -- php -r '
            $dir = "/var/www/html/database/migrations";
            $p   = $argv[1];
            $ran = [];
            try {
                $db = new PDO("sqlite:file:" . $p . "?mode=ro", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                foreach ($db->query("SELECT migration FROM migrations") as $r) { $ran[$r[0]] = true; }
            } catch (Throwable $e) { echo "-1"; exit; }
            $n = 0;
            foreach (glob($dir . "/*.php") as $f) {
                if (!isset($ran[basename($f, ".php")])) { $n++; }
            }
            echo (string) $n;
        ' "$dbpath" 2>/dev/null) || pending=-1
        case "$pending" in ''|*[!0-9]*) pending=-1 ;; esac
        if [ "$pending" -lt 0 ]; then
            echo "[lsky] 警告：读不出 SQLite 的迁移记账表，跳过自动迁移（站点不受影响）"
            return 0
        fi
        [ "$pending" -eq 0 ] && { echo "[lsky] 自动迁移检查完成：没有待执行的迁移"; return 0; }
        echo "[lsky] 检测到 $pending 条待执行迁移"
    else
        status=$(runuser -u www-data -- sh -c 'cd /var/www/html && php artisan migrate:status' 2>&1) || true
        case "$status" in
            *Pending*|*pending*) pending=1 ;;
            *)                   pending=0 ;;
        esac
        if [ "$pending" -eq 0 ]; then
            echo "[lsky] 自动迁移检查完成：没有待执行的迁移"
            return 0
        fi
        echo "[lsky] 检测到待执行的迁移"
    fi

    # 迁移前备份（仅 SQLite 三件套；保留最近 3 份。MySQL/Postgres 请自行确保有备份）
    if [ "$conn" = "sqlite" ] && [ -f "$dbpath" ]; then
        stamp=$(date +%Y%m%d-%H%M%S)
        if mkdir -p "$APP/database/backups/$stamp" 2>/dev/null; then
            cp -p "$dbpath" "$APP/database/backups/$stamp/" 2>/dev/null || true
            for f in "$dbpath-wal" "$dbpath-shm"; do
                [ -e "$f" ] && cp -p "$f" "$APP/database/backups/$stamp/" 2>/dev/null
            done
            echo "[lsky] 迁移前已备份 SQLite → database/backups/$stamp/"
            ls -1dt "$APP"/database/backups/*/ 2>/dev/null | tail -n +4 | while read -r b; do
                rm -rf "$b" 2>/dev/null || true
            done
        fi
    else
        echo "[lsky] 非 SQLite 数据库：迁移前不自动备份，请自行确认已有备份"
    fi

    # ④ 降权跑迁移（--force：生产环境必须显式确认）
    #    用 `php /var/www/html/artisan`（绝对路径）：artisan 自己按 __DIR__ 解析 base path，
    #    因此不必 cd，也少一层 `sh -c` 的失败面；输出一律打出来，空输出也要留痕（便于定位）。
    rc=0
    out=$(runuser -u www-data -- php /var/www/html/artisan migrate --force 2>&1) || rc=$?
    if [ -n "$out" ]; then
        echo "$out" | sed 's/^/    [migrate] /'
    else
        echo "    [migrate] （命令没有任何输出，退出码 $rc）"
        command -v runuser >/dev/null 2>&1 && echo "    [probe] runuser=$(command -v runuser)" || echo "    [probe] runuser 不在 PATH 里"
        runuser -u www-data -- php -v 2>&1 | head -2 | sed 's/^/    [probe] /'
        runuser -u www-data -- php /var/www/html/artisan --version 2>&1 | head -6 | sed 's/^/    [probe] /'
        [ -d /var/www/html/storage/logs ] || echo "    [probe] 卷里没有 storage/logs 目录（Laravel 写日志会失败）"
        ls -la /var/www/html/database/ 2>&1 | head -6 | sed 's/^/    [probe] /'
    fi
    if [ "$rc" -ne 0 ]; then
        echo "[lsky] 警告：自动迁移未成功（退出码 $rc）。站点照常启动，请看上面的迁移输出；"
        echo "[lsky]       修好后重启容器会自动重试（迁移前已备份 SQLite，在 database/backups/ 里）。"
    else
        echo "[lsky] 自动迁移完成：上面的迁移已应用（新表就绪）"
    fi

    # ⑤ 属主归一化（含 migrate 可能新建的 -wal / -shm）
    chown -R www-data:www-data "$APP/database" 2>/dev/null || true
    return 0
}

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
    # 播种分支同样要作废运行时缓存：这条路径不只跑在空卷上 —— 「卷里缺 public/index.php」
    # 也会走到这里，那种已有卷里可能正躺着一份引用了已删开发包的 packages.php。
    invalidate_runtime_caches
    echo "[lsky] 空卷首次部署：已作废卷里的编译视图缓存与包发现缓存"
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
    #
    # --exclude=./.code-revision 是必须的：版本标记既是「卷里的代码已同步到这一版」的标志，
    # 就绝不能跟着 tar 流一起写进卷。tar 是流式的 —— 标记一被写进卷，归档还没解完（磁盘满 /
    # OOM / 主机重启）卷里就已经是「新标记 + 半套代码」；下次启动会判定同版本而永远跳过同步，
    # 缺文件导致的 500 再也不会自愈。所以标记只在下面归档解完包之后由 cp 显式写一次。
    ( cd /var/www/lsky && tar cf - \
        --exclude=./.env \
        --exclude=./.code-revision \
        --exclude=./storage \
        --exclude=./database \
        --exclude=./bootstrap/cache \
        --exclude=./public/i \
        . ) | ( cd /var/www/html && tar xf - )

    # 模板可能刚被覆盖（例如 blade 里改了资源版本串），要清掉编译后的视图缓存，
    # 否则浏览器拿到的还是旧 HTML。Laravel 会按需重新编译，代价可忽略。
    # 包发现缓存同样必须作废：卷里的 packages.php / services.php 记录的是"旧镜像当时装着
    # 哪些包"的 ServiceProvider 类名（含 debugbar / ignition 这类开发包）。镜像现在用
    # composer install --no-dev，这些类已经不存在 —— 不清掉的话 Laravel 引导时加载这份清单
    # 会 Class not found，整站 500。两个文件都是纯缓存：下次请求会按当前 vendor/ 重新生成，
    # 删掉没有副作用（权限已在上面的 chown 里归一化，www-data 可写）。
    invalidate_runtime_caches
    echo "[lsky] 代码已同步，已作废卷里的编译视图缓存与包发现缓存"

    # 版本标记**必须等归档解包完成之后**才写 —— 它同时是「同步完成」的信号。
    # 写早了（例如靠 tar 流带进去）会让卷在半套代码上自称已最新，之后就永远跳过同步。
    cp -a "$IMAGE_MARKER" "$VOLUME_MARKER"

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

# ---------------------------------------------------------------- 自动补迁移（fork 专属，2026-10-02）
# 放在最后：此时代码已同步完、属主已归 www-data。它就是「从上游 v2.1 / 旧版镜像升级上来
# 不用再手工拷迁移文件 + 手跑 migrate」的那一步（详见 auto_migrate 上方注释）。
# 兜一层 `||` 是刻意的：本脚本 set -eu，函数万一非 0 冒泡出去会让容器直接起不来。
auto_migrate || echo "[lsky] 警告：自动迁移步骤异常（不影响启动，详见上方日志）"

exec "$@"
