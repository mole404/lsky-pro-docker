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
# laravel/framework 9.52.22（9.x 最后一个补丁）+ symfony/* 6.4 LTS（Laravel 9 的 ^6.0 正好允许）。
# 要回退 PHP：改这个数字即可，但请连镜像 tag 一起回退（新 lock 里的包可能要求 ≥8.3）。
ARG PHP_VERSION=8.3
ARG DEBIAN_RELEASE=bookworm
ARG PHP_EXT_INSTALLER_VERSION=2.12.0

# ---------------------------------------------------------------------------
# F15：基镜像钉 digest —— 上游重推 tag（同 tag 指向新内容）时，构建出来的仍是同一份东西。
# 两个阶段用的**不是**同一个基镜像（builder = cli，runtime = apache），各自钉自己的。
# 更新方法（改 PHP_VERSION / DEBIAN_RELEASE 时必须一并更新，否则构建会因 manifest 不匹配而失败）：
#   1) 取 token（本机没有 docker，别用 docker manifest）：
#      curl -s 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/php:pull'
#      -> 取返回 JSON 里的 .token
#   2) 读 digest（tag 换成要查的那个）：
#      curl -sI -H "Authorization: Bearer $TOKEN"
#           -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'
#           https://registry-1.docker.io/v2/library/php/manifests/8.3-cli-bookworm
#      -> 看响应头 Docker-Content-Digest（8.3-apache-bookworm 同理，两个都要查）
#   3) 把拿到的 sha256 填进下面的 ARG（**tag 保留**，digest 附在 @ 之后，形如 php:8.3-apache-bookworm@sha256:…）
# 注意：钉死后上游的安全修复**不会**自己进来 —— 想拿新修复就得重跑上面两步、更新 digest，再重建镜像。
# 试构建（CI 的 workflow_dispatch 换 PHP 版本）也要一并覆盖对应的 digest ARG。
# 实测（2026-09-30，Docker Hub Registry API 原始响应头，见提交说明/报告）：
#   php:8.3-cli-bookworm    -> sha256:4687aec76c4a895b68b91bcd5e48f1ba7a3dea120f6de50bba7e1a93af5372dd
#   php:8.3-apache-bookworm -> sha256:06df07e2e1d72581dde4fd97bc98d2d0b78686fc13d6a041c520da9a6ce73055
ARG PHP_CLI_IMAGE_DIGEST=sha256:4687aec76c4a895b68b91bcd5e48f1ba7a3dea120f6de50bba7e1a93af5372dd
ARG PHP_APACHE_IMAGE_DIGEST=sha256:06df07e2e1d72581dde4fd97bc98d2d0b78686fc13d6a041c520da9a6ce73055

FROM php:${PHP_VERSION}-cli-${DEBIAN_RELEASE}@${PHP_CLI_IMAGE_DIGEST} AS build

ARG LSKY_COMMIT
ARG FORK_SHA=unknown

WORKDIR /build

# 安装必要的依赖
#   curl  —— 装 composer
#   unzip —— composer 解压 dist 包要用（去掉它会导致 composer install 直接失败：CI 实测踩过）
#   git   —— 部分包会走 source 安装时的兜底
RUN docker-php-ext-install ftp

# 依赖安装（builder 阶段的平台要求必须满足，否则 composer install 直接失败）
# F16：composer 安装器**先校验、再执行**（不能像以前那样 `curl … | php` 直接把网上的字节喂给解释器）。
# 官方做法（2026-09-30 实查 https://getcomposer.org/download/）：预期 sha384 来自
# https://composer.github.io/installer.sig，与 https://getcomposer.org/installer 分属两个域名，
# 单一站点被投毒时另一侧能拦住。校验不过（sig 拉不到 / 格式不对 / 对不上）就不往下走 = 构建失败。
# 这里**故意不写死**哈希：installer 会随每个 composer 版本重新生成（官方文档明确警告别复制传播这段代码），
# 写死的话 composer 一发新版、构建就必然红。想连 composer 版本一起钉，改用带版本号的
# https://getcomposer.org/download/<version>/composer.phar + 同目录 .sha256sum 校验。
RUN apt-get update && \
    apt-get install -y curl unzip git && \
    curl -fsSL -o /tmp/composer-setup.php https://getcomposer.org/installer && \
    curl -fsSL -o /tmp/composer-setup.sig https://composer.github.io/installer.sig && \
    grep -Eq '^[0-9a-f]{96}$' /tmp/composer-setup.sig && \
    printf '%s  %s\n' "$(cat /tmp/composer-setup.sig)" /tmp/composer-setup.php | sha384sum -c - && \
    php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer && \
    rm -f /tmp/composer-setup.php /tmp/composer-setup.sig && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# 应用源码：本仓库 src/ 里的 vendored 快照（= 上游那个 commit 的完整树，304 个文件）。
