<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

#[\PHPUnit\Framework\Attributes\RequiresPhpExtension('pdo_sqlite')]
class OrderAccountScopeFallbackTest extends TestCase
{
    use RefreshDatabase;

    public function test_order_list_and_bootstrap_fallback_to_first_account_for_admin_without_active_account_header(): void
    {
        $primaryAccount = $this->createAccount('Primary');
        $secondaryAccount = $this->createAccount('Secondary');

        $admin = User::factory()->create([
            'is_admin' => true,
        ]);

        Sanctum::actingAs($admin, ['*']);

        $primaryOrder = $this->createOrder($primaryAccount, $admin, [
            'order_number' => 'OR-FALLBACK-PRIMARY-0001',
            'customer_name' => 'Khach chinh',
        ]);

        $secondaryOrder = $this->createOrder($secondaryAccount, $admin, [
            'order_number' => 'OR-FALLBACK-SECONDARY-0001',
            'customer_name' => 'Khach phu',
        ]);

        $bootstrapResponse = $this
            ->withHeaders($this->headers())
            ->getJson('/api/orders/bootstrap?mode=list');

        $bootstrapResponse->assertOk();
        $this->assertNotEmpty($bootstrapResponse->json('order_statuses'));
        $this->assertSame(1, (int) $bootstrapResponse->json('order_kind_counts.official'));
        $this->assertSame(0, (int) $bootstrapResponse->json('order_kind_counts.draft'));

        $listResponse = $this
            ->withHeaders($this->headers())
            ->getJson('/api/orders?per_page=100');

        $listResponse->assertOk();
        $this->assertSame(1, (int) $listResponse->json('total'));
        $this->assertSame(1, (int) $listResponse->json('summary.order_count'));

        $returnedIds = collect($listResponse->json('data'))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains($primaryOrder->id, $returnedIds);
        $this->assertNotContains($secondaryOrder->id, $returnedIds);
    }

    private function createAccount(string $label): Account
    {
        $slug = Str::lower($label) . '-' . Str::lower(Str::random(6));

        return Account::query()->create([
            'name' => 'Order Fallback ' . $label,
            'domain' => $slug . '.local',
            'subdomain' => $slug,
            'status' => 'active',
        ]);
    }

    private function headers(): array
    {
        return [
            'Accept' => 'application/json',
        ];
    }

    private function createOrder(Account $account, User $user, array $overrides = []): Order
    {
        return Order::query()->create(array_merge([
            'account_id' => $account->id,
            'user_id' => $user->id,
            'order_number' => 'OR-FALLBACK-' . Str::upper(Str::random(6)),
            'order_kind' => Order::KIND_OFFICIAL,
            'order_type' => Order::TYPE_STANDARD,
            'status' => 'new',
            'customer_name' => 'Khach test',
            'customer_phone' => '090' . random_int(1000000, 9999999),
            'shipping_address' => 'Dia chi test',
            'total_price' => 120000,
            'shipping_fee' => 0,
            'discount' => 0,
            'cost_total' => 80000,
            'profit_total' => 40000,
        ], $overrides));
    }
}
