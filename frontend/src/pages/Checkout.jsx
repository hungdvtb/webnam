import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import api, { couponApi } from '../services/api';
import { VN_REGIONS } from '../data/regions';
import SearchableSelect from '../components/SearchableSelect';
import { rememberLeadAttribution } from '../utils/leadAttribution';
import {
    buildRegionPath,
    buildShippingAddress,
    sortRegionObjects,
    sortRegionStrings,
    validateVietnamesePhone
} from '../utils/administrativeUnits';

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
}).format(Number(value || 0));

const getItemMeta = (item) => {
    const chips = [];
    const options = item?.options;

    if (item?.product?.category?.name) {
        chips.push(item.product.category.name);
    }

    if (options && typeof options === 'object') {
        [
            options.bundle_option_title,
            options.variant_label,
            options.variant_name,
            options.option_label,
            options.color,
            options.size
        ].filter(Boolean).forEach((entry) => chips.push(entry));

        if (Array.isArray(options.attributes)) {
            options.attributes.forEach((attribute) => {
                if (!attribute) return;

                if (typeof attribute === 'string') {
                    chips.push(attribute);
                    return;
                }

                const label = [attribute.name, attribute.value].filter(Boolean).join(': ');
                if (label) chips.push(label);
            });
        }
    }

    return Array.from(new Set(chips.filter(Boolean))).slice(0, 3);
};

const PAYMENT_OPTIONS = [
    {
        value: 'cod',
        title: 'Thanh toán khi nhận hàng',
        description: 'Kiểm tra đơn và thanh toán trực tiếp khi giao.',
        icon: 'payments'
    },
    {
        value: 'bank_transfer',
        title: 'Chuyển khoản ngân hàng',
        description: 'Nhận thông tin tài khoản sau khi xác nhận đơn.',
        icon: 'account_balance'
    }
];

