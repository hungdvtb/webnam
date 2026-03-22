'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';
import config from '@/lib/config';
import SimpleProductView from './product/SimpleProductView';
import ConfigurableProductView from './product/ConfigurableProductView';
import GroupedProductView from './product/GroupedProductView';
import BundleProductView from './product/BundleProductView';

export default function ProductDetailContent({ product }) {
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [selectedGroupItems, setSelectedGroupItems] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
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

    if (product?.type === 'grouped' && product.grouped_items?.length > 0) {
      setSelectedGroupItems(product.grouped_items.map(item => item.id));
    }

    if (product?.type === 'bundle') {
      const items = product.bundle_items || product.grouped_items || [];
      if (items.length > 0) {
        let firstConfigTitle = '';
        const mappedItems = items.map(item => {
          const groupName = item.option_title || item.pivot?.option_title || '';
          if (!firstConfigTitle && groupName) firstConfigTitle = groupName;
          
          return {
            ...item,
            qty: item.pivot?.quantity || 1,
            option_title: groupName
          };
        });

        setBundleItems(mappedItems.map(item => ({
          ...item,
          selected: !item.option_title || item.option_title === firstConfigTitle
        })));
      }
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

  const toggleGroupItem = (id) => {
    const items = product.bundle_items || product.grouped_items || [];
    const item = items.find(i => i.id === id);
    if (!item || item.pivot?.is_required) return;
    
    setSelectedGroupItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const updateBundleItemQuantity = (id, newQty) => {
    setBundleItems(prev => prev.map(item => 
      item.id === id ? { ...item, qty: Math.max(1, newQty) } : item
    ));
  };

  const removeBundleItem = (id) => {
    setBundleItems(prev => prev.map(item =>
      item.id === id ? { ...item, removed: true, selected: false } : item
    ));
  };

  const restoreBundleItem = (id) => {
    setBundleItems(prev => prev.map(item =>
      item.id === id ? { ...item, removed: false, selected: true } : item
    ));
  };

  const updateBundleItemProduct = (oldItemId, newProduct) => {
    setBundleItems(prev => prev.map(item => {
      if (item.id === oldItemId) {
        return {
          ...newProduct,
          id: newProduct.id,
          qty: item.qty || 1,
          selected: true,
          removed: false,
          option_title: item.option_title || item.pivot?.option_title,
          pivot: {
              ...item.pivot,
              variant_id: (newProduct.pivot?.link_type === 'super_link') ? newProduct.id : (item.pivot?.variant_id || null)
          }
        };
      }
      return item;
    }));
  };

  const switchBundleConfiguration = (configName) => {
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
    const mappedItems = items.map(item => {
      const groupName = item.option_title || item.pivot?.option_title || '';
      if (!firstConfigTitle && groupName) firstConfigTitle = groupName;
      return {
        ...item,
        qty: item.pivot?.quantity || 1,
        option_title: groupName
      };
    });
    setBundleItems(mappedItems.map(item => ({
      ...item,
      selected: !item.option_title || item.option_title === firstConfigTitle
    })));
  };

  const toggleBundleItem = (id) => {
    setBundleItems(prev => {
      const itemToToggle = prev.find(it => it.id === id);
      if (!itemToToggle) return prev;

      const getGroupName = (it) => it.option_title || it.pivot?.option_title || it.category?.name || 'Thành phần mặc định';
      const groupName = getGroupName(itemToToggle);

      return prev.map(item => {
        if (item.id === id) return { ...item, selected: true };
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
      const sum = bundleItems
        .filter(item => item.selected && !item.removed)
        .reduce((acc, item) => acc + (parseFloat(item.price) * item.qty), 0);
      return sum;
    }
    return currentProduct.current_price ?? currentProduct.price;
  }, [product, currentProduct, selectedGroupItems, bundleItems]);

  const images = useMemo(() => {
    return (currentProduct.images && currentProduct.images.length > 0) 
      ? currentProduct.images 
      : (product.images || []);
  }, [currentProduct, product.images]);

  const getImageUrl = (img) => {
    const fallback = 'https://placehold.co/800';
    if (!img) return fallback;
    // Full URL stored directly in image_url field (most common from DB)
    if (img.image_url && img.image_url.startsWith('http')) return img.image_url;
    // Legacy: img.url field
    if (img.url && img.url.startsWith('http')) return img.url;
    // Path-based (relative path – prepend storageUrl)
    if (img.path && typeof img.path === 'string') {
      const cleanPath = img.path.trim().replace(/^[\/\\]+/, '');
      if (cleanPath && cleanPath !== 'undefined' && cleanPath !== 'null' && cleanPath !== '') {
        return `${config.storageUrl}/${cleanPath}`;
      }
    }
    if (img.url && img.url.trim() !== '') return img.url;
    return fallback;
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  const getBundleSelectionByConfig = (configName) => {
    const normalizedConfig = configName || '';
    const selectedItems = bundleItems.filter(item => {
      if (item.removed) return false;
      const itemConfig = item.option_title || item.pivot?.option_title || '';
      return !itemConfig || itemConfig === normalizedConfig;
    });

    const itemsToCart = selectedItems.map((it, idx) => ({
      uid: `${it.id}_${it.pivot?.variant_id || idx}`,
      id: it.id,
      name: it.name,
      qty: it.qty || 1,
      price: it.price,
      image: it.images?.[0]?.image_url || it.primary_image?.url
    }));

    const finalPrice = selectedItems.reduce(
      (acc, item) => acc + (parseFloat(item.price || 0) * (item.qty || 1)),
      0
    );

    return { itemsToCart, finalPrice };
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

  const handleOptionSelect = (attrCode, value) => {
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
    setSelectedVariantId(variantId);
    setActiveIndex(0);
  };

  const handleAddToCart = (e) => {
    if (e) e.preventDefault();
    const items = (product.bundle_items?.length ? product.bundle_items : null)
      || (product.grouped_items?.length ? product.grouped_items : []);

    const itemsToCart = product.type === 'bundle'
      ? bundleItems.filter(it => it.selected && !it.removed).map((it, idx) => ({
          uid: `${it.id}_${it.pivot?.variant_id || idx}`,  // unique per slot
          id: it.id,
          name: it.name,
          qty: it.qty,
          price: it.price,
          image: it.images?.[0]?.image_url || it.primary_image?.url
        }))
      : selectedGroupItems.map((id, idx) => {
          const item = items.find(i => i.id === id);
          return {
            uid: `${id}_${idx}`,
            id,
            name: item?.name,
            qty: item?.pivot?.quantity || 1,
            price: item?.price
          };
      });

    const cartProduct = product.type === 'configurable' ? currentProduct : product;
    addToCart(cartProduct, quantity, getSelectedOptionsPayload(), itemsToCart, displayPrice);
    flyToCart(e, images?.[0] ? getImageUrl(images[0]) : '/logo-dai-thanh.png');
  };

  const handleAddBundleConfig = (configName, e) => {
    if (e) e.preventDefault();
    const { itemsToCart, finalPrice } = getBundleSelectionByConfig(configName);
    if (itemsToCart.length === 0) return;

    addToCart(product, quantity, { bundle_config: configName }, itemsToCart, finalPrice);
    flyToCart(
      e,
      images?.[0] ? getImageUrl(images[0]) : '/logo-dai-thanh.png'
    );
  };

  const handleBuyNow = (e) => {
    if (e) e.preventDefault();
    const items = (product.bundle_items?.length ? product.bundle_items : null)
      || (product.grouped_items?.length ? product.grouped_items : []);

    const itemsToCart = product.type === 'bundle'
      ? bundleItems.filter(it => it.selected && !it.removed).map((it, idx) => ({
          uid: `${it.id}_${it.pivot?.variant_id || idx}`,
          id: it.id,
          name: it.name,
          qty: it.qty,
          price: it.price,
          image: it.images?.[0]?.image_url || it.primary_image?.url
        }))
      : selectedGroupItems.map((id, idx) => {
          const item = items.find(i => i.id === id);
          return {
            uid: `${id}_${idx}`,
            id,
            name: item?.name,
            qty: item?.pivot?.quantity || 1,
            price: item?.price
          };
      });

    const cartProduct = product.type === 'configurable' ? currentProduct : product;
    addToCart(cartProduct, quantity, getSelectedOptionsPayload(), itemsToCart, displayPrice);
    router.push('/cart');
  };

  const handleBuyBundleConfig = (configName) => {
    const { itemsToCart, finalPrice } = getBundleSelectionByConfig(configName);
    if (itemsToCart.length === 0) return;

    addToCart(product, quantity, { bundle_config: configName }, itemsToCart, finalPrice);
    router.push('/cart');
  };

  // Buy only the items in a specific tab config (called from BundleProductView)
  const handleBuyTabConfig = (tabItems, finalPrice) => {
    const itemsToCart = tabItems
      .filter(it => !it.removed)
      .map((it, idx) => ({
        uid: `${it.id}_${it.pivot?.variant_id || idx}`,
        id: it.id,
        name: it.name,
        qty: it.qty || 1,
        price: it.price,
        image: it.images?.[0]?.image_url || it.primary_image?.url
      }));
    addToCart(product, 1, {}, itemsToCart, finalPrice);
    router.push('/cart');
  };

  const commonProps = {
    product,
    displayPrice,
    formatPrice,
    getImageUrl,
    images,
    videoUrl: currentProduct?.video_url || product.video_url,
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
