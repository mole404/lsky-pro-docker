<?php

/**
 * ExportConcurrency（导出并发占位表）自校验测试。
 *
 * 为什么需要：这张小表管着三件用户可见的事 ——
 *   ① 同一账号同时只能有一笔导出（否则两笔并行回读存储、重复占带宽与 worker）；
 *   ② 整机的全局并发上限（低配机上导出会占住 Apache worker）；
 *   ③ 前端进度条读的进度。
 * 而它此前**没有任何自动覆盖**：把 'busy' / 'full' 弄反、把心跳过期判据写错、
 * 让缓存故障变成「拦下用户」，在 CI 里都看不出来。
 *
 * 特点：零依赖。用到 Laravel 门面的那几个点由 export-concurrency.stubs.php 顶替，
 *      所以能在一个只有 PHP 的容器里跑（CI 就这么跑）。
 *
 * 用法：
 *   php test/php/export-concurrency.test.php
 *   { cat test/php/export-concurrency.stubs.php; tail -n +2 src/app/Support/ExportConcurrency.php; tail -n +2 test/php/export-concurrency.test.php; } | php /dev/stdin
 */

if (! class_exists(\Illuminate\Support\Facades\Cache::class)) {
    require __DIR__.'/export-concurrency.stubs.php';
}

if (! class_exists(\App\Support\ExportConcurrency::class)) {
    require __DIR__.'/../../src/app/Support/ExportConcurrency.php';
}

final class ExportConcurrencyTest
{
    private int $passed = 0;
    private int $failed = 0;

    public function run(): int
    {
        $this->placeAndExclusive();
        $this->globalCap();
        $this->releaseAllowsRetry();
        $this->progressRoundTrip();
        $this->heartbeatKeepsAlive();
        $this->staleEntryIsReclaimed();
        $this->legacyTimestampShape();
        $this->malformedEntryIsDead();
        $this->capBoundaries();
        $this->lockTimeoutIsConservative();
        $this->cacheFailureDegrades();

        if ($this->failed > 0) {
            fwrite(STDERR, sprintf("FAILED: %d passed, %d failed\n", $this->passed, $this->failed));

            return 1;
        }

        printf("OK: %d assertions passed\n", $this->passed);

        return 0;
    }

    /** 占位成功 / 同账号第二次被拒 */
    private function placeAndExclusive(): void
    {
        \Illuminate\Support\Facades\Cache::reset();

        $this->assert(\App\Support\ExportConcurrency::acquire(1) === null, '首次占位成功（返回 null）');
        $this->assert(\App\Support\ExportConcurrency::active() === 1, '活跃占位数 = 1');
        $this->assert(\App\Support\ExportConcurrency::acquire(1) === 'busy', '同账号再占位 → busy');
        $this->assert(\App\Support\ExportConcurrency::isActive(1) === true, 'isActive(1) = true');
        $this->assert(\App\Support\ExportConcurrency::isActive(2) === false, '别的账号不受影响');
    }

    /** 全局上限：到顶之后是 'full'（不是 'busy'） */
    private function globalCap(): void
    {
        putenv('EXPORT_MAX_CONCURRENCY=2');
        \Illuminate\Support\Facades\Cache::reset();

        $this->assert(\App\Support\ExportConcurrency::cap() === 2, 'cap() 读 EXPORT_MAX_CONCURRENCY');
        $this->assert(\App\Support\ExportConcurrency::acquire(1) === null, '第 1 笔占位成功');
        $this->assert(\App\Support\ExportConcurrency::acquire(2) === null, '第 2 笔占位成功（到上限）');
        $this->assert(\App\Support\ExportConcurrency::acquire(3) === 'full', '第 3 笔 → full（全局已满）');
        $this->assert(\App\Support\ExportConcurrency::active() === 2, '活跃占位数 = 上限 2');
        $this->assert(\App\Support\ExportConcurrency::progress(3) === null, '被拒的账号没有进度条目');
    }

    /** 取消 / 结束之后立刻能重开（release 必须真的释放） */
    private function releaseAllowsRetry(): void
    {
        putenv('EXPORT_MAX_CONCURRENCY=4');
        \Illuminate\Support\Facades\Cache::reset();

        \App\Support\ExportConcurrency::acquire(9);
        \App\Support\ExportConcurrency::release(9);

        $this->assert(\App\Support\ExportConcurrency::isActive(9) === false, 'release 之后不再活跃');
        $this->assert(\App\Support\ExportConcurrency::active() === 0, 'release 之后活跃数为 0');
        $this->assert(\App\Support\ExportConcurrency::acquire(9) === null, '取消后立刻能重开（不被 busy 卡住）');
        \App\Support\ExportConcurrency::release(9);
        \App\Support\ExportConcurrency::release(9); // 幂等：重复 release 不应出错
        $this->assert(\App\Support\ExportConcurrency::active() === 0, 'release 幂等');
    }

