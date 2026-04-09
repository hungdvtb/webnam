# SEO Excel Batch Tool

Tool local để đọc file Excel trong thư mục `design/seo`, tự sinh nội dung cho các cột:

- `Thông số kỹ thuật`
- `Mô tả`
- `SEO title`
- `SEO description`
- `SEO keywords`

## Chạy nhanh

Từ thư mục gốc project:

```powershell
.\design\seo\run-seo-batch.cmd
```

## Cấu hình

Sửa file `design/seo/seo-batch.config.json` nếu cần:

- `preferredInputFile`: chỉ định chính xác tên file Excel
- `processLatestFile`: `true` để tự lấy file mới nhất trong thư mục
- `outputMode`: `new` để xuất file mới, `overwrite` để ghi đè file nguồn
- `outputDir`: thư mục xuất file
- `outputFileName`: đặt tên output cố định
- `sheetName`: chỉ định sheet cần xử lý nếu workbook có nhiều sheet

## Output

- File Excel sau xử lý nằm trong `design/seo/output`
- Log nằm trong `design/seo/logs`

## Ghi chú

- Tool giữ nguyên toàn bộ cột cũ, chỉ cập nhật 5 cột SEO yêu cầu.
- Nếu thiếu cột SEO, tool sẽ tự tạo thêm đúng tên cột.
- Mặc định tool dùng engine sinh nội dung local, không bắt buộc API ngoài.
- Phần `llm` trong config được chừa sẵn để mở rộng sau nếu muốn nối model/API.
