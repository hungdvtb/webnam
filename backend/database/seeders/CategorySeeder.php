<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class CategorySeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        \App\Models\Category::create(['name' => 'Bình Gốm', 'slug' => 'binh-gom']);
        \App\Models\Category::create(['name' => 'Bộ Ấm Trà', 'slug' => 'bo-am-tra']);
        \App\Models\Category::create(['name' => 'Đồ Trang Trí', 'slug' => 'do-trang-tri']);
        \App\Models\Category::create(['name' => 'Gốm Tâm Linh', 'slug' => 'gom-tam-linh']);
    }
}
