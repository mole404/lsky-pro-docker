# ---------------------------------------------------------------------------
# Lsky Pro Docker 镜像 —— mole404/lsky-pro-docker
#
# 上游应用：https://github.com/lsky-org/lsky-pro           （GPL-3.0，官方已停止维护）
# 上游镜像：https://github.com/HalcyonAzure/lsky-pro-docker （AGPL-3.0，本仓库由它衍生）
#
# 本仓库 = 上游应用源码快照（vendored 在 src/）+ Docker 构建脚本 + 少量前端补丁。
#
# 与上游镜像的差异（详见 README）：
#   1. 应用源码**已 vendored 进本仓库**（src/ = 上游 commit 38d52c46… 即 2025-11-24 的 master 完整树）。
#      构建不再联网拉 GitHub archive：上游已明示停止维护，万一仓库被删/归档/改名也还能重建镜像；
#      之后要改 PHP 代码，直接改 src/ 下的文件、提交即可，不用再维护 overlay 叠加。
#   2. 前端补丁已就地落在 src/ 里（iOS Safari 长按弹菜单 + 菜单交互修复）。
#      "我们相对上游改了什么"见 patches/ios-longpress.patch，可用 tools/diff-vs-upstream.sh 重新生成/核对。
#   3. 基础镜像显式写成 Debian bookworm 变体（与 2024-04 那版线上镜像同一 Debian 大版本）
#   4. install-php-extensions 钉到具体版本，不再用 latest
#   5. 构建期自证：① 我们从不修改的上游文件按上游 md5 校验（快照没被动过）
#      ② 补丁产物与「有意偏离上游」的 composer.lock 按预期 md5 校验（改了不更新就构建失败）
#
# 构建：docker build -t lsky-pro-docker .
# ---------------------------------------------------------------------------

# 上游源码快照的版本号（只用于版本标记与镜像元数据；代码本体是仓库里的 src/）。
# 改这里 = 必须同时用 tools/vendor-upstream.sh 重新 vendor src/，否则标记与实际代码不符（自证 1 会失败）。
ARG LSKY_COMMIT=38d52c4609eb85236b45ac75acac2ced55174953
# PHP 版本：8.1 已于 2025-12-31 EOL，8.2 的 EOL 是 2026-12-31（都太近），
# 所以选 8.3（安全维护到 2027-12-31）。依赖侧配套升到同一大版本线内的最新：
# laravel/framework 9.52.21（9.x 最后一个补丁）+ symfony/* 6.4 LTS（Laravel 9 的 ^6.0 正好允许）。
# 要回退 PHP：改这个数字即可，但请连镜像 tag 一起回退（新 lock 里的包可能要求 ≥8.3）。
ARG PHP_VERSION=8.3
ARG DEBIAN_RELEASE=bookworm
ARG PHP_EXT_INSTALLER_VERSION=2.12.0

FROM php:${PHP_VERSION}-cli-${DEBIAN_RELEASE} AS build

ARG LSKY_COMMIT
ARG FORK_SHA=unknown

WORKDIR /build

# 安装必要的依赖
#   curl  —— 装 composer
#   unzip —— composer 解压 dist 包要用（去掉它会导致 composer install 直接失败：CI 实测踩过）
#   git   —— 部分包会走 source 安装时的兜底
RUN docker-php-ext-install ftp

# 依赖安装（builder 阶段的平台要求必须满足，否则 composer install 直接失败）
RUN apt-get update && \
    apt-get install -y curl unzip git && \
    curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 应用源码：本仓库 src/ 里的 vendored 快照（= 上游那个 commit 的完整树，304 个文件）。
# 前端补丁已经就地在 src/ 里改好，这里不做任何"叠加覆盖"。改代码 = 改 src/ 然后提交。
COPY src/ /build/

# 自证 1：vendored 快照确实是上游那一版。
# 下面这些文件我们从不修改，md5 全部等于上游原值；任何一处对不上都说明 src/ 被误改
# （或与 LSKY_COMMIT 不符）→ 直接构建失败，不产出不可信的镜像。
RUN printf '%s\n' \
        '9fb843806abd6b778d8acd3366e2f0f1  ./app/Services/ImageService.php' \
        'c1adde95924944e07bd72e87bd5db2f7  ./config/convention.php' \
        '3b58bff18126a61c142cc576457c82a6  ./public/index.php' \
        '12b10ff822d7deb281664d6ff0c2c1e2  ./routes/web.php' \
    | md5sum -c -

# 有意偏离上游的另一个文件：composer.lock。
# 上游冻结在 2024-12 的解析结果（laravel 9.52.17 / symfony 6.0.x —— 两者都已 EOL），
# 我们把它升到「同一大版本线内的安全版本」：
#   laravel/framework 9.52.21（9.x 最后一个补丁）、symfony/* 6.4 LTS（Laravel 9 的 ^6.0 允许）、
#   guzzlehttp/guzzle 7.15.5、guzzlehttp/psr7 2.13.1、phpseclib 3.0.57、
#   league/commonmark 2.10.3、aws/aws-sdk-php 3.398.1、laminas-diactoros 2.26.0
#   —— 修掉了除「Laravel 9 框架自身那几条（9.x 线没有修复版本）」以外的已知公告。
# 所以它不再等于上游值 —— 但仍钉 md5：任何改动都必须同步更新这里（防止有人别处悄悄改）。
RUN printf '%s\n' \
        '9dfc7d029808dbca37cc239560e8f49f  ./composer.lock' \
    | md5sum -c -

