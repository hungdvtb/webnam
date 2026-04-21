<?php

namespace App\Services\Shipping;

use App\Models\Order;
use App\Models\Shipment;
use App\Models\ShipmentReconciliation;
use App\Services\SimpleXlsxService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ViettelPostReconciliationService
{
    private SimpleXlsxService $xlsxService;

    public function __construct(SimpleXlsxService $xlsxService)
    {
        $this->xlsxService = $xlsxService;
    }

    /**
     * Normalize a header/key string: strip all non-letter/digit chars, lowercase.
     * "Tổng phí (9)= (3)+(5)+(6)+(7)-(8)" → "tổngphí9357678"
     */
    private function normalizeKey(string $value): string
    {
        $clean = preg_replace('/[^\p{L}\p{N}]/u', '', trim($value));
        return mb_strtolower($clean ?? '', 'UTF-8');
    }

    /**
     * VTP status string → internal shipment_status.
     */
    private function mapVtpStatus(string $vtpStatus): ?string
    {
        $normalized = mb_strtolower(trim($vtpStatus), 'UTF-8');
        $map = [
            'giao thành công'   => 'delivered',
            'đang vận chuyển'   => 'in_transit',
            'đang giao hàng'    => 'out_for_delivery',
            'chờ phát lại'      => 'out_for_delivery',
            'đã lấy hàng'       => 'picked_up',
            'chuyển hoàn'       => 'returning',
            'đã hoàn thành'     => 'returned',
            'đã hoàn'           => 'returned',
            'hoàn thành công'   => 'returned',
        ];
        foreach ($map as $vtp => $sys) {
            if (str_contains($normalized, mb_strtolower($vtp, 'UTF-8'))) {
                return $sys;
            }
        }
        return null;
    }

    /**
     * Detect DH (exchange) or NP1 (partial) suffix on a tracking code.
     * Returns ['base_code' => string, 'type' => 'exchange'|'partial'] or null.
     */
    private function detectReturnSuffix(string $trackingCode): ?array
    {
        $code = trim($trackingCode);

        // Exchange: e.g. 138018222594DH  or  138018222594 DH
        if (preg_match('/^(\d+)\s*DH$/i', $code, $m)) {
            return ['base_code' => $m[1], 'type' => 'exchange'];
        }

        // Partial: e.g. 1376834708121P1  or  137683470812 1P1  or 2P1 etc.
        if (preg_match('/^(\d+)\s*\d+P\d+$/i', $code, $m)) {
            return ['base_code' => $m[1], 'type' => 'partial'];
        }

        return null;
    }

    /**
     * Main entry point. Processes the ViettelPost "Danh sách vận đơn" Excel file.
     *
     * Column layout (confirmed from actual VTP file, header at row 9):
     *   B  = Mã Vận Đơn
     *   Z  = Cước vận chuyển (3)
     *   AA = Tiền thu hộ (4)
     *   AF = Tổng phí (9)
     *   AG = Trạng Thái
     *   AI = Trạng thái đối soát COD
     *
     * Formulas:
     *   Tiền về (normal)  = Tiền thu hộ (AA) - Tổng phí (AF)
     *   Chi phí hoàn (DH/1P1) = Tổng phí (AF) + 0.5 × Cước VC (Z)
     */
    public function processFile(string $filePath, int $userId): array
    {
        try {
            $allRows = $this->xlsxService->readRaw($filePath);

            if (empty($allRows)) {
                return ['success' => false, 'message' => 'File Excel không có dữ liệu hoặc sai định dạng.'];
            }

            // ── Find header row ──────────────────────────────────────────────
            $headerRowIndex = -1;
            foreach ($allRows as $rowIndex => $row) {
                foreach ($row as $cell) {
                    $n = $this->normalizeKey((string) $cell);
                    if (in_array($n, ['mãvậnđơn', 'mavandon', 'mãvđ', 'sốphiếugửi'], true)) {
                        $headerRowIndex = $rowIndex;
                        break 2;
                    }
                }
            }

            if ($headerRowIndex === -1) {
                return ['success' => false, 'message' => 'Không tìm thấy dòng tiêu đề. Cột "Mã Vận Đơn" bắt buộc phải có.'];
            }

            // ── Build header map ─────────────────────────────────────────────
            $headerMap = [];
            foreach ($allRows[$headerRowIndex] as $colIndex => $cell) {
                $key = $this->normalizeKey((string) $cell);
                if ($key !== '') {
                    $headerMap[$key] = $colIndex;
                }
            }

            // ── Summary ──────────────────────────────────────────────────────
            $summary = [
                'total_rows'        => 0,
                'reconciled'        => 0,       // Tiền khớp ±500đ
                'mismatch'          => 0,        // Lệch tiền
                'mismatch_positive' => 0,        // VTP chuyển nhiều hơn
                'mismatch_negative' => 0,        // VTP chuyển ít hơn
                'mismatch_pos_amount' => 0.0,    // Tổng tiền lệch dương
                'mismatch_neg_amount' => 0.0,    // Tổng tiền lệch âm (absolute)
                'in_progress'       => 0,        // Chưa giao thành công
                'not_found'         => 0,        // Không tìm thấy trong hệ thống
                'return_exchange'   => 0,        // Đơn đổi hàng (DH)
                'return_partial'    => 0,        // Đơn giao 1 phần (1P1)
                'return_exchange_cost' => 0.0,   // Chi phí hoàn đổi
                'return_partial_cost'  => 0.0,   // Chi phí hoàn 1 phần
                'errors'            => [],
                'results'           => [],
            ];

            // ── Process each row ─────────────────────────────────────────────
            for ($i = $headerRowIndex + 1; $i < count($allRows); $i++) {
                $row = $allRows[$i];

                // Skip empty rows
                $hasData = false;
                foreach ($row as $cell) {
                    if (trim((string) $cell) !== '') { $hasData = true; break; }
                }
                if (!$hasData) continue;

                $summary['total_rows']++;
                $result = $this->processRow($row, $headerMap, $userId, $i + 1);

                switch ($result['status']) {
                    case 'reconciled':
                        $summary['reconciled']++;
                        break;
                    case 'mismatch':
                        $summary['mismatch']++;
                        if (($result['diff'] ?? 0) > 0) {
                            $summary['mismatch_positive']++;
                            $summary['mismatch_pos_amount'] += $result['diff'];
                        } else {
                            $summary['mismatch_negative']++;
                            $summary['mismatch_neg_amount'] += abs($result['diff']);
                        }
                        break;
                    case 'in_progress':
                        $summary['in_progress']++;
                        break;
                    case 'not_found':
                        $summary['not_found']++;
                        break;
                    case 'return_exchange':
                        $summary['return_exchange']++;
                        $summary['return_exchange_cost'] += abs($result['return_cost'] ?? 0);
                        break;
                    case 'return_partial':
                        $summary['return_partial']++;
                        $summary['return_partial_cost'] += abs($result['return_cost'] ?? 0);
                        break;
                    case 'error':
                        $summary['errors'][] = 'Dòng ' . ($i + 1) . ': ' . $result['message'];
                        break;
                }

                $summary['results'][] = $result;
            }

            return ['success' => true, 'summary' => $summary];

        } catch (\Exception $e) {
            Log::error('VTP Reconciliation Error: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
            return ['success' => false, 'message' => 'Lỗi xử lý file: ' . $e->getMessage()];
        }
    }

    /**
     * Process a single data row.
     */
    private function processRow(array $row, array $headerMap, int $userId, int $lineNum): array
    {
        // Helper: get cell value by multiple header aliases
        $get = function (array $aliases, $default = '') use ($row, $headerMap) {
            foreach ($aliases as $alias) {
                $key = $this->normalizeKey($alias);
                if (isset($headerMap[$key])) {
                    $val = trim((string) ($row[$headerMap[$key]] ?? ''));
                    if ($val !== '') return $val;
                }
            }
            return $default;
        };

        // ── Extract columns ──────────────────────────────────────────────────
        $trackingCode = $get(['Mã Vận Đơn', 'Mã vận đơn', 'mãvậnđơn', 'Số phiếu gửi']);

        // Cước vận chuyển (Z) = col 3 in formula
        $shippingFee = (float) str_replace(',', '', $get([
            'Cước vận chuyển (3)= (1+2)', 'Cước vận chuyển (3)=(1+2)', 'Cước vận chuyển', 'cuocvanChuyển', 'cuocvanchuyển3'
        ], '0'));

        // Tiền thu hộ (AA) = COD collected
        $codAmount = (float) str_replace(',', '', $get([
            'Tiền thu hộ (4)', 'Tiền thu hộ(4)', 'Tiền thu hộ', 'tiềnthuhộ4', 'tiềnthuhộ'
        ], '0'));

        // Tổng phí (AF) = total fee charged by VTP
        $totalFee = (float) str_replace(',', '', $get([
            'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)', 'Tổng phí (9)=(3)+(5)+(6)+(7)-(8)',
            'Tổng phí', 'tổngphí9', 'tongphi'
        ], '0'));

        // Trạng Thái (AG)
        $vtpStatus = $get(['Trạng Thái', 'Trạng thái', 'trangthai']);

        if ($trackingCode === '') {
            return ['status' => 'error', 'message' => 'Không tìm thấy mã vận đơn trong dòng này.'];
        }

        // ── Detect return suffix (DH / 1P1) ─────────────────────────────────
        $returnInfo = $this->detectReturnSuffix($trackingCode);
        if ($returnInfo !== null) {
            return $this->processReturnRow(
                $returnInfo['base_code'],
                $returnInfo['type'],
                $trackingCode,
                $codAmount,
                $shippingFee,
                $totalFee,
                $vtpStatus,
                $userId
            );
        }

        // ── Map VTP status ───────────────────────────────────────────────────
        $systemStatus = $this->mapVtpStatus($vtpStatus);

        // ── Find shipment ────────────────────────────────────────────────────
        $shipment = Shipment::where('tracking_number', $trackingCode)
            ->orWhere('carrier_tracking_code', $trackingCode)
            ->first();

        // Non-delivered orders: just update status, no financial reconciliation
        if ($systemStatus !== 'delivered') {
            if ($shipment && $systemStatus) {
                $shipment->update(['shipment_status' => $systemStatus]);
            }
            return [
                'status'        => 'in_progress',
                'tracking_code' => $trackingCode,
                'vtp_status'    => $vtpStatus,
                'system_status' => $systemStatus,
                'message'       => "Đơn đang xử lý ({$vtpStatus}), bỏ qua đối soát tài chính.",
            ];
        }

        if (!$shipment) {
            return [
                'status'        => 'not_found',
                'tracking_code' => $trackingCode,
                'message'       => "Không tìm thấy vận đơn {$trackingCode} trên hệ thống.",
            ];
        }

        // ── Calculate financials ─────────────────────────────────────────────
        // Tiền về = COD thu được - Tổng phí VTP
        $receivedAmount = $codAmount - $totalFee;

        return DB::transaction(function () use (
            $shipment, $codAmount, $shippingFee, $totalFee,
            $receivedAmount, $userId, $trackingCode
        ) {
            $expected = (float) $shipment->actual_received_amount;
            $diff     = $receivedAmount - $expected;

            // ±500 VNĐ tolerance
            $reconciliationStatus = abs($diff) <= 500 ? 'reconciled' : 'mismatch';

            $shipment->update([
                'reconciled_amount'          => $receivedAmount,
                'reconciliation_diff_amount' => $diff,
                'reconciliation_status'      => $reconciliationStatus,
                'reconciled_at'              => now(),
                'last_reconciled_at'         => now(),
                'shipment_status'            => 'delivered',
            ]);

            ShipmentReconciliation::create([
                'shipment_id'            => $shipment->id,
                'carrier_code'           => $shipment->carrier_code ?: 'viettelpost',
                'cod_amount'             => $codAmount,
                'shipping_fee'           => $totalFee,
                'service_fee'            => 0,
                'actual_received_amount' => $receivedAmount,
                'system_expected_amount' => $expected,
                'diff_amount'            => $diff,
                'status'                 => $reconciliationStatus,
                'reconciled_by'          => $userId,
                'reconciled_at'          => now(),
                'note'                   => "Đối soát VTP. Mã VĐ: {$trackingCode}. "
                    . "COD: " . number_format($codAmount) . "đ. "
                    . "Tổng phí: " . number_format($totalFee) . "đ. "
                    . "Tiền về: " . number_format($receivedAmount) . "đ.",
            ]);

            return [
                'status'                => $reconciliationStatus,
                'shipment_id'           => $shipment->id,
                'shipment_number'       => $shipment->shipment_number,
                'tracking_code'         => $trackingCode,
                'reconciliation_status' => $reconciliationStatus,
                'received_amount'       => $receivedAmount,
                'expected_amount'       => $expected,
                'diff'                  => $diff,
            ];
        });
    }

    /**
     * Process a DH (exchange) or 1P1 (partial) return row.
     *
     * Chi phí hoàn = Tổng phí (AF) + 0.5 × Cước VC (Z)
     * This is a cost, recorded as a negative adjustment on the original shipment.
     */
    private function processReturnRow(
        string $baseCode,
        string $returnType,   // 'exchange' | 'partial'
        string $fullReturnCode,
        float  $codAmount,
        float  $shippingFee,
        float  $totalFee,
        string $vtpStatus,
        int    $userId
    ): array {
        // Cost the shop pays for this return
        $returnCost = $totalFee + (0.5 * $shippingFee);  // positive number = expense

        // Find original order via return_tracking_code field
        $order = Order::where('return_tracking_code', $fullReturnCode)->first();

        // Find original shipment (via order or directly via base tracking code)
        $shipment = null;
        if ($order) {
            $shipment = Shipment::where('order_id', $order->id)->first();
        }
        if (!$shipment) {
            $shipment = Shipment::where('tracking_number', $baseCode)
                ->orWhere('carrier_tracking_code', $baseCode)
                ->first();
        }

        if (!$shipment) {
            $typeLabel = $returnType === 'exchange' ? 'đổi hàng' : 'giao 1 phần';
            return [
                'status'        => 'not_found',
                'tracking_code' => $fullReturnCode,
                'message'       => "Đơn {$typeLabel} {$fullReturnCode}: không tìm thấy vận đơn gốc (mã gốc: {$baseCode}).",
            ];
        }

        return DB::transaction(function () use (
            $shipment, $order, $returnType, $fullReturnCode,
            $baseCode, $codAmount, $shippingFee, $totalFee, $returnCost, $userId, $vtpStatus
        ) {
            $typeLabel  = $returnType === 'exchange' ? 'đổi hàng (DH)' : 'hoàn 1 phần (1P1)';
            $recStatus  = $returnType === 'exchange' ? 'return_exchange' : 'return_partial';

            // Record adjustment as negative (cost to shop)
            ShipmentReconciliation::create([
                'shipment_id'            => $shipment->id,
                'carrier_code'           => $shipment->carrier_code ?: 'viettelpost',
                'cod_amount'             => 0,
                'shipping_fee'           => $shippingFee,
                'service_fee'            => 0,
                'actual_received_amount' => -$returnCost, // negative = cost
                'system_expected_amount' => 0,
                'diff_amount'            => -$returnCost,
                'status'                 => $recStatus,
                'reconciled_by'          => $userId,
                'reconciled_at'          => now(),
                'note'                   => "Chi phí {$typeLabel}. Mã hoàn: {$fullReturnCode}. Mã gốc: {$baseCode}. "
                    . "Tổng phí: " . number_format($totalFee) . "đ. "
                    . "Cước VC: " . number_format($shippingFee) . "đ. "
                    . "Chi phí hoàn (phí + 1/2 cước): " . number_format($returnCost) . "đ.",
            ]);

            // Update shipment return_status & mark as returned
            $newReturnStatus = $returnType === 'exchange' ? 'exchanged' : 'partial_returned';
            $shipment->update([
                'return_status'         => $newReturnStatus,
                'shipment_status'       => 'returned',
                'reconciliation_status' => $recStatus,
                'reconciled_at'         => now(),
                'last_reconciled_at'    => now(),
            ]);

            // Also update order return_status if linked
            if ($order) {
                if (!in_array($order->return_status, ['exchanged', 'partial_returned', 'returned'], true)) {
                    $order->update(['return_status' => $newReturnStatus]);
                }
            }

            $statusKey = $returnType === 'exchange' ? 'return_exchange' : 'return_partial';

            return [
                'status'          => $statusKey,
                'return_type'     => $returnType,
                'return_code'     => $fullReturnCode,
                'base_code'       => $baseCode,
                'shipment_id'     => $shipment->id,
                'shipment_number' => $shipment->shipment_number,
                'return_cost'     => $returnCost,           // positive, for display
                'message'         => "Chi phí {$typeLabel} vào VĐ gốc {$baseCode}: " . number_format($returnCost) . "đ.",
            ];
        });
    }
}
