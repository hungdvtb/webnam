<?php

define('LARAVEL_START', microtime(true));

require __DIR__ . '/vendor/autoload.php';

$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;
use Illuminate\Support\Facades\DB;

const ML80_EXPORT_PATH = __DIR__ . '/storage/app/generated/ml80-men-lam-content.json';
const ML80_DURABILITY = 'Nung >1200°C, bền màu';
const ML80_MATERIAL = 'Gốm Bát Tràng, cốt dày';
const ML80_GLAZE = 'Men lam truyền thống';

$writeToDatabase = !in_array('--export-only', $argv, true);
$profiles = ml80Profiles();

$products = Product::query()
    ->where('sku', 'like', 'ML80-%')
    ->orderBy('sku')
    ->get();

if ($products->isEmpty()) {
    fwrite(STDERR, "Khong tim thay san pham ML80-* trong he thong.\n");
    exit(1);
}

$generatedRows = [];

foreach ($products as $product) {
    $profile = ml80ResolveProfile($product->sku, $profiles);

    if ($profile === null) {
        fwrite(STDERR, "Chua co profile cho SKU {$product->sku}.\n");
        exit(1);
    }

    $payload = ml80GeneratePayload($product, $profile);
    ml80ValidatePayload($product->sku, $payload);

    if ($writeToDatabase) {
        DB::transaction(function () use ($product, $payload) {
            $product->forceFill([
                'description' => $payload['description'],
                'specifications' => json_encode($payload['specs'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'meta_title' => $payload['meta']['title'],
                'meta_description' => $payload['meta']['description'],
            ])->save();
        });
    }

    $generatedRows[] = [
        'product_id' => $product->id,
        'sku' => $product->sku,
        'title' => $product->name,
        'slug' => $product->slug,
        'description' => $payload['description'],
        'meta' => $payload['meta'],
        'specs' => $payload['specs'],
    ];
}

ml80EnsureDirectory(dirname(ML80_EXPORT_PATH));
file_put_contents(
    ML80_EXPORT_PATH,
    json_encode([
        'generated_at' => date('c'),
        'write_to_database' => $writeToDatabase,
        'count' => count($generatedRows),
        'items' => $generatedRows,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);

echo sprintf(
    "Da %s noi dung cho %d san pham ML80 va xuat file %s\n",
    $writeToDatabase ? 'cap nhat' : 'tao',
    count($generatedRows),
    ML80_EXPORT_PATH
);

function ml80Profiles(): array
{
    return [
        'ML80-AMTRA' => [
            'kind' => 'am_tra',
            'seo_name' => 'Ấm trà men lam sen',
            'motif' => 'hoa sen',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng ấm thờ đồng bộ với bộ trà men lam',
            'use' => 'Dùng dâng trà hoặc nước thanh khiết trên ban thờ',
            'altar' => 'Ban thờ gia tiên, ban thờ Phật và phòng thờ gia đình',
            'painting' => 'Có, họa tiết sen được nghệ nhân vẽ tay',
            'cta_use' => 'dâng trà, nước thanh khiết',
        ],
        'ML80-BATCOM' => [
            'kind' => 'bat_com',
            'seo_name' => 'Bát cơm men lam sen',
            'motif' => 'hoa sen',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng bát thờ cân đối, đồng bộ với bộ men lam',
            'use' => 'Dùng dâng cơm cúng trong các dịp lễ, giỗ, rằm và mùng một',
            'altar' => 'Ban thờ gia tiên, bàn thờ gia đình và từ đường',
            'painting' => 'Có, men lam kết hợp họa tiết sen vẽ tay',
            'cta_use' => 'dâng cơm cúng trang trọng',
        ],
        'ML80-BATGA' => [
            'kind' => 'bat_ga',
            'seo_name' => 'Bát gà men lam sen',
            'motif' => 'hoa sen',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng bát lòng sâu, phù hợp bày lễ mặn',
            'use' => 'Dùng đặt gà cúng, xôi hoặc lễ mặn trên ban thờ',
            'altar' => 'Ban thờ gia tiên, nhà thờ họ và không gian thờ ngày giỗ lễ lớn',
            'painting' => 'Có, hoa văn sen xanh lam được vẽ tay',
            'cta_use' => 'bày gà cúng và lễ mặn chỉn chu',
        ],
        'ML80-BATTHAHOA' => [
            'kind' => 'bat_tha_hoa',
            'seo_name' => 'Bát thả hoa thả cá men lam 22cm',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Đường kính miệng',
            'dimension_value' => '22cm',
            'use' => 'Dùng làm bát tụ thủy thả hoa, thả cá cho ban Thần Tài',
            'altar' => 'Ban Thần Tài, Ông Địa và quầy thờ kinh doanh',
            'painting' => 'Có, hoàn thiện thủ công theo phong cách men lam',
            'cta_use' => 'tụ thủy sinh tài cho ban Thần Tài',
        ],
        'ML80-BATTRASAM-S2' => [
            'kind' => 'bat_tra_sam',
            'seo_name' => 'Bát trà sâm men lam S2',
            'motif' => 'hoa sen',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Cỡ S2, đồng bộ với ấm trà và kỷ chén men lam',
            'use' => 'Dùng dâng trà, nước hoặc trà sâm trên ban thờ',
            'altar' => 'Ban thờ gia tiên, ban Phật và bàn thờ gia đình',
            'painting' => 'Có, họa tiết sen được vẽ tay thủ công',
            'cta_use' => 'dâng trà sâm và nước thờ gọn đẹp',
        ],
        'ML80-BATHUONGLAM' => [
            'kind' => 'bat_huong',
            'seo_name' => 'Bát hương men lam rồng như ý',
            'motif' => 'rồng như ý',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Nhiều cỡ đồng bộ theo bộ đồ thờ men lam',
            'use' => 'Dùng cắm hương và làm trung tâm bố cục thờ cúng',
            'altar' => 'Ban thờ gia tiên, bàn thờ thần linh và phòng thờ truyền thống',
            'painting' => 'Có, họa tiết rồng như ý được vẽ tay',
            'cta_use' => 'giữ tâm hương trang nghiêm trên ban thờ',
        ],
        'ML80-BOMATTROIMENLAM45CM' => [
            'kind' => 'bo_mat_troi',
            'seo_name' => 'Bộ mặt trời men lam 45cm',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Cỡ 45cm, kèm khay gỗ trưng bày',
            'use' => 'Dùng làm điểm nhấn trang trí và hoàn thiện bố cục ban thờ',
            'altar' => 'Ban thờ gia tiên, án gian và phòng thờ cần điểm nhấn trung tâm',
            'painting' => 'Có, hoa văn men lam được hoàn thiện thủ công',
            'cta_use' => 'tạo điểm nhấn sang trọng cho không gian thờ',
        ],
        'ML80-COCDUNGPHATTHU' => [
            'kind' => 'coc_phat_thu',
            'seo_name' => 'Cốc đựng phật thủ S1 men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Cỡ S1, gọn vừa cho quả phật thủ thờ',
            'use' => 'Dùng cố định và tôn dáng quả phật thủ trên ban thờ',
            'altar' => 'Ban thờ gia tiên, ban Thần Tài và ban Phật',
            'painting' => 'Có, dáng cốc được hoàn thiện thủ công',
            'cta_use' => 'giữ quả phật thủ đẹp dáng và trang trọng',
        ],
        'ML80-CHANNEN' => [
            'kind' => 'chan_nen',
            'seo_name' => 'Đôi chân nến men lam sen',
            'motif' => 'hoa sen',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng đôi cân xứng, phối hai bên bát hương',
            'use' => 'Dùng cắm nến thờ, tạo thế cân đối và ấm sáng cho ban thờ',
            'altar' => 'Ban thờ gia tiên, ban Phật và án thờ truyền thống',
            'painting' => 'Có, họa tiết sen men lam vẽ tay',
            'cta_use' => 'giữ ánh nến thờ cân xứng, trang nghiêm',
        ],
        'ML80-CHOESENLAM' => [
            'kind' => 'choe_muoi_gao_nuoc',
            'seo_name' => 'Chóe muối gạo nước men lam sen',
            'motif' => 'hoa sen',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng chóe nhỏ gọn, đồng bộ với bộ thờ men lam',
            'use' => 'Dùng đựng muối, gạo, nước trong nghi thức thờ cúng',
            'altar' => 'Ban thờ gia tiên, ban Thần Tài và bàn thờ gia đình',
            'painting' => 'Có, men lam phối họa tiết sen vẽ tay',
            'cta_use' => 'bày muối gạo nước đầy đủ trên ban thờ',
        ],
        'ML80-DEBATHUONG' => [
            'kind' => 'de_bat_huong',
            'seo_name' => 'Đế bát hương men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Thiết kế đồng bộ theo chân bát hương men lam',
            'use' => 'Dùng kê bát hương, nâng dáng và tạo thế vững chắc',
            'altar' => 'Ban thờ gia tiên, ban thần linh và phòng thờ truyền thống',
            'painting' => 'Có, hoàn thiện thủ công đồng bộ với bộ men lam',
            'cta_use' => 'kê bát hương chắc chắn và đẹp thế',
        ],
        'ML80-DENLAM' => [
            'kind' => 'den_tho',
            'seo_name' => 'Đèn thờ men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng đèn thờ đồng bộ với bộ đồ thờ men lam',
            'use' => 'Dùng bài trí đèn thờ hai bên ban thờ, giữ nguồn sáng trang nghiêm',
            'altar' => 'Ban thờ gia tiên, ban Phật và ban Thần Tài',
            'painting' => 'Có, thân đèn được hoàn thiện thủ công',
            'cta_use' => 'giữ ánh sáng thờ ấm và trang nghiêm',
        ],
        'ML80-DIALAM' => [
            'kind' => 'dia_tho',
            'seo_name' => 'Đĩa thờ men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng đĩa thờ phẳng lòng, dễ bày lễ vật',
            'use' => 'Dùng bày oản, bánh trái, lễ khô hoặc hoa quả nhỏ',
            'altar' => 'Ban thờ gia tiên, bàn thờ gia đình và bàn thờ thần linh',
            'painting' => 'Có, viền và lòng đĩa được vẽ tay',
            'cta_use' => 'bày lễ vật gọn gàng trên ban thờ',
        ],
        'ML80-DIATRAU-F12' => [
            'kind' => 'dia_trau',
            'seo_name' => 'Đĩa trầu men lam F12',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Form F12, phù hợp bày trầu cau và lễ nhỏ',
            'use' => 'Dùng bày trầu cau, cánh phượng và lễ vật nhỏ trên ban thờ',
            'altar' => 'Ban thờ gia tiên, bàn thờ cưới hỏi và phòng thờ truyền thống',
            'painting' => 'Có, hoa văn men lam được hoàn thiện thủ công',
            'cta_use' => 'bày trầu cau đẹp mắt và thành kính',
        ],
        'ML80-DOTTRAM' => [
            'kind' => 'dot_tram',
            'seo_name' => 'Đốt trầm men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng đốt trầm gọn, phù hợp nhiều vị trí trên bàn thờ',
            'use' => 'Dùng đốt trầm hương, giúp không gian thờ thêm thanh tịnh',
            'altar' => 'Ban thờ gia tiên, thiền thất và phòng thờ gia đình',
            'painting' => 'Có, sản phẩm được hoàn thiện thủ công',
            'cta_use' => 'xông trầm và thanh lọc không gian thờ',
        ],
        'ML80-KYNGAILAM' => [
            'kind' => 'ky_ngai',
            'seo_name' => 'Kỷ ngai men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng kỷ ngai gọn, đồng bộ với chén thờ men lam',
            'use' => 'Dùng dâng nước, trà hoặc rượu theo lối bài trí truyền thống',
            'altar' => 'Ban thờ gia tiên, ban thần linh và bàn thờ gia đình',
            'painting' => 'Có, thân kỷ và viền men được làm thủ công',
            'cta_use' => 'dâng nước thờ chỉn chu và gọn đẹp',
        ],
        'ML80-LOHOALAM' => [
            'kind' => 'lo_hoa',
            'seo_name' => 'Lọ hoa men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng lọ cân đối, thường đặt đối xứng hai bên ban thờ',
            'use' => 'Dùng cắm hoa tươi, hoa sen, hoa cúc hoặc hoa thờ theo mùa',
            'altar' => 'Ban thờ gia tiên, ban Phật và bàn thờ gia đình',
            'painting' => 'Có, hoa văn men lam được vẽ tay',
            'cta_use' => 'cắm hoa thờ thanh nhã và đón sinh khí',
        ],
        'ML80-LUCBINHLAM' => [
            'kind' => 'luc_binh',
            'seo_name' => 'Lục bình men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng lục bình tròn bụng, thu cổ, nở miệng đặc trưng',
            'use' => 'Dùng trưng bày hai bên ban thờ hoặc trong phòng thờ',
            'altar' => 'Phòng thờ gia tiên, từ đường và không gian thờ rộng',
            'painting' => 'Có, thân bình được vẽ tay và hoàn thiện thủ công',
            'cta_use' => 'tạo thế cân đối và chiêu khí cho phòng thờ',
        ],
        'ML80-MAMBONGLAM' => [
            'kind' => 'mam_bong',
            'seo_name' => 'Mâm bồng men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng mâm cao chân, thuận tiện bày ngũ quả và bánh oản',
            'use' => 'Dùng bày ngũ quả, bánh oản hoặc lễ phẩm trên ban thờ',
            'altar' => 'Ban thờ gia tiên, ban Phật và bàn thờ gia đình',
            'painting' => 'Có, hoa văn men lam được vẽ tay',
            'cta_use' => 'nâng lễ vật đẹp mắt và trang trọng',
        ],
        'ML80-NAMRUOULAM' => [
            'kind' => 'nam_ruou',
            'seo_name' => 'Nậm rượu men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng nậm thờ truyền thống, đồng bộ với chén thờ men lam',
            'use' => 'Dùng đựng rượu cúng hoặc nước thơm dâng lễ',
            'altar' => 'Ban thờ gia tiên, bàn thờ thần linh và từ đường',
            'painting' => 'Có, thân nậm được hoàn thiện thủ công',
            'cta_use' => 'dâng rượu cúng trang nghiêm và gọn đẹp',
        ],
        'ML80-ONGHUONG' => [
            'kind' => 'ong_huong_parent',
            'seo_name' => 'Ống hương men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Có các cỡ S1 cao 22cm, S2 cao 20cm và S3 cao 17cm',
            'use' => 'Dùng đựng hương sạch, giữ bàn thờ gọn gàng',
            'altar' => 'Ban thờ gia tiên, ban Phật và ban Thần Tài',
            'painting' => 'Có, hoa văn men lam được hoàn thiện thủ công',
            'cta_use' => 'giữ hương thờ ngăn nắp, sạch sẽ',
        ],
        'ML80-ONGHUONG-S1-22' => [
            'kind' => 'ong_huong_variant',
            'seo_name' => 'Ống hương men lam S1 22cm',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Chiều cao',
            'dimension_value' => '22cm (size S1)',
            'use' => 'Dùng đựng hương dài, giữ khu vực thờ gọn đẹp',
            'altar' => 'Ban thờ gia tiên và bàn thờ cần ống hương dáng cao',
            'painting' => 'Có, hoa văn men lam được làm thủ công',
            'cta_use' => 'đựng hương dài và giữ bàn thờ gọn đẹp',
        ],
        'ML80-ONGHUONG-S2-20' => [
            'kind' => 'ong_huong_variant',
            'seo_name' => 'Ống hương men lam S2 20cm',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Chiều cao',
            'dimension_value' => '20cm (size S2)',
            'use' => 'Dùng đựng hương thờ phổ thông trên bàn thờ gia đình',
            'altar' => 'Ban thờ gia tiên, ban Phật và bàn thờ gia đình',
            'painting' => 'Có, sản phẩm được hoàn thiện thủ công',
            'cta_use' => 'đựng hương thờ phổ thông gọn gàng',
        ],
        'ML80-ONGHUONG-S3-17' => [
            'kind' => 'ong_huong_variant',
            'seo_name' => 'Ống hương men lam S3 17cm',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Chiều cao',
            'dimension_value' => '17cm (size S3)',
            'use' => 'Dùng đựng hương ngắn hoặc đặt trên bàn thờ nhỏ gọn',
            'altar' => 'Ban thờ nhỏ, ban Thần Tài và kệ thờ gọn',
            'painting' => 'Có, hoàn thiện thủ công theo phong cách men lam',
            'cta_use' => 'đựng hương trên bàn thờ nhỏ gọn',
        ],
        'ML80-ONGHUONGLAM' => [
            'kind' => 'ong_huong_simple',
            'seo_name' => 'Ống hương men lam',
            'motif' => 'men lam truyền thống',
            'dimension_label' => 'Kích thước',
            'dimension_value' => 'Dáng ống hương tiêu chuẩn, dễ phối với nhiều bộ thờ',
            'use' => 'Dùng đựng hương sạch, giữ bàn thờ ngăn nắp và trang nghiêm',
            'altar' => 'Ban thờ gia tiên, ban Phật và ban Thần Tài',
            'painting' => 'Có, hoàn thiện thủ công đồng bộ với bộ men lam',
            'cta_use' => 'giữ hương sạch và bàn thờ gọn đẹp',
        ],
    ];
}

function ml80ResolveProfile(string $sku, array $profiles): ?array
{
    $aliases = [
        'ML80-ONGHUONG-COPY' => 'ML80-ONGHUONG',
        'ML80-ONGHUONG-COPY-V1' => 'ML80-ONGHUONG-S1-22',
        'ML80-ONGHUONG-COPY-V2' => 'ML80-ONGHUONG-S2-20',
        'ML80-ONGHUONG-COPY-V3' => 'ML80-ONGHUONG-S3-17',
    ];

    $lookupKey = $aliases[$sku] ?? $sku;

    return $profiles[$lookupKey] ?? null;
}

function ml80GeneratePayload(Product $product, array $profile): array
{
    return [
        'description' => ml80Description($product->name, $profile),
        'meta' => [
            'title' => ml80MetaTitle($profile),
            'description' => ml80MetaDescription($profile),
        ],
        'specs' => ml80Specifications($profile),
    ];
}

function ml80Description(string $productName, array $profile): string
{
    $kind = $profile['kind'];

    $paragraphs = match ($kind) {
        'am_tra' => [
            "{$productName} là món phụ kiện thờ được nhiều gia đình lựa chọn khi muốn hoàn thiện bộ trà thờ men lam theo phong cách Bát Tràng truyền thống. Sản phẩm được tạo dáng thủ công từ cốt gốm dày, phủ lớp men lam xanh sâu và nhấn bằng {$profile['motif']} vẽ tay nên nhìn rất thanh nhã, sạch mắt và có chiều sâu cổ điển. Nhờ được nung ở nhiệt độ cao, bề mặt men ổn định, hạn chế bám ố và giữ sắc lam bền đẹp trong quá trình sử dụng lâu dài.",
            "Trên ban thờ, chiếc ấm dùng để dâng trà hoặc nước thanh khiết, thể hiện sự chu toàn và lòng hiếu kính của gia chủ. Khi đặt cùng bát trà sâm hoặc kỷ chén men lam, tổng thể không gian thờ trở nên đồng bộ, ấm cúng và trang nghiêm hơn hẳn. Đây là lựa chọn phù hợp cho những ai yêu vẻ đẹp truyền thống, cần một món đồ thờ vừa bền chắc, dễ lau chùi, vừa giữ được thần thái thủ công và ý nghĩa thanh tịnh trong nghi lễ thờ cúng.",
        ],
        'bat_com' => [
            "{$productName} là món đồ thờ mang ý nghĩa no đủ và trọn vẹn trong mỗi mâm lễ dâng gia tiên. Dáng bát được làm cân đối, lòng sâu vừa phải, cốt gốm dày và lên men lam thủ công nên bề mặt có độ trong, sắc xanh trang nhã và đậm chất đồ thờ Bát Tràng vẽ tay. Chi tiết {$profile['motif']} giúp sản phẩm mềm nét hơn, vừa giữ vẻ cổ truyền vừa tạo cảm giác thanh sạch trên ban thờ.",
            "Bát cơm thờ thường được sử dụng trong ngày rằm, mùng một, giỗ lễ hoặc những dịp cần dâng cơm cúng chỉn chu. Khi kết hợp cùng đĩa thờ, mâm bồng, ấm trà hay bát hương men lam, sản phẩm góp phần tạo nên bố cục đều mắt và trang nghiêm cho không gian thờ. Nhờ nung nhiệt cao, bát chịu nhiệt tốt, cứng cáp, bền màu và phù hợp với các gia đình muốn duy trì nét thờ cúng truyền thống bằng đồ gốm sứ thủ công lâu dài.",
        ],
        'bat_ga' => [
            "{$productName} là lựa chọn phù hợp cho các gia đình cần một món đồ thờ chuyên dùng để bày gà cúng, xôi hoặc lễ mặn trong ngày giỗ, Tết và các dịp cúng quan trọng. Phần lòng bát được tạo khá sâu, cốt gốm chắc tay và lớp men lam phủ đều, giúp sản phẩm vừa có vẻ đẹp cổ truyền vừa giữ được sự sạch sẽ, sáng men sau nhiều lần sử dụng. Họa tiết {$profile['motif']} vẽ tay làm mềm tổng thể, tạo cảm giác trang trọng mà không nặng nề.",
            "Trong bố cục ban thờ, bát gà giúp việc bày lễ mặn gọn gàng, tránh xô lệch và giữ tổng thể cân đối hơn so với dùng đồ thông thường. Sản phẩm đặc biệt phù hợp với ban thờ gia tiên, từ đường hoặc nhà thờ họ, nơi yêu cầu mâm lễ được chuẩn bị tươm tất và thành kính. Với kỹ thuật nung nhiệt cao của gốm Bát Tràng, bát có độ bền ổn định, men bền màu và là món đồ thờ vừa thực dụng vừa đậm ý nghĩa lễ nghi truyền thống.",
        ],
        'bat_tha_hoa' => [
            "{$productName} là dòng bát tụ thủy dành riêng cho khu vực thờ Thần Tài, nơi nhiều gia chủ coi trọng yếu tố sinh khí và sự hanh thông trong việc làm ăn. Dáng bát mở rộng, miệng 22cm tạo cảm giác đầy đặn, dễ bày nước, cánh hoa hoặc vật phẩm trang trí theo phong tục thờ cúng. Men lam phủ thủ công mang lại sắc xanh dịu, cổ điển, đồng thời giúp sản phẩm nổi bật nhưng vẫn hài hòa với các món thờ gốm sứ Bát Tràng khác.",
            "Khi đặt trên ban Thần Tài, bát thả hoa thả cá thường được dùng như điểm tụ thủy tượng trưng cho tài lộc lưu chuyển và sự mát lành trong không gian thờ. Đây là món đồ nhỏ nhưng tạo hiệu ứng thị giác khá rõ, giúp bàn thờ gọn hơn, có chiều sâu hơn và dễ tạo cảm giác chỉn chu ngay từ ánh nhìn đầu tiên. Sản phẩm được nung ở nhiệt độ cao nên bền cốt, khó ngả màu, dễ vệ sinh và phù hợp với các cửa hàng, gia đình muốn đầu tư bài bản cho bàn thờ Thần Tài.",
        ],
        'bat_tra_sam' => [
            "{$productName} là món đồ thờ nhỏ nhưng rất quan trọng trong bộ trà thờ men lam, giúp việc dâng nước, trà hoặc trà sâm trở nên chỉnh tề và đúng nghi thức hơn. Sản phẩm được làm thủ công từ gốm Bát Tràng, phủ men lam xanh sâu, phối họa tiết {$profile['motif']} vẽ tay nên lên ban thờ nhìn thanh nhã và đồng bộ. Form S2 tạo cảm giác gọn, vừa tay, phù hợp với nhiều kiểu kỷ chén và ấm trà men lam hiện nay.",
            "Trong quan niệm thờ cúng, chén nước hay bát trà dâng lễ thể hiện sự tinh sạch, chu đáo và lòng thành của người dâng. Vì vậy, lựa chọn bát trà sâm có men bền, cốt chắc và hình dáng nhã nhặn sẽ giúp tổng thể bàn thờ tinh tế hơn mà vẫn giữ nét truyền thống. Đây là món phụ kiện đáng đầu tư cho ban thờ gia tiên hoặc ban Phật, nhất là với gia chủ muốn hoàn thiện bộ đồ thờ men lam thủ công một cách đồng bộ và bền đẹp theo thời gian.",
        ],
        'bat_huong' => [
            "{$productName} là tâm điểm của không gian thờ, nơi hội tụ nén tâm hương và thể hiện sự kết nối giữa con cháu với tổ tiên, thần linh. Phần thân bát được chế tác từ cốt gốm Bát Tràng dày dặn, phủ men lam truyền thống và nhấn bằng họa tiết {$profile['motif']} vẽ tay nên toát lên vẻ uy nghiêm mà vẫn thanh nhã. Sắc lam sâu, đường nét cân đối và bề mặt men ổn định giúp sản phẩm phù hợp với lối bài trí thờ truyền thống của nhiều gia đình Việt.",
            "Một bát hương đẹp không chỉ cần đúng dáng mà còn phải tạo được cảm giác vững, sạch và trang trọng khi đặt ở vị trí trung tâm. Sản phẩm này phù hợp cho ban thờ gia tiên, bàn thờ thần linh hoặc không gian thờ cần sự chỉn chu, cổ kính. Nhờ nung nhiệt cao, cốt gốm đanh chắc, men bền màu và dễ vệ sinh, bát hương men lam rồng như ý là lựa chọn bền vững cho gia chủ muốn giữ nếp thờ cúng lâu dài bằng đồ gốm sứ thủ công chuẩn Bát Tràng.",
        ],
        'bo_mat_troi' => [
            "{$productName} là món bài trí có tính nhấn mạnh về bố cục, thường được lựa chọn để làm nổi bật khu vực trung tâm của không gian thờ. Tông men lam truyền thống đem lại cảm giác cổ điển, sâu màu và sang hơn khi đặt cùng bát hương, lọ hoa hoặc chân nến men lam. Kích cỡ 45cm đi cùng khay gỗ giúp sản phẩm đứng dáng, chắc chắn và tạo được hiệu ứng thị giác rõ ràng mà không làm bàn thờ trở nên rối mắt.",
            "Trong cách bài trí phòng thờ, những món tạo điểm tụ như bộ mặt trời giúp tổng thể trở nên có lớp lang và tôn thêm vẻ trang nghiêm cho khu vực thờ cúng. Đây là lựa chọn phù hợp cho gia chủ muốn tăng chiều sâu cho án gian, bàn thờ gia tiên hoặc phòng thờ truyền thống mà vẫn giữ chất liệu gốm sứ thủ công làm chủ đạo. Sản phẩm được hoàn thiện thủ công, nung ở nhiệt độ cao nên bền cốt, bền men và phù hợp với không gian thờ cần sự chỉnh chu, bền đẹp lâu dài.",
        ],
        'coc_phat_thu' => [
            "{$productName} là phụ kiện thờ hữu ích cho những gia đình thường dâng quả phật thủ trên ban thờ và muốn giữ dáng quả luôn ngay ngắn, đẹp mắt. Dáng cốc gọn, chắc, đủ để nâng đỡ quả lễ mà vẫn không chiếm nhiều diện tích trên mặt bàn thờ. Khi phối cùng men lam truyền thống, món phụ kiện nhỏ này trở nên hài hòa hơn với tổng thể đồ thờ gốm sứ Bát Tràng, tạo cảm giác đồng bộ và tinh tế.",
            "Quả phật thủ trong văn hóa thờ cúng thường gắn với lời cầu chúc bình an, che chở và đón điều lành, vì vậy việc bày quả cho đẹp dáng cũng được nhiều gia chủ đặc biệt quan tâm. Cốc đựng riêng giúp hạn chế lăn xô lệch, giữ bố cục gọn gàng và tôn vật phẩm lễ lên rõ hơn. Sản phẩm được làm thủ công, cốt gốm chắc, men bền và là lựa chọn đáng giá cho ban thờ gia tiên, ban Phật hoặc ban Thần Tài cần sự chỉn chu trong từng chi tiết nhỏ.",
        ],
        'chan_nen' => [
            "{$productName} là món đồ thờ giúp hoàn thiện thế cân xứng hai bên bát hương, đồng thời mang đến nguồn sáng ấm cho không gian thờ cúng. Cặp chân nến được tạo dáng thủ công trên nền gốm Bát Tràng, phủ men lam và nhấn bằng họa tiết {$profile['motif']} nên vừa giữ nét cổ truyền vừa tạo cảm giác thanh nhã, dễ phối với các món thờ khác. Chất men bền màu giúp sản phẩm luôn sáng men, sạch sẽ và có giá trị sử dụng lâu dài.",
            "Trong phong tục thờ tự, ánh nến tượng trưng cho sự ấm áp, kết nối và gìn giữ sinh khí của không gian thờ. Vì vậy, một đôi chân nến cân đối, chắc tay và đúng phong cách men lam sẽ giúp bàn thờ trở nên trang nghiêm hơn rất nhiều. Sản phẩm phù hợp với ban thờ gia tiên, ban Phật hoặc án thờ truyền thống, đặc biệt với những gia chủ yêu vẻ đẹp thủ công, muốn giữ tinh thần xưa nhưng vẫn cần độ bền, dễ vệ sinh và ổn định khi sử dụng lâu dài.",
        ],
        'choe_muoi_gao_nuoc' => [
            "{$productName} là món đồ thờ gắn liền với ý niệm no đủ, bền vững và sung túc trong nếp thờ cúng của nhiều gia đình Việt. Dáng chóe nhỏ gọn, cốt gốm chắc, lớp men lam phủ đều và điểm họa tiết {$profile['motif']} vẽ tay giúp sản phẩm vừa đẹp mắt vừa đồng bộ với các món men lam khác trên ban thờ. Đây là kiểu đồ thờ nhỏ nhưng có tính biểu tượng rõ, thường được dùng thường xuyên nên độ bền và sự dễ lau chùi rất được quan tâm.",
            "Khi dùng để đựng muối, gạo và nước, bộ chóe giúp mặt ban thờ gọn hơn, các vật phẩm lễ được đặt đúng vị trí và tạo cảm giác chu toàn trong cách bày biện. Sản phẩm phù hợp cho ban thờ gia tiên, ban Thần Tài hoặc bàn thờ gia đình cần bộ đồ thờ mang ý nghĩa cầu ấm no và vững bền. Nhờ được nung nhiệt cao, chóe có độ cứng tốt, giữ men bền màu và là lựa chọn thủ công đáng tin cậy cho những ai muốn xây dựng một không gian thờ chuẩn truyền thống.",
        ],
        'de_bat_huong' => [
            "{$productName} là chi tiết phụ trợ quan trọng giúp bát hương được kê cao ráo, chắc chắn và đúng thế hơn trên mặt bàn thờ. Phần đế được làm đồng bộ theo phong cách men lam Bát Tràng nên khi kết hợp với bát hương sẽ tạo cảm giác liền mạch, tôn dáng và giúp bố cục trung tâm trở nên bề thế hơn. Cốt gốm dày, men phủ thủ công và bề mặt ổn định cũng giúp sản phẩm giữ được vẻ sạch, sáng trong quá trình sử dụng lâu dài.",
            "Nhiều gia chủ lựa chọn đế bát hương không chỉ để tăng tính thẩm mỹ mà còn để giữ khu vực tâm thờ gọn gàng, rõ lớp và dễ chăm sóc hơn khi lau dọn. Đây là món phụ kiện phù hợp cho ban thờ gia tiên, ban thần linh hoặc bàn thờ có yêu cầu bài trí chỉn chu theo lối truyền thống. Sản phẩm được nung ở nhiệt độ cao nên chắc cốt, bền men và là lựa chọn hợp lý cho những bộ đồ thờ men lam cần sự đồng bộ từ chi tiết nhỏ nhất.",
        ],
        'den_tho' => [
            "{$productName} mang đến nguồn sáng trang nghiêm cho không gian thờ, đồng thời giúp bố cục hai bên ban thờ hài hòa và ấm cúng hơn. Thân đèn được hoàn thiện thủ công trên nền gốm Bát Tràng, phủ men lam xanh sâu nên vừa giữ vẻ cổ truyền vừa dễ kết hợp với bát hương, lọ hoa, chân nến hay mâm bồng cùng tông. Bề mặt men bền, ít bám ố và cốt gốm chắc tay là những ưu điểm khiến dòng đèn thờ men lam được nhiều gia đình ưa chuộng.",
            "Trong quan niệm thờ cúng, ánh sáng là yếu tố giữ sự ấm áp, thanh tịnh và tôn nghiêm cho khu vực thờ tự. Vì vậy, chọn đèn thờ có chất liệu bền, kiểu dáng nhã và đồng bộ với bộ đồ thờ là điều rất quan trọng. Sản phẩm phù hợp với ban thờ gia tiên, ban Phật hoặc ban Thần Tài, nhất là với gia chủ muốn đầu tư một không gian thờ gọn đẹp, thủ công và sử dụng ổn định lâu dài mà vẫn giữ trọn tinh thần truyền thống Bát Tràng.",
        ],
        'dia_tho' => [
            "{$productName} là món đồ thờ cơ bản nhưng rất hữu dụng trong việc bày lễ vật nhỏ, bánh trái, oản hoặc hoa quả trên ban thờ. Dáng đĩa cân đối, lòng đủ rộng, men lam phủ thủ công và đường nét vẽ tay giúp sản phẩm nhìn trang nhã hơn hẳn các dòng đĩa thông thường. Khi đặt lên bàn thờ, sắc xanh lam tạo cảm giác sạch, mát mắt và rất dễ phối cùng bát hương, mâm bồng hay kỷ ngai trong cùng một bố cục.",
            "Một chiếc đĩa thờ đẹp sẽ giúp lễ vật được trình bày gọn gàng, dễ quan sát và tạo nên tổng thể chỉn chu cho không gian thờ cúng. Sản phẩm phù hợp với ban thờ gia tiên, bàn thờ gia đình và nhiều kiểu bài trí truyền thống khác nhau. Nhờ cốt gốm Bát Tràng dày dặn, nung nhiệt cao và lớp men ổn định, đĩa có độ bền tốt, ít xuống màu và là món đồ thờ nhỏ nhưng rất đáng đầu tư nếu gia chủ muốn hoàn thiện ban thờ theo phong cách men lam thủ công.",
        ],
        'dia_trau' => [
            "{$productName} là dòng đĩa chuyên dùng để bày trầu cau và các lễ vật nhỏ, rất hợp với những gia đình coi trọng sự chỉn chu trong từng nghi thức thờ cúng. Form F12 gọn đẹp, dễ sắp xếp miếng trầu, quả cau hoặc cánh phượng theo kiểu truyền thống mà vẫn giữ được sự cân đối trên mặt bàn thờ. Men lam phủ thủ công tạo cảm giác cổ điển, sạch và dễ phối với các món đồ thờ gốm sứ Bát Tràng khác.",
            "Trầu cau là lễ vật mang ý nghĩa kính lễ, gắn kết và bền chặt trong văn hóa Việt, vì vậy việc dùng riêng một chiếc đĩa trầu đúng dáng sẽ giúp nghi thức dâng lễ thêm trang trọng. Sản phẩm phù hợp với ban thờ gia tiên, phòng thờ trong dịp lễ hỏi, cưới, giỗ chạp hoặc những ngày cúng quan trọng. Nhờ cốt gốm chắc, men bền màu và hoàn thiện thủ công, đĩa trầu men lam không chỉ đẹp mà còn bền, dễ lau chùi và giữ được nét truyền thống lâu dài.",
        ],
        'dot_tram' => [
            "{$productName} là món đồ thờ được nhiều gia đình lựa chọn khi muốn giữ cho không gian thờ luôn có mùi hương thanh khiết và cảm giác tĩnh tại. Dáng đốt trầm gọn gàng, dễ đặt trên bàn thờ hoặc trong phòng thờ, trong khi lớp men lam truyền thống mang lại vẻ cổ điển, nhã và rất hợp với gốm thờ Bát Tràng. Sản phẩm được làm thủ công nên từng chi tiết đều có độ mềm tay và cảm giác mộc vừa đủ.",
            "Khi dùng để đốt trầm, sản phẩm giúp lan tỏa hương thơm nhẹ, hỗ trợ thanh lọc không gian và tạo bầu khí trang nghiêm cho giờ thắp hương, tụng niệm hay cúng lễ. Đây là món phụ kiện phù hợp với ban thờ gia tiên, thiền thất hoặc phòng thờ gia đình cần thêm sự ấm cúng và tĩnh lặng. Nhờ nung nhiệt cao, cốt gốm chắc và men bền màu, đốt trầm men lam có độ bền sử dụng tốt, dễ vệ sinh và là lựa chọn vừa đẹp vừa hữu ích cho không gian tâm linh.",
        ],
        'ky_ngai' => [
            "{$productName} là món đồ thờ giúp việc dâng nước, trà hoặc rượu trở nên gọn gàng và đúng lối bài trí truyền thống hơn. Thiết kế dạng ngai tạo sự liên kết giữa các chén thờ, giữ bố cục ngay ngắn và mang đến cảm giác trang nghiêm cho khu vực chính giữa ban thờ. Men lam phủ thủ công trên cốt gốm Bát Tràng giúp sản phẩm có sắc xanh bền đẹp, cổ điển và rất dễ phối với bát hương, lọ hoa hay mâm bồng cùng tông.",
            "Trong không gian thờ cúng, những chi tiết nhỏ như kỷ ngai lại quyết định khá nhiều đến cảm giác chỉnh chu và nền nếp của tổng thể bố cục. Sản phẩm phù hợp với ban thờ gia tiên, ban thần linh hoặc bàn thờ gia đình yêu thích lối thờ gọn mà vẫn đủ lễ. Với độ bền cốt gốm tốt, men ổn định, dễ lau chùi và phong cách thủ công đậm chất Bát Tràng, đây là món đồ thờ đáng đầu tư để hoàn thiện bộ men lam truyền thống.",
        ],
        'lo_hoa' => [
            "{$productName} là món đồ thờ không thể thiếu nếu gia chủ muốn ban thờ luôn có sắc hoa tươi và sinh khí nhẹ nhàng. Dáng lọ được làm cân đối, men lam phủ thủ công tạo nên vẻ thanh nhã, cổ điển và rất dễ kết hợp với bát hương, chân nến, đèn thờ trong cùng một bộ đồ thờ Bát Tràng. Bề mặt men sáng sâu, cốt gốm dày và đường nét vẽ tay giúp sản phẩm vừa bền vừa có thần thái thủ công rõ rệt.",
            "Trên ban thờ, hoa tươi tượng trưng cho sự thanh sạch và lòng thành, vì vậy một đôi lọ hoa đẹp sẽ giúp tổng thể trở nên sáng, có sức sống và chỉn chu hơn nhiều. Sản phẩm phù hợp với ban thờ gia tiên, ban Phật hoặc không gian thờ gia đình cần nét trang nhã truyền thống. Nhờ được nung nhiệt cao, lọ hoa men lam có độ bền tốt, ít ngả màu, dễ lau chùi và là lựa chọn phù hợp cho gia chủ muốn sử dụng đồ thờ lâu dài mà vẫn giữ vẻ đẹp bền vững theo năm tháng.",
        ],
        'luc_binh' => [
            "{$productName} là dòng bình trưng bày mang tính trang trí cao, thường được đặt hai bên phòng thờ hoặc cạnh ban thờ để tăng vẻ bề thế và cân đối cho không gian. Dáng lục bình tròn bụng, thắt cổ, nở miệng giúp sản phẩm giữ được thần thái cổ điển, trong khi lớp men lam xanh sâu đem lại cảm giác sang và rất hợp với phong cách thờ truyền thống. Từng đường nét được hoàn thiện thủ công nên mỗi bình đều có độ mềm và khí chất riêng của gốm Bát Tràng.",
            "Không chỉ là món trang trí, lục bình trong không gian thờ còn gợi liên tưởng tới sự tích tụ sinh khí, ổn định và đủ đầy. Sản phẩm phù hợp với từ đường, phòng thờ rộng hoặc các không gian cần sự cân xứng ở hai bên bàn thờ. Nhờ cốt gốm chắc, nung nhiệt cao và men bền màu, lục bình men lam có khả năng sử dụng lâu dài, giữ vẻ đẹp ổn định và là lựa chọn xứng đáng cho gia chủ muốn nâng tầm phòng thờ bằng đồ gốm sứ thủ công truyền thống.",
        ],
        'mam_bong' => [
            "{$productName} là món đồ thờ quen thuộc dùng để nâng đỡ ngũ quả, bánh oản hoặc các lễ phẩm dâng cúng trên ban thờ. Dáng mâm cao chân tạo thế tôn lễ vật, giúp mặt bàn thờ thoáng hơn và nhìn có lớp lang hơn khi phối cùng bát hương, đèn thờ hay lọ hoa men lam. Lớp men lam phủ thủ công cùng cốt gốm Bát Tràng chắc tay đem lại cảm giác vừa cổ điển vừa bền bỉ, rất phù hợp với không gian thờ truyền thống.",
            "Trong phong tục thờ cúng, lễ vật được bày cao ráo và ngay ngắn luôn thể hiện sự thành kính của gia chủ. Vì vậy, một chiếc mâm bồng đúng dáng, bền men và hài hòa tổng thể sẽ giúp khu vực thờ cúng trang nghiêm hơn rõ rệt. Sản phẩm phù hợp với ban thờ gia tiên, ban Phật hoặc bàn thờ gia đình cần sự chỉn chu trong cách bày biện. Đây là món đồ thờ thủ công đáng lựa chọn nếu gia chủ ưu tiên vẻ đẹp men lam truyền thống và độ bền sử dụng lâu dài.",
        ],
        'nam_ruou' => [
            "{$productName} là món đồ thờ mang đậm dấu ấn lễ nghi, thường được dùng để đựng rượu cúng hoặc nước thơm trong những dịp dâng lễ trang trọng. Dáng nậm thờ truyền thống kết hợp men lam Bát Tràng tạo nên vẻ cổ kính, nhã và rất hợp với các bộ đồ thờ gia tiên. Cốt gốm được làm dày tay, lớp men phủ đều và hoàn thiện thủ công nên sản phẩm vừa có độ bền tốt vừa giữ được cảm giác mộc, có hồn của đồ gốm vẽ tay.",
            "Khi bài trí trên ban thờ, nậm rượu giúp nghi thức dâng lễ thêm đầy đủ, đồng thời tạo sự liền mạch với kỷ ngai, bát hương và các món phụ kiện men lam khác. Đây là sản phẩm phù hợp với bàn thờ gia tiên, ban thần linh hoặc từ đường cần bộ lễ khí đồng bộ. Nhờ nung ở nhiệt độ cao, men bền màu và cốt gốm đanh chắc, nậm rượu men lam có thể sử dụng lâu dài, dễ vệ sinh và là lựa chọn đáng cân nhắc cho người yêu đồ thờ Bát Tràng thủ công.",
        ],
        'ong_huong_parent' => [
            "{$productName} là món đồ thờ giúp việc cất giữ hương sạch trở nên gọn gàng và trang nghiêm hơn, đặc biệt với những gia đình muốn bàn thờ luôn ngăn nắp. Sản phẩm được làm theo phong cách men lam truyền thống của Bát Tràng, cốt gốm chắc, dáng đứng vững và bề mặt men ổn định nên vừa đẹp khi bày trên bàn thờ vừa thuận tiện trong quá trình sử dụng hằng ngày. Đây là mẫu có nhiều cỡ để gia chủ dễ chọn theo chiều dài hương và diện tích không gian thờ.",
            "Ống hương không phải món đồ lớn nhưng lại tạo khác biệt rõ rệt ở sự chỉn chu của khu vực thờ cúng, vì hương được cất riêng sẽ sạch sẽ, tránh rối mắt và dễ lấy khi dùng. Sản phẩm phù hợp cho ban thờ gia tiên, ban Phật, ban Thần Tài hoặc phòng thờ gia đình cần bộ men lam gọn đẹp. Nhờ kỹ thuật nung nhiệt cao, men bền màu và hoàn thiện thủ công, ống hương men lam là lựa chọn bền chắc, tinh tế và giàu tính truyền thống cho không gian thờ.",
        ],
        'ong_huong_variant' => [
            "{$productName} là lựa chọn phù hợp cho gia chủ cần một ống hương men lam có kích thước rõ ràng để bày vừa vặn trên bàn thờ. Dáng ống đứng chắc, cốt gốm Bát Tràng dày và lớp men lam hoàn thiện thủ công giúp sản phẩm có vẻ ngoài trang nhã, sạch và rất dễ phối với bát hương, đèn thờ hay lọ hoa cùng tông. Kích thước riêng của từng mẫu giúp việc chọn ống hương theo loại hương sử dụng hoặc theo chiều cao bộ thờ trở nên chủ động hơn.",
            "Khi hương được cất trong ống riêng, khu vực thờ sẽ gọn gàng hơn, hạn chế bụi vụn và tạo cảm giác nền nếp trong mỗi lần thắp hương. Đây là món phụ kiện nhỏ nhưng cực kỳ thực dụng cho ban thờ gia tiên, ban Phật hoặc bàn thờ gia đình muốn giữ sự sạch sẽ lâu dài. Sản phẩm được nung ở nhiệt độ cao nên bền cốt, men ổn định, dễ lau chùi và là lựa chọn đáng tin cậy cho những ai thích bộ đồ thờ men lam vừa đẹp vừa hữu dụng.",
        ],
        'ong_huong_simple' => [
            "{$productName} là mẫu ống hương men lam đơn giản, dễ dùng và phù hợp với nhiều kiểu bố cục bàn thờ truyền thống. Sản phẩm được làm từ gốm sứ Bát Tràng, tạo dáng thủ công, phủ men lam xanh sâu nên vừa có nét cổ điển vừa giữ được cảm giác sạch và trang nhã khi đặt cạnh bát hương, đèn thờ hoặc lọ hoa. Dáng ống tiêu chuẩn giúp gia chủ dễ sắp xếp ở nhiều vị trí mà không làm ban thờ bị chật.",
            "Với các gia đình coi trọng sự ngăn nắp, ống hương là món phụ kiện rất nên có vì giúp bó hương luôn sạch, dễ lấy và tránh làm khu vực thờ bị rối mắt. Sản phẩm phù hợp cho ban thờ gia tiên, ban Phật hoặc ban Thần Tài cần một món đồ nhỏ nhưng có tính ứng dụng cao. Nhờ cốt gốm chắc, men bền màu và hoàn thiện thủ công đồng bộ với dòng men lam, đây là lựa chọn bền đẹp cho không gian thờ muốn giữ vẻ truyền thống và sự chỉnh tề lâu dài.",
        ],
        default => [
            "{$productName} là sản phẩm đồ thờ gốm sứ Bát Tràng được hoàn thiện thủ công trên nền men lam truyền thống, hướng tới vẻ đẹp trang nghiêm và bền dùng lâu dài cho không gian thờ cúng.",
            "Sản phẩm phù hợp với nhiều kiểu bàn thờ gia tiên, phòng thờ gia đình và những gia chủ yêu vẻ đẹp thủ công, cổ truyền của gốm Bát Tràng.",
        ],
    };

    return ml80Paragraphs($paragraphs);
}

function ml80MetaTitle(array $profile): string
{
    $seoName = $profile['seo_name'];
    $candidates = [
        "{$seoName} Bát Tràng vẽ tay thủ công chuẩn thờ",
        "{$seoName} gốm Bát Tràng vẽ tay chuẩn thờ",
        "{$seoName} men lam Bát Tràng thủ công",
    ];

    return ml80BoundedText($candidates, 50, 65);
}

function ml80MetaDescription(array $profile): string
{
    $text = "{$profile['seo_name']} Bát Tràng vẽ tay, {$profile['cta_use']}, cốt gốm bền chắc và men lam bền màu. Liên hệ chọn mẫu hợp ban thờ.";

    return ml80NormalizeDescriptionLength($text, 120, 160);
}

function ml80Specifications(array $profile): array
{
    $compact = ml80CompactSpecs($profile);

    return [
        ['label' => 'Cốt gốm', 'value' => ML80_MATERIAL],
        ['label' => 'Men', 'value' => ML80_GLAZE],
        ['label' => $compact['size_label'], 'value' => $compact['size']],
        ['label' => 'Công dụng', 'value' => $compact['use']],
        ['label' => 'Bàn thờ', 'value' => $compact['altar']],
        ['label' => 'Vẽ tay', 'value' => $compact['painting']],
        ['label' => 'Độ bền', 'value' => ML80_DURABILITY],
    ];
}

function ml80CompactSpecs(array $profile): array
{
    return match ($profile['kind']) {
        'am_tra' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng ấm thờ', 'use' => 'Dâng trà, nước thờ', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, vẽ sen tay'],
        'bat_com' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng bát thờ', 'use' => 'Dâng cơm cúng', 'altar' => 'Gia tiên, từ đường', 'painting' => 'Có, vẽ sen tay'],
        'bat_ga' => ['size_label' => 'Kích cỡ', 'size' => 'Lòng sâu, dáng bát', 'use' => 'Bày gà, lễ mặn', 'altar' => 'Gia tiên, nhà thờ họ', 'painting' => 'Có, vẽ sen tay'],
        'bat_tha_hoa' => ['size_label' => 'Kích cỡ', 'size' => 'Miệng 22cm', 'use' => 'Tụ thủy, thả hoa', 'altar' => 'Ban Thần Tài', 'painting' => 'Có, hoàn thiện tay'],
        'bat_tra_sam' => ['size_label' => 'Kích cỡ', 'size' => 'Cỡ S2', 'use' => 'Dâng trà sâm, nước', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, vẽ sen tay'],
        'bat_huong' => ['size_label' => 'Kích cỡ', 'size' => 'Nhiều cỡ đồng bộ', 'use' => 'Cắm hương trung tâm', 'altar' => 'Gia tiên, thần linh', 'painting' => 'Có, vẽ rồng tay'],
        'bo_mat_troi' => ['size_label' => 'Kích cỡ', 'size' => '45cm, kèm khay gỗ', 'use' => 'Tạo điểm nhấn thờ', 'altar' => 'Gia tiên, án gian', 'painting' => 'Có, hoàn thiện tay'],
        'coc_phat_thu' => ['size_label' => 'Kích cỡ', 'size' => 'Cỡ S1', 'use' => 'Giữ quả phật thủ', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, hoàn thiện tay'],
        'chan_nen' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng đôi cân xứng', 'use' => 'Cắm nến thờ', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, vẽ sen tay'],
        'choe_muoi_gao_nuoc' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng chóe nhỏ', 'use' => 'Đựng muối, gạo, nước', 'altar' => 'Gia tiên, Thần Tài', 'painting' => 'Có, vẽ sen tay'],
        'de_bat_huong' => ['size_label' => 'Kích cỡ', 'size' => 'Đồng bộ bát hương', 'use' => 'Kê bát hương', 'altar' => 'Gia tiên, thần linh', 'painting' => 'Có, hoàn thiện tay'],
        'den_tho' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng đèn đồng bộ', 'use' => 'Giữ sáng ban thờ', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, hoàn thiện tay'],
        'dia_tho' => ['size_label' => 'Kích cỡ', 'size' => 'Lòng phẳng, dễ bày', 'use' => 'Bày oản, trái, lễ', 'altar' => 'Gia tiên, thần linh', 'painting' => 'Có, vẽ tay'],
        'dia_trau' => ['size_label' => 'Kích cỡ', 'size' => 'Form F12', 'use' => 'Bày trầu cau', 'altar' => 'Gia tiên, lễ cưới', 'painting' => 'Có, vẽ tay'],
        'dot_tram' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng gọn', 'use' => 'Đốt trầm hương', 'altar' => 'Gia tiên, phòng thờ', 'painting' => 'Có, hoàn thiện tay'],
        'ky_ngai' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng kỷ ngai', 'use' => 'Dâng nước, trà', 'altar' => 'Gia tiên, thần linh', 'painting' => 'Có, hoàn thiện tay'],
        'lo_hoa' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng lọ cân đối', 'use' => 'Cắm hoa thờ', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, vẽ tay'],
        'luc_binh' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng lục bình', 'use' => 'Trưng bày, chiêu khí', 'altar' => 'Phòng thờ, từ đường', 'painting' => 'Có, vẽ tay'],
        'mam_bong' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng cao chân', 'use' => 'Bày ngũ quả, oản', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, vẽ tay'],
        'nam_ruou' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng nậm thờ', 'use' => 'Đựng rượu cúng', 'altar' => 'Gia tiên, từ đường', 'painting' => 'Có, hoàn thiện tay'],
        'ong_huong_parent' => ['size_label' => 'Kích cỡ', 'size' => 'S1 22, S2 20, S3 17', 'use' => 'Đựng hương sạch', 'altar' => 'Gia tiên, Phật, Tài', 'painting' => 'Có, hoàn thiện tay'],
        'ong_huong_variant' => match ($profile['seo_name']) {
            'Ống hương men lam S1 22cm' => ['size_label' => 'Cao', 'size' => '22cm', 'use' => 'Đựng hương dài', 'altar' => 'Ban gia tiên', 'painting' => 'Có, hoàn thiện tay'],
            'Ống hương men lam S2 20cm' => ['size_label' => 'Cao', 'size' => '20cm', 'use' => 'Đựng hương phổ thông', 'altar' => 'Gia tiên, Phật', 'painting' => 'Có, hoàn thiện tay'],
            default => ['size_label' => 'Cao', 'size' => '17cm', 'use' => 'Đựng hương bàn thờ nhỏ', 'altar' => 'Ban nhỏ, Thần Tài', 'painting' => 'Có, hoàn thiện tay'],
        },
        'ong_huong_simple' => ['size_label' => 'Kích cỡ', 'size' => 'Dáng tiêu chuẩn', 'use' => 'Đựng hương sạch', 'altar' => 'Gia tiên, Phật, Tài', 'painting' => 'Có, hoàn thiện tay'],
        default => ['size_label' => 'Kích cỡ', 'size' => 'Theo mẫu', 'use' => 'Đồ thờ men lam', 'altar' => 'Ban thờ gia đình', 'painting' => 'Có, hoàn thiện tay'],
    };
}

function ml80Paragraphs(array $paragraphs): string
{
    return implode("\n", array_map(
        fn ($paragraph) => '<p>' . trim((string) $paragraph) . '</p>',
        array_filter($paragraphs, fn ($paragraph) => trim((string) $paragraph) !== '')
    ));
}

function ml80BoundedText(array $candidates, int $min, int $max): string
{
    foreach ($candidates as $candidate) {
        $candidate = trim((string) $candidate);
        $length = mb_strlen($candidate);

        if ($length >= $min && $length <= $max) {
            return $candidate;
        }
    }

    foreach ($candidates as $candidate) {
        $candidate = trim((string) $candidate);

        if (mb_strlen($candidate) <= $max) {
            return $candidate;
        }
    }

    return ml80TrimToLength(trim((string) $candidates[0]), $max);
}

function ml80NormalizeDescriptionLength(string $text, int $min, int $max): string
{
    $text = trim($text);

    if (mb_strlen($text) < $min) {
        $text .= ' Hỗ trợ chọn kích thước và bố cục phù hợp.';
    }

    if (mb_strlen($text) > $max) {
        $text = ml80TrimToLength($text, $max);
    }

    return $text;
}

function ml80TrimToLength(string $text, int $max): string
{
    if (mb_strlen($text) <= $max) {
        return $text;
    }

    $ellipsis = '...';
    $limit = max(1, $max - mb_strlen($ellipsis));
    $trimmed = mb_substr($text, 0, $limit + 1);
    $spacePosition = mb_strrpos($trimmed, ' ');

    if ($spacePosition !== false) {
        $trimmed = mb_substr($trimmed, 0, $spacePosition);
    } else {
        $trimmed = mb_substr($trimmed, 0, $limit);
    }

    return rtrim($trimmed, " ,.;:") . $ellipsis;
}

function ml80ValidatePayload(string $sku, array $payload): void
{
    $wordCount = count(array_filter(preg_split('/\s+/u', trim(strip_tags((string) $payload['description'])))));
    $metaTitleLength = mb_strlen((string) $payload['meta']['title']);
    $metaDescriptionLength = mb_strlen((string) $payload['meta']['description']);
    $specCount = is_array($payload['specs']) ? count($payload['specs']) : 0;

    if ($wordCount < 150 || $wordCount > 300) {
        throw new RuntimeException("Mo ta cua {$sku} khong dat 150-300 chu (hien co {$wordCount}).");
    }

    if ($metaTitleLength < 50 || $metaTitleLength > 65) {
        throw new RuntimeException("Meta title cua {$sku} khong dat 50-65 ky tu (hien co {$metaTitleLength}).");
    }

    if ($metaDescriptionLength < 120 || $metaDescriptionLength > 160) {
        throw new RuntimeException("Meta description cua {$sku} khong dat 120-160 ky tu (hien co {$metaDescriptionLength}).");
    }

    if ($specCount < 3 || $specCount > 7) {
        throw new RuntimeException("So dong thong so cua {$sku} khong nam trong khoang 3-7.");
    }
}

function ml80EnsureDirectory(string $path): void
{
    if (!is_dir($path)) {
        mkdir($path, 0777, true);
    }
}
