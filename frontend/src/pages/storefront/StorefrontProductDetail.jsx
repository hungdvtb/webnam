import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';
import { trackAddToCart } from '../../components/TrackingScripts';

const FALLBACK_IMAGE = 'https://placehold.co/800x800?text=No+Image';

const PRODUCT_TYPE_LABELS = {
    simple: 'Sản phẩm đơn',
    configurable: 'Có biến thể',
    bundle: 'Bộ sản phẩm',
    grouped: 'Nhóm sản phẩm',
    virtual: 'Dịch vụ',
    downloadable: 'Tài liệu số',
};

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

const normalizeAdditionalInfo = (rawValue) => {
    if (!rawValue) {
        return [];
    }

    let parsed = rawValue;

    if (typeof rawValue === 'string') {
        try {
            parsed = JSON.parse(rawValue);
        } catch (error) {
            return [];
        }
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed
        .map((item) => {
            const source = typeof item === 'object' && item !== null ? item : {};
            return {
                title: String(source.title || '').trim(),
                post_id: source.post_id ? Number(source.post_id) : null,
                post_title: String(source.post_title || '').trim(),
                post_slug: String(source.post_slug || '').trim(),
            };
        })
        .filter((item) => item.title || item.post_title || item.post_id);
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
        // Keep the free-form fallback below.
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

const getYoutubeId = (url) => {
    const match = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
    return match ? match[1] : null;
};

const getVideoMediaItem = (videoUrl, fallbackThumbnail) => {
    const normalizedUrl = String(videoUrl || '').trim();

    if (!normalizedUrl) {
        return null;
    }

    const youtubeId = getYoutubeId(normalizedUrl);
    if (youtubeId) {
        return {
            id: `video-youtube-${youtubeId}`,
            type: 'video',
            provider: 'youtube',
            embedUrl: `https://www.youtube.com/embed/${youtubeId}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1`,
            thumbnailUrl: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
        };
    }

    if (/facebook\.com/i.test(normalizedUrl)) {
        return {
            id: `video-facebook-${normalizedUrl}`,
            type: 'video',
            provider: 'facebook',
            embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(normalizedUrl)}&show_text=0`,
            thumbnailUrl: fallbackThumbnail || FALLBACK_IMAGE,
        };
    }

    if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(normalizedUrl)) {
        return {
            id: `video-file-${normalizedUrl}`,
            type: 'video',
            provider: 'file',
            url: normalizedUrl,
            thumbnailUrl: fallbackThumbnail || FALLBACK_IMAGE,
        };
    }

    return {
        id: `video-embed-${normalizedUrl}`,
        type: 'video',
        provider: 'embed',
        embedUrl: normalizedUrl,
        thumbnailUrl: fallbackThumbnail || FALLBACK_IMAGE,
    };
};

const buildMediaItems = (product, displayEntity) => {
    const imageItems = normalizeImages(displayEntity || product).map((image) => ({
        id: `image-${image.id}`,
        type: 'image',
        url: image.url,
        thumbnailUrl: image.url,
        is_primary: image.is_primary,
    }));

    const videoItem = getVideoMediaItem(product?.video_url, imageItems[0]?.thumbnailUrl);

    if (!videoItem) {
        return imageItems;
    }

    if (imageItems.length === 0) {
        return [videoItem];
    }

    const [primaryImage, ...remainingImages] = imageItems;
    return [primaryImage, videoItem, ...remainingImages];
};

const isAttributeOptionAvailable = (attributeId, optionValue, variants, superAttributes, selectedAttributes) => (
    variants.some((variant) => (
        superAttributes.every((attribute) => {
            const expectedValue = Number(attribute.id) === Number(attributeId)
                ? optionValue
                : selectedAttributes[attribute.id];

            if (!expectedValue) {
                return true;
            }

            const variantValue = variant.attributes?.find((item) => Number(item.id) === Number(attribute.id))?.value;
            return variantValue === expectedValue;
        })
    ))
);

const getBundleSelectionKey = (groupTitle, itemId, index) => `${groupTitle || 'bundle'}::${itemId}::${index}`;

const resolveBundleUnitPrice = (item, selectedVariant) => {
    const bundlePrice = Number(item?.bundle_price);
    const hasBundlePrice = Number.isFinite(bundlePrice);
    const selectedVariantId = Number(selectedVariant?.id || 0);
    const defaultVariantId = Number(item?.selected_variant_id || 0);

    if (selectedVariant && hasBundlePrice && selectedVariantId > 0 && defaultVariantId > 0 && selectedVariantId === defaultVariantId) {
        return bundlePrice;
    }

    const variantPrice = Number(selectedVariant?.current_price ?? selectedVariant?.price);
    if (selectedVariant && Number.isFinite(variantPrice)) {
        return variantPrice;
    }

    if (hasBundlePrice) {
        return bundlePrice;
    }

    const itemPrice = Number(item?.current_price ?? item?.price);
    return Number.isFinite(itemPrice) ? itemPrice : 0;
};

const SectionHeading = ({ icon, eyebrow, title, action = null }) => (
    <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/8 text-primary">
                <span className="material-symbols-outlined text-[20px]">{icon}</span>
            </div>
            <div className="min-w-0">
                {eyebrow ? (
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">
                        {eyebrow}
                    </p>
                ) : null}
                <h2 className="mt-1 text-base font-black leading-tight text-stone-900 md:text-lg">
                    {title}
                </h2>
            </div>
        </div>
        {action}
    </div>
);

const QuantityStepper = ({ quantity, onDecrease, onIncrease, compact = false }) => (
    <div className="flex items-center overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <button
            type="button"
            onClick={onDecrease}
            className={`flex items-center justify-center text-stone-700 transition hover:bg-stone-50 ${
                compact ? 'h-10 w-10' : 'h-11 w-11 md:h-12 md:w-12'
            }`}
        >
            <span className="material-symbols-outlined text-[20px]">remove</span>
        </button>
        <span
            className={`flex items-center justify-center border-x border-stone-200 font-black text-stone-900 ${
                compact ? 'h-10 min-w-[38px] text-sm' : 'h-11 min-w-[54px] text-base md:h-12'
            }`}
        >
            {quantity}
        </span>
        <button
            type="button"
            onClick={onIncrease}
            className={`flex items-center justify-center text-stone-700 transition hover:bg-stone-50 ${
                compact ? 'h-10 w-10' : 'h-11 w-11 md:h-12 md:w-12'
            }`}
        >
            <span className="material-symbols-outlined text-[20px]">add</span>
        </button>
    </div>
);

const ProductMediaGallery = ({ items, title }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [zoomed, setZoomed] = useState(false);
    const touchStartX = useRef(null);

    useEffect(() => {
        setActiveIndex(0);
    }, [items]);

    const gallery = items?.length ? items : [{
        id: 'fallback-image',
        type: 'image',
        url: FALLBACK_IMAGE,
        thumbnailUrl: FALLBACK_IMAGE,
    }];
    const activeItem = gallery[activeIndex] || gallery[0];
    const canSwipe = gallery.length > 1 && activeItem.type !== 'video';

    const changeSlide = (direction) => {
        setActiveIndex((prev) => {
            const next = prev + direction;
            if (next < 0) {
                return gallery.length - 1;
            }

            if (next >= gallery.length) {
                return 0;
            }

            return next;
        });
    };

    const handleTouchStart = (event) => {
        touchStartX.current = event.changedTouches?.[0]?.clientX ?? null;
    };

    const handleTouchEnd = (event) => {
        const startX = touchStartX.current;
        const endX = event.changedTouches?.[0]?.clientX ?? null;

        if (startX === null || endX === null) {
            touchStartX.current = null;
            return;
        }

        const deltaX = endX - startX;
        if (Math.abs(deltaX) > 45 && canSwipe) {
            changeSlide(deltaX < 0 ? 1 : -1);
        }

        touchStartX.current = null;
    };

    return (
        <div className="bg-white md:rounded-[32px] md:border md:border-stone-200/80 md:p-3 md:shadow-[0_30px_60px_-45px_rgba(27,54,93,0.45)]">
            <div
                className="relative overflow-hidden bg-stone-100 md:rounded-[28px]"
                onTouchStart={canSwipe ? handleTouchStart : undefined}
                onTouchEnd={canSwipe ? handleTouchEnd : undefined}
            >
                <div className="aspect-[100/92] md:aspect-square">
                    {activeItem.type === 'video' ? (
                        activeItem.provider === 'file' ? (
                            <video
                                src={activeItem.url}
                                poster={activeItem.thumbnailUrl}
                                controls
                                playsInline
                                className="h-full w-full bg-black object-cover"
                            />
                        ) : (
                            <iframe
                                src={activeItem.embedUrl}
                                title={`${title} video`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                                className="h-full w-full border-0 bg-black"
                            />
                        )
                    ) : (
                        <button
                            type="button"
                            onClick={() => setZoomed(true)}
                            className="block h-full w-full"
                        >
                            <img
                                src={activeItem.url || FALLBACK_IMAGE}
                                alt={title}
                                className="h-full w-full object-cover"
                            />
                        </button>
                    )}
                </div>

                <div className="absolute left-3 top-3 flex items-center gap-2">
                    <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white backdrop-blur">
                        {activeItem.type === 'video' ? 'Video' : 'Ảnh'}
                    </span>
                    {activeItem.type === 'image' ? (
                        <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-stone-700 backdrop-blur">
                            Chạm để xem lớn
                        </span>
                    ) : null}
                </div>

                {gallery.length > 1 ? (
                    <>
                        <button
                            type="button"
                            onClick={() => changeSlide(-1)}
                            className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow-lg backdrop-blur transition hover:bg-white"
                        >
                            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => changeSlide(1)}
                            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow-lg backdrop-blur transition hover:bg-white"
                        >
                            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                        </button>
                        <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white backdrop-blur">
                            {activeIndex + 1}/{gallery.length}
                        </div>
                    </>
                ) : null}

            </div>

            {gallery.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto px-4 py-3 md:px-1 md:pb-0 md:pt-3 [&::-webkit-scrollbar]:hidden">
                    {gallery.map((item, index) => {
                        const isActive = index === activeIndex;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setActiveIndex(index)}
                                className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 transition md:h-20 md:w-20 ${
                                    isActive
                                        ? 'border-primary shadow-[0_10px_24px_-16px_rgba(27,54,93,0.7)]'
                                        : 'border-transparent bg-stone-100 opacity-80'
                                }`}
                            >
                                <img
                                    src={item.thumbnailUrl || item.url || FALLBACK_IMAGE}
                                    alt=""
                                    className="h-full w-full object-cover"
                                />
                                {item.type === 'video' ? (
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                                        <span className="material-symbols-outlined text-[22px]">play_circle</span>
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {zoomed && activeItem.type === 'image' ? (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 p-4" onClick={() => setZoomed(false)}>
                    <button
                        type="button"
                        onClick={() => setZoomed(false)}
                        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                    <img
                        src={activeItem.url || FALLBACK_IMAGE}
                        alt={title}
                        className="max-h-[92vh] max-w-[92vw] object-contain"
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
                className={`material-symbols-outlined text-base ${
                    star <= Math.round(rating || 0) ? 'text-amber-500' : 'text-stone-200'
                }`}
            >
                star
            </span>
        ))}
    </div>
);

const TrustHighlights = () => (
    <section className="rounded-[28px] border border-stone-200/80 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)] md:rounded-[30px] md:p-5">
        <SectionHeading
            icon="workspace_premium"
            eyebrow="Dịch vụ & Tin cậy"
            title="An tâm trước khi đặt"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
            {[
                {
                    icon: 'verified',
                    title: 'Chính hãng',
                    description: 'Gốm sứ thủ công tuyển chọn và kiểm tra kỹ trước khi giao.',
                },
                {
                    icon: 'local_shipping',
                    title: 'Vận chuyển',
                    description: 'Đóng gói an toàn, hỗ trợ giao toàn quốc cho đơn mobile.',
                },
                {
                    icon: 'support_agent',
                    title: 'Tư vấn',
                    description: 'Hỗ trợ chọn men, kích thước và bố cục phù hợp.',
                },
                {
                    icon: 'payments',
                    title: 'Minh bạch',
                    description: 'Giá hiển thị rõ ràng, cập nhật theo lựa chọn thực tế.',
                },
            ].map((item) => (
                <div key={item.title} className="rounded-[22px] bg-stone-50 p-3.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/8 text-primary">
                        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    </div>
                    <p className="mt-3 text-sm font-black text-stone-900">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">{item.description}</p>
                </div>
            ))}
        </div>
    </section>
);

const RelatedProductsCarousel = ({ items }) => {
    const [activePage, setActivePage] = useState(0);
    const mobileItemsPerPage = 2;
    const mobilePages = [];

    for (let index = 0; index < items.length; index += mobileItemsPerPage) {
        mobilePages.push(items.slice(index, index + mobileItemsPerPage));
    }

    useEffect(() => {
        setActivePage(0);
    }, [items]);

    if (items.length === 0) {
        return null;
    }

    return (
        <section className="mt-8 px-3 md:mt-12 md:px-0">
            <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">
                        Gợi ý mua kèm
                    </p>
                    <h2 className="mt-1 text-xl font-black text-stone-900">
                        Sản phẩm tương tự
                    </h2>
                </div>
                <Link to="/san-pham" className="text-sm font-black text-primary hover:underline">
                    Xem tất cả
                </Link>
            </div>

            <div className="md:hidden">
                <div className="relative overflow-hidden">
                    <div
                        className="flex transition-transform duration-300 ease-out"
                        style={{ transform: `translateX(-${activePage * 100}%)` }}
                    >
                        {mobilePages.map((pageItems, pageIndex) => (
                            <div key={`related-page-${pageIndex}`} className="grid w-full shrink-0 grid-cols-2 gap-3">
                                {pageItems.map((item) => (
                                    <Link
                                        key={item.id}
                                        to={`/san-pham/${item.slug || item.id}`}
                                        className="group overflow-hidden rounded-[24px] border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
                                    >
                                        <div className="aspect-square overflow-hidden bg-stone-100">
                                            <img
                                                src={item.main_image || item.primary_image?.url || FALLBACK_IMAGE}
                                                alt={item.name}
                                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                            />
                                        </div>
                                        <div className="p-3">
                                            <h3 className="line-clamp-2 text-sm font-black leading-5 text-stone-800">
                                                {item.name}
                                            </h3>
                                            <p className="mt-2 text-sm font-black text-red-600">
                                                {formatCurrency(item.current_price || item.price)}
                                            </p>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {mobilePages.length > 1 ? (
                    <div className="mt-4 flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => setActivePage((prev) => Math.max(0, prev - 1))}
                            disabled={activePage === 0}
                            className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                        </button>
                        <div className="flex items-center gap-2">
                            {mobilePages.map((_, index) => (
                                <button
                                    key={`related-dot-${index}`}
                                    type="button"
                                    onClick={() => setActivePage(index)}
                                    className={`h-2.5 rounded-full transition-all ${
                                        activePage === index ? 'w-6 bg-primary' : 'w-2.5 bg-stone-300'
                                    }`}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setActivePage((prev) => Math.min(mobilePages.length - 1, prev + 1))}
                            disabled={activePage === mobilePages.length - 1}
                            className="flex h-11 w-11 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                        </button>
                    </div>
                ) : null}
            </div>

            <div className="hidden grid-cols-4 gap-4 md:grid">
                {items.map((item) => (
                    <Link
                        key={item.id}
                        to={`/san-pham/${item.slug || item.id}`}
                        className="group overflow-hidden rounded-[24px] border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
                    >
                        <div className="aspect-square overflow-hidden bg-stone-100">
                            <img
                                src={item.main_image || item.primary_image?.url || FALLBACK_IMAGE}
                                alt={item.name}
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                            />
                        </div>
                        <div className="p-3">
                            <h3 className="line-clamp-2 text-sm font-black leading-5 text-stone-800">
                                {item.name}
                            </h3>
                            <p className="mt-2 text-sm font-black text-red-600">
                                {formatCurrency(item.current_price || item.price)}
                            </p>
                        </div>
                    </Link>
                ))}
            </div>
        </section>
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
    const [selectedBundleVariants, setSelectedBundleVariants] = useState({});
    const bundleDetailRef = useRef(null);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setQuantity(1);
            setSelectedAttributes({});
            setCurrentVariant(null);
            setSelectedBundleVariants({});

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
            return;
        }

        setSelectedBundleOption((prev) => {
            if (prev && bundleOptionGroups.some((group) => group.title === prev)) {
                return prev;
            }

            return defaultBundleOption;
        });
    }, [defaultBundleOption, product?.id, product?.type, bundleItems.length]);

    useEffect(() => {
        if (product?.type !== 'bundle') {
            setSelectedBundleVariants({});
            return;
        }

        setSelectedBundleVariants((prev) => {
            const nextSelections = {};

            bundleOptionGroups.forEach((group) => {
                group.items.forEach((item, index) => {
                    const key = getBundleSelectionKey(group.title, item.id, index);
                    const itemVariants = Array.isArray(item?.variants) ? item.variants : [];
                    const previousValue = prev[key];

                    if (previousValue && itemVariants.some((variant) => Number(variant.id) === Number(previousValue))) {
                        nextSelections[key] = previousValue;
                        return;
                    }

                    if (item?.selected_variant_id && itemVariants.some((variant) => Number(variant.id) === Number(item.selected_variant_id))) {
                        nextSelections[key] = item.selected_variant_id;
                        return;
                    }

                    nextSelections[key] = itemVariants.length === 1 ? itemVariants[0].id : '';
                });
            });

            return nextSelections;
        });
    }, [bundleItems, product?.id, product?.type]);

    if (loading) {
        return (
            <div className="mx-auto max-w-7xl px-4 py-8">
                <div className="grid gap-6 md:grid-cols-2 md:gap-10">
                    <div className="aspect-square animate-pulse rounded-[30px] bg-stone-200" />
                    <div className="space-y-4">
                        <div className="h-32 animate-pulse rounded-[30px] bg-stone-200" />
                        <div className="h-28 animate-pulse rounded-[30px] bg-stone-200" />
                        <div className="h-64 animate-pulse rounded-[30px] bg-stone-200" />
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
    const activeBundleSelectionRows = activeBundleItems.map((item, index) => {
        const selectionKey = getBundleSelectionKey(activeBundleGroup?.title || activeBundleOption, item.id, index);
        const itemVariants = Array.isArray(item?.variants) ? item.variants : [];
        const selectedVariant = itemVariants.find((variant) => Number(variant.id) === Number(selectedBundleVariants[selectionKey]))
            || item.selected_variant
            || (itemVariants.length === 1 ? itemVariants[0] : null);
        const quantityPerBundle = Math.max(1, Number(item?.quantity || 1));
        const unitPrice = resolveBundleUnitPrice(item, selectedVariant);
        const referenceUnitPrice = Number(selectedVariant?.price ?? item?.price);

        return {
            ...item,
            selectionKey,
            itemVariants,
            selectedVariant,
            requiresSelection: itemVariants.length > 0 && !selectedVariant,
            quantityPerBundle,
            unitPrice,
            lineTotal: unitPrice * quantityPerBundle,
            referenceUnitPrice: Number.isFinite(referenceUnitPrice) ? referenceUnitPrice : unitPrice,
            displayName: selectedVariant?.name || item.name,
            displaySku: selectedVariant?.sku || item.sku || 'N/A',
            displayImage: selectedVariant?.main_image || selectedVariant?.primary_image?.url || item.main_image || item.primary_image?.url || FALLBACK_IMAGE,
        };
    });
    const bundleCurrentTotal = activeBundleSelectionRows.reduce((sum, item) => sum + item.lineTotal, 0);
    const bundleBaseTotal = activeBundleSelectionRows.reduce((sum, item) => sum + (item.referenceUnitPrice * item.quantityPerBundle), 0);
    const mustChooseBundleVariants = product.type === 'bundle' && activeBundleSelectionRows.some((item) => item.requiresSelection);
    const displayEntity = product.type === 'bundle' ? product : (displayVariant || product);
    const mediaItems = buildMediaItems(product, displayEntity);
    const rawCurrentPrice = product.type === 'bundle'
        ? (activeBundleSelectionRows.length > 0 ? bundleCurrentTotal : Number(product.current_price ?? product.price ?? 0))
        : Number(displayVariant?.current_price ?? displayVariant?.price ?? product.current_price ?? product.price ?? 0);
    const rawBasePrice = product.type === 'bundle'
        ? (bundleBaseTotal > rawCurrentPrice ? bundleBaseTotal : rawCurrentPrice)
        : Number(displayVariant?.price ?? product.price ?? rawCurrentPrice);
    const variantPrices = variants
        .map((variant) => Number(variant.current_price ?? variant.price ?? 0))
        .filter((price) => price > 0);
    const minVariantPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : null;
    const maxVariantPrice = variantPrices.length > 0 ? Math.max(...variantPrices) : null;
    const showPriceRange = product.type !== 'bundle'
        && !displayVariant
        && hasVariants
        && minVariantPrice !== null
        && maxVariantPrice !== null
        && minVariantPrice !== maxVariantPrice;
    const buyProductId = product.type === 'bundle' ? product.id : (displayVariant?.id || product.id);
    const displaySku = product.type === 'bundle' ? (product.sku || 'N/A') : (displayVariant?.sku || product.sku || 'N/A');
    const mustChooseVariant = hasSuperAttributes && hasVariants && !currentVariant;
    const mustCompleteSelection = mustChooseVariant || mustChooseBundleVariants;
    const resolvedStockQuantity = Number(displayVariant?.stock_quantity ?? product.stock_quantity);
    const hasRealStock = Number.isFinite(resolvedStockQuantity);
    const storefrontStatusLabel = mustChooseBundleVariants
        ? 'Cần chọn đủ biến thể trong bộ trước khi đặt'
        : mustChooseVariant
            ? 'Cần chọn phân loại trước khi đặt'
            : hasRealStock && resolvedStockQuantity > 0
                ? `Còn ${resolvedStockQuantity} sản phẩm`
                : 'Sẵn sàng giao ngay';
    const storefrontStatusClass = mustCompleteSelection
        ? 'text-amber-600'
        : hasRealStock && resolvedStockQuantity > 0
            ? 'text-emerald-600'
            : 'text-primary';
    const productTypeLabel = PRODUCT_TYPE_LABELS[product.type] || 'Sản phẩm thủ công';
    const attributeHighlights = Array.isArray(product.attributes)
        ? product.attributes
            .map((attribute) => ({
                label: attribute.name || 'Thuộc tính',
                value: attribute.value,
            }))
            .filter((item) => item.value)
        : [];
    const specificationItems = [
        ...(product.weight ? [{ label: 'Khối lượng', value: `${product.weight} gram` }] : []),
        ...parseSpecificationLines(product.specifications),
    ].filter((item) => item.value);
    const tabDetails = [
        { label: 'Mã sản phẩm', value: displaySku },
        { label: 'Trạng thái', value: storefrontStatusLabel, tone: storefrontStatusClass },
        ...(product.category?.name ? [{ label: 'Danh mục', value: product.category.name }] : []),
        { label: 'Loại sản phẩm', value: productTypeLabel },
        ...attributeHighlights,
        ...specificationItems,
    ].filter((item) => item.value);
    const knowledgeItems = normalizeAdditionalInfo(product.additional_info);

    const handleSelectAttribute = (attributeId, optionValue) => {
        setSelectedAttributes((prev) => {
            const nextSelections = {
                ...prev,
                [attributeId]: prev[attributeId] === optionValue ? '' : optionValue,
            };

            superAttributes.forEach((attribute) => {
                if (!nextSelections[attribute.id]) {
                    return;
                }

                const stillAvailable = isAttributeOptionAvailable(
                    attribute.id,
                    nextSelections[attribute.id],
                    variants,
                    superAttributes,
                    nextSelections,
                );

                if (!stillAvailable) {
                    delete nextSelections[attribute.id];
                }
            });

            return nextSelections;
        });
    };

    const handleSelectBundleVariant = (groupTitle, itemId, index, variantId) => {
        const selectionKey = getBundleSelectionKey(groupTitle, itemId, index);
        setSelectedBundleVariants((prev) => ({
            ...prev,
            [selectionKey]: variantId,
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

    const persistCheckoutSelection = () => {
        if (typeof window === 'undefined') {
            return;
        }

        const payload = {
            checkoutProductId: buyProductId,
            quantity,
            bundleOption: product.type === 'bundle' ? activeBundleOption : '',
            bundleTotal: product.type === 'bundle' ? rawCurrentPrice : null,
            bundleItems: product.type === 'bundle'
                ? activeBundleSelectionRows.map((item) => ({
                    base_product_id: item.id,
                    product_id: item.selectedVariant?.id || item.id,
                    variant_id: item.selectedVariant?.id || null,
                    product_name: item.displayName,
                    product_sku: item.displaySku,
                    quantity: item.quantityPerBundle,
                    unit_price: item.unitPrice,
                    line_total: item.lineTotal,
                    option_title: activeBundleGroup?.title || activeBundleOption || '',
                }))
                : [],
            saved_at: Date.now(),
        };

        window.sessionStorage.setItem('storefront-checkout-selection', JSON.stringify(payload));
    };

    const trackCheckoutIntent = () => {
        trackAddToCart({
            ...product,
            id: buyProductId,
            sku: displaySku,
            price: Number(rawCurrentPrice || 0),
            current_price: Number(rawCurrentPrice || 0),
            main_image: displayVariant?.main_image || product.main_image,
        }, quantity);
    };

    const handleViewBundleDetails = () => {
        bundleDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleAddToCart = () => {
        if (mustCompleteSelection) {
            return;
        }

        persistCheckoutSelection();
        trackCheckoutIntent();
        window.location.href = buildCheckoutUrl();
    };

    const handleBuyNow = () => {
        if (mustCompleteSelection) {
            return;
        }

        persistCheckoutSelection();
        trackCheckoutIntent();
        window.location.href = buildCheckoutUrl();
    };

    return (
        <div className="animate-fade-in bg-[#fcfaf7]">
            <div className="mx-auto max-w-7xl px-0 pb-24 md:px-4 md:py-8 md:pb-10">
                <div className="grid grid-cols-1 gap-6 md:gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                    <div className="md:sticky md:top-[96px] md:self-start">
                        <ProductMediaGallery items={mediaItems} title={product.name} />
                    </div>

                    <div className="space-y-3.5 px-3 md:px-0 md:space-y-5">
                        <section className="rounded-[28px] border border-[#eadbc5] bg-[#fffaf4] p-4 shadow-[0_18px_38px_-30px_rgba(197,160,101,0.65)] md:hidden">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/65">
                                Giá ưu tiên trên mobile
                            </p>
                            <div className="mt-2 flex items-end gap-3">
                                <span className="text-[28px] font-black leading-none text-red-600">
                                    {showPriceRange
                                        ? `${formatCurrency(minVariantPrice)} - ${formatCurrency(maxVariantPrice)}`
                                        : formatCurrency(rawCurrentPrice)}
                                </span>
                                {!showPriceRange && Number(rawBasePrice || 0) > Number(rawCurrentPrice || 0) ? (
                                    <span className="pb-1 text-sm font-bold text-stone-400 line-through">
                                        {formatCurrency(rawBasePrice)}
                                    </span>
                                ) : null}
                            </div>

                            <h1 className="mt-3 text-[24px] font-black leading-[1.08] tracking-tight text-stone-900">
                                {product.name}
                            </h1>

                            <div className={`mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-[12px] font-black shadow-sm ${storefrontStatusClass}`}>
                                <span className="h-2.5 w-2.5 rounded-full bg-current" />
                                <span>{storefrontStatusLabel}</span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                                {product.category ? (
                                    <Link
                                        to={`/danh-muc/${product.category.slug}`}
                                        className="rounded-full bg-primary/6 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-primary"
                                    >
                                        {product.category.name}
                                    </Link>
                                ) : null}
                                <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-600 shadow-sm">
                                    {productTypeLabel}
                                </span>
                                {displayVariant ? (
                                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-800">
                                        {getVariantLabel(product.name, displayVariant)}
                                    </span>
                                ) : null}
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
                                <div className="flex items-center gap-2 text-stone-500">
                                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">
                                        SKU
                                    </span>
                                    <span className="font-mono font-bold text-stone-800">{displaySku}</span>
                                </div>
                                {product.review_count > 0 ? (
                                    <div className="flex items-center gap-1.5 text-stone-500">
                                        <Stars rating={product.average_rating} />
                                        <span className="font-medium">{product.review_count} đánh giá</span>
                                    </div>
                                ) : null}
                            </div>
                        </section>

                        <section className="hidden rounded-[30px] border border-[#eadbc5] bg-[#fffaf4] p-5 shadow-[0_18px_38px_-30px_rgba(197,160,101,0.65)] md:block">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/65">
                                        Giá ưu tiên trên mobile
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-end gap-3">
                                        <span className="text-[30px] font-black leading-none text-red-600 md:text-[38px]">
                                            {showPriceRange
                                                ? `${formatCurrency(minVariantPrice)} - ${formatCurrency(maxVariantPrice)}`
                                                : formatCurrency(rawCurrentPrice)}
                                        </span>
                                        {!showPriceRange && Number(rawBasePrice || 0) > Number(rawCurrentPrice || 0) ? (
                                            <span className="pb-1 text-base font-bold text-stone-400 line-through">
                                                {formatCurrency(rawBasePrice)}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>

                                <div className={`inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black shadow-sm ${storefrontStatusClass}`}>
                                    <span className="h-2.5 w-2.5 rounded-full bg-current" />
                                    <span>{mustCompleteSelection ? 'Hoàn tất lựa chọn' : 'Sẵn sàng mua'}</span>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-stone-600">
                                <span className="rounded-full bg-white px-3 py-2 shadow-sm">Đã bao gồm VAT</span>
                                <span className="rounded-full bg-white px-3 py-2 shadow-sm">Bảo hiểm vận chuyển</span>
                                {product.review_count > 0 ? (
                                    <span className="rounded-full bg-white px-3 py-2 shadow-sm">
                                        {product.review_count} đánh giá thực tế
                                    </span>
                                ) : null}
                            </div>
                        </section>

                        <section className="hidden rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_22px_44px_-34px_rgba(27,54,93,0.45)] md:block">
                            <div className="flex flex-wrap items-center gap-2">
                                {product.category ? (
                                    <Link
                                        to={`/danh-muc/${product.category.slug}`}
                                        className="rounded-full bg-primary/6 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] text-primary"
                                    >
                                        {product.category.name}
                                    </Link>
                                ) : null}
                                <span className="rounded-full bg-stone-100 px-3 py-1.5 text-[11px] font-bold text-stone-600">
                                    {productTypeLabel}
                                </span>
                                {displayVariant ? (
                                    <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-800">
                                        {getVariantLabel(product.name, displayVariant)}
                                    </span>
                                ) : null}
                            </div>

                            <h1 className="mt-4 text-[28px] font-black leading-[1.1] tracking-tight text-stone-900 md:text-[34px]">
                                {product.name}
                            </h1>

                            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                                <div className="flex items-center gap-2 text-stone-500">
                                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">
                                        SKU
                                    </span>
                                    <span className="font-mono font-bold text-stone-800">{displaySku}</span>
                                </div>
                                <span className="h-1 w-1 rounded-full bg-stone-300" />
                                <span className={`flex items-center gap-2 font-bold ${storefrontStatusClass}`}>
                                    <span className="h-2 w-2 rounded-full bg-current" />
                                    {storefrontStatusLabel}
                                </span>
                            </div>

                            {product.review_count > 0 ? (
                                <div className="mt-4 flex items-center gap-2">
                                    <Stars rating={product.average_rating} />
                                    <span className="text-sm font-medium text-stone-500">
                                        {product.average_rating} / 5 ({product.review_count} đánh giá)
                                    </span>
                                </div>
                            ) : (
                                <p className="mt-4 text-sm font-medium text-stone-500">
                                    Sản phẩm thủ công được tư vấn 1:1 khi cần chọn men, kích thước hoặc cách bài trí.
                                </p>
                            )}
                        </section>

                        {product.type === 'bundle' && bundleOptionGroups.length > 0 ? (
                            <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)]">
                                <SectionHeading
                                    icon="dashboard_customize"
                                    eyebrow="Chọn cấu hình"
                                    title="Lựa chọn bộ sản phẩm"
                                    action={activeBundleGroup ? (
                                        <button
                                            type="button"
                                            onClick={handleViewBundleDetails}
                                            className="rounded-full bg-primary/6 px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-primary md:hidden"
                                        >
                                            Xem thành phần
                                        </button>
                                    ) : null}
                                />

                                <div className="mt-4 flex flex-wrap gap-2.5">
                                    {bundleOptionGroups.map((group) => {
                                        const isSelected = activeBundleOption === group.title;

                                        return (
                                            <button
                                                key={group.title}
                                                type="button"
                                                onClick={() => setSelectedBundleOption(group.title)}
                                                className={`rounded-2xl border px-4 py-3 text-sm font-black transition ${
                                                    isSelected
                                                        ? 'border-primary bg-primary text-white shadow-lg'
                                                        : 'border-stone-200 bg-white text-stone-700 hover:border-primary/35 hover:text-primary'
                                                }`}
                                            >
                                                {group.title}
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        ) : null}

                        {hasSuperAttributes ? (
                            <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)]">
                                <SectionHeading
                                    icon="tune"
                                    eyebrow="Chọn phân loại"
                                    title={mustChooseVariant ? 'Hoàn tất lựa chọn trước khi đặt hàng' : 'Biến thể đã sẵn sàng'}
                                />

                                <div className="mt-4 space-y-4">
                                    {superAttributes.map((attribute) => (
                                        <div key={attribute.id} className="space-y-2.5">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-sm font-black text-stone-800">{attribute.name}</span>
                                                <span className="text-xs font-semibold text-stone-400">
                                                    {selectedAttributes[attribute.id] || 'Chưa chọn'}
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {getAttributeOptions(attribute, variants).map((option) => {
                                                    const isSelected = selectedAttributes[attribute.id] === option.value;
                                                    const isDisabled = !isSelected && !isAttributeOptionAvailable(
                                                        attribute.id,
                                                        option.value,
                                                        variants,
                                                        superAttributes,
                                                        selectedAttributes,
                                                    );

                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            disabled={isDisabled}
                                                            onClick={() => handleSelectAttribute(attribute.id, option.value)}
                                                            className={`rounded-2xl border px-4 py-2.5 text-sm font-bold transition ${
                                                                isSelected
                                                                    ? 'border-primary bg-primary text-white shadow-md'
                                                                    : isDisabled
                                                                        ? 'cursor-not-allowed border-stone-200 bg-stone-100 text-stone-300 opacity-70'
                                                                        : 'border-stone-200 bg-white text-stone-700 hover:border-primary/35 hover:text-primary'
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
                            </section>
                        ) : null}

                        {hasVariants && !hasSuperAttributes ? (
                            <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)]">
                                <SectionHeading
                                    icon="view_list"
                                    eyebrow="Danh sách biến thể"
                                    title="Chọn phiên bản phù hợp"
                                />

                                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                                    {variants.map((variant) => {
                                        const isSelected = displayVariant?.id === variant.id;

                                        return (
                                            <button
                                                key={variant.id}
                                                type="button"
                                                onClick={() => setCurrentVariant(variant)}
                                                className={`rounded-[24px] border p-4 text-left transition ${
                                                    isSelected
                                                        ? 'border-primary bg-primary/5 shadow-md'
                                                        : 'border-stone-200 hover:border-primary/35 hover:shadow-sm'
                                                }`}
                                            >
                                                <p className="text-sm font-black text-stone-900">
                                                    {getVariantLabel(product.name, variant)}
                                                </p>
                                                <p className="mt-2 text-lg font-black text-red-600">
                                                    {formatCurrency(variant.current_price || variant.price)}
                                                </p>
                                                <p className="mt-1 text-xs font-bold text-emerald-600">
                                                    {Number(variant.stock_quantity || 0) > 0
                                                        ? `Còn ${variant.stock_quantity} sản phẩm`
                                                        : 'Sẵn sàng tư vấn'}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        ) : null}

                        {(attributeHighlights.length > 0 || product.category || product.type) ? (
                            <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)]">
                                <SectionHeading
                                    icon="inventory_2"
                                    eyebrow="Thông tin nhanh"
                                    title="Mã sản phẩm, trạng thái và thuộc tính"
                                />

                                <div className="mt-4 grid grid-cols-2 gap-3">
                                    <div className="rounded-2xl bg-stone-50 p-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Mã SKU</p>
                                        <p className="mt-2 break-words font-mono text-sm font-bold text-stone-900">{displaySku}</p>
                                    </div>
                                    <div className="rounded-2xl bg-stone-50 p-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Trạng thái</p>
                                        <p className={`mt-2 text-sm font-bold ${storefrontStatusClass}`}>{storefrontStatusLabel}</p>
                                    </div>
                                    <div className="rounded-2xl bg-stone-50 p-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Loại</p>
                                        <p className="mt-2 text-sm font-bold text-stone-900">{productTypeLabel}</p>
                                    </div>
                                    <div className="rounded-2xl bg-stone-50 p-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Danh mục</p>
                                        <p className="mt-2 text-sm font-bold text-stone-900">{product.category?.name || 'Đang cập nhật'}</p>
                                    </div>
                                </div>

                                {attributeHighlights.length > 0 ? (
                                    <div className="mt-4 flex flex-wrap gap-2">
                                        {attributeHighlights.map((item, index) => (
                                            <div key={`${item.label}-${index}`} className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2">
                                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">{item.label}</p>
                                                <p className="mt-1 text-sm font-bold text-stone-900">{item.value}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </section>
                        ) : null}

                        {product.type === 'bundle' && activeBundleGroup ? (
                            <section
                                className="hidden rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)] md:block"
                            >
                                <SectionHeading
                                    icon="list_alt"
                                    eyebrow="Thành phần đang chọn"
                                    title={activeBundleGroup.title}
                                />

                                <div className="mt-4 grid gap-3">
                                    {activeBundleItems.map((item, index) => (
                                        <div
                                            key={`${activeBundleGroup.title}-${item.id}-${index}`}
                                            className="flex items-center gap-3 rounded-[24px] border border-stone-200 bg-stone-50 p-3"
                                        >
                                            <img
                                                src={item.main_image || item.primary_image?.url || FALLBACK_IMAGE}
                                                alt={item.name}
                                                className="h-16 w-16 rounded-2xl object-cover"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="line-clamp-2 text-sm font-black text-stone-900">
                                                    {item.name}
                                                </p>
                                                <p className="mt-1 text-xs font-semibold text-stone-500">
                                                    SKU: {item.sku || 'N/A'}
                                                </p>
                                            </div>
                                            <div className="rounded-2xl bg-white px-3 py-2 text-center shadow-sm">
                                                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">
                                                    SL
                                                </p>
                                                <p className="mt-1 text-sm font-black text-primary">
                                                    x{item.quantity || 1}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {product.type === 'bundle' && activeBundleGroup ? (
                            <section
                                ref={bundleDetailRef}
                                className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)] md:hidden"
                            >
                                <SectionHeading
                                    icon="list_alt"
                                    eyebrow="Thành phần bộ"
                                    title={activeBundleGroup.title}
                                    action={(
                                        <div className="rounded-full bg-primary/6 px-3 py-2 text-right">
                                            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/70">
                                                Tổng giá
                                            </p>
                                            <p className="mt-0.5 text-sm font-black text-primary">
                                                {formatCurrency(rawCurrentPrice)}
                                            </p>
                                        </div>
                                    )}
                                />

                                <div className="mt-4 grid gap-3">
                                    {activeBundleSelectionRows.map((item, index) => (
                                        <div
                                            key={`${activeBundleGroup.title}-${item.id}-${index}`}
                                            className="rounded-[24px] border border-stone-200 bg-stone-50 p-3"
                                        >
                                            <div className="flex items-start gap-3">
                                                <img
                                                    src={item.displayImage}
                                                    alt={item.displayName}
                                                    className="h-16 w-16 rounded-2xl object-cover"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <p className="line-clamp-2 text-sm font-black text-stone-900">
                                                        {item.displayName}
                                                    </p>
                                                    <p className="mt-1 text-xs font-semibold text-stone-500">
                                                        SKU: {item.displaySku}
                                                    </p>
                                                    <p className="mt-2 text-sm font-black text-red-600">
                                                        {formatCurrency(item.unitPrice)}
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl bg-white px-3 py-2 text-center shadow-sm">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">
                                                        SL
                                                    </p>
                                                    <p className="mt-1 text-sm font-black text-primary">
                                                        x{item.quantityPerBundle}
                                                    </p>
                                                </div>
                                            </div>

                                            {item.itemVariants.length > 0 ? (
                                                <div className="mt-3 rounded-[20px] bg-white p-3 shadow-sm">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-500">
                                                            Chọn phân loại
                                                        </p>
                                                        <span className={`text-[11px] font-bold ${item.requiresSelection ? 'text-amber-700' : 'text-stone-500'}`}>
                                                            {item.selectedVariant ? getVariantLabel(item.name, item.selectedVariant) : 'Chưa chọn'}
                                                        </span>
                                                    </div>

                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {item.itemVariants.map((variant) => {
                                                            const isSelected = Number(item.selectedVariant?.id) === Number(variant.id);
                                                            return (
                                                                <button
                                                                    key={variant.id}
                                                                    type="button"
                                                                    onClick={() => handleSelectBundleVariant(activeBundleGroup.title, item.id, index, variant.id)}
                                                                    className={`rounded-2xl border px-3.5 py-2 text-sm font-bold transition ${
                                                                        isSelected
                                                                            ? 'border-primary bg-primary text-white shadow-md'
                                                                            : 'border-stone-200 bg-white text-stone-700 hover:border-primary/35 hover:text-primary'
                                                                    }`}
                                                                >
                                                                    {getVariantLabel(item.name, variant)}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    {item.requiresSelection ? (
                                                        <p className="mt-2 text-xs font-semibold text-amber-700">
                                                            Cần chọn phân loại cho sản phẩm con này trước khi mua bộ.
                                                        </p>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 flex items-center justify-between rounded-[24px] border border-primary/12 bg-primary/[0.04] px-4 py-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/70">
                                            Tổng giá bộ
                                        </p>
                                        <p className="mt-1 text-xs text-stone-500">
                                            Cập nhật tức thì theo lựa chọn phân loại từng sản phẩm con.
                                        </p>
                                    </div>
                                    <p className="text-lg font-black text-primary">
                                        {formatCurrency(rawCurrentPrice)}
                                    </p>
                                </div>
                            </section>
                        ) : null}

                        <div className="md:hidden">
                            <TrustHighlights />
                        </div>

                        <section className="hidden rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)] md:block">
                            <SectionHeading
                                icon="shopping_bag"
                                eyebrow="Sẵn sàng đặt hàng"
                                title="Số lượng và thao tác mua nhanh"
                            />

                            <div className="mt-4 flex items-center justify-between gap-4 rounded-[24px] bg-stone-50 p-4">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">
                                        Số lượng
                                    </p>
                                    <p className="mt-1 text-sm font-medium text-stone-500">
                                        Điều chỉnh trước khi mua trên mobile.
                                    </p>
                                </div>
                                <QuantityStepper
                                    quantity={quantity}
                                    onDecrease={() => setQuantity((prev) => Math.max(1, prev - 1))}
                                    onIncrease={() => setQuantity((prev) => prev + 1)}
                                />
                            </div>

                            <div className="mt-4 hidden gap-3 md:grid md:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={handleAddToCart}
                                    disabled={mustCompleteSelection}
                                    className="flex items-center justify-center gap-2 rounded-[24px] border-2 border-primary px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-[20px]">shopping_cart</span>
                                    Thêm vào giỏ
                                </button>
                                <button
                                    type="button"
                                    onClick={handleBuyNow}
                                    disabled={mustCompleteSelection}
                                    className="flex items-center justify-center gap-2 rounded-[24px] bg-primary px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-[20px]">bolt</span>
                                    Mua ngay
                                </button>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowLeadForm(true)}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-black text-primary transition hover:text-primary/80"
                            >
                                <span className="material-symbols-outlined text-[18px]">support_agent</span>
                                Cần chuyên gia gốm sứ tư vấn chọn màu?
                            </button>

                            {mustCompleteSelection ? (
                                <p className="mt-3 text-sm font-semibold text-amber-700">
                                    {mustChooseBundleVariants
                                        ? 'Vui lòng chọn đủ biến thể cho từng sản phẩm con trong bộ trước khi đặt hàng.'
                                        : 'Vui lòng chọn đầy đủ phân loại trước khi đặt hàng.'}
                                </p>
                            ) : (
                                <p className="mt-3 text-sm text-stone-500 md:hidden">
                                    Thanh đặt hàng đang được ghim ở cuối màn hình để thao tác nhanh hơn.
                                </p>
                            )}
                        </section>

                        <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)] md:hidden">
                            <SectionHeading
                                icon="shopping_bag"
                                eyebrow="Sẵn sàng đặt hàng"
                                title="Số lượng và thao tác mua nhanh"
                            />

                            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                                <div className="rounded-[24px] bg-stone-50 p-4">
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-stone-500">
                                        Số lượng
                                    </p>
                                    <p className="mt-1 text-sm font-medium text-stone-500">
                                        Điều chỉnh nhanh trước khi thêm vào giỏ hoặc mua ngay.
                                    </p>
                                    <div className="mt-3">
                                        <QuantityStepper
                                            quantity={quantity}
                                            onDecrease={() => setQuantity((prev) => Math.max(1, prev - 1))}
                                            onIncrease={() => setQuantity((prev) => prev + 1)}
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={handleAddToCart}
                                        disabled={mustCompleteSelection}
                                        className="flex items-center justify-center gap-2 rounded-[24px] border-2 border-primary px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">shopping_cart</span>
                                        Thêm vào giỏ
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleBuyNow}
                                        disabled={mustCompleteSelection}
                                        className="flex items-center justify-center gap-2 rounded-[24px] bg-primary px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-[20px]">bolt</span>
                                        Mua ngay
                                    </button>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowLeadForm(true)}
                                className="mt-4 inline-flex items-center gap-2 text-sm font-black text-primary transition hover:text-primary/80"
                            >
                                <span className="material-symbols-outlined text-[18px]">support_agent</span>
                                Cần chuyên gia gốm sứ tư vấn chọn màu?
                            </button>

                            {mustCompleteSelection ? (
                                <p className="mt-3 text-sm font-semibold text-amber-700">
                                    {mustChooseBundleVariants
                                        ? 'Vui lòng chọn đủ biến thể cho từng sản phẩm con trong bộ trước khi đặt hàng.'
                                        : 'Vui lòng chọn đầy đủ phân loại trước khi đặt hàng.'}
                                </p>
                            ) : (
                                <p className="mt-3 text-sm text-stone-500">
                                    Khối mua hàng đã được gom gọn cho mobile để thao tác trong một nhịp.
                                </p>
                            )}
                        </section>

                        <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)]">
                            <div className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
                                {[
                                    { key: 'description', label: 'Mô tả' },
                                    { key: 'specs', label: 'Thông số' },
                                    { key: 'reviews', label: `Đánh giá (${product.review_count || 0})` },
                                ].map((tab) => (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => setActiveTab(tab.key)}
                                        className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-black transition ${
                                            activeTab === tab.key
                                                ? 'bg-primary text-white shadow-md'
                                                : 'bg-stone-100 text-stone-600'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            <div className="mt-5">
                                {activeTab === 'description' ? (
                                    <div
                                        className="prose prose-sm max-w-none text-stone-700 md:prose-base prose-headings:text-stone-900 prose-a:text-primary prose-strong:text-stone-900"
                                        dangerouslySetInnerHTML={{
                                            __html: product.description || '<p class="text-stone-400 italic">Chưa có mô tả sản phẩm.</p>',
                                        }}
                                    />
                                ) : null}

                                {activeTab === 'specs' ? (
                                    tabDetails.length > 0 ? (
                                        <div className="space-y-3">
                                            {tabDetails.map((item, index) => (
                                                <div
                                                    key={`${item.label}-${index}`}
                                                    className="flex items-start justify-between gap-4 rounded-[22px] bg-stone-50 px-4 py-3"
                                                >
                                                    <span className="max-w-[42%] text-sm font-bold text-stone-500">
                                                        {item.label}
                                                    </span>
                                                    <span className={`text-right text-sm font-black ${item.tone || 'text-stone-900'}`}>
                                                        {item.value}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="py-8 text-center text-sm italic text-stone-400">
                                            Chưa có thông số chi tiết.
                                        </p>
                                    )
                                ) : null}

                                {activeTab === 'reviews' ? (
                                    <div className="space-y-4">
                                        {Array.isArray(product.reviews) && product.reviews.length > 0 ? (
                                            product.reviews.map((review) => (
                                                <div key={review.id} className="rounded-[24px] bg-stone-50 p-4">
                                                    <div className="mb-2 flex items-center justify-between gap-3">
                                                        <div>
                                                            <p className="text-sm font-black text-stone-800">{review.customer_name}</p>
                                                            <p className="text-xs text-stone-400">{review.created_at}</p>
                                                        </div>
                                                        <Stars rating={review.rating} />
                                                    </div>
                                                    <p className="text-sm leading-6 text-stone-600">{review.comment}</p>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="py-8 text-center text-sm italic text-stone-400">
                                                Chưa có đánh giá nào.
                                            </p>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        </section>

                        <section className="rounded-[30px] border border-stone-200/80 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(27,54,93,0.42)]">
                            <SectionHeading
                                icon="menu_book"
                                eyebrow="Kiến thức gốm sứ"
                                title="Hướng dẫn lựa chọn và bài trí"
                            />

                            {knowledgeItems.length > 0 ? (
                                <div className="mt-4 grid gap-3">
                                    {knowledgeItems.map((item, index) => {
                                        const target = item.post_slug
                                            ? `/blog/${item.post_slug}`
                                            : item.post_id
                                                ? `/blog/${item.post_id}`
                                                : '/blog';

                                        return (
                                            <Link
                                                key={`${item.post_id || item.title || 'knowledge'}-${index}`}
                                                to={target}
                                                className="group flex items-start justify-between gap-3 rounded-[24px] border border-stone-200 bg-stone-50 px-4 py-4 transition hover:border-primary/25 hover:bg-primary/5"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">
                                                        {item.title || 'Bài viết gợi ý'}
                                                    </p>
                                                    <p className="mt-2 line-clamp-2 text-sm font-black leading-6 text-stone-900">
                                                        {item.post_title || item.title || 'Xem bài viết liên quan'}
                                                    </p>
                                                </div>
                                                <span className="material-symbols-outlined text-primary transition group-hover:translate-x-1">
                                                    east
                                                </span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            ) : (
                                <Link
                                    to="/blog"
                                    className="mt-4 flex items-start justify-between gap-3 rounded-[24px] border border-stone-200 bg-stone-50 px-4 py-4 transition hover:border-primary/25 hover:bg-primary/5"
                                >
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">
                                            Cẩm nang gốm sứ
                                        </p>
                                        <p className="mt-2 text-sm font-black leading-6 text-stone-900">
                                            Xem thêm mẹo chọn men, cách bảo quản và gợi ý bài trí cho không gian sống.
                                        </p>
                                    </div>
                                    <span className="material-symbols-outlined text-primary">east</span>
                                </Link>
                            )}
                        </section>
                    </div>
                </div>

                <div className="md:hidden">
                    <RelatedProductsCarousel items={related} />
                </div>

                {related.length > 0 ? (
                    <section className="hidden px-4 md:mt-12 md:block md:px-0">
                        <div className="mb-5 flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">
                                    Gợi ý mua kèm
                                </p>
                                <h2 className="mt-1 text-xl font-black text-stone-900">
                                    Sản phẩm liên quan
                                </h2>
                            </div>
                            <Link to="/san-pham" className="text-sm font-black text-primary hover:underline">
                                Xem tất cả
                            </Link>
                        </div>

                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                            {related.map((item) => (
                                <Link
                                    key={item.id}
                                    to={`/san-pham/${item.slug || item.id}`}
                                    className="group overflow-hidden rounded-[24px] border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
                                >
                                    <div className="aspect-square overflow-hidden bg-stone-100">
                                        <img
                                            src={item.main_image || item.primary_image?.url || FALLBACK_IMAGE}
                                            alt={item.name}
                                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                                        />
                                    </div>
                                    <div className="p-3">
                                        <h3 className="line-clamp-2 text-sm font-black leading-5 text-stone-800">
                                            {item.name}
                                        </h3>
                                        <p className="mt-2 text-sm font-black text-red-600">
                                            {formatCurrency(item.current_price || item.price)}
                                        </p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>

            <div className="hidden fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 shadow-[0_-18px_40px_-30px_rgba(27,54,93,0.75)] backdrop-blur md:hidden">
                <div className="mx-auto max-w-7xl px-4 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] pt-3">
                    <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">
                                {mustChooseVariant ? 'Cần chọn phân loại' : 'Giá đặt nhanh'}
                            </p>
                            <p className="mt-1 truncate text-lg font-black text-red-600">
                                {showPriceRange
                                    ? `${formatCurrency(minVariantPrice)} - ${formatCurrency(maxVariantPrice)}`
                                    : formatCurrency(rawCurrentPrice)}
                            </p>
                        </div>

                        <QuantityStepper
                            quantity={quantity}
                            compact
                            onDecrease={() => setQuantity((prev) => Math.max(1, prev - 1))}
                            onIncrease={() => setQuantity((prev) => prev + 1)}
                        />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setShowLeadForm(true)}
                            className="flex items-center justify-center gap-2 rounded-[22px] border border-primary px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-primary"
                        >
                            <span className="material-symbols-outlined text-[18px]">support_agent</span>
                            Tư vấn
                        </button>
                        <button
                            type="button"
                            onClick={handleBuyNow}
                            disabled={mustChooseVariant}
                            className="flex items-center justify-center gap-2 rounded-[22px] bg-primary px-4 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                            Mua ngay
                        </button>
                    </div>
                </div>
            </div>

            <LeadFormModal
                show={showLeadForm}
                onClose={() => setShowLeadForm(false)}
                product={displayVariant || product}
            />
        </div>
    );
};

export default StorefrontProductDetail;
