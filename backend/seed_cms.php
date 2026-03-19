<?php

use App\Models\Account;
use App\Models\Banner;
use App\Models\SiteSetting;

require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

echo "Seeding CMS Content...\n";

$account = Account::first();
if (!$account) {
    echo "No account found. Please seed accounts first.\n";
    exit;
}

// Banners
Banner::truncate();
Banner::create([
    'account_id' => $account->id,
    'title' => 'Tinh Hoa Đất Việt',
    'subtitle' => 'Nơi lưu giữ hồn cốt gốm sứ ngàn năm, kết tinh từ lửa và đất mẹ.',
    'image_url' => 'https://lh3.googleusercontent.com/aida-public/AB6AXuDxyxuenD-UTiSSDUsliBib3rtgLHsYtiaH9MZN635eMD2i5g6jBh21b_i4PS_GT-soo2VMNLwfy-Oq73sxuHpQzbLd0Q_s9D1BH0YlxEqdZH8QEUgJYgO69GgRJ7_S90Z0flvVhLFMtyRI4JYn5oDhNjJMOQQaPXYg1SOZi9xdBl-CuNrWoXgMx6FnoRXcNlQW805WC7pDVrZpAcA2C5nFT-F8aUk5Y9RG_yhTxI8LujIcyvaI3MKicA_JeOFP3EJ48T_0LzUsYQM',
    'button_text' => 'Xem Bộ Sưu Tập',
    'link_url' => '/shop',
    'sort_order' => 1,
    'is_active' => true,
]);

// Site Settings
SiteSetting::truncate();
SiteSetting::setValue('site_name', 'Gốm Sứ Đại Thành', $account->id);
SiteSetting::setValue('contact_phone', '0988 123 456', $account->id);
SiteSetting::setValue('contact_email', 'contact@gomsu.vn', $account->id);
SiteSetting::setValue('footer_text', '© 2026 Gốm Sứ Đại Thành. Preservation of Vietnamese Heritage.', $account->id);
SiteSetting::setValue('about_story_title', 'Di Sản Ngàn Năm Trong Tầm Tay', $account->id);
SiteSetting::setValue(
    'about_story_content',
    'Từ những làng nghề truyền thống Bát Tràng, Chu Đậu, mỗi sản phẩm tại Gốm Sứ Đại Thành đều được chế tác thủ công bởi những nghệ nhân bậc thầy, lưu giữ những kỹ thuật phục dựng men cổ quý hiếm.',
    $account->id
);
SiteSetting::setValue('header_brand_text', 'Gốm Đại Thành', $account->id);
SiteSetting::setValue('header_notice_text', 'MIỄN PHÍ VẬN CHUYỂN TOÀN QUỐC CHO ĐƠN HÀNG TỪ 500.000Đ', $account->id);
SiteSetting::setValue('header_search_placeholder', 'Bạn cần tìm kiếm sản phẩm gì?', $account->id);
SiteSetting::setValue('header_menu_items', json_encode([
    ['id' => 'header-menu-products', 'label' => 'Sản phẩm', 'link' => '/san-pham', 'enabled' => true, 'order' => 1],
    ['id' => 'header-menu-about', 'label' => 'Về chúng tôi', 'link' => '/about', 'enabled' => true, 'order' => 2],
    ['id' => 'header-menu-knowledge', 'label' => 'Kiến thức gốm', 'link' => '/blog', 'enabled' => true, 'order' => 3],
    ['id' => 'header-menu-store', 'label' => 'Hệ thống cửa hàng', 'link' => '/he-thong-cua-hang', 'enabled' => true, 'order' => 4],
], JSON_UNESCAPED_UNICODE), $account->id);

echo "CMS seeding complete!\n";

