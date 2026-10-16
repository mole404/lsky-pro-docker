<?php

namespace App\Http\Controllers\User;

use App\Enums\UserConfigKey;
use App\Http\Controllers\Controller;
use App\Http\Requests\UserSettingRequest;
use App\Models\User;
use App\Support\StorageUsage;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\View\View;

class UserController extends Controller
{
    public function dashboard(): View
    {
        /** @var User $user */
        $user = Auth::user();
        $configs = $user->group->configs;
        $strategies = $user->group->strategies()->get();
        // 每个存储策略各占多少：一次分组聚合同时给出总量与分段，替掉视图里对
        // use_capacity 访问器的 4 次重复聚合（数值完全一样，都是同一张表的 SUM(size)）。
        // 策略名优先用上面已取到的集合；策略被移出当前组时会缺，StorageUsage 内部只对缺的那些补一次
        // 查询（侧栏那份不传名字，等于一次查全，见 StorageUsage::forUser）。
        $storage = StorageUsage::forUser($user, $strategies->pluck('name', 'id')->all());
        return view('user.dashboard', compact('strategies', 'configs', 'user', 'storage'));
    }

    public function settings(): View
    {
        /** @var User $user */
        $user = Auth::user();

        // 批量导出卡片的筛选项数量。全部是只读聚合查询、不写库、不做缓存：
        // 图片数随时在变，设置页每次打开都要显示当下的真实数量。
        // 归属一律限定在自己的图上（未分类 = album_id 为空）。
        $uncategorizedNum = $user->images()->whereNull('album_id')->count();

        $strategyCounts = DB::table('images')
            ->where('user_id', $user->id)
            ->selectRaw('strategy_id, count(*) as total')
            ->groupBy('strategy_id')
            ->pluck('total', 'strategy_id');

        $tagCounts = DB::table('image_tag')
            ->join('images', 'images.id', '=', 'image_tag.image_id')
            ->where('images.user_id', $user->id)
            ->selectRaw('image_tag.tag_id as tag_id, count(*) as total')
            ->groupBy('image_tag.tag_id')
            ->pluck('total', 'tag_id');

        // 每个上传日各有多少张：给导出卡片的月历用 —— 前端据此把「哪天存过图片」直接标出来，
        // 用户不用去猜哪天空着。键是 Y-m-d（与 created_at 落库的应用时区一致），值是张数。
        // 取日期的写法按驱动分流，避免 substr() 在 pgsql 上不存在：
        $dayExpression = DB::connection()->getDriverName() === 'pgsql'
            ? "to_char(created_at, 'YYYY-MM-DD')"
            : 'substr(created_at, 1, 10)';

        $dayCounts = DB::table('images')
            ->where('user_id', $user->id)
            ->selectRaw("{$dayExpression} as day, count(*) as total")
            ->groupBy('day')
            ->pluck('total', 'day')
            ->toArray();

        return view('user.settings', compact('uncategorizedNum', 'strategyCounts', 'tagCounts', 'dayCounts'));
    }

    public function update(UserSettingRequest $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        $user->name = $request->validated('name');
        $user->url = $request->validated('url') ?: '';
        $user->configs = $user->configs->merge(collect($request->validated('configs'))->transform(function ($value) {
            return (int)$value;
        }));
        if ($password = $request->validated('password')) {
            $user->forceFill([
                'password' => Hash::make($password),
                'remember_token' => Str::random(60),
            ]);

            event(new PasswordReset($user));
        }
        $user->save();
        return $this->success('保存成功');
    }

    public function setStrategy(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        if (! $strategy = $user->group->strategies()->find($request->id)) {
            return $this->fail('没有找到该策略');
        }
        $user->update(['configs->'.UserConfigKey::DefaultStrategy => $strategy->id]);
        return $this->success('设置成功');
    }
}
