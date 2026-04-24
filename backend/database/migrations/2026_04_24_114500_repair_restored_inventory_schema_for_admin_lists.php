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
        if (!Schema::hasTable('inventory_documents')) {
            return;
        }

        Schema::table('inventory_documents', function (Blueprint $table) {
            if (!Schema::hasColumn('inventory_documents', 'adjustment_kind')) {
                $table->string('adjustment_kind', 40)->nullable()->after('type');
            }

            if (!Schema::hasColumn('inventory_documents', 'adjustment_source')) {
                $table->string('adjustment_source', 60)->nullable()->after('adjustment_kind');
            }

            if (!Schema::hasColumn('inventory_documents', 'deleted_at')) {
                $table->softDeletes()->after('updated_at');
            }
        });

        if (!$this->pgIndexExists('inventory_documents', 'inventory_documents_type_adjustment_kind_idx')) {
            Schema::table('inventory_documents', function (Blueprint $table) {
                $table->index(['type', 'adjustment_kind'], 'inventory_documents_type_adjustment_kind_idx');
            });
        }

        if (!$this->pgIndexExists('inventory_documents', 'inventory_documents_adjustment_source_idx')) {
            Schema::table('inventory_documents', function (Blueprint $table) {
                $table->index('adjustment_source', 'inventory_documents_adjustment_source_idx');
            });
        }

        DB::table('inventory_documents')
            ->where('type', 'adjustment')
            ->whereNull('adjustment_kind')
            ->update([
                'adjustment_kind' => InventoryDocument::ADJUSTMENT_KIND_STOCK,
            ]);

        DB::table('inventory_documents')
            ->where('type', 'adjustment')
            ->whereNull('adjustment_source')
            ->update([
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
        // This is an environment repair migration. Keep rollback as a no-op
        // to avoid dropping recovered columns from restored data.
    }

    private function pgIndexExists(string $table, string $indexName): bool
    {
        return DB::table('pg_indexes')
            ->where('schemaname', 'public')
            ->where('tablename', $table)
            ->where('indexname', $indexName)
            ->exists();
    }
};
