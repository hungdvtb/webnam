<?php

namespace App\Models\Concerns;

use App\Models\Product;
use App\Support\OrderProductSnapshot;

trait HasOrderItemProductDisplay
{
    public function initializeHasOrderItemProductDisplay(): void
    {
        $this->appends = array_values(array_unique(array_merge($this->appends ?? [], [
            'snapshot_name',
            'snapshot_sku',
            'actual_snapshot_name',
            'actual_snapshot_sku',
            'current_product_name',
            'current_product_sku',
            'current_actual_product_name',
            'current_actual_product_sku',
            'display_name',
            'display_sku',
            'actual_display_name',
            'actual_display_sku',
            'has_product_snapshot_mismatch',
            'has_actual_product_override',
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

    protected function loadedActualProductForDisplay(): ?Product
    {
        if (!$this->relationLoaded('actualProduct')) {
            return null;
        }

        $product = $this->getRelation('actualProduct');

        return $product instanceof Product ? $product : null;
    }

    protected function normalizeProductIdentity(mixed $value): ?string
    {
        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : null;
    }

    public function getSnapshotNameAttribute(): ?string
    {
        $snapshotName = $this->normalizeProductIdentity($this->attributes['product_name_snapshot'] ?? null);
        $productId = (int) ($this->attributes['product_id'] ?? 0);

        if ($snapshotName !== null && OrderProductSnapshot::isPlaceholderName($snapshotName, $productId)) {
            return $this->getCurrentProductNameAttribute();
        }

        return $snapshotName;
    }

    public function getSnapshotSkuAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->attributes['product_sku_snapshot'] ?? null);
    }

    public function getActualSnapshotNameAttribute(): ?string
    {
        $snapshotName = $this->normalizeProductIdentity($this->attributes['actual_product_name_snapshot'] ?? null);
        $actualProductId = (int) ($this->attributes['actual_product_id'] ?? 0);

        if ($snapshotName !== null && OrderProductSnapshot::isPlaceholderName($snapshotName, $actualProductId)) {
            return $this->getCurrentActualProductNameAttribute();
        }

        return $snapshotName;
    }

    public function getActualSnapshotSkuAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->attributes['actual_product_sku_snapshot'] ?? null);
    }

    public function getCurrentProductNameAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->loadedProductForDisplay()?->name);
    }

    public function getCurrentProductSkuAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->loadedProductForDisplay()?->sku);
    }

    public function getCurrentActualProductNameAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->loadedActualProductForDisplay()?->name);
    }

    public function getCurrentActualProductSkuAttribute(): ?string
    {
        return $this->normalizeProductIdentity($this->loadedActualProductForDisplay()?->sku);
    }

    public function getDisplayNameAttribute(): string
    {
        return $this->getCurrentProductNameAttribute()
            ?? $this->getSnapshotNameAttribute()
            ?? ('San pham #' . ((int) ($this->attributes['product_id'] ?? 0) ?: (int) $this->getKey()));
    }

    public function getDisplaySkuAttribute(): ?string
    {
        return $this->getCurrentProductSkuAttribute()
            ?? $this->getSnapshotSkuAttribute();
    }

    public function getActualDisplayNameAttribute(): ?string
    {
        if (!$this->getHasActualProductOverrideAttribute()) {
            return null;
        }

        return $this->getCurrentActualProductNameAttribute()
            ?? $this->getActualSnapshotNameAttribute()
            ?? ('San pham #' . (int) ($this->attributes['actual_product_id'] ?? 0));
    }

    public function getActualDisplaySkuAttribute(): ?string
    {
        if (!$this->getHasActualProductOverrideAttribute()) {
            return null;
        }

        return $this->getCurrentActualProductSkuAttribute()
            ?? $this->getActualSnapshotSkuAttribute();
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

    public function getHasActualProductOverrideAttribute(): bool
    {
        $actualProductId = (int) ($this->attributes['actual_product_id'] ?? 0);
        $productId = (int) ($this->attributes['product_id'] ?? 0);

        return $actualProductId > 0 && $actualProductId !== $productId;
    }
}
