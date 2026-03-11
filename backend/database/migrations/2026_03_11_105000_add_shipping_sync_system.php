<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ── 1. Orders: add shipping sync columns ──
        Schema::table('orders', function (Blueprint $table) {
            $table->string('shipping_status', 50)->nullable()->after('shipment_status');
            $table->timestamp('shipping_synced_at')->nullable()->after('shipping_status');
            $table->string('shipping_status_source', 30)->default('manual')->after('shipping_synced_at'); // manual, carrier, system
        });

        // ── 2. Shipments: add carrier raw/mapped status ──
        Schema::table('shipments', function (Blueprint $table) {
            $table->string('carrier_status_raw')->nullable()->after('carrier_tracking_code');
            $table->string('carrier_status_mapped', 50)->nullable()->after('carrier_status_raw');
        });

        // ── 3. Carrier status mappings table ──
        Schema::create('carrier_status_mappings', function (Blueprint $table) {
            $table->id();
            $table->string('carrier_code', 50);
            $table->string('carrier_raw_status');
            $table->string('internal_shipment_status', 50);
            $table->string('mapped_order_status', 50)->nullable();
            $table->boolean('is_terminal')->default(false);
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['carrier_code', 'carrier_raw_status'], 'carrier_status_unique');
            $table->index('carrier_code');
        });

        // ── 4. Order status logs table ──
        Schema::create('order_status_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->onDelete('cascade');
            $table->string('from_status', 50)->nullable();
            $table->string('to_status', 50);
            $table->string('from_shipping_status', 50)->nullable();
            $table->string('to_shipping_status', 50)->nullable();
            $table->string('source', 30)->default('manual'); // manual, shipment_sync, carrier_sync, system
            $table->unsignedBigInteger('changed_by')->nullable();
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index('order_id');
        });

        // ── 5. Seed carrier status mappings ──
        $this->seedCarrierMappings();
    }

    private function seedCarrierMappings(): void
    {
        $mappings = [];

        // GHN mappings
        $ghnMap = [
            ['ready_to_pick', 'waiting_pickup', 'confirmed', false, 1],
            ['picking', 'waiting_pickup', 'confirmed', false, 2],
            ['picked', 'picked_up', 'shipping', false, 3],
            ['storing', 'in_transit', 'shipping', false, 4],
            ['transporting', 'in_transit', 'shipping', false, 5],
            ['sorting', 'in_transit', 'shipping', false, 6],
            ['delivering', 'out_for_delivery', 'shipping', false, 7],
            ['delivered', 'delivered', 'completed', true, 8],
            ['delivery_fail', 'delivery_failed', 'processing', false, 9],
            ['waiting_to_return', 'returning', 'pending_return', false, 10],
            ['return', 'returning', 'pending_return', false, 11],
            ['return_transporting', 'returning', 'pending_return', false, 12],
            ['return_sorting', 'returning', 'pending_return', false, 13],
            ['returning', 'returning', 'pending_return', false, 14],
            ['returned', 'returned', 'returned', true, 15],
            ['cancel', 'canceled', 'cancelled', true, 16],
            ['exception', 'delivery_failed', 'processing', false, 17],
            ['damage', 'delivery_failed', 'processing', false, 18],
            ['lost', 'delivery_failed', 'processing', false, 19],
        ];
        foreach ($ghnMap as [$raw, $internal, $orderSt, $terminal, $sort]) {
            $mappings[] = ['carrier_code' => 'ghn', 'carrier_raw_status' => $raw, 'internal_shipment_status' => $internal, 'mapped_order_status' => $orderSt, 'is_terminal' => $terminal, 'sort_order' => $sort, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()];
        }

        // GHTK mappings
        $ghtkMap = [
            ['-1', 'canceled', 'cancelled', true, 1],
            ['1', 'waiting_pickup', 'confirmed', false, 2],
            ['2', 'waiting_pickup', 'confirmed', false, 3],
            ['3', 'picked_up', 'shipping', false, 4],
            ['4', 'in_transit', 'shipping', false, 5],
            ['5', 'out_for_delivery', 'shipping', false, 6],
            ['6', 'delivered', 'completed', true, 7],
            ['7', 'delivery_failed', 'processing', false, 8],
            ['8', 'delivery_failed', 'processing', false, 9],
            ['9', 'returning', 'pending_return', false, 10],
            ['10', 'returning', 'pending_return', false, 11],
            ['11', 'returning', 'pending_return', false, 12],
            ['12', 'returning', 'pending_return', false, 13],
            ['13', 'returned', 'returned', true, 14],
            ['20', 'waiting_pickup', 'confirmed', false, 15],
            ['21', 'waiting_pickup', 'confirmed', false, 16],
        ];
        foreach ($ghtkMap as [$raw, $internal, $orderSt, $terminal, $sort]) {
            $mappings[] = ['carrier_code' => 'ghtk', 'carrier_raw_status' => $raw, 'internal_shipment_status' => $internal, 'mapped_order_status' => $orderSt, 'is_terminal' => $terminal, 'sort_order' => $sort, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()];
        }

        // Viettel Post mappings
        $vtpMap = [
            ['100', 'created', 'confirmed', false, 1],
            ['101', 'waiting_pickup', 'confirmed', false, 2],
            ['102', 'picked_up', 'shipping', false, 3],
            ['103', 'in_transit', 'shipping', false, 4],
            ['104', 'in_transit', 'shipping', false, 5],
            ['200', 'out_for_delivery', 'shipping', false, 6],
            ['201', 'delivery_failed', 'processing', false, 7],
            ['202', 'delivered', 'completed', true, 8],
            ['300', 'returning', 'pending_return', false, 9],
            ['301', 'returning', 'pending_return', false, 10],
            ['302', 'returned', 'returned', true, 11],
            ['400', 'delivery_failed', 'processing', false, 12],
            ['500', 'canceled', 'cancelled', true, 13],
        ];
        foreach ($vtpMap as [$raw, $internal, $orderSt, $terminal, $sort]) {
            $mappings[] = ['carrier_code' => 'viettel_post', 'carrier_raw_status' => $raw, 'internal_shipment_status' => $internal, 'mapped_order_status' => $orderSt, 'is_terminal' => $terminal, 'sort_order' => $sort, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()];
        }

        // J&T mappings
        $jtMap = [
            ['Pickup', 'picked_up', 'shipping', false, 1],
            ['On Transit', 'in_transit', 'shipping', false, 2],
            ['Arrived Destination', 'in_transit', 'shipping', false, 3],
            ['Out for Delivery', 'out_for_delivery', 'shipping', false, 4],
            ['Delivered', 'delivered', 'completed', true, 5],
            ['Undelivered', 'delivery_failed', 'processing', false, 6],
            ['On Hold', 'delivery_failed', 'processing', false, 7],
            ['Returning', 'returning', 'pending_return', false, 8],
            ['Returned', 'returned', 'returned', true, 9],
            ['Cancelled', 'canceled', 'cancelled', true, 10],
        ];
        foreach ($jtMap as [$raw, $internal, $orderSt, $terminal, $sort]) {
            $mappings[] = ['carrier_code' => 'jt', 'carrier_raw_status' => $raw, 'internal_shipment_status' => $internal, 'mapped_order_status' => $orderSt, 'is_terminal' => $terminal, 'sort_order' => $sort, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()];
        }

        // Shopee Express mappings
        $spxMap = [
            ['PICKUP_PENDING', 'waiting_pickup', 'confirmed', false, 1],
            ['PICKUP_DONE', 'picked_up', 'shipping', false, 2],
            ['IN_TRANSIT', 'in_transit', 'shipping', false, 3],
            ['OUT_FOR_DELIVERY', 'out_for_delivery', 'shipping', false, 4],
            ['DELIVERED', 'delivered', 'completed', true, 5],
            ['DELIVERY_FAILED', 'delivery_failed', 'processing', false, 6],
            ['RETURNING', 'returning', 'pending_return', false, 7],
            ['RETURNED', 'returned', 'returned', true, 8],
            ['CANCELLED', 'canceled', 'cancelled', true, 9],
        ];
        foreach ($spxMap as [$raw, $internal, $orderSt, $terminal, $sort]) {
            $mappings[] = ['carrier_code' => 'shopee_express', 'carrier_raw_status' => $raw, 'internal_shipment_status' => $internal, 'mapped_order_status' => $orderSt, 'is_terminal' => $terminal, 'sort_order' => $sort, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()];
        }

        \DB::table('carrier_status_mappings')->insert($mappings);
    }

    public function down(): void
    {
        Schema::dropIfExists('order_status_logs');
        Schema::dropIfExists('carrier_status_mappings');

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['shipping_status', 'shipping_synced_at', 'shipping_status_source']);
        });

        Schema::table('shipments', function (Blueprint $table) {
            $table->dropColumn(['carrier_status_raw', 'carrier_status_mapped']);
        });
    }
};
