<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CartController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\FinanceController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\ProductGroupController;
use App\Http\Controllers\Api\ProductImageController;
use App\Http\Controllers\Api\AIController;
use App\Http\Controllers\Api\MediaController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/* |-------------------------------------------------------------------------- | API Routes |-------------------------------------------------------------------------- */

// Public routes
Route::post('/register', [AuthController::class , 'register']);
Route::post('/login', [AuthController::class , 'login']);

Route::get('/products', [ProductController::class , 'index']);
Route::get('/products/{id}', [ProductController::class , 'show'])->where('id', '[0-9]+');

Route::get('/categories', [CategoryController::class , 'index']);
Route::get('/categories/{id}', [CategoryController::class , 'show']);

Route::get('/product-groups', [ProductGroupController::class , 'index']);
Route::get('/product-groups/{id}', [ProductGroupController::class , 'show']);

Route::get('/blog', [\App\Http\Controllers\Api\BlogController::class , 'index']);
Route::get('/blog/categories', [\App\Http\Controllers\Api\BlogController::class , 'categories']);
Route::get('/blog/import/template', [\App\Http\Controllers\Api\BlogController::class , 'downloadImportTemplate']);
Route::get('/blog/{id}', [\App\Http\Controllers\Api\BlogController::class , 'show']);

// Public account resolution by site_code (for frontend)
Route::get('/accounts/resolve/{code}', [\App\Http\Controllers\AccountController::class , 'resolveBySiteCode']);

Route::get('/banners', [\App\Http\Controllers\Api\BannerController::class , 'index']);
Route::get('/site-settings', [\App\Http\Controllers\Api\SiteSettingController::class , 'index']);
Route::get('/menus/code/{code}', [\App\Http\Controllers\Api\MenuController::class , 'getByCode']);
Route::get('/menus/active', [\App\Http\Controllers\Api\MenuController::class , 'getActive']);
Route::get('/thumbnail', [ProductImageController::class , 'thumbnail']);
Route::get('/media/proxy', [MediaController::class, 'proxy']);
Route::post('/shipments/carriers/viettel-post/webhook', [\App\Http\Controllers\Api\ShipmentController::class, 'processViettelPostWebhook']);


