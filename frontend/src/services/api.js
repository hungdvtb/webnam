import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8003/api',
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

// Interceptor to add Bearer token if present
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    const activeAccountId = localStorage.getItem('activeAccountId');
    if (activeAccountId && activeAccountId !== 'all') {
        config.headers['X-Account-Id'] = activeAccountId;
    }

    const activeSiteCode = localStorage.getItem('activeSiteCode');
    if (activeSiteCode) {
        config.headers['X-Site-Code'] = activeSiteCode;
    }

    return config;
});

const multipartConfig = (data) => (
    data instanceof FormData
        ? { headers: { 'Content-Type': 'multipart/form-data' } }
        : undefined
);

export const productApi = {
    getAll: (params, signal) => api.get('/products', { params, signal }),
    getOne: (id) => api.get(`/products/${id}`),
    refreshOrderItems: (data) => api.post('/products/refresh-order-items', data),
    store: (data) => api.post('/products', data),
    update: (id, data) => api.post(`/products/${id}`, data), // POST for multipart support
    destroy: (id) => api.delete(`/products/${id}`),
    duplicate: (id) => api.post(`/products/${id}/duplicate`),
    restore: (id) => api.post(`/products/${id}/restore`),
    forceDelete: (id) => api.delete(`/products/${id}/force`),
    bulkDelete: (ids) => api.delete('/products/bulk-delete', { data: { ids } }),
    bulkRestore: (ids) => api.post('/products/bulk-restore', { ids }),
    bulkForceDelete: (ids) => api.delete('/products/bulk-force-delete', { data: { ids } }),
    bulkUpdateAttributes: (data) => api.post('/products/bulk-update-attributes', data),
    bulkUpdateUndo: (logId) => api.post('/products/bulk-update-undo', { log_id: logId }),
};

export const productImageApi = {
    upload: (productId, formData) => api.post(`/products/${productId}/images`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    }),
    setPrimary: (id) => api.post(`/product-images/${id}/primary`),
    destroy: (id) => api.delete(`/product-images/${id}`),
    reorder: (ids) => api.post('/product-images/reorder', { ids }),
};

export const categoryApi = {
    getAll: () => api.get('/categories'),
    getOne: (id) => api.get(`/categories/${id}`),
    store: (data) => api.post('/categories', data),
    update: (id, data) => api.post(`/categories/${id}`, data),
    destroy: (id) => api.delete(`/categories/${id}`),
    reorder: (items) => api.post('/categories/reorder', { items }),
    bulkUpdateLayout: (data) => api.post('/categories/bulk-layout', data),
};

export const attributeApi = {
    getAll: (params) => api.get('/attributes', { params }),
    getOne: (id) => api.get(`/attributes/${id}`),
    store: (data) => api.post('/attributes', data),
    update: (id, data) => api.put(`/attributes/${id}`, data),
    destroy: (id) => api.delete(`/attributes/${id}`),
};

export const accountApi = {
    getAll: () => api.get('/accounts'),
    getOne: (id) => api.get(`/accounts/${id}`),
    store: (data) => api.post('/accounts', data),
    storeWithUser: (data) => api.post('/accounts/with-user', data),
    update: (id, data) => api.put(`/accounts/${id}`, data),
    destroy: (id) => api.delete(`/accounts/${id}`),
    resolve: (siteCode) => api.get(`/accounts/resolve/${siteCode}`),
};

export const warehouseApi = {
    getAll: (params) => api.get('/warehouses', params ? { params } : {}),
    getOne: (id) => api.get(`/warehouses/${id}`),
    store: (data) => api.post('/warehouses', data),
    update: (id, data) => api.put(`/warehouses/${id}`, data),
    destroy: (id) => api.delete(`/warehouses/${id}`),
    getInventory: (id) => api.get(`/warehouses/${id}/inventory`),
    updateInventory: (id, data) => api.post(`/warehouses/${id}/inventory`, data),
};

