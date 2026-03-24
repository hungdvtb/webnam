'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/context/CartContext';
import config from '@/lib/config';
import { placeWebOrder, getWebSiteSettings } from '@/lib/api';
import { rememberLeadAttribution } from '@/lib/leadAttribution';
import SearchableSelect from '@/components/ui/SearchableSelect';
import styles from './cart.module.css';
import ThankYouView from '@/components/common/ThankYouView';

const CART_META_IGNORED_KEYS = new Set([
  'variant_id',
  'variant_sku',
  'parent_product_id',
  'parent_product_name'
]);

const getCartItemMeta = (item) => {
  const chips = [];
  const normalizedName = String(item?.name || '').trim().toLowerCase();

  if (item?.groupedItems?.length) {
    chips.push(`Combo ${item.groupedItems.length} món`);
  }

  if (item?.options && typeof item.options === 'object') {
    Object.entries(item.options).forEach(([key, value]) => {
      if (!value || CART_META_IGNORED_KEYS.has(key)) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((entry) => {
          const formatted = String(entry || '').trim();
          if (formatted) {
            chips.push(formatted);
          }
        });
        return;
      }

      if (typeof value === 'object') {
        return;
      }

      const formatted = String(value).trim();
      if (formatted) {
        chips.push(formatted);
      }
    });
  }

  if (item?.sku) {
    chips.push(`SKU ${item.sku}`);
  }

  return Array.from(
    new Set(
      chips.filter((chip) => chip && chip.toLowerCase() !== normalizedName)
    )
  ).slice(0, 3);
};

