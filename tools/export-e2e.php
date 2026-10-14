#!/usr/bin/env php
<?php

/**
 * 「批量导出」端到端验收器 —— 在跑起来的容器里对着真实部署跑一遍。
 *
 * 为什么要有它：导出是「路由 + auth 中间件 + 流式响应」的组合，单元测试与页面渲染测试都盖不住
 * —— 返回类型对不上的那类错只有真走一次 HTTP 内核才会暴露（历史上正是它漏到了线上）。
 *
 * 用法（容器内执行）：
 *   php tools/export-e2e.php --out=/tmp/e2e.zip [--filter='album_ids[]=2'] [--user=1] [--expect=1]
 *
 *   --filter  传给 /settings/export 的查询串（默认空 = 导出该账号全部图片）
 *   --user    用哪个账号（默认 1）
 *   --expect  期望的图片条目数；给了就断言（不给只报告实际数量）
 *   --out     把流式 zip 落到这个文件并校验；省略时只打印诊断（zip 走 stdout）
 *
 * 校验项：HTTP 200 / Content-Type: application/zip / zip 结构完整（本地头 + 中央目录能对上）/
 *         索引与摘要条目存在 / 图片条目数 == --expect / 跑完导出占位已释放。
 * 退出码：0 通过；1 失败（原因打 stderr，CI 可直接 ::error::）。
 *
 * 实现说明：导出把字节写进 php://output（还会先清空输出缓冲），所以「zip 走 stdout、诊断走 stderr」
 * 是唯一干净的接法。给了 --out 时本脚本会用 proc_open 自己再起一个子进程去接，父进程只做校验。
 */

$opts = ['filter' => '', 'user' => '1', 'expect' => null, 'out' => null];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([a-z]+)=(.*)$/s', $arg, $m)) {
        $opts[$m[1]] = $m[2];
    }
}

$isChild = getenv('LSKY_E2E_CHILD') === '1';

// ---------------------------------------------------------------------------
// 父进程：把 zip 接进 --out，再做结构校验
// ---------------------------------------------------------------------------
if ($opts['out'] !== null && ! $isChild) {
    $errors = [];
    $out = $opts['out'];
    @unlink($out);
    putenv('LSKY_E2E_CHILD=1');

    $cmd = [PHP_BINARY, __FILE__, '--filter='.$opts['filter'], '--user='.$opts['user']];
    $proc = proc_open($cmd, [1 => ['file', $out, 'w'], 2 => ['pipe', 'w']], $pipes, null, null);
    if (! is_resource($proc)) {
        fwrite(STDERR, "::error::无法启动子进程\n");
        exit(1);
    }
    $diag = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $code = proc_close($proc);

    // 子进程的诊断里挑出我们要断言的几行
    $grab = static function (string $label) use ($diag): ?string {
        return preg_match('/^'.preg_quote($label, '/').'(.*)$/m', $diag, $m) ? trim($m[1]) : null;
    };

    $status = $grab('HTTP 状态:');
    $ctype = $grab('Content-Type:');
    $lockAfter = $grab('跑之后的占位状态（false 才对）:');

    if ($code !== 0) { $errors[] = '子进程退出码 '.$code.'（见上面的栈/报错）'; }
    if ($status !== '200') { $errors[] = 'HTTP 状态不是 200 而是 '.var_export($status, true); }
    if ($ctype !== 'application/zip') { $errors[] = 'Content-Type 不是 application/zip 而是 '.var_export($ctype, true); }
    if ($lockAfter !== 'false') { $errors[] = '跑完导出占位没释放（'.$lockAfter.'）—— 用户会被自己的占位挡住'; }

    // zip 结构：结尾必须能读到中央目录，条目数与图片数对得上
    $bytes = is_file($out) ? filesize($out) : 0;
    $entries = [];
    if ($bytes === 0) {
        $errors[] = 'zip 是空的（0 字节）';
    } else {
        $data = (string) file_get_contents($out);
        $eocd = strrpos($data, "PK\x05\x06");
        if ($eocd === false) {
            $errors[] = 'zip 结尾读不到中央目录（EOCD）—— 包是残的';
        } else {
            $total = unpack('v', substr($data, $eocd + 10, 2))[1];
            $cdOffset = unpack('V', substr($data, $eocd + 16, 4))[1];
            $p = $cdOffset;
            for ($i = 0; $i < $total; $i++) {
                if (substr($data, $p, 4) !== "PK\x01\x02") { $errors[] = '中央目录第 '.($i + 1).' 条签名不对'; break; }
                $nameLen = unpack('v', substr($data, $p + 28, 2))[1];
                $entries[] = substr($data, $p + 46, $nameLen);
                $extraLen = unpack('v', substr($data, $p + 30, 2))[1];
                $commentLen = unpack('v', substr($data, $p + 32, 2))[1];
                $p += 46 + $nameLen + $extraLen + $commentLen;
            }
        }
    }

    $images = array_values(array_filter($entries, static fn ($n) => ! str_starts_with($n, '_')));
    if (count($images) !== count($entries) - 2) {
        $errors[] = '包内除了图片还应有 _index.csv 与 _export_summary.txt 两个条目，实际条目: '.implode(', ', $entries);
    }
    if ($opts['expect'] !== null && count($images) !== (int) $opts['expect']) {
        $errors[] = '图片条目数 '.count($images).' 与期望的 '.$opts['expect'].' 不符';
    }

    echo 'zip: '.$out.'  '.$bytes.' 字节，条目 '.count($entries).'（图片 '.count($images)."）\n";
    foreach ($entries as $n) { echo '  - '.$n."\n"; }
    echo "---- 子进程诊断 ----\n".$diag;

    if ($errors) {
        fwrite(STDERR, "::error::导出端到端验收失败：\n  - ".implode("\n  - ", $errors)."\n");
        exit(1);
    }
    echo "RESULT: PASS\n";
    exit(0);
}

