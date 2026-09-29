#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 用途：把本仓库 src/ 与上游官方快照做**全树对比**，回答两个问题：
#   1) 我们相对上游到底改了哪几个文件、改了什么（默认就打印这个）
#   2) src/ 里有没有「手滑改动」—— 只要出现**已知偏离清单**之外的文件与上游不同就报警
#
# 依赖：git（需要能访问 github.com；上游已停更，平时不需要跑这个脚本）
# 用法：bash tools/diff-vs-upstream.sh [commit]     # 默认用 Dockerfile 里的 LSKY_COMMIT
#
# 维护：有意改了 src/ 里的上游文件后，把该文件登记进下面的 KNOWN_DEVIATIONS（附一句理由），
#       否则脚本会把它当成「手滑改动」而 exit 1。反过来说：只要它不报错，src/ 相对上游
#       的改动就**恰好**是清单里这些 —— 这也正是 CI / 人工复核想看到的不变量。
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

COMMIT="${1:-$(grep -oE '^ARG LSKY_COMMIT=[0-9a-f]+' Dockerfile | cut -d= -f2)}"
if [ -z "$COMMIT" ]; then
    echo "用法：bash tools/diff-vs-upstream.sh <上游 commit>" >&2
    exit 2
fi

# ===========================================================================
# 已知偏离清单（KNOWN DEVIATIONS）—— 本 fork **有意**相对上游修改的上游文件。
#      判据：diff 出来的「内容不同」清单必须**恰好**落在下面这些行内（顺序无关）。
#      不在清单里的文件一旦与上游不同 = 手滑改动 / 未登记的改动 → 报警 + exit 1。
#
# 每行是 `src/<路径>`；它上方最近的 `# [n ...]` 注释就是「这个文件为什么偏离上游」的理由。
# 新增/删除条目时「理由」必须跟着改 —— 这份清单本身就是「我们和上游差在哪」的权威记录。
#
# 注意：这里只登记「内容不同」（两边都存在、内容不一样）的文件。
#       “只在一边存在”（我们新增的 theme.js / public/static 等、上游有而我们删掉的
#        Gallery/Upgrade 文件）只做信息展示，不参与报警 —— src/ 里还混着 node_modules /
#       vendor / storage 这类构建或运行期产物，用「新增文件」报警会全是噪音。
# ===========================================================================
KNOWN_RAW=$(cat <<'EOF'
# [1 补丁产物：iOS Safari 长按弹菜单 + 菜单交互修复]
#   src/resources/js/context-js.js
src/resources/js/context-js.js
#   src/public/js/context-js/context-js.js
src/public/js/context-js/context-js.js
#   src/resources/views/user/images.blade.php
src/resources/views/user/images.blade.php
#   #   （两份 JS 内容必须逐字节一致；blade 只改了引入脚本那一行的资源版本串。完整 diff：patches/ios-longpress.patch）
#   （两份 JS 内容必须逐字节一致；blade 只改了引入脚本那一行的资源版本串。完整 diff：patches/ios-longpress.patch）

# [2 功能移除：画廊（Gallery）与系统升级；登录态访问首页改跳「我的图片」]
#   src/app/Enums/ConfigKey.php
src/app/Enums/ConfigKey.php
#   src/app/Http/Controllers/Admin/SettingController.php
src/app/Http/Controllers/Admin/SettingController.php
#   src/config/app.php
src/config/app.php
#   src/config/convention.php
src/config/convention.php
#   src/routes/web.php
src/routes/web.php
#   src/resources/views/admin/setting/index.blade.php
src/resources/views/admin/setting/index.blade.php

# [3 安全：彻底移除 SVG 上传（读取侧硬过滤 + 只可能因 svg 命中的死代码清理）]
#   src/app/Http/Controllers/Controller.php
src/app/Http/Controllers/Controller.php
#   src/app/Http/Requests/Admin/GroupRequest.php
src/app/Http/Requests/Admin/GroupRequest.php
#   src/app/Models/Group.php
src/app/Models/Group.php
#   src/app/Models/Image.php
src/app/Models/Image.php
#   src/app/Services/ImageService.php
src/app/Services/ImageService.php

# [4 依赖安全升级：composer.lock 升到同大版本线内的安全版本
#   （laravel/framework 9.52.22、symfony/* 6.4 LTS、guzzle、phpseclib、commonmark 等一批 CVE 修复）]
#   src/composer.lock
src/composer.lock

# [5 前端源码：全站前端换新（清爽极简 + 亮/暗/跟随系统）及后续 UI/交互迭代
#   （菜单/弹窗/侧栏/图片页…；app/Utils.php 是配套加的「资源版本串 / 本地默认头像」助手方法）]
#   src/app/Utils.php
src/app/Utils.php
#   src/package.json
src/package.json
#   src/resources/css/app.css
src/resources/css/app.css
#   src/resources/css/common.less
src/resources/css/common.less
#   src/resources/css/context-js.less
src/resources/css/context-js.less
#   src/resources/js/app.js
src/resources/js/app.js
#   src/resources/js/stores/sidebar.js
src/resources/js/stores/sidebar.js
#   src/resources/views/admin/console/index.blade.php
src/resources/views/admin/console/index.blade.php
#   src/resources/views/admin/group/add.blade.php
src/resources/views/admin/group/add.blade.php
#   src/resources/views/admin/group/edit.blade.php
src/resources/views/admin/group/edit.blade.php
#   src/resources/views/admin/group/index.blade.php
src/resources/views/admin/group/index.blade.php
#   src/resources/views/admin/group/rules.blade.php
src/resources/views/admin/group/rules.blade.php
#   src/resources/views/admin/image/index.blade.php
src/resources/views/admin/image/index.blade.php
#   src/resources/views/admin/strategy/add.blade.php
src/resources/views/admin/strategy/add.blade.php
#   src/resources/views/admin/strategy/edit.blade.php
src/resources/views/admin/strategy/edit.blade.php
#   src/resources/views/admin/strategy/index.blade.php
src/resources/views/admin/strategy/index.blade.php
#   src/resources/views/admin/strategy/tips.blade.php
src/resources/views/admin/strategy/tips.blade.php
#   src/resources/views/admin/user/edit.blade.php
src/resources/views/admin/user/edit.blade.php
#   src/resources/views/admin/user/index.blade.php
src/resources/views/admin/user/index.blade.php
#   src/resources/views/auth/confirm-password.blade.php
src/resources/views/auth/confirm-password.blade.php
#   src/resources/views/auth/forgot-password.blade.php
src/resources/views/auth/forgot-password.blade.php
#   src/resources/views/auth/login.blade.php
src/resources/views/auth/login.blade.php
#   src/resources/views/auth/register.blade.php
src/resources/views/auth/register.blade.php
#   src/resources/views/auth/reset-password.blade.php
src/resources/views/auth/reset-password.blade.php
#   src/resources/views/auth/verify-email.blade.php
src/resources/views/auth/verify-email.blade.php
#   src/resources/views/common/api.blade.php
src/resources/views/common/api.blade.php
#   src/resources/views/components/auth-card.blade.php
src/resources/views/components/auth-card.blade.php
#   src/resources/views/components/auth-validation-errors.blade.php
src/resources/views/components/auth-validation-errors.blade.php
#   src/resources/views/components/box.blade.php
src/resources/views/components/box.blade.php
#   src/resources/views/components/button.blade.php
src/resources/views/components/button.blade.php
#   src/resources/views/components/code.blade.php
src/resources/views/components/code.blade.php
#   src/resources/views/components/container.blade.php
src/resources/views/components/container.blade.php
#   src/resources/views/components/default-avatar.blade.php
src/resources/views/components/default-avatar.blade.php
#   src/resources/views/components/dropdown-link.blade.php
src/resources/views/components/dropdown-link.blade.php
#   src/resources/views/components/dropdown.blade.php
src/resources/views/components/dropdown.blade.php
#   src/resources/views/components/fieldset-checkbox.blade.php
src/resources/views/components/fieldset-checkbox.blade.php
#   src/resources/views/components/fieldset-radio.blade.php
src/resources/views/components/fieldset-radio.blade.php
#   src/resources/views/components/fieldset.blade.php
src/resources/views/components/fieldset.blade.php
#   src/resources/views/components/input.blade.php
src/resources/views/components/input.blade.php
#   src/resources/views/components/label.blade.php
src/resources/views/components/label.blade.php
#   src/resources/views/components/loading-spin.blade.php
src/resources/views/components/loading-spin.blade.php
#   src/resources/views/components/modal.blade.php
src/resources/views/components/modal.blade.php
#   src/resources/views/components/nav-link.blade.php
src/resources/views/components/nav-link.blade.php
#   src/resources/views/components/no-data.blade.php
src/resources/views/components/no-data.blade.php
#   src/resources/views/components/select.blade.php
src/resources/views/components/select.blade.php
#   src/resources/views/components/table.blade.php
src/resources/views/components/table.blade.php
#   src/resources/views/components/textarea.blade.php
src/resources/views/components/textarea.blade.php
#   src/resources/views/components/upload.blade.php
src/resources/views/components/upload.blade.php
#   src/resources/views/install.blade.php
src/resources/views/install.blade.php
#   src/resources/views/layouts/app.blade.php
src/resources/views/layouts/app.blade.php
#   src/resources/views/layouts/guest.blade.php
src/resources/views/layouts/guest.blade.php
#   src/resources/views/layouts/header.blade.php
src/resources/views/layouts/header.blade.php
#   src/resources/views/layouts/notice.blade.php
src/resources/views/layouts/notice.blade.php
#   src/resources/views/layouts/sidebar.blade.php
src/resources/views/layouts/sidebar.blade.php
#   src/resources/views/layouts/strategies.blade.php
src/resources/views/layouts/strategies.blade.php
#   src/resources/views/layouts/user-nav.blade.php
src/resources/views/layouts/user-nav.blade.php
#   src/resources/views/user/dashboard.blade.php
src/resources/views/user/dashboard.blade.php
#   src/resources/views/user/settings.blade.php
src/resources/views/user/settings.blade.php
#   src/resources/views/welcome.blade.php
src/resources/views/welcome.blade.php
#   src/tailwind.config.js
src/tailwind.config.js
#   src/webpack.mix.js
src/webpack.mix.js

# [6 前端构建产物：由 [5] 的源码经 webpack（npm run prod）重建得到，与上游那份旧产物逐字节不同]
#   src/public/css/app.css
src/public/css/app.css
#   src/public/css/common.css
src/public/css/common.css
#   src/public/css/context-js/context-js.css
src/public/css/context-js/context-js.css
#   src/public/css/fontawesome.css
src/public/css/fontawesome.css
#   src/public/js/app.js
src/public/js/app.js
#   src/public/js/app.js.LICENSE.txt
src/public/js/app.js.LICENSE.txt
#   src/public/js/blueimp-file-upload/jquery.fileupload.js
src/public/js/blueimp-file-upload/jquery.fileupload.js
#   src/public/js/blueimp-load-image/load-image.all.min.js
src/public/js/blueimp-load-image/load-image.all.min.js
#   src/public/js/clipboard/clipboard.min.js
src/public/js/clipboard/clipboard.min.js
#   src/public/js/dragselect/ds.min.js
src/public/js/dragselect/ds.min.js
#   src/public/js/echarts/echarts.min.js
src/public/js/echarts/echarts.min.js
#   src/public/js/masonry/masonry.pkgd.min.js
src/public/js/masonry/masonry.pkgd.min.js
#   src/public/js/viewer-js/viewer.min.js
src/public/js/viewer-js/viewer.min.js
#   src/public/mix-manifest.json
src/public/mix-manifest.json
#
# [7 SQLite 并发参数（B9）：连接建立时把 journal_mode 设成 WAL + 用 PDO::ATTR_TIMEOUT 设 busy_timeout，
#    避免并发读写偶发 'database is locked'。Laravel 9.52 的 sqlite 驱动不认 journal_mode/busy_timeout
#    这两个 config 键，所以 journal_mode 只能 PRAGMA（放在 AppServiceProvider）]
#   src/app/Providers/AppServiceProvider.php
src/app/Providers/AppServiceProvider.php
#   src/config/database.php
src/config/database.php
EOF
)
# 去掉注释/空行/行尾空白，得到排序后的文件清单
KNOWN="$(printf '%s\n' "$KNOWN_RAW" | sed -e 's/#.*//' -e 's/[[:space:]]*$//' -e '/^[[:space:]]*$/d' | sort)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/3] 拉取上游快照 ${COMMIT:0:9} …"
git init -q "$TMP/up"
git -C "$TMP/up" remote add origin https://github.com/lsky-org/lsky-pro.git
git -C "$TMP/up" fetch -q --depth 1 origin "$COMMIT"
git -C "$TMP/up" checkout -q FETCH_HEAD

