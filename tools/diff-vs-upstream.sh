#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 用途：把本仓库 src/ 与上游官方快照做**全树对比**，回答两个问题：
#   1) 我们相对上游到底改了哪几个文件、改了什么（默认就打印这个）
#   2) src/ 里有没有"手滑改动" —— 除了白名单里那三个补丁文件之外还动了别处就报警
#
# 依赖：git（需要能访问 github.com；上游已停更，平时不需要跑这个脚本）
# 用法：bash tools/diff-vs-upstream.sh [commit]     # 默认用 Dockerfile 里的 LSKY_COMMIT
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

COMMIT="${1:-$(grep -oE '^ARG LSKY_COMMIT=[0-9a-f]+' Dockerfile | cut -d= -f2)}"
if [ -z "$COMMIT" ]; then
    echo "用法：bash tools/diff-vs-upstream.sh <上游 commit>" >&2
    exit 2
fi

# 白名单：这三个文件是我们有意修改的补丁产物（见 README / patches/ios-longpress.patch）
PATCHED="resources/js/context-js.js
public/js/context-js/context-js.js
resources/views/user/images.blade.php"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/3] 拉取上游快照 ${COMMIT:0:9} …"
git init -q "$TMP/up"
git -C "$TMP/up" remote add origin https://github.com/lsky-org/lsky-pro.git
git -C "$TMP/up" fetch -q --depth 1 origin "$COMMIT"
git -C "$TMP/up" checkout -q FETCH_HEAD

echo "[2/3] 全树对比（只列有差异的文件）…"
diff -rq --exclude=.git "$TMP/up" src > "$TMP/raw.txt" 2>&1 || true

# 分类：内容不同 / 只在 src（我们新增）/ 只在上游（我们删了）
DIFFERS=$(grep -oE '^Files .* and src/.* differ$' "$TMP/raw.txt" | sed -E 's#^Files .* and (src/.*) differ$#\1#' | sort || true)
ONLY_SRC=$(grep -oE "^Only in src.*: .*$" "$TMP/raw.txt" | sed -E 's#^Only in (src[^:]*): (.*)$#\1/\2#' | sed 's#^\./##' | sort || true)
ONLY_UP=$(grep -oE "^Only in .*lsky-pro.*: .*$" "$TMP/raw.txt" | grep -v 'Only in src' | sed -E 's#^Only in [^:]*: (.*)$#\1#' | sort || true)

echo
echo "=== 内容不同的文件（预期只有白名单那三项）==="
if [ -n "$DIFFERS" ]; then echo "$DIFFERS"; else echo "（无）"; fi

if [ -n "$ONLY_SRC" ] || [ -n "$ONLY_UP" ]; then
    echo
    echo "=== 只在一边存在的文件 ==="
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
echo "[3/3] 白名单校验："
UNEXPECTED="$(comm -23 <(printf '%s\n' "$DIFFERS") <(printf '%s\n' "$PATCHED" | sed 's#^#src/#' | sort) || true)"
if [ -n "$UNEXPECTED" ]; then
    echo "  ❌ 除了预期补丁，还动了别的文件（要么是有意的、请更新白名单，要么是手滑）："
    printf '%s\n' "$UNEXPECTED" | sed 's/^/     /'
    exit 1
fi
echo "  ✅ src/ 相对上游的改动 = 预期补丁三项，没有额外改动"
echo
echo "提示：把上面的 diff 存进 patches/ios-longpress.patch 即可（patch 文件只是「给人看」的存档，不参与构建）。"
