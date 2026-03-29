<?php

use App\Models\InventoryDocument;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_documents', function (Blueprint $table) {
            if (!Schema::hasColumn('inventory_documents', 'adjustment_kind')) {
                $table->string('adjustment_kind', 40)->nullable()->after('type');
                $table->index(['type', 'adjustment_kind'], 'inventory_documents_type_adjustment_kind_idx');
            }

            if (!Schema::hasColumn('inventory_documents', 'adjustment_source')) {
                $table->string('adjustment_source', 60)->nullable()->after('adjustment_kind');
                $table->index('adjustment_source', 'inventory_documents_adjustment_source_idx');
            }
        });

        DB::table('inventory_documents')
            ->where('type', 'adjustment')
            ->update([
                'adjustment_kind' => InventoryDocument::ADJUSTMENT_KIND_STOCK,
                'adjustment_source' => InventoryDocument::ADJUSTMENT_SOURCE_MANUAL,
            ]);

        $returnDocumentIds = DB::table('inventory_documents')
            ->where('type', 'return')
            ->select('id');

        DB::table('inventory_documents')
            ->where('type', 'adjustment')
            ->where(function ($query) use ($returnDocumentIds) {
                $query
                    ->whereIn('parent_document_id', $returnDocumentIds)
                    ->orWhere(function ($nested) use ($returnDocumentIds) {
                        $nested
                            ->where('reference_type', 'inventory_document')
                            ->whereIn('reference_id', $returnDocumentIds);
                    });
            })
            ->update([
                'adjustment_kind' => InventoryDocument::ADJUSTMENT_KIND_EXPORT,
                'adjustment_source' => InventoryDocument::ADJUSTMENT_SOURCE_RETURN_RECONCILIATION,
            ]);
    }

    public function down(): void
    {
        Schema::table('inventory_documents', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_documents', 'adjustment_source')) {
                $table->dropIndex('inventory_documents_adjustment_source_idx');
                $table->dropColumn('adjustment_source');
            }

            if (Schema::hasColumn('inventory_documents', 'adjustment_kind')) {
                $table->dropIndex('inventory_documents_type_adjustment_kind_idx');
                $table->dropColumn('adjustment_kind');
            }
        });
    }
};
