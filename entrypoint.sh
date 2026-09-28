#!/bin/bash
set -eu

WEB_PORT=${WEB_PORT:-8089}
HTTPS_PORT=${HTTPS_PORT:-8088}

envsubst '${WEB_PORT} ${HTTPS_PORT}' < /etc/apache2/sites-enabled/000-default.conf.template > /etc/apache2/sites-enabled/000-default.conf
envsubst '${WEB_PORT} ${HTTPS_PORT}' < /etc/apache2/ports.conf.template > /etc/apache2/ports.conf

IMAGE_MARKER=/var/www/lsky/.code-revision
VOLUME_MARKER=/var/www/html/.code-revision

if [ ! -e '/var/www/html/public/index.php' ]; then
    # ---------------------------------------------------------------- 空卷：首次部署
    # 与上游逐字一致地全量播种。
    #
    # 刻意**不**复制镜像里的 .env：镜像是带 .env 的（构建时由 .env.example 生成、
    # APP_KEY 为空），把它带进空卷会让 Lsky 的安装向导（自己生成 .env 的流程）直接 500。
    # 这条是实测踩过的坑，别"顺手"改成 cp -a /var/www/lsky/. 。
    cp -a /var/www/lsky/* /var/www/html/
    cp -a /var/www/lsky/.env.example /var/www/html
    # 版本标记是 dotfile，上面那条通配符不会带上，单独拷贝
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

    echo "[lsky] 检测到镜像代码版本变化，已同步进卷：$(head -1 "$VOLUME_MARKER" 2>/dev/null || echo '标记缺失')"
else
    # ---------------------------------------------------------------- 已有部署：同一版本
    # 标记一致 → 卷里的代码就是当前镜像这一版，跳过同步（免得每次重启白写整棵应用树）。
    echo "[lsky] 卷里的代码已是当前镜像版本，跳过同步（$(head -1 "$VOLUME_MARKER")）"
fi

    chown -R www-data /var/www/html
    chgrp -R www-data /var/www/html
    chmod -R 755 /var/www/html/

exec "$@"
