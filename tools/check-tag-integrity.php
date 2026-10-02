<?php

/**
 * fork 新增：标签数据完整性自检（只读，不改任何数据）。
 *
 * 迁移里声明「tags / image_tag 的关联行由应用代码显式删除」（本仓 SQLite 未启用
 * PRAGMA foreign_keys，级联删除不可靠）。删图片走 UserService::deleteImages()、
 * 删用户走 Admin\UserController，两处都必须照做 —— 这个脚本用来盯住这条规则。
 *
 * 用法（容器内）：php tools/check-tag-integrity.php [sqlite 路径]
 * 退出码：0 = 干净，1 = 有残留行。
 */

$path = $argv[1] ?? (getenv('DB_DATABASE') ?: __DIR__.'/../database/database.sqlite');
if (! is_file($path)) {
    fwrite(STDERR, "找不到数据库文件：{$path}\n");
    exit(2);
}

$db = new PDO('sqlite:'.$path);
$count = fn (string $sql): int => (int) $db->query($sql)->fetchColumn();

$total       = $count('select count(*) from image_tag');
$orphanImage = $count('select count(*) from image_tag it left join images i on i.id = it.image_id where i.id is null');
$orphanTag   = $count('select count(*) from image_tag it left join tags t on t.id = it.tag_id where t.id is null');
$orphanOwner = $count('select count(*) from tags t left join users u on u.id = t.user_id where u.id is null');

$line = fn (string $label, int $n): string => sprintf("%-22s %d %s\n", $label, $n, $n === 0 ? '✓' : '✗');

echo "标签数据完整性自检：{$path}\n";
echo sprintf("%-22s %d\n", 'image_tag 总行数', $total);
echo $line('指向已删图片的残留', $orphanImage);
echo $line('指向已删标签的残留', $orphanTag);
echo $line('属于已删用户的标签', $orphanOwner);

$bad = $orphanImage + $orphanTag + $orphanOwner;
echo $bad === 0 ? "结论：干净 ✓\n" : "结论：有 {$bad} 条残留，删图片/删用户的清理路径漏了 ✗\n";

exit($bad === 0 ? 0 : 1);
