<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StrategyRequest;
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
}