    /** 进度：写进去什么读出来什么 */
    private function progressRoundTrip(): void
    {
        \Illuminate\Support\Facades\Cache::reset();
        \App\Support\ExportConcurrency::acquire(5, 10, 'run-a');
        \App\Support\ExportConcurrency::touch(5, \App\Support\ExportConcurrency::progressPayload(5, 2048, 10, 'run-a'));

        $p = \App\Support\ExportConcurrency::progress(5);

        $this->assert(($p['done'] ?? null) === 5, 'progress.done = 5');
        $this->assert(($p['total'] ?? null) === 10, 'progress.total = 10');
        $this->assert(($p['bytes'] ?? null) === 2048, 'progress.bytes = 2048');
        $this->assert(($p['run'] ?? null) === 'run-a', 'progress.run = run-a（前端据此认领自己的任务）');
        $this->assert(\App\Support\ExportConcurrency::progress(999) === null, '没有导出的账号 → 进度 null');
        $this->assert(\App\Support\ExportConcurrency::progressPayload(1, 2, 3, 'r') === ['done' => 1, 'bytes' => 2, 'total' => 3, 'run' => 'r'], 'progressPayload 形状');
    }

    /** 心跳（每写一张图刷一次）没过期 ⇒ 仍然算活着 */
    private function heartbeatKeepsAlive(): void
    {
        \Illuminate\Support\Facades\Cache::reset();
        \App\Support\ExportConcurrency::acquire(7);

        \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY][7]['beat'] = time() - 250;
        $this->assert(\App\Support\ExportConcurrency::isActive(7) === true, '心跳 250s 前（<300s）仍算活跃');