export const orderApi = {
    getBootstrap: (params) => api.get('/orders/bootstrap', { params }),
    getAll: (params, signal) => api.get('/orders', { params, signal }),
    getOne: (id) => api.get(`/orders/${id}`),
    store: (data) => api.post('/orders', data),
    update: (id, data) => api.put(`/orders/${id}`, data),
    destroy: (id) => api.delete(`/orders/${id}`),
    updateStatus: (id, status) => api.put(`/orders/${id}/status`, { status }),
    duplicate: (id) => api.post(`/orders/${id}/duplicate`),
    restore: (id) => api.post(`/orders/${id}/restore`),
    bulkDelete: (ids, force = false) => api.post('/orders/bulk-delete', { ids, force: force ? 1 : 0 }),
    bulkRestore: (ids) => api.post('/orders/bulk-restore', { ids }),
    bulkDuplicate: (ids) => api.post('/orders/bulk-duplicate', { ids }),
    bulkUpdate: (data) => api.post('/orders/bulk-update', data),
    dispatchPreview: (data) => api.post('/orders/dispatch/preview', data),
    dispatch: (data) => api.post('/orders/dispatch', data),
    quickDispatch: (data) => api.post('/orders/quick-dispatch', data),
    getShippingAlerts: (params) => api.get('/orders/shipping-alerts', { params }),
    getConnectedCarriers: () => api.get('/orders/connected-carriers'),
};

export const leadApi = {
    getAll: (params, signal) => api.get('/leads', { params, signal }),
    getOne: (id) => api.get(`/leads/${id}`),
    update: (id, data) => api.put(`/leads/${id}`, data),
    destroy: (id) => api.delete(`/leads/${id}`),
    realtime: (params) => api.get('/leads/realtime', { params }),
    getNotifications: (params) => api.get('/leads/notifications', params ? { params } : {}),
    markNotificationsRead: (data) => api.post('/leads/notifications/read', data),
    updateNotificationSettings: (data) => api.post('/leads/notification-settings', data, multipartConfig(data)),
    getNotes: (id) => api.get(`/leads/${id}/notes`),
    addNote: (id, data) => api.post(`/leads/${id}/notes`, data),
    getOrderDraft: (id) => api.get(`/leads/${id}/order-draft`),
    getStatuses: () => api.get('/lead-statuses'),
    createStatus: (data) => api.post('/lead-statuses', data),
    updateStatusConfig: (id, data) => api.put(`/lead-statuses/${id}`, data),
    reorderStatuses: (ids) => api.post('/lead-statuses/reorder', { ids }),
    deleteStatusConfig: (id) => api.delete(`/lead-statuses/${id}`),
    getStaffs: () => api.get('/lead-staffs'),
    createStaff: (data) => api.post('/lead-staffs', data),
    updateStaff: (id, data) => api.put(`/lead-staffs/${id}`, data),
    reorderStaffs: (ids) => api.post('/lead-staffs/reorder', { ids }),
    deleteStaff: (id) => api.delete(`/lead-staffs/${id}`),
    getTagRules: () => api.get('/lead-tag-rules'),
    createTagRule: (data) => api.post('/lead-tag-rules', data),
    updateTagRule: (id, data) => api.put(`/lead-tag-rules/${id}`, data),
    deleteTagRule: (id) => api.delete(`/lead-tag-rules/${id}`),
};

export const orderStatusApi = {
    getAll: (params) => api.get('/order-statuses', params ? { params } : {}),
    getOne: (id) => api.get(`/order-statuses/${id}`),
    store: (data) => api.post('/order-statuses', data),
    update: (id, data) => api.put(`/order-statuses/${id}`, data),
    reorder: (ids) => api.post('/order-statuses/reorder', { ids }),
    destroy: (id) => api.delete(`/order-statuses/${id}`),
};

export const customerApi = {
    getAll: (params) => api.get('/customers', { params }),
    getOne: (id) => api.get(`/customers/${id}`),
    store: (data) => api.post('/customers', data),
    update: (id, data) => api.put(`/customers/${id}`, data),
    destroy: (id) => api.delete(`/customers/${id}`),
};

export const stockApi = {
    getMovements: (params) => api.get('/stock-movements', { params }),
    storeMovement: (data) => api.post('/stock-movements', data),
    getTransfers: (params) => api.get('/stock-transfers', { params }),
    storeTransfer: (data) => api.post('/stock-transfers', data),
    completeTransfer: (id) => api.post(`/stock-transfers/${id}/complete`),
};

