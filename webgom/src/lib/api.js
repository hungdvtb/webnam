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
    return fetchFromApi(`/web-api/products/${slug}`, { next: { revalidate: 0 } });
}

export async function getWebRelatedProducts(slug) {
    return fetchFromApi(`/web-api/products/${slug}/related`);
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
