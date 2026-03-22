import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';
import { trackAddToCart } from '../../components/TrackingScripts';

const FALLBACK_IMAGE = 'https://placehold.co/800x800?text=No+Image';

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;

const normalizeImages = (entity) => {
    const images = Array.isArray(entity?.images)
        ? entity.images
            .map((image, index) => ({
                id: image.id || `${entity?.id || 'image'}-${index}`,
                url: image.url || image.path || image.image_url || entity?.main_image || FALLBACK_IMAGE,
                is_primary: Boolean(image.is_primary),
            }))
            .filter((image) => image.url)
        : [];

    if (images.length > 0) {
        return images;
    }

    const primaryUrl = entity?.primary_image?.url || entity?.primary_image?.path || entity?.main_image;
    if (primaryUrl) {
        return [{
            id: entity?.primary_image?.id || entity?.id || 0,
            url: primaryUrl,
            is_primary: true,
        }];
    }

    return [{ id: entity?.id || 0, url: FALLBACK_IMAGE, is_primary: true }];
};

const parseSpecificationLines = (rawValue) => {
    if (!rawValue || rawValue === '[]' || rawValue === '{}') {
        return [];
    }

    try {
        if (typeof rawValue === 'string' && (rawValue.trim().startsWith('[') || rawValue.trim().startsWith('{'))) {
            const parsed = JSON.parse(rawValue);

            if (Array.isArray(parsed)) {
                return parsed
                    .map((item, index) => {
                        if (typeof item === 'object' && item !== null) {
                            const label = item.label || item.name || item.key || `Thông số ${index + 1}`;
                            const value = item.value || item.content || item.text || '';
                            return value ? { label, value } : null;
                        }
                        return item ? { label: `Thông số ${index + 1}`, value: String(item) } : null;
                    })
                    .filter(Boolean);
            }

            return Object.entries(parsed)
                .map(([label, value]) => ({
                    label,
                    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                }))
                .filter((item) => item.value);
        }
    } catch (error) {
        // Keep the plain-text fallback below for free-form specifications.
    }

    return String(rawValue)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) {
                return { label: `Thông số ${index + 1}`, value: line };
            }

            return {
                label: line.slice(0, separatorIndex).trim() || `Thông số ${index + 1}`,
                value: line.slice(separatorIndex + 1).trim(),
            };
        })
        .filter((item) => item.value);
};

const getVariantLabel = (productName, variant) => {
    const attributeLabel = Array.isArray(variant?.attributes) && variant.attributes.length > 0
        ? variant.attributes.map((attribute) => attribute.value).filter(Boolean).join(' / ')
        : '';

    if (attributeLabel) {
        return attributeLabel;
    }

    const variantName = String(variant?.name || '').trim();
    const baseName = String(productName || '').trim();
    if (variantName && baseName && variantName.toLowerCase().startsWith(baseName.toLowerCase())) {
        const suffix = variantName.slice(baseName.length).replace(/^[-–—:\s]+/, '').trim();
        if (suffix) {
            return suffix;
        }
    }

    return variant?.sku || `Biến thể #${variant?.id || ''}`.trim();
};

const getAttributeOptions = (attribute, variants) => {
    const fromVariants = variants
        .map((variant) => variant.attributes?.find((item) => Number(item.id) === Number(attribute.id))?.value)
        .filter(Boolean);

    const allowedValues = new Set(fromVariants);
    const configuredOptions = Array.isArray(attribute?.options) ? attribute.options : [];
    const normalizedConfigured = configuredOptions
        .filter((option) => allowedValues.size === 0 || allowedValues.has(option.value))
        .map((option) => ({
            id: option.id || option.value,
            value: option.value,
            swatch: option.swatch,
        }));

    if (normalizedConfigured.length > 0) {
        return normalizedConfigured;
    }

    return Array.from(allowedValues).map((value) => ({
        id: value,
        value,
        swatch: null,
    }));
};

