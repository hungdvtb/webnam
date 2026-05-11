<?php

namespace App\Console\Commands;

use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use Illuminate\Console\Command;

class ListGoogleMerchantDataSources extends Command
{
    protected $signature = 'google-merchant:list-data-sources';

    protected $description = 'List Google Merchant Center data sources for the configured account.';

    public function handle(GoogleMerchantProductSyncService $syncService): int
    {
        try {
            $dataSources = $syncService->listDataSources();
        } catch (\Throwable $exception) {
            $this->error($exception->getMessage());
            return self::FAILURE;
        }

        if (empty($dataSources)) {
            $this->warn('No data sources returned.');
            return self::SUCCESS;
        }

        $rows = collect($dataSources)->map(function (array $source) {
            return [
                'name' => $source['name'] ?? '',
                'id' => $source['dataSourceId'] ?? '',
                'display_name' => $source['displayName'] ?? '',
                'input' => $source['input'] ?? '',
                'type' => collect([
                    'primaryProductDataSource',
                    'supplementalProductDataSource',
                    'localInventoryDataSource',
                    'regionalInventoryDataSource',
                    'promotionDataSource',
                    'productReviewDataSource',
                    'merchantReviewDataSource',
                ])->first(fn (string $key) => array_key_exists($key, $source)) ?? '',
            ];
        })->all();

        $this->table(['name', 'id', 'display_name', 'input', 'type'], $rows);

        return self::SUCCESS;
    }
}
