<?php
define('LARAVEL_START', microtime(true));
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\Product;

$sku = 'DEMO-GOM-0051';
$product = Product::where('sku', $sku)->first();

if ($product) {
    // A more relevant pottery video instead of Rickroll if possible, but let's use a placeholder first
    $videoHtml = '<div class="video-container"><iframe src="https://www.youtube.com/embed/Yp_DBy6XwM8" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
    
    // Check if video already exists to avoid duplication
    if (strpos($product->description, 'video-container') === false) {
        $product->description = $product->description . "\n\n<h3>Quy trình chế tác thủ công</h3>\n" . $videoHtml;
        $product->save();
        echo "Product $sku updated with video.\n";
    } else {
        echo "Product $sku already has a video.\n";
    }
} else {
    echo "Product $sku not found.\n";
}
