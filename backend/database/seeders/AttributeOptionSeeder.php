<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class AttributeOptionSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Add options for "Nghệ nhân chế tác" (ID: 1)
        $artists = ['Nghệ nhân Phạm Anh Đạo', 'Nghệ nhân Trần Độ', 'Nghệ nhân Lê Văn Kiên'];
        foreach ($artists as $index => $val) {
            \App\Models\AttributeOption::updateOrCreate(
                ['attribute_id' => 1, 'value' => $val],
                ['order' => $index]
            );
        }

        // Add options for "Loại men" (ID: 6)
        $glazes = ['Men Lam Cổ', 'Men Rạn', 'Men Ngọc', 'Men Hoả Biến'];
        foreach ($glazes as $index => $val) {
            \App\Models\AttributeOption::updateOrCreate(
                ['attribute_id' => 6, 'value' => $val],
                ['order' => $index]
            );
        }
    }
}
