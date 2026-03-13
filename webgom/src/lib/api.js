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
    // Revalidate every hour
    return fetchFromApi('/menus/active', { next: { revalidate: 3600 } });
}

export async function getStorefrontData() {
    return fetchFromApi('/storefront/homepage');
}

export async function getProducts(params = {}) {
    const query = new URLSearchParams(params).toString();
    return fetchFromApi(`/storefront/products?${query}`);
}

export async function getWebProducts(params = {}) {
    const query = new URLSearchParams(params).toString();
    return fetchFromApi(`/web-api/products?${query}`);
}

export async function getWebCategories() {
    return fetchFromApi('/web-api/categories', { next: { revalidate: 0 } });
}

export async function getWebCategory(slug) {
    return fetchFromApi(`/web-api/categories/${slug}`);
}

export async function getWebProductDetail(slug) {
    return fetchFromApi(`/web-api/products/${slug}`);
}

export async function getWebRelatedProducts(slug) {
    return fetchFromApi(`/web-api/products/${slug}/related`);
}
