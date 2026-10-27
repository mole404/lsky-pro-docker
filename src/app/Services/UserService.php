<?php

namespace App\Services;

use App\Models\Image;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class UserService
{
    /**
     * 删除图片以及物理文件，返回已删除数量
     * 考虑到删除磁盘文件、服务器内部请求第三方删除接口比较消耗资源，传入的主键不应过多
     *
     * @param array $keys
     * @param User|null $user 传入用户数据则会根据用户id过滤
     * @param string $field
     * @param bool $deleteFiles 是否同时删除存储里的物理文件（false = 只删记录，用于存储已不可达 / 整桶即将报废的场合）
     * @return int
     */
    public function deleteImages(array $keys, ?User $user = null, string $field = 'id', bool $deleteFiles = true): int
    {
        $count = 0;
        $model = Image::with('user', 'strategy', 'album')->when(! is_null($user), function (Builder $builder) use ($user) {
            $builder->where('user_id', $user->id);
        })->whereIn($field, $keys);

        DB::transaction(function () use ($model, $deleteFiles, &$count) {
            // 受影响用户的图片总数只在该用户的图片全部删完之后算一次：
            // 原实现每删一张就 count() 一次并写回（删 N 张 = 2N 条 SQL，且表还在变小），
            // 批量删除时是主要开销。最终值与逐张重算完全一致。
            $touchedUsers = [];

            /** @var Image $image */
            foreach ($model->cursor() as $image) {
                // 相册图片数量更新
                $image->album?->decrement('image_num');
                // fork：图片删了，它与标签的关联行也要一并清掉。
                // 迁移注释声明「关联行由应用代码显式删除」，这里就是那条规则（SQLite 未启用
                // 外键级联，不显式删就会留下指向已删图片的残留行，无声累积）。
                $image->tags()->detach();

                if ($deleteFiles) {
                    $image->delete();
                } else {
                    // 关掉模型事件 = 不触发 deleting 钩子里的物理文件删除，
                    // 只删数据库记录（钩子见 Image::booted()）。
                    Image::withoutEvents(function () use ($image) {
                        $image->delete();
                    });
                }

                if ($image->user) {
                    $touchedUsers[$image->user->id] = $image->user;
                }

                $count++;
            }

            foreach ($touchedUsers as $touched) {
                $touched->image_num = $touched->images()->count();
                $touched->save();
            }
        });

        return $count;
    }
}
