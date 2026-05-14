'use client';

import React, { useState, useEffect, useMemo, useRef, useEffectEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/context/CartContext';
import { BUNDLE_DISCOUNT_RATE, getCartBundlePricing } from '@/lib/bundlePricing';
import config from '@/lib/config';
import { placeWebOrder, saveWebOrderDraft, getWebSiteSettings } from '@/lib/api';
import { rememberLeadAttribution } from '@/lib/leadAttribution';
import { resolveCartItemImageUrl } from '@/lib/media';
import { buildBundleComponentDetailHref } from '@/lib/productLinks';
import { getAnalyticsIdentity, trackCheckoutStarted, trackPurchase } from '@/lib/analytics';
import SearchableSelect from '@/components/ui/SearchableSelect';
import ComponentSelectionModal from '@/components/product/common/ComponentSelectionModal';
import styles from './cart.module.css';
import ThankYouView from '@/components/common/ThankYouView';

const CART_META_IGNORED_KEYS = new Set([
  'variant_id',
  'variant_sku',
  'parent_product_id',
  'parent_product_name',
  'bundle_metadata_version',
  'is_full_bundle',
  'eligible_discount',
  'combo_discount_rate',
  'combo_discount_amount',
]);

const getCartItemMeta = (item) => {
  const chips = [];
  const normalizedName = String(item?.name || '').trim().toLowerCase();

  if (item?.groupedItems?.length) {
    const originalBundleCount = Math.max(
      Number(item?.originalSubCount || 0),
      Number(item?.groupedItems?.length || 0),
    );
    const bundleOptionTitle = String(
      item?.options?.bundle_option_title
      || item?.options?.bundle_config
      || item?.bundleConfigName
      || ''
    ).trim();

    if (originalBundleCount > 0) {
      chips.push(`Combo ${originalBundleCount} món`);
    }

    if (bundleOptionTitle) {
      const normalizedBundleOptionTitle = bundleOptionTitle.toLowerCase();

      if (
        normalizedBundleOptionTitle !== normalizedName
        && !normalizedName.includes(normalizedBundleOptionTitle)
      ) {
        chips.push(bundleOptionTitle);
      }
    }

    return chips.slice(0, 2);
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

  return Array.from(
    new Set(
      chips.filter((chip) => chip && chip.toLowerCase() !== normalizedName)
    )
  ).slice(0, 3);
};

const CHECKOUT_PHONE_REGEX = /^(0)[0-9]{9}$/;
const CHECKOUT_DRAFT_DELAY_MS = 10 * 60 * 1000;
const CHECKOUT_DRAFT_UPDATE_DELAY_MS = 2000;
const CHECKOUT_DRAFT_STORAGE_KEY = `webgom_checkout_draft_${config.siteCode}`;
const CART_BUNDLE_RETURN_STATE_KEY = '__webgom_bundle_component_return_state';
const CART_BUNDLE_RETURN_STATE_TTL_MS = 30 * 60 * 1000;
const THANK_YOU_SELFTEST_DATA = {
  orderNumber: 'SELFTEST123',
  createdAt: '2026-04-07T10:15:00.000Z',
  discount: 0,
  cartTotal: 2112000,
  formData: {
    customer_name: 'Codex Mobile Test',
    phone: '0901234567',
    address: '123 Lê Lợi',
    province: 'Hà Nội',
    district: '',
    ward: 'Phường Hàng Bạc',
    email: '',
    notes: '',
    paymentMethod: 'cod',
  },
  cartItems: [
    {
      id: 1161,
      name: 'Bộ test men lam',
      slug: 'bo-test-men-lam',
      sku: 'SELFTEST-ORDER-IMAGE',
      productUrl: '/product/bo-test-men-lam',
      price: 1056000,
      quantity: 2,
      options: {},
      groupedItems: [],
      images: [],
      image: null,
    },
  ],
};

const getCartItemUnitPrice = (item) => {
  if (item?.groupedItems?.length) {
    return item.groupedItems.reduce(
      (sum, groupedItem) => sum + (parseFloat(groupedItem.price || 0) * (groupedItem.qty || 1)),
      0
    );
  }

  return parseFloat(item?.price || 0);
};

const createCheckoutDraftToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const readStoredCheckoutDraft = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed?.token) {
      return null;
    }

    return {
      token: parsed.token,
      leadId: parsed.leadId || null,
    };
  } catch (error) {
    console.error('Failed to read checkout draft state:', error);
    return null;
  }
};

const writeStoredCheckoutDraft = (token, leadId = null) => {
  if (typeof window === 'undefined' || !token) {
    return;
  }

  window.sessionStorage.setItem(
    CHECKOUT_DRAFT_STORAGE_KEY,
    JSON.stringify({ token, leadId })
  );
};

const clearStoredCheckoutDraft = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
};

const normalizeCartScrollPosition = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
};

const normalizeCartViewportOffset = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
};

const readCartBundleReturnState = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const historyState = window.history.state;
  const savedState = historyState?.[CART_BUNDLE_RETURN_STATE_KEY];

  if (!savedState || typeof savedState !== 'object') {
    return null;
  }

  const updatedAt = Number(savedState.updatedAt || 0);

  if (updatedAt > 0 && (Date.now() - updatedAt) > CART_BUNDLE_RETURN_STATE_TTL_MS) {
    return null;
  }

  return {
    scrollY: normalizeCartScrollPosition(savedState.scrollY),
    anchorKey: String(savedState.anchorKey || '').trim(),
    anchorViewportTop: normalizeCartViewportOffset(savedState.anchorViewportTop),
  };
};

