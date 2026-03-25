<?php

namespace App\Services\Inventory;

use App\Models\Product;
use App\Models\SupplierProductPrice;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

class ProductPricingService
{
    public function syncExpectedCost(
        Product $product,
        $expectedCost,
        ?int $preferredSupplierId = null,
        ?int $userId = null,
        array $options = []
    ): Product {
        $normalizedExpectedCost = $this->normalizeMoney($expectedCost);
        $supplierId = $this->resolveExpectedCostSupplierId($product, $preferredSupplierId);

        $product->forceFill([
            'expected_cost' => $normalizedExpectedCost,
            'supplier_id' => $supplierId ?? $product->supplier_id,
        ]);

        if ($product->isDirty()) {
            $product->save();
        }

        if ($supplierId) {
            $this->attachSupplierToProduct(
                $product,
                $supplierId,
                $options['account_id'] ?? $product->account_id
            );
        }

        if ($normalizedExpectedCost === null || !$supplierId) {
            return $product->fresh();
        }

        $supplierPrice = SupplierProductPrice::withoutGlobalScopes()->firstOrNew([
            'supplier_id' => $supplierId,
            'product_id' => $product->id,
        ]);

        $payload = [
            'account_id' => $options['account_id'] ?? $supplierPrice->account_id ?? $product->account_id,
            'unit_cost' => $normalizedExpectedCost,
            'updated_by' => $userId ?? Auth::id(),
        ];

        if (array_key_exists('notes', $options)) {
            $payload['notes'] = $options['notes'];
        }

        if (array_key_exists('supplier_product_code', $options)) {
            $payload['supplier_product_code'] = $this->normalizeSupplierProductCode($options['supplier_product_code']);
        }

        $supplierPrice->fill($payload);
        if ($supplierPrice->isDirty() || !$supplierPrice->exists) {
            $supplierPrice->save();
        }

        return $product->fresh();
    }

    public function syncProductFromSupplierPrice(SupplierProductPrice $supplierPrice, ?int $userId = null): Product
    {
        $product = Product::query()
            ->lockForUpdate()
            ->findOrFail((int) $supplierPrice->product_id);

        $supplierId = (int) $supplierPrice->supplier_id;
        $this->attachSupplierToProduct(
            $product,
            $supplierId,
            $supplierPrice->account_id ?? $product->account_id
        );

        $product->forceFill([
            'supplier_id' => $supplierId,
            'expected_cost' => $this->normalizeMoney($supplierPrice->unit_cost),
        ]);

        if ($product->isDirty()) {
            $product->save();
        }

        return $product->fresh();
    }

    private function resolveExpectedCostSupplierId(Product $product, ?int $preferredSupplierId = null): ?int
    {
        if ($preferredSupplierId && $preferredSupplierId > 0) {
            return $preferredSupplierId;
        }

        if ($product->supplier_id) {
            return (int) $product->supplier_id;
        }

        $supplierId = SupplierProductPrice::withoutGlobalScopes()
            ->where('product_id', $product->id)
            ->orderByDesc('updated_at')
            ->orderByDesc('id')
            ->value('supplier_id');

        if ($supplierId) {
            return (int) $supplierId;
        }

        $linkedSupplierId = DB::table('product_suppliers')
            ->where('product_id', $product->id)
            ->orderBy('id')
            ->value('supplier_id');

        return $linkedSupplierId ? (int) $linkedSupplierId : null;
    }

    private function attachSupplierToProduct(Product $product, int $supplierId, $accountId): void
    {
        DB::table('product_suppliers')->upsert(
            [[
                'product_id' => (int) $product->id,
                'supplier_id' => $supplierId,
                'account_id' => $accountId,
                'created_at' => now(),
                'updated_at' => now(),
            ]],
            ['product_id', 'supplier_id'],
            ['account_id', 'updated_at']
        );
    }

    private function normalizeMoney($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return round((float) $value, 2);
    }

    private function normalizeSupplierProductCode($value): ?string
    {
        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : null;
    }
}
