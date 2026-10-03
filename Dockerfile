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
#   6. 运行时加固（F23，2026-09-30）：PHP 关掉 expose_php / display_errors
#      （/usr/local/etc/php/conf.d/zz-lsky-hardening.ini）、Apache 关掉版本号外泄
#      （/etc/apache2/conf-enabled/zz-lsky-hardening.conf：ServerTokens Prod + ServerSignature Off），
#      两处都带构建期断言；CI 的「Verify published image」再对真实响应头断言一次。
#   7. 认证类 POST 加路由级节流（src/routes/auth.php：login/register/forgot-password/confirm-password）
#   8. 测试版内存收紧（2026-10-01）：PHP memory_limit 收到 64M（可运行时用 env PHP_MEMORY_LIMIT
#      覆盖，entrypoint 渲染进上面的 hardening ini）、opcache memory_consumption 128→64、
#      Apache MaxConnectionsPerChild 保持默认 5（低流量站，每 ~3 分钟换班开销可忽略，
#      取最严的内存纪律；可运行时用 env APACHE_MAX_CONNECTIONS_PER_CHILD 覆盖，0 = 永不回收）。
#      详见各段注释与 CI「Verify published image」的新断言。
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
# 试构建（CI 的 workflow_dispatch 换 PHP 版本）也要一并覆盖对应的 digest ARG：
# 带 `@digest` 时 **digest 优先、tag 只作装饰**，只换 PHP_VERSION 不换 digest 会静默构建出旧版本。
# CI 已自动化：build-image.yaml 的 Resolve 步骤会按请求的 PHP 版本解析出对应 digest 并覆盖这两个 ARG
# （也可在 workflow_dispatch 里手工传 php_cli_digest / php_apache_digest）。上面这套手工方法仅用于本地/离线场景。
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
# routes/auth.php 也是有意偏离（F23 防爆破）：给 login / register / forgot-password /
# confirm-password 四个 POST 端点加了 throttle（详见文件内注释）。它同样被钉住，
# 改了不更新这行 md5 就构建失败。
# 这几个文件以后只要被改动（哪怕手滑），构建就会红 —— md5 必须随改动同步更新。
RUN printf '%s\n' \
        '8136e73b50315d783f105dd4ac9971bb  ./config/convention.php' \
        '881fdbaed19ef39027783f093448875d  ./routes/web.php' \
        'c1ab546f3e7f5237c1d45435171858ce  ./routes/auth.php' \
        'e7edc0fc9dc8c654c4debca0e1d2eac4  ./app/Services/ImageService.php' \
    | md5sum -c -

