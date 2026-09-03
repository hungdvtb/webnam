import axios from 'axios';

const DEFAULT_API_BASE_URL = '/api';
const ADMIN_HOST_PATTERN = /(^|\.)admin\.gomdaithanh\.com$/i;
const API_HOST_PATTERN = /(^|\.)api\.gomdaithanh\.com$/i;
const LOOPBACK_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i;
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;
const STOREFRONT_API_PATH_PATTERN = /(^|\/)storefront\//i;
const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '');
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ERR_CONNECTION_ABORTED',
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_RESET',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_NETWORK',
    'ERR_NETWORK_CHANGED',
    'ETIMEDOUT',
]);
const RETRYABLE_NETWORK_MESSAGE_FRAGMENTS = [
    'network changed',
    'network error',
    'failed to fetch',
    'load failed',
    'timeout',
];
const IDEMPOTENT_HTTP_METHODS = new Set(['get', 'head', 'options']);
const LOCAL_QUICK_REPLY_BRIDGE_BASE_URLS = String(
    import.meta.env.VITE_QUICK_REPLY_LOCAL_BRIDGE_URLS
    || 'http://127.0.0.1:8003/api,http://localhost:8003/api'
)
    .split(',')
    .map((url) => trimTrailingSlash(url))
    .filter(Boolean);
const LOCAL_QUICK_REPLY_BRIDGE_TIMEOUT_MS = Number(
    import.meta.env.VITE_QUICK_REPLY_LOCAL_BRIDGE_TIMEOUT_MS || 6500
);

const normalizeHostname = (value) => String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
const isLoopbackHostname = (value) => LOOPBACK_HOST_PATTERN.test(normalizeHostname(value));

const shouldUseSameOriginFallback = (value) => {
    if (typeof window === 'undefined' || !ABSOLUTE_HTTP_URL_PATTERN.test(value)) {
        return false;
    }

    try {
        const configuredUrl = new URL(value, window.location.origin);
        const currentHostname = normalizeHostname(window.location.hostname);
        const isKnownHostedEnv = ADMIN_HOST_PATTERN.test(currentHostname) || API_HOST_PATTERN.test(currentHostname);

        return isLoopbackHostname(configuredUrl.hostname)
            && (isKnownHostedEnv || !isLoopbackHostname(currentHostname));
    } catch {
        return false;
    }
};

const resolveApiBaseUrl = (value) => {
    const resolvedValue = trimTrailingSlash(value || DEFAULT_API_BASE_URL) || DEFAULT_API_BASE_URL;

    if (shouldUseSameOriginFallback(resolvedValue)) {
        return DEFAULT_API_BASE_URL;
    }

    return resolvedValue;
};

const configuredApiBaseUrl = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL);

// Respect an explicit API origin in env so local dev can bypass the Vite proxy when needed.
export const API_BASE_URL = resolveApiBaseUrl(configuredApiBaseUrl || DEFAULT_API_BASE_URL);

const configuredStorageBaseUrl = trimTrailingSlash(import.meta.env.VITE_STORAGE_BASE_URL);
const resolvedStorageBaseUrl = configuredStorageBaseUrl
    ? resolveApiBaseUrl(configuredStorageBaseUrl)
    : API_BASE_URL.replace(/\/api$/, '');

export const STORAGE_BASE_URL = resolvedStorageBaseUrl.replace(/\/$/, '');

const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
});

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const postLocalQuickReplyBridge = async (path, data = {}) => {
    let lastError = null;

    for (const baseURL of LOCAL_QUICK_REPLY_BRIDGE_BASE_URLS) {
        try {
            return await axios.post(`${baseURL}${path}`, data, {
                timeout: Number.isFinite(LOCAL_QUICK_REPLY_BRIDGE_TIMEOUT_MS)
                    ? LOCAL_QUICK_REPLY_BRIDGE_TIMEOUT_MS
                    : 6500,
                withCredentials: false,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Quick-Reply-Local-Bridge': '1',
                },
            });
        } catch (error) {
            lastError = error;

            if (error?.response && ![404, 405].includes(Number(error.response.status))) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Không kết nối được local bridge trả lời nhanh.');
};

const normalizeRequestMethod = (method) => String(method || 'get').trim().toLowerCase();

const isStorefrontApiRequest = (url = '') => STOREFRONT_API_PATH_PATTERN.test(String(url || '').replace(/^\/+/, ''));

const resolveCurrentPublicHost = () => {
    if (typeof window === 'undefined') {
        return '';
    }

    const host = String(window.location?.host || '').trim();
    const hostname = normalizeHostname(window.location?.hostname || '');

    if (!host || !hostname || isLoopbackHostname(hostname) || ADMIN_HOST_PATTERN.test(hostname)) {
        return '';
    }

    return host;
};

const resolveRetryLimit = (config = {}) => {
    const resolvedLimit = Number(config.maxRetries);

    if (Number.isFinite(resolvedLimit)) {
        return Math.max(Math.trunc(resolvedLimit), 0);
    }

    return 3;
};

const requestAllowsRetry = (config = {}) => {
    if (config.retryPolicy === 'never') {
        return false;
    }

    if (config.retryPolicy === 'idempotent') {
        return true;
    }

    return IDEMPOTENT_HTTP_METHODS.has(normalizeRequestMethod(config.method));
};

const parseRetryAfterMs = (value) => {
    if (value === null || value === undefined) {
        return null;
    }

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue >= 0) {
        return numericValue * 1000;
    }

    const retryDate = Date.parse(String(value));
    if (Number.isNaN(retryDate)) {
        return null;
    }

    return Math.max(retryDate - Date.now(), 0);
};

const resolveRetryDelayMs = (error, retryCount) => {
    const retryAfterHeader = parseRetryAfterMs(error?.response?.headers?.['retry-after']);

    if (retryAfterHeader !== null) {
        return Math.min(retryAfterHeader, 15000);
    }

    const normalizedRetryCount = Math.max(Number(retryCount) || 1, 1);
    const baseDelayMs = Math.min(500 * (2 ** (normalizedRetryCount - 1)), 6000);
    const jitterMs = Math.min(Math.round(baseDelayMs * 0.25), 500);

    return baseDelayMs + jitterMs;
};

export const isRetryableNetworkError = (error) => {
    if (!error || axios.isCancel(error) || error?.code === 'ERR_CANCELED') {
        return false;
    }

    if (error?.response) {
        return false;
    }

    const normalizedCode = String(error?.code || '').trim().toUpperCase();
    if (RETRYABLE_NETWORK_ERROR_CODES.has(normalizedCode)) {
        return true;
    }

    const normalizedMessage = String(error?.message || '').trim().toLowerCase();
    return RETRYABLE_NETWORK_MESSAGE_FRAGMENTS.some((fragment) => normalizedMessage.includes(fragment));
};

