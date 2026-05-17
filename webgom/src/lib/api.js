import config from './config';

export async function fetchFromApi(endpoint, options = {}) {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Site-Code': config.siteCode,
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
    }

    const payload = await response.json();
    const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const timing = {
        endpoint,
        durationMs: Math.round(finishedAt - startedAt),
        serverTiming: response.headers.get('server-timing') || '',
        webgomTiming: response.headers.get('x-webgom-timing') || '',
    };

    if (payload && typeof payload === 'object') {
        try {
            Object.defineProperty(payload, '__webgomTiming', {
                value: timing,
                enumerable: false,
                configurable: true,
            });
        } catch {
            // Timing metadata is best-effort and must never affect data flow.
        }
    }

    if (
        (
            endpoint.includes('/web-api/products')
            || endpoint.includes('/web-api/categories')
        )
        && (
            typeof window === 'undefined'
            || process.env.NODE_ENV !== 'production'
            || window.__WEBGOM_PRODUCT_PERF__ === true
        )
    ) {
        console.info('[product-perf] api-response', {
            ...timing,
        });
    }

    return payload;
}

export async function resolveAccount() {
    return fetchFromApi(`/accounts/resolve/${config.siteCode}`, { next: { revalidate: 3600 } });
}

export async function getActiveMenu() {
    // Cache for 5 minutes
    return fetchFromApi('/menus/active', { next: { revalidate: 300 } });
}

export async function getStorefrontData() {
    // Cache for 1 minute
    return fetchFromApi('/storefront/homepage', { next: { revalidate: 60 } });
}

export async function getProducts(params = {}) {
    // Handle nested attrs if present
    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (key === 'attrs' && typeof value === 'object') {
            Object.entries(value).forEach(([attrKey, attrValue]) => {
                if (Array.isArray(attrValue)) {
                    attrValue.forEach(v => urlParams.append(`attrs[${attrKey}][]`, v));
                } else {
                    urlParams.append(`attrs[${attrKey}]`, attrValue);
                }
            });
        } else {
            urlParams.append(key, value);
        }
    });
    return fetchFromApi(`/storefront/products?${urlParams.toString()}`, { next: { revalidate: 30 } });
}

export async function getWebProducts(params = {}) {
    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (key === 'attrs' && typeof value === 'object') {
            Object.entries(value).forEach(([attrKey, attrValue]) => {
                if (Array.isArray(attrValue)) {
                    attrValue.forEach(v => urlParams.append(`attrs[${attrKey}][]`, v));
                } else {
                    urlParams.append(`attrs[${attrKey}]`, attrValue);
                }
            });
        } else {
            urlParams.append(key, value);
        }
    });
    return fetchFromApi(`/web-api/products?${urlParams.toString()}`, { next: { revalidate: 30 } });
}

export async function getWebCategories() {
    // Cache for 5 minutes
    return fetchFromApi('/web-api/categories', { next: { revalidate: 300 } });
}

export async function getWebCategory(slug) {
    // Cache for 1 minute
    return fetchFromApi(`/web-api/categories/${slug}`, { next: { revalidate: 60 } });
}

export async function getWebProductDetail(slug) {
    // Cache for 1 minute
    return fetchFromApi(`/web-api/products/${slug}`, { next: { revalidate: 60 } });
}

export async function getWebProductBundleOptionDetail(slug, params = {}) {
    const urlParams = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            urlParams.append(key, value);
        }
    });

    const query = urlParams.toString();
    return fetchFromApi(
        `/web-api/products/${slug}/bundle-option-detail${query ? `?${query}` : ''}`,
        { next: { revalidate: 60 } },
    );
}

export async function getWebRelatedProducts(slug) {
    const response = await fetchFromApi(`/web-api/products/${slug}/related`, { next: { revalidate: 300 } });

    if (Array.isArray(response)) {
        return {
            items: response,
            meta: {
                source: response.length > 0 ? 'legacy' : 'empty',
                has_explicit_related: response.length > 0,
                fallback_category: null,
            },
        };
    }

    return {
        items: Array.isArray(response?.items) ? response.items : [],
        meta: {
            source: typeof response?.meta?.source === 'string' ? response.meta.source : 'empty',
            has_explicit_related: Boolean(response?.meta?.has_explicit_related),
            fallback_category: response?.meta?.fallback_category ?? null,
        },
    };
}

export async function placeWebOrder(orderData) {
    return fetchFromApi('/storefront/order', {
        method: 'POST',
        body: JSON.stringify(orderData)
    });
}

export async function saveWebOrderDraft(orderData) {
    return fetchFromApi('/storefront/order-draft', {
        method: 'POST',
        body: JSON.stringify(orderData)
    });
}

export async function getWebSiteSettings() {
    // Cache for 10 minutes
    return fetchFromApi('/site-settings', { next: { revalidate: 600 } });
}

