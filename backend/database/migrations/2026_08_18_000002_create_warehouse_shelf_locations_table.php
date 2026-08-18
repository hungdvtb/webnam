<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('warehouse_shelves', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('warehouse_id')->nullable()->constrained('warehouses')->nullOnDelete();
            $table->string('name');
            $table->string('code', 80);
            $table->unsignedSmallInteger('floor_count')->default(4);
            $table->boolean('is_active')->default(true);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'warehouse_id', 'code'], 'warehouse_shelves_account_warehouse_code_idx');
            $table->index(['account_id', 'is_active'], 'warehouse_shelves_account_active_idx');
        });

        Schema::create('product_storage_locations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignId('warehouse_shelf_id')->constrained('warehouse_shelves')->cascadeOnDelete();
            $table->unsignedSmallInteger('floor_number')->default(1);
            $table->string('position_note')->nullable();
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'product_id'], 'product_storage_locations_account_product_unique');
            $table->index(['warehouse_shelf_id', 'floor_number'], 'product_storage_locations_shelf_floor_idx');
            $table->index(['account_id', 'floor_number'], 'product_storage_locations_account_floor_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_storage_locations');
        Schema::dropIfExists('warehouse_shelves');
    }
};