// Protected routes
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [AuthController::class , 'user']);
    Route::post('/logout', [AuthController::class , 'logout']);

    // Cart routes
    Route::get('/cart', [CartController::class , 'index']);
    Route::post('/cart/add', [CartController::class , 'add']);
    Route::post('/cart/update', [CartController::class , 'update']);
    Route::post('/cart/remove', [CartController::class , 'remove']);

    // Admin Product routes
    Route::post('/products', [ProductController::class , 'store']);
    Route::delete('/products/bulk-delete', [ProductController::class , 'bulkDelete']);
    Route::post('/products/bulk-restore', [ProductController::class , 'bulkRestore']);
    Route::post('/products/bulk-update-attributes', [ProductController::class , 'bulkUpdateAttributes']);
    Route::post('/products/bulk-update-undo', [ProductController::class , 'undoBulkUpdate']);
    Route::delete('/products/bulk-force-delete', [ProductController::class , 'bulkForceDelete']);
    Route::post('/products/{id}/duplicate', [ProductController::class , 'duplicate']);
    Route::post('/products/{id}', [ProductController::class , 'update']); // Use POST for update to handle file uploads
    Route::delete('/products/{id}', [ProductController::class , 'destroy']);
    Route::post('/products/{id}/restore', [ProductController::class , 'restore']);
    Route::delete('/products/{id}/force', [ProductController::class , 'forceDelete']);

    // Admin Product Image routes
    Route::post('/products/{id}/images', [ProductImageController::class , 'store']);
    Route::post('/product-images/reorder', [ProductImageController::class , 'reorder']);
    Route::post('/product-images/{id}/primary', [ProductImageController::class , 'setPrimary']);
    Route::delete('/product-images/{id}', [ProductImageController::class , 'destroy']);

    // Admin Category routes
    Route::post('/categories', [CategoryController::class , 'store']);
    Route::post('/categories/reorder', [CategoryController::class , 'reorder']);
    Route::post('/categories/bulk-layout', [CategoryController::class , 'bulkUpdateLayout']);
    Route::post('/categories/{id}', [CategoryController::class , 'update']);
    Route::delete('/categories/{id}', [CategoryController::class , 'destroy']);

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
    Route::get('/orders/connected-carriers', [\App\Http\Controllers\Api\OrderController::class , 'connectedCarriers']);
    Route::get('/orders/shipping-alerts', [\App\Http\Controllers\Api\OrderController::class , 'shippingAlerts']);
    Route::post('/orders/dispatch/preview', [\App\Http\Controllers\Api\OrderController::class , 'dispatchPreview']);
    Route::post('/orders/dispatch', [\App\Http\Controllers\Api\OrderController::class , 'dispatch']);
    Route::get('/orders/{id}', [\App\Http\Controllers\Api\OrderController::class , 'show'])->whereNumber('id');
    Route::put('/orders/{id}/status', [\App\Http\Controllers\Api\OrderController::class , 'updateStatus'])->whereNumber('id');
    Route::put('/orders/{id}', [\App\Http\Controllers\Api\OrderController::class , 'update'])->whereNumber('id');
    Route::delete('/orders/{id}', [\App\Http\Controllers\Api\OrderController::class , 'destroy'])->whereNumber('id');
    Route::post('/orders/{id}/duplicate', [\App\Http\Controllers\Api\OrderController::class , 'duplicate'])->whereNumber('id');
    Route::post('/orders/{id}/restore', [\App\Http\Controllers\Api\OrderController::class , 'restore'])->whereNumber('id');
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
    Route::get('/shipping-settings', [\App\Http\Controllers\Api\ShippingSettingsController::class , 'index']);
    Route::put('/shipping-settings/integrations/{carrierCode}', [\App\Http\Controllers\Api\ShippingSettingsController::class , 'updateIntegration']);
    Route::post('/shipping-settings/integrations/{carrierCode}/test', [\App\Http\Controllers\Api\ShippingSettingsController::class , 'testIntegration']);

    // Customer management
    Route::get('/customers', [\App\Http\Controllers\Api\CustomerController::class , 'index']);
    Route::post('/customers', [\App\Http\Controllers\Api\CustomerController::class , 'store']);
    Route::get('/customers/{id}', [\App\Http\Controllers\Api\CustomerController::class , 'show']);
    Route::put('/customers/{id}', [\App\Http\Controllers\Api\CustomerController::class , 'update']);
    Route::delete('/customers/{id}', [\App\Http\Controllers\Api\CustomerController::class , 'destroy']);

    // Leads / KhÃ¡ch liÃªn há»‡ tÆ° váº¥n
    Route::get('/leads', [\App\Http\Controllers\Api\LeadController::class , 'index']);
    Route::get('/leads/realtime', [\App\Http\Controllers\Api\LeadController::class , 'realtime']);
    Route::get('/leads/{id}', [\App\Http\Controllers\Api\LeadController::class , 'show']);
    Route::get('/leads/{id}/notes', [\App\Http\Controllers\Api\LeadController::class , 'notes']);
    Route::post('/leads/{id}/notes', [\App\Http\Controllers\Api\LeadController::class , 'storeNote']);
    Route::get('/leads/{id}/order-draft', [\App\Http\Controllers\Api\LeadController::class , 'orderDraft']);
    Route::put('/leads/{id}', [\App\Http\Controllers\Api\LeadController::class , 'update']);
    Route::delete('/leads/{id}', [\App\Http\Controllers\Api\LeadController::class , 'destroy']);
    Route::get('/lead-statuses', [\App\Http\Controllers\Api\LeadStatusController::class , 'index']);
    Route::post('/lead-statuses', [\App\Http\Controllers\Api\LeadStatusController::class , 'store']);
    Route::put('/lead-statuses/{id}', [\App\Http\Controllers\Api\LeadStatusController::class , 'update']);
    Route::post('/lead-statuses/reorder', [\App\Http\Controllers\Api\LeadStatusController::class , 'reorder']);
    Route::delete('/lead-statuses/{id}', [\App\Http\Controllers\Api\LeadStatusController::class , 'destroy']);
    Route::get('/lead-staffs', [\App\Http\Controllers\Api\LeadStaffController::class , 'index']);
    Route::post('/lead-staffs', [\App\Http\Controllers\Api\LeadStaffController::class , 'store']);
    Route::put('/lead-staffs/{id}', [\App\Http\Controllers\Api\LeadStaffController::class , 'update']);
    Route::post('/lead-staffs/reorder', [\App\Http\Controllers\Api\LeadStaffController::class , 'reorder']);
    Route::delete('/lead-staffs/{id}', [\App\Http\Controllers\Api\LeadStaffController::class , 'destroy']);
    Route::get('/lead-tag-rules', [\App\Http\Controllers\Api\LeadTagRuleController::class , 'index']);
    Route::post('/lead-tag-rules', [\App\Http\Controllers\Api\LeadTagRuleController::class , 'store']);
    Route::put('/lead-tag-rules/{id}', [\App\Http\Controllers\Api\LeadTagRuleController::class , 'update']);
    Route::delete('/lead-tag-rules/{id}', [\App\Http\Controllers\Api\LeadTagRuleController::class , 'destroy']);


    // Inventory & Logistics expansion
    Route::get('/stock-movements', [\App\Http\Controllers\Api\StockMovementController::class , 'index']);
    Route::post('/stock-movements', [\App\Http\Controllers\Api\StockMovementController::class , 'store']);

    Route::get('/stock-transfers', [\App\Http\Controllers\Api\StockTransferController::class , 'index']);
    Route::post('/stock-transfers', [\App\Http\Controllers\Api\StockTransferController::class , 'store']);
    Route::post('/stock-transfers/{id}/complete', [\App\Http\Controllers\Api\StockTransferController::class , 'complete']);

    // Inventory management
    Route::get('/inventory/dashboard', [InventoryController::class, 'dashboard']);
    Route::get('/inventory/products', [InventoryController::class, 'products']);
    Route::post('/inventory/products', [InventoryController::class, 'storeProduct']);
    Route::put('/inventory/products/{id}', [InventoryController::class, 'updateProduct'])->whereNumber('id');
    Route::put('/inventory/products/{id}/import-star', [InventoryController::class, 'updateInventoryImportStar'])->whereNumber('id');
    Route::get('/inventory/suppliers', [InventoryController::class, 'suppliers']);
    Route::post('/inventory/suppliers', [InventoryController::class, 'storeSupplier']);
    Route::put('/inventory/suppliers/{id}', [InventoryController::class, 'updateSupplier'])->whereNumber('id');
    Route::delete('/inventory/suppliers/{id}', [InventoryController::class, 'destroySupplier'])->whereNumber('id');
    Route::get('/inventory/suppliers/{id}/prices', [InventoryController::class, 'supplierPrices'])->whereNumber('id');
    Route::post('/inventory/suppliers/{id}/prices', [InventoryController::class, 'storeSupplierPrice'])->whereNumber('id');
    Route::post('/inventory/suppliers/{id}/prices/bulk', [InventoryController::class, 'bulkUpsertSupplierPrices'])->whereNumber('id');
    Route::put('/inventory/suppliers/{id}/prices/{priceId}', [InventoryController::class, 'updateSupplierPrice'])->whereNumber('id')->whereNumber('priceId');
    Route::delete('/inventory/suppliers/{id}/prices/{priceId}', [InventoryController::class, 'destroySupplierPrice'])->whereNumber('id')->whereNumber('priceId');
    Route::get('/inventory/units', [InventoryController::class, 'inventoryUnits']);
    Route::post('/inventory/units', [InventoryController::class, 'storeInventoryUnit']);
    Route::get('/inventory/import-statuses', [InventoryController::class, 'importStatuses']);
    Route::post('/inventory/import-statuses', [InventoryController::class, 'storeImportStatus']);
    Route::put('/inventory/import-statuses/{id}', [InventoryController::class, 'updateImportStatus'])->whereNumber('id');
    Route::post('/inventory/import-invoices/analyze', [InventoryController::class, 'analyzeImportInvoice']);
    Route::get('/inventory/import-invoices/{id}', [InventoryController::class, 'showInvoiceAnalysis'])->whereNumber('id');
    Route::get('/inventory/imports', [InventoryController::class, 'imports']);
    Route::post('/inventory/imports', [InventoryController::class, 'storeImport']);
    Route::post('/inventory/imports/bulk-delete', [InventoryController::class, 'bulkDestroyImports']);
    Route::get('/inventory/imports/{id}/attachments', [InventoryController::class, 'importAttachments'])->whereNumber('id');
    Route::post('/inventory/imports/{id}/attachments', [InventoryController::class, 'storeImportAttachments'])->whereNumber('id');
    Route::post('/inventory/imports/{id}/attachments/{attachmentId}', [InventoryController::class, 'replaceImportAttachment'])->whereNumber('id')->whereNumber('attachmentId');
    Route::delete('/inventory/imports/{id}/attachments/{attachmentId}', [InventoryController::class, 'destroyImportAttachment'])->whereNumber('id')->whereNumber('attachmentId');
    Route::put('/inventory/imports/{id}', [InventoryController::class, 'updateImport'])->whereNumber('id');
    Route::delete('/inventory/imports/{id}', [InventoryController::class, 'destroyImport'])->whereNumber('id');
    Route::get('/inventory/imports/{id}', [InventoryController::class, 'showImport'])->whereNumber('id');
    Route::get('/inventory/documents/{type}', [InventoryController::class, 'documents']);
    Route::post('/inventory/documents/{type}', [InventoryController::class, 'storeDocument']);
    Route::post('/inventory/documents/{type}/bulk-delete', [InventoryController::class, 'bulkDestroyDocuments']);
    Route::put('/inventory/documents/{type}/{id}', [InventoryController::class, 'updateDocument'])->whereNumber('id');
    Route::delete('/inventory/documents/{type}/{id}', [InventoryController::class, 'destroyDocument'])->whereNumber('id');
    Route::get('/inventory/documents/{type}/{id}', [InventoryController::class, 'showDocument'])->whereNumber('id');
    Route::get('/inventory/batches', [InventoryController::class, 'batches']);
    Route::get('/inventory/exports', [InventoryController::class, 'exports']);
    Route::get('/inventory/exports/{id}', [InventoryController::class, 'showExport'])->whereNumber('id');

    // Finance
    Route::get('/finance/dashboard', [FinanceController::class, 'dashboard']);
    Route::get('/finance/options', [FinanceController::class, 'options']);
    Route::get('/finance/transactions', [FinanceController::class, 'transactions']);
    Route::post('/finance/transactions', [FinanceController::class, 'storeTransaction']);
    Route::post('/finance/transactions/{id}/restore', [FinanceController::class, 'restoreTransaction'])->whereNumber('id');
    Route::post('/finance/transactions/{id}', [FinanceController::class, 'updateTransaction'])->whereNumber('id');
    Route::delete('/finance/transactions/{id}', [FinanceController::class, 'destroyTransaction'])->whereNumber('id');
    Route::get('/finance/wallets', [FinanceController::class, 'wallets']);
    Route::post('/finance/wallets', [FinanceController::class, 'storeWallet']);
    Route::put('/finance/wallets/{id}', [FinanceController::class, 'updateWallet'])->whereNumber('id');
    Route::post('/finance/wallets/{id}/adjust', [FinanceController::class, 'adjustWallet'])->whereNumber('id');
    Route::get('/finance/wallets/{id}/ledger', [FinanceController::class, 'walletLedger'])->whereNumber('id');
    Route::get('/finance/transfers', [FinanceController::class, 'transfers']);
    Route::post('/finance/transfers', [FinanceController::class, 'storeTransfer']);
    Route::delete('/finance/transfers/{id}', [FinanceController::class, 'destroyTransfer'])->whereNumber('id');
    Route::get('/finance/loans', [FinanceController::class, 'loans']);
    Route::post('/finance/loans', [FinanceController::class, 'storeLoan']);
    Route::put('/finance/loans/{id}', [FinanceController::class, 'updateLoan'])->whereNumber('id');
    Route::delete('/finance/loans/{id}', [FinanceController::class, 'destroyLoan'])->whereNumber('id');
    Route::post('/finance/loans/{id}/payments', [FinanceController::class, 'storeLoanPayment'])->whereNumber('id');
    Route::delete('/finance/loan-payments/{id}', [FinanceController::class, 'destroyLoanPayment'])->whereNumber('id');
    Route::get('/finance/fixed-expenses', [FinanceController::class, 'fixedExpenses']);
    Route::get('/finance/fixed-expenses/by-date', [FinanceController::class, 'fixedExpenseByDate']);
    Route::post('/finance/fixed-expenses', [FinanceController::class, 'storeFixedExpense']);
    Route::put('/finance/fixed-expenses/sheet', [FinanceController::class, 'syncFixedExpenseSheet']);
    Route::put('/finance/fixed-expenses/{id}', [FinanceController::class, 'updateFixedExpense'])->whereNumber('id');
    Route::delete('/finance/fixed-expenses/{id}', [FinanceController::class, 'destroyFixedExpense'])->whereNumber('id');
    Route::post('/finance/fixed-expenses/{id}/pay', [FinanceController::class, 'payFixedExpense'])->whereNumber('id');
    Route::get('/finance/catalogs', [FinanceController::class, 'catalogs']);
    Route::post('/finance/catalogs', [FinanceController::class, 'storeCatalog']);
    Route::put('/finance/catalogs/{id}', [FinanceController::class, 'updateCatalog'])->whereNumber('id');
    Route::delete('/finance/catalogs/{id}', [FinanceController::class, 'destroyCatalog'])->whereNumber('id');
    Route::get('/finance/reports', [FinanceController::class, 'reports']);

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
    Route::post('/shipments/reconcile', [\App\Http\Controllers\Api\ShipmentController::class , 'bulkReconcile']);
    Route::post('/shipments/sync', [\App\Http\Controllers\Api\ShipmentController::class , 'syncCarrierShipments']);
    Route::post('/shipments/carrier-callback', [\App\Http\Controllers\Api\ShipmentController::class , 'processCarrierCallback']);

    // Order shipping status check
    Route::get('/orders/{id}/shipping-lock', function ($id) {
            $order = \App\Models\Order::findOrFail($id);
            $syncService = app(\App\Services\Shipping\ShipmentStatusSyncService::class);
            return response()->json($syncService->canManuallyEditOrderShipping($order));
        }
        )->whereNumber('id');

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
        Route::get('/blog/seo-keywords', [\App\Http\Controllers\Api\BlogController::class , 'seoKeywords']);
        Route::post('/blog/seo-keywords', [\App\Http\Controllers\Api\BlogController::class , 'storeSeoKeyword']);
        Route::put('/blog/seo-keywords/{id}', [\App\Http\Controllers\Api\BlogController::class , 'updateSeoKeyword']);
        Route::delete('/blog/seo-keywords/{id}', [\App\Http\Controllers\Api\BlogController::class , 'destroySeoKeyword']);
        Route::post('/blog/bulk-seo-keyword', [\App\Http\Controllers\Api\BlogController::class , 'bulkSeoKeyword']);
        Route::post('/blog/bulk-category', [\App\Http\Controllers\Api\BlogController::class , 'bulkCategory']);
        Route::post('/blog/categories', [\App\Http\Controllers\Api\BlogController::class , 'storeCategory']);
        Route::put('/blog/categories/{id}', [\App\Http\Controllers\Api\BlogController::class , 'updateCategory']);
        Route::delete('/blog/categories/{id}', [\App\Http\Controllers\Api\BlogController::class , 'destroyCategory']);
        Route::post('/blog/categories/reorder', [\App\Http\Controllers\Api\BlogController::class , 'reorderCategories']);
        Route::post('/blog', [\App\Http\Controllers\Api\BlogController::class , 'store']);
        Route::post('/blog/reorder', [\App\Http\Controllers\Api\BlogController::class , 'reorder']);
        Route::post('/blog/import-word', [\App\Http\Controllers\Api\BlogController::class , 'importWord']);
        Route::put('/blog/{id}', [\App\Http\Controllers\Api\BlogController::class , 'update']);
        Route::delete('/blog/{id}', [\App\Http\Controllers\Api\BlogController::class , 'destroy']);

        // CMS (Banners & Settings)
        Route::post('/banners', [\App\Http\Controllers\Api\BannerController::class , 'store']);
        Route::get('/banners/{id}', [\App\Http\Controllers\Api\BannerController::class , 'show']);
        Route::put('/banners/{id}', [\App\Http\Controllers\Api\BannerController::class , 'update']);
        Route::delete('/banners/{id}', [\App\Http\Controllers\Api\BannerController::class , 'destroy']);
        Route::post('/site-settings', [\App\Http\Controllers\Api\SiteSettingController::class , 'store']);
        Route::get('/quote-templates', [\App\Http\Controllers\Api\QuoteTemplateController::class, 'index']);
        Route::post('/quote-templates', [\App\Http\Controllers\Api\QuoteTemplateController::class, 'store']);
        Route::put('/quote-templates/{id}', [\App\Http\Controllers\Api\QuoteTemplateController::class, 'update']);
        Route::delete('/quote-templates/{id}', [\App\Http\Controllers\Api\QuoteTemplateController::class, 'destroy']);

        // Admin Domain routes
        Route::get('/site-domains', [\App\Http\Controllers\Api\SiteDomainController::class , 'index']);
        Route::post('/site-domains', [\App\Http\Controllers\Api\SiteDomainController::class , 'store']);
        Route::put('/site-domains/{id}', [\App\Http\Controllers\Api\SiteDomainController::class , 'update']);
        Route::delete('/site-domains/{id}', [\App\Http\Controllers\Api\SiteDomainController::class , 'destroy']);

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
        Route::post('/ai/generate-content', [AIController::class , 'generateContent']);
        Route::post('/ai/read-invoice', [AIController::class , 'readInvoice']);
        Route::post('/ai/generate-product-description', [AIController::class , 'generateProductDescription']);
        Route::post('/ai/rewrite-product-description', [AIController::class , 'rewriteProductDescription']);
        
        // Media Upload for Editor
        Route::post('/media/upload', [MediaController::class, 'upload']);
    });

