<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_documents', function (Blueprint $table) {
            if (!Schema::hasColumn('inventory_documents', 'parent_document_id')) {
                $table->foreignId('parent_document_id')
                    ->nullable()
                    ->after('reference_id')
                    ->constrained('inventory_documents')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn('inventory_documents', 'batch_group_key')) {
                $table->string('batch_group_key', 120)->nullable()->after('parent_document_id');
                $table->index('batch_group_key', 'inventory_documents_batch_group_key_idx');
            }

            if (!Schema::hasColumn('inventory_documents', 'meta')) {
                $table->json('meta')->nullable()->after('notes');
            }
        });

        Schema::table('inventory_document_items', function (Blueprint $table) {
            if (!Schema::hasColumn('inventory_document_items', 'meta')) {
                $table->json('meta')->nullable()->after('notes');
            }
        });

        Schema::create('inventory_document_order_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_document_id')->constrained('inventory_documents')->cascadeOnDelete();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(
                ['inventory_document_id', 'order_id'],
                'inventory_document_order_links_document_order_unique'
            );
            $table->index(['account_id', 'order_id'], 'inventory_document_order_links_account_order_idx');
        });

        Schema::create('inventory_document_item_order_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('inventory_document_item_id')->constrained('inventory_document_items')->cascadeOnDelete();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedInteger('exported_quantity')->default(0);
            $table->unsignedInteger('actual_quantity')->default(0);
            $table->integer('export_adjustment_quantity')->default(0);
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(
                ['order_id', 'product_id'],
                'inventory_document_item_order_links_order_product_idx'
            );
            $table->index(
                ['inventory_document_item_id', 'order_id'],
                'inventory_document_item_order_links_item_order_idx'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_document_item_order_links');
        Schema::dropIfExists('inventory_document_order_links');

        Schema::table('inventory_document_items', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_document_items', 'meta')) {
                $table->dropColumn('meta');
            }
        });

        Schema::table('inventory_documents', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_documents', 'meta')) {
                $table->dropColumn('meta');
            }

            if (Schema::hasColumn('inventory_documents', 'batch_group_key')) {
                $table->dropIndex('inventory_documents_batch_group_key_idx');
                $table->dropColumn('batch_group_key');
            }

            if (Schema::hasColumn('inventory_documents', 'parent_document_id')) {
                $table->dropConstrainedForeignId('parent_document_id');
            }
        });
    }
};
