<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
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

        $firstProduct = $this->createProduct($account, [
            'name' => 'Bo am tra men lam',
            'specifications' => json_encode([
                ['label' => 'Chieu cao', 'value' => '18cm'],
            ], JSON_UNESCAPED_UNICODE),
            'additional_info' => json_encode([
                ['title' => 'Huong dan', 'post_id' => 101, 'post_title' => 'Huong dan cu'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $secondProduct = $this->createProduct($account, [
            'name' => 'Loc hoa gom su',
            'specifications' => json_encode([
                ['label' => 'Duong kinh', 'value' => '14cm'],
            ], JSON_UNESCAPED_UNICODE),
            'additional_info' => json_encode([
                ['title' => 'Bao quan', 'post_id' => 202, 'post_title' => 'Bao quan cu'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $copiedSpecifications = [
            ['label' => 'Chat lieu', 'value' => 'Men ran'],
            ['label' => 'Mau sac', 'value' => 'Xanh ngoc'],
        ];

        $copiedAdditionalInfo = [
            ['title' => 'Huong dan su dung', 'post_id' => 301, 'post_title' => 'Huong dan moi'],
            ['title' => 'Chinh sach bao hanh', 'post_id' => 302, 'post_title' => 'Bao hanh moi'],
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
            ['title' => 'Huong dan', 'post_id' => 101, 'post_title' => 'Huong dan cu'],
        ], json_decode((string) $firstProduct->additional_info, true));
        $this->assertSame([
            ['title' => 'Bao quan', 'post_id' => 202, 'post_title' => 'Bao quan cu'],
        ], json_decode((string) $secondProduct->additional_info, true));
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
}
