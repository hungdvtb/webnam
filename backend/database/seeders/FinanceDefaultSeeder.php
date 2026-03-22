<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Services\Finance\FinanceService;
use Illuminate\Database\Seeder;

class FinanceDefaultSeeder extends Seeder
{
    public function run(): void
    {
        $service = app(FinanceService::class);

        Account::query()->pluck('id')->each(function ($accountId) use ($service) {
            $service->ensureDefaults((int) $accountId);
        });
    }
}
