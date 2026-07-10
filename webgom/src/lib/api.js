import config from './config';

function getBrowserPublicHost() {
    if (typeof window === 'undefined') {
        return '';
    }

    const queryPublicHost = new URLSearchParams(window.location?.search || '').get('public_host');
    if (queryPublicHost) {
        return String(queryPublicHost).trim();
    }

    return String(window.location?.host || '').trim();
}

function getBrowserSiteCode() {
    if (typeof window === 'undefined') {
        return '';
    }

    return String(new URLSearchParams(window.location?.search || '').get('site_code') || '').trim();
}

export async function fetchFromApi(endpoint, options = {}) {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const {
        publicHost: requestedPublicHost,
        siteCode: requestedSiteCode,
        headers: optionHeaders = {},
        ...fetchOptions
    } = options;
    const publicHost = String(requestedPublicHost || optionHeaders['X-Public-Host'] || optionHeaders['x-public-host'] || getBrowserPublicHost()).trim();
    const siteCode = String(requestedSiteCode || optionHeaders['X-Site-Code'] || optionHeaders['x-site-code'] || getBrowserSiteCode() || config.siteCode).trim();
    const response = await fetch(`${config.apiUrl}${endpoint}`, {
        ...fetchOptions,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(siteCode ? { 'X-Site-Code': siteCode } : {}),
            ...(publicHost ? { 'X-Public-Host': publicHost } : {}),
            ...optionHeaders,
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
        if (key === 'publicHost') {
            return;
        }

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
    return fetchFromApi(`/web-api/products?${urlParams.toString()}`, {
        next: { revalidate: 30 },
        publicHost: params.public_host || params.publicHost,
        siteCode: params.site_code || params.siteCode,
    });
}

export async function getWebCategories(options = {}) {
    // Cache for 5 minutes
    return fetchFromApi('/web-api/categories', { next: { revalidate: 300 }, publicHost: options.publicHost, siteCode: options.siteCode });
}

export async function getWebCategory(slug, options = {}) {
    // Cache for 1 minute
    return fetchFromApi(`/web-api/categories/${slug}`, { next: { revalidate: 60 }, publicHost: options.publicHost, siteCode: options.siteCode });
}

export async function getWebProductDetail(slug, options = {}) {
    // Cache for 1 minute
    return fetchFromApi(`/web-api/products/${slug}`, { next: { revalidate: 60 }, publicHost: options.publicHost, siteCode: options.siteCode });
}

export async function getWebProductBundleOptionDetail(slug, params = {}, options = {}) {
    const urlParams = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            urlParams.append(key, value);
        }
    });

    const query = urlParams.toString();
    return fetchFromApi(
        `/web-api/products/${slug}/bundle-option-detail${query ? `?${query}` : ''}`,
        { next: { revalidate: 60 }, publicHost: options.publicHost || params.public_host, siteCode: options.siteCode || params.site_code },
    );
}

export async function getWebRelatedProducts(slug, options = {}) {
    const response = await fetchFromApi(`/web-api/products/${slug}/related`, { next: { revalidate: 300 }, publicHost: options.publicHost, siteCode: options.siteCode });

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

export async function getWebProductReviews(productId, params = {}) {
    const urlParams = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            urlParams.append(key, value);
        }
    });

    const query = urlParams.toString();
    return fetchFromApi(`/products/${productId}/reviews${query ? `?${query}` : ''}`, {
        cache: 'no-store',
    });
}

export async function submitWebProductReview(productId, data) {
    return fetchFromApi(`/products/${productId}/reviews`, {
        method: 'POST',
        body: JSON.stringify(data),
    });
}

export async function likeWebProductReview(reviewId) {
    return fetchFromApi(`/product-reviews/${reviewId}/like`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function getWebProductFaqs(productId) {
    return fetchFromApi(`/products/${productId}/faqs`, {
        cache: 'no-store',
    });
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

