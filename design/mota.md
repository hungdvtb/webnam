Dưới đây là **prompt hoàn chỉnh** để bạn dùng cho Antigravity (hoặc AI generate system design/code). Mình đã tổng hợp các ý bạn đưa ra: website bán đồ gốm, đã có design sẵn, BE Laravel, FE React, ảnh lưu S3, có product group cho phép bỏ bớt sản phẩm khi mua.

---

## 📌 PROMPT CHO ANTIGRAVITY

Tôi cần xây dựng một **website bán đồ gốm** (ceramic e-commerce website).
Đã có sẵn UI/UX design (chỉ cần implement theo design).

### 🏗 Tech stack:

* Backend: Laravel (RESTful API)
* Frontend: React
* Database: MySQL
* Storage: Amazon S3 (lưu ảnh sản phẩm)
* Authentication: JWT hoặc Laravel Sanctum

---

# 🎯 Mô tả nghiệp vụ chính

1. Website bán đồ gốm thủ công.
2. Có sản phẩm đơn lẻ.
3. Có sản phẩm dạng **Group (Combo)**:

   * Group là tập hợp nhiều sản phẩm con.
   * Khi khách mua group, có thể:

     * Bỏ bớt một số sản phẩm con
     * Hoặc thay đổi số lượng từng sản phẩm con
4. Giá của group:

   * Có thể là giá cố định
   * Hoặc tính lại theo các sản phẩm còn lại sau khi bỏ bớt
5. Ảnh sản phẩm lưu trên S3.
6. Có trang admin để quản lý.

---

# 🖥 FRONTEND (React) – Các chức năng cần có

## 1. Trang khách hàng

### Trang chính

* Trang chủ
* Trang danh mục
* Trang chi tiết sản phẩm
* Trang chi tiết group sản phẩm
* Tìm kiếm sản phẩm
* Lọc theo:

  * Giá
  * Danh mục
  * Sản phẩm nổi bật

### Chi tiết sản phẩm

* Ảnh (load từ S3)
* Gallery nhiều ảnh
* Mô tả
* Giá
* Thêm vào giỏ hàng
* Số lượng

### Chi tiết Product Group

* Hiển thị danh sách sản phẩm con
* Checkbox hoặc button để bỏ bớt sản phẩm
* Cho phép chỉnh số lượng từng sản phẩm con
* Tính lại tổng tiền realtime

### Giỏ hàng

* Sửa số lượng
* Xóa sản phẩm
* Xử lý group và sản phẩm đơn lẻ
* Tính tổng tiền

### Thanh toán

* Form thông tin khách hàng
* Chọn phương thức thanh toán
* Tạo đơn hàng

### Tài khoản người dùng

* Đăng ký
* Đăng nhập
* Quên mật khẩu
* Lịch sử đơn hàng
* Chi tiết đơn hàng

---

# 🛠 ADMIN (Laravel + React Admin)

## 1. Dashboard

* Tổng số đơn hàng
* Doanh thu
* Sản phẩm bán chạy

## 2. Quản lý sản phẩm

* Tạo / sửa / xóa sản phẩm
* Upload ảnh lên S3
* Quản lý nhiều ảnh
* Bật/tắt hiển thị

## 3. Quản lý Product Group

* Tạo group
* Thêm nhiều sản phẩm vào group
* Thiết lập:

  * Giá cố định hoặc
  * Tính theo từng sản phẩm
* Cho phép cấu hình:

  * Sản phẩm nào bắt buộc
  * Sản phẩm nào có thể bỏ

## 4. Quản lý danh mục

* CRUD danh mục
* Phân cấp (category tree)

## 5. Quản lý đơn hàng

* Xem chi tiết
* Cập nhật trạng thái:

  * Pending
  * Paid
  * Shipping
  * Completed
  * Cancelled

## 6. Quản lý người dùng

* Danh sách user
* Phân quyền:

  * Admin
  * Staff
  * Customer

---

# 🗄 Database gợi ý

## Tables:

* users
* roles
* products
* product_images
* categories
* product_groups
* product_group_items
* carts
* cart_items
* orders
* order_items
* payments

---

# ⚙ Backend yêu cầu

* RESTful API
* Validation đầy đủ
* Phân quyền bằng middleware
* Upload ảnh lên S3 qua Laravel filesystem
* Tính toán giá group logic phía backend
* API chuẩn hóa response JSON

---

# 📦 Yêu cầu nâng cao (nếu cần)

* Caching sản phẩm
* SEO friendly URL
* Slug cho sản phẩm
* Soft delete
* Logging
* Rate limit API
* Docker setup
 

 