# 前端补丁已经就地在 src/ 里改好，这里不做任何"叠加覆盖"。改代码 = 改 src/ 然后提交。
COPY src/ /build/

# 自证 1：vendored 快照确实是上游那一版。
# 下面这个文件我们从不修改，md5 等于上游原值；对不上就说明 src/ 被误改
# （或与 LSKY_COMMIT 不符）→ 直接构建失败，不产出不可信的镜像。
RUN printf '%s\n' \
        '3b58bff18126a61c142cc576457c82a6  ./public/index.php' \
    | md5sum -c -

# 自证 1b：有意偏离上游、但仍需锁死的文件。
# config/convention.php 与 routes/web.php 被本 fork 改过 —— 移除了「画廊」「系统升级」，
# 且首页 / 在登录状态下改为跳转「我的图片」（游客上传页只留给未登录用户）
# 两个功能（删配置项常量、删路由表条目，详见 README）。
# app/Services/ImageService.php 同样是有意偏离的：移除 SVG 支持时删掉了几个「只可能因为
# svg 数据而命中」的分支（上传跳过图片处理 / 跳过违规扫描的 in_array svg、makeThumbnail
# 里 svg 直拷原文件），详见 README「与上游的差异」第 7 条。
# 这三个文件以后只要被改动（哪怕手滑），构建就会红 —— md5 必须随改动同步更新。
RUN printf '%s\n' \
        '8136e73b50315d783f105dd4ac9971bb  ./config/convention.php' \
        'f6167a0726f8f2892494952a14c2bf49  ./routes/web.php' \
        'e7edc0fc9dc8c654c4debca0e1d2eac4  ./app/Services/ImageService.php' \
    | md5sum -c -

# 有意偏离上游的另一个文件：composer.lock。
# 上游冻结在 2024-12 的解析结果（laravel 9.52.17 / symfony 6.0.x —— 两者都已 EOL），
# 我们把它升到「同一大版本线内的安全版本」：
#   laravel/framework 9.52.22（9.x 最后一个补丁；9.52.21 -> 9.52.22 是一次安全修复）、symfony/* 6.4 LTS（Laravel 9 的 ^6.0 允许）、
#   guzzlehttp/guzzle 7.15.5、guzzlehttp/psr7 2.13.1、phpseclib 3.0.57、
#   league/commonmark 2.10.3、aws/aws-sdk-php 3.398.1、laminas-diactoros 2.26.0
#   —— 修掉了除「Laravel 9 框架自身那几条（9.x 线没有修复版本）」以外的已知公告。
# 所以它不再等于上游值 —— 但仍钉 md5：任何改动都必须同步更新这里（防止有人别处悄悄改）。
RUN printf '%s\n' \
        '47dc4ba720293bffe2d3ee1992775e02  ./composer.lock' \
    | md5sum -c -

# --no-dev：镜像只装运行时依赖。开发包（debugbar / ignition / whoops / phpunit / faker / sail…）
# 对线上没有用途，留着既是体积也是暴露面（debugbar 那类在调试模式下会漏内部信息）。
# 连带项：卷里的 bootstrap/cache/packages.php 是"当年装着开发包"时生成的，里面记着这些包的
# ServiceProvider 类名 —— 包没了之后，Laravel 引导时加载该清单会 Class not found → 整站 500。
# 所以 entrypoint 的同步分支会作废这份清单（连同 services.php），CI 里也有对应的回归断言。
RUN php -r "file_exists('.env') || copy('.env.example', '.env');" \
    && composer install --no-dev

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
        'b13fc1e4fede8c55c25862eb13cfcfcf  ./public/js/context-js/context-js.js' \
        'b13fc1e4fede8c55c25862eb13cfcfcf  ./resources/js/context-js.js' \
        'cab1ae9abf815ae3ca30a63608dbf004  ./resources/views/user/images.blade.php' \
    | md5sum -c - \
    && grep -q "assetVersion('js/context-js/context-js.js')" ./resources/views/user/images.blade.php \
    && grep -q 'isIOSWebKit' ./public/js/context-js/context-js.js \
    && grep -q 'LONG_PRESS_DELAY = 250' ./public/js/context-js/context-js.js \
    && grep -q 'LONG_PRESS_DELAY = 250' ./resources/js/context-js.js \
    && grep -q 'installMenuGuard' ./public/js/context-js/context-js.js \
    && grep -q 'MENU_OPEN_GRACE' ./public/js/context-js/context-js.js \
    && grep -q 'touch-open' ./public/js/context-js/context-js.js \
    && grep -q 'fitSubmenu' ./public/js/context-js/context-js.js \
    && grep -q 'clampMenu' ./resources/js/context-js.js \
    && grep -q 'submenu-inplace' ./public/js/context-js/context-js.js \
    && grep -q 'SUBMENU_GUARD' ./public/js/context-js/context-js.js

