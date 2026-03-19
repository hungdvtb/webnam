import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { orderApi, couponApi } from '../services/api';
import { VN_REGIONS } from '../data/regions';
import SearchableSelect from '../components/SearchableSelect';
import {
    buildRegionPath,
    buildShippingAddress,
    sortRegionObjects,
    sortRegionStrings,
    validateVietnamesePhone
} from '../utils/administrativeUnits';

const Checkout = () => {
    const { cart, cartTotal, refreshCart } = useCart();
    const { user } = useAuth();
    const { showModal } = useUI();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [couponCode, setCouponCode] = useState('');
    const [couponData, setCouponData] = useState(null);
    const [discountAmount, setDiscountAmount] = useState(0);
    const [error, setError] = useState('');

    const [regionType, setRegionType] = useState('new');
    const [provinces, setProvinces] = useState([]);
    const [districts, setDistricts] = useState([]);
    const [wards, setWards] = useState([]);

    const [formData, setFormData] = useState({
        customer_name: user?.name || '',
        customer_email: user?.email || '',
        customer_phone: '',
        province: '',
        district: '',
        ward: '',
        address_detail: '',
        shipping_address: '',
        notes: '',
        payment_method: 'cod'
    });

    useEffect(() => {
        const provinceList = sortRegionObjects(VN_REGIONS[regionType] || []);
        setProvinces(provinceList);
        setFormData(prev => ({
            ...prev,
            province: '',
            district: '',
            ward: '',
            shipping_address: buildShippingAddress({
                addressDetail: prev.address_detail,
                regionType
            })
        }));
        setDistricts([]);
        setWards([]);
    }, [regionType]);

    useEffect(() => {
        if (formData.province) {
            const provinceData = provinces.find(p => p.name === formData.province);
            if (regionType === 'old') {
                setDistricts(sortRegionObjects(provinceData?.districts || []));
                setWards([]);
                setFormData(prev => ({ ...prev, district: '', ward: '' }));
            } else {
                setWards(sortRegionStrings(provinceData?.wards || []));
                setDistricts([]);
                setFormData(prev => ({ ...prev, district: '', ward: '' }));
            }
        }
    }, [formData.province, provinces, regionType]);

    useEffect(() => {
        if (regionType === 'old' && formData.district) {
            const districtData = districts.find(d => d.name === formData.district);
            setWards(sortRegionStrings(districtData?.wards || []));
            setFormData(prev => ({ ...prev, ward: '' }));
        }
    }, [formData.district, districts, regionType]);

    useEffect(() => {
        setFormData(prev => {
            const shippingAddress = buildShippingAddress({
                addressDetail: prev.address_detail,
                ward: prev.ward,
                district: prev.district,
                province: prev.province,
                regionType
            });

            if (prev.shipping_address === shippingAddress) {
                return prev;
            }

            return { ...prev, shipping_address: shippingAddress };
        });
    }, [formData.address_detail, formData.province, formData.district, formData.ward, regionType]);

    if (!cart || cart.items.length === 0) {
        navigate('/cart');
        return null;
    }

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const validatePhone = validateVietnamesePhone;

    const handleApplyCoupon = async () => {
        if (!couponCode) return;
        try {
            const res = await couponApi.validate(couponCode, cartTotal);
            setCouponData(res.data.coupon);
            setDiscountAmount(res.data.discount_amount);
            setError('');
        } catch (err) {
            setError(err.response?.data?.message || 'Mã giảm giá không hợp lệ.');
            setCouponData(null);
            setDiscountAmount(0);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateVietnamesePhone(formData.customer_phone)) {
            setError('Số điện thoại không hợp lệ (Cần 10 số, bắt đầu bằng 03, 05, 07, 08, 09)');
            return;
        }

        setLoading(true);
        setError('');
        try {
            const data = {
                ...formData,
                coupon_id: couponData?.id,
                discount_amount: discountAmount,
                custom_attributes: {
                    region_type: regionType === 'new' ? 'Địa giới mới' : 'Địa giới cũ',
                    full_region_path: buildRegionPath({
                        ward: formData.ward,
                        district: formData.district,
                        province: formData.province,
                        regionType
                    })
                }
            };
            const response = await orderApi.store(data);
            await refreshCart();
            showModal({
                title: 'Đặt hàng thành công',
                content: `Cảm ơn bạn đã tin tưởng Gốm Đại Thành.\nMã đơn hàng của bạn là: <b>${response.data.order_number}</b>`,
                type: 'success',
                onAction: () => navigate('/')
            });
        } catch (err) {
            setError(err.response?.data?.message || 'Có lỗi xảy ra khi đặt hàng.');
        } finally {
            setLoading(false);
        }
    };

    const finalTotal = Math.max(0, cartTotal - discountAmount);

    return (
        <main className="w-full max-w-[1280px] mx-auto px-6 lg:px-12 py-20 bg-background-light">
            <h1 className="font-display text-4xl text-primary font-bold mb-12 border-b border-gold/20 pb-6 uppercase tracking-tight">Thủ Tục Thanh Toán</h1>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-16">
                {/* Shipping Info */}
                <div className="lg:col-span-7 space-y-12">
                    <section className="space-y-8">
                        <div className="flex justify-between items-center">
                            <h2 className="font-display text-2xl font-bold text-primary flex items-center gap-3">
                                <span className="size-8 rounded-full bg-gold/20 flex items-center justify-center text-gold text-sm font-bold">1</span>
                                Thông Tin Giao Hàng
                            </h2>
                            <div className="flex bg-stone/5 p-1 rounded-sm border border-gold/10">
                                <button
                                    type="button"
                                    onClick={() => setRegionType('new')}
                                    className={`px-4 py-1.5 text-[10px] uppercase font-bold tracking-widest transition-all ${regionType === 'new' ? 'bg-primary text-white shadow-lg' : 'text-stone hover:text-primary'}`}
                                >
                                    Hiện tại
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRegionType('old')}
                                    className={`px-4 py-1.5 text-[10px] uppercase font-bold tracking-widest transition-all ${regionType === 'old' ? 'bg-primary text-white shadow-lg' : 'text-stone hover:text-primary'}`}
                                >
                                    Địa danh cũ
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Họ và Tên</label>
                                <input
                                    type="text"
                                    name="customer_name"
                                    value={formData.customer_name}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
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
                                    className={`w-full bg-white border p-4 focus:outline-none font-body ${formData.customer_phone && !validateVietnamesePhone(formData.customer_phone) ? 'border-brick' : 'border-gold/20 focus:border-primary'}`}
                                    placeholder="09xx xxx xxx"
                                />
                                {formData.customer_phone && !validatePhone(formData.customer_phone) && <p className="text-[10px] text-brick italic">Số điện thoại không hợp lệ</p>}
                            </div>

                            <SearchableSelect
                                label="Tỉnh / Thành Phố"
                                name="province"
                                value={formData.province}
                                options={provinces}
                                onChange={handleChange}
                                placeholder="Chọn tỉnh/thành"
                                required
                            />

                            {regionType === 'old' && (
                                <SearchableSelect
                                    label="Quận / Huyện"
                                    name="district"
                                    value={formData.district}
                                    options={districts}
                                    onChange={handleChange}
                                    placeholder="Chọn quận/huyện"
                                    disabled={!formData.province}
                                    required
                                />
                            )}

                            <SearchableSelect
                                label="Xã / Phường"
                                name="ward"
                                value={formData.ward}
                                options={wards}
                                onChange={handleChange}
                                placeholder="Chọn xã/phường"
                                disabled={regionType === 'old' ? !formData.district : !formData.province}
                                required
                            />

                            <div className="md:col-span-2 space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Địa Chỉ Chi Tiết</label>
                                <input
                                    type="text"
                                    name="address_detail"
                                    value={formData.address_detail}
                                    onChange={handleChange}
                                    required
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary font-body"
                                    placeholder="Số nhà, tên đường..."
                                />
                            </div>

                            <div className="md:col-span-2 space-y-2">
                                <label className="font-ui text-xs font-bold uppercase tracking-widest text-primary">Ghi Chú Đơn Hàng</label>
                                <textarea
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    rows="2"
                                    className="w-full bg-white border border-gold/20 p-4 focus:outline-none focus:border-primary font-body resize-none"
                                    placeholder="Lời nhắn cho nhà bán hàng..."
                                ></textarea>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-8 pt-8 border-t border-gold/10">
                        <h2 className="font-display text-2xl font-bold text-primary flex items-center gap-3">
                            <span className="size-8 rounded-full bg-gold/20 flex items-center justify-center text-gold text-sm font-bold">2</span>
                            Phương Thức Thanh Toán
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className={`relative flex items-center gap-4 p-6 border-2 cursor-pointer transition-all ${formData.payment_method === 'cod' ? 'border-primary bg-primary/5' : 'border-gold/20'}`}>
                                <input
                                    type="radio"
                                    name="payment_method"
                                    value="cod"
                                    checked={formData.payment_method === 'cod'}
                                    onChange={handleChange}
                                    className="size-5 text-primary"
                                />
                                <div>
                                    <h4 className="font-ui font-bold text-primary">Thanh toán (COD)</h4>
                                    <p className="text-xs text-stone italic">Giao hàng và thu tiền</p>
                                </div>
                            </label>
                            <label className={`relative flex items-center gap-4 p-6 border-2 cursor-pointer transition-all ${formData.payment_method === 'bank_transfer' ? 'border-primary bg-primary/5' : 'border-gold/20'}`}>
                                <input
                                    type="radio"
                                    name="payment_method"
                                    value="bank_transfer"
                                    checked={formData.payment_method === 'bank_transfer'}
                                    onChange={handleChange}
                                    className="size-5 text-primary"
                                />
                                <h4 className="font-ui font-bold text-primary">Chuyển khoản</h4>
                            </label>
                        </div>
                    </section>
                </div>

                {/* Order Summary */}
                <div className="lg:col-span-5 h-fit lg:sticky lg:top-24">
                    <div className="bg-white border-frame p-8 shadow-xl space-y-8">
                        <h2 className="font-display text-2xl font-bold text-primary uppercase border-b border-gold/20 pb-4">Đơn Hàng</h2>

                        <div className="max-h-[300px] overflow-y-auto space-y-4 pr-2">
                            {cart.items.map(item => (
                                <div key={item.id} className="flex gap-4">
                                    <div className="size-16 bg-background-light flex-shrink-0">
                                        <img src={item.product?.images?.[0]?.image_url} alt="" className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex-grow">
                                        <h4 className="font-ui font-bold text-sm text-primary line-clamp-1">{item.product?.name}</h4>
                                        <div className="flex justify-between text-xs text-stone mt-1">
                                            <span>SL: {item.quantity}</span>
                                            <span>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(item.price * item.quantity)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Coupon Section */}
                        <div className="pt-6 border-t border-gold/10">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    className="flex-grow bg-background-light border border-gold/20 p-3 text-sm focus:outline-none focus:border-gold"
                                    placeholder="Mã giảm giá..."
                                    value={couponCode}
                                    onChange={e => setCouponCode(e.target.value.toUpperCase())}
                                />
                                <button
                                    type="button"
                                    onClick={handleApplyCoupon}
                                    className="bg-gold text-white px-6 text-xs font-bold uppercase tracking-widest hover:bg-brick transition-all"
                                >
                                    Áp Dụng
                                </button>
                            </div>
                            {couponData && <p className="text-xs text-green-600 mt-2 italic font-ui">Đã áp dụng mã: {couponData.code}</p>}
                        </div>

                        <div className="space-y-3 pt-6 border-t border-gold/10 font-ui text-sm">
                            <div className="flex justify-between text-stone">
                                <span>Tạm tính</span>
                                <span>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(cartTotal)}</span>
                            </div>
                            {discountAmount > 0 && (
                                <div className="flex justify-between text-brick font-bold">
                                    <span>Giảm giá</span>
                                    <span>-{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(discountAmount)}</span>
                                </div>
                            )}
                            <div className="pt-4 border-t border-gold flex justify-between items-end">
                                <span className="font-bold text-primary uppercase tracking-wider">Tổng cộng</span>
                                <span className="text-3xl font-display font-bold text-brick italic">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(finalTotal)}</span>
                            </div>
                        </div>

                        {error && <div className="bg-brick/10 text-brick text-xs p-3 border-l-4 border-brick italic">{error}</div>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary text-white font-ui font-bold uppercase tracking-widest py-5 hover:bg-umber transition-all flex items-center justify-center gap-3 shadow-2xl shadow-primary/30"
                        >
                            {loading ? <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : 'Xác Nhận Đặt Hàng'}
                        </button>
                    </div>
                </div>
            </form>
        </main>
    );
};

export default Checkout;
