#!/usr/bin/env bash
# ============================================================================
# B6 真升级用例：「旧镜像 → 新镜像」在**同一个卷**上做一次真实升级，断言站点数据逐字节不变。
#
# 为什么需要它：CI 里的 A/B/C 三段是拿「手工改坏的标记 / 手工改坏的代码」在**同一次构建**的
# 镜像里模拟升级 —— 只能证明 entrypoint 的分支逻辑对，证明不了「从已发布的旧版镜像升上来
# 会怎样」。本用例先用**已发布的旧镜像**把一个卷养成真实站点（真实代码树 + 真实数据布局），
# 再换上本次构建的新镜像挂同一个卷起，是端到端的真升级。
#
# 关键设计（每条都有理由，改之前先读）：
#   1) 升级基线用**不可变 tag**（sha-<commit>），不用 :latest：
#      immutable tag 永不变动、公开可拉，是唯一可复现的「旧版本」；:latest 会随每次 promote
#      漂移（甚至可能正好是本次这次构建的同 commit 产物 —— 那就成了自己升级自己）。
#      基线 tag **不写死**：由 resolve_upgrade_base() 向 GHCR 匿名 API 现查「最新的
#      sha-<commit> tag，且 ≠ 本次构建的 commit」。写死总有一天会因那个 tag 从 GHCR
#      消失而假红（红的理由与本次改动无关，还会挡住发布）。环境变量 UPGRADE_FROM_TAG
#      仍是覆盖手段（应急钉死某个已知 tag）。
#      防漂移：脚本拿 tag 名里的 sha 去核镜像自带的 .code-revision（互相印证），
#      谁把 tag 挪到别的版本上，这里当场报错（本仓库历史上真的贴错过 tag）。
#   2) 「升级」= 删掉旧容器，再用新镜像挂**同一个卷**起 —— 与线上
#      `docker compose pull && docker compose up -d` 等价。刻意不用 --force-recreate 之类
#      的花活：要验的就是那条真实路径。
#   3) 数据哨兵覆盖真实站点的全部数据面：.env（多行 + UTF-8 + 特殊字符）/ installed.lock
#      （丢了它整站会被重定向到 /install）/ database/database.sqlite（真建表 + 真写行 + BLOB，
#      不是个空文件）/ storage/app/uploads（真 PNG "缩略图"）/ public/i（同步排除清单里的
#      部署产物）。
#      断言分三层：①逐文件 md5 不变 ②整个数据面清单（排序后的 md5 列表）diff 必须为空
#      ③用新镜像的 PHP + PDO 真的打开 SQLite 读出行指纹（文件级 + 逻辑级两重）。
#   4) 代码确实换成新的了：.code-revision 的 fork_sha = 本次 commit、public/js/app.js 与
#      app/Services/ImageService.php 的 md5 = 新镜像里那份（升级前先把它们改成垃圾/手工修补，
#      所以这条断言与「两版镜像恰好差在哪」无关，永远有效）、编译视图缓存被清。
#      再加一条端到端：Apache 实际吐给浏览器的 /js/app.js 就是新镜像那一份。
#   5) 终局日志行：新容器必须打「已同步进卷：fork_sha=<本次 commit>」（不是「跳过同步」）；
#      旧容器必须打过它那条分支的终局行（播种/同步），证明这个卷真是旧镜像养起来的。
#   6) 清理一律走 trap；失败时先把两个容器的完整日志 dump 出来再退。
#
# 与 workflow 里其它步骤错开的名字（改名前先确认没撞车）：
#   已有：容器 lsky-smoke（宿主 18089）/ lsky-mpm-a..f + 卷 lsky-mpm-vol-a..f / lsky-a|lsky-b|lsky-c + 卷 lsky-sync-test
#   本步：容器 lsky-up-old / lsky-up-new、卷 lsky-upgrade-vol、宿主端口 18090，且严格串行
#        （旧容器先 rm 掉，再起新的 —— 任何时刻最多一个容器在跑 entrypoint）。
#
# 本地复跑（不需要 docker build，公开镜像直接 docker pull）：
#   IMAGE_REF=ghcr.io/mole404/lsky-pro-docker:sha-<本次 commit> \
#   GITHUB_SHA=$(git -C <repo> rev-parse HEAD) bash tools/upgrade-test.sh
#   # 基线默认自动解析；要钉死某一版再跑：加 UPGRADE_FROM_TAG=sha-<commit>
# 注意：NEW_REF 必须先存在于本地（脚本只 inspect、不 pull 新镜像；CI 里前一步已 pull）。
# ============================================================================
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/mole404/lsky-pro-docker}"
IMAGE_REF="${IMAGE_REF:-}"
# 升级基线（不可变 tag）默认**动态解析**（见下方 resolve_upgrade_base）；环境变量是覆盖手段，
# 只有「GHCR 匿名 API 挂了又要立刻出包」时才手工钉一个已知的 sha-<commit>。
UPGRADE_FROM_TAG_OVERRIDE="${UPGRADE_FROM_TAG:-}"
EXPECT_SHA="${GITHUB_SHA:-}"     # CI 里必有；本地跑可省（省了就只断言「新旧确实不同」）
EXP_CTX="${EXP_CTX:-}"           # 补丁版 context-js.js 的 md5；空则从 Dockerfile 解析

