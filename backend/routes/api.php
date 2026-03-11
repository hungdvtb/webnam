<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CartController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ProductGroupController;
use App\Http\Controllers\Api\ProductImageController;
use App\Http\Controllers\Api\AIController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/* |-------------------------------------------------------------------------- | API Routes |-------------------------------------------------------------------------- */

// Public routes
Route::post('/register', [AuthController::class , 'register']);
Route::post('/login', [AuthController::class , 'login']);

Route::get('/products', [ProductController::class , 'index']);
Route::get('/products/{id}', [ProductController::class , 'show']);

Route::get('/categories', [CategoryController::class , 'index']);
Route::get('/categories/{id}', [CategoryController::class , 'show']);

Route::get('/product-groups', [ProductGroupController::class , 'index']);
Route::get('/product-groups/{id}', [ProductGroupController::class , 'show']);

Route::get('/blog', [\App\Http\Controllers\Api\BlogController::class , 'index']);
Route::get('/blog/{id}', [\App\Http\Controllers\Api\BlogController::class , 'show']);

// Public account resolution by site_code (for frontend)
Route::get('/accounts/resolve/{code}', [\App\Http\Controllers\AccountController::class , 'resolveBySiteCode']);

Route::get('/banners', [\App\Http\Controllers\Api\BannerController::class , 'index']);
Route::get('/site-settings', [\App\Http\Controllers\Api\SiteSettingController::class , 'index']);
Route::get('/menus/code/{code}', [\App\Http\Controllers\Api\MenuController::class , 'getByCode']);
Route::get('/menus/active', [\App\Http\Controllers\Api\MenuController::class , 'getActive']);
Route::get('/thumbnail', [ProductImageController::class , 'thumbnail']);


// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [AuthController::class , 'user']);
    Route::post('/logout', [AuthController::class , 'logout']);

    // Cart routes
    Route::get('/cart', [CartController::class , 'index']);
    Route::post('/cart/add', [CartController::class , 'add']);
    Route::post('/cart/update', [CartController::class , 'update']);
    Route::post('/cart/remove', [CartController::class , 'remove']);

    // Order routes
    Route::get('/orders', [OrderController::class , 'index']);
    Route::get('/orders/{id}', [OrderController::class , 'show']);
    Route::post('/orders', [OrderController::class , 'store']);

    // Admin Product routes
    Route::post('/products', [ProductController::class , 'store']);
    Route::post('/products/{id}/duplicate', [ProductController::class , 'duplicate']);
    Route::post('/products/{id}', [ProductController::class , 'update']); // Use POST for update to handle file uploads
    Route::delete('/products/{id}', [ProductController::class , 'destroy']);

    // Admin Product Image routes
    Route::post('/products/{id}/images', [ProductImageController::class , 'store']);
    Route::post('/product-images/reorder', [ProductImageController::class , 'reorder']);
    Route::post('/product-images/{id}/primary', [ProductImageController::class , 'setPrimary']);
    Route::delete('/product-images/{id}', [ProductImageController::class , 'destroy']);

    // Admin Category routes
    Route::post('/categories', [CategoryController::class , 'store']);
    Route::put('/categories/{id}', [CategoryController::class , 'update']);
    Route::delete('/categories/{id}', [CategoryController::class , 'destroy']);
    Route::post('/categories/reorder', [CategoryController::class , 'reorder']);

    // Admin Attribute routes
    Route::get('/attributes', [\App\Http\Controllers\AttributeController::class , 'index']); // Move here or public? Admin is fine
    Route::post('/attributes', [\App\Http\Controllers\AttributeController::class , 'store']);
    Route::get('/attributes/{id}', [\App\Http\Controllers\AttributeController::class , 'show']);
    Route::put('/attributes/{id}', [\App\Http\Controllers\AttributeController::class , 'update']);
    Route::delete('/attributes/{id}', [\App\Http\Controllers\AttributeController::class , 'destroy']);

    // Admin Account routes
    Route::post('/accounts/with-user', [\App\Http\Controllers\AccountController::class , 'storeWithUser']);
    Route::get('/accounts', [\App\Http\Controllers\AccountController::class , 'index']);
    Route::post('/accounts', [\App\Http\Controllers\AccountController::class , 'store']);
    Route::get('/accounts/{id}', [\App\Http\Controllers\AccountController::class , 'show']);
    Route::put('/accounts/{id}', [\App\Http\Controllers\AccountController::class , 'update']);
    Route::delete('/accounts/{id}', [\App\Http\Controllers\AccountController::class , 'destroy']);

    // Admin User routes
    Route::get('/users', [\App\Http\Controllers\Api\UserController::class , 'index']);
    Route::post('/users', [\App\Http\Controllers\Api\UserController::class , 'store']);
    Route::put('/users/{id}', [\App\Http\Controllers\Api\UserController::class , 'update']);
    Route::delete('/users/{id}', [\App\Http\Controllers\Api\UserController::class , 'destroy']);

    // Logistics routes
    Route::get('/warehouses', [App\Http\Controllers\Api\WarehouseController::class , 'index']);
    Route::post('/warehouses', [App\Http\Controllers\Api\WarehouseController::class , 'store']);
    Route::get('/warehouses/{id}', [App\Http\Controllers\Api\WarehouseController::class , 'show']);
    Route::put('/warehouses/{id}', [App\Http\Controllers\Api\WarehouseController::class , 'update']);
    Route::delete('/warehouses/{id}', [App\Http\Controllers\Api\WarehouseController::class , 'destroy']);
    Route::get('/warehouses/{id}/inventory', [App\Http\Controllers\Api\WarehouseController::class , 'getInventory']);
    Route::post('/warehouses/{id}/inventory', [App\Http\Controllers\Api\WarehouseController::class , 'updateInventory']);

    // Order management
    Route::get('/orders', [\App\Http\Controllers\Api\OrderController::class , 'index']);
    Route::post('/orders', [\App\Http\Controllers\Api\OrderController::class , 'store']);
    Route::get('/orders/{id}', [\App\Http\Controllers\Api\OrderController::class , 'show']);
    Route::put('/orders/{id}/status', [\App\Http\Controllers\Api\OrderController::class , 'updateStatus']);
    Route::put('/orders/{id}', [\App\Http\Controllers\Api\OrderController::class , 'update']);
    Route::delete('/orders/{id}', [\App\Http\Controllers\Api\OrderController::class , 'destroy']);
    Route::post('/orders/{id}/duplicate', [\App\Http\Controllers\Api\OrderController::class , 'duplicate']);
    Route::post('/orders/{id}/restore', [\App\Http\Controllers\Api\OrderController::class , 'restore']);
    Route::post('/orders/bulk-update', [\App\Http\Controllers\Api\OrderController::class , 'bulkUpdate']);
    Route::post('/orders/bulk-delete', [\App\Http\Controllers\Api\OrderController::class , 'bulkDelete']);
    Route::post('/orders/bulk-restore', [\App\Http\Controllers\Api\OrderController::class , 'bulkRestore']);
    Route::post('/orders/bulk-duplicate', [\App\Http\Controllers\Api\OrderController::class , 'bulkDuplicate']);

    // Order Statuses
    Route::get('/order-statuses', [\App\Http\Controllers\Api\OrderStatusController::class , 'index']);
    Route::post('/order-statuses/reorder', [\App\Http\Controllers\Api\OrderStatusController::class , 'reorder']);
    Route::post('/order-statuses', [\App\Http\Controllers\Api\OrderStatusController::class , 'store']);
    Route::get('/order-statuses/{orderStatus}', [\App\Http\Controllers\Api\OrderStatusController::class , 'show']);
    Route::put('/order-statuses/{orderStatus}', [\App\Http\Controllers\Api\OrderStatusController::class , 'update']);
    Route::delete('/order-statuses/{orderStatus}', [\App\Http\Controllers\Api\OrderStatusController::class , 'destroy']);

    // Carrier Status Mappings
    Route::get('/carrier-mappings', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'index']);
    Route::post('/carrier-mappings', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'store']);
    Route::put('/carrier-mappings/{id}', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'update']);
    Route::delete('/carrier-mappings/{id}', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'destroy']);
    Route::post('/carrier-mappings/carriers/reorder', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'updateCarriersSort']);
    Route::post('/carrier-mappings/carriers/{code}/toggle-visibility', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'toggleCarrierVisibility']);
    Route::put('/carrier-mappings/carriers/{code}', [\App\Http\Controllers\Api\CarrierStatusMappingController::class , 'updateCarrier']);

    // Customer management
    Route::get('/customers', [\App\Http\Controllers\Api\CustomerController::class , 'index']);
    Route::post('/customers', [\App\Http\Controllers\Api\CustomerController::class , 'store']);
    Route::get('/customers/{id}', [\App\Http\Controllers\Api\CustomerController::class , 'show']);
    Route::put('/customers/{id}', [\App\Http\Controllers\Api\CustomerController::class , 'update']);
    Route::delete('/customers/{id}', [\App\Http\Controllers\Api\CustomerController::class , 'destroy']);

    // Leads / Khách liên hệ tư vấn
    Route::get('/leads', [\App\Http\Controllers\Api\LeadController::class , 'index']);
    Route::put('/leads/{id}', [\App\Http\Controllers\Api\LeadController::class , 'update']);
    Route::delete('/leads/{id}', [\App\Http\Controllers\Api\LeadController::class , 'destroy']);


    // Inventory & Logistics expansion
    Route::get('/stock-movements', [\App\Http\Controllers\Api\StockMovementController::class , 'index']);
    Route::post('/stock-movements', [\App\Http\Controllers\Api\StockMovementController::class , 'store']);

    Route::get('/stock-transfers', [\App\Http\Controllers\Api\StockTransferController::class , 'index']);
    Route::post('/stock-transfers', [\App\Http\Controllers\Api\StockTransferController::class , 'store']);
    Route::post('/stock-transfers/{id}/complete', [\App\Http\Controllers\Api\StockTransferController::class , 'complete']);

    // Shipment management
    Route::get('/shipments', [\App\Http\Controllers\Api\ShipmentController::class , 'index']);
    Route::get('/shipments/stats', [\App\Http\Controllers\Api\ShipmentController::class , 'stats']);
    Route::get('/shipments/carriers', [\App\Http\Controllers\Api\ShipmentController::class , 'carriers']);
    Route::post('/shipments', [\App\Http\Controllers\Api\ShipmentController::class , 'store']);
    Route::get('/shipments/{id}', [\App\Http\Controllers\Api\ShipmentController::class , 'show']);
    Route::put('/shipments/{id}', [\App\Http\Controllers\Api\ShipmentController::class , 'update']);
    Route::put('/shipments/{id}/status', [\App\Http\Controllers\Api\ShipmentController::class , 'updateStatus']);
    Route::post('/shipments/{id}/notes', [\App\Http\Controllers\Api\ShipmentController::class , 'addNote']);
    Route::post('/shipments/{id}/reconcile', [\App\Http\Controllers\Api\ShipmentController::class , 'markReconciled']);
    Route::post('/shipments/{id}/restore', [\App\Http\Controllers\Api\ShipmentController::class , 'restore']);
    Route::delete('/shipments/{id}', [\App\Http\Controllers\Api\ShipmentController::class , 'destroy']);
    Route::post('/shipments/bulk-status', [\App\Http\Controllers\Api\ShipmentController::class , 'bulkUpdateStatus']);
    Route::post('/shipments/carrier-callback', [\App\Http\Controllers\Api\ShipmentController::class , 'processCarrierCallback']);

    // Order shipping status check
    Route::get('/orders/{id}/shipping-lock', function ($id) {
            $order = \App\Models\Order::findOrFail($id);
            $syncService = app(\App\Services\Shipping\ShipmentStatusSyncService::class);
            return response()->json($syncService->canManuallyEditOrderShipping($order));
        }
        );

        // Promotions & Marketing
        Route::get('/coupons', [\App\Http\Controllers\Api\CouponController::class , 'index']);
        Route::post('/coupons', [\App\Http\Controllers\Api\CouponController::class , 'store']);
        Route::post('/coupons/validate', [\App\Http\Controllers\Api\CouponController::class , 'validate']);

        // Reviews (Public can read, Auth can post)
        Route::post('/products/{productId}/reviews', [\App\Http\Controllers\Api\ReviewController::class , 'store']);

        // Wishlist
        Route::get('/wishlist', [\App\Http\Controllers\Api\WishlistController::class , 'index']);
        Route::post('/wishlist/toggle/{productId}', [\App\Http\Controllers\Api\WishlistController::class , 'toggle']);

        // Blog Management (Protected)
        Route::post('/blog', [\App\Http\Controllers\Api\BlogController::class , 'store']);
        Route::put('/blog/{id}', [\App\Http\Controllers\Api\BlogController::class , 'update']);
        Route::delete('/blog/{id}', [\App\Http\Controllers\Api\BlogController::class , 'destroy']);

        // CMS (Banners & Settings)
        Route::post('/banners', [\App\Http\Controllers\Api\BannerController::class , 'store']);
        Route::get('/banners/{id}', [\App\Http\Controllers\Api\BannerController::class , 'show']);
        Route::put('/banners/{id}', [\App\Http\Controllers\Api\BannerController::class , 'update']);
        Route::delete('/banners/{id}', [\App\Http\Controllers\Api\BannerController::class , 'destroy']);
        Route::post('/site-settings', [\App\Http\Controllers\Api\SiteSettingController::class , 'store']);

        // Menus
        Route::get('/menus', [\App\Http\Controllers\Api\MenuController::class , 'index']);
        Route::get('/menus/{id}', [\App\Http\Controllers\Api\MenuController::class , 'show']);
        Route::post('/menus', [\App\Http\Controllers\Api\MenuController::class , 'store']);
        Route::put('/menus/{id}', [\App\Http\Controllers\Api\MenuController::class , 'update']);
        Route::delete('/menus/{id}', [\App\Http\Controllers\Api\MenuController::class , 'destroy']);
        Route::post('/menus/{id}/items', [\App\Http\Controllers\Api\MenuController::class , 'saveItems']);

        // Reports
        Route::get('/reports/dashboard', [\App\Http\Controllers\Api\ReportController::class , 'dashboardSummary']);
        Route::get('/reports/inventory', [\App\Http\Controllers\Api\ReportController::class , 'inventoryReport']);
        Route::get('/reports/top-products', [\App\Http\Controllers\Api\ReportController::class , 'topSellingProducts']);
        Route::get('/reports/sales', [\App\Http\Controllers\Api\ReportController::class , 'salesReport']);

        // Invoices
        Route::get('/invoices', [\App\Http\Controllers\Api\InvoiceController::class , 'index']);
        Route::get('/invoices/{id}', [\App\Http\Controllers\Api\InvoiceController::class , 'show']);
        Route::post('/invoices/{id}/paid', [\App\Http\Controllers\Api\InvoiceController::class , 'markAsPaid']);

        // Admin Review Management
        Route::get('/admin/reviews', [\App\Http\Controllers\Api\ReviewController::class , 'adminIndex']);
        Route::post('/admin/reviews/{id}/approve', [\App\Http\Controllers\Api\ReviewController::class , 'approve']);

        // Admin AI Tools
        Route::post('/ai/generate-product-description', [AIController::class , 'generateProductDescription']);    });

// Public Routes for Reviews (Reading)
Route::get('/products/{productId}/reviews', [\App\Http\Controllers\Api\ReviewController::class , 'index']);

// Public AI Chat Routes
Route::post('/ai/chat', [AIController::class , 'chat']);
Route::get('/ai/history/{chat_id}', [AIController::class , 'getHistory']);

// ─── Storefront Public API (Website bán hàng) ───
Route::prefix('storefront')->group(function () {
    Route::get('/homepage', [\App\Http\Controllers\Api\StorefrontController::class , 'homepage']);
    Route::get('/categories', [\App\Http\Controllers\Api\StorefrontController::class , 'categories']);
    Route::get('/products', [\App\Http\Controllers\Api\StorefrontController::class , 'products']);
    Route::get('/products/{slugOrId}', [\App\Http\Controllers\Api\StorefrontController::class , 'productDetail']);
    Route::get('/products/{id}/related', [\App\Http\Controllers\Api\StorefrontController::class , 'relatedProducts']);
    Route::post('/order', [\App\Http\Controllers\Api\StorefrontController::class , 'placeOrder']);
    Route::post('/lead', [\App\Http\Controllers\Api\StorefrontController::class , 'submitLead']);
});