export const inventoryApi = {
    getDashboard: (params) => api.get('/inventory/dashboard', { params }),
    getProducts: (params, signal) => api.get('/inventory/products', { params, signal }),
    createProduct: (data) => api.post('/inventory/products', data),
    updateProduct: (id, data) => api.put(`/inventory/products/${id}`, data),
    setImportStar: (id, data) => api.put(`/inventory/products/${id}/import-star`, data),
    getSuppliers: (params) => api.get('/inventory/suppliers', { params }),
    createSupplier: (data) => api.post('/inventory/suppliers', data),
    updateSupplier: (id, data) => api.put(`/inventory/suppliers/${id}`, data),
    deleteSupplier: (id) => api.delete(`/inventory/suppliers/${id}`),
    getSupplierPrices: (supplierId, params) => api.get(`/inventory/suppliers/${supplierId}/prices`, { params }),
    createSupplierPrice: (supplierId, data) => api.post(`/inventory/suppliers/${supplierId}/prices`, data),
    bulkSupplierPrices: (supplierId, data) => api.post(`/inventory/suppliers/${supplierId}/prices/bulk`, data),
    updateSupplierPrice: (supplierId, priceId, data) => api.put(`/inventory/suppliers/${supplierId}/prices/${priceId}`, data),
    deleteSupplierPrice: (supplierId, priceId) => api.delete(`/inventory/suppliers/${supplierId}/prices/${priceId}`),
    getUnits: (params) => api.get('/inventory/units', params ? { params } : {}),
    createUnit: (data) => api.post('/inventory/units', data),
    getImportStatuses: (params) => api.get('/inventory/import-statuses', params ? { params } : {}),
    createImportStatus: (data) => api.post('/inventory/import-statuses', data),
    updateImportStatus: (id, data) => api.put(`/inventory/import-statuses/${id}`, data),
    analyzeImportInvoice: (data) => api.post('/inventory/import-invoices/analyze', data, multipartConfig(data)),
    getImportInvoiceAnalysis: (id) => api.get(`/inventory/import-invoices/${id}`),
    getImports: (params) => api.get('/inventory/imports', { params }),
    getImportAttachments: (id) => api.get(`/inventory/imports/${id}/attachments`),
    addImportAttachments: (id, data) => api.post(`/inventory/imports/${id}/attachments`, data, multipartConfig(data)),
    replaceImportAttachment: (id, attachmentId, data) => api.post(`/inventory/imports/${id}/attachments/${attachmentId}`, data, multipartConfig(data)),
    deleteImportAttachment: (id, attachmentId) => api.delete(`/inventory/imports/${id}/attachments/${attachmentId}`),
    createImport: (data) => api.post('/inventory/imports', data, multipartConfig(data)),
    updateImport: (id, data) => {
        if (data instanceof FormData) {
            data.append('_method', 'PUT');
            return api.post(`/inventory/imports/${id}`, data, multipartConfig(data));
        }
        return api.put(`/inventory/imports/${id}`, data);
    },
    deleteImport: (id) => api.delete(`/inventory/imports/${id}`),
    bulkDeleteImports: (ids) => api.post('/inventory/imports/bulk-delete', { ids }),
    getImport: (id) => api.get(`/inventory/imports/${id}`),
    getDocuments: (type, params) => api.get(`/inventory/documents/${type}`, { params }),
    createDocument: (type, data) => api.post(`/inventory/documents/${type}`, data),
    updateDocument: (type, id, data) => api.put(`/inventory/documents/${type}/${id}`, data),
    deleteDocument: (type, id) => api.delete(`/inventory/documents/${type}/${id}`),
    bulkDeleteDocuments: (type, ids) => api.post(`/inventory/documents/${type}/bulk-delete`, { ids }),
    getDocument: (type, id) => api.get(`/inventory/documents/${type}/${id}`),
    getBatches: (params) => api.get('/inventory/batches', { params }),
    getExports: (params) => api.get('/inventory/exports', { params }),
    getExport: (id) => api.get(`/inventory/exports/${id}`),
};