if [ -z "$IMAGE_REF" ]; then
    echo "用法：IMAGE_REF=<本次构建的镜像引用，如 ${IMAGE}:sha-<commit>> [UPGRADE_FROM_TAG=sha-<commit>] $0" >&2
    echo "      不传 UPGRADE_FROM_TAG 时会向 GHCR 匿名解析「最新的 sha-<commit> tag（≠ 本次构建）」当基线。" >&2
    exit 2
fi
NEW_REF="$IMAGE_REF"
UPGRADE_FROM_TAG=""   # 下面「解析 / 覆盖」后再赋值
OLD_REF=""            # ditto

# ---------------------------------------------------------------- 升级基线解析
# 为什么不再写死 tag：写死的 sha-cd14a3b… 总有一天会从 GHCR 消失（或被删），那一步就红 ——
# 而它红的理由与「本次改动」毫无关系（纯假红，还挡住发布）。改成向 GHCR 的**匿名** API 现查。
#
# 为什么不用 tags/list 的返回顺序当「最新」：registry 规范不保证 tags 顺序（实测 GHCR 返回的
# 顺序也确实不是时间序）—— 把它当时间序是隐式假设，换个 registry/实现就静默选错。所以逐个
# 候选 tag 读**镜像配置里的 created（构建时间）**，取最大者：有据可依、可复现、且确定性。
# 代价：每个候选 3 次匿名请求（index → amd64 manifest → config blob），8 路并发，
# ~50 个候选约 10 秒；公开包全程匿名，不需要任何凭据。
#
# 参数 = 要排除的 commit（本次构建的 commit / 新镜像自带的 fork_sha）——「旧版本」不能是
#        本次构建自己，否则用例会退化成「自己升级自己」。
# 成功打印选中的 tag；失败返回非 0（由调用方决定怎么办，见下面调用处）。
resolve_upgrade_base() {
    local host path tok tmp cands tag
    host="${IMAGE%%/*}"          # ghcr.io
    path="${IMAGE#*/}"           # mole404/lsky-pro-docker
    tmp=$(mktemp "${TMPDIR:-/tmp}/upgrade-bases.XXXXXX") || return 1
    cands="$tmp.cands"
    rm -f "$tmp" "$cands"

    # ① 匿名 token（公开包，pull scope 足够）
    tok=$(curl -fsS "https://${host}/token?scope=repository:${path}:pull" \
          | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null) \
        || { rm -f "$cands"; return 1; }
    [ -n "$tok" ] || { rm -f "$cands"; return 1; }

    # ② 候选 = 不可变 tag（sha-<40hex>），排除掉「本次构建」那一版
    curl -fsS -H "Authorization: Bearer $tok" "https://${host}/v2/${path}/tags/list" \
      | python3 -c '
import sys, json, re
tags = json.load(sys.stdin).get("tags") or []
exclude = set(a for a in sys.argv[1:] if a)
pat = re.compile(r"^sha-[0-9a-f]{40}$")
print("\n".join(t for t in tags if pat.match(t) and t[4:] not in exclude))
' "$@" 2>/dev/null > "$cands" || { rm -f "$cands"; return 1; }
    [ -s "$cands" ] || { rm -f "$cands"; return 1; }
    echo "（解析升级基线：$(wc -l < "$cands" | tr -d ' ') 个候选 tag，逐个读镜像构建时间…）" >&2

    # ③ 并发读每个候选的 created；取最大者（同秒按 tag 名兜底 → 确定性）
    #    注意：本函数体经 export -f 在**新 bash**（无 set -e）里跑，所以单个候选失败只是
    #    少一个候选（return 0），不会把整步搞红；最终一个都没解析到才由调用方报错。
    export _UB_HOST="$host" _UB_PATH="$path" _UB_TOK="$tok"
    _ub_created_of() { # $1=tag → 打印 "<created> <tag>"；取不到就什么都不打
        local idx cfg created
        idx=$(curl -fsSL -H "Authorization: Bearer $_UB_TOK" \
                -H 'Accept: application/vnd.oci.image.index.v1+json' \
                "https://${_UB_HOST}/v2/${_UB_PATH}/manifests/$1" 2>/dev/null \
              | python3 -c 'import sys,json;m=json.load(sys.stdin).get("manifests") or [];print(next((x["digest"] for x in m if (x.get("platform") or {}).get("architecture")=="amd64"),""))' 2>/dev/null)
        [ -n "$idx" ] || return 0
        cfg=$(curl -fsSL -H "Authorization: Bearer $_UB_TOK" \
                -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
                "https://${_UB_HOST}/v2/${_UB_PATH}/manifests/${idx}" 2>/dev/null \
              | python3 -c 'import sys,json;print((json.load(sys.stdin).get("config") or {}).get("digest") or "")' 2>/dev/null)
        [ -n "$cfg" ] || return 0
        created=$(curl -fsSL -H "Authorization: Bearer $_UB_TOK" \
                    "https://${_UB_HOST}/v2/${_UB_PATH}/blobs/${cfg}" 2>/dev/null \
                  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("created") or "")' 2>/dev/null)
        [ -n "$created" ] && printf '%s %s\n' "$created" "$1"
        return 0
    }
    export -f _ub_created_of
    # 不用 xargs -r（GNU 专有）：上面已用 `[ -s "$cands" ]` 保证输入非空。
    xargs -P8 -I{} bash -c '_ub_created_of "$@"' _ {} < "$cands" > "$tmp" 2>/dev/null || true
    unset _UB_HOST _UB_PATH _UB_TOK

    [ -s "$tmp" ] || { rm -f "$tmp" "$cands"; return 1; }
    # created 是 ISO-8601（UTC，"Z"）→ 字典序即时间序，sort -r 取最大
    tag=$(sort -r "$tmp" | head -1 | awk '{print $2}')
    rm -f "$tmp" "$cands"

    [ -n "$tag" ] || return 1
    printf '%s\n' "$tag"
}

