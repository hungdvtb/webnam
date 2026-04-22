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
    private const CARRIER_CODE = 'viettel_post';

    public function __construct(
        private SimpleXlsxService $xlsxService,
        private ShipmentStatusSyncService $syncService
    ) {
    }

    private function normalizeKey(string $value): string
    {
        $clean = preg_replace('/[^\p{L}\p{N}]/u', '', trim($value));

        return mb_strtolower($clean ?? '', 'UTF-8');
    }

    private function mapVtpStatus(string $vtpStatus): ?string
    {
        $normalized = mb_strtolower(trim($vtpStatus), 'UTF-8');
        $map = [
            'giao thành công' => 'delivered',
            'đang vận chuyển' => 'in_transit',
            'đang giao hàng' => 'out_for_delivery',
            'chờ phát lại' => 'out_for_delivery',
            'đã lấy hàng' => 'picked_up',
            'chờ xử lý' => 'waiting_pickup',
            'chuyển hoàn' => 'returning',
            'đã hoàn thành' => 'returned',
            'đã hoàn' => 'returned',
            'hoàn thành công' => 'returned',
            'đã trả' => 'returned',
        ];

        foreach ($map as $vtp => $sys) {
            if (str_contains($normalized, mb_strtolower($vtp, 'UTF-8'))) {
                return $sys;
            }
        }

        return null;
    }

    private function syncShipmentFromVtpStatus(Shipment $shipment, string $vtpStatus, int $userId, string $trackingCode): array
    {
        $shipment->forceFill([
            'carrier_code' => self::CARRIER_CODE,
            'carrier_name' => $shipment->carrier_name ?: 'Viettel Post',
            'tracking_number' => $shipment->tracking_number ?: $trackingCode,
            'carrier_tracking_code' => $shipment->carrier_tracking_code ?: $trackingCode,
        ])->save();

        $result = $this->syncService->processCarrierStatus($shipment, $vtpStatus);

        if (($result['success'] ?? false) || !empty($result['mapping_disabled'])) {
            return $result;
        }

        $fallbackStatus = $this->mapVtpStatus($vtpStatus);
        if ($fallbackStatus === null) {
            return $result;
        }

        $shipment->forceFill([
            'carrier_status_raw' => $vtpStatus,
            'carrier_status_mapped' => $fallbackStatus,
            'carrier_status_code' => $vtpStatus,
            'carrier_status_text' => $vtpStatus,
            'last_synced_at' => now(),
        ])->save();

        if ((string) $shipment->shipment_status === $fallbackStatus) {
            $orderSynced = $this->syncService->syncOrderFromShipment($shipment->fresh(), 'carrier_sync', $userId);

            return [
                'success' => true,
                'message' => 'Trang thai VTP da duoc dong bo.',
                'shipment' => $shipment->fresh(),
                'order_synced' => $orderSynced,
            ];
        }

        return $this->syncService->updateShipmentStatus(
            $shipment,
            $fallbackStatus,
            'carrier_sync',
            $userId,
            "Auto-sync tu file doi soat VTP: raw='{$vtpStatus}'"
        );
    }

    private function detectReturnSuffix(string $trackingCode): ?array
    {
        $code = trim($trackingCode);

        if (preg_match('/^(\d+)\s*DH$/i', $code, $m)) {
            return ['base_code' => $m[1], 'type' => 'exchange'];
        }

        if (preg_match('/^(\d+)\s*\d+P\d+$/i', $code, $m)) {
            return ['base_code' => $m[1], 'type' => 'partial'];
        }

        return null;
    }

    public function processFile(string $filePath, int $userId, ?int $accountId = null): array
    {
        try {
            $allRows = $this->xlsxService->readRaw($filePath);

            if (empty($allRows)) {
                return ['success' => false, 'message' => 'File Excel không có dữ liệu hoặc sai định dạng.'];
            }

            $headerRowIndex = -1;
            foreach ($allRows as $rowIndex => $row) {
                foreach ($row as $cell) {
                    $normalizedCell = $this->normalizeKey((string) $cell);
                    if (in_array($normalizedCell, ['mãvậnđơn', 'mavandon', 'mãvđ', 'sốphiếugửi'], true)) {
                        $headerRowIndex = $rowIndex;
                        break 2;
                    }
                }
            }

            if ($headerRowIndex === -1) {
                return ['success' => false, 'message' => 'Không tìm thấy dòng tiêu đề. Cột "Mã Vận Đơn" bắt buộc phải có.'];
            }

            $headerMap = [];
            foreach ($allRows[$headerRowIndex] as $colIndex => $cell) {
                $key = $this->normalizeKey((string) $cell);
                if ($key !== '') {
                    $headerMap[$key] = $colIndex;
                }
            }

            $summary = [
                'total_rows' => 0,
                'received_cod' => 0,
                'unreconciled_cod' => 0,
                'no_cod' => 0,
                'in_progress' => 0,
                'not_found' => 0,
                'return_exchange' => 0,
                'return_partial' => 0,
                'return_exchange_cost' => 0.0,
                'return_partial_cost' => 0.0,
                'errors' => [],
                'results' => [],
            ];

            for ($i = $headerRowIndex + 1; $i < count($allRows); $i++) {
                $row = $allRows[$i];

                $hasData = false;
                foreach ($row as $cell) {
                    if (trim((string) $cell) !== '') {
                        $hasData = true;
                        break;
                    }
                }

                if (!$hasData) {
                    continue;
                }

                $summary['total_rows']++;
                $result = $this->processRow($row, $headerMap, $userId, $i + 1, $accountId);

                switch ($result['status']) {
                    case 'received_cod':
                        $summary['received_cod']++;
                        break;
                    case 'unreconciled_cod':
                        $summary['unreconciled_cod']++;
                        break;
                    case 'no_cod':
                        $summary['no_cod']++;
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

    private function processRow(array $row, array $headerMap, int $userId, int $lineNum, ?int $accountId = null): array
    {
        $get = function (array $aliases, $default = '') use ($row, $headerMap) {
            foreach ($aliases as $alias) {
                $key = $this->normalizeKey($alias);
                if (isset($headerMap[$key])) {
                    $value = trim((string) ($row[$headerMap[$key]] ?? ''));
                    if ($value !== '') {
                        return $value;
                    }
                }
            }

            return $default;
        };

        $trackingCode = $get(['Mã Vận Đơn', 'Mã vận đơn', 'mãvậnđơn', 'Số phiếu gửi']);
        $shippingFee = (float) str_replace(',', '', $get([
            'Cước vận chuyển (3)= (1+2)',
            'Cước vận chuyển (3)=(1+2)',
            'Cước vận chuyển',
            'cuocvanChuyển',
            'cuocvanchuyển3',
        ], '0'));
        $codAmount = (float) str_replace(',', '', $get([
            'Tiền thu hộ (4)',
            'Tiền thu hộ(4)',
            'Tiền thu hộ',
            'tiềnthuhộ4',
            'tiềnthuhộ',
        ], '0'));
        $totalFee = (float) str_replace(',', '', $get([
            'Tổng phí (9)= (3)+(5)+(6)+(7)-(8)',
            'Tổng phí (9)=(3)+(5)+(6)+(7)-(8)',
            'Tổng phí',
            'tổngphí9',
            'tongphi',
        ], '0'));
        $vtpStatus = $get(['Trạng Thái', 'Trạng thái', 'trangthai']);
        $codStatus = $get([
            'Trạng thái đối soát COD',
            'TrạngtháiđốisoátCOD',
            'trangthaidoisoatcod',
        ]);
        $codStatusRaw = mb_strtolower($codStatus, 'UTF-8');

        $reconciliationStatus = 'unreconciled_cod';
        if (str_contains($codStatusRaw, 'đã nhận cod')) {
            $reconciliationStatus = 'received_cod';
        } elseif (str_contains($codStatusRaw, 'không có cod')) {
            $reconciliationStatus = 'no_cod';
        }

        if ($vtpStatus !== '') {
            $this->syncService->rememberCarrierRawStatus($accountId, self::CARRIER_CODE, $vtpStatus, [
                'source' => 'viettel_post_reconciliation_import',
                'line' => $lineNum,
                'tracking_code' => $trackingCode,
                'cod_status' => $codStatus,
            ]);
        }

        if ($trackingCode === '') {
            return ['status' => 'error', 'message' => 'Không tìm thấy mã vận đơn trong dòng này.'];
        }

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

        $systemStatus = $this->mapVtpStatus($vtpStatus);
        $shipment = Shipment::query()
            ->where('tracking_number', $trackingCode)
            ->orWhere('carrier_tracking_code', $trackingCode)
            ->first();

        if (!$shipment) {
            return [
                'status' => $systemStatus === 'delivered' ? 'not_found' : 'in_progress',
                'tracking_code' => $trackingCode,
                'vtp_status' => $vtpStatus,
                'system_status' => $systemStatus,
                'message' => $systemStatus === 'delivered'
                    ? "Không tìm thấy vận đơn {$trackingCode} trên hệ thống."
                    : "Đơn đang xử lý ({$vtpStatus}), chưa tìm thấy vận đơn tương ứng để cập nhật.",
            ];
        }

        $statusResult = $this->syncShipmentFromVtpStatus($shipment, $vtpStatus, $userId, $trackingCode);
        if (!($statusResult['success'] ?? false)) {
            return [
                'status' => 'error',
                'tracking_code' => $trackingCode,
                'vtp_status' => $vtpStatus,
                'message' => $statusResult['message'] ?? 'Không đồng bộ được trạng thái VTP.',
            ];
        }

        $shipment = $shipment->fresh();

        if ((string) $shipment->shipment_status !== 'delivered' && $systemStatus !== 'delivered') {
            if ((string) $shipment->reconciliation_status !== $reconciliationStatus) {
                $shipment->update([
                    'reconciliation_status' => $reconciliationStatus,
                ]);
            }

            return [
                'status' => 'in_progress',
                'tracking_code' => $trackingCode,
                'vtp_status' => $vtpStatus,
                'system_status' => $shipment->shipment_status,
                'message' => "Đơn đang xử lý ({$vtpStatus}), cập nhật COD: {$reconciliationStatus}.",
            ];
        }

        $receivedAmount = $codAmount - $totalFee;

        return DB::transaction(function () use (
            $shipment,
            $codAmount,
            $totalFee,
            $receivedAmount,
            $userId,
            $trackingCode,
            $reconciliationStatus
        ) {
            $expected = (float) $shipment->actual_received_amount;
            $diff = $receivedAmount - $expected;

            $shipment->update([
                'reconciled_amount' => $receivedAmount,
                'reconciliation_diff_amount' => $diff,
                'reconciliation_status' => $reconciliationStatus,
                'reconciled_at' => now(),
                'last_reconciled_at' => now(),
                'carrier_code' => self::CARRIER_CODE,
                'carrier_name' => $shipment->carrier_name ?: 'Viettel Post',
            ]);

            ShipmentReconciliation::create([
                'shipment_id' => $shipment->id,
                'carrier_code' => self::CARRIER_CODE,
                'cod_amount' => $codAmount,
                'shipping_fee' => $totalFee,
                'service_fee' => 0,
                'actual_received_amount' => $receivedAmount,
                'system_expected_amount' => $expected,
                'diff_amount' => $diff,
                'status' => $reconciliationStatus,
                'reconciled_by' => $userId,
                'reconciled_at' => now(),
                'note' => "Đối soát VTP. Mã VĐ: {$trackingCode}. "
                    . 'COD: ' . number_format($codAmount) . 'đ. '
                    . 'Tổng phí: ' . number_format($totalFee) . 'đ. '
                    . 'Tiền về: ' . number_format($receivedAmount) . 'đ.',
            ]);

            return [
                'status' => $reconciliationStatus,
                'shipment_id' => $shipment->id,
                'shipment_number' => $shipment->shipment_number,
                'tracking_code' => $trackingCode,
                'reconciliation_status' => $reconciliationStatus,
                'received_amount' => $receivedAmount,
                'expected_amount' => $expected,
                'diff' => $diff,
            ];
        });
    }

    private function processReturnRow(
        string $baseCode,
        string $returnType,
        string $fullReturnCode,
        float $codAmount,
        float $shippingFee,
        float $totalFee,
        string $vtpStatus,
        int $userId
    ): array {
        $returnCost = $totalFee + (0.5 * $shippingFee);

        $order = Order::query()->where('return_tracking_code', $fullReturnCode)->first();
        $shipment = null;

        if ($order) {
            $shipment = Shipment::query()->where('order_id', $order->id)->first();
        }

        if (!$shipment) {
            $shipment = Shipment::query()
                ->where('tracking_number', $baseCode)
                ->orWhere('carrier_tracking_code', $baseCode)
                ->first();
        }

        if (!$shipment) {
            $typeLabel = $returnType === 'exchange' ? 'đổi hàng' : 'giao 1 phần';

            return [
                'status' => 'not_found',
                'tracking_code' => $fullReturnCode,
                'message' => "Đơn {$typeLabel} {$fullReturnCode}: không tìm thấy vận đơn gốc (mã gốc: {$baseCode}).",
            ];
        }

        return DB::transaction(function () use (
            $shipment,
            $order,
            $returnType,
            $fullReturnCode,
            $baseCode,
            $shippingFee,
            $totalFee,
            $returnCost,
            $userId,
            $vtpStatus
        ) {
            $typeLabel = $returnType === 'exchange' ? 'đổi hàng (DH)' : 'hoàn 1 phần (1P1)';
            $recStatus = $returnType === 'exchange' ? 'return_exchange' : 'return_partial';
            $newReturnStatus = $returnType === 'exchange' ? 'exchanged' : 'partial_returned';

            ShipmentReconciliation::create([
                'shipment_id' => $shipment->id,
                'carrier_code' => self::CARRIER_CODE,
                'cod_amount' => 0,
                'shipping_fee' => $shippingFee,
                'service_fee' => 0,
                'actual_received_amount' => -$returnCost,
                'system_expected_amount' => 0,
                'diff_amount' => -$returnCost,
                'status' => $recStatus,
                'reconciled_by' => $userId,
                'reconciled_at' => now(),
                'note' => "Chi phí {$typeLabel}. Mã hoàn: {$fullReturnCode}. Mã gốc: {$baseCode}. "
                    . 'Tổng phí: ' . number_format($totalFee) . 'đ. '
                    . 'Cước VC: ' . number_format($shippingFee) . 'đ. '
                    . 'Chi phí hoàn (phí + 1/2 cước): ' . number_format($returnCost) . 'đ.',
            ]);

            $shipment->update([
                'carrier_code' => self::CARRIER_CODE,
                'carrier_name' => $shipment->carrier_name ?: 'Viettel Post',
                'carrier_status_raw' => $vtpStatus,
                'carrier_status_mapped' => 'returned',
                'carrier_status_code' => $vtpStatus,
                'carrier_status_text' => $vtpStatus,
                'status' => 'returned',
                'shipment_status' => 'returned',
                'return_status' => $newReturnStatus,
                'reconciliation_status' => $recStatus,
                'reconciled_amount' => -$returnCost,
                'reconciliation_diff_amount' => -$returnCost,
                'reconciled_at' => now(),
                'last_reconciled_at' => now(),
                'returned_at' => $shipment->returned_at ?: now(),
                'last_synced_at' => now(),
            ]);

            if ($order && !in_array($order->return_status, ['exchanged', 'partial_returned', 'returned'], true)) {
                $order->update(['return_status' => $newReturnStatus]);
            }

            $this->syncService->syncOrderFromShipment($shipment->fresh(), 'viettelpost_reconcile', $userId);

            return [
                'status' => $returnType === 'exchange' ? 'return_exchange' : 'return_partial',
                'return_type' => $returnType,
                'return_code' => $fullReturnCode,
                'base_code' => $baseCode,
                'shipment_id' => $shipment->id,
                'shipment_number' => $shipment->shipment_number,
                'return_cost' => $returnCost,
                'message' => "Chi phí {$typeLabel} vào VĐ gốc {$baseCode}: " . number_format($returnCost) . 'đ.',
            ];
        });
    }
}
