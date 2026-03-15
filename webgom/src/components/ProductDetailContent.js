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
      product.super_attributes.forEach(attr => {
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

    if (product?.type === 'bundle' && product.grouped_items?.length > 0) {
      setBundleItems(product.grouped_items.map(item => ({
        ...item,
        qty: item.pivot?.quantity || 1,
        selected: true
      })));
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
    const item = product.grouped_items?.find(i => i.id === id);
    if (!item || item.is_required) return;
    
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

  const displayPrice = useMemo(() => {
    if (product?.type === 'grouped' && product.grouped_items?.length > 0) {
      const sum = product.grouped_items
        .filter(item => selectedGroupItems.includes(item.id))
        .reduce((acc, item) => acc + (parseFloat(item.price) * (item.quantity || 1)), 0);
      return sum > 0 ? sum : product.price;
    }
    if (product?.type === 'bundle' && bundleItems.length > 0) {
      const sum = bundleItems
        .filter(item => item.selected)
        .reduce((acc, item) => acc + (parseFloat(item.price) * item.qty), 0);
      return sum > 0 ? sum : product.price;
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
    setSelectedOptions(prev => ({ ...prev, [attrCode]: value }));
    setActiveIndex(0);
  };

  const handleAddToCart = (e) => {
    if (e) e.preventDefault();
    addToCart(product, quantity, selectedOptions, selectedGroupItems);
    alert('Đã thêm sản phẩm vào giỏ hàng!');
  };

  const handleBuyNow = (e) => {
    if (e) e.preventDefault();
    addToCart(product, quantity, selectedOptions, selectedGroupItems);
    router.push('/cart');
  };

  const commonProps = {
    product,
    displayPrice,
    formatPrice,
    getImageUrl,
    images,
    activeIndex,
    setActiveIndex,
    quantity,
    setQuantity,
    handleAddToCart,
    handleBuyNow
  };

  if (product?.type === 'bundle') {
    return (
      <BundleProductView 
        {...commonProps}
        bundleItems={bundleItems}
        updateBundleItemQuantity={updateBundleItemQuantity}
        removeBundleItem={removeBundleItem}
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
