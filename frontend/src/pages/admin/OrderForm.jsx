import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api, { cmsApi, orderApi, productApi, attributeApi, orderStatusApi, quoteTemplateApi, leadApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { motion, Reorder, AnimatePresence } from 'framer-motion';
import SearchableSelect from '../../components/SearchableSelect';
import { VN_REGIONS } from '../../data/regions';
import {
    buildRegionPath,
    buildShippingAddress,
    extractCustomerInfoFromText,
    extractAddressDetail,
    parseAdministrativeAddress,
    sortRegionObjects,
    sortRegionStrings,
    validateVietnamesePhone
} from '../../utils/administrativeUnits';

const AdminSection = ({ icon, title, children, className = '', bodyClassName = '' }) => (
    <section className={`bg-white border border-primary/10 shadow-sm rounded-sm overflow-hidden ${className}`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.02]">
            <span className="material-symbols-outlined text-[18px] text-primary/50">{icon}</span>
            <h3 className="text-[13px] font-black uppercase tracking-[0.1em] text-primary">{title}</h3>
        </div>
        <div className={`p-4 space-y-[10px] ${bodyClassName}`}>{children}</div>
    </section>
);

const AdminField = ({ label, children, required = false, className = '' }) => (
    <div className={`space-y-1 ${className}`}>
        <label className="block text-[11px] font-bold uppercase tracking-widest text-primary/70">
            {label}
            {required && <span className="text-brick"> *</span>}
        </label>
        {children}
    </div>
);

const Field = ({ label, children, className = '' }) => (
    React.Children.toArray(children).some((child) => React.isValidElement(child) && child.props?.readOnly && child.props?.name === 'shipping_address')
        ? null
        : (
            <div className={`space-y-1 ${className}`}>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-primary/70">{label}</label>
                {children}
            </div>
        )
);

const adminInputClassName = 'w-full h-10 bg-primary/5 border border-primary/10 px-3 rounded-sm text-[14px] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all';
const adminTextareaClassName = 'w-full min-h-[88px] bg-primary/5 border border-primary/10 px-3 py-2 rounded-sm text-[14px] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all resize-none';
const adminRegionFieldClassName = 'group relative min-w-0 min-h-[42px] rounded-sm border border-primary/10 bg-primary/5 px-2 py-1 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-white flex flex-col justify-center';
const adminRegionLabelClassName = 'mb-1 block text-[8px] font-bold uppercase tracking-widest leading-none text-slate-400 transition-colors pointer-events-none group-focus-within:text-primary';
const adminRegionClearButtonClassName = 'absolute right-1.5 top-1.5 z-[5] size-4 rounded-full border border-primary/10 bg-white/90 text-primary/35 hover:text-brick hover:border-brick/20 transition-all flex items-center justify-center shadow-sm';
const defaultQuoteSettings = {
    quote_logo_url: '',
    quote_store_name: '',
    quote_store_address: '',
    quote_store_phone: ''
};
const productSearchHistoryStorageKey = 'order_form_product_search_history';
const productQuickFilterAttributeStorageKey = 'order_form_product_quick_filter_attribute_id';
const supportedProductQuickFilterTypes = new Set(['select', 'multiselect']);
const quoteCurrencyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const quoteCanvasFontFamily = '"Tahoma", "Arial", sans-serif';

const normalizeCanvasText = (value) => String(value ?? '').normalize('NFC').trim();
const normalizeProductSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const compactProductSearchText = (value) => normalizeProductSearchText(value).replace(/\s+/g, '');
const tokenizeProductSearch = (value) => Array.from(new Set(
    normalizeProductSearchText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
)).slice(0, 6);
const getStoredProductSearchHistory = () => {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(productSearchHistoryStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === 'string' && item.trim() !== '').slice(0, 8)
            : [];
    } catch (error) {
        console.error('Unable to read product search history', error);
        return [];
    }
};
const getStoredProductQuickFilterAttributeId = () => {
    if (typeof window === 'undefined') return '';

    try {
        return window.localStorage.getItem(productQuickFilterAttributeStorageKey) || '';
    } catch (error) {
        console.error('Unable to read product quick filter attribute', error);
        return '';
    }
};
const normalizeQuickFilterOptionValue = (value) => String(value ?? '').trim();
const parseProductAttributeValueList = (value) => {
    if (Array.isArray(value)) {
        return value.map(normalizeQuickFilterOptionValue).filter(Boolean);
    }

    if (typeof value !== 'string') {
        return value == null ? [] : [normalizeQuickFilterOptionValue(value)].filter(Boolean);
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) return [];

    if ((trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) || (trimmedValue.startsWith('{') && trimmedValue.endsWith('}'))) {
        try {
            const parsed = JSON.parse(trimmedValue);
            if (Array.isArray(parsed)) {
                return parsed.map(normalizeQuickFilterOptionValue).filter(Boolean);
            }

            if (parsed && typeof parsed === 'object') {
                return Object.values(parsed).map(normalizeQuickFilterOptionValue).filter(Boolean);
            }
        } catch (error) { }
    }

    return [trimmedValue];
};
const buildProductQuickFilterAttributes = (attributes = []) => {
    const normalizedAttributes = attributes
        .filter((attribute) => supportedProductQuickFilterTypes.has(attribute?.frontend_type))
        .map((attribute) => ({
            ...attribute,
            options: (attribute.options || [])
                .map((option) => ({ ...option, value: normalizeQuickFilterOptionValue(option?.value) }))
                .filter((option) => option.value !== '')
        }))
        .filter((attribute) => attribute.options.length > 0);

    const backendPreferredAttributes = normalizedAttributes.filter(
        (attribute) => attribute.is_filterable_backend || attribute.is_filterable || attribute.is_filterable_frontend
    );

    return (backendPreferredAttributes.length > 0 ? backendPreferredAttributes : normalizedAttributes)
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'vi'));
};
const getProductAttributeDisplayValues = (product, attributeId) => {
    if (!attributeId || !product) return [];

    const productAttributeValues = Array.isArray(product?.attribute_values)
        ? product.attribute_values
        : (Array.isArray(product?.attributeValues) ? product.attributeValues : []);
    const variationAttributeValues = Array.isArray(product?.variations)
        ? product.variations.flatMap((variation) => (
            Array.isArray(variation?.attribute_values)
                ? variation.attribute_values
                : (Array.isArray(variation?.attributeValues) ? variation.attributeValues : [])
        ))
        : [];

    return Array.from(new Set(
        [...productAttributeValues, ...variationAttributeValues]
            .filter((attributeValue) => String(attributeValue?.attribute_id ?? attributeValue?.attribute?.id ?? '') === String(attributeId))
            .flatMap((attributeValue) => parseProductAttributeValueList(attributeValue?.value))
            .filter(Boolean)
    ));
};
const scoreProductSearchResult = (product, rawTerm) => {
    const query = normalizeProductSearchText(rawTerm);
    if (!query) return 1;

    const name = normalizeProductSearchText(product?.name);
    const sku = normalizeProductSearchText(product?.sku);
    const compactSku = compactProductSearchText(product?.sku);
    const compactQuery = compactProductSearchText(rawTerm);
    const tokens = tokenizeProductSearch(rawTerm);

    const phraseInName = Boolean(query) && name.includes(query);
    const phraseInSku = Boolean(query) && sku.includes(query);
    const phraseInCompactSku = Boolean(compactQuery) && compactSku.includes(compactQuery);

    const nameTokenMatches = tokens.reduce((count, token) => count + Number(name.includes(token)), 0);
    const skuTokenMatches = tokens.reduce((count, token) => {
        const compactToken = compactProductSearchText(token);
        return count + Number(sku.includes(token) || (compactToken && compactSku.includes(compactToken)));
    }, 0);
    const combinedTokenMatches = tokens.reduce((count, token) => {
        const compactToken = compactProductSearchText(token);
        return count + Number(
            name.includes(token)
            || sku.includes(token)
            || (compactToken && compactSku.includes(compactToken))
        );
    }, 0);

    const minimumRelevantMatches = tokens.length <= 1 ? 1 : Math.max(2, tokens.length - 1);
    if (!phraseInName && !phraseInSku && !phraseInCompactSku) {
        if (tokens.length === 0) return 0;
        if (combinedTokenMatches < minimumRelevantMatches) return 0;
    }

    let score = 0;

    if (sku === query || (compactQuery && compactSku === compactQuery)) score += 1500;
    if (name === query) score += 1400;
    if (phraseInSku || phraseInCompactSku) score += 880;
    if (phraseInName) score += 820;
    if (sku.startsWith(query) || (compactQuery && compactSku.startsWith(compactQuery))) score += 760;
    if (name.startsWith(query)) score += 700;

    score += combinedTokenMatches * 140;
    score += nameTokenMatches * 50;
    score += skuTokenMatches * 70;

    if (tokens.length > 1 && combinedTokenMatches === tokens.length) score += 260;
    if (tokens.length > 1 && nameTokenMatches === tokens.length) score += 120;
    if (tokens.length > 2 && combinedTokenMatches === minimumRelevantMatches) score -= 40;

    return Math.max(score, 0);
};
const formatQuoteMoney = (value) => `${quoteCurrencyFormatter.format(Number(value) || 0)} đ`;
const quoteCanvasPageWidth = 1200;

const waitForNodeImages = async (node) => {
    if (!node) return;

    const images = Array.from(node.querySelectorAll('img'));
    const imagePromises = images.map((image) => {
        if (image.complete) return Promise.resolve();

        return new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        });
    });

    await Promise.all(imagePromises);

    if (document.fonts?.ready) {
        try {
            await document.fonts.ready;
        } catch (error) {
            console.error('Font readiness check failed', error);
        }
    }
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});

const loadCanvasImage = async (src) => {
    if (!src) return null;

    try {
        const normalizedSrc = src.startsWith('data:')
            ? src
            : `${String(api.defaults.baseURL || '').replace(/\/+$/, '')}/media/proxy?url=${encodeURIComponent(src)}`;

        const response = await fetch(normalizedSrc, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error(`IMAGE_FETCH_${response.status}`);
        const blob = await response.blob();
        const dataUrl = await blobToDataUrl(blob);

        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = dataUrl;
        });
    } catch (error) {
        console.error('Failed to load canvas image', src, error);
        return null;
    }
};

const wrapCanvasText = (ctx, text, maxWidth) => {
    const normalized = normalizeCanvasText(text);
    if (!normalized) return [''];

    const paragraphs = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const lines = [];

    paragraphs.forEach((paragraph) => {
        const words = paragraph.split(/\s+/);
        let currentLine = '';

        words.forEach((word) => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(testLine).width <= maxWidth || !currentLine) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        });

        if (currentLine) lines.push(currentLine);
    });

    return lines.length ? lines : [''];
};

const drawTextLines = (ctx, lines, x, y, lineHeight, align = 'left') => {
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
        ctx.fillText(normalizeCanvasText(line), x, y + (index * lineHeight));
    });
};

const drawImageContain = (ctx, image, x, y, width, height) => {
    if (!image) return;

    const ratio = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    const drawX = x + ((width - drawWidth) / 2);
    const drawY = y + ((height - drawHeight) / 2);

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
};

