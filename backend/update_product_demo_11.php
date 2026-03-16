<?php
define('LARAVEL_START', microtime(true));
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;
use App\Models\Attribute;
use App\Models\ProductAttributeValue;

$sku = 'DEMO-CONFIG-4HQRHK-11';
$product = Product::where('sku', $sku)->first();

if ($product) {
    echo "Found product $sku. Updating...\n";
    $product->update([
        'name' => 'Chân Nến Đắp Nổi Phú Quý - Men Ngọc Cổ Bát Tràng',
        'description' => "Đôi chân nến 'Phú Quý Đắp Nổi' là đỉnh cao của nghệ thuật điêu khắc gốm sứ Bát Tràng. Sản phẩm được thực hiện thủ công bởi những nghệ nhân có tay nghề trên 20 năm, với kỹ thuật đắp nổi hoa văn vô cùng tỉ mỉ và sắc nét.\n\nTrên thân chân nến, hình tượng 'Hoa Mẫu Đơn' và 'Rồng Vờn Mây' được đắp nổi sống động, mang ý nghĩa về sự gia đạo bình an, phú quý và uy quyền. Lớp men ngọc (Celadon) đặc trưng của Bát Tràng khoác lên sản phẩm một vẻ đẹp kiêu sa, thanh cao nhưng vẫn giữ được nét cổ kính.\n\nSản phẩm không chỉ là vật thờ cúng ý nghĩa trên ban thờ gia tiên mà còn là một tác phẩm trưng bày phong thủy tuyệt đẹp, giúp cân bằng ngũ hành và hội tụ vượng khí cho gia chủ.",
        'specifications' => json_encode([
            ['label' => 'Chiều cao', 'value' => '35cm'],
            ['label' => 'Đường kính đế', 'value' => '15cm'],
            ['label' => 'Chất liệu', 'value' => 'Gốm sứ cao cấp, Đất sét luyện kỹ'],
            ['label' => 'Loại men', 'value' => 'Men Ngọc Hổ Phách (Celadon)'],
            ['label' => 'Kiểu dáng', 'value' => 'Chân nến đắp nổi truyền thống'],
            ['label' => 'Công dụng', 'value' => 'Thờ cúng, Trang trí nội thất, Quà tặng cao cấp']
        ]),
        'meta_title' => 'Chân Nến Đắp Nổi Phú Quý - Men Ngọc Cổ Bát Tràng | Di Sản Gốm Việt',
        'meta_description' => 'Chân nến gốm sứ Bát Tràng đắp nổi thủ công tinh xảo, sử dụng men ngọc cổ truyền cao cấp. Tác phẩm nghệ thuật phong thủy độc bản.',
        'meta_keywords' => 'chân nến gốm, gốm bát tràng, đắp nổi, men ngọc, đồ thờ cao cấp'
    ]);

    $attributes = [
        'nghe_nhan' => 'Nghệ nhân Đắp nổi Phạm Đạt',
        'loai_men' => 'Men Ngọc Hổ Phách',
        'ngay_ra_lo' => '10/03/2026',
        'chung_chi' => 'Chứng nhận Đồ thờ Tinh hoa Bát Tràng',
        'duongkinh' => '15cm',
        'cau_chuyen' => 'Tác phẩm được lấy cảm hứng từ các đôi chân nến cung đình cổ tại Bảo tàng Lịch sử Quốc gia, mang thông điệp về sự kế thừa và gìn giữ ngọn lửa văn hóa Việt.'
    ];

    foreach ($attributes as $code => $value) {
        $attr = Attribute::where('code', $code)->first();
        if ($attr) {
            ProductAttributeValue::updateOrCreate(
                ['product_id' => $product->id, 'attribute_id' => $attr->id],
                ['value' => $value]
            );
            echo "Updated attribute $code.\n";
        }
    }
    echo "Update complete.\n";
} else {
    echo "Product $sku not found.\n";
}
