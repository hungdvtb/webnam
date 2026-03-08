<?php

use App\Models\BlogPost;
use Illuminate\Support\Str;

require __DIR__.'/vendor/autoload.php';
$app = require_once __DIR__.'/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Seeding Blog Posts...\n";

// Clear old posts
BlogPost::truncate();

$posts = [
    [
        'title' => 'Cách chọn Bình Hút Lộc theo phong thủy cho gia chủ',
        'content' => '
            <p>Bình hút lộc là một trong những vật phẩm phong thủy được ưa chuộng nhất trong các gia đình Việt. Tuy nhiên, không phải ai cũng biết cách chọn bình sao cho đúng mệnh, đúng hướng.</p>
            <p><strong>1. Chọn theo màu sắc:</strong> Người mệnh Kim nên chọn bình màu trắng, vàng. Người mệnh Mộc chọn màu xanh lá, xanh dương...</p>
            <p><strong>2. Họa tiết ý nghĩa:</strong> Các mẫu vẽ "Công Thành Danh Toại" hay "Thuận Buồm Xuôi Gió" đều mang ý nghĩa rước tài lộc vào nhà.</p>
            <p>Để đạt hiệu quả tốt nhất, gia chủ nên đặt bình ở nơi kín đáo, tránh đối diện trực tiếp với cửa ra vào.</p>
        ',
        'image' => 'https://gomsuhoanggia.vn/wp-content/uploads/2021/04/binh-hut-loc-vinh-hoa-phu-quy-men-ngoc-ve-vang-h35cm-800x800.jpg',
        'status' => true,
    ],
    [
        'title' => 'Quy trình 12 bước chế tác gốm sứ Bát Tràng thủ công',
        'content' => '
            <p>Làng gốm Bát Tràng từ lâu đã nổi tiếng với quy trình chế tác khắt khe, đòi hỏi sự kiên nhẫn và bàn tay khéo léo của người nghệ nhân.</p>
            <p>Bước đầu tiên là chọn đất. Đất sét phải là loại cao lanh trắng, mịn, được lọc bỏ tạp chất qua nhiều lần bể lọc. Sau đó là công đoạn tạo hình trên bàn xoay...</p>
            <p>Một trong những bước quan trọng nhất là "vẽ men". Nghệ nhân sử dụng bút lông vẽ trực tiếp lên cốt gốm sống trước khi đưa vào lò nung ở nhiệt độ 1300 độ C.</p>
        ',
        'image' => 'https://gomsuhoanggia.vn/wp-content/uploads/2021/04/bo-tra-men-trang-ve-sen-ke-chi-vang-800x800.jpg',
        'status' => true,
    ],
    [
        'title' => 'Ý nghĩa họa tiết Sen Vàng trên dòng gốm Tâm Linh',
        'content' => '
            <p>Hoa sen là quốc hoa của Việt Nam, tượng trưng cho sự thanh cao "gần bùn mà chẳng hôi tanh mùi bùn". Khi được kết hợp với kỹ thuật vẽ vàng 24k, nó tạo nên một vẻ đẹp quyền quý.</p>
            <p>Trong tâm linh, sen vàng mang lại sự bình an, thanh tịnh cho không gian thờ tự. Các bộ đồ thờ men rạn vẽ sen vàng thường được các gia đình đại gia tộc lựa chọn để thể hiện lòng thành kính với tổ tiên.</p>
        ',
        'image' => 'https://gomsuhoanggia.vn/wp-content/uploads/2021/04/binh-hoa-25-cm-sen-vang-men-ngoc-800x800.jpg',
        'status' => true,
    ]
];

foreach ($posts as $data) {
    $data['account_id'] = 1;
    $data['slug'] = Str::slug($data['title']);
    BlogPost::create($data);
}

echo "Blog seeding complete!\n";
