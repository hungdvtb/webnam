<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->repairCategoriesTable();
        $this->repairCategoryProductTable();
    }

    public function down(): void
    {
        // This is an environment repair migration. Keep rollback as a no-op
        // to avoid dropping recovered columns from restored data.
    }

    private function repairCategoriesTable(): void
    {
        if (!Schema::hasTable('categories')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            if (!Schema::hasColumn('categories', 'code')) {
                $table->string('code')->nullable()->after('name');
            }

            if (!Schema::hasColumn('categories', 'logo_path')) {
                $table->string('logo_path')->nullable()->after('banner_path');
            }

            if (!Schema::hasColumn('categories', 'banner_media_asset_id')) {
                $table->unsignedBigInteger('banner_media_asset_id')->nullable()->after('banner_path');
            }

            if (!Schema::hasColumn('categories', 'logo_media_asset_id')) {
                $table->unsignedBigInteger('logo_media_asset_id')->nullable()->after('logo_path');
            }

            if (!Schema::hasColumn('categories', 'deleted_at')) {
                $table->softDeletes()->after('updated_at');
            }

            if (!Schema::hasColumn('categories', 'deleted_by')) {
                $table->unsignedBigInteger('deleted_by')->nullable()->after('deleted_at');
            }
        });

        $usedCodesByAccount = [];
        $categories = DB::table('categories')
            ->select('id', 'account_id', 'slug', 'code')
            ->orderBy('id')
            ->get();

        foreach ($categories as $category) {
            $accountKey = (string) ($category->account_id ?? 0);
            $baseCode = trim((string) ($category->code ?: $category->slug));
            $baseCode = $baseCode !== '' ? $baseCode : ('danh-muc-' . $category->id);
            $baseCode = $this->normalizeCategoryCode($baseCode);
            $code = $baseCode;
            $suffix = 2;

            while (isset($usedCodesByAccount[$accountKey][$code])) {
                $code = $baseCode . '-' . $suffix;
                $suffix++;
            }

            $usedCodesByAccount[$accountKey][$code] = true;

            if ((string) $category->code !== $code) {
                DB::table('categories')
                    ->where('id', $category->id)
                    ->update(['code' => $code]);
            }
        }

        if (!$this->pgIndexExists('categories', 'categories_account_id_code_unique')) {
            Schema::table('categories', function (Blueprint $table) {
                $table->unique(['account_id', 'code'], 'categories_account_id_code_unique');
            });
        }

        if (!$this->pgIndexExists('categories', 'categories_deleted_at_index')) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index('deleted_at');
            });
        }

        if (!$this->pgIndexExists('categories', 'categories_deleted_by_index')) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index('deleted_by');
            });
        }

        if (
            Schema::hasColumn('categories', 'parent_id')
            && Schema::hasColumn('categories', 'deleted_at')
            && Schema::hasColumn('categories', 'order')
            && !$this->pgIndexExists('categories', 'categories_parent_deleted_at_order_index')
        ) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index(['parent_id', 'deleted_at', 'order'], 'categories_parent_deleted_at_order_index');
            });
        }
    }

    private function repairCategoryProductTable(): void
    {
        if (!Schema::hasTable('category_product')) {
            return;
        }

        Schema::table('category_product', function (Blueprint $table) {
            if (!Schema::hasColumn('category_product', 'sort_order')) {
                $table->unsignedInteger('sort_order')->default(0)->after('category_id');
            }

            if (!Schema::hasColumn('category_product', 'item_type')) {
                $table->string('item_type', 40)->default('product')->after('category_id');
            }

            if (!Schema::hasColumn('category_product', 'bundle_option_key')) {
                $table->string('bundle_option_key', 190)->default('')->after('item_type');
            }

            if (!Schema::hasColumn('category_product', 'bundle_option_post_id')) {
                $table->unsignedBigInteger('bundle_option_post_id')->nullable()->after('bundle_option_key');
            }

            if (!Schema::hasColumn('category_product', 'bundle_option_title')) {
                $table->string('bundle_option_title')->nullable()->after('bundle_option_post_id');
            }
        });

        DB::table('category_product')
            ->whereNull('item_type')
            ->update(['item_type' => 'product']);

        DB::table('category_product')
            ->whereNull('bundle_option_key')
            ->update(['bundle_option_key' => '']);

        $existingRows = DB::table('category_product')
            ->orderBy('category_id')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get(['id', 'category_id']);

        $nextSortOrderByCategory = [];

        foreach ($existingRows as $row) {
            $categoryId = (int) $row->category_id;
            $sortOrder = $nextSortOrderByCategory[$categoryId] ?? 0;

            DB::table('category_product')
                ->where('id', $row->id)
                ->update(['sort_order' => $sortOrder]);

            $nextSortOrderByCategory[$categoryId] = $sortOrder + 1;
        }

        $missingAssignments = DB::table('products')
            ->leftJoin('category_product', function ($join) {
                $join->on('products.id', '=', 'category_product.product_id')
                    ->on('products.category_id', '=', 'category_product.category_id');
            })
            ->whereNotNull('products.category_id')
            ->whereNull('category_product.id')
            ->orderBy('products.category_id')
            ->orderBy('products.created_at')
            ->orderBy('products.id')
            ->get([
                'products.id as product_id',
                'products.category_id',
                'products.created_at',
            ]);

        $insertRows = [];

        foreach ($missingAssignments as $row) {
            $categoryId = (int) $row->category_id;
            $sortOrder = $nextSortOrderByCategory[$categoryId] ?? 0;

            $insertRows[] = [
                'product_id' => (int) $row->product_id,
                'category_id' => $categoryId,
                'item_type' => 'product',
                'bundle_option_key' => '',
                'bundle_option_post_id' => null,
                'bundle_option_title' => null,
                'sort_order' => $sortOrder,
                'created_at' => $row->created_at ?? now(),
                'updated_at' => now(),
            ];

            $nextSortOrderByCategory[$categoryId] = $sortOrder + 1;
        }

        foreach (array_chunk($insertRows, 500) as $chunk) {
            DB::table('category_product')->insert($chunk);
        }

        if (!$this->pgIndexExists('category_product', 'category_product_unique_category_assignment')) {
            Schema::table('category_product', function (Blueprint $table) {
                $table->unique(
                    ['category_id', 'item_type', 'product_id', 'bundle_option_key'],
                    'category_product_unique_category_assignment'
                );
            });
        }

        if (!$this->pgIndexExists('category_product', 'category_product_category_item_sort_index')) {
            Schema::table('category_product', function (Blueprint $table) {
                $table->index(
                    ['category_id', 'item_type', 'sort_order'],
                    'category_product_category_item_sort_index'
                );
            });
        }
    }

    private function pgIndexExists(string $table, string $indexName): bool
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return Schema::hasIndex($table, $indexName);
        }

        return DB::table('pg_indexes')
            ->where('schemaname', 'public')
            ->where('tablename', $table)
            ->where('indexname', $indexName)
            ->exists();
    }

    private function normalizeCategoryCode(string $value): string
    {
        $normalized = trim(strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $value) ?? ''));
        $normalized = trim($normalized, '-');

        return $normalized !== '' ? $normalized : 'danh-muc';
    }
};
