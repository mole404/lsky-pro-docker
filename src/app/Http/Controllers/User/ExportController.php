<?php

namespace App\Http\Controllers\User;

use App\Exceptions\ClientAbortedException;
use App\Http\Controllers\Controller;
use App\Models\Image;
use App\Models\Strategy;
use App\Models\User;
use App\Services\ImageService;
use App\Support\ExportCancel;
use App\Support\ExportConcurrency;
use App\Support\StreamedZipWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use League\Flysystem\Filesystem;
use Symfony\Component\HttpFoundation\StreamedResponse as SymfonyStreamedResponse;

/**
 * 用户端「批量导出」：把自己账号下的图片按筛选条件流式打包成一个 zip 直接下载。
 *
 * 改动前请先读这三条硬约束：
 *   1) 只读：全程只有 SELECT 与 readStream()。不写库、不删图、不落盘（既不写临时文件也不需要 ext-zip，
 *      zip 是自己按 PKWARE 格式边读边写进 php://output 的，见 App\Support\StreamedZipWriter）。
 *   2) 用完就扔：占位表、结果记录都只落在缓存里且都有 TTL，导出结束/取消/崩溃后立即清理或自动过期。
 *   3) zip 的中央目录写在最后 ⇒ 中断的包连包内摘要都读不出来，所以「正常结束 / 用户取消 / fatal」
 *      三条收尾路径都必须写一份服务端结果记录（设置页靠它显示「已中断」）。
 */
class ExportController extends Controller
{
    /** 导出结果记录保留时间（秒）：够设置页轮询到即可，过期自动消失 */
    private const RESULT_TTL = 1800;

    /** 每批取多少张图（只影响内存与查询次数，不影响输出内容） */
    private const CHUNK = 200;

    /** 条目名长度上限（zip 本身允许到 65535 字节，这里只是让名字保持可读、可控） */
    private const NAME_LIMIT = 120;

    /**
     * 单张图的读取超时（秒）：连接 5s、整次请求 30s。
     * 导出是长响应，一张图卡在远端就会占住一个 worker —— 交给 S3 客户端的 http 超时兜底
     * （其它驱动的适配器不接受超时参数，行为与从前一致）。
     */
    private const READ_TIMEOUTS = ['connect_timeout' => 5, 'timeout' => 30];

    /**
     * 体积预检：点「打包下载」前先给用户看「多少张 / 多大」。
     * 只查库（一次 count + 一次 sum），不读存储、不写任何东西。
     */
    public function preview(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = Auth::user();
        $query = $this->filtered($request);

        return response()->json([
            'count' => (clone $query)->count(),
            // size 列的单位是 KB（实测 912230 ≈ 891MB）
            'bytes' => (int) round((float) (clone $query)->sum('size') * 1024),
            // 已经有导出在跑就先说清楚：前端提示后不跳转，避免用户撞上 429 的纯文本页
            'busy'  => ExportConcurrency::isActive($user->id),
        ]);
    }

    /**
     * 本人最近一次导出结果；没有记录时返回 null（页面上就什么都不显示）。
     */
    public function result(): JsonResponse
    {
        /** @var User $user */
        $user = Auth::user();
        $record = Cache::get($this->resultKey($user->id));

        // 固定信封，不外发裸 null：Symfony 的 JsonResponse 会把 PHP 的 null 归一成 `{}`、
        // 把空数组归一成 `[]`，前端很容易把空对象误当成「有一条记录、只是字段全空」。
        // 信封里的 record 永远是显式的 null 或对象，前端一句 data.record 就够。
        //   record   —— 最近一次「已完成」的导出记录（没有则 null）
        //   progress —— 此刻正在跑的那笔的进度（含 run 标识，前端据此认领自己的任务）
        //   active   —— 此刻是否有导出在跑（含别人触发的，或本账号的另一笔）
        return response()->json([
            'record'   => is_array($record) ? $record : null,
            'progress' => ExportConcurrency::progress($user->id),
            'active'   => ExportConcurrency::isActive($user->id),
        ]);
    }