# 没有从 GITHUB_ENV 传进来就从 Dockerfile 解析（单一事实来源，别在这里抄常量）
if [ -z "$EXP_CTX" ] && [ -f Dockerfile ]; then
    EXP_CTX=$(grep -oE 'context_js_md5=[0-9a-f]{32}' Dockerfile | head -1 | cut -d= -f2 || true)
fi

# ---------------------------------------------------------------- 名字（与其它步骤错开）
VOL=lsky-upgrade-vol
OLD_C=lsky-up-old
NEW_C=lsky-up-new
HOST_PORT=18090     # 宿主端口：smoke 用 18089，这里错开，且本步独占

LOGDIR=$(mktemp -d)
OLD_LOG=$LOGDIR/old.log
NEW_LOG=$LOGDIR/new.log
SEED_OUT=$LOGDIR/seed.out
AFTER_OUT=$LOGDIR/after.out
SNAP_BEFORE=$LOGDIR/snapshot-before.txt
SNAP_AFTER=$LOGDIR/snapshot-after.txt

cleanup() {
    docker rm -f "$OLD_C" "$NEW_C" >/dev/null 2>&1 || true
    docker volume rm -f "$VOL" >/dev/null 2>&1 || true
}
on_err() {
    local rc=$?
    echo "::group::诊断：真升级用例（$OLD_C / $NEW_C 容器日志）"
    for c in "$OLD_C" "$NEW_C"; do
        echo "--- $c"
        docker logs "$c" 2>&1 | tail -60 || true
    done
    echo "::endgroup::"
    cleanup
    exit $rc
}
trap on_err ERR

cleanup   # 上一次跑残留的先清掉（幂等）

echo "== 0) 解析升级基线 + 自洽校验：tag 名里的 sha 必须等于旧镜像自带的 fork_sha =="

# 镜像内文件的 md5（新镜像那份就是「同步之后卷里应该长成的样子」）
img_md5() { docker run --rm --entrypoint md5sum "$1" "$2" | awk '{print $1}'; }
# 镜像自带 .code-revision 里的 fork_sha
img_fork_sha() {
    docker run --rm --entrypoint cat "$1" /var/www/lsky/.code-revision \
        | sed -n 's/^fork_sha=//p' | head -1
}

# 先确认「本次构建的镜像」在本地（前一步 pull 过），并读出它自带的 fork_sha ——
# 它同时是解析基线时的排除项（「旧版本」绝不能是本次构建自己）。
docker image inspect "$NEW_REF" >/dev/null 2>&1 \
    || { echo "::error::本地没有本次构建的镜像 $NEW_REF（前一步应当已经 pull 过）"; exit 1; }
NEW_SHA=$(img_fork_sha "$NEW_REF")
[ -n "$NEW_SHA" ] || { echo "::error::新镜像 $NEW_REF 里没有 .code-revision"; exit 1; }

if [ -n "$UPGRADE_FROM_TAG_OVERRIDE" ]; then
    UPGRADE_FROM_TAG="$UPGRADE_FROM_TAG_OVERRIDE"
    echo "升级基线：环境变量覆盖 → $UPGRADE_FROM_TAG"
