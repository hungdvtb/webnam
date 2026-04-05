<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderAiTrainingDatasetTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_overwrite_and_delete_ai_training_dataset(): void
    {
        [$account] = $this->authenticate();

        $initialProduct = $this->createProduct($account, [
            'name' => 'Bat huong men lam 18',
            'sku' => 'BAT-18-ML',
        ]);
        $replacementProduct = $this->createProduct($account, [
            'name' => 'Bat huong men lam 20',
            'sku' => 'BAT-20-ML',
        ]);

        $createResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/ai/training', [
                'rule_key' => 'ban-1m97-men-lam',
                'altar_size_label' => '1m97',
                'altar_size_aliases' => ['1m97', 'ban 1m97'],
                'context_aliases' => ['men lam'],
                'input_type' => 'text',
                'source_name' => 'Nhap tay',
                'training_note' => 'Bo men lam cho ban 1m97',
                'input_text' => 'ban 1m97, bat huong men lam',
                'parsed_raw_text' => 'ban 1m97, bat huong men lam',
                'parsed_result' => [
                    'raw_text' => 'ban 1m97, bat huong men lam',
                    'summary' => ['mapped' => 1],
                ],
                'mapping_items' => [
                    [
                        'aliases' => ['bat huong', 'bat'],
                        'default_quantity' => 1,
                        'target_product_id' => $initialProduct->id,
                        'entry_kind' => 'product',
                        'display_name' => $initialProduct->name,
                        'display_sku' => $initialProduct->sku,
                        'price' => 500000,
                        'cost_price' => 300000,
                    ],
                ],
            ]);

        $createResponse
            ->assertOk()
            ->assertJsonPath('data.rule_key', 'ban-1m97-men-lam')
            ->assertJsonPath('data.items_count', 1)
            ->assertJsonCount(1, 'data.mapping_items');

        $datasetId = (int) $createResponse->json('data.id');
        $this->assertGreaterThan(0, $datasetId);

        $this->withHeaders($this->headers($account))
            ->getJson('/api/orders/ai/training')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $datasetId);

        $this->withHeaders($this->headers($account))
            ->getJson('/api/orders/ai/rules')
            ->assertOk()
            ->assertJsonPath('rules.0.altar_size_label', '1m97')
            ->assertJsonPath('rules.0.items.0.target_product_id', $initialProduct->id);

        $overwriteResponse = $this
            ->withHeaders($this->headers($account))
            ->postJson('/api/orders/ai/training', [
                'rule_key' => 'ban-1m97-men-lam',
                'altar_size_label' => '1m97',
                'altar_size_aliases' => ['1m97', 'ban 1m97'],
                'context_aliases' => ['men lam'],
                'input_type' => 'text',
                'source_name' => 'Nhap tay moi',
                'training_note' => 'Ghi de rule cu',
                'input_text' => 'ban 1m97, bat huong men lam size 20',
                'parsed_raw_text' => 'ban 1m97, bat huong men lam size 20',
                'parsed_result' => [
                    'raw_text' => 'ban 1m97, bat huong men lam size 20',
                    'summary' => ['mapped' => 1],
                ],
                'mapping_items' => [
                    [
                        'aliases' => ['bat huong', 'bat'],
                        'default_quantity' => 1,
                        'target_product_id' => $replacementProduct->id,
                        'entry_kind' => 'product',
                        'display_name' => $replacementProduct->name,
                        'display_sku' => $replacementProduct->sku,
                        'price' => 650000,
                        'cost_price' => 420000,
                    ],
                ],
            ]);

        $overwriteResponse
            ->assertOk()
            ->assertJsonPath('data.rule_key', 'ban-1m97-men-lam')
            ->assertJsonPath('data.mapping_items.0.target_product_id', $replacementProduct->id);

        $this->withHeaders($this->headers($account))
            ->getJson('/api/orders/ai/training')
            ->assertOk()
            ->assertJsonPath('total', 1);

        $this->withHeaders($this->headers($account))
            ->getJson('/api/orders/ai/rules')
            ->assertOk()
            ->assertJsonPath('rules.0.items.0.target_product_id', $replacementProduct->id);

        $this->withHeaders($this->headers($account))
            ->deleteJson('/api/orders/ai/training/' . $datasetId)
            ->assertOk();

        $this->withHeaders($this->headers($account))
            ->getJson('/api/orders/ai/training')
            ->assertOk()
            ->assertJsonPath('total', 0);

        $this->withHeaders($this->headers($account))
            ->getJson('/api/orders/ai/rules')
            ->assertOk()
            ->assertJsonCount(0, 'rules');
    }

    private function authenticate(): array
    {
        $account = Account::query()->create([
            'name' => 'AI Training ' . Str::upper(Str::random(4)),
            'domain' => 'ai-training-' . Str::lower(Str::random(6)) . '.local',
            'subdomain' => 'ai-training-' . Str::lower(Str::random(6)),
            'status' => 'active',
        ]);

        $user = User::factory()->create();
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

    private function createProduct(Account $account, array $overrides = []): Product
    {
        return Product::query()->create(array_merge([
            'account_id' => $account->id,
            'name' => 'San pham ' . Str::upper(Str::random(4)),
            'sku' => 'SKU-' . Str::upper(Str::random(6)),
            'type' => 'simple',
            'price' => 100000,
            'cost_price' => 70000,
            'status' => true,
        ], $overrides));
    }
}
