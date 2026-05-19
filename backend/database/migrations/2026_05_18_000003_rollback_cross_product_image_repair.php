<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            ! Schema::hasTable('products')
            || ! Schema::hasTable('product_images')
            || ! Schema::hasTable('media_assets')
        ) {
            return;
        }

        $this->removeCopiedImages('ML80-KYNGAILAM', 'VV90-KYNGAI');
        $this->removeCopiedImages('ML80-LOHOALAM', 'VV90-LOHOA');

        $this->restoreKnownProductImage('VV90-KYNGAI', '01kq2jc544ravkn21ba62qkxx4', true, 0);
        $this->restoreKnownProductImage('VV90-KYNGAI3', '01knzwm81mwdsbkj27gathk8qj', true, 0);
        $this->restoreKnownProductImage('VV90-KYNGAI3', '01kp0ejcan6cw6ej088xjqv8js', false, 1);
        $this->restoreKnownProductImage('VV90-KYNGAI5', '01knzwm2w875h5m2512h75kah3', true, 0);
        $this->restoreKnownProductImage('VV90-KYNGAI5', '01kp0ej7ekwhzz5q99nbmh825n', false, 1);
    }

    public function down(): void
    {
        // No-op: this migration only removes cross-product copied image rows
        // and restores known original rows when their media assets exist.
    }

    private function removeCopiedImages(string $sourceSku, string $targetSku): void
    {
        $sourceProductId = $this->productIdBySku($sourceSku);
        $targetProductId = $this->productIdBySku($targetSku);

        if (! $sourceProductId || ! $targetProductId) {
            return;
        }

        $sourceAssetIds = DB::table('product_images')
            ->where('product_id', $sourceProductId)
            ->pluck('media_asset_id')
            ->filter()
            ->unique()
            ->values();

        if ($sourceAssetIds->isEmpty()) {
            return;
        }

        DB::table('product_images')
            ->where('product_id', $targetProductId)
            ->whereIn('media_asset_id', $sourceAssetIds->all())
            ->delete();
    }

    private function restoreKnownProductImage(string $sku, string $publicId, bool $isPrimary, int $sortOrder): void
    {
        $product = DB::table('products')
            ->where('sku', $sku)
            ->first(['id', 'account_id']);
        $asset = DB::table('media_assets')
            ->where('public_id', $publicId)
            ->first(['id', 'public_id', 'original_name', 'size_bytes']);

        if (! $product || ! $asset) {
            return;
        }

        if ($isPrimary) {
            DB::table('product_images')
                ->where('product_id', $product->id)
                ->update(['is_primary' => false]);
        }

        $record = [
            'product_id' => $product->id,
            'media_asset_id' => $asset->id,
            'image_url' => '/api/media/assets/' . $asset->public_id . '/large',
            'is_primary' => $isPrimary,
            'sort_order' => $sortOrder,
            'file_name' => $asset->original_name,
            'file_size' => $asset->size_bytes,
            'updated_at' => now(),
        ];

        if (Schema::hasColumn('product_images', 'account_id')) {
            $record['account_id'] = $product->account_id ?? null;
        }

        $existingId = DB::table('product_images')
            ->where('product_id', $product->id)
            ->where('media_asset_id', $asset->id)
            ->value('id');

        if ($existingId) {
            DB::table('product_images')
                ->where('id', $existingId)
                ->update($record);

            return;
        }

        $record['created_at'] = now();

        DB::table('product_images')->insert($record);
    }

    private function productIdBySku(string $sku): ?int
    {
        $productId = DB::table('products')
            ->where('sku', $sku)
            ->value('id');

        return is_numeric($productId) ? (int) $productId : null;
    }
};
