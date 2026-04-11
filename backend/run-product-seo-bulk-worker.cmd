@echo off
setlocal
cd /d "%~dp0"
echo [INFO] Khoi dong Tien trinh chay nen SEO AI (Worker)...
echo [INFO] Su dung PHP 8.4 tai: C:\xampp\htdocs\webnam\php84\php.exe
echo [INFO] Worker dang chay, vui long KHONG TAT cua so nay. Thu nho (Minimize) xuong taskbar!
echo =========================================================================

"C:\xampp\htdocs\webnam\php84\php.exe" artisan product-seo-bulk:work --stop-when-empty
echo [INFO] Da chay xong cac tien trinh hien co! Cua so nay se tu dong dong.
timeout /t 5

