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
                    if (str_contains($cellLower, 'mã đơn hàng') || str_contains($cellLower, 'mã vận đơn')) {
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
            
            // Map header names to indices
            $headerMap = [];
            foreach ($headerRow as $i => $h) {
                $cleanHeader = mb_strtolower(str_replace([' ', '_', '(', ')', '*', ' ', "\xC2\xA0"], '', trim((string)$h)), 'UTF-8');
                $headerMap[$cleanHeader] = $i;
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
                $orderNumber = $this->findInRow($row, $headerMap, ['madonhang', 'ordercode', 'madonhangkhach', 'reference', 'mãđơnhàng', 'mãđơnhàngkhách']);
                $trackingNumber = $this->findInRow($row, $headerMap, ['mabưuphẩm', 'mavandon', 'mavandonvtp', 'trackingnumber', 'mabuguithanhcong', 'mãvậnđơn', 'mãbưuphẩm']);
                $shippingFee = (float)$this->findInRow($row, $headerMap, ['tongcuoc', 'moneytotal', 'cuocphi', 'cuoc_tong', 'tổngcước', 'tổngtiềncước'], 0);

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
            if (isset($headerMap[$key])) {
                $idx = $headerMap[$key];
                return isset($row[$idx]) ? trim((string)$row[$idx]) : $default;
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
                    'carrier_code' => 'viettelpost',
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
                // If shipment exists, only update if it DOESN'T have a tracking number yet
                if (empty($shipment->tracking_number)) {
                    $shipment->update([
                        'tracking_number' => $trackingNumber,
                        'carrier_tracking_code' => $trackingNumber,
                        'shipping_cost' => $shippingFee,
                        'actual_received_amount' => $shipment->cod_amount - $shippingFee,
                    ]);
                } else {
                    // Skip if tracking number is already set
                    return;
                }
            }

            // Sync back to order
            $order->update([
                'shipping_status' => 'confirmed',
                'shipping_tracking_code' => $trackingNumber,
                'shipping_dispatched_at' => now(),
            ]);
        });
    }
}
