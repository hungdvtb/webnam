<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ── 1. Carriers table ──
        Schema::create('carriers', function (Blueprint $table) {
            $table->id();
            $table->string('code', 50)->unique();
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->boolean('api_enabled')->default(false);
            $table->boolean('webhook_enabled')->default(false);
            $table->string('logo')->nullable();
            $table->json('config_json')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->timestamps();
        });

        // Seed default carriers
        \DB::table('carriers')->insert([
            ['code' => 'ghn', 'name' => 'Giao Hàng Nhanh', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'ghtk', 'name' => 'Giao Hàng Tiết Kiệm', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'viettel_post', 'name' => 'Viettel Post', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'jt', 'name' => 'J&T Express', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'shopee_express', 'name' => 'Shopee Express', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'best', 'name' => 'Best Express', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'ninja_van', 'name' => 'Ninja Van', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
            ['code' => 'other', 'name' => 'Khác', 'is_active' => true, 'api_enabled' => false, 'webhook_enabled' => false, 'created_at' => now(), 'updated_at' => now()],
        ]);

        // ── 2. Upgrade shipments table (add new columns) ──
        Schema::table('shipments', function (Blueprint $table) {
            // Identification
            $table->string('carrier_code', 50)->nullable()->after('tracking_number');
            $table->string('carrier_tracking_code')->nullable()->after('carrier_code');
            $table->string('order_code')->nullable()->after('order_id');
            $table->string('channel', 30)->default('manual')->after('carrier_tracking_code'); // manual / api / import

            // Customer
            $table->unsignedBigInteger('customer_id')->nullable()->after('channel');
            $table->string('customer_name')->nullable()->after('customer_id');
            $table->string('customer_phone', 30)->nullable()->after('customer_name');
            $table->text('customer_address')->nullable()->after('customer_phone');
            $table->string('customer_ward')->nullable()->after('customer_address');
            $table->string('customer_district')->nullable()->after('customer_ward');
            $table->string('customer_province')->nullable()->after('customer_district');

            // Sender
            $table->string('sender_name')->nullable()->after('customer_province');
            $table->string('sender_phone', 30)->nullable()->after('sender_name');
            $table->text('sender_address')->nullable()->after('sender_phone');

            // Status
            $table->string('shipment_status', 50)->default('created')->after('status');
            $table->string('shipment_sub_status')->nullable()->after('shipment_status');
            $table->string('order_status_snapshot', 50)->nullable()->after('shipment_sub_status');

            // Money
            $table->decimal('cod_amount', 15, 2)->default(0)->after('shipping_cost');
            $table->decimal('service_fee', 15, 2)->default(0)->after('cod_amount');
            $table->decimal('return_fee', 15, 2)->default(0)->after('service_fee');
            $table->decimal('insurance_fee', 15, 2)->default(0)->after('return_fee');
            $table->decimal('other_fee', 15, 2)->default(0)->after('insurance_fee');
            $table->decimal('reconciled_amount', 15, 2)->default(0)->after('other_fee');
            $table->decimal('actual_received_amount', 15, 2)->default(0)->after('reconciled_amount');
            $table->decimal('reconciliation_diff_amount', 15, 2)->default(0)->after('actual_received_amount');

            // COD / Reconciliation status
            $table->string('reconciliation_status', 30)->default('pending')->after('reconciliation_diff_amount'); // pending, reconciled, mismatch
            $table->string('cod_status', 30)->default('unpaid')->after('reconciliation_status'); // unpaid, collected, failed, transferred

            // Operations
            $table->integer('attempt_delivery_count')->default(0)->after('cod_status');
            $table->string('failed_reason')->nullable()->after('attempt_delivery_count');
            $table->string('failed_reason_code', 50)->nullable()->after('failed_reason');
            $table->text('internal_note')->nullable()->after('failed_reason_code');
            $table->string('risk_flag', 30)->nullable()->after('internal_note'); // high_cod, stuck, returning
            $table->string('priority_level', 20)->default('normal')->after('risk_flag'); // low, normal, high, urgent
            $table->unsignedBigInteger('created_by')->nullable()->after('priority_level');
            $table->unsignedBigInteger('assigned_to')->nullable()->after('created_by');

            // Timestamps
            $table->timestamp('picked_at')->nullable()->after('shipped_at');
            $table->timestamp('in_transit_at')->nullable()->after('picked_at');
            $table->timestamp('out_for_delivery_at')->nullable()->after('in_transit_at');
            $table->timestamp('delivery_failed_at')->nullable()->after('out_for_delivery_at');
            $table->timestamp('returning_at')->nullable()->after('delivery_failed_at');
            $table->timestamp('returned_at')->nullable()->after('returning_at');
            $table->timestamp('reconciled_at')->nullable()->after('returned_at');
            $table->timestamp('canceled_at')->nullable()->after('reconciled_at');
            $table->timestamp('last_synced_at')->nullable()->after('canceled_at');

            // Raw data
            $table->json('raw_tracking_payload')->nullable()->after('last_synced_at');
            $table->json('extra_data')->nullable()->after('raw_tracking_payload');

            // Soft delete
            $table->softDeletes()->after('updated_at');

            // Indexes
            $table->index('shipment_status');
            $table->index('reconciliation_status');
            $table->index('cod_status');
            $table->index('carrier_code');
            $table->index('customer_phone');
        });

        // ── 3. Shipment tracking histories ──
        Schema::create('shipment_tracking_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shipment_id')->constrained()->onDelete('cascade');
            $table->string('tracking_code')->nullable();
            $table->string('status', 50);
            $table->string('sub_status')->nullable();
            $table->text('description')->nullable();
            $table->string('location')->nullable();
            $table->timestamp('event_time')->nullable();
            $table->json('raw_payload')->nullable();
            $table->timestamps();

            $table->index('shipment_id');
            $table->index('status');
        });

        // ── 4. Shipment reconciliations ──
        Schema::create('shipment_reconciliations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shipment_id')->constrained()->onDelete('cascade');
            $table->string('reconciliation_code')->nullable();
            $table->string('carrier_code', 50)->nullable();
            $table->decimal('cod_amount', 15, 2)->default(0);
            $table->decimal('shipping_fee', 15, 2)->default(0);
            $table->decimal('service_fee', 15, 2)->default(0);
            $table->decimal('return_fee', 15, 2)->default(0);
            $table->decimal('actual_received_amount', 15, 2)->default(0);
            $table->decimal('system_expected_amount', 15, 2)->default(0);
            $table->decimal('diff_amount', 15, 2)->default(0);
            $table->string('status', 30)->default('pending'); // pending, reconciled, mismatch
            $table->text('note')->nullable();
            $table->unsignedBigInteger('reconciled_by')->nullable();
            $table->timestamp('reconciled_at')->nullable();
            $table->timestamps();

            $table->index('shipment_id');
        });

        // ── 5. Shipment notes ──
        Schema::create('shipment_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shipment_id')->constrained()->onDelete('cascade');
            $table->string('note_type', 30)->default('general'); // general, internal, warning
            $table->text('content');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            $table->index('shipment_id');
        });

        // ── 6. Shipment status logs ──
        Schema::create('shipment_status_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('shipment_id')->constrained()->onDelete('cascade');
            $table->string('from_status', 50)->nullable();
            $table->string('to_status', 50);
            $table->unsignedBigInteger('changed_by')->nullable();
            $table->string('change_source', 30)->default('manual'); // manual, api, webhook, system
            $table->text('reason')->nullable();
            $table->timestamps();

            $table->index('shipment_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shipment_status_logs');
        Schema::dropIfExists('shipment_notes');
        Schema::dropIfExists('shipment_reconciliations');
        Schema::dropIfExists('shipment_tracking_histories');
        Schema::dropIfExists('carriers');

        Schema::table('shipments', function (Blueprint $table) {
            $cols = [
                'carrier_code', 'carrier_tracking_code', 'order_code', 'channel',
                'customer_id', 'customer_name', 'customer_phone', 'customer_address',
                'customer_ward', 'customer_district', 'customer_province',
                'sender_name', 'sender_phone', 'sender_address',
                'shipment_status', 'shipment_sub_status', 'order_status_snapshot',
                'cod_amount', 'service_fee', 'return_fee', 'insurance_fee', 'other_fee',
                'reconciled_amount', 'actual_received_amount', 'reconciliation_diff_amount',
                'reconciliation_status', 'cod_status',
                'attempt_delivery_count', 'failed_reason', 'failed_reason_code',
                'internal_note', 'risk_flag', 'priority_level', 'created_by', 'assigned_to',
                'picked_at', 'in_transit_at', 'out_for_delivery_at',
                'delivery_failed_at', 'returning_at', 'returned_at', 'reconciled_at', 'canceled_at',
                'last_synced_at', 'raw_tracking_payload', 'extra_data', 'deleted_at'
            ];
            $table->dropColumn($cols);
        });
    }
};