# 代码版本标记：入口脚本用它判断「卷里的代码是不是当前镜像这一版」，不一致才同步（见 entrypoint.sh）。
# 它由「源码 commit + 补丁 md5 + 内容指纹」组成：任何代码/补丁变化都会让它变。
# 改 src/ 下任何文件（哪怕一行）后，都要把对应的 md5 一并更新，否则容器不会重新同步进卷。
#
# 内容指纹（F22）：上面那两个 md5 只覆盖「我们打补丁的那几个文件」—— app.js / PHP 这类**没被钉 md5**
# 的文件改了之后标记不变，卷里的旧代码就永远不会被同步（镜像与卷不同步，且没有任何报错）。
# 所以这里再对三处构建期内容做确定性哈希，把它们也编进标记：
#   app_src_md5 = app/ config/ routes/ 三个目录下所有文件「按路径排序后内容拼接」的 md5
#                 （排序用 sort -z，与文件系统返回顺序无关 = 同一份源码在任何机器上结果一致）；
#   app_js_md5  = public/js/app.js 的 md5；app_css_md5 = public/css/app.css 的 md5。
# 任何一个不存在 / 命令失败都写 none（标记照写）—— **绝不能让构建失败**。
# 入口脚本比的是整个标记文件的内容，所以多出这几行 = 换镜像时自动触发同步，entrypoint 不需要改。
RUN APP_SRC_MD5=$(find app config routes -type f -print0 2>/dev/null | sort -z | xargs -0 -r cat 2>/dev/null | md5sum | cut -d' ' -f1); \
    [ -n "$APP_SRC_MD5" ] || APP_SRC_MD5=none; \
    APP_JS_MD5=$(md5sum public/js/app.js 2>/dev/null | cut -d' ' -f1); \
    [ -n "$APP_JS_MD5" ] || APP_JS_MD5=none; \
    APP_CSS_MD5=$(md5sum public/css/app.css 2>/dev/null | cut -d' ' -f1); \
    [ -n "$APP_CSS_MD5" ] || APP_CSS_MD5=none; \
    printf '%s\n' \
        "fork_sha=${FORK_SHA}" \
        "lsky_commit=${LSKY_COMMIT}" \
        "context_js_md5=b13fc1e4fede8c55c25862eb13cfcfcf" \
        "images_blade_md5=cab1ae9abf815ae3ca30a63608dbf004" \
        "app_src_md5=${APP_SRC_MD5}" \
        "app_js_md5=${APP_JS_MD5}" \
        "app_css_md5=${APP_CSS_MD5}" \
        > .code-revision \
    && cat .code-revision

FROM php:${PHP_VERSION}-apache-${DEBIAN_RELEASE}@${PHP_APACHE_IMAGE_DIGEST}

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
# F16：mlocati 的 release **只有脚本本身、没有官方校验资产**（2026-09-30 实查 2.12.0 的 release assets
# 只有 1 个），所以期望 sha256 直接写死在仓库里，下载后立即校验，验不过就构建失败。
# 换 PHP_EXT_INSTALLER_VERSION 时**必须**同步更新下面这个值（故意的：忘了就红）：
#   新值取法：curl -fsSL -o /tmp/ipe "https://github.com/mlocati/docker-php-extension-installer/releases/download/<新版本>/install-php-extensions" && sha256sum /tmp/ipe
#   当前值对应 2.12.0（2026-09-30 实测）：3f49c71fa66c79b8b2b96bc0ce92885dafd7946f3b5a46f545b390d6f1617e2c
ARG PHP_EXT_INSTALLER_SHA256=3f49c71fa66c79b8b2b96bc0ce92885dafd7946f3b5a46f545b390d6f1617e2c
RUN curl -fsSL -o /usr/local/bin/install-php-extensions \
        "https://github.com/mlocati/docker-php-extension-installer/releases/download/${PHP_EXT_INSTALLER_VERSION}/install-php-extensions" \
    && echo "${PHP_EXT_INSTALLER_SHA256}  /usr/local/bin/install-php-extensions" | sha256sum -c -

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

