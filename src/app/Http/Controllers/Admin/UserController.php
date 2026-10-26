<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UserRequest;
use App\Models\User;
use App\Support\Like;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\View\View;

class UserController extends Controller
{
    public function index(Request $request): View|RedirectResponse
    {
        $status = $request->query('status');
        $keywords = $request->query('keywords');
        $users = User::query()->when($status > -1, function (Builder $builder) use ($status) {
            $builder->where('status', $status);
        })->when($keywords, function (Builder $builder, $keywords) {
            // 两个 like 必须包进闭包：平铺时拼出来的 SQL 是
            //   status = ? and name like ? or email like ?
            // 而 AND 的优先级高于 OR ⇒ 邮箱那一支整体绕过 status 筛选
            // （选「正常」时冻结用户照样出现在列表里）。包一层后是
            //   status = ? and (name like ? or email like ?)
            // 与 Admin\ImageController 里关键字组的写法一致。
            $builder->where(function (Builder $q) use ($keywords) {
                Like::whereContains($q, 'name', $keywords);
                Like::orWhereContains($q, 'email', $keywords);
            });
        })->with('group')->withSum('images', 'size')->latest()->paginate();
        $users->getCollection()->each(function (User $user) {
            $user->group->setVisible(['name']);
        });
        $statuses = [-1 => '全部', 1 => '正常', 0 => '冻结'];

        $users->appends(compact('status', 'keywords'));

        // ?page= 越界（删到最后一页不足、旧书签）时回到最后一页，别停在空列表上。
        if ($redirect = $this->redirectOutOfRangePage($users)) {
            return $redirect;
        }

        return view('admin.user.index', compact('users', 'statuses'));
    }

    public function edit(Request $request): View
    {
        $user = User::query()->findOrFail($request->route('id'));
        return view('admin.user.edit', compact('user'));
    }

    public function update(UserRequest $request): Response
    {
        /** @var User $user */
        $user = User::query()->findOrFail($request->route('id'));
        $validated = $request->validated();

        if (! empty($validated['password'])) {
            $user->forceFill([
                'password' => Hash::make($validated['password']),
                'remember_token' => Str::random(60),
            ]);

            event(new PasswordReset($user));
        }

        unset($validated['password']);
        unset($validated['password_confirmation']);
        $user->fill($validated);
        $user->group_id = $validated['group_id'];

        if (!$user->save()) {
            return $this->fail('保存失败');
        }
        return $this->success('保存成功');
    }

    public function delete(Request $request): Response
    {
        /** @var User $user */
        if ($user = User::query()->find($request->route('id'))) {
            DB::transaction(function () use ($user) {
                $user->images()->update(['user_id' => null]);
                $user->albums()->delete();
                // fork：标签与其关联行一并清理（SQLite 未启用外键级联，级联删除不可靠）。
                // 这些图已归为游客图片，它们身上的标签随属主一起消失。
                DB::table('image_tag')->whereIn('tag_id', $user->tags()->pluck('id'))->delete();
                $user->tags()->delete();
                $user->delete();
            });
        }
        return $this->success('删除成功');
    }
}
