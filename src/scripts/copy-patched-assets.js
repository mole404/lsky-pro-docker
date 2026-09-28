/*
 * 构建收尾：把「打过补丁、且在 Dockerfile 里按 md5 + 关键标记自证」的资源按原字节拷进 public/。
 *
 * 为什么不用 webpack 的 mix.copy：
 *   laravel-mix 在 --production 下会对 copy 过去的文件做压缩改名。我们的补丁文件
 *   （resources/js/context-js.js，iOS 长按菜单）在镜像构建时按 md5 与关键标记 grep 自证，
 *   被压缩后标记消失、md5 变化 → 镜像构建直接失败。
 * 这里用字节级拷贝，保证 public/js 与 resources/js 两份永远一致。
 */
const fs = require('fs');
const path = require('path');

const pairs = [
    ['resources/js/context-js.js', 'public/js/context-js/context-js.js'],
];

pairs.forEach(function (pair) {
    const src = path.resolve(__dirname, '..', pair[0]);
    const dst = path.resolve(__dirname, '..', pair[1]);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('[copy-patched-assets] ' + pair[0] + ' -> ' + pair[1]);
});
