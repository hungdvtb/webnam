'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import {
  BUNDLE_METADATA_VERSION,
  buildBundleSnapshot,
  createBundleCartEntry,
  evaluateBundleSelection,
  getBundleOptionTitle,
  getBundleSourcePosition,
  getBundleSlotKey,
  resolveBundleConfigName,
} from '@/lib/bundlePricing';
import { flyToCart } from '@/utils/flyToCart';
import {
  getEntityImageCandidates,
  pickEntityPrimaryImage,
  resolveImageObjectUrl,
  resolveVideoEmbedUrl,
} from '@/lib/media';
import SimpleProductView from './product/SimpleProductView';
import ConfigurableProductView from './product/ConfigurableProductView';
import GroupedProductView from './product/GroupedProductView';
import BundleProductView from './product/BundleProductView';

const FALLBACK_PRODUCT_IMAGE = 'https://placehold.co/800';
const MOBILE_BOTTOM_ORDER_OFFSET = 96;
const BUNDLE_DETAIL_SCROLL_REQUEST_EVENT = 'webgom:bundle-detail-scroll-request';
const VARIANT_SELECTION_REQUIRED_MESSAGE = 'Vui lòng chọn mẫu/size trước khi đặt hàng';

const getMobileScrollOffset = () => {
  if (typeof document === 'undefined') {
    return 80;
  }

  const stickyHeader = document.querySelector('.mobile-sticky-header-shell');
  const stickyHeaderHeight = Math.round(
    stickyHeader?.getBoundingClientRect?.().height || stickyHeader?.offsetHeight || 0
  );

  if (stickyHeaderHeight > 0) {
    return stickyHeaderHeight + 8;
  }

  const promoBar = document.querySelector('.top-promotion-bar');
  const promoBarHeight = Math.round(promoBar?.getBoundingClientRect?.().height || 32);

  return promoBarHeight + 8;
};

const getBundleSelectionAreaNode = () => {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.querySelector('#bundle-list');
};

const isBundleSelectionAreaActive = (targetNode) => {
  if (typeof window === 'undefined' || !targetNode) {
    return false;
  }

  const rect = targetNode.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const topBoundary = getMobileScrollOffset();
  const activationBoundary = Math.min(
    viewportHeight * 0.45,
    viewportHeight - MOBILE_BOTTOM_ORDER_OFFSET
  );
  const lowerBoundary = Math.max(topBoundary + 120, activationBoundary);

  return rect.top <= lowerBoundary && rect.bottom > topBoundary + 80;
};

const scrollToBundleSelectionArea = (targetNode) => {
  if (typeof window === 'undefined' || !targetNode) {
    return false;
  }

  let handledByBundleView = false;

  window.dispatchEvent(
    new CustomEvent(BUNDLE_DETAIL_SCROLL_REQUEST_EVENT, {
      detail: {
        respond: () => {
          handledByBundleView = true;
        },
      },
    })
  );

  if (handledByBundleView) {
    return true;
  }

  const targetTop = Math.max(
    0,
    Math.round(window.scrollY + targetNode.getBoundingClientRect().top - getMobileScrollOffset())
  );

  window.scrollTo({ top: targetTop, behavior: 'smooth' });

  return true;
};

const sortProductImagesForDisplay = (sourceImages = []) => {
  const images = Array.isArray(sourceImages) ? sourceImages : [];

  return [...images].sort((left, right) => {
    const primaryDelta = Number(Boolean(right?.is_primary)) - Number(Boolean(left?.is_primary));

    if (primaryDelta !== 0) {
      return primaryDelta;
    }

    const leftSort = Number.isFinite(Number(left?.sort_order)) ? Number(left.sort_order) : Number.MAX_SAFE_INTEGER;
    const rightSort = Number.isFinite(Number(right?.sort_order)) ? Number(right.sort_order) : Number.MAX_SAFE_INTEGER;

    if (leftSort !== rightSort) {
      return leftSort - rightSort;
    }

    return Number(left?.id || 0) - Number(right?.id || 0);
  });
};

const filterUniqueRenderableImages = (sourceImages = []) => {
  const orderedImages = sortProductImagesForDisplay(sourceImages);
  const validImages = orderedImages.filter((image, index, collection) => {
    const resolvedUrl = resolveImageObjectUrl(image, '');

    if (!resolvedUrl) {
      return false;
    }

    return collection.findIndex((candidate) => (
      resolveImageObjectUrl(candidate, '') === resolvedUrl
    )) === index;
  });

  return validImages.length > 0 ? validImages : orderedImages;
};

const normalizeProductVideoUrls = (items = [], fallbackUrl = '') => {
  const sourceItems = Array.isArray(items) ? items : (items ? [items] : []);
  const urls = sourceItems
    .map((item) => String(typeof item === 'object' ? (item?.url || item?.video_url || '') : item || '').trim())
    .filter(Boolean);

  const legacyUrl = String(fallbackUrl || '').trim();
  if (urls.length === 0 && legacyUrl) {
    urls.push(legacyUrl);
  }

  return urls.filter((url, index, collection) => (
    collection.indexOf(url) === index && Boolean(resolveVideoEmbedUrl(url))
  ));
};

