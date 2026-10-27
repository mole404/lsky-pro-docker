<?php

namespace App\Services;

use App\Models\Album;
use App\Models\Image;
use App\Models\Strategy;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use League\Flysystem\Filesystem as Flysystem;

/**
 * 批量清空某个存储策略内图片的删除器（后台「清空图片」专用）。
 *
 * 与 UserService::deleteImages 的区别在两件事上：
 *
 * 1. 顺序。Image 的 deleting 钩子是「先删远端文件、再删数据库行」，单张删除够用；但批量删除
 *    一旦把整批包进事务，中途任何一张失败都会把数据库回滚，而已经删掉的物理文件回不来
 *    （记录还在、文件没了 ⇒ 前台 404、且不可恢复）。这里刻意分两阶段：事务里只做数据库，
 *    提交成功之后才去删文件。回滚只会回数据库，最坏情况是留下几个没人引用的孤儿对象，
 *    可枚举、可清理。
 *
 * 2. 可见性。物理文件删除失败不再被静默吞掉：逐张统计成功/失败，失败写 warning 日志
 *    （含 image_id 与 pathname），并原样回给前端，避免「勾了删文件、其实一个没删还报成功」。
 */
class ImagePurgeService
{
    /** @var array<int, Flysystem> 每个策略只建一次客户端（S3/OSS 客户端要重新握手，很贵） */
    private array $filesystems = [];

    /**
     * 删除一批图片，返回记录数与物理文件数。
     *
     * @param  Collection<int, Image>|array<int, Image>  $images  已查出 id/user_id/album_id/strategy_id/md5/sha1/pathname/key 的模型
     * @return array{records: int, files_deleted: int, files_failed: int}
     */
    public function purge($images, bool $deleteFiles): array
    {
        $images = collect($images)->filter()->values();

        if ($images->isEmpty()) {
            return ['records' => 0, 'files_deleted' => 0, 'files_failed' => 0];
        }

        $ids = $images->pluck('id')->all();

        // 加锁顺序固定（用户 id 升序），减少与上传路径或另一路清空互相死锁的机会。
        $byUser = $images->filter(fn (Image $image) => ! is_null($image->user_id))
            ->groupBy('user_id')
            ->sortKeys();
        $byAlbum = $images->filter(fn (Image $image) => ! is_null($image->album_id))
            ->groupBy('album_id')
            ->sortKeys();

        $records = DB::transaction(function () use ($ids, $byUser, $byAlbum) {
            // 中间表没有外键级联，必须显式清（与 UserService::deleteImages 同口径）。
            DB::table('image_tag')->whereIn('image_id', $ids)->delete();

            foreach ($byAlbum as $albumId => $rows) {
                Album::query()->whereKey($albumId)->decrement('image_num', $rows->count());
            }

            // 走查询构造器批量删 = 不触发 Eloquent 事件，物理文件留到事务提交后再处理。
            $deleted = Image::query()->whereIn('id', $ids)->delete();

            foreach ($byUser as $userId => $rows) {
                if (is_null($userId)) {
                    continue;
                }

                // 锁住用户行再重算：上传路径是原子的 increment('image_num')，
                // 「读出来再写回去」没有锁就会丢更新。
                $user = User::query()->whereKey($userId)->lockForUpdate()->first();
                if ($user) {
                    $user->image_num = $user->images()->count();
                    $user->save();
                }
            }

            return $deleted;
        });

        $filesDeleted = 0;
        $filesFailed = 0;
        $firstError = null;

        if ($deleteFiles) {
            [$filesDeleted, $filesFailed, $firstError] = $this->deleteFiles($images);

            if ($filesFailed > 0) {
                Log::warning('清空存储策略：部分物理文件删除失败', [
                    'strategy_id' => $images->first()->strategy_id,
                    'failed'      => $filesFailed,
                    'deleted'     => $filesDeleted,
                    'error'       => $firstError,
                ]);
            }
        }

        // 只删记录的模式下不碰文件，但缓存必须清：否则开了原图保护的分组在 TTL 内
        // 还能从 image_{key} 缓存里把已删图片读出来。
        if (! $deleteFiles) {
            foreach ($images as $image) {
                Cache::forget("image_{$image->key}");
            }
        }

        return [
            'records'       => $records,
            'files_deleted' => $filesDeleted,
            'files_failed'  => $filesFailed,
            // 只回第一条原因：反复贴同一句 SDK 报错没有意义，够定位就行。
            'first_error'   => $firstError,
        ];
    }

    /**
     * 事务提交后删物理文件；同样的 md5+sha1 在**同一策略内**还有别的记录时跳过（文件还被引用）。
     *
     * @return array{0: int, 1: int, 2: string|null} [成功数, 失败数, 首条错误原因]
     */
    private function deleteFiles(Collection $images): array
    {
        $deleted = 0;
        $failed = 0;
        $firstError = null;

        foreach ($images as $image) {
            $stillReferenced = Image::query()
                ->where('strategy_id', $image->strategy_id)
                ->where('md5', $image->md5)
                ->where('sha1', $image->sha1)
                ->exists();

            if (! $stillReferenced) {
                try {
                    $this->filesystem($image->strategy_id)->delete($image->pathname);
                    @unlink(public_path($image->getThumbnailPathname()));
                    $deleted++;
                } catch (\Throwable $e) {
                    $failed++;
                    $firstError ??= $e->getMessage();
                    Log::warning('清空存储策略：删除物理文件失败', [
                        'image_id'    => $image->id,
                        'strategy_id' => $image->strategy_id,
                        'pathname'    => $image->pathname,
                        'error'       => $e->getMessage(),
                    ]);
                }
            }

            Cache::forget("image_{$image->key}");
        }

        return [$deleted, $failed, $firstError];
    }

    /**
     * 按策略取（并记住）文件系统客户端；超时压到 5 秒，避免存储半死不活时一张图拖死整个请求。
     */
    private function filesystem(int $strategyId): Flysystem
    {
        if (! isset($this->filesystems[$strategyId])) {
            $strategy = Strategy::query()->find($strategyId);

            if (is_null($strategy)) {
                throw new \RuntimeException("存储策略 {$strategyId} 不存在，无法删除物理文件");
            }

            $this->filesystems[$strategyId] = new Flysystem(
                (new ImageService())->getAdapter($strategy, ['connect_timeout' => 5, 'timeout' => 5])
            );
        }

        return $this->filesystems[$strategyId];
    }

    /** 清掉记住的客户端（长任务的守护场景下按批释放用；当前请求内不调用）。 */
    public function flushFilesystems(): void
    {
        $this->filesystems = [];
    }
}
