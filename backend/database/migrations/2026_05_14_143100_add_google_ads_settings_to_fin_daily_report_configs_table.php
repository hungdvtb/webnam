<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->text('google_developer_token')->nullable()->after('fb_tokens_configs');
            $table->text('google_client_id')->nullable()->after('google_developer_token');
            $table->text('google_client_secret')->nullable()->after('google_client_id');
            $table->text('google_refresh_token')->nullable()->after('google_client_secret');
            $table->text('google_login_customer_id')->nullable()->after('google_refresh_token');
            $table->text('google_customer_ids')->nullable()->after('google_login_customer_id');
            $table->decimal('google_tax_rate', 5, 2)->default(0)->after('google_customer_ids');
        });
    }

    public function down(): void
    {
        Schema::table('fin_daily_report_configs', function (Blueprint $table) {
            $table->dropColumn([
                'google_developer_token',
                'google_client_id',
                'google_client_secret',
                'google_refresh_token',
                'google_login_customer_id',
                'google_customer_ids',
                'google_tax_rate',
            ]);
        });
    }
};