// ---------------------------------------------------------------------------
// 子进程：真的走一次 HTTP 内核，把 zip 写到 stdout，诊断写 stderr
// ---------------------------------------------------------------------------
use App\Support\ExportConcurrency;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;

$say = static function (string $line): void { fwrite(STDERR, $line."\n"); };

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
// CLI 里光 make(HttpKernel) 不会引导 config/db/门面，模型就拿不到连接
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$user = App\Models\User::findOrFail((int) $opts['user']);

// 等价于测试里的 actingAs()：先把 web guard 解析成已登录，auth 中间件即放行
Auth::shouldUse('web');
Auth::guard('web')->setUser($user);

$request = Request::create('/settings/export'.($opts['filter'] !== '' ? '?'.$opts['filter'] : ''), 'GET');
$say('请求: '.$request->getRequestUri());
$say('跑之前的占位状态: '.var_export(ExportConcurrency::isActive($user->id), true));

$response = $kernel->handle($request);
$streamed = $response instanceof Symfony\Component\HttpFoundation\StreamedResponse;

$say('HTTP 状态: '.$response->getStatusCode());
$say('Content-Type: '.($response->headers->get('content-type') ?? '-'));
$say('Content-Disposition: '.($response->headers->get('content-disposition') ?? '-'));
$say('X-Accel-Buffering: '.($response->headers->get('x-accel-buffering') ?? '-'));
$say('响应类型: '.get_class($response));

if ($streamed && $response->getStatusCode() === 200) {
    $response->sendContent();   // 回调把 zip 写进 php://output（CLI 下就是本进程 stdout）
} else {
    $body = method_exists($response, 'getContent') ? (string) $response->getContent() : '';
    $say('非流式响应体（前 200 字）: '.substr(preg_replace('/\s+/', ' ', $body), 0, 200));
}

$say('跑之后的占位状态（false 才对）: '.var_export(ExportConcurrency::isActive($user->id), true));
$say('结果记录: '.json_encode(Cache::get('image-export:result:'.$user->id), JSON_UNESCAPED_UNICODE));
