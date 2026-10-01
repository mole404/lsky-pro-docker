<?php

namespace App\Models;

use App\Enums\GroupConfigKey;
use App\Enums\ImagePermission;
use App\Services\ImageService;
use App\Utils;
use Illuminate\Support\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use League\Flysystem\Filesystem;

/**
 * @property int $id
 * @property int $user_id
 * @property int $album_id
 * @property int $group_id
 * @property int $strategy_id
 * @property string $key
 * @property string $path
 * @property string $name
 * @property string $pathname
 * @property string $origin_name
 * @property string $alias_name
 * @property string $filename
 * @property float $size
 * @property string $mimetype
 * @property string $extension
 * @property string $md5
 * @property string $sha1
 * @property integer $width
 * @property integer $height
 * @property string $url
 * @property string $thumb_url
 * @property Collection $links
 * @property int $permission
 * @property boolean $is_unhealthy
 * @property string $uploaded_ip
 * @property Carbon $updated_at
 * @property Carbon $created_at
 * @property-read User $user
 * @property-read Album $album
 * @property-read Group $group
 * @property-read Strategy $strategy
 * @property-read Collection $tags
 */
class Image extends Model
{
    use HasFactory;

    protected $fillable = [
        'key',
        'path',
        'name',
        'origin_name',
        'alias_name',
        'size',
        'mimetype',
        'extension',
        'md5',
        'sha1',
        'width',
        'height',
        'permission',
        'is_unhealthy',
        'uploaded_ip',
    ];

    protected $hidden = [
        'user_id',
        'album_id',
        'group_id',
        'strategy_id',
    ];

    protected $casts = [
        'id' => 'integer',
        'user_id' => 'integer',
        'album_id' => 'integer',
        'group_id' => 'integer',
        'strategy_id' => 'integer',
        'width' => 'integer',
        'height' => 'integer',
        'size' => 'float',
        'is_unhealthy' => 'bool',
        'permission' => 'integer',
    ];

    protected ?Filesystem $filesystem = null;

    protected static function booted()
    {
        static::creating(function (self $image) {
            $image->key = $image->generateKey();
        });

        static::deleting(function (self $image) {
            // TODO 检测是否启用了队列，放置队列中异步删除
            // 在当前图片所属的策略中是否存在其他相同 md5 和 sha1 的记录，没有则可以删除物理文件
            if (!static::query()
                ->where('strategy_id', $image->strategy_id)
                ->where('id', '<>', $image->id)
                ->where('md5', $image->md5)
                ->where('sha1', $image->sha1)
                ->exists()
            ) {
                // 删除本地缓存文件
                try {
                    // 删除物理文件
                    $image->filesystem()->delete($image->pathname);
                    @unlink(public_path($image->getThumbnailPathname()));
                    // 删除缓存
                    Cache::forget("image_{$image->key}");
                } catch (\Throwable $e) {
                    Utils::e($e, '删除物理文件时发生异常');
                }
            }
        });
    }

