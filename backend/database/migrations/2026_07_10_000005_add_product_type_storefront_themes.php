<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->addThemeColumns('accounts');
        $this->addThemeColumns('stores');
    }

    public function down(): void
    {
        $this->dropThemeColumns('stores');
        $this->dropThemeColumns('accounts');
    }

    private function addThemeColumns(string $tableName): void
    {
        if (!Schema::hasTable($tableName) || !Schema::hasTable('storefront_themes')) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($tableName) {
            $afterColumn = Schema::hasColumn($tableName, 'storefront_theme_id')
                ? 'storefront_theme_id'
                : (Schema::hasColumn($tableName, 'public_domain_id') ? 'public_domain_id' : 'id');

            if (!Schema::hasColumn($tableName, 'simple_product_theme_id')) {
                $table->foreignId('simple_product_theme_id')
                    ->nullable()
                    ->after($afterColumn)
                    ->constrained('storefront_themes')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn($tableName, 'configurable_product_theme_id')) {
                $table->foreignId('configurable_product_theme_id')
                    ->nullable()
                    ->after('simple_product_theme_id')
                    ->constrained('storefront_themes')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn($tableName, 'bundle_product_theme_id')) {
                $table->foreignId('bundle_product_theme_id')
                    ->nullable()
                    ->after('configurable_product_theme_id')
                    ->constrained('storefront_themes')
                    ->nullOnDelete();
            }
        });
    }

    private function dropThemeColumns(string $tableName): void
    {
        if (!Schema::hasTable($tableName)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($tableName) {
            foreach ([
                'simple_product_theme_id',
                'configurable_product_theme_id',
                'bundle_product_theme_id',
            ] as $column) {
                if (Schema::hasColumn($tableName, $column)) {
                    $table->dropConstrainedForeignId($column);
                }
            }
        });
    }
};
