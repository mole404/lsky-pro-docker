<?php

namespace App\Support;

use RuntimeException;

/**
 * 流式 zip 写入器：只做 STORE（不压缩），边读边写，不需要 ext-zip、不落任何临时文件。
 *
 * 为什么不用 ZipArchive：
 *   · 本镜像没有 ext-zip（`class_exists('ZipArchive') === false`，实测）；
 *   · ZipArchive::open() 只接受文件路径 ⇒ 必须先写盘，与「导出不落盘」直接冲突；
 *   · 图片本身已是压缩格式（JPEG/PNG/WebP），deflate 收益≈0，STORE 还能边读边算 CRC32
 *     （`hash_init('crc32b')`），拿掉了 deflate 缓冲与一部分 CPU/内存。
 *
 * 已知限制：
 *   · 条目大小事前未知 ⇒ 每条都带 data descriptor（flags bit3）；
 *   · 中央目录在所有条目之后一次写出 ⇒ 下载中断的包无法解压、也无法续传；
 *   · `addStream()` 一旦开始写某个条目的字节，之后该流再出错就只能中止整个响应
 *     （所以调用方必须先成功打开流，再调用这里）。
 */
class StreamedZipWriter
{
    private const SIG_LFH      = 0x04034b50;
    private const SIG_DATA     = 0x08074b50;
    private const SIG_CD       = 0x02014b50;
    private const SIG_EOCD     = 0x06054b50;
    private const SIG_Z64_EOCD = 0x06064b50;
    private const SIG_Z64_LOC  = 0x07064b50;

    /** bit3 = 大小/CRC 写在 data descriptor 里；bit11 = 文件名是 UTF-8 */
    private const FLAGS      = 0x0008 | 0x0800;
    private const METHOD     = 0; // STORE
    private const CHUNK      = 65536;
    private const U32_MAX    = 0xFFFFFFFF;
    private const U16_MAX    = 0xFFFF;
    private const MAX_EMPTY_READS = 64; // 流连续空读的容忍次数（非阻塞流保护）

    /** @var resource */
    private $out;

    private bool $zip64;

    private int $offset = 0;

    /** @var array<int, array{name:string, crc:int, size:int, offset:int, mtime:int}> */
    private array $entries = [];

    /** @var array<string, int> 已用条目名 → 出现次数（用于去重） */
    private array $names = [];

    /**
     * @param resource $out   输出流（导出时传 `fopen('php://output', 'wb')`）
     * @param bool     $zip64 是否整体使用 zip64。由调用方按「预估总字节 ≥ 4GiB 或 张数 ≥ 65535」决定；
     *                        小批量走经典 zip 的兼容性最好，只有大批量才需要 zip64。
     */
    public function __construct($out, bool $zip64 = false)
    {
        if (! is_resource($out)) {
            throw new RuntimeException('zip 输出目标不是可写流');
        }
        $this->out = $out;
        $this->zip64 = $zip64;
    }

    /** 已写入的条目数 */
    public function count(): int
    {
        return count($this->entries);
    }

    /**
     * 给条目名去重：重名时追加 `_2`、`_3`…（保留扩展名）。
     * 返回的即是最终会写进包里的名字。
     */
    public function uniqueName(string $name): string
    {
        $name = $this->normalizeName($name);
        if (! isset($this->names[$name])) {
            return $name;
        }

        $dir = '';
        $file = $name;
        $pos = strrpos($name, '/');
        if ($pos !== false) {
            $dir = substr($name, 0, $pos + 1);
            $file = substr($name, $pos + 1);
        }

        $ext = '';
        $pos = strrpos($file, '.');
        if ($pos !== false && $pos > 0) {
            $ext = substr($file, $pos);
            $file = substr($file, 0, $pos);
        }

        $i = 2;
        do {
            $candidate = $dir.$file.'_'.$i.$ext;
            $i++;
        } while (isset($this->names[$candidate]));

        return $candidate;
    }

