'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  BUNDLE_METADATA_VERSION,
  buildBundleCartSignature,
  createBundleCartEntry,
} from '@/lib/bundlePricing';
import { getWebProductDetail } from '@/lib/api';
import {
  getEntityImageCollection,
  pickEntityPrimaryImage,
  resolveCartItemImageUrl,
} from '@/lib/media';
import { trackAddToCart } from '@/lib/analytics';

const CartContext = createContext();

const cloneCartValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(cloneCartValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneCartValue(nestedValue)])
    );
  }

  return value;
};

const CART_KEY_OPTION_IGNORED_KEYS = new Set([
  'is_full_bundle',
  'eligible_discount',
  'combo_discount_amount',
  'combo_discount_rate',
  'bundle_metadata_version',
]);

const normalizeOptions = (options = {}) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {};
  }

  return cloneCartValue(options);
};

const serializeOptionsForKey = (options = {}) => {
  const normalizedOptions = normalizeOptions(options);
  const filteredEntries = Object.entries(normalizedOptions)
    .filter(([key]) => !CART_KEY_OPTION_IGNORED_KEYS.has(key))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return JSON.stringify(Object.fromEntries(filteredEntries));
};

const cloneBundleEntries = (items = []) => (
  Array.isArray(items)
    ? items.map((item, index) => createBundleCartEntry(item, index))
    : []
);

const buildCartItemKey = (productId, options = {}, groupedItems = []) => (
  `${productId}-${serializeOptionsForKey(options)}-${buildBundleCartSignature(groupedItems)}`
);

const cloneImageCollection = (images = []) => (
  Array.isArray(images)
    ? images.map((image) => cloneCartValue(image))
    : []
);

const getCartMediaSource = (entity = null) => {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  return pickEntityPrimaryImage(entity, 'large') ? entity : null;
};

const buildCartItemMediaPayload = (product = {}, mediaContext = {}) => {
  const variantSource = getCartMediaSource(mediaContext?.variantProduct);
  const productSource = getCartMediaSource(product);
  const parentSource = getCartMediaSource(mediaContext?.parentProduct);
  const primarySource = variantSource || productSource || parentSource;

  return {
    image: cloneCartValue(
      pickEntityPrimaryImage(primarySource || product || mediaContext?.parentProduct || null, 'large')
    ),
    images: cloneImageCollection(getEntityImageCollection(primarySource || productSource || parentSource || null)),
    variantImage: cloneCartValue(pickEntityPrimaryImage(variantSource || null, 'large')),
    variantImages: cloneImageCollection(getEntityImageCollection(variantSource || null)),
    parentImage: cloneCartValue(pickEntityPrimaryImage(parentSource || null, 'large')),
    parentImages: cloneImageCollection(getEntityImageCollection(parentSource || null)),
    main_image: String(
      primarySource?.main_image
      || productSource?.main_image
      || product?.main_image
      || ''
    ).trim() || null,
    parent_main_image: String(
      parentSource?.main_image
      || mediaContext?.parentProduct?.main_image
      || ''
    ).trim() || null,
    variant_main_image: String(
      variantSource?.main_image
      || mediaContext?.variantProduct?.main_image
      || ''
    ).trim() || null,
  };
};

const getCartItemLookupKey = (item = {}) => {
  const parentProductId = Number(item?.options?.parent_product_id || 0);
  if (parentProductId > 0) {
    return String(parentProductId);
  }

  const variantId = Number(item?.options?.variant_id || 0);
  if (variantId > 0) {
    return String(variantId);
  }

  const slug = String(item?.slug || '').trim();
  if (slug) {
    return slug;
  }

  const productId = Number(item?.id || 0);
  return productId > 0 ? String(productId) : '';
};

