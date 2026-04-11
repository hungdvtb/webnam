<?php

namespace App\Models\Concerns;

use App\Models\Product;

trait HasOrderItemProductDisplay
{
    public function initializeHasOrderItemProductDisplay(): void
    {
        $this->appends = array_values(array_unique(array_merge($this->appends ?? [], [
            'snapshot_name',
            'snapshot_sku',
            'current_product_name',
            'current_product_sku',
            'display_name',
            'display_sku',
            'has_product_snapshot_mismatch',
        ])));
    }

    protected function loadedProductForDisplay(): ?Product
    {
        if (!$this->relationLoaded('product')) {
            return null;
        }

        $product = $this->getRelation('product');

        return $product instanceof Product ? $product : null;
    }

    protected function normalizeProductIdentity(mixed $value): ?string
    {
        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : null;
    }

    public function getSnapshotNameAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->attributes['product_name_snapshot'] ?? null);
    }

    public function getSnapshotSkuAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->attributes['product_sku_snapshot'] ?? null);
    }

    public function getCurrentProductNameAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->loadedProductForDisplay()?->name);
    }

    public function getCurrentProductSkuAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->loadedProductForDisplay()?->sku);
    }

    public function getDisplayNameAttribute(): string
    {
        return $this->getCurrentProductNameAttribute()
            ?? $this->getSnapshotNameAttribute()
            ?? ('Sản phẩm #' . ((int) ($this->attributes['product_id'] ?? 0) ?: (int) $this->getKey()));
    }

    public function getDisplaySkuAttribute(): ?string
    {
        return $this->getCurrentProductSkuAttribute()
            ?? $this->getSnapshotSkuAttribute();
    }

    public function getHasProductSnapshotMismatchAttribute(): bool
    {
        $currentName = $this->getCurrentProductNameAttribute();
        $currentSku = $this->getCurrentProductSkuAttribute();
        $snapshotName = $this->getSnapshotNameAttribute();
        $snapshotSku = $this->getSnapshotSkuAttribute();

        if ($currentName === null && $currentSku === null) {
            return false;
        }

        return ($currentName !== null && $snapshotName !== null && $currentName !== $snapshotName)
            || ($currentSku !== null && $snapshotSku !== null && $currentSku !== $snapshotSku);
    }
}
