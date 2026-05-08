'use client';

import config from './config';

const SNAPSHOT_PREFIX = 'webgom:bundle-option-snapshot:';
const DETAIL_PREFIX = 'webgom:bundle-option-detail:';
const pendingPrefetches = new Map();

const normalizeText = (value) => String(value || '').trim();

const isBundleOptionProduct = (product = {}) => (
  normalizeText(product?.item_type || product?.itemType) === 'bundle_option'
  || normalizeText(product?.bundle_option_key || product?.bundleOptionKey) !== ''
  || normalizeText(product?.bundle_option_title || product?.bundleOptionTitle) !== ''
);

const getOptionKey = (product = {}) => normalizeText(product?.bundle_option_key || product?.bundleOptionKey);
const getOptionTitle = (product = {}) => normalizeText(product?.bundle_option_title || product?.bundleOptionTitle);

const getCacheKey = (slug = '', optionKey = '', optionTitle = '') => {
  const identity = normalizeText(optionKey) || normalizeText(optionTitle) || 'default';
  return `${normalizeText(slug)}::${identity}`;
};

const pickBundleOptionSnapshot = (product = {}, href = '') => ({
  cached_at: Date.now(),
  href,
  id: product?.id ?? null,
  slug: product?.slug || '',
  type: product?.type || 'bundle',
  item_type: product?.item_type || 'bundle_option',
  name: product?.name || '',
  sku: product?.sku || '',
  price: product?.price ?? null,
  current_price: product?.current_price ?? null,
  special_price: product?.special_price ?? null,
  primary_image: product?.primary_image ?? null,
  main_image: product?.main_image ?? null,
  category: product?.category ?? null,
  bundle_option_key: getOptionKey(product),
  bundle_option_title: getOptionTitle(product),
  bundle_option_total_price: product?.bundle_option_total_price ?? null,
  bundle_option_discounted_price: product?.bundle_option_discounted_price ?? null,
  bundle_option_discount_amount: product?.bundle_option_discount_amount ?? null,
  bundle_parent_name: product?.bundle_parent_name ?? null,
  parent_product_id: product?.parent_product_id ?? null,
});

export function cacheBundleOptionSnapshot(product = {}, href = '') {
  if (typeof window === 'undefined' || !isBundleOptionProduct(product) || !product?.slug) {
    return;
  }

  const snapshot = pickBundleOptionSnapshot(product, href);
  const cacheKey = getCacheKey(product.slug, snapshot.bundle_option_key, snapshot.bundle_option_title);

  try {
    window.sessionStorage.setItem(`${SNAPSHOT_PREFIX}${cacheKey}`, JSON.stringify(snapshot));
    window.sessionStorage.setItem(`${SNAPSHOT_PREFIX}last`, JSON.stringify(snapshot));
  } catch {
    // Cache pressure should never affect product navigation.
  }
}

export function readBundleOptionSnapshot(slug = '', optionKey = '', optionTitle = '') {
  if (typeof window === 'undefined') {
    return null;
  }

  const keys = [
    `${SNAPSHOT_PREFIX}${getCacheKey(slug, optionKey, optionTitle)}`,
    `${SNAPSHOT_PREFIX}last`,
  ];

  for (const key of keys) {
    try {
      const raw = window.sessionStorage.getItem(key);
      const snapshot = raw ? JSON.parse(raw) : null;

      if (!snapshot) {
        continue;
      }

      const sameSlug = normalizeText(snapshot.slug) === normalizeText(slug);
      const sameOption = !optionKey && !optionTitle
        ? true
        : (
          (optionKey && normalizeText(snapshot.bundle_option_key) === normalizeText(optionKey))
          || (optionTitle && normalizeText(snapshot.bundle_option_title) === normalizeText(optionTitle))
        );

      if (sameSlug && sameOption) {
        return snapshot;
      }
    } catch {
      // Ignore malformed old cache entries.
    }
  }

  return null;
}

export function readCachedBundleOptionDetail(slug = '', optionKey = '', optionTitle = '') {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${DETAIL_PREFIX}${getCacheKey(slug, optionKey, optionTitle)}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function prefetchBundleOptionDetail(product = {}, href = '') {
  if (typeof window === 'undefined' || !isBundleOptionProduct(product) || !product?.slug) {
    return Promise.resolve(null);
  }

  cacheBundleOptionSnapshot(product, href);

  const optionKey = getOptionKey(product);
  const optionTitle = getOptionTitle(product);
  const cacheKey = getCacheKey(product.slug, optionKey, optionTitle);

  if (pendingPrefetches.has(cacheKey)) {
    return pendingPrefetches.get(cacheKey);
  }

  const params = new URLSearchParams();
  if (optionKey) params.set('bundle_option_key', optionKey);
  if (optionTitle) params.set('bundle_option', optionTitle);

  const prefetchPromise = fetch(`${config.apiUrl}/web-api/products/${encodeURIComponent(product.slug)}/bundle-option-detail?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'X-Site-Code': config.siteCode,
    },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (payload) {
        try {
          window.sessionStorage.setItem(`${DETAIL_PREFIX}${cacheKey}`, JSON.stringify(payload));
        } catch {
          // Ignore cache pressure.
        }
      }

      return payload;
    })
    .catch(() => null)
    .finally(() => {
      pendingPrefetches.delete(cacheKey);
    });

  pendingPrefetches.set(cacheKey, prefetchPromise);
  return prefetchPromise;
}
