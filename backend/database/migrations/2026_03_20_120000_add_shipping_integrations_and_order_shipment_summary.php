<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipping_integrations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->onDelete('cascade');
            $table->string('carrier_code', 50);
            $table->string('carrier_name');
            $table->boolean('is_enabled')->default(false);
            $table->string('connection_status', 30)->default('disconnected');
            $table->string('api_base_url')->nullable();
            $table->string('username')->nullable();
            $table->text('password_encrypted')->nullable();
            $table->text('access_token')->nullable();
            $table->timestamp('token_expires_at')->nullable();
            $table->string('sender_name')->nullable();
            $table->string('sender_phone', 30)->nullable();
            $table->text('sender_address')->nullable();
            $table->unsignedBigInteger('sender_province_id')->nullable();
            $table->unsignedBigInteger('sender_district_id')->nullable();
            $table->unsignedBigInteger('sender_ward_id')->nullable();
            $table->string('default_service_code', 30)->nullable();
            $table->string('default_service_add', 50)->nullable();
            $table->string('webhook_url')->nullable();
            $table->json('config_json')->nullable();
            $table->timestamp('last_tested_at')->nullable();
            $table->text('last_error_message')->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'carrier_code'], 'shipping_integrations_account_carrier_unique');
            $table->index(['account_id', 'is_enabled']);
        });

        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'shipping_carrier_code')) {
                $table->string('shipping_carrier_code', 50)->nullable()->after('shipping_status_source');
            }
            if (!Schema::hasColumn('orders', 'shipping_carrier_name')) {
                $table->string('shipping_carrier_name')->nullable()->after('shipping_carrier_code');
            }
            if (!Schema::hasColumn('orders', 'shipping_tracking_code')) {
                $table->string('shipping_tracking_code')->nullable()->after('shipping_carrier_name');
            }
            if (!Schema::hasColumn('orders', 'shipping_dispatched_at')) {
                $table->timestamp('shipping_dispatched_at')->nullable()->after('shipping_tracking_code');
            }
            if (!Schema::hasColumn('orders', 'shipping_issue_code')) {
                $table->string('shipping_issue_code', 60)->nullable()->after('shipping_dispatched_at');
            }
            if (!Schema::hasColumn('orders', 'shipping_issue_message')) {
                $table->text('shipping_issue_message')->nullable()->after('shipping_issue_code');
            }
            if (!Schema::hasColumn('orders', 'shipping_issue_detected_at')) {
                $table->timestamp('shipping_issue_detected_at')->nullable()->after('shipping_issue_message');
            }
        });

        Schema::table('shipments', function (Blueprint $table) {
            if (!Schema::hasColumn('shipments', 'integration_id')) {
                $table->foreignId('integration_id')->nullable()->after('order_id')->constrained('shipping_integrations')->nullOnDelete();
            }
            if (!Schema::hasColumn('shipments', 'external_order_number')) {
                $table->string('external_order_number')->nullable()->after('carrier_tracking_code');
            }
            if (!Schema::hasColumn('shipments', 'dispatch_payload')) {
                $table->json('dispatch_payload')->nullable()->after('raw_tracking_payload');
            }
            if (!Schema::hasColumn('shipments', 'dispatch_response')) {
                $table->json('dispatch_response')->nullable()->after('dispatch_payload');
            }
            if (!Schema::hasColumn('shipments', 'last_reconciled_at')) {
                $table->timestamp('last_reconciled_at')->nullable()->after('reconciled_at');
            }
            if (!Schema::hasColumn('shipments', 'carrier_status_code')) {
                $table->string('carrier_status_code', 50)->nullable()->after('carrier_status_mapped');
            }
            if (!Schema::hasColumn('shipments', 'carrier_status_text')) {
                $table->string('carrier_status_text')->nullable()->after('carrier_status_code');
            }
            if (!Schema::hasColumn('shipments', 'problem_code')) {
                $table->string('problem_code', 60)->nullable()->after('carrier_status_text');
            }
            if (!Schema::hasColumn('shipments', 'problem_message')) {
                $table->text('problem_message')->nullable()->after('problem_code');
            }
            if (!Schema::hasColumn('shipments', 'problem_detected_at')) {
                $table->timestamp('problem_detected_at')->nullable()->after('problem_message');
            }
            if (!Schema::hasColumn('shipments', 'last_webhook_received_at')) {
                $table->timestamp('last_webhook_received_at')->nullable()->after('problem_detected_at');
            }
        });

        Schema::table('carrier_status_mappings', function (Blueprint $table) {
            if (!Schema::hasColumn('carrier_status_mappings', 'account_id')) {
                $table->unsignedBigInteger('account_id')->nullable()->after('id');
                $table->index('account_id');
            }
        });

        Schema::table('carrier_raw_statuses', function (Blueprint $table) {
            if (!Schema::hasColumn('carrier_raw_statuses', 'account_id')) {
                $table->unsignedBigInteger('account_id')->nullable()->after('id');
                $table->index('account_id');
            }
        });

        try {
            Schema::table('carrier_status_mappings', function (Blueprint $table) {
                $table->dropUnique('carrier_status_unique');
            });
        } catch (\Throwable $e) {
            // Ignore if the unique key was already changed in a dirty environment.
        }

        try {
            Schema::table('carrier_raw_statuses', function (Blueprint $table) {
                $table->dropUnique('carrier_raw_statuses_carrier_code_raw_status_unique');
            });
        } catch (\Throwable $e) {
            // Ignore if the unique key was already changed in a dirty environment.
        }

        Schema::table('carrier_status_mappings', function (Blueprint $table) {
            $table->unique(['account_id', 'carrier_code', 'carrier_raw_status'], 'carrier_status_account_unique');
        });

        Schema::table('carrier_raw_statuses', function (Blueprint $table) {
            $table->unique(['account_id', 'carrier_code', 'raw_status'], 'carrier_raw_status_account_unique');
        });

        DB::table('orders')
            ->whereNull('shipping_carrier_name')
            ->whereNotNull('shipping_status')
            ->update([
                'shipping_carrier_name' => DB::raw("NULL"),
            ]);
    }

    public function down(): void
    {
        try {
            Schema::table('carrier_raw_statuses', function (Blueprint $table) {
                $table->dropUnique('carrier_raw_status_account_unique');
            });
        } catch (\Throwable $e) {
        }

        try {
            Schema::table('carrier_status_mappings', function (Blueprint $table) {
                $table->dropUnique('carrier_status_account_unique');
            });
        } catch (\Throwable $e) {
        }

        Schema::table('carrier_raw_statuses', function (Blueprint $table) {
            if (Schema::hasColumn('carrier_raw_statuses', 'account_id')) {
                $table->dropColumn('account_id');
            }
        });

        Schema::table('carrier_status_mappings', function (Blueprint $table) {
            if (Schema::hasColumn('carrier_status_mappings', 'account_id')) {
                $table->dropColumn('account_id');
            }
        });

        Schema::table('shipments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('integration_id');
            $table->dropColumn([
                'external_order_number',
                'dispatch_payload',
                'dispatch_response',
                'last_reconciled_at',
                'carrier_status_code',
                'carrier_status_text',
                'problem_code',
                'problem_message',
                'problem_detected_at',
                'last_webhook_received_at',
            ]);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'shipping_carrier_code',
                'shipping_carrier_name',
                'shipping_tracking_code',
                'shipping_dispatched_at',
                'shipping_issue_code',
                'shipping_issue_message',
                'shipping_issue_detected_at',
            ]);
        });

        Schema::dropIfExists('shipping_integrations');
    }
};
