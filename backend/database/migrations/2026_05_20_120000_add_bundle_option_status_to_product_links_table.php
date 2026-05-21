<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (!Schema::hasColumn('product_links', 'bundle_option_status')) {
                $column = $table->string('bundle_option_status', 20)->default('visible');

                if (Schema::hasColumn('product_links', 'bundle_option_uid')) {
                    $column->after('bundle_option_uid');
                } elseif (Schema::hasColumn('product_links', 'option_post_id')) {
                    $column->after('option_post_id');
                }
            }
        });

        if (Schema::hasColumn('product_links', 'bundle_option_status')) {
            DB::table('product_links')
                ->where('link_type', 'bundle')
                ->where(function ($query) {
                    $query
                        ->whereNull('bundle_option_status')
                        ->orWhere('bundle_option_status', '');
                })
                ->update(['bundle_option_status' => 'visible']);
        }
    }

    public function down(): void
    {
        Schema::table('product_links', function (Blueprint $table) {
            if (Schema::hasColumn('product_links', 'bundle_option_status')) {
                $table->dropColumn('bundle_option_status');
            }
        });
    }
};
