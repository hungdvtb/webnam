<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Category;
use App\Models\InventoryUnit;
use App\Models\Post;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductBulkStructuredFieldsTest extends TestCase
{
    use RefreshDatabase;

    public function test_bulk_update_attributes_can_copy_structured_sections_and_undo_them(): void
    {
        $account = $this->authenticate();
        $legacyGuidePost = $this->createPost($account, 'Huong dan cu');
        $legacyCarePost = $this->createPost($account, 'Bao quan cu');
        $guidePost = $this->createPost($account, 'Huong dan moi');
        $warrantyPost = $this->createPost($account, 'Bao hanh moi');

        $firstProduct = $this->createProduct($account, [
            'name' => 'Bo am tra men lam',
            'specifications' => json_encode([
                ['label' => 'Chieu cao', 'value' => '18cm'],
            ], JSON_UNESCAPED_UNICODE),
            'additional_info' => json_encode([
                ['title' => 'Huong dan', 'post_id' => $legacyGuidePost->id, 'post_title' => 'Huong dan cu'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $secondProduct = $this->createProduct($account, [
            'name' => 'Loc hoa gom su',
            'specifications' => json_encode([
                ['label' => 'Duong kinh', 'value' => '14cm'],
            ], JSON_UNESCAPED_UNICODE),
            'additional_info' => json_encode([
                ['title' => 'Bao quan', 'post_id' => $legacyCarePost->id, 'post_title' => 'Bao quan cu'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $copiedSpecifications = [
            ['label' => 'Chat lieu', 'value' => 'Men ran'],
            ['label' => 'Mau sac', 'value' => 'Xanh ngoc'],
        ];

        $copiedAdditionalInfo = [
            ['title' => 'Huong dan su dung', 'display_text' => '', 'post_id' => $guidePost->id, 'post_title' => 'Huong dan moi', 'post_slug' => ''],
            ['title' => 'Chinh sach bao hanh', 'display_text' => '', 'post_id' => $warrantyPost->id, 'post_title' => 'Bao hanh moi', 'post_slug' => ''],
        ];

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-attributes', [
                'ids' => [$firstProduct->id, $secondProduct->id],
                'basic_info' => [
                    'specifications' => json_encode($copiedSpecifications, JSON_UNESCAPED_UNICODE),
                    'additional_info' => json_encode($copiedAdditionalInfo, JSON_UNESCAPED_UNICODE),
                ],
            ]);

        $response->assertOk();

        $logId = (int) $response->json('log_id');

        $firstProduct->refresh();
        $secondProduct->refresh();

        $this->assertSame($copiedSpecifications, json_decode((string) $firstProduct->specifications, true));
        $this->assertSame($copiedSpecifications, json_decode((string) $secondProduct->specifications, true));
        $this->assertSame($copiedAdditionalInfo, json_decode((string) $firstProduct->additional_info, true));
        $this->assertSame($copiedAdditionalInfo, json_decode((string) $secondProduct->additional_info, true));

        $undoResponse = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-undo', [
                'log_id' => $logId,
            ]);

        $undoResponse->assertOk();

        $firstProduct->refresh();
        $secondProduct->refresh();

        $this->assertSame([
            ['label' => 'Chieu cao', 'value' => '18cm'],
        ], json_decode((string) $firstProduct->specifications, true));
        $this->assertSame([
            ['label' => 'Duong kinh', 'value' => '14cm'],
        ], json_decode((string) $secondProduct->specifications, true));
        $this->assertSame([
            ['title' => 'Huong dan', 'post_id' => $legacyGuidePost->id, 'post_title' => 'Huong dan cu'],
        ], json_decode((string) $firstProduct->additional_info, true));
        $this->assertSame([
            ['title' => 'Bao quan', 'post_id' => $legacyCarePost->id, 'post_title' => 'Bao quan cu'],
        ], json_decode((string) $secondProduct->additional_info, true));
    }

    public function test_bulk_update_attributes_can_merge_selected_structured_items_without_overwriting_other_rows(): void
    {
        $account = $this->authenticate();
        $legacyGuidePost = $this->createPost($account, 'Huong dan cu');
        $legacyCarePost = $this->createPost($account, 'Bao quan cu');
        $newGuidePost = $this->createPost($account, 'Huong dan moi');

        $firstProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 1',
            'specifications' => json_encode([
                ['label' => 'Chieu cao', 'value' => '18cm'],
                ['label' => 'Chat lieu', 'value' => 'Su cao cap'],
            ], JSON_UNESCAPED_UNICODE),
            'additional_info' => json_encode([
                ['title' => 'Huong dan', 'post_id' => $legacyGuidePost->id, 'post_title' => 'Huong dan cu'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $secondProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 2',
            'specifications' => json_encode([
                ['label' => 'Duong kinh', 'value' => '14cm'],
                ['label' => 'Mau sac', 'value' => 'Trang'],
            ], JSON_UNESCAPED_UNICODE),
            'additional_info' => json_encode([
                ['title' => 'Bao quan', 'post_id' => $legacyCarePost->id, 'post_title' => 'Bao quan cu'],
                ['title' => 'Huong dan su dung', 'post_id' => $newGuidePost->id, 'post_title' => 'Huong dan cu'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-attributes', [
                'ids' => [$firstProduct->id, $secondProduct->id],
                'merge_fields' => ['specifications', 'additional_info'],
                'basic_info' => [
                    'specifications' => json_encode([
                        ['label' => 'Chieu cao', 'value' => '20cm'],
                        ['label' => 'Mau sac', 'value' => 'Xanh ngoc'],
                    ], JSON_UNESCAPED_UNICODE),
                    'additional_info' => json_encode([
                        [
                            'title' => 'Huong dan su dung',
                            'display_text' => 'Xem chi tiet',
                            'post_id' => $newGuidePost->id,
                            'post_title' => 'Huong dan moi',
                            'post_slug' => 'huong-dan-moi',
                        ],
                    ], JSON_UNESCAPED_UNICODE),
                ],
            ]);

        $response->assertOk();

        $logId = (int) $response->json('log_id');

        $firstProduct->refresh();
        $secondProduct->refresh();

        $this->assertSame([
            ['label' => 'Chieu cao', 'value' => '20cm'],
            ['label' => 'Chat lieu', 'value' => 'Su cao cap'],
            ['label' => 'Mau sac', 'value' => 'Xanh ngoc'],
        ], json_decode((string) $firstProduct->specifications, true));
        $this->assertSame([
            ['label' => 'Duong kinh', 'value' => '14cm'],
            ['label' => 'Mau sac', 'value' => 'Xanh ngoc'],
            ['label' => 'Chieu cao', 'value' => '20cm'],
        ], json_decode((string) $secondProduct->specifications, true));
        $this->assertSame([
            ['title' => 'Huong dan', 'post_id' => $legacyGuidePost->id, 'post_title' => 'Huong dan cu'],
            [
                'title' => 'Huong dan su dung',
                'display_text' => 'Xem chi tiet',
                'post_id' => $newGuidePost->id,
                'post_title' => 'Huong dan moi',
                'post_slug' => 'huong-dan-moi',
            ],
        ], json_decode((string) $firstProduct->additional_info, true));
        $this->assertSame([
            ['title' => 'Bao quan', 'post_id' => $legacyCarePost->id, 'post_title' => 'Bao quan cu'],
            [
                'title' => 'Huong dan su dung',
                'display_text' => 'Xem chi tiet',
                'post_id' => $newGuidePost->id,
                'post_title' => 'Huong dan moi',
                'post_slug' => 'huong-dan-moi',
            ],
        ], json_decode((string) $secondProduct->additional_info, true));

        $undoResponse = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-undo', [
                'log_id' => $logId,
            ]);

        $undoResponse->assertOk();

        $firstProduct->refresh();
        $secondProduct->refresh();

        $this->assertSame([
            ['label' => 'Chieu cao', 'value' => '18cm'],
            ['label' => 'Chat lieu', 'value' => 'Su cao cap'],
        ], json_decode((string) $firstProduct->specifications, true));
        $this->assertSame([
            ['label' => 'Duong kinh', 'value' => '14cm'],
            ['label' => 'Mau sac', 'value' => 'Trang'],
        ], json_decode((string) $secondProduct->specifications, true));
        $this->assertSame([
            ['title' => 'Huong dan', 'post_id' => $legacyGuidePost->id, 'post_title' => 'Huong dan cu'],
        ], json_decode((string) $firstProduct->additional_info, true));
        $this->assertSame([
            ['title' => 'Bao quan', 'post_id' => $legacyCarePost->id, 'post_title' => 'Bao quan cu'],
            ['title' => 'Huong dan su dung', 'post_id' => $newGuidePost->id, 'post_title' => 'Huong dan cu'],
        ], json_decode((string) $secondProduct->additional_info, true));
    }

    public function test_bulk_update_attributes_can_update_suppliers_and_undo_them(): void
    {
        $account = $this->authenticate();

        $legacySupplier = $this->createSupplier($account, 'Nha cung cap cu', 'NCC-CU');
        $backupSupplier = $this->createSupplier($account, 'Nha cung cap phu', 'NCC-PHU');
        $newPrimarySupplier = $this->createSupplier($account, 'Nha cung cap moi', 'NCC-MOI');
        $newLinkedSupplier = $this->createSupplier($account, 'Nha cung cap kem', 'NCC-KEM');

        $firstProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 1',
            'supplier_id' => $legacySupplier->id,
            'expected_cost' => 150000,
        ]);
        $firstProduct->suppliers()->sync([
            $legacySupplier->id => ['account_id' => $account->id],
        ]);

        $secondProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 2',
            'supplier_id' => $backupSupplier->id,
            'expected_cost' => 180000,
        ]);
        $secondProduct->suppliers()->sync([
            $backupSupplier->id => ['account_id' => $account->id],
            $legacySupplier->id => ['account_id' => $account->id],
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-attributes', [
                'ids' => [$firstProduct->id, $secondProduct->id],
                'basic_info' => [
                    'supplier_id' => $newPrimarySupplier->id,
                    'supplier_ids' => [$newLinkedSupplier->id],
                ],
            ]);

        $response->assertOk();

        $logId = (int) $response->json('log_id');

        $firstProduct->refresh()->load('suppliers');
        $secondProduct->refresh()->load('suppliers');

        $this->assertSame($newPrimarySupplier->id, (int) $firstProduct->supplier_id);
        $this->assertSame($newPrimarySupplier->id, (int) $secondProduct->supplier_id);
        $this->assertEqualsCanonicalizing(
            [$newPrimarySupplier->id, $newLinkedSupplier->id],
            $firstProduct->suppliers->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertEqualsCanonicalizing(
            [$newPrimarySupplier->id, $newLinkedSupplier->id],
            $secondProduct->suppliers->pluck('id')->map(fn ($id) => (int) $id)->all()
        );

        $undoResponse = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-undo', [
                'log_id' => $logId,
            ]);

        $undoResponse->assertOk();

        $firstProduct->refresh()->load('suppliers');
        $secondProduct->refresh()->load('suppliers');

        $this->assertSame($legacySupplier->id, (int) $firstProduct->supplier_id);
        $this->assertSame($backupSupplier->id, (int) $secondProduct->supplier_id);
        $this->assertEqualsCanonicalizing(
            [$legacySupplier->id],
            $firstProduct->suppliers->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertEqualsCanonicalizing(
            [$backupSupplier->id, $legacySupplier->id],
            $secondProduct->suppliers->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
    }

    public function test_bulk_update_attributes_can_update_inventory_unit_and_undo_it(): void
    {
        $account = $this->authenticate();

        $legacyUnit = $this->createInventoryUnit($account, 'Bộ', 'BO');
        $newUnit = $this->createInventoryUnit($account, 'Cái', 'CAI');

        $firstProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 1',
            'inventory_unit_id' => $legacyUnit->id,
        ]);
        $secondProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 2',
            'inventory_unit_id' => null,
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-attributes', [
                'ids' => [$firstProduct->id, $secondProduct->id],
                'basic_info' => [
                    'inventory_unit_id' => $newUnit->id,
                ],
            ]);

        $response->assertOk();

        $logId = (int) $response->json('log_id');

        $firstProduct->refresh();
        $secondProduct->refresh();

        $this->assertSame($newUnit->id, (int) $firstProduct->inventory_unit_id);
        $this->assertSame($newUnit->id, (int) $secondProduct->inventory_unit_id);

        $undoResponse = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-undo', [
                'log_id' => $logId,
            ]);

        $undoResponse->assertOk();

        $firstProduct->refresh();
        $secondProduct->refresh();

        $this->assertSame($legacyUnit->id, (int) $firstProduct->inventory_unit_id);
        $this->assertNull($secondProduct->inventory_unit_id);
    }

    public function test_bulk_update_attributes_can_update_multiple_categories_and_undo_them(): void
    {
        $account = $this->authenticate();

        $legacyPrimaryCategory = $this->createCategory($account, 'Do tho', 'do-tho');
        $legacySecondaryCategory = $this->createCategory($account, 'Phong thuy', 'phong-thuy');
        $newPrimaryCategory = $this->createCategory($account, 'Trang tri', 'trang-tri');
        $newSecondaryCategory = $this->createCategory($account, 'Qua tang', 'qua-tang');

        $firstProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 1',
            'category_id' => $legacyPrimaryCategory->id,
        ]);
        $firstProduct->categories()->sync([
            $legacyPrimaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
            $legacySecondaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
        ]);

        $secondProduct = $this->createProduct($account, [
            'name' => 'Bo do tho 2',
            'category_id' => $legacySecondaryCategory->id,
        ]);
        $secondProduct->categories()->sync([
            $legacySecondaryCategory->id => ['sort_order' => 0, 'item_type' => 'product'],
        ]);

        $response = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-attributes', [
                'ids' => [$firstProduct->id, $secondProduct->id],
                'basic_info' => [
                    'category_ids' => [$newPrimaryCategory->id, $newSecondaryCategory->id],
                ],
            ]);

        $response->assertOk();

        $logId = (int) $response->json('log_id');

        $firstProduct->refresh()->load('categories');
        $secondProduct->refresh()->load('categories');

        $this->assertSame($newPrimaryCategory->id, (int) $firstProduct->category_id);
        $this->assertSame($newPrimaryCategory->id, (int) $secondProduct->category_id);
        $this->assertEqualsCanonicalizing(
            [$newPrimaryCategory->id, $newSecondaryCategory->id],
            $firstProduct->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertEqualsCanonicalizing(
            [$newPrimaryCategory->id, $newSecondaryCategory->id],
            $secondProduct->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );

        $undoResponse = $this
            ->withHeaders($this->headers($account))
            ->post('/api/products/bulk-update-undo', [
                'log_id' => $logId,
            ]);

        $undoResponse->assertOk();

        $firstProduct->refresh()->load('categories');
        $secondProduct->refresh()->load('categories');

        $this->assertSame($legacyPrimaryCategory->id, (int) $firstProduct->category_id);
        $this->assertSame($legacySecondaryCategory->id, (int) $secondProduct->category_id);
        $this->assertEqualsCanonicalizing(
            [$legacyPrimaryCategory->id, $legacySecondaryCategory->id],
            $firstProduct->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
        $this->assertEqualsCanonicalizing(
            [$legacySecondaryCategory->id],
            $secondProduct->categories->pluck('id')->map(fn ($id) => (int) $id)->all()
        );
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

    private function createSupplier(Account $account, string $name, string $code): Supplier
    {
        return Supplier::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'code' => $code,
            'status' => true,
        ]);
    }

    private function createInventoryUnit(Account $account, string $name, string $code): InventoryUnit
    {
        return InventoryUnit::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'normalized_name' => Str::lower(Str::ascii($name)),
            'code' => $code,
            'sort_order' => ((int) InventoryUnit::query()->max('sort_order')) + 1,
        ]);
    }

    private function createCategory(Account $account, string $name, string $code): Category
    {
        return Category::query()->create([
            'account_id' => $account->id,
            'name' => $name,
            'code' => $code,
            'slug' => Str::slug($name),
            'status' => true,
            'order' => 0,
        ]);
    }

    private function createPost(Account $account, string $title): Post
    {
        return Post::query()->create([
            'account_id' => $account->id,
            'title' => $title,
            'slug' => Str::slug($title) . '-' . Str::lower(Str::random(5)),
            'content' => 'Noi dung bai viet',
            'excerpt' => 'Tom tat bai viet',
            'is_published' => true,
        ]);
    }
}
