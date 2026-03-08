import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:8002/api',
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

export const productApi = {
    getAll: (params) => api.get('/products', { params }),
    getOne: (id) => api.get(`/products/${id}`),
    store: (data) => api.post('/products', data),
    update: (id, data) => api.post(`/products/${id}`, data), // POST for multipart support
    destroy: (id) => api.delete(`/products/${id}`),
};

export const productImageApi = {
    upload: (productId, formData) => api.post(`/products/${productId}/images`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    }),
    setPrimary: (id) => api.post(`/product-images/${id}/primary`),
    destroy: (id) => api.delete(`/product-images/${id}`),
};

export const categoryApi = {
    getAll: () => api.get('/categories'),
    getOne: (id) => api.get(`/categories/${id}`),
    store: (data) => api.post('/categories', data),
    update: (id, data) => api.put(`/categories/${id}`, data),
    destroy: (id) => api.delete(`/categories/${id}`),
    reorder: (items) => api.post('/categories/reorder', { items }),
};

export const attributeApi = {
    getAll: () => api.get('/attributes'),
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
    getAll: () => api.get('/warehouses'),
    getOne: (id) => api.get(`/warehouses/${id}`),
    store: (data) => api.post('/warehouses', data),
    update: (id, data) => api.put(`/warehouses/${id}`, data),
    destroy: (id) => api.delete(`/warehouses/${id}`),
    getInventory: (id) => api.get(`/warehouses/${id}/inventory`),
    updateInventory: (id, data) => api.post(`/warehouses/${id}/inventory`, data),
};

export const orderApi = {
    getAll: (params) => api.get('/orders', { params }),
    getOne: (id) => api.get(`/orders/${id}`),
    store: (data) => api.post('/orders', data),
    updateStatus: (id, status) => api.put(`/orders/${id}/status`, { status }),
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
    getOne: (id) => api.get(`/blog/${id}`),
    store: (data) => api.post('/blog', data),
    update: (id, data) => api.put(`/blog/${id}`, data),
    destroy: (id) => api.delete(`/blog/${id}`),
};

export const reportApi = {
    getDashboard: () => api.get('/reports/dashboard'),
    getInventory: () => api.get('/reports/inventory'),
    getTopProducts: () => api.get('/reports/top-products'),
    getSales: (days) => api.get('/reports/sales', { params: { days } }),
};

export const invoiceApi = {
    getAll: (params) => api.get('/invoices', { params }),
    getOne: (id) => api.get(`/invoices/${id}`),
    markAsPaid: (id) => api.post(`/invoices/${id}/paid`),
};

export const shipmentApi = {
    getAll: (params) => api.get('/shipments', { params }),
    getOne: (id) => api.get(`/shipments/${id}`),
    store: (data) => api.post('/shipments', data),
    updateStatus: (id, status) => api.put(`/shipments/${id}/status`, { status }),
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
    chat: (data) => api.post('/ai/chat', data),
    generateProductDescription: (data) => api.post('/ai/generate-product-description', data),
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

export default api;
