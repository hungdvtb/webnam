<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('lead_follow_up_tasks')) {
            return;
        }

        Schema::create('lead_follow_up_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained()->cascadeOnDelete();
            $table->foreignId('lead_id')->constrained()->cascadeOnDelete();
            $table->string('task_type', 30);
            $table->date('due_date');
            $table->string('status', 20)->default('pending');
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('completed_activity_type', 30)->nullable();
            $table->timestamps();

            $table->unique(['account_id', 'lead_id', 'task_type', 'due_date'], 'lead_tasks_unique_due');
            $table->index(['account_id', 'status', 'task_type', 'due_date'], 'lead_tasks_queue_index');
            $table->index(['lead_id', 'status', 'due_date'], 'lead_tasks_lead_status_index');
        });
    }

    public function down(): void
    {
        // Keep the original migration responsible for dropping this table.
    }
};