export const isRetryableResponseError = (error) => {
    const status = Number(error?.response?.status || 0);
    return RETRYABLE_STATUS_CODES.has(status);
};

export const isRetryableRequestError = (error) => (
    isRetryableNetworkError(error) || isRetryableResponseError(error)
);

export const describeApiConnectionError = (error) => {
    if (isRetryableNetworkError(error)) {
        return `Khong ket noi duoc backend API (${API_BASE_URL}). Kiem tra frontend :3003 va backend :8003 co dang chay dung port khong.`;
    }

    const status = Number(error?.response?.status || 0);
    if ([502, 503, 504].includes(status)) {
        return `Backend API dang gian doan (${status}). He thong se tu giam tan suat polling.`;
    }

    return error?.response?.data?.message
        || error?.response?.data?.error
        || error?.message
        || 'Khong the ket noi backend API.';
};

const shouldRetryRequest = (error) => {
    const config = error?.config;
    if (!config || config.signal?.aborted || !requestAllowsRetry(config)) {
        return false;
    }

    const retryCount = Number(config.__retryCount || 0);
    if (retryCount >= resolveRetryLimit(config)) {
        return false;
    }

    return isRetryableRequestError(error);
};

// Interceptor to add Bearer token if present
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    const activeAccountId = String(localStorage.getItem('activeAccountId') || '').trim();
    if (activeAccountId && !['all', 'default', '0'].includes(activeAccountId)) {
        config.headers['X-Account-Id'] = activeAccountId;
    }

    const activeSiteCode = localStorage.getItem('activeSiteCode');
    if (activeSiteCode) {
        config.headers['X-Site-Code'] = activeSiteCode;
    }

    if (isStorefrontApiRequest(config.url)) {
        const publicHost = resolveCurrentPublicHost();
        if (publicHost) {
            config.headers['X-Public-Host'] = publicHost;
        }
    }

    return config;
});

const isAuthRouteRequest = (url = '') => {
    const normalizedUrl = String(url || '');

    return normalizedUrl.endsWith('/login')
        || normalizedUrl.endsWith('/register')
        || normalizedUrl.includes('/accounts/resolve/');
};

const handleUnauthorizedApiResponse = (error) => {
    if (typeof window === 'undefined') {
        return;
    }

    if ((error?.response?.status ?? 0) !== 401) {
        return;
    }

    if (isAuthRouteRequest(error?.config?.url)) {
        return;
    }

    const existingToken = window.localStorage.getItem('token');
    if (!existingToken) {
        return;
    }

    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const loginPath = window.location.pathname.startsWith('/admin') ? '/old/login' : '/login';

    window.localStorage.removeItem('token');
    window.localStorage.removeItem('user');
    window.sessionStorage.setItem('auth_notice', 'session-expired');
    window.sessionStorage.setItem('post_login_redirect', currentPath);
    window.location.assign(loginPath);
};

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const config = error?.config;

        if (config && shouldRetryRequest(error)) {
            config.__retryCount = Number(config.__retryCount || 0) + 1;
            await sleep(resolveRetryDelayMs(error, config.__retryCount));

            return api(config);
        }

        handleUnauthorizedApiResponse(error);
        return Promise.reject(error);
    }
);

const multipartConfig = (data) => (
    data instanceof FormData
        ? { headers: { 'Content-Type': undefined } }
        : undefined
);

const sanitizeProductUpdatePayload = (data) => {
    if (data instanceof FormData) {
        const rawStockQuantity = data.get('stock_quantity');
        if (typeof rawStockQuantity === 'string' && rawStockQuantity.trim() === '') {
            data.delete('stock_quantity');
        }

        return data;
    }

    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const normalizedData = { ...data };
        if (
            normalizedData.stock_quantity === ''
            || normalizedData.stock_quantity === null
            || normalizedData.stock_quantity === undefined
        ) {
            delete normalizedData.stock_quantity;
        }

        return normalizedData;
    }

    return data;
};

const requestCache = {
    orderBootstrap: new Map(),
    orderDetail: new Map(),
    receiptBootstrap: new Map(),
};

const ORDER_BOOTSTRAP_CACHE_TTL_MS = 60 * 1000;
const ORDER_DETAIL_CACHE_TTL_MS = 30 * 1000;
const RECEIPT_BOOTSTRAP_CACHE_TTL_MS = 60 * 1000;

const resolveActiveApiCacheNamespace = () => {
    if (typeof window === 'undefined') return 'server';

    const activeAccountId = window.localStorage.getItem('activeAccountId') || 'default';
    const activeSiteCode = window.localStorage.getItem('activeSiteCode') || 'default';

    return `${activeAccountId}::${activeSiteCode}`;
};

const readCachedResponse = (cache, key) => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }

    if (entry.response) return Promise.resolve(entry.response);
    return entry.promise || null;
};

const primeCachedRequest = (cache, key, loader, ttlMs) => {
    const cached = readCachedResponse(cache, key);
    if (cached) return cached;

    const promise = loader();
    const expiresAt = Date.now() + ttlMs;
    cache.set(key, { promise, expiresAt });

    promise
        .then((response) => {
            const currentEntry = cache.get(key);
            if (currentEntry?.promise === promise) {
                cache.set(key, { response, expiresAt: Date.now() + ttlMs });
            }
        })
        .catch(() => {
            const currentEntry = cache.get(key);
            if (currentEntry?.promise === promise) {
                cache.delete(key);
            }
        });

    return promise;
};

const invalidateCachedResponse = (cache, key) => {
    cache.delete(key);
};

const orderBootstrapCacheKey = (params = {}) => {
    const mode = String(params?.mode || 'list').toLowerCase() === 'form' ? 'form' : 'list';
    return `${resolveActiveApiCacheNamespace()}::${mode}`;
};

const orderDetailCacheKey = (id) => `${resolveActiveApiCacheNamespace()}::${id}`;
const invalidateOrderDetailIds = (ids) => {
    const normalizedIds = Array.isArray(ids) ? ids : [ids];
    normalizedIds.forEach((id) => {
        if (!id) return;
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
    });
};
const collectBatchReturnOrderIds = (payload, fallbackIds = []) => {
    const sourceRows = Array.isArray(payload?.source_orders)
        ? payload.source_orders
        : (Array.isArray(payload?.orders) ? payload.orders : []);
    const responseIds = sourceRows.map((order) => order?.id).filter(Boolean);

    return responseIds.length ? responseIds : fallbackIds;
};
const receiptBootstrapCacheKey = (params = {}) => (
    `${resolveActiveApiCacheNamespace()}::${params?.include_references ? 'with-references' : 'base'}`
);

