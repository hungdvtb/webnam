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

const normalizeMoneyValue = (value) => Math.max(0, Number(value || 0) || 0);
const normalizeQuantity = (value) => Math.max(1, Number(value || 1) || 1);

const getProductTrackingId = (item = {}) => String(
  item?.id
  || item?.product_id
  || item?.sku
  || item?.product_sku
  || item?.slug
  || item?.product_slug
  || ''
).trim();

const getProductTrackingName = (item = {}) => String(
  item?.name
  || item?.product_name
  || ''
).trim();

const getProductTrackingSku = (item = {}) => String(
  item?.sku
  || item?.product_sku
  || ''
).trim();

const getProductUnitValue = (item = {}, fallbackValue = 0) => normalizeMoneyValue(
  item?.unit_value
  ?? item?.current_price
  ?? item?.currentPrice
  ?? item?.price
  ?? fallbackValue
);

const buildCommerceItems = (items = []) => (
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const id = getProductTrackingId(item);
      if (!id) return null;

      const quantity = normalizeQuantity(item?.quantity);
      const price = getProductUnitValue(item);

      return {
        id,
        name: getProductTrackingName(item),
        sku: getProductTrackingSku(item),
        quantity,
        price,
      };
    })
    .filter(Boolean)
);

const trackMetaPixel = (eventName, payload = {}) => {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') {
    return;
  }

  try {
    window.fbq('track', eventName, payload);
  } catch {
    // Marketing pixels must never block storefront UX.
  }
};

const trackGoogleEvent = (eventName, payload = {}) => {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
    return;
  }

  try {
    window.gtag('event', eventName, payload);
  } catch {
    // Marketing pixels must never block storefront UX.
  }
};

const trackTikTokEvent = (eventName, payload = {}) => {
  if (typeof window === 'undefined' || !window.ttq || typeof window.ttq.track !== 'function') {
    return;
  }

  try {
    window.ttq.track(eventName, payload);
  } catch {
    // Marketing pixels must never block storefront UX.
  }
};

const toMetaContents = (items) => items.map((item) => ({
  id: item.id,
  quantity: item.quantity,
  item_price: item.price,
}));

const toGoogleItems = (items) => items.map((item) => ({
  item_id: item.id,
  item_name: item.name,
  price: item.price,
  quantity: item.quantity,
}));

const toTikTokContents = (items) => items.map((item) => ({
  content_id: item.id,
  content_name: item.name,
  content_type: 'product',
  quantity: item.quantity,
  price: item.price,
}));

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
  const normalizedQuantity = normalizeQuantity(quantity);
  const totalValue = normalizeMoneyValue(unitValue * normalizedQuantity);
  const commerceItems = buildCommerceItems([{
    ...product,
    quantity: normalizedQuantity,
    unit_value: unitValue,
  }]);
  const primaryItem = commerceItems[0];

  if (primaryItem) {
    trackMetaPixel('AddToCart', {
      content_ids: [primaryItem.id],
      content_name: primaryItem.name,
      content_type: 'product',
      contents: toMetaContents(commerceItems),
      value: totalValue,
      currency: 'VND',
    });

    trackGoogleEvent('add_to_cart', {
      currency: 'VND',
      value: totalValue,
      items: toGoogleItems(commerceItems),
    });

    trackTikTokEvent('AddToCart', {
      contents: toTikTokContents(commerceItems),
      value: totalValue,
      currency: 'VND',
    });
  }

  return trackAnalyticsEvent('add_to_cart', {
    product_id: productId,
    product_name: product?.name || product?.product_name || '',
    product_sku: product?.sku || product?.product_sku || '',
    product_slug: product?.slug || product?.product_slug || '',
    quantity: normalizedQuantity,
    value: unitValue,
    metadata: {
      product_type: product?.type || product?.item_type || '',
      ...extra,
    },
  });
};

export const trackCheckoutStarted = (cartItems = [], totalValue = 0) => {
  const commerceItems = buildCommerceItems(cartItems);
  const normalizedValue = normalizeMoneyValue(totalValue);
  const totalQuantity = commerceItems.reduce((sum, item) => sum + item.quantity, 0);

  if (commerceItems.length > 0) {
    trackMetaPixel('InitiateCheckout', {
      content_ids: commerceItems.map((item) => item.id),
      content_type: 'product',
      contents: toMetaContents(commerceItems),
      num_items: totalQuantity,
      value: normalizedValue,
      currency: 'VND',
    });

    trackGoogleEvent('begin_checkout', {
      currency: 'VND',
      value: normalizedValue,
      items: toGoogleItems(commerceItems),
    });

    trackTikTokEvent('InitiateCheckout', {
      contents: toTikTokContents(commerceItems),
      value: normalizedValue,
      currency: 'VND',
    });
  }

  return trackAnalyticsEvent('checkout_started', {
    quantity: totalQuantity,
    value: normalizedValue,
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
  });
};

export const trackPurchase = (orderNumber, cartItems = [], totalValue = 0) => {
  const commerceItems = buildCommerceItems(cartItems);
  const normalizedValue = normalizeMoneyValue(totalValue);
  const totalQuantity = commerceItems.reduce((sum, item) => sum + item.quantity, 0);
  const transactionId = String(orderNumber || '').trim();

  if (commerceItems.length > 0) {
    const metaPayload = {
      content_ids: commerceItems.map((item) => item.id),
      content_type: 'product',
      contents: toMetaContents(commerceItems),
      num_items: totalQuantity,
      value: normalizedValue,
      currency: 'VND',
    };

    trackMetaPixel('Purchase', metaPayload);
    trackMetaPixel('CompleteRegistration', {
      ...metaPayload,
      status: true,
    });

    trackGoogleEvent('purchase', {
      transaction_id: transactionId,
      currency: 'VND',
      value: normalizedValue,
      items: toGoogleItems(commerceItems),
    });

    trackTikTokEvent('CompletePayment', {
      contents: toTikTokContents(commerceItems),
      value: normalizedValue,
      currency: 'VND',
    });
  }

  return trackAnalyticsEvent('purchase', {
    order_number: transactionId,
    quantity: totalQuantity,
    value: normalizedValue,
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
  });
};
