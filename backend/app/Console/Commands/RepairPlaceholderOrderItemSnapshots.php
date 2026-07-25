<?php

namespace App\Console\Commands;

use App\Support\OrderProductSnapshot;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class RepairPlaceholderOrderItemSnapshots extends Command
{
    protected $signature = 'orders:repair-placeholder-product-snapshots
        {--dry-run : Report rows without updating them}
        {--account-id= : Limit repair to one account}
        {--chunk=500 : Rows to scan per chunk}';

    protected $description = 'Replace placeholder order item product snapshots with catalog product names.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $accountId = $this->option('account-id') ? (int) $this->option('account-id') : null;
        $chunkSize = max(50, (int) $this->option('chunk'));

        $orderItems = $this->repairOrderItems($dryRun, $accountId, $chunkSize);
        $supplementItems = Schema::hasTable('order_supplement_items')
            ? $this->repairSupplementItems($dryRun, $accountId, $chunkSize)
            : 0;

        $mode = $dryRun ? 'would update' : 'updated';
        $this->info(sprintf(
            'Placeholder snapshot repair complete: %s %d order_items and %d order_supplement_items.',
            $mode,
            $orderItems,
            $supplementItems
        ));

        return self::SUCCESS;
    }

    private function repairOrderItems(bool $dryRun, ?int $accountId, int $chunkSize): int
    {
        $updated = 0;

        $query = DB::table('order_items')
            ->join('products', 'products.id', '=', 'order_items.product_id')
            ->leftJoin('products as actual_products', 'actual_products.id', '=', 'order_items.actual_product_id')
            ->select([
                'order_items.id',
                'order_items.account_id',
                'order_items.product_id',
                'order_items.actual_product_id',
                'order_items.product_name_snapshot',
                'order_items.product_sku_snapshot',
                'order_items.actual_product_name_snapshot',
                'order_items.actual_product_sku_snapshot',
                'products.name as catalog_name',
                'products.sku as catalog_sku',
                'actual_products.name as actual_catalog_name',
                'actual_products.sku as actual_catalog_sku',
            ])
            ->orderBy('order_items.id');

        if ($accountId) {
            $query->where('order_items.account_id', $accountId);
        }

        $query->chunkById($chunkSize, function ($rows) use (&$updated, $dryRun): void {
            foreach ($rows as $row) {
                $changes = [];
                $productId = (int) $row->product_id;
                $catalogName = trim((string) $row->catalog_name);
                $catalogSku = trim((string) $row->catalog_sku);

                if ($catalogName !== '' && OrderProductSnapshot::isPlaceholderName($row->product_name_snapshot, $productId)) {
                    $changes['product_name_snapshot'] = $catalogName;
                }

                if ($catalogSku !== '' && $this->isMissingSku($row->product_sku_snapshot)) {
                    $changes['product_sku_snapshot'] = $catalogSku;
                }

                $actualProductId = (int) ($row->actual_product_id ?? 0);
                $actualCatalogName = trim((string) $row->actual_catalog_name);
                $actualCatalogSku = trim((string) $row->actual_catalog_sku);

                if (
                    $actualProductId > 0
                    && $actualCatalogName !== ''
                    && OrderProductSnapshot::isPlaceholderName($row->actual_product_name_snapshot, $actualProductId)
                ) {
                    $changes['actual_product_name_snapshot'] = $actualCatalogName;
                }

                if ($actualProductId > 0 && $actualCatalogSku !== '' && $this->isMissingSku($row->actual_product_sku_snapshot)) {
                    $changes['actual_product_sku_snapshot'] = $actualCatalogSku;
                }

                if ($changes === []) {
                    continue;
                }

                $updated++;

                if (!$dryRun) {
                    DB::table('order_items')
                        ->where('id', $row->id)
                        ->update($changes);
                }
            }
        }, 'order_items.id', 'id');

        return $updated;
    }

    private function repairSupplementItems(bool $dryRun, ?int $accountId, int $chunkSize): int
    {
        $updated = 0;

        $query = DB::table('order_supplement_items')
            ->join('products', 'products.id', '=', 'order_supplement_items.product_id')
            ->select([
                'order_supplement_items.id',
                'order_supplement_items.account_id',
                'order_supplement_items.product_id',
                'order_supplement_items.product_name_snapshot',
                'order_supplement_items.product_sku_snapshot',
                'products.name as catalog_name',
                'products.sku as catalog_sku',
            ])
            ->orderBy('order_supplement_items.id');

        if ($accountId) {
            $query->where('order_supplement_items.account_id', $accountId);
        }

        $query->chunkById($chunkSize, function ($rows) use (&$updated, $dryRun): void {
            foreach ($rows as $row) {
                $changes = [];
                $productId = (int) $row->product_id;
                $catalogName = trim((string) $row->catalog_name);
                $catalogSku = trim((string) $row->catalog_sku);

                if ($catalogName !== '' && OrderProductSnapshot::isPlaceholderName($row->product_name_snapshot, $productId)) {
                    $changes['product_name_snapshot'] = $catalogName;
                }

                if ($catalogSku !== '' && $this->isMissingSku($row->product_sku_snapshot)) {
                    $changes['product_sku_snapshot'] = $catalogSku;
                }

                if ($changes === []) {
                    continue;
                }

                $updated++;

                if (!$dryRun) {
                    DB::table('order_supplement_items')
                        ->where('id', $row->id)
                        ->update($changes);
                }
            }
        }, 'order_supplement_items.id', 'id');

        return $updated;
    }

    private function isMissingSku(mixed $value): bool
    {
        $sku = trim((string) $value);

        return $sku === '' || strtoupper($sku) === 'N/A';
    }
}
