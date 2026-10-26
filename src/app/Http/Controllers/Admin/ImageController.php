<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Image;
use App\Services\UserService;
use App\Support\Like;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\View\View;

class ImageController extends Controller
{
    public function index(Request $request): View|RedirectResponse
    {
        $keywords = $request->query('keywords');
        $images = Image::query()->with(['user' => function (BelongsTo $belongsTo) {
            $belongsTo->withSum('images', 'size');
        }, 'album', 'group', 'strategy'])->when($keywords, function (Builder $builder, $keywords) {
            $words = [];
            $qualifiers = [
                'name:', 'album:', 'group:', 'strategy:', 'email:', 'extension:', 'md5:', 'sha1:', 'ip:', 'is:', 'order:',
            ];
            // 引号感知分词：限定符的值里含空格时（如 strategy:"AWS S3"）要整体作为一个 token，
            // 不能再按空格硬切。未闭合的引号按普通字符处理，保持旧的逐词行为。
            preg_match_all('/\S+:"[^"]*"|\S+/u', (string) $keywords, $matched);
            $tokens = $matched[0] ?? [];
            collect($tokens)->filter(function ($keyword) use ($qualifiers, &$words) {
                if (Str::startsWith($keyword, $qualifiers)) {
                    return true;
                }
                $words[] = $keyword;
                return false;
            })->each(function ($filter) use ($builder) {
                match ($filter) {
                    // fork：原 'is:public' / 'is:private' 两条语法已删除 —— 界面上的「图片权限」
                    // 口径整体下线后，后台不再提供按可见性筛图的能力（手输该语法等同于未知语法，
                    // 不产生任何筛选条件，与 is:xxx 里的其它未知值行为一致）。
                    'is:unhealthy' => $builder->where('is_unhealthy', 1),
                    'is:guest' => $builder->whereNull('user_id'),
                    'is:adminer' => $builder->whereHas('user', fn (Builder $builder) => $builder->where('is_adminer', 1)),
                    'order:earliest' => $builder->orderBy('created_at'),
                    'order:utmost' => $builder->orderByDesc('size'),
                    'order:least' => $builder->orderBy('size'),
                    default => 0,
                };

                [$qualifier, $value] = explode(':', $filter, 2);

                // 值两端的双引号只用于在查询串里保住空格，交给数据库前必须去掉。
                if (Str::startsWith($value, '"') && Str::endsWith($value, '"')) {
                    $value = substr($value, 1, -1);
                }

                if ($value) {
                    $callback = fn (Builder $builder) => $builder->where('name', $value);
                    match ($qualifier) {
                        'name' => $builder->whereHas('user', $callback),
                        'album' => $builder->whereHas('album', $callback),
                        'group' => $builder->whereHas('group', $callback),
                        'strategy' => $builder->whereHas('strategy', $callback),
                        'email' => $builder->whereHas('user', fn (Builder $builder) => $builder->where('email', $value)),
                        'extension' => $builder->where('extension', $value),
                        'md5' => $builder->where('md5', $value),
                        'sha1' => $builder->where('sha1', $value),
                        'ip' => $builder->where('ip', $value),
                        default => 0
                    };
                }
            });

            if ($words) {
                // 必须把关键字 OR 组包进闭包：直接挂在最外层时，orWhere 会和上面的限定符条件
                // （whereHas / where）平铺在同一个布尔层级，SQL 会被拼成
                // `限定符条件 or origin_name like ...`，即关键字只要沾上就绕过限定符，过滤失效。
                // 包一层闭包后生成 `限定符条件 and (name like ... or origin_name like ...)`。
                $builder->where(function (Builder $q) use ($words) {
                    foreach ($words as $word) {
                        // 关键字一律当字面量：% _ \ 由 Like 转义 + 显式 ESCAPE 子句，
                        // 否则搜 `a_b` / `100%` 会被通配符带到无关的图。
                        Like::orWhereContains($q, 'name', $word);
                        Like::orWhereContains($q, 'origin_name', $word);
                        Like::orWhereContains($q, 'alias_name', $word);
                    }
                });
            }
        })->latest()->paginate(36);
        $images->getCollection()->each(function (Image $image) {
            $image->append('url', 'pathname', 'thumb_url');
            $image->album?->setVisible(['name']);
            $image->group?->setVisible(['name']);
            $image->strategy?->setVisible(['name']);
        });

        $images->appends(compact('keywords'));

        // ?page= 越界（删到最后一页不足、旧书签）时回到最后一页，别停在空列表上。
        if ($redirect = $this->redirectOutOfRangePage($images)) {
            return $redirect;
        }

        return view('admin.image.index', compact('images'));
    }

    public function update(): Response
    {
        return $this->success();
    }

    public function delete(Request $request): Response
    {
        /** @var Image $image */
        $image = Image::with('user', 'strategy', 'album')->find($request->route('id'));
        (new UserService())->deleteImages([$image->id]);
        return $this->success('删除成功');
    }
}