    /**
     * 流式导出。响应头之后就一路往外写 zip 字节，不再有任何“整体缓冲”。
     */
    public function export(Request $request): Response|SymfonyStreamedResponse
    {
        /** @var User $user */
        $user = Auth::user();
        $userId = $user->id;

        // 本次导出的标识：前端随机生成、随下载地址带过来，服务端原样写进结果记录。
        // 前端只认「run 与自己一致」的结果，于是设置页再也不用在打开时读旧记录来区分
        // 「本次」与「上一次」—— 历史记录一次都不会显示在页面上。
        $run = $this->runToken($request);

        // 占位 = 同一账号只能有一个导出（同时受整机并发上限约束）
        $denied = ExportConcurrency::acquire($userId, 0, $run);

        if ($denied === 'busy') {
            return $this->text('已有导出任务在进行中，请等它结束', 429);
        }

        if ($denied === 'full') {
            return $this->text('当前有其他用户正在导出，请稍后再试', 429);
        }

        // 占位是在「流真正开始写」之前拿的，而释放只发生在流回调里 —— 所以这一段里要是出了岔子
        // （异常、致命错误、类型错误……），流回调永远不会跑，占位就没人还，用户被自己那笔占位
        // 挡在门外直到心跳过期。这里用 shutdown 兜底：没开流就还占位。
        // 新一次导出开始：清掉可能残留的取消旗标（否则上一轮的取消会立刻掐掉这一轮）
        ExportCancel::clear($userId);

        $streamStarted = false;
        register_shutdown_function(static function () use (&$streamStarted, $userId) {
            if (! $streamStarted) {
                ExportConcurrency::release($userId);
            }
        });

        $query = $this->filtered($request);
        $total = (clone $query)->count();

        if ($total === 0) {
            // 没东西可导：不用开流，也别留着占位
            ExportConcurrency::release($userId);

            return $this->text('没有符合条件的图片，未生成导出文件');
        }

        $bytes = (int) round((float) (clone $query)->sum('size') * 1024);

        // 总数先公布出去：进度条一开弹窗就有分母，不用等第一张图写完
        ExportConcurrency::touch($userId, ExportConcurrency::progressPayload(0, 0, $total, $run));

        // zip64 判定：条目数越过 65535，或 32 位的大小/偏移快溢出时必须切到 zip64。
        // size 列是 KB 精度（不含每条头部开销），所以留 8MB 余量；另外固定还会追加 3 个条目（索引/摘要/失败清单）。
        $zip64 = ($total + 8) >= 0xFFFF || $bytes >= 0xFFFFFFFF - 8 * 1024 * 1024;

        $filename = 'lsky-images-'.Carbon::now()->format('Ymd-His').'.zip';
        $filters = $this->describe($request);
        $started = Carbon::now();

        $headers = [
            'Content-Type'        => 'application/zip',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"; filename*=UTF-8''{$filename}",
            'Cache-Control'       => 'private, no-store, no-cache, must-revalidate',
            'Pragma'              => 'no-cache',
            // 关键：让 nginx 不要把这个响应缓冲到磁盘（容器内零落盘承诺的外部一半）
            'X-Accel-Buffering'   => 'no',
        ];

        return response()->stream(function () use ($query, $zip64, $userId, $total, $filters, $started, $run, &$streamStarted) {
            // 流真的开始往外写了：撤掉上面那个「没开流就还占位」的兜底
            $streamStarted = true;

            $state = [
                'ok'          => 0,
                'failed'      => 0,
                'bytes'       => 0,
                'first_error' => null,
                'failures'    => [],
                'index'       => [],
            ];
            $finished = false;

            // 收尾：释放占位 + 写结果记录 +（只有真出问题才）写一条日志。
            // 三条路径都走这里 —— 正常结束、用户取消/网络断开、fatal（register_shutdown_function）。
            $finish = function (bool $aborted) use (&$state, &$finished, $userId, $total, $started, $run) {
                if ($finished) {
                    return;
                }
                $finished = true;

                ExportConcurrency::release($userId);
                ExportCancel::clear($userId);

                $this->storeResult($userId, [
                    'started_at'  => $started->toIso8601String(),
                    'finished_at' => Carbon::now()->toIso8601String(),
                    'total'       => $total,
                    'ok'          => $state['ok'],
                    'failed'      => $state['failed'],
                    'bytes'       => (int) $state['bytes'],
                    'aborted'     => $aborted,
                    'first_error' => $state['first_error'],
                    // 本次导出的标识：前端只认自己那一次，页面不再显示任何历史结果
                    'run'         => $run,
                ]);

                if ($state['failed'] > 0 || $state['first_error'] !== null) {
                    $this->log($userId, $state, $aborted);
                }
            };

            register_shutdown_function(function () use (&$finish) {
                // fatal / 未捕获异常（含被限制执行时间的信号打断）也要收尾，
                // 否则占位与结果记录要等到 TTL 才消失。$finished 保证不会重复收尾。
                $finish(true);
            });

            while (ob_get_level() > 0) {
                // 任何残留的输出缓冲都会把字节插到 zip 前面（浏览器拿到的是一个损坏的包）
                ob_end_clean();
            }

            $out = fopen('php://output', 'wb');
            $zip = new StreamedZipWriter($out, $zip64);
            $filesystems = [];  // strategy_id => Filesystem：同一策略复用 adapter，避免每张图重建客户端与握手
            $used = [];         // 已占用的条目名，用于同名去重

            $interrupted = false;

            try {
                $query->with(['album', 'strategy', 'group', 'tags'])
                    ->chunkById(self::CHUNK, function ($images) use ($zip, &$state, &$filesystems, &$used, $userId, $total, $run) {
                        foreach ($images as $image) {
                            if (connection_aborted()) {
                                throw new ClientAbortedException();
                            }

                            // 用户点了「取消导出」：在图片边界上停 —— 不掐在一张图写到一半的地方，
                            // 免得包内多出一条半截条目。走的是同一条中断收尾。
                            if (ExportCancel::requested($userId)) {
                                throw new ClientAbortedException();
                            }

                            $this->writeImage($zip, $image, $filesystems, $used, $state);

                            // 心跳 + 进度：每张图刷新一次（同一笔写入）。既让别人知道这个导出还活着
                            // （不会被当成死占位回收），也让设置页的进度条能动起来。
                            ExportConcurrency::touch($userId, ExportConcurrency::progressPayload(
                                $state['ok'] + $state['failed'],
                                (int) $state['bytes'],
                                $total,
                                $run
                            ));
                        }
                    });

                if (connection_aborted()) {
                    throw new ClientAbortedException();
                }

                // 顺序固定为：图片条目 → 索引 → 摘要 → 失败清单。
                // 索引建立在内存里（每行百余字节），换来的是一条 zip 顺序写到底、不回头。
                if ($state['index']) {
                    $zip->addString('_index.csv', $this->csv($state['index']));
                }

                $zip->addString('_export_summary.txt', $this->summary($filters, $state, $total, $started));

                if ($state['failures']) {
                    $zip->addString('_export_failures.txt', $this->failureReport($state['failures']));
                }

                $zip->finish();
            } catch (ClientAbortedException $e) {
                // 用户取消 / 网络断开：什么都不用“抢救”，中央目录本来也写不完整
                $interrupted = true;
            } catch (\Throwable $e) {
                // 流已经写了一半（例如远端读到一半断开）：这条条目回不了头，只能结束响应。
                // 客户端会拿到不完整的包（设置页会显示「已中断」），服务端记下第一个原因。
                $interrupted = true;
                $state['first_error'] = $state['first_error'] ?: class_basename($e).': '.$e->getMessage();
            } finally {
                if (is_resource($out)) {
                    @fclose($out);
                }

                $finish($interrupted);
            }
        }, 200, $headers);
    }

