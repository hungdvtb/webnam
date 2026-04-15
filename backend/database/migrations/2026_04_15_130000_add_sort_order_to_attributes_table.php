<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('attributes', function (Blueprint $table) {
            $table->unsignedInteger('sort_order')->default(0)->after('status');
            $table->index(['account_id', 'entity_type', 'sort_order'], 'attributes_account_entity_sort_index');
        });

        $attributes = DB::table('attributes')
            ->select(['id', 'account_id', 'entity_type'])
            ->orderByRaw('CASE WHEN account_id IS NULL THEN 0 ELSE 1 END')
            ->orderBy('account_id')
            ->orderBy('entity_type')
            ->orderBy('id')
            ->get();

        $currentGroup = null;
        $position = 0;

        foreach ($attributes as $attribute) {
            $groupKey = sprintf(
                '%s|%s',
                $attribute->account_id === null ? 'null' : (string) $attribute->account_id,
                (string) ($attribute->entity_type ?: 'product')
            );

            if ($groupKey !== $currentGroup) {
                $currentGroup = $groupKey;
                $position = 1;
            } else {
                $position++;
            }

            DB::table('attributes')
                ->where('id', $attribute->id)
                ->update(['sort_order' => $position]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('attributes', function (Blueprint $table) {
            $table->dropIndex('attributes_account_entity_sort_index');
            $table->dropColumn('sort_order');
        });
    }
};