const QuoteCaptureSheet = ({ captureRef, quoteSettings, template, formData, orderId, totalQuantity, subtotal }) => {
    const headerAddress = [quoteSettings.quote_store_address, quoteSettings.quote_store_phone ? `Điện thoại: ${quoteSettings.quote_store_phone}` : '']
        .filter(Boolean)
        .join('\n');
    const hasLogo = Boolean(quoteSettings.quote_logo_url);
    const sheetTitle = orderId ? `Báo giá đơn #${orderId}` : 'Báo giá sản phẩm';

    return (
        <div ref={captureRef} className="w-[1125px] bg-white text-slate-900 shadow-2xl" style={{ fontFamily: '"Times New Roman", serif' }}>
            <div className="border-[2px] border-[#2F1A14]">
                <div className="grid grid-cols-[250px_minmax(0,1fr)] min-h-[210px]">
                    <div className="border-r border-[#2F1A14] flex items-center justify-center p-6">
                        {hasLogo ? (
                            <img src={quoteSettings.quote_logo_url} alt="Logo" className="max-w-full max-h-[150px] object-contain" />
                        ) : (
                            <div className="w-full h-[150px] border border-dashed border-[#C59A6A] flex items-center justify-center text-[#C59A6A] text-[28px] font-bold tracking-[0.2em]">
                                LOGO
                            </div>
                        )}
                    </div>

                    <div className="p-6 flex flex-col justify-center text-center">
                        <div className="text-[16px] font-bold uppercase tracking-[0.06em] leading-snug">
                            {quoteSettings.quote_store_name || 'Thông tin xưởng / cửa hàng'}
                        </div>
                        <div className="mt-4 whitespace-pre-line text-[12px] leading-6">
                            {headerAddress || 'Cấu hình địa chỉ và số điện thoại trong phần Cài đặt web > Báo giá.'}
                        </div>
                        <div className="mt-4 inline-flex self-center border border-[#2F1A14] px-4 py-1 text-[12px] font-bold uppercase tracking-[0.14em]">
                            {sheetTitle}
                        </div>
                    </div>
                </div>

                <table className="w-full border-collapse table-fixed">
                    <thead>
                        <tr className="bg-[#6B0F0F] text-white">
                            <th className="w-[240px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold">Hình ảnh sản phẩm</th>
                            <th className="border border-[#2F1A14] px-3 py-3 text-[12px] font-bold">Tên sản phẩm</th>
                            <th className="w-[84px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-center">SL</th>
                            <th className="w-[150px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-right">Đơn giá</th>
                            <th className="w-[170px] border border-[#2F1A14] px-3 py-3 text-[12px] font-bold text-right">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        {formData.items.map((item, index) => (
                            <tr key={`${template?.id || 'template'}-${item.product_id}-${index}`} className="align-top">
                                {index === 0 && (
                                    <td rowSpan={formData.items.length} className="border border-[#2F1A14] bg-[#8E0B0B] p-4 align-middle">
                                        <div className="flex h-full flex-col items-center justify-between text-white">
                                            <div className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em]">
                                                <span>{quoteSettings.quote_store_name || 'Báo giá'}</span>
                                                <span>{template?.name || 'Mẫu'}</span>
                                            </div>
                                            <div className="mt-4 flex-1 w-full bg-white/10 border border-white/15 p-3">
                                                {template?.image_url ? (
                                                    <img src={template.image_url} alt={template.name} className="h-[220px] w-full object-contain" />
                                                ) : (
                                                    <div className="h-[220px] w-full border border-dashed border-white/30 flex items-center justify-center text-[12px] uppercase tracking-[0.16em]">
                                                        Chưa có ảnh mẫu
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                )}
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] leading-6">{item.name}</td>
                                <td className="border border-[#D5CEC9] px-2 py-3 text-[12px] text-center font-semibold">{item.quantity}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] text-right">{formatQuoteMoney(item.price)}</td>
                                <td className="border border-[#D5CEC9] px-4 py-3 text-[12px] text-right font-semibold">{formatQuoteMoney(item.price * item.quantity)}</td>
                            </tr>
                        ))}
                        <tr className="bg-[#F5E7BF]">
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold uppercase">Tổng món</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold text-center">{totalQuantity}</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[12px] font-bold text-center" colSpan={2}>Tổng tiền</td>
                            <td className="border border-[#2F1A14] px-4 py-3 text-[13px] font-bold text-right">{formatQuoteMoney(subtotal)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ProductSearchOption = ({ product, onSelect, quickFilterAttribute = null }) => {
    const skuRef = useRef(null);
    const nameRef = useRef(null);
    const [hasTruncation, setHasTruncation] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const quickFilterValues = useMemo(
        () => getProductAttributeDisplayValues(product, quickFilterAttribute?.id),
        [product, quickFilterAttribute]
    );

    const checkTruncation = useCallback(() => {
        const skuTruncated = skuRef.current && skuRef.current.scrollWidth > skuRef.current.clientWidth + 1;
        const nameTruncated = nameRef.current && nameRef.current.scrollWidth > nameRef.current.clientWidth + 1;
        return Boolean(skuTruncated || nameTruncated);
    }, []);

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setHasTruncation(checkTruncation());
        });

        const handleResize = () => {
            setHasTruncation(checkTruncation());
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [checkTruncation, product.name, product.sku]);

    const handleMouseEnter = () => {
        setHasTruncation(checkTruncation());
        setIsHovered(true);
    };

    return (
        <button
            type="button"
            onClick={() => onSelect(product.id)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setIsHovered(false)}
            className="w-full px-3 py-2.5 text-left hover:bg-primary/5 border-b border-primary/5 flex items-center gap-3 transition-colors group relative overflow-visible"
        >
            <div className="size-8 bg-primary/5 rounded-sm flex items-center justify-center text-primary/10 overflow-hidden shrink-0">
                {product.main_image ? <img src={product.main_image} alt="" className="size-full object-cover" /> : <span className="material-symbols-outlined text-sm">image</span>}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5 gap-3">
                    <span ref={skuRef} className="text-[13px] font-bold text-primary truncate tracking-tight">{product.sku || '---'}</span>
                    <span className="text-[14px] font-extrabold text-blue-600 shrink-0 ml-4">{new Intl.NumberFormat('vi-VN').format(product.price)}₫</span>
                </div>
                <p ref={nameRef} className="text-[12px] text-primary/50 truncate font-medium">{product.name || '---'}</p>
                {quickFilterAttribute && quickFilterValues.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                        {quickFilterValues.slice(0, 2).map((value) => (
                            <span
                                key={`${product.id}-${quickFilterAttribute.id}-${value}`}
                                className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[10px] font-bold text-primary/70"
                            >
                                {value}
                            </span>
                        ))}
                        {quickFilterValues.length > 2 && (
                            <span className="text-[10px] font-bold text-primary/35">+{quickFilterValues.length - 2}</span>
                        )}
                    </div>
                )}
            </div>

            {isHovered && hasTruncation && (
                <div className="pointer-events-none absolute left-11 right-3 top-1/2 z-[120] -translate-y-1/2 rounded-sm border border-primary/10 bg-white/95 px-3 py-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] ring-1 ring-black/5 backdrop-blur-sm">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45 break-all">
                        {product.sku || '---'}
                    </div>
                    <div className="mt-1 text-[12px] font-semibold leading-5 text-[#0F172A] break-words">
                        {product.name || '---'}
                    </div>
                </div>
            )}
        </button>
    );
};