// Public Routes for Reviews (Reading)
Route::get('/products/{productId}/reviews', [\App\Http\Controllers\Api\ReviewController::class , 'index']);

// Public AI Chat Routes
Route::get('/ai/status', [AIController::class , 'status']);
Route::post('/ai/chat', [AIController::class , 'chat']);
Route::get('/ai/history/{chat_id}', [AIController::class , 'getHistory']);

// â”€â”€â”€ Storefront Public API (Website bÃ¡n hÃ ng) â”€â”€â”€
Route::group(['prefix' => 'storefront'], function () {
    Route::get('/homepage', [\App\Http\Controllers\Api\StorefrontController::class , 'homepage']);
    Route::get('/categories', [\App\Http\Controllers\Api\StorefrontController::class , 'categories']);
    Route::get('/products', [\App\Http\Controllers\Api\StorefrontController::class , 'products']);
    Route::get('/products/{slugOrId}', [\App\Http\Controllers\Api\StorefrontController::class , 'productDetail']);
    Route::get('/products/{id}/related', [\App\Http\Controllers\Api\StorefrontController::class , 'relatedProducts']);
    Route::post('/order', [\App\Http\Controllers\Api\StorefrontController::class , 'placeOrder']);
    Route::post('/lead', [\App\Http\Controllers\Api\StorefrontController::class , 'submitLead']);
});

// â”€â”€â”€ Separate Storefront API (Web API) â”€â”€â”€
Route::group(['prefix' => 'web-api'], function () {
    Route::get('/products', [\App\Http\Controllers\StorefrontApi\ProductController::class, 'index']);
    Route::get('/products/{slug}', [\App\Http\Controllers\StorefrontApi\ProductController::class, 'show']);
    Route::get('/products/{slug}/related', [\App\Http\Controllers\StorefrontApi\ProductController::class, 'related']);
    Route::get('/categories', [\App\Http\Controllers\StorefrontApi\CategoryController::class, 'index']);
    Route::get('/categories/{slug}', [\App\Http\Controllers\StorefrontApi\CategoryController::class, 'show']);
});