const resolveBundleOptionVideoUrls = (product, activeConfig) => {
  const parentVideoUrls = normalizeProductVideoUrls(product?.video_urls, product?.video_url || '');
  const normalizedConfig = String(activeConfig || '').trim();

  if (product?.type !== 'bundle' || !normalizedConfig) {
    return parentVideoUrls;
  }

  const optionVideoUrls = (product.bundle_items || product.grouped_items || [])
    .filter((item) => getBundleOptionTitle(item) === normalizedConfig)
    .map((item) => item?.option_video_url || item?.pivot?.option_video_url || '')
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  const uniqueOptionVideoUrls = optionVideoUrls.filter((url, index, collection) => collection.indexOf(url) === index);

  return normalizeProductVideoUrls([
    ...uniqueOptionVideoUrls,
    ...parentVideoUrls,
  ]);
};

const getPinnedEntityGalleryImages = (entity) => {
  const primaryImage = pickEntityPrimaryImage(entity, 'large');
  const pinnedPrimaryImage = primaryImage && typeof primaryImage === 'object'
    ? { ...primaryImage, is_primary: true, sort_order: -1 }
    : null;

  return filterUniqueRenderableImages([
    pinnedPrimaryImage,
    ...getEntityImageCandidates(entity),
  ].filter(Boolean));
};

const createBundleItemUid = (item, fallbackIndex = 0) => {
  const optionTitle = getBundleOptionTitle(item);
  const baseProductId = Number(item?.base_product_id ?? item?.id ?? 0);
  const sourcePosition = getBundleSourcePosition(item, fallbackIndex);
  return `${optionTitle}::${baseProductId}::${sourcePosition}`;
};

const normalizeBundleItemState = (item, fallbackIndex = 0) => {
  const optionTitle = getBundleOptionTitle(item);
  const sourcePosition = getBundleSourcePosition(item, fallbackIndex);
  const baseProductId = Number(item?.base_product_id ?? item?.id ?? 0);
  const selectedProductId = Number(item?.selected_product_id ?? item?.pivot?.variant_id ?? item?.id ?? 0) || baseProductId;

  return {
    ...item,
    bundle_item_uid: item?.bundle_item_uid || createBundleItemUid(item, fallbackIndex),
    bundle_slot_key: item?.bundle_slot_key || getBundleSlotKey(item, fallbackIndex),
    option_title: optionTitle,
    source_position: sourcePosition,
    base_product_id: baseProductId,
    base_product_slug: item?.base_product_slug || item?.slug || '',
    selected_product_id: selectedProductId,
    id: selectedProductId,
    qty: item?.qty ?? item?.pivot?.quantity ?? 1,
  };
};

const getBundleOptionUid = (item = {}) => String(
  item?.option_uid
  || item?.bundle_option_uid
  || item?.pivot?.bundle_option_uid
  || ''
).trim();

const resolveRequestedBundleConfig = (items = [], requestedKey = '', requestedTitle = '', requestedUid = '') => {
  const normalizedUid = String(requestedUid || '').trim();
  const normalizedKey = String(requestedKey || '').trim();
  const normalizedTitle = String(requestedTitle || '').trim();

  if (!normalizedUid && !normalizedKey && !normalizedTitle) {
    return '';
  }

  for (const item of Array.isArray(items) ? items : []) {
    const optionTitle = getBundleOptionTitle(item);
    const optionUid = getBundleOptionUid(item);
    const optionKey = String(
      item?.option_key
      || item?.pivot?.option_key
      || (item?.option_post_id ? `post:${item.option_post_id}` : optionTitle)
    ).trim();

    if (
      (normalizedUid && optionUid === normalizedUid)
      || (normalizedKey && optionKey === normalizedKey)
      || (normalizedTitle && optionTitle === normalizedTitle)
    ) {
      return optionTitle;
    }
  }

  return '';
};

const mapBundleItemsForConfig = (items = [], requestedKey = '', requestedTitle = '', requestedUid = '') => {
  let firstConfigTitle = '';
  const mappedItems = (Array.isArray(items) ? items : []).map((item, index) => {
    const groupName = getBundleOptionTitle(item);
    if (!firstConfigTitle && groupName) {
      firstConfigTitle = groupName;
    }

    return normalizeBundleItemState({
      ...item,
      option_title: groupName,
    }, index);
  });
  const requestedConfigTitle = resolveRequestedBundleConfig(
    mappedItems,
    requestedKey,
    requestedTitle,
    requestedUid,
  );

  return {
    mappedItems,
    initialConfigTitle: requestedConfigTitle || firstConfigTitle,
  };
};

const getBundleSourceItems = (product) => {
  if (product?.type !== 'bundle') {
    return [];
  }

  if (Array.isArray(product.bundle_items) && product.bundle_items.length > 0) {
    return product.bundle_items;
  }

  if (Array.isArray(product.grouped_items) && product.grouped_items.length > 0) {
    return product.grouped_items;
  }

  return [];
};

