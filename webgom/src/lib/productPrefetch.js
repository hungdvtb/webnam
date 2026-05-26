'use client';

import { useEffect } from 'react';
import config from './config';

const SNAPSHOT_PREFIX = 'webgom:bundle-option-snapshot:';
const DETAIL_PREFIX = 'webgom:bundle-option-detail:';
const CACHE_VERSION = 8;
const MAX_IDLE_PREFETCHES = 12;
const MAX_CONCURRENT_PREFETCHES = 2;
const pendingPrefetches = new Map();
const queuedPrefetches = new Map();
let activePrefetchCount = 0;

const normalizeText = (value) => String(value || '').trim();

const isBundleOptionProduct = (product = {}) => (
  normalizeText(product?.item_type || product?.itemType) === 'bundle_option'
  || normalizeText(product?.bundle_option_uid || product?.bundleOptionUid || product?.option_uid) !== ''
  || normalizeText(product?.bundle_option_key || product?.bundleOptionKey) !== ''
  || normalizeText(product?.bundle_option_title || product?.bundleOptionTitle) !== ''
);

export const isBundleNavigationProduct = (product = {}) => (
  isBundleOptionProduct(product)
  || normalizeText(product?.type || product?.productType).toLowerCase() === 'bundle'
);

const getOptionKey = (product = {}) => normalizeText(product?.bundle_option_key || product?.bundleOptionKey);
const getOptionUid = (product = {}) => normalizeText(product?.bundle_option_uid || product?.bundleOptionUid || product?.option_uid);
const getOptionTitle = (product = {}) => normalizeText(product?.bundle_option_title || product?.bundleOptionTitle);

const getCacheKey = (slug = '', optionUid = '', optionKey = '', optionTitle = '') => {
  const identity = normalizeText(optionUid) || normalizeText(optionKey) || normalizeText(optionTitle) || 'default';
  return `${normalizeText(slug)}::${identity}`;
};

const pickBundleOptionSnapshot = (product = {}, href = '') => ({
  cache_version: CACHE_VERSION,
  __webgom_is_snapshot: true,
  cached_at: Date.now(),
  href,
  id: product?.id ?? null,
  slug: product?.slug || '',
  type: product?.type || product?.productType || 'bundle',
  item_type: product?.item_type || product?.itemType || (isBundleOptionProduct(product) ? 'bundle_option' : 'product'),
  name: product?.name || '',
  sku: product?.sku || '',
  price: product?.price ?? null,
  current_price: product?.current_price ?? product?.currentPrice ?? null,
  special_price: product?.special_price ?? product?.specialPrice ?? null,
  primary_image: product?.primary_image ?? product?.primaryImage ?? null,
  main_image: product?.main_image ?? product?.mainImage ?? null,
  images: Array.isArray(product?.images) ? product.images : [],
  video_url: product?.video_url || product?.videoUrl || '',
  video_urls: Array.isArray(product?.video_urls)
    ? product.video_urls
    : (Array.isArray(product?.videoUrls) ? product.videoUrls : []),
  category: product?.category ?? null,
  bundle_option_uid: getOptionUid(product),
  bundle_option_key: getOptionKey(product),
  bundle_option_title: getOptionTitle(product),
  bundle_option_total_price: product?.bundle_option_total_price ?? product?.bundleOptionTotalPrice ?? null,
  bundle_option_discounted_price: product?.bundle_option_discounted_price ?? product?.bundleOptionDiscountedPrice ?? null,
  bundle_option_discount_amount: product?.bundle_option_discount_amount ?? product?.bundleOptionDiscountAmount ?? null,
  bundle_parent_name: product?.bundle_parent_name ?? product?.bundleParentName ?? null,
  parent_product_id: product?.parent_product_id ?? product?.parentProductId ?? null,
});

export function cacheBundleOptionSnapshot(product = {}, href = '') {
  if (typeof window === 'undefined' || !isBundleNavigationProduct(product) || !product?.slug) {
    return;
  }

  const snapshot = pickBundleOptionSnapshot(product, href);
  const cacheKey = getCacheKey(product.slug, snapshot.bundle_option_uid, snapshot.bundle_option_key, snapshot.bundle_option_title);

  try {
    window.sessionStorage.setItem(`${SNAPSHOT_PREFIX}${cacheKey}`, JSON.stringify(snapshot));
    window.sessionStorage.setItem(`${SNAPSHOT_PREFIX}last`, JSON.stringify(snapshot));
  } catch {
    // Cache pressure should never affect product navigation.
  }
}