# 有意偏离上游的另一个文件：composer.lock。
# 上游冻结在 2024-12 的解析结果（laravel 9.52.17 / symfony 6.0.x —— 两者都已 EOL），
# 我们把它升到「同一大版本线内的安全版本」：
#   laravel/framework 9.52.22（9.x 最后一个补丁；9.52.21 -> 9.52.22 是一次安全修复）、symfony/* 6.4 LTS（Laravel 9 的 ^6.0 允许）、
#   guzzlehttp/guzzle 7.15.5、guzzlehttp/psr7 2.13.1、phpseclib 3.0.57、
#   league/commonmark 2.10.3、aws/aws-sdk-php 3.398.1、laminas-diactoros 2.26.0
#   psy/psysh 0.11.23（2026-09-30：原 0.11.12 有 GHSA-4486-gxhx-5mg7 —— CWD 下 .psysh.php 自动加载
#   导致本地提权；上游在同一条 0.11 线发了修复，随 laravel/tinker 一起进镜像，故一并升掉。
#   osv-scanner.toml 里对应那条白名单已随之删除=扫描真的干净，而不是被豁免。）
#   —— 修掉了除「Laravel 9 框架自身那几条（9.x 线没有修复版本）」以外的已知公告。
# 所以它不再等于上游值 —— 但仍钉 md5：任何改动都必须同步更新这里（防止有人别处悄悄改）。
RUN printf '%s\n' \
        '12ab233331630b2dd1c48cee9e5ce927  ./composer.lock' \
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
        'c0e513ec8e93fd81b34b3c6de5cf5eb8  ./public/js/context-js/context-js.js' \
        'c0e513ec8e93fd81b34b3c6de5cf5eb8  ./resources/js/context-js.js' \
        'dad60266ca53a1af4b52567dac2d0dbb  ./resources/views/user/images.blade.php' \
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
#   app_js_md5  = public/js/app.js 的 md5；app_css_md5 = public/css/app.css 的 md5；
#   composer_lock_md5 = composer.lock 的 md5（应用根目录，构建后镜像里是 /var/www/lsky/composer.lock）。
#                 补这一条的背景：上面的指纹只覆盖「代码」，而 composer.lock 变了（只升级 vendor 依赖、
#                 其它 PHP/前端都没动）时，标记不变 → 老卷不会重新同步 → 卷里是旧依赖、镜像里是新依赖。
#                 composer install 是在 build 阶段、镜像自带的 vendor/ 已经按新 lock 装好；
#                 加了这一条，只换依赖的镜像也会让标记变、触发一次同步。
# 任何一个不存在 / 命令失败都写 none（标记照写）—— **绝不能让构建失败**。
# 入口脚本比的是整个标记文件的内容，所以多出这几行 = 换镜像时自动触发同步，entrypoint 不需要改。
RUN APP_SRC_MD5=$(find app config routes -type f -print0 2>/dev/null | sort -z | xargs -0 -r cat 2>/dev/null | md5sum | cut -d' ' -f1); \
    [ -n "$APP_SRC_MD5" ] || APP_SRC_MD5=none; \
    APP_JS_MD5=$(md5sum public/js/app.js 2>/dev/null | cut -d' ' -f1); \
    [ -n "$APP_JS_MD5" ] || APP_JS_MD5=none; \
    APP_CSS_MD5=$(md5sum public/css/app.css 2>/dev/null | cut -d' ' -f1); \
    [ -n "$APP_CSS_MD5" ] || APP_CSS_MD5=none; \
    COMPOSER_LOCK_MD5=$(md5sum composer.lock 2>/dev/null | cut -d' ' -f1); \
    [ -n "$COMPOSER_LOCK_MD5" ] || COMPOSER_LOCK_MD5=none; \
    printf '%s\n' \
        "fork_sha=${FORK_SHA}" \
        "lsky_commit=${LSKY_COMMIT}" \
        "context_js_md5=c0e513ec8e93fd81b34b3c6de5cf5eb8" \
        "images_blade_md5=dad60266ca53a1af4b52567dac2d0dbb" \
        "app_src_md5=${APP_SRC_MD5}" \
        "app_js_md5=${APP_JS_MD5}" \
        "app_css_md5=${APP_CSS_MD5}" \
        "composer_lock_md5=${COMPOSER_LOCK_MD5}" \
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

# F21 修正（CI 实撞，2026-09-30）：Debian 自带的 /etc/apache2/sites-available/default-ssl.conf
# 由上面的 a2ensite 启用，而它**仍指向被删掉的那对 snakeoil 证书文件** → Apache 启动时配置校验报
#   AH00526: SSLCertificateFile: file '/etc/ssl/certs/ssl-cert-snakeoil.pem' does not exist or is empty
# 整个 Apache 起不来（症状很难认：容器进程在、安装页返回 000）。
# 把它也指到入口脚本运行期生成的那对证书（路径固定，与 000-default.conf.template 的 HTTPS vhost 一致）。
# 护栏按**文件路径**判而不是按 "snakeoil" 这个词判 —— 该文件里有一句提到 snakeoil 的注释是正常的。
# （本地在真容器里模拟过：改完 + 证书就位 → apache2ctl -t 输出 Syntax OK）
RUN sed -i \
        -e 's#/etc/ssl/certs/ssl-cert-snakeoil.pem#/etc/apache2/ssl/lsky-selfsigned.crt#' \
        -e 's#/etc/ssl/private/ssl-cert-snakeoil.key#/etc/apache2/ssl/lsky-selfsigned.key#' \
        /etc/apache2/sites-available/default-ssl.conf \
    && ! grep -rn '/etc/ssl/certs/ssl-cert-snakeoil\|/etc/ssl/private/ssl-cert-snakeoil' /etc/apache2/ \
    && grep -q 'lsky-selfsigned.crt' /etc/apache2/sites-available/default-ssl.conf

