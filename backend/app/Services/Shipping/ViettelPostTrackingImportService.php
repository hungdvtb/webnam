<?php

namespace App\Services\Shipping;

use App\Models\Order;
use App\Models\Shipment;
use App\Models\ShipmentStatusLog;
use App\Services\SimpleXlsxService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ViettelPostTrackingImportService
{
    private const CARRIER_CODE = 'viettel_post';

    private SimpleXlsxService $xlsxService;
    private ShipmentStatusSyncService $syncService;

    public function __construct(SimpleXlsxService $xlsxService, ShipmentStatusSyncService $syncService)
    {
        $this->xlsxService = $xlsxService;
        $this->syncService = $syncService;
    }

    /**
     * Process Viettel Post Result Excel to sync tracking info and create shipments
     */
    public function processFile(string $filePath, int $userId): array
    {
        try {
            $allRows = $this->xlsxService->readRaw($filePath);
            
            if (empty($allRows)) {
                return ['success' => false, 'message' => 'File Excel không có dữ liệu.'];
            }

            // Find the header row (the one containing 'Mã vận đơn' or 'Mã đơn hàng')
            $headerIndex = -1;
            $headerRow = [];
            
            foreach ($allRows as $index => $row) {
                $isHeader = false;
                foreach ($row as $cell) {
                    $cellLower = mb_strtolower(trim((string)$cell));
                    if (str_contains($cellLower, 'mã đơn hàng') || str_contains($cellLower, 'mã vận đơn') || str_contains($cellLower, 'số phiếu gửi')) {
                        $isHeader = true;
                        break;
                    }
                }
                
                if ($isHeader) {
                    $headerIndex = $index;
                    $headerRow = $row;
                    break;
                }
            }

            if ($headerIndex === -1) {
                return ['success' => false, 'message' => 'Không tìm thấy dòng tiêu đề (Mã đơn hàng/Mã vận đơn) trong file Excel.'];
            }

            // Extract data rows (everything after headerIndex)
            $dataRows = array_slice($allRows, $headerIndex + 1);
            
            // Map header names to indices (strip ALL non-letter/non-digit chars)
            $headerMap = [];
            foreach ($headerRow as $i => $h) {
                $cleanHeader = preg_replace('/[^\p{L}\p{N}]/u', '', trim((string)$h));
                $cleanHeader = mb_strtolower($cleanHeader ?? '', 'UTF-8');
                if ($cleanHeader !== '') {
                    $headerMap[$cleanHeader] = $i;
                }
            }

            if (empty($dataRows)) {
                return ['success' => false, 'message' => 'Không tìm thấy dữ liệu đơn hàng bên dưới dòng tiêu đề.'];
            }

            $summary = [
                'total_rows' => count($dataRows),
                'success' => 0,
                'failed' => 0,
                'not_found' => 0,
                'errors' => [],
            ];

            foreach ($dataRows as $index => $row) {
                // Identify values using indices
                // Keys below are post-normalizeKey() form (all non-letter/digit stripped, lowercased)
                // Real file keys confirmed: 'mãvậnđơn'(Col B), 'mãđơnhàng'(Col C),
                // 'tiềnthuhộ4'(Col AA), 'tổngphí935678'(Col AF), 'trạngthái'(Col AG)
                $orderNumber = $this->findInRow($row, $headerMap, [
                    'mãđơnhàng', 'madonhang', 'mãđơnhàngkhách', 'madonhangkhach',
                    'reference', 'madon', 'mãđơn', 'ordercode',
                ]);

                $trackingNumber = $this->findInRow($row, $headerMap, [
                    'mãvậnđơn',   // Col B – confirmed from real file
                    'mavandon', 'mavandonvtp', 'trackingnumber',
                    'mãbưuphẩm', 'mabưuphẩm', 'sophieugui', 'sốphiếugửi',
                ]);

                // Shipping fee: "Tổng phí (9)= (3)+(5)+(6)+(7)-(8)" → 'tổngphí935678'
                $shippingFee = (float)$this->findInRow($row, $headerMap, [
                    'tổngphí935678',    // Col AF – confirmed from real file
                    'tổngphí', 'tongphi',
                    'tổngcước1',        // "Tổng cước (1)" Col W – fallback
                    'tongcuoc', 'moneytotal', 'cuocphi',
                ], 0);

                if (!$orderNumber) {
                    // Skip empty rows
                    if (empty(array_filter($row))) continue;
                    
                    $summary['failed']++;
                    $summary['errors'][] = "Dòng " . ($headerIndex + $index + 2) . ": Không tìm thấy cột Mã đơn hàng.";
                    continue;
                }

                if (!$trackingNumber) {
                    // Skip if no tracking number assigned yet
                    continue;
                }

                $order = Order::where('order_number', $orderNumber)->first();
                if (!$order) {
                    $summary['not_found']++;
                    $summary['errors'][] = "Dòng " . ($headerIndex + $index + 2) . ": Không tìm thấy đơn hàng #{$orderNumber} trên hệ thống.";
                    continue;
                }

                try {
                    $this->syncOrderToShipment($order, $trackingNumber, $shippingFee, $userId);
                    $summary['success']++;
                } catch (\Exception $e) {
                    $summary['failed']++;
                    $summary['errors'][] = "Đơn #{$orderNumber}: " . $e->getMessage();
                }
            }

            return ['success' => true, 'summary' => $summary];
        } catch (\Exception $e) {
            Log::error("VTP Tracking Import Error: " . $e->getMessage());
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    private function findInRow(array $row, array $headerMap, array $keys, $default = null)
    {
        foreach ($keys as $key) {
            // Normalize search key the same way headers are normalized
            $normalizedKey = mb_strtolower(
                preg_replace('/[^\p{L}\p{N}]/u', '', $key) ?? '',
                'UTF-8'
            );
            if (isset($headerMap[$normalizedKey])) {
                $idx = $headerMap[$normalizedKey];
                $val = isset($row[$idx]) ? trim((string)$row[$idx]) : null;
                if ($val !== null && $val !== '') {
                    return $val;
                }
            }
        }
        return $default;
    }

    private function syncOrderToShipment(Order $order, string $trackingNumber, float $shippingFee, int $userId): void
    {
        DB::transaction(function () use ($order, $trackingNumber, $shippingFee, $userId) {
            // Check if shipment already exists
            $shipment = Shipment::where('order_id', $order->id)->first();
            
            if (!$shipment) {
                // Generate shipment number
                $today = now()->format('Ymd');
                $count = Shipment::withTrashed()->whereDate('created_at', today())->count() + 1;
                $shipmentNumber = 'VD-' . $today . '-' . str_pad($count, 4, '0', STR_PAD_LEFT);

                $shipment = Shipment::create([
                    'order_id' => $order->id,
                    'order_code' => $order->order_number,
                    'shipment_number' => $shipmentNumber,
                    'tracking_number' => $trackingNumber,
                    'carrier_code' => self::CARRIER_CODE,
                    'carrier_name' => 'Viettel Post',
                    'carrier_tracking_code' => $trackingNumber,
                    'channel' => 'vtp_excel_import',
                    'customer_id' => $order->customer_id,
                    'customer_name' => $order->customer_name,
                    'customer_phone' => $order->customer_phone,
                    'customer_address' => $order->shipping_address,
                    'status' => 'waiting_pickup', // Default status after sync
                    'shipment_status' => 'waiting_pickup',
                    'cod_amount' => $order->total_price,
                    'shipping_cost' => $shippingFee,
                    'actual_received_amount' => $order->total_price - $shippingFee,
                    'created_by' => $userId,
                ]);

                ShipmentStatusLog::create([
                    'shipment_id' => $shipment->id,
                    'from_status' => null,
                    'to_status' => 'waiting_pickup',
                    'changed_by' => $userId,
                    'change_source' => 'vtp_import',
                    'reason' => 'Khởi tạo từ file Excel kết quả VTP'
                ]);
            } else {
                // If shipment exists, update it
                $shipmentData = [
                    'carrier_code' => self::CARRIER_CODE,
                    'carrier_name' => $shipment->carrier_name ?: 'Viettel Post',
                    'shipping_cost' => $shippingFee,
                    'actual_received_amount' => $shipment->cod_amount - $shippingFee,
                ];

                if (empty($shipment->tracking_number)) {
                    $shipmentData['tracking_number'] = $trackingNumber;
                    $shipmentData['carrier_tracking_code'] = $trackingNumber;
                }

                $shipment->update($shipmentData);
            }

            // Sync back to order
            $order->update([
                'status' => 'shipping',
                'shipping_status' => 'confirmed',
                'shipping_tracking_code' => $trackingNumber,
                'shipping_fee' => $shippingFee,
                'internal_shipping_fee' => $shippingFee,
                'shipping_dispatched_at' => now(),
            ]);
        });
    }
}
