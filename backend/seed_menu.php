<?php

use App\Models\Account;
use App\Models\Menu;
use App\Models\MenuItem;

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Creating demo menu for GSDT...\n";

$account = Account::where('site_code', 'GSDT')->first();

if (!$account) {
    echo "Account GSDT not found. Creating it first...\n";
    $account = Account::create([
        'name' => 'Gốm Sứ Đại Thành',
        'subdomain' => 'gom-su-dai-thanh',
        'site_code' => 'GSDT'
    ]);
}

$accountId = $account->id;

// Deactivate old menus for this account
Menu::where('account_id', $accountId)->update(['is_active' => false]);

// Create Main Menu
$menu = Menu::create([
    'account_id' => $accountId,
    'name' => 'Main Menu',
    'code' => 'main-menu',
    'is_active' => true
]);

$items = [
    ['title' => 'SẢN PHẨM', 'url' => '/products'],
    ['title' => 'NGHỆ NHÂN', 'url' => '/artisan'],
    ['title' => 'LỊCH SỬ', 'url' => '/history'],
    ['title' => 'TRIỂN LÃM', 'url' => '/exhibitions'],
];

foreach ($items as $index => $itemData) {
    MenuItem::create([
        'menu_id' => $menu->id,
        'title' => $itemData['title'],
        'url' => $itemData['url'],
        'order' => $index
    ]);
}

echo "Demo menu created successfully for account ID: " . $accountId . "\n";
