<?php

require __DIR__ . '/vendor/autoload.php';

// Mock Laravel environment enough to run the service
class App {
    public static function make($class) {
        if ($class === \App\Services\SimpleXlsxService::class) {
            return new \App\Services\SimpleXlsxService();
        }
    }
}

// Manually include necessary files since we are outside Laravel's bootstrap for a quick script
require_once __DIR__ . '/app/Services/SimpleXlsxService.php';

$xlsx = new \App\Services\SimpleXlsxService();
$filePath = 'C:\xampp\htdocs\webnam\design\doi_soat_viettelpost\VTP_danh_sach_van_don_18_04_2026 09_33_46.xlsx';

try {
    $rows = $xlsx->readRaw($filePath);
    $headerRowIndex = -1;
    $headers = [];
    foreach ($rows as $idx => $row) {
        if (in_array('Mã Vận Đơn', $row)) {
            $headerRowIndex = $idx;
            $headers = $row;
            break;
        }
    }

    if ($headerRowIndex === -1) {
        echo "Could not find header row.\n";
        return;
    }

    echo "FOUND HEADERS at index $headerRowIndex:\n";
    $tongPhiIdx = -1;
    foreach ($headers as $idx => $hdr) {
        // Strip line breaks that might break comparison
        $cleanHdr = preg_replace('/\s+/', ' ', trim($hdr));
        if (strpos($cleanHdr, 'Tổng phí') !== false) {
            $tongPhiIdx = $idx;
            echo "-> Found Tổng phí column at index: $idx ($cleanHdr)\n";
        }
    }

    if ($tongPhiIdx === -1) {
        $tongPhiIdx = 31; // fallback
    }

    $totalFee = 0;
    $rowCount = 0;
    foreach (array_slice($rows, $headerRowIndex + 1) as $idx => $row) {
        if (!isset($row[1]) || trim($row[1]) === '') continue; // Skip empty rows (no tracking code)
        $feeStr = $row[$tongPhiIdx] ?? '0';
        $fee = (float)str_replace(',', '', $feeStr);
        $totalFee += $fee;
        $rowCount++;
    }
    echo "\nTOTAL ROWS: $rowCount\n";
    echo "TOTAL SHIPPING FEE (Column $tongPhiIdx): " . number_format($totalFee, 0) . " VND\n";
    
} catch (\Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
}
