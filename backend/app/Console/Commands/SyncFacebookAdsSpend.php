<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

class SyncFacebookAdsSpend extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'sync:fb-ads {date?}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Sync Facebook Ads spend for a specific date (default today)';

    /**
     * Execute the console command.
     */
    public function handle(\App\Services\FacebookAdsSyncService $service)
    {
        $date = $this->argument('date') ?: date('Y-m-d');
        $this->info("Syncing Facebook Ads for: {$date}");

        $result = $service->sync($date);

        if ($result !== false) {
            $this->info("Successfully synced. Total spend: " . number_format($result) . " VNĐ");
        } else {
            $this->error("Sync failed. Check logs for details.");
        }
    }
}