echo "[2/3] 全树对比（只列有差异的文件）…"
# 排除构建/运行期产物：它们不在上游仓库里，也不属于「源码有没有被改」的判据
diff -rq --exclude=.git --exclude=node_modules --exclude=vendor --exclude=storage \
        --exclude=cache --exclude=.env "$TMP/up" src > "$TMP/raw.txt" 2>&1 || true

# 分类：内容不同 / 只在 src（我们新增）/ 只在上游（我们删了）
DIFFERS=$(grep -oE '^Files .* and src/.* differ$' "$TMP/raw.txt" | sed -E 's#^Files .* and (src/.*) differ$#\1#' | sort || true)
ONLY_SRC=$(grep -oE "^Only in src.*: .*$" "$TMP/raw.txt" | sed -E 's#^Only in (src[^:]*): (.*)$#\1/\2#' | sed 's#^\./##' | sort || true)
ONLY_UP=$(grep -oE "^Only in .*lsky-pro.*: .*$" "$TMP/raw.txt" | grep -v 'Only in src' | sed -E 's#^Only in [^:]*: (.*)$#\1#' | sort || true)

# 空字符串要变成「零行」（不能变成一行空行，否则 comm 会误判）
lines() { [ -n "${1:-}" ] && printf '%s\n' "$1" || true; }