    /**
     * 取消当前账号正在进行的导出。
     *
     * 客户端点「取消导出」走这里：置一个旗标，流式循环在下一张图的边界上自己停下，
     * 然后照常走「中断」收尾（释放占位 + 结果记为已中断），连接随之断开。
     * 没有导出在进行时不报错（幂等）。
     */
    public function cancel(): JsonResponse
    {
        /** @var User $user */
        $user = Auth::user();

        $active = ExportConcurrency::isActive($user->id);

        if ($active) {
            ExportCancel::request($user->id);
        }

        return response()->json(['ok' => true, 'active' => $active]);
    }

    /**
     * 写一张图。失败只记进状态（跳过该图），不中断整包 —— 除非字节已经写出去了（那种情况只能中止）。
     */
    private function writeImage(StreamedZipWriter $zip, Image $image, array &$filesystems, array &$used, array &$state): void
    {
        $strategy = $image->strategy;

        if (! $strategy) {
            $this->markFailed($state, $image->id, 'storage-strategy-missing');

            return;
        }

        $pathname = (string) $image->pathname;

        if ($pathname === '') {
            $this->markFailed($state, $image->id, 'pathname-missing');

            return;
        }

        // 顺序很关键：先把流拿到手，再写 local header。
        // 反过来的话，一条读不出来的图会在包里留下“只有头部没有内容”的条目，整包就废了。
        try {
            // 同一个存储策略只建一次适配器：否则每张图都要新建客户端 + 重新握手（四百张图就是四百次）
            $filesystem = $filesystems[$strategy->id]
                ??= new Filesystem((new ImageService())->getAdapter($strategy, self::READ_TIMEOUTS));
            $stream = $filesystem->readStream($pathname);
        } catch (\Throwable $e) {
            $this->markFailed($state, $image->id, 'read-failed: '.class_basename($e));

            return;
        }

        if (! is_resource($stream)) {
            $this->markFailed($state, $image->id, 'read-failed: not-a-stream');

            return;
        }

        try {
            $state['bytes'] += $zip->addStream(
                $this->entryName($image, $used),
                $stream,
                $image->created_at ? $image->created_at->getTimestamp() : null
            );
        } catch (\Throwable $e) {
            // 已经写进去一半，回不了头了：交给外层中止整个响应
            $state['first_error'] = 'partial-entry: '.class_basename($e);

            throw $e;
        }

        $state['ok']++;

        if ((float) $image->size <= 0) {
            // 读得出来但源文件是 0 字节：条目确实进包了，只是内容为空 —— 单独列出来让用户能察觉
            $state['failures'][] = $image->id."\tzero-byte";
        }

        $state['index'][] = [
            $image->filename,
            (int) round((float) $image->size * 1024),
            $image->created_at ? $image->created_at->format('Y-m-d H:i:s') : '',
            $image->album ? $image->album->name : '未分类',
            $image->tags->pluck('name')->implode('、'),
            $image->strategy ? $image->strategy->name : '',
            $image->url,
            $image->key,
        ];
    }

