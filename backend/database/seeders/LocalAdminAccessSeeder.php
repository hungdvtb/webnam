<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class LocalAdminAccessSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            return;
        }

        $connection = config('database.default');
        $host = config("database.connections.{$connection}.host");

        if (! in_array($host, ['127.0.0.1', 'localhost', '::1'], true)) {
            return;
        }

        $user = User::query()->firstOrNew([
            'email' => 'admin@webnam.com',
        ]);

        $user->name = filled($user->name) ? $user->name : 'System Admin';
        $user->password = Hash::make('123123');
        $user->is_admin = true;
        $user->status = 1;
        $user->save();
    }
}