echo
echo "=== 内容不同的文件（应恰好落在「已知偏离清单」内）==="
if [ -n "$DIFFERS" ]; then echo "$DIFFERS"; else echo "（无）"; fi

if [ -n "$ONLY_SRC" ] || [ -n "$ONLY_UP" ]; then
    echo
    echo "=== 只在一边存在的文件（信息展示，不参与报警）==="
    [ -n "$ONLY_SRC" ] && echo "$ONLY_SRC" | sed 's/^/  只在 src\/：/'
    [ -n "$ONLY_UP" ]  && echo "$ONLY_UP"  | sed 's/^/  只在上游：/'
fi

echo
echo "=== 每个文件的详细 diff ==="
for f in $DIFFERS; do
    echo "---- $f"
    diff -u "$TMP/up/${f#src/}" "$f" || true
done

echo
echo "[3/3] 已知偏离清单校验："
UNEXPECTED="$(comm -23 <(lines "$DIFFERS") <(lines "$KNOWN") || true)"
STALE="$(comm -13 <(lines "$DIFFERS") <(lines "$KNOWN") || true)"
if [ -n "$UNEXPECTED" ]; then
    echo "  ❌ 有清单之外的改动（要么是有意的、请登记进 KNOWN_DEVIATIONS 并写一句理由，要么是手滑）："
    printf '%s\n' "$UNEXPECTED" | sed 's/^/     /'
    exit 1
fi
echo "  ✅ src/ 相对上游的改动全部落在已知偏离清单内（清单 $(printf '%s\n' "$KNOWN" | wc -l | tr -d ' ') 项，实际不同 $(printf '%s\n' "$(lines "$DIFFERS")" | grep -c . || true) 项）"
if [ -n "$STALE" ]; then
    echo "  ⚠️ 清单里登记了、但实际已与上游一致（条目可清理）："
    printf '%s\n' "$STALE" | sed 's/^/     /'
fi
echo
echo "提示：把上面的 diff 存进 patches/ios-longpress.patch 即可（patch 文件只是「给上下级看」的存档，不参与构建）。"
