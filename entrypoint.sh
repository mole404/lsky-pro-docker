#!/bin/bash
set -eu

WEB_PORT=${WEB_PORT:-8089}
HTTPS_PORT=${HTTPS_PORT:-8088}

envsubst '${WEB_PORT} ${HTTPS_PORT}' < /etc/apache2/sites-enabled/000-default.conf.template > /etc/apache2/sites-enabled/000-default.conf
envsubst '${WEB_PORT} ${HTTPS_PORT}' < /etc/apache2/ports.conf.template > /etc/apache2/ports.conf

if [ ! -e '/var/www/html/public/index.php' ]; then
    # 空卷（首次部署）：全量播种镜像里的应用，并放一份 .env 模板
    cp -a /var/www/lsky/. /var/www/html/
    cp -a /var/www/lsky/.env.example /var/www/html
else
    # 已有部署：每次启动强制把镜像里的应用代码同步进卷，做到「换镜像 = 代码也换」，
    # 不需要任何环境变量、也不依赖人工 cp。
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
fi
    chown -R www-data /var/www/html
    chgrp -R www-data /var/www/html
    chmod -R 755 /var/www/html/

exec "$@"