const writeCartBundleReturnState = (nextState = {}) => {
  if (typeof window === 'undefined') {
    return;
  }

  const currentState = window.history.state && typeof window.history.state === 'object'
    ? window.history.state
    : {};

  window.history.replaceState(
    {
      ...currentState,
      [CART_BUNDLE_RETURN_STATE_KEY]: {
        scrollY: normalizeCartScrollPosition(nextState.scrollY),
        anchorKey: String(nextState.anchorKey || '').trim(),
        anchorViewportTop: normalizeCartViewportOffset(nextState.anchorViewportTop),
        updatedAt: Number(nextState.updatedAt || Date.now()),
      },
    },
    '',
    window.location.href,
  );
};

const clearCartBundleReturnState = () => {
  if (typeof window === 'undefined') {
    return;
  }

  const currentState = window.history.state;

  if (!currentState || typeof currentState !== 'object' || !(CART_BUNDLE_RETURN_STATE_KEY in currentState)) {
    return;
  }

  const { [CART_BUNDLE_RETURN_STATE_KEY]: _ignored, ...nextState } = currentState;
  window.history.replaceState(nextState, '', window.location.href);
};

const findCartBundleAnchorNode = (anchorKey = '') => {
  if (typeof document === 'undefined' || !anchorKey) {
    return null;
  }

  return Array.from(document.querySelectorAll('[data-bundle-component-anchor]')).find(
    (node) => node.getAttribute('data-bundle-component-anchor') === anchorKey
  ) || null;
};

