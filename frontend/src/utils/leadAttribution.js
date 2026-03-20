const STORAGE_KEY = 'lead_attribution_snapshot';
const SESSION_KEY = 'lead_attribution_snapshot_session';
const COOKIE_KEY = 'lead_attribution_snapshot';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const parseQuery = (search) => {
    const params = new URLSearchParams(search || window.location.search || '');
    return {
        utm_source: params.get('utm_source') || '',
        utm_medium: params.get('utm_medium') || '',
        utm_campaign: params.get('utm_campaign') || '',
        utm_content: params.get('utm_content') || '',
        utm_term: params.get('utm_term') || '',
        fbclid: params.get('fbclid') || '',
        gclid: params.get('gclid') || '',
        ttclid: params.get('ttclid') || '',
        source_label: params.get('source') || '',
        raw_query: params.toString(),
    };
};

const hasTrackingPayload = (payload = {}) => Boolean(
    payload.utm_source
    || payload.utm_medium
    || payload.utm_campaign
    || payload.utm_content
    || payload.utm_term
    || payload.fbclid
    || payload.gclid
    || payload.ttclid
    || payload.source_label
);

const normalizeSource = (payload = {}) => {
    const values = [
        payload.utm_source,
        payload.source,
        payload.source_label,
        payload.referrer,
        payload.raw_query,
        payload.fbclid,
        payload.gclid,
        payload.ttclid,
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    const combined = values.join(' ');

    if (combined.includes('facebook') || combined.includes('fbclid') || combined.includes('meta') || combined === 'fb') {
        return 'Facebook';
    }
    if (combined.includes('google') || combined.includes('gclid') || combined.includes('googleads')) {
        return 'Google';
    }
    if (combined.includes('tiktok') || combined.includes('ttclid')) {
        return 'TikTok';
    }
    if (combined.includes('direct')) {
        return 'Direct';
    }
    if (combined.includes('website')) {
        return 'Website';
    }

    return payload.referrer ? 'Website' : 'Direct';
};

const readCookie = () => {
    if (typeof document === 'undefined') return {};

    const rawCookie = document.cookie
        .split('; ')
        .find((part) => part.startsWith(`${COOKIE_KEY}=`));

    if (!rawCookie) return {};

    try {
        return JSON.parse(decodeURIComponent(rawCookie.split('=').slice(1).join('=')));
    } catch (error) {
        console.error('Unable to parse lead attribution cookie', error);
        return {};
    }
};

const persistSnapshot = (snapshot) => {
    const serialized = JSON.stringify(snapshot);

    try {
        window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
        console.error('Unable to persist lead attribution snapshot in localStorage', error);
    }

    try {
        window.sessionStorage.setItem(SESSION_KEY, serialized);
    } catch (error) {
        console.error('Unable to persist lead attribution snapshot in sessionStorage', error);
    }

    try {
        document.cookie = `${COOKIE_KEY}=${encodeURIComponent(serialized)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    } catch (error) {
        console.error('Unable to persist lead attribution snapshot in cookie', error);
    }
};

export const readLeadAttribution = () => {
    if (typeof window === 'undefined') return {};

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
            || window.sessionStorage.getItem(SESSION_KEY);

        if (raw) {
            return JSON.parse(raw);
        }
    } catch (error) {
        console.error('Unable to read lead attribution snapshot from storage', error);
    }

    return readCookie();
};

export const rememberLeadAttribution = (extra = {}) => {
    if (typeof window === 'undefined') return {};

    const previous = readLeadAttribution();
    const queryData = parseQuery(window.location.search);
    const incoming = {
        ...queryData,
        ...extra,
    };
    const isNewTrackingVisit = hasTrackingPayload(queryData);
    const referrer = isNewTrackingVisit
        ? (document.referrer || '')
        : (incoming.referrer || previous.referrer || document.referrer || '');

    const next = {
        ...previous,
        ...incoming,
        first_url: isNewTrackingVisit ? window.location.href : (previous.first_url || window.location.href),
        landing_url: isNewTrackingVisit ? window.location.href : (incoming.landing_url || previous.landing_url || window.location.href),
        current_url: incoming.current_url || window.location.href,
        referrer,
    };

    next.source = normalizeSource(next);
    next.source_display = next.source;

    persistSnapshot(next);

    return next;
};

export const clearLeadAttribution = () => {
    if (typeof window === 'undefined') return;

    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
};
