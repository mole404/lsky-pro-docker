<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StrategyRequest;
use App\Services\ImagePurgeService;
use App\Models\Image;
use App\Models\Strategy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class StrategyController extends Controller
{
    public function index(Request $request): View|RedirectResponse
    {
        $keywords = $request->query('keywords');
        $strategies = Strategy::query()->when($keywords, function (Builder $builder, $keywords) {
            $builder->where('name', 'like', "%{$keywords}%")->orWhere('intro', 'like', "%{$keywords}%");
        })->withCount('images')->withSum('images', 'size')->latest()->paginate();

        $strategies->appends(compact('keywords'));

        // ?page= 越界（删到最后一页不足、旧书签）时回到最后一页，别停在空列表上。
        if ($redirect = $this->redirectOutOfRangePage($strategies)) {
            return $redirect;
        }

        return view('admin.strategy.index', compact('strategies'));
    }

    public function add(): View
    {
        return view('admin.strategy.add');
    }

    public function edit(Request $request): View
    {
        /** @var Strategy $strategy */
        $strategy = Strategy::query()->findOrFail($request->route('id'));
        return view('admin.strategy.edit', compact('strategy'));
    }

    public function create(StrategyRequest $request): Response
    {
        $validated = $request->validated();
        $strategy = new Strategy($validated);
        DB::transaction(function () use ($strategy, $validated) {
            $strategy->save();
            $strategy->groups()->attach($validated['groups'] ?? []);
        });
        return $this->success('创建成功');
    }

    public function update(StrategyRequest $request): Response
    {
        $validated = $request->validated();
        /** @var Strategy $strategy */
        $strategy = Strategy::query()->findOrFail($request->route('id'));
        $strategy->fill($request->validated());
        DB::transaction(function () use ($strategy, $validated) {
            $strategy->save();
            $strategy->groups()->sync($validated['groups'] ?? []);
        });
        return $this->success('保存成功');
    }

    public function delete(Request $request): Response
    {
        /** @var Strategy $strategy */
        if ($strategy = Strategy::query()->find($request->route('id'))) {
            $imagesCount = 0;
            DB::transaction(function () use ($strategy, &$imagesCount) {
                // 必须在事务内再查一次图片数量：前端的图片数是页面渲染时的快照，
                // 用户停留在删除确认框期间可能刚好有人往该策略上传了图片，
                // 只有进事务后复查才能挡住这种竞态。
                $imagesCount = $strategy->images()->count();
                if ($imagesCount > 0) {
                    // 有图片时直接结束事务，不写入任何数据，避免留下半截状态
                    return;
                }
                $strategy->delete();
            });
            if ($imagesCount > 0) {
                return $this->fail("该存储策略内已有 {$imagesCount} 张图片，请先删除该存储策略内的所有图片");
            }
        }
        return $this->success('删除成功');
    }

    /**
     * 清空某个存储策略内的全部图片（为下线该策略做准备）。
     *
     * 做成「按 id 游标分批」而不是一次删完：删除物理文件要访问远端存储，几百张放在
     * 单个请求里会撞 PHP 的执行时间上限；分批后前端能显示进度、随时中断、从断点继续。
     * 第一次请求时用当前 max(id) 做快照，之后只删 ≤ 快照的图 —— 否则一边清、别人一边
     * 往该策略上传，删除会永远追不上新图。
     */
    public function purgeImages(Request $request): Response
    {
        // 输入式确认：前端弹窗要求手打「确认删除」，后端再核一次，避免误触发。
        if ($request->input('confirm') !== '确认删除') {
            return $this->fail('请输入「确认删除」后继续');
        }

        /** @var Strategy|null $strategy */
        $strategy = Strategy::query()->find($request->route('id'));
        if (is_null($strategy)) {
            return $this->fail('不存在的存储策略');
        }

        $deleteFiles = $request->boolean('delete_files');
        // 删远端文件的模式每批小一些（单张失败可能要等存储超时），只删记录可以放大批次。
        $limit = (int) $request->input('limit', $deleteFiles ? 20 : 200);
        $limit = max(1, min(200, $limit));
        $cursor = max(0, (int) $request->input('cursor', 0));
        $snapshot = max(0, (int) $request->input('snapshot', 0));

        if ($snapshot > 0 && $cursor > $snapshot) {
            return $this->fail('游标参数不合法');
        }

        // 同一个策略同时只允许一路清空：两个标签页同时点会互抢行锁，进度也会各算各的。
        // 标准驱动（file/database/array/redis）都实现了 LockProvider，但型别对不代表运行期不会抛：
        // database 驱动没建 cache_locks 表时取锁会抛 QueryException，array 驱动的锁出了进程就不算数。
        // 所以拿不到锁对象时退化成 Cache::add()（file 驱动的 add 走独占文件锁，同样是原子的），
        // 宁可少一层互斥也不要整个功能 500。
        $lockKey = "purge-strategy:{$strategy->id}";
        $lock = null;
        $acquired = false;

        try {
            $lock = Cache::lock($lockKey, 600);
            $acquired = $lock->get();
        } catch (\Throwable $e) {
            $lock = null;
            $acquired = Cache::add($lockKey, 1, 600);
        }

        if (! $acquired) {
            return $this->fail('该存储策略正在清空中，请等这一次跑完或刷新页面查看结果');
        }

        try {
            return $this->purgeBatch($strategy, $deleteFiles, $limit, $cursor, $snapshot);
        } finally {
            $lock ? $lock->release() : Cache::forget($lockKey);
        }
    }

    /**
     * 跑一批清空。文件删除在事务提交之后（见 ImagePurgeService 的注释），
     * 因此单批失败只会回滚数据库，不会出现「记录回来了、文件已经删了」。
     */
    private function purgeBatch(Strategy $strategy, bool $deleteFiles, int $limit, int $cursor, int $snapshot): Response
    {
        @set_time_limit(90);

        $base = Image::query()->where('strategy_id', $strategy->id);

        if ($snapshot === 0) {
            $snapshot = (int) (clone $base)->max('id');
        }

        $images = (clone $base)
            ->when($snapshot > 0, fn (Builder $builder) => $builder->where('id', '<=', $snapshot))
            ->when($cursor > 0, fn (Builder $builder) => $builder->where('id', '>', $cursor))
            ->orderBy('id')
            ->limit($limit)
            // 只取用得到的列：删文件、清缓存、重算计数都不需要关联（也顺带没有了 N+1）。
            // ⚠️ `pathname` 不是数据库列，是 Image 上的访问器（= path + '/' + name），
            // 所以这里必须取 `path` 和 `name` —— 少一个，访问器就拼出空串，
            // 删除时变成「删策略根目录」，报 Unable to delete file located at: …/（空文件名）。
            ->get(['id', 'user_id', 'album_id', 'strategy_id', 'md5', 'sha1', 'path', 'name', 'key']);

        $service = new ImagePurgeService();
        $deleted = 0;
        $filesDeleted = 0;
        $filesFailed = 0;
        $firstFileError = null;
        // 单张远端删除有 5 秒超时（ImagePurgeService），这里再按批给一个总预算：
        // 到点就收手，剩下的交给下一次请求，别让整个请求撞上 PHP/nginx 的时限。
        $deadline = microtime(true) + 20;

        foreach ($images->chunk(5) as $chunk) {
            $result = $service->purge($chunk->values(), $deleteFiles);
            $deleted += $result['records'];
            $filesDeleted += $result['files_deleted'];
            $filesFailed += $result['files_failed'];
            $firstFileError ??= $result['first_error'] ?? null;
            $cursor = (int) $chunk->last()->id;

            if (microtime(true) > $deadline) {
                break;
            }
        }

        // 进度按「游标之后还剩多少」算；这个区间空了就按快照全量复核一次 ——
        // 否则「游标之后没图、游标之前还有残留」会被误判成已清空。
        $remaining = (clone $base)
            ->when($snapshot > 0, fn (Builder $builder) => $builder->where('id', '<=', $snapshot))
            ->where('id', '>', $cursor)
            ->count();

        if ($remaining === 0) {
            $remaining = (clone $base)
                ->when($snapshot > 0, fn (Builder $builder) => $builder->where('id', '<=', $snapshot))
                ->count();

            if ($remaining > 0) {
                // 还有残留但在游标之前 ⇒ 回到起点再扫一遍（正常情况下不会走到这里）。
                $cursor = 0;
            }
        }

        return $this->success('已删除', [
            'deleted'       => $deleted,
            'files_deleted' => $filesDeleted,
            'files_failed'  => $filesFailed,
            'error'         => $firstFileError,
            'remaining'     => $remaining,
            'cursor'        => $cursor,
            'snapshot'      => $snapshot,
            'done'          => $remaining === 0,
        ]);
    }
}
