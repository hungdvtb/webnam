import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { trackInitiateCheckout, trackPurchase } from '../../components/TrackingScripts';

const StorefrontCheckout = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const productId = searchParams.get('product');
    const qty = parseInt(searchParams.get('qty') || '1');
    const bundleOption = searchParams.get('bundle_option') || '';

    const [product, setProduct] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [form, setForm] = useState({
        customer_name: '',
        phone: '',
        email: '',
        address: '',
        district: '',
        ward: '',
        notes: '',
        quantity: qty,
    });

    useEffect(() => {
        if (productId) {
            api.get(`/storefront/products/${productId}`).then(res => {
                setProduct(res.data);
                trackInitiateCheckout([{ id: res.data.id, quantity: qty }], res.data.current_price * qty);
                setLoading(false);
            }).catch(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [productId]);

    const updateField = (key, value) => setForm(f => ({ ...f, [key]: value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.customer_name.trim() || !form.phone.trim() || !form.address.trim()) {
            alert('Vui lòng điền đầy đủ: Họ tên, Số điện thoại, Địa chỉ');
            return;
        }
        setSubmitting(true);
        try {
            const payload = {
                customer_name: form.customer_name,
                phone: form.phone,
                email: form.email,
                address: form.address,
                district: form.district,
                ward: form.ward,
                notes: form.notes,
                source: 'website',
                items: product ? [{
                    product_id: product.id,
                    quantity: form.quantity,
                    options: bundleOption ? { bundle_option_title: bundleOption } : undefined,
                }] : [],
            };
            const res = await api.post('/storefront/order', payload);
            trackPurchase(res.data.order_number, product ? product.current_price * form.quantity : 0, payload.items);
            navigate(`/cam-on?order=${encodeURIComponent(res.data.order_number)}`, {
                replace: true,
                state: {
                    orderNumber: res.data.order_number,
                    createdAt: new Date().toISOString(),
                    message: res.data.message,
                    customerName: form.customer_name,
                    phone: form.phone,
                    email: form.email,
                    shippingAddress: [form.address, form.ward, form.district].filter(Boolean).join(', '),
                    paymentMethod: 'cod',
                    totalAmount: product ? product.current_price * form.quantity : 0,
                    totalItems: form.quantity,
                    bundleOption,
                    continuePath: '/san-pham',
                    continueLabel: 'Tiếp tục mua sắm',
                    secondaryPath: '/old/dashboard',
                    secondaryLabel: 'Xem lịch sử đơn hàng',
                    items: product ? [{
                        id: product.id,
                        name: product.name,
                        sku: product.sku,
                        quantity: form.quantity,
                        price: product.current_price,
                        image: product.images?.[0]?.url || product.main_image || '',
                        meta: bundleOption || product.category?.name || '',
                    }] : [],
                },
            });
        } catch (err) {
            alert(err.response?.data?.message || 'Có lỗi xảy ra, vui lòng thử lại');
        }
        setSubmitting(false);
    };

    const totalPrice = product ? product.current_price * form.quantity : 0;

    return (
        <div className="animate-fade-in">
            {/* Breadcrumb */}
            <div className="bg-stone-50 border-b border-stone-100">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2 text-xs text-stone-500 font-medium">
                    <Link to="/" className="hover:text-primary">Trang chủ</Link>
                    <span>/</span>
                    <span className="text-stone-800 font-bold">Đặt hàng</span>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
                <h1 className="text-xl md:text-2xl font-black text-stone-900 uppercase tracking-tight mb-8 text-center">Thông tin đặt hàng</h1>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-6 md:gap-10">
                    {/* Order Form */}
                    <form onSubmit={handleSubmit} className="md:col-span-3 space-y-5">
                        <div className="bg-white rounded-2xl border border-stone-100 p-5 md:p-6 space-y-4">
                            <h3 className="text-xs font-black text-stone-800 uppercase tracking-widest flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary text-base">person</span>
                                Thông tin người nhận
                            </h3>
                            <div>
                                <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Họ tên *</label>
                                <input type="text" required value={form.customer_name} onChange={e => updateField('customer_name', e.target.value)}
                                       placeholder="Nhập họ tên người nhận"
                                       className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Số điện thoại *</label>
                                    <input type="tel" required value={form.phone} onChange={e => updateField('phone', e.target.value)}
                                           placeholder="0xxx xxx xxx"
                                           className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Email</label>
                                    <input type="email" value={form.email} onChange={e => updateField('email', e.target.value)}
                                           placeholder="email@example.com (tùy chọn)"
                                           className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-2xl border border-stone-100 p-5 md:p-6 space-y-4">
                            <h3 className="text-xs font-black text-stone-800 uppercase tracking-widest flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary text-base">location_on</span>
                                Địa chỉ giao hàng
                            </h3>
                            <div>
                                <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Địa chỉ *</label>
                                <input type="text" required value={form.address} onChange={e => updateField('address', e.target.value)}
                                       placeholder="Số nhà, tên đường..."
                                       className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Quận/Huyện</label>
                                    <input type="text" value={form.district} onChange={e => updateField('district', e.target.value)}
                                           className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Phường/Xã</label>
                                    <input type="text" value={form.ward} onChange={e => updateField('ward', e.target.value)}
                                           className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Ghi chú</label>
                                <textarea rows={3} value={form.notes} onChange={e => updateField('notes', e.target.value)}
                                          placeholder="Ghi chú về đơn hàng, yêu cầu đặc biệt..."
                                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none" />
                            </div>
                        </div>

                        <button type="submit" disabled={submitting}
                                className="w-full py-4 bg-primary text-white rounded-xl text-sm font-black uppercase tracking-widest shadow-xl hover:brightness-90 active:scale-[0.98] transition-all disabled:opacity-50">
                            {submitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    Đang xử lý...
                                </span>
                            ) : (
                                `XÁC NHẬN ĐẶT HÀNG${totalPrice > 0 ? ` — ${totalPrice.toLocaleString()}đ` : ''}`
                            )}
                        </button>
                    </form>

                    {/* Order Summary */}
                    <div className="md:col-span-2">
                        <div className="bg-white rounded-2xl border border-stone-100 p-5 md:p-6 sticky top-20">
                            <h3 className="text-xs font-black text-stone-800 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary text-base">shopping_bag</span>
                                Đơn hàng
                            </h3>

                            {product ? (
                                <div className="space-y-4">
                                    <div className="flex gap-3">
                                        {product.images?.[0] && (
                                            <img src={product.images[0].url} alt="" className="w-20 h-20 rounded-xl object-cover border border-stone-100" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-bold text-stone-800 line-clamp-2">{product.name}</h4>
                                            <p className="text-xs text-stone-500 mt-1">{product.sku}</p>
                                            {bundleOption ? <p className="mt-1 text-xs font-bold text-primary">Tùy chọn bộ: {bundleOption}</p> : null}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-stone-500">Số lượng</span>
                                        <div className="flex items-center border border-stone-200 rounded-lg overflow-hidden">
                                            <button onClick={() => updateField('quantity', Math.max(1, form.quantity - 1))} className="w-8 h-8 flex items-center justify-center text-stone-600 hover:bg-stone-50">
                                                <span className="material-symbols-outlined text-xs">remove</span>
                                            </button>
                                            <span className="w-8 h-8 flex items-center justify-center text-xs font-bold border-x border-stone-200">{form.quantity}</span>
                                            <button onClick={() => updateField('quantity', form.quantity + 1)} className="w-8 h-8 flex items-center justify-center text-stone-600 hover:bg-stone-50">
                                                <span className="material-symbols-outlined text-xs">add</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="border-t border-stone-100 pt-4 space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-stone-500">Đơn giá</span>
                                            <span className="font-bold text-stone-800">{Number(product.current_price).toLocaleString()}đ</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-stone-500">Vận chuyển</span>
                                            <span className="font-bold text-stone-500 italic">Liên hệ</span>
                                        </div>
                                        <div className="flex justify-between text-lg font-black pt-2 border-t border-stone-100">
                                            <span className="text-stone-800">Tổng cộng</span>
                                            <span className="text-red-600">{totalPrice.toLocaleString()}đ</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 opacity-40">
                                    <span className="material-symbols-outlined text-4xl text-stone-300 mb-2 block">shopping_cart</span>
                                    <p className="text-xs text-stone-500 font-medium">Chưa có sản phẩm</p>
                                    <Link to="/san-pham" className="text-xs text-primary font-bold mt-2 inline-block hover:underline">Chọn sản phẩm →</Link>
                                </div>
                            )}

                            {/* Trust badges */}
                            <div className="mt-6 pt-4 border-t border-stone-100 space-y-2">
                                {[
                                    { icon: 'shield', text: 'Thanh toán an toàn' },
                                    { icon: 'local_shipping', text: 'Giao hàng toàn quốc' },
                                    { icon: 'autorenew', text: 'Đổi trả miễn phí 7 ngày' },
                                ].map((b, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs text-stone-500">
                                        <span className="material-symbols-outlined text-green-600 text-sm">{b.icon}</span>
                                        <span className="font-medium">{b.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StorefrontCheckout;
