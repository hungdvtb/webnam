<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('categories') || !Schema::hasColumn('categories', 'parent_id')) {
            return;
        }

        $categories = DB::table('categories')
            ->orderBy('id')
            ->get(['id', 'account_id', 'parent_id']);

        if ($categories->isEmpty()) {
            return;
        }

        $categoryMap = [];

        foreach ($categories as $category) {
            $categoryMap[(int) $category->id] = [
                'id' => (int) $category->id,
                'account_id' => $category->account_id === null ? null : (int) $category->account_id,
                'parent_id' => $category->parent_id === null ? null : (int) $category->parent_id,
            ];
        }

        $resetParent = function (int $categoryId) use (&$categoryMap): void {
            if (($categoryMap[$categoryId]['parent_id'] ?? null) !== null) {
                $categoryMap[$categoryId]['parent_id'] = null;
                DB::table('categories')->where('id', $categoryId)->update(['parent_id' => null]);
            }
        };

        foreach ($categoryMap as $categoryId => $category) {
            $parentId = $category['parent_id'];
            if ($parentId === null) {
                continue;
            }

            $parent = $categoryMap[$parentId] ?? null;
            if (
                $parent === null
                || $parentId === $categoryId
                || $parent['account_id'] !== $category['account_id']
            ) {
                $resetParent($categoryId);
            }
        }

        foreach (array_keys($categoryMap) as $categoryId) {
            $visited = [$categoryId => true];
            $cursor = $categoryMap[$categoryId]['parent_id'];

            while ($cursor !== null && isset($categoryMap[$cursor])) {
                if (isset($visited[$cursor])) {
                    $resetParent($categoryId);
                    break;
                }

                $visited[$cursor] = true;
                $cursor = $categoryMap[$cursor]['parent_id'];
            }
        }
    }

    public function down(): void
    {
        // Irreversible cleanup migration.
    }
};
