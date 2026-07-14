<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\Store;
use App\Models\StorefrontTheme;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StorefrontThemeApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_theme_can_be_renamed_and_assigned_to_existing_account(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $account = Account::query()->create([
            'name' => 'Theme Account',
            'subdomain' => 'theme-account',
            'site_code' => 'THEME_ACCOUNT',
            'status' => true,
        ]);
        $theme = $this->createTheme('theme-account-test', 'Giao diện số 1');

        $this
            ->putJson("/api/storefront-themes/{$theme->id}", [
                'name' => 'Giao diện bán hàng chính',
            ])
            ->assertOk()
            ->assertJsonPath('name', 'Giao diện bán hàng chính');

        $this
            ->putJson("/api/accounts/{$account->id}", [
                'name' => $account->name,
                'domain' => $account->domain,
                'subdomain' => $account->subdomain,
                'site_code' => $account->site_code,
                'status' => true,
                'storefront_theme_id' => $theme->id,
            ])
            ->assertOk()
            ->assertJsonPath('storefront_theme_id', $theme->id)
            ->assertJsonPath('storefront_theme.name', 'Giao diện bán hàng chính');

        $this->assertDatabaseHas('accounts', [
            'id' => $account->id,
            'storefront_theme_id' => $theme->id,
        ]);
    }

    public function test_theme_can_be_renamed_and_assigned_to_existing_store(): void
    {
        Sanctum::actingAs(User::factory()->create(['is_admin' => true]), ['*']);

        $account = Account::query()->create([
            'name' => 'Theme Store',
            'subdomain' => 'theme-store',
            'site_code' => 'THEME_STORE',
            'status' => true,
        ]);
        $theme = $this->createTheme('theme-one-test', 'Giao diện số 1');
        $store = Store::query()->create([
            'account_id' => $account->id,
            'name' => 'Showroom Ha Noi',
            'slug' => 'showroom-ha-noi',
            'status' => true,
        ]);

        $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->putJson("/api/storefront-themes/{$theme->id}", [
                'name' => 'Giao diện bán hàng chính',
            ])
            ->assertOk()
            ->assertJsonPath('name', 'Giao diện bán hàng chính');

        $this
            ->withHeader('X-Account-Id', (string) $account->id)
            ->putJson("/api/stores/{$store->id}", [
                'storefront_theme_id' => $theme->id,
            ])
            ->assertOk()
            ->assertJsonPath('storefront_theme_id', $theme->id)
            ->assertJsonPath('storefront_theme.name', 'Giao diện bán hàng chính');

        $this->assertDatabaseHas('stores', [
            'id' => $store->id,
            'storefront_theme_id' => $theme->id,
        ]);
    }

    public function test_product_detail_uses_theme_assigned_to_product_store_before_account_theme(): void
    {
        $account = Account::query()->create([
            'name' => 'Theme Product Store',
            'subdomain' => 'theme-product-store',
            'site_code' => 'THEME_PRODUCT',
            'status' => true,
        ]);
        $accountTheme = $this->createTheme('account-theme-test', 'Account theme');
        $storeTheme = $this->createTheme('store-theme-test', 'Store theme');
        $account->update(['storefront_theme_id' => $accountTheme->id]);
        $store = Store::query()->create([
            'account_id' => $account->id,
            'storefront_theme_id' => $storeTheme->id,
            'name' => 'Showroom Store Theme',
            'slug' => 'showroom-store-theme',
            'status' => true,
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'store_id' => $store->id,
            'type' => 'simple',
            'name' => 'Product with store theme',
            'slug' => 'product-with-store-theme',
            'sku' => 'STORE-THEME-001',
            'price' => 100000,
            'status' => true,
        ]);

        $this
            ->withHeaders([
                'X-Site-Code' => 'THEME_PRODUCT',
                'X-Public-Host' => 'localhost:3000',
            ])
            ->getJson('/api/web-api/products/product-with-store-theme')
            ->assertOk()
            ->assertJsonPath('storefront_theme.code', 'store-theme-test')
            ->assertJsonPath('storefront_theme.name', 'Store theme');
    }

    public function test_product_detail_uses_product_type_theme_assigned_to_account(): void
    {
        $account = Account::query()->create([
            'name' => 'Product Type Theme Account',
            'subdomain' => 'product-type-theme',
            'site_code' => 'PRODUCT_TYPE_THEME',
            'status' => true,
        ]);
        $simpleTheme = $this->createTheme('simple-theme-test', 'Simple theme');
        $configurableTheme = $this->createTheme('configurable-theme-test', 'Configurable theme', 'configurable');
        $bundleTheme = $this->createTheme('bundle-theme-test', 'Bundle theme', 'bundle');
        $account->update([
            'simple_product_theme_id' => $simpleTheme->id,
            'configurable_product_theme_id' => $configurableTheme->id,
            'bundle_product_theme_id' => $bundleTheme->id,
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'Simple product theme product',
            'slug' => 'simple-product-theme-product',
            'sku' => 'SIMPLE-THEME-001',
            'price' => 100000,
            'status' => true,
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'configurable',
            'name' => 'Configurable product theme product',
            'slug' => 'configurable-product-theme-product',
            'sku' => 'CONFIG-THEME-001',
            'price' => 120000,
            'status' => true,
        ]);

        Product::query()->create([
            'account_id' => $account->id,
            'type' => 'bundle',
            'name' => 'Bundle product theme product',
            'slug' => 'bundle-product-theme-product',
            'sku' => 'BUNDLE-THEME-001',
            'price' => 200000,
            'status' => true,
        ]);

        $headers = [
            'X-Site-Code' => 'PRODUCT_TYPE_THEME',
            'X-Public-Host' => 'localhost:3000',
        ];

        $this
            ->withHeaders($headers)
            ->getJson('/api/web-api/products/simple-product-theme-product')
            ->assertOk()
            ->assertJsonPath('storefront_theme.code', 'simple-theme-test');

        $this
            ->withHeaders($headers)
            ->getJson('/api/web-api/products/configurable-product-theme-product')
            ->assertOk()
            ->assertJsonPath('storefront_theme.code', 'configurable-theme-test');

        $this
            ->withHeaders($headers)
            ->getJson('/api/web-api/products/bundle-product-theme-product')
            ->assertOk()
            ->assertJsonPath('storefront_theme.code', 'bundle-theme-test');
    }

    private function createTheme(string $code, string $name, string $productType = 'simple'): StorefrontTheme
    {
        return StorefrontTheme::query()->create([
            'name' => $name,
            'code' => $code,
            'folder' => $code,
            'product_type' => $productType,
            'status' => true,
            'is_default' => false,
            'sort_order' => 10,
        ]);
    }
}
