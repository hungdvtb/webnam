<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use Gemini;

$client = Gemini::client('FAKE_KEY');
$class = new ReflectionClass(get_class($client));
$methods = $class->getMethods(ReflectionMethod::IS_PUBLIC);

foreach ($methods as $method) {
    echo $method->getName() . "\n";
}