export default function CartPage() {
  const { cartItems, removeFromCart, updateQuantity, updateItem, restoreCombo, cartCount, cartTotal, clearCart } = useCart();

  const [formData, setFormData] = useState({
    customer_name: '',
    phone: '',
    address: '',
    province: '',
    district: '',
    ward: '',
    email: '',
    notes: '',
    paymentMethod: 'cod'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOrderSuccess, setIsOrderSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  
  const [bankSettings, setBankSettings] = useState(null);
  const [successOrderData, setSuccessOrderData] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const checkoutSectionRef = useRef(null);
  const fieldGroupRefs = useRef({});
  const fieldInputRefs = useRef({});
  const hasMobileCheckoutIntentRef = useRef(false);

  useEffect(() => {
    getWebSiteSettings().then(res => setBankSettings(res)).catch(e => console.error("Error fetching settings:", e));
  }, []);

  const clearFieldErrors = (...fieldNames) => {
    if (fieldNames.length === 0) {
      setFieldErrors({});
      return;
    }

    setFieldErrors((prev) => {
      let hasChanges = false;
      const next = { ...prev };

      fieldNames.forEach((fieldName) => {
        if (next[fieldName]) {
          delete next[fieldName];
          hasChanges = true;
        }
      });

      return hasChanges ? next : prev;
    });
  };

  const registerFieldGroupRef = (fieldName) => (node) => {
    if (node) {
      fieldGroupRefs.current[fieldName] = node;
      return;
    }

    delete fieldGroupRefs.current[fieldName];
  };

  const registerFieldInputRef = (fieldName) => (node) => {
    if (node) {
      fieldInputRefs.current[fieldName] = node;
      return;
    }

    delete fieldInputRefs.current[fieldName];
  };

  // Location logic
  const [useNewAddress, setUseNewAddress] = useState(true);
  const [provinces, setProvinces] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [wards, setWards] = useState([]);

  useEffect(() => {
    const fetchProvinces = async () => {
      try {
        if (useNewAddress) {
          const res = await fetch('https://partner.viettelpost.vn/v2/categories/listProvinceNew');
          const data = await res.json();
          setProvinces(data.data || []);
        } else {
          const res = await fetch('https://provinces.open-api.vn/api/p/');
          const data = await res.json();
          setProvinces(data.map(p => ({ PROVINCE_ID: p.code, PROVINCE_NAME: p.name })));
        }
      } catch (e) {
        console.error('Failed to fetch provinces', e);
      }
    };
    fetchProvinces();
    // Reset selections on switch
    setDistricts([]);
    setWards([]);
    setFormData(prev => ({ ...prev, province: '', district: '', ward: '' }));
    clearFieldErrors('province', 'district', 'ward');
  }, [useNewAddress]);

  const [isWardsLoading, setIsWardsLoading] = useState(false);

  const handleProvinceChange = async (e) => {
    const pName = e.target.value;
    setFormData(prev => ({ ...prev, province: pName, district: '', ward: '' }));
    clearFieldErrors('province', 'district', 'ward');
    setDistricts([]);
    setWards([]);
    if (!pName) return;
    
    const provinceObj = provinces.find(p => p.PROVINCE_NAME === pName);
    if (!provinceObj) return;

    try {
      if (useNewAddress) {
        setIsWardsLoading(true);
        // Lấy đúng danh sách Phường/Xã cho 34 Tỉnh từ API mới nhất
        const res = await fetch(`https://partner.viettelpost.vn/v2/categories/listWardsNew?provinceId=${provinceObj.PROVINCE_ID}`);
        const data = await res.json();
        // Viettel Post trả về WARDS_ID, WARDS_NAME
        const newWards = (data.data || []).map(w => ({ WARD_ID: w.WARDS_ID, WARD_NAME: w.WARDS_NAME }));
        setWards(newWards);
        setDistricts([]);
        setIsWardsLoading(false);
      } else {
        const res = await fetch(`https://provinces.open-api.vn/api/p/${provinceObj.PROVINCE_ID}?depth=2`);
        const data = await res.json();
        if (data.districts) setDistricts(data.districts.map(d => ({ DISTRICT_ID: d.code, DISTRICT_NAME: d.name })));
      }
    } catch (e) {
      console.error('Failed to fetch address data', e);
      setIsWardsLoading(false);
    }
  };

  const handleDistrictChange = async (e) => {
    const dName = e.target.value;
    setFormData(prev => ({ ...prev, district: dName, ward: '' }));
    clearFieldErrors('district', 'ward');
    setWards([]);
    if (!dName) return;
    
    const districtObj = districts.find(d => d.DISTRICT_NAME === dName);
    if (!districtObj) return;

    try {
      if (useNewAddress) {
        const res = await fetch(`https://partner.viettelpost.vn/v2/categories/listWards?districtId=${districtObj.DISTRICT_ID}`);
        const data = await res.json();
        setWards(data.data || []);
      } else {
        const res = await fetch(`https://provinces.open-api.vn/api/d/${districtObj.DISTRICT_ID}?depth=2`);
        const data = await res.json();
        if (data.wards) setWards(data.wards.map(w => ({ WARD_ID: w.code, WARD_NAME: w.name })));
      }
    } catch (e) {
      console.error('Failed to fetch wards', e);
    }
  };


  const formatPrice = (price) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);

  const getImageUrl = (item) => {
    const img = item.image;
    if (!img) return null;
    // Full URL stored directly in image_url field (DB standard)
    if (img.image_url && img.image_url.startsWith('http')) return img.image_url;
    // Legacy url field
    if (img.url && img.url.startsWith('http')) return img.url;
    // Relative path
    if (img.path) {
      const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
      return `${config.storageUrl}/${cleanPath}`;
    }
    return null;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    clearFieldErrors(name);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const validateCheckoutForm = () => {
    const errors = {};
    const phoneRegex = /^(0)[0-9]{9}$/;
    const fieldOrder = ['customer_name', 'phone', 'province'];

    if (!useNewAddress) {
      fieldOrder.push('district');
    }

    fieldOrder.push('ward', 'address');

    if (!formData.customer_name?.trim()) {
      errors.customer_name = 'Vui lòng nhập họ và tên người nhận.';
    }

    if (!formData.phone?.trim()) {
      errors.phone = 'Vui lòng nhập số điện thoại.';
    } else if (!phoneRegex.test(formData.phone.trim())) {
      errors.phone = 'Số điện thoại cần đủ 10 số và bắt đầu bằng số 0.';
    }

    if (!formData.province) {
      errors.province = 'Vui lòng chọn Tỉnh/Thành phố.';
    }

    if (!useNewAddress && !formData.district) {
      errors.district = 'Vui lòng chọn Quận/Huyện.';
    }

    if (!formData.ward) {
      errors.ward = 'Vui lòng chọn Phường/Xã.';
    }

    if (!formData.address?.trim()) {
      errors.address = 'Vui lòng nhập địa chỉ chi tiết.';
    }

    const firstInvalidField = fieldOrder.find((fieldName) => errors[fieldName]);

    return {
      errors,
      firstInvalidField,
      firstMessage: firstInvalidField ? errors[firstInvalidField] : '',
      isValid: Object.keys(errors).length === 0,
    };
  };

  const isCheckoutFormReady = !isOrderSuccess && cartItems.length > 0 && validateCheckoutForm().isValid;

  const getCheckoutScrollOffset = () => {
    if (typeof window === 'undefined') {
      return 0;
    }

    let offset = 12;
    const stickyShellNode = document.querySelector('.mobile-sticky-header-shell');

    if (stickyShellNode instanceof HTMLElement) {
      const shellStyles = window.getComputedStyle(stickyShellNode);
      const shellPosition = shellStyles.position;
      const shellTop = Number.parseFloat(shellStyles.top || '0');

      if ((shellPosition === 'fixed' || shellPosition === 'sticky') && Number.isFinite(shellTop) && shellTop <= 4) {
        offset += stickyShellNode.getBoundingClientRect().height;
        return offset;
      }
    }

    const headerNode = document.querySelector('.site-header');

    if (headerNode instanceof HTMLElement) {
      const headerStyles = window.getComputedStyle(headerNode);
      const headerPosition = headerStyles.position;
      const headerTop = Number.parseFloat(headerStyles.top || '0');

      if ((headerPosition === 'fixed' || headerPosition === 'sticky') && Number.isFinite(headerTop) && headerTop <= 4) {
        offset += headerNode.getBoundingClientRect().height;
      }
    }

    return offset;
  };

  const scrollToCheckoutTarget = () => {
    if (typeof window === 'undefined') {
      return;
    }

    const targetNode = checkoutSectionRef.current;

    if (!targetNode) {
      return;
    }

    const top = targetNode.getBoundingClientRect().top + window.scrollY - getCheckoutScrollOffset();
    window.scrollTo({
      top: Math.max(top, 0),
      behavior: 'smooth',
    });
  };

  const focusCheckoutField = (fieldName = 'customer_name') => {
    const inputNode = fieldInputRefs.current[fieldName];
    const groupNode = fieldGroupRefs.current[fieldName];
    const sectionNode = checkoutSectionRef.current;
    const isMobileViewport = typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px)').matches;

    window.setTimeout(() => {
      if (isMobileViewport) {
        if (sectionNode && typeof sectionNode.focus === 'function') {
          sectionNode.focus({ preventScroll: true });
          return;
        }

        if (groupNode && typeof groupNode.focus === 'function') {
          groupNode.focus({ preventScroll: true });
        }
        return;
      }

      if (inputNode && typeof inputNode.focus === 'function') {
        inputNode.focus({ preventScroll: true });
        return;
      }

      if (groupNode && typeof groupNode.focus === 'function') {
        groupNode.focus({ preventScroll: true });
      }
    }, 220);
  };

  const guideToCheckoutForm = (fieldName = 'customer_name') => {
    scrollToCheckoutTarget(fieldName);
    focusCheckoutField(fieldName);
  };

  // ── Remove a sub-item from a bundle combo (uid-aware) ──────────────────────
  // Use uid when available (new items) to safely identify each slot even when
  // the same product id appears multiple times in a combo (different variants).
  const handleRemoveSubItem = (cartKey, uid) => {
    const item = cartItems.find(i => i.cartKey === cartKey);
    if (!item) return;
    const newGroupedItems = item.groupedItems.filter(
      gi => (gi.uid ?? gi.id) !== uid
    );
    updateItem(cartKey, { groupedItems: newGroupedItems });
  };

  // ── Change qty of a single sub-item inside a combo ─────────────────────────
  const handleSubItemQty = (cartKey, uid, delta) => {
    const item = cartItems.find(i => i.cartKey === cartKey);
    if (!item) return;
    const newGroupedItems = item.groupedItems.map(gi =>
      (gi.uid ?? gi.id) === uid
        ? { ...gi, qty: Math.max(1, (gi.qty || 1) + delta) }
        : gi
    );
    updateItem(cartKey, { groupedItems: newGroupedItems });
  };

  // ── Discount: 10% per bundle item that still has ALL original sub-items ─────
  const discount = cartItems.reduce((acc, item) => {
    if (!item.groupedItems?.length) return acc;
    const originalCount = item.originalSubCount ?? item.groupedItems.length;
    const isFullCombo = item.groupedItems.length >= originalCount;
    if (!isFullCombo) return acc;
    // 10% of this item's effective subtotal (sum of sub-items)
    const subTotal = item.groupedItems.reduce(
      (s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)),
      0
    );
    return acc + (subTotal * item.quantity * 0.1);
  }, 0);

  // ── Hide "Thêm sản phẩm khác" when EVERY cart item is a combo/bundle ────────
  const hasOnlyBundles = cartItems.length > 0 &&
    cartItems.every(item => item.groupedItems?.length > 0);

  const totalAfterDiscount = cartTotal - discount;

  // ── Submit order ────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    
    // Validate required fields
    if (!formData.customer_name?.trim()) {
      alert('Vui lòng nhập Họ và tên người nhận.');
      return;
    }
    const phoneRegex = /^(0)[0-9]{9}$/;
    if (!formData.phone?.trim() || !phoneRegex.test(formData.phone)) {
      alert("Số điện thoại không hợp lệ. Vui lòng nhập đúng 10 số, bắt đầu bằng số 0 (ví dụ: 0987654321).");
      return;
    }
    if (!formData.province) {
      alert('Vui lòng chọn Tỉnh/Thành phố.');
      return;
    }
    if (!useNewAddress && !formData.district) {
      alert('Vui lòng chọn Quận/Huyện.');
      return;
    }
    if (!formData.ward) {
      alert('Vui lòng chọn Phường/Xã.');
      return;
    }
    if (!formData.address?.trim()) {
      alert('Vui lòng nhập Địa chỉ chi tiết.');
      return;
    }

    setIsSubmitting(true);
    try {
      const attribution = rememberLeadAttribution();
      const fullAddress = [formData.address, formData.ward, formData.district, formData.province]
        .filter(Boolean).join(', ');
      const orderData = {
        ...formData,
        address: fullAddress,
        discount,
        total: totalAfterDiscount,
        landing_url: attribution.landing_url || attribution.first_url || window.location.href,
        current_url: window.location.href,
        referrer: attribution.referrer || document.referrer || '',
        utm_source: attribution.utm_source || '',
        utm_medium: attribution.utm_medium || '',
        utm_campaign: attribution.utm_campaign || '',
        utm_content: attribution.utm_content || '',
        utm_term: attribution.utm_term || '',
        raw_query: attribution.raw_query || '',
        items: cartItems.map(item => ({
          product_id: item.id,
          quantity: item.quantity,
          options: item.options,
          sub_items: item.groupedItems?.map(gi => ({ id: gi.id, qty: gi.qty || 1 })),
          product_name: item.name,
          product_sku: item.sku,
          product_slug: item.slug,
          product_url: item.productUrl || `${window.location.origin}/product/${item.slug || item.id}`,
          unit_price: item.price,
        }))
      };
      const response = await placeWebOrder(orderData);
      setOrderNumber(response.order_number);
      // Cache details for thank you page
      setSuccessOrderData({
        cartItems: [...cartItems],
        cartTotal,
        discount,
        formData: { ...formData }
      });
      setIsOrderSuccess(true);
      clearCart();
      window.scrollTo(0, 0);
    } catch (error) {
      console.error('Order placement failed:', error);
      alert('Có lỗi xảy ra khi đặt hàng. Vui lòng thử lại sau.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleMobileCartConfirmRequest = (event) => {
      const respond = typeof event?.detail?.respond === 'function'
        ? event.detail.respond
        : () => {};

      if (isOrderSuccess) {
        respond({ success: true, showNotice: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (isSubmitting) {
        respond({
          success: false,
          showNotice: true,
          message: 'Đơn hàng đang được xử lý, vui lòng chờ trong giây lát.',
        });
        return;
      }

      if (cartItems.length === 0) {
        respond({
          success: false,
          showNotice: true,
          message: 'Giỏ hàng đang trống, vui lòng chọn sản phẩm trước khi đặt hàng.',
        });
        return;
      }

      if (!hasMobileCheckoutIntentRef.current) {
        hasMobileCheckoutIntentRef.current = true;
        const initialTargetField = validateCheckoutForm().firstInvalidField || 'customer_name';
        guideToCheckoutForm(initialTargetField);
        respond({ success: true, showNotice: false });
        return;
      }

      const validation = validateCheckoutForm();

      if (!validation.isValid) {
        setFieldErrors(validation.errors);
        guideToCheckoutForm(validation.firstInvalidField || 'customer_name');
        respond({
          success: false,
          showNotice: true,
          message: validation.firstMessage || 'Vui lòng kiểm tra lại thông tin giao hàng.',
        });
        return;
      }

      setFieldErrors({});
      respond({ success: true, showNotice: false });
      handleSubmit();
    };

    window.addEventListener('webgom:mobile-cart-confirm-request', handleMobileCartConfirmRequest);

    return () => {
      window.removeEventListener('webgom:mobile-cart-confirm-request', handleMobileCartConfirmRequest);
    };
  }, [cartItems, formData, isOrderSuccess, isSubmitting, useNewAddress, cartTotal, discount, totalAfterDiscount]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.dispatchEvent(
      new CustomEvent('webgom:mobile-cart-status', {
        detail: {
          isCheckoutFormValid: isCheckoutFormReady,
        },
      })
    );

    return () => {
      window.dispatchEvent(
        new CustomEvent('webgom:mobile-cart-status', {
          detail: {
            isCheckoutFormValid: false,
          },
        })
      );
    };
  }, [isCheckoutFormReady]);

  if (isOrderSuccess) {
    return (
      <ThankYouView 
        orderNumber={orderNumber}
        formData={successOrderData?.formData || formData}
        cartItems={successOrderData?.cartItems || []}
        cartTotal={successOrderData?.cartTotal || 0}
        discount={successOrderData?.discount || 0}
        bankSettings={bankSettings}
      />
    );
  }

  /* ─── Empty cart ─── */
  if (cartItems.length === 0) {
    return (
      <div className={styles.cartPage}>
        <div className="container">
          <div className={styles.emptyState}>
            <span className={`material-symbols-outlined ${styles.emptyIcon}`}>shopping_cart_off</span>
            <h2 className={styles.pageTitle} style={{ marginBottom: '0.75rem' }}>GIỎ HÀNG ĐANG TRỐNG</h2>
            <p className={styles.pageSubtitle}>
              Hãy chọn những tác phẩm gốm sứ ưng ý để khởi đầu di sản của riêng bạn.
            </p>
            <Link href="/products" className={styles.ctaButton}
              style={{ marginTop: '2.5rem', display: 'inline-block', width: 'auto', padding: '1rem 3rem' }}>
              BẮT ĐẦU MUA SẮM
            </Link>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Main checkout page ─── */
  return (
    <div className={styles.cartPage}>
      <main className="container">
        <div className={styles.pageHeader}>
          <h2 className={styles.pageTitle}>Giỏ hàng &amp; Thanh toán</h2>
          <p className={styles.pageSubtitle}>
            Hoàn tất quy trình để sở hữu những tuyệt tác gốm sứ thủ công
          </p>
        </div>

        <div className={styles.checkoutGrid}>
          {/* ════ LEFT: Delivery + Payment ════ */}
          <div className={styles.mainContent}>

            <section className={styles.sectionCard} ref={checkoutSectionRef} tabIndex={-1}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>1</span>
                <h3 className={styles.sectionTitle}>Thông tin giao hàng</h3>
              </div>

              <div className={styles.formGrid}>
                <div
                  ref={registerFieldGroupRef('customer_name')}
                  tabIndex={-1}
                  className={`${styles.inputGroup} ${fieldErrors.customer_name ? styles.inputGroupError : ''}`}
                >
                  <label>Họ và tên người nhận <span style={{color: '#ef4444'}}>*</span></label>
                  <input
                    ref={registerFieldInputRef('customer_name')}
                    className={`${styles.inputField} ${fieldErrors.customer_name ? styles.inputFieldError : ''}`}
                    type="text"
                    name="customer_name"
                    placeholder="Nhập họ và tên" value={formData.customer_name}
                    onChange={handleInputChange}
                    aria-invalid={Boolean(fieldErrors.customer_name)}
                    required
                  />
                  {fieldErrors.customer_name ? (
                    <p className={styles.fieldError}>{fieldErrors.customer_name}</p>
                  ) : null}
                </div>
                <div
                  ref={registerFieldGroupRef('phone')}
                  tabIndex={-1}
                  className={`${styles.inputGroup} ${fieldErrors.phone ? styles.inputGroupError : ''}`}
                >
                  <label>Số điện thoại <span style={{color: '#ef4444'}}>*</span></label>
                  <input
                    ref={registerFieldInputRef('phone')}
                    className={`${styles.inputField} ${fieldErrors.phone ? styles.inputFieldError : ''}`}
                    type="tel"
                    name="phone"
                    placeholder="Nhập số điện thoại" value={formData.phone}
                    onChange={handleInputChange}
                    aria-invalid={Boolean(fieldErrors.phone)}
                    required
                  />
                  {fieldErrors.phone ? (
                    <p className={styles.fieldError}>{fieldErrors.phone}</p>
                  ) : null}
                </div>

                {/* Chuyển đổi địa chỉ hành chính mới */}
                <div style={{ gridColumn: '1 / -1', padding: '0.25rem 0', display: 'flex', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '13px', color: '#b68f54', fontWeight: 'bold', userSelect: 'none' }}>
                    <input 
                      type="checkbox" 
                      checked={useNewAddress} 
                      onChange={(e) => {
                        clearFieldErrors('province', 'district', 'ward');
                        setUseNewAddress(e.target.checked);
                      }}
                      style={{ marginRight: '8px', cursor: 'pointer', width: '16px', height: '16px', accentColor: '#C5A059' }}
                    />
                    Sử dụng đơn vị hành chính mới (Chỉ gồm 2 cấp: Tỉnh/Thành phố và Phường/Xã)
                  </label>
                </div>

                <div className={styles.threeCol} style={useNewAddress ? { gridTemplateColumns: '1fr 1fr' } : {}}>
                  <div
                    ref={registerFieldGroupRef('province')}
                    tabIndex={-1}
                    className={`${styles.inputGroup} ${fieldErrors.province ? styles.inputGroupError : ''}`}
                  >
                    <label>Tỉnh / Thành phố <span style={{color: '#ef4444'}}>*</span></label>
                    <SearchableSelect
                      name="province"
                      className={`${styles.inputField} ${fieldErrors.province ? styles.inputFieldError : ''}`}
                      value={formData.province}
                      onChange={handleProvinceChange}
                      preserveMobileScroll
                      required
                      placeholder="Chọn Tỉnh/Thành phố"
                      options={provinces.map(p => ({ value: p.PROVINCE_NAME, label: p.PROVINCE_NAME }))}
                    />
                    {fieldErrors.province ? (
                      <p className={styles.fieldError}>{fieldErrors.province}</p>
                    ) : null}
                  </div>
                  
                  {!useNewAddress && (
                    <div
                      ref={registerFieldGroupRef('district')}
                      tabIndex={-1}
                      className={`${styles.inputGroup} ${fieldErrors.district ? styles.inputGroupError : ''}`}
                    >
                      <label>Quận / Huyện <span style={{color: '#ef4444'}}>*</span></label>
                      <SearchableSelect
                        name="district"
                        className={`${styles.inputField} ${fieldErrors.district ? styles.inputFieldError : ''}`}
                        value={formData.district}
                        onChange={handleDistrictChange}
                        preserveMobileScroll
                        required
                        disabled={!formData.province || districts.length === 0}
                        placeholder="Chọn Quận/Huyện"
                        options={districts.map(d => ({ value: d.DISTRICT_NAME, label: d.DISTRICT_NAME }))}
                      />
                      {fieldErrors.district ? (
                        <p className={styles.fieldError}>{fieldErrors.district}</p>
                      ) : null}
                    </div>
                  )}

                  <div
                    ref={registerFieldGroupRef('ward')}
                    tabIndex={-1}
                    className={`${styles.inputGroup} ${fieldErrors.ward ? styles.inputGroupError : ''}`}
                  >
                    <label>Phường / Xã <span style={{color: '#ef4444'}}>*</span></label>
                    <SearchableSelect
                      name="ward"
                      className={`${styles.inputField} ${fieldErrors.ward ? styles.inputFieldError : ''}`}
                      value={formData.ward}
                      onChange={handleInputChange}
                      preserveMobileScroll
                      required
                      disabled={useNewAddress ? (isWardsLoading || !formData.province) : (!formData.district || wards.length === 0)}
                      placeholder={isWardsLoading ? 'Đang tải...' : 'Chọn Phường/Xã'}
                      options={wards.map(w => ({ value: w.WARD_NAME, label: w.WARD_NAME }))}
                    />
                    {fieldErrors.ward ? (
                      <p className={styles.fieldError}>{fieldErrors.ward}</p>
                    ) : null}
                  </div>
                </div>

                <div className={styles.fullWidth}>
                  <div
                    ref={registerFieldGroupRef('address')}
                    tabIndex={-1}
                    className={`${styles.inputGroup} ${fieldErrors.address ? styles.inputGroupError : ''}`}
                  >
                    <label>Địa chỉ chi tiết <span style={{color: '#ef4444'}}>*</span></label>
                    <input
                      ref={registerFieldInputRef('address')}
                      className={`${styles.inputField} ${fieldErrors.address ? styles.inputFieldError : ''}`}
                      type="text"
                      name="address"
                      placeholder="Ví dụ: 123 Đường Lê Lợi" value={formData.address}
                      onChange={handleInputChange}
                      aria-invalid={Boolean(fieldErrors.address)}
                      required
                    />
                    {fieldErrors.address ? (
                      <p className={styles.fieldError}>{fieldErrors.address}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className={styles.sectionCard} style={{ marginBottom: 0 }}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>2</span>
                <h3 className={styles.sectionTitle}>Phương thức thanh toán</h3>
              </div>

              <div className={styles.paymentOptions}>
                <div
                  className={`${styles.paymentOption} ${formData.paymentMethod === 'cod' ? styles.activeOption : ''}`}
                  onClick={() => setFormData(p => ({ ...p, paymentMethod: 'cod' }))}
                >
                  <input type="radio" name="paymentOption" readOnly checked={formData.paymentMethod === 'cod'} />
                  <span className={`material-symbols-outlined ${styles.paymentIcon}`}>local_shipping</span>
                  <div className={styles.paymentDesc}>
                    <span className={styles.paymentTitle}>Giao hàng và thu tiền tại nhà (COD)</span>
                    <span className={styles.paymentSubtext}>Thanh toán khi nhận được hàng.</span>
                  </div>
                </div>
                <div
                  className={`${styles.paymentOption} ${formData.paymentMethod === 'bank' ? styles.activeOption : ''}`}
                  onClick={() => setFormData(p => ({ ...p, paymentMethod: 'bank' }))}
                >
                  <input type="radio" name="paymentOption" readOnly checked={formData.paymentMethod === 'bank'} />
                  <span className={`material-symbols-outlined ${styles.paymentIcon}`}>account_balance</span>
                  <div className={styles.paymentDesc}>
                    <span className={styles.paymentTitle}>Chuyển khoản qua ngân hàng</span>
                    <span className={styles.paymentSubtext}>Thông tin tài khoản để chuyển khoản.</span>
                  </div>
                </div>
              </div>

              {formData.paymentMethod === 'bank' && bankSettings && (
                <div style={{ marginTop: '1rem', padding: '1.25rem', backgroundColor: '#faf9f5', border: '1px solid #e5e7eb', borderRadius: '4px' }} className="animate-fade-in">
                  <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '1rem', color: '#1f2937' }}>Thông tin chuyển khoản:</h4>
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1', minWidth: '200px' }}>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '13px' }}><strong>Ngân hàng:</strong> {bankSettings.bank_name}</p>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '13px' }}><strong>Số tài khoản:</strong> <span style={{ color: '#b68f54', fontWeight: 'bold', fontSize: '15px' }}>{bankSettings.bank_account_number}</span></p>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '13px' }}><strong>Chủ tài khoản:</strong> {bankSettings.bank_account_name}</p>
                      <p style={{ margin: '0 0 0.5rem 0', fontSize: '13px' }}><strong>Nội dung:</strong> <i style={{ color: '#4b5563' }}>{bankSettings.bank_transfer_template?.replace('{order_number}', 'DHXXXXX') || 'DHXXXXX'}</i></p>
                    </div>
                    {bankSettings.bank_qr_code && (
                      <div style={{ width: '120px', height: '120px', flexShrink: 0, backgroundColor: '#fff', padding: '4px', border: '1px solid #e5e7eb', borderRadius: '4px' }}>
                        <img src={bankSettings.bank_qr_code} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button className={styles.ctaButton} onClick={handleSubmit}
                disabled={isSubmitting} id="checkout-submit-btn">
                {isSubmitting ? 'ĐANG XỬ LÝ...' : 'XÁC NHẬN THANH TOÁN'}
              </button>
              <p className={styles.ctaNote}>
                Bằng cách nhấn xác nhận, quý khách đồng ý với Điều khoản &amp; Chính sách bảo mật của Gốm Đại Thành.
              </p>
            </section>
          </div>

          {/* ════ RIGHT: Order Summary ════ */}
          <aside className={styles.sidebar}>
            <div className={styles.summaryCard}>
              <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Tóm Tắt Đơn Hàng 
                <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#64748b', textTransform: 'none' }}>({cartCount} sản phẩm)</span>
              </h3>

              <div className={styles.mobileCartList}>
                {cartItems.map((item) => {
                  const itemMeta = getCartItemMeta(item);
                  const imgSrc = getImageUrl(item);
                  const originalCount = item.originalSubCount ?? item.groupedItems?.length ?? 0;
                  const isFullCombo = item.groupedItems?.length > 0 &&
                    item.groupedItems.length >= originalCount;
                  const effectivePrice = item.groupedItems?.length > 0
                    ? item.groupedItems.reduce((s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)), 0)
                    : item.price;
                  const lineTotal = effectivePrice * item.quantity;

                  return (
                    <div key={`${item.cartKey}-mobile`} className={styles.mobileCartItem}>
                      <button
                        type="button"
                        className={styles.mobileRemoveBtn}
                        onClick={() => removeFromCart(item.cartKey)}
                        aria-label={`Xóa ${item.name}`}
                      >
                        <span className="material-symbols-outlined">delete</span>
                      </button>

                      <div className={styles.mobileItemMain}>
                        <div className={styles.mobileItemImage}>
                          {imgSrc ? (
                            <Image src={imgSrc} alt={item.name} fill style={{ objectFit: 'cover' }} unoptimized />
                          ) : (
                            <div style={{
                              width: '100%', height: '100%', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', background: '#F0EDE6'
                            }}>
                              <span className="material-symbols-outlined" style={{ color: '#C5A065', fontSize: 24 }}>
                                image
                              </span>
                            </div>
                          )}
                        </div>

                        <div className={styles.mobileItemBody}>
                          <h4 className={styles.mobileItemName}>{item.name}</h4>

                          {itemMeta.length > 0 ? (
                            <div className={styles.mobileMetaList}>
                              {itemMeta.map((meta) => (
                                <span key={`${item.cartKey}-meta-${meta}`} className={styles.mobileMetaBadge}>
                                  {meta}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className={styles.mobileMetaFallback}>
                              {item.groupedItems?.length > 0 ? 'Combo bộ sưu tập' : 'Tác phẩm đơn'}
                            </p>
                          )}

                          <div className={styles.mobileItemFooter}>
                            <div className={styles.mobilePriceGroup}>
                              <span className={styles.mobileLabel}>
                                {item.groupedItems?.length > 0 ? 'Giá combo' : 'Đơn giá'}
                              </span>
                              <strong className={styles.mobileUnitPrice}>{formatPrice(effectivePrice)}</strong>
                            </div>

                            <div className={styles.mobileQuantityCtrl}>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.cartKey, item.quantity - 1)}
                                aria-label={`Giảm số lượng ${item.name}`}
                              >
                                −
                              </button>
                              <span>{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.cartKey, item.quantity + 1)}
                                aria-label={`Tăng số lượng ${item.name}`}
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div className={styles.mobileLineTotal}>
                            <span className={styles.mobileLineLabel}>Thành tiền</span>
                            <strong className={styles.mobileLinePrice}>{formatPrice(lineTotal)}</strong>
                          </div>
                        </div>
                      </div>

                      {item.groupedItems?.length > 0 && (
                        <div className={styles.mobileBundleBlock}>
                          <div className={styles.mobileBundleTopRow}>
                            <div className={styles.mobileBundleSummary}>
                              <span className={styles.mobileBundleSummaryLabel}>
                                Combo {item.groupedItems.length} món
                              </span>
                              <span className={styles.mobileBundleSummaryNote}>
                                Chi tiết các món nằm trong combo này
                              </span>
                            </div>
                            <span className={styles.mobileBundleTag}>
                              {isFullCombo ? 'Ưu đãi 10%' : `${item.groupedItems.length}/${originalCount} món`}
                            </span>
                          </div>

                          <div className={styles.mobileBundleList}>
                            {item.groupedItems.map((gi) => {
                              const giUid = gi.uid ?? gi.id;
                              return (
                                <div key={`${item.cartKey}-bundle-${giUid}`} className={styles.mobileBundleItem}>
                                  <div className={styles.mobileBundleCopy}>
                                    <span className={styles.mobileBundleName}>
                                      {gi.name || `Sản phẩm #${gi.id}`}
                                    </span>
                                    <span className={styles.mobileBundlePrice}>
                                      {formatPrice(parseFloat(gi.price || 0))}
                                    </span>
                                  </div>

                                  <div className={styles.mobileBundleActions}>
                                    <div className={styles.mobileSubQtyCtrl}>
                                      <button type="button" onClick={() => handleSubItemQty(item.cartKey, giUid, -1)}>−</button>
                                      <span>{gi.qty || 1}</span>
                                      <button type="button" onClick={() => handleSubItemQty(item.cartKey, giUid, 1)}>+</button>
                                    </div>

                                    <button
                                      type="button"
                                      className={styles.mobileChildRemove}
                                      onClick={() => handleRemoveSubItem(item.cartKey, giUid)}
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <div className={styles.mobileBundleFooter}>
                            {isFullCombo ? (
                              <span className={styles.mobileBundleStatus}>✓ Combo đầy đủ, ưu đãi 10% đang áp dụng</span>
                            ) : (
                              <>
                                <span className={styles.mobileBundleStatusMuted}>
                                  Mua đủ {originalCount} món để nhận ưu đãi 10%
                                </span>
                                <button
                                  type="button"
                                  className={styles.mobileRestoreBtn}
                                  onClick={() => restoreCombo(item.cartKey)}
                                >
                                  Khôi phục combo
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={styles.cartList}>
                {cartItems.map((item) => {
                  const imgSrc = getImageUrl(item);
                  const originalCount = item.originalSubCount ?? item.groupedItems?.length ?? 0;
                  const isFullCombo = item.groupedItems?.length > 0 &&
                    item.groupedItems.length >= originalCount;

                  // Effective price for this cart item (dynamic for bundles)
                  const effectivePrice = item.groupedItems?.length > 0
                    ? item.groupedItems.reduce((s, gi) => s + (parseFloat(gi.price || 0) * (gi.qty || 1)), 0)
                    : item.price;

                  return (
                    <div key={item.cartKey} className={styles.cartItem}>
                      <button className={styles.removeBtn}
                        onClick={() => removeFromCart(item.cartKey)} title="Xóa">
                        <span className="material-symbols-outlined">delete</span>
                      </button>

                      <div className={styles.itemMain}>
                        <div className={styles.itemImage}>
                          {imgSrc ? (
                            <Image src={imgSrc} alt={item.name} fill
                              style={{ objectFit: 'cover' }} unoptimized />
                          ) : (
                            <div style={{
                              width: '100%', height: '100%', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', background: '#F0EDE6'
                            }}>
                              <span className="material-symbols-outlined"
                                style={{ color: '#C5A065', fontSize: 26 }}>image</span>
                            </div>
                          )}
                        </div>
                        <div className={styles.itemDetails}>
                          <h4 className={styles.itemName}>{item.name}</h4>
                          <p className={styles.itemMeta}>
                            {item.sku ? `SKU: ${item.sku}` :
                              (item.groupedItems?.length > 0 ? 'Combo bộ sưu tập' : 'Tác phẩm đơn')}
                          </p>
                          <div className={styles.itemActions}>
                            <div className={styles.quantityCtrl}>
                              <button onClick={() => updateQuantity(item.cartKey, item.quantity - 1)}>−</button>
                              <input type="text" value={item.quantity} readOnly />
                              <button onClick={() => updateQuantity(item.cartKey, item.quantity + 1)}>+</button>
                            </div>
                            <div className={styles.itemPrice}>
                              {formatPrice(effectivePrice * item.quantity)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Sub-items for bundle/combo with qty controls */}
                      {item.groupedItems?.length > 0 && (
                        <div className={styles.itemGroup}>
                          <span className={styles.groupLabel}>Sản phẩm trong combo</span>
                          <div className={styles.groupChildren}>
                            {item.groupedItems.map((gi) => {
                              const giUid = gi.uid ?? gi.id;
                              return (
                                <div key={giUid} className={styles.childItem}>
                                  <div className={styles.childIcon}>
                                    <span className="material-symbols-outlined">check_circle</span>
                                  </div>
                                  <span className={styles.childName} style={{ flex: 1 }}>
                                    {gi.name || `Sản phẩm #${gi.id}`}
                                  </span>
                                  {/* Sub-item unit price */}
                                  <span className={styles.childPrice}>
                                    {formatPrice(parseFloat(gi.price || 0))}
                                  </span>
                                  {/* Sub-item qty controls */}
                                  <div className={styles.subQtyCtrl}>
                                    <button onClick={() => handleSubItemQty(item.cartKey, giUid, -1)}>−</button>
                                    <span>{gi.qty || 1}</span>
                                    <button onClick={() => handleSubItemQty(item.cartKey, giUid, 1)}>+</button>
                                  </div>
                                  <button
                                    className={styles.childRemove}
                                    onClick={() => handleRemoveSubItem(item.cartKey, giUid)}
                                  >
                                    Xóa
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {/* Combo status & restore — separated below the list */}
                          <div className={styles.comboFooter}>
                            {isFullCombo ? (
                              <div className={styles.comboTag} style={{ color: '#2E7D32' }}>
                                ✓ Combo đầy đủ — Ưu đãi 10% đang áp dụng
                              </div>
                            ) : (
                              <>
                                <div className={styles.comboTag} style={{ color: '#94A3B8' }}>
                                  Mua đủ {originalCount} sản phẩm để được ưu đãi 10%
                                </div>
                                <button
                                  className={styles.restoreComboBtn}
                                  onClick={() => restoreCombo(item.cartKey)}
                                  title="Khôi phục lại đầy đủ các món trong combo"
                                >
                                  ↩ Khôi phục combo
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!hasOnlyBundles && (
                <Link href="/products" className={styles.addMoreBtn}>
                  + THÊM SẢN PHẨM KHÁC
                </Link>
              )}

              <div className={styles.summaryBody}>
                <div className={styles.summaryRow}>
                  <span>Tạm tính ({cartCount} sản phẩm)</span>
                  <span style={{ fontWeight: 600 }}>{formatPrice(cartTotal)}</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Phí vận chuyển</span>
                  <span style={{ fontWeight: 600 }}>Miễn phí</span>
                </div>
                <div className={styles.summaryRow}>
                  <span>Ưu đãi combo (10%)</span>
                  <span className={styles.discountText} style={{ fontWeight: 600 }}>
                    {discount > 0 ? `− ${formatPrice(discount)}` : '− 0₫'}
                  </span>
                </div>
              </div>

              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Tổng cộng</span>
                <span className={styles.totalPrice}>{formatPrice(totalAfterDiscount)}</span>
              </div>

              <div className={styles.trustBadges}>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>verified</span>
                  <span>Bảo hành 10 năm</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>local_shipping</span>
                  <span>Đóng gói chuyên dụng</span>
                </div>
                <div className={styles.badgeItem}>
                  <span className={`material-symbols-outlined ${styles.badgeIcon}`}>workspace_premium</span>
                  <span>Chứng nhận Nghệ nhân</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <div className={styles.mobileCheckoutBar}>
        <div className="container">
          <div className={styles.mobileCheckoutInner}>
            <div className={styles.mobileCheckoutCopy}>
              <span className={styles.mobileCheckoutLabel}>Tổng cộng</span>
              <strong className={styles.mobileCheckoutPrice}>{formatPrice(totalAfterDiscount)}</strong>
              <span className={styles.mobileCheckoutSubtext}>
                {cartCount} sản phẩm
                {discount > 0 ? ` • Giảm ${formatPrice(discount)}` : ' • Miễn phí vận chuyển'}
              </span>
            </div>

            <button
              type="button"
              className={styles.mobileCheckoutButton}
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Đang xử lý...' : 'Xác nhận đơn'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
