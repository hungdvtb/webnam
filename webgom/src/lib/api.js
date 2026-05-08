import config from './config';

export async function fetchFromApi(endpoint, options = {}) {
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

    return response.json();
}

export async function resolveAccount() {
    return fetchFromApi(`/accounts/resolve/${config.siteCode}`);
}

export async function getActiveMenu() {
    // Revalidate 0 to always get fresh data
    return fetchFromApi('/menus/active', { next: { revalidate: 0 } });
}

export async function getStorefrontData() {
    return fetchFromApi('/storefront/homepage');
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
    return fetchFromApi(`/storefront/products?${urlParams.toString()}`);
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
    return fetchFromApi(`/web-api/products?${urlParams.toString()}`);
}

export async function getWebCategories() {
    return fetchFromApi('/web-api/categories', { next: { revalidate: 0 } });
}

export async function getWebCategory(slug) {
    return fetchFromApi(`/web-api/categories/${slug}`);
}

export async function getWebProductDetail(slug) {
    // Cache for 30 seconds - balances freshness with SSR performance.
    // Next.js also deduplicates identical fetch() calls within the same render pass.
    return fetchFromApi(`/web-api/products/${slug}`, { next: { revalidate: 30 } });
}

export async function getWebRelatedProducts(slug) {
    const response = await fetchFromApi(`/web-api/products/${slug}/related`, { next: { revalidate: 60 } });

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
    return fetchFromApi('/site-settings', { next: { revalidate: 0 } });
}
