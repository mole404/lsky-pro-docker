<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * 客户端断开（用户主动取消下载 / 关页面 / 网络断开）时用来跳出导出循环。
 *
 * 与真实故障区分开：导出收尾时它只算「中断」，不写日志（不是服务端的问题）；
 * 而远端读到一半断开这类异常会被标成失败并记一条日志。
 */
class ClientAbortedException extends RuntimeException
{
}
