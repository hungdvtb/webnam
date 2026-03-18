'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/context/CartContext';
import config from '@/lib/config';
import SimpleProductView from './product/SimpleProductView';
import ConfigurableProductView from './product/ConfigurableProductView';
import GroupedProductView from './product/GroupedProductView';
import BundleProductView from './product/BundleProductView';

export default function ProductDetailContent({ product }) {
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedGroupItems, setSelectedGroupItems] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const { addToCart } = useCart();
  const router = useRouter();

  // Initialize selected options
  useEffect(() => {
    if (product?.super_attributes?.length > 0) {
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
  }, [product]);

  // Find the matching variant
  const matchingVariant = useMemo(() => {
    if (!product?.variations || product.variations.length === 0) return null;

    return product.variations.find(variant => {
      return Object.entries(selectedOptions).every(([attrCode, selectedValue]) => {
        return variant.attribute_values?.some(av => 
          av.attribute?.code === attrCode && av.value === selectedValue
        );
      });
    });
  }, [product, selectedOptions]);

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
    setBundleItems(prev => prev.filter(item => item.id !== id));
  };

  const updateBundleItemProduct = (oldItemId, newProduct) => {
    setBundleItems(prev => prev.map(item => {
      if (item.id === oldItemId) {
        return {
          ...newProduct,
          qty: item.qty || 1,
          selected: true,
          option_title: item.option_title,
          pivot: {
              ...item.pivot,
              variant_id: newProduct.pivot?.link_type === 'super_link' ? newProduct.id : null
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
        .filter(item => item.selected)
        .reduce((acc, item) => acc + (parseFloat(item.price) * item.qty), 0);
      return sum;
    }
    return currentProduct.price;
  }, [product, currentProduct, selectedGroupItems, bundleItems]);

  const images = useMemo(() => {
    return (currentProduct.images && currentProduct.images.length > 0) 
      ? currentProduct.images 
      : (product.images || []);
  }, [currentProduct, product.images]);

  const getImageUrl = (img) => {
    const fallback = 'https://placehold.co/800';
    if (!img) return fallback;
    if (img.url && img.url.startsWith('http')) return img.url;
    
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
          return othersMatch && thisMatches && variant.stock_quantity > 0;
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
              return othersMatch && thisMatches && variant.stock_quantity > 0;
            });
          });
          if (firstValid) next[attr.code] = firstValid.value;
        }
      });

      return next;
    });
    setActiveIndex(0);
  };

  const handleAddToCart = (e) => {
    if (e) e.preventDefault();
    const items = (product.bundle_items?.length ? product.bundle_items : null)
      || (product.grouped_items?.length ? product.grouped_items : []);

    const itemsToCart = product.type === 'bundle'
      ? bundleItems.filter(it => it.selected).map((it, idx) => ({
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
    
    addToCart(product, quantity, selectedOptions, itemsToCart, displayPrice);
    alert('Đã thêm sản phẩm vào giỏ hàng!');
  };

  const handleBuyNow = (e) => {
    if (e) e.preventDefault();
    const items = (product.bundle_items?.length ? product.bundle_items : null)
      || (product.grouped_items?.length ? product.grouped_items : []);

    const itemsToCart = product.type === 'bundle'
      ? bundleItems.filter(it => it.selected).map((it, idx) => ({
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
    addToCart(product, quantity, selectedOptions, itemsToCart);
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
        switchBundleConfiguration={switchBundleConfiguration}
        resetBundleItems={resetBundleItems}
        handleAddToCart={handleAddToCart}
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

  if (product?.super_attributes?.length > 0) {
    return (
      <ConfigurableProductView 
        {...commonProps}
        currentProduct={currentProduct}
        selectedOptions={selectedOptions}
        handleOptionSelect={handleOptionSelect}
      />
    );
  }

  return <SimpleProductView {...commonProps} />;
}