export function readBundleOptionSnapshot(slug = '', optionKey = '', optionTitle = '', optionUid = '') {
  if (typeof window === 'undefined') {
    return null;
  }

  const keys = [
    `${SNAPSHOT_PREFIX}${getCacheKey(slug, optionUid, optionKey, optionTitle)}`,
    `${SNAPSHOT_PREFIX}last`,
  ];

  for (const key of keys) {
    try {
      const raw = window.sessionStorage.getItem(key);
      const snapshot = raw ? JSON.parse(raw) : null;

      if (!snapshot) {
        continue;
      }

      if (Number(snapshot.cache_version || 0) !== CACHE_VERSION) {
        window.sessionStorage.removeItem(key);
        continue;
      }

      const sameSlug = normalizeText(snapshot.slug) === normalizeText(slug);
      const sameOption = !optionUid && !optionKey && !optionTitle
        ? true
        : (
          (optionUid && normalizeText(snapshot.bundle_option_uid) === normalizeText(optionUid))
          || (optionKey && normalizeText(snapshot.bundle_option_key) === normalizeText(optionKey))
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

export function readCachedBundleOptionDetail(slug = '', optionKey = '', optionTitle = '', optionUid = '') {
  if (typeof window === 'undefined') {
    return null;
  }

  const cacheKey = getCacheKey(slug, optionUid, optionKey, optionTitle);

  try {
    const raw = window.sessionStorage.getItem(`${DETAIL_PREFIX}${cacheKey}`);
    const payload = raw ? JSON.parse(raw) : null;

    if (Number(payload?.cache_version || 0) === CACHE_VERSION) {
      return payload;
    }

    window.sessionStorage.removeItem(`${DETAIL_PREFIX}${cacheKey}`);
    return null;
  } catch {
    return null;
  }
}

export function cacheBundleProductDetail(payload = {}, slug = '', optionKey = '', optionTitle = '', optionUid = '') {
  if (typeof window === 'undefined' || !payload || typeof payload !== 'object') {
    return;
  }

  const resolvedSlug = normalizeText(slug || payload.slug);

  if (!resolvedSlug) {
    return;
  }

  try {
    window.sessionStorage.setItem(`${DETAIL_PREFIX}${getCacheKey(resolvedSlug, optionUid, optionKey, optionTitle)}`, JSON.stringify({
      ...payload,
      cache_version: CACHE_VERSION,
      cached_at: Date.now(),
    }));
  } catch {
    // Cache pressure should never affect product navigation.
  }
}

const buildBundleDetailRequest = (product = {}) => {
  const slug = normalizeText(product?.slug);

  if (!slug || !isBundleNavigationProduct(product)) {
    return null;
  }

  const optionKey = getOptionKey(product);
  const optionUid = getOptionUid(product);
  const optionTitle = getOptionTitle(product);

  if (!isBundleOptionProduct(product)) {
    return {
      slug,
      optionKey: '',
      optionUid: '',
      optionTitle: '',
      cacheKey: getCacheKey(slug),
      endpoint: `/web-api/products/${encodeURIComponent(slug)}`,
    };
  }

  const params = new URLSearchParams();
  if (optionUid) params.set('bundle_option_uid', optionUid);
  if (optionKey) params.set('bundle_option_key', optionKey);
  if (optionTitle) params.set('bundle_option', optionTitle);

  return {
    slug,
    optionKey,
    optionUid,
    optionTitle,
    cacheKey: getCacheKey(slug, optionUid, optionKey, optionTitle),
    endpoint: `/web-api/products/${encodeURIComponent(slug)}/bundle-option-detail${params.toString() ? `?${params.toString()}` : ''}`,
  };
};

const buildBundleDetailRequestFromIdentity = (
  slug = '',
  optionKey = '',
  optionTitle = '',
  optionUid = '',
) => {
  const normalizedSlug = normalizeText(slug);

  if (!normalizedSlug) {
    return null;
  }

  const normalizedOptionKey = normalizeText(optionKey);
  const normalizedOptionTitle = normalizeText(optionTitle);
  const normalizedOptionUid = normalizeText(optionUid);

  if (!normalizedOptionUid && !normalizedOptionKey && !normalizedOptionTitle) {
    return {
      slug: normalizedSlug,
      optionKey: '',
      optionUid: '',
      optionTitle: '',
      cacheKey: getCacheKey(normalizedSlug),
      endpoint: `/web-api/products/${encodeURIComponent(normalizedSlug)}`,
    };
  }

  const params = new URLSearchParams();
  if (normalizedOptionUid) params.set('bundle_option_uid', normalizedOptionUid);
  if (normalizedOptionKey) params.set('bundle_option_key', normalizedOptionKey);
  if (normalizedOptionTitle) params.set('bundle_option', normalizedOptionTitle);

  return {
    slug: normalizedSlug,
    optionKey: normalizedOptionKey,
    optionUid: normalizedOptionUid,
    optionTitle: normalizedOptionTitle,
    cacheKey: getCacheKey(normalizedSlug, normalizedOptionUid, normalizedOptionKey, normalizedOptionTitle),
    endpoint: `/web-api/products/${encodeURIComponent(normalizedSlug)}/bundle-option-detail?${params.toString()}`,
  };
};

export function prefetchBundleOptionDetail(product = {}, href = '') {
  if (typeof window === 'undefined' || !isBundleNavigationProduct(product) || !product?.slug) {
    return Promise.resolve(null);
  }

  cacheBundleOptionSnapshot(product, href);

  const request = buildBundleDetailRequest(product);

  if (!request) {
    return Promise.resolve(null);
  }

  const cachedDetail = readCachedBundleOptionDetail(
    request.slug,
    request.optionKey,
    request.optionTitle,
    request.optionUid,
  );

  if (cachedDetail) {
    return Promise.resolve(cachedDetail);
  }

  if (pendingPrefetches.has(request.cacheKey)) {
    return pendingPrefetches.get(request.cacheKey);
  }

  const prefetchPromise = fetch(`${config.apiUrl}${request.endpoint}`, {
    headers: {
      Accept: 'application/json',
      'X-Site-Code': config.siteCode,
    },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (payload) {
        cacheBundleProductDetail(
          payload,
          request.slug,
          request.optionKey,
          request.optionTitle,
          request.optionUid,
        );
      }

      return payload;
    })
    .catch(() => null)
    .finally(() => {
      pendingPrefetches.delete(request.cacheKey);
    });

  pendingPrefetches.set(request.cacheKey, prefetchPromise);
  return prefetchPromise;
}

export function readPendingBundleProductDetail(slug = '', optionKey = '', optionTitle = '', optionUid = '') {
  const request = buildBundleDetailRequestFromIdentity(slug, optionKey, optionTitle, optionUid);

  if (!request) {
    return null;
  }

  return pendingPrefetches.get(request.cacheKey) || null;
}

export function getBundlePrefetchDescriptor(product = {}) {
  const request = buildBundleDetailRequest(product);

  if (!request) {
    return null;
  }

  return {
    key: request.cacheKey,
    storageKey: `${DETAIL_PREFIX}${request.cacheKey}`,
    url: `${config.apiUrl}${request.endpoint}`,
    siteCode: config.siteCode,
    cacheVersion: CACHE_VERSION,
  };
}

const runNextQueuedPrefetch = () => {
  if (activePrefetchCount >= MAX_CONCURRENT_PREFETCHES || queuedPrefetches.size === 0) {
    return;
  }

  const [cacheKey, entry] = queuedPrefetches.entries().next().value;
  queuedPrefetches.delete(cacheKey);
  activePrefetchCount += 1;

  prefetchBundleOptionDetail(entry.product, entry.href)
    .finally(() => {
      activePrefetchCount = Math.max(0, activePrefetchCount - 1);
      runNextQueuedPrefetch();
    });
};

const scheduleQueuedPrefetch = (product = {}, href = '') => {
  const request = buildBundleDetailRequest(product);

  if (!request || queuedPrefetches.has(request.cacheKey) || pendingPrefetches.has(request.cacheKey)) {
    return;
  }

  if (readCachedBundleOptionDetail(request.slug, request.optionKey, request.optionTitle, request.optionUid)) {
    return;
  }

  queuedPrefetches.set(request.cacheKey, { product, href });
  runNextQueuedPrefetch();
};

const scheduleIdleWork = (callback) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const timeoutId = window.setTimeout(callback, 80);
  return () => window.clearTimeout(timeoutId);
};

export function useVisibleBundleProductPrefetch(entries = []) {
  useEffect(() => {
    if (typeof window === 'undefined' || !Array.isArray(entries) || entries.length === 0) {
      return undefined;
    }

    const bundleEntries = entries.filter((entry) => (
      entry?.key
      && entry?.product?.slug
      && isBundleNavigationProduct(entry.product)
    ));

    if (bundleEntries.length === 0) {
      return undefined;
    }

    const entryByKey = new Map(bundleEntries.map((entry) => [String(entry.key), entry]));
    const observedNodes = Array.from(document.querySelectorAll('[data-bundle-prefetch-key]'))
      .filter((node) => entryByKey.has(node.getAttribute('data-bundle-prefetch-key') || ''));
    const cancelIdleCallbacks = [];
    const scheduledKeys = new Set();
    let scheduledCount = 0;

    const scheduleEntry = (entry) => {
      if (!entry || scheduledCount >= MAX_IDLE_PREFETCHES || scheduledKeys.has(String(entry.key))) {
        return;
      }

      scheduledCount += 1;
      scheduledKeys.add(String(entry.key));
      cancelIdleCallbacks.push(scheduleIdleWork(() => {
        scheduleQueuedPrefetch(entry.product, entry.href);
      }));
    };

    bundleEntries.slice(0, 4).forEach(scheduleEntry);

    if (observedNodes.length === 0 || typeof window.IntersectionObserver !== 'function') {
      bundleEntries.slice(0, 4).forEach(scheduleEntry);
      return () => {
        cancelIdleCallbacks.forEach((cancel) => cancel());
      };
    }

    const observer = new window.IntersectionObserver((observerEntries) => {
      observerEntries.forEach((observerEntry) => {
        if (!observerEntry.isIntersecting) {
          return;
        }

        const node = observerEntry.target;
        const key = node.getAttribute('data-bundle-prefetch-key') || '';
        scheduleEntry(entryByKey.get(key));
        observer.unobserve(node);
      });
    }, {
      rootMargin: '1200px 0px',
      threshold: 0.01,
    });

    observedNodes.forEach((node) => observer.observe(node));

    return () => {
      observer.disconnect();
      cancelIdleCallbacks.forEach((cancel) => cancel());
    };
  }, [entries]);
}
