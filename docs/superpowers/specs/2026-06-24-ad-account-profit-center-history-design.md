# Phân mảng tài khoản quảng cáo theo ngày hiệu lực

## Mục tiêu

Cho phép chọn nhanh nhiều tài khoản quảng cáo đã cấu hình kết nối và gán chúng vào một mảng lợi nhuận. Một tài khoản có thể đổi mảng theo ngày; chi phí của mỗi ngày phải luôn thuộc mảng có hiệu lực tại ngày đó.

## Quy tắc nghiệp vụ

- Mỗi bản ghi gán gồm nền tảng, ID tài khoản quảng cáo, mảng lợi nhuận, ngày bắt đầu hiệu lực và ngày kết thúc tùy chọn.
- Khi thêm mốc mới cho cùng tài khoản, hệ thống tự chốt mốc đang hiệu lực ngay trước ngày mới. Ví dụ TK3 ở Mảng A từ 01/05, khi gán Mảng B từ 01/06 thì mốc A thành 01/05–31/05.
- Các mốc không được chồng ngày. Ngày chi phí không có mốc hiệu lực thì không được phân vào mảng nào.
- Dữ liệu mapping cũ được coi là hiệu lực từ 01/01/1900 để giữ nguyên cách tính lịch sử hiện tại cho đến khi người dùng khai báo mốc chính xác hơn.
- Khi lưu mốc, các dòng chi phí quảng cáo đã đồng bộ của đúng tài khoản và đúng khoảng ngày được cập nhật lại `profit_center_id`; báo cáo lọc theo mảng sẽ dùng giá trị theo ngày này.

## Trải nghiệm quản trị

- API trả về danh sách tài khoản đã kết nối từ cấu hình Facebook/Google, hợp nhất với các tài khoản đã có lịch sử mapping.
- Khối “Gán nhanh” cho phép lọc nền tảng, tìm ID/tên, tick nhiều tài khoản, chọn một mảng và ngày hiệu lực rồi thêm các mốc vào danh sách chờ lưu.
- Bảng lịch sử hiển thị từng mốc: nền tảng, ID/tên, mảng, từ ngày, đến ngày và trạng thái. Mốc hiện tại có nhãn “Đang áp dụng”.
- Nút lưu không xóa các mốc lịch sử không xuất hiện trong form; nó chỉ tạo hoặc cập nhật mốc có cùng tài khoản và ngày bắt đầu.

## Phạm vi

- Bao gồm Facebook và Google đã có trong cấu hình báo cáo lợi nhuận.
- Bao gồm cập nhật dữ liệu chi phí quảng cáo đã lưu và lọc chi phí trong báo cáo theo `profit_center_id` của từng ngày.
- Không bao gồm chia phần trăm một tài khoản cho nhiều mảng trong cùng một ngày; một tài khoản chỉ thuộc một mảng tại một thời điểm.