else
    # 解析失败就**明确失败**（见下），理由：
    #   · 静默通过 = 这次真升级根本没验，却让流水线变绿（最坏的一种「假绿」）；
    #   · 回退到写死值也不行 —— 那正是本次要消掉的假红来源（那个 tag 迟早会没）。
    # 应急通道留给了环境变量：设 UPGRADE_FROM_TAG=sha-<commit> 后重跑即可（覆盖优先）。
    if ! UPGRADE_FROM_TAG=$(resolve_upgrade_base "$EXPECT_SHA" "$NEW_SHA"); then
        echo "::error::无法从 GHCR 匿名 API 解析升级基线（token / tags/list / 镜像 created 时间都取不到）"
        echo "::error::真升级用例没有基线时**不许静默通过**。应急：把 UPGRADE_FROM_TAG 设成一个已知的不可变 tag（sha-<commit>）后重跑。"
        exit 1
    fi
    echo "升级基线（动态解析）→ $UPGRADE_FROM_TAG"
fi
if [[ ! "$UPGRADE_FROM_TAG" =~ ^sha-[0-9a-f]{40}$ ]]; then
    echo "::error::基线 '$UPGRADE_FROM_TAG' 不是 sha-<40hex> 形式（动态解析或环境变量给了非法值）"
    exit 1
fi
OLD_REF="${IMAGE}:${UPGRADE_FROM_TAG}"

for i in 1 2 3; do
    if docker pull "$OLD_REF" >/dev/null 2>&1; then break; fi
    echo "拉 $OLD_REF 失败，5 秒后重试（$i/3）"
    sleep 5
done
docker image inspect "$OLD_REF" >/dev/null 2>&1 \
    || { echo "::error::拉不到升级基线镜像 $OLD_REF（公开包，应能匿名拉取）"; exit 1; }

OLD_SHA=$(img_fork_sha "$OLD_REF")
TAG_SHA="${UPGRADE_FROM_TAG#sha-}"
NEW_APP_JS=$(img_md5 "$NEW_REF" /var/www/lsky/public/js/app.js)
OLD_APP_JS=$(img_md5 "$OLD_REF" /var/www/lsky/public/js/app.js)
NEW_IMGSVC=$(img_md5 "$NEW_REF" /var/www/lsky/app/Services/ImageService.php)

[ -n "$OLD_SHA" ] || { echo "::error::旧镜像 $OLD_REF 里没有 .code-revision（太老的镜像不能当基线）"; exit 1; }
if [ "$OLD_SHA" != "$TAG_SHA" ]; then
    echo "::error::基线 tag $UPGRADE_FROM_TAG 指向的镜像里 fork_sha=$OLD_SHA —— tag 被挪到别的版本上了（不可变 tag 必须指向它自己那一版）"
    exit 1
fi
if [ -n "$EXPECT_SHA" ] && [ "$NEW_SHA" != "$EXPECT_SHA" ]; then
    echo "::error::新镜像里的 fork_sha=$NEW_SHA ≠ 本次 commit $EXPECT_SHA（build-arg FORK_SHA 没生效？）"
    exit 1
fi
if [ "$OLD_SHA" = "$NEW_SHA" ]; then
    echo "::warning::基线 $UPGRADE_FROM_TAG 与本次构建是同一个 commit（$NEW_SHA）—— 没有『旧版本』可升，本用例跳过（不阻断发布）"
    cleanup
    exit 0
fi
echo "升级基线 $OLD_REF（fork_sha=$OLD_SHA） →  新镜像 $NEW_REF（fork_sha=$NEW_SHA）"
if [ "$OLD_APP_JS" = "$NEW_APP_JS" ]; then
    echo "::notice::这一对镜像的 public/js/app.js 恰好相同（本次改动没碰前端产物）——『代码换新』改由 .code-revision 的 fork_sha / ImageService.php 承担"
else
    echo "两版的前端产物确实不同：app.js $OLD_APP_JS → $NEW_APP_JS"
fi

# ---------------------------------------------------------------------------
echo "== 1) 用旧镜像 + 独立卷起一个真实部署（这个卷随后要被升级）=="
docker run -d --name "$OLD_C" -v "$VOL":/var/www/html \
    -p "127.0.0.1:${HOST_PORT}:8089" -e WEB_PORT=8089 "$OLD_REF" >/dev/null

# 等该分支**终局**日志行（播种分支最后打的就是这行；别等「第一条 [lsky]」——
# 自签证书 / MPM 那些行排在它前面，等早了会读到中间状态）。最多 120 秒。
old_ready=0
for i in $(seq 1 60); do
    docker logs "$OLD_C" > "$OLD_LOG" 2>&1 || true
    if grep -q '已把镜像应用播种到' "$OLD_LOG"; then old_ready=1; break; fi
    st=$(docker inspect -f '{{.State.Status}}' "$OLD_C" 2>/dev/null || echo unknown)
    if [ "$st" != running ]; then
        echo "::error::旧镜像容器在播种完成前就退出了（status=$st）"
        tail -40 "$OLD_LOG" || true
        exit 1
    fi
    sleep 2
