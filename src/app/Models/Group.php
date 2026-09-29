<?php

namespace App\Models;

use App\Enums\GroupConfigKey;
use App\Utils;
use Illuminate\Support\Carbon;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;

/**
 * @property int $id
 * @property string $name
 * @property boolean $is_default
 * @property boolean $is_guest
 * @property Collection $configs
 * @property Carbon $updated_at
 * @property Carbon $created_at
 * @property-read \Illuminate\Database\Eloquent\Collection $users
 * @property-read \Illuminate\Database\Eloquent\Collection $images
 * @property-read \Illuminate\Database\Eloquent\Collection $strategies
 */
class Group extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'is_default',
        'is_guest',
        'configs',
    ];

    protected $casts = [
        'id' => 'integer',
        'is_default' => 'bool',
        'is_guest' => 'bool',
        'configs' => 'collection'
    ];

    /**
     * fork（F3）：读取侧硬过滤 SVG 后缀。
     *
     * convention.php 里的 accepted_file_suffixes 只是**默认值**：Utils::parseConfigs()
     * 对列表型值走 array_is_list() 那支，stored 整份覆盖默认 —— 存量实例的 DB 里
     * （InstallSeeder 播下的「系统默认组&游客组」）存的白名单含 svg，升级后不会自动
     * 变干净，只能靠去后台点一次保存（现在 GroupRequest 的 in: 不认 svg）。
     * 所以最后一道闸门放读取侧：这里是「上传取可上传后缀」的唯一咽喉点 ——
     * ImageService::store() 的 $configs = $group->configs（再 get(AcceptedFileSuffixes)），
     * 登录上传走 $user->group、游客上传走 Group::where('is_guest', true)，同一模型同一
     * accessor；组配置没有缓存层（Utils 的 Cache::rememberForever('configs') 只缓存
     * configs 表的系统配置，与组无关）。
     *
     * 作用域：只滤掉「可上传后缀」这一个键里的 svg/svgz（大小写不敏感），其它配置键、
     * 其它后缀、顺序、标量型配置、不传 stored 的默认值路径全部逐字不变；
     * 非 collection 的读取结果（如 configs 为 NULL）原样返回，与改动前一致。
     *
     * @param  mixed  $value
     * @return Collection|null
     */
    public function getConfigsAttribute($value): ?Collection
    {
        // 读取语义与原来的 cast('collection') 完全一致，只是不再直接返回
        $configs = $value instanceof Collection ? $value->collect() : $this->castAttribute('configs', $value);

        if (! $configs instanceof Collection) {
            return $configs;
        }

        $suffixes = $configs->get(GroupConfigKey::AcceptedFileSuffixes);
        if (is_array($suffixes)) {
            $configs->put(GroupConfigKey::AcceptedFileSuffixes, array_values(array_filter(
                $suffixes,
                static fn ($suffix) => ! in_array(strtolower((string) $suffix), ['svg', 'svgz'], true)
            )));
        }

        return $configs;
    }

    const POSITIONS = [
        'top-left' => '左上角',
        'top' => '上中',
        'top-right' => '右上角',
        'left' => '左边',
        'center' => '中间',
        'right' => '右边',
        'bottom-left' => '左下角',
        'bottom' => '下中',
        'bottom-right' => '右下角',
        'tiled' => '平铺',
    ];

    const SCENES = [
        'porn' => '智能鉴黄',
        'terrorism' => '暴恐涉政',
        'ad' => '图文违规',
        'qrcode' => '二维码',
        'live' => '不良场景',
        'logo' => 'Logo',
    ];

    protected static function booted()
    {
        static::saving(function (self $group) {
            if ($group->isDirty('is_default') && $group->is_default) {
                Group::query()->where('is_default', true)->update(['is_default' => false]);
            }
            if ($group->isDirty('is_guest') && $group->is_guest) {
                Group::query()->where('is_guest', true)->update(['is_guest' => false]);
            }
            $group->configs = Utils::parseConfigs(self::getDefaultConfigs()->toArray(), $group->configs->toArray());
        });
    }

    /**
     * 获取组默认配置
     *
     * @return Collection
     */
    public static function getDefaultConfigs(): Collection
    {
        return collect(config('convention.group'));
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class, 'group_id', 'id');
    }

    public function images(): HasMany
    {
        return $this->hasMany(Image::class, 'group_id', 'id');
    }

    public function strategies(): BelongsToMany
    {
        return $this->belongsToMany(Strategy::class, 'group_strategy', 'group_id', 'strategy_id');
    }
}
