<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\User;
use App\Services\ProductSkuService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductSkuIntegrityTest extends TestCase
{
    use RefreshDatabase;

    public function test_store_configurable_product_auto_generates_unique_variant_skus(): void
    {
        $account = $this->authenticate();

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products', [
                'type' => 'configurable',
                'name' => 'Bo suu tap men ngoc',
                'price' => 120000,
                'sku' => 'MEN-NGOC-01',
                'variants' => [
                    [
                        'name' => 'Xanh nhat',
                        'sku' => '',
                        'price' => 120000,
                        'stock_quantity' => 5,
                    ],
                    [
                        'name' => 'Xanh dam',
                        'sku' => '',
                        'price' => 120000,
                        'stock_quantity' => 3,
                    ],
                ],
            ]);

        $response->assertCreated();

        $product = Product::withoutGlobalScopes()
            ->with('variations')
            ->findOrFail((int) $response->json('id'));

        $variantSkus = $product->variations->pluck('sku')->sort()->values()->all();

        $this->assertSame(['MEN-NGOC-01-V1', 'MEN-NGOC-01-V2'], $variantSkus);
    }

    public function test_update_rejects_existing_variant_duplicate_sku(): void
    {
        $account = $this->authenticate();
        [$product, $variants] = $this->createConfigurableProduct($account, 'Binh gom', 'BINH-GOM-01');

        $response = $this
            ->withHeaders($this->headers($account))
            ->post("/api/products/{$product->id}", [
                'type' => 'configurable',
                'name' => $product->name,
                'price' => $product->price,
                'sku' => $product->sku,
                'variants' => [
                    [
                        'id' => $variants[0]->id,
                        'name' => $variants[0]->name,
                        'sku' => $variants[1]->sku,
                        'price' => $variants[0]->price,
                        'stock_quantity' => $variants[0]->stock_quantity,
                    ],
                    [
                        'id' => $variants[1]->id,
                        'name' => $variants[1]->name,
                        'sku' => $variants[1]->sku,
                        'price' => $variants[1]->price,
                        'stock_quantity' => $variants[1]->stock_quantity,
                    ],
                ],
            ]);

        $response
            ->assertStatus(422)
            ->assertJsonValidationErrors(['variants.0.sku']);
    }

    public function test_duplicate_clones_variants_with_new_ids_and_parent_based_skus(): void
    {
        $account = $this->authenticate();
        [$product, $variants] = $this->createConfigurableProduct($account, 'Ky nuoc nghe thuat', 'KY-NUOC-01');

        $response = $this
            ->withHeaders($this->headers($account))
            ->post("/api/products/{$product->id}/duplicate");

        $response->assertOk();

        $clone = Product::withoutGlobalScopes()
            ->with('variations')
            ->findOrFail((int) ($response->json('data.id') ?? $response->json('id')));

        $cloneVariantIds = $clone->variations->pluck('id')->all();
        $cloneVariantSkus = $clone->variations->pluck('sku')->sort()->values()->all();

        $this->assertNotSame($product->id, $clone->id);
        $this->assertNotSame($product->sku, $clone->sku);
        $this->assertCount(2, $cloneVariantIds);
        $this->assertEmpty(array_intersect($cloneVariantIds, array_map(fn (Product $variant) => $variant->id, $variants)));
        $this->assertSame([
            "{$clone->sku}-V1",
            "{$clone->sku}-V2",
        ], $cloneVariantSkus);
    }

    public function test_repair_legacy_integrity_clones_shared_variants_for_each_parent(): void
    {
        $account = $this->authenticate();

        [$originalParent, $originalVariants] = $this->createConfigurableProduct($account, 'Goc', 'GOC-01');
        $copyParent = $this->createProduct($account, [
            'type' => 'configurable',
            'name' => 'Ban sao',
            'sku' => 'GOC-01-COPY',
        ]);

        DB::statement('DROP INDEX IF EXISTS product_links_unique_super_link_variant');
        $copyParent->linkedProducts()->attach($originalVariants[0]->id, ['link_type' => 'super_link', 'position' => 0]);

        app(ProductSkuService::class)->repairLegacyIntegrity();

        $originalParent->refresh()->load('variations');
        $copyParent->refresh()->load('variations');

        $this->assertCount(2, $originalParent->variations);
        $this->assertCount(1, $copyParent->variations);
        $this->assertNotSame($originalParent->variations[0]->id, $copyParent->variations[0]->id);
        $this->assertSame($copyParent->sku . '-V1', $copyParent->variations[0]->sku);
    }

    private function authenticate(): Account
    {
        $account = Account::query()->create([
            'name' => 'Test Account',
            'domain' => 'test-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'test-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::lower(Str::random(6)) . '@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);

        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        return $account;
    }

    private function headers(Account $account): array
    {
        return [
            'X-Account-Id' => (string) $account->id,
            'Accept' => 'application/json',
        ];
    }

    private function createConfigurableProduct(Account $account, string $name, string $sku): array
    {
        $product = $this->createProduct($account, [
            'type' => 'configurable',
            'name' => $name,
            'sku' => $sku,
        ]);

        $variantA = $this->createProduct($account, [
            'name' => $name . ' - V1',
            'sku' => $sku . '-V1',
            'stock_quantity' => 5,
        ]);

        $variantB = $this->createProduct($account, [
            'name' => $name . ' - V2',
            'sku' => $sku . '-V2',
            'stock_quantity' => 7,
        ]);

        $product->linkedProducts()->attach($variantA->id, ['link_type' => 'super_link', 'position' => 0]);
        $product->linkedProducts()->attach($variantB->id, ['link_type' => 'super_link', 'position' => 1]);

        return [$product, [$variantA, $variantB]];
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        $name = $overrides['name'] ?? ('San pham ' . Str::lower(Str::random(5)));
        $sku = $overrides['sku'] ?? ('SKU-' . Str::upper(Str::random(6)));

        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(5)),
            'sku' => $sku,
            'price' => 100000,
            'stock_quantity' => 0,
            'status' => true,
        ], $overrides));
    }
}
