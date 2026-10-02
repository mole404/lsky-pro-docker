<?php

namespace App\Http\Controllers\User;

use App\Enums\ImagePermission;
use App\Http\Controllers\Controller;
use App\Http\Requests\ImageRenameRequest;
use App\Http\Requests\TagRequest;
use App\Models\Album;
use App\Models\Image;
use App\Models\Tag;
use App\Models\User;
use App\Services\UserService;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class ImageController extends Controller
{
    public function index(): View
    {
        return view('user.images');
    }

    public function images(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();

        $images = $user->images()->filter($request)->with('group', 'strategy', 'tags')->paginate(40);
        $images->getCollection()->each(function (Image $image) {
            // 图片宽高过小会导致前端排版异常
            $image->width = max($image->width, 200);
            $image->height = max($image->height, 200);

            $image->human_date = $image->created_at->diffForHumans();
            $image->date = $image->created_at->format('Y-m-d H:i:s');
            // fork 新增：列表也要带 tags —— 图片墙的卡片角标要显示每张图的标签。
            // 逐个 setVisible 是为了去掉 belongToMany 附带的 pivot（image_id/tag_id 前端用不到）。
            $image->tags->each(function (Tag $tag) {
                $tag->setVisible(['id', 'name']);
            });
            $image->append(['url', 'thumb_url', 'filename', 'links'])->setVisible([
                'id', 'filename', 'url', 'thumb_url', 'human_date', 'date', 'size', 'width', 'height', 'links', 'tags'
            ]);
        });
        return $this->success('success', compact('images'));
    }

    public function image(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        /** @var Image $image */
        if (!$image = $user->images()->find($request->route('id'))) {
            return $this->fail('未找到该图片');
        }
        $image->strategy?->setVisible(['name']);
        $image->album?->setVisible(['name']);
        // fork 新增：详情弹窗要显示/编辑这张图的标签
        $image->load('tags');
        $image->tags->each(function (Tag $tag) {
            $tag->setVisible(['id', 'name']);
        });
        $image->append(['url', 'thumb_url', 'filename', 'links'])->setVisible([
            'id', 'filename', 'origin_name', 'url', 'thumb_url', 'width', 'height', 'size', 'mimetype', 'md5', 'sha1',
            'permission', 'strategy', 'album', 'uploaded_ip', 'links', 'created_at', 'tags'
        ]);
        return $this->success('success', compact('image'));
    }

    public function permission(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        $permission = $request->input('permission');
        $permissions = ['public' => ImagePermission::Public, 'private' => ImagePermission::Private];
        if (!in_array($permission, array_keys($permissions))) {
            return $this->fail('设置失败');
        }
        $user->images()->whereIn('id', (array) $request->input('ids'))->update([
            'permission' => $permissions[$permission],
        ]);
        return $this->success('设置成功');
    }

    public function rename(ImageRenameRequest $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        /** @var Image $image */
        if ($image = $user->images()->find($request->input('id'))) {
            $image->alias_name = $request->input('name');
            $image->save();
        }

        return $this->success('重命名成功', $image->only('id', 'filename'));
    }

    public function movement(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        DB::transaction(function () use ($user, $request) {
            /** @var null|Album $album */
            $album = $user->albums()->find((int) $request->input('id'));
            $user->images()->whereIn('id', $request->input('selected'))->update([
                'album_id' => $album->id ?? null,
            ]);
            if ($album) {
                $album->image_num = $album->images()->count();
                $album->save();
            }
            if ($albumId = (int) $request->input('album_id')) {
                /** @var Album $originAlbum */
                $originAlbum = $user->albums()->find($albumId);
                $originAlbum->image_num = $originAlbum->images()->count();
                $originAlbum->save();
            }
        });
        return $this->success('移动成功');
    }

    /* ------------------------------------------------------------------
     * fork 新增：按用户隔离的图片标签
     * 所有操作都只作用于 auth()->user() 自己的数据；跨用户读写不可能。
     * ------------------------------------------------------------------ */

    public function tags(): Response
    {
        /** @var User $user */
        $user = Auth::user();
        // 只列自己的标签，并带上每个标签的使用数量
        $tags = $user->tags()->withCount('images')->latest()->get();
        $tags->each(function (Tag $tag) {
            $tag->setVisible(['id', 'name', 'images_count']);
        });
        return $this->success('success', compact('tags'));
    }

    public function createTag(TagRequest $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        $name = trim((string) $request->validated()['name']);
        // 预检重名（tags 表另有 unique(user_id, name) 兜底）
        if ($user->tags()->where('name', $name)->exists()) {
            return $this->fail('标签已存在');
        }
        /** @var Tag $tag */
        $tag = $user->tags()->create(['name' => $name]);
        return $this->success('创建成功', $tag->only('id', 'name'));
    }

    public function updateTag(TagRequest $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        /** @var Tag|null $tag */
        $tag = $user->tags()->find($request->route('id'));
        if (is_null($tag)) {
            return $this->fail('不存在的标签');
        }
        $name = trim((string) $request->validated()['name']);
        if ($user->tags()->where('name', $name)->where('id', '<>', $tag->id)->exists()) {
            return $this->fail('标签已存在');
        }
        $tag->name = $name;
        $tag->save();
        return $this->success('修改成功', $tag->only('id', 'name'));
    }

    public function deleteTag(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        /** @var Tag|null $tag */
        $tag = $user->tags()->find($request->route('id'));
        if (is_null($tag)) {
            return $this->fail('不存在的标签');
        }
        DB::transaction(function () use ($tag) {
            // SQLite 未启用 PRAGMA foreign_keys、级联不可靠 —— 关联行必须显式删除
            $tag->images()->detach();
            $tag->delete();
        });
        return $this->success('删除成功');
    }

    public function tagImages(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();

        $attach = $this->normalizeIds($request->input('tags'));
        $detach = $this->normalizeIds($request->input('remove_tags'));
        // 同一个标签同时出现在「加」与「移除」里时，以移除为准
        $attach = array_values(array_diff($attach, $detach));

        $imageIds = $this->normalizeIds($request->input('ids'));
        if (empty($imageIds)) {
            return $this->fail('请选择图片');
        }

        // 安全红线 ①：先 whereIn，再用 user_id 约束一次确认图片确实属于当前用户；
        // 只要有任意一张不属于自己就整体拒绝、绝不落库。
        $ownedImageIds = Image::query()
            ->where('user_id', $user->id)
            ->whereIn('id', $imageIds)
            ->pluck('id')
            ->all();
        if (count($ownedImageIds) !== count($imageIds)) {
            return $this->fail('图片不存在');
        }

        // 安全红线 ②：涉及的标签也必须全是自己的，否则整体拒绝。
        $tagIds = array_values(array_unique(array_merge($attach, $detach)));
        if ($tagIds) {
            $ownedTagIds = $user->tags()->whereIn('id', $tagIds)->pluck('id')->all();
            if (count($ownedTagIds) !== count($tagIds)) {
                return $this->fail('标签不存在');
            }
        }

        DB::transaction(function () use ($user, $tagIds, $attach, $detach, $ownedImageIds) {
            foreach ($user->tags()->whereIn('id', $tagIds)->get() as $tag) {
                /** @var Tag $tag */
                if (in_array($tag->id, $attach, true)) {
                    // 幂等新增，避免复合主键冲突
                    $tag->images()->syncWithoutDetaching($ownedImageIds);
                }
                if (in_array($tag->id, $detach, true)) {
                    $tag->images()->detach($ownedImageIds);
                }
            }
        });

        return $this->success('设置成功');
    }

    /**
     * 把请求里的 id 列表规整成「去重后的正整数数组」。
     *
     * @param  mixed  $ids
     * @return int[]
     */
    private function normalizeIds($ids): array
    {
        return array_values(array_unique(array_filter(
            array_map('intval', (array) $ids),
            fn ($id) => $id > 0
        )));
    }

    public function delete(Request $request): Response
    {
        /** @var User $user */
        $user = Auth::user();
        (new UserService())->deleteImages($request->all() ?: [], $user);
        return $this->success('删除成功');
    }
}
