<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            $table->string('seo_keyword')->nullable()->after('slug');
            $table->boolean('is_starred')->default(false)->after('is_published');
            $table->unsignedInteger('sort_order')->default(0)->after('is_starred');

            $table->index(['account_id', 'seo_keyword']);
            $table->index(['account_id', 'is_starred']);
            $table->index(['account_id', 'sort_order']);
        });

        $posts = DB::table('posts')
            ->select(['id', 'account_id'])
            ->orderBy('account_id')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        $sortOrderPerAccount = [];

        foreach ($posts as $post) {
            $accountId = (int) $post->account_id;
            $sortOrderPerAccount[$accountId] = ($sortOrderPerAccount[$accountId] ?? 0) + 1;

            DB::table('posts')
                ->where('id', $post->id)
                ->update(['sort_order' => $sortOrderPerAccount[$accountId]]);
        }

        DB::table('posts')
            ->whereNull('is_published')
            ->update(['is_published' => true]);

        $driver = DB::getDriverName();

        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE posts MODIFY is_published TINYINT(1) NOT NULL DEFAULT 1');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE posts ALTER COLUMN is_published SET DEFAULT TRUE');
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            $table->dropIndex('posts_account_id_seo_keyword_index');
            $table->dropIndex('posts_account_id_is_starred_index');
            $table->dropIndex('posts_account_id_sort_order_index');

            $table->dropColumn(['seo_keyword', 'is_starred', 'sort_order']);
        });

        $driver = DB::getDriverName();

        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE posts MODIFY is_published TINYINT(1) NOT NULL DEFAULT 0');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE posts ALTER COLUMN is_published SET DEFAULT FALSE');
        }
    }
};