done
if [ "$old_ready" != 1 ]; then
    echo "::error::旧镜像 120 秒内没打完播种的终局日志行（基线必须支持标记式播种）"
    tail -40 "$OLD_LOG" || true
    exit 1
fi
grep '\[lsky\]' "$OLD_LOG" || true

# 基线得是个真能跑的部署（不只是「文件拷完了」）：安装向导 200 说明 Apache 也起来了。
old_code=000
for i in $(seq 1 60); do
    old_code=$(curl -s -o /dev/null -w '%{http_code}' -L "http://127.0.0.1:${HOST_PORT}/install" || true)
    if [ "$old_code" = 200 ]; then break; fi
    sleep 2
done
if [ "$old_code" != 200 ]; then
    echo "::error::旧镜像的部署没起来（GET /install → ${old_code:-空}）"
    tail -40 "$OLD_LOG" || true
    exit 1
fi
echo "旧镜像部署就绪：播种终局行 + GET /install = 200"

# 关掉旧容器再动卷：免得和 entrypoint 末尾的 chown -R / chmod -R 抢同一批文件
docker rm -f "$OLD_C" >/dev/null

# ---------------------------------------------------------------------------
echo "== 2) 播种哨兵数据（用旧镜像挂同一卷写；模拟真实站点的数据面）=="
# 用 with-stdin 的方式喂整段脚本：外层 heredoc 带引号 → 里面的 $ 和引号都原样交给容器的 sh，
# 不必跟 docker run --entrypoint sh '...' 的单引号套娃较劲。
docker run --rm -i -v "$VOL":/var/www/html --entrypoint sh "$OLD_REF" > "$SEED_OUT" 2>&1 <<'EOSH'
set -eu
cd /var/www/html

# ① 站点配置：多行 + 注释 + 引号 + UTF-8（升级绝不能碰它，覆盖 = 丢 APP_KEY / 存储密钥）
cat > .env <<'ENVEOF'
APP_NAME="Lsky Pro 图床"
APP_ENV=production
APP_KEY=base64:U0VOVElORUxfS0VZX0RPX05PVF9UT1VDSF9fQE1ZTE9OR0JBU0U2NA==
APP_DEBUG=false
APP_URL=http://127.0.0.1:18090
LOG_CHANNEL=stack
DB_CONNECTION=sqlite
DB_DATABASE=/var/www/html/database/database.sqlite
# 升级哨兵行：必须逐字节活下来（含中文与引号 " ' 反斜杠 \
UPGRADE_SENTINEL=KEEP_ME_byte-for-byte
ENVEOF

# ② SQLite 数据库：真建表 + 真写行 + 真 BLOB（不是个空文件）
rm -f database/database.sqlite
php -r '
$db = new PDO("sqlite:/var/www/html/database/database.sqlite");
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec("PRAGMA journal_mode=DELETE");
$db->exec("CREATE TABLE images (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, bytes INTEGER NOT NULL, payload BLOB, created_at TEXT)");
$st = $db->prepare("INSERT INTO images (path, bytes, payload, created_at) VALUES (?,?,?,?)");
for ($i = 1; $i <= 20; $i++) {
    $st->execute(["uploads/2026/09/sentinel-$i.png", 1024 * $i, random_bytes(64), "2026-09-30 12:00:00"]);
}
$st->execute(["中文路径/升级哨兵.png", 4096, random_bytes(128), "2026-09-30 12:00:09"]);
$db->exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT)");
$us = $db->prepare("INSERT INTO users (name, email) VALUES (?, ?)");
$us->execute(["徐老师", "keep-me@example.com"]);
'

# ③ 图片数据（真 PNG，2x2）+ 缩略图目录
mkdir -p storage/app/uploads/thumbnails
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP4z8DAAMIM////ZwAAHu8E/HMcU8wAAAAASUVORK5CYII=' \
    | base64 -d > storage/app/uploads/thumbnails/sentinel.png

# ④ public/i：本地存储策略的部署产物，在 entrypoint 的同步排除清单里（绝不能被镜像代码覆盖）
mkdir -p public/i/deploy
echo "DEPLOY_ARTIFACT：public/i 属于部署产物，换镜像不许动它" > public/i/deploy/keep.txt

# ⑤ 站点自己的配置缓存 + 已安装锁（installed.lock 丢了 → 整站被重定向到 /install）
mkdir -p bootstrap/cache
printf '%s\n' '<?php return ["app" => ["name" => "SENTINEL_CONFIG_CACHE"]];' > bootstrap/cache/config.php
: > installed.lock

# ⑥ 纯缓存（按设计会被作废）：编译后的视图 —— 用它反证「同步分支真跑过」
mkdir -p storage/framework/views
echo '<?php // STALE_COMPILED_VIEW' > storage/framework/views/deadbeef.php