const resolveLookupProducts = (item = {}, detail = null) => {
  if (!detail || typeof detail !== 'object') {
    return {
      product: null,
      variantProduct: null,
      parentProduct: null,
    };
  }

  const variantId = Number(item?.options?.variant_id || 0);
  const parentProductId = Number(item?.options?.parent_product_id || 0);
  const detailId = Number(detail?.id || 0);

  const variantProduct = variantId > 0
    ? (
      detailId === variantId
        ? detail
        : detail?.variations?.find((variant) => Number(variant?.id || 0) === variantId) || null
    )
    : null;

  const parentProduct = parentProductId > 0
    ? (detailId === parentProductId ? detail : null)
    : (variantProduct ? detail : null);

  return {
    product: variantProduct || detail,
    variantProduct,
    parentProduct,
  };
};

const normalizeCartItem = (item = {}) => {
  const normalizedOptions = normalizeOptions(item.options);
  const normalizedGroupedItems = cloneBundleEntries(item.groupedItems);
  const normalizedBundleSnapshot = cloneBundleEntries(item.bundleSnapshot);
  const fallbackOriginalGroupedItems = cloneBundleEntries(item.originalGroupedItems);
  const originalGroupedItems = normalizedBundleSnapshot.length > 0
    ? normalizedBundleSnapshot
    : fallbackOriginalGroupedItems;
  const quantity = Math.max(1, Number(item.quantity || 1));
  const bundleConfigName = String(
    item.bundleConfigName
    || normalizedOptions.bundle_option_title
    || normalizedOptions.bundle_config
    || ''
  ).trim();

  if (bundleConfigName && !normalizedOptions.bundle_option_title) {
    normalizedOptions.bundle_option_title = bundleConfigName;
  }

  if (bundleConfigName && !normalizedOptions.bundle_config) {
    normalizedOptions.bundle_config = bundleConfigName;
  }

  const productId = Number(item.id || item.product_id || 0);

  return {
    ...item,
    id: productId,
    quantity,
    price: Number(item.price ?? item.originalPrice ?? 0),
    originalPrice: Number(item.originalPrice ?? item.price ?? 0),
    image: cloneCartValue(item.image),
    images: cloneImageCollection(item.images),
    variantImage: cloneCartValue(item.variantImage ?? item.variant_image ?? null),
    variantImages: cloneImageCollection(item.variantImages ?? item.variant_images),
    parentImage: cloneCartValue(item.parentImage ?? item.parent_image ?? null),
    parentImages: cloneImageCollection(item.parentImages ?? item.parent_images),
    main_image: item.main_image ?? null,
    parent_main_image: item.parent_main_image ?? null,
    variant_main_image: item.variant_main_image ?? null,
    options: normalizedOptions,
    groupedItems: normalizedGroupedItems,
    bundleSnapshot: normalizedBundleSnapshot,
    originalGroupedItems,
    originalSubCount: originalGroupedItems.length || Math.max(Number(item.originalSubCount || 0), 0),
    bundleMetadataVersion: normalizedBundleSnapshot.length > 0
      ? Number(item.bundleMetadataVersion || BUNDLE_METADATA_VERSION)
      : Number(item.bundleMetadataVersion || 0),
    bundleConfigName,
    cartKey: item.cartKey || buildCartItemKey(productId, normalizedOptions, normalizedGroupedItems),
  };
};

const resolveBundleEntryUnitPrice = (product = {}, fallback = 0) => {
  const candidates = [
    product?.current_price,
    product?.price,
    product?.pivot?.price,
    fallback,
  ];

  for (const candidate of candidates) {
    const normalized = Number(candidate);
    if (Number.isFinite(normalized)) {
      return normalized;
    }
  }

  return 0;
};

