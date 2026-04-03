'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  BUNDLE_METADATA_VERSION,
  buildBundleCartSignature,
  createBundleCartEntry,
} from '@/lib/bundlePricing';

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

  const addToCart = (
    product,
    quantity = 1,
    options = {},
    groupedItems = [],
    finalPrice = null,
    bundleMeta = null,
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

    setCartItems((prev) => {
      const existingItem = prev.find((item) => item.cartKey === itemKey);

      if (existingItem) {
        return prev.map((item) => (
          item.cartKey === itemKey
            ? { ...item, quantity: item.quantity + quantity }
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
          image: product.primary_image || (product.images && product.images[0]),
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
