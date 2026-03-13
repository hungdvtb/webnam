<?php

use App\Models\Category;
use App\Models\Account;

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Seeding category banners and descriptions for GSDT...\n";

$account = Account::where('site_code', 'GSDT')->first();
if (!$account) {
    die("Account GSDT not found.\n");
}

$categories = [
    'gom-men-lam' => [
        'description' => 'Sắc xanh huyền bí của đại dương hội tụ trong từng đường nét vẽ tay tinh xảo từ các nghệ nhân làng gốm Bát Tràng.',
        'banner_path' => 'category_banners/men-lam.png'
    ],
    'gom-men-ran' => [
        'description' => 'Vẻ đẹp thời gian ngưng đọng trong từng vết rạn độc bản, mang hơi thở cung đình xưa.',
        'banner_path' => 'category_banners/men-ran.png'
    ],
    'bo-am-tra-dao' => [
        'description' => 'Thưởng trà trong không gian nghệ thuật với những chén trà gốm sứ cao cấp, tinh hoa trà đạo Việt.',
        'banner_path' => 'category_banners/tra-dao.png'
    ],
];

foreach ($categories as $slug => $data) {
    Category::where('slug', $slug)
        ->where('account_id', $account->id)
        ->update($data);
}

echo "Seeding completed.\n";
