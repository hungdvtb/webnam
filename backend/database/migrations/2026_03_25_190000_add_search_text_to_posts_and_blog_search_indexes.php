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
            $table->text('search_text')->default('');
        });

        $this->backfillSearchText();

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('CREATE EXTENSION IF NOT EXISTS unaccent');
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        DB::statement(
            "CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text AS $$ SELECT public.unaccent('public.unaccent', \$1) $$ LANGUAGE sql IMMUTABLE"
        );

        DB::statement('ALTER TABLE posts ALTER COLUMN search_text SET NOT NULL');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_posts_search_text_trgm ON posts USING GIN (immutable_unaccent(search_text) gin_trgm_ops)');
        DB::statement("CREATE INDEX IF NOT EXISTS idx_posts_seo_keyword_trgm ON posts USING GIN (immutable_unaccent(COALESCE(seo_keyword, '')) gin_trgm_ops)");
        DB::statement('CREATE INDEX IF NOT EXISTS idx_blog_categories_name_trgm ON blog_categories USING GIN (immutable_unaccent(name) gin_trgm_ops)');
        DB::statement('CREATE INDEX IF NOT EXISTS idx_blog_categories_slug_trgm ON blog_categories USING GIN (immutable_unaccent(slug) gin_trgm_ops)');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS idx_posts_search_text_trgm');
            DB::statement('DROP INDEX IF EXISTS idx_posts_seo_keyword_trgm');
            DB::statement('DROP INDEX IF EXISTS idx_blog_categories_name_trgm');
            DB::statement('DROP INDEX IF EXISTS idx_blog_categories_slug_trgm');
        }

        Schema::table('posts', function (Blueprint $table) {
            $table->dropColumn('search_text');
        });
    }

    private function backfillSearchText(): void
    {
        DB::table('posts')
            ->select(['id', 'title', 'slug', 'excerpt', 'content'])
            ->orderBy('id')
            ->chunkById(100, function ($posts) {
                foreach ($posts as $post) {
                    DB::table('posts')
                        ->where('id', $post->id)
                        ->update([
                            'search_text' => $this->buildSearchText($post),
                        ]);
                }
            });
    }

    private function buildSearchText(object $post): string
    {
        $plainContent = html_entity_decode(strip_tags((string) ($post->content ?? '')), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $searchText = implode(' ', array_filter([
            trim((string) ($post->title ?? '')),
            trim((string) ($post->slug ?? '')),
            trim((string) ($post->excerpt ?? '')),
            trim($plainContent),
        ]));

        return trim((string) preg_replace('/\s+/u', ' ', $searchText));
    }
};
