<?php

use App\Models\Account;
use App\Support\OrderStatusCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('accounts') || !Schema::hasTable('order_statuses')) {
            return;
        }

        Account::query()
            ->orderBy('id')
            ->each(fn (Account $account) => OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id, true));
    }

    public function down(): void
    {
        // Data repair only. Keep restored statuses in place when rolling back.
    }
};
