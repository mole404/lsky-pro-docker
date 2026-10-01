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
        Schema::create('image_tag', function (Blueprint $table) {
            $table->engine = 'InnoDB';
            $table->charset = 'utf8mb4';
            $table->collation = 'utf8mb4_unicode_ci';

            // fork：图片与标签的多对多中间表（无时间戳）。
            // 同样**不建外键**（SQLite 未启用 PRAGMA foreign_keys，级联不可靠），
            // 删除标签/图片时的关联行由应用代码显式删除。
            $table->unsignedBigInteger('image_id')->comment('图片');
            $table->unsignedBigInteger('tag_id')->comment('标签');

            $table->primary(['image_id', 'tag_id']);
            $table->index('tag_id');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('image_tag');
    }
};
