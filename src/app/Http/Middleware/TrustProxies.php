<?php

namespace App\Http\Middleware;

use Illuminate\Http\Middleware\TrustProxies as Middleware;
use Illuminate\Http\Request;

class TrustProxies extends Middleware
{
    /**
     * 只信任真实入口（主机 nginx —— 127.0.0.1:8089 这一跳）。
     *
     * 上游默认写的是 '*'，等于信任所有转发头。而外层 nginx 用的是
     * $proxy_add_x_forwarded_for（追加而不是覆盖），客户端自己带的
     * X-Forwarded-For 会排在列表最前面；Laravel 取客户端 IP 时又会采信它 ——
     * 于是所有按 IP 限流的地方（登录失败计数、throttle 中间件）都能靠伪造一个头
     * 无限重置。实测：写 '*' 时应用眼里的客户端 IP 就是伪造进去的那个值；
     * 改成下面这组之后才是真实客户端。
     *
     * 只列私有网段而不是写死某一个网关地址：容器网络重建后网关会变，写死会静默失效
     * （届时应用不再认转发头，所有人被当成同一个 IP，限流会互相牵连）。
     * 公网攻击者不可能以私有地址连进来，所以这样信任是安全的：
     * 从右往左找第一个“不受信”的地址，得到的仍然是真实客户端。
     *
     * @var array<int, string>|string|null
     */
    protected $proxies = ['127.0.0.1', '::1', '172.16.0.0/12', '10.0.0.0/8', '192.168.0.0/16'];

    /**
     * The headers that should be used to detect proxies.
     *
     * @var int
     */
    protected $headers =
        Request::HEADER_X_FORWARDED_FOR |
        Request::HEADER_X_FORWARDED_HOST |
        Request::HEADER_X_FORWARDED_PORT |
        Request::HEADER_X_FORWARDED_PROTO |
        Request::HEADER_X_FORWARDED_AWS_ELB;
}
