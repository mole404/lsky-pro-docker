<?php

/**
 * StreamedZipWriter 自校验测试。
 *
 * 特点：不依赖 Laravel、不依赖 ext-zip、不写任何文件（全程 php://temp 内存流），
 *      因此既能在本机跑，也能在只有 PHP 的容器里跑。
 *
 * 用法：
 *   php test/php/zip-writer.test.php                        只跑内部断言
 *   php test/php/zip-writer.test.php - classic              内部断言 + 把经典 zip 以 base64 打到 stdout（带标记）
 *   php test/php/zip-writer.test.php - zip64                同上，zip64 模式
 *   php test/php/zip-writer.test.php out.zip classic        写到文件（再用 unzip -t / python zipfile 校验）
 *
 * 外部校验（真正验证格式合法性，PHP 侧的断言只做自证）：
 *   python3 -c "import zipfile;z=zipfile.ZipFile('out.zip');print(z.testzip(), z.namelist())"
 *   unzip -t out.zip
 */

if (! class_exists(\App\Support\StreamedZipWriter::class)) {
    require getenv('ZIP_WRITER_PATH') ?: __DIR__.'/../../src/app/Support/StreamedZipWriter.php';
}

use App\Support\StreamedZipWriter;

final class ZipWriterTest
{
    /** 大条目的固定生成式：python 侧可复现，用来做内容完整性比对 */
    public const LARGE_SIZE = 2 * 1024 * 1024;

    private int $passed = 0;

    private int $failed = 0;

    public function run(): int
    {
        $this->testInternalAssertions();
        $this->testEntryNameNormalization();
        $this->testErrorPaths();

        if ($this->failed > 0) {
            fwrite(STDERR, sprintf("FAILED: %d passed, %d failed\n", $this->passed, $this->failed));

            return 1;
        }

        printf("OK: %d assertions passed\n", $this->passed);

        return 0;
    }

    /** 构造一份「什么都有」的包：中文/空格名、空文件、分块大文件、提示文件 */
    public function build(string $mode): array
    {
        $zip64 = $mode === 'zip64';
        $out = fopen('php://temp', 'r+b');
        $zip = new StreamedZipWriter($out, $zip64);

        $zip->addString('hello.txt', "hello world\n");
        $zip->addString('中文 目录/图片 一.jpg', $this->patterned(1024));
        $zip->addString('empty.bin', '');
        $zip->addStream('big/big.bin', $this->patternedStream(self::LARGE_SIZE), mktime(3, 4, 6, 10, 15, 2026));
        $zip->addString('_export_failures.txt', "914\t读取失败\n");
        $zip->finish();

        rewind($out);
        $bytes = stream_get_contents($out);
        fclose($out);

        return [$bytes, $zip->count()];
    }

    private function testInternalAssertions(): void
    {
        foreach (['classic', 'zip64'] as $mode) {
            [$bytes, $count] = $this->build($mode);

            $this->assert($count === 5, $mode.': 条目数为 5');
            $this->assert(strlen($bytes) > self::LARGE_SIZE, $mode.': 输出包含全部大文件字节');
            $this->assert(substr($bytes, 0, 4) === pack('V', 0x04034b50), $mode.': 以本地文件头开始');

            // 结尾必须是 EOCD（22 字节固定长度 + 0 注释）
            $eocd = substr($bytes, -22);
            $this->assert(substr($eocd, 0, 4) === pack('V', 0x06054b50), $mode.': 以 EOCD 结束');

            if ($mode === 'zip64') {
                $locator = substr($bytes, -42, 20);
                $this->assert(substr($locator, 0, 4) === pack('V', 0x07064b50), 'zip64: EOCD 前有 zip64 locator');
                $this->assert(substr($eocd, 10, 2) === pack('v', 0xFFFF), 'zip64: 经典 EOCD 写哨兵条目数');
            } else {
                $this->assert(substr($eocd, 10, 2) === pack('v', 5), 'classic: EOCD 条目数为 5');
                $this->assert(substr($eocd, 8, 4) !== pack('V', 0xFFFFFFFF), 'classic: 不出现哨兵值');
            }
        }

        // 去重：同名第二条追加 _2（保留扩展名）
        $out = fopen('php://temp', 'r+b');
        $zip = new StreamedZipWriter($out, false);
        $zip->addString('a.jpg', 'x');
        $this->assert($zip->uniqueName('a.jpg') === 'a_2.jpg', '去重：同名 → a_2.jpg');
        $this->assert($zip->uniqueName('a.png') === 'a.png', '去重：不同名不动');
        $zip->addString('dir/b.jpg', 'x');
        $this->assert($zip->uniqueName('dir/b.jpg') === 'dir/b_2.jpg', '去重：带目录');
        $zip->finish();
        fclose($out);

        // 名字归一化（通过 uniqueName 观察）
        $out = fopen('php://temp', 'r+b');
        $zip = new StreamedZipWriter($out, false);
        $this->assert($zip->uniqueName('../evil.txt') === 'evil.txt', '归一化：去掉 .. 与前导路径');
        $this->assert($zip->uniqueName('/abs/x.txt') === 'abs/x.txt', '归一化：去掉前导斜杠');
        $this->assert($zip->uniqueName("a\\b.txt") === 'a/b.txt', '归一化：反斜杠转正斜杠');
        $this->assert($zip->uniqueName('bad:name?.txt') === 'bad_name_.txt', '归一化：非法字符换下划线');
        fclose($out);
    }

