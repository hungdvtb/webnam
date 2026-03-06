import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { orderApi } from '../services/api';

const Checkout = () => {
    const { cart, cartTotal, refreshCart } = useCart();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({
        customer_name: user?.name || '',
        customer_email: user?.email || '',
        customer_phone: '',
        shipping_address: '',
        notes: '',
        payment_method: 'cod'
    });

    if (!cart || cart.items.length === 0) {
        navigate('/cart');
        return null;
    }

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const response = await orderApi.create(formData);
            await refreshCart();
            // Redirect to success page or order details
            navigate(`/details`); // Temporary, should be order success page
            alert('Đặt hàng thành công! Mã đơn hàng: ' + response.data.order_number);
        } catch (err) {
            setError(err.response?.data?.message || 'Có lỗi xảy ra khi đặt hàng. Vui lòng thử lại.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="w-full max-w-[1280px] mx-auto px-6 lg:px-12 py-20 bg-background-light">
            <h1 className="font-display text-4xl text-primary font-bold mb-12 border-b border-gold/20 pb-6 uppercase tracking-tight">Thủ Tục Thanh Toán</h1>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-16">
                {/* Shipping Info */}
                <div className="lg:col-span-7 space-y-12">
                    <section className="space-y-8">
                        <h2 className="font-display text-2xl font-bold text-primary flex items-center gap-3">
                            <span className="size-8 rounded-full bg-gold/20 flex items-center justify-center text-gold text-sm font-bold">1</span>
                            Thông Tin Giao Hàng
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Họ và Tên</label>
                                <input
                                    type="text"
                                    name="customer_name"
                                    value={formData.customer_name}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary transition-all font-body"
                                    placeholder="Nguyễn Văn A"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Số Điện Thoại</label>
                                <input
                                    type="tel"
                                    name="customer_phone"
                                    value={formData.customer_phone}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary transition-all font-body"
                                    placeholder="09xx xxx xxx"
                                />
                            </div>
                            <div className="md:col-span-2 space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Email</label>
                                <input
                                    type="email"
                                    name="customer_email"
                                    value={formData.customer_email}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary transition-all font-body"
                                    placeholder="email@example.com"
                                />
                            </div>
                            <div className="md:col-span-2 space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Địa Chỉ Nhận Hàng</label>
                                <textarea
                                    name="shipping_address"
                                    value={formData.shipping_address}
                                    onChange={handleChange}
                                    required
                                    rows="3"
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary transition-all font-body resize-none"
                                    placeholder="Số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành phố..."
                                ></textarea>
                            </div>
                            <div className="md:col-span-2 space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Ghi Chú (Tùy chọn)</label>
                                <input
                                    type="text"
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary transition-all font-body"
                                    placeholder="Lời nhắn cho nghệ nhân hoặc shipper..."
                                />
                            </div>
                        </div>
                    </section>

                    <section className="space-y-8 pt-8 border-t border-gold/10">
                        <h2 className="font-display text-2xl font-bold text-primary flex items-center gap-3">
                            <span className="size-8 rounded-full bg-gold/20 flex items-center justify-center text-gold text-sm font-bold">2</span>
                            Phương Thức Thanh Toán
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className={`relative flex items-center gap-4 p-6 border-2 cursor-pointer transition-all ${formData.payment_method === 'cod' ? 'border-primary bg-primary/5' : 'border-gold/20 hover:border-gold'}`}>
                                <input
                                    type="radio"
                                    name="payment_method"
                                    value="cod"
                                    checked={formData.payment_method === 'cod'}
                                    onChange={handleChange}
                                    className="size-5 text-primary focus:ring-primary"
                                />
                                <div>
                                    <h4 className="font-ui font-bold text-primary">Thanh toán khi nhận hàng (COD)</h4>
                                    <p className="text-xs text-stone italic">Phí vận chuyển: Miễn phí</p>
                                </div>
                            </label>
                            <label className={`relative flex items-center gap-4 p-6 border-2 cursor-pointer transition-all ${formData.payment_method === 'bank_transfer' ? 'border-primary bg-primary/5' : 'border-gold/20 hover:border-gold opactiy-50'}`}>
                                <input
                                    type="radio"
                                    name="payment_method"
                                    value="bank_transfer"
                                    checked={formData.payment_method === 'bank_transfer'}
                                    onChange={handleChange}
                                    className="size-5 text-primary focus:ring-primary"
                                />
                                <div>
                                    <h4 className="font-ui font-bold text-primary">Chuyển khoản ngân hàng</h4>
                                    <p className="text-xs text-stone italic">Nhanh chóng & An toàn</p>
                                </div>
                            </label>
                        </div>
                    </section>
                </div>

                {/* Order Summary */}
                <div className="lg:col-span-5 lg:sticky lg:top-24 h-fit">
                    <div className="bg-white border-frame p-8 shadow-xl space-y-8">
                        <h2 className="font-display text-2xl font-bold text-primary uppercase border-b border-gold/20 pb-4">Đơn Hàng Của Bạn</h2>

                        <div className="max-h-[300px] overflow-y-auto pr-4 space-y-4 scrollbar-thin">
                            {cart.items.map(item => (
                                <div key={item.id} className="flex gap-4">
                                    <div className="size-16 bg-background-light flex-shrink-0">
                                        <img src={item.product?.images?.[0]?.image_url} alt="" className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex-grow">
                                        <h4 className="font-ui font-bold text-sm text-primary line-clamp-1">{item.product?.name}</h4>
                                        <div className="flex justify-between text-xs text-stone mt-1">
                                            <span>SL: {item.quantity}</span>
                                            <span className="font-bold">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price * item.quantity)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3 pt-6 border-t border-gold/10 font-ui text-sm">
                            <div className="flex justify-between text-stone">
                                <span>Tạm tính</span>
                                <span>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cartTotal)}</span>
                            </div>
                            <div className="flex justify-between text-stone">
                                <span>Phí vận chuyển</span>
                                <span className="italic">Miễn phí</span>
                            </div>
                            <div className="pt-4 border-t border-gold flex justify-between items-end">
                                <span className="font-bold text-primary uppercase tracking-wider">Tổng cộng</span>
                                <span className="text-3xl font-display font-bold text-brick italic">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cartTotal)}</span>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-brick/10 text-brick text-xs p-3 font-ui border-l-4 border-brick italic">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary text-white font-ui font-bold uppercase tracking-widest py-5 hover:bg-umber transition-all flex items-center justify-center gap-3 shadow-2xl shadow-primary/30"
                        >
                            {loading ? (
                                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            ) : (
                                <>
                                    <span>Xác Nhận Đặt Hàng</span>
                                    <span className="material-symbols-outlined text-base">check_circle</span>
                                </>
                            )}
                        </button>

                        <p className="text-[10px] text-stone text-center italic">Bằng cách đặt hàng, quý khách đồng ý với Điều khoản dịch vụ & Chính sách bảo mật của Di Sản Gốm Việt.</p>
                    </div>
                </div>
            </form>
        </main>
    );
};

export default Checkout;