# ⑦ 代码侧哨兵：升级必须被新镜像那一版覆盖（证明代码确实换源了，而不是「恰好没变」）
echo '<?php // HANDBOOK_EDIT_MUST_BE_REPLACED' > app/Services/ImageService.php
echo '// STALE_APP_JS_MUST_BE_REPLACED' > public/js/app.js

# ⑧ 两个探针写在 ./database 下（同步排除清单里的数据目录 → 升级后还在）：
#    于是一个阶段跑的是**同一份**快照/探针定义，不存在「测试代码抄两份会漂移」的问题。
cat > database/.upgrade-probe.php <<'PHPEOF'
<?php
// 逻辑级探针：用当前镜像的 PHP + PDO 真的打开卷里的 SQLite，读出行指纹。
$p = '/var/www/html/database/database.sqlite';
$db = new PDO('sqlite:' . $p);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$rows = 0;
$h = hash_init('sha256');
foreach ($db->query('SELECT id, path, bytes, length(payload) AS plen FROM images ORDER BY id') as $r) {
    $rows++;
    hash_update($h, $r['id'] . '|' . $r['path'] . '|' . $r['bytes'] . '|' . $r['plen'] . "\n");
}
echo 'DB_ROWS=' . $rows . PHP_EOL;
echo 'DB_FINGERPRINT=' . hash_final($h) . PHP_EOL;
$u = $db->query('SELECT name, email FROM users ORDER BY id')->fetch(PDO::FETCH_NUM);
echo 'DB_FIRST_USER=' . $u[0] . '|' . $u[1] . PHP_EOL;
PHPEOF

cat > database/.upgrade-snapshot.sh <<'SNAPEOF'
#!/bin/sh
# 数据面快照 —— 升级前后各跑一次，两份输出必须逐字节相同（CI 直接 diff）。
set -eu
cd /var/www/html
md5of() { md5sum "$1" | awk '{print $1}'; }

echo "逻辑级（用本镜像的 PHP+PDO 真读 SQLite）:"
php database/.upgrade-probe.php

echo "数据文件:"
echo "ENV_MD5=$(md5of .env)"
echo "ENV_LINES=$(wc -l < .env | tr -d ' ')"
echo "ENV_BYTES=$(wc -c < .env | tr -d ' ')"
echo "ENV_SENTINEL_HITS=$(grep -c '^UPGRADE_SENTINEL=KEEP_ME_byte-for-byte$' .env || true)"
echo "ENV_UTF8_HITS=$(grep -c 'Lsky Pro 图床' .env || true)"
echo "INSTALLED_LOCK_MD5=$(md5of installed.lock)"
echo "DB_FILE_MD5=$(md5of database/database.sqlite)"
echo "DB_FILE_BYTES=$(wc -c < database/database.sqlite | tr -d ' ')"
echo "PNG_MD5=$(md5of storage/app/uploads/thumbnails/sentinel.png)"
echo "PNG_MAGIC=$(od -An -tx1 -N8 storage/app/uploads/thumbnails/sentinel.png | tr -d ' \n')"
echo "CONFIG_CACHE_MD5=$(md5of bootstrap/cache/config.php)"
echo "DEPLOY_ARTIFACT_MD5=$(md5of public/i/deploy/keep.txt)"

echo "数据面整份清单（排序后的 md5 列表，逐字节比对）:"
echo "-- INVENTORY_BEGIN --"
{
    md5sum .env installed.lock bootstrap/cache/config.php
    find database storage/app public/i -type f -print0 | sort -z | xargs -0 -r md5sum
} 
echo "-- INVENTORY_END --"
echo "INVENTORY_LINES=$({ md5sum .env installed.lock bootstrap/cache/config.php; find database storage/app public/i -type f; } | wc -l | tr -d ' ')"
SNAPEOF

echo "== 播种后的数据面快照（升级前）=="
echo "-- DATA_SNAPSHOT_BEGIN --"
sh database/.upgrade-snapshot.sh
echo "-- DATA_SNAPSHOT_END --"
EOSH
sed -n '/-- DATA_SNAPSHOT_BEGIN --/,/-- DATA_SNAPSHOT_END --/p' "$SEED_OUT" | sed '1d;$d' > "$SNAP_BEFORE"
grep -vE '^(-- DATA_SNAPSHOT_|-- INVENTORY_)' "$SNAP_BEFORE" | sed 's/^/    /'
[ -s "$SNAP_BEFORE" ] || { echo "::error::升级前的数据面快照是空的（播种阶段没跑成）"; cat "$SEED_OUT"; exit 1; }

# ---------------------------------------------------------------------------
echo "== 3) 换新镜像、挂同一个卷起（= 升级；旧容器此刻已经 rm 掉了）=="
docker run -d --name "$NEW_C" -v "$VOL":/var/www/html \
    -p "127.0.0.1:${HOST_PORT}:8089" -e WEB_PORT=8089 "$NEW_REF" >/dev/null

