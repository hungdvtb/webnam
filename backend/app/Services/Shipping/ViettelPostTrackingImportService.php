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
            $data = $this->xlsxService->read($filePath);
            $rows = $data['rows'];
            
            if (empty($rows)) {
                return ['success' => false, 'message' => 'File Excel không có dữ liệu.'];
            }

            $summary = [
                'total_rows' => count($rows),
                'success' => 0,
                'failed' => 0,
                'not_found' => 0,
                'errors' => [],
            ];

            foreach ($rows as $index => $row) {
                // Normalize keys
                $normalizedRow = [];
                foreach ($row as $key => $value) {
                    $cleanKey = strtolower(str_replace([' ', '_', '(', ')', '*'], '', (string)$key));
                    $normalizedRow[$cleanKey] = $value;
                }

                // Identify columns
                $orderNumber = $this->findValue($normalizedRow, ['madonhang', 'ordercode', 'madonhangkhach', 'reference']);
                $trackingNumber = $this->findValue($normalizedRow, ['mabưuphẩm', 'mavandon', 'mavandonvtp', 'trackingnumber', 'mabuguithanhcong']);
                $shippingFee = (float)$this->findValue($normalizedRow, ['tongcuoc', 'moneytotal', 'cuocphi', 'cuoc_tong'], 0);

                if (!$orderNumber) {
                    $summary['failed']++;
                    $summary['errors'][] = "Dòng " . ($index + 2) . ": Không tìm thấy cột Mã đơn hàng.";
                    continue;
                }

                if (!$trackingNumber) {
                    // Skip if no tracking number assigned yet
                    continue;
                }

                $order = Order::where('order_number', $orderNumber)->first();
                if (!$order) {
                    $summary['not_found']++;
                    $summary['errors'][] = "Dòng " . ($index + 2) . ": Không tìm thấy đơn hàng #{$orderNumber} trên hệ thống.";
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

    private function findValue(array $row, array $keys, $default = null)
    {
        foreach ($keys as $key) {
            if (isset($row[$key])) return $row[$key];
        }
        return $default;
    }
}
