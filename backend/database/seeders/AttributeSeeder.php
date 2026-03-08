<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class AttributeSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $account = \App\Models\Account::where('subdomain', 'demo')->first();
        $accountId = $account ? $account->id : (\App\Models\Account::first()?->id ?? null);

        $attributesData = [
            ['name' => 'Nghệ nhân chế tác', 'code' => 'nghe_nhan', 'frontend_type' => 'text', 'is_filterable' => true],
            ['name' => 'Câu chuyện sản phẩm', 'code' => 'cau_chuyen', 'frontend_type' => 'textarea', 'is_filterable' => false],
            ['name' => 'Ngày ra lò', 'code' => 'ngay_ra_lo', 'frontend_type' => 'date', 'is_filterable' => true],
            ['name' => 'Hàng phi mậu dịch (Không bán)', 'code' => 'phi_mau_dich', 'frontend_type' => 'boolean', 'is_filterable' => true],
            ['name' => 'Chứng chỉ chất lượng', 'code' => 'chung_chi', 'frontend_type' => 'multiselect', 'is_filterable' => true, 'options' => ['ISO 9001', 'OCOP 4 sao', 'OCOP 5 sao', 'Hàng VN CLC']],
            ['name' => 'Loại men', 'code' => 'loai_men', 'frontend_type' => 'select', 'is_filterable' => true, 'options' => ['Men rạn', 'Men lam', 'Men ngọc', 'Men nâu', 'Men hoàng thạch']],
            ['name' => 'Phí bảo hiểm vận chuyển', 'code' => 'phi_bao_hiem', 'frontend_type' => 'price', 'is_filterable' => false],
            ['name' => 'Giấy chứng nhận (Ảnh)', 'code' => 'anh_chung_nhan', 'frontend_type' => 'media_image', 'is_filterable' => false],
        ];

        foreach ($attributesData as $data) {
            $options = $data['options'] ?? null;
            unset($data['options']);
            $data['account_id'] = $accountId;
            
            // Allow creating globally scoped without session so temporarily remove global scope issues
            $existing = \App\Models\Attribute::withoutGlobalScope('account_id')
                ->where('code', $data['code'])
                ->where('account_id', $accountId)
                ->first();

            if (!$existing && $accountId) {
                // Remove global scope to create via normal eloquent or use DB
                // Easier to disable it briefly or just insert. DB is safer for bypassing traits depending on config.
                $attrId = \Illuminate\Support\Facades\DB::table('attributes')->insertGetId([
                    'name' => $data['name'],
                    'code' => $data['code'],
                    'frontend_type' => $data['frontend_type'],
                    'is_filterable' => $data['is_filterable'],
                    'is_required' => false,
                    'account_id' => $accountId,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                if ($options && in_array($data['frontend_type'], ['select', 'multiselect'])) {
                    foreach ($options as $idx => $opt) {
                        \Illuminate\Support\Facades\DB::table('attribute_options')->insert([
                            'attribute_id' => $attrId,
                            'value' => $opt,
                            'order' => $idx,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }
                }
            }
        }
    }
}
