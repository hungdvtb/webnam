<?php

namespace App\Support;

use Illuminate\Support\Str;

class BatTrangCategoryCatalog
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public static function definitions(): array
    {
        return [
            [
                'key' => 'men-lam-ve-tay',
                'parent_key' => null,
                'name' => 'Bộ đồ thờ men lam vẽ tay Bát Tràng',
                'code' => 'bo-do-tho-men-lam-ve-tay-bat-trang',
                'slug' => 'bo-do-tho-men-lam-ve-tay-bat-trang',
                'order' => 0,
                'theme' => 'men_lam',
                'scale' => 0.98,
                'guide_ratio' => 0.66,
                'palette' => self::palette([18, 39, 83], [236, 239, 235], [246, 243, 235], [27, 71, 146], [56, 110, 198], [149, 182, 228], [207, 168, 82], [10, 22, 49], [225, 234, 248], [176, 165, 145]),
                'description' => self::menLamVeTayDescription(),
                'meta_title' => 'Bộ đồ thờ men lam vẽ tay Bát Tràng thủ công cao cấp',
                'meta_description' => 'Bộ đồ thờ men lam vẽ tay Bát Tràng với sắc lam cobalt sang trọng, họa tiết thủ công chuẩn thờ, phù hợp nhiều không gian phòng thờ gia tiên.',
                'meta_keywords' => 'bộ đồ thờ men lam vẽ tay bát tràng, đồ thờ men lam, gốm bát tràng đồ thờ, bộ đồ thờ cao cấp',
            ],
            [
                'key' => 'men-lam-ve-vang',
                'parent_key' => null,
                'name' => 'Bộ đồ thờ men lam vẽ vàng Bát Tràng',
                'code' => 'bo-do-tho-men-lam-ve-vang-bat-trang',
                'slug' => 'bo-do-tho-men-lam-ve-vang-bat-trang',
                'order' => 1,
                'theme' => 've_vang',
                'scale' => 1.0,
                'guide_ratio' => 0.68,
                'palette' => self::palette([13, 35, 72], [245, 238, 224], [249, 245, 236], [22, 78, 160], [36, 111, 204], [164, 188, 228], [221, 182, 78], [12, 24, 50], [242, 231, 212], [182, 164, 140]),
                'description' => self::menLamVeVangDescription(),
                'meta_title' => 'Bộ đồ thờ men lam vẽ vàng Bát Tràng sang trọng chuẩn thờ',
                'meta_description' => 'Khám phá bộ đồ thờ men lam vẽ vàng Bát Tràng với nền men xanh sang trọng, điểm kim vàng nổi bật, hợp phòng thờ cao cấp và ban thờ đẹp.',
                'meta_keywords' => 'bộ đồ thờ men lam vẽ vàng bát tràng, đồ thờ vẽ vàng, bộ đồ thờ cao cấp bát tràng, đồ thờ men lam vẽ vàng',
            ],
            [
                'key' => 'men-ran',
                'parent_key' => null,
                'name' => 'Bộ đồ thờ men rạn Bát Tràng',
                'code' => 'bo-do-tho-men-ran-bat-trang',
                'slug' => 'bo-do-tho-men-ran-bat-trang',
                'order' => 2,
                'theme' => 'men_ran',
                'scale' => 1.03,
                'guide_ratio' => 0.7,
                'palette' => self::palette([66, 48, 38], [236, 228, 214], [240, 234, 223], [123, 91, 65], [92, 121, 118], [173, 156, 132], [183, 144, 90], [37, 28, 24], [225, 214, 198], [155, 132, 108]),
                'description' => self::menRanDescription(),
                'meta_title' => 'Bộ đồ thờ men rạn Bát Tràng cổ kính, trang nghiêm',
                'meta_description' => 'Bộ đồ thờ men rạn Bát Tràng mang sắc men cổ, bề mặt rạn đẹp tự nhiên, hợp không gian thờ truyền thống, nhà thờ họ và phòng thờ sang trọng.',
                'meta_keywords' => 'bộ đồ thờ men rạn bát tràng, đồ thờ men rạn, bộ đồ thờ cổ bát tràng, gốm men rạn đồ thờ',
            ],
            [
                'key' => 'chon-bo-kich-thuoc',
                'parent_key' => null,
                'name' => 'Chọn bộ theo kích thước ban thờ',
                'code' => 'chon-bo-theo-kich-thuoc-ban-tho',
                'slug' => 'chon-bo-theo-kich-thuoc-ban-tho',
                'order' => 3,
                'theme' => 'size_selector',
                'scale' => 0.96,
                'guide_ratio' => 0.72,
                'palette' => self::palette([17, 35, 74], [236, 234, 228], [246, 242, 234], [33, 84, 164], [55, 118, 198], [184, 202, 228], [209, 170, 86], [12, 26, 52], [227, 233, 246], [184, 171, 152]),
                'description' => self::sizeSelectorDescription(),
                'meta_title' => 'Chọn bộ đồ thờ Bát Tràng theo kích thước ban thờ',
                'meta_description' => 'Danh mục chọn bộ đồ thờ theo kích thước ban thờ giúp gia chủ tìm nhanh mẫu phù hợp từng mặt ban, giữ tỷ lệ chuẩn và bố cục thờ trang nghiêm.',
                'meta_keywords' => 'chọn bộ đồ thờ theo kích thước ban thờ, bộ đồ thờ bát tràng theo size, tư vấn bộ đồ thờ theo ban thờ',
            ],
            self::sizeDefinition(
                'ban-than-tai',
                'Ban thần tài',
                'ban-than-tai',
                0,
                0.66,
                0.34,
                self::palette([15, 58, 77], [235, 239, 231], [246, 243, 234], [28, 90, 140], [44, 136, 173], [173, 209, 216], [211, 169, 74], [11, 29, 37], [223, 241, 236], [176, 167, 145]),
                'Ban thần tài thường có chiều ngang nhỏ và cần bộ đồ thờ BÁT TRÀNG gọn, sạch mặt ban, đủ công năng mà vẫn giữ bố cục trang nghiêm cho không gian thờ dưới đất.',
                [
                    'ƯU TIÊN BỘ ĐỒ THỜ NHỎ GỌN để không che tượng Thần Tài - Ông Địa và không lấn diện tích đặt hũ gạo, hũ muối, bát nước.',
                    'Nên chọn BÁT HƯƠNG vừa tầm, KỶ 3 CHÉN, ỐNG HƯƠNG, LỌ HOA MINI và CHÂN NẾN nhỏ để mặt ban luôn thông thoáng.',
                    'Các dòng MEN LAM, MEN RẠN hoặc MEN LAM VẼ VÀNG bản gọn đều hợp với ban thần tài nếu giữ đúng tỷ lệ và khoảng thở hai bên.',
                ],
                [
                    'Đặt BÁT HƯƠNG ở trục giữa, KỶ CHÉN phía trước, LỌ HOA và ỐNG HƯƠNG cân đối hai bên.',
                    'Nếu chiều sâu ban hạn chế, nên ưu tiên BỘ 5 MÓN hoặc BỘ 7 MÓN tinh gọn thay vì lên quá nhiều phụ kiện.',
                    'Tránh dùng mâm bồng hoặc đôi đèn quá lớn vì dễ làm nặng mặt ban và che tầm nhìn tượng thờ.',
                ],
                [
                    'Khi chọn bộ, nên đo đủ CHIỀU NGANG, CHIỀU SÂU và chiều cao tầng trên để bộ đồ thờ lên ban không bị chạm thành hoặc kẹt tượng.',
                    'Gia chủ chuộng vẻ sáng sạch nên chọn MEN LAM; thích nét cổ kính có thể lên MEN RẠN; muốn nổi bật sang trọng có thể chọn VẼ VÀNG bản nhỏ.',
                ],
                'Bộ đồ thờ ban thần tài Bát Tràng gọn đẹp, đúng tỷ lệ mặt ban nhỏ, phù hợp bộ 5 món hoặc 7 món và dễ phối men lam, men rạn, vẽ vàng.'
            ),
            self::sizeDefinition(
                'ban-1m-1m1',
                'Ban 1m - 1m1',
                'ban-1m-1m1',
                1,
                0.75,
                0.46,
                self::palette([20, 42, 88], [239, 240, 234], [247, 244, 236], [35, 81, 162], [63, 124, 206], [178, 202, 232], [210, 172, 83], [13, 23, 51], [229, 237, 248], [183, 170, 148]),
                'Nhóm BAN 1M - 1M1 là kích thước phổ biến cho phòng thờ gia đình nhỏ, phù hợp các bộ đồ thờ BÁT TRÀNG cân đối, rõ lớp và vẫn giữ được cảm giác sang trọng.',
                [
                    'Nên ưu tiên BỘ 5 MÓN hoặc BỘ 7 MÓN có tỷ lệ hài hòa để mặt ban vừa đầy đặn vừa không bị bí.',
                    'BÁT HƯƠNG trung tâm, KỶ CHÉN, LỌ HOA, CHÂN NẾN và ỐNG HƯƠNG cần chọn cùng tông men để tổng thể gọn và liền mạch.',
                    'MEN LAM VẼ TAY là lựa chọn dễ dùng; MEN RẠN hợp phòng thờ cổ; VẼ VÀNG thích hợp không gian sáng và nội thất gỗ sơn son thếp vàng.',
                ],
                [
                    'Giữ khoảng hở hai đầu ban để bộ đồ thờ không chạm mép và còn chỗ cho hoa quả, lễ vật theo ngày rằm hoặc mùng một.',
                    'Nếu dùng thêm mâm bồng, nên chọn loại vừa thay vì bản đại để trung tâm bàn thờ không bị dồn khối.',
                    'Nên lên bố cục đối xứng để tạo cảm giác BAN THỜ GỌN MÀ VẪN CÓ THẦN THÁI.',
                ],
                [
                    'Đo cả chiều sâu lòng ban trước khi chốt bộ, vì nhiều mặt ban 1m - 1m1 có chiều ngang ổn nhưng chiều sâu khá ngắn.',
                    'Gia chủ muốn dễ vệ sinh và ít lỗi phối nên chọn set đồng bộ cùng một dòng men thay vì ghép nhiều mẫu khác nhau.',
                ],
                'Bộ đồ thờ Bát Tràng cho ban 1m - 1m1 cân đối, dễ phối bộ 5 món hoặc 7 món, hợp phòng thờ gia đình và nhiều dòng men cao cấp.'
            ),
            self::sizeDefinition(
                'ban-1m27-1m4',
                'Ban 1m27 - 1m4',
                'ban-1m27-1m4',
                2,
                0.84,
                0.56,
                self::palette([17, 44, 93], [242, 237, 229], [248, 245, 237], [31, 88, 170], [51, 132, 212], [188, 207, 233], [216, 174, 80], [13, 27, 54], [233, 238, 247], [185, 169, 145]),
                'BAN 1M27 - 1M4 là khoảng kích thước rất đẹp để lên bộ đồ thờ BÁT TRÀNG đầy đủ, cân chuẩn tỷ lệ và dễ tạo điểm nhấn trung tâm cho không gian thờ gia tiên.',
                [
                    'Kích thước này phù hợp BỘ 7 MÓN hoặc BỘ 9 MÓN với bố cục rõ lớp, đủ chiều cao và có khoảng thở cho hoa quả, lễ vật.',
                    'Có thể lên BÁT HƯƠNG trung tâm nổi bật hơn, kết hợp MÂM BỒNG, LỌ HOA, CHÂN NẾN, ỐNG HƯƠNG và KỶ CHÉN theo cùng một hệ men.',
                    'MEN LAM VẼ TAY, MEN LAM VẼ VÀNG và MEN RẠN đều phát huy vẻ đẹp rõ nét trên mặt ban kích thước này.',
                ],
                [
                    'Nếu gia chủ chuộng bố cục sang, nên giữ trục chính cao ở giữa và dàn đều phụ kiện đối xứng hai bên.',
                    'Nên ưu tiên các mẫu có hoa văn đồng bộ RỒNG CHẦU, SEN, PHÚC LỘC THỌ hoặc họa tiết cổ truyền để tăng chiều sâu thẩm mỹ.',
                    'Không nên ghép quá nhiều món bản lớn cùng lúc vì dễ làm mặt ban nặng và giảm khoảng sáng cho tổng thể.',
                ],
                [
                    'Đây là nhóm size dễ lên bộ hoàn chỉnh cho nhiều phòng thờ nhà phố, nhà mái bằng, nhà ống và gian thờ riêng trong căn hộ.',
                    'Khi cần cảm giác cao cấp hơn, có thể ưu tiên VẼ VÀNG hoặc MEN RẠN phối ánh gỗ trầm để tăng độ sang và chiều sâu.',
                ],
                'Bộ đồ thờ Bát Tràng cho ban 1m27 - 1m4 phù hợp bộ 7 món hoặc 9 món, cân tỷ lệ đẹp, hợp men lam, men rạn và men lam vẽ vàng.'
            ),
            self::sizeDefinition(
                'ban-1m57-1m75',
                'Ban 1m57 - 1m75',
                'ban-1m57-1m75',
                3,
                0.94,
                0.68,
                self::palette([20, 39, 82], [237, 235, 227], [247, 244, 236], [37, 76, 148], [53, 115, 195], [187, 205, 231], [211, 168, 80], [13, 25, 51], [229, 234, 245], [183, 168, 145]),
                'BAN 1M57 - 1M75 cho phép gia chủ lên bộ đồ thờ BÁT TRÀNG có thần thái bề thế hơn, phù hợp những không gian phòng thờ riêng hoặc ban thờ gia tiên kích thước đẹp.',
                [
                    'Có thể chọn BỘ 9 MÓN hoặc BỘ 11 MÓN với trung tâm nổi khối, hai bên cân xứng và các món phụ trợ đầy đủ công năng.',
                    'Mặt ban rộng giúp các dòng MEN RẠN, MEN LAM VẼ VÀNG hoặc MEN LAM cao cấp thể hiện rõ chiều sâu men và nét vẽ thủ công.',
                    'Đây là nhóm size thích hợp để lên thêm MÂM BỒNG, ĐÔI CHÂN NẾN, ĐÔI LỌ HOA và bộ kỷ chén có kích thước rõ ràng hơn.',
                ],
                [
                    'Nên tính trước khoảng sáng giữa các món để khi bày hoa quả, trầu cau, nước thờ vẫn giữ được bố cục thoáng.',
                    'Nếu ban đặt trong phòng thờ riêng, có thể ưu tiên bộ đồng bộ hoa văn và tăng chiều cao trục giữa để tạo khí chất trang nghiêm.',
                    'Chọn men và tông màu theo nội thất phòng thờ để bộ đồ thờ hòa cùng nền gỗ, câu đối, hoành phi và ánh sáng tổng thể.',
                ],
                [
                    'Ban cỡ này rất hợp các bộ đồ thờ mang tính SANG TRỌNG, CHỈN CHU và có chiều sâu trưng bày.',
                    'Gia chủ thích vẻ cổ kính nên nghiêng về MEN RẠN; thích độ sang sáng rõ nên chọn MEN LAM VẼ VÀNG; muốn thanh nhã chuẩn truyền thống có thể chọn MEN LAM VẼ TAY.',
                ],
                'Bộ đồ thờ Bát Tràng cho ban 1m57 - 1m75 phù hợp bộ 9 món hoặc 11 món, cho bố cục bề thế, sang trọng và chuẩn tỷ lệ phòng thờ riêng.'
            ),
            self::sizeDefinition(
                'ban-1m75-1m97',
                'Ban 1m75 - 1m97',
                'ban-1m75-1m97',
                4,
                1.02,
                0.78,
                self::palette([16, 34, 70], [233, 229, 220], [246, 242, 233], [31, 72, 143], [44, 112, 192], [189, 204, 228], [204, 166, 85], [12, 22, 47], [224, 230, 241], [180, 163, 141]),
                'BAN 1M75 - 1M97 là nhóm kích thước đẹp cho bộ đồ thờ BÁT TRÀNG bản lớn, hợp các gian thờ có chiều cao và chiều sâu tốt, cần sự bề thế nhưng vẫn giữ bố cục chuẩn.',
                [
                    'Nên ưu tiên BỘ ĐỒ THỜ BẢN ĐẠI với tỷ lệ thân món đủ lớn để không bị lọt thỏm trên mặt ban rộng.',
                    'Có thể phối thêm các món nhấn như MÂM BỒNG lớn, ĐÔI LỌ HOA cao, ĐÔI CHÂN NẾN rõ khối và kỷ chén bản cân hơn.',
                    'MEN RẠN cao cấp, MEN LAM VẼ VÀNG hoặc MEN LAM đại khí đều rất hợp nhóm kích thước này.',
                ],
                [
                    'Giữ trục chính vững ở giữa, hai bên dàn đều chiều cao để tổng thể không bị lệch khối.',
                    'Nên tránh dùng món nhỏ vì khi lên ban lớn sẽ làm bố cục thiếu lực và giảm cảm giác trang nghiêm.',
                    'Nếu không gian có hoành phi câu đối lớn, nên chọn bộ men có chiều sâu và sắc độ tương xứng để tổng thể đồng bộ.',
                ],
                [
                    'Nhóm size này phù hợp nhà thờ gia đình, phòng thờ rộng và nhiều không gian cần bộ đồ thờ có tính nhấn mạnh.',
                    'Gia chủ muốn vẻ đẹp lâu bền, dễ nhìn theo năm tháng nên ưu tiên bộ men đồng bộ và đúng tỷ lệ chiều cao từng món.',
                ],
                'Bộ đồ thờ Bát Tràng cho ban 1m75 - 1m97 hợp bản đại khí, lên bộ bề thế, cân xứng và nổi bật trên các không gian thờ rộng.'
            ),
            self::sizeDefinition(
                'ban-tren-2m17',
                'Ban trên 2m17',
                'ban-tren-2m17',
                5,
                1.12,
                0.88,
                self::palette([13, 30, 64], [236, 228, 214], [246, 242, 234], [28, 68, 139], [41, 105, 184], [191, 203, 224], [208, 168, 83], [10, 21, 44], [222, 227, 236], [182, 162, 138]),
                'BAN TRÊN 2M17 cần bộ đồ thờ BÁT TRÀNG đại khí, đủ tầm vóc và độ đầy để không gian thờ lớn giữ được thế trang nghiêm, uy nghi và đồng bộ tổng thể kiến trúc.',
                [
                    'Nên chọn BỘ ĐỒ THỜ CAO CẤP bản lớn, kết hợp các món có chiều cao và bề ngang tương xứng mặt ban.',
                    'Có thể phối thêm LỤC BÌNH, ĐỈNH HẠC, MÂM BỒNG lớn hoặc bộ phụ trợ đại khí nếu kiến trúc gian thờ cho phép.',
                    'MEN RẠN, MEN LAM VẼ VÀNG và MEN LAM bản lớn đều có thể phát huy vẻ đẹp mạnh ở nhóm kích thước này khi lên đúng tỷ lệ.',
                ],
                [
                    'Ưu tiên thiết kế trục giữa thật chắc, các món hai bên lên rõ lớp để tránh cảm giác trống giữa mặt ban lớn.',
                    'Cần đo kỹ chiều sâu, khoảng lùi sát tường và khoảng treo hoành phi câu đối trước khi chốt bộ để bố cục hoàn thiện và không bị dồn.',
                    'Nên chọn bộ cùng phong cách, cùng hoa văn và cùng cấp độ men để gian thờ lớn giữ tính nhất quán cao.',
                ],
                [
                    'Đây là nhóm size phù hợp từ phòng thờ lớn, từ đường, nhà thờ họ đến không gian thờ có tính nghi lễ và quy mô lớn hơn thông thường.',
                    'Khi cần tư vấn sâu, nên lên layout theo sơ đồ mặt ban để chọn đúng BÁT HƯƠNG, LỌ HOA, MÂM BỒNG và phụ kiện tương ứng.',
                ],
                'Bộ đồ thờ Bát Tràng cho ban trên 2m17 phù hợp không gian thờ lớn, cần bản đại khí, bố cục uy nghi và đồng bộ cao cấp.'
            ),
        ];
    }

    /**
     * @param  array<int, int>  $bgLeft
     * @param  array<int, int>  $bgRight
     * @param  array<int, int>  $ceramic
     * @param  array<int, int>  $outline
     * @param  array<int, int>  $accent
     * @param  array<int, int>  $accentSoft
     * @param  array<int, int>  $gold
     * @param  array<int, int>  $shadow
     * @param  array<int, int>  $mist
     * @param  array<int, int>  $crackle
     * @return array<string, array<int, int>>
     */
    private static function palette(array $bgLeft, array $bgRight, array $ceramic, array $outline, array $accent, array $accentSoft, array $gold, array $shadow, array $mist, array $crackle): array
    {
        return [
            'bg_left' => $bgLeft,
            'bg_right' => $bgRight,
            'ceramic' => $ceramic,
            'outline' => $outline,
            'accent' => $accent,
            'accent_soft' => $accentSoft,
            'gold' => $gold,
            'shadow' => $shadow,
            'mist' => $mist,
            'crackle' => $crackle,
        ];
    }

    /**
     * @param  array<string, array<int, int>>  $palette
     * @param  array<int, string>  $highlights
     * @param  array<int, string>  $arrangement
     * @param  array<int, string>  $selectionNotes
     * @return array<string, mixed>
     */
    private static function sizeDefinition(
        string $key,
        string $name,
        string $slug,
        int $order,
        float $scale,
        float $guideRatio,
        array $palette,
        string $intro,
        array $highlights,
        array $arrangement,
        array $selectionNotes,
        string $metaDescription
    ): array {
        return [
            'key' => $key,
            'parent_key' => 'chon-bo-kich-thuoc',
            'name' => $name,
            'code' => $slug,
            'slug' => $slug,
            'order' => $order,
            'theme' => 'size',
            'scale' => $scale,
            'guide_ratio' => $guideRatio,
            'palette' => $palette,
            'description' => self::buildSizeDescription($name, $intro, $highlights, $arrangement, $selectionNotes),
            'meta_title' => $name . ' | Bộ đồ thờ Bát Tràng đúng tỷ lệ ban thờ',
            'meta_description' => $metaDescription,
            'meta_keywords' => implode(', ', [
                Str::lower($name),
                'bộ đồ thờ bát tràng',
                'đồ thờ theo kích thước ban thờ',
                'đồ thờ men lam',
            ]),
        ];
    }

    /**
     * @param  array<int, string>  $highlights
     * @param  array<int, string>  $arrangement
     * @param  array<int, string>  $selectionNotes
     */
    private static function buildSizeDescription(string $name, string $intro, array $highlights, array $arrangement, array $selectionNotes): string
    {
        $lines = [
            Str::upper($name),
            '',
            $intro,
            '',
            'Điểm cần ưu tiên',
        ];

        foreach ($highlights as $item) {
            $lines[] = '- ' . $item;
        }

        $lines[] = '';
        $lines[] = 'Gợi ý bố trí';

        foreach ($arrangement as $item) {
            $lines[] = '- ' . $item;
        }

        $lines[] = '';
        $lines[] = 'Lưu ý khi chọn bộ';

        foreach ($selectionNotes as $item) {
            $lines[] = '- ' . $item;
        }

        $lines[] = '';
        $lines[] = 'Từ khóa trọng tâm';
        $lines[] = '- BỘ ĐỒ THỜ BÁT TRÀNG, CHỌN BỘ THEO KÍCH THƯỚC BAN THỜ, MEN LAM, MEN RẠN, VẼ VÀNG.';

        return implode("\n", $lines);
    }

    private static function menLamVeTayDescription(): string
    {
        return implode("\n", [
            'BỘ ĐỒ THỜ MEN LAM VẼ TAY BÁT TRÀNG',
            '',
            'Bộ đồ thờ men lam vẽ tay Bát Tràng là dòng đồ thờ được nhiều gia đình lựa chọn nhờ sắc men xanh coban thanh nhã, họa tiết vẽ tay thủ công và thần thái trang nghiêm, bền đẹp theo thời gian.',
            '',
            'Điểm nổi bật',
            '- MEN LAM VẼ TAY chuẩn BÁT TRÀNG cho cảm giác thanh sạch, nền men sáng và đường nét thủ công có chiều sâu.',
            '- Hợp nhiều không gian từ BAN GIA TIÊN, BAN PHẬT, PHÒNG THỜ RIÊNG đến nhà thờ họ cần vẻ đẹp truyền thống.',
            '- Dễ phối bộ gồm BÁT HƯƠNG, LỌ HOA, MÂM BỒNG, KỶ CHÉN, CHÂN NẾN, ỐNG HƯƠNG và các món phụ trợ đồng bộ.',
            '',
            'Giá trị thẩm mỹ',
            '- Tông XANH COBAN tạo cảm giác mát mắt, trang nhã và rất hài hòa khi đặt trên nền gỗ mít, gỗ gõ hoặc gỗ óc chó.',
            '- Hoa văn SEN, RỒNG CHẦU, PHÚC LỘC THỌ hay họa tiết cổ vẽ tay giúp bộ đồ thờ giữ được thần thái trang nghiêm mà không bị nặng nề.',
            '- Bề mặt men mịn, sạch, lên màu sâu nên càng dùng lâu càng có độ nền nã và sang.',
            '',
            'Gợi ý chọn bộ',
            '- Với ban thờ vừa và nhỏ, nên ưu tiên BỘ 5 MÓN hoặc BỘ 7 MÓN men lam để mặt ban thoáng mà vẫn đủ nghi lễ.',
            '- Với ban thờ từ 1m27 trở lên, có thể lên BỘ 9 MÓN hoặc phối thêm MÂM BỒNG, ĐÔI CHÂN NẾN để tổng thể đầy và cân hơn.',
            '- Gia chủ thích vẻ truyền thống chuẩn Việt nên ưu tiên MEN LAM VẼ TAY khi muốn sự bền đẹp, dễ phối và ít lỗi thời.',
        ]);
    }

    private static function menLamVeVangDescription(): string
    {
        return implode("\n", [
            'BỘ ĐỒ THỜ MEN LAM VẼ VÀNG BÁT TRÀNG',
            '',
            'Bộ đồ thờ men lam vẽ vàng Bát Tràng dành cho gia chủ muốn không gian thờ vừa chuẩn truyền thống vừa có điểm nhấn sang trọng, nổi bật nhờ nền lam sâu và các chi tiết vẽ vàng tinh tế.',
            '',
            'Điểm nổi bật',
            '- MEN LAM VẼ VÀNG kết hợp sắc lam thanh nhã với ánh VÀNG NHẤN tạo hiệu ứng sang mà vẫn giữ sự trang nghiêm.',
            '- Phù hợp các không gian PHÒNG THỜ CAO CẤP, nhà phố, biệt thự hoặc ban thờ cần điểm nhấn rõ trên nền gỗ trầm.',
            '- Dễ tạo bộ đồng bộ với BÁT HƯƠNG, LỌ HOA, MÂM BỒNG, CHÂN NẾN, KỶ CHÉN và các món phụ trợ cùng phong cách.',
            '',
            'Giá trị thẩm mỹ',
            '- Các đường viền vàng làm nổi họa tiết SEN, RỒNG, VÂN MÂY, giúp bộ đồ thờ lên ánh sang trọng nhưng không phô.',
            '- Sự tương phản giữa nền lam và chi tiết vàng tạo chiều sâu thị giác, đặc biệt đẹp khi không gian thờ có ánh sáng vàng ấm.',
            '- Đây là dòng phù hợp gia chủ thích vẻ CHỈN CHU, TINH XẢO và có độ nhấn cao hơn men lam thông thường.',
            '',
            'Gợi ý chọn bộ',
            '- Với ban thờ vừa, có thể lên BỘ 7 MÓN hoặc BỘ 9 MÓN để các chi tiết vẽ vàng thể hiện rõ mà không rối mắt.',
            '- Với ban thờ lớn, nên chọn trọn bộ đồng bộ cùng một hệ hoa văn để tổng thể sang, liền mạch và có trục chính mạnh.',
            '- Khi phối cùng đồ gỗ sơn son, hoành phi câu đối hoặc nội thất có ánh đồng, MEN LAM VẼ VÀNG thường cho hiệu quả rất đẹp.',
        ]);
    }

    private static function menRanDescription(): string
    {
        return implode("\n", [
            'BỘ ĐỒ THỜ MEN RẠN BÁT TRÀNG',
            '',
            'Bộ đồ thờ men rạn Bát Tràng mang vẻ đẹp cổ kính, đằm và rất hợp những không gian thờ chú trọng chiều sâu truyền thống, sự trang nghiêm và thần thái tĩnh tại.',
            '',
            'Điểm nổi bật',
            '- MEN RẠN CỔ cho bề mặt có hệ vân rạn đẹp tự nhiên, tạo cảm giác xưa nhưng vẫn sang và rất có chiều sâu.',
            '- Hợp BAN GIA TIÊN, TỪ ĐƯỜNG, NHÀ THỜ HỌ và những không gian thờ cần vẻ đẹp cổ kính, chắc nền.',
            '- Dễ phối với bộ BÁT HƯƠNG, ĐĨA THỜ, LỌ HOA, MÂM BỒNG, CHÂN NẾN, ĐÔI HẠC hoặc các món đại khí hơn.',
            '',
            'Giá trị thẩm mỹ',
            '- Tông men ngà trầm và hệ vân rạn tạo nên cảm giác ấm, sâu, rất ăn với gỗ nâu sậm, không gian truyền thống và ánh sáng vàng ấm.',
            '- Hoa văn đắp nổi, kẻ chỉ hoặc họa tiết cổ trên MEN RẠN thường cho cảm giác dày dặn, bề thế và nghi lễ hơn.',
            '- Đây là dòng rất hợp gia chủ thích vẻ đẹp BỀN VỮNG, CỔ KÍNH, không chạy theo xu hướng sáng bóng hiện đại.',
            '',
            'Gợi ý chọn bộ',
            '- Với ban thờ trung bình, có thể chọn BỘ 7 MÓN hoặc BỘ 9 MÓN men rạn để vẫn giữ sự thoáng nhưng đủ lớp.',
            '- Với không gian thờ lớn, MEN RẠN lên bộ 9 MÓN, 11 MÓN hoặc phối thêm đại khí sẽ tạo chiều sâu rất tốt.',
            '- Nếu gia chủ muốn vẻ trang nghiêm rõ rệt, MEN RẠN là lựa chọn nổi bật hơn so với các dòng men sáng.',
        ]);
    }

    private static function sizeSelectorDescription(): string
    {
        return implode("\n", [
            'CHỌN BỘ THEO KÍCH THƯỚC BAN THỜ',
            '',
            'Danh mục CHỌN BỘ THEO KÍCH THƯỚC BAN THỜ giúp gia chủ lọc nhanh bộ đồ thờ BÁT TRÀNG đúng tỷ lệ mặt ban, tránh tình trạng bộ quá nhỏ, quá dày hoặc mất cân đối khi lên bố cục thực tế.',
            '',
            'Lợi ích khi chọn theo size',
            '- Dễ xác định bộ đồ thờ phù hợp cho BAN THẦN TÀI, BAN 1M - 1M1, BAN 1M27 - 1M4, BAN 1M57 - 1M75, BAN 1M75 - 1M97 và BAN TRÊN 2M17.',
            '- Giúp bộ BÁT HƯƠNG, LỌ HOA, MÂM BỒNG, KỶ CHÉN, CHÂN NẾN và phụ kiện đi theo đúng tỷ lệ, không chật mặt ban.',
            '- Hạn chế lỗi phối bộ khi gia chủ chọn men đẹp nhưng kích thước món không phù hợp với chiều ngang, chiều sâu hoặc chiều cao ban thờ.',
            '',
            'Nguyên tắc chọn bộ',
            '- Luôn đo đủ CHIỀU NGANG, CHIỀU SÂU và khoảng thoáng phía sau của ban thờ trước khi chốt bộ.',
            '- Chọn bộ theo TỶ LỆ TỔNG THỂ thay vì chỉ nhìn riêng kích thước bát hương.',
            '- Ưu tiên bộ đồng bộ cùng một dòng MEN LAM, MEN LAM VẼ VÀNG hoặc MEN RẠN để tổng thể sang và dễ lên bố cục.',
        ]);
    }
}
