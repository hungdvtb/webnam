<?php
$token = 'số';
$split = mb_str_split($token);
echo "Split: " . implode('%', $split) . "\n";
foreach($split as $c) {
    echo bin2hex($c) . " ";
}
echo "\n";
