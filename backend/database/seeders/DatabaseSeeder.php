<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::query()->updateOrCreate([
            'email' => 'admin@webnam.com',
        ], [
            'name' => 'Admin User',
            'password' => Hash::make('123123'),
            'is_admin' => true,
            'status' => 1,
            'permissions' => null,
        ]);

        $this->call([
            DemoContentSeeder::class,
            SystemPostSeeder::class,
            FinanceDefaultSeeder::class,
        ]);
    }
}