    /**
     * 从流写入一条条目，读多少写多少（分块 64KB，不会把整份读进内存）。
     *
     * @param resource $stream 已成功打开的源流（调用方负责关闭）
     * @return int 写入的字节数
     */
    public function addStream(string $name, $stream, ?int $mtime = null): int
    {
        if (! is_resource($stream)) {
            throw new RuntimeException('zip 条目来源不是可读流：'.$name);
        }

        $name = $this->normalizeName($name);
        if ($name === '') {
            throw new RuntimeException('zip 条目名不能为空');
        }

        $entry = [
            'name'   => $name,
            'crc'    => 0,
            'size'   => 0,
            'offset' => $this->offset,
            'mtime'  => $mtime ?? time(),
        ];

        $crc = hash_init('crc32b');
        $size = 0;
        $emptyReads = 0;

        $this->write($this->localHeader($name, $entry['mtime']));

        while (! feof($stream)) {
            $chunk = fread($stream, self::CHUNK);
            if ($chunk === false) {
                throw new RuntimeException('读取源流失败：'.$name);
            }
            if ($chunk === '') {
                // 阻塞流在 EOF 前不会返回空串；非阻塞流可能，给一个容忍上限避免死循环
                if (++$emptyReads > self::MAX_EMPTY_READS) {
                    throw new RuntimeException('读取源流超时/无数据：'.$name);
                }
                continue;
            }
            $emptyReads = 0;

            hash_update($crc, $chunk);
            $this->write($chunk);
            $size += strlen($chunk);
        }

        $crcValue = (int) hexdec(hash_final($crc));

        // data descriptor：32 位（经典）或 64 位（zip64，与本地头里的 zip64 extra 对应）
        $this->write($this->zip64
            ? pack('VVPP', self::SIG_DATA, $crcValue, $size, $size)
            : pack('VVVV', self::SIG_DATA, $crcValue, $size, $size));

        $entry['crc'] = $crcValue;
        $entry['size'] = $size;
        $this->entries[] = $entry;
        $this->names[$name] = ($this->names[$name] ?? 0) + 1;

        return $size;
    }

    /** 写入一条来自内存字符串的条目（例如包内提示文件） */
    public function addString(string $name, string $contents, ?int $mtime = null): int
    {
        // php://memory：php://temp 超过 2MB 会溢写到系统临时文件（容器里是 /tmp），
        // 与「全程零落盘」的承诺不符（索引一大就会命中，且被硬杀时可能留残文件）。
        // 索引本来就整份在内存里（拼好的 CSV 字符串），换成 memory 不额外增加占用。
        $stream = fopen('php://memory', 'r+b');
        if ($stream === false) {
            throw new RuntimeException('无法创建内存流');
        }
        fwrite($stream, $contents);
        rewind($stream);

        try {
            return $this->addStream($name, $stream, $mtime);
        } finally {
            fclose($stream);
        }
    }