export const productApi = {
    getAll: (params, signal) => api.get('/products', { params, signal }),
    getOne: (id, params) => api.get(`/products/${id}`, params ? { params } : undefined),
    downloadExcel: (params) => api.get('/products/export', { params, responseType: 'blob' }),
    downloadImportTemplate: () => api.get('/products/import/template', { responseType: 'blob' }),
    importExcel: (data) => api.post('/products/import', data, multipartConfig(data)),
    refreshOrderItems: (data) => api.post('/products/refresh-order-items', data),
    convertToConfigurable: (id, data) => api.post(`/products/${id}/convert-to-configurable`, data, multipartConfig(data)),
    store: (data) => api.post('/products', data, multipartConfig(data)),
    update: (id, data) => {
        const normalizedData = sanitizeProductUpdatePayload(data);
        return api.post(`/products/${id}`, normalizedData, multipartConfig(normalizedData));
    }, // POST for multipart support
    destroy: (id) => api.delete(`/products/${id}`),
    duplicate: (id) => api.post(`/products/${id}/duplicate`),
    regenerateAiReviews: (id, data = {}) => api.post(`/products/${id}/reviews/ai/regenerate`, data, {
        timeout: 20 * 60 * 1000,
        retryPolicy: 'never',
    }),
    restore: (id) => api.post(`/products/${id}/restore`),
    forceDelete: (id) => api.delete(`/products/${id}/force`),
    bulkDelete: (ids) => api.delete('/products/bulk-delete', { data: { ids } }),
    bulkRestore: (ids) => api.post('/products/bulk-restore', { ids }),
    bulkForceDelete: (ids) => api.delete('/products/bulk-force-delete', { data: { ids } }),
    bulkUpdateAttributes: (data) => api.post('/products/bulk-update-attributes', data),
    bulkUpdateUndo: (logId) => api.post('/products/bulk-update-undo', { log_id: logId }),
    getSortItems: () => api.get('/products/sort-items'),
    reorder: (productIds) => api.post('/products/reorder', { product_ids: productIds }),
};

export const productCategoryCloneApi = {
    preview: (data) => api.post('/products/category-clone/preview', data),
    apply: (data) => api.post('/products/category-clone/apply', data),
};

export const productReplacementApi = {
    getAll: (params, signal) => api.get('/product-replacements', { params, signal }),
    create: (data) => api.post('/product-replacements', data),
    update: (id, data) => api.put(`/product-replacements/${id}`, data),
    destroy: (id) => api.delete(`/product-replacements/${id}`),
    lookup: (params, signal) => api.get('/product-replacements/lookup', { params, signal }),
};

export const productGroupApi = {
    getAll: () => api.get('/product-groups'),
    getOne: (id) => api.get(`/product-groups/${id}`),
};

export const productSeoBulkApi = {
    listRuns: (params) => api.get('/products/seo-bulk/runs', { params }),
    createRun: (data, config = {}) => api.post('/products/seo-bulk/runs', data, {
        retryPolicy: 'idempotent',
        ...config,
    }),
    getRun: (runId, params) => api.get(`/products/seo-bulk/runs/${runId}`, { params }),
    cancelRun: (runId) => api.post(`/products/seo-bulk/runs/${runId}/cancel`),
};

export const googleMerchantApi = {
    getSettings: () => api.get('/google-merchant/settings'),
    updateSettings: (data) => (
        data instanceof FormData
            ? api.post('/google-merchant/settings', data, multipartConfig(data))
            : api.put('/google-merchant/settings', data)
    ),
    testConnection: () => api.post('/google-merchant/test'),
    registerGcp: (data = {}) => api.post('/google-merchant/register-gcp', data, {
        retryPolicy: 'never',
    }),
    listDataSources: () => api.get('/google-merchant/data-sources'),
    syncProduct: (id, data = {}) => api.post(`/google-merchant/products/${id}/sync`, data, {
        retryPolicy: 'never',
    }),
    syncProducts: (data = {}, config = {}) => api.post('/google-merchant/products/sync', data, {
        retryPolicy: 'never',
        ...config,
    }),
    getLogs: (params) => api.get('/google-merchant/logs', { params }),
};

export const metaCatalogApi = {
    getSettings: () => api.get('/meta-catalog/settings'),
    updateSettings: (data) => api.put('/meta-catalog/settings', data),
    dryRun: (data = {}) => api.post('/meta-catalog/dry-run', data, {
        retryPolicy: 'never',
        timeout: 120000,
    }),
    syncNow: () => api.post('/meta-catalog/sync-now', {}, {
        retryPolicy: 'never',
        timeout: 180000,
    }),
    checkFeed: (format) => api.post(`/meta-catalog/feed/${format}/check`, {}, {
        retryPolicy: 'never',
        timeout: 60000,
    }),
    getLogs: (params) => api.get('/meta-catalog/logs', { params }),
};

export const productImageApi = {
    upload: (productId, formData) => api.post(`/products/${productId}/images`, formData, multipartConfig(formData)),
    syncProductImages: (productId, formData) => api.post(`/products/${productId}/images/sync`, formData, multipartConfig(formData)),
    bulkAppendPreview: (formData, config = {}) => api.post('/product-images/bulk-append/preview', formData, {
        ...multipartConfig(formData),
        ...config,
    }),
    bulkAppendApply: (formData, config = {}) => api.post('/product-images/bulk-append/apply', formData, {
        ...multipartConfig(formData),
        ...config,
    }),
    bulkRefreshPreview: (formData, config = {}) => api.post('/product-images/bulk-refresh/preview', formData, {
        ...multipartConfig(formData),
        ...config,
    }),
    bulkRefreshApply: (formData, config = {}) => api.post('/product-images/bulk-refresh/apply', formData, {
        ...multipartConfig(formData),
        ...config,
    }),
    setPrimary: (id) => api.post(`/product-images/${id}/primary`),
    destroy: (id) => api.delete(`/product-images/${id}`),
    reorder: (ids) => api.post('/product-images/reorder', { ids }),
};

const isAdminRoute = () => (
    typeof window !== 'undefined' && window.location?.pathname?.startsWith('/admin')
);

const withAdminCategoryListParams = (params) => {
    const nextParams = { ...(params || {}) };

    if (isAdminRoute()) {
        nextParams.include_link_only = 1;
    }

    return Object.keys(nextParams).length > 0 ? nextParams : undefined;
};

