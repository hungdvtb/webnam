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
        Schema::create('post_seo_keywords', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->onDelete('cascade');
            $table->string('keyword', 255);
            $table->timestamps();

            $table->unique(['account_id', 'keyword']);
            $table->index(['account_id']);
        });

        $rows = DB::table('posts')
            ->select(['account_id', 'seo_keyword'])
            ->whereNotNull('seo_keyword')
            ->where('seo_keyword', '<>', '')
            ->distinct()
            ->get();

        if ($rows->isNotEmpty()) {
            $now = now();
            $payload = $rows->map(function ($row) use ($now) {
                return [
                    'account_id' => $row->account_id,
                    'keyword' => trim((string) $row->seo_keyword),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            })->filter(fn ($row) => $row['keyword'] !== '')->values()->all();

            if (!empty($payload)) {
                DB::table('post_seo_keywords')->insertOrIgnore($payload);
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('post_seo_keywords');
    }
};
