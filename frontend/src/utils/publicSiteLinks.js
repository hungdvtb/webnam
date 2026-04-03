const DEFAULT_PUBLIC_SITE_URL = String(import.meta.env.VITE_PUBLIC_SITE_URL || '').trim();

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1']);
const ADMIN_TO_PUBLIC_PORTS = new Map([
    ['3003', '3000'],
    ['5173', '3000'],
]);

function normalizeAbsoluteBaseUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    let candidate = raw;

    if (!/^[a-z]+:\/\//i.test(candidate)) {
        if (!/^[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(candidate)) {
            return '';
        }

        candidate = `https://${candidate.replace(/^\/+/, '')}`;
    }

    try {
        const url = new URL(candidate);

        if (!url.hostname) {
            return '';
        }

        if (url.hostname.toLowerCase().startsWith('admin.')) {
            url.hostname = url.hostname.slice('admin.'.length);
        } else if (LOCALHOST_NAMES.has(url.hostname) && ADMIN_TO_PUBLIC_PORTS.has(url.port)) {
            url.port = ADMIN_TO_PUBLIC_PORTS.get(url.port) || url.port;
        }

        url.search = '';
        url.hash = '';
        url.pathname = url.pathname.replace(/\/+$/, '');

        return url.toString().replace(/\/$/, '');
    } catch {
        return '';
    }
}

function derivePublicBaseUrlFromCurrentOrigin(currentOrigin) {
    if (typeof window === 'undefined' && !currentOrigin) {
        return '';
    }

    return normalizeAbsoluteBaseUrl(currentOrigin || window.location?.origin || '');
}

function pickPreferredDomain(domains = []) {
    const activeDomains = Array.isArray(domains)
        ? domains.filter((item) => item?.is_active !== false)
        : [];

    const selectedDomain = activeDomains.find((item) => item?.is_default)
        || activeDomains[0]
        || (Array.isArray(domains) ? domains.find((item) => item?.is_default) : null)
        || (Array.isArray(domains) ? domains[0] : null);

    return normalizeAbsoluteBaseUrl(selectedDomain?.domain || '');
}

function normalizePublicBlogPath(value = '') {
    const raw = String(value || '').trim();

    if (!raw) {
        return '';
    }

    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            return normalizePublicBlogPath(url.pathname);
        } catch {
            return '';
        }
    }

    if (!raw.startsWith('/blog/')) {
        return '';
    }

    return raw.replace(/\/+$/, '');
}

export function resolvePublicSiteBaseUrl({ explicitBaseUrl = '', domains = [], currentOrigin = '' } = {}) {
    const candidates = [
        explicitBaseUrl,
        DEFAULT_PUBLIC_SITE_URL,
        pickPreferredDomain(domains),
        derivePublicBaseUrlFromCurrentOrigin(currentOrigin),
    ];

    return candidates.find(Boolean) || '';
}

export function buildPublicBlogPath(postOrSlug) {
    if (postOrSlug && typeof postOrSlug === 'object') {
        const explicitPath = normalizePublicBlogPath(postOrSlug.public_path);
        if (explicitPath) {
            return explicitPath;
        }
    }

    const slug = typeof postOrSlug === 'string'
        ? postOrSlug
        : String(postOrSlug?.slug || '').trim();

    if (!slug) {
        return '';
    }

    return `/blog/${encodeURIComponent(slug)}`;
}

export function buildPublicBlogUrl(post, options = {}) {
    const directUrl = normalizeAbsoluteBaseUrl(post?.public_url || '');
    if (directUrl) {
        const path = normalizePublicBlogPath(post?.public_path || directUrl);
        return path ? new URL(path, directUrl).toString() : directUrl;
    }

    const path = buildPublicBlogPath(post);
    if (!path) {
        return '';
    }

    const baseUrl = resolvePublicSiteBaseUrl(options);
    if (!baseUrl) {
        return '';
    }

    try {
        return new URL(path, `${baseUrl}/`).toString();
    } catch {
        return '';
    }
}