export const financeApi = {
    getDashboard: (params) => api.get('/finance/dashboard', { params }),
    getOptions: () => api.get('/finance/options'),
    getTransactions: (params) => api.get('/finance/transactions', { params }),
    createTransaction: (data) => api.post('/finance/transactions', data, multipartConfig(data)),
    updateTransaction: (id, data) => api.post(`/finance/transactions/${id}`, data, multipartConfig(data)),
    deleteTransaction: (id) => api.delete(`/finance/transactions/${id}`),
    restoreTransaction: (id) => api.post(`/finance/transactions/${id}/restore`),
    getWallets: (params) => api.get('/finance/wallets', { params }),
    createWallet: (data) => api.post('/finance/wallets', data),
    updateWallet: (id, data) => api.put(`/finance/wallets/${id}`, data),
    adjustWallet: (id, data) => api.post(`/finance/wallets/${id}/adjust`, data),
    getWalletLedger: (id, params) => api.get(`/finance/wallets/${id}/ledger`, { params }),
    getTransfers: (params) => api.get('/finance/transfers', { params }),
    createTransfer: (data) => api.post('/finance/transfers', data),
    deleteTransfer: (id) => api.delete(`/finance/transfers/${id}`),
    getLoans: (params) => api.get('/finance/loans', { params }),
    createLoan: (data) => api.post('/finance/loans', data),
    updateLoan: (id, data) => api.put(`/finance/loans/${id}`, data),
    deleteLoan: (id) => api.delete(`/finance/loans/${id}`),
    createLoanPayment: (id, data) => api.post(`/finance/loans/${id}/payments`, data),
    deleteLoanPayment: (id) => api.delete(`/finance/loan-payments/${id}`),
    getFixedExpenses: (params) => api.get('/finance/fixed-expenses', { params }),
    getFixedExpenseByDate: (params) => api.get('/finance/fixed-expenses/by-date', { params }),
    syncFixedExpenseSheet: (data) => api.put('/finance/fixed-expenses/sheet', data),
    getDailyProfitTable: (params) => api.get('/finance/daily-profit', { params }),
    saveDailyProfitConfig: (data) => api.post('/finance/daily-profit/config', data),
    createFixedExpense: (data) => api.post('/finance/fixed-expenses', data),
    updateFixedExpense: (id, data) => api.put(`/finance/fixed-expenses/${id}`, data),
    deleteFixedExpense: (id) => api.delete(`/finance/fixed-expenses/${id}`),
    payFixedExpense: (id, data) => api.post(`/finance/fixed-expenses/${id}/pay`, data, multipartConfig(data)),
    getCatalogs: (params) => api.get('/finance/catalogs', { params }),
    createCatalog: (data) => api.post('/finance/catalogs', data),
    updateCatalog: (id, data) => api.put(`/finance/catalogs/${id}`, data),
    deleteCatalog: (id) => api.delete(`/finance/catalogs/${id}`),
    getReports: (params) => api.get('/finance/reports', { params }),
};

export const couponApi = {
    getAll: () => api.get('/coupons'),
    store: (data) => api.post('/coupons', data),
    validate: (code, orderValue) => api.post('/coupons/validate', { code, order_value: orderValue }),
};

export const reviewApi = {
    getByProduct: (productId) => api.get(`/products/${productId}/reviews`),
    store: (productId, data) => api.post(`/products/${productId}/reviews`, data),
    adminList: (params) => api.get('/admin/reviews', { params }),
    approve: (id) => api.post(`/admin/reviews/${id}/approve`),
};

export const wishlistApi = {
    get: () => api.get('/wishlist'),
    toggle: (productId) => api.post(`/wishlist/toggle/${productId}`),
};

export const blogApi = {
    getAll: (params) => api.get('/blog', { params }),
    getCategories: (params) => api.get('/blog/categories', params ? { params } : {}),
    createCategory: (data) => api.post('/blog/categories', data),
    updateCategory: (id, data) => api.put(`/blog/categories/${id}`, data),
    deleteCategory: (id) => api.delete(`/blog/categories/${id}`),
    reorderCategories: (ids) => api.post('/blog/categories/reorder', { ids }),
    bulkCategory: (data) => api.post('/blog/bulk-category', data),
    getSeoKeywords: () => api.get('/blog/seo-keywords'),
    createSeoKeyword: (data) => api.post('/blog/seo-keywords', data),
    updateSeoKeyword: (id, data) => api.put(`/blog/seo-keywords/${id}`, data),
    deleteSeoKeyword: (id) => api.delete(`/blog/seo-keywords/${id}`),
    bulkSeoKeyword: (data) => api.post('/blog/bulk-seo-keyword', data),
    getOne: (id) => api.get(`/blog/${id}`),
    store: (data) => api.post('/blog', data),
    update: (id, data) => api.put(`/blog/${id}`, data),
    destroy: (id) => api.delete(`/blog/${id}`),
    reorder: (ids) => api.post('/blog/reorder', { ids }),
    importWord: (formData) => api.post('/blog/import-word', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    }),
    downloadImportTemplate: () => api.get('/blog/import/template', { responseType: 'blob' }),
};

export const reportApi = {
    getDashboard: () => api.get('/reports/dashboard'),
    getInventory: () => api.get('/reports/inventory'),
    getTopProducts: () => api.get('/reports/top-products'),
    getSales: (days) => api.get('/reports/sales', { params: { days } }),
    getSalesMatrix: (params) => api.get('/reports/sales-matrix', { params }),
};

