import React from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const Cart = () => {
    const { cart, loading, updateQuantity, removeFromCart, cartTotal } = useCart();

    if (loading) {
        return (
            <div className="flex justify-center items-center h-96 bg-background-light">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
            </div>
        );
    }

    if (!cart || cart.items.length === 0) {
        return (
            <main className="py-32 px-6 text-center bg-background-light">
                <div className="max-w-md mx-auto space-y-8">
                    <div className="relative inline-block">
                        <span className="material-symbols-outlined text-8xl text-gold/20">shopping_bag</span>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="material-symbols-outlined text-4xl text-gold">production_quantity_limits</span>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h1 className="font-display text-4xl text-primary font-bold">Giỏ hàng trống</h1>
                        <p className="font-body text-lg text-stone italic">Quý khách chưa chọn được sản phẩm ưng ý nào cho mình?</p>
                    </div>
                    <Link to="/shop" className="inline-block bg-primary text-white font-ui font-bold uppercase tracking-widest py-4 px-12 hover:bg-umber transition-all shadow-lg shadow-primary/20">
                        Quay lại cửa hàng
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="w-full max-w-[1280px] mx-auto px-6 lg:px-12 py-20 bg-background-light">
            <h1 className="font-display text-4xl text-primary font-bold mb-12 border-b border-gold/20 pb-6 uppercase tracking-tight">Giỏ Hàng Của Quý Khách</h1>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
                {/* Cart Items */}
                <div className="lg:col-span-8 space-y-8">
                    {cart.items.map(item => (
                        <div key={item.id} className="flex flex-col sm:flex-row gap-6 p-6 bg-white border border-gold/10 group hover:shadow-hover transition-all relative">
                            <div className="w-full sm:w-32 aspect-square bg-background-light overflow-hidden">
                                <img
                                    src={item.product?.images?.[0]?.image_url || 'https://via.placeholder.com/200'}
                                    alt={item.product?.name}
                                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                />
                            </div>
                            <div className="flex-grow flex flex-col justify-between py-2">
                                <div className="space-y-1">
                                    <div className="flex justify-between items-start">
                                        <Link to={`/details/${item.product_id}`} className="font-display text-xl font-bold text-primary hover:text-gold transition-colors">{item.product?.name}</Link>
                                        <button
                                            onClick={() => removeFromCart(item.id)}
                                            className="text-stone hover:text-brick transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-sm">close</span>
                                        </button>
                                    </div>
                                    <p className="font-ui text-[10px] text-gold uppercase tracking-widest font-bold">{item.product?.category?.name}</p>
                                    <p className="font-body text-lg text-brick italic pt-2">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price)}</p>
                                </div>

                                <div className="flex justify-between items-center mt-6">
                                    <div className="flex items-center border border-gold/30 rounded-sm h-10 w-28 bg-background-light">
                                        <button
                                            className="w-8 h-full flex items-center justify-center text-primary"
                                            onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                                        >
                                            <span className="material-symbols-outlined text-xs">remove</span>
                                        </button>
                                        <span className="w-full text-center font-ui font-bold text-sm">{item.quantity}</span>
                                        <button
                                            className="w-8 h-full flex items-center justify-center text-primary"
                                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                        >
                                            <span className="material-symbols-outlined text-xs">add</span>
                                        </button>
                                    </div>
                                    <p className="font-ui font-bold text-primary">
                                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price * item.quantity)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}

                    <div className="pt-6">
                        <Link to="/shop" className="text-primary font-ui font-bold uppercase tracking-widest text-xs flex items-center gap-2 hover:text-gold transition-colors">
                            <span className="material-symbols-outlined text-sm">west</span> Tiếp tục chọn hàng
                        </Link>
                    </div>
                </div>

                {/* Summary */}
                <div className="lg:col-span-4 lg:sticky lg:top-24 h-fit">
                    <div className="bg-white border-2 border-gold p-8 shadow-xl space-y-8">
                        <h2 className="font-display text-2xl font-bold text-primary uppercase border-b border-gold/20 pb-4">Tóm tắt đơn hàng</h2>

                        <div className="space-y-4 font-ui text-sm">
                            <div className="flex justify-between text-stone">
                                <span>Tạm tính ({cart.items.length} món)</span>
                                <span>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cartTotal)}</span>
                            </div>
                            <div className="flex justify-between text-stone">
                                <span>Vận chuyển</span>
                                <span className="italic">Miễn phí</span>
                            </div>
                            <div className="pt-4 border-t border-gold/10 flex justify-between items-end">
                                <span className="font-bold text-primary uppercase tracking-wider">Tổng cộng</span>
                                <span className="text-2xl font-display font-bold text-brick italic">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cartTotal)}</span>
                            </div>
                        </div>

                        <Link to="/checkout" className="w-full bg-primary text-white font-ui font-bold uppercase tracking-widest py-4 hover:bg-umber transition-all flex items-center justify-center gap-3 shadow-lg shadow-primary/20">
                            <span>Tiến hành thanh toán</span>
                            <span className="material-symbols-outlined text-sm">east</span>
                        </Link>

                        <div className="flex items-center justify-center gap-4 pt-4 text-gold opacity-50">
                            <span className="material-symbols-outlined text-4xl">payments</span>
                            <span className="material-symbols-outlined text-4xl">local_shipping</span>
                            <span className="material-symbols-outlined text-4xl">verified_user</span>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
};

export default Cart;
