<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Support\OrderStatusCatalog;
use Illuminate\Database\Seeder;

class OrderStatusSeeder extends Seeder
{
    public function run(): void
    {
        Account::query()
            ->orderBy('id')
            ->each(fn (Account $account) => OrderStatusCatalog::ensureDefaultSystemStatuses((int) $account->id, true));
    }
}