    /**
     * 导出范围：永远只在「自己账号的图」里选（多用户部署不越权），条件由 Image::scopeFilter 解析。
     */
    private function filtered(Request $request)
    {
        /** @var User $user */
        $user = Auth::user();

        // 必须给 `album_id` 一个显式哨兵值：scopeFilter 在「没传 album_id」时会强制
        // whereNull('album_id')（那是图片列表页「未分类」视图的语义）。导出侧若走缺省分支，
        // 就只会导出未分类的那些图，而且 album_ids[] 的 whereIn 会被它 AND 成空集。
        // 这里只改本次请求自己的一份 query，不影响别的调用方（它们也不会传这个值）。
        $request->query->set('album_id', 'all');

        // reorder('id')：固定按主键升序取（chunkById 需要单调键），也顺带丢掉列表页的默认排序
        return $user->images()->filter($request)->reorder('id');
    }

    /**
     * zip 内的条目名：`<相册名>/<原文件名>`，未分类进 uncategorized/。
     * 同名（同一个相册里两张都叫 a.jpg）时补上图片 key 区分。
     */
    private function entryName(Image $image, array &$used): string
    {
        // trim() 必须与写条目时的口径一致（StreamedZipWriter::normalizeName 逐段 trim）：
        // sanitize() 只去首尾点、不去空格，若不在这里对齐，去重键会与包里最终的名字不同
        // （"a.jpg " 与 "a.jpg" 两个键、同一个名字）⇒ 包里出现重名条目，解压时后者覆盖前者。
        $folder = trim($image->album ? $this->sanitize($image->album->name) : 'uncategorized');

        if ($folder === '') {
            $folder = 'uncategorized';
        }

        $filename = trim($this->sanitize((string) $image->filename));

        if ($filename === '') {
            $filename = $image->key.'.'.$image->extension;
        }

        $name = $folder.'/'.$filename;

        if (isset($used[$name])) {
            $extension = pathinfo($filename, PATHINFO_EXTENSION);
            $base = $extension !== '' ? substr($filename, 0, -strlen($extension) - 1) : $filename;
            $name = $folder.'/'.$base.'_'.$image->key.($extension !== '' ? '.'.$extension : '');
        }

        $used[$name] = true;

        return $name;
    }