const buildBundleSelectionStateFromItems = (
  items = [],
  requestedUid = '',
  requestedKey = '',
  requestedTitle = '',
) => {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      bundleItems: [],
      activeBundleConfig: '',
    };
  }

  const { mappedItems, initialConfigTitle } = mapBundleItemsForConfig(
    items,
    requestedKey,
    requestedTitle,
    requestedUid,
  );

  return {
    bundleItems: mappedItems.map((item) => ({
      ...item,
      selected: !item.option_title || item.option_title === initialConfigTitle,
    })),
    activeBundleConfig: initialConfigTitle,
  };
};

const buildBundleSourceSignature = (product, items = []) => {
  if (product?.type !== 'bundle') {
    return `${product?.type || 'unknown'}:${product?.id || ''}`;
  }

  return [
    product?.id || '',
    product?.is_bundle_option_lite ? 'lite' : 'full',
    items.length,
    ...items.map((item, index) => ([
      item?.id || '',
      item?.base_product_id || '',
      item?.selected_product_id || '',
      item?.pivot?.variant_id || '',
      getBundleOptionTitle(item),
      getBundleOptionUid(item),
      getBundleSourcePosition(item, index),
      item?.qty ?? item?.pivot?.quantity ?? '',
      item?.price ?? item?.unit_price ?? '',
    ].join(':'))),
  ].join('|');
};

const buildInitialBundleSelectionState = (
  product,
  requestedUid = '',
  requestedKey = '',
  requestedTitle = '',
) => {
  if (product?.type !== 'bundle') {
    return {
      bundleItems: [],
      activeBundleConfig: '',
    };
  }

  return buildBundleSelectionStateFromItems(
    getBundleSourceItems(product),
    requestedUid,
    requestedKey,
    requestedTitle,
  );
};

