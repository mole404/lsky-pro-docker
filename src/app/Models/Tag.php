<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Carbon;

/**
 * fork 新增：按用户隔离的图片标签（每个用户只能读写自己的标签，互相不可见）。
 *
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property Carbon $updated_at
 * @property Carbon $created_at
 * @property-read User $user
 * @property-read \Illuminate\Database\Eloquent\Collection $images
 */
class Tag extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
    ];

    protected $hidden = [
        'user_id',
    ];

    protected $casts = [
        'id' => 'integer',
        'user_id' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    public function images(): BelongsToMany
    {
        // 中间表 image_tag 无时间戳，不要调 withTimestamps()
        return $this->belongsToMany(Image::class, 'image_tag', 'tag_id', 'image_id');
    }
}