# 等**同步分支**的终局行（tar 写完之后才 echo 这行）；「先落文件再 grep」避开 pipefail+SIGPIPE 假红。
new_ready=0
for i in $(seq 1 60); do
    docker logs "$NEW_C" > "$NEW_LOG" 2>&1 || true
    if grep -q '已同步进卷' "$NEW_LOG"; then new_ready=1; break; fi
    st=$(docker inspect -f '{{.State.Status}}' "$NEW_C" 2>/dev/null || echo unknown)
    if [ "$st" != running ]; then
        echo "::error::新镜像容器在同步完成前就退出了（status=$st）"
        tail -40 "$NEW_LOG" || true
        exit 1
    fi
    sleep 2
done
if [ "$new_ready" != 1 ]; then
    echo "::error::新镜像 120 秒内没有走同步分支（应当打『检测到镜像代码版本变化，已同步进卷』）"
    tail -40 "$NEW_LOG" || true
    exit 1
fi
grep '\[lsky\]' "$NEW_LOG" || true
grep -q "已同步进卷：fork_sha=$NEW_SHA" "$NEW_LOG" \
    || { echo "::error::同步的终局行里没有点名本次 commit（期望 fork_sha=$NEW_SHA）"; exit 1; }
if grep -q '跳过同步' "$NEW_LOG"; then
    echo "::error::新镜像走了『跳过同步』分支（标记不一致时不该跳过）"
    exit 1
fi
echo "新镜像走了同步分支，终局行：$(grep -o '已同步进卷：.*' "$NEW_LOG" | head -1)"

# 端到端：Apache 实际吐出的 /js/app.js 必须就是新镜像里那一份（不是磁盘上「看着对」）
if [ -z "$EXP_CTX" ]; then
    echo "::warning::没有 EXP_CTX（补丁 JS 的期望 md5），跳过对外服务校验"
fi
served_ok=0
for i in $(seq 1 60); do
    served=$( { curl -s "http://127.0.0.1:${HOST_PORT}/js/app.js" || true; } | md5sum | awk '{print $1}')
    if [ "$served" = "$NEW_APP_JS" ]; then served_ok=1; break; fi
    sleep 2
done
if [ "$served_ok" != 1 ]; then
    echo "::error::Apache 吐出的 /js/app.js（$served）不是新镜像里那份（$NEW_APP_JS）"
    tail -40 "$NEW_LOG" || true
    exit 1
fi
echo "端到端：GET /js/app.js = 新镜像里的 app.js（$NEW_APP_JS）"
if [ -n "$EXP_CTX" ]; then
    served_ctx=$( { curl -s "http://127.0.0.1:${HOST_PORT}/js/context-js/context-js.js" || true; } | md5sum | awk '{print $1}')
    if [ "$served_ctx" != "$EXP_CTX" ]; then
        echo "::error::Apache 吐出的补丁 JS（$served_ctx）不是补丁版（$EXP_CTX）"
        exit 1
    fi
    echo "端到端：GET /js/context-js/context-js.js = 补丁版（$EXP_CTX）"
fi

# ---------------------------------------------------------------------------
echo "== 4) 升级后：代码状态 + 数据面快照 =="
docker run --rm -i -v "$VOL":/var/www/html --entrypoint sh "$NEW_REF" > "$AFTER_OUT" 2>&1 <<'EOSH'
set -eu
cd /var/www/html

echo "代码状态:"
echo "MARKER_FORK_SHA=$(sed -n 's/^fork_sha=//p' .code-revision | head -1)"
echo "MARKER_LINES=$(wc -l < .code-revision | tr -d ' ')"
echo "APP_JS_MD5=$(md5sum public/js/app.js | awk '{print $1}')"
echo "IMAGESERVICE_MD5=$(md5sum app/Services/ImageService.php | awk '{print $1}')"
echo "HANDBOOK_LEFT=$(grep -c HANDBOOK_EDIT_MUST_BE_REPLACED app/Services/ImageService.php || true)"
echo "STALE_APP_JS_LEFT=$(grep -c STALE_APP_JS_MUST_BE_REPLACED public/js/app.js || true)"
echo "COMPILED_VIEWS=$(ls storage/framework/views/*.php 2>/dev/null | wc -l | tr -d ' ')"
echo "ENV_EXAMPLE-present=$([ -f .env.example ] && echo yes || echo no)"

echo "-- DATA_SNAPSHOT_BEGIN --"
sh database/.upgrade-snapshot.sh
echo "-- DATA_SNAPSHOT_END --"
EOSH
sed -n '/-- DATA_SNAPSHOT_BEGIN --/,/-- DATA_SNAPSHOT_END --/p' "$AFTER_OUT" | sed '1d;$d' > "$SNAP_AFTER"
sed -n '1,/-- DATA_SNAPSHOT_BEGIN --/p' "$AFTER_OUT" | sed '$d' | grep -v '^$' | sed 's/^/    /'
[ -s "$SNAP_AFTER" ] || { echo "::error::升级后的数据面快照是空的"; cat "$AFTER_OUT"; exit 1; }