    /**
     * 条目名里的单段清洗：去掉控制字符与 zip/文件系统不友好的符号、防 `..` 段，
     * 但**保留空格与中文**（zip 名走 UTF-8 标志位，中文名能被正常解压）。
     */
    private function sanitize(string $value): string
    {
        $value = (string) preg_replace('/[\x00-\x1F\x7F]/u', '', $value);
        $value = str_replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], '_', $value);
        $value = (string) preg_replace('#^\.+$#', '_', trim($value));
        $value = trim($value, '.');

        if (mb_strlen($value) > self::NAME_LIMIT) {
            $value = mb_substr($value, 0, self::NAME_LIMIT);
        }

        return $value;
    }

    /**
     * 筛选条件的“人话”，写进包内摘要（用和设置页同一份查询参数渲染，不靠前端拼）。
     */
    private function describe(Request $request): string
    {
        /** @var User $user */
        $user = Auth::user();
        $parts = [];

        $albums = $this->ids($request->query('album_ids'), true);

        if ($albums) {
            $names = $user->albums()->whereIn('id', array_values(array_diff($albums, [0])))->pluck('name')->all();

            if (in_array(0, $albums, true)) {
                array_unshift($names, '未分类');
            }

            $parts[] = '相册='.implode('、', $names);
        }

        $tags = $this->ids($request->query('tag_ids'));

        if ($tags) {
            $parts[] = '标签='.$user->tags()->whereIn('id', $tags)->pluck('name')->implode('、');
        }

        $strategies = $this->ids($request->query('strategy_ids'));

        if ($strategies) {
            $parts[] = '策略='.Strategy::query()->whereIn('id', $strategies)->pluck('name')->implode('、');
        }

        $from = $request->query('date_from');
        $to = $request->query('date_to');

        if (is_string($from) && $from !== '' || is_string($to) && $to !== '') {
            $parts[] = '日期='.($from ?: '不限').'~'.($to ?: '不限');
        }

        return $parts ? implode('；', $parts) : '全部图片';
    }

    /**
     * 把请求里的 id 数组规整成整数列表（去重、丢非法值）。
     * $allowZero 用于相册：0 代表「未分类」这一项。
     */
    private function ids($value, bool $allowZero = false): array
    {
        $ids = [];

        foreach ((array) $value as $item) {
            if (! is_scalar($item)) {
                continue;
            }

            $id = (int) $item;

            if ($id < 0 || ($id === 0 && ! $allowZero) || in_array($id, $ids, true)) {
                continue;
            }

            $ids[] = $id;
        }

        return $ids;
    }

    private function csv(array $rows): string
    {
        // Excel 打开 UTF-8 CSV 需要 BOM，否则中文列会乱码
        $csv = "\xEF\xBB\xBF";
        $csv .= $this->csvLine(['文件名', '字节大小', '上传时间', '相册', '标签', '存储策略', '直链', 'key']);

        foreach ($rows as $row) {
            $csv .= $this->csvLine($row);
        }

        return $csv;
    }

    private function csvLine(array $fields): string
    {
        $escaped = array_map(static function ($field) {
            $field = (string) $field;

            return preg_match('/[",\r\n]/', $field) ? '"'.str_replace('"', '""', $field).'"' : $field;
        }, $fields);

        return implode(',', $escaped)."\r\n";
    }

    private function summary(string $filters, array $state, int $total, Carbon $started): string
    {
        $lines = [
            '导出时间：'.Carbon::now()->format('Y-m-d H:i:s P'),
            '筛选条件：'.$filters,
            '图片张数：'.$total.'（成功 '.$state['ok'].'，失败 '.$state['failed'].'）',
            '总字节：'.(int) $state['bytes'],
            '索引文件：_index.csv',
            '耗时：'.(int) $started->diffInSeconds(Carbon::now()).' 秒',
        ];

        if ($state['failures']) {
            $lines[] = '失败清单：_export_failures.txt';
        }

        return implode("\n", $lines)."\n";
    }

    private function failureReport(array $failures): string
    {
        $header = [
            '# 需要留意的条目（格式：image_id <TAB> 原因）',
            '# read-failed: …      = 从存储读不出来，**没有**写进压缩包',
            '# pathname-missing / storage-strategy-missing = 记录不完整，**没有**写进压缩包',
            '# zero-byte           = 源文件是 0 字节，该条目**已**写进压缩包，只是内容为空',
        ];

        return implode("\n", $header)."\n".implode("\n", $failures)."\n";
    }

    private function markFailed(array &$state, int $id, string $reason): void
    {
        $state['failed']++;
        $state['first_error'] = $state['first_error'] ?: $reason;
        $state['failures'][] = $id."\t".$reason;
    }

    /**
     * 前端带来的本次导出标识。只收 [A-Za-z0-9_-] 且长度封顶，拿不到就是 null
     * （例如用户直接从地址栏打开下载地址，那种情况结果记录里 run 为 null）。
     */
    private function runToken(Request $request): ?string
    {
        $run = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $request->query('run', ''));

        return $run === '' ? null : substr($run, 0, 32);
    }

    private function resultKey(int $userId): string
    {
        return 'image-export:result:'.$userId;
    }

    private function storeResult(int $userId, array $result): void
    {
        try {
            Cache::put($this->resultKey($userId), $result, self::RESULT_TTL);
        } catch (\Throwable $e) {
            // 结果记录写失败不该影响导出本身（用户还能看包内摘要）
        }
    }

    /**
     * 只在「有失败 / 有异常」时写一条日志。
     * 走按需的 daily channel（不需要改 config/logging.php），days=3 由 Monolog 自动删超期文件；
     * 成功导出一条都不写 —— 正常情况下这一天的日志文件根本不会产生。
     */
    private function log(int $userId, array $state, bool $aborted): void
    {
        try {
            Log::build([
                'driver' => 'daily',
                'path'   => storage_path('logs/export.log'),
                'level'  => 'warning',
                'days'   => 3,
            ])->warning('image export finished', [
                'user_id'     => $userId,
                'ok'          => $state['ok'],
                'failed'      => $state['failed'],
                'aborted'     => $aborted,
                'first_error' => $state['first_error'],
            ]);
        } catch (\Throwable $e) {
            // 日志写不进去也不该影响导出
        }
    }

    private function text(string $message, int $status = 200): Response
    {
        return response($message, $status)->header('Content-Type', 'text/plain; charset=utf-8');
    }
}