export const categoryApi = {
    getAll: (params) => {
        const nextParams = withAdminCategoryListParams(params);
        return api.get('/categories', nextParams ? { params: nextParams } : {});
    },
    getOne: (id) => api.get(`/categories/${id}`),
    getProducts: (id) => api.get(`/categories/${id}/products`),
    downloadExcel: (params) => api.get('/categories/export', { params, responseType: 'blob' }),
    downloadImportTemplate: () => api.get('/categories/import/template', { responseType: 'blob' }),
    importExcel: (data) => api.post('/categories/import', data, multipartConfig(data)),
    store: (data) => api.post('/categories', data, multipartConfig(data)),
    update: (id, data) => api.post(`/categories/${id}`, data, multipartConfig(data)),
    destroy: (id) => api.delete(`/categories/${id}`),
    bulkDelete: (ids) => api.delete('/categories/bulk-delete', { data: { ids } }),
    restore: (id) => api.post(`/categories/${id}/restore`),
    bulkRestore: (ids) => api.post('/categories/bulk-restore', { ids }),
    duplicate: (id, data = {}) => api.post(`/categories/${id}/duplicate`, data),
    reorder: (items) => api.post('/categories/reorder', { items }),
    reorderProducts: (id, items) => {
        const normalizedItems = Array.isArray(items) ? items : [];

        if (normalizedItems.every((item) => typeof item === 'number')) {
            return api.post(`/categories/${id}/products/reorder`, { product_ids: normalizedItems });
        }

        return api.post(`/categories/${id}/products/reorder`, { items: normalizedItems });
    },
    publicTree: {
        get: (domainId) => api.get(`/public-category-trees/${domainId}`),
        update: (domainId, data) => api.put(`/public-category-trees/${domainId}`, data),
    },
};

