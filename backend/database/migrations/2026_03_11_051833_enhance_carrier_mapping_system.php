<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Add fields to carriers
        if (Schema::hasTable('carriers')) {
            Schema::table('carriers', function (Blueprint $table) {
                if (!Schema::hasColumn('carriers', 'sort_order')) {
                    $table->integer('sort_order')->default(0)->after('is_active');
                }
                if (!Schema::hasColumn('carriers', 'is_visible')) {
                    $table->boolean('is_visible')->default(true)->after('sort_order');
                }
                if (!Schema::hasColumn('carriers', 'color')) {
                    $table->string('color', 20)->nullable()->after('name');
                }
            });
        }

        // Add description to mappings
        if (Schema::hasTable('carrier_status_mappings')) {
            Schema::table('carrier_status_mappings', function (Blueprint $table) {
                if (!Schema::hasColumn('carrier_status_mappings', 'description')) {
                    $table->text('description')->nullable()->after('mapped_order_status');
                }
            });
        }

        // Create carrier_raw_statuses for discovered statuses from API
        if (!Schema::hasTable('carrier_raw_statuses')) {
            Schema::create('carrier_raw_statuses', function (Blueprint $table) {
                $table->id();
                $table->string('carrier_code', 50);
                $table->string('raw_status');
                $table->timestamp('first_seen_at')->nullable();
                $table->timestamp('last_seen_at')->nullable();
                $table->boolean('is_mapped')->default(false);
                $table->unsignedBigInteger('mapping_id')->nullable();
                $table->json('sample_payload')->nullable();
                $table->timestamps();

                $table->unique(['carrier_code', 'raw_status']);
                $table->index('carrier_code');
                $table->index('is_mapped');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('carrier_raw_statuses');

        if (Schema::hasTable('carrier_status_mappings') && Schema::hasColumn('carrier_status_mappings', 'description')) {
            Schema::table('carrier_status_mappings', function (Blueprint $table) {
                $table->dropColumn('description');
            });
        }

        if (Schema::hasTable('carriers')) {
            $columnsToDrop = array_values(array_filter([
                Schema::hasColumn('carriers', 'sort_order') ? 'sort_order' : null,
                Schema::hasColumn('carriers', 'is_visible') ? 'is_visible' : null,
                Schema::hasColumn('carriers', 'color') ? 'color' : null,
            ]));

            if (!empty($columnsToDrop)) {
                Schema::table('carriers', function (Blueprint $table) use ($columnsToDrop) {
                    $table->dropColumn($columnsToDrop);
                });
            }
        }
    }
};
