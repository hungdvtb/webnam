<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_employees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('employee_code', 50);
            $table->string('full_name');
            $table->string('department')->nullable();
            $table->string('position')->nullable();
            $table->string('salary_type', 30)->default('theo_ca');
            $table->decimal('salary_amount', 15, 2)->default(0);
            $table->decimal('standard_work_units', 8, 3)->nullable();
            $table->decimal('lunch_allowance', 15, 2)->default(0);
            $table->string('bonus_policy')->nullable();
            $table->string('pay_schedule')->nullable();
            $table->string('raise_plan')->nullable();
            $table->string('bank_account_note')->nullable();
            $table->string('status', 30)->default('Đang làm');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'employee_code']);
            $table->index(['account_id', 'department']);
            $table->index(['account_id', 'status']);
            $table->index(['account_id', 'user_id']);
        });

        Schema::create('payroll_work_shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('shift_code', 30);
            $table->string('shift_name');
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->decimal('standard_hours', 6, 2)->default(4);
            $table->decimal('default_work_units', 8, 3)->default(1);
            $table->decimal('wage_multiplier', 8, 3)->default(1);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'shift_code']);
            $table->index(['account_id', 'is_active', 'sort_order']);
        });

        Schema::create('payroll_schedule_registrations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->date('work_date');
            $table->foreignId('payroll_employee_id')->constrained('payroll_employees')->cascadeOnDelete();
            $table->foreignId('payroll_work_shift_id')->constrained('payroll_work_shifts')->restrictOnDelete();
            $table->decimal('registered_work_units', 8, 3)->default(1);
            $table->string('status', 40)->default('Đã đăng ký');
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['account_id', 'work_date', 'payroll_employee_id', 'payroll_work_shift_id'], 'payroll_schedule_unique');
            $table->index(['account_id', 'work_date']);
        });

        Schema::create('payroll_attendance_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('payroll_schedule_registration_id')->nullable()->constrained('payroll_schedule_registrations')->nullOnDelete();
            $table->date('work_date');
            $table->foreignId('payroll_employee_id')->constrained('payroll_employees')->cascadeOnDelete();
            $table->foreignId('payroll_work_shift_id')->constrained('payroll_work_shifts')->restrictOnDelete();
            $table->string('attendance_status', 40)->default('Đi làm');
            $table->decimal('work_units', 8, 3)->default(1);
            $table->decimal('unit_rate', 15, 2)->nullable();
            $table->decimal('bonus_amount', 15, 2)->default(0);
            $table->decimal('penalty_amount', 15, 2)->default(0);
            $table->text('notes')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['account_id', 'work_date', 'payroll_employee_id', 'payroll_work_shift_id'], 'payroll_attendance_unique');
            $table->index(['account_id', 'work_date']);
            $table->index(['account_id', 'attendance_status']);
        });

        Schema::create('payroll_user_scopes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('payroll_employee_id')->nullable()->constrained('payroll_employees')->nullOnDelete();
            $table->string('role_name', 40)->default('Nhân viên');
            $table->string('scope_type', 40)->default('Chỉ bản thân');
            $table->string('department')->nullable();
            $table->boolean('can_view_salary')->default(false);
            $table->boolean('can_edit_attendance')->default(false);
            $table->boolean('can_manage_payroll')->default(false);
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'user_id']);
            $table->index(['account_id', 'scope_type']);
            $table->index(['account_id', 'department']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_user_scopes');
        Schema::dropIfExists('payroll_attendance_records');
        Schema::dropIfExists('payroll_schedule_registrations');
        Schema::dropIfExists('payroll_work_shifts');
        Schema::dropIfExists('payroll_employees');
    }
};
