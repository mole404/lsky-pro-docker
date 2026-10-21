<?php

namespace App\Support;

/**
 * 用户名的规范化与「纯空白」判定。
 *
 * 注册、个人资料、后台编辑用户三处入口共用这一份定义，保证裁切字符集与判定口径一致：
 *   - 两端裁切：ASCII 空白（\s）、全角空格 U+3000、NBSP U+00A0、U+2000–U+200B 区间的
 *     定宽/窄空格与零宽字符、BOM U+FEFF。中间的空格保留不动。
 *   - 纯空白：整体只由上述字符组成（含空串）即判为无效，交给 not_regex 拒绝。
 *
 * 框架的 TrimStrings 中间件只裁 ASCII 空白，多字节空白（全角空格、NBSP）不处理，
 * 因此三个入口都在校验前先调用 normalize()，再用 BLANK_PATTERN 兜住纯空白输入。
 */
final class Username
{
    /** 两端需要裁掉的空白与零宽字符（带 /u，按字符匹配）。 */
    public const EDGE_PATTERN = '/^[\s\x{3000}\x{00A0}\x{2000}-\x{200B}\x{FEFF}]+|[\s\x{3000}\x{00A0}\x{2000}-\x{200B}\x{FEFF}]+$/u';

    /** 整个值只由空白与零宽字符组成（含空串）；作为 not_regex 的参数使用。 */
    public const BLANK_PATTERN = '/^[\s\x{3000}\x{00A0}\x{2000}-\x{200B}\x{FEFF}]*$/u';

    /**
     * 裁掉两端空白；非字符串原样返回，交由 string 规则报类型错误。
     *
     * @param  mixed  $value
     * @return mixed
     */
    public static function normalize($value)
    {
        if (! is_string($value)) {
            return $value;
        }

        return preg_replace(self::EDGE_PATTERN, '', $value);
    }
}
