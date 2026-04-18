<?php

namespace App\Services\Shipping;

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
     * Process Viettel Post Reconciliation Excel file
     *
     * @param string $filePath Absolute path to the excel file
     * @param int $userId ID of the user performing reconciliation
     * @return array Summary of the process
     */
    public function processFile(string $filePath, int $userId): array
    {
        try {
            $data = $this->xlsxService->read($filePath);
            $rows = $data['rows'];
            
            if (empty($rows)) {
                return [
                    'success' => false,
                    'message' => 'File Excel không có dữ liệu hoặc sai định dạng.',
                ];
            }

            $summary = [
                'total_rows' => count($rows),
                'matched' => 0,
                'not_found' => 0,
                'mismatch' => 0,
                'reconciled' => 0,
                'errors' => [],
                'results' => [],
            ];

            foreach ($rows as $index => $row) {
                $processedRow = $this->processRow($row, $userId);
                
                if ($processedRow['status'] === 'not_found') {
                    $summary['not_found']++;
                } elseif ($processedRow['status'] === 'error') {
                    $summary['errors'][] = "Dòng " . ($index + 2) . ": " . $processedRow['message'];
                } else {
                    $summary['matched']++;
                    if ($processedRow['reconciliation_status'] === 'reconciled') {
                        $summary['reconciled']++;
                    } else {
                        $summary['mismatch']++;
                    }
                }
                
                $summary['results'][] = $processedRow;
            }

            return [
                'success' => true,
                'summary' => $summary,
            ];

        } catch (\Exception $e) {
            Log::error("VTP Reconciliation Error: " . $e->getMessage());
            return [
                'success' => false,
                'message' => 'Lỗi xử lý file: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Parse a single row and update shipment
     */
    private function processRow(array $row, int $userId): array
    {
        // Normalize column keys (lowercase and remove spaces/underscores)
        $normalizedRow = [];
        foreach ($row as $key => $value) {
            $cleanKey = strtolower(str_replace([' ', '_'], '', (string)$key));
            $normalizedRow[$cleanKey] = $value;
        }

        // Potential column mappings for Viettel Post
        $trackingCode = $this->findValue($normalizedRow, ['mavandon', 'maphieugui', 'trackingnumber', 'mabưuphẩm']);
        $orderCode = $this->findValue($normalizedRow, ['madonhang', 'madonhangkhach', 'reference', 'ma_don_hang']);
        $codAmount = (float) $this->findValue($normalizedRow, ['moneycollection', 'tienthuho', 'cod', 'tien_thu_ho'], 0);
        $shippingFee = (float) $this->findValue($normalizedRow, ['moneytotal', 'tongcuoc', 'tongphi', 'cuoc_tong'], 0);
        $transferAmount = (float) $this->findValue($normalizedRow, ['tienthuctra', 'thucnhan', 'thuctra', 'tien_thuc_nhan'], 0);

        if (!$trackingCode && !$orderCode) {
            return [
                'status' => 'error',
                'message' => 'Không tìm thấy cột Mã vận đơn hoặc Mã đơn hàng.',
            ];
        }

        // Find shipment
        $shipment = Shipment::query()
            ->where(function ($q) use ($trackingCode, $orderCode) {
                if ($trackingCode) {
                    $q->where('tracking_number', $trackingCode)
                      ->orWhere('carrier_tracking_code', $trackingCode);
                }
                if ($orderCode) {
                    $q->orWhere('order_code', $orderCode)
                      ->orWhere('shipment_number', $orderCode);
                }
            })
            ->first();

        // If shipment not found, try to find order and auto-create shipment
        if (!$shipment && $orderCode) {
            $order = \App\Models\Order::where('order_number', $orderCode)->first();
            if ($order) {
                $shipment = $this->autoCreateShipmentFromOrder($order, $trackingCode, $codAmount, $shippingFee, $userId);
            }
        }

        if (!$shipment) {
            return [
                'status' => 'not_found',
                'tracking_code' => $trackingCode,
                'order_code' => $orderCode,
                'message' => 'Không tìm thấy vận đơn hoặc đơn hàng tương ứng trên hệ thống.',
            ];
        }

        return DB::transaction(function () use ($shipment, $codAmount, $shippingFee, $transferAmount, $userId, $trackingCode) {
            $expected = $shipment->actual_received_amount;
            $diff = $transferAmount - $expected;
            $reconciliationStatus = abs($diff) < 10 ? 'reconciled' : 'mismatch'; // Tolerance 10 VND

            // Update shipment
            $shipment->update([
                'reconciled_amount' => $transferAmount,
                'actual_received_amount' => $transferAmount, // Update to actual if confirmed
                'reconciliation_diff_amount' => $diff,
                'reconciliation_status' => $reconciliationStatus,
                'reconciled_at' => now(),
                'last_reconciled_at' => now(),
            ]);

            // Create reconciliation history
            ShipmentReconciliation::create([
                'shipment_id' => $shipment->id,
                'carrier_code' => $shipment->carrier_code ?: 'viettelpost',
                'cod_amount' => $codAmount,
                'shipping_fee' => $shippingFee,
                'service_fee' => 0, // VTP money_total usually includes fees
                'actual_received_amount' => $transferAmount,
                'system_expected_amount' => $expected,
                'diff_amount' => $diff,
                'status' => $reconciliationStatus,
                'reconciled_by' => $userId,
                'reconciled_at' => now(),
                'note' => "Đối soát tự động từ file Excel. Mã VĐ file: {$trackingCode}",
            ]);

            return [
                'status' => 'success',
                'shipment_id' => $shipment->id,
                'shipment_number' => $shipment->shipment_number,
                'reconciliation_status' => $reconciliationStatus,
                'diff' => $diff,
            ];
        });
    }

    /**
     * Auto-create a shipment record for an order that was exported but not yet officially dispatched
     */
    private function autoCreateShipmentFromOrder(\App\Models\Order $order, ?string $trackingCode, float $codAmount, float $shippingFee, int $userId): Shipment
    {
        // Generate shipment number
        $today = now()->format('Ymd');
        $count = Shipment::withTrashed()->whereDate('created_at', today())->count() + 1;
        $shipmentNumber = 'VD-' . $today . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);

        $shipment = Shipment::create([
            'order_id' => $order->id,
            'order_code' => $order->order_number,
            'shipment_number' => $shipmentNumber,
            'tracking_number' => $trackingCode,
            'carrier_code' => 'viettelpost',
            'carrier_name' => 'Viettel Post',
            'carrier_tracking_code' => $trackingCode,
            'channel' => 'automatic_reconciliation',
            'customer_id' => $order->customer_id,
            'customer_name' => $order->customer_name,
            'customer_phone' => $order->customer_phone,
            'customer_address' => $order->shipping_address,
            'status' => 'delivered', // Assume delivered if reconciled
            'shipment_status' => 'delivered',
            'cod_amount' => $codAmount,
            'shipping_cost' => $shippingFee,
            'actual_received_amount' => $codAmount - $shippingFee,
            'created_by' => $userId,
        ]);

        // Sync order status
        $order->update([
            'shipping_status' => 'delivered',
            'shipping_tracking_code' => $trackingCode,
        ]);

        return $shipment;
    }

    /**
     * Helper to find value from multiple possible keys
     */
    private function findValue(array $row, array $keys, $default = null)
    {
        foreach ($keys as $key) {
            $cleanKey = strtolower(str_replace([' ', '_'], '', $key));
            if (isset($row[$cleanKey])) {
                return $row[$cleanKey];
            }
        }
        return $default;
    }
}