    public function scopeFilter(Builder $builder, Request $request)
    {
        return $builder->when($request->query('order') ?: 'newest', function (Builder $builder, $order) {
            switch ($order) {
                case 'earliest':
                    $builder->orderBy('created_at');
                    break;
                case 'utmost':
                    $builder->orderByDesc('size');
                    break;
                case 'least':
                    $builder->orderBy('size');
                    break;
                default:
                    $builder->latest();
            }
        })->when($request->query('permission') ?: 'all', function (Builder $builder, $permission) {
            switch ($permission) {
                case 'public':
                    $builder->where('permission', ImagePermission::Public);
                    break;
                case 'private':
                    $builder->where('permission', ImagePermission::Private);
                    break;
            }
        })->when($request->query('keyword'), function (Builder $builder, $keyword) {
            // fork 有意修复（已偏离上游）：两个 like 必须包进闭包，不能让 orWhere 平铺进整条查询。
            // 不加括号时这两个条件是「平铺的 OR」：
            //   user_id = X AND album_id IS NULL AND origin_name LIKE … OR alias_name LIKE …
            // alias 那一支因此不受 user_id / album_id / permission 约束 —— 能搜出他人（含 private）图片。
            // 实测（scratch/f1_verify.php + Laravel 9.52.21）：Eloquent\Builder::callScope() 会在
            // 「命名作用域」调用路径（$user->images()->filter($request)）自动把这批 where 收成一个
            // Nested 组，所以这条线上跨用户越权被框架挡住了；但同一个 scope 只要被直接调用
            // （$model->scopeFilter($builder, $request)）就真会跨用户拿到 private 图，而且
            // album_id / permission 过滤在**两条路径**上都会被 OR 逃逸（别的相册的图混进来、
            // permission=private 时公开图混进来）。包闭包后：
            //   user_id = X AND album_id IS NULL AND (origin_name LIKE … OR alias_name LIKE …)
            // 不再依赖框架内部的自动分组行为；未命中越权分支时结果集与改前完全一致。
            $builder->where(function (Builder $query) use ($keyword) {
                $query->where('origin_name', 'like', "%{$keyword}%")
                    ->orWhere('alias_name', 'like', "%{$keyword}%");
            });
        })->when((int) $request->query('album_id'), function (Builder $builder, $albumId) {
            $builder->where('album_id', $albumId);
        }, function (Builder $builder) {
            $builder->whereNull('album_id');
        })->when($request->query('tags'), function (Builder $builder, $tags) {
            // fork 新增：按标签筛选，参数形状 `tags[]=<id>&tags[]=<id>`。
            // 语义是 **AND**：传入的每一个标签都必须命中（N 个 whereHas 各自是一段
            // exists 子查询、彼此被 AND 连接，正好就是「都要有」）。本库只有四百来张图，
            // 这里选最直白的写法，不做子查询优化。
            // 注意：标签按用户隔离（写入侧强制），这里无需再按 user_id 过滤 —— 外层查询来自
            // $user->images()（或 Image 上的 user 约束），而 image_tag 只会把「某用户的图」
            // 连到「同一个用户的标签」上（写入侧强制），所以拿别人的 tag id 只会得到空集。
            foreach (array_unique(array_filter((array) $tags)) as $tagId) {
                if ((int) $tagId <= 0) {
                    continue;
                }
                $builder->whereHas('tags', function (Builder $query) use ($tagId) {
                    $query->where('tags.id', (int) $tagId);
                });
            }
        });
    }

    public function filename(): Attribute
    {
        return new Attribute(fn() => $this->alias_name ?: $this->origin_name);
    }

    public function pathname(): Attribute
    {
        $path = $this->path ? "{$this->path}/" : '';
        return new Attribute(fn() => "{$path}{$this->name}");
    }

    public function url(): Attribute
    {
        return new Attribute(function () {
            // 是否启用原图保护功能
            if ($this->group?->configs->get(GroupConfigKey::IsEnableOriginalProtection)) {
                $url = asset("{$this->key}.{$this->extension}");
            } else {
                $url = rtrim($this->strategy?->configs->get('url'), '/').'/'.ltrim($this->pathname, '/');
            }

            // 拼接图片 url
            return $url.($this->strategy?->configs->get('queries') ?: '');
        });
    }

    public function thumbUrl(): Attribute
    {
        return new Attribute(function () {
            $pathname = $this->getThumbnailPathname();

            // 没有缩略图则返回原图
            if (! file_exists(public_path($pathname))) {
                return $this->url;
            }

            return asset($pathname);
        });
    }

    public function links(): Attribute
    {
        return new Attribute(fn() => collect([
            'url' => $this->url,
            'html' => "&lt;img src=\"{$this->url}\" alt=\"{$this->origin_name}\" title=\"{$this->origin_name}\" /&gt;",
            'bbcode' => "[img]{$this->url}[/img]",
            'markdown' => "![{$this->origin_name}]({$this->url})",
            'markdown_with_link' => "[![{$this->origin_name}]({$this->url})]({$this->url})",
            'thumbnail_url' => $this->thumb_url,
        ]));
    }

    public function filesystem(): Filesystem
    {
        if (is_null($this->filesystem)) {
            $this->filesystem = new Filesystem((new ImageService())->getAdapter($this->strategy));
        }
        return $this->filesystem;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    public function album(): BelongsTo
    {
        return $this->belongsTo(Album::class, 'album_id', 'id');
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'group_id', 'id');
    }

    public function strategy(): BelongsTo
    {
        return $this->belongsTo(Strategy::class, 'strategy_id', 'id');
    }

    public function tags(): BelongsToMany
    {
        // fork 新增：图片标签（中间表 image_tag 无时间戳）
        return $this->belongsToMany(Tag::class, 'image_tag', 'image_id', 'tag_id');
    }

    public function getThumbnailPathname(): string
    {
        return trim(config('app.thumbnail_path'), '/')."/{$this->md5}.png";
    }

    private function generateKey($length = 6): string
    {
        $key = Str::random($length);
        if (self::query()->where('key', $key)->exists()) {
            return $this->generateKey(++$length);
        }
        return $key;
    }
}