const ImageGallery = ({ images, title }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [zoomed, setZoomed] = useState(false);

    useEffect(() => {
        setActiveIndex(0);
    }, [images]);

    const gallery = images?.length ? images : [{ id: 0, url: FALLBACK_IMAGE }];

    return (
        <div className="space-y-3">
            <div
                className="relative aspect-square overflow-hidden rounded-3xl bg-stone-100 shadow-sm"
                onClick={() => setZoomed(true)}
            >
                <img
                    src={gallery[activeIndex]?.url || FALLBACK_IMAGE}
                    alt={title}
                    className="h-full w-full cursor-zoom-in object-cover"
                />
                {gallery.length > 1 ? (
                    <>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                setActiveIndex((prev) => (prev - 1 + gallery.length) % gallery.length);
                            }}
                            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-stone-700 shadow-lg transition hover:bg-white"
                        >
                            <span className="material-symbols-outlined text-xl">chevron_left</span>
                        </button>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                setActiveIndex((prev) => (prev + 1) % gallery.length);
                            }}
                            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-stone-700 shadow-lg transition hover:bg-white"
                        >
                            <span className="material-symbols-outlined text-xl">chevron_right</span>
                        </button>
                    </>
                ) : null}
            </div>

            {gallery.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {gallery.map((image, index) => (
                        <button
                            key={image.id}
                            type="button"
                            onClick={() => setActiveIndex(index)}
                            className={`h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 transition ${
                                index === activeIndex ? 'border-primary shadow-md' : 'border-transparent opacity-70 hover:opacity-100'
                            }`}
                        >
                            <img src={image.url} alt="" className="h-full w-full object-cover" />
                        </button>
                    ))}
                </div>
            ) : null}

            {zoomed ? (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={() => setZoomed(false)}>
                    <button
                        type="button"
                        onClick={() => setZoomed(false)}
                        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                    <img
                        src={gallery[activeIndex]?.url || FALLBACK_IMAGE}
                        alt={title}
                        className="max-h-[90vh] max-w-[90vw] object-contain"
                    />
                </div>
            ) : null}
        </div>
    );
};

const Stars = ({ rating }) => (
    <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
            <span
                key={star}
                className={`material-symbols-outlined text-base ${star <= Math.round(rating || 0) ? 'text-amber-500' : 'text-stone-200'}`}
            >
                star
            </span>
        ))}
    </div>
);