export default function ProductDetailContent({
  product,
  requestedBundleOptionUid = '',
  requestedBundleOptionKey = '',
  requestedBundleOptionTitle = '',
  requestedVariantId = 0,
}) {
  const initialBundleSelectionState = useMemo(
    () => buildInitialBundleSelectionState(
      product,
      requestedBundleOptionUid,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product?.id, requestedBundleOptionUid, requestedBundleOptionKey, requestedBundleOptionTitle],
  );
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [hasExplicitVariantSelection, setHasExplicitVariantSelection] = useState(false);
  const [hasCustomerSelectedVariantMedia, setHasCustomerSelectedVariantMedia] = useState(false);
  const [variantSelectionNotice, setVariantSelectionNotice] = useState('');
  const [selectedGroupItems, setSelectedGroupItems] = useState([]);
  const [bundleItems, setBundleItems] = useState(initialBundleSelectionState.bundleItems);
  const [activeBundleConfig, setActiveBundleConfig] = useState(initialBundleSelectionState.activeBundleConfig);
  const [quantity, setQuantity] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const { addToCart } = useCart();
  const router = useRouter();
  const hasStructuredVariantAttributes = product?.super_attributes?.length > 0;
  const hasVariants = product?.type === 'configurable' && product?.variations?.length > 0;
  const bundleSourceItemsForState = useMemo(
    () => getBundleSourceItems(product),
    [product],
  );
  const bundleSourceSignature = useMemo(
    () => buildBundleSourceSignature(product, bundleSourceItemsForState),
    [bundleSourceItemsForState, product],
  );
  const bundleSourceSignatureRef = useRef(bundleSourceSignature);
  const hasCustomizedBundleRef = useRef(false);

  // Initialize configurable/grouped selected options on mount or when product changes.
  // Bundle state is intentionally excluded: it is initialized synchronously via useState()
  // using the useMemo result, so running setBundleItems here would cause a redundant
  // post-hydration re-render that manifests as a visible spinner delay (~4s on large bundles).
  useEffect(() => {
    const resolvedRequestedVariantId = Number.parseInt(String(requestedVariantId || '').trim(), 10) || 0;
    const requestedVariant = hasVariants && resolvedRequestedVariantId > 0
      ? (
        product.variations?.find((variant) => Number(variant.id) === resolvedRequestedVariantId)
        || null
      )
      : null;

    if (hasStructuredVariantAttributes) {
      const initialOptions = {};
      // Honor a requested variant from the URL, but do not preselect the first/default
      // variant on normal page load. A valid selection must come from the customer.
      if (requestedVariant) {
        product.super_attributes.forEach(attr => {
          const varVal = requestedVariant.attribute_values?.find(av =>
            (av.attribute?.code === attr.code || av.attribute_id === attr.id)
          )?.value;
          if (varVal) {
            initialOptions[attr.code] = varVal;
          }
        });
      }
      setSelectedOptions(initialOptions);
    } else {
      setSelectedOptions({});
    }

    if (hasVariants) {
      setSelectedVariantId(requestedVariant?.id ?? null);
    } else {
      setSelectedVariantId(null);
    }

    setHasExplicitVariantSelection(Boolean(requestedVariant?.id));
    setHasCustomerSelectedVariantMedia(false);
    setVariantSelectionNotice('');

    if (product?.type === 'grouped' && product.grouped_items?.length > 0) {
      setSelectedGroupItems(product.grouped_items.map(item => item.id));
    }
  }, [
    hasStructuredVariantAttributes,
    hasVariants,
    product,
    requestedVariantId,
  ]);

  // Sync bundle state when the product source changes. This handles deferred bundle
  // pages where a lite shell renders first and the full bundle items arrive later
  // with the same product id, without resetting customer edits afterwards.
  useEffect(() => {
    const previousSignature = bundleSourceSignatureRef.current;
    bundleSourceSignatureRef.current = bundleSourceSignature;

    if (previousSignature === bundleSourceSignature) {
      return;
    }

    if (hasCustomizedBundleRef.current && bundleItems.length > 0) {
      return;
    }

    if (product?.type !== 'bundle') {
      setBundleItems([]);
      setActiveBundleConfig('');
      hasCustomizedBundleRef.current = false;
      return;
    }

    const nextBundleSelectionState = buildBundleSelectionStateFromItems(
      bundleSourceItemsForState,
      requestedBundleOptionUid,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
    );

    setBundleItems(nextBundleSelectionState.bundleItems);
    setActiveBundleConfig(nextBundleSelectionState.activeBundleConfig);
    hasCustomizedBundleRef.current = false;
  }, [
    product?.type,
    bundleItems.length,
    bundleSourceItemsForState,
    bundleSourceSignature,
    requestedBundleOptionUid,
    requestedBundleOptionKey,
    requestedBundleOptionTitle,
  ]);

  // Find the matching variant
  const matchingVariant = useMemo(() => {
    if (!hasVariants) return null;

    if (!hasStructuredVariantAttributes) {
      if (!selectedVariantId) {
        return null;
      }

      return product.variations.find((variant) => variant.id === selectedVariantId) || null;
    }

    const isSelectionComplete = (product.super_attributes || []).every((attr) => selectedOptions[attr.code]);
    if (!isSelectionComplete) {
      return null;
    }

    return product.variations.find(variant => {
      return Object.entries(selectedOptions).every(([attrCode, selectedValue]) => {
        return variant.attribute_values?.some(av => 
          av.attribute?.code === attrCode && av.value === selectedValue
        );
      });
    });
  }, [hasStructuredVariantAttributes, hasVariants, product, selectedOptions, selectedVariantId]);

  const currentProduct = matchingVariant || product;
  const bundleSourceItems = useMemo(() => (
    (product?.bundle_items?.length ? product.bundle_items : null)
    || (product?.grouped_items?.length ? product.grouped_items : [])
  ), [product]);
  const resolvedActiveBundleConfig = useMemo(() => {
    if (product?.type !== 'bundle') {
      return '';
    }

    return activeBundleConfig
      || resolveBundleConfigName(bundleItems.filter((item) => item.selected))
      || resolveBundleConfigName(bundleSourceItems);
  }, [activeBundleConfig, bundleItems, bundleSourceItems, product?.type]);
  const selectedBundleCartItems = useMemo(() => {
    if (product?.type !== 'bundle') {
      return [];
    }

    return bundleItems
      .filter((item) => item.selected && !item.removed)
      .map((item, index) => createBundleCartEntry(item, index));
  }, [bundleItems, product?.type]);
  const selectedBundleSnapshot = useMemo(() => (
    product?.type === 'bundle'
      ? buildBundleSnapshot(bundleSourceItems, resolvedActiveBundleConfig)
      : []
  ), [bundleSourceItems, resolvedActiveBundleConfig, product?.type]);
  const selectedBundlePricing = useMemo(() => (
    product?.type === 'bundle'
      ? evaluateBundleSelection(selectedBundleCartItems, selectedBundleSnapshot)
      : null
  ), [selectedBundleCartItems, selectedBundleSnapshot, product?.type]);

  const hasConfigurableChoices = useMemo(() => {
    if (!hasVariants) return false;

    if (!hasStructuredVariantAttributes) {
      return (product?.variations?.length || 0) > 1;
    }

    const hasMultipleAttributeChoices = (product?.super_attributes || []).some(
      (attr) => (attr?.options?.length || 0) > 1
    );

    return hasMultipleAttributeChoices || (product?.variations?.length || 0) > 1;
  }, [hasStructuredVariantAttributes, hasVariants, product]);

  const toggleGroupItem = (id) => {
    const items = product.bundle_items || product.grouped_items || [];
    const item = items.find(i => i.id === id);
    if (!item || item.pivot?.is_required) return;
    
    setSelectedGroupItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const updateBundleItemQuantity = (bundleItemUid, newQty) => {
    hasCustomizedBundleRef.current = true;
    setBundleItems(prev => prev.map(item => 
      item.bundle_item_uid === bundleItemUid ? { ...item, qty: Math.max(1, newQty) } : item
    ));
  };

  const removeBundleItem = (bundleItemUid) => {
    hasCustomizedBundleRef.current = true;
    setBundleItems(prev => prev.map(item =>
      item.bundle_item_uid === bundleItemUid ? { ...item, removed: true, selected: false } : item
    ));
  };

  const restoreBundleItem = (bundleItemUid) => {
    hasCustomizedBundleRef.current = true;
    setBundleItems(prev => prev.map(item =>
      item.bundle_item_uid === bundleItemUid ? { ...item, removed: false, selected: true } : item
    ));
  };

  const updateBundleItemProduct = (bundleItemUid, newProduct) => {
    hasCustomizedBundleRef.current = true;
    setBundleItems(prev => prev.map(item => {
      if (item.bundle_item_uid === bundleItemUid) {
        const isSiblingVariant = newProduct?.pivot?.link_type === 'super_link';
        return normalizeBundleItemState({
          ...newProduct,
          qty: item.qty || 1,
          selected: true,
          removed: false,
          bundle_item_uid: item.bundle_item_uid,
          option_title: item.option_title || item.pivot?.option_title,
          source_position: item.source_position,
          base_product_id: isSiblingVariant
            ? item.base_product_id
            : Number(newProduct?.base_product_id ?? newProduct?.id ?? item.base_product_id),
          base_product_slug: isSiblingVariant
            ? item.base_product_slug
            : (newProduct?.base_product_slug || newProduct?.slug || ''),
          selected_product_id: Number(newProduct?.id ?? item.selected_product_id ?? item.id ?? item.base_product_id),
          pivot: {
            ...item.pivot,
            ...newProduct?.pivot,
            variant_id: isSiblingVariant
              ? Number(newProduct?.id ?? item.selected_product_id ?? item.id ?? item.base_product_id)
              : (newProduct?.pivot?.variant_id ?? null)
          }
        }, item.source_position);
      }
      return item;
    }));
  };

  const switchBundleConfiguration = (configName) => {
    setActiveBundleConfig(configName || '');
    setBundleItems(prev => {
      return prev.map(item => {
        const itemConfig = item.option_title || item.pivot?.option_title || '';
        if (itemConfig === configName) {
          return { ...item, selected: true };
        } else if (itemConfig && itemConfig !== configName) {
          // Deselect items from other named configurations
          return { ...item, selected: false };
        }
        return item; // Keep items without a configuration (general items)
      });
    });
  };

  // Reset bundle to original configuration from product data
  const resetBundleItems = () => {
    const items = getBundleSourceItems(product);
    if (items.length === 0) return;
    const { bundleItems: nextBundleItems, activeBundleConfig: nextActiveBundleConfig } = buildBundleSelectionStateFromItems(
      items,
      requestedBundleOptionUid,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
    );
    hasCustomizedBundleRef.current = false;
    setBundleItems(nextBundleItems);
    setActiveBundleConfig(nextActiveBundleConfig);
  };

  const toggleBundleItem = (bundleItemUid) => {
    hasCustomizedBundleRef.current = true;
    setBundleItems(prev => {
      const itemToToggle = prev.find(it => it.bundle_item_uid === bundleItemUid);
      if (!itemToToggle) return prev;

      const getGroupName = (it) => it.option_title || it.pivot?.option_title || it.category?.name || 'Thành phần mặc định';
      const groupName = getGroupName(itemToToggle);

      return prev.map(item => {
        if (item.bundle_item_uid === bundleItemUid) return { ...item, selected: true };
        if (getGroupName(item) === groupName) return { ...item, selected: false };
        return item;
      });
    });
  };

  const displayPrice = useMemo(() => {
    if (product?.type === 'grouped') {
      const items = product.bundle_items || product.grouped_items || [];
      const sum = items
        .filter(item => selectedGroupItems.includes(item.id))
        .reduce((acc, item) => acc + (parseFloat(item.price) * (item.pivot?.quantity || 1)), 0);
      return sum > 0 ? sum : product.price;
    }
    if (product?.type === 'bundle' && bundleItems.length > 0) {
      return selectedBundlePricing?.finalSubtotal ?? 0;
    }
    return currentProduct.current_price ?? currentProduct.price;
  }, [product, currentProduct, selectedGroupItems, bundleItems, selectedBundlePricing]);

  const images = useMemo(() => {
    return getPinnedEntityGalleryImages(product);
  }, [product]);
  const primaryDisplayImage = useMemo(() => {
    if (
      !hasExplicitVariantSelection
      || !hasCustomerSelectedVariantMedia
      || !hasVariants
      || !currentProduct?.id
      || currentProduct.id === product?.id
    ) {
      return null;
    }

    return getPinnedEntityGalleryImages(currentProduct)[0] || null;
  }, [
    currentProduct,
    currentProduct?.id,
    currentProduct?.images,
    hasExplicitVariantSelection,
    hasCustomerSelectedVariantMedia,
    hasVariants,
    product?.id,
  ]);
  const galleryVideoUrls = useMemo(
    () => resolveBundleOptionVideoUrls(product, resolvedActiveBundleConfig),
    [product, resolvedActiveBundleConfig]
  );
  const galleryVideoUrl = galleryVideoUrls[0] || '';
  const hasGalleryVideo = galleryVideoUrls.length > 0;

  const getImageUrl = (img) => resolveImageObjectUrl(img, FALLBACK_PRODUCT_IMAGE);

  useEffect(() => {
    setActiveIndex((previous) => {
      if (images.length === 0) {
        return hasGalleryVideo ? -1 : 0;
      }

      if (previous < 0 && hasGalleryVideo) {
        const requestedVideoIndex = Math.max(0, Math.abs(previous) - 1);
        return -1 - Math.min(requestedVideoIndex, Math.max(galleryVideoUrls.length - 1, 0));
      }

      if (previous >= 0 && previous < images.length) {
        return previous;
      }

      return 0;
    });
  }, [images, hasGalleryVideo, galleryVideoUrls]);

  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  const buildBundleCartPayload = (configName = resolvedActiveBundleConfig) => {
    const normalizedConfig = String(configName || '').trim();
    const currentItems = bundleItems
      .filter((item) => {
        if (item.removed) return false;

        const itemConfig = getBundleOptionTitle(item);

        if (normalizedConfig) {
          return !itemConfig || itemConfig === normalizedConfig;
        }

        return item.selected;
      })
      .map((item, index) => createBundleCartEntry(item, index));
    const resolvedConfigName = normalizedConfig
      || resolveBundleConfigName(currentItems)
      || resolveBundleConfigName(bundleSourceItems);
    const snapshotItems = buildBundleSnapshot(bundleSourceItems, resolvedConfigName);
    const pricing = evaluateBundleSelection(currentItems, snapshotItems);
    const options = {
      bundle_metadata_version: BUNDLE_METADATA_VERSION,
      is_full_bundle: pricing.isFullBundle,
      eligible_discount: pricing.eligibleDiscount,
      combo_discount_rate: pricing.comboDiscountRate,
      combo_discount_amount: pricing.comboDiscountAmount,
    };

    if (resolvedConfigName) {
      options.bundle_config = resolvedConfigName;
      options.bundle_option_title = resolvedConfigName;
    }

    const optionMedia = Array.isArray(product?.bundle_options)
      ? product.bundle_options.find((option) => {
        const optionTitle = String(
          option?.bundle_option_title
          || option?.title
          || option?.name
          || ''
        ).trim();

        return optionTitle === resolvedConfigName;
      })
      : null;
    const optionUid = String(
      optionMedia?.bundle_option_uid
      || optionMedia?.uid
      || currentItems.find((item) => getBundleOptionTitle(item) === resolvedConfigName)?.option_uid
      || currentItems.find((item) => getBundleOptionTitle(item) === resolvedConfigName)?.bundle_option_uid
      || currentItems.find((item) => getBundleOptionTitle(item) === resolvedConfigName)?.pivot?.bundle_option_uid
      || ''
    ).trim();

    if (optionUid) {
      options.bundle_option_uid = optionUid;
    }

    return {
      itemsToCart: currentItems,
      finalPrice: pricing.finalSubtotal,
      pricing,
      mediaContext: null,
      options,
      bundleMeta: {
        bundleConfigName: resolvedConfigName,
        bundleSnapshot: snapshotItems,
        originalGroupedItems: snapshotItems,
        pricing,
      },
    };
  };

  const getBundleSelectionByConfig = (configName) => {
    return buildBundleCartPayload(configName);
  };

  const getSelectedOptionsPayload = () => {
    if (product?.type !== 'configurable') {
      return selectedOptions;
    }

    const optionPayload = { ...selectedOptions };

    if (currentProduct?.id && currentProduct.id !== product.id) {
      optionPayload.variant_id = currentProduct.id;
      optionPayload.variant_name = currentProduct.name;
      optionPayload.variant_sku = currentProduct.sku;
      optionPayload.parent_product_id = product.id;
      optionPayload.parent_product_name = product.name;
    }

    return optionPayload;
  };

  const getCurrentItemsToCart = () => {
    const items = (product.bundle_items?.length ? product.bundle_items : null)
      || (product.grouped_items?.length ? product.grouped_items : []);

    return selectedGroupItems.map((id, idx) => {
      const item = items.find(i => i.id === id);
      return {
        uid: `${id}_${idx}`,
        id,
        name: item?.name,
        qty: item?.pivot?.quantity || 1,
        price: item?.price
      };
    });
  };

  const addCurrentSelectionToCart = () => {
    const cartProduct = product.type === 'configurable' ? currentProduct : product;

    if (product?.type === 'bundle') {
      const { itemsToCart, finalPrice, options, bundleMeta, mediaContext } = buildBundleCartPayload(resolvedActiveBundleConfig);
      if (itemsToCart.length === 0) {
        return;
      }
      addToCart(cartProduct, quantity, options, itemsToCart, finalPrice, bundleMeta, mediaContext);
      return;
    }

    addToCart(
      cartProduct,
      quantity,
      getSelectedOptionsPayload(),
      getCurrentItemsToCart(),
      displayPrice,
      null,
      product?.type === 'configurable'
        ? {
          variantProduct: currentProduct,
          parentProduct: product,
        }
        : null,
    );
  };

  const getMobileQuickOrderValidationMessage = () => {
    if (!hasVariants) {
      return '';
    }

    if (hasStructuredVariantAttributes) {
      const missingAttributes = (product.super_attributes || []).filter((attr) => !selectedOptions[attr.code]);

      if (missingAttributes.length > 0) {
        return VARIANT_SELECTION_REQUIRED_MESSAGE;
      }

      if (!matchingVariant || !currentProduct?.id) {
        return 'Tổ hợp thuộc tính hiện tại chưa hợp lệ. Vui lòng chọn lại trước khi đặt hàng.';
      }

      if (hasConfigurableChoices && !hasExplicitVariantSelection) {
        return VARIANT_SELECTION_REQUIRED_MESSAGE;
      }

      return '';
    }

    if (!currentProduct?.id || !selectedVariantId) {
      return VARIANT_SELECTION_REQUIRED_MESSAGE;
    }

    if (hasConfigurableChoices && !hasExplicitVariantSelection) {
      return VARIANT_SELECTION_REQUIRED_MESSAGE;
    }

    return '';
  };

  const handleOptionSelect = (attrCode, value) => {
    setHasExplicitVariantSelection(true);
    setHasCustomerSelectedVariantMedia(true);
    setVariantSelectionNotice('');
    setSelectedOptions(prev => {
      const next = { ...prev, [attrCode]: value };
      
      // Auto-correct other attributes if they become invalid with the new selection
      product.super_attributes?.forEach(attr => {
        if (attr.code === attrCode) return;

        const currentVal = next[attr.code];
        if (!currentVal) return;
        const isPossible = product.variations?.some(variant => {
          const othersMatch = Object.entries(next).every(([oCode, oVal]) => {
            if (oCode === attr.code) return true;
            return variant.attribute_values?.some(av => 
              (av.attribute?.code === oCode || av.attribute_id === product.super_attributes.find(a => a.code === oCode)?.id) 
              && av.value === oVal
            );
          });
          const thisMatches = variant.attribute_values?.some(av => 
            (av.attribute?.code === attr.code || av.attribute_id === attr.id) && av.value === currentVal
          );
          return othersMatch && thisMatches;
        });

        if (!isPossible) {
          // Find first valid option for this attribute given the current (new) state of NEXT
          const firstValid = attr.options?.find(opt => {
            return product.variations?.some(variant => {
              const othersMatch = Object.entries(next).every(([oCode, oVal]) => {
                if (oCode === attr.code) return true;
                return variant.attribute_values?.some(av => 
                  (av.attribute?.code === oCode || av.attribute_id === product.super_attributes.find(a => a.code === oCode)?.id) 
                  && av.value === oVal
                );
              });
              const thisMatches = variant.attribute_values?.some(av => 
                (av.attribute?.code === attr.code || av.attribute_id === attr.id) && av.value === opt.value
              );
              return othersMatch && thisMatches;
            });
          });
          if (firstValid) next[attr.code] = firstValid.value;
        }
      });

      return next;
    });
    setActiveIndex(0);
  };

  const handleVariantSelect = (variantId) => {
    setHasExplicitVariantSelection(true);
    setHasCustomerSelectedVariantMedia(true);
    setVariantSelectionNotice('');
    setSelectedVariantId(variantId);
    setActiveIndex(0);
  };

  const checkAndScrollToOptions = () => {
    let needsSelection = false;
    let needsVariantSelection = false;
    if (hasVariants) {
      const isStructuredIncomplete = hasStructuredVariantAttributes && (product.super_attributes || []).some((attr) => !selectedOptions[attr.code]);
      if (isStructuredIncomplete || !matchingVariant || !currentProduct?.id || (hasConfigurableChoices && !hasExplicitVariantSelection)) {
         needsSelection = true;
         needsVariantSelection = true;
      }
    } else if (product?.type === 'bundle') {
      const { itemsToCart } = buildBundleCartPayload(resolvedActiveBundleConfig);
      if (itemsToCart.length === 0) {
         needsSelection = true;
      }
    }

    if (needsSelection) {
      if (needsVariantSelection) {
        setVariantSelectionNotice(VARIANT_SELECTION_REQUIRED_MESSAGE);
      }
      // Find the selection section
      const targetNode = document.querySelector('#bundle-list, #variants-selection');
      if (targetNode) {
         const yOffset = -80; // offset for sticky header
         const y = targetNode.getBoundingClientRect().top + window.scrollY + yOffset;
         window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return true;
    }
    return false;
  };

  const scrollToBundleSelectionBeforeMobileOrder = () => {
    if (product?.type !== 'bundle') {
      return false;
    }

    const targetNode = getBundleSelectionAreaNode();

    if (!targetNode || isBundleSelectionAreaActive(targetNode)) {
      return false;
    }

    return scrollToBundleSelectionArea(targetNode);
  };

  const handleAddToCart = (e) => {
    if (e) e.preventDefault();
    if (checkAndScrollToOptions()) return;
    addCurrentSelectionToCart();
    const flyImage = primaryDisplayImage || images?.[0];
    flyToCart(e, flyImage ? getImageUrl(flyImage) : '/logo-dai-thanh.png');
  };

  const handleAddBundleConfig = (configName, e) => {
    if (e) e.preventDefault();
    const { itemsToCart, finalPrice, options, bundleMeta, mediaContext } = getBundleSelectionByConfig(configName);
    if (itemsToCart.length === 0) return;

    addToCart(product, quantity, options, itemsToCart, finalPrice, bundleMeta, mediaContext);
    const flyImage = primaryDisplayImage || images?.[0];
    flyToCart(
      e,
      flyImage ? getImageUrl(flyImage) : '/logo-dai-thanh.png'
    );
  };

  const handleBuyNow = (e) => {
    if (e) e.preventDefault();
    if (checkAndScrollToOptions()) return;
    addCurrentSelectionToCart();
    router.push('/cart');
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleMobileOrderRequest = (event) => {
      const respond = typeof event.detail?.respond === 'function' ? event.detail.respond : () => {};

      if (checkAndScrollToOptions()) {
        respond({ success: true }); // pretend success to prevent default error toast UI
        return;
      }

      if (scrollToBundleSelectionBeforeMobileOrder()) {
        respond({ success: true });
        return;
      }

      const validationMessage = getMobileQuickOrderValidationMessage();
      if (validationMessage) {
        respond({ success: false, message: validationMessage });
        return;
      }

      addCurrentSelectionToCart();
      respond({ success: true });
      router.push('/cart');
    };

    window.addEventListener('webgom:mobile-order-request', handleMobileOrderRequest);

    return () => {
      window.removeEventListener('webgom:mobile-order-request', handleMobileOrderRequest);
    };
  }, [
    addCurrentSelectionToCart,
    checkAndScrollToOptions,
    getMobileQuickOrderValidationMessage,
    router,
    scrollToBundleSelectionBeforeMobileOrder
  ]);

  const handleBuyBundleConfig = (configName) => {
    const { itemsToCart, finalPrice, options, bundleMeta, mediaContext } = getBundleSelectionByConfig(configName);
    if (itemsToCart.length === 0) return;

    addToCart(product, quantity, options, itemsToCart, finalPrice, bundleMeta, mediaContext);
    router.push('/cart');
  };

  // Buy only the items in a specific tab config (called from BundleProductView)
  const handleBuyTabConfig = (tabItems) => {
    const configName = resolveBundleConfigName(tabItems) || resolvedActiveBundleConfig;
    const { itemsToCart, finalPrice, options, bundleMeta, mediaContext } = getBundleSelectionByConfig(configName);

    if (itemsToCart.length === 0) {
      return;
    }

    addToCart(product, 1, options, itemsToCart, finalPrice, bundleMeta, mediaContext);
    router.push('/cart');
  };

  const commonProps = {
    product,
    displayPrice,
    formatPrice,
    getImageUrl,
    images,
    primaryDisplayImage,
    videoUrl: galleryVideoUrl,
    videoUrls: galleryVideoUrls,
    activeIndex,
    setActiveIndex,
    quantity,
    setQuantity,
    handleAddToCart,
    handleBuyNow,
    variantSelectionNotice,
    additionalInfo: (() => {
      try {
        if (!product.additional_info) return [];
        return typeof product.additional_info === 'string' ? JSON.parse(product.additional_info) : product.additional_info;
      } catch (e) { return []; }
    })()
  };

  if (product?.type === 'bundle') {
    return (
      <BundleProductView 
        {...commonProps}
        activeBundleConfig={resolvedActiveBundleConfig}
        bundleItems={bundleItems}
        updateBundleItemQuantity={updateBundleItemQuantity}
        updateBundleItemProduct={updateBundleItemProduct}
        removeBundleItem={removeBundleItem}
        restoreBundleItem={restoreBundleItem}
        switchBundleConfiguration={switchBundleConfiguration}
        resetBundleItems={resetBundleItems}
        handleAddToCart={handleAddToCart}
        handleAddBundleConfig={handleAddBundleConfig}
        handleBuyTabConfig={handleBuyTabConfig}
        handleBuyBundleConfig={handleBuyBundleConfig}
      />
    );
  }

  if (product?.type === 'grouped') {
    return (
      <GroupedProductView 
        {...commonProps}
        selectedGroupItems={selectedGroupItems}
        toggleGroupItem={toggleGroupItem}
      />
    );
  }

  if (hasVariants) {
    return (
      <ConfigurableProductView 
        {...commonProps}
        currentProduct={currentProduct}
        hasStructuredVariantAttributes={hasStructuredVariantAttributes}
        selectedOptions={selectedOptions}
        handleOptionSelect={handleOptionSelect}
        handleVariantSelect={handleVariantSelect}
      />
    );
  }

  return <SimpleProductView {...commonProps} />;
}