# ---------------------------------------------------------------------------
# F23：Apache 版本号外泄 —— 关掉 Server 头里的精确版本与页脚签名。
#   实测（2026-09-30，本机 docker run 已发布镜像）：响应头 `Server: Apache/2.4.68 (Debian)`。
#   （同一次探测还看到 `X-Powered-By: PHP/8.3.35` —— 那条由下面的 PHP ini 加固负责。）
#   ServerTokens Prod  → Server 头只发 "Apache"（不带版本 / 模块 / OS）；
#   ServerSignature Off → 错误页与目录列表不再追加 "Apache/2.4.68 (Debian) Server at …" 页脚
#                        （Debian 出厂默认本就是 Off，这里显式写死：基镜像换版本时默认值可能变）。
#   为什么放 conf-enabled 的独立文件、而不是 000-default.conf.template 那个 vhost 模板：
#     ① ServerTokens 是**全局（main server config）指令**，写进 <VirtualHost> 里 Apache 会直接
#        拒绝加载该配置（"ServerTokens not allowed in <VirtualHost> context"）→ 整站起不来；
#        它必须落在全局上下文，而模板整份就是 vhost。
#     ② 那个模板同时管 HTTPS vhost、目录权限等一堆东西，改它等于改 vhost 行为，风险面远大于
#        「加一个 conf-enabled 文件」。
#     ③ apache2.conf 先 IncludeOptional mods-enabled/ 再 IncludeOptional conf-enabled/，入口
#        脚本写 mpm.conf 也走这里；conf-enabled 不会被入口脚本覆写，换镜像照样生效。
#   构建期自证：① 文件真的在；② 两行**逐行精确**在里面（grep -qx，不是模糊包含）。
#   语法由真容器自证（CI 的 smoke 步骤会起容器跑 Apache，配置写错站点就起不来）。
# ---------------------------------------------------------------------------
RUN printf '%s\n' \
        '# fork 加固（F23）：不对外泄露 Apache 精确版本' \
        'ServerTokens Prod' \
        'ServerSignature Off' \
        > /etc/apache2/conf-enabled/zz-lsky-hardening.conf \
    && test -f /etc/apache2/conf-enabled/zz-lsky-hardening.conf \
    && grep -qx 'ServerTokens Prod' /etc/apache2/conf-enabled/zz-lsky-hardening.conf \
    && grep -qx 'ServerSignature Off' /etc/apache2/conf-enabled/zz-lsky-hardening.conf

# ftp 必须**显式**装进运行时镜像：官方 php:8.1 镜像自带 ftp，php:8.3 的没有
# （2026-09-28 换 8.3 时 CI 实测：builder 阶段 composer install 直接失败，
#  报 league/flysystem-ftp requires ext-ftp）。它是 Lsky 的 FTP 存储驱动要用的扩展，
# 不能依赖"从基镜像继承"。CI 里也加了 ftp 的硬断言。
#
# opcache（测试版收紧，先量后改）：原值 memory_consumption=128 / max_accelerated_files=10000。
#   实测（2026-10-01，本机真容器 Apache 进程内 opcache_get_status）：
#     · 真实负载（安装页 + 登录/注册/首页等通跑一轮）预热集合 = 827 个脚本 / 已用 25.0MB；
#     · 全树编译（把 /var/www/lsky 下 10842 个 .php 全部塞进缓存）上限 = 9949 个脚本 / 255.9MB
#       （在 256MB 上限处被截断 —— 这是"理论上限"，没有任何单次请求会走到）。
#   真实使用约 25MB，故 memory_consumption 收到 64（≈实测 2.6 倍，且不低于 64）：
#   够用又有余量，比原来的 128 省 64MB 共享内存（本机 965MB，内存是瓶颈）。
#   max_accelerated_files 保持 10000 —— 已远超实测预热集合（827）的 12 倍；哈希表本身只占 KB 级，
#   调低没有收益、调高没有意义（64MB 的脚本缓存也装不下全树）。这组值下 opcache 不会因容量不足频繁重启。
#   validate_timestamps 保持 1（显式写死，防基镜像默认变化）：单机热更新靠它 —— 卷里代码一改，
#   带 mtime 校验的请求就会重新编译；关掉它换镜像后要重启容器才生效。
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
    echo 'opcache.memory_consumption=64'; \
    echo 'opcache.save_comments=1'; \
    echo 'opcache.revalidate_freq=1'; \
    echo 'opcache.validate_timestamps=1'; \
    } > /usr/local/etc/php/conf.d/opcache-recommended.ini; \
    \
    echo 'apc.enable_cli=1' >> /usr/local/etc/php/conf.d/docker-php-ext-apcu.ini; \
    \
    echo 'memory_limit=512M' > /usr/local/etc/php/conf.d/memory-limit.ini; \
    \
    mkdir /var/www/data; \
    chown -R www-data:root /var/www; \
    chmod -R g=u /var/www

