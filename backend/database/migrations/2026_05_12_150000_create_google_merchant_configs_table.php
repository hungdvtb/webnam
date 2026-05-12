<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const KEY_PREFIX = 'google_merchant_';

    private const LEGACY_KEYS = [
        'enabled',
        'merchant_id',
        'data_source_id',
        'data_source_name',
        'developer_email',
        'credential_type',
        'service_account_json',
        'oauth_client_id',
        'oauth_client_secret',
        'oauth_refresh_token',
        'access_token',
        'content_language',
        'feed_label',
        'currency',
        'offer_id_field',
        'product_url_base',
        'default_brand',
        'default_google_product_category',
        'inactive_action',
    ];

    public function up(): void
    {
        if (!Schema::hasTable('google_merchant_configs')) {
            Schema::create('google_merchant_configs', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('account_id')->unique();
                $table->boolean('enabled')->default(false);
                $table->string('merchant_id', 64)->nullable();
                $table->string('data_source_id', 128)->nullable();
                $table->string('data_source_name')->nullable();
                $table->string('developer_email')->nullable();
                $table->string('credential_type', 32)->default('service_account');
                $table->longText('service_account_json')->nullable();
                $table->string('service_account_manifest_name')->nullable();
                $table->string('oauth_client_id')->nullable();
                $table->longText('oauth_client_secret')->nullable();
                $table->longText('oauth_refresh_token')->nullable();
                $table->longText('access_token')->nullable();
                $table->string('content_language', 2)->default('vi');
                $table->string('feed_label', 20)->default('VN');
                $table->string('currency', 3)->default('VND');
                $table->string('offer_id_field', 16)->default('sku');
                $table->string('product_url_base')->nullable();
                $table->string('default_brand', 120)->nullable();
                $table->string('default_google_product_category', 750)->nullable();
                $table->string('inactive_action', 32)->default('out_of_stock');
                $table->timestamps();
            });
        }

        $this->copyLegacySiteSettings();
    }

    public function down(): void
    {
        Schema::dropIfExists('google_merchant_configs');
    }

    private function copyLegacySiteSettings(): void
    {
        if (!Schema::hasTable('site_settings') || !Schema::hasTable('google_merchant_configs')) {
            return;
        }

        $storageKeys = array_map(
            fn (string $key) => self::KEY_PREFIX . $key,
            self::LEGACY_KEYS
        );

        $rows = DB::table('site_settings')
            ->whereIn('key', $storageKeys)
            ->get(['account_id', 'key', 'value']);

        if ($rows->isEmpty()) {
            return;
        }

        $configsByAccount = [];
        foreach ($rows as $row) {
            $key = substr((string) $row->key, strlen(self::KEY_PREFIX));
            if (!in_array($key, self::LEGACY_KEYS, true)) {
                continue;
            }

            $configsByAccount[(int) $row->account_id][$key] = $row->value;
        }

        $now = now();
        foreach ($configsByAccount as $accountId => $values) {
            if ($accountId <= 0) {
                continue;
            }

            if (DB::table('google_merchant_configs')->where('account_id', $accountId)->exists()) {
                continue;
            }

            $insert = [
                'account_id' => $accountId,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            foreach (self::LEGACY_KEYS as $key) {
                if (array_key_exists($key, $values)) {
                    $insert[$key] = $values[$key];
                }
            }

            DB::table('google_merchant_configs')->insert($insert);
        }
    }
};
