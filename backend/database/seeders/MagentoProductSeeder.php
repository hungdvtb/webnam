<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class MagentoProductSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $account = \App\Models\Account::where('subdomain', 'demo')->first();
        if (!$account) {
            $account = \App\Models\Account::create([
                'name' => 'Gốm Đại Thành Demo',
                'subdomain' => 'demo',
                'site_code' => 'GOMDAITHANH_DEMO',
                'status' => 'active'
            ]);
        }
        $accountId = $account->id;

        // Clean up old demo products for this account
        $oldProducts = \App\Models\Product::where('account_id', $accountId)->get();
        foreach($oldProducts as $p) {
            foreach($p->images as $img) {
                $baseUrl = config('filesystems.disks.s3.url');
                $path = str_replace($baseUrl . '/', '', $img->image_url);
                \Illuminate\Support\Facades\Storage::disk('s3')->delete($path);
            }
            $p->delete();
        }

        $categoryIds = \App\Models\Category::pluck('id')->toArray();
        if (empty($categoryIds)) return;

        $client = new \GuzzleHttp\Client();
        $placeholderImages = [
            'https://picsum.photos/800/800?random=1',
            'https://picsum.photos/800/800?random=2',
            'https://picsum.photos/800/800?random=3'
        ];

        $uploadImage = function($product) use ($client, $placeholderImages) {
            $numImages = rand(2, 3);
            for ($i = 0; $i < $numImages; $i++) {
                try {
                    $response = $client->get($placeholderImages[array_rand($placeholderImages)]);
                    $content = $response->getBody()->getContents();
                    $filename = 'products/demo_' . uniqid() . '.jpg';
                    
                    \Illuminate\Support\Facades\Storage::disk('s3')->put($filename, $content, 'public');
                    $url = \Illuminate\Support\Facades\Storage::disk('s3')->url($filename);

                    \App\Models\ProductImage::create([
                        'product_id' => $product->id,
                        'image_url' => $url,
                        'is_primary' => $i === 0,
                        'sort_order' => $i
                    ]);
                } catch (\Exception $e) {
                    \Illuminate\Support\Facades\Log::error("Failed to upload demo image: " . $e->getMessage());
                }
            }
        };

        // 1. Create 10 Simple Products
        $simpleProducts = [];
        for ($i = 1; $i <= 10; $i++) {
            $p = \App\Models\Product::create([
                'type' => 'simple',
                'name' => "Sản phẩm gốm đơn lẻ #$i",
                'slug' => "san-pham-gom-don-le-$i-" . time(),
                'sku' => "SIMPLE-$i-" . strtoupper(\Illuminate\Support\Str::random(4)),
                'price' => rand(500, 5000) * 1000,
                'description' => "Tác phẩm gốm sứ độc bản, được chế tác tỉ mỉ bởi các nghệ nhân lành nghề của Gốm Đại Thành. Phù hợp trang trí và tâm linh.",
                'category_id' => $categoryIds[array_rand($categoryIds)],
                'stock_quantity' => rand(5, 50),
                'status' => true,
                'account_id' => $accountId,
                'is_featured' => $i <= 3,
            ]);

            $uploadImage($p);

            // Add EAV Attributes
            \App\Models\ProductAttributeValue::create([
                'product_id' => $p->id,
                'attribute_id' => 1, // Nghệ nhân
                'value' => 'Nghệ nhân Phạm Anh Đạo'
            ]);
            \App\Models\ProductAttributeValue::create([
                'product_id' => $p->id,
                'attribute_id' => 6, // Loại men
                'value' => 'Men Lam Cổ'
            ]);
            
            $simpleProducts[] = $p;
        }

        // 2. Create 2 Configurable Products
        for ($i = 1; $i <= 2; $i++) {
            $conf = \App\Models\Product::create([
                'type' => 'configurable',
                'name' => "Bình Gốm Biến Thể Loại #$i",
                'slug' => "binh-gom-bien-the-conf-$i-" . time(),
                'sku' => "CONF-$i-" . strtoupper(\Illuminate\Support\Str::random(4)),
                'price' => rand(5000, 10000) * 1000,
                'description' => "Dòng sản phẩm cao cấp có nhiều biến thể về Nghệ nhân và Loại men.",
                'category_id' => $categoryIds[array_rand($categoryIds)],
                'stock_quantity' => 0,
                'status' => true,
                'account_id' => $accountId,
            ]);

            $uploadImage($conf);

            $conf->superAttributes()->sync([1 => ['position' => 0], 6 => ['position' => 1]]);

            $variationIds = array_slice($simpleProducts, ($i - 1) * 3, 3);
            foreach ($variationIds as $idx => $v) {
                $conf->linkedProducts()->attach($v->id, ['link_type' => 'super_link', 'position' => $idx]);
            }
        }
    }
}
