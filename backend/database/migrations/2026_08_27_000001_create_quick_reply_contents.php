<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quick_reply_contents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quick_reply_id')->constrained('quick_replies')->cascadeOnDelete();
            $table->mediumText('body')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['quick_reply_id', 'position']);
        });

        if (!Schema::hasColumn('quick_reply_images', 'quick_reply_content_id')) {
            Schema::table('quick_reply_images', function (Blueprint $table) {
                $table->foreignId('quick_reply_content_id')
                    ->nullable()
                    ->after('quick_reply_id')
                    ->constrained('quick_reply_contents')
                    ->cascadeOnDelete();

                $table->index(['quick_reply_content_id', 'sort_order'], 'quick_reply_images_content_sort_index');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('quick_reply_images', 'quick_reply_content_id')) {
            Schema::table('quick_reply_images', function (Blueprint $table) {
                $table->dropIndex('quick_reply_images_content_sort_index');
                $table->dropConstrainedForeignId('quick_reply_content_id');
            });
        }

        Schema::dropIfExists('quick_reply_contents');
    }
};
