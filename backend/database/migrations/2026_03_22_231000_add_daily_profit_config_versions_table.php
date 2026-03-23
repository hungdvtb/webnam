<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('finance_daily_profit_config_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->date('effective_date');
            $table->decimal('return_rate', 8, 4)->default(0);
            $table->decimal('packaging_cost_per_order', 18, 2)->default(0);
            $table->string('shipping_calculation_mode', 40)->default('fixed_per_order');
            $table->decimal('shipping_cost_per_order', 18, 2)->default(0);
            $table->decimal('shipping_cost_rate', 8, 4)->default(0);
            $table->decimal('tax_rate', 8, 4)->default(1.5);
            $table->text('note')->nullable();
            $table->timestamps();

            $table->index(['account_id', 'effective_date'], 'finance_daily_profit_config_effective_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('finance_daily_profit_config_versions');
    }
};
