# ---------------------------------------------------------------------------
# Lsky Pro Docker 镜像 —— mole404/lsky-pro-docker
# （上游：https://github.com/HalcyonAzure/lsky-pro-docker ，AGPL-3.0）
#
# 与上游的差异（详见 README）：
#   1. 源码钉死在 LSKY_COMMIT，不再在构建时拉 master，镜像内容不会随上游漂移
#   2. 叠加 overlay/ 里的前端补丁：修复 iOS Safari 长按无法弹出图床自定义菜单的问题
#   3. 基础镜像显式写成 Debian bookworm 变体（与 2024-04 那版线上镜像同一 Debian 大版本）
#   4. install-php-extensions 钉到具体版本，不再用 latest
#   5. 构建期自证：源码快照与补丁产物都用 md5 断言，对不上直接构建失败
#
# 构建：docker build -t lsky-pro-docker .
# ---------------------------------------------------------------------------

# 上游源码快照：911275c 是 2024-04-29 构建的 halcyonazure/lsky-pro-docker:latest 所使用的 master HEAD
ARG LSKY_COMMIT=911275c13b038c7a8b710de44664f23887eeb6f6
ARG PHP_VERSION=8.1
ARG DEBIAN_RELEASE=bookworm
ARG PHP_EXT_INSTALLER_VERSION=2.12.0

FROM php:${PHP_VERSION}-cli-${DEBIAN_RELEASE} AS build

ARG LSKY_COMMIT
ARG FORK_SHA=unknown

WORKDIR /build

# 安装必要的依赖
RUN apt-get update && \
    apt-get install -y curl unzip && \
    curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 拉取钉死的源码快照（上游原本是拉 refs/heads/master）