const OrderForm = () => {
    const { id } = useParams();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const duplicateFromId = queryParams.get('duplicate_from');
    const leadId = queryParams.get('lead_id');
    const returnTo = queryParams.get('return_to');
    const isEdit = !!id;
    const navigate = useNavigate();
    const { user } = useAuth();
    const { showModal } = useUI();

    const [loading, setLoading] = useState(isEdit || !!duplicateFromId);
    const [saving, setSaving] = useState(false);
    const [products, setProducts] = useState([]);
    const [attributes, setAttributes] = useState([]);
    const [orderStatuses, setOrderStatuses] = useState([]);

    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [searchHistory, setSearchHistory] = useState(() => getStoredProductSearchHistory());
    const [productQuickFilterAttributes, setProductQuickFilterAttributes] = useState([]);
    const [productQuickFilterAttributeId, setProductQuickFilterAttributeId] = useState(() => getStoredProductQuickFilterAttributeId());
    const [productQuickFilterValues, setProductQuickFilterValues] = useState([]);
    const [showColumnConfig, setShowColumnConfig] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [quoteSettings, setQuoteSettings] = useState(defaultQuoteSettings);
    const [quoteTemplates, setQuoteTemplates] = useState([]);
    const [showQuoteTemplatePicker, setShowQuoteTemplatePicker] = useState(false);
    const [quoteTemplateSearch, setQuoteTemplateSearch] = useState('');
    const [quoteCaptureTemplate, setQuoteCaptureTemplate] = useState(null);
    const [leadConversionSummary, setLeadConversionSummary] = useState(null);
    const captureRef = useRef(null);
    const quoteCaptureRef = useRef(null);
    const activeProductQuickFilterAttribute = useMemo(
        () => productQuickFilterAttributes.find((attribute) => String(attribute.id) === String(productQuickFilterAttributeId)) || null,
        [productQuickFilterAttributeId, productQuickFilterAttributes]
    );
    const normalizedProductQuickFilterValues = useMemo(
        () => Array.from(new Set(productQuickFilterValues.map(normalizeQuickFilterOptionValue).filter(Boolean))).slice(0, 1),
        [productQuickFilterValues]
    );
    const activeProductQuickFilterSummary = useMemo(() => {
        if (!activeProductQuickFilterAttribute || normalizedProductQuickFilterValues.length === 0) return '';

        return `${activeProductQuickFilterAttribute.name}: ${normalizedProductQuickFilterValues[0]}`;
    }, [activeProductQuickFilterAttribute, normalizedProductQuickFilterValues]);
    const hasActiveProductQuickFilter = normalizedProductQuickFilterValues.length > 0;

    const navigateBackToLead = useCallback(() => {
        if (returnTo && returnTo.startsWith('/admin/')) {
            navigate(returnTo);
            return;
        }

        if (leadId) {
            navigate('/admin/leads');
            return;
        }

        navigate('/admin/orders');
    }, [leadId, navigate, returnTo]);

    const COLUMN_DEFS = {
        stt: { label: 'STT', width: 'w-12', align: 'center' },
        sku: { label: 'Mã sản phẩm', width: 'w-40', align: 'left' },
        name: { label: 'Tên sản phẩm', width: '', align: 'left' },
        quantity: { label: 'Số lượng', width: 'w-24', align: 'center' },
        price: { label: 'Đơn giá', width: 'w-44', align: 'center' },
        cost_price: { label: 'Giá nhập', width: 'w-44', align: 'center' },
        total: { label: 'Thành tiền', width: 'w-48', align: 'right' },
        actions: { label: 'Xoá', width: 'w-12', align: 'center' }
    };

    const [columnOrder, setColumnOrder] = useState(() => {
        const saved = localStorage.getItem('order_form_column_order');
        let order = saved ? JSON.parse(saved) : ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
        if (order && !order.includes('cost_price')) order.splice(order.indexOf('price') + 1, 0, 'cost_price');
        return order;
    });
    const [visibleColumns, setVisibleColumns] = useState(() => {
        const saved = localStorage.getItem('order_form_visible_columns');
        let visible = saved ? JSON.parse(saved) : ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
        if (visible && !visible.includes('cost_price') && !localStorage.getItem('added_cost_price_migrated_form')) {
            visible.splice(visible.indexOf('price') + 1, 0, 'cost_price');
            localStorage.setItem('added_cost_price_migrated_form', 'true');
        }
        return visible;
    });
    const [columnWidths, setColumnWidths] = useState(() => {
        const saved = localStorage.getItem('order_column_widths');
        return saved ? JSON.parse(saved) : {
            stt: 50,
            sku: 150,
            name: null, // Flexible
            quantity: 90,
            price: 150,
            cost_price: 150,
            total: 170,
            actions: 60
        };
    });

    const [formData, setFormData] = useState({
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        address_detail: '',
        shipping_address: '',
        district: '',
        ward: '',
        source: 'Website',
        type: 'Lẻ',
        shipment_status: 'Chưa giao',
        notes: '',
        items: [],
        custom_attributes: {},
        shipping_fee: 0,
        discount: 0,
        cost_total: 0,
        status: 'new',
        province: ''
    });

    const [provinces, setProvinces] = useState([]);
    const [districts, setDistricts] = useState([]);
    const [wards, setWards] = useState([]);
    const [regionType, setRegionType] = useState('new');
    const [addressDetection, setAddressDetection] = useState(null);
    const useNewAddress = regionType === 'new';
    const isWardsLoading = false;
    const isDistrictsLoading = false;

    useEffect(() => {
        fetchInitialData();
        if (isEdit) {
            fetchOrder(id);
        } else if (duplicateFromId) {
            fetchOrder(duplicateFromId, true);
        } else if (leadId) {
            fetchLeadDraft(leadId);
        } else {
            setLoading(false);
        }
    }, [id, duplicateFromId, leadId]);

    useEffect(() => {
        if (productQuickFilterAttributes.length === 0) {
            return;
        }

        const fallbackAttributeId = String(productQuickFilterAttributes[0]?.id || '');
        const hasCurrentAttribute = productQuickFilterAttributes.some(
            (attribute) => String(attribute.id) === String(productQuickFilterAttributeId)
        );

        if (!hasCurrentAttribute && fallbackAttributeId) {
            setProductQuickFilterAttributeId(fallbackAttributeId);
            setProductQuickFilterValues([]);
        }
    }, [productQuickFilterAttributeId, productQuickFilterAttributes]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        if (productQuickFilterAttributeId) {
            window.localStorage.setItem(productQuickFilterAttributeStorageKey, String(productQuickFilterAttributeId));
            return;
        }

        window.localStorage.removeItem(productQuickFilterAttributeStorageKey);
    }, [productQuickFilterAttributeId]);

    useEffect(() => {
        const nextProvinces = sortRegionObjects(VN_REGIONS[regionType] || []);
        setProvinces(nextProvinces);
        setDistricts([]);
        setWards([]);

        setFormData(prev => {
            const provinceExists = nextProvinces.some((province) => province.name === prev.province);
            const nextData = {
                ...prev,
                province: provinceExists ? prev.province : '',
                district: provinceExists && regionType === 'old' ? prev.district : '',
                ward: provinceExists ? prev.ward : ''
            };

            return nextData;
        });
    }, [regionType]);

    const handleProvinceChange = (e) => {
        const provinceName = e.target.value;
        const provinceData = provinces.find((province) => province.name === provinceName);

        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            province: provinceName,
            district: '',
            ward: ''
        }));

        if (regionType === 'old') {
            setDistricts(sortRegionObjects(provinceData?.districts || []));
            setWards([]);
            return;
        }

        setDistricts([]);
        setWards(sortRegionStrings(provinceData?.wards || []));
    };

    const handleDistrictChange = (e) => {
        const districtName = e.target.value;
        const districtData = districts.find((district) => district.name === districtName);

        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            district: districtName,
            ward: ''
        }));
        setWards(sortRegionStrings(districtData?.wards || []));
    };

    const handleWardChange = (e) => {
        const wardName = e.target.value;
        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({ ...prev, ward: wardName }));
    };

    const syncShippingAddress = useCallback((nextData, nextRegionType = regionType) => ({
        ...nextData,
        shipping_address: nextData.shipping_address || nextData.address_detail || ''
    }), [regionType]);

    const clearProvince = useCallback(() => {
        setAddressDetection(null);
        setDistricts([]);
        setWards([]);
        setFormData(prev => syncShippingAddress({
            ...prev,
            province: '',
            district: '',
            ward: ''
        }));
    }, [syncShippingAddress]);

    const clearDistrict = useCallback(() => {
        setAddressDetection(null);
        setWards([]);
        setFormData(prev => syncShippingAddress({
            ...prev,
            district: '',
            ward: ''
        }));
    }, [syncShippingAddress]);

    const clearWard = useCallback(() => {
        setAddressDetection(null);
        setFormData(prev => syncShippingAddress({
            ...prev,
            ward: ''
        }));
    }, [syncShippingAddress]);

    useEffect(() => {
        if (!formData.province) {
            setDistricts([]);
            setWards([]);
            return;
        }

        const provinceData = provinces.find((province) => province.name === formData.province);
        if (!provinceData) return;

        if (regionType === 'old') {
            const nextDistricts = sortRegionObjects(provinceData.districts || []);
            setDistricts(nextDistricts);
            const districtData = nextDistricts.find((district) => district.name === formData.district);
            setWards(sortRegionStrings(districtData?.wards || []));
            return;
        }

        setDistricts([]);
        setWards(sortRegionStrings(provinceData.wards || []));
    }, [formData.province, formData.district, provinces, regionType]);

    const detectAdministrativeAddress = useCallback((rawAddress) => {
        const trimmedAddress = (rawAddress || '').trim();
        if (!trimmedAddress) {
            setAddressDetection(null);
            return;
        }

        const parsed = parseAdministrativeAddress(trimmedAddress, VN_REGIONS);
        const extracted = extractCustomerInfoFromText(trimmedAddress);

        if (!parsed || parsed.confidence === 'none') {
            setAddressDetection({
                type: 'warning',
                message: 'Không tự nhận diện chắc chắn. Vui lòng kiểm tra lại đơn vị hành chính.'
            });
            setFormData(prev => ({
                ...prev,
                customer_name: extracted.customerName || prev.customer_name,
                customer_phone: extracted.customerPhone || prev.customer_phone,
                province: '',
                district: '',
                ward: '',
                shipping_address: extracted.addressText || trimmedAddress,
                address_detail: extracted.addressText || trimmedAddress
            }));
            return;
        }

        setRegionType(parsed.regionType);
        setFormData(prev => syncShippingAddress({
            ...prev,
            customer_name: parsed.customerName || prev.customer_name,
            customer_phone: parsed.customerPhone || prev.customer_phone,
            shipping_address: parsed.addressText,
            address_detail: parsed.addressDetail,
            province: parsed.province,
            district: parsed.district || '',
            ward: parsed.ward || ''
        }, parsed.regionType));
        setAddressDetection({
            type: parsed.confidence === 'exact' ? 'success' : 'warning',
            message: parsed.confidence === 'exact'
                ? 'Đã tự nhận diện địa chỉ và điền sẵn thông tin khách hàng.'
                : 'Đã tự nhận diện gần đúng. Vui lòng kiểm tra lại trước khi lưu.'
        });
    }, [syncShippingAddress]);

    const handleCancel = useCallback(() => {
        navigateBackToLead();
    }, [navigateBackToLead]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // If a global modal is showing, let it handle ESC first
                if (document.body.style.overflow === 'hidden') return;

                const active = document.activeElement;
                const isWriting = active && (
                    active.tagName === 'INPUT' ||
                    active.tagName === 'TEXTAREA' ||
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                );

                if (isWriting && !showColumnConfig && !showSearchDropdown && !showQuoteTemplatePicker) return;

                if (showColumnConfig) {
                    setShowColumnConfig(false);
                    return;
                }
                if (showSearchDropdown) {
                    setShowSearchDropdown(false);
                    setShowSearchHistory(false);
                    return;
                }
                if (showQuoteTemplatePicker) {
                    setShowQuoteTemplatePicker(false);
                    return;
                }
                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showColumnConfig, showSearchDropdown, showQuoteTemplatePicker, handleCancel]);

    const saveColumnSettings = () => {
        localStorage.setItem('order_form_column_order', JSON.stringify(columnOrder));
        localStorage.setItem('order_form_visible_columns', JSON.stringify(visibleColumns));
        localStorage.setItem('order_column_widths', JSON.stringify(columnWidths));
        setShowColumnConfig(false);
        alert('Đã lưu cấu hình bảng làm mặc định!');
    };

    const handleColumnResize = (id, e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = columnWidths[id] || (e.currentTarget.parentElement.offsetWidth);

        const onMouseMove = (moveEvent) => {
            const newWidth = Math.max(50, startWidth + (moveEvent.clientX - startX));
            setColumnWidths(prev => ({ ...prev, [id]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    // handleCancel now handles navigation directly without confirm for a faster experience

    const fetchProducts = async (term = '', filterOverrides = {}) => {
        try {
            const params = { per_page: 50 };
            if (term) params.search = term;

            const activeFilterAttributeId = filterOverrides.attributeId ?? productQuickFilterAttributeId;
            const activeFilterValues = Array.isArray(filterOverrides.values)
                ? filterOverrides.values.map(normalizeQuickFilterOptionValue).filter(Boolean)
                : normalizedProductQuickFilterValues;

            if (activeFilterAttributeId && activeFilterValues.length > 0) {
                params[`attributes[${activeFilterAttributeId}]`] = activeFilterValues.join(',');
            }

            const prodRes = await productApi.getAll(params);
            setProducts(prodRes.data.data || []);
        } catch (error) {
            console.error("Error fetching products", error);
        }
    };

    const pushSearchHistory = useCallback((term) => {
        const trimmedTerm = normalizeCanvasText(term);
        if (trimmedTerm.length < 2) return;

        setSearchHistory((prev) => {
            const next = [
                trimmedTerm,
                ...prev.filter((item) => normalizeProductSearchText(item) !== normalizeProductSearchText(trimmedTerm))
            ].slice(0, 8);

            window.localStorage.setItem(productSearchHistoryStorageKey, JSON.stringify(next));
            return next;
        });
    }, []);

    const clearSearchHistory = useCallback(() => {
        setSearchHistory([]);
        window.localStorage.removeItem(productSearchHistoryStorageKey);
    }, []);

    const handleProductQuickFilterAttributeChange = useCallback((nextAttributeId) => {
        setProductQuickFilterAttributeId(nextAttributeId);
        setProductQuickFilterValues([]);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const openProductQuickFilterPanel = useCallback((event) => {
        event?.stopPropagation?.();
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const toggleProductQuickFilterValue = useCallback((value) => {
        const normalizedValue = normalizeQuickFilterOptionValue(value);
        if (!normalizedValue) return;

        setProductQuickFilterValues((prev) => (
            prev[0] === normalizedValue ? [] : [normalizedValue]
        ));
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const clearProductQuickFilterValues = useCallback(() => {
        setProductQuickFilterValues([]);
        setShowSearchDropdown(true);
        setShowSearchHistory(false);
    }, []);

    const rankedSearchProducts = useMemo(() => {
        const availableProducts = products.filter((product) => !formData.items.some((item) => item.product_id === product.id));

        if (!searchTerm.trim()) {
            return availableProducts.slice(0, 50);
        }

        return availableProducts
            .map((product) => ({
                ...product,
                __searchScore: scoreProductSearchResult(product, searchTerm)
            }))
            .filter((product) => product.__searchScore > 0)
            .sort((left, right) => (
                right.__searchScore - left.__searchScore
                || String(left.name || '').localeCompare(String(right.name || ''), 'vi')
            ))
            .slice(0, 50);
    }, [formData.items, products, searchTerm]);

    useEffect(() => {
        const timerId = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 500);

        return () => {
            clearTimeout(timerId);
        };
    }, [searchTerm]);

    useEffect(() => {
        if (showSearchDropdown || debouncedSearchTerm.trim() !== '' || hasActiveProductQuickFilter) {
            fetchProducts(debouncedSearchTerm);
        }
    }, [
        debouncedSearchTerm,
        hasActiveProductQuickFilter,
        productQuickFilterAttributeId,
        normalizedProductQuickFilterValues,
        showSearchDropdown
    ]);

    useEffect(() => {
        if (!showSearchDropdown || debouncedSearchTerm.trim().length < 2) return;
        pushSearchHistory(debouncedSearchTerm);
    }, [debouncedSearchTerm, pushSearchHistory, showSearchDropdown]);

    const fetchInitialData = async () => {
        try {
            // Fetch statuses first and independently
            const statusRes = await orderStatusApi.getAll();
            setOrderStatuses(statusRes.data || []);
        } catch (error) {
            console.error("Error fetching order statuses", error);
        }

        const [prodRes, attrRes, productAttrRes, settingsRes, templatesRes] = await Promise.allSettled([
            productApi.getAll({ per_page: 50 }),
            attributeApi.getAll({ entity_type: 'order', active_only: true }),
            attributeApi.getAll({ entity_type: 'product', active_only: true }),
            cmsApi.settings.get(),
            quoteTemplateApi.getAll()
        ]);

        if (prodRes.status === 'fulfilled') {
            setProducts(prodRes.value.data.data || []);
        } else {
            console.error("Error fetching products", prodRes.reason);
        }

        if (attrRes.status === 'fulfilled') {
            setAttributes(attrRes.value.data || []);
        } else {
            console.error("Error fetching order attributes", attrRes.reason);
        }

        if (productAttrRes.status === 'fulfilled') {
            setProductQuickFilterAttributes(buildProductQuickFilterAttributes(productAttrRes.value.data || []));
        } else {
            setProductQuickFilterAttributes([]);
            console.error("Error fetching product quick-filter attributes", productAttrRes.reason);
        }

        if (settingsRes.status === 'fulfilled') {
            setQuoteSettings((prev) => ({ ...prev, ...(settingsRes.value.data || {}) }));
        } else {
            console.error("Error fetching quote settings", settingsRes.reason);
        }

        if (templatesRes.status === 'fulfilled') {
            setQuoteTemplates((templatesRes.value.data || []).sort((a, b) => {
                const sortA = Number(a.sort_order) || 0;
                const sortB = Number(b.sort_order) || 0;
                if (sortA !== sortB) return sortA - sortB;
                return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
            }));
        } else {
            console.error("Error fetching quote templates", templatesRes.reason);
        }
    };

    const fetchOrder = async (targetId, isDuplicating = false) => {
        try {
            setLoading(true);
            const response = await orderApi.getOne(targetId);
            const order = response.data;

            const customAttrValues = {};
            order.attribute_values?.forEach(av => {
                const code = av.attribute?.code;
                if (code) {
                    try {
                        customAttrValues[code] = JSON.parse(av.value);
                    } catch (e) {
                        customAttrValues[code] = av.value;
                    }
                }
            });

            setRegionType(order.district ? 'old' : 'new');
            setFormData({
                customer_name: order.customer_name || '',
                customer_email: order.customer_email || '',
                customer_phone: order.customer_phone || '',
                address_detail: extractAddressDetail({
                    shippingAddress: order.shipping_address || '',
                    province: order.province || '',
                    district: order.district || '',
                    ward: order.ward || '',
                    regionType: order.district ? 'old' : 'new'
                }),
                shipping_address: order.shipping_address || '',
                notes: order.notes || '',
                items: order.items?.map(item => ({
                    product_id: item.product_id,
                    name: item.product?.name || item.product_name_snapshot || `Sản phẩm #${item.product_id}`,
                    sku: item.product?.sku || item.product_sku_snapshot || `N/A`,
                    quantity: item.quantity,
                    price: item.price,
                    cost_price: item.cost_price || item.product?.cost_price || 0
                })) || [],
                custom_attributes: customAttrValues,
                shipping_fee: order.shipping_fee || 0,
                discount: order.discount || 0,
                cost_total: order.cost_total || 0,
                status: isDuplicating ? 'new' : (order.status || 'new'),
                source: order.source || 'Website',
                type: order.type || 'Lẻ',
                shipment_status: isDuplicating ? 'Chưa giao' : (order.shipment_status || 'Chưa giao'),
                province: order.province || '',
                district: order.district || '',
                ward: order.ward || ''
            });
            setRegionType(order.district ? 'old' : 'new');

        } catch (error) {
            console.error("Error fetching order", error);
            if (error.response?.status === 404) {
                showModal({ title: 'Lỗi', content: 'Đơn hàng không tồn tại hoặc đã bị xóa.', type: 'error' });
            } else {
                showModal({ title: 'Lỗi', content: 'Không thể tải thông tin đơn hàng.', type: 'error' });
            }
            navigate('/admin/orders');
        } finally {
            setLoading(false);
        }
    };

    const fetchLeadDraft = async (targetLeadId) => {
        try {
            setLoading(true);
            const response = await leadApi.getOrderDraft(targetLeadId);
            const draft = response.data || {};

            if (draft.can_create_order === false) {
                showModal({
                    title: 'Không thể mở lead',
                    content: 'Lead này đã ở trạng thái Đã tạo đơn nên không mở lại form tạo đơn.',
                    type: 'warning'
                });
                navigateBackToLead();
                return;
            }

            setLeadConversionSummary(draft.conversion_summary || null);
            const draftItems = (draft.items || []).map((item) => ({
                product_id: item.product_id,
                name: item.name || item.product_name || `Sản phẩm #${item.product_id}`,
                sku: item.sku || item.product_sku || 'N/A',
                quantity: Number(item.quantity) || 1,
                price: Number(item.price) || 0,
                cost_price: Number(item.cost_price) || 0,
                options: item.options || {}
            }));
            const draftCostTotal = draftItems.reduce((sum, item) => sum + (Number(item.cost_price || 0) * Number(item.quantity || 0)), 0);

            setFormData((prev) => syncShippingAddress({
                ...prev,
                customer_name: draft.customer_name || '',
                customer_email: draft.customer_email || '',
                customer_phone: draft.customer_phone || '',
                address_detail: extractAddressDetail({
                    shippingAddress: draft.shipping_address || '',
                    province: draft.province || '',
                    district: draft.district || '',
                    ward: draft.ward || '',
                    regionType: draft.district ? 'old' : 'new'
                }),
                shipping_address: draft.shipping_address || '',
                district: draft.district || '',
                ward: draft.ward || '',
                province: draft.province || '',
                source: draft.source || 'Website',
                type: draft.type || 'Lẻ',
                shipment_status: draft.shipment_status || 'Chưa giao',
                notes: draft.notes || '',
                items: draftItems,
                custom_attributes: draft.custom_attributes || {},
                shipping_fee: Number(draft.shipping_fee) || 0,
                discount: Number(draft.discount) || 0,
                cost_total: draftCostTotal,
                status: draft.status || 'new'
            }));
            setRegionType(draft.district ? 'old' : 'new');
        } catch (error) {
            console.error('Error fetching lead draft', error);
            showModal({
                title: 'Lỗi',
                content: 'Không thể tải dữ liệu lead để tạo đơn.',
                type: 'error'
            });
            navigateBackToLead();
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'address_detail') {
            setAddressDetection(null);
            setFormData(prev => syncShippingAddress({ ...prev, address_detail: value }));
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleShippingAddressChange = (e) => {
        const value = e.target.value;
        setAddressDetection(null);
        setFormData(prev => ({
            ...prev,
            shipping_address: value,
            address_detail: value
        }));
    };

    const handleShippingAddressPaste = (e) => {
        const pastedText = e.clipboardData.getData('text');
        if (!pastedText) return;

        e.preventDefault();
        detectAdministrativeAddress(pastedText);
    };

    const handleShippingAddressBlur = (e) => {
        detectAdministrativeAddress(e.target.value);
    };


    const addProductById = (productId) => {
        if (!productId) return;
        const product = products.find(p => p.id === parseInt(productId));
        if (!product) return;

        if (formData.items.some(item => item.product_id === product.id)) return;
        if (searchTerm.trim()) pushSearchHistory(searchTerm);

        const newItems = [...formData.items, {
            product_id: product.id,
            name: product.name,
            sku: product.sku,
            quantity: 1,
            price: product.price,
            cost_price: product.cost_price || 0
        }];

        const costTotal = newItems.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);

        setFormData(prev => ({
            ...prev,
            items: newItems,
            cost_total: costTotal
        }));
        setShowSearchHistory(false);
        // Keep search term and dropdown open for consecutive selections
    };

    const updateItem = React.useCallback((index, field, value) => {
        setFormData(prev => {
            const newItems = [...prev.items];
            newItems[index] = { ...newItems[index], [field]: value };
            const costTotal = newItems.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, []);

    const removeItem = React.useCallback((id) => {
        setFormData(prev => {
            const newItems = prev.items.filter(item => item.product_id !== id);
            const costTotal = newItems.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
            return {
                ...prev,
                items: newItems,
                cost_total: costTotal
            };
        });
    }, []);

    const calculateSubtotal = () => {
        return formData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    };

    const calculateTotal = () => {
        return calculateSubtotal() + Number(formData.shipping_fee) - Number(formData.discount);
    };

    const captureQuoteImage = async (template) => {
        if (!template) return;

        setIsCapturing(true);
        setShowQuoteTemplatePicker(false);

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('CANVAS_CONTEXT_UNAVAILABLE');

            const pageWidth = quoteCanvasPageWidth;
            const headerHeight = 248;
            const tableHeaderHeight = 52;
            const footerHeight = 56;
            const imageColWidth = 260;
            const qtyColWidth = 92;
            const priceColWidth = 170;
            const totalColWidth = 180;
            const nameColWidth = pageWidth - imageColWidth - qtyColWidth - priceColWidth - totalColWidth;
            const bodyStartY = headerHeight + tableHeaderHeight;
            const borderColor = '#D7C7B8';
            const borderStrong = '#B79D86';
            const textPrimary = '#1F2937';
            const textMuted = '#7C6A58';
            const brandDark = '#243447';
            const brandGold = '#C8A56A';
            const headerBg = '#FCF8F3';
            const footerBg = '#F6E7C8';
            const imagePanelBg = '#F9F5EF';
            const subtleBg = '#F8F4EE';

            const measureCanvas = document.createElement('canvas');
            const measureCtx = measureCanvas.getContext('2d');
            if (!measureCtx) throw new Error('MEASURE_CONTEXT_UNAVAILABLE');
            measureCtx.font = `15px ${quoteCanvasFontFamily}`;

            const rowHeights = formData.items.map((item) => {
                const lines = wrapCanvasText(measureCtx, item.name || '', nameColWidth - 30);
                return Math.max(48, (lines.length * 18) + 16);
            });

            const itemsHeight = rowHeights.reduce((sum, height) => sum + height, 0);
            const pageHeight = headerHeight + tableHeaderHeight + itemsHeight + footerHeight;

            canvas.width = pageWidth * 2;
            canvas.height = pageHeight * 2;
            canvas.style.width = `${pageWidth}px`;
            canvas.style.height = `${pageHeight}px`;
            ctx.scale(2, 2);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageWidth, pageHeight);

            const [logoImage, templateImage] = await Promise.all([
                loadCanvasImage(quoteSettings.quote_logo_url),
                loadCanvasImage(template.image_url)
            ]);

            ctx.direction = 'ltr';
            ctx.fillStyle = headerBg;
            ctx.fillRect(0, 0, pageWidth, headerHeight);
            ctx.fillStyle = brandDark;
            ctx.fillRect(0, 0, pageWidth, 18);
            ctx.fillStyle = brandGold;
            ctx.fillRect(0, 18, pageWidth, 4);

            ctx.strokeStyle = borderStrong;
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, pageWidth - 1, pageHeight - 1);

            const logoCardX = 34;
            const logoCardY = 44;
            const logoCardSize = 176;

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#E6D7C9';
            ctx.lineWidth = 1;
            ctx.fillRect(logoCardX, logoCardY, logoCardSize, logoCardSize);
            ctx.strokeRect(logoCardX, logoCardY, logoCardSize, logoCardSize);

            if (logoImage) {
                drawImageContain(ctx, logoImage, logoCardX + 16, logoCardY + 16, logoCardSize - 32, logoCardSize - 32);
            } else {
                ctx.fillStyle = '#F8F2E8';
                ctx.beginPath();
                ctx.arc(logoCardX + (logoCardSize / 2), logoCardY + (logoCardSize / 2), 48, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = brandGold;
                ctx.font = `700 22px ${quoteCanvasFontFamily}`;
                ctx.textAlign = 'center';
                ctx.fillText('LOGO', logoCardX + (logoCardSize / 2), logoCardY + 74);
                ctx.font = `400 12px ${quoteCanvasFontFamily}`;
                ctx.fillStyle = textMuted;
                ctx.fillText(normalizeCanvasText('Cấu hình trong hệ thống'), logoCardX + (logoCardSize / 2), logoCardY + 102);
            }

            const centerColX = 246;
            const centerColWidth = 600;
            const rightCardX = 884;
            const rightCardWidth = 282;
            const quoteBadgeText = normalizeCanvasText(id ? `Báo giá đơn #${id}` : 'Báo giá sản phẩm');
            const storeName = normalizeCanvasText(quoteSettings.quote_store_name || 'Thông tin cửa hàng / xưởng');
            const addressText = normalizeCanvasText(quoteSettings.quote_store_address || 'Bổ sung địa chỉ cửa hàng trong Cài đặt web > Báo giá');
            const phoneText = normalizeCanvasText(quoteSettings.quote_store_phone || 'Chưa có số điện thoại');
            const selectedTemplateName = normalizeCanvasText(template.name || 'Chưa đặt tên mẫu');

            ctx.fillStyle = brandDark;
            ctx.font = `800 42px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('BẢNG BÁO GIÁ'), centerColX, 72);

            ctx.fillStyle = textPrimary;
            ctx.font = `700 28px ${quoteCanvasFontFamily}`;
            ctx.fillText(storeName, centerColX, 128);

            ctx.fillStyle = textMuted;
            ctx.font = `400 14px ${quoteCanvasFontFamily}`;
            const addressLines = wrapCanvasText(ctx, addressText, centerColWidth);
            drawTextLines(ctx, addressLines, centerColX, 166, 24, 'left');
            drawTextLines(ctx, [`Điện thoại: ${phoneText}`], centerColX, 166 + (addressLines.length * 24) + 8, 22, 'left');

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#D8C4AF';
            ctx.fillRect(rightCardX, 46, rightCardWidth, 156);
            ctx.strokeRect(rightCardX, 46, rightCardWidth, 156);

            ctx.fillStyle = subtleBg;
            ctx.fillRect(rightCardX + 18, 64, rightCardWidth - 36, 40);
            ctx.strokeStyle = '#E6D7C9';
            ctx.strokeRect(rightCardX + 18, 64, rightCardWidth - 36, 40);
            ctx.fillStyle = brandDark;
            ctx.font = `700 12px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText(quoteBadgeText.toUpperCase(), rightCardX + (rightCardWidth / 2), 78);

            ctx.textAlign = 'left';
            ctx.fillStyle = textMuted;
            ctx.font = `700 12px ${quoteCanvasFontFamily}`;
            ctx.fillText(normalizeCanvasText('Mẫu đã chọn'), rightCardX + 24, 126);
            ctx.fillStyle = textPrimary;
            ctx.font = `700 24px ${quoteCanvasFontFamily}`;
            ctx.fillText(selectedTemplateName, rightCardX + 24, 148);
            ctx.fillStyle = textMuted;
            ctx.font = `400 13px ${quoteCanvasFontFamily}`;
            ctx.fillText(normalizeCanvasText(`Ngày tạo: ${new Date().toLocaleDateString('vi-VN')}`), rightCardX + 24, 180);

            ctx.fillStyle = brandDark;
            ctx.fillRect(0, headerHeight, pageWidth, tableHeaderHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = `700 13px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText(normalizeCanvasText('Ảnh bộ / mẫu'), imageColWidth / 2, headerHeight + 18);
            ctx.fillText(normalizeCanvasText('Tên sản phẩm'), imageColWidth + (nameColWidth / 2), headerHeight + 18);
            ctx.fillText('SL', imageColWidth + nameColWidth + (qtyColWidth / 2), headerHeight + 18);
            ctx.fillText(normalizeCanvasText('Đơn giá'), imageColWidth + nameColWidth + qtyColWidth + (priceColWidth / 2), headerHeight + 18);
            ctx.fillText(normalizeCanvasText('Thành tiền'), imageColWidth + nameColWidth + qtyColWidth + priceColWidth + (totalColWidth / 2), headerHeight + 18);

            const xName = imageColWidth;
            const xQty = xName + nameColWidth;
            const xPrice = xQty + qtyColWidth;
            const xTotal = xPrice + priceColWidth;

            ctx.fillStyle = imagePanelBg;
            ctx.fillRect(0, bodyStartY, imageColWidth, itemsHeight);
            ctx.strokeStyle = borderStrong;
            ctx.strokeRect(0.5, bodyStartY + 0.5, imageColWidth - 1, itemsHeight - 1);

            const imageInset = 22;
            const imageBoxX = imageInset;
            const imageBoxY = bodyStartY + imageInset;
            const imageBoxWidth = imageColWidth - (imageInset * 2);
            const imageBoxHeight = itemsHeight - (imageInset * 2);

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(imageBoxX, imageBoxY, imageBoxWidth, imageBoxHeight);
            ctx.strokeStyle = '#E7D9CB';
            ctx.lineWidth = 1;
            ctx.strokeRect(imageBoxX, imageBoxY, imageBoxWidth, imageBoxHeight);

            if (templateImage) {
                drawImageContain(ctx, templateImage, imageBoxX + 10, imageBoxY + 10, imageBoxWidth - 20, imageBoxHeight - 20);
            } else {
                ctx.fillStyle = '#FBF6EE';
                ctx.fillRect(imageBoxX + 12, imageBoxY + 12, imageBoxWidth - 24, imageBoxHeight - 24);
                ctx.textAlign = 'center';
                ctx.fillStyle = brandDark;
                ctx.font = `700 18px ${quoteCanvasFontFamily}`;
                ctx.fillText(selectedTemplateName, imageBoxX + (imageBoxWidth / 2), imageBoxY + (imageBoxHeight / 2) - 14);
                ctx.fillStyle = textMuted;
                ctx.font = `400 12px ${quoteCanvasFontFamily}`;
                ctx.fillText(normalizeCanvasText('Chưa có ảnh mẫu trong hệ thống'), imageBoxX + (imageBoxWidth / 2), imageBoxY + (imageBoxHeight / 2) + 14);
            }

            let currentY = bodyStartY;
            formData.items.forEach((item, index) => {
                const rowHeight = rowHeights[index];
                const nameLines = wrapCanvasText(ctx, normalizeCanvasText(item.name || ''), nameColWidth - 30);

                ctx.fillStyle = index % 2 === 0 ? '#FFFFFF' : '#FBF8F4';
                ctx.fillRect(xName, currentY, pageWidth - xName, rowHeight);
                ctx.strokeStyle = borderColor;
                ctx.strokeRect(xName + 0.5, currentY + 0.5, nameColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xQty + 0.5, currentY + 0.5, qtyColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xPrice + 0.5, currentY + 0.5, priceColWidth - 1, rowHeight - 1);
                ctx.strokeRect(xTotal + 0.5, currentY + 0.5, totalColWidth - 1, rowHeight - 1);

                ctx.fillStyle = textPrimary;
                ctx.font = `400 15px ${quoteCanvasFontFamily}`;
                const nameBlockHeight = nameLines.length * 18;
                const nameTextY = currentY + Math.max(10, (rowHeight - nameBlockHeight) / 2);
                drawTextLines(ctx, nameLines, xName + 14, nameTextY, 18, 'left');

                const valueY = currentY + (rowHeight / 2);
                ctx.textAlign = 'center';
                ctx.font = `400 13px ${quoteCanvasFontFamily}`;
                ctx.textBaseline = 'middle';
                ctx.fillText(String(item.quantity || 0), xQty + (qtyColWidth / 2), valueY);

                ctx.textAlign = 'right';
                ctx.fillStyle = textPrimary;
                ctx.font = `400 13px ${quoteCanvasFontFamily}`;
                ctx.fillText(formatQuoteMoney(item.price), xPrice + priceColWidth - 14, valueY);
                ctx.font = `700 13px ${quoteCanvasFontFamily}`;
                ctx.fillText(formatQuoteMoney(item.price * item.quantity), xTotal + totalColWidth - 14, valueY);
                ctx.textBaseline = 'top';

                currentY += rowHeight;
            });

            ctx.fillStyle = footerBg;
            ctx.fillRect(0, bodyStartY + itemsHeight, pageWidth, footerHeight);
            ctx.strokeStyle = borderStrong;
            ctx.strokeRect(0.5, bodyStartY + itemsHeight + 0.5, pageWidth - 1, footerHeight - 1);
            [imageColWidth, xQty, xPrice].forEach((x) => {
                ctx.beginPath();
                ctx.moveTo(x, bodyStartY + itemsHeight);
                ctx.lineTo(x, pageHeight);
                ctx.stroke();
            });

            ctx.fillStyle = textPrimary;
            ctx.font = `700 15px ${quoteCanvasFontFamily}`;
            ctx.textAlign = 'left';
            ctx.fillText(normalizeCanvasText('Tổng món'), 18, bodyStartY + itemsHeight + 18);
            ctx.textAlign = 'center';
            ctx.fillText(String(quoteTotalQuantity), imageColWidth + (nameColWidth / 2), bodyStartY + itemsHeight + 18);
            ctx.fillText(normalizeCanvasText('Tổng tiền'), xQty + ((qtyColWidth + priceColWidth) / 2), bodyStartY + itemsHeight + 18);
            ctx.textAlign = 'right';
            ctx.fillText(formatQuoteMoney(quoteSubtotal), pageWidth - 18, bodyStartY + itemsHeight + 18);

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));

            if (!blob) {
                throw new Error('QUOTE_CAPTURE_FAILED');
            }

            try {
                if (navigator.clipboard?.write && window.ClipboardItem) {
                    const data = [new ClipboardItem({ 'image/png': blob })];
                    await navigator.clipboard.write(data);
                }
            } catch (clipErr) {
                console.error('Clipboard copy failed:', clipErr);
            }

            const safeCustomerName = (formData.customer_name || 'khach-le')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9-_]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .toLowerCase() || 'khach-le';

            const link = document.createElement('a');
            link.download = `bao-gia-${safeCustomerName}-${Date.now()}.png`;
            link.href = URL.createObjectURL(blob);
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        } catch (err) {
            console.error('Quote capture failed', err);
            showModal({ title: 'Lỗi', content: 'Không thể tạo ảnh báo giá. Hãy thử lại.', type: 'error' });
        } finally {
            setIsCapturing(false);
        }
    };

    const handleScreenshot = async () => {
        if (formData.items.length === 0 || isCapturing) return;

        const availableTemplates = quoteTemplates.filter((template) => template.is_active !== false);

        if (availableTemplates.length === 0) {
            showModal({
                title: 'Thiếu cấu hình',
                content: 'Chưa có bộ/mẫu báo giá hoạt động. Vào Cài đặt web > Báo giá để cấu hình trước.',
                type: 'error'
            });
            return;
        }

        setQuoteTemplateSearch('');
        setShowQuoteTemplatePicker(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Validate location
        const isLocValid = regionType === 'new'
            ? (formData.province && formData.ward)
            : (formData.province && formData.district && formData.ward);

        if (!isLocValid) {
            alert(regionType === 'new' ? 'Vui lòng chọn Tỉnh/Thành phố và Phường/Xã.' : 'Vui lòng chọn đầy đủ Tỉnh, Quận và Phường.');
            return;
        }

        const normalizedAddressDetail = extractAddressDetail({
            shippingAddress: formData.shipping_address.trim(),
            ward: formData.ward,
            district: formData.district,
            province: formData.province,
            regionType
        });
        const effectiveAddressDetail = normalizedAddressDetail || formData.address_detail.trim() || formData.shipping_address.trim();

        if (!effectiveAddressDetail) {
            alert('Vui lòng nhập địa chỉ giao hàng.');
            return;
        }

        if (formData.customer_phone && !validateVietnamesePhone(formData.customer_phone)) {
            alert('Số điện thoại không hợp lệ.');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                ...formData,
                lead_id: leadId ? Number(leadId) : undefined,
                address_detail: effectiveAddressDetail,
                shipping_address: buildShippingAddress({
                    addressDetail: effectiveAddressDetail,
                    ward: formData.ward,
                    district: formData.district,
                    province: formData.province,
                    regionType
                }),
                custom_attributes: {
                    ...formData.custom_attributes,
                    region_type: regionType === 'new' ? 'Địa giới mới' : 'Địa giới cũ',
                    full_region_path: buildRegionPath({
                        ward: formData.ward,
                        district: formData.district,
                        province: formData.province,
                        regionType
                    })
                }
            };

            if (isEdit) {
                await orderApi.update(id, payload);
            } else {
                await orderApi.store(payload);
            }
            if (!isEdit && (leadId || returnTo)) {
                navigateBackToLead();
            } else {
                navigate('/admin/orders');
            }
        } catch (error) {
            console.error("Error saving order:", error);
            if (error.response?.data?.errors) {
                console.table(error.response.data.errors);
                const firstError = Object.values(error.response.data.errors)[0][0];
                alert(`Lỗi: ${firstError}`);
            } else {
                alert("Có lỗi xảy ra khi lưu đơn hàng. Vui lòng kiểm tra console để biết chi tiết.");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleAttributeChange = React.useCallback((code, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: { ...prev.custom_attributes, [code]: value }
        }));
    }, []);

    const handleReorder = React.useCallback((newItems) => {
        setFormData(prev => ({ ...prev, items: newItems }));
    }, []);

    const availableQuoteTemplates = quoteTemplates.filter((template) => template.is_active !== false);
    const normalizedQuoteTemplateSearch = normalizeCanvasText(quoteTemplateSearch).toLowerCase();
    const filteredQuoteTemplates = availableQuoteTemplates.filter((template) => (
        !normalizedQuoteTemplateSearch || normalizeCanvasText(template.name).toLowerCase().includes(normalizedQuoteTemplateSearch)
    ));
    const quoteTotalQuantity = formData.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const quoteSubtotal = calculateSubtotal();
    const leadConversionCard = leadConversionSummary ? (
        <div className="w-full rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
            <div className="mb-[10px] flex items-center gap-2.5 border-b border-primary/10 pb-3">
                <span className="material-symbols-outlined text-primary/40 text-[18px]">conversion_path</span>
                <h3 className="font-sans text-[15px] font-bold uppercase tracking-tight text-primary">Thông tin chuyển đổi</h3>
            </div>

            <div className="space-y-3 text-[13px] text-slate-700">
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Lead</span>
                    <span>{formData.custom_attributes?.lead_number || `#${leadId}`}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Tag</span>
                    <span>{leadConversionSummary.tag || 'Website'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Nguồn</span>
                    <span>{leadConversionSummary.source || leadConversionSummary.tag || 'Website'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Landing URL</span>
                    <div className="min-w-0 break-all">
                        {leadConversionSummary.landing_url ? <a href={leadConversionSummary.landing_url} target="_blank" rel="noreferrer" className="text-primary hover:text-brick">{leadConversionSummary.landing_url}</a> : <span>-</span>}
                    </div>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Trang đặt</span>
                    <div className="min-w-0 break-all">
                        {leadConversionSummary.current_url ? <a href={leadConversionSummary.current_url} target="_blank" rel="noreferrer" className="text-primary hover:text-brick">{leadConversionSummary.current_url}</a> : <span>-</span>}
                    </div>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Referrer</span>
                    <span className="break-all">{leadConversionSummary.referrer || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">UTM source</span>
                    <span>{leadConversionSummary.utm_source || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">UTM medium</span>
                    <span>{leadConversionSummary.utm_medium || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">UTM campaign</span>
                    <span>{leadConversionSummary.utm_campaign || '-'}</span>
                </div>
                <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3">
                    <span className="font-bold text-primary/55">Link sản phẩm</span>
                    <div className="min-w-0 break-all">
                        {leadConversionSummary.product_link ? <a href={leadConversionSummary.product_link} target="_blank" rel="noreferrer" className="text-primary hover:text-brick">{leadConversionSummary.product_link}</a> : <span>-</span>}
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    if (loading) return <div className="p-8 text-center italic text-primary">Đang tải dữ liệu...</div>;

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-y-auto">
            <style>{`
                @keyframes refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .animate-refresh-spin { animation: refresh-spin 0.8s linear infinite; }
                .admin-header-title { font-size: 15px !important; font-weight: 800 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.1em !important; }
                .admin-table-header { font-size: 11px !important; font-weight: 900 !important; color: #1B365D !important; text-transform: uppercase !important; letter-spacing: 0.15em !important; background-color: #F0F4F8 !important; }
                .order-form-table::-webkit-scrollbar { width: 10px; height: 10px; }
                .order-form-table::-webkit-scrollbar-track { background: #F0F4F8; }
                .order-form-table::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
            `}</style>
            <div className="flex-none bg-[#F8FAFC] pb-4 space-y-2">
                <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleCancel}
                        className="size-9 flex items-center justify-center bg-white border border-primary/10 text-primary/50 hover:text-brick hover:border-brick/20 rounded-sm shadow-sm transition-all"
                        title="Quay lại"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                    </button>
                    <div>
                        <h1 className="admin-header-title italic">
                            {isEdit ? "Chỉnh sửa đơn hàng" : "Tạo đơn hàng mới"}
                        </h1>
                        <p className="font-sans text-[12px] font-medium text-primary/40">Trang quản trị / Đơn hàng / {isEdit ? `Chi tiết #${id}` : "Thêm mới"}</p>
                    </div>
                </div>

                {/* Close/Action buttons like OrderList */}
                <div className="flex items-center gap-2">
                     <button
                        type="button"
                        onClick={handleCancel}
                        className="px-4 h-9 bg-white border border-primary/10 text-primary/60 hover:text-brick text-[12px] font-semibold rounded-sm transition-all"
                    >
                        Hủy thoát
                    </button>
                    <button
                        type="submit"
                        form="order-form"
                        disabled={saving}
                        className="bg-primary text-white px-4 h-9 rounded-sm text-[12px] font-semibold hover:bg-brick transition-all shadow-sm flex items-center gap-2"
                    >
                        <span className={`material-symbols-outlined text-base ${saving ? 'animate-spin' : ''}`}>
                            {saving ? 'progress_activity' : 'save'}
                        </span>
                        {saving ? 'Đang lưu' : 'Lưu dữ liệu'}
                    </button>
                </div>
            </div>

                <div className="hidden bg-white border border-primary/10 p-2 shadow-sm rounded-sm flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-primary/40">receipt_long</span>
                        <span className="text-[13px] font-bold text-primary">Biên tập đơn hàng</span>
                    </div>
                    <div className="flex lg:hidden items-center gap-2">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="px-3 h-9 bg-white border border-primary/10 text-primary/60 hover:text-brick text-[12px] font-semibold rounded-sm transition-all"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            form="order-form"
                            disabled={saving}
                            className="bg-primary text-white px-3 h-9 rounded-sm text-[12px] font-semibold hover:bg-brick transition-all shadow-sm flex items-center gap-2"
                        >
                            <span className={`material-symbols-outlined text-[16px] ${saving ? 'animate-spin' : ''}`}>
                                {saving ? 'progress_activity' : 'save'}
                            </span>
                            Lưu
                        </button>
                    </div>
                </div>
            </div>

            <form id="order-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-[10px] flex-1 min-h-0 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.95fr)]">
                {/* Left Section: Product Management & Custom Attributes */}
                <div className="flex flex-col gap-[10px] max-w-full min-w-0">
                    <div className="bg-white border border-primary/10 p-4 shadow-sm rounded-sm">
                        {/* Title & Product Selector Tags */}
                        <div className="flex flex-col xl:flex-row xl:items-center gap-[10px] border-b border-primary/10 pb-4">
                            <div className="relative group">
                                <span className="material-symbols-outlined text-primary/30 p-3 bg-primary/5 rounded-full">shopping_bag</span>
                                <button
                                    type="button"
                                    onClick={handleScreenshot}
                                    disabled={formData.items.length === 0 || isCapturing}
                                    className={`absolute -bottom-1 -right-1 size-6 flex items-center justify-center rounded-full shadow-lg transition-all ${isCapturing ? 'bg-primary animate-pulse' : 'bg-primary hover:bg-primary/90 text-white'} ${formData.items.length === 0 ? 'opacity-0 scale-0' : 'opacity-100 scale-100'}`}
                                    title="Chụp ảnh báo giá cho khách"
                                >
                                    <span className="material-symbols-outlined text-[14px]">{isCapturing ? 'progress_activity' : 'photo_camera'}</span>
                                </button>
                            </div>
                            <div className="flex-1 flex flex-col xl:flex-row gap-[10px] xl:items-center relative z-[100] min-w-0">
                                {/* Flexible Search Input */}
                                <div className="relative min-w-[320px] flex-1">
                                    <div className="flex items-center bg-primary/5 border border-primary/10 rounded-sm px-3 h-10 focus-within:border-primary/30 focus-within:bg-white transition-all shadow-sm">
                                        <span className="material-symbols-outlined text-[16px] text-primary/40 mr-2">search</span>
                                        <input
                                            type="text"
                                            placeholder="Gõ mã hoặc tên sản phẩm..."
                                            className="bg-transparent text-[14px] placeholder:text-primary/30 focus:outline-none flex-1 font-medium text-[#0F172A] tracking-tight"
                                            value={searchTerm}
                                            onChange={(e) => {
                                                setSearchTerm(e.target.value);
                                                setShowSearchDropdown(true);
                                                setShowSearchHistory(false);
                                            }}
                                            onFocus={() => setShowSearchDropdown(true)}
                                            onClick={() => {
                                                setShowSearchDropdown(true);
                                                setShowSearchHistory(false);
                                            }}
                                        />
                                        {searchTerm && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSearchTerm('');
                                                    setShowSearchHistory(false);
                                                }}
                                                className="text-primary/30 hover:text-brick ml-2"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowSearchDropdown(true);
                                                setShowSearchHistory((prev) => !prev);
                                            }}
                                            className="text-primary/30 hover:text-primary ml-3 border-l border-primary/10 pl-3 transition-all"
                                            title={'Hi\u1ec3n th\u1ecb l\u1ecbch s\u1eed t\u00ecm ki\u1ebfm'}
                                        >
                                            <span className="material-symbols-outlined text-[15px]">history</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (searchTerm.trim()) pushSearchHistory(searchTerm);
                                                fetchProducts(searchTerm.trim());
                                                setShowSearchDropdown(true);
                                                setShowSearchHistory(false);
                                            }}
                                            className="text-primary/30 hover:text-primary ml-3 border-l border-primary/10 pl-3 transition-all"
                                            title={'L\u00e0m m\u1edbi danh s\u00e1ch s\u1ea3n ph\u1ea9m'}
                                        >
                                            <span className="material-symbols-outlined text-xs">refresh</span>
                                        </button>
                                        {productQuickFilterAttributes.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={openProductQuickFilterPanel}
                                                className={`relative ml-3 border-l border-primary/10 pl-3 transition-all ${hasActiveProductQuickFilter ? 'text-primary' : 'text-primary/30 hover:text-primary'}`}
                                                title={'Lọc nhanh theo thuộc tính'}
                                            >
                                                <span className="material-symbols-outlined text-[15px]">tune</span>
                                                {hasActiveProductQuickFilter && (
                                                    <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full bg-primary px-1 text-center text-[9px] font-black leading-4 text-white">
                                                        {normalizedProductQuickFilterValues.length}
                                                    </span>
                                                )}
                                            </button>
                                        )}
                                    </div>

                                    {hasActiveProductQuickFilter && activeProductQuickFilterSummary && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={openProductQuickFilterPanel}
                                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/15 bg-primary/[0.03] px-2.5 py-1.5 shadow-sm transition-all hover:border-primary/30 hover:bg-white"
                                                title={'Đổi thuộc tính lọc nhanh'}
                                            >
                                                <span className="material-symbols-outlined shrink-0 text-[12px] text-primary/35">tune</span>
                                                <span className="min-w-0 truncate text-[11px] font-semibold leading-none text-primary/70">
                                                    {activeProductQuickFilterSummary}
                                                </span>
                                                <span className="material-symbols-outlined shrink-0 text-[12px] text-primary/30">swap_horiz</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={clearProductQuickFilterValues}
                                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/10 bg-white text-primary/35 shadow-sm transition-all hover:border-brick/20 hover:text-brick"
                                                title={'Xóa lọc nhanh'}
                                            >
                                                <span className="material-symbols-outlined text-[12px]">close</span>
                                            </button>
                                        </div>
                                    )}

                                    {showSearchDropdown && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl rounded-sm z-[100] max-h-[400px] overflow-auto custom-scrollbar">
                                            {productQuickFilterAttributes.length > 0 && (
                                                <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-3">
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                {'Lọc nhanh'}
                                                            </div>
                                                            <select
                                                                value={productQuickFilterAttributeId || ''}
                                                                onChange={(e) => handleProductQuickFilterAttributeChange(e.target.value)}
                                                                className="h-8 min-w-[180px] rounded-sm border border-primary/15 bg-white px-2.5 text-[12px] font-semibold text-[#0F172A] focus:outline-none focus:border-primary/30"
                                                            >
                                                                {productQuickFilterAttributes.map((attribute) => (
                                                                    <option key={attribute.id} value={attribute.id}>
                                                                        {attribute.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            {hasActiveProductQuickFilter && (
                                                                <button
                                                                    type="button"
                                                                    onClick={clearProductQuickFilterValues}
                                                                    className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35 hover:text-brick transition-colors"
                                                                >
                                                                    {'Xóa lọc'}
                                                                </button>
                                                            )}
                                                        </div>
                                                        {activeProductQuickFilterAttribute?.options?.length > 0 ? (
                                                            <div className="flex flex-wrap gap-2">
                                                                {activeProductQuickFilterAttribute.options.map((option) => {
                                                                    const isSelected = normalizedProductQuickFilterValues.includes(option.value);

                                                                    return (
                                                                        <button
                                                                            key={`${activeProductQuickFilterAttribute.id}-${option.id || option.value}`}
                                                                            type="button"
                                                                            onClick={() => toggleProductQuickFilterValue(option.value)}
                                                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all ${isSelected ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/10 bg-white text-primary/70 hover:border-primary/25 hover:bg-primary/5'}`}
                                                                        >
                                                                            <span className="material-symbols-outlined text-[12px]">{isSelected ? 'check' : 'add'}</span>
                                                                            <span>{option.value}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        ) : (
                                                            <div className="text-[11px] italic text-primary/30">
                                                                {'Thuộc tính này chưa có giá trị để lọc nhanh.'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {showSearchHistory && (
                                                <div className="border-b border-primary/10 bg-primary/[0.02] px-3 py-2">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                            {'L\u1ecbch s\u1eed t\u00ecm ki\u1ebfm'}
                                                        </div>
                                                        {searchHistory.length > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={clearSearchHistory}
                                                                className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/35 hover:text-brick transition-colors"
                                                            >
                                                                {'X\u00f3a h\u1ebft'}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {searchHistory.length > 0 ? searchHistory.map((term) => (
                                                            <button
                                                                key={term}
                                                                type="button"
                                                                onClick={() => {
                                                                    setSearchTerm(term);
                                                                    setShowSearchDropdown(true);
                                                                    setShowSearchHistory(false);
                                                                }}
                                                                className="inline-flex items-center gap-1 rounded-sm border border-primary/10 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:border-primary/25 hover:bg-primary/5 transition-all"
                                                            >
                                                                <span className="material-symbols-outlined text-[13px] text-primary/35">history</span>
                                                                <span className="max-w-[220px] truncate">{term}</span>
                                                            </button>
                                                        )) : (
                                                            <div className="py-2 text-[11px] italic text-primary/30">
                                                                {'Ch\u01b0a c\u00f3 l\u1ecbch s\u1eed t\u00ecm ki\u1ebfm.'}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {rankedSearchProducts.map((p) => (
                                                    <ProductSearchOption
                                                        key={p.id}
                                                        product={p}
                                                        onSelect={addProductById}
                                                        quickFilterAttribute={activeProductQuickFilterAttribute}
                                                    />
                                                ))}
                                            {(searchTerm.trim() !== '' || hasActiveProductQuickFilter) && rankedSearchProducts.length === 0 && (
                                                <div className="p-4 text-center italic text-primary/20 text-[11px] uppercase font-black tracking-widest">Không có kết quả khả dụng...</div>
                                            )}
                                        </div>
                                    )}
                                    {showSearchDropdown && (
                                        <div
                                            className="fixed inset-0 z-[90]"
                                            onClick={() => {
                                                setShowSearchDropdown(false);
                                                setShowSearchHistory(false);
                                            }}
                                        />
                                    )}
                                </div>

                                {/* Scrollable Product Chips - Strictly Single Row */}
                                <div className="flex-[3] flex flex-nowrap gap-2 items-center overflow-x-auto overflow-y-hidden custom-scrollbar pb-1 border border-primary/10 bg-primary/5 rounded-sm px-2 h-[42px] min-w-0">
                                    {formData.items.map((item, index) => (
                                        <div key={item.product_id} className="bg-orange-50 hover:bg-orange-100/50 px-3 py-1.5 rounded-sm border border-orange-200 flex items-center gap-2 transition-all group/chip relative shadow-sm shrink-0">
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <span className="text-[10px] text-orange-600/40 font-bold leading-none">{index + 1}.</span>
                                                <span className="text-[11px] text-orange-600 font-bold leading-none whitespace-nowrap tracking-tight">{item.sku || 'N/A'}</span>
                                            </div>
                                            <button type="button" onClick={() => removeItem(item.product_id)} className="text-orange-400 hover:text-brick transition-all leading-none transform hover:scale-125">
                                                <span className="material-symbols-outlined text-[12px]">close</span>
                                            </button>

                                            {/* Name Tooltip on Hover */}
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded shadow-xl opacity-0 group-hover/chip:opacity-100 pointer-events-none transition-all whitespace-nowrap z-[150] border border-white/10 scale-90 group-hover/chip:scale-100 origin-bottom">
                                                {item.name}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-800"></div>
                                            </div>
                                        </div>
                                    ))}
                                    {/* Small spacer to ensure last item is visible */}
                                    <div className="w-4 shrink-0 h-full"></div>
                                </div>
                            </div>
                        </div>

                             {/* Captured Area for Screenshot */}
                        <div ref={captureRef} className="bg-white mt-[10px] rounded-sm shadow-xl border border-primary/10 overflow-hidden">
                            <div className="relative min-h-[400px] overflow-auto order-form-table">
                                <table className="w-full text-left border-collapse table-fixed lg:table-auto">
                                    <thead className="admin-table-header sticky top-0 z-30 shadow-sm border-b border-primary/10">
                                        <tr>
                                            {/* Column Config Header */}
                                            <th className="w-12 border border-primary/10 bg-[#F0F4F8] shrink-0 relative text-center sticky top-0 z-30">
                                                <div className="flex items-center justify-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowColumnConfig(!showColumnConfig)}
                                                        className="size-7 flex items-center justify-center hover:bg-primary/10 rounded-full transition-colors group z-50"
                                                        title="Cấu hình cột"
                                                    >
                                                        <span className="material-symbols-outlined text-primary/30 group-hover:text-primary text-lg">settings_backup_restore</span>
                                                    </button>

                                                    <AnimatePresence>
                                                        {showColumnConfig && (
                                                            <>
                                                                <div className="fixed inset-0 z-[190]" onClick={() => setShowColumnConfig(false)} />
                                                                <motion.div
                                                                    initial={{ opacity: 0, x: -10 }}
                                                                    animate={{ opacity: 1, x: 0 }}
                                                                    exit={{ opacity: 0, x: -10 }}
                                                                    className="absolute top-10 left-0 bg-white border border-primary/10 shadow-2xl rounded-sm p-4 z-[200] w-64 normal-case text-left"
                                                                >
                                                                    <h4 className="font-sans text-sm font-bold text-primary/50 mb-4">Cấu hình cột hiển thị</h4>
                                                                    <div className="space-y-1">
                                                                        <Reorder.Group axis="y" values={columnOrder} onReorder={setColumnOrder} className="space-y-1">
                                                                            {columnOrder.map(colId => (
                                                                                 <Reorder.Item key={colId} value={colId} className="flex items-center justify-between p-2 hover:bg-primary/5 rounded-sm cursor-grab active:cursor-grabbing border border-transparent hover:border-primary/10 group transition-all">
                                                                                    <div className="flex items-center gap-3">
                                                                                        <span className="material-symbols-outlined text-[16px] text-primary/20 group-hover:text-primary/40">drag_indicator</span>
                                                                                         <span className="text-[12px] font-bold text-primary">{COLUMN_DEFS[colId].label}</span>
                                                                                    </div>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (visibleColumns.includes(colId)) {
                                                                                                setVisibleColumns(visibleColumns.filter(c => c !== colId));
                                                                                                localStorage.setItem('order_form_visible_columns', JSON.stringify(visibleColumns.filter(c => c !== colId)));
                                                                                            } else {
                                                                                                setVisibleColumns([...visibleColumns, colId]);
                                                                                                localStorage.setItem('order_form_visible_columns', JSON.stringify([...visibleColumns, colId]));
                                                                                            }
                                                                                        }}
                                                                                        className={`material-symbols-outlined text-lg ${visibleColumns.includes(colId) ? 'text-primary' : 'text-primary/10'}`}
                                                                                    >
                                                                                        {visibleColumns.includes(colId) ? 'visibility' : 'visibility_off'}
                                                                                    </button>
                                                                                </Reorder.Item>
                                                                            ))}
                                                                        </Reorder.Group>
                                                                                                            <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const defOrder = ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
                                                                                const defVisible = ['stt', 'sku', 'name', 'quantity', 'price', 'cost_price', 'total', 'actions'];
                                                                                const defWidths = { stt: 50, sku: 150, name: null, quantity: 90, price: 150, cost_price: 150, total: 170, actions: 60 };
                                                                                setColumnOrder(defOrder);
                                                                                setVisibleColumns(defVisible);
                                                                                setColumnWidths(defWidths);
                                                                            }}
                                                                            className="py-2 text-[12px] font-bold text-primary/40 hover:bg-primary/5 rounded-sm transition-all"
                                                                        >
                                                                            Mặc định
                                                                        </button>
                                                                    </div>
                                                                </motion.div>
                                                            </>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </th>
                                            {columnOrder.filter(id => visibleColumns.includes(id)).map((colId, idx) => {
                                                const def = COLUMN_DEFS[colId];
                                                const width = columnWidths[colId];
                                                return (
                                                    <th
                                                        key={colId}
                                                        className={`py-3 px-4 border border-primary/10 text-${def.align} relative group/header sticky top-0 z-30 bg-[#F0F4F8]`}
                                                        style={width ? { width: `${width}px` } : { width: 'auto' }}
                                                    >
                                                          <span className="block whitespace-nowrap text-primary font-black uppercase tracking-[0.15em]">{def.label}</span>
                                                        {/* Resize Handle */}
                                                        <div
                                                            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 z-20 transition-colors opacity-0 group-hover/header:opacity-100"
                                                            onMouseDown={(e) => handleColumnResize(colId, e)}
                                                        />
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <Reorder.Group axis="y" values={formData.items} onReorder={handleReorder} as="tbody" className="font-sans text-sm font-medium">
                                        {formData.items.map((item, index) => (
                                            <Reorder.Item
                                                key={item.product_id}
                                                value={item}
                                                as="tr"
                                                className="hover:bg-primary/[0.01] transition-colors group cursor-grab active:cursor-grabbing active:border-primary/20 bg-white"
                                            >
                                                <td className="border border-primary/10 bg-primary/5 text-center">
                                                    <span className="material-symbols-outlined text-[16px] text-primary/10 group-hover:text-primary/30 font-bold">drag_indicator</span>
                                                </td>
                                                {columnOrder.filter(id => visibleColumns.includes(id)).map(colId => {
                                                    switch (colId) {
                                                        case 'stt':
                                                            return <td key={colId} className="py-2.5 text-center text-primary/30 font-sans text-[12px] font-bold border border-primary/10">{index + 1}</td>;
                                                        case 'sku':
                                                            return (
                                                <td key={colId} className="py-2.5 px-4 border border-primary/10 relative group/cell">
                                                    <p className="font-sans text-[13px] text-primary font-bold leading-none truncate max-w-[120px]">{item.sku || '---'}</p>
                                                    {/* Tooltip */}
                                                    <div className="absolute bottom-full left-4 mb-2 bg-slate-900 text-white p-2 rounded shadow-2xl opacity-0 group-hover/cell:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap text-[11px] font-bold border border-white/10 scale-90 group-hover/cell:scale-100 origin-bottom-left">
                                                        Mã: {item.sku || 'N/A'}
                                                        <div className="absolute top-full left-2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-900"></div>
                                                    </div>
                                                </td>
                                                            );
                                                        case 'name':
                                                            return (
                                               <td key={colId} className="py-2.5 px-4 border border-primary/10 relative group/cell">
                                                    <p className="text-primary font-bold text-[13px] leading-tight truncate max-w-[300px]">{item.name}</p>
                                                    {item.options?.bundle_parent_name || item.options?.bundle_option_title ? (
                                                        <div className="mt-1 max-w-[320px] truncate text-[11px] font-semibold text-primary/55">
                                                            {item.options?.bundle_parent_name ? `Từ bundle: ${item.options.bundle_parent_name}` : 'Từ bundle'}
                                                            {item.options?.bundle_option_title ? ` - ${item.options.bundle_option_title}` : ''}
                                                        </div>
                                                    ) : null}
                                                    {/* Tooltip */}
                                                    <div className="absolute bottom-full left-4 mb-2 bg-slate-900 text-white p-3 rounded shadow-2xl opacity-0 group-hover/cell:opacity-100 pointer-events-none transition-all z-50 w-80 text-[12px] font-bold border border-white/10 scale-95 group-hover/cell:scale-100 origin-bottom-left leading-relaxed">
                                                        <div>{item.name}</div>
                                                        {item.options?.bundle_parent_name || item.options?.bundle_option_title ? (
                                                            <div className="mt-2 border-t border-white/15 pt-2 text-[11px] font-medium text-white/80">
                                                                {item.options?.bundle_parent_name ? `Bundle gốc: ${item.options.bundle_parent_name}` : 'Bundle gốc'}
                                                                {item.options?.bundle_option_title ? ` - ${item.options.bundle_option_title}` : ''}
                                                            </div>
                                                        ) : null}
                                                        <div className="absolute top-full left-4 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-900"></div>
                                                    </div>
                                                </td>
                                                            );
                                                        case 'quantity':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-3 border border-primary/10 text-center">
                                                                    <input
                                                                        type="number"
                                                                        value={item.quantity}
                                                                        onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 0)}
                                                                         className="w-16 h-8 text-center bg-blue-50/50 border-none focus:bg-white focus:ring-1 focus:ring-blue-200 focus:outline-none text-[13px] font-bold rounded-sm shadow-inner text-slate-900"
                                                                    />
                                                                </td>
                                                            );
                                                        case 'price':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-4 border border-primary/10">
                                                                    <div className="flex items-center justify-end">
                                                                        <input
                                                                            type="text"
                                                                            value={new Intl.NumberFormat('vi-VN').format(item.price)}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                                                updateItem(index, 'price', parseInt(val) || 0);
                                                                            }}
                                                                             className="w-full h-8 bg-transparent border-none text-right font-sans text-[13px] font-bold text-slate-900 border-b border-blue-100 focus:border-blue-300 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-slate-900/30 text-[11px] ml-1">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'cost_price':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-4 border border-primary/10">
                                                                    <div className="flex items-center justify-end">
                                                                        <input
                                                                            type="text"
                                                                            value={new Intl.NumberFormat('vi-VN').format(item.cost_price)}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                                                updateItem(index, 'cost_price', parseInt(val) || 0);
                                                                            }}
                                                                            className="w-full bg-transparent border-none text-right font-sans text-[13px] font-bold text-primary/30 border-b border-primary/5 focus:border-primary/10 transition-all rounded-none px-1"
                                                                        />
                                                                        <span className="font-bold text-primary text-[10px] ml-1 opacity-10">₫</span>
                                                                    </div>
                                                                </td>
                                                            );
                                                        case 'total':
                                                            return (
                                                                <td key={colId} className="py-2.5 px-6 border border-primary/10 text-right bg-blue-50/30">
                                                                    <p className="font-sans text-[13px] font-extrabold text-slate-900 tracking-tight">
                                                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(item.price * item.quantity)}<span className="text-[11px] ml-0.5 opacity-40">₫</span>
                                                                    </p>
                                                                </td>
                                                            );
                                                        case 'actions':
                                                            return (
                                                                <td key={colId} className="py-2.5 text-center border border-primary/10">
                                                                    <button type="button" onClick={() => removeItem(item.product_id)} className="text-primary/10 hover:text-brick transition-all transform hover:scale-125">
                                                                        <span className="material-symbols-outlined text-[20px]">delete_outline</span>
                                                                    </button>
                                                                </td>
                                                            );
                                                        default:
                                                            return null;
                                                    }
                                                })}
                                            </Reorder.Item>
                                        ))}
                                        {formData.items.length === 0 && (
                                            <tr>
                                                <td colSpan={visibleColumns.length + 1} className="py-16 text-center italic text-primary/30 text-[12px] font-bold border border-primary/10 bg-primary/5">Phần này để hiển thị sản phẩm đã chọn...</td>
                                            </tr>
                                        )}
                                    </Reorder.Group>
                                </table>
                            </div>

                            <div className="flex justify-end px-4 py-5 border-t border-primary/10 bg-white">
                                <div className="flex items-baseline gap-4">
                                    <span className="font-sans font-bold text-brick/60 text-[12px]">Tổng thanh toán:</span>
                                    <span className="font-sans font-black text-brick text-[32px] leading-none tracking-tighter">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(calculateTotal())}<span className="text-[16px] ml-1 opacity-40 font-bold">₫</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end p-4 border-t border-primary/10 bg-primary/[0.02]">
                            {/* Right: Totals */}
                            <div className="space-y-4 font-sans min-w-[340px]">
                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Tổng tiền sản phẩm:</span>
                                    <span className="font-bold text-blue-600 text-[16px] leading-none">
                                        {new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(calculateSubtotal())}₫
                                    </span>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Phí vận chuyển:</span>
                                    <div className="flex items-center gap-1 border-b border-blue-600/10 focus-within:border-blue-600/40 transition-colors">
                                        <input
                                            type="text"
                                            value={new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(formData.shipping_fee)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                setFormData(prev => ({ ...prev, shipping_fee: parseInt(val) || 0 }));
                                            }}
                                             className="w-24 text-right bg-transparent py-1 font-bold text-blue-600 text-[15px] focus:outline-none placeholder:text-blue-600/10"
                                         />
                                         <span className="font-bold text-blue-600 text-[15px]">₫</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/40 text-[12px]">Chiết khấu/Giảm:</span>
                                    <div className="flex items-center gap-1 border-b border-blue-600/10 focus-within:border-blue-600/40 transition-colors">
                                        <input
                                            type="text"
                                            value={new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(formData.discount)}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\./g, '').replace(/[^0-9]/g, '');
                                                setFormData(prev => ({ ...prev, discount: parseInt(val) || 0 }));
                                            }}
                                             className="w-24 text-right bg-transparent py-1 font-bold text-brick text-[15px] focus:outline-none placeholder:text-blue-600/10"
                                         />
                                         <span className="font-bold text-brick text-[15px]">₫</span>
                                    </div>
                                </div>

                                <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-blue-600/10" data-screenshot-hide="true">
                                    <span className="font-bold text-blue-600/30 text-[12px]">Tổng giá vốn nhập:</span>
                                    <div className="flex items-center gap-1 font-bold text-blue-600/50 text-sm">
                                        <span className="bg-blue-600/5 px-2 py-0.5 rounded-sm">{new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(formData.cost_total)}₫</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Section: Sidebar Metadata */}
                <div className="w-full min-w-0 max-w-full flex flex-col gap-[10px]">
                    <div className="bg-white border border-primary/10 p-4 shadow-sm rounded-sm">
                        <div className="flex items-center gap-2.5 mb-[10px] border-b border-primary/10 pb-3">
                            <span className="material-symbols-outlined text-primary/40 text-[18px]">assignment</span>
                            <h3 className="font-sans text-[15px] font-bold text-primary uppercase tracking-tight">Thông tin đơn hàng</h3>
                        </div>

                        <div className="space-y-[10px]">
                            <Field label="Trạng thái">
                            <select
                                name="status"
                                value={formData.status}
                                onChange={handleInputChange}
                                className={adminInputClassName}
                            >
                                {orderStatuses.filter(s => s.is_active || (formData.status && s.code.toLowerCase() === formData.status.toLowerCase())).map(s => (
                                    <option key={s.id} value={s.code}>{s.name || s.code}</option>
                                ))}
                                {formData.status && !orderStatuses.some(s => s.code.toLowerCase() === formData.status.toLowerCase()) && (
                                    <option value={formData.status}>{formData.status}</option>
                                )}
                            </select>
                        </Field>
                        {addressDetection && (
                            <div className={`rounded-sm border px-3 py-2 text-[12px] ${addressDetection.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                                {addressDetection.message}
                            </div>
                        )}

                        <Field label="Địa chỉ giao hàng tự động" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="shipping_address"
                                value={formData.shipping_address}
                                readOnly
                                rows="3"
                                className={`${adminTextareaClassName} bg-slate-50`}
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Nhân viên xử lý">
                            <div className={`${adminInputClassName} flex items-center text-primary/60 bg-slate-50`}>{user?.name || "Super Admin"}</div>
                        </Field>

                        <Field label="Tên khách hàng">
                            <input
                                type="text"
                                name="customer_name"
                                value={formData.customer_name}
                                onChange={handleInputChange}
                                className={adminInputClassName}
                                placeholder="..."
                            />
                        </Field>

                        <Field label="Số điện thoại">
                            <input
                                type="text"
                                name="customer_phone"
                                value={formData.customer_phone}
                                onChange={handleInputChange}
                                className={`${adminInputClassName} ${formData.customer_phone && !validateVietnamesePhone(formData.customer_phone) ? 'border-brick' : ''}`}
                                placeholder="..."
                            />
                        </Field>

                        {/* Administrative Selection */}
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] font-black text-primary/40 uppercase tracking-widest leading-none">Đơn vị hành chính</span>
                            <div 
                                className="flex items-center gap-1 cursor-pointer p-0.5 bg-primary/5 rounded-full border border-primary/10"
                                onClick={() => setRegionType(useNewAddress ? 'old' : 'new')}
                            >
                                <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all ${useNewAddress ? 'bg-primary text-white shadow-sm' : 'text-primary/40'}`}>Mới nhất</div>
                                <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase transition-all ${!useNewAddress ? 'bg-orange-600 text-white shadow-sm' : 'text-primary/40'}`}>Cũ</div>
                            </div>
                        </div>

                        <div className={`grid ${useNewAddress ? 'grid-cols-[minmax(0,1.16fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1.24fr)_minmax(0,0.96fr)_minmax(0,1.04fr)]'} gap-[10px] mb-[10px]`}>
                            <div className={adminRegionFieldClassName}>
                                <span className={adminRegionLabelClassName}>
                                    Tỉnh / Thành phố
                                </span>
                                {formData.province && (
                                    <button
                                        type="button"
                                        onClick={clearProvince}
                                        className={adminRegionClearButtonClassName}
                                        title="Xóa Tỉnh/Thành phố"
                                    >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                    </button>
                                )}
                                <SearchableSelect
                                    options={(provinces || []).map(p => p.name)}
                                    value={formData.province}
                                    name="province"
                                    onChange={handleProvinceChange}
                                    placeholder="Tỉnh..."
                                    variant="admin"
                                />
                            </div>

                            {!useNewAddress && (
                            <div className={adminRegionFieldClassName}>
                                <span className={adminRegionLabelClassName}>
                                    Quận / Huyện
                                </span>
                                {formData.district && (
                                    <button
                                        type="button"
                                        onClick={clearDistrict}
                                        className={adminRegionClearButtonClassName}
                                        title="Xóa Quận/Huyện"
                                    >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                    </button>
                                )}
                                <SearchableSelect
                                    options={districts.map(d => d.name)}
                                    value={formData.district}
                                    name="district"
                                    onChange={handleDistrictChange}
                                    placeholder={useNewAddress ? "-" : (isDistrictsLoading ? "..." : "Quận...")}
                                    disabled={useNewAddress || !formData.province || isDistrictsLoading}
                                    variant="admin"
                                />
                            </div>

                            )}
                            <div className={adminRegionFieldClassName}>
                                <span className={adminRegionLabelClassName}>
                                    Phường / Xã
                                </span>
                                {formData.ward && (
                                    <button
                                        type="button"
                                        onClick={clearWard}
                                        className={adminRegionClearButtonClassName}
                                        title="Xóa Phường/Xã"
                                    >
                                        <span className="material-symbols-outlined text-[10px] leading-none">close</span>
                                    </button>
                                )}
                                <SearchableSelect
                                    options={wards}
                                    value={formData.ward}
                                    name="ward"
                                    onChange={handleWardChange}
                                    placeholder={isWardsLoading ? "..." : "Phường..."}
                                    disabled={(!useNewAddress && !formData.district) || (useNewAddress && !formData.province) || isWardsLoading}
                                    variant="admin"
                                />
                            </div>
                        </div>

                        <Field label="Địa chỉ giao hàng (Số nhà, tên đường...)" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="shipping_address"
                                value={formData.shipping_address}
                                onChange={handleShippingAddressChange}
                                onPaste={handleShippingAddressPaste}
                                onBlur={handleShippingAddressBlur}
                                rows="3"
                                className={adminTextareaClassName}
                                placeholder="Dán hoặc nhập địa chỉ để tự nhận diện..."
                            />
                        </Field>

                        <Field label="Ghi chú đơn hàng" className="min-h-[100px] items-start pt-3">
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleInputChange}
                                rows="3"
                                className={adminTextareaClassName}
                                placeholder="..."
                            />
                        </Field>

                        <div className="pt-2 pb-2">
                            <h4 className="font-sans text-[15px] font-bold text-primary mb-6 flex items-center justify-center gap-2 uppercase tracking-[0.1em]">
                                <span className="h-px bg-primary/10 flex-1"></span>
                                Thông tin bổ sung
                                <span className="h-px bg-primary/10 flex-1"></span>
                            </h4>
                            <div className="grid grid-cols-1 gap-1">
                                {attributes.map(attr => (
                                    <Field key={attr.id} label={attr.name}>
                                        <input
                                            type="text"
                                            value={formData.custom_attributes[attr.code] || ''}
                                            onChange={(e) => handleAttributeChange(attr.code, e.target.value)}
                                            className={adminInputClassName}
                                            placeholder={`...`}
                                        />
                                    </Field>
                                ))}
                            </div>
                        </div>

                        <div className="pt-6">
                            <button
                                type="button"
                                onClick={handleCancel}
                                className="w-full bg-primary/5 text-primary/40 font-sans font-bold text-[12px] py-4 hover:bg-primary/10 transition-all border border-primary/10 rounded-sm uppercase tracking-widest"
                            >
                                Quay về danh sách
                            </button>
                        </div>
                        </div>
                    </div>

                    {leadConversionCard}
                </div>
            </form>

            <AnimatePresence>
                {showQuoteTemplatePicker && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[220] bg-slate-950/35 backdrop-blur-[1px]"
                            onClick={() => setShowQuoteTemplatePicker(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 16 }}
                            className="fixed inset-0 z-[230] flex items-center justify-center p-6"
                        >
                            <div className="w-full max-w-6xl rounded-sm border border-primary/10 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)] overflow-hidden">
                                <div className="flex items-start justify-between gap-4 border-b border-primary/10 bg-primary/[0.02] px-6 py-4">
                                    <div>
                                        <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">Chọn bộ / mẫu báo giá</h3>
                                        <p className="mt-1 text-[12px] text-primary/45">Chọn ảnh đại diện để hệ thống tạo ảnh báo giá dạng bảng cho đơn hàng hiện tại.</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setQuoteTemplateSearch('');
                                            setShowQuoteTemplatePicker(false);
                                        }}
                                        className="size-9 rounded-sm border border-primary/10 text-primary/40 hover:text-brick hover:border-brick/20 transition-all flex items-center justify-center"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                </div>

                                <div className="border-b border-primary/10 px-6 py-4 bg-white">
                                    <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                                        <div className="relative w-full lg:max-w-[360px]">
                                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-primary/35">search</span>
                                            <input
                                                type="text"
                                                value={quoteTemplateSearch}
                                                onChange={(e) => setQuoteTemplateSearch(e.target.value)}
                                                placeholder="Tìm nhanh theo tên bộ / mẫu..."
                                                className="w-full h-10 rounded-sm border border-primary/10 bg-primary/[0.02] pl-10 pr-10 text-[13px] text-primary focus:outline-none focus:border-primary/30 focus:bg-white transition-all"
                                            />
                                            {quoteTemplateSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setQuoteTemplateSearch('')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 size-7 rounded-sm text-primary/35 hover:text-brick hover:bg-primary/5 transition-all flex items-center justify-center"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 text-[12px] text-primary/45">
                                            <span className="font-semibold">{filteredQuoteTemplates.length}</span>
                                            <span>mẫu hiển thị</span>
                                            <span className="text-primary/20">/</span>
                                            <span>{availableQuoteTemplates.length} mẫu hoạt động</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="max-h-[68vh] overflow-y-auto p-6 custom-scrollbar">
                                    {filteredQuoteTemplates.length === 0 ? (
                                        <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.02] px-6 py-14 text-center">
                                            <div className="text-[13px] font-bold text-primary">Không tìm thấy mẫu phù hợp</div>
                                            <div className="mt-2 text-[12px] text-primary/45">Thử từ khóa ngắn hơn hoặc xóa bộ lọc để xem toàn bộ mẫu báo giá.</div>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                                        {filteredQuoteTemplates.map((template) => (
                                            <button
                                                key={template.id}
                                                type="button"
                                                onClick={() => captureQuoteImage(template)}
                                                className="group overflow-hidden rounded-sm border border-primary/10 bg-white text-left shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
                                            >
                                                <div className="aspect-[4/3] bg-stone-50 border-b border-primary/10 overflow-hidden">
                                                    {template.image_url ? (
                                                        <img src={template.image_url} alt={template.name} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-primary/25 uppercase tracking-[0.16em] text-[12px] font-black">
                                                            Chưa có ảnh
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="px-3 py-3">
                                                    <div className="text-[12px] font-black uppercase tracking-[0.1em] text-primary line-clamp-2 min-h-[34px]">{template.name}</div>
                                                    <div className="mt-2 flex items-center justify-between text-[10px] text-primary/45">
                                                        <span>Sẵn sàng tạo ảnh</span>
                                                        <span className="inline-flex items-center gap-1 text-primary">
                                                            Chọn mẫu
                                                            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {quoteCaptureTemplate && (
                <div className="fixed left-[-20000px] top-0 z-[-1]">
                    <QuoteCaptureSheet
                        captureRef={quoteCaptureRef}
                        quoteSettings={quoteSettings}
                        template={quoteCaptureTemplate}
                        formData={formData}
                        orderId={id}
                        totalQuantity={quoteTotalQuantity}
                        subtotal={quoteSubtotal}
                    />
                </div>
            )}
        </div>
    );
};

export default OrderForm;
