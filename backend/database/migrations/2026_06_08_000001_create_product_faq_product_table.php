<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_faq_product', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_faq_id')->constrained('product_faqs')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['product_faq_id', 'product_id'], 'product_faq_product_unique');
            $table->index(['account_id', 'product_id'], 'product_faq_product_account_product_idx');
            $table->index(['product_id', 'product_faq_id'], 'product_faq_product_product_faq_idx');
        });

        DB::table('product_faqs')
            ->select(['id', 'account_id', 'product_id', 'created_at', 'updated_at'])
            ->orderBy('id')
            ->chunkById(500, function ($faqs) {
                $rows = $faqs
                    ->map(fn ($faq) => [
                        'account_id' => $faq->account_id,
                        'product_faq_id' => $faq->id,
                        'product_id' => $faq->product_id,
                        'created_at' => $faq->created_at ?? now(),
                        'updated_at' => $faq->updated_at ?? now(),
                    ])
                    ->all();

                if ($rows !== []) {
                    DB::table('product_faq_product')->insertOrIgnore($rows);
                }
            });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_faq_product');
    }
};
