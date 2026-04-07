<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('categories')) {
            return;
        }

        $needsDeletedAt = !Schema::hasColumn('categories', 'deleted_at');
        $needsDeletedBy = !Schema::hasColumn('categories', 'deleted_by');

        if ($needsDeletedAt || $needsDeletedBy) {
            Schema::table('categories', function (Blueprint $table) use ($needsDeletedAt, $needsDeletedBy) {
                if ($needsDeletedAt) {
                    $table->softDeletes()->after('updated_at');
                }

                if ($needsDeletedBy) {
                    $table->unsignedBigInteger('deleted_by')->nullable()->after($needsDeletedAt ? 'deleted_at' : 'updated_at');
                }
            });
        }

        if (Schema::hasColumn('categories', 'deleted_at') && !Schema::hasIndex('categories', ['deleted_at'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index('deleted_at');
            });
        }

        if (Schema::hasColumn('categories', 'deleted_by') && !Schema::hasIndex('categories', ['deleted_by'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index('deleted_by');
            });
        }

        if (
            Schema::hasColumn('categories', 'parent_id')
            && Schema::hasColumn('categories', 'deleted_at')
            && Schema::hasColumn('categories', 'order')
            && !Schema::hasIndex('categories', ['parent_id', 'deleted_at', 'order'])
        ) {
            Schema::table('categories', function (Blueprint $table) {
                $table->index(['parent_id', 'deleted_at', 'order'], 'categories_parent_deleted_at_order_index');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('categories')) {
            return;
        }

        if (Schema::hasIndex('categories', ['parent_id', 'deleted_at', 'order'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->dropIndex('categories_parent_deleted_at_order_index');
            });
        }

        if (Schema::hasIndex('categories', ['deleted_by'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->dropIndex(['deleted_by']);
            });
        }

        if (Schema::hasIndex('categories', ['deleted_at'])) {
            Schema::table('categories', function (Blueprint $table) {
                $table->dropIndex(['deleted_at']);
            });
        }

        $hasDeletedAt = Schema::hasColumn('categories', 'deleted_at');
        $hasDeletedBy = Schema::hasColumn('categories', 'deleted_by');

        if ($hasDeletedAt || $hasDeletedBy) {
            Schema::table('categories', function (Blueprint $table) use ($hasDeletedAt, $hasDeletedBy) {
                if ($hasDeletedBy) {
                    $table->dropColumn('deleted_by');
                }

                if ($hasDeletedAt) {
                    $table->dropSoftDeletes();
                }
            });
        }
    }
};
