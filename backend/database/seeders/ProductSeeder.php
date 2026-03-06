<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class ProductSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $binhGom = \App\Models\Category::where('slug', 'binh-gom')->first();
        $boAmTra = \App\Models\Category::where('slug', 'bo-am-tra')->first();

        \App\Models\Product::create([
            'name' => 'Bình Hút Lộc Men Lam',
            'slug' => 'binh-hut-loc-men-lam',
            'description' => 'Bình hút lộc truyền thống với men xanh lam tinh xảo.',
            'price' => 12500000,
            'category_id' => $binhGom->id,
            'stock_quantity' => 10,
            'is_featured' => true
        ]);

        \App\Models\Product::create([
            'name' => 'Bộ Trà Sen Vàng',
            'slug' => 'bo-tra-sen-vang',
            'description' => 'Bộ ấm chén gốm cao cấp vẽ hoa sen vàng sang trọng.',
            'price' => 8900000,
            'category_id' => $boAmTra->id,
            'stock_quantity' => 5,
            'is_featured' => true
        ]);
        
        // Add more products as needed...
    }
}
