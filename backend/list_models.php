<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use Gemini;

$client = Gemini::factory()
    ->withApiKey('AIzaSyA3059CMFq_Q078GNSo72OYK_rDl13-eww')
    ->withBaseUrl('https://generativelanguage.googleapis.com/v1/')
    ->make();

try {
    $models = $client->models()->list();
    foreach ($models->models as $model) {
        echo $model->name . " (" . $model->version . "): " . implode(', ', $model->supportedGenerationMethods) . "\n";
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
