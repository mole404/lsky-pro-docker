#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 用途：把本仓库 src/ 换成上游另一个 commit 的完整快照（重新 vendor）。
#
# 什么时候用：上游万一又有提交、你想跟上去的时候。
# 注意：三个补丁文件（见 PATCHED 列表）不会被覆盖 —— 脚本会把上游版本存到
#       /tmp 下并逐条打印 diff，需要你确认后把补丁重新贴到 src/ 里（或反过来弃用）。
#       跑完必须：① 更新 Dockerfile 里的 LSKY_COMMIT 与两道自证的 md5
#                 ② 重新生成 patches/ios-longpress.patch
#                 ③ 跑 test/ 的行为测试（bash test/run.sh 或 cd test && npm test）
#
# 依赖：git、md5sum（需要能访问 github.com）
# 用法：bash tools/vendor-upstream.sh <上游 commit>
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

COMMIT="${1:-}"
if [ -z "$COMMIT" ]; then
    echo "用法：bash tools/vendor-upstream.sh <上游 commit>" >&2
    exit 2
fi
case "$COMMIT" in
    *[!0-9a-f]*) echo "看起来不像 commit SHA：$COMMIT" >&2; exit 2 ;;
esac

PATCHED="resources/js/context-js.js
public/js/context-js/context-js.js
resources/views/user/images.blade.php"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/4] 拉取上游快照 ${COMMIT:0:9} …"
git init -q "$TMP/up"
git -C "$TMP/up" remote add origin https://github.com/lsky-org/lsky-pro.git
git -C "$TMP/up" fetch -q --depth 1 origin "$COMMIT"
git -C "$TMP/up" checkout -q FETCH_HEAD
REAL="$(git -C "$TMP/up" rev-parse HEAD)"
echo "      实际 commit = $REAL"
[ "$REAL" = "$COMMIT" ] || { echo "❌ 拉到的不是指定 commit，先停下" >&2; exit 1; }

echo "[2/4] 把补丁文件先留档（免得被覆盖）…"
mkdir -p "$TMP/patched"
for f in $PATCHED; do
    cp -a "src/$f" "$TMP/patched/$(echo "$f" | tr / _)"
done

echo "[3/4] 替换 src/ …"
find src -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -C "$TMP/up" --exclude=./.git -cf - . | tar -C src -xf -
for f in $PATCHED; do
    cp -a "$TMP/patched/$(echo "$f" | tr / _)" "src/$f"
done
echo "      完成，src/ 现在 = 上游 $REAL + 我们的三个补丁文件"

echo
echo "[4/4] 上游新版里这三个文件与我们的补丁版本的差异（人工看，必要时重新贴补丁）："
for f in $PATCHED; do
    echo "---- $f"
    if diff -q "$TMP/up/$f" "src/$f" >/dev/null; then
        echo "    上游与我们的一致（说明这是上游也改过的文件，补丁可能已合并/被覆盖，务必人工确认）"
    else
        diff -u "$TMP/up/$f" "src/$f" | head -80 || true
    fi
done

cat <<EOF

接下来必须做的事：
  1) 更新 Dockerfile 里的 ARG LSKY_COMMIT=$REAL
  2) 更新「自证 1」（上游纯净性）与「自证 2」（补丁产物）里的 md5 期望值：
       cd src && printf '%s\n' '...' | md5sum -c -      # 生成/校验用这条
  3) 重新生成 patches/ios-longpress.patch（bash tools/diff-vs-upstream.sh）
  4) 跑行为测试：cd test && npm ci && npm test
  5) 提交后看 CI：镜像自证 + 真容器三场景会给出最终结论
EOF
