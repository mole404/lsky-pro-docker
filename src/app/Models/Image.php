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
        // 把 `foo[]=1&foo[]=2` 这类多选参数归一成「去重后的 int 列表」：
        // 只接受 int 或纯数字字符串（`1a`、`abc`、数组嵌套等一律丢弃），并按需允许 0。
        // 归一后为空数组时，下面的 when() 因为是假值会整段跳过 —— 这样既做到「不传/空 = 不加限制」，
        // 也不会产生 whereIn([]) 这种恒假条件。
        $intIds = static function ($value, bool $allowZero = false): array {
            if (! is_array($value)) {
                return [];
            }

            $ids = [];
            foreach ($value as $item) {
                if (is_int($item)) {
                    $id = $item;
                } elseif (is_string($item) && ctype_digit($item)) {
                    $id = (int) $item;
                } else {
                    continue;
                }

                if ($id > 0 || ($allowZero && $id === 0)) {
                    $ids[$id] = $id;
                }
            }

            return array_values($ids);
        };

        // 日期参数校验：只认规范的 `Y-m-d`，且日历上真实存在（checkdate 会挡掉 2026-02-30 / 2026-13-01）。
        // 任何其它形状（残缺、超范围、数组、null）都返回 null，调用点据此「忽略该条件」而不是抛异常。
        $validDate = static function ($value): ?string {
            if (! is_string($value) || ! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches)) {
                return null;
            }

            return checkdate((int) $matches[2], (int) $matches[3], (int) $matches[1]) ? $value : null;
        };

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
        }, function (Builder $builder) use ($request) {
            // fork 新增（只新增取值，不改既有取值的行为）：`album_id=all` 表示「全部相册」，
            // 即不加任何相册约束。未传该参数时仍是原来的 whereNull('album_id')
            // （图片列表页「未分类」视图的语义），数字取值仍然是等值匹配 —— 后两者一字未改。
            // 需要这个显式哨兵的原因：导出侧「一个相册都不勾 = 导出全部图片」若走缺省分支，
            // 会退化成「只导出未分类」；且 `album_ids[]` 的 whereIn 会被额外 AND 上 whereNull
            // 而恒为空集（实测：未分类占多数时，只传 album_ids[]=1 而不加哨兵会取到 0 行）。
            if ($request->query('album_id') === 'all') {
                return;
            }

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
        })->when($intIds($request->query('tag_ids')), function (Builder $builder, array $tagIds) {
            // fork 新增：`tag_ids[]` 是导出侧用的标签参数名（与新版 UI 的 album_ids[] / strategy_ids[]
            // 命名对齐），语义与上面既有的 `tags[]` 完全一致 —— 传入的每一个标签都必须命中（AND）。
            // 既有 `tags[]` 分支的行为一字未改；两者同时出现时各加一组 whereHas，仍然都是 AND。
            foreach ($tagIds as $tagId) {
                $builder->whereHas('tags', function (Builder $query) use ($tagId) {
                    $query->where('tags.id', $tagId);
                });
            }
        })->when($intIds($request->query('album_ids'), true), function (Builder $builder, array $albumIds) {
            // fork 新增：相册多选，参数形状 `album_ids[]=<id>`；`0` 是「未分类」的哨兵值
            // （album_id IS NULL），正值是具体相册。归一化后为空数组时整段被 when() 跳过，
            // 即「不传 / 空 = 该维度不加任何限制」—— 与列表页 `album_id` 缺省时强制
            // whereNull('album_id') 的语义**不同**，导出侧走本条、不要复用 `album_id`。
            // 「未分类」与具体相册之间是 OR：必须包进闭包，否则 orWhereNull 会平铺进外层
            // 查询，把自己的 OR 分支从 user_id / permission / 其它维度的条件里摘出去
            // （keyword 那段有同类教训，见上）。
            $builder->where(function (Builder $query) use ($albumIds) {
                $classified = array_values(array_diff($albumIds, [0]));

                if ($classified !== []) {
                    $query->whereIn('album_id', $classified);
                }

                if (in_array(0, $albumIds, true)) {
                    if ($classified === []) {
                        $query->whereNull('album_id');
                    } else {
                        $query->orWhereNull('album_id');
                    }
                }
            });
        })->when($intIds($request->query('strategy_ids')), function (Builder $builder, array $strategyIds) {
            // fork 新增：存储策略多选，参数形状 `strategy_ids[]=<id>`；维度内 OR（whereIn），
            // 维度之间 AND。非正整数与非法值已在 $intIds 里剔除，不会退化成 whereIn([])。
            $builder->whereIn('strategy_id', $strategyIds);
        })->when($validDate($request->query('date_from')), function (Builder $builder, string $dateFrom) {
            // fork 新增：上传日期区间下界（闭区间，含当日 00:00:00）。
            // created_at 落库时用的就是应用时区（config/app.php 的 timezone = PRC）的本地时间，
            // 所以这里直接按字面字符串比较，**不做任何时区换算**；SQLite/MySQL 下
            // 'Y-m-d H:i:s' 的字面比较等价于时间先后比较。
            $builder->where('created_at', '>=', "{$dateFrom} 00:00:00");
        })->when($validDate($request->query('date_to')), function (Builder $builder, string $dateTo) {
            // fork 新增：上传日期区间上界（闭区间，含当日 23:59:59）。两端各自独立生效。
            // 非法日期已被 $validDate 归一成 null ⇒ when() 跳过该条件，请求不会因参数格式出错而 500。
            $builder->where('created_at', '<=', "{$dateTo} 23:59:59");
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
