'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { resolveImageObjectUrl, resolveVideoEmbedUrl } from '@/lib/media';
import SimpleProductView from './product/SimpleProductView';
import ConfigurableProductView from './product/ConfigurableProductView';
import GroupedProductView from './product/GroupedProductView';
import BundleProductView from './product/BundleProductView';

const FALLBACK_PRODUCT_IMAGE = 'https://placehold.co/800';

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

export default function ProductDetailContent({ product }) {
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [hasExplicitVariantSelection, setHasExplicitVariantSelection] = useState(false);
  const [selectedGroupItems, setSelectedGroupItems] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
  const [activeBundleConfig, setActiveBundleConfig] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const { addToCart } = useCart();
  const router = useRouter();
  const hasStructuredVariantAttributes = product?.super_attributes?.length > 0;
  const hasVariants = product?.type === 'configurable' && product?.variations?.length > 0;

  // Initialize selected options
  useEffect(() => {
    if (hasStructuredVariantAttributes) {
      const initialOptions = {};
      // Preferred: pick values from the first available variation to ensure a valid combo
      const firstVariant = product.variations?.[0];
      
      product.super_attributes.forEach(attr => {
        // Try to get value from first variant
        if (firstVariant) {
          const varVal = firstVariant.attribute_values?.find(av => 
            (av.attribute?.code === attr.code || av.attribute_id === attr.id)
          )?.value;
          if (varVal) {
            initialOptions[attr.code] = varVal;
            return;
          }
        }

        // Fallback to product default or first option
        const val = product.attribute_values?.find(av => av.attribute_id === attr.id)?.value;
        if (val) {
          initialOptions[attr.code] = val;
        } else if (attr.options?.length > 0) {
          initialOptions[attr.code] = attr.options[0].value;
        }
      });
      setSelectedOptions(initialOptions);
    } else {
      setSelectedOptions({});
    }

    if (hasVariants) {
      setSelectedVariantId((prev) => {
        if (prev && product.variations?.some((variant) => variant.id === prev)) {
          return prev;
        }

        return product.variations?.[0]?.id ?? null;
      });
    } else {
      setSelectedVariantId(null);
    }

    setHasExplicitVariantSelection(false);

    if (product?.type === 'grouped' && product.grouped_items?.length > 0) {
      setSelectedGroupItems(product.grouped_items.map(item => item.id));
    }

    if (product?.type === 'bundle') {
      const items = product.bundle_items || product.grouped_items || [];
      if (items.length > 0) {
        let firstConfigTitle = '';
        const mappedItems = items.map((item, index) => {
          const groupName = getBundleOptionTitle(item);
          if (!firstConfigTitle && groupName) firstConfigTitle = groupName;

          return normalizeBundleItemState({
            ...item,
            option_title: groupName
          }, index);
        });

        setBundleItems(mappedItems.map(item => ({
          ...item,
          selected: !item.option_title || item.option_title === firstConfigTitle
        })));
        setActiveBundleConfig(firstConfigTitle);
      } else {
        setBundleItems([]);
        setActiveBundleConfig('');
      }
    } else {
      setBundleItems([]);
      setActiveBundleConfig('');
    }
  }, [hasStructuredVariantAttributes, hasVariants, product]);

  // Find the matching variant
  const matchingVariant = useMemo(() => {
    if (!hasVariants) return null;

    if (!hasStructuredVariantAttributes) {
      return product.variations.find((variant) => variant.id === selectedVariantId) || product.variations[0] || null;
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
    setBundleItems(prev => prev.map(item => 
      item.bundle_item_uid === bundleItemUid ? { ...item, qty: Math.max(1, newQty) } : item
    ));
  };

  const removeBundleItem = (bundleItemUid) => {
    setBundleItems(prev => prev.map(item =>
      item.bundle_item_uid === bundleItemUid ? { ...item, removed: true, selected: false } : item
    ));
  };

  const restoreBundleItem = (bundleItemUid) => {
    setBundleItems(prev => prev.map(item =>
      item.bundle_item_uid === bundleItemUid ? { ...item, removed: false, selected: true } : item
    ));
  };

  const updateBundleItemProduct = (bundleItemUid, newProduct) => {
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
    const items = product.bundle_items || product.grouped_items || [];
    if (items.length === 0) return;
    let firstConfigTitle = '';
    const mappedItems = items.map((item, index) => {
      const groupName = getBundleOptionTitle(item);
      if (!firstConfigTitle && groupName) firstConfigTitle = groupName;
      return normalizeBundleItemState({
        ...item,
        option_title: groupName
      }, index);
    });
    setBundleItems(mappedItems.map(item => ({
      ...item,
      selected: !item.option_title || item.option_title === firstConfigTitle
    })));
    setActiveBundleConfig(firstConfigTitle);
  };

  const toggleBundleItem = (bundleItemUid) => {
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
    const sourceImages = (currentProduct.images && currentProduct.images.length > 0)
      ? currentProduct.images
      : (product.images || []);

    const orderedImages = [...sourceImages].sort((left, right) => {
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
  }, [currentProduct, product.images]);
  const galleryVideoUrl = currentProduct?.video_url || product.video_url || '';
  const hasGalleryVideo = Boolean(resolveVideoEmbedUrl(galleryVideoUrl));

  const getImageUrl = (img) => resolveImageObjectUrl(img, FALLBACK_PRODUCT_IMAGE);

  useEffect(() => {
    setActiveIndex((previous) => {
      if (images.length === 0) {
        return hasGalleryVideo ? -1 : 0;
      }

      if (previous === -1 && hasGalleryVideo) {
        return -1;
      }

      if (previous >= 0 && previous < images.length) {
        return previous;
      }

      return 0;
    });
  }, [images, hasGalleryVideo]);

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

    return {
      itemsToCart: currentItems,
      finalPrice: pricing.finalSubtotal,
      pricing,
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
      const { itemsToCart, finalPrice, options, bundleMeta } = buildBundleCartPayload(resolvedActiveBundleConfig);
      if (itemsToCart.length === 0) {
        return;
      }
      addToCart(cartProduct, quantity, options, itemsToCart, finalPrice, bundleMeta);
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
        return `Vui lòng chọn ${missingAttributes.map((attr) => attr.name).join(', ')} trước khi đặt hàng.`;
      }

      if (!matchingVariant || !currentProduct?.id) {
        return 'Tổ hợp thuộc tính hiện tại chưa hợp lệ. Vui lòng chọn lại trước khi đặt hàng.';
      }

      if (hasConfigurableChoices && !hasExplicitVariantSelection) {
        return 'Vui lòng chọn đầy đủ thuộc tính sản phẩm trước khi đặt hàng.';
      }

      return '';
    }

    if (!currentProduct?.id || !selectedVariantId) {
      return 'Vui lòng chọn phân loại sản phẩm trước khi đặt hàng.';
    }

    if (hasConfigurableChoices && !hasExplicitVariantSelection) {
      return 'Vui lòng chọn phân loại sản phẩm trước khi đặt hàng.';
    }

    return '';
  };

  const handleOptionSelect = (attrCode, value) => {
    setHasExplicitVariantSelection(true);
    setSelectedOptions(prev => {
      const next = { ...prev, [attrCode]: value };
      
      // Auto-correct other attributes if they become invalid with the new selection
      product.super_attributes?.forEach(attr => {
        if (attr.code === attrCode) return;

        const currentVal = next[attr.code];
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
    setSelectedVariantId(variantId);
    setActiveIndex(0);
  };

  const checkAndScrollToOptions = () => {
    let needsSelection = false;
    if (hasVariants) {
      const isStructuredIncomplete = hasStructuredVariantAttributes && (product.super_attributes || []).some((attr) => !selectedOptions[attr.code]);
      if (isStructuredIncomplete || !matchingVariant || !currentProduct?.id || (hasConfigurableChoices && !hasExplicitVariantSelection)) {
         needsSelection = true;
      }
    } else if (product?.type === 'bundle') {
      const { itemsToCart } = buildBundleCartPayload(resolvedActiveBundleConfig);
      if (itemsToCart.length === 0) {
         needsSelection = true;
      }
    }

    if (needsSelection) {
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

  const handleAddToCart = (e) => {
    if (e) e.preventDefault();
    if (checkAndScrollToOptions()) return;
    addCurrentSelectionToCart();
    flyToCart(e, images?.[0] ? getImageUrl(images[0]) : '/logo-dai-thanh.png');
  };

  const handleAddBundleConfig = (configName, e) => {
    if (e) e.preventDefault();
    const { itemsToCart, finalPrice, options, bundleMeta } = getBundleSelectionByConfig(configName);
    if (itemsToCart.length === 0) return;

    addToCart(product, quantity, options, itemsToCart, finalPrice, bundleMeta);
    flyToCart(
      e,
      images?.[0] ? getImageUrl(images[0]) : '/logo-dai-thanh.png'
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
    getMobileQuickOrderValidationMessage,
    router
  ]);

  const handleBuyBundleConfig = (configName) => {
    const { itemsToCart, finalPrice, options, bundleMeta } = getBundleSelectionByConfig(configName);
    if (itemsToCart.length === 0) return;

    addToCart(product, quantity, options, itemsToCart, finalPrice, bundleMeta);
    router.push('/cart');
  };

  // Buy only the items in a specific tab config (called from BundleProductView)
  const handleBuyTabConfig = (tabItems) => {
    const configName = resolveBundleConfigName(tabItems) || resolvedActiveBundleConfig;
    const { itemsToCart, finalPrice, options, bundleMeta } = getBundleSelectionByConfig(configName);

    if (itemsToCart.length === 0) {
      return;
    }

    addToCart(product, 1, options, itemsToCart, finalPrice, bundleMeta);
    router.push('/cart');
  };

  const commonProps = {
    product,
    displayPrice,
    formatPrice,
    getImageUrl,
    images,
    videoUrl: galleryVideoUrl,
    activeIndex,
    setActiveIndex,
    quantity,
    setQuantity,
    handleAddToCart,
    handleBuyNow,
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
