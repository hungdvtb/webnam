"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import styles from './CategoryVariantQuickAdd.module.css';
import { getWebProductBundleOptionDetail, getWebProductDetail } from '@/lib/api';
import {
  BUNDLE_METADATA_VERSION,
  buildBundleSnapshot,
  createBundleCartEntry,
  evaluateBundleSelection,
  getBundleOptionTitle,
  resolveBundleConfigName,
} from '@/lib/bundlePricing';
import { logCategoryTiming } from '@/lib/productPerformance';
import { flyToCart } from '@/utils/flyToCart';
import { resolveImageObjectUrl } from '@/lib/media';

const QUICK_ADD_HISTORY_STATE_KEY = '__webgomCategoryVariantQuickAdd';

const getQuickAddPageKey = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return `${window.location.pathname}${window.location.search}`;
};

const getHistoryStateObject = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  const state = window.history?.state;
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
};

const getQuickAddHistoryMarker = (state) => (
  state && typeof state === 'object' && !Array.isArray(state)
    ? state[QUICK_ADD_HISTORY_STATE_KEY]
    : null
);

const stripQuickAddHistoryMarker = (state) => {
  const safeState = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const { [QUICK_ADD_HISTORY_STATE_KEY]: _quickAddMarker, ...restState } = safeState;
  return restState;
};

const FALLBACK_PRODUCT_IMAGE = '/logo-dai-thanh.png';
const READY_STATUS_TEXT = 'Sẵn sàng giao ngay';
const DEFAULT_VARIANT_NOTE = 'Mẫu + size phổ thông';

const formatPrice = (value) => (
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value || 0))
);

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const truthy = (value) => (
  value === true
  || value === 1
  || ['1', 'true', 't', 'yes'].includes(String(value || '').trim().toLowerCase())
);

const normalizeType = (value) => String(value || '').trim().toLowerCase();