    private function testErrorPaths(): void
    {
        $out = fopen('php://temp', 'r+b');
        $zip = new StreamedZipWriter($out, false);

        // 已关闭的流：必须抛异常，而不是写出半个条目
        $closed = fopen('php://temp', 'r+b');
        fclose($closed);
        $threw = false;
        try {
            $zip->addStream('closed.bin', $closed);
        } catch (\RuntimeException $e) {
            $threw = true;
        }
        $this->assert($threw, '错误路径：已关闭的流抛 RuntimeException');
        $this->assert($zip->count() === 0, '错误路径：失败条目没有进包');

        // 空名字必须被拒
        $threw = false;
        try {
            $zip->addString('   ', 'x');
        } catch (\RuntimeException $e) {
            $threw = true;
        }
        $this->assert($threw, '错误路径：空条目名抛 RuntimeException');

        fclose($out);
    }

    private function patterned(int $size): string
    {
        $buf = '';
        for ($i = 0; $i < $size; $i++) {
            $buf .= chr((($i * 37) + 11) % 256);
        }

        return $buf;
    }

    /** @return resource 惰性生成的分块流（模拟远端存储的读流） */
    private function patternedStream(int $size)
    {
        $stream = fopen('php://temp', 'r+b');
        $block = $this->patterned(65536);
        $written = 0;
        for ($i = 0; $written < $size; $i++) {
            $take = min(65536, $size - $written);
            fwrite($stream, substr($block, 0, $take));
            $written += $take;
        }
        rewind($stream);

        return $stream;
    }

    /**
     * 条目名归一化 normalizeName() 的契约。
     *
     * 为什么单独测它：ExportController 现在用**同一个**静态函数算去重键（键 == 最终写进包里的名字），
     * 两边一旦分叉，两个不同的键会写出同一个条目名 —— 解压时后者覆盖前者，用户静默丢图。
     * 本轮修的就是这条：控制器曾用自己的清洗规则把 `相册A/. . .` 洗成 `相册A/.`，
     * 而 writer 会把「只剩点号」的段整段丢掉 ⇒ 两个不同的源名撞成同一个条目名。
     *
     * 注：这里只钉住 writer 这一侧的契约；「控制器确实调用了它」由 release-discipline 测试静态钉住。
     */
    private function testEntryNameNormalization(): void
    {
        $cases = [
            '普通/文件.jpg'              => '普通/文件.jpg',
            '相册/. '                    => '相册',        // 洗成 '.' 的段被丢掉（本轮修的那条的另一面）
            '相册/..'                    => '相册',
            '相册/ . /f.jpg'             => '相册/f.jpg',
            '相册//空白段/f.jpg'          => '相册/空白段/f.jpg',
            '/前导斜杠/f.jpg'             => '前导斜杠/f.jpg',
            '  空格两端  /f.jpg'          => '空格两端/f.jpg',
            'a\\b:c*.jpg'                => 'a/b_c_.jpg',
            '相册/. . .'                 => '相册/. . .',   // 只有恰好 '' / '.' / '..' 才丢；点加空格不是
            ''                           => '',
            '   '                        => '',
            '.'                          => '',
            '..'                         => '',
        ];

        foreach ($cases as $in => $want) {
            $got = StreamedZipWriter::normalizeName($in);
            $this->assert($got === $want, sprintf(
                'normalizeName(%s) === %s（实际 %s）', var_export($in, true), var_export($want, true), var_export($got, true)
            ));
            // 幂等：控制器把归一化结果直接当最终名字用，再洗一次必须一字不改
            $this->assert(
                StreamedZipWriter::normalizeName($got) === $got,
                sprintf('normalizeName(%s) 幂等（再洗一次不变）', var_export($got, true))
            );
        }
    }

    private function assert(bool $condition, string $label): void
    {
        if ($condition) {
            $this->passed++;

            return;
        }
        $this->failed++;
        fwrite(STDERR, "  ✗ {$label}\n");
    }
}

$emit = $argv[1] ?? null;
$mode = $argv[2] ?? 'classic';
if (! in_array($mode, ['classic', 'zip64'], true)) {
    fwrite(STDERR, "unknown mode: {$mode}\n");
    exit(2);
}

$test = new ZipWriterTest();
$exit = $test->run();

if ($exit === 0 && $emit !== null) {
    [$bytes] = $test->build($mode);
    if ($emit === '-') {
        echo "---ZIP-BASE64-BEGIN---\n";
        echo base64_encode($bytes), "\n";
        echo "---ZIP-BASE64-END---\n";
    } else {
        file_put_contents($emit, $bytes);
        printf("wrote %d bytes to %s (%s)\n", strlen($bytes), $emit, $mode);
    }
}

exit($exit);
