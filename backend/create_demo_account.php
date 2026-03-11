<?php
require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$acc = \App\Models\Account::firstOrCreate(
    ['subdomain' => 'chinhanh2'],
    [
        'name' => 'Gốm Sứ Đại Thành - Chi nhánh 2',
        'domain' => 'chinhanh2.webnam.com',
        'status' => 1,
        'site_code' => 'GOMDAITHANH_CN2'
    ]
);

echo "Account created: " . $acc->id . "\n";
