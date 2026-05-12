import config from './config';

const VISITOR_KEY = `webgom_analytics_visitor_${config.siteCode}`;
const SESSION_KEY = `webgom_analytics_session_${config.siteCode}`;
const SESSION_STARTED_KEY = `webgom_analytics_session_started_${config.siteCode}`;
const SESSION_TTL_MS = 30 * 60 * 1000;

const createId = (prefix) => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

const safeStorageGet = (storage, key) => {
  try {
    return storage?.getItem(key) || '';
  } catch {
    return '';
  }
};

const safeStorageSet = (storage, key, value) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // Tracking must never block storefront UX.
  }
};

export const getAnalyticsIdentity = () => {
  if (typeof window === 'undefined') {
    return {
      visitor_id: '',
      session_id: '',
    };
  }

  let visitorId = safeStorageGet(window.localStorage, VISITOR_KEY);
  if (!visitorId) {
    visitorId = createId('v');
    safeStorageSet(window.localStorage, VISITOR_KEY, visitorId);
  }

  const sessionStartedAt = Number(safeStorageGet(window.sessionStorage, SESSION_STARTED_KEY) || 0);
  const existingSessionId = safeStorageGet(window.sessionStorage, SESSION_KEY);
  const isExpired = !sessionStartedAt || Date.now() - sessionStartedAt > SESSION_TTL_MS;
  const sessionId = existingSessionId && !isExpired ? existingSessionId : createId('s');

  safeStorageSet(window.sessionStorage, SESSION_KEY, sessionId);
  safeStorageSet(window.sessionStorage, SESSION_STARTED_KEY, String(Date.now()));

  return {
    visitor_id: visitorId,
    session_id: sessionId,
  };
};

const getUrlPayload = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  const url = new URL(window.location.href);

  return {
    path: `${url.pathname}${url.search}`,
    url: window.location.href,
    current_url: window.location.href,
    referrer: document.referrer || '',
    title: document.title || '',
    utm_source: url.searchParams.get('utm_source') || '',
    utm_medium: url.searchParams.get('utm_medium') || '',
    utm_campaign: url.searchParams.get('utm_campaign') || '',
    utm_content: url.searchParams.get('utm_content') || '',
    utm_term: url.searchParams.get('utm_term') || '',
  };
};

export const trackAnalyticsEvent = (eventName, payload = {}) => {
  if (typeof window === 'undefined' || !eventName) {
    return Promise.resolve(null);
  }

  const body = {
    ...getUrlPayload(),
    ...payload,
    ...getAnalyticsIdentity(),
    event_name: eventName,
    site_code: config.siteCode,
  };

  return fetch(`${config.apiUrl}/analytics/events`, {
    method: 'POST',
    keepalive: true,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Site-Code': config.siteCode,
    },
    body: JSON.stringify(body),
  }).catch(() => null);
};

export const trackPageView = () => trackAnalyticsEvent('page_view');

export const trackProductView = (product = {}) => {
  const productId = Number(product?.id || product?.product_id || 0);
  if (!productId) {
    return Promise.resolve(null);
  }

  return trackAnalyticsEvent('product_view', {
    product_id: productId,
    product_name: product?.name || product?.product_name || '',
    product_sku: product?.sku || product?.product_sku || '',
    product_slug: product?.slug || product?.product_slug || '',
    value: Number(product?.current_price || product?.price || 0) || undefined,
    metadata: {
      product_type: product?.type || product?.item_type || '',
    },
  });
};

export const trackAddToCart = (product = {}, quantity = 1, extra = {}) => {
  const productId = Number(product?.id || product?.product_id || 0);
  if (!productId) {
    return Promise.resolve(null);
  }

  const unitValue = Number(extra?.unit_value ?? extra?.price ?? product?.current_price ?? product?.price ?? 0) || 0;

  return trackAnalyticsEvent('add_to_cart', {
    product_id: productId,
    product_name: product?.name || product?.product_name || '',
    product_sku: product?.sku || product?.product_sku || '',
    product_slug: product?.slug || product?.product_slug || '',
    quantity: Math.max(1, Number(quantity || 1)),
    value: unitValue,
    metadata: {
      product_type: product?.type || product?.item_type || '',
      ...extra,
    },
  });
};

export const trackCheckoutStarted = (cartItems = [], totalValue = 0) => (
  trackAnalyticsEvent('checkout_started', {
    quantity: cartItems.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity || 1)), 0),
    value: Number(totalValue || 0),
    metadata: {
      items_count: cartItems.length,
      items: cartItems.slice(0, 30).map((item) => ({
        product_id: item?.id || item?.product_id || null,
        product_name: item?.name || item?.product_name || '',
        product_sku: item?.sku || item?.product_sku || '',
        product_slug: item?.slug || item?.product_slug || '',
        quantity: Number(item?.quantity || 1),
      })),
    },
  })
);
