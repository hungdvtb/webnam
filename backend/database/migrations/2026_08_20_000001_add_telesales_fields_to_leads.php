<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            if (!Schema::hasColumn('leads', 'assigned_staff_id')) {
                $table->unsignedBigInteger('assigned_staff_id')->nullable()->after('lead_status_id')->index();
            }

            if (!Schema::hasColumn('leads', 'potential_level')) {
                $table->string('potential_level', 30)->nullable()->after('assigned_staff_id')->index();
            }

            if (!Schema::hasColumn('leads', 'next_follow_up_at')) {
                $table->timestamp('next_follow_up_at')->nullable()->after('potential_level')->index();
            }

            if (!Schema::hasColumn('leads', 'follow_up_script')) {
                $table->string('follow_up_script', 40)->nullable()->after('next_follow_up_at');
            }

            if (!Schema::hasColumn('leads', 'follow_up_interval_days')) {
                $table->unsignedSmallInteger('follow_up_interval_days')->nullable()->after('follow_up_script');
            }

            if (!Schema::hasColumn('leads', 'last_contacted_at')) {
                $table->timestamp('last_contacted_at')->nullable()->after('follow_up_interval_days')->index();
            }

            if (!Schema::hasColumn('leads', 'do_not_call')) {
                $table->boolean('do_not_call')->default(false)->after('last_contacted_at')->index();
            }
        });

        Schema::table('lead_notes', function (Blueprint $table) {
            if (!Schema::hasColumn('lead_notes', 'activity_type')) {
                $table->string('activity_type', 40)->default('note')->after('content')->index();
            }

            if (!Schema::hasColumn('lead_notes', 'next_follow_up_at')) {
                $table->timestamp('next_follow_up_at')->nullable()->after('activity_type')->index();
            }

            if (!Schema::hasColumn('lead_notes', 'potential_level')) {
                $table->string('potential_level', 30)->nullable()->after('next_follow_up_at');
            }

            if (!Schema::hasColumn('lead_notes', 'lead_status_id')) {
                $table->unsignedBigInteger('lead_status_id')->nullable()->after('potential_level')->index();
            }

            if (!Schema::hasColumn('lead_notes', 'assigned_staff_id')) {
                $table->unsignedBigInteger('assigned_staff_id')->nullable()->after('lead_status_id')->index();
            }
        });

        Schema::table('leads', function (Blueprint $table) {
            if (Schema::hasColumn('leads', 'assigned_staff_id')) {
                $table->foreign('assigned_staff_id')->references('id')->on('lead_staffs')->nullOnDelete();
            }
        });

        Schema::table('lead_notes', function (Blueprint $table) {
            if (Schema::hasColumn('lead_notes', 'lead_status_id')) {
                $table->foreign('lead_status_id')->references('id')->on('lead_statuses')->nullOnDelete();
            }

            if (Schema::hasColumn('lead_notes', 'assigned_staff_id')) {
                $table->foreign('assigned_staff_id')->references('id')->on('lead_staffs')->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('lead_notes', function (Blueprint $table) {
            if (Schema::hasColumn('lead_notes', 'assigned_staff_id')) {
                $table->dropForeign(['assigned_staff_id']);
            }

            if (Schema::hasColumn('lead_notes', 'lead_status_id')) {
                $table->dropForeign(['lead_status_id']);
            }
        });

        Schema::table('leads', function (Blueprint $table) {
            if (Schema::hasColumn('leads', 'assigned_staff_id')) {
                $table->dropForeign(['assigned_staff_id']);
            }
        });

        Schema::table('lead_notes', function (Blueprint $table) {
            $columns = array_filter([
                Schema::hasColumn('lead_notes', 'activity_type') ? 'activity_type' : null,
                Schema::hasColumn('lead_notes', 'next_follow_up_at') ? 'next_follow_up_at' : null,
                Schema::hasColumn('lead_notes', 'potential_level') ? 'potential_level' : null,
                Schema::hasColumn('lead_notes', 'lead_status_id') ? 'lead_status_id' : null,
                Schema::hasColumn('lead_notes', 'assigned_staff_id') ? 'assigned_staff_id' : null,
            ]);

            if (!empty($columns)) {
                $table->dropColumn($columns);
            }
        });

        Schema::table('leads', function (Blueprint $table) {
            $columns = array_filter([
                Schema::hasColumn('leads', 'assigned_staff_id') ? 'assigned_staff_id' : null,
                Schema::hasColumn('leads', 'potential_level') ? 'potential_level' : null,
                Schema::hasColumn('leads', 'next_follow_up_at') ? 'next_follow_up_at' : null,
                Schema::hasColumn('leads', 'follow_up_script') ? 'follow_up_script' : null,
                Schema::hasColumn('leads', 'follow_up_interval_days') ? 'follow_up_interval_days' : null,
                Schema::hasColumn('leads', 'last_contacted_at') ? 'last_contacted_at' : null,
                Schema::hasColumn('leads', 'do_not_call') ? 'do_not_call' : null,
            ]);

            if (!empty($columns)) {
                $table->dropColumn($columns);
            }
        });
    }
};
