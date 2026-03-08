<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $tables = [
            'inventory_items',
            'product_images',
            'product_groups',
            'product_group_items',
            'orders',
            'order_items',
            'carts',
            'cart_items',
            'payments',
            'shipments',
            'stock_movements',
            'stock_transfers',
            'invoices',
            'customers',
            'blog_posts',
            'coupons',
            'product_reviews',
            'wishlists',
            'product_links',
            'product_super_attributes',
            'product_attribute_values'
        ];

        foreach ($tables as $table) {
            if (Schema::hasTable($table) && !Schema::hasColumn($table, 'account_id')) {
                Schema::table($table, function (Blueprint $table) {
                    $table->foreignId('account_id')->nullable()->constrained()->onDelete('cascade');
                });
            }
        }
    }

    public function down(): void
    {
        // ... reverse logic if needed
    }
};
