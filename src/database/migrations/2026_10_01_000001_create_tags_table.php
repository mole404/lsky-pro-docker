<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('tags', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            $table->id();
            // fork：标签按用户隔离。user_id 只建普通索引、**故意不建外键**：
            // 本仓 SQLite 未启用 PRAGMA foreign_keys，级联删除不可靠，
            // 关联行的清理一律在应用代码里显式执行。
            $table->unsignedBigInteger('user_id')->comment('用户');
            $table->string('name', 64)->comment('名称');
            $table->timestamps();

            $table->unique(['user_id', 'name']);
            $table->index('user_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('tags');
    }
};
