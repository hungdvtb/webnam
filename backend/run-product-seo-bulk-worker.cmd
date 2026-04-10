@echo off
setlocal
cd /d "%~dp0"
echo [INFO] Khoi dong Tien trinh chay nen SEO AI (Worker)...
echo [INFO] Su dung PHP 8.4 tai: C:\xampp\htdocs\webnam\php84\php.exe
echo [INFO] Worker dang chay, vui long KHONG TAT cua so nay. Thu nho (Minimize) xuong taskbar!
echo =========================================================================

:loop
"C:\xampp\htdocs\webnam\php84\php.exe" artisan product-seo-bulk:work
echo [WARN] Worker thoat, tu dong khoi dong lai sau 5 giay...
timeout /t 5 /nobreak
goto loop
