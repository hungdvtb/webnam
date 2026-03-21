<?php

namespace Database\Seeders;

use App\Services\BlogSystemPostService;
use Illuminate\Database\Seeder;

class SystemPostSeeder extends Seeder
{
    public function run(): void
    {
        app(BlogSystemPostService::class)->ensureForAllAccounts();
    }
}