const Checkout = () => {
    const { cart, cartTotal, refreshCart, loading: cartLoading } = useCart();
    const { user } = useAuth();
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
    const [isMobileLayout, setIsMobileLayout] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 1023px)').matches;
    });

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
        if (typeof window === 'undefined') return undefined;

        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const handleChange = () => setIsMobileLayout(mediaQuery.matches);

        handleChange();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        }

        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
    }, []);

    useEffect(() => {
        const provinceList = sortRegionObjects(VN_REGIONS[regionType] || []);
        setProvinces(provinceList);
        setFormData((prev) => ({
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
            const provinceData = provinces.find((province) => province.name === formData.province);

            if (regionType === 'old') {
                setDistricts(sortRegionObjects(provinceData?.districts || []));
                setWards([]);
                setFormData((prev) => ({ ...prev, district: '', ward: '' }));
            } else {
                setWards(sortRegionStrings(provinceData?.wards || []));
                setDistricts([]);
                setFormData((prev) => ({ ...prev, district: '', ward: '' }));
            }
        }
    }, [formData.province, provinces, regionType]);

    useEffect(() => {
        if (regionType === 'old' && formData.district) {
            const districtData = districts.find((district) => district.name === formData.district);
            setWards(sortRegionStrings(districtData?.wards || []));
            setFormData((prev) => ({ ...prev, ward: '' }));
        }
    }, [formData.district, districts, regionType]);

    useEffect(() => {
        setFormData((prev) => {
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

    if (cartLoading) {
        return (
            <div className="flex h-96 items-center justify-center bg-background-light">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-gold"></div>
            </div>
        );
    }

    if (!cart || cart.items.length === 0) {
        navigate('/old/cart', { replace: true });
        return null;
    }

    const finalTotal = Math.max(0, cartTotal - discountAmount);
    const orderItemCount = cart.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const invalidPhone = formData.customer_phone && !validateVietnamesePhone(formData.customer_phone);
    const selectedPayment = PAYMENT_OPTIONS.find((option) => option.value === formData.payment_method) || PAYMENT_OPTIONS[0];
    const mobileSelectVariant = isMobileLayout ? 'legacy-mobile' : 'storefront';

    const handleChange = (event) => {
        setFormData({ ...formData, [event.target.name]: event.target.value });
    };

    const handleApplyCoupon = async () => {
        if (!couponCode) return;

        try {
            const response = await couponApi.validate(couponCode, cartTotal);
            setCouponData(response.data.coupon);
            setDiscountAmount(response.data.discount_amount);
            setError('');
        } catch (err) {
            setError(err.response?.data?.message || 'Mã giảm giá không hợp lệ.');
            setCouponData(null);
            setDiscountAmount(0);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!validateVietnamesePhone(formData.customer_phone)) {
            setError('Số điện thoại không hợp lệ (cần 10 số và bắt đầu bằng 03, 05, 07, 08 hoặc 09).');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const attribution = rememberLeadAttribution();
            const payload = {
                ...formData,
                phone: formData.customer_phone,
                email: formData.customer_email,
                address: formData.shipping_address,
                coupon_id: couponData?.id,
                discount_amount: discountAmount,
                discount: discountAmount,
                total: finalTotal,
                source: attribution.source || attribution.source_display || 'Direct',
                landing_url: attribution.landing_url || attribution.first_url || window.location.href,
                current_url: window.location.href,
                referrer: attribution.referrer || document.referrer || '',
                utm_source: attribution.utm_source || '',
                utm_medium: attribution.utm_medium || '',
                utm_campaign: attribution.utm_campaign || '',
                utm_content: attribution.utm_content || '',
                utm_term: attribution.utm_term || '',
                raw_query: attribution.raw_query || '',
                items: cart.items.map((item) => ({
                    product_id: item.product_id,
                    quantity: item.quantity,
                    options: item.options || null,
                    product_name: item.product?.name || '',
                    product_sku: item.product?.sku || '',
                    product_slug: item.product?.slug || '',
                    product_url: `${window.location.origin}/san-pham/${item.product?.slug || item.product_id}`,
                    unit_price: item.price
                })),
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

            const orderItems = cart.items.map((item) => ({
                id: item.id,
                name: item.product?.name,
                sku: item.product?.sku,
                quantity: item.quantity,
                price: item.price,
                image: item.product?.images?.[0]?.image_url || '',
                meta: item.product?.category?.name || ''
            }));

            const response = await api.post('/storefront/order', payload);
            await refreshCart();
            navigate(`/old/cam-on?order=${encodeURIComponent(response.data.order_number)}`, {
                replace: true,
                state: {
                    orderNumber: response.data.order_number,
                    createdAt: new Date().toISOString(),
                    customerName: formData.customer_name,
                    phone: formData.customer_phone,
                    email: formData.customer_email,
                    shippingAddress: formData.shipping_address,
                    paymentMethod: formData.payment_method,
                    totalAmount: finalTotal,
                    totalItems: orderItemCount,
                    items: orderItems,
                    continuePath: '/old/shop',
                    continueLabel: 'Tiếp tục mua sắm',
                    secondaryPath: '/old/dashboard',
                    secondaryLabel: 'Xem lịch sử đơn hàng',
                    message: `Cảm ơn bạn đã tin tưởng Gốm Đại Thành. Đơn hàng ${response.data.order_number} đã được tiếp nhận thành công.`
                }
            });
        } catch (err) {
            setError(err.response?.data?.message || 'Có lỗi xảy ra khi đặt hàng.');
        } finally {
            setLoading(false);
        }
    };

    const baseFieldClassName = 'w-full rounded-2xl border bg-stone-50 px-4 py-3 text-sm font-medium text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10 lg:rounded-none lg:border lg:border-gold/20 lg:bg-white lg:p-4 lg:font-body lg:ring-0';
    const fieldClassName = `${baseFieldClassName} min-h-[52px]`;
    const noteClassName = `${baseFieldClassName} min-h-[108px] resize-none`;
    const mobileCardClassName = 'rounded-[28px] border border-stone-200 bg-white p-4 shadow-[0_12px_34px_rgba(27,54,93,0.06)] lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none';
    const mobileSectionTitleClassName = 'font-display text-[22px] font-bold leading-tight text-primary lg:text-2xl';

    return (
        <>
            <main className="mx-auto w-full max-w-[1280px] bg-background-light px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+8.5rem)] sm:px-5 sm:py-6 lg:px-12 lg:py-20 lg:pb-20">
                <div className="mb-5 border-b border-gold/15 pb-4 lg:mb-12 lg:pb-6">
                    <div className="flex items-end justify-between gap-4">
                        <div className="space-y-1.5">
                            <p className="font-ui text-[10px] font-black uppercase tracking-[0.18em] text-gold lg:hidden">Checkout mobile</p>
                            <h1 className="font-display text-[28px] font-bold leading-none text-primary lg:text-4xl">Thủ tục thanh toán</h1>
                            <p className="font-body text-sm text-stone lg:text-base">
                                Điền nhanh thông tin quan trọng, kiểm tra đơn và đặt hàng thuận tay hơn trên mobile.
                            </p>
                        </div>

                        <div className="hidden rounded-2xl border border-gold/15 bg-white px-4 py-3 text-right shadow-sm lg:block">
                            <p className="font-ui text-[10px] font-bold uppercase tracking-[0.18em] text-stone">Tổng thanh toán</p>
                            <p className="mt-1 font-display text-2xl font-bold italic text-brick">{formatCurrency(finalTotal)}</p>
                        </div>
                    </div>
                </div>

                <form id="checkout-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:gap-16">
                    <div className="space-y-4 lg:col-span-7 lg:space-y-12">
                        <section className={mobileCardClassName}>
                            <div className="flex items-start justify-between gap-4 lg:items-center">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/8 text-sm font-black text-primary">1</span>
                                        <h2 className={mobileSectionTitleClassName}>Thông tin giao hàng</h2>
                                    </div>
                                    <p className="mt-2 text-sm text-stone-500 lg:mt-3">Người nhận, địa chỉ và ghi chú cần thiết để xử lý đơn nhanh.</p>
                                </div>

                                <div className="hidden rounded-full bg-primary/[0.04] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-primary lg:block">
                                    Bắt buộc điền đủ
                                </div>
                            </div>

                            <div className="mt-5 space-y-5 lg:mt-8 lg:space-y-8">
                                <div className="space-y-3 lg:space-y-4">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Người nhận</p>
                                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-6">
                                            <div className="space-y-2">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-stone-700 lg:font-ui lg:text-xs lg:font-bold lg:tracking-widest lg:text-primary">
                                                    Họ và tên <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    name="customer_name"
                                                    value={formData.customer_name}
                                                    onChange={handleChange}
                                                    required
                                                    className={fieldClassName}
                                                    placeholder="Nguyễn Văn A"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-stone-700 lg:font-ui lg:text-xs lg:font-bold lg:tracking-widest lg:text-primary">
                                                    Số điện thoại <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="tel"
                                                    name="customer_phone"
                                                    value={formData.customer_phone}
                                                    onChange={handleChange}
                                                    required
                                                    className={`${fieldClassName} ${invalidPhone ? 'border-brick bg-brick/5 focus:border-brick focus:ring-brick/10' : ''}`}
                                                    placeholder="09xx xxx xxx"
                                                />
                                                {invalidPhone ? (
                                                    <p className="text-[11px] font-medium text-brick">Số điện thoại cần đủ 10 số và đúng đầu số di động Việt Nam.</p>
                                                ) : null}
                                            </div>

                                            <div className="space-y-2 lg:hidden md:col-span-2">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-stone-700">
                                                    Email
                                                </label>
                                                <input
                                                    type="email"
                                                    name="customer_email"
                                                    value={formData.customer_email}
                                                    onChange={handleChange}
                                                    className={fieldClassName}
                                                    placeholder="email@example.com"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Địa chỉ giao hàng</p>
                                            <div className="flex rounded-2xl bg-stone-100 p-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setRegionType('new')}
                                                    className={`min-h-[34px] rounded-xl px-3 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${regionType === 'new' ? 'bg-primary text-white shadow-md' : 'text-stone-500'}`}
                                                >
                                                    Hiện tại
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setRegionType('old')}
                                                    className={`min-h-[34px] rounded-xl px-3 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${regionType === 'old' ? 'bg-primary text-white shadow-md' : 'text-stone-500'}`}
                                                >
                                                    Địa danh cũ
                                                </button>
                                            </div>
                                        </div>

                                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-6">
                                            <SearchableSelect
                                                label="Tỉnh / thành phố"
                                                name="province"
                                                value={formData.province}
                                                options={provinces}
                                                onChange={handleChange}
                                                placeholder="Chọn tỉnh/thành"
                                                required
                                                variant={mobileSelectVariant}
                                            />

                                            {regionType === 'old' ? (
                                                <SearchableSelect
                                                    label="Quận / huyện"
                                                    name="district"
                                                    value={formData.district}
                                                    options={districts}
                                                    onChange={handleChange}
                                                    placeholder="Chọn quận/huyện"
                                                    disabled={!formData.province}
                                                    required
                                                    variant={mobileSelectVariant}
                                                />
                                            ) : null}

                                            <SearchableSelect
                                                label="Xã / phường"
                                                name="ward"
                                                value={formData.ward}
                                                options={wards}
                                                onChange={handleChange}
                                                placeholder="Chọn xã/phường"
                                                disabled={regionType === 'old' ? !formData.district : !formData.province}
                                                required
                                                variant={mobileSelectVariant}
                                            />

                                            <div className="space-y-2 md:col-span-2">
                                                <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-stone-700 lg:font-ui lg:text-xs lg:font-bold lg:tracking-widest lg:text-primary">
                                                    Địa chỉ chi tiết <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    name="address_detail"
                                                    value={formData.address_detail}
                                                    onChange={handleChange}
                                                    required
                                                    className={fieldClassName}
                                                    placeholder="Số nhà, tên đường..."
                                                />
                                            </div>
                                        </div>

                                        <div className="mt-3 rounded-[22px] border border-primary/10 bg-primary/[0.04] px-4 py-3">
                                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Địa chỉ sẽ giao tới</p>
                                            <p className="mt-1 text-sm font-semibold leading-relaxed text-primary">
                                                {formData.shipping_address || 'Chọn đủ khu vực và nhập địa chỉ chi tiết để hệ thống tự ghép địa chỉ.'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-[11px] font-black uppercase tracking-[0.18em] text-stone-700 lg:font-ui lg:text-xs lg:font-bold lg:tracking-widest lg:text-primary">
                                            Ghi chú đơn hàng
                                        </label>
                                        <textarea
                                            name="notes"
                                            value={formData.notes}
                                            onChange={handleChange}
                                            rows="3"
                                            className={noteClassName}
                                            placeholder="Ví dụ: giao giờ hành chính, gọi trước khi giao..."
                                        ></textarea>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className={`${mobileCardClassName} lg:hidden`}>
                            <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/8 text-sm font-black text-primary">2</span>
                                <div>
                                    <h2 className={mobileSectionTitleClassName}>Phương thức vận chuyển</h2>
                                    <p className="mt-1 text-sm text-stone-500">Giữ nguyên logic giao hàng hiện tại, chỉ làm rõ trạng thái đang áp dụng.</p>
                                </div>
                            </div>

                            <div className="mt-4">
                                <div className="flex items-start gap-3 rounded-[24px] border-2 border-primary bg-primary/[0.04] p-4">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                                        <span className="material-symbols-outlined text-[20px]">local_shipping</span>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-3">
                                            <h3 className="text-sm font-black text-primary">Giao hàng tiêu chuẩn</h3>
                                            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-primary">
                                                Đang chọn
                                            </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-relaxed text-stone-600">
                                            Đơn được xác nhận nhanh, hỗ trợ giao toàn quốc và giữ nguyên chính sách hiện tại của cửa hàng.
                                        </p>
                                    </div>

                                    <span className="material-symbols-outlined text-[22px] text-primary">check_circle</span>
                                </div>
                            </div>
                        </section>

                        <section className={mobileCardClassName}>
                            <div className="flex items-start gap-3">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/8 text-sm font-black text-primary lg:hidden">3</span>
                                <span className="hidden h-9 w-9 items-center justify-center rounded-full bg-gold/20 text-sm font-bold text-gold lg:flex">2</span>
                                <div>
                                    <h2 className={mobileSectionTitleClassName}>Phương thức thanh toán</h2>
                                    <p className="mt-2 text-sm text-stone-500">Lựa chọn đang chọn được tô rõ để thao tác một tay dễ hơn.</p>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:mt-8 lg:gap-4">
                                {PAYMENT_OPTIONS.map((option) => {
                                    const isSelected = formData.payment_method === option.value;

                                    return (
                                        <label
                                            key={option.value}
                                            className={`relative flex cursor-pointer items-start gap-3 rounded-[24px] border-2 p-4 transition-all lg:rounded-none lg:p-6 ${isSelected ? 'border-primary bg-primary/[0.05] shadow-[0_12px_30px_rgba(27,54,93,0.08)]' : 'border-stone-200 bg-white hover:border-primary/30'}`}
                                        >
                                            <input
                                                type="radio"
                                                name="payment_method"
                                                value={option.value}
                                                checked={isSelected}
                                                onChange={handleChange}
                                                className="sr-only"
                                            />

                                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isSelected ? 'bg-white text-primary shadow-sm' : 'bg-stone-100 text-stone-500'}`}>
                                                <span className="material-symbols-outlined text-[20px]">{option.icon}</span>
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-3">
                                                    <h3 className={`text-sm font-black ${isSelected ? 'text-primary' : 'text-stone-800'}`}>{option.title}</h3>
                                                    <span className={`material-symbols-outlined text-[20px] ${isSelected ? 'text-primary' : 'text-stone-300'}`}>
                                                        {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                                                    </span>
                                                </div>
                                                <p className={`mt-2 text-sm leading-relaxed ${isSelected ? 'text-primary/80' : 'text-stone-500'}`}>
                                                    {option.description}
                                                </p>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </section>
                    </div>

                    <div className="lg:sticky lg:top-24 lg:col-span-5 lg:h-fit">
                        <section className="rounded-[28px] border border-stone-200 bg-white p-4 shadow-[0_12px_34px_rgba(27,54,93,0.06)] lg:border-2 lg:border-gold lg:p-8 lg:shadow-xl">
                            <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-4 lg:border-gold/20">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Đơn hàng</p>
                                    <h2 className="mt-1 font-display text-[24px] font-bold text-primary lg:text-2xl">Tóm tắt đơn</h2>
                                </div>
                                <div className="rounded-full bg-primary/[0.05] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                                    {orderItemCount} sản phẩm
                                </div>
                            </div>

                            <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-1 custom-scrollbar lg:mt-6 lg:max-h-[300px] lg:space-y-4 lg:pr-2">
                                {cart.items.map((item) => {
                                    const itemMeta = getItemMeta(item);

                                    return (
                                        <div key={item.id} className="flex gap-3 rounded-[22px] bg-background-light p-3 lg:rounded-none lg:bg-transparent lg:p-0">
                                            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white lg:rounded-none lg:bg-background-light">
                                                <img
                                                    src={item.product?.images?.[0]?.image_url || 'https://placehold.co/120x120?text=No+Image'}
                                                    alt={item.product?.name}
                                                    className="h-full w-full object-cover"
                                                />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <h4 className="line-clamp-2 text-sm font-bold text-primary">{item.product?.name}</h4>

                                                {itemMeta.length > 0 ? (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {itemMeta.map((meta) => (
                                                            <span
                                                                key={`${item.id}-summary-${meta}`}
                                                                className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500 lg:bg-background-light"
                                                            >
                                                                {meta}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : null}

                                                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-stone-500">
                                                    <span>SL: {item.quantity}</span>
                                                    <span className="font-bold text-primary">{formatCurrency(item.price * item.quantity)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-4 border-t border-stone-100 pt-4 lg:mt-6 lg:border-gold/10 lg:pt-6">
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <input
                                        type="text"
                                        className="min-h-[48px] flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 text-sm font-medium text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10 lg:rounded-none lg:border-gold/20 lg:bg-background-light lg:p-3 lg:ring-0"
                                        placeholder="Mã giảm giá..."
                                        value={couponCode}
                                        onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleApplyCoupon}
                                        className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-gold px-5 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-brick lg:rounded-none lg:px-6"
                                    >
                                        Áp dụng
                                    </button>
                                </div>

                                {couponData ? (
                                    <p className="mt-2 text-xs font-medium text-green-600">Đã áp dụng mã: {couponData.code}</p>
                                ) : null}
                            </div>

                            <div className="mt-4 space-y-3 border-t border-stone-100 pt-4 font-ui text-sm lg:mt-6 lg:border-gold/10 lg:pt-6">
                                <div className="flex justify-between text-stone">
                                    <span>Tạm tính</span>
                                    <span>{formatCurrency(cartTotal)}</span>
                                </div>

                                <div className="flex justify-between text-stone">
                                    <span>Vận chuyển</span>
                                    <span className="font-medium text-primary">Giữ nguyên theo chính sách hiện tại</span>
                                </div>

                                {discountAmount > 0 ? (
                                    <div className="flex justify-between font-bold text-brick">
                                        <span>Giảm giá</span>
                                        <span>-{formatCurrency(discountAmount)}</span>
                                    </div>
                                ) : null}

                                <div className="flex items-end justify-between border-t border-stone-200 pt-4 lg:border-gold">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Tổng cần thanh toán</p>
                                        <p className="mt-1 text-[11px] text-stone">Thanh toán: {selectedPayment.title}</p>
                                    </div>
                                    <span className="font-display text-[30px] font-bold italic text-brick lg:text-3xl">{formatCurrency(finalTotal)}</span>
                                </div>
                            </div>

                            {error ? (
                                <div className="mt-4 rounded-[20px] border border-brick/20 bg-brick/10 px-4 py-3 text-sm text-brick lg:mt-6">
                                    {error}
                                </div>
                            ) : null}

                            <button
                                type="submit"
                                disabled={loading}
                                className="mt-6 hidden w-full items-center justify-center gap-3 bg-primary py-5 font-ui text-white shadow-2xl shadow-primary/30 transition-all hover:bg-umber disabled:opacity-60 lg:flex"
                            >
                                {loading ? (
                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                                ) : (
                                    <span className="font-bold uppercase tracking-widest">Xác nhận đặt hàng</span>
                                )}
                            </button>

                            <p className="mt-4 text-center text-[11px] font-medium text-stone-500 lg:hidden">
                                Nút đặt hàng luôn được ghim ở cuối màn hình để chốt đơn nhanh hơn.
                            </p>
                        </section>
                    </div>
                </form>
            </main>

            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 pt-3 shadow-[0_-16px_40px_rgba(27,54,93,0.14)] backdrop-blur lg:hidden">
                <div className="mx-auto max-w-[1280px] pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                    <div className="flex items-center gap-3 rounded-[24px] border border-primary/10 bg-background-light px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Tổng thanh toán</p>
                            <p className="mt-1 truncate text-lg font-black text-primary">{formatCurrency(finalTotal)}</p>
                            <p className="mt-1 text-[11px] text-stone">{orderItemCount} sản phẩm • {selectedPayment.title}</p>
                        </div>

                        <button
                            form="checkout-form"
                            type="submit"
                            disabled={loading}
                            className="inline-flex min-h-[52px] shrink-0 items-center justify-center rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-primary/20 transition-all hover:bg-umber disabled:opacity-60"
                        >
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"></span>
                                    Đang xử lý
                                </span>
                            ) : (
                                'Đặt hàng'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Checkout;
