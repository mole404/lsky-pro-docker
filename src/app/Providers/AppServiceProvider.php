<?php

namespace App\Providers;

use App\Enums\ConfigKey;
use App\Models\Group;
use App\Utils;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\View;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * @return void
     */
    public function register()
    {
        //
    }

    /**
     * Bootstrap any application services.
     *
     * @return void
     */
    public function boot()
    {
        // sqlite 并发参数（B9）：连接建立时把 journal_mode 设成 WAL。
        // 为什么不去 config/database.php 里写 'journal_mode'/'busy_timeout'：Laravel 9.52 的 sqlite
        // 驱动**不认**这两个键（SQLiteConnector 只读 database/options，SQLiteConnection 只多读
        // foreign_key_constraints）—— 写了也是死键、被静默忽略（实测）。busy_timeout 已改走
        // config 里的 PDO::ATTR_TIMEOUT（见 config/database.php），journal_mode 没有 config 路径，
        // 只能 PRAGMA，所以放这里。
        // 挂 ConnectionEstablished（连接对象**首次被取用**时派发）而不是在 boot() 里直接
        // DB::connection()->getPdo()：后者会让每个请求一引导就强行连库（哪怕这个请求根本不碰数据库）。
        Event::listen(ConnectionEstablished::class, function (ConnectionEstablished $event) {
            self::tuneSqliteConnection($event->connection);
        });

        // 是否需要生成 env 文件
        if (! file_exists(base_path('.env'))) {
            file_put_contents(base_path('.env'), file_get_contents(base_path('.env.example')));
            // 生成 key
            Artisan::call('key:generate');
        }

        // 如果已经安装程序，初始化一些配置
        if (file_exists(base_path('installed.lock'))) {
            // 覆盖默认配置
            Config::set('app.name', Utils::config(ConfigKey::AppName));
            Config::set('mail', array_merge(\config('mail'), Utils::config(ConfigKey::Mail)->toArray()));

            View::composer('*', function (\Illuminate\View\View $view) {
                /** @var Group $group */
                $group = Auth::check() ? Auth::user()->group : Group::query()->where('is_guest', true)->first();
                $view->with([
                    '_group' => $group,
                    '_is_notice' => strip_tags(Utils::config(ConfigKey::SiteNotice)),
                ]);
            });
        }
    }

    /**
     * 给 sqlite 连接套上并发参数（B9）。
     *
     * Laravel 9.52 的 sqlite 驱动不认 'journal_mode' / 'busy_timeout' 这两个 config 键，
     * 所以这里用 PRAGMA。journal_mode=WAL 是**写进数据库文件**的持久属性：
     *   - 读不再阻塞写、写不再阻塞读（回滚日志模式下，读事务升级为写事务时会立刻
     *     抛 SQLITE_BUSY，busy_timeout 对这种情况不生效 —— 这才是 'database is locked'
     *     的真正来源）；设一次之后一直有效，这里每个新连接再设一次是幂等的。
     * busy_timeout 由 config/database.php 的 PDO::ATTR_TIMEOUT 负责（= PRAGMA busy_timeout 5000）。
     *
     * 刻意只认 sqlite：其它驱动（mysql/pgsql/sqlsrv）直接返回，不发任何 SQL。
     *
     * @param  \Illuminate\Database\Connection  $connection
     * @return void
     */
    public static function tuneSqliteConnection(Connection $connection)
    {
        if ($connection->getDriverName() !== 'sqlite') {
            return;
        }

        // 注释里带 'PRAGMA journal_mode = WAL' 便于 grep 自证；exec 忽略返回值（WAL 设成功会返回
        // 'wal'，但 exec() 拿不到，所以真值由测试脚本单独 query 验证）。
        $connection->getPdo()->exec('PRAGMA journal_mode = WAL');
    }
}
