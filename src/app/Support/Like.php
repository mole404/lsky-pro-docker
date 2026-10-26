<?php

namespace App\Support;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Eloquent\Builder;

/**
 * 后台搜索里的「包含」匹配（LIKE）用的元字符转义工具。
 *
 * 为什么要转义：搜索词是用户自己填的，`%` / `_` 在 LIKE 里是通配符 —— 搜 `a_b` 会连
 * `axb`、`a1b` 一起命中，搜 `100%` 更是把整表都捞出来，用户看到的「匹配」全是假的。
 * 所以进 LIKE 之前一律把元字符转义成字面量。
 *
 * 为什么要显式写 ESCAPE：SQLite 的 LIKE **没有默认转义符**（转义符为 NULL ⇒ `\%` 就是
 * 反斜杠加通配符），MySQL 的默认转义符是反斜杠。只靠默认值 ⇒ 同一段代码在两种库上
 * 语义不同；显式 `escape '…'` 之后两边一致。
 *
 * 那个「单个反斜杠」的字面量两边写法不同，不能共用一份文本：
 *   · MySQL 的字符串里反斜杠本身是转义符 ⇒ 要写成 `'\\'` 才等于一个字符（写 `'\'` 会把
 *     后面的引号吃掉，整条 SQL 语法错）；
 *   · SQLite（以及 standard_conforming_strings 打开的 PostgreSQL）里反斜杠不是转义符
 *     ⇒ 必须写成 `'\'`（写 `'\\'` 是两个字符，而 escape 子句只接受单字符，SQLite 当场报错）。
 * 所以按连接驱动取字面量，见 escapeClause()。
 *
 * 不要用 where('col', 'like', ?) —— Laravel 那个写法拼不出 ESCAPE 子句，转义就白做了。
 */
final class Like
{
    /**
     * 转义值里的 LIKE 元字符（escape 字符本身是反斜杠，值里出现的它也要转义，
     * 否则能被用户用来「关掉」转义）：\ % _ 。
     *
     * 顺序要紧：反斜杠必须第一个换，否则后面换出来的 `\%` 会被再翻一倍（变成匹配两个字符）。
     */
    public static function escape(string $value): string
    {
        return str_replace(
            ['\\', '%', '_'],
            ['\\\\', '\\%', '\\_'],
            $value
        );
    }

    /** 「包含」用的模式串：%转义后的值% */
    public static function pattern(string $value): string
    {
        return '%'.self::escape($value).'%';
    }

    /** `col like ? escape '…'` 这一段的 SQL（列名按语法包好，escape 字面量按驱动取）。 */
    public static function clause(Builder $builder, string $column): string
    {
        return $builder->getQuery()->getGrammar()->wrap($column).' like ? '.self::escapeClause($builder->getConnection());
    }

    /** 单个反斜杠的 SQL 字面量，按驱动取（见类注释里的那张对照）。 */
    public static function escapeClause(ConnectionInterface $connection): string
    {
        return $connection->getDriverName() === 'mysql'
            ? "escape '\\\\'"     // MySQL：SQL 文本是 escape '\\'（一个字面反斜杠）
            : "escape '\\'";      // SQLite / PostgreSQL：SQL 文本是 escape '\'
    }

    /** `col like %value% escape '…'`，以 AND 挂到 $builder 上。 */
    public static function whereContains(Builder $builder, string $column, string $value): Builder
    {
        return $builder->whereRaw(self::clause($builder, $column), [self::pattern($value)]);
    }

    /** 同上，但以 OR 挂（用在已经包好闭包、需要「任一词命中」的组里）。 */
    public static function orWhereContains(Builder $builder, string $column, string $value): Builder
    {
        return $builder->orWhereRaw(self::clause($builder, $column), [self::pattern($value)]);
    }
}