const mergeBundleSelectionIntoEntry = (currentItem = {}, newProduct = {}, fallbackIndex = 0) => {
  const isSiblingVariant = newProduct?.pivot?.link_type === 'super_link';
  const preservedQty = Math.max(1, Number(currentItem?.qty || currentItem?.quantity || 1));
  const currentBaseProductId = Number(
    currentItem?.base_product_id
    || currentItem?.baseProductId
    || currentItem?.id
    || 0
  );
  const selectedProductId = Number(
    newProduct?.id
    || currentItem?.selected_product_id
    || currentItem?.product_id
    || currentItem?.id
    || currentBaseProductId
    || 0
  );
  const nextBaseProductId = isSiblingVariant
    ? currentBaseProductId
    : Number(
      newProduct?.base_product_id
      || newProduct?.baseProductId
      || newProduct?.id
      || currentBaseProductId
      || 0
    );
  const bundleItemUid = String(
    currentItem?.bundle_item_uid
    || currentItem?.uid
    || currentItem?.bundle_slot_key
    || currentItem?.id
    || `bundle-item-${fallbackIndex}`
  );
  const optionTitle = String(currentItem?.option_title || currentItem?.pivot?.option_title || '').trim();
  const sourcePosition = Number(currentItem?.source_position ?? currentItem?.pivot?.position ?? fallbackIndex);
  const resolvedVariantId = isSiblingVariant
    ? (selectedProductId || null)
    : (
      newProduct?.variant_id
      ?? newProduct?.pivot?.variant_id
      ?? currentItem?.variant_id
      ?? currentItem?.pivot?.variant_id
      ?? null
    );
  const resolvedPrice = resolveBundleEntryUnitPrice(
    newProduct,
    currentItem?.price ?? currentItem?.unit_price ?? 0
  );

  return createBundleCartEntry({
    ...currentItem,
    ...cloneCartValue(newProduct),
    id: selectedProductId || nextBaseProductId || currentBaseProductId,
    product_id: selectedProductId || nextBaseProductId || currentBaseProductId,
    selected_product_id: selectedProductId || nextBaseProductId || currentBaseProductId,
    base_product_id: nextBaseProductId || currentBaseProductId || selectedProductId,
    base_product_slug: isSiblingVariant
      ? (currentItem?.base_product_slug || '')
      : (newProduct?.base_product_slug || newProduct?.slug || currentItem?.base_product_slug || ''),
    bundle_item_uid: bundleItemUid,
    uid: bundleItemUid,
    bundle_slot_key: currentItem?.bundle_slot_key,
    option_title: optionTitle,
    source_position: Number.isFinite(sourcePosition) ? sourcePosition : fallbackIndex,
    name: newProduct?.name || currentItem?.name,
    product_name: newProduct?.name || currentItem?.product_name || currentItem?.name,
    sku: newProduct?.sku || currentItem?.sku,
    product_sku: newProduct?.sku || currentItem?.product_sku || currentItem?.sku,
    slug: newProduct?.slug || currentItem?.slug,
    qty: preservedQty,
    quantity: preservedQty,
    price: resolvedPrice,
    unit_price: resolvedPrice,
    variant_id: resolvedVariantId,
    pivot: {
      ...cloneCartValue(currentItem?.pivot || {}),
      ...cloneCartValue(newProduct?.pivot || {}),
      option_title: optionTitle || newProduct?.pivot?.option_title,
      position: Number.isFinite(sourcePosition) ? sourcePosition : fallbackIndex,
      quantity: preservedQty,
      variant_id: resolvedVariantId,
    },
  }, fallbackIndex);
};

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const savedCart = localStorage.getItem('webgom_cart');

    if (savedCart) {
      try {
        const parsedCart = JSON.parse(savedCart);
        setCartItems(
          Array.isArray(parsedCart)
            ? parsedCart.map((item) => normalizeCartItem(item))
            : []
        );
      } catch (error) {
        console.error('Failed to parse cart:', error);
      }
    }

    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('webgom_cart', JSON.stringify(cartItems));
    }
  }, [cartItems, isInitialized]);

  useEffect(() => {
    if (!isInitialized || cartItems.length === 0) {
      return undefined;
    }

    const unresolvedItems = cartItems.filter((item) => !resolveCartItemImageUrl(item, 'medium', ''));
    if (unresolvedItems.length === 0) {
      return undefined;
    }

    let isCancelled = false;

    const hydrateMissingCartImages = async () => {
      const detailPromiseCache = new Map();
      const updates = await Promise.all(
        unresolvedItems.map(async (item) => {
          const lookupKey = getCartItemLookupKey(item);
          if (!lookupKey) {
            return null;
          }

          try {
            if (!detailPromiseCache.has(lookupKey)) {
              detailPromiseCache.set(lookupKey, getWebProductDetail(lookupKey));
            }

            const detail = await detailPromiseCache.get(lookupKey);
            const { product: resolvedProduct, variantProduct, parentProduct } = resolveLookupProducts(item, detail);
            if (!resolvedProduct) {
              return null;
            }

            const mediaPayload = buildCartItemMediaPayload(resolvedProduct, {
              variantProduct,
              parentProduct,
            });

            if (!resolveCartItemImageUrl(mediaPayload, 'medium', '')) {
              return null;
            }

            return {
              cartKey: item.cartKey,
              mediaPayload,
            };
          } catch (error) {
            console.error('Failed to hydrate cart item image:', error);
            return null;
          }
        })
      );

      if (isCancelled) {
        return;
      }

      const updateMap = new Map(
        updates
          .filter((entry) => entry?.cartKey && entry?.mediaPayload)
          .map((entry) => [entry.cartKey, entry.mediaPayload])
      );

      if (updateMap.size === 0) {
        return;
      }

      setCartItems((prev) => prev.map((item) => (
        updateMap.has(item.cartKey)
          ? normalizeCartItem({ ...item, ...updateMap.get(item.cartKey) })
          : item
      )));
    };

    hydrateMissingCartImages();

    return () => {
      isCancelled = true;
    };
  }, [cartItems, isInitialized]);

  const addToCart = (
    product,
    quantity = 1,
    options = {},
    groupedItems = [],
    finalPrice = null,
    bundleMeta = null,
    mediaContext = null,
  ) => {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const normalizedGroupedItems = cloneBundleEntries(groupedItems);
    const normalizedBundleSnapshot = cloneBundleEntries(bundleMeta?.bundleSnapshot);
    const originalGroupedItems = normalizedBundleSnapshot.length > 0
      ? normalizedBundleSnapshot
      : cloneBundleEntries(bundleMeta?.originalGroupedItems);
    const normalizedOptions = normalizeOptions(options);
    const bundleConfigName = String(
      bundleMeta?.bundleConfigName
      || normalizedOptions.bundle_option_title
      || normalizedOptions.bundle_config
      || ''
    ).trim();

    if (bundleConfigName && !normalizedOptions.bundle_option_title) {
      normalizedOptions.bundle_option_title = bundleConfigName;
    }

    if (bundleConfigName && !normalizedOptions.bundle_config) {
      normalizedOptions.bundle_config = bundleConfigName;
    }

    if (bundleMeta?.pricing) {
      normalizedOptions.is_full_bundle = bundleMeta.pricing.isFullBundle;
      normalizedOptions.eligible_discount = bundleMeta.pricing.eligibleDiscount;
      normalizedOptions.combo_discount_rate = bundleMeta.pricing.comboDiscountRate;
      normalizedOptions.combo_discount_amount = bundleMeta.pricing.comboDiscountAmount;
      normalizedOptions.bundle_metadata_version = BUNDLE_METADATA_VERSION;
    }

    const itemKey = buildCartItemKey(product.id, normalizedOptions, normalizedGroupedItems);
    const cartItemMediaPayload = buildCartItemMediaPayload(product, mediaContext);
    trackAddToCart(product, quantity, {
      price: finalPrice ?? product.price,
      unit_value: finalPrice ?? product.current_price ?? product.price,
      options: normalizedOptions,
      bundle_config: bundleConfigName,
      grouped_items_count: normalizedGroupedItems.length,
    });

    setCartItems((prev) => {
      const existingItem = prev.find((item) => item.cartKey === itemKey);

      if (existingItem) {
        return prev.map((item) => (
          item.cartKey === itemKey
            ? normalizeCartItem({
              ...item,
              ...cartItemMediaPayload,
              quantity: item.quantity + quantity,
            })
            : item
        ));
      }

      return [
        ...prev,
        normalizeCartItem({
          cartKey: itemKey,
          id: product.id,
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          productUrl: currentUrl,
          price: finalPrice ?? product.price,
          originalPrice: bundleMeta?.pricing?.currentSubtotal ?? finalPrice ?? product.price,
          ...cartItemMediaPayload,
          quantity,
          options: normalizedOptions,
          groupedItems: normalizedGroupedItems,
          bundleSnapshot: normalizedBundleSnapshot,
          originalGroupedItems,
          originalSubCount: originalGroupedItems.length,
          bundleMetadataVersion: originalGroupedItems.length > 0 ? BUNDLE_METADATA_VERSION : 0,
          bundleConfigName,
        }),
      ];
    });
  };

  const removeFromCart = (cartKey) => {
    setCartItems((prev) => prev.filter((item) => item.cartKey !== cartKey));
  };

  const updateQuantity = (cartKey, newQuantity) => {
    if (newQuantity < 1) return;

    setCartItems((prev) => prev.map((item) => (
      item.cartKey === cartKey
        ? { ...item, quantity: newQuantity }
        : item
    )));
  };

  const updateItem = (cartKey, updates) => {
    setCartItems((prev) => prev.map((item) => (
      item.cartKey === cartKey
        ? normalizeCartItem({ ...item, ...updates })
        : item
    )));
  };

  const updateBundleItemProduct = (cartKey, bundleItemUid, newProduct) => {
    setCartItems((prev) => prev.map((item) => {
      if (item.cartKey !== cartKey || !Array.isArray(item.groupedItems) || item.groupedItems.length === 0) {
        return item;
      }

      let hasChanges = false;
      const nextGroupedItems = item.groupedItems.map((groupedItem, index) => {
        const currentUid = String(groupedItem?.bundle_item_uid || groupedItem?.uid || groupedItem?.id || '');

        if (currentUid !== String(bundleItemUid)) {
          return groupedItem;
        }

        hasChanges = true;
        return mergeBundleSelectionIntoEntry(groupedItem, newProduct, index);
      });

      return hasChanges
        ? normalizeCartItem({ ...item, groupedItems: nextGroupedItems })
        : item;
    }));
  };

  const clearCart = () => {
    setCartItems([]);
  };

  const restoreCombo = (cartKey) => {
    setCartItems((prev) => prev.map((item) => {
      if (item.cartKey !== cartKey) {
        return item;
      }

      const snapshotItems = cloneBundleEntries(
        item.bundleSnapshot?.length > 0
          ? item.bundleSnapshot
          : item.originalGroupedItems
      );

      return normalizeCartItem({
        ...item,
        groupedItems: snapshotItems,
      });
    }));
  };

  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const cartTotal = cartItems.reduce((acc, item) => {
    if (item.groupedItems?.length > 0) {
      const groupedSubtotal = item.groupedItems.reduce(
        (sum, groupedItem) => sum + (parseFloat(groupedItem.price || 0) * (groupedItem.qty || 1)),
        0
      );

      return acc + (groupedSubtotal * item.quantity);
    }

    return acc + (item.price * item.quantity);
  }, 0);

  return (
    <CartContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        updateQuantity,
        updateItem,
        updateBundleItemProduct,
        clearCart,
        restoreCombo,
        cartCount,
        cartTotal,
        isInitialized,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }

  return context;
}
