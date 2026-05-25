<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\QuoteTemplate;
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

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Quote Cache Account',
            'domain' => 'quote-cache-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'quote-cache-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

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

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }
}
