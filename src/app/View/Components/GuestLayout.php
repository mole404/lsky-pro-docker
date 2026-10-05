<?php

namespace App\View\Components;

use Illuminate\View\Component;

class GuestLayout extends Component
{
    /**
     * @param  bool  $floatingThemeSwitch  是否在页面右上角浮一个外观切换按钮。
     *   登录/注册这类「页面自己没有顶栏」的页面需要它；游客首页自带顶栏、把按钮排进那一行里，
     *   于是传 :floating-theme-switch="false" 关掉浮动版（否则两套坐标系会错位）。
     *
     *   ⚠ 必须是**构造器参数**：Blade 只把「能对上构造器参数名」的标签属性当 props 传进来
     *     （见 Illuminate\View\Compilers\ComponentTagCompiler::partitionDataAndAttributes）。
     *     只写一个 public 属性、不给构造器的话，属性会被丢进 attribute bag、值不会变 —— 实测踩过：
     *     页面照旧渲染出浮动按钮（编译产物里是 `resolve([] + …)` + `withAttributes(['floating-theme-switch' => false])`）。
     */
    public function __construct(public bool $floatingThemeSwitch = true)
    {
    }

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