RUN curl -sSL -o lsky.zip "https://github.com/lsky-org/lsky-pro/archive/${LSKY_COMMIT}.zip" \
    && unzip lsky.zip \
    && mv "./lsky-pro-${LSKY_COMMIT}"/* ./ \
    && mv "./lsky-pro-${LSKY_COMMIT}/.env.example" ./ \
    && rm -rf lsky.zip "lsky-pro-${LSKY_COMMIT}"

# 自证 1：确认拉到的确实是预期的那份上游快照。
# 对不上说明上游 archive 变了或 LSKY_COMMIT 被改错，直接让构建失败，不要产出不可信的镜像。
RUN printf '%s\n' \
        'bab81ff5e43b50a760935c7b3ae6475c  ./public/js/context-js/context-js.js' \
        'a7bcd8549c656501a057214637f10b45  ./app/Services/ImageService.php' \
        '674975e4e5561cc15c27626cb1ce5233  ./config/convention.php' \
        '22c896eb7322ec2ff37d5eddd7ca0dec  ./resources/views/user/images.blade.php' \
    | md5sum -c -

RUN php -r "file_exists('.env') || copy('.env.example', '.env');" \
    && composer install

# ---------------------------------------------------------------------------
# fork 补丁：iOS 长按菜单修复
#
# overlay/context-js.js 同时写到两个位置：
#   resources/js/context-js.js         —— 补丁的可读源码
#   public/js/context-js/context-js.js —— 浏览器实际加载的那份
# （上游 webpack.mix.js 里本来也是 mix.copy('resources/js/context-js.js', 'public/js/context-js')，
#  只是仓库里 public/ 下那份是旧工具链留下的压缩产物，一直没跟着源码更新。）
# ---------------------------------------------------------------------------
COPY overlay/context-js.js ./resources/js/context-js.js
COPY overlay/context-js.js ./public/js/context-js/context-js.js
COPY overlay/images.blade.php ./resources/views/user/images.blade.php

# 自证 2：补丁确实落盘、内容与预期完全一致；blade 的版本串也在。
# 以后改 overlay/ 里的文件，记得同步更新这里的 md5（故意做成"改了不更新就构建失败"）。
RUN printf '%s\n' \
        '528d32fc5adc0d306b6d8f773ee5caaf  ./public/js/context-js/context-js.js' \
        '528d32fc5adc0d306b6d8f773ee5caaf  ./resources/js/context-js.js' \
        '576929df685fdb93f9950c16d924bcdc  ./resources/views/user/images.blade.php' \
    | md5sum -c - \
    && grep -q "context-js.js') . '?v=ios-longpress2'" ./resources/views/user/images.blade.php \
    && grep -q 'isIOSWebKit' ./public/js/context-js/context-js.js \
    && grep -q 'LONG_PRESS_DELAY = 250' ./public/js/context-js/context-js.js \
    && grep -q 'LONG_PRESS_DELAY = 250' ./resources/js/context-js.js

# 代码版本标记：入口脚本用它判断「卷里的代码是不是当前镜像这一版」，不一致才同步（见 entrypoint.sh）。
# 它由源码 commit + 补丁 md5 组成，正好是上面刚断言过的值 —— 任何代码/补丁变化都会让它变。
RUN printf '%s\n' \
        "fork_sha=${FORK_SHA}" \
        "lsky_commit=${LSKY_COMMIT}" \
        "context_js_md5=528d32fc5adc0d306b6d8f773ee5caaf" \
        "images_blade_md5=576929df685fdb93f9950c16d924bcdc" \
        > .code-revision \
    && cat .code-revision

FROM php:${PHP_VERSION}-apache-${DEBIAN_RELEASE}

ARG LSKY_COMMIT
ARG PHP_EXT_INSTALLER_VERSION
ARG FORK_SHA=unknown

LABEL org.opencontainers.image.source="https://github.com/mole404/lsky-pro-docker" \
      org.opencontainers.image.title="lsky-pro-docker (ios-longpress)" \
      org.opencontainers.image.description="Lsky Pro 图床的 Docker 镜像；源码钉在 lsky-org/lsky-pro@${LSKY_COMMIT}，并叠加 iOS 长按菜单修复" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.revision="${FORK_SHA}" \
      lsky.source.commit="${LSKY_COMMIT}"

# 如果构建速度慢可以换源
# RUN  sed -i -E "s@http://***@http://mirrors.cloud.tencent.com@g" /etc/apt/sources.list
# 安装相关拓展（钉到具体版本，不使用 latest）
RUN curl -sSL -o /usr/local/bin/install-php-extensions \
        "https://github.com/mlocati/docker-php-extension-installer/releases/download/${PHP_EXT_INSTALLER_VERSION}/install-php-extensions"

# 开启SSL
RUN a2enmod ssl && a2ensite default-ssl

RUN apt-get update && \
    apt-get install -y gettext && \
    apt-get clean && rm -rf /var/cache/apt/* && rm -rf /var/lib/apt/lists/* && rm -rf /tmp/*  && \
    a2enmod rewrite && chmod +x /usr/local/bin/install-php-extensions && \
    install-php-extensions imagick bcmath pdo_mysql pdo_pgsql redis && \
    \
    { \
    echo 'post_max_size = 100M;';\
    echo 'upload_max_filesize = 100M;';\
    echo 'max_execution_time = 600S;';\
    } > /usr/local/etc/php/conf.d/docker-php-upload.ini; \
    \
    { \
    echo 'opcache.enable=1'; \
    echo 'opcache.interned_strings_buffer=8'; \
    echo 'opcache.max_accelerated_files=10000'; \
    echo 'opcache.memory_consumption=128'; \
    echo 'opcache.save_comments=1'; \
    echo 'opcache.revalidate_freq=1'; \
    } > /usr/local/etc/php/conf.d/opcache-recommended.ini; \
    \
    echo 'apc.enable_cli=1' >> /usr/local/etc/php/conf.d/docker-php-ext-apcu.ini; \
    \
    echo 'memory_limit=512M' > /usr/local/etc/php/conf.d/memory-limit.ini; \
    \
    mkdir /var/www/data; \
    chown -R www-data:root /var/www; \
    chmod -R g=u /var/www

COPY ./ssl /etc/ssl

COPY --from=build /build /var/www/lsky/
COPY ./000-default.conf.template /etc/apache2/sites-enabled/
COPY ./ports.conf.template /etc/apache2/
COPY entrypoint.sh /

# 数据安全护栏：强制同步的排除清单缺任何一项都可能覆盖站点数据/配置，缺了就构建失败。
# （镜像自带入口脚本运行时才会执行，这里只做静态断言，保证清单不被误删。）
RUN grep -q -- '--exclude=.\/.env' /entrypoint.sh \
    && grep -q -- '--exclude=.\/storage' /entrypoint.sh \
    && grep -q -- '--exclude=.\/database' /entrypoint.sh \
    && grep -q -- '--exclude=.\/bootstrap\/cache' /entrypoint.sh \
    && grep -q -- '--exclude=.\/public\/i' /entrypoint.sh \
    && grep -q 'views/\*.php' /entrypoint.sh \
    && grep -q 'code-revision' /entrypoint.sh \
    && test -f /var/www/lsky/.code-revision \
    && grep -q '^fork_sha=' /var/www/lsky/.code-revision \
    && grep -q 'cp -a /var/www/lsky/\* /var/www/html/' /entrypoint.sh \
    && grep -q 'cp -a /var/www/lsky/.env.example /var/www/html' /entrypoint.sh
WORKDIR /var/www/html/
VOLUME /var/www/html
ENV WEB_PORT 8089
ENV HTTPS_PORT 8088
EXPOSE ${WEB_PORT}
EXPOSE ${HTTPS_PORT}
RUN chmod a+x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["apachectl","-D","FOREGROUND"]
