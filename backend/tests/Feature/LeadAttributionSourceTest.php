<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Lead;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class LeadAttributionSourceTest extends TestCase
{
    use RefreshDatabase;

    public function test_storefront_order_uses_session_attribution_after_product_change(): void
    {
        $account = $this->createAccount();
        $product = $this->createProduct($account, 'Product B');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/storefront/order', [
                'customer_name' => 'Tracking Customer',
                'phone' => '0987654321',
                'address' => '1 Test Street',
                'source' => 'FB',
                'landing_url' => 'https://gomdaithanh.com/product/product-a?utm_source=facebook',
                'current_url' => 'https://gomdaithanh.com/product/product-b',
                'utm_source' => 'facebook',
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 1,
                    'product_name' => $product->name,
                    'product_slug' => $product->slug,
                    'product_url' => 'https://gomdaithanh.com/product/product-b',
                    'unit_price' => 100000,
                ]],
                'total' => 100000,
            ])
            ->assertCreated();

        $lead = Lead::query()->findOrFail((int) $response->json('lead_id'));

        $this->assertSame('FB', $lead->tag);
        $this->assertSame('facebook', $lead->source);
        $this->assertSame('facebook', $lead->utm_source);
        $this->assertSame('FB', $lead->conversion_data['source'] ?? null);
        $this->assertSame('https://gomdaithanh.com/product/product-b', $lead->link_url);
    }

    public function test_known_utm_sources_are_saved_with_display_labels(): void
    {
        $account = $this->createAccount();

        $cases = [
            'facebook' => ['FB', 'facebook'],
            'google' => ['GG', 'google'],
            'tiktok' => ['Tiktok', 'tiktok'],
        ];

        foreach ($cases as $utmSource => [$expectedTag, $expectedSource]) {
            $product = $this->createProduct($account, "Product {$utmSource}");

            $response = $this
                ->withHeaders($this->headers($account))
                ->postJson('/api/storefront/order', [
                    'customer_name' => "Customer {$utmSource}",
                    'phone' => '0987654321',
                    'address' => '1 Test Street',
                    'source' => $expectedTag,
                    'landing_url' => "https://gomdaithanh.com/product/{$product->slug}?utm_source={$utmSource}",
                    'current_url' => "https://gomdaithanh.com/product/{$product->slug}",
                    'utm_source' => $utmSource,
                    'items' => [[
                        'product_id' => $product->id,
                        'quantity' => 1,
                        'product_name' => $product->name,
                        'product_slug' => $product->slug,
                        'product_url' => "https://gomdaithanh.com/product/{$product->slug}",
                        'unit_price' => 100000,
                    ]],
                    'total' => 100000,
                ])
                ->assertCreated();

            $lead = Lead::query()->findOrFail((int) $response->json('lead_id'));

            $this->assertSame($expectedTag, $lead->tag);
            $this->assertSame($expectedSource, $lead->source);
            $this->assertSame($utmSource, $lead->utm_source);
            $this->assertSame($expectedTag, $lead->conversion_data['source'] ?? null);
        }
    }

    public function test_order_without_tracking_defaults_to_website(): void
    {
        $account = $this->createAccount();
        $product = $this->createProduct($account, 'No Tracking Product');

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/storefront/order', [
                'customer_name' => 'Website Customer',
                'phone' => '0987654321',
                'address' => '1 Test Street',
                'source' => 'Website',
                'landing_url' => "https://gomdaithanh.com/product/{$product->slug}",
                'current_url' => "https://gomdaithanh.com/product/{$product->slug}",
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 1,
                    'product_name' => $product->name,
                    'product_slug' => $product->slug,
                    'product_url' => "https://gomdaithanh.com/product/{$product->slug}",
                    'unit_price' => 100000,
                ]],
                'total' => 100000,
            ])
            ->assertCreated();

        $lead = Lead::query()->findOrFail((int) $response->json('lead_id'));

        $this->assertSame('Website', $lead->tag);
        $this->assertSame('website', $lead->source);
        $this->assertNull($lead->utm_source);
        $this->assertSame('Website', $lead->conversion_data['source'] ?? null);
    }

    private function createAccount(): Account
    {
        return Account::query()->create([
            'name' => 'Attribution Test',
            'domain' => 'attribution-' . Str::lower(Str::random(8)) . '.local',
            'subdomain' => 'attribution-' . Str::lower(Str::random(8)),
            'site_code' => 'ATTR_' . Str::upper(Str::random(8)),
            'status' => true,
        ]);
    }

    private function createProduct(Account $account, string $name): Product
    {
        return Product::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(8)),
            'sku' => 'SKU-' . Str::upper(Str::random(8)),
            'price' => 100000,
            'stock_quantity' => 10,
            'status' => true,
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
