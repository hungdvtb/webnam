<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\QuoteTemplate;
use App\Models\SiteSetting;
use App\Models\User;
use App\Support\OrderBootstrapCache;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderBootstrapCacheInvalidationTest extends TestCase
{
    use RefreshDatabase;

    public function test_updating_quote_template_invalidates_order_form_bootstrap_cache(): void
    {
        [$account] = $this->authenticate();
        $template = QuoteTemplate::query()->create([
            'account_id' => $account->id,
            'name' => 'Men lam',
            'image_url' => 'https://example.com/old-template.png',
            'sort_order' => 0,
            'is_active' => true,
        ]);

        $cacheKey = OrderBootstrapCache::key($account->id, OrderBootstrapCache::MODE_FORM);
        Cache::put($cacheKey, ['quote_templates' => [['id' => $template->id]]], now()->addMinutes(5));

        $this->assertTrue(Cache::has($cacheKey));

        $response = $this
            ->withHeaders($this->headers($account))
            ->putJson("/api/quote-templates/{$template->id}", [
                'name' => 'Men lam moi',
                'image_url' => 'https://example.com/new-template.png',
                'sort_order' => 1,
                'is_active' => true,
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('name', 'Men lam moi')
            ->assertJsonPath('image_url', 'https://example.com/new-template.png');

        $this->assertFalse(Cache::has($cacheKey));
    }

    public function test_saving_site_settings_invalidates_order_form_bootstrap_cache(): void
    {
        [$account] = $this->authenticate();

        $cacheKey = OrderBootstrapCache::key($account->id, OrderBootstrapCache::MODE_FORM);
        Cache::put($cacheKey, ['quote_settings' => ['quote_store_name' => 'Ten cu']], now()->addMinutes(5));

        $this->assertTrue(Cache::has($cacheKey));

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/site-settings', [
                'account_id' => $account->id,
                'settings' => [
                    'quote_store_name' => 'Ten moi',
                    'quote_store_phone' => '0900000000',
                ],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('message', 'Settings updated successfully');

        $this->assertFalse(Cache::has($cacheKey));
    }

    public function test_order_form_bootstrap_deduplicates_product_attribute_options_by_value(): void
    {
        [$account] = $this->authenticate();
        $attribute = Attribute::query()->create([
            'account_id' => $account->id,
            'name' => 'Loai men',
            'code' => 'loai-men-' . Str::lower(Str::random(6)),
            'entity_type' => 'product',
            'frontend_type' => 'select',
            'is_filterable' => true,
            'is_filterable_frontend' => true,
            'is_filterable_backend' => true,
            'status' => true,
            'sort_order' => 0,
        ]);

        foreach ([
            ['value' => 'Men ran', 'order' => 0],
            ['value' => 'Men ran', 'order' => 1],
            ['value' => 'Men lam', 'order' => 2],
            ['value' => 'Men lam', 'order' => 3],
        ] as $option) {
            AttributeOption::query()->create([
                'attribute_id' => $attribute->id,
                ...$option,
            ]);
        }

        $response = $this
            ->withHeaders($this->headers($account))
            ->getJson('/api/orders/bootstrap?mode=form');

        $response->assertOk();

        $attributePayload = collect($response->json('product_attributes'))
            ->firstWhere('id', $attribute->id);

        $this->assertNotNull($attributePayload);
        $this->assertSame(
            ['Men ran', 'Men lam'],
            collect($attributePayload['options'])->pluck('value')->all()
        );
    }

    public function test_order_form_bootstrap_uses_linked_account_quote_config_when_selected_account_has_none(): void
    {
        [$sourceAccount, $user] = $this->authenticate();
        $linkedAccount = $this->createAccount('quote-linked');
        $linkedAccount->update([
            'catalog_account_id' => $sourceAccount->id,
            'inventory_account_id' => $sourceAccount->id,
        ]);
        $user->accounts()->attach($linkedAccount->id, ['role' => 'manager']);

        $this->createQuoteConfig($sourceAccount, 'Men lam linked');

        $response = $this
            ->withHeaders($this->headers($linkedAccount))
            ->getJson('/api/orders/bootstrap?mode=form');

        $response->assertOk();
        $response->assertJsonPath('quote_settings.quote_store_name', 'Gom Dai Thanh');
        $this->assertSame(['Men lam linked'], collect($response->json('quote_templates'))->pluck('name')->all());
    }

    public function test_order_form_bootstrap_uses_first_configured_quote_account_when_selected_account_has_no_quote_templates(): void
    {
        [$configuredAccount, $user] = $this->authenticate();
        $emptyAccount = $this->createAccount('quote-empty');
        $user->accounts()->attach($emptyAccount->id, ['role' => 'manager']);

        $this->createQuoteConfig($configuredAccount, 'Men ran shared');

        $response = $this
            ->withHeaders($this->headers($emptyAccount))
            ->getJson('/api/orders/bootstrap?mode=form');

        $response->assertOk();
        $response->assertJsonPath('quote_settings.quote_store_name', 'Gom Dai Thanh');
        $this->assertSame(['Men ran shared'], collect($response->json('quote_templates'))->pluck('name')->all());
    }

    private function authenticate(): array
    {
        $account = $this->createAccount('quote-cache');

        $user = User::query()->create([
            'name' => 'Quote Cache Admin',
            'email' => 'quote-cache-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return [$account, $user];
    }

    private function createAccount(string $prefix): Account
    {
        $slug = $prefix . '-' . Str::lower(Str::random(6));

        return Account::query()->create([
            'name' => 'Quote Account ' . $slug,
            'domain' => $slug . '.local',
            'subdomain' => $slug,
            'status' => true,
        ]);
    }

    private function createQuoteConfig(Account $account, string $templateName): QuoteTemplate
    {
        SiteSetting::setValue('quote_store_name', 'Gom Dai Thanh', $account->id);
        SiteSetting::setValue('quote_store_phone', '0326250356', $account->id);

        return QuoteTemplate::query()->create([
            'account_id' => $account->id,
            'name' => $templateName,
            'image_url' => 'https://example.com/' . Str::slug($templateName) . '.png',
            'sort_order' => 0,
            'is_active' => true,
        ]);
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }
}
