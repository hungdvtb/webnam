<?php
$file = 'C:/xampp/htdocs/webnam/design/test_doi_soat/test đối soát.xlsx';
$zip = new ZipArchive();
if ($zip->open($file) !== true) { echo 'Cannot open'; exit; }
$shared = [];
$ss = $zip->getFromName('xl/sharedStrings.xml');
if ($ss) {
    $dom = new DOMDocument(); $dom->loadXML($ss, LIBXML_NOERROR);
    $x = new DOMXPath($dom); $x->registerNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    foreach ($x->query('//m:si') as $si) { $t=''; foreach ($x->query('.//m:t', $si) as $n) $t .= $n->textContent; $shared[] = $t; }
}
$ws = $zip->getFromName('xl/worksheets/sheet1.xml'); $zip->close();
$dom2 = new DOMDocument(); $dom2->loadXML($ws, LIBXML_NOERROR);
$x2 = new DOMXPath($dom2); $x2->registerNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');

$r = 0;
foreach ($x2->query('//m:sheetData/m:row') as $row) {
    if (in_array($r, [8, 55, 68, 79, 84])) { // Row 9, 56, 69, 80, 85
        $cells = []; $max = -1;
        foreach ($x2->query('./m:c', $row) as $c) {
            $ref = $c->getAttribute('r');
            preg_match('/^([A-Z]+)/', $ref, $m2);
            $l = $m2[1] ?? 'A'; $ci = 0;
            for ($i = 0; $i < strlen($l); $i++) $ci = $ci * 26 + (ord($l[$i]) - 64);
            $ci--;
            $type = $c->getAttribute('t');
            $vn = $x2->query('./m:v', $c)->item(0);
            $val = $vn ? $vn->textContent : '';
            if ($type === 's') $val = $shared[(int)$val] ?? $val;
            $cells[$ci] = $val; $max = max($max, $ci);
        }
        if ($max >= 0) {
            echo "Row " . ($r+1) . ":\n";
            echo "  Mã VĐ: " . ($cells[1] ?? '') . "\n";
            echo "  Trạng Thái: " . ($cells[32] ?? '') . "\n"; // AG is 32
            echo "  Cước VC: " . ($cells[25] ?? '') . "\n"; // Z is 25
            echo "  Tiền Thu Hộ: " . ($cells[26] ?? '') . "\n"; // AA is 26
            echo "  Tổng phí: " . ($cells[31] ?? '') . "\n"; // AF is 31
            echo "  Trạng thái đối soát COD: " . ($cells[34] ?? '') . "\n"; // AI is 34
        }
    }
    $r++;
}
