<?php

namespace App\View\Components;

use Illuminate\View\Component;

class GuestLayout extends Component
{
    /**
     * 是否在页面右上角浮一个外观切换按钮。
     * 登录/注册这类「页面自己没有顶栏」的页面需要它；游客首页自带顶栏、按钮排进那一行里，
     * 于是传 :floating-theme-switch="false" 关掉浮动版（否则两套坐标系会错位）。
     */
    public bool $floatingThemeSwitch = true;

    /**
     * Get the view / contents that represents the component.
     *
     * @return \Illuminate\View\View
     */
    public function render()
    {
        return view('layouts.guest');
    }
}