const getVariantRows = (product = {}) => {
  const directRows = [
    ...(Array.isArray(product?.variations) ? product.variations : []),
    ...(Array.isArray(product?.variants) ? product.variants : []),
  ];
  const linkedRows = [
    ...(Array.isArray(product?.linked_products) ? product.linked_products : []),
    ...(Array.isArray(product?.linkedProducts) ? product.linkedProducts : []),
  ];

  const seen = new Set();

  return [...directRows, ...linkedRows.filter((variant) => variant?.pivot?.link_type === 'super_link')]
    .filter((variant) => variant && Number(variant.id || 0) > 0)
    .filter((variant) => {
      const id = Number(variant.id || 0);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
};

const hasVariantIndicator = (product = {}) => (
  truthy(product?.has_variants)
  || truthy(product?.hasVariants)
  || truthy(product?.has_configurable_variants)
  || Number(product?.variations_count || product?.variants_count || product?.variant_count || 0) > 0
);

export const hasConfigurableVariants = (product = {}) => (
  normalizeType(product?.type || product?.type_id || product?.product_type) === 'configurable'
  && product?.item_type !== 'bundle_option'
  && getVariantRows(product).length > 0
);

const isConfigurableProduct = (product = {}) => (
  product?.item_type !== 'bundle_option'
  && (
    normalizeType(product?.type || product?.type_id || product?.product_type) === 'configurable'
    || getVariantRows(product).length > 0
    || hasVariantIndicator(product)
  )
);

const isBundleProduct = (product = {}) => (
  normalizeType(product?.type || product?.type_id || product?.product_type) === 'bundle'
);

export const getDefaultVariant = (product = {}) => {
  const rows = getVariantRows(product);
  const explicitDefault = rows.find((variant) => (
    truthy(variant?.pivot?.is_default)
    || truthy(variant?.is_default)
    || truthy(variant?.default_variant)
  ));

  if (explicitDefault) {
    return explicitDefault;
  }

  const defaultVariantId = Number(product?.default_variant_id || product?.defaultVariantId || 0);
  return defaultVariantId > 0
    ? rows.find((variant) => Number(variant?.id || 0) === defaultVariantId) || null
    : null;
};

const isDefaultVariantRow = (product = {}, variant = {}) => {
  if (!variant) {
    return false;
  }

  if (
    truthy(variant?.pivot?.is_default)
    || truthy(variant?.is_default)
    || truthy(variant?.default_variant)
  ) {
    return true;
  }

  const defaultVariantId = Number(product?.default_variant_id || product?.defaultVariantId || 0);
  return defaultVariantId > 0 && Number(variant?.id || 0) === defaultVariantId;
};

const getVariantAttributeValues = (variant = {}) => (
  Array.isArray(variant?.attribute_values)
    ? variant.attribute_values
    : (Array.isArray(variant?.attributeValues) ? variant.attributeValues : [])
);

const getVariantNameSuffix = (product = {}, variant = {}) => {
  const variantName = String(variant?.name || '').trim();
  const productName = String(product?.name || '').trim();

  if (variantName && productName && normalizeText(variantName).startsWith(normalizeText(productName))) {
    const suffix = variantName.slice(productName.length).replace(/^[-:–—\s]+/, '').trim();
    if (suffix) {
      return suffix;
    }
  }

  return variantName || variant?.sku || '';
};

const isSizeAttribute = (entry = {}) => {
  const haystack = normalizeText([
    entry?.attribute?.code,
    entry?.attribute?.name,
    entry?.attribute_code,
    entry?.attribute_name,
  ].filter(Boolean).join(' '));

  return haystack.includes('size')
    || haystack.includes('kich thuoc')
    || haystack.includes('duong kinh')
    || haystack.includes('chieu cao')
    || haystack.includes('cm');
};

export const getVariantSelectionSummary = (product = {}, variant = {}) => {
  const values = getVariantAttributeValues(variant)
    .map((entry) => ({
      value: String(entry?.value ?? '').trim(),
      isSize: isSizeAttribute(entry),
    }))
    .filter((entry) => entry.value);

  if (values.length > 0) {
    return {
      value: values.map((entry) => entry.value).join(' / '),
      isSize: values.some((entry) => entry.isSize),
    };
  }

  return {
    value: getVariantNameSuffix(product, variant),
    isSize: false,
  };
};

const getVariantPrice = (variant = {}, fallback = 0) => {
  const candidates = [variant?.current_price, variant?.price, fallback];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return 0;
};

const getVariantImageUrl = (product = {}, variant = {}) => (
  resolveImageObjectUrl(variant?.primary_image, 'medium', '')
  || resolveImageObjectUrl(variant?.images?.[0], 'medium', '')
  || resolveImageObjectUrl(product?.primary_image, 'medium', FALLBACK_PRODUCT_IMAGE)
);

const getBundleSourceItems = (product = {}) => (
  Array.isArray(product?.bundle_items) && product.bundle_items.length > 0
    ? product.bundle_items
    : (Array.isArray(product?.grouped_items) ? product.grouped_items : [])
);

const getBundleOptionUid = (value = {}) => String(
  value?.bundle_option_uid
  || value?.uid
  || value?.option_uid
  || value?.pivot?.bundle_option_uid
  || ''
).trim();

const getBundleOptionName = (option = {}) => String(
  option?.name
  || option?.bundle_option_title
  || option?.title
  || option?.option_title
  || option?.pivot?.option_title
  || 'Tùy chọn bộ'
).trim();

const getBundleOptionConfigName = (option = {}) => String(
  option?.bundle_option_title
  || option?.title
  || option?.option_title
  || option?.pivot?.option_title
  || option?.name
  || ''
).trim();

const getBundleOptionKey = (option = {}) => String(
  option?.key
  || option?.bundle_option_key
  || option?.option_key
  || option?.pivot?.option_key
  || (
    option?.bundle_option_post_id || option?.option_post_id || option?.pivot?.option_post_id
      ? `post:${option?.bundle_option_post_id || option?.option_post_id || option?.pivot?.option_post_id}`
      : ''
  )
).trim();

const getBundleOptionPostId = (option = {}) => (
  option?.bundle_option_post_id
  ?? option?.option_post_id
  ?? option?.pivot?.option_post_id
  ?? null
);

const getBundleOptionImageObject = (option = {}) => (
  option?.primary_image
  || option?.option_image
  || option?.option_post_featured_image
  || option?.pivot?.option_image
  || (option?.main_image ? { url: option.main_image, path: option.main_image } : null)
  || (option?.option_image_url ? { url: option.option_image_url, path: option.option_image_url } : null)
  || (option?.pivot?.option_image_url ? { url: option.pivot.option_image_url, path: option.pivot.option_image_url } : null)
  || null
);

const getBundleOptionImageUrl = (product = {}, option = {}) => (
  resolveImageObjectUrl(getBundleOptionImageObject(option), 'medium', '')
  || resolveImageObjectUrl(product?.primary_image, 'medium', FALLBACK_PRODUCT_IMAGE)
);

const uniqueBundleOptions = (options = []) => {
  const seen = new Set();

  return options.filter((option) => {
    const key = getBundleOptionUid(option)
      || getBundleOptionKey(option)
      || getBundleOptionConfigName(option)
      || getBundleOptionName(option);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const buildDerivedBundleOptions = (product = {}) => {
  const sourceItems = getBundleSourceItems(product);
  const rowsByKey = new Map();

  sourceItems.forEach((item) => {
    const configName = getBundleOptionTitle(item) || 'Mặc định';
    const uid = getBundleOptionUid(item);
    const key = uid || getBundleOptionKey(item) || configName;

    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        key: getBundleOptionKey(item) || key,
        bundle_option_uid: uid || null,
        name: configName,
        title: configName,
        bundle_option_title: configName,
        bundle_option_post_id: getBundleOptionPostId(item),
        primary_image: getBundleOptionImageObject(item) || item?.primary_image || item?.images?.[0] || null,
        main_image: resolveImageObjectUrl(getBundleOptionImageObject(item) || item?.primary_image || item?.images?.[0], 'medium', ''),
      });
    }
  });

  return Array.from(rowsByKey.values()).map((option) => {
    const configName = getBundleOptionConfigName(option);
    const snapshotItems = buildBundleSnapshot(sourceItems, configName);
    const pricing = evaluateBundleSelection(snapshotItems, snapshotItems);

    return {
      ...option,
      price: pricing.currentSubtotal,
      current_price: pricing.finalSubtotal,
      bundle_option_total_price: pricing.currentSubtotal,
      bundle_option_discounted_price: pricing.finalSubtotal,
      items_count: snapshotItems.length,
    };
  });
};

const getBundleOptionRows = (product = {}) => {
  const directRows = uniqueBundleOptions(Array.isArray(product?.bundle_options) ? product.bundle_options : []);

  if (directRows.length > 0) {
    return directRows;
  }

  return buildDerivedBundleOptions(product);
};

const hasBundleCartSource = (product = {}) => getBundleSourceItems(product).length > 0;

const getBundleOptionPrice = (product = {}, option = {}, fallback = 0) => {
  const candidates = [
    option?.bundle_option_discounted_price,
    option?.current_price,
    option?.special_price,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  const configName = getBundleOptionConfigName(option);
  const sourceItems = getBundleSourceItems(product);
  const snapshotItems = buildBundleSnapshot(sourceItems, configName);

  if (snapshotItems.length > 0) {
    const pricing = evaluateBundleSelection(snapshotItems, snapshotItems);
    if (Number.isFinite(pricing.finalSubtotal) && pricing.finalSubtotal > 0) {
      return pricing.finalSubtotal;
    }
  }

  for (const candidate of [option?.bundle_option_total_price, option?.price, fallback]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return 0;
};

const normalizeBundleMatchKey = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();

const doesItemMatchBundleOption = (item = {}, option = {}, fallbackConfigName = '') => {
  const optionUid = getBundleOptionUid(option);
  const itemUid = getBundleOptionUid(item);

  if (optionUid && itemUid && optionUid === itemUid) {
    return true;
  }

  const optionKey = getBundleOptionKey(option);
  const itemKey = getBundleOptionKey(item);

  if (optionKey && itemKey && optionKey === itemKey) {
    return true;
  }

  const itemTitle = getBundleOptionTitle(item);
  return normalizeBundleMatchKey(itemTitle) === normalizeBundleMatchKey(fallbackConfigName);
};

const buildBundleCartPayload = (product = {}, option = {}, fallbackPrice = 0) => {
  const sourceItems = getBundleSourceItems(product);
  const configName = getBundleOptionConfigName(option)
    || resolveBundleConfigName(sourceItems)
    || getBundleOptionName(option);
  const selectedSourceItems = sourceItems.filter((item) => (
    doesItemMatchBundleOption(item, option, configName)
  ));
  const currentItems = selectedSourceItems.map((item, index) => createBundleCartEntry(item, index));
  const snapshotItems = currentItems.length > 0
    ? currentItems.map((item, index) => createBundleCartEntry(item, index))
    : buildBundleSnapshot(sourceItems, configName);
  const pricing = evaluateBundleSelection(currentItems, snapshotItems);
  const optionPrice = getBundleOptionPrice(product, option, fallbackPrice);
  const finalPrice = Number.isFinite(pricing.finalSubtotal) && pricing.finalSubtotal > 0
    ? pricing.finalSubtotal
    : optionPrice;
  const optionUid = getBundleOptionUid(option)
    || getBundleOptionUid(selectedSourceItems.find((item) => getBundleOptionUid(item)) || {});
  const optionKey = getBundleOptionKey(option)
    || getBundleOptionKey(selectedSourceItems.find((item) => getBundleOptionKey(item)) || {});
  const optionPostId = getBundleOptionPostId(option)
    ?? getBundleOptionPostId(selectedSourceItems.find((item) => getBundleOptionPostId(item)) || {});
  const options = {
    bundle_metadata_version: BUNDLE_METADATA_VERSION,
    is_full_bundle: pricing.isFullBundle,
    eligible_discount: pricing.eligibleDiscount,
    combo_discount_rate: pricing.comboDiscountRate,
    combo_discount_amount: pricing.comboDiscountAmount,
    bundle_option_total_price: pricing.currentSubtotal || option?.bundle_option_total_price || option?.price || finalPrice,
    bundle_option_discounted_price: finalPrice,
  };

  if (configName) {
    options.bundle_config = configName;
    options.bundle_option_title = configName;
  }

  if (optionUid) {
    options.bundle_option_uid = optionUid;
  }

  if (optionKey) {
    options.bundle_option_key = optionKey;
  }

  if (optionPostId) {
    options.bundle_option_post_id = optionPostId;
  }

  const optionImage = getBundleOptionImageObject(option)
    || getBundleOptionImageObject(selectedSourceItems[0])
    || product?.primary_image
    || null;
  const mediaContext = optionImage
    ? {
      variantProduct: {
        ...product,
        primary_image: optionImage,
        main_image: resolveImageObjectUrl(optionImage, 'large', '') || product?.main_image || '',
        images: [optionImage],
      },
      parentProduct: product,
    }
    : null;

  return {
    itemsToCart: currentItems,
    finalPrice,
    options,
    bundleMeta: {
      bundleConfigName: configName,
      bundleSnapshot: snapshotItems,
      originalGroupedItems: snapshotItems,
      pricing: {
        ...pricing,
        finalSubtotal: finalPrice,
      },
    },
    mediaContext,
  };
};

const buildVariantOptions = (product = {}, variant = {}) => {
  const options = {};

  getVariantAttributeValues(variant).forEach((entry) => {
    const value = String(entry?.value ?? '').trim();
    const key = String(entry?.attribute?.code || entry?.attribute_code || entry?.attribute_id || '').trim();

    if (key && value) {
      options[key] = value;
    }
  });

  return {
    ...options,
    variant_id: variant.id,
    variant_name: variant.name,
    variant_sku: variant.sku,
    parent_product_id: product.id,
    parent_product_name: product.name,
  };
};

const buildAddedMessage = (product = {}, variant = {}, isDefault = false) => {
  const summary = getVariantSelectionSummary(product, variant);
  const productName = String(product?.name || variant?.name || '').trim();
  const displayName = summary.value && !normalizeText(productName).includes(normalizeText(summary.value))
    ? `${productName} ${summary.value}`
    : (productName || variant?.name || 'sản phẩm');

  if (!isDefault) {
    return `Đã thêm ${displayName}`;
  }

  return `Đã thêm ${displayName} (${summary.isSize ? 'size thông thường' : 'mẫu mặc định'})`;
};

const getProductDetailIdentifier = (product = {}) => (
  String(product?.slug || product?.id || '').trim()
);

const getBundleDetailParams = (product = {}) => {
  const optionUid = getBundleOptionUid(product);
  const optionKey = getBundleOptionKey(product);
  const optionTitle = String(
    product?.bundle_option_title
    || product?.bundleOptionTitle
    || product?.option_title
    || product?.pivot?.option_title
    || ''
  ).trim();

  if (product?.item_type !== 'bundle_option' && !optionUid && !optionKey && !optionTitle) {
    return {};
  }

  return {
    bundle_option_uid: optionUid,
    bundle_option_key: optionKey,
    bundle_option: optionTitle,
  };
};

const extractProductDetailPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.product && typeof payload.product === 'object') {
    return payload.product;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }

  return payload;
};

export function ProductDefaultVariantBadge({ product }) {
  if (!hasConfigurableVariants(product)) {
    return null;
  }

  const defaultVariant = getDefaultVariant(product);
  if (!defaultVariant) {
    return null;
  }

  const summary = getVariantSelectionSummary(product, defaultVariant);
  const label = summary.isSize && summary.value
    ? `Size thường: ${summary.value}`
    : (summary.value ? `Mẫu mặc định: ${summary.value}` : 'Mẫu mặc định');

  return (
    <span className={styles.defaultBadge}>
      {label}
    </span>
  );
}

export default function CategoryVariantQuickAdd({
  product,
  addToCart,
  displayPrice,
  cartOptions = {},
  buttonClassName = '',
  children,
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerKind, setPickerKind] = useState('variant');
  const [notice, setNotice] = useState('');
  const [hydratedProduct, setHydratedProduct] = useState(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const noticeTimerRef = useRef(null);
  const scrollRestoreRef = useRef({ scrollY: 0, cardElement: null, cardTop: null });
  const isPickerOpenRef = useRef(isPickerOpen);
  const pickerHistoryIdRef = useRef('');
  const pickerHistoryPushedRef = useRef(false);
  const pickerProduct = hydratedProduct || product;
  const variants = useMemo(() => getVariantRows(pickerProduct), [pickerProduct]);
  const bundleOptions = useMemo(() => getBundleOptionRows(pickerProduct), [pickerProduct]);
  const bundleProduct = isBundleProduct(product) || isBundleProduct(pickerProduct);
  const configurable = isConfigurableProduct(product) || isConfigurableProduct(pickerProduct);
  const pickerWillOpenDialog = bundleProduct || configurable;

  const captureScrollRestoreTarget = useCallback((sourceElement) => {
    if (typeof window === 'undefined') {
      return;
    }

    const cardElement = sourceElement?.closest?.('[data-product-card="true"]') || null;
    const cardRect = cardElement?.getBoundingClientRect?.();

    scrollRestoreRef.current = {
      scrollY: window.scrollY || window.pageYOffset || 0,
      cardElement,
      cardTop: Number.isFinite(cardRect?.top) ? cardRect.top : null,
    };
  }, []);

  const restorePageScrollPosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const snapshot = scrollRestoreRef.current;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY || window.pageYOffset || 0;
        let targetTop = snapshot.scrollY || 0;

        if (
          snapshot.cardElement?.isConnected
          && Number.isFinite(snapshot.cardTop)
          && typeof snapshot.cardElement.getBoundingClientRect === 'function'
        ) {
          const nextCardTop = snapshot.cardElement.getBoundingClientRect().top;
          targetTop = currentScrollY + nextCardTop - snapshot.cardTop;
        }

        window.scrollTo({
          top: Math.max(0, targetTop),
          left: window.scrollX || 0,
          behavior: 'auto',
        });
      });
    });
  }, []);

  const pushPickerHistoryState = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const currentState = getHistoryStateObject();
    const currentMarker = getQuickAddHistoryMarker(currentState);
    const pageKey = getQuickAddPageKey();

    if (currentMarker?.id === pickerHistoryIdRef.current && currentMarker?.pageKey === pageKey) {
      pickerHistoryPushedRef.current = true;
      return;
    }

    try {
      window.history.pushState(
        {
          ...currentState,
          [QUICK_ADD_HISTORY_STATE_KEY]: {
            id: pickerHistoryIdRef.current,
            pageKey,
          },
        },
        '',
        window.location.href,
      );
      pickerHistoryPushedRef.current = true;
    } catch (error) {
      console.warn('Failed to push category quick-add history state.', error);
    }
  }, []);

  const popPickerHistoryState = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const currentState = getHistoryStateObject();
    const currentMarker = getQuickAddHistoryMarker(currentState);

    if (currentMarker?.id !== pickerHistoryIdRef.current) {
      return;
    }

    if (pickerHistoryPushedRef.current) {
      pickerHistoryPushedRef.current = false;
      try {
        window.history.back();
      } catch (error) {
        console.warn('Failed to pop category quick-add history state.', error);
      }
      return;
    }

    try {
      window.history.replaceState(
        stripQuickAddHistoryMarker(currentState),
        '',
        window.location.href,
      );
    } catch (error) {
      console.warn('Failed to clear category quick-add history state.', error);
    }
  }, []);

  const openPicker = useCallback((kind, sourceElement) => {
    captureScrollRestoreTarget(sourceElement);
    pickerHistoryIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pickerHistoryPushedRef.current = false;
    isPickerOpenRef.current = true;

    if (kind) {
      setPickerKind(kind);
    }

    setIsPickerOpen(true);
  }, [captureScrollRestoreTarget]);

  const closePicker = useCallback(() => {
    isPickerOpenRef.current = false;
    setIsPickerOpen(false);
    popPickerHistoryState();
    restorePageScrollPosition();
  }, [popPickerHistoryState, restorePageScrollPosition]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    isPickerOpenRef.current = isPickerOpen;
  }, [isPickerOpen]);

  useEffect(() => {
    setHydratedProduct(null);
    if (isPickerOpenRef.current) {
      closePicker();
    } else {
      setIsPickerOpen(false);
    }
    setIsLoadingOptions(false);
    setPickerKind('variant');
  }, [closePicker, product?.id, product?.slug, product?.item_type, product?.bundle_option_uid, product?.bundle_option_key]);

  useEffect(() => () => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isPickerOpen || typeof window === 'undefined') {
      return undefined;
    }

    if (!pickerHistoryIdRef.current) {
      pickerHistoryIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    pushPickerHistoryState();

    const handlePopState = (event) => {
      if (!isPickerOpenRef.current) {
        return;
      }

      const nextMarker = getQuickAddHistoryMarker(event.state);

      if (nextMarker?.id === pickerHistoryIdRef.current) {
        return;
      }

      pickerHistoryPushedRef.current = false;
      isPickerOpenRef.current = false;
      setIsPickerOpen(false);
      restorePageScrollPosition();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isPickerOpen, pushPickerHistoryState, restorePageScrollPosition]);

  useEffect(() => {
    if (!isPickerOpen || typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }

    const lockedScrollY = scrollRestoreRef.current.scrollY || window.scrollY || window.pageYOffset || 0;
    const previousBodyStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      right: document.body.style.right,
      left: document.body.style.left,
      width: document.body.style.width,
      paddingRight: document.body.style.paddingRight,
    };
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closePicker();
      }
    };

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.right = '0';
    document.body.style.left = '0';
    document.body.style.width = '100%';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyStyle.overflow;
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.right = previousBodyStyle.right;
      document.body.style.left = previousBodyStyle.left;
      document.body.style.width = previousBodyStyle.width;
      document.body.style.paddingRight = previousBodyStyle.paddingRight;
      document.removeEventListener('keydown', handleKeyDown);
      window.scrollTo({
        top: lockedScrollY,
        left: window.scrollX || 0,
        behavior: 'auto',
      });
    };
  }, [closePicker, isPickerOpen]);

  const showNotice = (message) => {
    setNotice(message);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 3200);
  };

  const animateCart = (eventOrElement, optionOrVariant = null, parentProduct = pickerProduct) => {
    const sourceElement = eventOrElement?.currentTarget || eventOrElement?.target || eventOrElement;
    const card = sourceElement?.closest?.('[data-product-card="true"]') || sourceElement?.closest?.(`.${styles.optionCard}`);
    const imgSrc = card?.querySelector?.('img')?.src
      || (
        pickerKind === 'bundle'
          ? getBundleOptionImageUrl(parentProduct, optionOrVariant || parentProduct)
          : getVariantImageUrl(parentProduct, optionOrVariant || parentProduct)
      );

    flyToCart({ currentTarget: sourceElement }, imgSrc || FALLBACK_PRODUCT_IMAGE);
  };

  const addSimpleProduct = (eventOrElement) => {
    addToCart(product, 1, cartOptions, [], displayPrice);
    showNotice(`Đã thêm ${product?.name || 'sản phẩm'}`);
    animateCart(eventOrElement);
  };

  const addVariant = (
    variant,
    eventOrElement,
    isDefault = false,
    parentProduct = pickerProduct,
    { closeAfterAdd = false } = {},
  ) => {
    const variantPrice = getVariantPrice(variant, displayPrice);
    addToCart(
      variant,
      1,
      buildVariantOptions(parentProduct, variant),
      [],
      variantPrice,
      null,
      {
        variantProduct: variant,
        parentProduct,
      },
    );
    showNotice(buildAddedMessage(parentProduct, variant, isDefault));
    animateCart(eventOrElement, variant, parentProduct);
    if (closeAfterAdd && isPickerOpenRef.current) {
      closePicker();
    } else if (closeAfterAdd) {
      setIsPickerOpen(false);
    }
  };

  const addBundleOption = async (option, eventOrElement, parentProduct = pickerProduct) => {
    const resolvedParentProduct = hasBundleCartSource(parentProduct)
      ? parentProduct
      : await loadProductDetail('bundle');
    const bundlePayload = buildBundleCartPayload(resolvedParentProduct, option, displayPrice);
    const optionName = getBundleOptionName(option);

    addToCart(
      resolvedParentProduct,
      1,
      bundlePayload.options,
      bundlePayload.itemsToCart,
      bundlePayload.finalPrice,
      bundlePayload.bundleMeta,
      bundlePayload.mediaContext,
    );
    showNotice(`Đã thêm ${optionName || resolvedParentProduct?.name || 'sản phẩm'}`);
    animateCart(eventOrElement, option, resolvedParentProduct);
    if (isPickerOpenRef.current) {
      closePicker();
    } else {
      setIsPickerOpen(false);
    }
  };

  const loadProductDetail = async (kind = 'variant') => {
    if (hydratedProduct) {
      return hydratedProduct;
    }

    const identifier = getProductDetailIdentifier(product);
    if (!identifier) {
      return pickerProduct;
    }

    setIsLoadingOptions(true);

    try {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const payload = kind === 'bundle'
        ? await getWebProductBundleOptionDetail(identifier, getBundleDetailParams(product))
        : await getWebProductDetail(identifier);
      const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      logCategoryTiming(kind === 'bundle' ? 'api-bundle-options' : 'api-variants', {
        identifier,
        productId: product?.id ?? null,
        productType: product?.type || '',
        durationMs: Math.round(finishedAt - startedAt),
      });
      const detailProduct = extractProductDetailPayload(payload);

      if (!detailProduct) {
        return pickerProduct;
      }

      const mergedProduct = {
        ...product,
        ...detailProduct,
        item_type: product?.item_type ?? detailProduct?.item_type,
        bundle_option_uid: product?.bundle_option_uid ?? detailProduct?.bundle_option_uid,
        bundle_option_key: product?.bundle_option_key ?? detailProduct?.bundle_option_key,
        bundle_option_post_id: product?.bundle_option_post_id ?? detailProduct?.bundle_option_post_id,
        bundle_option_title: product?.bundle_option_title ?? detailProduct?.bundle_option_title,
        default_variant_id: detailProduct?.default_variant_id ?? product?.default_variant_id,
        defaultVariantId: detailProduct?.defaultVariantId ?? product?.defaultVariantId ?? product?.default_variant_id,
      };

      setHydratedProduct(mergedProduct);
      return mergedProduct;
    } catch (error) {
      console.error('Failed to load product options:', error);
      return pickerProduct;
    } finally {
      setIsLoadingOptions(false);
    }
  };

  const handleButtonClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const triggerElement = event.currentTarget;

    if (bundleProduct) {
      openPicker('bundle', triggerElement);

      if (bundleOptions.length === 0 || !hasBundleCartSource(pickerProduct)) {
        await loadProductDetail('bundle');
      }
      return;
    }

    if (!configurable) {
      addSimpleProduct(triggerElement);
      return;
    }

    if (variants.length > 0) {
      openPicker('variant', triggerElement);
      return;
    }

    openPicker('variant', triggerElement);
    await loadProductDetail();
  };

  const renderVariantCard = (variant) => {
    const summary = getVariantSelectionSummary(pickerProduct, variant);
    const variantPrice = getVariantPrice(variant, displayPrice);
    const optionName = variant.name || getVariantNameSuffix(pickerProduct, variant) || summary.value || 'Biến thể';
    const isDefault = isDefaultVariantRow(pickerProduct, variant);

    return (
      <div key={variant.id} className={`${styles.optionCard} ${isDefault ? styles.defaultVariantCard : ''}`}>
        <span className={styles.optionThumb}>
          <Image
            src={getVariantImageUrl(pickerProduct, variant)}
            alt=""
            fill
            unoptimized
            sizes="76px"
            style={{ objectFit: 'cover' }}
 
          />
        </span>
        <div className={styles.optionInfo}>
          <strong className={styles.optionName}>{optionName}</strong>
          {summary.value && !normalizeText(optionName).includes(normalizeText(summary.value)) ? (
            <span className={styles.optionMeta}>{summary.value}</span>
          ) : null}
          {isDefault ? (
            <span className={styles.defaultVariantNote}>{DEFAULT_VARIANT_NOTE}</span>
          ) : null}
          <strong className={styles.optionPrice}>{formatPrice(variantPrice)}</strong>
          <span className={styles.stockState}>{READY_STATUS_TEXT}</span>
        </div>
        <button
          type="button"
          className={styles.selectButton}
          onClick={(event) => addVariant(variant, event.currentTarget, isDefault, pickerProduct)}
        >
          Thêm
        </button>
      </div>
    );
  };

  const renderBundleOptionCard = (option) => {
    const optionUid = getBundleOptionUid(option);
    const optionKey = getBundleOptionKey(option);
    const optionName = getBundleOptionName(option);
    const optionPrice = getBundleOptionPrice(pickerProduct, option, displayPrice);

    return (
      <div key={optionUid || optionKey || optionName} className={styles.optionCard}>
        <span className={styles.optionThumb}>
          <Image
            src={getBundleOptionImageUrl(pickerProduct, option)}
            alt=""
            fill
            unoptimized
            sizes="76px"
            style={{ objectFit: 'cover' }}
 
          />
        </span>
        <div className={styles.optionInfo}>
          <strong className={styles.optionName}>{optionName}</strong>
          <strong className={styles.optionPrice}>{formatPrice(optionPrice)}</strong>
          <span className={styles.stockState}>{READY_STATUS_TEXT}</span>
        </div>
        <button
          type="button"
          className={styles.selectButton}
          onClick={(event) => addBundleOption(option, event.currentTarget, pickerProduct)}
        >
          Chọn
        </button>
      </div>
    );
  };

  const modalTitle = pickerKind === 'bundle'
    ? (product?.name || pickerProduct?.name || 'Sản phẩm bundle')
    : (pickerProduct?.name || product?.name || 'Sản phẩm');
  const modalEyebrow = pickerKind === 'bundle' ? 'Chọn nhanh tùy chọn bộ' : 'Chọn nhanh biến thể';
  const displayItems = pickerKind === 'bundle' ? bundleOptions : variants;
  const emptyMessage = pickerKind === 'bundle'
    ? 'Sản phẩm này chưa có tùy chọn bundle khả dụng.'
    : 'Sản phẩm này chưa có biến thể khả dụng.';

  const pickerModal = isPickerOpen ? (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closePicker();
        }
      }}
    >
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`${modalEyebrow} ${modalTitle}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <div className={styles.dialogHeaderText}>
            <p className={styles.eyebrow}>{modalEyebrow}</p>
            <h3 className={styles.dialogTitle}>{modalTitle}</h3>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => closePicker()}
            aria-label="Đóng popup chọn nhanh"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
            <span className={styles.closeButtonLabel}>Đóng</span>
          </button>
        </div>

        <div className={styles.optionList}>
          {isLoadingOptions ? (
            <p className={styles.emptyText}>Đang tải tùy chọn...</p>
          ) : null}

          {!isLoadingOptions && displayItems.length > 0 ? (
            <div className={styles.optionGrid}>
              {displayItems.map((item) => (
                pickerKind === 'bundle'
                  ? renderBundleOptionCard(item)
                  : renderVariantCard(item)
              ))}
            </div>
          ) : null}

          {!isLoadingOptions && displayItems.length === 0 ? (
            <p className={styles.emptyText}>{emptyMessage}</p>
          ) : null}
        </div>

        <div className={styles.dialogFooter}>
          <span className={styles.resultCount}>{displayItems.length} tùy chọn</span>
          <button
            type="button"
            className={styles.footerCloseButton}
            onClick={() => closePicker()}
          >
            Đóng
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={handleButtonClick}
        disabled={isLoadingOptions}
        aria-haspopup={pickerWillOpenDialog ? 'dialog' : undefined}
        aria-expanded={pickerWillOpenDialog ? isPickerOpen : undefined}
        aria-busy={isLoadingOptions || undefined}
      >
        {children}
      </button>

      {notice ? (
        <div className={styles.notice} role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}

      {portalReady && pickerModal ? createPortal(pickerModal, document.body) : null}
    </>
  );
}
