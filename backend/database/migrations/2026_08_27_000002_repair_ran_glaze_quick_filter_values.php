<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            !Schema::hasTable('attributes')
            || !Schema::hasTable('products')
            || !Schema::hasTable('product_attribute_values')
        ) {
            return;
        }

        $glazeAttributeIds = $this->glazeAttributeIds();
        if (empty($glazeAttributeIds)) {
            return;
        }

        $this->ensureGlazeOptions($glazeAttributeIds, ['Men rạn M5']);

        $this->repairGlazeValues($glazeAttributeIds, 'Men rạn M2', [
            '%-m2',
            '%-m2-%',
        ], [
            '% m2%',
        ]);

        $this->repairGlazeValues($glazeAttributeIds, 'Men rạn M3', [
            '%-m3',
            '%-m3-%',
        ], [
            '% m3%',
        ]);

        $this->repairGlazeValues($glazeAttributeIds, 'Men rạn M4 DAV', [
            '%-m4',
            '%-m4-%',
        ], [
            '% m4%',
        ]);

        $this->repairGlazeValues($glazeAttributeIds, 'Men rạn M5', [
            '%-m5',
            '%-m5-%',
        ], [
            '% m5%',
        ]);
    }

    public function down(): void
    {
        // Data repair only: do not restore the stale quick-filter values.
    }

    private function glazeAttributeIds(): array
    {
        $query = DB::table('attributes')
            ->where(function (Builder $attributeQuery) {
                $attributeQuery
                    ->whereRaw('LOWER(COALESCE(code, \'\')) = ?', ['loai_men'])
                    ->orWhereRaw('LOWER(COALESCE(name, \'\')) IN (?, ?)', ['loại men', 'loai men']);
            });

        if (Schema::hasColumn('attributes', 'entity_type')) {
            $query->where(function (Builder $entityQuery) {
                $entityQuery
                    ->whereNull('entity_type')
                    ->orWhere('entity_type', '')
                    ->orWhere('entity_type', 'product');
            });
        }

        return $query
            ->pluck('id')
            ->map(fn ($id) => is_numeric($id) ? (int) $id : null)
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function ensureGlazeOptions(array $attributeIds, array $values): void
    {
        if (!Schema::hasTable('attribute_options')) {
            return;
        }

        $hasOrderColumn = Schema::hasColumn('attribute_options', 'order');
        $hasCreatedAtColumn = Schema::hasColumn('attribute_options', 'created_at');
        $hasUpdatedAtColumn = Schema::hasColumn('attribute_options', 'updated_at');
        $hasSwatchValueColumn = Schema::hasColumn('attribute_options', 'swatch_value');

        foreach ($attributeIds as $attributeId) {
            foreach ($values as $value) {
                $normalizedValue = trim((string) $value);
                if ($normalizedValue === '') {
                    continue;
                }

                $optionQuery = DB::table('attribute_options')
                    ->where('attribute_id', $attributeId)
                    ->where('value', $normalizedValue);

                if ($optionQuery->exists()) {
                    continue;
                }

                $row = [
                    'attribute_id' => $attributeId,
                    'value' => $normalizedValue,
                ];

                if ($hasOrderColumn) {
                    $maxOrder = DB::table('attribute_options')
                        ->where('attribute_id', $attributeId)
                        ->max('order');
                    $row['order'] = is_numeric($maxOrder) ? ((int) $maxOrder + 1) : 0;
                }

                if ($hasCreatedAtColumn) {
                    $row['created_at'] = now();
                }

                if ($hasUpdatedAtColumn) {
                    $row['updated_at'] = now();
                }

                if ($hasSwatchValueColumn) {
                    $row['swatch_value'] = null;
                }

                DB::table('attribute_options')->insert($row);
            }
        }
    }

    private function repairGlazeValues(array $attributeIds, string $targetValue, array $skuPatterns, array $namePatterns): void
    {
        $value = json_encode([$targetValue], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($value) || $value === '') {
            return;
        }

        $updates = [
            'value' => $value,
        ];
        if (Schema::hasColumn('product_attribute_values', 'updated_at')) {
            $updates['updated_at'] = now();
        }

        DB::table('product_attribute_values')
            ->whereIn('attribute_id', $attributeIds)
            ->whereIn('value', $this->staleBaseGlazeValueCandidates())
            ->whereExists(function (Builder $productQuery) use ($skuPatterns, $namePatterns) {
                $productQuery
                    ->selectRaw('1')
                    ->from('products')
                    ->whereColumn('products.id', 'product_attribute_values.product_id')
                    ->where(function (Builder $ranQuery) {
                        $ranQuery
                            ->whereRaw('LOWER(COALESCE(products.sku, \'\')) LIKE ?', ['%ran%'])
                            ->orWhereRaw('LOWER(COALESCE(products.name, \'\')) LIKE ?', ['%rạn%'])
                            ->orWhereRaw('LOWER(COALESCE(products.name, \'\')) LIKE ?', ['%ran%']);
                    })
                    ->where(function (Builder $versionQuery) use ($skuPatterns, $namePatterns) {
                        foreach ($skuPatterns as $pattern) {
                            $versionQuery->orWhereRaw('LOWER(COALESCE(products.sku, \'\')) LIKE ?', [$pattern]);
                        }

                        foreach ($namePatterns as $pattern) {
                            $versionQuery->orWhereRaw('LOWER(COALESCE(products.name, \'\')) LIKE ?', [$pattern]);
                        }
                    });
            })
            ->update($updates);
    }

    private function staleBaseGlazeValueCandidates(): array
    {
        return array_values(array_unique([
            'Men rạn',
            'Men ran',
            json_encode(['Men rạn']),
            json_encode(['Men rạn'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]));
    }
};
