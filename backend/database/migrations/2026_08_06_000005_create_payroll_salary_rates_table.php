<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_employees', function (Blueprint $table) {
            if (!Schema::hasColumn('payroll_employees', 'salary_effective_from')) {
                $table->date('salary_effective_from')->nullable()->after('salary_amount')->index();
            }
        });

        if (!Schema::hasTable('payroll_salary_rates')) {
            Schema::create('payroll_salary_rates', function (Blueprint $table) {
                $table->id();
                $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
                $table->foreignId('payroll_employee_id')->constrained('payroll_employees')->cascadeOnDelete();
                $table->string('salary_type', 30)->default('theo_ca');
                $table->decimal('salary_amount', 15, 2)->default(0);
                $table->decimal('standard_work_units', 8, 3)->nullable();
                $table->date('effective_from');
                $table->string('notes')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();

                $table->unique(['account_id', 'payroll_employee_id', 'effective_from'], 'payroll_salary_rate_unique');
                $table->index(['account_id', 'payroll_employee_id', 'effective_from'], 'payroll_salary_rate_lookup');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_salary_rates');

        Schema::table('payroll_employees', function (Blueprint $table) {
            if (Schema::hasColumn('payroll_employees', 'salary_effective_from')) {
                $table->dropColumn('salary_effective_from');
            }
        });
    }
};
