<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('warehouses', function (Blueprint $table) {
            $table->string('province_name')->nullable()->after('city');
            $table->string('district_name')->nullable()->after('province_name');
            $table->string('ward_name')->nullable()->after('district_name');
            $table->unsignedBigInteger('province_id')->nullable()->after('ward_name');
            $table->unsignedBigInteger('district_id')->nullable()->after('province_id');
            $table->unsignedBigInteger('ward_id')->nullable()->after('district_id');
        });

        Schema::table('shipping_integrations', function (Blueprint $table) {
            $table->foreignId('default_warehouse_id')
                ->nullable()
                ->after('default_service_add')
                ->constrained('warehouses')
                ->nullOnDelete();
        });

        $now = now();
        $integrations = DB::table('shipping_integrations')->get();

        foreach ($integrations as $integration) {
            if ($integration->default_warehouse_id) {
                continue;
            }

            $config = json_decode($integration->config_json ?: '{}', true) ?: [];
            $hasSenderData = filled($integration->sender_name)
                || filled($integration->sender_phone)
                || filled($integration->sender_address)
                || filled($config['sender_province_name'] ?? null)
                || filled($config['sender_district_name'] ?? null)
                || filled($config['sender_ward_name'] ?? null);

            if (!$hasSenderData) {
                continue;
            }

            $warehouseId = DB::table('warehouses')->insertGetId([
                'account_id' => $integration->account_id,
                'name' => 'Kho gửi ' . ($integration->carrier_name ?: strtoupper((string) $integration->carrier_code)),
                'code' => 'SHIP-' . $integration->account_id . '-' . $integration->id,
                'contact_name' => $integration->sender_name,
                'phone' => $integration->sender_phone,
                'email' => null,
                'address' => $integration->sender_address,
                'city' => $config['sender_province_name'] ?? null,
                'province_name' => $config['sender_province_name'] ?? null,
                'district_name' => $config['sender_district_name'] ?? null,
                'ward_name' => $config['sender_ward_name'] ?? null,
                'province_id' => $integration->sender_province_id,
                'district_id' => $integration->sender_district_id,
                'ward_id' => $integration->sender_ward_id,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('shipping_integrations')
                ->where('id', $integration->id)
                ->update(['default_warehouse_id' => $warehouseId]);
        }
    }

    public function down(): void
    {
        Schema::table('shipping_integrations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('default_warehouse_id');
        });

        Schema::table('warehouses', function (Blueprint $table) {
            $table->dropColumn([
                'province_name',
                'district_name',
                'ward_name',
                'province_id',
                'district_id',
                'ward_id',
            ]);
        });
    }
};