# F21：不再随镜像发货证书。
# 原来这里是 `COPY ./ssl /etc/ssl` —— 把仓库里那对 Debian snakeoil 证书（ssl/certs + ssl/private，
# 在 GitHub 上人人可见）拷进镜像，模板的 HTTPS vhost 直接引用它 = 每个使用者共用同一份公开私钥。
# 现在改成运行期自签：入口脚本首次启动时用 openssl 生成到 /etc/apache2/ssl/（模板指向那里），
# 所以镜像里**不再有任何证书/私钥文件**。openssl 必须存在 —— 由下面的护栏钉住。

COPY --from=build /build /var/www/lsky/
COPY ./000-default.conf.template /etc/apache2/sites-enabled/
COPY ./ports.conf.template /etc/apache2/
# Apache MPM 模板：入口脚本会把它（按 APACHE_* 渲染后）写到 /etc/apache2/conf-enabled/mpm.conf，
# 覆盖 mods-enabled 里 mpm_prefork.conf 的出厂值（apache2.conf 先 include mods-enabled 再 include conf-enabled）。
COPY ./mpm.conf.template /etc/apache2/
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

# MPM 模板护栏：模板必须真的进镜像、入口脚本必须真的往 conf-enabled 写（漏了 COPY 或改了目标路径就构建失败）。
# 这里只做静态断言；渲染/覆盖是否生效由 CI 里的真容器自证（Verify Apache MPM defaults and overrides）。
RUN test -f /etc/apache2/mpm.conf.template \
    && test -d /etc/apache2/conf-enabled \
    && grep -q 'conf-enabled/mpm.conf' /entrypoint.sh \
    && grep -q 'APACHE_START_SERVERS' /etc/apache2/mpm.conf.template \
    && grep -q 'APACHE_MIN_SPARE_SERVERS' /etc/apache2/mpm.conf.template \
    && grep -q 'APACHE_MAX_SPARE_SERVERS' /etc/apache2/mpm.conf.template \
    && grep -q 'APACHE_MAX_REQUEST_WORKERS' /etc/apache2/mpm.conf.template \
    && grep -q 'APACHE_MAX_CONNECTIONS_PER_CHILD' /etc/apache2/mpm.conf.template \
    && grep -q 'APACHE_KEEP_ALIVE' /etc/apache2/mpm.conf.template

# F10 护栏：健康检查要用的 curl 在运行镜像里真的存在（php:*-apache 自带，但别依赖「我记得它自带」）。
RUN command -v curl > /dev/null

# F21 护栏：运行期自签 HTTPS 证书要用 openssl（php:*-apache 基于 debian:bookworm，自带 openssl；
# 但别依赖「我记得它自带」）。缺了它入口脚本只能打警告，HTTPS vhost 起不来。
RUN command -v openssl > /dev/null
WORKDIR /var/www/html/
VOLUME /var/www/html
ENV WEB_PORT 8089
ENV HTTPS_PORT 8088
EXPOSE ${WEB_PORT}
EXPOSE ${HTTPS_PORT}

# F10：健康检查。原来没有 —— 「Apache 进程还在」不代表站点还活着（卷同步失败的容器进程照样在）。
# 探本机 http://127.0.0.1:${WEB_PORT}/：shell 形式下 ${WEB_PORT} 是**运行期**由 ENV 展开的，
# 所以 compose/`-e WEB_PORT=xxxx` 换了端口也照样探对端口（不用改这里）。
# curl -f：HTTP 状态 ≥400 或连不上都算失败（非 0 退出 = unhealthy）；302/200 都算健康
# —— 未安装状态下 / 会 302 去安装页，登录后首页也可能 302，这两种都不该被判定为病态。
# start-period=90s：入口脚本要渲染 Apache/MPM 配置再把应用播种进卷（CI 里最长等到 60s），
# 这段时间内的失败不计入 retries，避免容器刚起来就 HEALTING→unhealthy。
# 依赖 curl 在运行镜像里必然存在（php:*-apache 官方镜像自带；下面的护栏会钉住这一点）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT}/"

RUN chmod a+x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["apachectl","-D","FOREGROUND"]
