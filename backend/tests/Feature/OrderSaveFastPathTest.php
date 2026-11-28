<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrderSaveFastPathTest extends TestCase
{
    use RefreshDatabase;

    public function test_draft_save_updates_only_changed_amounts_and_rewrites_changed_metadata(): void
    {
        $account = Account::query()->create([
            'name' => 'Order Save Account',
            'domain' => 'order-save.local',
            'subdomain' => 'order-save',
            'status' => true,
        ]);
        $user = User::query()->create([
            'name' => 'Order Save Admin',
            'email' => 'order-save@example.com',
            'password' => 'password',
            'is_admin' => true,
        ]);
        $user->accounts()->attach($account->id, ['role' => 'owner']);
        Sanctum::actingAs($user, ['*']);

        $product = Product::query()->create([
            'account_id' => $account->id,
            'type' => 'simple',
            'name' => 'San pham don nhap',
            'slug' => 'san-pham-don-nhap-' . Str::lower(Str::random(5)),
            'sku' => 'DRAFT-SAVE-FAST',
            'price' => 150000,
            'cost_price' => 80000,
            'stock_quantity' => 0,
            'status' => true,
        ]);
        $headers = ['X-Account-Id' => (string) $account->id];

        $created = $this->withHeaders($headers)->postJson('/api/orders', [
            'order_kind' => Order::KIND_DRAFT,
            'customer_name' => 'Khach ban dau',
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 2,
                'price' => 150000,
                'cost_price' => 80000,
                'name' => $product->name,
                'sku' => $product->sku,
            ]],
        ])->assertCreated();

        $orderId = (int) $created->json('id');
        $originalItem = OrderItem::query()->where('order_id', $orderId)->firstOrFail();
        $itemPayload = [
            'order_item_id' => $originalItem->id,
            'product_id' => $product->id,
            'quantity' => 2,
            'price' => 150000,
            'cost_price' => 80000,
            'name' => $originalItem->product_name_snapshot,
            'sku' => $originalItem->product_sku_snapshot,
            'product_source_account_id' => $originalItem->product_source_account_id,
            'inventory_source_account_id' => $originalItem->inventory_source_account_id,
        ];

        $this->withHeaders($headers)->putJson("/api/orders/{$orderId}", [
            'order_kind' => Order::KIND_DRAFT,
            'customer_name' => 'Khach da sua',
            'items' => [$itemPayload],
        ])->assertOk()->assertJsonPath('customer_name', 'Khach da sua');

        $this->assertSame($originalItem->id, OrderItem::query()->where('order_id', $orderId)->firstOrFail()->id);
        $this->assertEquals(300000, Order::query()->findOrFail($orderId)->total_price);

        $this->withHeaders($headers)->putJson("/api/orders/{$orderId}", [
            'order_kind' => Order::KIND_DRAFT,
            'customer_name' => 'Khach da sua',
            'items' => [array_merge($itemPayload, ['quantity' => 3])],
        ])->assertOk();

        $updatedItem = OrderItem::query()->where('order_id', $orderId)->firstOrFail();
        $this->assertSame($originalItem->id, $updatedItem->id);
        $this->assertEquals(3, $updatedItem->quantity);
        $this->assertEquals(450000, Order::query()->findOrFail($orderId)->total_price);

        $this->withHeaders($headers)->putJson("/api/orders/{$orderId}", [
            'order_kind' => Order::KIND_DRAFT,
            'customer_name' => 'Khach da sua',
            'items' => [array_merge($itemPayload, ['quantity' => 3, 'name' => 'Ten hien thi moi'])],
        ])->assertOk();

        $renamedItem = OrderItem::query()->where('order_id', $orderId)->firstOrFail();
        $this->assertNotSame($originalItem->id, $renamedItem->id);
        $this->assertSame('Ten hien thi moi', $renamedItem->product_name_snapshot);
    }
}