export const invoiceApi = {
    getAll: (params) => api.get('/invoices', { params }),
    getOne: (id) => api.get(`/invoices/${id}`),
    markAsPaid: (id) => api.post(`/invoices/${id}/paid`),
};

export const shipmentApi = {
    getAll: (params, signal) => api.get('/shipments', { params, signal }),
    getOne: (id) => api.get(`/shipments/${id}`),
    store: (data) => api.post('/shipments', data),
    update: (id, data) => api.put(`/shipments/${id}`, data),
    updateStatus: (id, data) => api.put(`/shipments/${id}/status`, data),
    destroy: (id) => api.delete(`/shipments/${id}`),
    restore: (id) => api.post(`/shipments/${id}/restore`),
    addNote: (id, data) => api.post(`/shipments/${id}/notes`, data),
    markReconciled: (id, data) => api.post(`/shipments/${id}/reconcile`, data),
    bulkReconcile: (data) => api.post('/shipments/reconcile', data),
    getStats: (params) => api.get('/shipments/stats', { params }),
    getCarriers: () => api.get('/shipments/carriers'),
    bulkUpdateStatus: (data) => api.post('/shipments/bulk-status', data),
    sync: (data) => api.post('/shipments/sync', data),
};

export const shippingApi = {
    getSettings: () => api.get('/shipping-settings'),
    updateIntegration: (carrierCode, data) => api.put(`/shipping-settings/integrations/${carrierCode}`, data),
    testIntegration: (carrierCode) => api.post(`/shipping-settings/integrations/${carrierCode}/test`),
};

export const authApi = {
    login: (credentials) => api.post('/login', credentials),
    register: (data) => api.post('/register', data),
    logout: () => api.post('/logout'),
    getUser: () => api.get('/user'),
};

export const cartApi = {
    get: () => api.get('/cart'),
    add: (data) => api.post('/cart/add', data),
    update: (data) => api.post('/cart/update', data),
    remove: (cartItemId) => api.post('/cart/remove', { cart_item_id: cartItemId }),
};

export const aiApi = {
    getStatus: () => api.get('/ai/status'),
    chat: (data) => api.post('/ai/chat', data),
    generateContent: (data) => api.post('/ai/generate-content', data),
    readInvoice: (data) => api.post('/ai/read-invoice', data, multipartConfig(data)),
    generateProductDescription: (data) => api.post('/ai/generate-product-description', data),
    rewriteProductDescription: (data) => api.post('/ai/rewrite-product-description', data),
    getHistory: (chatId) => api.get(`/ai/history/${chatId}`),
};

export const cmsApi = {
    banners: {
        getAll: (params) => api.get('/banners', { params }),
        getOne: (id) => api.get(`/banners/${id}`),
        store: (data) => api.post('/banners', data),
        update: (id, data) => api.put(`/banners/${id}`, data),
        destroy: (id) => api.delete(`/banners/${id}`),
    },
    settings: {
        get: (params) => api.get('/site-settings', { params }),
        update: (data) => api.post('/site-settings', data),
    },
    domains: {
        getAll: () => api.get('/site-domains'),
        store: (data) => api.post('/site-domains', data),
        update: (id, data) => api.put(`/site-domains/${id}`, data),
        destroy: (id) => api.delete(`/site-domains/${id}`),
    }
};

export const menuApi = {
    getAll: () => api.get('/menus'),
    getOne: (id) => api.get(`/menus/${id}`),
    getByCode: (code) => api.get(`/menus/code/${code}`),
    getActive: () => api.get('/menus/active'),
    store: (data) => api.post('/menus', data),
    update: (id, data) => api.put(`/menus/${id}`, data),
    destroy: (id) => api.delete(`/menus/${id}`),
    saveItems: (id, items) => api.post(`/menus/${id}/items`, { items }),
};

export const userApi = {
    getAll: () => api.get('/users'),
    store: (data) => api.post('/users', data),
    update: (id, data) => api.put(`/users/${id}`, data),
    destroy: (id) => api.delete(`/users/${id}`),
};

export const mediaApi = {
    upload: (formData) => api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    }),
};

export const quoteTemplateApi = {
    getAll: () => api.get('/quote-templates'),
    store: (data) => api.post('/quote-templates', data),
    update: (id, data) => api.put(`/quote-templates/${id}`, data),
    destroy: (id) => api.delete(`/quote-templates/${id}`),
};

export default api;
