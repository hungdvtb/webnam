"use client";

const STORAGE_KEY = 'lead_attribution_snapshot';
const SESSION_KEY = 'lead_attribution_snapshot_session';
const COOKIE_KEY = 'lead_attribution_snapshot';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const TRACKING_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'ttclid',
  'source_label',
];

const normalizeKnownSource = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';

  if (['facebook', 'fb', 'meta', 'facebook_ads', 'facebook-ad', 'facebook ads'].includes(normalized)) {
    return 'FB';
  }

  if (['google', 'gg', 'ga', 'google_ads', 'google-ad', 'google ads', 'googleads'].includes(normalized)) {
    return 'GG';
  }

  if (['tiktok', 'tik tok', 'tik_tok', 'tik-tok', 'tt', 'tiktok_ads', 'tiktok-ad', 'tiktok ads'].includes(normalized)) {
    return 'Tiktok';
  }

  if (['website', 'web', 'direct', 'website_order', 'website_lead'].includes(normalized)) {
    return 'Website';
  }

  return '';
};

const getQueryData = () => {
  const params = new URLSearchParams(window.location.search || '');
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

const hasTrackingPayload = (payload = {}) => TRACKING_KEYS.some((key) => Boolean(payload[key]));

const stripEmptyValues = (payload = {}) => Object.fromEntries(
  Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '')
);

const normalizeSource = (payload = {}) => {
  const direct = normalizeKnownSource(payload.utm_source)
    || normalizeKnownSource(payload.source)
    || normalizeKnownSource(payload.source_label)
    || normalizeKnownSource(payload.source_display);

  if (direct) return direct;

  const combined = [
    payload.raw_query,
    payload.fbclid ? 'fbclid' : '',
    payload.gclid ? 'gclid' : '',
    payload.ttclid ? 'ttclid' : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (combined.includes('facebook') || combined.includes('fbclid') || combined.includes('meta')) {
    return 'FB';
  }

  if (combined.includes('google') || combined.includes('gclid') || combined.includes('googleads')) {
    return 'GG';
  }

  if (combined.includes('tiktok') || combined.includes('ttclid')) {
    return 'Tiktok';
  }

  return 'Website';
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

export function readLeadAttribution(options = {}) {
  if (typeof window === 'undefined') return {};

  const includePersistent = options.includePersistent !== false;

  try {
    const sessionRaw = window.sessionStorage.getItem(SESSION_KEY);
    if (sessionRaw) {
      return JSON.parse(sessionRaw);
    }

    const raw = includePersistent ? window.localStorage.getItem(STORAGE_KEY) : '';

    if (raw) {
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error('Unable to read lead attribution snapshot', error);
  }

  return includePersistent ? readCookie() : {};
}

export function rememberLeadAttribution(extra = {}) {
  if (typeof window === 'undefined') return {};

  const queryData = getQueryData();
  const isNewTrackingVisit = hasTrackingPayload(queryData);
  const previous = readLeadAttribution({ includePersistent: isNewTrackingVisit });
  const incoming = isNewTrackingVisit ? queryData : stripEmptyValues(queryData);
  const next = {
    ...previous,
    ...incoming,
    ...extra,
    first_url: isNewTrackingVisit ? window.location.href : (previous.first_url || window.location.href),
    landing_url: isNewTrackingVisit ? window.location.href : (previous.landing_url || window.location.href),
    current_url: window.location.href,
    referrer: isNewTrackingVisit ? (document.referrer || '') : (previous.referrer || document.referrer || ''),
  };

  next.source = normalizeSource(next);
  next.source_display = next.source;

  persistSnapshot(next);

  return next;
}

export function clearLeadAttribution() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_KEY);
  document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; samesite=lax`;
}
