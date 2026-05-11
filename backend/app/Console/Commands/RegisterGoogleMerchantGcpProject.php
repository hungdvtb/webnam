<?php

namespace App\Console\Commands;

use App\Services\GoogleMerchant\GoogleMerchantProductSyncService;
use Illuminate\Console\Command;

class RegisterGoogleMerchantGcpProject extends Command
{
    protected $signature = 'google-merchant:register-gcp
        {developer_email? : Google account email to receive Merchant API developer notifications}';

    protected $description = 'Register the calling Google Cloud project with the Merchant Center account.';

    public function handle(GoogleMerchantProductSyncService $syncService): int
    {
        $developerEmail = trim((string) ($this->argument('developer_email') ?: config('google_merchant.developer_email', '')));

        if ($developerEmail === '') {
            $this->error('Missing developer email. Pass it as an argument or set GOOGLE_MERCHANT_DEVELOPER_EMAIL.');
            return self::FAILURE;
        }

        try {
            $response = $syncService->registerGcpProject($developerEmail);
        } catch (\Throwable $exception) {
            $this->error($exception->getMessage());
            return self::FAILURE;
        }

        $this->info("Registered GCP project for {$developerEmail}.");

        if (!empty($response)) {
            $this->line(json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        return self::SUCCESS;
    }
}
