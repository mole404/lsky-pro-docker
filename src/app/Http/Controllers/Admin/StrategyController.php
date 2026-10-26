<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StrategyRequest;
use App\Services\UserService;
use App\Models\Image;
use App\Models\Strategy;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class StrategyController extends Controller
{
    public function index(Request $request): View
    {
        $keywords = $request->query('keywords');
        $strategies = Strategy::query()->when($keywords, function (Builder $builder, $keywords) {
            $builder->where('name', 'like', "%{$keywords}%")->orWhere('intro', 'like', "%{$keywords}%");
        })->withCount('images')->withSum('images', 'size')->latest()->paginate();

        $strategies->appends(compact('keywords'));

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

        $base = Image::query()->where('strategy_id', $strategy->id);
        if ($snapshot === 0) {
            $snapshot = (int) (clone $base)->max('id');
        }

        $ids = (clone $base)
            ->when($snapshot > 0, fn (Builder $builder) => $builder->where('id', '<=', $snapshot))
            ->when($cursor > 0, fn (Builder $builder) => $builder->where('id', '>', $cursor))
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->all();

        $deleted = 0;
        if ($ids !== []) {
            $service = new UserService();
            // 单张删除的远端 I/O 可能很慢（存储不可达时要等超时）⇒ 按批切分并在接近
            // 执行时间上限前主动收手，剩下的交给下一次请求，不让整个请求被 PHP 掐掉。
            $deadline = microtime(true) + 25;
            foreach (array_chunk($ids, 5) as $chunk) {
                $deleted += $service->deleteImages($chunk, null, 'id', $deleteFiles);
                $cursor = (int) end($chunk);
                if (microtime(true) > $deadline) {
                    break;
                }
            }
        }

        $remaining = (clone $base)
            ->when($snapshot > 0, fn (Builder $builder) => $builder->where('id', '<=', $snapshot))
            ->when($cursor > 0, fn (Builder $builder) => $builder->where('id', '>', $cursor))
            ->count();

        return $this->success('已删除', [
            'deleted' => $deleted,
            'remaining' => $remaining,
            'cursor' => $cursor,
            'snapshot' => $snapshot,
            'done' => $remaining === 0,
        ]);
    }
}
