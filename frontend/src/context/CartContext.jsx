import React, { createContext, useState, useEffect, useContext } from 'react';
import { cartApi } from '../services/api';
import { useAuth } from './AuthContext';

const CartContext = createContext();

export const CartProvider = ({ children }) => {
    const [cart, setCart] = useState(null);
    const [loading, setLoading] = useState(false);
    const { user } = useAuth();

    const fetchCart = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const response = await cartApi.get();
            setCart(response.data);
        } catch (error) {
            console.error("Error fetching cart", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCart();
    }, [user]);

    const addToCart = async (productId, quantity = 1, productGroupId = null) => {
        try {
            await cartApi.add({
                product_id: productId,
                product_group_id: productGroupId,
                quantity: quantity
            });
            await fetchCart();
            return true;
        } catch (error) {
            console.error("Error adding to cart", error);
            return false;
        }
    };

    const updateQuantity = async (cartItemId, quantity) => {
        try {
            await cartApi.update({
                cart_item_id: cartItemId,
                quantity: quantity
            });
            await fetchCart();
        } catch (error) {
            console.error("Error updating cart", error);
        }
    };

    const removeFromCart = async (cartItemId) => {
        try {
            await cartApi.remove(cartItemId);
            await fetchCart();
        } catch (error) {
            console.error("Error removing from cart", error);
        }
    };

    const cartCount = cart?.items?.reduce((total, item) => total + item.quantity, 0) || 0;
    const cartTotal = cart?.items?.reduce((total, item) => total + (item.price * item.quantity), 0) || 0;

    return (
        <CartContext.Provider value={{
            cart,
            loading,
            addToCart,
            updateQuantity,
            removeFromCart,
            cartCount,
            cartTotal,
            refreshCart: fetchCart
        }}>
            {children}
        </CartContext.Provider>
    );
};

export const useCart = () => useContext(CartContext);
