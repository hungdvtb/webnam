<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('posts', 'is_ai_generated')) {
            $afterColumn = Schema::hasColumn('posts', 'featured_media_asset_id')
                ? 'featured_media_asset_id'
                : 'featured_image';

            Schema::table('posts', function (Blueprint $table) use ($afterColumn) {
                $table->boolean('is_ai_generated')->default(false)->after($afterColumn);
                $table->index(['account_id', 'is_ai_generated']);
            });
        }

        if (Schema::hasTable('blog_ai_bulk_jobs')) {
            DB::table('blog_ai_bulk_jobs')
                ->select(['id', 'summary'])
                ->orderBy('id')
                ->chunk(100, function ($jobs): void {
                    $postIds = [];

                    foreach ($jobs as $job) {
                        $summary = is_string($job->summary ?? null)
                            ? json_decode($job->summary, true)
                            : ($job->summary ?? []);

                        if (!is_array($summary)) {
                            continue;
                        }

                        foreach (['created_post_ids', 'updated_post_ids'] as $key) {
                            foreach ((array) ($summary[$key] ?? []) as $postId) {
                                $postId = (int) $postId;
                                if ($postId > 0) {
                                    $postIds[] = $postId;
                                }
                            }
                        }
                    }

                    $postIds = array_values(array_unique($postIds));
                    if ($postIds !== []) {
                        DB::table('posts')
                            ->whereIn('id', $postIds)
                            ->update(['is_ai_generated' => true]);
                    }
                });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('posts', 'is_ai_generated')) {
            Schema::table('posts', function (Blueprint $table) {
                $table->dropIndex('posts_account_id_is_ai_generated_index');
                $table->dropColumn('is_ai_generated');
            });
        }
    }
};