# ---------------------------------------------------------------------------
# F23：PHP ini 加固 —— 关掉「版本号外泄」与「错误直出」。
#   实测（2026-09-30，本机 docker run 已发布镜像）：响应头带 `X-Powered-By: PHP/8.3.35`。
#   官方 php 镜像**不带 php.ini**（只有 php.ini-production/-development 两个样本），于是
#   PHP 编译期的默认值直接生效：expose_php=1、display_errors=1。
#     expose_php=0     → 不再发 X-Powered-By（少给扫描器一条精确版本情报）；
#     display_errors=0 → 运行期错误不往 HTTP 响应里吐（Laravel 自己的错误处理/日志不受影响）。
#   文件名用 zz- 前缀：conf.d 里的 ini 按**文件名 ASCII 序**加载、后加载的覆盖先前的，
#   zz- 排最后 = 以后基镜像或扩展安装器再加什么 ini，都盖不掉这两项（顺序就是这里的关键）。
#   本次（测试版）追加 memory_limit=64M：先读现状 —— PHP 编译期默认 128M，而镜像里
#   （上游）memory-limit.ini 写的是 512M，所以**原来的生效值是 512M**。把 64M 放进这份
#   zz- 文件即可生效（排最后、覆盖 memory-limit.ini），不必去改那份上游 ini。
#   默认 64M 而不是写死：entrypoint.sh 运行期会把 PHP_MEMORY_LIMIT（默认 64M）渲染进这一项，
#   在 compose 里改一个 env 就能回 128M/256M、不用重建镜像（脏值只忽略该项并警告）。
#   其余 ini 未动：upload（100M 上传上限）保持原样；opcache-recommended.ini 的
#   memory_consumption 本次从 128 收到 64（依据见上面 opcache 段的实测注释）。
#   构建期自证：用 php -r **真读回 ini_get()** 断言已是目标值 —— 不是 grep 配置文件里有没有那几行
#   （那只证明"文件写了"，证明不了"PHP 真的读到了"）。expose_php/display_errors 判定用
#   filter_var(FILTER_VALIDATE_BOOL)，兼容 Off / false / 0 / 空串 几种写法；memory_limit 直接比对
#   字符串 "64M"。CLI 与 Apache 模块用的是同一份 /usr/local/etc/php/conf.d。
# ---------------------------------------------------------------------------
RUN printf '%s\n' \
        '; fork 加固（F23 + 测试版）：不泄露版本号 / 错误不直出 / 收紧内存上限' \
        'expose_php=0' \
        'display_errors=0' \
        'memory_limit=64M' \
        > /usr/local/etc/php/conf.d/zz-lsky-hardening.ini \
    && test -f /usr/local/etc/php/conf.d/zz-lsky-hardening.ini \
    && php -r 'foreach (["expose_php", "display_errors"] as $k) { if (filter_var(ini_get($k), FILTER_VALIDATE_BOOL)) { fwrite(STDERR, "ini 加固自证失败：".$k." 仍开着 (".var_export(ini_get($k), true).")".PHP_EOL); exit(1); } echo $k."=".var_export(ini_get($k), true)." 已关闭".PHP_EOL; }' \
    && php -r '$m = ini_get("memory_limit"); if ($m !== "64M") { fwrite(STDERR, "memory_limit 自证失败：读回 ".var_export($m, true)."，期望 64M（zz-lsky-hardening.ini 是否被别的 ini 覆盖？）".PHP_EOL); exit(1); } echo "memory_limit=".$m."（entrypoint 可用 PHP_MEMORY_LIMIT 运行期覆盖）".PHP_EOL;'

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
    && grep -q '^composer_lock_md5=' /var/www/lsky/.code-revision \
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
ENV WEB_PORT=8089
ENV HTTPS_PORT=8088
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