export const attributeApi = {
    getAll: (params) => api.get('/attributes', { params }),
    getOne: (id) => api.get(`/attributes/${id}`),
    store: (data) => api.post('/attributes', data),
    reorder: (data) => api.post('/attributes/reorder', data),
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

export const warehouseShelfApi = {
    getAll: (params, signal) => api.get('/warehouse-shelves', { params, signal }),
    search: (params, signal) => api.get('/warehouse-shelves/search', { params, signal }),
    getOne: (id) => api.get(`/warehouse-shelves/${id}`),
    create: (data) => api.post('/warehouse-shelves', data),
    update: (id, data) => api.put(`/warehouse-shelves/${id}`, data),
    destroy: (id) => api.delete(`/warehouse-shelves/${id}`),
    assign: (id, data) => api.post(`/warehouse-shelves/${id}/assign`, data),
    removeLocation: (id) => api.delete(`/warehouse-shelf-locations/${id}`),
};

export const orderApi = {
    getBootstrap: (params) => api.get('/orders/bootstrap', { params }),
    getBootstrapCached: (params) => primeCachedRequest(
        requestCache.orderBootstrap,
        orderBootstrapCacheKey(params),
        () => api.get('/orders/bootstrap', { params }),
        ORDER_BOOTSTRAP_CACHE_TTL_MS
    ),
    preloadBootstrap: (params) => primeCachedRequest(
        requestCache.orderBootstrap,
        orderBootstrapCacheKey(params),
        () => api.get('/orders/bootstrap', { params }),
        ORDER_BOOTSTRAP_CACHE_TTL_MS
    ).catch(() => null),
    invalidateBootstrap: (params) => {
        if (!params) {
            requestCache.orderBootstrap.clear();
            return;
        }

        invalidateCachedResponse(requestCache.orderBootstrap, orderBootstrapCacheKey(params));
    },
    getAll: (params, signal) => api.get('/orders', { params, signal }),
    getOne: (id) => api.get(`/orders/${id}`),
    getOneCached: (id) => primeCachedRequest(
        requestCache.orderDetail,
        orderDetailCacheKey(id),
        () => api.get(`/orders/${id}`),
        ORDER_DETAIL_CACHE_TTL_MS
    ),
    preloadOne: (id) => {
        if (!id) return Promise.resolve(null);

        return primeCachedRequest(
            requestCache.orderDetail,
            orderDetailCacheKey(id),
            () => api.get(`/orders/${id}`),
            ORDER_DETAIL_CACHE_TTL_MS
        ).catch(() => null);
    },
    invalidateOne: (id) => {
        if (!id) return;
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
    },
    invalidateAllDetails: () => {
        requestCache.orderDetail.clear();
    },
    getInventorySlips: (id) => api.get(`/orders/${id}/inventory-slips`),
    createInventorySlip: (id, data) => api.post(`/orders/${id}/inventory-slips`, data).then((response) => {
        invalidateOrderDetailIds(id);
        return response;
    }),
    deleteInventorySlip: (id, documentId) => api.delete(`/orders/${id}/inventory-slips/${documentId}`).then((response) => {
        invalidateOrderDetailIds(id);
        return response;
    }),
    quickSelect: (data) => api.post('/orders/quick-select', data),
    aiPreview: (data) => api.post('/orders/ai/preview', data, multipartConfig(data)),
    aiRuleTrainPreview: (data) => api.post('/orders/ai/rules/train-preview', data, multipartConfig(data)),
    getAiRules: () => api.get('/orders/ai/rules'),
    updateAiRules: (data) => api.put('/orders/ai/rules', data),
    previewBatchReturn: (data) => api.post('/orders/inventory-returns/batch-preview', data),
    createBatchReturn: (data) => api.post('/orders/inventory-returns/batch', data).then((response) => {
        invalidateOrderDetailIds(collectBatchReturnOrderIds(response.data, data?.order_ids || []));
        return response;
    }),
    getBatchReturn: (documentId) => api.get(`/orders/inventory-returns/${documentId}`),
    updateBatchReturn: (documentId, data) => api.put(`/orders/inventory-returns/${documentId}`, data).then((response) => {
        invalidateOrderDetailIds(collectBatchReturnOrderIds(response.data));
        return response;
    }),
    getPrintData: (ids) => api.post('/orders/print-data', { ids }),
    markPrinted: (ids) => api.post('/orders/mark-printed', { ids }).then((response) => {
        const normalizedIds = Array.isArray(ids) ? ids : [ids];
        normalizedIds.forEach((id) => {
            if (!id) return;
            invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
        });

        return response;
    }),
    store: (data) => api.post('/orders', data),
    update: (id, data) => api.put(`/orders/${id}`, data).then((response) => {
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
        return response;
    }),
    destroy: (id) => api.delete(`/orders/${id}`).then((response) => {
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
        return response;
    }),
    forceDelete: (id) => api.delete(`/orders/${id}/force`).then((response) => {
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
        return response;
    }),
    updateStatus: (id, payloadOrStatus) => {
        const payload = (payloadOrStatus && typeof payloadOrStatus === 'object')
            ? payloadOrStatus
            : { status: payloadOrStatus };
        return api.put(`/orders/${id}/status`, payload);
    },
    duplicate: (id, data = {}) => api.post(`/orders/${id}/duplicate`, data),
    convert: (id, data) => api.post(`/orders/${id}/convert`, data).then((response) => {
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
        return response;
    }),
    restore: (id) => api.post(`/orders/${id}/restore`).then((response) => {
        invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
        return response;
    }),
    bulkDelete: (ids, force = false) => api.post('/orders/bulk-delete', { ids, force: force ? 1 : 0 }),
    bulkRestore: (ids) => api.post('/orders/bulk-restore', { ids }),
    bulkDuplicate: (ids, targetKind = null) => api.post('/orders/bulk-duplicate', targetKind ? { ids, target_kind: targetKind } : { ids }),
    bulkConvert: (ids, targetKind, data = {}) => api.post('/orders/bulk-convert', { ids, target_kind: targetKind, ...data }),
    bulkUpdate: (data) => api.post('/orders/bulk-update', data).then((response) => {
        (Array.isArray(data?.ids) ? data.ids : []).forEach((id) => {
            if (id) {
                invalidateCachedResponse(requestCache.orderDetail, orderDetailCacheKey(id));
            }
        });

        return response;
    }),
    refreshImportCosts: (data) => api.post('/orders/refresh-import-costs', data).then((response) => {
        requestCache.orderDetail.clear();
        return response;
    }),
    dispatchPreview: (data) => api.post('/orders/dispatch/preview', data),
    dispatch: (data) => api.post('/orders/dispatch', data),
    cancelDispatch: (data) => api.post('/orders/dispatch/cancel', data),
    quickDispatch: (data) => api.post('/orders/quick-dispatch', data),
    getShippingAlerts: (params) => api.get('/orders/shipping-alerts', { params }),
    getReturnFollowups: (params, signal) => api.get('/orders/return-followups', { params, signal }),
    getConnectedCarriers: () => api.get('/orders/connected-carriers'),
    exportViettelPost: (ids, goodsName) => api.post('/orders/export-viettelpost', { ids, goods_name: goodsName }, { responseType: 'blob' }),
};

export const orderAiTrainingApi = {
    getAll: (params) => api.get('/orders/ai/training', { params }),
    getOne: (id) => api.get(`/orders/ai/training/${id}`),
    preview: (data) => api.post('/orders/ai/training/preview', data, multipartConfig(data)),
    getDefinitions: () => api.get('/orders/ai/training/definitions'),
    updateDefinitions: (data) => api.put('/orders/ai/training/definitions', data),
    create: (data) => api.post('/orders/ai/training', data, multipartConfig(data)),
    update: (id, data) => api.post(`/orders/ai/training/${id}`, data, multipartConfig(data)),
    destroy: (id) => api.delete(`/orders/ai/training/${id}`),
};

export const leadApi = {
    getAll: (params, signal) => api.get('/leads', { params, signal }),
    getOne: (id) => api.get(`/leads/${id}`),
    update: (id, data) => api.put(`/leads/${id}`, data),
    destroy: (id) => api.delete(`/leads/${id}`),
    restore: (id) => api.post(`/leads/${id}/restore`),
    bulkDelete: (ids) => api.post('/leads/bulk-delete', { ids }),
    bulkRestore: (ids) => api.post('/leads/bulk-restore', { ids }),
    realtime: (params, config = {}) => api.get('/leads/realtime', { params, ...config }),
    getNotifications: (params, config = {}) => api.get('/leads/notifications', params ? { params, ...config } : config),
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

export const telesalesApi = {
    bootstrap: () => api.get('/telesales/bootstrap'),
    getAll: (params, signal) => api.get('/telesales/leads', { params, signal }),
    getOne: (id) => api.get(`/telesales/leads/${id}`),
    importLeads: (data) => api.post('/telesales/leads/import', data),
    update: (id, data) => api.put(`/telesales/leads/${id}`, data),
    completeTask: (id, taskId, data = {}) => api.post(`/telesales/leads/${id}/tasks/${taskId}/complete`, data),
    deleteLatestNote: (id) => api.delete(`/telesales/leads/${id}/latest-note`),
    deleteNote: (id, noteId) => api.delete(`/telesales/leads/${id}/notes/${noteId}`),
    getStatuses: () => api.get('/lead-statuses'),
    createStatus: (data) => api.post('/lead-statuses', data),
    updateStatus: (id, data) => api.put(`/lead-statuses/${id}`, data),
    deleteStatus: (id) => api.delete(`/lead-statuses/${id}`),
    getPotentials: () => api.get('/lead-potentials'),
    createPotential: (data) => api.post('/lead-potentials', data),
    updatePotential: (id, data) => api.put(`/lead-potentials/${id}`, data),
    deletePotential: (id) => api.delete(`/lead-potentials/${id}`),
};

export const quickReplyApi = {
    bootstrap: () => api.get('/quick-replies/bootstrap'),
    getAll: (params, signal) => api.get('/quick-replies', { params, signal }),
    store: (data) => api.post('/quick-replies', data),
    importPancake: (data) => api.post('/quick-replies/import-pancake', data, multipartConfig(data)),
    splitZalo: (data = {}) => api.post('/quick-replies/split-zalo', data),
    localWindowBridgeSplitZalo: (data = {}) => postLocalQuickReplyBridge('/quick-replies/local-window-bridge/split-zalo', data),
    getZaloMirrorScreenshot: (params = {}) => api.get('/quick-replies/zalo-mirror/screenshot', { params, responseType: 'blob' }),
    clickZaloMirror: (data = {}) => api.post('/quick-replies/zalo-mirror/click', data),
    typeZaloMirror: (data = {}) => api.post('/quick-replies/zalo-mirror/type', data),
    update: (id, data) => api.put(`/quick-replies/${id}`, data),
    destroy: (id) => api.delete(`/quick-replies/${id}`),
    bulkDelete: (data) => api.post('/quick-replies/bulk-delete', data),
    restore: (id) => api.post(`/quick-replies/${id}/restore`),
    bulkRestore: (data) => api.post('/quick-replies/bulk-restore', data),
    gallery: (params, signal) => api.get('/quick-replies/gallery', { params, signal }),
    createGalleryFolder: (data) => api.post('/quick-replies/gallery/folders', data),
    updateGalleryFolder: (id, data) => api.put(`/quick-replies/gallery/folders/${id}`, data),
    deleteGalleryFolder: (id) => api.delete(`/quick-replies/gallery/folders/${id}`),
    uploadGalleryImages: (data, config = {}) => {
        const uploadConfig = multipartConfig(data) || {};
        return api.post('/quick-replies/gallery/images', data, {
            ...uploadConfig,
            ...config,
            headers: {
                ...(uploadConfig.headers || {}),
                ...(config.headers || {}),
            },
        });
    },
    updateGalleryImage: (id, data) => api.put(`/quick-replies/gallery/images/${id}`, data),
    deleteGalleryImage: (id) => api.delete(`/quick-replies/gallery/images/${id}`),
    copyGalleryImages: (data) => api.post('/quick-replies/gallery/images/copy', data),
    sendGalleryImagesToZalo: (data) => api.post('/quick-replies/gallery/images/send-to-zalo', data),
    duplicate: (id) => api.post(`/quick-replies/${id}/duplicate`),
    recordUse: (id) => api.post(`/quick-replies/${id}/use`),
    copyImages: (id, data = {}) => api.post(`/quick-replies/${id}/copy-images`, data),
    sendToZalo: (id, data = {}) => api.post(`/quick-replies/${id}/send-to-zalo`, data),
    createTopic: (data) => api.post('/quick-reply-topics', data),
    updateTopic: (id, data) => api.put(`/quick-reply-topics/${id}`, data),
    deleteTopic: (id) => api.delete(`/quick-reply-topics/${id}`),
};

export const orderStatusApi = {
    getAll: (params) => api.get('/order-statuses', params ? { params } : {}),
    getOne: (id) => api.get(`/order-statuses/${id}`),
    store: (data) => api.post('/order-statuses', data),
    update: (id, data) => api.put(`/order-statuses/${id}`, data),
    reorder: (ids) => api.post('/order-statuses/reorder', { ids }),
    destroy: (id) => api.delete(`/order-statuses/${id}`),
};

export const reportApi = {
    getDashboard: (params) => api.get('/reports/dashboard', params ? { params } : {}),
    getInventory: () => api.get('/reports/inventory'),
    getTopProducts: () => api.get('/reports/top-products'),
    getSales: (days) => api.get('/reports/sales', { params: { days } }),
    getSalesMatrix: (params) => api.get('/reports/sales-matrix', { params }),
    getProductSalesByDay: (params) => api.get('/reports/product-sales-by-day', { params }),
    getWebAnalytics: (params) => api.get('/reports/web-analytics', { params }),
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
    adjustStockCount: (data) => api.post('/inventory/stock-count-adjustments', data),
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
    reorderUnits: (ids, defaultId = null) => api.post('/inventory/units/reorder', { ids, default_id: defaultId }),
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
    restoreImport: (id) => api.post(`/inventory/imports/${id}/restore`),
    bulkDeleteImports: (ids) => api.post('/inventory/imports/bulk-delete', { ids }),
    bulkRestoreImports: (ids) => api.post('/inventory/imports/bulk-restore', { ids }),
    forceDeleteImport: (id) => api.delete(`/inventory/imports/${id}/force`),
    bulkForceDeleteImports: (ids) => api.post('/inventory/imports/bulk-force-delete', { ids }),
    getImport: (id) => api.get(`/inventory/imports/${id}`),
    getDocuments: (type, params) => api.get(`/inventory/documents/${type}`, { params }),
    createDocument: (type, data) => api.post(`/inventory/documents/${type}`, data),
    updateDocument: (type, id, data) => api.put(`/inventory/documents/${type}/${id}`, data),
    deleteDocument: (type, id) => api.delete(`/inventory/documents/${type}/${id}`),
    bulkDeleteDocuments: (type, ids) => api.post(`/inventory/documents/${type}/bulk-delete`, { ids }),
    restoreDocument: (type, id) => api.post(`/inventory/documents/${type}/${id}/restore`),
    forceDeleteDocument: (type, id) => api.delete(`/inventory/documents/${type}/${id}/force`),
    bulkRestoreDocuments: (type, ids) => api.post(`/inventory/documents/${type}/bulk-restore`, { ids }),
    bulkForceDeleteDocuments: (type, ids) => api.post(`/inventory/documents/${type}/bulk-force-delete`, { ids }),
    getDocument: (type, id) => api.get(`/inventory/documents/${type}/${id}`),
    getTrashSlips: (params) => api.get('/inventory/trash/slips', { params }),
    getBatches: (params) => api.get('/inventory/batches', { params }),
    getExports: (params) => api.get('/inventory/exports', { params }),
    getExport: (id) => api.get(`/inventory/exports/${id}`),
};

export const financeApi = {
    getDashboard: (params) => api.get('/finance/dashboard', { params }),
    getOptions: () => api.get('/finance/options'),
    getCashbook: (params) => api.get('/finance/cashbook', { params }),
    createCashbookEntry: (data) => api.post('/finance/cashbook/entries', data),
    updateCashbookEntry: (kind, id, data) => api.put(`/finance/cashbook/entries/${kind}/${id}`, data),
    deleteCashbookEntry: (kind, id) => api.delete(`/finance/cashbook/entries/${kind}/${id}`),
    getTransactions: (params) => api.get('/finance/transactions', { params }),
    createTransaction: (data) => api.post('/finance/transactions', data, multipartConfig(data)),
    updateTransaction: (id, data) => api.post(`/finance/transactions/${id}`, data, multipartConfig(data)),
    deleteTransaction: (id) => api.delete(`/finance/transactions/${id}`),
    restoreTransaction: (id) => api.post(`/finance/transactions/${id}/restore`),
    getWallets: (params) => api.get('/finance/wallets', { params }),
    createWallet: (data) => api.post('/finance/wallets', data),
    updateWallet: (id, data) => api.put(`/finance/wallets/${id}`, data),
    deleteWallet: (id) => api.delete(`/finance/wallets/${id}`),
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

    // New Fixed Cost Tracker endpoints
    getFixedCostTracker: (params) => api.get('/finance/fixed-costs', { params }),
    applyFixedCosts: (data) => api.post('/finance/fixed-costs/apply', data),
    createFixedCostCategory: (data) => api.post('/finance/fixed-costs/categories', data),
    updateFixedCostCategory: (id, data) => api.put(`/finance/fixed-costs/categories/${id}`, data),
    deleteFixedCostCategory: (id) => api.delete(`/finance/fixed-costs/categories/${id}`),

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
    // New Fund Management (Sổ cái) endpoints
    getFundSummary: () => api.get('/finance/funds/summary'),
    getFundAssetSummary: () => api.get('/finance/funds/asset-summary'),
    saveFundAssetSummarySettings: (data) => api.put('/finance/funds/asset-summary/settings', data),
    getFundAccounts: () => api.get('/finance/funds/accounts'),
    saveFundAccount: (data) => api.post('/finance/funds/accounts', data),
    deleteFundAccount: (id) => api.delete(`/finance/funds/accounts/${id}`),
    updateFundAccountInitial: (id, data) => api.put(`/finance/funds/accounts/${id}/initial-balance`, data),
    getFundCategories: () => api.get('/finance/funds/categories'),
    saveFundCategory: (data) => api.post('/finance/funds/categories', data),
    reorderFundCategories: (ids) => api.post('/finance/funds/categories/reorder', { ids }),
    deleteFundCategory: (id) => api.delete(`/finance/funds/categories/${id}`),
    getFundTransactions: (params) => api.get('/finance/funds/transactions', { params }),
    saveFundTransaction: (data) => api.post('/finance/funds/transactions', data),
    deleteFundTransaction: (id) => api.delete(`/finance/funds/transactions/${id}`),
    getFundReport: (params) => api.get('/finance/funds/report', { params }),
    transferFunds: (data) => api.post('/finance/funds/transfer', data),

    // Daily Profit/Loss Report (P&L)
    getDailyPnlReport: (params) => api.get('/finance/daily-pnl/report', { params }),
    getMonthlyPnlReport: (params) => api.get('/finance/daily-pnl/monthly-report', { params }),
    getMonthlyPnlReportDrilldown: (params) => api.get('/finance/daily-pnl/monthly-report/drilldown', { params }),
    getRevenueReconciliation: (params) => api.get('/finance/daily-pnl/revenue-reconciliation', { params }),
    getDailyPnlConfig: () => api.get('/finance/daily-pnl/config'),
    updateDailyPnlConfig: (data) => api.post('/finance/daily-pnl/config', data),
    getProfitCenters: (params) => api.get('/finance/profit-centers', { params }),
    createProfitCenter: (data) => api.post('/finance/profit-centers', data),
    updateProfitCenter: (id, data) => api.put(`/finance/profit-centers/${id}`, data),
    deleteProfitCenter: (id) => api.delete(`/finance/profit-centers/${id}`),
    saveAdAccountProfitCenterMappings: (mappings) => api.put('/finance/profit-centers/ad-account-mappings', { mappings }),
    getFbAdAccounts: (token) => api.get('/finance/daily-pnl/fb-accounts', { params: { token } }),
    syncFbAdSpend: (params) => api.post('/finance/daily-pnl/sync-fb', params),
    getFbAdSpendSplit: (params) => api.get('/finance/daily-pnl/fb-split', { params }),
    getGoogleAdAccounts: (data) => api.post('/finance/daily-pnl/google-accounts', data),
    syncGoogleAdSpend: (params) => api.post('/finance/daily-pnl/sync-google', params),
    getGoogleAdSpendSplit: (params) => api.get('/finance/daily-pnl/google-split', { params }),

    // Debt Management (Sổ nợ) endpoints
    getDebtSubjects: () => api.get('/finance/debts/subjects'),
    saveDebtSubject: (data) => api.post('/finance/debts/subjects', data),
    deleteDebtSubject: (id) => api.delete(`/finance/debts/subjects/${id}`),
    getDebtTransactions: (subjectId) => api.get(`/finance/debts/transactions/${subjectId}`),
    saveDebtTransaction: (data) => api.post('/finance/debts/transactions', data),
    deleteDebtTransaction: (id) => api.delete(`/finance/debts/transactions/${id}`),
};

export const receiptVoucherApi = {
    getBootstrap: (params, signal) => api.get('/finance/receipts/bootstrap', { params, signal }),
    getBootstrapCached: (params) => primeCachedRequest(
        requestCache.receiptBootstrap,
        receiptBootstrapCacheKey(params),
        () => api.get('/finance/receipts/bootstrap', { params }),
        RECEIPT_BOOTSTRAP_CACHE_TTL_MS
    ),
    invalidateBootstrap: (params) => {
        if (!params) {
            requestCache.receiptBootstrap.clear();
            return;
        }

        invalidateCachedResponse(requestCache.receiptBootstrap, receiptBootstrapCacheKey(params));
    },
    getAll: (params, signal) => api.get('/finance/receipts', { params, signal }),
    getSummary: (params, signal) => api.get('/finance/receipts/summary', { params, signal }),
    getOne: (id) => api.get(`/finance/receipts/${id}`),
    create: (data) => api.post('/finance/receipts', data),
    update: (id, data) => api.put(`/finance/receipts/${id}`, data),
    destroy: (id) => api.delete(`/finance/receipts/${id}`),
    restore: (id) => api.post(`/finance/receipts/${id}/restore`),
    forceDelete: (id) => api.delete(`/finance/receipts/${id}/force`),
    bulkDelete: (ids) => api.post('/finance/receipts/bulk-delete', { ids }),
    bulkRestore: (ids) => api.post('/finance/receipts/bulk-restore', { ids }),
    bulkForceDelete: (ids) => api.post('/finance/receipts/bulk-force-delete', { ids }),
};

export const couponApi = {
    getAll: () => api.get('/coupons'),
    store: (data) => api.post('/coupons', data),
    validate: (code, orderValue) => api.post('/coupons/validate', { code, order_value: orderValue }),
};

export const reviewApi = {
    getByProduct: (productId) => api.get(`/products/${productId}/reviews`),
    store: (productId, data) => api.post(`/products/${productId}/reviews`, data),
    like: (id) => api.post(`/product-reviews/${id}/like`),
    adminList: (params) => api.get('/admin/reviews', { params }),
    adminGet: (id) => api.get(`/admin/reviews/${id}`),
    adminCreate: (data) => api.post('/admin/reviews', data),
    adminBulkImport: (data) => api.post('/admin/reviews/bulk-import', data, multipartConfig(data)),
    adminExport: (params) => api.get('/admin/reviews/export', { params, responseType: 'blob' }),
    unreadSummary: (config = {}) => api.get('/admin/reviews/unread-summary', config),
    markSeen: () => api.post('/admin/reviews/mark-seen'),
    adminUpdate: (id, data) => api.put(`/admin/reviews/${id}`, data),
    adminDelete: (id) => api.delete(`/admin/reviews/${id}`),
    approve: (id) => api.post(`/admin/reviews/${id}/approve`),
    hide: (id) => api.post(`/admin/reviews/${id}/hide`),
};

export const productFaqApi = {
    getByProduct: (productId) => api.get(`/products/${productId}/faqs`),
    adminList: (params) => api.get('/admin/product-faqs', { params }),
    adminProducts: (params) => api.get('/admin/product-faqs/products', { params }),
    resolveTargets: (data) => api.post('/admin/product-faqs/resolve-targets', data),
    previewArticleLink: (data) => api.post('/admin/product-faqs/preview-article-link', data),
    adminCreate: (data) => api.post('/admin/product-faqs', data, multipartConfig(data)),
    adminUpdate: (id, data) => api.post(`/admin/product-faqs/${id}`, data, multipartConfig(data)),
    adminDelete: (id) => api.delete(`/admin/product-faqs/${id}`),
    reorder: (data) => api.post('/admin/product-faqs/reorder', data),
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
    restore: (id) => api.post(`/blog/${id}/restore`),
    forceDelete: (id) => api.delete(`/blog/${id}/force`),
    bulkDelete: (ids) => api.post('/blog/bulk-delete', { ids }),
    bulkRestore: (ids) => api.post('/blog/bulk-restore', { ids }),
    bulkForceDelete: (ids) => api.post('/blog/bulk-force-delete', { ids }),
    reorder: (ids) => api.post('/blog/reorder', { ids }),
    exportExcel: (data = {}) => api.post('/blog/export-excel', data, {
        responseType: 'blob',
    }),
    importExcel: (formData) => api.post('/blog/import-excel', formData, multipartConfig(formData)),
    listAiBulkJobs: (params) => api.get('/blog/ai-bulk/jobs', { params }),
    createAiBulkJob: (formData) => api.post('/blog/ai-bulk/jobs', formData, multipartConfig(formData)),
    getAiBulkJob: (jobId) => api.get(`/blog/ai-bulk/jobs/${jobId}`),
    runAiBulkJob: (jobId) => api.post(`/blog/ai-bulk/jobs/${jobId}/run`),
    listAiUrlJobs: (params, config = {}) => api.get('/blog/ai-url/jobs', { params, ...config }),
    createAiUrlJob: (data) => api.post('/blog/ai-url/jobs', data, { retryPolicy: 'never' }),
    getAiUrlJob: (jobId, config = {}) => api.get(`/blog/ai-url/jobs/${jobId}`, config),
    runAiUrlJob: (jobId, data = {}) => api.post(`/blog/ai-url/jobs/${jobId}/run`, data, { retryPolicy: 'never' }),
    scanAiUrlJob: (jobId) => api.post(`/blog/ai-url/jobs/${jobId}/scan`, {}, { retryPolicy: 'never' }),
    processNextAiUrlJob: (jobId, data = {}) => api.post(`/blog/ai-url/jobs/${jobId}/process-next`, data, { retryPolicy: 'never' }),
    pauseAiUrlJob: (jobId) => api.post(`/blog/ai-url/jobs/${jobId}/pause`, {}, { retryPolicy: 'never' }),
    resetFailedAiUrlJob: (jobId) => api.post(`/blog/ai-url/jobs/${jobId}/reset-failed`, {}, { retryPolicy: 'never' }),
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
    importTrackingViettelPost: (data) => api.post('/shipments/import-tracking/viettel-post', data, multipartConfig(data)),
    reconcileViettelPost: (data) => api.post('/shipments/reconcile/viettel-post', data, multipartConfig(data)),
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

export const userSettingsApi = {
    get: () => api.get('/user-settings'),
    update: (data) => api.patch('/user-settings', data),
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
    generateProductSeo: (data) => api.post('/ai/generate-product-seo', data),
    rewriteProductDescription: (data) => api.post('/ai/rewrite-product-description', data),
    getHistory: (chatId) => api.get(`/ai/history/${chatId}`),
};

export const cmsApi = {
    banners: {
        getAll: (params) => api.get('/banners', { params }),
        getOne: (id) => api.get(`/banners/${id}`),
        store: (data) => api.post('/banners', data, multipartConfig(data)),
        update: (id, data) => {
            if (data instanceof FormData) {
                data.append('_method', 'PUT');
                return api.post(`/banners/${id}`, data, multipartConfig(data));
            }

            return api.put(`/banners/${id}`, data, multipartConfig(data));
        },
        destroy: (id) => api.delete(`/banners/${id}`),
    },
    settings: {
        get: (params) => api.get('/site-settings', { params }),
        update: (data) => api.post('/site-settings', data),
    },
    domains: {
        getAll: (params) => api.get('/site-domains', params ? { params } : {}),
        store: (data) => api.post('/site-domains', data),
        update: (id, data) => api.put(`/site-domains/${id}`, data),
        destroy: (id) => api.delete(`/site-domains/${id}`),
    },
    stores: {
        getAll: (params) => api.get('/stores', params ? { params } : {}),
        store: (data) => api.post('/stores', data),
        update: (id, data) => api.put(`/stores/${id}`, data),
        destroy: (id) => api.delete(`/stores/${id}`),
    },
    storefrontThemes: {
        getAll: (params) => api.get('/storefront-themes', params ? { params } : {}),
        store: (data) => api.post('/storefront-themes', data),
        update: (id, data) => api.put(`/storefront-themes/${id}`, data),
        destroy: (id) => api.delete(`/storefront-themes/${id}`),
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
    changePassword: (id, data) => api.put(`/users/${id}/password`, data),
    destroy: (id) => api.delete(`/users/${id}`),
};

export const payrollApi = {
    getOverview: (params) => api.get('/payroll/overview', { params }),
    saveEmployees: (employees) => api.put('/payroll/employees/sheet', { employees }),
    saveShifts: (shifts) => api.put('/payroll/shifts/sheet', { shifts }),
    saveSchedules: (schedules) => api.put('/payroll/schedules/sheet', { schedules }),
    saveAttendance: (attendanceRecords) => api.put('/payroll/attendance/sheet', { attendance_records: attendanceRecords }),
    saveAdjustments: (adjustments) => api.put('/payroll/adjustments/sheet', { adjustments }),
    deleteAdjustment: (id) => api.delete(`/payroll/adjustments/${id}`),
    saveUserScopes: (userScopes) => api.put('/payroll/user-scopes/sheet', { user_scopes: userScopes }),
};

export const mediaApi = {
    upload: (formData, config = {}) => api.post('/media/upload', formData, {
        ...multipartConfig(formData),
        ...config,
    }),
};

export const quoteTemplateApi = {
    getAll: () => api.get('/quote-templates'),
    store: (data) => api.post('/quote-templates', data),
    update: (id, data) => api.put(`/quote-templates/${id}`, data),
    destroy: (id) => api.delete(`/quote-templates/${id}`),
};

export default api;