        \App\Support\ExportConcurrency::touch(7);
        $beat = \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY][7]['beat'];
        $this->assert($beat >= time() - 2, 'touch 把心跳刷新到现在');
    }

    /** 心跳过期 ⇒ 视为死占位，位置可回收（进程被 SIGKILL 后的自愈路径） */
    private function staleEntryIsReclaimed(): void
    {
        \Illuminate\Support\Facades\Cache::reset();
        \App\Support\ExportConcurrency::acquire(8);

        // 边界：正好等于 STALE(300) 时算「还活着」（判据是 >=，不是 >）——
        // 这一秒的边界值就是区分两种写法的唯一用例，缺了它把 >= 改成 > 也不会红。
        \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY][8]['beat'] = time() - 300;
        $this->assert(\App\Support\ExportConcurrency::isActive(8) === true, '心跳正好 300s（边界）仍算活跃');

        \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY][8]['beat'] = time() - 301;
        $this->assert(\App\Support\ExportConcurrency::isActive(8) === false, '心跳过期（>300s）→ 不再活跃');
        $this->assert(\App\Support\ExportConcurrency::progress(8) === null, '过期条目读不出进度');
        $this->assert(\App\Support\ExportConcurrency::acquire(8) === null, '过期后同账号能重新占位（自愈）');
    }

    /** 兼容旧版本的裸时间戳条目 */
    private function legacyTimestampShape(): void
    {
        \Illuminate\Support\Facades\Cache::reset();
        \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY] = [4 => time() - 5];

        $this->assert(\App\Support\ExportConcurrency::isActive(4) === true, '旧形状（未过期）仍算活跃');
        $p = \App\Support\ExportConcurrency::progress(4);
        $this->assert(($p['done'] ?? null) === 0 && ($p['total'] ?? null) === 0, '旧形状的进度字段归一成 0');

        \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY] = [4 => time() - 400];
        $this->assert(\App\Support\ExportConcurrency::isActive(4) === false, '旧形状过期 → 回收');
    }

    /** 认不出来的条目一律当死人（不能因为脏数据把账号永久卡住） */
    private function malformedEntryIsDead(): void
    {
        \Illuminate\Support\Facades\Cache::reset();
        \Illuminate\Support\Facades\Cache::$store[\App\Support\ExportConcurrency::KEY] = [
            6 => 'nonsense',
            7 => ['done' => 1],          // 缺 beat
            8 => ['beat' => 'not-int'],  // beat 类型不对
        ];

        $this->assert(\App\Support\ExportConcurrency::isActive(6) === false, '字符串条目当死人');
        $this->assert(\App\Support\ExportConcurrency::isActive(7) === false, '缺 beat 的条目当死人');
        $this->assert(\App\Support\ExportConcurrency::isActive(8) === false, 'beat 类型不对的条目当死人');
        $this->assert(\App\Support\ExportConcurrency::active() === 0, '脏表被读空');
    }

    /** cap() 的夹取边界 */
    private function capBoundaries(): void
    {
        putenv('EXPORT_MAX_CONCURRENCY=1');
        $this->assert(\App\Support\ExportConcurrency::cap() === 1, 'EV=1 → 1');

        putenv('EXPORT_MAX_CONCURRENCY=99');
        $this->assert(\App\Support\ExportConcurrency::cap() === 8, 'EV=99 → 夹到硬上限 8');

        putenv('EXPORT_MAX_CONCURRENCY=0');
        $fallback = \App\Support\ExportConcurrency::cap();
        $this->assert($fallback >= 1 && $fallback <= 4, 'EV=0（非法）→ 回退到自动取值，且落在 1..4', 'got '.$fallback);

        putenv('EXPORT_MAX_CONCURRENCY=abc');
        $fallback = \App\Support\ExportConcurrency::cap();
        $this->assert($fallback >= 1 && $fallback <= 4, 'EV=abc（非法）→ 回退到自动取值，且落在 1..4', 'got '.$fallback);

        // 只断言「落在 1..4」的话，把非法值当成 1 也能绿 ⇒ 这里钉住它与「未设置」**完全相等**
        // （桩里 workers() 读不到环境 ⇒ 未设置时必走 DEFAULT_CAP）
        putenv('EXPORT_MAX_CONCURRENCY');
        $auto = \App\Support\ExportConcurrency::cap();
        putenv('EXPORT_MAX_CONCURRENCY=0');
        $this->assert(\App\Support\ExportConcurrency::cap() === $auto, 'EV=0（非法）与 EV 未设置走同一条自动取值', 'auto='.$auto);
        putenv('EXPORT_MAX_CONCURRENCY=abc');
        $this->assert(\App\Support\ExportConcurrency::cap() === $auto, 'EV=abc（非法）与 EV 未设置走同一条自动取值', 'auto='.$auto);

        putenv('EXPORT_MAX_CONCURRENCY');
    }

    /**
     * 拿不到短锁（别人正在读改写占位表）时的回退方向。
     *
     * 这是「保守 vs 放行」的岔路口：acquire 那一路必须退回**保守的 'full'**（宁可当场拒掉，
     * 也不能放两笔导出并行跑）；而缓存层本身坏掉那一路才退回 null（见下一个用例）。
     * 桩用 $lockTimeout 模拟「等待 MUTEX_WAIT 秒仍拿不到锁」。
     */
    private function lockTimeoutIsConservative(): void
    {
        putenv('EXPORT_MAX_CONCURRENCY=4');
        \Illuminate\Support\Facades\Cache::reset();
        \Illuminate\Support\Facades\Cache::$lockTimeout = true;

        $this->assert(\App\Support\ExportConcurrency::acquire(3) === 'full', '拿不到锁 → acquire 保守拒绝（full）');
        $this->assert(\App\Support\ExportConcurrency::active() === 0, '拿不到锁 → 活跃数按 0 处理（不崩）');
        $this->assert(\App\Support\ExportConcurrency::progress(3) === null, '拿不到锁 → 读进度返回 null');

        \Illuminate\Support\Facades\Cache::$lockTimeout = false;
        \Illuminate\Support\Facades\Cache::reset();
        $this->assert(\App\Support\ExportConcurrency::acquire(3) === null, '锁恢复后立刻能占位（不残留假拒绝）');
        \App\Support\ExportConcurrency::release(3);
    }

    /** 缓存层坏掉时：宁可丢掉并发保护，也不能拦住用户导出（且只留一行日志） */
    private function cacheFailureDegrades(): void
    {
        \Illuminate\Support\Facades\Cache::reset();
        \Illuminate\Support\Facades\Log::$lines = [];
        \Illuminate\Support\Facades\Cache::$fail = true;

        $this->assert(\App\Support\ExportConcurrency::acquire(1) === null, '缓存不可用 → 占位放行（不拦用户）');
        $this->assert(\App\Support\ExportConcurrency::active() === 0, '缓存不可用 → 活跃数按 0 处理');
        $this->assert(\App\Support\ExportConcurrency::isActive(1) === false, '缓存不可用 → 不声称有人在做');
        \App\Support\ExportConcurrency::touch(1, ['done' => 1]);
        \App\Support\ExportConcurrency::release(1);
        // 判据是**恰好一行**（$warned 那道 latch 的语义）。
        // 桩里现在补了 class_basename()：没有它的时候，Log::warning 那行的实参求值会抛 Error、
        // 被 catch (\Throwable) 吞掉 ⇒ 日志恒为 0 行 ⇒ 这里写「最多一行」就永远绿（实测过）。
        $lines = \Illuminate\Support\Facades\Log::$lines;
        $count = count($lines);
        $this->assert($count === 1, '按张数的循环里日志恰好一行（latch 生效）', 'got '.$count.' 行');
        $this->assert(($lines[0] ?? null) === 'export cache unavailable', '日志内容是「缓存不可用」（还证明 class_basename 可用）', 'got '.var_export($lines[0] ?? null, true));

        \Illuminate\Support\Facades\Cache::reset();
        \Illuminate\Support\Facades\Log::$lines = [];
    }

    private function assert(bool $condition, string $label, string $detail = ''): void
    {
        if ($condition) {
            $this->passed++;
            printf("  PASS  %s\n", $label);

            return;
        }

        $this->failed++;
        printf("  FAIL  %s%s\n", $label, $detail !== '' ? '  → '.$detail : '');
    }
}

$test = new ExportConcurrencyTest();
exit($test->run());