# --- 断言① 代码确实换成了新镜像那一版 -------------------------------------
key() { sed -n "s/^$2=//p" "$1" | head -1; }
assert_eq() { # $1=文件 $2=key $3=期望 $4=说明
    local actual
    actual=$(key "$1" "$2")
    if [ "$actual" != "$3" ]; then
        echo "::error::$4（$2：实测 '$actual'，期望 '$3'）"
        cat "$1"
        exit 1
    fi
    echo "  ✓ $4（$2=$actual）"
}
assert_eq "$AFTER_OUT" MARKER_FORK_SHA   "$NEW_SHA"    "卷里的 .code-revision 已更新成本次 commit 的 fork_sha"
assert_eq "$AFTER_OUT" APP_JS_MD5        "$NEW_APP_JS" "卷里的 public/js/app.js 已是新镜像那一份"
assert_eq "$AFTER_OUT" IMAGESERVICE_MD5  "$NEW_IMGSVC" "卷里的 app/Services/ImageService.php 已被新镜像覆盖（升级前是手工修补版）"
assert_eq "$AFTER_OUT" HANDBOOK_LEFT     "0"           "旧的手工修补没有残留"
assert_eq "$AFTER_OUT" STALE_APP_JS_LEFT "0"           "旧的脏 app.js 没有残留"
assert_eq "$AFTER_OUT" COMPILED_VIEWS    "0"           "编译视图缓存已作废（blade 改动才会生效）"

# --- 断言② 数据面逐文件 md5 不变 ------------------------------------------
echo "数据面逐项比对（升级前 → 升级后）："
DATA_KEYS="DB_ROWS DB_FINGERPRINT DB_FIRST_USER DB_FILE_MD5 DB_FILE_BYTES \
           ENV_MD5 ENV_LINES ENV_BYTES ENV_SENTINEL_HITS ENV_UTF8_HITS \
           INSTALLED_LOCK_MD5 PNG_MD5 PNG_MAGIC CONFIG_CACHE_MD5 DEPLOY_ARTIFACT_MD5 \
           INVENTORY_LINES"
for k in $DATA_KEYS; do
    before=$(key "$SNAP_BEFORE" "$k")
    after=$(key "$SNAP_AFTER" "$k")
    if [ -z "$before" ] || [ -z "$after" ]; then
        echo "::error::快照里缺少 $k（before='$before' after='$after'）—— 快照脚本被改坏？"
        exit 1
    fi
    if [ "$before" != "$after" ]; then
        echo "::error::升级改了数据面：$k $before → $after"
        exit 1
    fi
    printf '  ✓ %-20s %s\n' "$k" "$before"
done
# 几个关键值顺手做一个「真值」检查，避免快照脚本写错却两边一致（假绿的经典形态）
[ "$(key "$SNAP_AFTER" DB_ROWS)" = "21" ] || { echo "::error::SQLite 里的行数不是 21（播种没写进去？）"; exit 1; }
[ "$(key "$SNAP_AFTER" ENV_UTF8_HITS)" = "1" ] || { echo "::error::.env 里的 UTF-8 行不见了"; exit 1; }
[ "$(key "$SNAP_AFTER" PNG_MAGIC)" = "89504e470d0a1a0a" ] || { echo "::error::缩略图不再是 PNG"; exit 1; }

# --- 断言③ 整个数据面清单 diff 必须为空 ------------------------------------
if ! diff -u "$SNAP_BEFORE" "$SNAP_AFTER" > "$LOGDIR/snapshot.diff" 2>&1; then
    echo "::error::升级前后数据面快照不一致（含整份 md5 清单）"
    cat "$LOGDIR/snapshot.diff"
    exit 1
fi
echo "  ✓ 数据面快照（含整份 md5 清单）逐字节相同"

echo "== 5) 清理 =="
cleanup

echo "真升级用例通过：$OLD_REF → $NEW_REF；数据面逐字节不变，代码已换成新镜像那一版"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
        echo "## 真升级用例（旧镜像 → 新镜像，数据逐字节不变）"
        echo ""
        echo '```'
        echo "升级基线  $OLD_REF（fork_sha=$OLD_SHA）"
        echo "新镜像    $NEW_REF（fork_sha=$NEW_SHA）"
        echo ""
        echo "== 升级后的代码状态 =="
        sed -n '1,/-- DATA_SNAPSHOT_BEGIN --/p' "$AFTER_OUT" | sed '$d' | grep -v '^$'
        echo ""
        echo "== 数据面快照（升级前后 diff 为空）=="
        grep -vE '^(-- DATA_SNAPSHOT_|-- INVENTORY_)' "$SNAP_AFTER"
        echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
fi