export default function CartPage() {
  const {
    cartItems,
    removeFromCart,
    updateQuantity,
    updateItem,
    updateBundleItemProduct,
    restoreCombo,
    cartCount,
    cartTotal,
    clearCart,
  } = useCart();

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
  const [activeBundleSelection, setActiveBundleSelection] = useState(null);
  
  const [bankSettings, setBankSettings] = useState(null);
  const [successOrderData, setSuccessOrderData] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const checkoutSectionRef = useRef(null);
  const fieldGroupRefs = useRef({});
  const fieldInputRefs = useRef({});
  const hasMobileCheckoutIntentRef = useRef(false);
  const draftTokenRef = useRef('');
  const draftLeadIdRef = useRef(null);
  const draftTimerRef = useRef(null);
  const draftSyncTimerRef = useRef(null);
  const draftRequestInFlightRef = useRef(null);
  const lastDraftPayloadRef = useRef('');
  const checkoutCompletedRef = useRef(false);
  const checkoutStartedTrackedRef = useRef(false);
  const latestCheckoutStateRef = useRef(null);

  useEffect(() => {
    checkoutCompletedRef.current = false;
    const storedDraft = readStoredCheckoutDraft();

    if (storedDraft?.token) {
      draftTokenRef.current = storedDraft.token;
      draftLeadIdRef.current = storedDraft.leadId;
      return;
    }

    draftTokenRef.current = createCheckoutDraftToken();
    writeStoredCheckoutDraft(draftTokenRef.current, null);
  }, []);

  useEffect(() => {
    getWebSiteSettings().then(res => setBankSettings(res)).catch(e => console.error("Error fetching settings:", e));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get('selftest') !== 'thankyou') {
      return;
    }

    setOrderNumber(THANK_YOU_SELFTEST_DATA.orderNumber);
    setSuccessOrderData({
      cartItems: [...THANK_YOU_SELFTEST_DATA.cartItems],
      cartTotal: THANK_YOU_SELFTEST_DATA.cartTotal,
      discount: THANK_YOU_SELFTEST_DATA.discount,
      formData: { ...THANK_YOU_SELFTEST_DATA.formData },
      createdAt: THANK_YOU_SELFTEST_DATA.createdAt,
    });
    setIsOrderSuccess(true);
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

  const getImageUrl = (item) => resolveCartItemImageUrl(item, 'medium', '');
  const getBundleComponentImageUrl = (item) => resolveCartItemImageUrl(item, 'medium', '');
  const getBundleComponentAnchorKey = (cartKey, itemUid) => `${cartKey}::${itemUid}`;
  const canChangeBundleComponent = (item) => Boolean(
    item?.base_product_slug
    || item?.base_product_id
    || item?.slug
    || item?.id
  );

  const closeBundleSelectionModal = () => {
    setActiveBundleSelection(null);
  };

  const openBundleSelectionModal = (cartKey, slot) => {
    if (!cartKey || !slot) {
      return;
    }

    setActiveBundleSelection({ cartKey, slot });
  };

  const handleSelectBundleComponent = (newProduct) => {
    if (!activeBundleSelection?.cartKey || !activeBundleSelection?.slot) {
      return;
    }

    updateBundleItemProduct(
      activeBundleSelection.cartKey,
      activeBundleSelection.slot.bundle_item_uid || activeBundleSelection.slot.uid || activeBundleSelection.slot.id,
      newProduct
    );
    closeBundleSelectionModal();
  };

  const rememberBundleComponentReturnState = useEffectEvent((anchorKey = '') => {
    if (typeof window === 'undefined') {
      return;
    }

    const anchorNode = findCartBundleAnchorNode(anchorKey);
    writeCartBundleReturnState({
      scrollY: window.scrollY,
      anchorKey,
      anchorViewportTop: anchorNode ? anchorNode.getBoundingClientRect().top : null,
      updatedAt: Date.now(),
    });
  });

  const handleBundleComponentLinkClick = useEffectEvent((event, anchorKey = '') => {
    if (event?.defaultPrevented) {
      return;
    }

    if (typeof event?.button === 'number' && event.button !== 0) {
      return;
    }

    if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) {
      return;
    }

    rememberBundleComponentReturnState(anchorKey);
  });

  const bundleStatesByKey = useMemo(() => {
    const bundleStateMap = new Map();

    cartItems.forEach((item) => {
      if (item.groupedItems?.length > 0) {
        bundleStateMap.set(item.cartKey, getCartBundlePricing(item));
      }
    });

    return bundleStateMap;
  }, [cartItems]);

  useEffect(() => {
    if (typeof window === 'undefined' || cartItems.length === 0) {
      return undefined;
    }

    const savedReturnState = readCartBundleReturnState();

    if (!savedReturnState) {
      return undefined;
    }

    let isCancelled = false;
    let frameId = 0;
    const timeoutIds = [];

    const restoreCartScrollPosition = () => {
      if (isCancelled) {
        return;
      }

      const anchorNode = findCartBundleAnchorNode(savedReturnState.anchorKey);
      const anchorViewportTop = Number(savedReturnState.anchorViewportTop);
      const targetTop = anchorNode && Number.isFinite(anchorViewportTop)
        ? (window.scrollY + anchorNode.getBoundingClientRect().top - anchorViewportTop)
        : savedReturnState.scrollY;

      window.scrollTo({
        top: Math.max(Math.round(targetTop), 0),
        behavior: 'auto',
      });
    };

    frameId = window.requestAnimationFrame(() => {
      restoreCartScrollPosition();
      timeoutIds.push(window.setTimeout(restoreCartScrollPosition, 150));
      timeoutIds.push(window.setTimeout(restoreCartScrollPosition, 360));
    });

    clearCartBundleReturnState();

    return () => {
      isCancelled = true;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [cartItems.length]);

  const getBundleDiscountPercent = (bundleState) => (
    Math.round((bundleState?.comboDiscountRate || BUNDLE_DISCOUNT_RATE) * 100)
  );

  const getBundleStatusTag = (bundleState) => {
    if (!bundleState) {
      return '';
    }

    if (bundleState.isFullBundle) {
      return `Ưu đãi ${getBundleDiscountPercent(bundleState)}%`;
    }

    if (bundleState.failureCode === 'missing_item') {
      return `${bundleState.currentCountDisplay}/${bundleState.expectedCountDisplay} món`;
    }

    if (bundleState.failureCode === 'quantity_mismatch') {
      return 'Sai số lượng';
    }

    return 'Sai cấu hình';
  };

  const getBundleHintText = (bundleState) => {
    const percent = getBundleDiscountPercent(bundleState);

    if (!bundleState) {
      return `Khôi phục đúng cấu hình gốc để nhận ưu đãi ${percent}%`;
    }

    if (bundleState.isFullBundle) {
      return `✓ Combo đầy đủ, ưu đãi ${percent}% đang áp dụng`;
    }

    if (!bundleState.hasTrustedSnapshot) {
      return `Khôi phục đúng cấu hình gốc để nhận ưu đãi ${percent}%`;
    }

    if (bundleState.failureCode === 'missing_item') {
      return `Mua đủ ${bundleState.expectedCountDisplay} món để nhận ưu đãi ${percent}%`;
    }

    if (bundleState.failureCode === 'quantity_mismatch') {
      return `Đưa số lượng từng món về đúng cấu hình gốc để nhận ưu đãi ${percent}%`;
    }

    return `Khôi phục đúng cấu hình gốc để nhận ưu đãi ${percent}%`;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    clearFieldErrors(name);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const clearDraftTimers = () => {
    if (draftTimerRef.current) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }

    if (draftSyncTimerRef.current) {
      window.clearTimeout(draftSyncTimerRef.current);
      draftSyncTimerRef.current = null;
    }
  };

  const ensureDraftToken = () => {
    if (draftTokenRef.current) {
      return draftTokenRef.current;
    }

    const storedDraft = readStoredCheckoutDraft();
    if (storedDraft?.token) {
      draftTokenRef.current = storedDraft.token;
      draftLeadIdRef.current = storedDraft.leadId;
      return draftTokenRef.current;
    }

    draftTokenRef.current = createCheckoutDraftToken();
    writeStoredCheckoutDraft(draftTokenRef.current, draftLeadIdRef.current);
    return draftTokenRef.current;
  };

  const clearCheckoutDraftSession = () => {
    clearDraftTimers();
    draftLeadIdRef.current = null;
    draftRequestInFlightRef.current = null;
    lastDraftPayloadRef.current = '';
    draftTokenRef.current = '';
    clearStoredCheckoutDraft();
  };

  const buildCheckoutPayload = (checkoutState = null) => {
    const state = checkoutState || latestCheckoutStateRef.current || {
      cartItems,
      formData,
      discount,
      totalAfterDiscount,
      useNewAddress,
    };
    const attribution = rememberLeadAttribution();
    const analyticsIdentity = getAnalyticsIdentity();
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const addressDetail = String(state.formData?.address || '').trim();
    const province = String(state.formData?.province || '').trim();
    const district = state.useNewAddress ? '' : String(state.formData?.district || '').trim();
    const ward = String(state.formData?.ward || '').trim();
    const fullAddress = [addressDetail, ward, district, province]
      .filter(Boolean)
      .join(', ');
    const draftToken = ensureDraftToken();

    return {
      customer_name: String(state.formData?.customer_name || '').trim(),
      phone: String(state.formData?.phone || '').trim(),
      address: fullAddress,
      address_detail: addressDetail,
      province,
      district,
      ward,
      email: String(state.formData?.email || '').trim(),
      notes: String(state.formData?.notes || '').trim(),
      paymentMethod: state.formData?.paymentMethod || 'cod',
      payment_method: state.formData?.paymentMethod || 'cod',
      source: attribution.source_display || attribution.source || 'Website',
      discount: state.discount || 0,
      total: state.totalAfterDiscount || 0,
      draft_token: draftToken,
      draft_lead_id: draftLeadIdRef.current,
      visitor_id: analyticsIdentity.visitor_id,
      session_id: analyticsIdentity.session_id,
      landing_url: attribution.landing_url || attribution.first_url || currentUrl,
      current_url: currentUrl,
      referrer: attribution.referrer || (typeof document !== 'undefined' ? document.referrer : '') || '',
      utm_source: attribution.utm_source || '',
      utm_medium: attribution.utm_medium || '',
      utm_campaign: attribution.utm_campaign || '',
      utm_content: attribution.utm_content || '',
      utm_term: attribution.utm_term || '',
      fbclid: attribution.fbclid || '',
      gclid: attribution.gclid || '',
      ttclid: attribution.ttclid || '',
      raw_query: attribution.raw_query || '',
      items: (state.cartItems || []).map((item) => {
        const bundleState = item.groupedItems?.length > 0
          ? getCartBundlePricing(item)
          : null;
        const bundleOptionTitle = item?.options?.bundle_option_title
          || item?.options?.bundle_config
          || bundleState?.bundleConfigName
          || '';
        const itemOptions = {
          ...(item.options || {}),
          bundle_option_title: bundleOptionTitle || undefined,
          is_full_bundle: Boolean(bundleState?.isFullBundle),
          eligible_discount: Boolean(bundleState?.eligibleDiscount),
          combo_discount_rate: bundleState?.comboDiscountRate || BUNDLE_DISCOUNT_RATE,
          combo_discount_amount: bundleState?.comboDiscountAmount || 0,
          bundle_metadata_version: item?.bundleMetadataVersion || 0,
        };
        const unitPrice = bundleState?.currentSubtotal ?? getCartItemUnitPrice(item);

        return {
          product_id: item.id,
          quantity: item.quantity,
          options: itemOptions,
          sub_items: (bundleState?.currentItems || item.groupedItems || []).map((groupedItem) => {
            const childUnitPrice = parseFloat(groupedItem.price || 0);
            const childQuantity = groupedItem.qty || 1;

            return {
              id: groupedItem.id,
              product_id: groupedItem.id,
              base_product_id: groupedItem.base_product_id || groupedItem.id,
              variant_id: groupedItem.variant_id || null,
              qty: childQuantity,
              quantity: childQuantity,
              name: groupedItem.name,
              product_name: groupedItem.name,
              price: childUnitPrice,
              unit_price: childUnitPrice,
              line_total: childUnitPrice * childQuantity,
              option_title: bundleOptionTitle || undefined,
            };
          }),
          bundle_snapshot: bundleState?.snapshotItems || undefined,
          removed_bundle_items: bundleState?.removedItems || undefined,
          is_full_bundle: Boolean(bundleState?.isFullBundle),
          eligible_discount: Boolean(bundleState?.eligibleDiscount),
          combo_discount_rate: bundleState?.comboDiscountRate || BUNDLE_DISCOUNT_RATE,
          combo_discount_amount: bundleState?.comboDiscountAmount || 0,
          combo_discount_line_amount: bundleState?.lineDiscount || 0,
          bundle_subtotal: bundleState?.currentSubtotal || undefined,
          bundle_total_after_discount: bundleState?.finalSubtotal || undefined,
          product_name: item.name,
          product_sku: item.sku,
          product_slug: item.slug,
          product_url: item.productUrl || `${window.location.origin}/product/${item.slug || item.id}`,
          unit_price: unitPrice,
          line_total: unitPrice * item.quantity,
        };
      }),
    };
  };

  const saveDraftLeadSnapshot = async (checkoutState = null) => {
    if (checkoutCompletedRef.current || isOrderSuccess || cartItems.length === 0) {
      return null;
    }

    const payload = buildCheckoutPayload(checkoutState);

    if (!CHECKOUT_PHONE_REGEX.test(payload.phone)) {
      return null;
    }

    const serializedPayload = JSON.stringify(payload);
    if (draftLeadIdRef.current && serializedPayload === lastDraftPayloadRef.current) {
      return null;
    }

    if (draftRequestInFlightRef.current) {
      try {
        await draftRequestInFlightRef.current;
      } catch (error) {
        return null;
      }

      return saveDraftLeadSnapshot(checkoutState);
    }

    const requestPromise = saveWebOrderDraft(payload)
      .then((response) => {
        if (response?.draft_token) {
          draftTokenRef.current = response.draft_token;
        }

        if (response?.lead_id) {
          draftLeadIdRef.current = response.lead_id;
          writeStoredCheckoutDraft(draftTokenRef.current || payload.draft_token, response.lead_id);
        }

        if (response?.is_draft === false) {
          checkoutCompletedRef.current = true;
          clearDraftTimers();
        }

        lastDraftPayloadRef.current = serializedPayload;
        return response;
      })
      .catch((error) => {
        console.error('Checkout draft save failed:', error);
        throw error;
      })
      .finally(() => {
        draftRequestInFlightRef.current = null;
      });

    draftRequestInFlightRef.current = requestPromise;
    return requestPromise;
  };

  const triggerDraftSave = useEffectEvent(() => {
    saveDraftLeadSnapshot().catch(() => {});
  });

  const resetDraftSession = useEffectEvent(() => {
    clearCheckoutDraftSession();
  });

  const validateCheckoutForm = () => {
    const errors = {};
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
    } else if (!CHECKOUT_PHONE_REGEX.test(formData.phone.trim())) {
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
  const discount = cartItems.reduce((acc, item) => (
    acc + (bundleStatesByKey.get(item.cartKey)?.lineDiscount || 0)
  ), 0);

  // ── Hide "Thêm sản phẩm khác" when EVERY cart item is a combo/bundle ────────
  const hasOnlyBundles = cartItems.length > 0 &&
    cartItems.every(item => item.groupedItems?.length > 0);

  const totalAfterDiscount = Math.max(cartTotal - discount, 0);
  const isPhoneReadyForDraft = CHECKOUT_PHONE_REGEX.test(String(formData.phone || '').trim());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (isOrderSuccess || cartItems.length === 0) {
      checkoutStartedTrackedRef.current = false;
      return;
    }

    if (checkoutStartedTrackedRef.current) {
      return;
    }

    checkoutStartedTrackedRef.current = true;
    trackCheckoutStarted(cartItems, totalAfterDiscount || cartTotal);
  }, [cartItems, cartTotal, isOrderSuccess, totalAfterDiscount]);

  useEffect(() => {
    latestCheckoutStateRef.current = {
      cartItems,
      formData,
      discount,
      totalAfterDiscount,
      useNewAddress,
    };
  }, [cartItems, formData, discount, totalAfterDiscount, useNewAddress]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (checkoutCompletedRef.current || isOrderSuccess || cartItems.length === 0 || !isPhoneReadyForDraft) {
      if (draftTimerRef.current) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      return undefined;
    }

    if (draftLeadIdRef.current || draftTimerRef.current) {
      return undefined;
    }

    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      triggerDraftSave();
    }, CHECKOUT_DRAFT_DELAY_MS);

    return undefined;
  }, [cartItems.length, isOrderSuccess, isPhoneReadyForDraft]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (
      checkoutCompletedRef.current
      || isOrderSuccess
      || isSubmitting
      || !draftLeadIdRef.current
      || cartItems.length === 0
      || !isPhoneReadyForDraft
    ) {
      if (draftSyncTimerRef.current) {
        window.clearTimeout(draftSyncTimerRef.current);
        draftSyncTimerRef.current = null;
      }
      return undefined;
    }

    if (draftSyncTimerRef.current) {
      window.clearTimeout(draftSyncTimerRef.current);
    }

    draftSyncTimerRef.current = window.setTimeout(() => {
      draftSyncTimerRef.current = null;
      triggerDraftSave();
    }, CHECKOUT_DRAFT_UPDATE_DELAY_MS);

    return undefined;
  }, [cartItems, discount, formData, isOrderSuccess, isSubmitting, isPhoneReadyForDraft, totalAfterDiscount]);

  useEffect(() => () => {
    clearDraftTimers();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || isOrderSuccess || cartItems.length > 0) {
      return;
    }

    if (!draftTokenRef.current && !draftLeadIdRef.current) {
      return;
    }

    resetDraftSession();
  }, [cartItems.length, isOrderSuccess]);

  // ── Submit order ────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    
    // Validate required fields
    if (!formData.customer_name?.trim()) {
      alert('Vui lòng nhập Họ và tên người nhận.');
      return;
    }
    if (!formData.phone?.trim() || !CHECKOUT_PHONE_REGEX.test(formData.phone.trim())) {
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

    clearDraftTimers();
    setIsSubmitting(true);
    try {
      const orderData = buildCheckoutPayload();
      const response = await placeWebOrder(orderData);
      const createdAt = new Date().toISOString();
      const completedOrderNumber = response.order_number;
      const completedOrderTotal = Number(totalAfterDiscount);
      const orderTotalForTracking = Number.isFinite(completedOrderTotal)
        ? Math.max(completedOrderTotal, 0)
        : Math.max(Number(cartTotal || 0) || 0, 0);
      trackPurchase(completedOrderNumber, cartItems, orderTotalForTracking);
      setOrderNumber(completedOrderNumber);
      // Cache details for thank you page
      setSuccessOrderData({
        cartItems: [...cartItems],
        cartTotal,
        discount,
        formData: { ...formData },
        createdAt,
      });
      checkoutCompletedRef.current = true;
      setIsOrderSuccess(true);
      clearCart();
      clearCheckoutDraftSession();
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
        window.dispatchEvent(
          new CustomEvent('webgom:thank-you-download-request', {
            detail: {
              source: 'mobile-cart-confirm-fallback',
              respond: () => {},
            },
          })
        );
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
  }, [cartItems, formData, guideToCheckoutForm, handleSubmit, isOrderSuccess, isSubmitting, useNewAddress, validateCheckoutForm, cartTotal, discount, totalAfterDiscount]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.dispatchEvent(
      new CustomEvent('webgom:mobile-cart-status', {
        detail: {
          isCheckoutFormValid: isCheckoutFormReady,
          isThankYouActive: isOrderSuccess,
        },
      })
    );

    return () => {
      window.dispatchEvent(
        new CustomEvent('webgom:mobile-cart-status', {
          detail: {
            isCheckoutFormValid: false,
            isThankYouActive: false,
          },
        })
      );
    };
  }, [isCheckoutFormReady, isOrderSuccess]);

  if (isOrderSuccess) {
    return (
      <ThankYouView 
        orderNumber={orderNumber}
        formData={successOrderData?.formData || formData}
        cartItems={successOrderData?.cartItems || []}
        cartTotal={successOrderData?.cartTotal || 0}
        discount={successOrderData?.discount || 0}
        bankSettings={bankSettings}
        createdAt={successOrderData?.createdAt}
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
                <div className={styles.addressToggleRow}>
                  <label className={styles.addressToggleLabel}>
                    <input 
                      type="checkbox" 
                      checked={useNewAddress} 
                      onChange={(e) => {
                        clearFieldErrors('province', 'district', 'ward');
                        setUseNewAddress(e.target.checked);
                      }}
                      className={styles.addressToggleCheckbox}
                    />
                    Sử dụng đơn vị hành chính mới (Chỉ gồm 2 cấp: Tỉnh/Thành phố và Phường/Xã)
                  </label>
                </div>

                <div className={`${styles.threeCol} ${useNewAddress ? styles.compactAddressGrid : ''}`}>
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
                <div className={`${styles.bankInfoCard} animate-fade-in`}>
                  <h4 className={styles.bankInfoTitle}>Thông tin chuyển khoản:</h4>
                  <div className={styles.bankInfoLayout}>
                    <div className={styles.bankInfoCopy}>
                      <p className={styles.bankInfoLine}><strong>Ngân hàng:</strong> {bankSettings.bank_name}</p>
                      <p className={styles.bankInfoLine}><strong>Số tài khoản:</strong> <span className={styles.bankInfoHighlight}>{bankSettings.bank_account_number}</span></p>
                      <p className={styles.bankInfoLine}><strong>Chủ tài khoản:</strong> {bankSettings.bank_account_name}</p>
                      <p className={styles.bankInfoLine}><strong>Nội dung:</strong> <i className={styles.bankInfoTemplate}>{bankSettings.bank_transfer_template?.replace('{order_number}', 'DHXXXXX') || 'DHXXXXX'}</i></p>
                    </div>
                    {bankSettings.bank_qr_code && (
                      <div className={styles.bankInfoQr}>
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
                Tóm tắt đơn hàng 
                <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#64748b', textTransform: 'none' }}>({cartCount} sản phẩm)</span>
              </h3>

              <div className={styles.mobileCartList}>
                {cartItems.map((item) => {
                  const itemMeta = getCartItemMeta(item);
                  const imgSrc = getImageUrl(item);
                  const isBundleItem = item.groupedItems?.length > 0;
                  const bundleState = isBundleItem ? bundleStatesByKey.get(item.cartKey) : null;
                  const originalCount = bundleState?.expectedCountDisplay
                    ?? item.originalSubCount
                    ?? item.groupedItems?.length
                    ?? 0;
                  const isFullCombo = Boolean(bundleState?.isFullBundle);
                  const effectivePrice = isBundleItem
                    ? (bundleState?.currentSubtotal ?? 0)
                    : item.price;
                  const lineTotal = isBundleItem
                    ? (bundleState?.lineSubtotal ?? (effectivePrice * item.quantity))
                    : (effectivePrice * item.quantity);
                  const itemMetricLabel = isBundleItem ? 'Giá combo' : 'Đơn giá';

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
                          ) : isBundleItem ? (
                            <p className={styles.mobileMetaFallback}>Combo bộ sưu tập</p>
                          ) : null}
                        </div>
                      </div>

                      <div className={styles.mobileBundleItemFooterFull}>
                        <div className={styles.mobileBundleMetricsGrid}>
                          <div className={`${styles.mobilePriceGroup} ${styles.mobileBundleMetric} ${styles.mobileBundlePriceMetric}`}>
                            <span className={styles.mobileLabel}>{itemMetricLabel}</span>
                            <strong className={styles.mobileUnitPrice}>{formatPrice(effectivePrice)}</strong>
                          </div>

                          <div className={styles.mobileBundleQtyInline}>
                            <div className={`${styles.mobileQuantityCtrl} ${styles.mobileBundleQuantityCtrl}`}>
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

                          <div className={`${styles.mobileBundleMetric} ${styles.mobileBundleTotalMetric}`}>
                            <span className={styles.mobileLineLabel}>Thành tiền</span>
                            <strong className={styles.mobileLinePrice}>{formatPrice(lineTotal)}</strong>
                          </div>
                        </div>
                      </div>

                      {isBundleItem && (
                        <div className={styles.mobileBundleBlock}>
                          <div className={styles.mobileBundleTopRow}>
                            <div className={styles.mobileBundleSummary}>
                              <span className={styles.mobileBundleSummaryLabel}>
                                Combo {originalCount} món
                              </span>
                              <span className={styles.mobileBundleSummaryNote}>
                                Chi tiết các món nằm trong combo này
                              </span>
                            </div>
                            <span className={styles.mobileBundleTag}>
                              {getBundleStatusTag(bundleState)}
                            </span>
                          </div>

                          <div className={styles.mobileBundleList}>
                            {item.groupedItems.map((gi) => {
                              const giUid = gi.uid ?? gi.id;
                              const bundleHref = buildBundleComponentDetailHref(gi);
                              const bundleImageSrc = getBundleComponentImageUrl(gi);
                              const bundleItemName = gi.name || `Sản phẩm #${gi.id}`;
                              const bundleAnchorKey = getBundleComponentAnchorKey(item.cartKey, giUid);
                              return (
                                <div
                                  key={`${item.cartKey}-bundle-${giUid}`}
                                  className={styles.mobileBundleItem}
                                  data-bundle-component-anchor={bundleAnchorKey}
                                >
                                  <div className={styles.mobileBundleCopy}>
                                    {bundleHref ? (
                                      <Link
                                        href={bundleHref}
                                        className={styles.mobileBundleNameLink}
                                        onClick={(event) => handleBundleComponentLinkClick(event, bundleAnchorKey)}
                                      >
                                        <span className={styles.mobileBundleName}>
                                          {bundleItemName}
                                        </span>
                                      </Link>
                                    ) : (
                                      <span className={styles.mobileBundleName}>
                                        {bundleItemName}
                                      </span>
                                    )}
                                    <span className={styles.mobileBundlePrice}>
                                      {formatPrice(parseFloat(gi.price || 0))}
                                    </span>
                                  </div>

                                  <div className={styles.mobileBundleActions}>
                                    <div className={styles.mobileBundleActionStart}>
                                      {bundleHref ? (
                                        <Link
                                          href={bundleHref}
                                          className={styles.bundleThumbLink}
                                          onClick={(event) => handleBundleComponentLinkClick(event, bundleAnchorKey)}
                                          aria-label={`Xem sản phẩm ${bundleItemName}`}
                                        >
                                          <span className={`${styles.bundleThumb} ${styles.mobileBundleThumb}`}>
                                            {bundleImageSrc ? (
                                              <Image
                                                src={bundleImageSrc}
                                                alt={bundleItemName}
                                                fill
                                                sizes="32px"
                                                unoptimized
                                                style={{ objectFit: 'cover' }}
                                              />
                                            ) : (
                                              <span className={styles.bundleThumbPlaceholder} aria-hidden="true">
                                                <span className="material-symbols-outlined">image</span>
                                              </span>
                                            )}
                                          </span>
                                        </Link>
                                      ) : (
                                        <span className={`${styles.bundleThumb} ${styles.mobileBundleThumb}`} aria-hidden="true">
                                          {bundleImageSrc ? (
                                            <Image
                                              src={bundleImageSrc}
                                              alt={bundleItemName}
                                              fill
                                              sizes="32px"
                                              unoptimized
                                              style={{ objectFit: 'cover' }}
                                            />
                                          ) : (
                                            <span className={styles.bundleThumbPlaceholder}>
                                              <span className="material-symbols-outlined">image</span>
                                            </span>
                                          )}
                                        </span>
                                      )}
                                      <div className={styles.mobileSubQtyCtrl}>
                                        <button type="button" onClick={() => handleSubItemQty(item.cartKey, giUid, -1)}>−</button>
                                        <span>{gi.qty || 1}</span>
                                        <button type="button" onClick={() => handleSubItemQty(item.cartKey, giUid, 1)}>+</button>
                                      </div>
                                    </div>

                                    {canChangeBundleComponent(gi) ? (
                                      <button
                                        type="button"
                                        className={styles.mobileChildChange}
                                        onClick={() => openBundleSelectionModal(item.cartKey, gi)}
                                      >
                                        Đổi mẫu / size
                                      </button>
                                    ) : null}
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
                              <span className={styles.mobileBundleStatus}>{getBundleHintText(bundleState)}</span>
                            ) : (
                              <>
                                <span className={styles.mobileBundleStatusMuted}>
                                  {getBundleHintText(bundleState)}
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
                  const isBundleItem = item.groupedItems?.length > 0;
                  const bundleState = isBundleItem ? bundleStatesByKey.get(item.cartKey) : null;
                  const isFullCombo = Boolean(bundleState?.isFullBundle);

                  // Effective price for this cart item (dynamic for bundles)
                  const effectivePrice = isBundleItem
                    ? (bundleState?.currentSubtotal ?? 0)
                    : item.price;
                  const lineTotal = isBundleItem
                    ? (bundleState?.lineSubtotal ?? (effectivePrice * item.quantity))
                    : (effectivePrice * item.quantity);
                  const itemMetricLabel = isBundleItem ? 'Giá combo' : 'Đơn giá';

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
                          {isBundleItem ? (
                            <p className={styles.itemMeta}>Combo bộ sưu tập</p>
                          ) : null}
                        </div>
                      </div>

                      <div className={styles.itemActions}>
                        <div className={`${styles.itemMetric} ${styles.itemPriceMetric}`}>
                          <span className={styles.itemLabel}>{itemMetricLabel}</span>
                          <strong className={styles.itemUnitPrice}>{formatPrice(effectivePrice)}</strong>
                        </div>
                        <div className={styles.itemQtyInline}>
                          <div className={styles.quantityCtrl}>
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
                        <div className={`${styles.itemMetric} ${styles.itemTotalMetric}`}>
                          <span className={styles.itemLineLabel}>Thành tiền</span>
                          <strong className={styles.itemLinePrice}>{formatPrice(lineTotal)}</strong>
                        </div>
                      </div>

                      {/* Sub-items for bundle/combo with qty controls */}
                      {isBundleItem && (
                        <div className={styles.itemGroup}>
                          <span className={styles.groupLabel}>Sản phẩm trong combo</span>
                          <div className={styles.groupChildren}>
                            {item.groupedItems.map((gi) => {
                              const giUid = gi.uid ?? gi.id;
                              const bundleHref = buildBundleComponentDetailHref(gi);
                              const bundleImageSrc = getBundleComponentImageUrl(gi);
                              const bundleItemName = gi.name || `Sản phẩm #${gi.id}`;
                              const bundleAnchorKey = getBundleComponentAnchorKey(item.cartKey, giUid);
                              return (
                                <div
                                  key={giUid}
                                  className={styles.childItem}
                                  data-bundle-component-anchor={bundleAnchorKey}
                                >
                                  <div className={styles.childCopy}>
                                    {bundleHref ? (
                                      <Link
                                        href={bundleHref}
                                        className={styles.childNameLink}
                                        onClick={(event) => handleBundleComponentLinkClick(event, bundleAnchorKey)}
                                      >
                                        <span className={styles.childName}>
                                          {bundleItemName}
                                        </span>
                                      </Link>
                                    ) : (
                                      <span className={styles.childName}>
                                        {bundleItemName}
                                      </span>
                                    )}
                                    <span className={styles.childPrice}>
                                      {formatPrice(parseFloat(gi.price || 0))}
                                    </span>
                                  </div>

                                  <div className={styles.childControls}>
                                    {bundleHref ? (
                                      <Link
                                        href={bundleHref}
                                        className={styles.bundleThumbLink}
                                        onClick={(event) => handleBundleComponentLinkClick(event, bundleAnchorKey)}
                                        aria-label={`Xem sản phẩm ${bundleItemName}`}
                                      >
                                        <span className={styles.bundleThumb}>
                                          {bundleImageSrc ? (
                                            <Image
                                              src={bundleImageSrc}
                                              alt={bundleItemName}
                                              fill
                                              sizes="32px"
                                              unoptimized
                                              style={{ objectFit: 'cover' }}
                                            />
                                          ) : (
                                            <span className={styles.bundleThumbPlaceholder} aria-hidden="true">
                                              <span className="material-symbols-outlined">image</span>
                                            </span>
                                          )}
                                        </span>
                                      </Link>
                                    ) : (
                                      <span className={styles.bundleThumb} aria-hidden="true">
                                        {bundleImageSrc ? (
                                          <Image
                                            src={bundleImageSrc}
                                            alt={bundleItemName}
                                            fill
                                            sizes="32px"
                                            unoptimized
                                            style={{ objectFit: 'cover' }}
                                          />
                                        ) : (
                                          <span className={styles.bundleThumbPlaceholder}>
                                            <span className="material-symbols-outlined">image</span>
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    <div className={styles.subQtyCtrl}>
                                      <button onClick={() => handleSubItemQty(item.cartKey, giUid, -1)}>−</button>
                                      <span>{gi.qty || 1}</span>
                                      <button onClick={() => handleSubItemQty(item.cartKey, giUid, 1)}>+</button>
                                    </div>
                                    {canChangeBundleComponent(gi) ? (
                                      <button
                                        type="button"
                                        className={styles.childChange}
                                        onClick={() => openBundleSelectionModal(item.cartKey, gi)}
                                      >
                                        Đổi mẫu / size
                                      </button>
                                    ) : null}
                                    <button
                                      className={styles.childRemove}
                                      onClick={() => handleRemoveSubItem(item.cartKey, giUid)}
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Combo status & restore — separated below the list */}
                          <div className={styles.comboFooter}>
                            {isFullCombo ? (
                              <div className={styles.comboTag} style={{ color: '#2E7D32' }}>
                                {getBundleHintText(bundleState)}
                              </div>
                            ) : (
                              <>
                                <div className={styles.comboTag} style={{ color: '#94A3B8' }}>
                                  {getBundleHintText(bundleState)}
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
                  Thêm sản phẩm khác
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

      <ComponentSelectionModal
        isOpen={Boolean(activeBundleSelection?.slot)}
        onClose={closeBundleSelectionModal}
        onSelect={handleSelectBundleComponent}
        currentSlot={activeBundleSelection?.slot}
        getImageUrl={getImageUrl}
        formatPrice={formatPrice}
        allowSearch={false}
        mobilePresentation="sheet"
        title="Đổi mẫu / size"
        subtitlePrefix="Đang chỉnh:"
      />

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
