<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Attribute;
use App\Models\AttributeOption;
use App\Models\Category;
use App\Models\InventoryBatch;
use App\Models\InventoryDocument;
use App\Models\InventoryDocumentItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\ProductAttributeValue;
use App\Models\ProductImage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductSingleToVariantConversionTest extends TestCase
{
    use RefreshDatabase;

    public function test_convert_simple_product_to_configurable_keeps_existing_product_as_first_variant(): void
    {
        [$account, $user] = $this->authenticate();
        $category = $this->createCategory($account, 'Do tho');
        $legacyAttribute = $this->createProductAttribute($account, 'Loai men', ['Men lam']);

        $product = $this->createProduct($account, [
            'name' => 'Nam tho co dien',
            'slug' => 'nam-tho-co-dien',
            'sku' => 'NAM-CO-DIEN',
            'category_id' => $category->id,
            'price' => 240000,
            'expected_cost' => 120000,
            'cost_price' => 118000,
            'stock_quantity' => 12,
        ]);
        $product->categories()->sync([$category->id => ['sort_order' => 0]]);
        ProductImage::query()->create([
            'product_id' => $product->id,
            'image_url' => 'https://example.test/images/nam-tho-co-dien.jpg',
            'is_primary' => true,
            'sort_order' => 0,
        ]);
        ProductAttributeValue::query()->create([
            'product_id' => $product->id,
            'attribute_id' => $legacyAttribute->id,
            'value' => 'Men lam',
        ]);

        $order = Order::query()->create([
            'account_id' => $account->id,
            'user_id' => $user->id,
            'order_number' => 'ORD-' . Str::upper(Str::random(8)),
            'total_price' => 240000,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 118000,
            'status' => 'processing',
            'customer_name' => 'Khach cu',
            'customer_email' => 'old-order@example.com',
            'customer_phone' => '0900000000',
            'shipping_address' => '1 Test Street',
            'district' => 'Quan 1',
            'ward' => 'Phuong 1',
        ]);
        OrderItem::query()->create([
            'order_id' => $order->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 1,
            'price' => 240000,
            'cost_price' => 118000,
            'cost_total' => 118000,
            'profit_total' => 122000,
        ]);

        $batch = InventoryBatch::query()->create([
            'account_id' => $account->id,
            'product_id' => $product->id,
            'batch_number' => 'BATCH-' . Str::upper(Str::random(8)),
            'received_at' => now(),
            'quantity' => 12,
            'remaining_quantity' => 12,
            'unit_cost' => 118000,
            'status' => 'open',
        ]);

        $document = InventoryDocument::query()->create([
            'account_id' => $account->id,
            'document_number' => 'DOC-' . Str::upper(Str::random(8)),
            'type' => 'adjustment',
            'document_date' => now()->toDateString(),
            'status' => 'completed',
            'total_quantity' => 12,
            'total_amount' => 1416000,
            'created_by' => $user->id,
        ]);
        InventoryDocumentItem::query()->create([
            'account_id' => $account->id,
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'product_name_snapshot' => $product->name,
            'product_sku_snapshot' => $product->sku,
            'quantity' => 12,
            'stock_bucket' => 'sellable',
            'direction' => 'in',
            'unit_cost' => 118000,
            'total_cost' => 1416000,
        ]);

        $bundle = $this->createProduct($account, [
            'name' => 'Bo tho gom',
            'slug' => 'bo-tho-gom',
            'sku' => 'BUNDLE-THO-GOM',
            'type' => 'bundle',
            'category_id' => $category->id,
            'price' => 240000,
        ]);
        $bundle->bundleItems()->attach($product->id, [
            'link_type' => 'bundle',
            'position' => 0,
            'quantity' => 1,
            'is_required' => true,
            'option_title' => 'Mac dinh',
            'is_default' => true,
            'price' => 240000,
            'cost_price' => 118000,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->postJson("/api/products/{$product->id}/convert-to-configurable", [
                'attribute_name' => 'Mau',
                'variants' => [
                    [
                        'value' => 'Co dien',
                        'name' => 'Nam tho co dien',
                    ],
                    [
                        'value' => 'Khac sen',
                        'name' => 'Nam tho khac sen',
                        'sku' => 'NAM-KHAC-SEN',
                        'price' => 260000,
                        'expected_cost' => 130000,
                    ],
                ],
            ]);

        $response
            ->assertOk()
            ->assertJsonPath('data.type', 'configurable');

        $parentId = (int) $response->json('parent_product_id');
        $this->assertNotSame($product->id, $parentId);

        $product->refresh();
        $product->load(['parentConfigurable', 'attributeValues']);
        $parent = Product::query()->with(['variations.attributeValues', 'superAttributes.options', 'images', 'attributeValues'])->findOrFail($parentId);
        $newVariant = $parent->variations->firstWhere('sku', 'NAM-KHAC-SEN');

        $this->assertSame('simple', $product->type);
        $this->assertSame(12, (int) $product->stock_quantity);
        $this->assertSame($parentId, (int) $product->parentConfigurable->first()->id);
        $this->assertSame('configurable', $parent->type);
        $this->assertSame(0, (int) $parent->stock_quantity);
        $this->assertCount(2, $parent->variations);
        $this->assertNotNull($newVariant);

        $variantAttribute = $parent->superAttributes->first();
        $this->assertNotNull($variantAttribute);
        $this->assertSame('Mau', $variantAttribute->name);
        $this->assertSame(['Co dien', 'Khac sen'], $variantAttribute->options->pluck('value')->sort()->values()->all());

        $this->assertSame('Co dien', ProductAttributeValue::query()
            ->where('product_id', $product->id)
            ->where('attribute_id', $variantAttribute->id)
            ->value('value'));
        $this->assertSame('Khac sen', ProductAttributeValue::query()
            ->where('product_id', $newVariant->id)
            ->where('attribute_id', $variantAttribute->id)
            ->value('value'));

        $this->assertDatabaseHas('order_items', [
            'order_id' => $order->id,
            'product_id' => $product->id,
            'product_sku_snapshot' => 'NAM-CO-DIEN',
        ]);
        $this->assertDatabaseHas('inventory_batches', [
            'id' => $batch->id,
            'product_id' => $product->id,
            'remaining_quantity' => 12,
        ]);
        $this->assertDatabaseHas('inventory_document_items', [
            'inventory_document_id' => $document->id,
            'product_id' => $product->id,
            'product_sku_snapshot' => 'NAM-CO-DIEN',
        ]);
        $this->assertDatabaseHas('product_links', [
            'product_id' => $bundle->id,
            'linked_product_id' => $product->id,
            'link_type' => 'bundle',
        ]);
        $this->assertDatabaseHas('product_links', [
            'product_id' => $parentId,
            'linked_product_id' => $product->id,
            'link_type' => 'super_link',
            'position' => 0,
        ]);
        $this->assertDatabaseHas('products', [
            'id' => $parentId,
            'type' => 'configurable',
            'category_id' => $category->id,
        ]);
        $this->assertDatabaseHas('products', [
            'id' => $newVariant->id,
            'type' => 'simple',
            'sku' => 'NAM-KHAC-SEN',
            'stock_quantity' => 0,
        ]);

        $this->assertSame('Men lam', ProductAttributeValue::query()
            ->where('product_id', $parentId)
            ->where('attribute_id', $legacyAttribute->id)
            ->value('value'));
        $this->assertSame(1, $parent->images()->count());
    }

    public function test_update_rejects_direct_type_change_from_simple_to_configurable(): void
    {
        [$account] = $this->authenticate();
        $product = $this->createProduct($account, [
            'name' => 'Nam don',
            'slug' => 'nam-don',
            'sku' => 'NAM-DON',
        ]);

        $this->withHeaders($this->headers($account))
            ->postJson("/api/products/{$product->id}", [
                'type' => 'configurable',
                'name' => 'Nam don',
                'price' => 100000,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['type']);
    }

    public function test_bundle_with_configurable_item_requires_specific_variant_selection(): void
    {
        [$account] = $this->authenticate();

        $parent = $this->createProduct($account, [
            'name' => 'Nam men',
            'slug' => 'nam-men',
            'sku' => 'NAM-MEN',
            'type' => 'configurable',
            'price' => 200000,
        ]);
        $variant = $this->createProduct($account, [
            'name' => 'Nam men xanh',
            'slug' => 'nam-men-xanh',
            'sku' => 'NAM-MEN-XANH',
            'price' => 200000,
        ]);
        $parent->linkedProducts()->attach($variant->id, [
            'link_type' => 'super_link',
            'position' => 0,
        ]);

        $this->withHeaders($this->headers($account))
            ->postJson('/api/products', [
                'type' => 'bundle',
                'name' => 'Bo bundle',
                'sku' => 'BUNDLE-NAM',
                'price' => 200000,
                'grouped_items' => [
                    [
                        'id' => $parent->id,
                        'quantity' => 1,
                        'is_required' => true,
                        'option_title' => 'Mac dinh',
                    ],
                ],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['grouped_items.0.variant_id']);
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'Convert Test Account',
            'domain' => 'convert-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'convert-' . Str::lower(Str::random(6)),
            'status' => true,
        ]);

        $user = User::query()->create([
            'name' => 'Convert Admin',
            'email' => 'convert-' . Str::lower(Str::random(6)) . '@example.com',
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

    private function createCategory(Account $account, string $name): Category
    {
        return Category::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(4)),
            'status' => true,
        ]);
    }

    private function createProductAttribute(Account $account, string $name, array $options = []): Attribute
    {
        $attribute = Attribute::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'entity_type' => 'product',
            'code' => Str::slug($name, '_') . '_' . Str::lower(Str::random(4)),
            'frontend_type' => 'select',
            'is_filterable' => false,
            'is_filterable_frontend' => false,
            'is_filterable_backend' => true,
            'is_required' => false,
            'is_variant' => false,
            'status' => true,
        ]);

        foreach ($options as $index => $value) {
            AttributeOption::query()->create([
                'attribute_id' => $attribute->id,
                'value' => $value,
                'order' => $index,
            ]);
        }

        return $attribute;
    }

    private function createProduct(Account $account, array $overrides = []): Product
    {
        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'name' => 'Test Product',
            'slug' => 'test-product-' . Str::lower(Str::random(6)),
            'sku' => 'TEST-' . Str::upper(Str::random(6)),
            'price' => 100000,
            'expected_cost' => 50000,
            'cost_price' => 50000,
            'type' => 'simple',
            'status' => true,
            'stock_quantity' => 0,
            'damaged_quantity' => 0,
        ], $overrides));
    }
}
