'use client';

const NAV_MARK_KEY = 'webgom:product-nav-mark';
const onceKeys = new Set();

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const readNavigationMark = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(NAV_MARK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export function markProductNavigationClick(product = {}, href = '') {
  if (typeof window === 'undefined') {
    return;
  }

  const mark = {
    at: now(),
    href,
    slug: product?.slug || '',
    itemType: product?.item_type || product?.itemType || '',
    bundleOptionKey: product?.bundle_option_key || product?.bundleOptionKey || '',
    bundleOptionTitle: product?.bundle_option_title || product?.bundleOptionTitle || '',
  };

  try {
    window.sessionStorage.setItem(NAV_MARK_KEY, JSON.stringify(mark));
  } catch {
    // Timing logs must never block navigation.
  }

  logProductTiming('click', {
    href,
    itemType: mark.itemType,
    bundleOptionKey: mark.bundleOptionKey,
    bundleOptionTitle: mark.bundleOptionTitle,
  }, mark);
}

export function logProductTiming(label, detail = {}, navigationMark = readNavigationMark()) {
  if (typeof window === 'undefined' || typeof console === 'undefined') {
    return;
  }

  const currentTime = now();
  const fromClickMs = navigationMark?.at !== undefined
    ? Math.max(0, Math.round(currentTime - Number(navigationMark.at)))
    : null;

  console.info(`[product-perf] ${label}`, {
    atMs: Math.round(currentTime),
    fromClickMs,
    ...detail,
  });
}

export function logProductTimingOnce(key, label, detail = {}) {
  if (!key || onceKeys.has(key)) {
    return;
  }

  onceKeys.add(key);
  logProductTiming(label, detail);
}

export function markProductRouteReady(detail = {}) {
  logProductTiming('route-change', {
    href: typeof window !== 'undefined' ? window.location.href : '',
    ...detail,
  });
}