const BundleActionPopup = ({ optionTitle, onClose, onViewDetails, onAddToCart, onBuyNow }) => {
    if (!optionTitle) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/55 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-md rounded-[28px] border border-stone-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/70">Lựa chọn bộ</p>
                        <h3 className="mt-1 text-lg font-black text-stone-900">{optionTitle}</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition hover:bg-stone-200 hover:text-stone-700"
                    >
                        <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                </div>

                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={onViewDetails}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm font-black text-amber-800 transition hover:bg-amber-100"
                    >
                        <span className="material-symbols-outlined text-lg">tune</span>
                        Xem chi tiết và tùy chỉnh thành phần bộ
                    </button>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={onAddToCart}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg transition hover:brightness-95"
                        >
                            <span className="material-symbols-outlined text-lg">shopping_cart</span>
                            Thêm vào giỏ
                        </button>
                        <button
                            type="button"
                            onClick={onBuyNow}
                            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-primary px-4 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-primary transition hover:bg-primary/5"
                        >
                            <span className="material-symbols-outlined text-lg">bolt</span>
                            Mua ngay
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StorefrontProductDetail = () => {
    const { slugOrId } = useParams();
    const [product, setProduct] = useState(null);
    const [related, setRelated] = useState([]);
    const [loading, setLoading] = useState(true);
    const [quantity, setQuantity] = useState(1);
    const [showLeadForm, setShowLeadForm] = useState(false);
    const [activeTab, setActiveTab] = useState('description');
    const [selectedAttributes, setSelectedAttributes] = useState({});
    const [currentVariant, setCurrentVariant] = useState(null);
    const [selectedBundleOption, setSelectedBundleOption] = useState('');
    const [bundleActionOption, setBundleActionOption] = useState('');
    const bundleDetailRef = useRef(null);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setQuantity(1);
            setSelectedAttributes({});
            setCurrentVariant(null);

            try {
                const response = await api.get(`/storefront/products/${slugOrId}`);
                setProduct(response.data);

                try {
                    const relatedResponse = await api.get(`/storefront/products/${response.data.id}/related`);
                    setRelated(Array.isArray(relatedResponse.data) ? relatedResponse.data : []);
                } catch (error) {
                    setRelated([]);
                }
            } catch (error) {
                console.error('Failed to load storefront product detail', error);
                setProduct(null);
                setRelated([]);
            } finally {
                setLoading(false);
            }
        };

        load();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [slugOrId]);

    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const superAttributes = Array.isArray(product?.super_attributes) ? product.super_attributes : [];
    const bundleItems = Array.isArray(product?.bundle_items) ? product.bundle_items : [];
    const hasVariants = product?.type === 'configurable' && variants.length > 0;
    const hasSuperAttributes = hasVariants && superAttributes.length > 0;
    const bundleOptionMap = new Map();

    bundleItems.forEach((item, index) => {
        const optionTitle = String(item?.option_title || 'Tùy chọn mặc định').trim();
        const position = Number(item?.position ?? index);

        if (!bundleOptionMap.has(optionTitle)) {
            bundleOptionMap.set(optionTitle, {
                title: optionTitle,
                items: [],
                position: Number.isFinite(position) ? position : index,
                isDefault: false,
            });
        }

        const group = bundleOptionMap.get(optionTitle);
        group.items.push(item);
        group.position = Math.min(group.position, Number.isFinite(position) ? position : group.position);
        group.isDefault = group.isDefault || Boolean(item?.is_default);
    });

    const bundleOptionGroups = Array.from(bundleOptionMap.values()).sort((left, right) => left.position - right.position);
    const defaultBundleOption = bundleOptionGroups.find((group) => group.isDefault)?.title || bundleOptionGroups[0]?.title || '';
    const activeBundleOption = selectedBundleOption || defaultBundleOption;
    const activeBundleGroup = bundleOptionGroups.find((group) => group.title === activeBundleOption) || bundleOptionGroups[0] || null;
    const activeBundleItems = activeBundleGroup?.items || [];

    useEffect(() => {
        if (!hasVariants) {
            setCurrentVariant(null);
            return;
        }

        if (!hasSuperAttributes) {
            setCurrentVariant(variants[0] || null);
            return;
        }

        const isSelectionComplete = superAttributes.every((attribute) => selectedAttributes[attribute.id]);
        if (!isSelectionComplete) {
            setCurrentVariant(null);
            return;
        }

        const matchedVariant = variants.find((variant) => (
            superAttributes.every((attribute) => {
                const variantValue = variant.attributes?.find((item) => Number(item.id) === Number(attribute.id))?.value;
                return variantValue === selectedAttributes[attribute.id];
            })
        ));

        setCurrentVariant(matchedVariant || null);
    }, [hasSuperAttributes, hasVariants, selectedAttributes, superAttributes, variants]);

    useEffect(() => {
        if (product?.type !== 'bundle' || bundleOptionGroups.length === 0) {
            setSelectedBundleOption('');
            setBundleActionOption('');
            return;
        }

        setSelectedBundleOption((prev) => {
            if (prev && bundleOptionGroups.some((group) => group.title === prev)) {
                return prev;
            }

            return defaultBundleOption;
        });
        setBundleActionOption('');
    }, [defaultBundleOption, product?.id, product?.type, bundleItems.length]);

    if (loading) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-8">
                <div className="grid gap-8 md:grid-cols-2">
                    <div className="aspect-square animate-pulse rounded-3xl bg-stone-200" />
                    <div className="space-y-4">
                        <div className="h-6 w-2/3 animate-pulse rounded bg-stone-200" />
                        <div className="h-10 w-1/3 animate-pulse rounded bg-stone-200" />
                        <div className="h-40 animate-pulse rounded-3xl bg-stone-200" />
                    </div>
                </div>
            </div>
        );
    }

    if (!product) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-20 text-center">
                <span className="material-symbols-outlined mb-3 block text-6xl text-stone-300">error_outline</span>
                <p className="text-lg font-bold text-stone-700">Không tìm thấy sản phẩm</p>
                <Link to="/san-pham" className="mt-2 inline-block text-sm font-bold text-primary hover:underline">
                    ← Quay lại cửa hàng
                </Link>
            </div>
        );
    }

    const fallbackVariant = !hasSuperAttributes && hasVariants ? variants[0] : null;
    const displayVariant = currentVariant || fallbackVariant;
    const displayImages = normalizeImages(displayVariant || product);
    const rawCurrentPrice = displayVariant?.current_price ?? displayVariant?.price ?? product.current_price ?? product.price;
    const rawBasePrice = displayVariant?.price ?? product.price ?? rawCurrentPrice;
    const variantPrices = variants
        .map((variant) => Number(variant.current_price ?? variant.price ?? 0))
        .filter((price) => price > 0);
    const minVariantPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : null;
    const maxVariantPrice = variantPrices.length > 0 ? Math.max(...variantPrices) : null;
    const showPriceRange = !displayVariant && hasVariants && minVariantPrice !== null && maxVariantPrice !== null && minVariantPrice !== maxVariantPrice;
    const mustChooseVariant = hasSuperAttributes && hasVariants && !currentVariant;
    const inStock = true;
    const stockLabel = mustChooseVariant ? 'Chọn biến thể' : (inStock ? 'Sẵn sàng giao ngay' : 'Hết hàng');
    const stockClass = mustChooseVariant ? 'text-amber-600' : (inStock ? 'text-green-600' : 'text-red-500');
    const storefrontStatusLabel = 'S\u1eb5n s\u00e0ng giao ngay';
    const storefrontStatusClass = 'text-green-600';
    const buyProductId = displayVariant?.id || product.id;
    const displaySku = displayVariant?.sku || product.sku || 'N/A';
    const specificationItems = [
        ...(product.weight ? [{ label: 'Khối lượng', value: `${product.weight} gram` }] : []),
        ...(product.attributes || []).map((attribute) => ({ label: attribute.name || 'Thuộc tính', value: attribute.value })),
        ...parseSpecificationLines(product.specifications),
    ].filter((item) => item.value);

    const handleSelectAttribute = (attributeId, optionValue) => {
        setSelectedAttributes((prev) => ({
            ...prev,
            [attributeId]: optionValue,
        }));
    };

    const buildCheckoutUrl = () => {
        const search = new URLSearchParams({
            product: String(buyProductId),
            qty: String(quantity),
        });

        if (product.type === 'bundle' && activeBundleOption) {
            search.set('bundle_option', activeBundleOption);
        }

        return `/dat-hang?${search.toString()}`;
    };

    const handleOpenBundleActions = (optionTitle) => {
        setSelectedBundleOption(optionTitle);
        setBundleActionOption(optionTitle);
    };

    const handleViewBundleDetails = () => {
        setBundleActionOption('');
        bundleDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleBundleAddToCart = async () => {
        setBundleActionOption('');

        if (mustChooseVariant) {
            return;
        }

        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = buildCheckoutUrl();
            return;
        }

        try {
            await api.post('/cart/add', {
                product_id: buyProductId,
                quantity,
                options: product.type === 'bundle' && activeBundleOption
                    ? { bundle_option_title: activeBundleOption }
                    : undefined,
            });
        } catch (error) {
            console.error('Failed to add storefront bundle to cart', error);
            window.location.href = buildCheckoutUrl();
        }
    };

    const handleBuyNow = () => {
        setBundleActionOption('');

        if (mustChooseVariant) {
            return;
        }

        trackAddToCart({
            ...product,
            id: buyProductId,
            sku: displaySku,
            price: Number(rawCurrentPrice || 0),
            current_price: Number(rawCurrentPrice || 0),
        }, quantity);
        window.location.href = buildCheckoutUrl();
    };

    const handleAddToCart = () => {
        if (mustChooseVariant) {
            return;
        }

        trackAddToCart({
            ...product,
            id: buyProductId,
            sku: displaySku,
            price: Number(rawCurrentPrice || 0),
            current_price: Number(rawCurrentPrice || 0),
        }, quantity);
        window.location.href = buildCheckoutUrl();
    };

    return (
        <div className="animate-fade-in">
            <div className="border-b border-stone-100 bg-stone-50">
                <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 text-xs font-medium text-stone-500">
                    <Link to="/" className="hover:text-primary">Trang chủ</Link>
                    <span>/</span>
                    <Link to="/san-pham" className="hover:text-primary">Sản phẩm</Link>
                    {product.category ? (
                        <>
                            <span>/</span>
                            <Link to={`/danh-muc/${product.category.slug}`} className="hover:text-primary">{product.category.name}</Link>
                        </>
                    ) : null}
                    <span>/</span>
                    <span className="max-w-[220px] truncate font-bold text-stone-800">{product.name}</span>
                </div>
            </div>

            <div className="mx-auto max-w-7xl px-4 py-6 md:py-10">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
                    <ImageGallery images={displayImages} title={product.name} />

                    <div className="space-y-5">
                        {product.category ? (
                            <Link to={`/danh-muc/${product.category.slug}`} className="text-[10px] font-black uppercase tracking-[0.2em] text-primary hover:underline">
                                {product.category.name}
                            </Link>
                        ) : null}

                        <div>
                            <h1 className="text-2xl font-black uppercase tracking-tight text-stone-900 md:text-3xl">{product.name}</h1>
                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium text-stone-600 md:text-sm">
                                <span>SKU: <strong className="font-bold uppercase tracking-wider text-stone-800">{displaySku}</strong></span>
                                <span className="h-1 w-1 rounded-full bg-stone-300" />
                                <span className={`flex items-center gap-1.5 ${storefrontStatusClass}`}>
                                    <span className="h-2 w-2 rounded-full bg-current" />
                                    {storefrontStatusLabel}
                                </span>
                            </div>
                        </div>

                        {product.review_count > 0 ? (
                            <div className="flex items-center gap-2">
                                <Stars rating={product.average_rating} />
                                <span className="text-sm font-medium text-stone-500">({product.review_count} đánh giá)</span>
                            </div>
                        ) : null}

                        <div className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
                            <div className="flex flex-wrap items-end gap-3">
                                <span className="text-3xl font-black text-red-600 md:text-4xl">
                                    {showPriceRange ? `${formatCurrency(minVariantPrice)} - ${formatCurrency(maxVariantPrice)}` : formatCurrency(rawCurrentPrice)}
                                </span>
                                {!showPriceRange && Number(rawBasePrice || 0) > Number(rawCurrentPrice || 0) ? (
                                    <span className="text-lg text-stone-400 line-through">{formatCurrency(rawBasePrice)}</span>
                                ) : null}
                            </div>
                            <p className="mt-2 text-sm text-stone-500">Đã bao gồm VAT và phí bảo hiểm vận chuyển</p>
                        </div>

                        {product.type === 'bundle' && bundleOptionGroups.length > 0 ? (
                            <div className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-lg text-primary">dashboard_customize</span>
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-stone-500">Chọn cấu hình bộ</p>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-3">
                                    {bundleOptionGroups.map((group) => {
                                        const isSelected = activeBundleOption === group.title;
                                        return (
                                            <button
                                                key={group.title}
                                                type="button"
                                                onClick={() => handleOpenBundleActions(group.title)}
                                                className={`rounded-2xl border px-5 py-3 text-sm font-black transition ${
                                                    isSelected
                                                        ? 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm'
                                                        : 'border-stone-200 bg-white text-stone-700 hover:border-primary/40 hover:text-primary'
                                                }`}
                                            >
                                                {group.title}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}

                        {hasSuperAttributes ? (
                            <div className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
                                <p className="text-xs font-black uppercase tracking-[0.18em] text-stone-500">Chọn biến thể</p>
                                <div className="mt-4 space-y-4">
                                    {superAttributes.map((attribute) => (
                                        <div key={attribute.id} className="space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-sm font-bold text-stone-800">{attribute.name}</span>
                                                <span className="text-xs font-medium text-stone-400">
                                                    {selectedAttributes[attribute.id] || 'Chưa chọn'}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {getAttributeOptions(attribute, variants).map((option) => {
                                                    const isSelected = selectedAttributes[attribute.id] === option.value;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            onClick={() => handleSelectAttribute(attribute.id, option.value)}
                                                            className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                                                                isSelected
                                                                    ? 'border-primary bg-primary text-white shadow-md'
                                                                    : 'border-stone-200 text-stone-700 hover:border-primary hover:text-primary'
                                                            }`}
                                                        >
                                                            {option.value}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {hasVariants && !hasSuperAttributes ? (
                            <div className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
                                <p className="text-xs font-black uppercase tracking-[0.18em] text-stone-500">Danh sách biến thể</p>
                                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                    {variants.map((variant) => {
                                        const isSelected = displayVariant?.id === variant.id;
                                        return (
                                            <button
                                                key={variant.id}
                                                type="button"
                                                onClick={() => setCurrentVariant(variant)}
                                                className={`rounded-2xl border p-3 text-left transition ${
                                                    isSelected
                                                        ? 'border-primary bg-primary/5 shadow-md'
                                                        : 'border-stone-200 hover:border-primary/50 hover:shadow-sm'
                                                }`}
                                            >
                                                <p className="text-sm font-bold text-stone-900">{getVariantLabel(product.name, variant)}</p>
                                                <p className="mt-1 text-sm font-black text-red-600">{formatCurrency(variant.current_price || variant.price)}</p>
                                                <p className="mt-1 text-xs font-medium text-green-600">
                                                    {'S\u1eb5n s\u00e0ng giao ngay'}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}

                        {specificationItems.length > 0 ? (
                            <div className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
                                <p className="text-xs font-black uppercase tracking-[0.18em] text-stone-500">Thông số chi tiết</p>
                                <div className="mt-4 space-y-3">
                                    {specificationItems.map((item, index) => (
                                        <div key={`${item.label}-${index}`} className="flex items-start justify-between gap-4 border-b border-stone-100 pb-3 last:border-b-0 last:pb-0">
                                            <span className="text-sm font-medium text-stone-500">{item.label}</span>
                                            <span className="max-w-[60%] text-right text-sm font-bold text-stone-800">{item.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {product.type === 'bundle' && activeBundleGroup ? (
                            <div ref={bundleDetailRef} className="rounded-3xl border border-stone-100 bg-white p-5 shadow-sm">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-lg text-primary">list_alt</span>
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-stone-500">Tóm tắt thành phần bộ</p>
                                </div>
                                <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm font-bold text-amber-900">
                                    {activeBundleGroup.title}
                                </div>
                                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    {activeBundleItems.map((item, index) => (
                                        <div key={`${activeBundleGroup.title}-${item.id}-${index}`} className="flex items-center gap-3 rounded-2xl border border-stone-100 bg-stone-50 p-3">
                                            <img
                                                src={item.main_image || item.primary_image?.url || FALLBACK_IMAGE}
                                                alt={item.name}
                                                className="h-16 w-16 rounded-2xl object-cover"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="line-clamp-2 text-sm font-bold text-stone-900">{item.name}</p>
                                                <p className="mt-1 text-xs font-medium text-stone-500">SKU: {item.sku || 'N/A'}</p>
                                            </div>
                                            <div className="rounded-xl bg-white px-3 py-2 text-center shadow-sm">
                                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400">SL</p>
                                                <p className="text-sm font-black text-primary">x{item.quantity || 1}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className="rounded-3xl border border-stone-100 bg-stone-50 p-5">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-black uppercase tracking-[0.16em] text-stone-800">Số lượng</span>
                                <div className="flex items-center overflow-hidden rounded-2xl border border-stone-200 bg-white">
                                    <button type="button" onClick={() => setQuantity((prev) => Math.max(1, prev - 1))} className="flex h-11 w-11 items-center justify-center text-stone-700 hover:bg-stone-50">
                                        <span className="material-symbols-outlined text-xl">remove</span>
                                    </button>
                                    <span className="flex h-11 min-w-[52px] items-center justify-center border-x border-stone-200 text-lg font-bold text-stone-900">{quantity}</span>
                                    <button type="button" onClick={() => setQuantity((prev) => prev + 1)} className="flex h-11 w-11 items-center justify-center text-stone-700 hover:bg-stone-50">
                                        <span className="material-symbols-outlined text-xl">add</span>
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={handleAddToCart}
                                    disabled={mustChooseVariant}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-xl">shopping_cart</span>
                                    Thêm vào giỏ
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowLeadForm(true)}
                                    className="flex items-center justify-center gap-2 rounded-2xl border-2 border-primary px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-primary transition hover:bg-primary/5"
                                >
                                    <span className="material-symbols-outlined text-xl">shopping_bag</span>
                                    Mua ngay
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-10 border-t border-stone-100 pt-8 md:mt-14">
                    <div className="flex gap-6 border-b border-stone-100">
                        {[
                            { key: 'description', label: 'Mô tả sản phẩm' },
                            { key: 'reviews', label: `Đánh giá (${product.review_count || 0})` },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
                                className={`border-b-2 py-4 text-sm font-bold uppercase tracking-wider transition ${
                                    activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-stone-500 hover:text-stone-800'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="py-6">
                        {activeTab === 'description' ? (
                            <div
                                className="prose prose-sm max-w-none text-stone-700"
                                dangerouslySetInnerHTML={{ __html: product.description || '<p class=\"text-stone-400 italic\">Chưa có mô tả sản phẩm</p>' }}
                            />
                        ) : (
                            <div className="space-y-4">
                                {Array.isArray(product.reviews) && product.reviews.length > 0 ? (
                                    product.reviews.map((review) => (
                                        <div key={review.id} className="rounded-2xl bg-stone-50 p-4">
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-bold text-stone-800">{review.customer_name}</p>
                                                    <p className="text-xs text-stone-400">{review.created_at}</p>
                                                </div>
                                                <Stars rating={review.rating} />
                                            </div>
                                            <p className="text-sm text-stone-600">{review.comment}</p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="py-8 text-center text-sm italic text-stone-400">Chưa có đánh giá nào</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {related.length > 0 ? (
                    <div className="mt-10 border-t border-stone-100 pt-8">
                        <h2 className="mb-6 text-lg font-black uppercase tracking-tight text-stone-900">Sản phẩm liên quan</h2>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                            {related.map((item) => (
                                <Link
                                    key={item.id}
                                    to={`/san-pham/${item.slug || item.id}`}
                                    className="group overflow-hidden rounded-2xl border border-stone-100 bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
                                >
                                    <div className="aspect-square overflow-hidden bg-stone-100">
                                        <img
                                            src={item.main_image || item.primary_image?.url || FALLBACK_IMAGE}
                                            alt={item.name}
                                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                        />
                                    </div>
                                    <div className="p-3">
                                        <h3 className="line-clamp-2 text-sm font-bold text-stone-800">{item.name}</h3>
                                        <p className="mt-1 text-sm font-black text-red-600">{formatCurrency(item.current_price || item.price)}</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>

            <BundleActionPopup
                optionTitle={bundleActionOption}
                onClose={() => setBundleActionOption('')}
                onViewDetails={handleViewBundleDetails}
                onAddToCart={handleBundleAddToCart}
                onBuyNow={handleBuyNow}
            />
            <LeadFormModal show={showLeadForm} onClose={() => setShowLeadForm(false)} product={displayVariant || product} />
        </div>
    );
};

export default StorefrontProductDetail;
