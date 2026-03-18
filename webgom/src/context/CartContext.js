'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

const CartContext = createContext();

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load cart from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem('webgom_cart');
    if (savedCart) {
      try {
        setCartItems(JSON.parse(savedCart));
      } catch (e) {
        console.error('Failed to parse cart:', e);
      }
    }
    setIsInitialized(true);
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('webgom_cart', JSON.stringify(cartItems));
    }
  }, [cartItems, isInitialized]);

  const addToCart = (product, quantity = 1, options = {}, groupedItems = [], finalPrice = null) => {
    setCartItems(prev => {
      // Create a unique key for the item based on product ID, options, and grouped items
      const itemKey = `${product.id}-${JSON.stringify(options)}-${JSON.stringify(groupedItems.map(i => i.id).sort())}`;
      const existingItem = prev.find(item => item.cartKey === itemKey);

      if (existingItem) {
        return prev.map(item => 
          item.cartKey === itemKey 
            ? { ...item, quantity: item.quantity + quantity } 
            : item
        );
      }

      return [...prev, {
        cartKey: itemKey,
        id: product.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        price: finalPrice || product.price,
        originalPrice: finalPrice || product.price,
        image: product.primary_image || (product.images && product.images[0]),
        quantity,
        options,
        groupedItems: groupedItems,
        originalGroupedItems: groupedItems.length > 0 ? [...groupedItems] : [], // snapshot for restore
        originalSubCount: groupedItems.length   // track full-combo size for discount logic
      }];
    });
  };

  const removeFromCart = (cartKey) => {
    setCartItems(prev => prev.filter(item => item.cartKey !== cartKey));
  };

  const updateQuantity = (cartKey, newQuantity) => {
    if (newQuantity < 1) return;
    setCartItems(prev => prev.map(item => 
      item.cartKey === cartKey ? { ...item, quantity: newQuantity } : item
    ));
  };

  const updateItem = (cartKey, updates) => {
    setCartItems(prev => prev.map(item => 
      item.cartKey === cartKey ? { ...item, ...updates } : item
    ));
  };

  const clearCart = () => {
    setCartItems([]);
  };

  // Restore a bundle/combo back to its original sub-items
  const restoreCombo = (cartKey) => {
    setCartItems(prev => prev.map(item =>
      item.cartKey === cartKey
        ? { ...item, groupedItems: [...(item.originalGroupedItems || [])] }
        : item
    ));
  };

  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);

  // Dynamically compute from sub-items for bundle/combo items so that
  // removing or changing qty of a sub-item is instantly reflected.
  const cartTotal = cartItems.reduce((acc, item) => {
    if (item.groupedItems?.length > 0) {
      const subTotal = item.groupedItems.reduce(
        (s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)),
        0
      );
      return acc + (subTotal * item.quantity);
    }
    return acc + (item.price * item.quantity);
  }, 0);

  return (
    <CartContext.Provider value={{ 
      cartItems, 
      addToCart, 
      removeFromCart, 
      updateQuantity, 
      updateItem,
      clearCart,
      restoreCombo,
      cartCount, 
      cartTotal,
      isInitialized
    }}>
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