RUN php -r "file_exists('.env') || copy('.env.example', '.env');" \
    && composer install

# ---------------------------------------------------------------------------
# fork 补丁：iOS 长按菜单修复 + 菜单交互修复（已就地在 src/ 里，这里只做校验）
#
# 补丁涉及三个文件（两份 JS 内容必须一致，别只改一份）：
#   src/resources/js/context-js.js             —— 可读源码
#   src/public/js/context-js/context-js.js     —— 浏览器实际加载的那份
#   src/resources/views/user/images.blade.php  —— 引入脚本那一行（资源版本串）
# （上游 webpack.mix.js 里本来也是 mix.copy('resources/js/context-js.js', 'public/js/context-js')，
#  只是仓库里 public/ 下那份是旧工具链留下的压缩产物，一直没跟着源码更新。）
# ---------------------------------------------------------------------------

# 自证 2：补丁内容与预期完全一致，blade 的资源版本串也在。
# 改 src/ 里这三个文件后必须同步更新这里的 md5（故意做成"改了不更新就构建失败"），
# 并重新生成 patches/ios-longpress.patch（tools/diff-vs-upstream.sh）。
RUN printf '%s\n' \
        'e114c840101d021aa416239196925624  ./public/js/context-js/context-js.js' \
        'e114c840101d021aa416239196925624  ./resources/js/context-js.js' \
        'f4e100c87d4becdcce163800db535775  ./resources/views/user/images.blade.php' \
    | md5sum -c - \
    && grep -q "context-js.js') . '?v=ios-longpress4'" ./resources/views/user/images.blade.php \
    && grep -q 'isIOSWebKit' ./public/js/context-js/context-js.js \
    && grep -q 'LONG_PRESS_DELAY = 250' ./public/js/context-js/context-js.js \
    && grep -q 'LONG_PRESS_DELAY = 250' ./resources/js/context-js.js \
    && grep -q 'installMenuGuard' ./public/js/context-js/context-js.js \
    && grep -q 'MENU_OPEN_GRACE' ./public/js/context-js/context-js.js \
    && grep -q 'touch-open' ./public/js/context-js/context-js.js

# 代码版本标记：入口脚本用它判断「卷里的代码是不是当前镜像这一版」，不一致才同步（见 entrypoint.sh）。
# 它由源码 commit + 补丁 md5 组成，正好是上面刚断言过的值 —— 任何代码/补丁变化都会让它变。
# 改 src/ 下任何文件（哪怕一行）后，都要把对应的 md5 一并更新，否则容器不会重新同步进卷。
RUN printf '%s\n' \
        "fork_sha=${FORK_SHA}" \
        "lsky_commit=${LSKY_COMMIT}" \
        "context_js_md5=e114c840101d021aa416239196925624" \
        "images_blade_md5=f4e100c87d4becdcce163800db535775" \
        > .code-revision \
    && cat .code-revision

FROM php:${PHP_VERSION}-apache-${DEBIAN_RELEASE}

ARG LSKY_COMMIT
ARG PHP_EXT_INSTALLER_VERSION
ARG FORK_SHA=unknown

LABEL org.opencontainers.image.source="https://github.com/mole404/lsky-pro-docker" \
      org.opencontainers.image.title="lsky-pro-docker (ios-longpress + menu-ux)" \
      org.opencontainers.image.description="Lsky Pro 图床的 Docker 镜像；应用源码 vendored 取自 lsky-org/lsky-pro@${LSKY_COMMIT}（构建不再依赖上游在线），并在其上做了 iOS 长按菜单修复与菜单交互修复（点菜单外只关菜单、触摸端二级菜单点击展开、滚动/缩放/Esc 关闭）" \
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

# ftp 必须**显式**装进运行时镜像：官方 php:8.1 镜像自带 ftp，php:8.3 的没有
# （2026-09-28 换 8.3 时 CI 实测：builder 阶段 composer install 直接失败，
#  报 league/flysystem-ftp requires ext-ftp）。它是 Lsky 的 FTP 存储驱动要用的扩展，
# 不能依赖"从基镜像继承"。CI 里也加了 ftp 的硬断言。
RUN apt-get update && \
    apt-get install -y gettext && \
    apt-get clean && rm -rf /var/cache/apt/* && rm -rf /var/lib/apt/lists/* && rm -rf /tmp/*  && \
    a2enmod rewrite && chmod +x /usr/local/bin/install-php-extensions && \
    install-php-extensions imagick bcmath pdo_mysql pdo_pgsql redis ftp && \
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
    && grep -q 'tar cf - --exclude=./.env --exclude=./.code-revision' /entrypoint.sh \
    && grep -q 'cp -a "$IMAGE_MARKER" "$VOLUME_MARKER"' /entrypoint.sh
WORKDIR /var/www/html/
VOLUME /var/www/html
ENV WEB_PORT 8089
ENV HTTPS_PORT 8088
EXPOSE ${WEB_PORT}
EXPOSE ${HTTPS_PORT}
RUN chmod a+x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["apachectl","-D","FOREGROUND"]