    /** 写出中央目录与 EOCD。必须在所有条目之后调用一次。 */
    public function finish(): void
    {
        $cdOffset = $this->offset;
        $count = count($this->entries);

        foreach ($this->entries as $entry) {
            $needZip64 = $this->zip64 || $entry['size'] >= self::U32_MAX || $entry['offset'] >= self::U32_MAX;

            $extra = '';
            $sizeField = $entry['size'];
            $offsetField = $entry['offset'];
            if ($needZip64) {
                $extra = pack('vvPPP', 0x0001, 24, $entry['size'], $entry['size'], $entry['offset']);
                $sizeField = self::U32_MAX;
                $offsetField = self::U32_MAX;
            }

            [$time, $date] = $this->dosDateTime($entry['mtime']);

            $this->write(pack(
                'VvvvvvvVVVvvvvvVV',
                self::SIG_CD,
                0x031E,                 // version made by: UNIX (3) << 8 | 3.0
                $needZip64 ? 45 : 20,   // version needed to extract
                self::FLAGS,
                self::METHOD,
                $time,
                $date,
                $entry['crc'],
                $sizeField,
                $sizeField,
                strlen($entry['name']),
                strlen($extra),
                0,                      // comment length
                0,                      // disk number start
                0,                      // internal attributes
                0x81A40000,             // external attributes: 0644
                $offsetField
            ).$entry['name'].$extra);
        }

        $cdSize = $this->offset - $cdOffset;
        $needZip64Eocd = $this->zip64
            || $count > self::U16_MAX
            || $cdOffset >= self::U32_MAX
            || $cdSize >= self::U32_MAX;

        if ($needZip64Eocd) {
            $z64Offset = $this->offset;
            $this->write(pack(
                'VPvvVVPPPP',
                self::SIG_Z64_EOCD,
                44,                     // size of remaining record
                0x031E,
                45,
                0,                      // disk number
                0,                      // disk with start of CD
                $count,
                $count,
                $cdSize,
                $cdOffset
            ));
            $this->write(pack('VVPV', self::SIG_Z64_LOC, 0, $z64Offset, 1));
        }

        $this->write(pack(
            'VvvvvVVv',
            self::SIG_EOCD,
            0,
            0,
            $needZip64Eocd ? self::U16_MAX : $count,
            $needZip64Eocd ? self::U16_MAX : $count,
            $needZip64Eocd ? self::U32_MAX : $cdSize,
            $needZip64Eocd ? self::U32_MAX : $cdOffset,
            0
        ));
    }

    private function localHeader(string $name, int $mtime): string
    {
        [$time, $date] = $this->dosDateTime($mtime);

        // zip64 模式下本地头也声明 zip64 extra（大小占位 0），读者据此知道 descriptor 是 8 字节
        $extra = $this->zip64 ? pack('vvPP', 0x0001, 16, 0, 0) : '';
        $sizeField = $this->zip64 ? self::U32_MAX : 0;

        return pack(
            'VvvvvvVVVvv',
            self::SIG_LFH,
            $this->zip64 ? 45 : 20,
            self::FLAGS,
            self::METHOD,
            $time,
            $date,
            0,              // CRC：写在 data descriptor 里
            $sizeField,     // 压缩后大小
            $sizeField,     // 原始大小
            strlen($name),
            strlen($extra)
        ).$name.$extra;
    }

    /** @return array{0:int,1:int} [DOS time, DOS date] */
    private function dosDateTime(int $timestamp): array
    {
        $t = getdate($timestamp);
        $year = max(1980, $t['year']);

        return [
            (($t['hours'] & 0x1F) << 11) | (($t['minutes'] & 0x3F) << 5) | (($t['seconds'] >> 1) & 0x1F),
            (($year - 1980) << 9) | (($t['mon'] & 0x0F) << 5) | ($t['mday'] & 0x1F),
        ];
    }

    /** 条目名归一化：统一分隔符、去掉控制字符与文件系统非法字符、去掉 `..` 段与前导 `/` */
    private function normalizeName(string $name): string
    {
        // 反斜杠是路径分隔符；其余在文件系统/解压器里有风险的字符换成下划线（不引入额外层级）
        $name = str_replace('\\', '/', $name);
        $name = str_replace([':', '*', '?', '"', '<', '>', '|'], '_', $name);

        $parts = [];
        foreach (explode('/', $name) as $part) {
            $part = preg_replace('/[\x00-\x1F\x7F]/', '', $part);
            $part = trim($part);
            if ($part === '' || $part === '.' || $part === '..') {
                continue;
            }
            $parts[] = $part;
        }

        return implode('/', $parts);
    }

    private function write(string $bytes): void
    {
        $length = strlen($bytes);
        if ($length === 0) {
            return;
        }

        $written = 0;
        while ($written < $length) {
            $n = fwrite($this->out, $written === 0 ? $bytes : substr($bytes, $written));
            if ($n === false || $n === 0) {
                throw new RuntimeException('写入 zip 输出流失败');
            }
            $written += $n;
        }

        $this->offset += $length;
    }
}
