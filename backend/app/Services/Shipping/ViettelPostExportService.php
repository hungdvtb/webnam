<?php

namespace App\Services\Shipping;

use App\Models\Order;
use App\Services\SimpleXlsxService;
use Illuminate\Support\Collection;

class ViettelPostExportService
{
    private const DATA_START_ROW_NUMBER = 7;
    private const NUMERIC_COLUMN_INDEXES = [
        0,  // STT
        6,  // Số lượng
        7,  // Trọng lượng
        8,  // Giá trị hàng
        9,  // COD
        15, // Dài
        16, // Rộng
        17, // Cao
    ];

    // ViettelPost Excel template constants
    private const HEADER_ROW_TITLE = [
        '', '', '', 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    ];
    private const HEADER_ROW_COMPANY = [
        '', '', '', 'TỔNG CÔNG TY CỔ PHẦN BƯU CHÍNH VIETTEL', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    ];
    private const HEADER_ROW_TITLE2 = [
        '', '', '', '', '', 'DANH SÁCH ĐƠN HÀNG', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    ];
    private const HEADER_ROW_NOTE = [
        '(*) là các trường bắt buộc nhập',
    ];
    private const HEADER_ROW_COLUMNS = [
        'STT',
        'Mã đơn hàng ',
        'Tên người nhận (*)',
        'Số ĐT người nhận (*)',
        'Địa chỉ nhận (*)',
        'Tên hàng hóa (*)',
        'Số lượng',
        'Trọng lượng (gram)  (*)',
        'Giá trị hàng (VND) (*)',
        'Tiền thu hộ COD (VND)',
        'Loại hàng hóa (*)',
        'Tính chất hàng hóa đặc biệt',
        'Dịch vụ  (*)',
        'Dịch vụ cộng thêm ',
        'Thu tiền xem hàng',
        'Dài (cm)',
        'Rộng (cm)',
        'Cao (cm)',
        'Người trả cước',
        'Yêu cầu khác',
        'Thời gian hẹn lấy',
        'Thời gian giao',
    ];

    public function __construct(private readonly SimpleXlsxService $xlsx) {}

    /**
     * Export orders to ViettelPost Excel format.
     *
     * @param  Collection<Order>  $orders
     * @param  string  $goodsName  The goods description to put in "Tên hàng hóa"
     * @param  string  $outputPath Full path of output file
     */
    public function export(Collection $orders, string $goodsName, string $outputPath): void
    {
        $rows = [];

        // Header rows to match VTP template
        $rows[] = self::HEADER_ROW_TITLE;
        $rows[] = self::HEADER_ROW_COMPANY;
        $rows[] = array_fill(0, 22, ''); // Empty separator row
        $rows[] = self::HEADER_ROW_TITLE2;
        $rows[] = self::HEADER_ROW_NOTE;
        $rows[] = self::HEADER_ROW_COLUMNS;

        // Data rows
        $stt = 1;
        foreach ($orders as $order) {
            $address = implode(', ', array_filter([
                $order->shipping_address,
                $order->ward,
                $order->district,
                $order->province,
            ]));

            $isExchange = $order->getNormalizedOrderType() === \App\Models\Order::TYPE_EXCHANGE_RETURN 
                && $order->supplementItems()->exists();

            $rows[] = [
                $stt++,                              // STT
                $order->order_number,                 // Mã đơn hàng (Mã hiển thị trên hệ thống)
                $order->customer_name ?? '',          // Tên người nhận
                $order->customer_phone ?? '',         // Số ĐT
                $address,                            // Địa chỉ nhận
                $goodsName ?: 'Gốm sứ dễ vỡ',       // Tên hàng hóa (user-defined)
                1,                                   // Số lượng (always 1 package)
                1000,                                // Trọng lượng - placeholder, user fills in later
                (int) ($order->total_price ?? 0),    // Giá trị hàng
                (int) ($order->total_price ?? 0),    // Tiền thu hộ COD
                'Bưu kiện',                          // Loại hàng hóa - Mặc định là bưu kiện
                '',                                  // Tính chất đặc biệt
                'VBK',                               // Dịch vụ code (VBK = Tiêu chuẩn)
                $isExchange ? 'GGDH' : '',            // Dịch vụ cộng thêm (GGDH = Đổi hàng)
                '',                                  // Thu tiền xem hàng
                '',                                  // Dài - user fills
                '',                                  // Rộng - user fills
                '',                                  // Cao - user fills
                'Người gửi trả',                     // Người trả cước - default
                '',                                  // Yêu cầu khác
                '',                                  // Thời gian hẹn lấy
                '',                                  // Thời gian giao
            ];
        }

        $this->xlsx->writeRaw($outputPath, $rows, 'Danh sach van don', [
            'numeric_columns' => self::NUMERIC_COLUMN_INDEXES,
            'numeric_start_row' => self::DATA_START_ROW_NUMBER,
        ]);
    }
}
