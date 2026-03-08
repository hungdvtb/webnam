<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Warehouse;
use App\Models\Product;
use App\Models\InventoryItem;
use App\Models\Account;

class WarehouseSeeder extends Seeder
{
    public function run(): void
    {
        $account = Account::where('subdomain', 'demo')->first();
        if (!$account) return;

        $warehouses = [
            [
                'account_id' => $account->id,
                'name' => 'Kho Tổng Miền Bắc',
                'code' => 'WH-HN-MAIN',
                'contact_name' => 'Nguyễn Văn Kho',
                'phone' => '0912345678',
                'address' => 'Số 10, Phố Gốm, Gia Lâm, Hà Nội',
                'city' => 'Hà Nội',
                'is_active' => true
            ],
            [
                'account_id' => $account->id,
                'name' => 'Showroom Bát Tràng',
                'code' => 'SR-BT-01',
                'contact_name' => 'Trần Thị Gốm',
                'phone' => '0987654321',
                'address' => 'Xóm 1, Bát Tràng, Gia Lâm, Hà Nội',
                'city' => 'Hà Nội',
                'is_active' => true
            ]
        ];

        foreach ($warehouses as $wh) {
            $warehouse = Warehouse::create($wh);

            // Distribute stock for demo products
            $products = Product::where('account_id', $account->id)->where('type', 'simple')->get();
            foreach ($products as $product) {
                InventoryItem::create([
                    'product_id' => $product->id,
                    'warehouse_id' => $warehouse->id,
                    'qty' => rand(10, 50),
                    'min_qty' => 5,
                    'is_in_stock' => true
                ]);
            }
        }

        // Update total stock for products based on inventory
        $allProducts = Product::where('account_id', $account->id)->get();
        foreach ($allProducts as $product) {
            $totalQty = InventoryItem::where('product_id', $product->id)->sum('qty');
            $product->update(['stock_quantity' => $totalQty]);
        }
    }
}
