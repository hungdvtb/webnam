import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { productApi, categoryApi, attributeApi, productImageApi, aiApi, blogApi, mediaApi, cmsApi, inventoryApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import ReactQuill from 'react-quill-new';
import mammoth from 'mammoth';
import 'react-quill-new/dist/quill.snow.css';

import QuillResizeImage from 'quill-image-resize-module-react';
window.Quill = ReactQuill.Quill;
ReactQuill.Quill.register('modules/resize', QuillResizeImage);

import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import AdminMultiSelect from '../../components/admin/AdminMultiSelect';
import { PRODUCT_TYPE_FORM_META } from '../../config/productTypes';
import { compressImage, formatBytes } from '../../utils/imageUtils';
import {
    copyBundleOptionBelowSource,
    createBundleItemEntryId,
    createBundleOptionId,
} from '../../utils/bundleOptions';
import {
    formatRoundedImportCost,
    formatWholeMoneyInput,
    normalizeRoundedImportCostNumber,
    normalizeWholeMoneyDraft,
    normalizeWholeMoneyNumber,
} from '../../utils/money';
import { resolveImageObjectUrl } from '../../utils/mediaUrl';
import { formatCategorySummary, getCategoryNamesByIds, getProductCategoryIds, normalizeCategoryIds } from '../../utils/productCategories';
import { resolveImageUploadError, validateImageFileForUpload } from '../../utils/uploadError';
import { resolveAiRequestError } from '../../utils/aiError';
import { hasAdminPermission } from '../../utils/adminPermissions';
import ProductDescriptionAiReviewModal from '../../components/admin/ProductDescriptionAiReviewModal';
import ProductDescriptionHtmlPasteModal from '../../components/admin/ProductDescriptionHtmlPasteModal';
import ProductDescriptionImageLibraryModal from '../../components/admin/ProductDescriptionImageLibraryModal';

const ItemType = {
    IMAGE: 'image',
    BUNDLE_ITEM: 'bundle_item',
};

const resolveAdminImageUrl = (image, fallback = '') => resolveImageObjectUrl(image, 'thumbnail', fallback);

const normalizeAdminPrimarySelection = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    const primaryIndex = items.findIndex((item) => Boolean(item?.is_primary));
    const resolvedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;

    return items.map((item, index) => ({
        ...item,
        is_primary: index === resolvedPrimaryIndex,
    }));
};

const normalizeAdminImages = (items = []) => normalizeAdminPrimarySelection(
    Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            image_url: item?.image_url?.startsWith?.('blob:')
                ? item.image_url
                : resolveAdminImageUrl(item, item?.image_url || ''),
        }))
        : []
);

const resolveAttributeSortOrder = (attribute) => {
    const numericValue = Number(attribute?.sort_order);
    return Number.isFinite(numericValue) ? numericValue : Number.MAX_SAFE_INTEGER;
};

const sortAttributesBySortOrder = (items = []) => (
    Array.isArray(items)
        ? [...items].sort((left, right) => {
            const sortDifference = resolveAttributeSortOrder(left) - resolveAttributeSortOrder(right);
            if (sortDifference !== 0) {
                return sortDifference;
            }

            return Number(left?.id || 0) - Number(right?.id || 0);
        })
        : []
);

const normalizeSelectedSuperAttributes = (items = []) => sortAttributesBySortOrder(items).map((item) => ({
    ...item,
    selected_values: Array.isArray(item?.selected_values) ? [...item.selected_values] : [],
    default_value: item?.default_value ?? null,
}));

const normalizeVariantSelectionValues = (values = []) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
));

const summarizeVariantSelectionValues = (values = [], emptyLabel = 'Chưa chọn giá trị') => {
    const normalizedValues = normalizeVariantSelectionValues(values);

    if (normalizedValues.length === 0) {
        return emptyLabel;
    }

    if (normalizedValues.length <= 3) {
        return normalizedValues.join(', ');
    }

    return `${normalizedValues.slice(0, 3).join(', ')} +${normalizedValues.length - 3}`;
};

const normalizeVariantStatus = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    if (typeof value === 'string') {
        const normalizedValue = value.trim().toLowerCase();
        if (normalizedValue === '') {
            return fallback;
        }

        if (['0', 'false', 'off', 'no'].includes(normalizedValue)) {
            return false;
        }

        if (['1', 'true', 'on', 'yes'].includes(normalizedValue)) {
            return true;
        }
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    return Boolean(value);
};

const isActiveVariantDraft = (variant) => normalizeVariantStatus(variant?.status, true);

const isTemporaryProductImageId = (imageId) => {
    const normalizedId = String(imageId || '');
    return normalizedId.startsWith('temp_') || normalizedId.startsWith('opt_');
};

const getAdminImageDisplayName = (image, index = 0) => {
    if (image?.file?.name) return image.file.name;
    if (image?.file_name) return image.file_name;
    if (image?.image_url) {
        try {
            const parts = String(image.image_url).split('/');
            return parts[parts.length - 1].split('?')[0];
        } catch {
            return `Ảnh ${index + 1}`;
        }
    }

    return `Ảnh ${index + 1}`;
};

const PRODUCT_IMAGE_TOKEN_EXISTING_PREFIX = 'existing:';
const PRODUCT_IMAGE_TOKEN_NEW_PREFIX = 'new:';
const IMAGE_PREVIEW_DOUBLE_CLICK_DELAY = 320;

const buildProductImageSubmissionPayload = (items = []) => {
    const order = [];
    const files = [];
    let primaryToken = '';

    (Array.isArray(items) ? items : []).forEach((image) => {
        let token = '';

        if (image?.file) {
            token = `${PRODUCT_IMAGE_TOKEN_NEW_PREFIX}${files.length}`;
            files.push(image.file);
        } else {
            const persistedId = Number(image?.id);
            if (!persistedId) {
                return;
            }

            token = `${PRODUCT_IMAGE_TOKEN_EXISTING_PREFIX}${persistedId}`;
        }

        order.push(token);
        if (!primaryToken && image?.is_primary) {
            primaryToken = token;
        }
    });

    if (!primaryToken && order.length > 0) {
        primaryToken = order[0];
    }

    return {
        order,
        files,
        primaryToken,
    };
};

const buildProductImageSignature = (items = []) => (
    (Array.isArray(items) ? items : [])
        .map((image, index) => {
            const idPart = image?.file
                ? `new:${image.file.name || 'image'}:${image.file.size || 0}:${image.file.lastModified || 0}`
                : `existing:${Number(image?.id) || ''}`;

            return `${index}:${idPart}:${image?.is_primary ? 1 : 0}`;
        })
        .join('|')
);

const BUNDLE_OPTION_STATUS_VISIBLE = 'visible';
const BUNDLE_OPTION_STATUS_INTERNAL = 'internal';

const normalizeBundleOptionStatus = (value) => (
    String(value || '').trim().toLowerCase() === BUNDLE_OPTION_STATUS_INTERNAL
        ? BUNDLE_OPTION_STATUS_INTERNAL
        : BUNDLE_OPTION_STATUS_VISIBLE
);

const isInternalBundleOption = (option) => (
    normalizeBundleOptionStatus(option?.status ?? option?.bundle_option_status) === BUNDLE_OPTION_STATUS_INTERNAL
);

const normalizeBundleSignatureValue = (value) => String(value ?? '').trim();

const buildBundleOptionSignature = (options = []) => JSON.stringify(
    (Array.isArray(options) ? options : []).map((option, optionIndex) => ({
        index: optionIndex,
        title: normalizeBundleSignatureValue(option?.title),
        status: normalizeBundleOptionStatus(option?.status ?? option?.bundle_option_status),
        post_id: normalizeBundleSignatureValue(option?.post_id),
        image_url: normalizeBundleSignatureValue(option?.image_url),
        video_url: normalizeBundleSignatureValue(option?.video_url),
        video_source: normalizeBundleSignatureValue(option?.video_source),
        items: (Array.isArray(option?.items) ? option.items : []).map((item, itemIndex) => ({
            index: itemIndex,
            id: normalizeBundleSignatureValue(item?.product_id ?? item?.id),
            variant_id: normalizeBundleSignatureValue(item?.variant_id),
            quantity: normalizeBundleSignatureValue(item?.quantity),
            is_required: Boolean(item?.is_required),
            is_default: Boolean(item?.is_default),
            price: normalizeBundleSignatureValue(item?.price),
            cost_price: normalizeBundleSignatureValue(item?.cost_price),
        })),
    }))
);

const appendProductImageSubmissionPayload = (formData, imagePayload) => {
    if (formData instanceof FormData) {
        formData.append('sync_images', '1');
        imagePayload.order.forEach((token) => formData.append('image_order[]', token));
        if (imagePayload.primaryToken) {
            formData.append('primary_image_token', imagePayload.primaryToken);
        }
        imagePayload.files.forEach((file) => formData.append('images[]', file));
        return;
    }

    if (formData && typeof formData === 'object') {
        formData.sync_images = true;
        formData.image_order = imagePayload.order;
        if (imagePayload.primaryToken) {
            formData.primary_image_token = imagePayload.primaryToken;
        }
    }
};

const normalizeProductVideoItems = (items = [], fallbackUrl = '') => {
    const sourceItems = Array.isArray(items) ? items : [];
    const mappedItems = sourceItems.map((item, index) => {
        if (item && typeof item === 'object') {
            return {
                title: String(item.title ?? item.name ?? ''),
                url: String(item.url ?? item.video_url ?? ''),
            };
        }

        return {
            title: `Video ${index + 1}`,
            url: String(item ?? ''),
        };
    });

    if (mappedItems.length === 0 && fallbackUrl) {
        mappedItems.push({ title: 'Video 1', url: String(fallbackUrl) });
    }

    const seen = new Set();
    return mappedItems
        .map((item, index) => ({
            title: item.title || `Video ${index + 1}`,
            url: item.url,
        }))
        .filter((item) => {
            if (!item.url) {
                return false;
            }

            const key = item.url.toLowerCase();
            if (seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
};

const normalizeProductVideoDraftItems = (items = [], fallbackUrl = '') => {
    const sourceItems = Array.isArray(items) ? items : [];
    const mappedItems = sourceItems.map((item, index) => {
        if (item && typeof item === 'object') {
            return {
                title: String(item.title ?? item.name ?? '').trim(),
                url: String(item.url ?? item.video_url ?? '').trim(),
            };
        }

        return {
            title: `Video ${index + 1}`,
            url: String(item ?? '').trim(),
        };
    });

    if (mappedItems.length === 0 && fallbackUrl) {
        mappedItems.push({ title: 'Video 1', url: String(fallbackUrl).trim() });
    }

    return mappedItems;
};

const buildVariantImagePickerPosition = (anchorRect, panelWidth = 336, panelHeight = 356) => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const resolvedWidth = Math.min(panelWidth, Math.max(280, viewportWidth - 32));
    const fallbackTop = 120;
    const fallbackLeft = Math.max(16, viewportWidth - resolvedWidth - 16);

    if (!anchorRect) {
        return {
            top: fallbackTop,
            left: fallbackLeft,
            width: resolvedWidth,
        };
    }

    const preferredLeft = anchorRect.left + (anchorRect.width / 2) - (resolvedWidth / 2);
    const left = Math.min(
        Math.max(16, preferredLeft),
        Math.max(16, viewportWidth - resolvedWidth - 16),
    );
    const preferredTop = anchorRect.bottom + 10;
    const top = preferredTop + panelHeight > viewportHeight - 16
        ? Math.max(16, anchorRect.top - panelHeight - 10)
        : preferredTop;

    return {
        top,
        left,
        width: resolvedWidth,
    };
};

const AI_INSTRUCTION_SUGGESTIONS = [
    'Viết ngắn gọn hơn, súc tích hơn.',
    'Trình bày theo bố cục chuẩn: mở bài, chất liệu, ý nghĩa, bài trí.',
    'Thêm gợi ý vị trí ảnh minh họa phù hợp trong bài.',
    'Giọng văn sang trọng, dễ hiểu, phù hợp khách mua quà và trưng bày.',
];

const DraggableImage = ({
    img,
    index,
    moveImage,
    handleSetPrimary,
    handleDeleteImage,
    isSelected,
    toggleSelectImage,
    isDragSelecting,
    handlePreviewImage,
}) => {
    const ref = useRef(null);
    const [, drop] = useDrop({
        accept: ItemType.IMAGE,
        hover(item, monitor) {
            if (!ref.current) return;
            const dragIndex = item.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;
            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleX = (hoverBoundingRect.right - hoverBoundingRect.left) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientX = clientOffset.x - hoverBoundingRect.left;
            if (dragIndex < hoverIndex && hoverClientX < hoverMiddleX) return;
            if (dragIndex > hoverIndex && hoverClientX > hoverMiddleX) return;
            moveImage(dragIndex, hoverIndex);
            item.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag({
        type: ItemType.IMAGE,
        item: () => ({ id: img.id, index }),
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    drag(drop(ref));

    // Get display size (either from file object or cached property)
    const fileSize = img.file ? img.file.size : (img.file_size || 0);

    // Extract file name: Use the uploaded file's original name, or extract from URL if it's already saved
    const getFileName = () => {
        if (img.file && img.file.name) return img.file.name;
        if (img.file_name) return img.file_name;
        if (img.image_url) {
            try {
                const parts = img.image_url.split('/');
                return parts[parts.length - 1].split('?')[0];
            } catch {
                return `Ảnh #${index + 1}`;
            }
        }
        return `Ảnh #${index + 1}`;
    };

    const fileName = getFileName();

    return (
        <div
            ref={ref}
            className={`group bg-white border rounded shadow-sm overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md image-item-card cursor-pointer select-none relative shrink-0 w-[calc(100%/8-12px)] min-w-[120px] ${isSelected ? 'ring-2 ring-gold border-gold bg-gold/5' : img.is_primary ? 'border-primary ring-1 ring-primary/20 bg-primary/[0.02]' : 'border-stone/15 hover:border-primary/40'} ${isDragging ? 'opacity-30 scale-95' : 'opacity-100'}`}
            data-id={img.id}
            onMouseDown={(e) => {
                if (e.target.closest('button')) return;
                toggleSelectImage(img.id);
            }}
            onMouseEnter={() => {
                if (isDragSelecting) {
                    toggleSelectImage(img.id, true);
                }
            }}
        >
            {/* Checkmark mark for selection */}
            {isSelected && (
                <div className="absolute top-1 right-1 z-30 bg-gold text-white rounded p-0.5 shadow-sm animate-fade-in-up">
                    <span className="material-symbols-outlined text-[14px]">check</span>
                </div>
            )}

            {/* Image Thumbnail Area - Fixed small ratio */}
            <div
                className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-stone/5"
                onDoubleClick={(e) => {
                    if (e.target.closest('button')) {
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    handlePreviewImage?.(img.image_url, fileName);
                }}
            >
                <img
                    src={img.image_url || null}
                    alt={fileName}
                    className="h-full w-full cursor-zoom-in object-cover transition-transform duration-700 group-hover:scale-105"
                />

                {/* Optimizing Overlay */}
                {img.optimizing && (
                    <div className="absolute inset-0 bg-white/70 backdrop-blur-[2px] flex flex-col items-center justify-center z-20">
                        <span className="material-symbols-outlined text-[24px] text-primary animate-spin mb-1">refresh</span>
                        <span className="text-[10px] uppercase font-bold text-primary tracking-wider">Đang tối ưu...</span>
                    </div>
                )}

                {/* Action Overlay (Hover) */}
                <div className="pointer-events-none absolute inset-0 z-10 flex cursor-move flex-col items-center justify-center gap-2 bg-primary/80 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                    {!img.is_primary && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSetPrimary(img.id); }}
                            className="bg-white text-primary px-3 py-1.5 text-[11px] font-bold uppercase rounded shadow-sm hover:bg-gold hover:text-white transition-colors animate-fade-in-up"
                        >
                            Chọn làm ảnh chính
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteImage(img.id); }}
                        className="bg-brick/90 text-white size-8 flex items-center justify-center rounded-sm hover:bg-brick transition-colors shadow-lg animate-fade-in-up delay-75"
                        title="Xóa ảnh"
                    >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                </div>

                {/* Badges */}
                {img.is_primary && (
                    <div className="absolute top-2 left-2 z-20 bg-gold text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">verified</span>
                        Ảnh đại diện
                    </div>
                )}
                {index === 0 && !img.is_primary && (
                    <div className="absolute top-2 left-2 z-20 bg-primary/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider shadow-sm border border-white/20">
                        Sắp xếp #1
                    </div>
                )}
            </div>

            {/* Info Footer */}
            <div className="flex-1 flex flex-col justify-center px-2 py-1.5 border-t border-stone/10 bg-white text-center cursor-move">
                <p className="text-[10px] font-bold text-primary truncate w-full mb-0.5" title={fileName}>
                    {fileName}
                </p>
                <div className="flex items-center justify-center">
                    {img.optimizing ? (
                        <span className="text-[9px] italic text-gold animate-pulse">Đang nén...</span>
                    ) : (
                        <span className="text-[9px] font-bold text-stone/40 bg-stone/5 px-1.5 py-0.5 rounded border border-stone/10 font-mono tracking-tight">
                            {fileSize ? formatBytes(fileSize) : '-- KB'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

const ImageLightboxModal = ({ image, onClose }) => {
    useEffect(() => {
        if (!image?.url) {
            return undefined;
        }

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [image?.url, onClose]);

    if (!image?.url) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6">
            <motion.button
                type="button"
                aria-label="Đóng xem ảnh lớn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/80 backdrop-blur-[2px]"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 8 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onClick={(e) => e.stopPropagation()}
                className="relative z-10 flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-white/10 bg-[#120d08] shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
            >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white/80">
                    <p className="min-w-0 truncate text-[12px] font-bold uppercase tracking-[0.16em]">
                        {image.alt || 'Xem ảnh lớn'}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 rounded-full bg-white/10 p-1 text-white transition-colors hover:bg-white/20"
                        title="Đóng"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
                <div className="flex min-h-[240px] items-center justify-center bg-black/20 p-4 sm:p-6">
                    <img
                        src={image.url}
                        alt={image.alt || 'Ảnh xem trước'}
                        className="max-h-[78vh] max-w-full object-contain"
                    />
                </div>
            </motion.div>
        </div>
    );
};

const DraggableBundleItem = ({
    index,
    optionId,
    item,
    moveBundleItem,
    handleSetDefaultInOption,
    handleUpdateBundleItemVariant,
    bundleItemVariants,
    handleUpdateBundleItemQty,
    handleRemoveItemFromOption,
    formatNumberOutput,
    isSortingMode
}) => {
    const ref = useRef(null);
    const { showToast } = useUI();
    const [, drop] = useDrop({
        accept: `bundle_item_${optionId}`,
        hover(draggedItem, monitor) {
            if (!ref.current) return;
            const dragIndex = draggedItem.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;
            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;
            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;
            moveBundleItem(optionId, dragIndex, hoverIndex);
            draggedItem.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag({
        type: `bundle_item_${optionId}`,
        item: () => ({ id: item.entry_id || item.id, index, optionId }),
        canDrag: isSortingMode,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    drag(drop(ref));

    return (
        <tr
            ref={ref}
            className={`border-b border-stone/5 transition-colors group/row ${isDragging ? 'opacity-30 bg-gold/5' : 'hover:bg-gold/[0.02]'} ${isSortingMode ? 'cursor-move' : ''}`}
        >
            <td className="pl-5 py-3 text-center border-r border-gold/10">
                {isSortingMode ? (
                    <div className="flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-stone/40 group-hover/row:text-gold transition-colors">reorder</span>
                        <span className="text-[11px] font-black text-primary bg-stone/5 w-6 h-6 flex items-center justify-center rounded-full border border-stone/10">
                            {index + 1}
                        </span>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => handleSetDefaultInOption(optionId, item.entry_id || item.id)}
                        className={`size-6 mx-auto rounded-full flex items-center justify-center transition-all ${item.is_default ? 'bg-primary text-white shadow-sm' : 'bg-stone/10 text-black/20 hover:bg-stone/20'}`}
                        title={item.is_default ? "Sản phẩm mặc định" : "Đặt làm mặc định"}
                    >
                        <span className="material-symbols-outlined text-[16px]">{item.is_default ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
                    </button>
                )}
            </td>
            <td className="px-3 py-3 border-r border-gold/10">
                <div className="flex items-center gap-3">
                    <img src={item.image_url || 'https://placehold.co/100'} alt="" className="size-10 object-cover rounded border border-stone/10 bg-white" />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <p className="text-[13px] font-bold text-black truncate" title={item.name}>{item.name}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(item.name);
                                    showToast('Đã sao chép tên sản phẩm', 'success');
                                }}
                                className="opacity-0 group-hover/row:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                title="Sao chép tên"
                            >
                                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                        </div>
                        <div className="flex items-center gap-1">
                            <p className="text-[10px] font-mono text-gold uppercase">{item.sku}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(item.sku);
                                    showToast('Đã sao chép mã sản phẩm', 'success');
                                }}
                                className="opacity-0 group-hover/row:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                title="Sao chép SKU"
                            >
                                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                        </div>
                    </div>
                </div>
            </td>
            <td className="px-3 py-3 border-r border-gold/10">
                {item.type === 'configurable' ? (
                    <div className="space-y-1">
                        <select
                        value={item.variant_id || ''}
                        onChange={(e) => handleUpdateBundleItemVariant(optionId, item.entry_id || item.id, e.target.value)}
                        className="w-full bg-stone/5 border border-stone/10 rounded px-2 py-1 text-[11px] font-bold text-black focus:outline-none focus:border-gold/30"
                    >
                        <option value="">Chọn phân loại...</option>
                        {(bundleItemVariants[item.product_id || item.id] || []).map(v => (
                            <option key={v.id} value={v.id}>{v.name || (v.attribute_values || []).map(av => av.value).join(' / ')}</option>
                        ))}
                    </select>
                    {!item.variant_id ? (
                        <p className="text-[10px] font-bold text-brick">Bắt buộc chọn biến thể con để bundle ghi nhận đúng tồn kho.</p>
                    ) : null}
                    {false ? (
                        <p className="text-[10px] font-bold text-brick">Báº¯t buá»™c chá»n biáº¿n thá»ƒ con Ä‘á»ƒ bundle ghi nháº­n Ä‘Ãºng tá»“n kho.</p>
                    ) : null}
                    </div>
                ) : (
                    <span className="text-[11px] text-black/60 italic">Sản phẩm đơn</span>
                )}
            </td>
            <td className="px-3 py-3 text-center border-r border-gold/10">
                <p className="text-[12px] font-black text-black">{formatNumberOutput(item.price)}₫</p>
            </td>
            <td className="px-3 py-3 text-center border-r border-gold/10">
                <div className="flex items-center justify-center gap-1 bg-white border border-stone/10 rounded-full px-2 py-0.5 mx-auto w-fit">
                    <button
                        type="button"
                        onClick={() => handleUpdateBundleItemQty(optionId, item.entry_id || item.id, Math.max(1, item.quantity - 1))}
                        className="material-symbols-outlined text-[16px] text-black/40 hover:text-brick"
                    >remove</button>
                    <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => handleUpdateBundleItemQty(optionId, item.entry_id || item.id, e.target.value)}
                        className="w-8 text-center bg-transparent border-none p-0 text-[12px] font-black text-black focus:ring-0"
                    />
                    <button
                        type="button"
                        onClick={() => handleUpdateBundleItemQty(optionId, item.entry_id || item.id, item.quantity + 1)}
                        className="material-symbols-outlined text-[16px] text-black/40 hover:text-primary"
                    >add</button>
                </div>
            </td>
            <td className="px-3 py-3 text-right">
                <button
                    type="button"
                    onClick={() => handleRemoveItemFromOption(optionId, item.entry_id || item.id)}
                    className="size-8 rounded-full flex items-center justify-center text-black/20 hover:text-brick hover:bg-brick/5 opacity-0 group-hover/row:opacity-100 transition-all"
                >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
            </td>
        </tr>
    );
};

const DraggableBundleOptionRow = ({
    index,
    option,
    optionCount,
    moveBundleOption,
    onMoveUp,
    onMoveDown,
}) => {
    const ref = useRef(null);
    const productCount = Array.isArray(option?.items) ? option.items.length : 0;
    const defaultItem = option?.items?.find((item) => item.is_default) || option?.items?.[0] || null;
    const linkedPostTitle = option?.post_title || 'Chua lien ket bai viet';
    const isFirst = index === 0;
    const isLast = index === optionCount - 1;
    const optionIsInternal = isInternalBundleOption(option);

    const [, drop] = useDrop({
        accept: 'bundle_option_group',
        hover(draggedItem, monitor) {
            if (!ref.current) return;
            const dragIndex = draggedItem.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;

            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const clientOffset = monitor.getClientOffset();
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;

            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

            moveBundleOption(dragIndex, hoverIndex);
            draggedItem.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag({
        type: 'bundle_option_group',
        item: () => ({ id: option.id, index }),
        canDrag: optionCount > 1,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    drag(drop(ref));

    return (
        <tr
            ref={ref}
            className={`border-b border-stone/10 transition-colors ${isDragging ? 'bg-gold/5 opacity-40' : optionIsInternal ? 'bg-amber-50/65 hover:bg-amber-50' : 'hover:bg-gold/[0.03]'}`}
        >
            <td className="w-[88px] px-4 py-3 border-r border-stone/10">
                <div className="flex items-center justify-center gap-2">
                    <span className={`material-symbols-outlined text-[18px] ${optionCount > 1 ? 'cursor-move text-stone/45' : 'text-stone/20'}`}>
                        reorder
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/15 bg-gold/5 text-[11px] font-black text-primary">
                        {index + 1}
                    </span>
                </div>
            </td>
            <td className="px-4 py-3 border-r border-stone/10">
                <div className="min-w-0">
                    <p className="truncate text-[13px] font-black text-primary" title={option?.title || `Tuy chon ${index + 1}`}>
                        {option?.title || `Tuy chon ${index + 1}`}
                    </p>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                        {optionIsInternal && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">
                                {'N\u1ed9i b\u1ed9'}
                            </span>
                        )}
                        <p className="truncate text-[11px] text-stone/55" title={defaultItem?.name || 'Chua co san pham mac dinh'}>
                            {defaultItem?.name ? `Mac dinh: ${defaultItem.name}` : 'Chua co san pham trong tuy chon nay'}
                        </p>
                    </div>
                </div>
            </td>
            <td className="px-4 py-3 border-r border-stone/10">
                <p className={`truncate text-[11px] ${option?.post_title ? 'font-semibold text-gold' : 'italic text-stone/45'}`} title={linkedPostTitle}>
                    {linkedPostTitle}
                </p>
            </td>
            <td className="w-[120px] px-4 py-3 text-center border-r border-stone/10">
                <span className="inline-flex rounded-full bg-primary/[0.06] px-3 py-1 text-[11px] font-black text-primary">
                    {productCount} SP
                </span>
            </td>
            <td className="w-[124px] px-4 py-3">
                <div className="flex items-center justify-center gap-2">
                    <button
                        type="button"
                        onClick={onMoveUp}
                        disabled={isFirst}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone/15 text-stone/45 transition-all hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Di chuyen len"
                    >
                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                    </button>
                    <button
                        type="button"
                        onClick={onMoveDown}
                        disabled={isLast}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone/15 text-stone/45 transition-all hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Di chuyen xuong"
                    >
                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                    </button>
                </div>
            </td>
        </tr>
    );
};

const DraggableBundleItemSorterRow = ({
    optionId,
    index,
    item,
    itemCount,
    positionValue,
    moveBundleItemQuickSorterItem,
    onPositionChange,
    onPositionCommit,
    onMoveUp,
    onMoveDown,
    formatNumberOutput,
}) => {
    const ref = useRef(null);
    const entryKey = getBundleItemEntryKey(item);
    const isFirst = index === 0;
    const isLast = index === itemCount - 1;

    const [, drop] = useDrop({
        accept: `bundle_item_quick_sort_${optionId}`,
        hover(draggedItem, monitor) {
            if (!ref.current) return;
            const dragIndex = draggedItem.index;
            const hoverIndex = index;
            if (dragIndex === hoverIndex) return;

            const hoverBoundingRect = ref.current?.getBoundingClientRect();
            const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
            const clientOffset = monitor.getClientOffset();
            if (!clientOffset) return;
            const hoverClientY = clientOffset.y - hoverBoundingRect.top;

            if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) return;
            if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) return;

            moveBundleItemQuickSorterItem(dragIndex, hoverIndex);
            draggedItem.index = hoverIndex;
        },
    });

    const [{ isDragging }, drag] = useDrag({
        type: `bundle_item_quick_sort_${optionId}`,
        item: () => ({ id: entryKey, index }),
        canDrag: itemCount > 1,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    });

    drag(drop(ref));

    const quantity = Math.max(1, Number(item?.quantity) || 1);
    const displayVariantLabel = String(item?.variant_label || '').trim();

    return (
        <div
            ref={ref}
            className={`grid grid-cols-[88px_minmax(0,1fr)_132px_104px] border-b border-stone/10 transition-colors ${isDragging ? 'bg-gold/5 opacity-50' : 'bg-white hover:bg-gold/[0.03]'}`}
        >
            <div className="flex items-center justify-center gap-2 border-r border-stone/10 px-3 py-3">
                <span className={`material-symbols-outlined text-[18px] ${itemCount > 1 ? 'cursor-move text-stone/45' : 'text-stone/20'}`}>
                    reorder
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/15 bg-gold/5 text-[11px] font-black text-primary">
                    {index + 1}
                </span>
            </div>

            <div className="border-r border-stone/10 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                    <img
                        src={item?.image_url || 'https://placehold.co/100'}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-sm border border-stone/10 bg-white object-cover shadow-sm"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-black text-primary" title={item?.name || ''}>
                                {item?.name || 'Sản phẩm bundle'}
                            </p>
                            {item?.is_default ? (
                                <span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.06] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-primary">
                                    Default
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="rounded-full border border-gold/10 bg-gold/[0.08] px-2 py-0.5 font-mono font-black uppercase text-gold">
                                {item?.sku || 'NO-SKU'}
                            </span>
                            {displayVariantLabel ? (
                                <span className="truncate rounded-full border border-stone/10 bg-stone/5 px-2 py-0.5 font-semibold text-stone/60" title={displayVariantLabel}>
                                    {displayVariantLabel}
                                </span>
                            ) : null}
                            <span className="rounded-full border border-stone/10 bg-white px-2 py-0.5 font-semibold text-stone/55">
                                SL {quantity}
                            </span>
                            <span className="rounded-full border border-brick/10 bg-brick/[0.06] px-2 py-0.5 font-black text-brick">
                                {formatNumberOutput(item?.price || 0)}₫
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="border-r border-stone/10 px-4 py-3">
                <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-gold/15 bg-white px-3 py-1 shadow-sm">
                    <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={positionValue}
                        onChange={(event) => onPositionChange(entryKey, event.target.value)}
                        onBlur={(event) => onPositionCommit(entryKey, event.target.value)}
                        onFocus={(event) => event.target.select()}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                onPositionCommit(entryKey, event.currentTarget.value);
                                event.currentTarget.blur();
                            }
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                onPositionCommit(entryKey, index + 1);
                                event.currentTarget.blur();
                            }
                        }}
                        className="w-12 border-none bg-transparent p-0 text-center text-[12px] font-black text-primary focus:ring-0"
                        aria-label={`Vị trí của ${item?.name || 'sản phẩm bundle'}`}
                    />
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-stone/35">
                        / {itemCount}
                    </span>
                </div>
            </div>

            <div className="px-4 py-3">
                <div className="flex items-center justify-center gap-2">
                    <button
                        type="button"
                        onClick={onMoveUp}
                        disabled={isFirst}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone/15 text-stone/45 transition-all hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Di chuyển lên"
                    >
                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                    </button>
                    <button
                        type="button"
                        onClick={onMoveDown}
                        disabled={isLast}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone/15 text-stone/45 transition-all hover:border-primary/25 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                        title="Di chuyển xuống"
                    >
                        <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const BundleOptionPostSelector = ({
    option,
    blogSearchQuery,
    setBlogSearchQuery,
    isSearchingBlog,
    blogResults,
    searchBlogPosts,
    onSelectPost,
    onClearPost,
}) => {
    const searchKey = option.id;
    const selectedPostId = option.post_id ?? '';
    const selectedPostTitle = option.post_title || (selectedPostId ? `Bài viết #${selectedPostId}` : '');

    return (
        <div className="relative w-full max-w-[360px] min-w-[240px] shrink">
            <div className="flex items-center gap-2 rounded-sm border border-gold/15 bg-white/90 px-3 py-2 shadow-sm">
                <span className="material-symbols-outlined text-[17px] text-gold/70 shrink-0">article</span>
                {selectedPostId ? (
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-stone/35">Bài viết web</p>
                            <p className="truncate text-[12px] font-bold text-gold" title={selectedPostTitle}>
                                {selectedPostTitle}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onClearPost(option.id)}
                            className="shrink-0 text-stone/40 transition-colors hover:text-brick"
                            title="Bỏ liên kết bài viết"
                        >
                            <span className="material-symbols-outlined text-[16px]">cancel</span>
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="relative min-w-0 flex-1">
                            <input
                                type="text"
                                value={blogSearchQuery[searchKey] || ''}
                                onChange={(e) => {
                                    const query = e.target.value;
                                    setBlogSearchQuery(prev => ({ ...prev, [searchKey]: query }));
                                    searchBlogPosts(searchKey, query);
                                }}
                                placeholder="Tìm bài viết trên web..."
                                className="w-full bg-transparent border-none p-0 pr-5 text-[12px] font-semibold text-primary placeholder:text-stone/35 focus:outline-none focus:ring-0"
                            />
                            {isSearchingBlog[searchKey] && (
                                <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[12px] animate-spin text-gold">refresh</span>
                            )}
                        </div>
                        <span className="material-symbols-outlined text-[16px] text-stone/25 shrink-0">search</span>
                    </>
                )}
            </div>

            {blogResults[searchKey]?.length > 0 && !selectedPostId && (
                <div className="absolute left-0 right-0 top-full z-[120] mt-1 max-h-[220px] overflow-y-auto rounded-sm border border-stone/15 bg-white shadow-xl custom-scrollbar">
                    {blogResults[searchKey].map((post) => (
                        <button
                            key={post.id}
                            type="button"
                            onClick={() => onSelectPost(option.id, post)}
                            className="block w-full border-b border-stone/5 px-3 py-2 text-left transition-colors last:border-0 hover:bg-gold/5"
                        >
                            <p className="text-[11px] font-bold leading-tight text-primary">{post.title}</p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};


const formatNumberOutput = (num) => {
    return formatWholeMoneyInput(num);
};

const calculateBundleOptionSubtotal = (option) => {
    const items = Array.isArray(option?.items) ? option.items : [];
    return items.reduce((total, item) => {
        const unitPrice = normalizeWholeMoneyNumber(item?.price) ?? 0;
        const rawQuantity = Number(item?.quantity);
        const quantity = Number.isFinite(rawQuantity) ? Math.max(0, rawQuantity) : 0;
        return total + (unitPrice * quantity);
    }, 0);
};

const formatImportCostOutput = (num) => {
    return formatRoundedImportCost(num);
};

const formatImportCostInput = (num) => {
    return formatWholeMoneyInput(num);
};

const removeAccents = (str) => {
    return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
};

const generateSKUFromName = (name) => {
    if (!name) return '';
    let slug = removeAccents(name);
    slug = slug.replace(/[^a-zA-Z0-9\s-]/g, ''); // Remove special characters
    slug = slug.trim().replace(/\s+/g, '-'); // Spaces to hyphens
    slug = slug.toUpperCase();
    return slug.substring(0, 50); // Limit length
};

const normalizeSkuDraft = (value) => String(value || '').trim().replace(/\s+/g, '-');

const buildAutoVariantSkuList = (parentSku, variants) => {
    const baseSku = normalizeSkuDraft(parentSku);
    if (!baseSku) return variants;

    const usedSkus = new Set();

    return variants.map((variant) => {
        const manualSku = normalizeSkuDraft(variant?.sku);
        if (!variant?.sku_auto && manualSku) {
            usedSkus.add(manualSku);
            return { ...variant, sku: manualSku };
        }

        let index = 1;
        let candidate = `${baseSku}-V${index}`;
        while (usedSkus.has(candidate)) {
            index += 1;
            candidate = `${baseSku}-V${index}`;
        }

        usedSkus.add(candidate);

        return {
            ...variant,
            sku: candidate,
            sku_auto: true,
        };
    });
};

const createEmptyVariantQuickUpdateForm = () => ({
    price: '',
    expected_cost: '',
    weight: '',
    inventory_unit_id: '',
});

const cloneVariantDraft = (variant = {}) => ({
    ...variant,
    attributes: { ...(variant?.attributes || {}) },
});

const SIMPLE_TO_CONFIG_PRESET_ATTRIBUTES = ['Mẫu', 'Kích thước', 'Loại men'];
const isConvertedSimpleSourceVariant = (variant, parentId) => {
    const numericVariantId = Number(variant?.id);
    const numericParentId = Number(parentId);

    return (
        String(variant?.pivot?.link_type || '') === 'super_link'
        && Number(variant?.pivot?.position ?? -1) === 0
        && Number.isFinite(numericVariantId)
        && Number.isFinite(numericParentId)
        && numericVariantId > 0
        && numericParentId > 0
        && numericVariantId < numericParentId
    );
};

const isLocalDraftVariantId = (variantId) => {
    const normalizedVariantId = String(variantId || '');
    return normalizedVariantId.startsWith('new_') || normalizedVariantId.startsWith('manual_');
};

const areOrderedIdsEqual = (left = [], right = []) => (
    left.length === right.length
    && left.every((value, index) => String(value) === String(right[index]))
);

const buildInventoryUnitReorderPayload = (draftUnits = [], sourceUnits = []) => {
    const normalizedDraftUnits = Array.isArray(draftUnits)
        ? draftUnits.filter((unit) => unit?.id !== undefined && unit?.id !== null && unit?.id !== '')
        : [];

    const draftOrderById = new Map(
        normalizedDraftUnits.map((unit, index) => [String(unit.id), index])
    );

    const preferredDefaultId = String(
        (normalizedDraftUnits.find((unit) => unit.is_default) || normalizedDraftUnits[0] || {}).id || ''
    );

    const latestUnits = Array.isArray(sourceUnits) && sourceUnits.length
        ? sourceUnits
        : normalizedDraftUnits;

    const orderedUnits = latestUnits
        .filter((unit) => unit?.id !== undefined && unit?.id !== null && unit?.id !== '')
        .map((unit, index) => ({
            ...unit,
            _reorderIndex: draftOrderById.has(String(unit.id))
                ? draftOrderById.get(String(unit.id))
                : normalizedDraftUnits.length + index,
        }))
        .sort((left, right) => left._reorderIndex - right._reorderIndex);

    const ids = orderedUnits.map((unit) => unit.id);
    const defaultUnit = orderedUnits.find((unit) => String(unit.id) === preferredDefaultId)
        || orderedUnits.find((unit) => unit.is_default)
        || orderedUnits[0]
        || null;

    return {
        ids,
        defaultId: defaultUnit?.id || null,
    };
};

const resolveApiErrorMessage = (error, fallbackMessage) => {
    const validationMessage = Object.values(error?.response?.data?.errors || {})
        .flat()
        .find(Boolean);

    if (validationMessage) return validationMessage;
    if (error?.response?.status === 401) {
        return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    }

    return error?.response?.data?.message || fallbackMessage;
};

const createClientUploadError = (message) => {
    const error = new Error(message);
    error.userMessage = message;
    return error;
};

const extractUploadedImageUrl = (response) => {
    const primaryImage = response?.data?.image;

    return String(
        response?.data?.url
        || primaryImage?.large_url
        || primaryImage?.medium_url
        || primaryImage?.image_url
        || ''
    ).trim();
};

const isTransientImageUrl = (url) => {
    const normalizedUrl = String(url || '').trim().toLowerCase();
    return normalizedUrl.startsWith('blob:') || normalizedUrl.startsWith('data:');
};

const normalizePersistedImageUrl = (url) => {
    const normalizedUrl = String(url || '').trim();
    return isTransientImageUrl(normalizedUrl) ? '' : normalizedUrl;
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeHtmlAttribute = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const AI_PROTECTED_MEDIA_SELECTOR = 'picture, video, audio, iframe, img, object, embed, svg, canvas';

const protectDescriptionMediaHtml = (html) => {
    if (typeof document === 'undefined') {
        return {
            html,
            fragments: [],
        };
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');
    const fragments = [];
    const nodes = Array.from(wrapper.querySelectorAll(AI_PROTECTED_MEDIA_SELECTOR));

    nodes.forEach((node) => {
        if (!node?.parentNode || !wrapper.contains(node)) {
            return;
        }

        const token = `__AI_MEDIA_PLACEHOLDER_${fragments.length}__`;
        fragments.push({
            token,
            originalHtml: node.outerHTML,
        });

        const placeholder = document.createElement('span');
        placeholder.setAttribute('data-ai-media-placeholder', token);
        placeholder.textContent = token;
        node.replaceWith(placeholder);
    });

    return {
        html: wrapper.innerHTML,
        fragments,
    };
};

const restoreDescriptionMediaHtml = (html, fragments = []) => {
    let restoredHtml = String(html || '');

    fragments.forEach(({ token, originalHtml }) => {
        const escapedToken = escapeRegExp(token);
        restoredHtml = restoredHtml.replace(
            new RegExp(`<span\\b[^>]*data-ai-media-placeholder=["']${escapedToken}["'][^>]*>[\\s\\S]*?<\\/span>`, 'gi'),
            originalHtml
        );
        restoredHtml = restoredHtml.replace(new RegExp(escapedToken, 'g'), originalHtml);
    });

    return restoredHtml;
};

const uploadImageViaMediaApi = async (file) => {
    const validationMessage = validateImageFileForUpload(file);

    if (validationMessage) {
        throw createClientUploadError(validationMessage);
    }

    const uploadData = new FormData();
    uploadData.append('image', file);

    const response = await mediaApi.upload(uploadData);
    const imageUrl = extractUploadedImageUrl(response);

    if (!imageUrl) {
        throw createClientUploadError('API upload khong tra ve URL anh hop le.');
    }

    return imageUrl;
};

const resolveProductImageUploadErrorMessage = (error) => resolveImageUploadError(error).message;

const moveListItem = (items, fromIndex, toIndex) => {
    if (
        !Array.isArray(items)
        || fromIndex === toIndex
        || fromIndex < 0
        || toIndex < 0
        || fromIndex >= items.length
        || toIndex >= items.length
    ) {
        return items;
    }

    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
};

const getBundleItemEntryKey = (item) => String(item?.entry_id ?? item?.id ?? '');

const buildBundleItemSorterPositionDrafts = (items = []) => Object.fromEntries(
    (Array.isArray(items) ? items : []).map((item, index) => [getBundleItemEntryKey(item), String(index + 1)])
);

const createConvertVariantEntryId = () => `convert-variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const createConvertVariantDraft = (overrides = {}) => ({
    entry_id: createConvertVariantEntryId(),
    is_existing: false,
    value: '',
    name: '',
    sku: '',
    ...overrides,
});

const getConvertVariantValueKey = (value) => normalizeSearchText(value);

const normalizeConvertVariantOptionValues = (options = []) => {
    const seen = new Set();

    return (Array.isArray(options) ? options : [])
        .map((option, index) => ({
            id: option?.id ?? `convert-option-${index}`,
            value: String(option?.value || '').trim(),
            order: Number.isFinite(Number(option?.order)) ? Number(option.order) : index,
        }))
        .filter((option) => option.value)
        .filter((option) => {
            const key = getConvertVariantValueKey(option.value);

            if (!key || seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        })
        .sort((left, right) => {
            if (left.order !== right.order) {
                return left.order - right.order;
            }

            return left.value.localeCompare(right.value, 'vi');
        });
};

const resolveConvertVariantRawAttributeValue = (rawValue) => {
    if (Array.isArray(rawValue)) {
        return String(rawValue.find((item) => String(item || '').trim()) || '').trim();
    }

    return String(rawValue || '').trim();
};

const inferExistingConvertVariantValue = ({
    optionValues = [],
    rawAttributeValue,
    productName,
}) => {
    const normalizedOptions = normalizeConvertVariantOptionValues(optionValues);

    if (normalizedOptions.length === 0) {
        return '';
    }

    const resolvedAttributeValue = resolveConvertVariantRawAttributeValue(rawAttributeValue);
    const normalizedAttributeValue = getConvertVariantValueKey(resolvedAttributeValue);
    const normalizedProductName = getConvertVariantValueKey(productName);

    const rankedOptions = [...normalizedOptions].sort(
        (left, right) => right.value.length - left.value.length
    );

    const exactAttributeMatch = rankedOptions.find(
        (option) => getConvertVariantValueKey(option.value) === normalizedAttributeValue
    );
    if (exactAttributeMatch) {
        return exactAttributeMatch.value;
    }

    const partialAttributeMatch = rankedOptions.find((option) => (
        normalizedAttributeValue
        && normalizedAttributeValue.includes(getConvertVariantValueKey(option.value))
    ));
    if (partialAttributeMatch) {
        return partialAttributeMatch.value;
    }

    const productNameMatch = rankedOptions.find((option) => (
        normalizedProductName
        && normalizedProductName.includes(getConvertVariantValueKey(option.value))
    ));
    if (productNameMatch) {
        return productNameMatch.value;
    }

    return normalizedOptions[0]?.value || '';
};

const buildConvertVariantAutoName = (parentName, sourceName, value) => {
    const resolvedBaseName = String(parentName || sourceName || '').trim();

    if (!resolvedBaseName) {
        return value ? `Bien the - ${value}` : 'Bien the';
    }

    return value ? `${resolvedBaseName} - ${value}` : resolvedBaseName;
};

const buildConvertVariantsFromOptionValues = ({
    optionValues = [],
    previousVariants = [],
    existingProductName = '',
    existingProductSku = '',
    parentName = '',
    existingValue = '',
}) => {
    const normalizedOptions = normalizeConvertVariantOptionValues(optionValues).map((option) => option.value);
    const normalizedExistingValue = String(existingValue || '').trim();
    const orderedValues = normalizedExistingValue
        ? [
            normalizedExistingValue,
            ...normalizedOptions.filter((value) => (
                getConvertVariantValueKey(value) !== getConvertVariantValueKey(normalizedExistingValue)
            )),
        ]
        : normalizedOptions;

    const previousExistingVariant = Array.isArray(previousVariants)
        ? previousVariants.find((variant) => variant?.is_existing)
        : null;
    const previousVariantsByValue = new Map();

    (Array.isArray(previousVariants) ? previousVariants : []).forEach((variant) => {
        if (variant?.is_existing) {
            return;
        }

        const key = getConvertVariantValueKey(variant?.value);
        if (!key || previousVariantsByValue.has(key)) {
            return;
        }

        previousVariantsByValue.set(key, variant);
    });

    const firstVariantValue = orderedValues[0] || String(previousExistingVariant?.value || '').trim();
    const firstVariant = {
        ...(previousExistingVariant || createConvertVariantDraft()),
        entry_id: previousExistingVariant?.entry_id || createConvertVariantEntryId(),
        is_existing: true,
        value: firstVariantValue,
        name: String(
            previousExistingVariant?.name
            || existingProductName
            || buildConvertVariantAutoName(parentName, existingProductName, firstVariantValue)
        ).trim(),
        sku: String(previousExistingVariant?.sku || existingProductSku || '').trim(),
    };

    const nextVariants = [firstVariant];

    orderedValues
        .filter((value) => getConvertVariantValueKey(value) !== getConvertVariantValueKey(firstVariantValue))
        .forEach((value) => {
            const previousVariant = previousVariantsByValue.get(getConvertVariantValueKey(value));

            nextVariants.push(createConvertVariantDraft({
                ...(previousVariant || {}),
                entry_id: previousVariant?.entry_id || createConvertVariantEntryId(),
                value,
                name: String(
                    previousVariant?.name
                    || buildConvertVariantAutoName(parentName, existingProductName, value)
                ).trim(),
                sku: String(previousVariant?.sku || '').trim(),
            }));
        });

    return nextVariants;
};

const areConvertVariantListsEqual = (left = [], right = []) => {
    if (left === right) {
        return true;
    }

    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }

    return left.every((variant, index) => {
        const nextVariant = right[index];

        return (
            String(variant?.entry_id || '') === String(nextVariant?.entry_id || '')
            && Boolean(variant?.is_existing) === Boolean(nextVariant?.is_existing)
            && String(variant?.value || '') === String(nextVariant?.value || '')
            && String(variant?.name || '') === String(nextVariant?.name || '')
            && String(variant?.sku || '') === String(nextVariant?.sku || '')
        );
    });
};

const buildInitialConvertToConfigurableForm = (sourceProduct = {}, fallbackProduct = {}) => {
    const resolvedName = String(sourceProduct?.name || fallbackProduct?.name || '').trim();
    const resolvedSku = String(sourceProduct?.sku || fallbackProduct?.sku || '').trim();

    return {
        parent_name: resolvedName,
        attribute_source: 'preset',
        preset_attribute_name: SIMPLE_TO_CONFIG_PRESET_ATTRIBUTES[0],
        attribute_id: '',
        custom_attribute_name: '',
        variants: [
            createConvertVariantDraft({
                is_existing: true,
                value: 'Mẫu gốc',
                name: resolvedName,
                sku: resolvedSku,
            }),
        ],
    };
};

const Field = ({ label, children, className = "", labelClassName = "" }) => (
    <div className={`relative border border-stone/30 rounded-sm px-3 focus-within:border-primary/30 transition-colors flex items-center min-h-[40px] bg-white ${className}`}>
        <label className={`absolute -top-3 left-2 bg-white px-1.5 font-sans text-[13px] font-bold text-orange-700 tracking-tight leading-none ${labelClassName}`}>
            {label}
        </label>
        <div className="w-full flex items-center pt-0.5 text-[14px]">
            {children}
        </div>
    </div>
);

const OverflowPreviewInput = ({
    value,
    name,
    onChange,
    type = 'text',
    tooltipLabel,
    editor = 'input',
    rows = 3,
    className = "",
    wrapperClassName = "",
    mirrorClassName = "",
    popoverInputClassName = "",
    onClick,
    onBlur,
    onFocus,
    ...props
}) => {
    const wrapperRef = useRef(null);
    const mainInputRef = useRef(null);
    const measureRef = useRef(null);
    const popoverInputRef = useRef(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isPinnedOpen, setIsPinnedOpen] = useState(false);
    const [draftValue, setDraftValue] = useState(String(value ?? ''));
    const valueSnapshotRef = useRef(String(value ?? ''));

    const normalizedValue = String(value ?? '');
    const hasValue = normalizedValue.trim().length > 0;

    const syncOverflowState = useCallback(() => {
        const wrapperWidth = wrapperRef.current?.clientWidth || 0;
        const measureWidth = measureRef.current?.scrollWidth || 0;
        const hasOverflow = hasValue && wrapperWidth > 0 && measureWidth > (wrapperWidth - 6);
        setIsOverflowing(hasOverflow);
    }, [hasValue, normalizedValue]);

    useEffect(() => {
        syncOverflowState();
    }, [syncOverflowState]);

    useEffect(() => {
        setDraftValue(normalizedValue);
        if (!isPinnedOpen) {
            valueSnapshotRef.current = normalizedValue;
        }
    }, [isPinnedOpen, normalizedValue]);

    useEffect(() => {
        if (!wrapperRef.current || typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const observer = new ResizeObserver(() => {
            syncOverflowState();
        });

        observer.observe(wrapperRef.current);

        return () => {
            observer.disconnect();
        };
    }, [syncOverflowState]);

    const emitChange = useCallback((nextValue) => {
        if (typeof onChange !== 'function') {
            return;
        }

        onChange({
            target: {
                name,
                value: nextValue,
                type,
                checked: false,
            },
        });
    }, [name, onChange, type]);

    const closePopover = useCallback(({ restore = false, focusMain = false } = {}) => {
        if (restore) {
            const previousValue = valueSnapshotRef.current;
            setDraftValue(previousValue);
            emitChange(previousValue);
        }

        setIsPinnedOpen(false);
        setIsHovered(false);

        if (focusMain) {
            requestAnimationFrame(() => {
                if (!mainInputRef.current) {
                    return;
                }

                mainInputRef.current.focus({ preventScroll: true });
                if (typeof mainInputRef.current.select === 'function') {
                    mainInputRef.current.select();
                }
            });
        }
    }, [emitChange]);

    const openPinnedPopover = useCallback((focusEditor = false) => {
        if (!isOverflowing && !isPinnedOpen) {
            return;
        }

        valueSnapshotRef.current = normalizedValue;
        setIsPinnedOpen(true);

        if (focusEditor) {
            requestAnimationFrame(() => {
                popoverInputRef.current?.focus({ preventScroll: true });
                if (typeof popoverInputRef.current?.select === 'function' && editor !== 'textarea') {
                    popoverInputRef.current.select();
                }
            });
        }
    }, [editor, isOverflowing, isPinnedOpen, normalizedValue]);

    const handleBaseInputChange = useCallback((event) => {
        setDraftValue(event.target.value);
        onChange?.(event);
    }, [onChange]);

    const handlePopoverInputChange = useCallback((event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        emitChange(nextValue);
    }, [emitChange]);

    const handlePopoverKeyDown = useCallback((event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closePopover({ restore: true, focusMain: true });
            return;
        }

        if (editor === 'textarea') {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                closePopover({ focusMain: true });
            }
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            closePopover({ focusMain: true });
        }
    }, [closePopover, editor]);

    useEffect(() => {
        if (!isPinnedOpen) {
            return undefined;
        }

        const handlePointerDownOutside = (event) => {
            if (!wrapperRef.current?.contains(event.target)) {
                setIsPinnedOpen(false);
                setIsHovered(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDownOutside);
        document.addEventListener('touchstart', handlePointerDownOutside);

        return () => {
            document.removeEventListener('mousedown', handlePointerDownOutside);
            document.removeEventListener('touchstart', handlePointerDownOutside);
        };
    }, [isPinnedOpen]);

    const isPopoverVisible = (isOverflowing || isPinnedOpen) && (isHovered || isPinnedOpen);
    const isTextareaEditor = editor === 'textarea';

    return (
        <div
            ref={wrapperRef}
            className={`relative flex-1 min-w-0 ${wrapperClassName}`}
            onMouseEnter={() => {
                if (isOverflowing) {
                    setIsHovered(true);
                }
            }}
            onMouseLeave={() => {
                setIsHovered(false);
            }}
        >
            <input
                {...props}
                ref={mainInputRef}
                name={name}
                type={type}
                value={value}
                onChange={handleBaseInputChange}
                onClick={(event) => {
                    onClick?.(event);
                    if (isOverflowing) {
                        openPinnedPopover(true);
                    }
                }}
                onBlur={onBlur}
                onFocus={onFocus}
                title={isOverflowing ? normalizedValue : undefined}
                className={className}
            />

            <span
                ref={measureRef}
                aria-hidden="true"
                className={`pointer-events-none invisible absolute left-0 top-0 whitespace-pre ${mirrorClassName}`}
            >
                {normalizedValue}
            </span>

            <AnimatePresence>
                {isPopoverVisible ? (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        className="absolute left-0 top-full z-[80] mt-2 w-[min(26rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-gold/15 bg-white shadow-[0_18px_42px_rgba(26,48,84,0.18)]"
                        onMouseDown={() => {
                            if (!isPinnedOpen) {
                                valueSnapshotRef.current = normalizedValue;
                                setIsPinnedOpen(true);
                            }
                        }}
                    >
                        <div className="flex items-start justify-between gap-3 border-b border-stone/10 px-3 py-2.5">
                            <div className="min-w-0">
                                {tooltipLabel ? (
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gold/85">
                                        {tooltipLabel}
                                    </p>
                                ) : null}
                                <p className="mt-1 text-[11px] font-medium text-stone/45">
                                    Xem đầy đủ và sửa nhanh ngay tại đây.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={() => closePopover()}
                                className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-stone/5 text-stone/45 transition-colors hover:bg-stone/10 hover:text-primary"
                                title="Đóng popup"
                            >
                                <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                        </div>

                        <div className="px-3 py-3">
                            {isTextareaEditor ? (
                                <textarea
                                    ref={popoverInputRef}
                                    value={draftValue}
                                    onFocus={() => setIsPinnedOpen(true)}
                                    onChange={handlePopoverInputChange}
                                    onKeyDown={handlePopoverKeyDown}
                                    placeholder={props.placeholder}
                                    rows={rows}
                                    className={`w-full resize-none rounded-lg border border-gold/20 bg-[#fcfcfa] px-3 py-2.5 text-[14px] font-bold text-primary shadow-inner outline-none transition-colors focus:border-primary/30 ${popoverInputClassName}`}
                                />
                            ) : (
                                <input
                                    ref={popoverInputRef}
                                    type={type}
                                    value={draftValue}
                                    onFocus={() => setIsPinnedOpen(true)}
                                    onChange={handlePopoverInputChange}
                                    onKeyDown={handlePopoverKeyDown}
                                    placeholder={props.placeholder}
                                    className={`w-full rounded-lg border border-gold/20 bg-[#fcfcfa] px-3 py-2.5 text-[14px] font-bold shadow-inner outline-none transition-colors focus:border-primary/30 ${popoverInputClassName}`}
                                />
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-stone/10 px-3 py-2.5">
                            <p className="text-[10px] font-semibold text-stone/45">
                                {isTextareaEditor ? 'Đồng bộ ngay với ô chính. Ctrl+Enter để đóng.' : 'Đồng bộ ngay với ô chính. Enter để đóng.'}
                            </p>

                            <button
                                type="button"
                                onClick={() => closePopover({ focusMain: true })}
                                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-umber"
                            >
                                <span className="material-symbols-outlined text-[14px]">check</span>
                                Cập nhật
                            </button>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
};

const SectionTitle = ({ icon, title }) => (
    <div className="flex items-center gap-2.5 mb-6 border-b border-stone/10 pb-2">
        <span className="material-symbols-outlined text-primary/40 p-1.5 bg-stone/5 rounded-full text-base">{icon}</span>
        <h3 className="font-sans text-[15px] font-bold text-primary uppercase tracking-tight">{title}</h3>
    </div>
);

// Quill 2 only accepts registered builtin formats here.
const quillFormats = [
    'header', 'font', 'size',
    'bold', 'italic', 'underline', 'strike', 'blockquote',
    'list', 'indent',
    'link', 'image', 'video',
    'color', 'background',
    'align'
];

const normalizeSpecificationRows = (rows = []) => (
    Array.isArray(rows)
        ? rows
            .map((item) => ({
                label: String(item?.label ?? '').trim(),
                value: String(item?.value ?? '').trim(),
            }))
            .filter((item) => item.label || item.value)
        : []
);

const normalizeAdditionalInfoRows = (rows = []) => (
    Array.isArray(rows)
        ? rows
            .map((item) => ({
                title: String(item?.title ?? '').trim(),
                display_text: String(item?.display_text ?? '').trim(),
                post_id: item?.post_invalid ? '' : (item?.post_id ? String(item.post_id).trim() : ''),
                post_title: String(item?.post_title ?? '').trim(),
                post_slug: String(item?.post_slug ?? '').trim(),
            }))
            .filter((item) => item.title || item.display_text || item.post_id || item.post_title || item.post_slug)
        : []
);

const ADDITIONAL_INFO_DISPLAY_LIMIT = 72;

const createAdditionalInfoRowId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `additional-info-${crypto.randomUUID()}`
        : `additional-info-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

const createAdditionalInfoRow = (item = {}) => ({
    row_id: item?.row_id || createAdditionalInfoRowId(),
    title: String(item?.title ?? ''),
    display_text: String(item?.display_text ?? ''),
    post_id: item?.post_id ? String(item.post_id) : '',
    post_title: String(item?.post_title ?? ''),
    post_slug: String(item?.post_slug ?? ''),
    post_invalid: Boolean(item?.post_invalid),
    post_error: String(item?.post_error ?? ''),
});

const hydrateAdditionalInfoRows = (rows = []) => (
    Array.isArray(rows)
        ? rows.map((item) => createAdditionalInfoRow(item))
        : []
);

const normalizeSearchText = (value) => (
    String(value ?? '')
        .toLocaleLowerCase('vi')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/\s+/g, ' ')
        .trim()
);

const truncateAdditionalInfoDisplayText = (value, maxLength = ADDITIONAL_INFO_DISPLAY_LIMIT) => {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();

    if (!normalized) {
        return '';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    const sliced = normalized.slice(0, Math.max(1, maxLength - 3)).trim();
    const lastSpace = sliced.lastIndexOf(' ');
    const safeSlice = lastSpace >= Math.floor(maxLength * 0.6)
        ? sliced.slice(0, lastSpace).trim()
        : sliced;

    return `${safeSlice.replace(/[.,;:!?-]+$/, '')}...`;
};

const resolveAdditionalInfoPreviewText = (item) => {
    const manualText = String(item?.display_text ?? '').trim();
    if (manualText) {
        return manualText;
    }

    return truncateAdditionalInfoDisplayText(item?.post_title ?? '');
};

const getBlogPostDateValue = (value) => {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
};

const getBlogPostEffectiveTimestamp = (post) => {
    const publishedAt = getBlogPostDateValue(post?.published_at);
    return publishedAt || getBlogPostDateValue(post?.created_at);
};

const sortBlogPostsNewestFirst = (items = []) => [...items].sort((left, right) => {
    const systemDiff = Number(Boolean(left?.is_system)) - Number(Boolean(right?.is_system));
    if (systemDiff !== 0) return systemDiff;

    const effectiveDiff = getBlogPostEffectiveTimestamp(right) - getBlogPostEffectiveTimestamp(left);
    if (effectiveDiff !== 0) return effectiveDiff;

    const createdDiff = getBlogPostDateValue(right?.created_at) - getBlogPostDateValue(left?.created_at);
    if (createdDiff !== 0) return createdDiff;

    if (getBlogPostEffectiveTimestamp(left) > 0 || getBlogPostEffectiveTimestamp(right) > 0) {
        return Number(right?.id || 0) - Number(left?.id || 0);
    }

    return 0;
});

const mergeUniqueBlogPosts = (...groups) => {
    const merged = [];
    const seenIds = new Set();

    groups.flat().forEach((post) => {
        if (!post?.id || seenIds.has(post.id)) {
            return;
        }

        seenIds.add(post.id);
        merged.push(post);
    });

    return sortBlogPostsNewestFirst(merged);
};

const SKU_MAX_LENGTH = 120;

const normalizeSkuSeed = (value) => (
    String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '-')
        .replace(/[^A-Z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
);

const truncateSkuValue = (value, maxLength = SKU_MAX_LENGTH) => (
    value.length > maxLength ? value.slice(0, maxLength) : value
);

const buildLocalCopySku = (originalSku, fallbackSeed = null) => {
    const base = normalizeSkuSeed(originalSku || fallbackSeed || 'PRODUCT') || 'PRODUCT';
    return truncateSkuValue(`${base}-COPY`);
};

const buildLocalVariantSku = (parentSku, reservedSkus) => {
    const normalizedParentSku = normalizeSkuSeed(parentSku) || 'PRODUCT';

    for (let index = 1; index <= 9999; index += 1) {
        const candidate = truncateSkuValue(`${normalizedParentSku}-V${index}`);
        if (!reservedSkus.has(candidate)) {
            reservedSkus.add(candidate);
            return candidate;
        }
    }

    const fallbackCandidate = truncateSkuValue(`${normalizedParentSku}-V`);
    reservedSkus.add(fallbackCandidate);
    return fallbackCandidate;
};

const buildDuplicateVariantDrafts = (variants = [], parentSku = '') => {
    const reservedSkus = new Set([normalizeSkuSeed(parentSku)].filter(Boolean));

    return variants.map((variant) => {
        const nextSku = buildLocalVariantSku(parentSku, reservedSkus);

        return {
            ...variant,
            sku: nextSku,
            sku_auto: true,
            source_id: variant?.source_id ?? variant?.id ?? null,
        };
    });
};

const getOrderedSuperLinkVariants = (productData) => (
    (productData?.linked_products || [])
        .filter((item) => item?.pivot?.link_type === 'super_link')
        .slice()
        .sort((left, right) => (Number(left?.pivot?.position ?? 0) - Number(right?.pivot?.position ?? 0)))
);

const flattenBundleOptionsToCompositeItems = (options = []) => (
    (Array.isArray(options) ? options : []).flatMap((option) => (
        (Array.isArray(option?.items) ? option.items : []).map((item) => ({
            ...item,
            option_title: option.title,
            option_post_id: option.post_id || '',
            bundle_option_uid: option.uid || option.bundle_option_uid || '',
            bundle_option_status: normalizeBundleOptionStatus(option.status ?? option.bundle_option_status),
            option_image_url: normalizePersistedImageUrl(option.image_url),
            option_video_url: option.video_url || '',
            option_video_source: option.video_source || '',
        }))
    ))
);

const calculateCompositeItemsTotal = (items = []) => (
    (Array.isArray(items) ? items : []).reduce((total, item) => {
        const quantity = Number(item?.quantity ?? 0);
        const unitPrice = normalizeWholeMoneyNumber(item?.price) ?? 0;
        return total + unitPrice * (Number.isFinite(quantity) ? quantity : 0);
    }, 0)
);

const normalizeCompositeItemForSubmit = (item = {}) => {
    const productId = Number(item.product_id ?? item.id ?? 0);
    const quantity = Number.parseInt(String(item.quantity ?? 1), 10);
    const normalizedPrice = normalizeWholeMoneyNumber(item.price);
    const normalizedCostPrice = normalizeRoundedImportCostNumber(item.cost_price);
    const normalizedImageUrl = normalizePersistedImageUrl(item.option_image_url);
    const variantId = Number(item.variant_id ?? 0);

    const payload = {
        id: productId,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        is_required: Boolean(item.is_required),
        option_title: item.option_title || '',
        is_default: Boolean(item.is_default),
        price: normalizedPrice ?? 0,
    };

    if (item.bundle_option_uid) {
        payload.bundle_option_uid = String(item.bundle_option_uid);
    }

    payload.bundle_option_status = normalizeBundleOptionStatus(item.bundle_option_status);

    if (item.option_post_id) {
        payload.option_post_id = item.option_post_id;
    }

    if (normalizedImageUrl) {
        payload.option_image_url = normalizedImageUrl;
    }

    if (item.option_video_url) {
        payload.option_video_url = item.option_video_url;
    }

    if (item.option_video_source) {
        payload.option_video_source = item.option_video_source;
    }

    if (normalizedCostPrice !== null) {
        payload.cost_price = normalizedCostPrice;
    }

    if (Number.isFinite(variantId) && variantId > 0) {
        payload.variant_id = variantId;
    }

    return payload;
};

const buildCompositeItemsSubmitPayload = (items = []) => (
    (Array.isArray(items) ? items : [])
        .map(normalizeCompositeItemForSubmit)
        .filter((item) => Number.isFinite(Number(item.id)) && Number(item.id) > 0)
);

const isFileLikeValue = (value) => (
    Boolean(value)
    && typeof File !== 'undefined'
    && value instanceof File
);

const AD_TRACKING_LINK_DEFINITIONS = [
    { key: 'facebook', label: 'Link Facebook', source: 'facebook', helper: 'utm_source=facebook' },
    { key: 'google', label: 'Link Google', source: 'google', helper: 'utm_source=google' },
    { key: 'tiktok', label: 'Link TikTok', source: 'tiktok', helper: 'utm_source=tiktok' },
];

const normalizeBundleOptionLinkText = (value) => String(value ?? '').trim();

const normalizeBundleOptionKeyText = (value) => (
    normalizeBundleOptionLinkText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ')
);

const buildBundleOptionLinkKey = (option = {}) => {
    const postId = normalizeBundleOptionLinkText(option.post_id ?? option.bundle_option_post_id);
    if (/^\d+$/.test(postId)) {
        return `post:${Number(postId)}`;
    }

    return `title:${normalizeBundleOptionKeyText(option.title ?? option.bundle_option_title) || 'mac dinh'}`;
};

const buildCompactBundleOptionLinkValue = (option = {}) => {
    const optionUid = normalizeBundleOptionLinkText(option.uid ?? option.bundle_option_uid);

    return optionUid || buildBundleOptionLinkKey(option);
};

const ProductForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const isDuplicate = queryParams.get('mode') === 'duplicate';
    const isCreateFlow = !isEdit || isDuplicate;
    const expectedCostLabel = isCreateFlow ? 'Giá nhập dự kiến' : 'Giá dự kiến';
    const currentCostLabel = isCreateFlow ? 'Giá nhập thực tế' : 'Giá vốn hiện tại';
    const returnContext = location.state?.returnContext || null;

    const { showModal, hideModal, showToast } = useUI();
    const { user } = useAuth();
    const { available: aiAvailable, disabledReason } = useAiAvailability();
    const canCreateProducts = hasAdminPermission(user, 'products.create');
    const canUpdateProducts = hasAdminPermission(user, 'products.update');

    useEffect(() => {
        if ((isCreateFlow && !canCreateProducts) || (!isCreateFlow && !canUpdateProducts)) {
            navigate('/admin/products', { replace: true });
        }
    }, [canCreateProducts, canUpdateProducts, isCreateFlow, navigate]);

    const [isSaving, setIsSaving] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiGeneratingSeo, setAiGeneratingSeo] = useState(false);
    const [aiRewriting, setAiRewriting] = useState(false);
    const [typeConfirmed, setTypeConfirmed] = useState(true);
    const [showVariantExpansionGuide, setShowVariantExpansionGuide] = useState(false);
    const [categories, setCategories] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [inventoryUnits, setInventoryUnits] = useState([]);
    const [showInventoryUnitSorter, setShowInventoryUnitSorter] = useState(false);
    const [inventoryUnitsDraft, setInventoryUnitsDraft] = useState([]);
    const [isSavingInventoryUnitOrder, setIsSavingInventoryUnitOrder] = useState(false);
    const [suggestedProducts, setSuggestedProducts] = useState([]);
    const [suggestedBundleProducts, setSuggestedBundleProducts] = useState([]);
    const [searchingRelated, setSearchingRelated] = useState(false);
    const [searchingBundle, setSearchingBundle] = useState(false);
    const [showRelatedFilters, setShowRelatedFilters] = useState(false);
    const [allAttributes, setAllAttributes] = useState([]);
    const [images, setImages] = useState([]);
    const [selectedImages, setSelectedImages] = useState([]);
    const [lightboxImage, setLightboxImage] = useState(null);
    const [isDragSelecting, setIsDragSelecting] = useState(false);
    const [saveStatusText, setSaveStatusText] = useState('');
    const [showSlugModal, setShowSlugModal] = useState(false);
    const [tempSlug, setTempSlug] = useState('');
    const [slugError, setSlugError] = useState('');
    const [allBlogPosts, setAllBlogPosts] = useState([]);
    const [blogSearchQuery, setBlogSearchQuery] = useState({}); // { index: query }
    const [isSearchingBlog, setIsSearchingBlog] = useState({}); // { index: loading }
    const [blogResults, setBlogResults] = useState({}); // { index: results }
    const [domains, setDomains] = useState([]);
    const duplicateDraftDefaultsRef = useRef(null);
    const legacyBundleVariantRepairNoticeShownRef = useRef(false);

    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('product_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const searchContainerRef = useRef(null);
    const relatedSearchContainerRef = useRef(null); // For the other search bar
    const supplierDropdownRef = useRef(null);
    const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);

    const [formData, setFormData] = useState({
        type: 'simple',
        name: '',
        category_id: '',
        category_ids: [],
        price: '',
        price_type: 'fixed',
        expected_cost: '',
        cost_price: '',
        weight: '',
        inventory_unit_id: '',
        supplier_ids: [],
        description: '',
        specifications: [], // [{label, value}]
        is_featured: false,
        is_new: true,
        status: true,
        stock_quantity: '',
        sku: '',
        meta_title: '',
        meta_description: '',
        meta_keywords: '',
        linked_product_ids: [],
        grouped_items: [], // [{id, name, sku, price, quantity, is_required, image_url}]
        super_attribute_ids: [],
        custom_attributes: {},
        video_url: '',
        video_urls: [],
        slug: '',
        additional_info: [], // [{row_id, title, display_text, post_id, post_title, post_slug}]
        bundle_title: '',
        site_domain_id: ''
    });
    const initialStockQuantityRef = useRef('');
    const initialImageSignatureRef = useRef('');
    const initialFormDataSignatureRef = useRef('');
    const initialBundleOptionSignatureRef = useRef(buildBundleOptionSignature([]));
    const hasNonImageFormChangesRef = useRef(false);
    const normalizeSelectedCategoryIds = useCallback((values) => normalizeCategoryIds(values), []);
    const applySelectedCategoryIds = useCallback((nextValuesOrUpdater) => {
        setFormData((prev) => {
            const incomingValues = typeof nextValuesOrUpdater === 'function'
                ? nextValuesOrUpdater(prev.category_ids || [])
                : nextValuesOrUpdater;
            const nextCategoryIds = normalizeSelectedCategoryIds(incomingValues);

            return {
                ...prev,
                category_ids: nextCategoryIds,
                category_id: nextCategoryIds[0] || '',
            };
        });
    }, [normalizeSelectedCategoryIds]);
    const selectedCategoryNames = useMemo(
        () => getCategoryNamesByIds(formData.category_ids, categories),
        [categories, formData.category_ids]
    );
    const selectedCategorySummary = useMemo(
        () => formatCategorySummary(selectedCategoryNames, 'Chưa gắn danh mục'),
        [selectedCategoryNames]
    );
    const [productMeta, setProductMeta] = useState({
        originalType: '',
        parentConfigurable: null,
    });
    const [showConvertToConfigurableModal, setShowConvertToConfigurableModal] = useState(false);
    const [isConvertingToConfigurable, setIsConvertingToConfigurable] = useState(false);
    const [convertToConfigurableForm, setConvertToConfigurableForm] = useState({
        parent_name: '',
        attribute_source: 'preset',
        preset_attribute_name: SIMPLE_TO_CONFIG_PRESET_ATTRIBUTES[0],
        attribute_id: '',
        custom_attribute_name: '',
        variants: [],
    });

    const [variants, setVariants] = useState([]);
    const [serverValidationErrors, setServerValidationErrors] = useState({});
    const [selectedSuperAttributes, setSelectedSuperAttributes] = useState([]);
    const [existingVariantSuperAttributes, setExistingVariantSuperAttributes] = useState([]);
    const [selectedVariantIds, setSelectedVariantIds] = useState([]);
    const [variantImagePicker, setVariantImagePicker] = useState({
        index: null,
        top: 0,
        left: 0,
        width: 336,
    });
    const [showVariantConfig, setShowVariantConfig] = useState(false);
    const [showVariantQuickUpdateModal, setShowVariantQuickUpdateModal] = useState(false);
    const [variantQuickUpdateScope, setVariantQuickUpdateScope] = useState('all');
    const [variantQuickUpdateForm, setVariantQuickUpdateForm] = useState(createEmptyVariantQuickUpdateForm);
    const [lastDeletedVariantBatch, setLastDeletedVariantBatch] = useState(null);
    const [showHiddenVariantsModal, setShowHiddenVariantsModal] = useState(false);
    const [selectedHiddenVariantIds, setSelectedHiddenVariantIds] = useState([]);
    const [refreshingAttributes, setRefreshingAttributes] = useState(false);
    const [bundleOptions, setBundleOptions] = useState([]); // [{ id, title, post_id, post_title, items: [] }]
    const [showBundleSearch, setShowBundleSearch] = useState(null); // optionId
    const [isSortingBundle, setIsSortingBundle] = useState({}); // { optionId: boolean }
    const [bundleOptionVideoPicker, setBundleOptionVideoPicker] = useState(null);
    const [bundleItemVariants, setBundleItemVariants] = useState({}); // { productId: [variants] }
    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
    const [expandedBundleOptions, setExpandedBundleOptions] = useState({});
    const toggleBundleOptionExpanded = useCallback((optionId) => {
        setExpandedBundleOptions((prev) => ({
            ...prev,
            [optionId]: !prev[optionId],
        }));
    }, []);
    const [showBundleOptionSorter, setShowBundleOptionSorter] = useState(false);
    const [bundleItemQuickSorter, setBundleItemQuickSorter] = useState({
        optionId: null,
        items: [],
        positionDrafts: {},
    });
    const [bundleOptionImagePicker, setBundleOptionImagePicker] = useState({
        optionId: null,
        top: 0,
        left: 0,
        width: 380,
    });
    const bundleOptionCardRefs = useRef({});
    const bundleOptionTitleInputRefs = useRef({});
    const pendingCopiedBundleOptionIdRef = useRef(null);
    const blogSearchRequestRef = useRef({});
    const variantImageInputRefs = useRef({});
    const bundleOptionImagePickerRef = useRef(null);
    const variantImagePickerRef = useRef(null);
    const variantImagePickerAnchorRef = useRef(null);
    const variantImageCellClickTimeoutRef = useRef(null);
    const variantLibraryImageClickTimeoutRef = useRef(null);
    const ownedVariantPreviewUrlsRef = useRef(new Set());

    // Filters for Related Products suggestions
    const [relatedQuery, setRelatedQuery] = useState('');
    const [bundleQuery, setBundleQuery] = useState('');
    const [relatedCategory, setRelatedCategory] = useState('all');
    const [relatedAttrFilter, setRelatedAttrFilter] = useState({}); // { attr_id: value }
    const [showSelectedRelated, setShowSelectedRelated] = useState(false);
    const [selectedProductsData, setSelectedProductsData] = useState([]);
    const [stagedRelatedIds, setStagedRelatedIds] = useState([]);
    const [stagedRelatedData, setStagedRelatedData] = useState([]);

    const currentInventoryUnitDefaultId = useMemo(() => (
        String((inventoryUnits.find((unit) => unit.is_default) || inventoryUnits[0] || {}).id || '')
    ), [inventoryUnits]);

    const draftInventoryUnitDefaultId = useMemo(() => (
        String((inventoryUnitsDraft.find((unit) => unit.is_default) || inventoryUnitsDraft[0] || {}).id || '')
    ), [inventoryUnitsDraft]);

    const activeBundleItemQuickSorterOption = useMemo(() => (
        bundleOptions.find((option) => option.id === bundleItemQuickSorter.optionId) || null
    ), [bundleItemQuickSorter.optionId, bundleOptions]);

    const bundleItemQuickSorterHasChanges = useMemo(() => {
        if (!activeBundleItemQuickSorterOption) {
            return false;
        }

        return !areOrderedIdsEqual(
            (Array.isArray(activeBundleItemQuickSorterOption.items) ? activeBundleItemQuickSorterOption.items : []).map(getBundleItemEntryKey),
            (Array.isArray(bundleItemQuickSorter.items) ? bundleItemQuickSorter.items : []).map(getBundleItemEntryKey)
        );
    }, [activeBundleItemQuickSorterOption, bundleItemQuickSorter.items]);

    const inventoryUnitOrderChanged = useMemo(() => {
        if (!inventoryUnitsDraft.length) return false;
        return (
            !areOrderedIdsEqual(
                inventoryUnits.map((unit) => String(unit.id)),
                inventoryUnitsDraft.map((unit) => String(unit.id))
            )
            || currentInventoryUnitDefaultId !== draftInventoryUnitDefaultId
        );
    }, [currentInventoryUnitDefaultId, draftInventoryUnitDefaultId, inventoryUnits, inventoryUnitsDraft]);

    const [variantTableWidths, setVariantTableWidths] = useState({
        select: 64,
        default_variant: 124,
        image: 80,
        name: 320,
        sku: 200,
        price: 150,
        expected_cost: 150,
        current_cost: 150,
        weight: 100,
        unit: 96,
        actions: 60
    });

    const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
    const [aiInstruction, setAiInstruction] = useState('');
    const [aiRewriteReview, setAiRewriteReview] = useState({
        open: false,
        sourceHtml: '',
        draftHtml: '',
        revisionInstruction: '',
        model: '',
    });
    const [descriptionImageLibraryOpen, setDescriptionImageLibraryOpen] = useState(false);
    const [descriptionHtmlPasteOpen, setDescriptionHtmlPasteOpen] = useState(false);
    const quillRef = useRef(null);

    const registerBundleOptionCardRef = useCallback((optionId, node) => {
        if (node) {
            bundleOptionCardRefs.current[optionId] = node;
            return;
        }

        delete bundleOptionCardRefs.current[optionId];
    }, []);

    const registerBundleOptionTitleInputRef = useCallback((optionId, node) => {
        if (node) {
            bundleOptionTitleInputRefs.current[optionId] = node;
            return;
        }

        delete bundleOptionTitleInputRefs.current[optionId];
    }, []);

    const clearServerValidationErrors = useCallback((prefixes = []) => {
        if (!Array.isArray(prefixes) || prefixes.length === 0) return;
        setServerValidationErrors((prev) => {
            const keys = Object.keys(prev || {});
            if (keys.length === 0) return prev;
            const next = { ...prev };
            keys.forEach((key) => {
                if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
                    delete next[key];
                }
            });
            return next;
        });
    }, []);

    const normalizeMoneyValue = (value) => {
        const parsedValue = normalizeWholeMoneyNumber(value);
        return parsedValue ?? '';
    };

    const normalizeImportCostValue = (value) => {
        const parsedValue = normalizeRoundedImportCostNumber(value);
        return parsedValue ?? '';
    };

    const normalizeStockQuantityComparableValue = (value) => {
        if (value === '' || value === null || value === undefined) {
            return '';
        }

        const normalizedText = String(value).trim();
        if (normalizedText === '') {
            return '';
        }

        const numericValue = Number(normalizedText);
        return Number.isFinite(numericValue) && Number.isInteger(numericValue)
            ? numericValue
            : normalizedText;
    };

    const normalizeImportCostDraftValue = (value) => {
        return normalizeWholeMoneyDraft(value);
    };

    const normalizeExistingVariantSuperAttributes = useCallback((items = []) => (
        normalizeSelectedSuperAttributes(items).map((item) => ({
            ...item,
            selected_values: normalizeVariantSelectionValues(item?.selected_values),
            default_value: null,
        }))
    ), []);

    const variantReadyAttributes = useMemo(() => (
        allAttributes.filter((attribute) => (
            attribute.entity_type === 'product'
            && Boolean(attribute.is_variant)
            && (attribute.frontend_type === 'select' || attribute.frontend_type === 'multiselect')
        ))
    ), [allAttributes]);

    const existingVariantSuperAttributeIdSet = useMemo(
        () => new Set(existingVariantSuperAttributes.map((attribute) => String(attribute.id))),
        [existingVariantSuperAttributes]
    );

    const selectedSuperAttributeIdSet = useMemo(
        () => new Set(selectedSuperAttributes.map((attribute) => String(attribute.id))),
        [selectedSuperAttributes]
    );

    const removedExistingVariantAttributes = useMemo(
        () => existingVariantSuperAttributes.filter(
            (attribute) => !selectedSuperAttributeIdSet.has(String(attribute.id))
        ),
        [existingVariantSuperAttributes, selectedSuperAttributeIdSet]
    );

    const sanitizeSelectedSuperAttributes = useCallback((items = []) => (
        normalizeSelectedSuperAttributes(items).map((item) => {
            const selectedValues = normalizeVariantSelectionValues(item?.selected_values);
            const isExistingVariantAttribute = existingVariantSuperAttributeIdSet.has(String(item?.id));
            const rawDefaultValue = String(item?.default_value ?? '').trim();

            return {
                ...item,
                selected_values: selectedValues,
                default_value: isExistingVariantAttribute
                    ? null
                    : (selectedValues.find((value) => value === rawDefaultValue) || selectedValues[0] || null),
            };
        })
    ), [existingVariantSuperAttributeIdSet]);

    const toggleSuperAttributeSelection = useCallback((attribute) => {
        setSelectedSuperAttributes((prev) => {
            const alreadySelected = prev.some((item) => String(item.id) === String(attribute.id));

            if (alreadySelected) {
                return sanitizeSelectedSuperAttributes(
                    prev.filter((item) => String(item.id) !== String(attribute.id))
                );
            }

            return sanitizeSelectedSuperAttributes([
                ...prev,
                {
                    ...attribute,
                    selected_values: normalizeVariantSelectionValues(attribute?.selected_values),
                    default_value: attribute?.default_value ?? null,
                },
            ]);
        });
    }, [sanitizeSelectedSuperAttributes]);

    const selectedConvertAttribute = useMemo(() => {
        if (convertToConfigurableForm.attribute_source !== 'existing') {
            return null;
        }

        return variantReadyAttributes.find((attribute) => (
            String(attribute.id) === String(convertToConfigurableForm.attribute_id)
        )) || null;
    }, [
        convertToConfigurableForm.attribute_id,
        convertToConfigurableForm.attribute_source,
        variantReadyAttributes,
    ]);

    const selectedConvertAttributeOptions = useMemo(() => (
        normalizeConvertVariantOptionValues(selectedConvertAttribute?.options)
    ), [selectedConvertAttribute]);

    const currentConvertAttributeValue = useMemo(() => {
        if (convertToConfigurableForm.attribute_source !== 'existing' || !selectedConvertAttribute) {
            return '';
        }

        return inferExistingConvertVariantValue({
            optionValues: selectedConvertAttribute.options,
            rawAttributeValue: formData.custom_attributes?.[selectedConvertAttribute.id],
            productName: formData.name,
        });
    }, [
        convertToConfigurableForm.attribute_source,
        formData.custom_attributes,
        formData.name,
        selectedConvertAttribute,
    ]);

    const convertVariantOptionsByEntryId = useMemo(() => {
        if (convertToConfigurableForm.attribute_source !== 'existing') {
            return {};
        }

        const variantsList = Array.isArray(convertToConfigurableForm.variants)
            ? convertToConfigurableForm.variants
            : [];

        return variantsList.reduce((accumulator, variant) => {
            const currentValueKey = getConvertVariantValueKey(variant?.value);
            const usedByOtherVariants = new Set(
                variantsList
                    .filter((item) => item?.entry_id !== variant?.entry_id)
                    .map((item) => getConvertVariantValueKey(item?.value))
                    .filter(Boolean)
            );

            accumulator[variant.entry_id] = selectedConvertAttributeOptions.filter((option) => {
                const optionKey = getConvertVariantValueKey(option.value);
                return optionKey === currentValueKey || !usedByOtherVariants.has(optionKey);
            });

            return accumulator;
        }, {});
    }, [
        convertToConfigurableForm.attribute_source,
        convertToConfigurableForm.variants,
        selectedConvertAttributeOptions,
    ]);

    const remainingConvertAttributeOptions = useMemo(() => {
        if (convertToConfigurableForm.attribute_source !== 'existing') {
            return [];
        }

        const usedValueKeys = new Set(
            (Array.isArray(convertToConfigurableForm.variants) ? convertToConfigurableForm.variants : [])
                .map((variant) => getConvertVariantValueKey(variant?.value))
                .filter(Boolean)
        );

        return selectedConvertAttributeOptions.filter((option) => (
            !usedValueKeys.has(getConvertVariantValueKey(option.value))
        ));
    }, [
        convertToConfigurableForm.attribute_source,
        convertToConfigurableForm.variants,
        selectedConvertAttributeOptions,
    ]);

    const canConvertSimpleProduct = useMemo(() => (
        isEdit
        && !isDuplicate
        && (productMeta.originalType || formData.type) === 'simple'
        && !productMeta.parentConfigurable
    ), [formData.type, isDuplicate, isEdit, productMeta.originalType, productMeta.parentConfigurable]);

    const resolvedConvertAttributeName = useMemo(() => {
        if (convertToConfigurableForm.attribute_source === 'existing') {
            return selectedConvertAttribute?.name || '';
        }

        if (convertToConfigurableForm.attribute_source === 'custom') {
            return String(convertToConfigurableForm.custom_attribute_name || '').trim();
        }

        return String(convertToConfigurableForm.preset_attribute_name || SIMPLE_TO_CONFIG_PRESET_ATTRIBUTES[0]).trim();
    }, [
        convertToConfigurableForm.attribute_id,
        convertToConfigurableForm.attribute_source,
        convertToConfigurableForm.custom_attribute_name,
        convertToConfigurableForm.preset_attribute_name,
        selectedConvertAttribute,
    ]);

    const convertVariantValueGuide = useMemo(() => {
        const normalizedAttributeName = String(resolvedConvertAttributeName || '')
            .trim()
            .toLocaleLowerCase('vi')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        if (normalizedAttributeName.includes('kich thuoc')) {
            return {
                helper: 'Nếu thuộc tính là Kích thước thì giá trị có thể là Phi 12, Phi 14.',
                firstPlaceholder: 'Ví dụ: Phi 12',
                nextPlaceholder: 'Ví dụ: Phi 14',
            };
        }

        if (normalizedAttributeName.includes('loai men') || normalizedAttributeName === 'men') {
            return {
                helper: 'Nếu thuộc tính là Loại men thì giá trị có thể là Men lam, Men rạn.',
                firstPlaceholder: 'Ví dụ: Men lam',
                nextPlaceholder: 'Ví dụ: Men rạn',
            };
        }

        return {
            helper: 'Nếu thuộc tính là Mẫu thì giá trị có thể là Mẫu gốc, Khắc sen.',
            firstPlaceholder: 'Ví dụ: Mẫu gốc',
            nextPlaceholder: 'Ví dụ: Khắc sen',
        };
    }, [resolvedConvertAttributeName]);

    useEffect(() => {
        if (!showConvertToConfigurableModal) {
            return;
        }

        if (convertToConfigurableForm.attribute_source !== 'existing' || !selectedConvertAttribute) {
            return;
        }

        setConvertToConfigurableForm((prev) => {
            const nextVariants = buildConvertVariantsFromOptionValues({
                optionValues: selectedConvertAttribute.options,
                previousVariants: prev.variants,
                existingProductName: formData.name,
                existingProductSku: formData.sku,
                parentName: prev.parent_name || formData.name,
                existingValue: currentConvertAttributeValue,
            });

            if (areConvertVariantListsEqual(prev.variants, nextVariants)) {
                return prev;
            }

            return {
                ...prev,
                variants: nextVariants,
            };
        });
    }, [
        convertToConfigurableForm.attribute_source,
        currentConvertAttributeValue,
        formData.name,
        formData.sku,
        selectedConvertAttribute,
        showConvertToConfigurableModal,
    ]);

    const openConvertToConfigurableModal = useCallback(() => {
        setConvertToConfigurableForm(buildInitialConvertToConfigurableForm({
            name: formData.name,
            sku: formData.sku,
        }));
        setShowConvertToConfigurableModal(true);
    }, [formData.name, formData.sku]);

    const closeConvertToConfigurableModal = useCallback(() => {
        if (isConvertingToConfigurable) return;
        setShowConvertToConfigurableModal(false);
    }, [isConvertingToConfigurable]);

    const handleConvertVariantFieldChange = useCallback((entryId, field, value) => {
        setConvertToConfigurableForm((prev) => ({
            ...prev,
            variants: prev.variants.map((variant) => {
                if (variant.entry_id !== entryId) return variant;

                return {
                    ...variant,
                    [field]: field === 'sku' ? normalizeSkuDraft(value) : value,
                };
            }),
        }));
    }, []);

    const handleAddConvertVariant = useCallback(() => {
        if (convertToConfigurableForm.attribute_source === 'existing') {
            if (!selectedConvertAttribute) {
                showToast({ message: 'Hãy chọn thuộc tính có sẵn trước khi thêm biến thể.', type: 'warning' });
                return;
            }

            if (selectedConvertAttributeOptions.length === 0) {
                showToast({ message: 'Thuộc tính này chưa có giá trị để tạo biến thể.', type: 'warning' });
                return;
            }

            const nextOption = remainingConvertAttributeOptions[0];

            if (!nextOption) {
                showToast({ message: 'Tất cả giá trị của thuộc tính này đã có biến thể.', type: 'info' });
                return;
            }

            setConvertToConfigurableForm((prev) => ({
                ...prev,
                variants: [
                    ...prev.variants,
                    createConvertVariantDraft({
                        value: nextOption.value,
                        name: buildConvertVariantAutoName(prev.parent_name || formData.name, formData.name, nextOption.value),
                    }),
                ],
            }));
            return;
        }

        setConvertToConfigurableForm((prev) => ({
            ...prev,
            variants: [
                ...prev.variants,
                createConvertVariantDraft({
                    name: prev.parent_name ? `${prev.parent_name} - ` : '',
                }),
            ],
        }));
    }, [
        convertToConfigurableForm.attribute_source,
        formData.name,
        remainingConvertAttributeOptions,
        selectedConvertAttribute,
        selectedConvertAttributeOptions.length,
        showToast,
    ]);

    const handleRemoveConvertVariant = useCallback((entryId) => {
        setConvertToConfigurableForm((prev) => ({
            ...prev,
            variants: prev.variants.filter((variant) => variant.entry_id !== entryId || variant.is_existing),
        }));
    }, []);

    const handleConvertToConfigurable = useCallback(async () => {
        if (!id) return;

        const parentName = String(convertToConfigurableForm.parent_name || '').trim() || String(formData.name || '').trim();
        const attributeName = resolvedConvertAttributeName;
        const normalizedVariants = convertToConfigurableForm.variants.map((variant, index) => {
            const value = String(variant.value || '').trim();
            const fallbackName = value
                ? `${parentName || formData.name || 'Biến thể'} - ${value}`
                : `${parentName || formData.name || 'Biến thể'} ${index + 1}`;

            return {
                value,
                name: String(variant.name || '').trim() || fallbackName,
                sku: String(variant.sku || '').trim() || undefined,
            };
        });

        const missingValueVariant = normalizedVariants.findIndex((variant) => !variant.value);
        if (!parentName) {
            showToast({ message: 'Cần nhập tên sản phẩm cha trước khi chuyển đổi.', type: 'error' });
            return;
        }

        if (convertToConfigurableForm.attribute_source === 'existing' && !convertToConfigurableForm.attribute_id) {
            showToast({ message: 'Hãy chọn thuộc tính có sẵn để dùng làm thuộc tính biến thể.', type: 'error' });
            return;
        }

        if (convertToConfigurableForm.attribute_source !== 'existing' && !attributeName) {
            showToast({ message: 'Tên thuộc tính biến thể không được để trống.', type: 'error' });
            return;
        }

        if (missingValueVariant >= 0) {
            showToast({ message: `Biến thể #${missingValueVariant + 1} chưa có giá trị thuộc tính.`, type: 'error' });
            return;
        }

        const duplicateValues = new Set();
        const seenValues = new Set();
        normalizedVariants.forEach((variant) => {
            const key = variant.value.toLocaleLowerCase('vi');
            if (seenValues.has(key)) {
                duplicateValues.add(variant.value);
            }
            seenValues.add(key);
        });

        if (duplicateValues.size > 0) {
            showToast({ message: 'Giá trị thuộc tính của các biến thể đang bị trùng nhau.', type: 'error' });
            return;
        }

        setIsConvertingToConfigurable(true);

        try {
            const payload = {
                parent_name: parentName,
                variants: normalizedVariants,
            };

            if (convertToConfigurableForm.attribute_source === 'existing') {
                payload.attribute_id = Number(convertToConfigurableForm.attribute_id);
            } else {
                payload.attribute_name = attributeName;
            }

            const response = await productApi.convertToConfigurable(id, payload);
            const parentProductId = Number(response?.data?.parent_product_id || response?.data?.data?.id || 0);

            if (!parentProductId) {
                throw new Error('Missing parent product id');
            }

            showToast({
                message: 'Sản phẩm đơn đã được chuyển thành nhóm biến thể. Dữ liệu lịch sử vẫn bám theo biến thể đầu tiên.',
                type: 'success',
            });
            setShowConvertToConfigurableModal(false);
            navigate(`/admin/products/edit/${parentProductId}`, {
                replace: true,
                state: location.state,
            });
        } catch (error) {
            const data = error?.response?.data;
            const errorList = data?.errors ? Object.values(data.errors).flat() : [];
            const message = errorList[0] || data?.message || 'Không thể chuyển sản phẩm thành sản phẩm có biến thể.';
            showToast({ message, type: 'error' });
        } finally {
            setIsConvertingToConfigurable(false);
        }
    }, [
        convertToConfigurableForm.attribute_id,
        convertToConfigurableForm.attribute_source,
        convertToConfigurableForm.parent_name,
        convertToConfigurableForm.variants,
        formData.name,
        id,
        location.state,
        navigate,
        resolvedConvertAttributeName,
        showToast,
    ]);

    useEffect(() => {
        if (formData.type !== 'bundle' || bundleOptions.length === 0) {
            setShowBundleOptionSorter(false);
        }
    }, [bundleOptions.length, formData.type]);

    useEffect(() => {
        if (!bundleItemQuickSorter.optionId) {
            return;
        }

        const hasActiveOption = bundleOptions.some((option) => option.id === bundleItemQuickSorter.optionId);
        if (formData.type !== 'bundle' || !hasActiveOption) {
            setBundleItemQuickSorter({
                optionId: null,
                items: [],
                positionDrafts: {},
            });
        }
    }, [bundleItemQuickSorter.optionId, bundleOptions, formData.type]);

    useEffect(() => {
        if (!bundleItemQuickSorter.optionId || typeof window === 'undefined') {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setBundleItemQuickSorter({
                    optionId: null,
                    items: [],
                    positionDrafts: {},
                });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [bundleItemQuickSorter.optionId]);

    useEffect(() => {
        const copiedOptionId = pendingCopiedBundleOptionIdRef.current;
        if (!copiedOptionId || typeof window === 'undefined') {
            return undefined;
        }

        const rafId = window.requestAnimationFrame(() => {
            const optionCard = bundleOptionCardRefs.current[copiedOptionId];
            const optionTitleInput = bundleOptionTitleInputRefs.current[copiedOptionId];

            optionCard?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
                inline: 'nearest',
            });

            if (optionTitleInput) {
                optionTitleInput.focus();
                optionTitleInput.select();
            }

            pendingCopiedBundleOptionIdRef.current = null;
        });

        return () => window.cancelAnimationFrame(rafId);
    }, [bundleOptions]);

    const compositeItemsForPricing = useMemo(() => {
        if (formData.type === 'bundle' && bundleOptions.length > 0) {
            return flattenBundleOptionsToCompositeItems(bundleOptions);
        }

        return Array.isArray(formData.grouped_items) ? formData.grouped_items : [];
    }, [bundleOptions, formData.grouped_items, formData.type]);

    const compositeSumPrice = useMemo(
        () => calculateCompositeItemsTotal(compositeItemsForPricing),
        [compositeItemsForPricing]
    );

    const handleImportCostFieldBlur = (field) => {
        setFormData((prev) => {
            const normalizedValue = normalizeImportCostValue(prev[field]);
            return prev[field] === normalizedValue
                ? prev
                : { ...prev, [field]: normalizedValue };
        });
    };

    const handleVariantImportCostBlur = (index) => {
        setVariants((prev) => prev.map((variant, variantIndex) => {
            if (variantIndex !== index) return variant;
            const normalizedValue = normalizeImportCostValue(variant.expected_cost);
            return variant.expected_cost === normalizedValue
                ? variant
                : { ...variant, expected_cost: normalizedValue };
        }));
    };

    const handleVariantQuickUpdateImportCostBlur = () => {
        setVariantQuickUpdateForm((prev) => {
            const normalizedValue = normalizeImportCostValue(prev.expected_cost);
            return prev.expected_cost === normalizedValue
                ? prev
                : { ...prev, expected_cost: normalizedValue };
        });
    };

    const resolveDuplicateSafeCost = (primaryValue, fallbackValue = null) => {
        if (isDuplicate) {
            return '';
        }

        return normalizeImportCostValue(primaryValue ?? fallbackValue);
    };

    const getBundleItemProductId = (item) => Number(item?.product_id ?? item?.id ?? 0);

    const getBundleVariantLabel = (variant) => {
        const variantName = String(variant?.name || '').trim();
        if (variantName) {
            return variantName;
        }

        return (variant?.attribute_values || [])
            .map((attributeValue) => attributeValue?.value)
            .filter(Boolean)
            .join(' / ')
            .trim() || String(variant?.sku || '').trim();
    };

    const resolveBundleItemImage = (product) => {
        return resolveAdminImageUrl(product?.images?.find((image) => image.is_primary) || product?.images?.[0], '');
    };

    const restoreBundleItemBaseDisplay = (item) => ({
        ...item,
        variant_id: null,
        variant_label: '',
        name: item.product_name || item.name,
        sku: item.product_sku || item.sku,
        price: item.product_price ?? item.price,
        cost_price: item.product_cost_price ?? item.cost_price,
        image_url: item.product_image_url || item.image_url,
    });

    const applyBundleItemVariantDisplay = (item, variant) => {
        if (!variant) {
            return restoreBundleItemBaseDisplay(item);
        }

        return {
            ...item,
            variant_id: variant.id,
            variant_label: getBundleVariantLabel(variant),
            name: variant.name || item.product_name || item.name,
            sku: variant.sku || item.product_sku || item.sku,
            price: normalizeMoneyValue(variant.price ?? item.price),
            cost_price: resolveDuplicateSafeCost(variant.cost_price, item.product_cost_price),
            image_url: resolveBundleItemImage(variant) || item.product_image_url || item.image_url,
            legacy_missing_variant: false,
        };
    };

    const resolveLegacyBundleVariantSelection = (item, variants = [], siblingItems = []) => {
        if (!item?.legacy_missing_variant || !Array.isArray(variants) || variants.length === 0) {
            return null;
        }

        const normalizedItemSku = normalizeSkuSeed(item.product_sku || item.sku || '');
        if (normalizedItemSku) {
            const matchedBySku = variants.find((variant) => normalizeSkuSeed(variant?.sku) === normalizedItemSku);
            if (matchedBySku) {
                return matchedBySku;
            }
        }

        const normalizedItemName = String(item.product_name || item.name || '').trim().toLocaleLowerCase('vi');
        if (normalizedItemName) {
            const matchedByName = variants.filter((variant) => (
                String(variant?.name || '').trim().toLocaleLowerCase('vi') === normalizedItemName
            ));
            if (matchedByName.length === 1) {
                return matchedByName[0];
            }
        }

        const normalizedItemPrice = normalizeWholeMoneyNumber(item?.price);
        if (normalizedItemPrice !== null) {
            const matchedByPrice = variants.filter((variant) => (
                normalizeWholeMoneyNumber(variant?.price) === normalizedItemPrice
            ));
            if (matchedByPrice.length === 1) {
                return matchedByPrice[0];
            }
        }

        const currentEntryKey = String(item.entry_id || item.id || '');
        const usedVariantIds = new Set(
            siblingItems
                .filter((sibling) => (
                    getBundleItemProductId(sibling) === getBundleItemProductId(item)
                    && String(sibling.entry_id || sibling.id || '') !== currentEntryKey
                    && sibling?.variant_id
                ))
                .map((sibling) => Number(sibling.variant_id))
                .filter(Boolean)
        );

        return variants.find((variant) => !usedVariantIds.has(Number(variant.id))) || variants[0] || null;
    };

    const hydrateBundleItemsWithVariants = (productId, variants = []) => {
        const normalizedProductId = Number(productId);
        if (!normalizedProductId) {
            return;
        }

        let autoResolvedCount = 0;

        setBundleOptions((prev) => prev.map((option) => ({
            ...option,
            items: option.items.map((item) => {
                if (getBundleItemProductId(item) !== normalizedProductId) {
                    return item;
                }

                const selectedVariant = item.variant_id
                    ? variants.find((variant) => Number(variant.id) === Number(item.variant_id))
                    : null;
                if (selectedVariant) {
                    return applyBundleItemVariantDisplay(item, selectedVariant);
                }

                const baseItem = restoreBundleItemBaseDisplay(item);
                const fallbackVariant = resolveLegacyBundleVariantSelection(baseItem, variants, option.items);
                if (!fallbackVariant) {
                    return baseItem;
                }

                autoResolvedCount += 1;
                return applyBundleItemVariantDisplay(baseItem, fallbackVariant);
            }),
        })));

        if (autoResolvedCount > 0 && !legacyBundleVariantRepairNoticeShownRef.current) {
            legacyBundleVariantRepairNoticeShownRef.current = true;
            showToast({
                message: 'Một số item bundle cũ chưa có biến thể đã được tự chọn tạm biến thể đầu tiên. Vui lòng kiểm tra lại trước khi lưu.',
                type: 'warning',
            });
        }
    };

    const loadBundleVariantsForProduct = async (productId, forceRefresh = false) => {
        const normalizedProductId = Number(productId);
        if (!normalizedProductId) {
            return [];
        }

        const cachedVariants = bundleItemVariants[normalizedProductId];
        if (!forceRefresh && cachedVariants) {
            hydrateBundleItemsWithVariants(normalizedProductId, cachedVariants);
            return cachedVariants;
        }

        try {
            const response = await productApi.getOne(normalizedProductId, { context: 'edit' });
            const variants = (response.data.linked_products || []).filter((product) => (
                product.pivot?.link_type === 'super_link'
                && normalizeVariantStatus(product.status, true)
            ));
            setBundleItemVariants((prev) => ({ ...prev, [normalizedProductId]: variants }));
            hydrateBundleItemsWithVariants(normalizedProductId, variants);
            return variants;
        } catch (error) {
            console.error('Error fetching bundle item variants', error);
            return [];
        }
    };

    const resolveBundleOptionsForSubmit = async () => {
        if (formData.type !== 'bundle') {
            return {
                nextOptions: bundleOptions,
                compositeItems: compositeItemsForPricing,
                unresolvedItems: [],
                autoResolvedCount: 0,
            };
        }

        const nextOptions = (Array.isArray(bundleOptions) ? bundleOptions : []).map((option) => ({
            ...option,
            items: (Array.isArray(option?.items) ? option.items : []).map((item) => ({ ...item })),
        }));

        const candidates = new Map();
        nextOptions.forEach((option) => {
            (option.items || []).forEach((item) => {
                if (item?.variant_id) {
                    return;
                }

                const productId = getBundleItemProductId(item);
                if (!productId) {
                    return;
                }

                if (item?.type === 'configurable' || !item?.type) {
                    candidates.set(productId, {
                        needsTypeCheck: candidates.get(productId)?.needsTypeCheck || !item?.type,
                    });
                }
            });
        });

        if (candidates.size === 0) {
            return {
                nextOptions,
                compositeItems: flattenBundleOptionsToCompositeItems(nextOptions),
                unresolvedItems: [],
                autoResolvedCount: 0,
            };
        }

        const productTypes = {};
        const variantsByProductId = {};
        const variantCacheUpdates = {};

        await Promise.all(Array.from(candidates.entries()).map(async ([productId, meta]) => {
            const cachedVariants = bundleItemVariants[productId];
            if (!meta.needsTypeCheck && cachedVariants) {
                productTypes[productId] = 'configurable';
                variantsByProductId[productId] = cachedVariants;
                return;
            }

            try {
                const response = await productApi.getOne(productId, { context: 'edit' });
                const product = response.data || {};
                productTypes[productId] = product.type || '';

                if (product.type === 'configurable') {
                    const variants = (product.linked_products || []).filter((variant) => (
                        variant?.pivot?.link_type === 'super_link'
                        && normalizeVariantStatus(variant.status, true)
                    ));
                    variantsByProductId[productId] = variants;
                    variantCacheUpdates[productId] = variants;
                }
            } catch (error) {
                console.error('Error resolving bundle item variant before submit', error);
                if (cachedVariants) {
                    productTypes[productId] = 'configurable';
                    variantsByProductId[productId] = cachedVariants;
                }
            }
        }));

        if (Object.keys(variantCacheUpdates).length > 0) {
            setBundleItemVariants((prev) => ({ ...prev, ...variantCacheUpdates }));
        }

        let autoResolvedCount = 0;
        const unresolvedItems = [];
        const resolvedOptions = nextOptions.map((option) => ({
            ...option,
            items: (option.items || []).map((item) => {
                if (item?.variant_id) {
                    return item;
                }

                const productId = getBundleItemProductId(item);
                const productType = item?.type || productTypes[productId] || '';
                if (productType !== 'configurable') {
                    return productType && item?.type !== productType
                        ? { ...item, type: productType }
                        : item;
                }

                const variants = variantsByProductId[productId] || [];
                const baseItem = restoreBundleItemBaseDisplay({
                    ...item,
                    type: 'configurable',
                    legacy_missing_variant: true,
                });
                const fallbackVariant = resolveLegacyBundleVariantSelection(baseItem, variants, option.items)
                    || variants[0]
                    || null;

                if (!fallbackVariant) {
                    unresolvedItems.push({ ...baseItem, type: 'configurable' });
                    return { ...baseItem, type: 'configurable' };
                }

                autoResolvedCount += 1;
                return applyBundleItemVariantDisplay({ ...baseItem, type: 'configurable' }, fallbackVariant);
            }),
        }));

        if (autoResolvedCount > 0 || unresolvedItems.length > 0) {
            setBundleOptions(resolvedOptions);
        }

        return {
            nextOptions: resolvedOptions,
            compositeItems: flattenBundleOptionsToCompositeItems(resolvedOptions),
            unresolvedItems,
            autoResolvedCount,
        };
    };

    const localSkuValidation = useMemo(() => {
        const parentSku = normalizeSkuDraft(formData.sku);
        const errors = {
            parent: '',
            variants: {},
        };
        const seen = new Map();

        if (!parentSku) {
            errors.parent = 'Mã sản phẩm không được để trống.';
        } else {
            seen.set(parentSku, { type: 'parent' });
        }

        variants.forEach((variant, index) => {
            const variantSku = normalizeSkuDraft(variant?.sku);
            if (!variantSku) {
                errors.variants[index] = 'Biến thể này chưa có mã SKU.';
                return;
            }

            const existing = seen.get(variantSku);
            if (existing) {
                if (existing.type === 'parent') {
                    errors.parent = errors.parent || 'Mã sản phẩm cha đang trùng với một biến thể.';
                } else if (errors.variants[existing.index] === undefined) {
                    errors.variants[existing.index] = 'Mã biến thể đang bị trùng trong danh sách.';
                }

                errors.variants[index] = 'Mã biến thể đang bị trùng trong danh sách.';
                return;
            }

            seen.set(variantSku, { type: 'variant', index });
        });

        return {
            parent: errors.parent,
            variants: errors.variants,
            hasErrors: Boolean(errors.parent) || Object.keys(errors.variants).length > 0,
        };
    }, [formData.sku, variants]);

    const parentSkuError = localSkuValidation.parent || serverValidationErrors?.sku?.[0] || '';
    const getVariantSkuError = useCallback((index) => (
        localSkuValidation.variants[index]
        || serverValidationErrors?.[`variants.${index}.sku`]?.[0]
        || serverValidationErrors?.[`variants.${index}.id`]?.[0]
        || ''
    ), [localSkuValidation.variants, serverValidationErrors]);

    const getVariantSelectionKey = useCallback((variant, index) => (
        String(variant?.id ?? `variant_${index}`)
    ), []);

    const selectedVariantIdSet = useMemo(() => new Set(selectedVariantIds), [selectedVariantIds]);
    const selectedHiddenVariantIdSet = useMemo(() => new Set(selectedHiddenVariantIds), [selectedHiddenVariantIds]);
    const visibleVariantEntries = useMemo(
        () => variants.map((variant, index) => ({
            variant,
            index,
            selectionKey: getVariantSelectionKey(variant, index),
        })).filter((entry) => isActiveVariantDraft(entry.variant)),
        [getVariantSelectionKey, variants]
    );
    const hiddenVariantEntries = useMemo(
        () => variants.map((variant, index) => ({
            variant,
            index,
            selectionKey: getVariantSelectionKey(variant, index),
        })).filter((entry) => !isActiveVariantDraft(entry.variant)),
        [getVariantSelectionKey, variants]
    );
    const visibleVariantCount = visibleVariantEntries.length;
    const hiddenVariantCount = hiddenVariantEntries.length;
    const selectedVariantCount = useMemo(
        () => visibleVariantEntries.reduce((count, entry) => (
            selectedVariantIdSet.has(entry.selectionKey) ? count + 1 : count
        ), 0),
        [selectedVariantIdSet, visibleVariantEntries]
    );
    const selectedHiddenVariantCount = useMemo(
        () => hiddenVariantEntries.reduce((count, entry) => (
            selectedHiddenVariantIdSet.has(entry.selectionKey) ? count + 1 : count
        ), 0),
        [hiddenVariantEntries, selectedHiddenVariantIdSet]
    );
    const hasLocalDraftVariants = useMemo(
        () => variants.some((variant) => isLocalDraftVariantId(variant?.id)),
        [variants]
    );
    const isAllVariantsSelected = visibleVariantCount > 0 && selectedVariantCount === visibleVariantCount;
    const hasPartialVariantSelection = selectedVariantCount > 0 && !isAllVariantsSelected;
    const isAllHiddenVariantsSelected = hiddenVariantCount > 0 && selectedHiddenVariantCount === hiddenVariantCount;
    const hasPartialHiddenVariantSelection = selectedHiddenVariantCount > 0 && !isAllHiddenVariantsSelected;
    const variantQuickUpdateTargetCount = variantQuickUpdateScope === 'selected' ? selectedVariantCount : visibleVariantCount;
    const lastDeletedVariantCount = lastDeletedVariantBatch?.items?.length || 0;
    const hasRestorableDeletedVariantBatch = lastDeletedVariantCount > 0;
    const canApplyVariantQuickUpdate = useMemo(
        () => variantQuickUpdateTargetCount > 0 && Object.values(variantQuickUpdateForm).some((value) => value !== ''),
        [variantQuickUpdateForm, variantQuickUpdateTargetCount]
    );
    const variantImageLibraryItems = useMemo(
        () => images.map((image, index) => ({
            ...image,
            display_name: getAdminImageDisplayName(image, index),
        })),
        [images]
    );
    const bundleOptionImageLibraryItems = useMemo(() => {
        const seenUrls = new Set();
        return variantImageLibraryItems
            .map((image) => ({
                ...image,
                library_source: 'product',
            }))
            .filter((image) => {
                const imageUrl = String(image?.image_url || '').trim();
                if (!imageUrl || seenUrls.has(imageUrl)) {
                    return false;
                }

                seenUrls.add(imageUrl);
                return true;
            });
    }, [variantImageLibraryItems]);
    const descriptionImageLibraryItems = useMemo(() => {
        const seenUrls = new Set();

        return variantImageLibraryItems
            .map((image, index) => ({
                ...image,
                image_url: image?.large_url || image?.medium_url || image?.image_url || '',
                display_name: image?.display_name || getAdminImageDisplayName(image, index),
            }))
            .filter((image) => {
                const imageUrl = String(image?.image_url || '').trim();
                if (!imageUrl || seenUrls.has(imageUrl)) {
                    return false;
                }

                seenUrls.add(imageUrl);
                return true;
            });
    }, [variantImageLibraryItems]);
    const bundleOptionImagePickerOption = useMemo(() => (
        bundleOptionImagePicker.optionId === null
            ? null
            : (bundleOptions.find((option) => option.id === bundleOptionImagePicker.optionId) || null)
    ), [bundleOptionImagePicker.optionId, bundleOptions]);
    const variantImagePickerVariant = useMemo(() => (
        variantImagePicker.index === null ? null : (variants[variantImagePicker.index] || null)
    ), [variantImagePicker.index, variants]);
    const activeVariantLibraryImage = useMemo(() => {
        if (!variantImagePickerVariant) {
            return null;
        }

        if (variantImagePickerVariant.library_image_id) {
            return variantImageLibraryItems.find((image) => (
                String(image?.id || '') === String(variantImagePickerVariant.library_image_id)
            )) || null;
        }

        if (variantImagePickerVariant.image_url) {
            return variantImageLibraryItems.find((image) => (
                String(image?.image_url || '') === String(variantImagePickerVariant.image_url || '')
            )) || null;
        }

        return variantImageLibraryItems.find((image) => image?.is_primary) || variantImageLibraryItems[0] || null;
    }, [variantImageLibraryItems, variantImagePickerVariant]);
    const openImageLightbox = useCallback((url, alt = '') => {
        const resolvedUrl = String(url || '').trim();
        if (!resolvedUrl) {
            return;
        }

        setLightboxImage({
            url: resolvedUrl,
            alt: alt || 'Xem ảnh lớn',
        });
    }, []);
    const closeImageLightbox = useCallback(() => {
        setLightboxImage(null);
    }, []);

    const closeBundleOptionImagePicker = useCallback(() => {
        setBundleOptionImagePicker((prev) => ({
            optionId: null,
            top: 0,
            left: 0,
            width: prev.width || 380,
        }));
    }, []);

    const openBundleOptionImagePicker = useCallback((optionId, anchorElement) => {
        const nextPosition = buildVariantImagePickerPosition(
            anchorElement?.getBoundingClientRect?.(),
            380,
            492,
        );

        setBundleOptionImagePicker((prev) => (
            prev.optionId === optionId
                ? { optionId: null, top: 0, left: 0, width: prev.width || nextPosition.width }
                : { optionId, ...nextPosition }
        ));
    }, []);

    const handleSelectBundleOptionLibraryImage = useCallback(async (optionId, image) => {
        let imageUrl = String(image?.image_url || image?.url || image?.path || '').trim();
        if (!imageUrl) {
            return;
        }

        if (isTransientImageUrl(imageUrl)) {
            if (!image?.file) {
                showToast({
                    message: 'Anh nay chua co URL luu tru. Hay tai lai anh trong popup roi thu lai.',
                    type: 'warning',
                });
                return;
            }

            try {
                imageUrl = await uploadImageViaMediaApi(image.file);
            } catch (error) {
                showToast({
                    message: resolveProductImageUploadErrorMessage(error),
                    type: 'error',
                    duration: 7000,
                });
                return;
            }
        }

        setBundleOptions((prev) => prev.map((option) => (
            option.id === optionId ? { ...option, image_url: imageUrl } : option
        )));
        closeBundleOptionImagePicker();
    }, [closeBundleOptionImagePicker, showToast]);

    useEffect(() => {
        setSelectedVariantIds((prev) => {
            if (prev.length === 0) return prev;
            const validIds = new Set(variants.map((variant, index) => getVariantSelectionKey(variant, index)));
            const next = prev.filter((id) => validIds.has(id));
            return next.length === prev.length ? prev : next;
        });
    }, [getVariantSelectionKey, variants]);

    useEffect(() => () => {
        if (variantImageCellClickTimeoutRef.current) {
            window.clearTimeout(variantImageCellClickTimeoutRef.current);
        }

        if (variantLibraryImageClickTimeoutRef.current) {
            window.clearTimeout(variantLibraryImageClickTimeoutRef.current);
        }
    }, []);

    useEffect(() => {
        if (variantQuickUpdateScope === 'selected' && selectedVariantCount === 0) {
            setVariantQuickUpdateScope('all');
        }
    }, [selectedVariantCount, variantQuickUpdateScope]);

    useEffect(() => {
        if (bundleOptionImagePicker.optionId === null) {
            return undefined;
        }

        const handlePointerDown = (event) => {
            const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
            if (
                bundleOptionImagePickerRef.current?.contains(event.target)
                || eventPath.includes(bundleOptionImagePickerRef.current)
            ) {
                return;
            }

            closeBundleOptionImagePicker();
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                closeBundleOptionImagePicker();
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', closeBundleOptionImagePicker);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', closeBundleOptionImagePicker);
        };
    }, [bundleOptionImagePicker.optionId, closeBundleOptionImagePicker]);

    const closeVariantImagePicker = useCallback(() => {
        variantImagePickerAnchorRef.current = null;
        setVariantImagePicker((prev) => (
            prev.index === null
                ? prev
                : { index: null, top: 0, left: 0, width: prev.width || 336 }
        ));
    }, []);

    useEffect(() => {
        if (variantImagePicker.index === null) {
            return undefined;
        }

        const handlePointerDown = (event) => {
            const target = event.target;
            if (variantImagePickerRef.current?.contains(target)) {
                return;
            }
            if (variantImagePickerAnchorRef.current?.contains?.(target)) {
                return;
            }
            closeVariantImagePicker();
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                closeVariantImagePicker();
            }
        };

        const handleViewportChange = () => {
            closeVariantImagePicker();
        };

        document.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [closeVariantImagePicker, variantImagePicker.index]);

    useEffect(() => {
        const nextOwnedUrls = new Set(
            variants
                .filter((variant) => (
                    variant?.image_preview_owned
                    && String(variant?.image_url || '').startsWith('blob:')
                ))
                .map((variant) => variant.image_url)
        );

        ownedVariantPreviewUrlsRef.current.forEach((url) => {
            if (!nextOwnedUrls.has(url)) {
                URL.revokeObjectURL(url);
            }
        });

        ownedVariantPreviewUrlsRef.current = nextOwnedUrls;
    }, [variants]);

    useEffect(() => {
        if (variantImagePicker.index !== null && !variants[variantImagePicker.index]) {
            closeVariantImagePicker();
        }
    }, [closeVariantImagePicker, variantImagePicker.index, variants]);

    useEffect(() => () => {
        ownedVariantPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
        ownedVariantPreviewUrlsRef.current = new Set();
    }, []);

    const appendAiInstruction = useCallback((suggestion) => {
        setAiInstruction((prev) => {
            const normalizedPrev = prev.trim();
            if (!normalizedPrev) return suggestion;
            if (normalizedPrev.includes(suggestion)) return prev;
            return `${normalizedPrev}\n- ${suggestion}`;
        });
    }, []);

    const imageHandler = useCallback(() => {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/*');
        input.click();

        input.onchange = async () => {
            const file = input.files[0];
            if (file) {
                try {
                    const url = await uploadImageViaMediaApi(file);

                    let quill;
                    try {
                        quill = quillRef.current.getEditor();
                    } catch (e) { return; }
                    const range = quill.getSelection();
                    quill.insertEmbed(range.index, 'image', url);

                    // Set default width to 100% or allow resizing later
                    quill.setSelection(range.index + 1);
                } catch (error) {
                    showToast({
                        message: resolveProductImageUploadErrorMessage(error),
                        type: 'error',
                        duration: 7000,
                    });
                    return;
                    showToast('Lỗi khi tải ảnh lên', 'error');
                }
            }
        };
    }, [showToast]);

    const videoHandler = useCallback(() => {
        const url = prompt('Nhập link video (Facebook hoặc YouTube):');
        if (!url) return;

        let embedUrl = url;

        // Detect YouTube
        const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        if (ytMatch) {
            embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
        }

        // Detect Facebook
        const fbMatch = url.match(/(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:watch\/\?v=|.*\/videos\/|video\.php\?v=)(\d+)/);
        if (fbMatch || url.includes('facebook.com')) {
            embedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
        }

        let quill;
        try {
            quill = quillRef.current.getEditor();
        } catch(e) { return; }
        const range = quill.getSelection();
        quill.insertEmbed(range.index, 'video', embedUrl);
        quill.setSelection(range.index + 1);
    }, []);

    const quillModules = useMemo(() => ({
        toolbar: {
            container: [
                [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                [{ 'align': [] }],
                ['link', 'image', 'video'],
                ['fullscreen'],
                ['clean']
            ],
            handlers: {
                image: imageHandler,
                video: videoHandler,
                fullscreen: () => setIsEditorFullscreen(prev => !prev)
            }
        },
        resize: {
            locale: {
                altTip: "Nhấn chuột vào đây để thay đổi thuộc tính ảnh",
                floatLeft: "Căn trái",
                floatRight: "Căn phải",
                center: "Căn giữa",
                restore: "Trở về mặc định",
            }
        }
    }), [imageHandler, videoHandler]);

    const handleVariantColumnResize = useCallback((colId, e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = variantTableWidths[colId];

        const onMouseMove = (moveEvent) => {
            const newWidth = Math.max(colId === 'actions' || colId === 'image' ? 40 : 60, startWidth + (moveEvent.clientX - startX));
            setVariantTableWidths(prev => ({ ...prev, [colId]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [variantTableWidths]);

    const navigateBackToOrigin = useCallback(() => {
        if (returnContext?.target) {
            navigate(returnContext.target, {
                state: {
                    returnContext,
                },
            });
            return;
        }

        navigate('/admin/products');
    }, [navigate, returnContext]);

    const handleCancel = useCallback(() => {
        navigateBackToOrigin();
    }, [navigateBackToOrigin]);

    const handleCopyContent = useCallback(() => {
        const content = formData.description;
        if (!content) {
            showToast('Nội dung trống', 'warning');
            return;
        }
        navigator.clipboard.writeText(content).then(() => {
            showToast('Đã sao chép HTML mô tả!', 'success');
        }).catch(err => {
            showToast('Lỗi khi sao chép', 'error');
        });
    }, [formData.description, showToast]);

    const handleApplyDescriptionHtmlPaste = useCallback((html) => {
        let normalizedHtml = String(html || '').trim();
        normalizedHtml = normalizedHtml.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();

        if (!normalizedHtml) {
            showToast({
                message: 'HTML đang trống.',
                type: 'warning',
            });
            return;
        }

        setFormData((prev) => ({
            ...prev,
            description: normalizedHtml,
        }));
        setDescriptionHtmlPasteOpen(false);
        showToast({
            message: 'Đã áp dụng HTML mô tả mới.',
            type: 'success',
        });
    }, [showToast]);

    const handleOpenDescriptionImageLibrary = useCallback(() => {
        if (descriptionImageLibraryItems.length === 0) {
            showToast({
                message: 'Sản phẩm này chưa có ảnh trong thư viện để chèn vào mô tả.',
                type: 'warning',
            });
            return;
        }

        setDescriptionImageLibraryOpen(true);
    }, [descriptionImageLibraryItems.length, showToast]);

    const handleInsertDescriptionLibraryImage = useCallback(async (image) => {
        let imageUrl = String(image?.large_url || image?.medium_url || image?.image_url || image?.url || image?.path || '').trim();

        if (!imageUrl) {
            showToast({
                message: 'Ảnh này chưa có URL hợp lệ.',
                type: 'warning',
            });
            return;
        }

        if (isTransientImageUrl(imageUrl)) {
            if (!image?.file) {
                showToast({
                    message: 'Ảnh này chưa được lưu. Hãy lưu sản phẩm hoặc tải ảnh lên trước khi chèn vào mô tả.',
                    type: 'warning',
                });
                return;
            }

            try {
                imageUrl = await uploadImageViaMediaApi(image.file);
            } catch (error) {
                showToast({
                    message: resolveProductImageUploadErrorMessage(error),
                    type: 'error',
                    duration: 7000,
                });
                return;
            }
        }

        try {
            const quill = quillRef.current?.getEditor?.();
            if (quill) {
                const range = quill.getSelection(true);
                const insertIndex = Number.isFinite(range?.index)
                    ? range.index
                    : Math.max((quill.getLength?.() || 1) - 1, 0);

                quill.insertEmbed(insertIndex, 'image', imageUrl, 'user');
                quill.insertText(insertIndex + 1, '\n', 'user');
                quill.setSelection(insertIndex + 2, 0, 'silent');
                setFormData((prev) => ({ ...prev, description: quill.root.innerHTML }));
            } else {
                const fallbackHtml = `<p><img src="${escapeHtmlAttribute(imageUrl)}" alt="${escapeHtmlAttribute(formData.name || image?.display_name || 'Ảnh sản phẩm')}" /></p>`;
                setFormData((prev) => ({ ...prev, description: `${prev.description || ''}${fallbackHtml}` }));
            }

            setDescriptionImageLibraryOpen(false);
            showToast({
                message: 'Đã chèn ảnh vào mô tả sản phẩm.',
                type: 'success',
            });
        } catch {
            showToast({
                message: 'Không thể chèn ảnh vào editor lúc này.',
                type: 'error',
            });
        }
    }, [formData.name, showToast]);

    const handleWordImport = useCallback(async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            const arrayBuffer = loadEvent.target.result;
            try {
                const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
                const html = result.value;
                setFormData(prev => ({ ...prev, description: prev.description + html }));
                showToast('Import từ Word thành công!', 'success');
            } catch (err) {
                showToast('Lỗi khi đọc file Word', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
        // Reset input
        e.target.value = '';
    }, [showToast]);

    // Handle replacement and actions for images and videos
    useEffect(() => {
        if (!quillRef.current) return;
        let quill;
        try {
            quill = quillRef.current.getEditor();
        } catch (e) { return; }
        const editorRoot = quill.root;
        const editorContainer = editorRoot.closest('.quill');

        const removeExistingPopups = () => {
            const existing = document.querySelectorAll('.ql-image-actions-popup');
            existing.forEach(el => el.remove());
        };

        const handleEditorClick = (e) => {
            const target = e.target;

            // Remove popup if clicking elsewhere
            if (target.tagName !== 'IMG' && !target.closest('.ql-image-actions-popup')) {
                removeExistingPopups();
                return;
            }

            if (target.tagName === 'IMG') {
                e.preventDefault();
                e.stopPropagation();
                removeExistingPopups();

                const popup = document.createElement('div');
                popup.className = 'ql-image-actions-popup';

                // Position relative to the editor container for better stability
                const rect = target.getBoundingClientRect();
                const containerRect = editorContainer.getBoundingClientRect();

                // Position calculations
                const top = rect.top - containerRect.top - 50;
                const left = rect.left - containerRect.left + (rect.width / 2);

                popup.style.top = `${top}px`;
                popup.style.left = `${left}px`;
                popup.style.position = 'absolute';
                popup.style.transform = 'translateX(-50%)';
                popup.style.zIndex = '10005';

                // View
                const btnView = document.createElement('button');
                btnView.innerHTML = '<span class="material-symbols-outlined">visibility</span> Xem';
                btnView.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    window.open(target.src, '_blank');
                };

                // Edit/Replace - Keep dimensions
                const btnEdit = document.createElement('button');
                btnEdit.innerHTML = '<span class="material-symbols-outlined">edit</span> Thay ảnh';
                btnEdit.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async () => {
                        const file = input.files[0];
                        if (file) {
                            try {
                                const url = await uploadImageViaMediaApi(file);
                                // Replace src but keep existing width/height/style
                                target.src = url;
                                // Update form state
                                setFormData(prev => ({ ...prev, description: editorRoot.innerHTML }));
                                showToast('Đã cập nhật ảnh mới, giữ nguyên kích thước', 'success');
                                removeExistingPopups();
                            } catch (err) {
                                showToast({
                                    message: resolveProductImageUploadErrorMessage(err),
                                    type: 'error',
                                    duration: 7000,
                                });
                                return;
                                showToast('Lỗi khi tải ảnh mới', 'error');
                            }
                        }
                    };
                    input.click();
                };

                // Delete
                const btnDelete = document.createElement('button');
                btnDelete.className = 'delete';
                btnDelete.innerHTML = '<span class="material-symbols-outlined">delete</span> Xóa';
                btnDelete.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (confirm('Xóa ảnh này ra khỏi nội dung?')) {
                        target.remove();
                        setFormData(prev => ({ ...prev, description: editorRoot.innerHTML }));
                        showToast('Đã xóa ảnh', 'success');
                        removeExistingPopups();
                    }
                };

                popup.appendChild(btnView);
                popup.appendChild(btnEdit);
                popup.appendChild(btnDelete);

                if (editorContainer) {
                    editorContainer.style.position = 'relative';
                    editorContainer.appendChild(popup);
                }
            }
        };

        const handleEditorDblClick = (e) => {
            const target = e.target;
            const iframe = target.closest('iframe');
            if (iframe && iframe.classList.contains('ql-video')) {
                const newUrl = prompt('Nhập link video mới:', iframe.src);
                if (newUrl && newUrl !== iframe.src) {
                    let finalUrl = newUrl;
                    const ytMatch = newUrl.match(/(?:\/watch\?v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                    if (ytMatch) {
                        finalUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
                    } else if (newUrl.includes('facebook.com')) {
                        finalUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(newUrl)}&show_text=0`;
                    }
                    iframe.src = finalUrl;
                    setFormData(prev => ({ ...prev, description: editorRoot.innerHTML }));
                    showToast('Đã thay video mới', 'success');
                }
            }
        };

        editorRoot.addEventListener('click', handleEditorClick);
        editorRoot.addEventListener('dblclick', handleEditorDblClick);

        return () => {
            editorRoot.removeEventListener('click', handleEditorClick);
            editorRoot.removeEventListener('dblclick', handleEditorDblClick);
            removeExistingPopups();
        };
    }, [showToast, mediaApi]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (lightboxImage?.url) return;

                // Precedence 1: Don't close form if a global UI Modal is open
                if (document.body.style.overflow === 'hidden') return;

                // Precedence 2: Don't close if focusing on input/textarea/editor that might use ESC
                const active = document.activeElement;
                const isWriting = active && (
                    active.tagName === 'INPUT' ||
                    active.tagName === 'TEXTAREA' ||
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                );

                if (isWriting) return;

                handleCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleCancel, lightboxImage?.url]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (relatedSearchContainerRef.current && !relatedSearchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(event.target)) setSupplierPickerOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const addToSearchHistory = (term) => {
        if (!term || term.trim() === '' || term.length < 2) return;
        setSearchHistory(prev => {
            const filtered = prev.filter(item => item !== term);
            const updated = [term, ...filtered].slice(0, 10);
            localStorage.setItem('product_search_history', JSON.stringify(updated));
            return updated;
        });
    };

    useEffect(() => {
        fetchCategories();
        fetchSuppliers();
        fetchInventoryUnits();
        fetchRelatedData();
        if (isEdit) {
            fetchProduct();
        } else {
            setProductMeta({ originalType: '', parentConfigurable: null });
            setConvertToConfigurableForm(buildInitialConvertToConfigurableForm());
            setExistingVariantSuperAttributes([]);
        }
        fetchBlogPosts();
        fetchDomains();
    }, [id, isEdit]);

    useEffect(() => {
        if (!inventoryUnits.length) return;
        setFormData((prev) => {
            if (prev.inventory_unit_id) return prev;
            const preferred = inventoryUnits.find((unit) => unit.is_default) || inventoryUnits[0];
            return preferred ? { ...prev, inventory_unit_id: String(preferred.id) } : prev;
        });
    }, [inventoryUnits]);
    useEffect(() => {
        return () => {
            // Cleanup object URLs to avoid memory leaks
            images.forEach(img => {
                if (img.image_url && img.image_url.startsWith('blob:')) {
                    URL.revokeObjectURL(img.image_url);
                }
            });
        };
    }, [images]);

    // Keyboard bindings for deletion of selected images
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (lightboxImage?.url) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                const active = document.activeElement;
                if (active && (
                    active.tagName === 'INPUT' ||
                    active.tagName === 'TEXTAREA' ||
                    active.classList.contains('ql-editor') ||
                    active.getAttribute('contenteditable') === 'true'
                )) return;

                if (selectedImages.length > 0) {
                    handleDeleteSelectedImages();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [lightboxImage?.url, selectedImages]); // Need selectedImages in deps

    // Global mouse lift to end drag select
    useEffect(() => {
        const handleMouseUp = () => setIsDragSelecting(false);
        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, []);

    const fetchCategories = async () => {
        try {
            const response = await categoryApi.getAll();
            setCategories(response.data);
        } catch (error) {
            console.error("Error fetching categories", error);
        }
    };

    const fetchSuppliers = async () => {
        try {
            const response = await inventoryApi.getSuppliers({ per_page: 500 });
            setSuppliers(response.data?.data || []);
        } catch (error) {
            console.error("Error fetching suppliers", error);
        }
    };

    const fetchInventoryUnits = async () => {
        try {
            const response = await inventoryApi.getUnits();
            const units = Array.isArray(response.data) ? response.data : [];
            setInventoryUnits(units);
            return units;
        } catch (error) {
            console.error("Error fetching inventory units", error);
            return [];
        }
    };

    const handleCreateInventoryUnit = async (initialValue = '', options = {}) => {
        const { selectUnit = true } = options;
        const nextName = window.prompt('Nhập đơn vị tính mới', initialValue)?.trim();
        if (!nextName) return null;

        try {
            const response = await inventoryApi.createUnit({ name: nextName });
            const unit = response.data;

            const refreshedUnits = await fetchInventoryUnits();
            const resolvedUnit = refreshedUnits.find((item) => String(item.id) === String(unit.id)) || unit;

            if (!refreshedUnits.length) {
                setInventoryUnits((prev) => (
                    prev.some((item) => String(item.id) === String(unit.id))
                        ? prev
                        : [...prev, unit]
                ));
            }

            if (selectUnit && resolvedUnit?.id) {
                setFormData((prev) => ({ ...prev, inventory_unit_id: String(resolvedUnit.id) }));
            }
            showToast({
                message: response.status === 201
                    ? `Đã thêm ĐVT "${resolvedUnit.name}".`
                    : `ĐVT "${resolvedUnit.name}" đã tồn tại, hệ thống đã chọn sẵn.`,
                type: 'success',
            });
            return resolvedUnit;
        } catch (error) {
            console.error("Error creating inventory unit", error);
            showToast({ message: 'Không thể tạo đơn vị tính mới.', type: 'error' });
            return null;
        }
    };

    const openInventoryUnitSorter = () => {
        if (!inventoryUnits.length) {
            showToast({ message: 'Chưa có ĐVT nào để sắp xếp.', type: 'info' });
            return;
        }

        const preferredDefaultId = String((inventoryUnits.find((unit) => unit.is_default) || inventoryUnits[0] || {}).id || '');

        setInventoryUnitsDraft(
            inventoryUnits.map((unit, index) => ({
                ...unit,
                sort_order: Number(unit?.sort_order) || (index + 1),
                is_default: String(unit.id) === preferredDefaultId,
            }))
        );
        setShowInventoryUnitSorter(true);
    };

    const closeInventoryUnitSorter = () => {
        if (isSavingInventoryUnitOrder) return;
        setShowInventoryUnitSorter(false);
        setInventoryUnitsDraft([]);
    };

    const moveInventoryUnitDraftByOffset = (index, offset) => {
        setInventoryUnitsDraft((prev) => {
            const next = moveListItem(prev, index, index + offset);
            return next === prev
                ? prev
                : next.map((unit, itemIndex) => ({
                    ...unit,
                    sort_order: itemIndex + 1,
                }));
        });
    };

    const setInventoryUnitDraftDefault = (unitId) => {
        setInventoryUnitsDraft((prev) => prev.map((unit) => ({
            ...unit,
            is_default: String(unit.id) === String(unitId),
        })));
    };

    const handleSaveInventoryUnitOrder = async () => {
        if (isSavingInventoryUnitOrder) return;
        if (!inventoryUnitsDraft.length) {
            closeInventoryUnitSorter();
            return;
        }

        if (!inventoryUnitOrderChanged) {
            closeInventoryUnitSorter();
            return;
        }

        setIsSavingInventoryUnitOrder(true);
        try {
            const latestUnits = await fetchInventoryUnits();
            const { ids: reorderedUnitIds, defaultId } = buildInventoryUnitReorderPayload(
                inventoryUnitsDraft,
                latestUnits.length ? latestUnits : inventoryUnits
            );

            await inventoryApi.reorderUnits(reorderedUnitIds, defaultId);
            const refreshedUnits = await fetchInventoryUnits();

            if (!refreshedUnits.length) {
                setInventoryUnits(
                    inventoryUnitsDraft.map((unit, index) => ({
                        ...unit,
                        sort_order: index + 1,
                    }))
                );
            }

            setShowInventoryUnitSorter(false);
            setInventoryUnitsDraft([]);
            showToast({ message: 'Đã cập nhật thứ tự và ĐVT mặc định.', type: 'success' });
        } catch (error) {
            console.error("Error reordering inventory units", error);
            showToast({
                message: resolveApiErrorMessage(error, 'Không thể lưu cấu hình ĐVT.'),
                type: 'error',
            });
            await fetchInventoryUnits();
        } finally {
            setIsSavingInventoryUnitOrder(false);
        }
    };

    const fetchRelatedData = async () => {
        try {
            const attrRes = await attributeApi.getAll({ active_only: true });
            setAllAttributes(sortAttributesBySortOrder(attrRes.data || []));
        } catch (error) {
            console.error("Error fetching related data", error);
        }
    };

    const fetchBlogPosts = async () => {
        try {
            const response = await blogApi.getAll({ per_page: 200, compact: 1, view: 'picker' });
            setAllBlogPosts(sortBlogPostsNewestFirst(Array.isArray(response.data.data) ? response.data.data : []));
        } catch (error) {
            console.error("Error fetching blog posts", error);
        }
    };

    const searchBlogPosts = async (searchKey, query) => {
        const trimmedQuery = String(query || '').trim();
        if (!trimmedQuery || trimmedQuery.length < 2) {
            blogSearchRequestRef.current[searchKey] = (blogSearchRequestRef.current[searchKey] || 0) + 1;
            setBlogResults(prev => ({ ...prev, [searchKey]: [] }));
            setIsSearchingBlog(prev => ({ ...prev, [searchKey]: false }));
            return;
        }

        const normalizedQuery = normalizeSearchText(trimmedQuery);
        const localMatches = allBlogPosts
            .filter((post) => {
                const haystack = normalizeSearchText([
                    post?.title,
                    post?.slug,
                    post?.excerpt,
                ].filter(Boolean).join(' '));

                return haystack.includes(normalizedQuery);
            })
            .slice(0, 10);

        const requestId = (blogSearchRequestRef.current[searchKey] || 0) + 1;
        blogSearchRequestRef.current[searchKey] = requestId;

        setBlogResults(prev => ({ ...prev, [searchKey]: localMatches }));
        setIsSearchingBlog(prev => ({ ...prev, [searchKey]: true }));
        try {
            const response = await blogApi.getAll({
                search: trimmedQuery,
                per_page: 20,
                compact: 1,
                view: 'picker',
            });
            const remoteResults = Array.isArray(response.data.data) ? response.data.data : [];

            setAllBlogPosts(prev => mergeUniqueBlogPosts(prev, remoteResults));

            if (blogSearchRequestRef.current[searchKey] !== requestId) {
                return;
            }

            setBlogResults(prev => ({
                ...prev,
                [searchKey]: mergeUniqueBlogPosts(localMatches, remoteResults),
            }));
        } catch (error) {
            console.error("Error searching blog posts", error);
        } finally {
            if (blogSearchRequestRef.current[searchKey] === requestId) {
                setIsSearchingBlog(prev => ({ ...prev, [searchKey]: false }));
            }
        }
    };

    const fetchDomains = async () => {
        try {
            const response = await cmsApi.domains.getAll();
            setDomains(response.data.filter(d => d.is_active));
        } catch (error) {
            console.error("Error fetching domains", error);
        }
    };

    // Lazy load related products on demand
    const fetchSuggestedProducts = useCallback(async () => {
        const query = (relatedQuery || '').trim();
        const hasSearch = query.length > 0;
        const hasCategory = relatedCategory !== 'all';
        const hasAttrs = Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '');

        setSearchingRelated(true);
        try {
            // Sử dụng bộ tham số tối giản nhất tương tự OrderForm để đảm bảo tìm thấy sản phẩm
            const params = {
                per_page: 50
            };

            if (hasSearch) {
                params.search = query;
            }

            if (hasCategory) {
                params.category_ids = String(relatedCategory);
            }

            // Chỉ thêm lọc thuộc tính nếu có
            Object.entries(relatedAttrFilter).forEach(([attrId, val]) => {
                if (val && val !== 'all' && val !== '') {
                    params[`attributes[${attrId}]`] = val;
                }
            });

            // Nếu không có search/filter, dùng danh mục mặc định
            if (!hasSearch && !hasCategory && !hasAttrs && formData.category_ids.length > 0) {
                params.category_ids = formData.category_ids.join(',');
                params.sort_by = 'random';
            }

            const response = await productApi.getAll(params);
            const rawData = response.data?.data || response.data || [];
            const results = (Array.isArray(rawData) ? rawData : []).filter(p => String(p.id) !== String(id || formData.id));
            setSuggestedProducts(results);
        } catch (error) {
            console.error("Error searching products", error);
        } finally {
            setSearchingRelated(false);
        }
    }, [relatedQuery, relatedCategory, relatedAttrFilter, id, formData.id, formData.category_ids]);

    // Lazy load bundle items on demand
    const fetchBundleItems = useCallback(async () => {
        if (!bundleQuery) {
            setSuggestedBundleProducts([]);
            return;
        }

        setSearchingBundle(true);
        try {
            const response = await productApi.getAll({
                per_page: 50,
                search: bundleQuery
            });
            const results = (response.data.data || []).filter(p => p.id != id);
            setSuggestedBundleProducts(results);
        } catch (error) {
            console.error("Error searching bundle products", error);
        } finally {
            setSearchingBundle(false);
        }
    }, [bundleQuery, id]);

    // Debounce suggested products search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchSuggestedProducts();
        }, 400);
        return () => clearTimeout(timer);
    }, [fetchSuggestedProducts]);

    // Debounce bundle products search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchBundleItems();
        }, 400);
        return () => clearTimeout(timer);
    }, [fetchBundleItems]);

    const handleRefreshAttributes = async () => {
        setRefreshingAttributes(true);
        try {
            const response = await attributeApi.getAll({ active_only: true });
            setAllAttributes(sortAttributesBySortOrder(response.data || []));

            if (existingVariantSuperAttributes.length > 0) {
                setExistingVariantSuperAttributes((prev) => {
                    const synced = prev.map((selected) => {
                        const updated = (response.data || []).find((attribute) => attribute.id === selected.id);
                        return updated
                            ? {
                                ...updated,
                                selected_values: selected.selected_values,
                            }
                            : selected;
                    });

                    return normalizeExistingVariantSuperAttributes(synced);
                });
            }

            // Sync current selection if attributes were updated
            if (selectedSuperAttributes.length > 0) {
                setSelectedSuperAttributes(prev => {
                    const synced = prev.map(selected => {
                        const updated = (response.data || []).find(a => a.id === selected.id);
                        return updated
                            ? {
                                ...updated,
                                selected_values: selected.selected_values,
                                default_value: selected.default_value ?? null,
                            }
                            : selected;
                    });
                    return sanitizeSelectedSuperAttributes(synced);
                });
            }
            showModal({ title: 'Thành công', content: 'Đã cập nhật danh sách thuộc tính mới nhất.', type: 'success', autoClose: 2000 });
        } catch (error) {
            showModal({ title: 'Lỗi', content: 'Không thể làm mới danh sách thuộc tính.', type: 'error' });
        } finally {
            setRefreshingAttributes(false);
        }
    };

    const filteredSuggestedProducts = useMemo(() => suggestedProducts, [suggestedProducts]);
    const filteredBundleProducts = useMemo(() => suggestedBundleProducts, [suggestedBundleProducts]);

    useEffect(() => {
        setVariants((prev) => {
            if (!Array.isArray(prev) || prev.length === 0) return prev;
            if (!prev.some((variant) => variant?.sku_auto)) return prev;

            const next = buildAutoVariantSkuList(formData.sku, prev);
            const changed = next.some((variant, index) => variant.sku !== prev[index]?.sku);
            return changed ? next : prev;
        });
    }, [formData.sku]);

    const handleResetVariants = () => {
        if (variants.length > 0) {
            showModal({
                title: 'CẢNH BÁO: XÓA BIẾN THỂ',
                content: `<b>Bạn đang thực hiện xóa toàn bộ biến thể hiện có.</b>\n\n- Mã SKU và Tốn kho hiện tại sẽ bị xóa sạch.\n- Dữ liệu lịch sử đơn hàng có thể bị ảnh hưởng.\n\n<span style="color: #c2410c; font-weight: 800; text-transform: uppercase; font-size: 11px;">Lưu ý: Nếu bạn chỉ muốn MỞ RỘNG (thêm Màu/Size...), hãy dùng nút "HƯỚNG DẪN MỞ RỘNG" thay vì xóa!</span>`,
                type: 'warning',
                onAction: () => {
                    setVariants([]);
                    setSelectedVariantIds([]);
                    setLastDeletedVariantBatch(null);
                    setSelectedSuperAttributes([]);
                    setShowVariantConfig(true);
                    clearServerValidationErrors(['variants.']);
                    hideModal();
                },
                actionText: 'TÔI CHẮC CHẮN XÓA'
            });
            return;
        }
        setVariants([]);
        setSelectedVariantIds([]);
        setLastDeletedVariantBatch(null);
        setSelectedSuperAttributes([]);
        setShowVariantConfig(true);
        clearServerValidationErrors(['variants.']);
    };

    const handleAddManualVariant = () => {
        const newV = {
            id: `manual_${Date.now()}`,
            sku: '',
            price: formData.price,
            expected_cost: formData.expected_cost,
            current_cost: '',
            weight: formData.weight,
            inventory_unit_id: formData.inventory_unit_id || '',
            attributes: {},
            status: true,
            isExistingSourceVariant: false,
            isConvertedSourceVariant: false,
            library_image_id: null,
            image_reference_url: null,
            image_preview_owned: false,
            label: 'Biến thể tùy chỉnh',
            sku_auto: true,
            is_default: false,
        };
        setLastDeletedVariantBatch(null);
        setVariants(prev => buildAutoVariantSkuList(formData.sku, [...prev, newV]));
        clearServerValidationErrors(['variants.']);
    };

    const fetchProduct = async () => {
        try {
            const response = await productApi.getOne(id, { context: 'edit' });
            const data = response.data;
            const duplicateName = isDuplicate ? `${data.name || ''} (Copy)` : (data.name || '');
            const duplicateParentSku = isDuplicate
                ? buildLocalCopySku(data.sku, data.name)
                : (data.sku || '');
            const parentConfigurable = Array.isArray(data.parent_configurable)
                ? (data.parent_configurable[0] || null)
                : (data.parent_configurable || null);
            setProductMeta({
                originalType: data.type || 'simple',
                parentConfigurable,
            });
            setConvertToConfigurableForm(buildInitialConvertToConfigurableForm({
                name: data.name,
                sku: data.sku,
            }));
            const resolvedCategoryIds = getProductCategoryIds(data);
            const resolvedStockQuantity = isDuplicate ? 0 : (data.stock_quantity ?? '');
            const resolvedVideoUrls = normalizeProductVideoItems(data.video_urls, data.video_url || '');
            initialStockQuantityRef.current = normalizeStockQuantityComparableValue(resolvedStockQuantity);
            const loadedFormData = {
                type: data.type || 'simple',
                name: duplicateName,
                category_id: resolvedCategoryIds[0] || '',
                category_ids: resolvedCategoryIds,
                price: normalizeMoneyValue(data.price),
                price_type: data.price_type || 'fixed',
                expected_cost: normalizeImportCostValue(data.expected_cost),
                cost_price: resolveDuplicateSafeCost(data.cost_price),
                weight: data.weight || '',
                inventory_unit_id: data.inventory_unit_id ? String(data.inventory_unit_id) : '',
                supplier_ids: Array.isArray(data.supplier_ids)
                    ? data.supplier_ids.map((value) => String(value))
                    : Array.isArray(data.suppliers)
                        ? data.suppliers.map((supplier) => String(supplier.id))
                        : (data.supplier_id ? [String(data.supplier_id)] : []),
                description: data.description || '',
                specifications: (() => {
                    if (!data.specifications) return [];
                    try {
                        const parsed = JSON.parse(data.specifications);
                        if (!Array.isArray(parsed)) {
                            return [];
                        }

                        return parsed.map((spec) => ({
                            label: spec?.label ?? '',
                            value: spec?.value ?? '',
                        }));
                    } catch (e) {
                         // Fallback for legacy text data
                        return data.specifications.split('\n')
                            .filter(l => l.trim())
                            .map(l => {
                                const parts = l.split(':');
                                return {
                                    label: parts[0]?.trim() || 'Thông số',
                                    value: parts.slice(1).join(':').trim() || l
                                };
                            });
                    }
                })(),
                is_featured: !!data.is_featured,
                is_new: isDuplicate ? true : !!data.is_new,
                status: isDuplicate ? false : (data.hasOwnProperty('status') ? !!data.status : true),
                stock_quantity: resolvedStockQuantity,
                sku: duplicateParentSku,
                meta_title: data.meta_title || '',
                meta_description: data.meta_description || '',
                meta_keywords: data.meta_keywords || '',
                linked_product_ids: data.linked_products ? data.linked_products.map(p => p.id) : [],
                grouped_items: (data.bundle_items || data.grouped_items || []).map(item => ({
                    id: item.id,
                    product_id: item.id,
                    name: item.name,
                    sku: item.sku,
                    price: normalizeMoneyValue(item.pivot?.price ?? item.price),
                    cost_price: resolveDuplicateSafeCost(item.pivot?.cost_price, item.cost_price),
                    quantity: item.pivot?.quantity ?? 1,
                    is_required: !!(item.pivot?.is_required),
                    option_title: item.pivot?.option_title || '',
                    bundle_option_uid: item.pivot?.bundle_option_uid || '',
                    bundle_option_status: normalizeBundleOptionStatus(item.pivot?.bundle_option_status),
                    option_video_url: item.pivot?.option_video_url || '',
                    option_video_source: item.pivot?.option_video_source || '',
                    is_default: !!(item.pivot?.is_default),
                    variant_id: item.pivot?.variant_id || null,
                    image_url: resolveAdminImageUrl(item.images?.find(img => img.is_primary) || item.images?.[0], '')
                })),
                super_attribute_ids: data.super_attributes ? data.super_attributes.map(a => a.id) : [],
                custom_attributes: (data.attribute_values || []).reduce((acc, curr) => {
                    let val = curr.value;
                    try {
                        if (val && (val.startsWith('[') || val.startsWith('{'))) {
                            val = JSON.parse(val);
                        }
                    } catch (e) { }
                    acc[curr.attribute_id] = val;
                    return acc;
                }, {}),
                video_url: resolvedVideoUrls[0]?.url || '',
                video_urls: resolvedVideoUrls,
                slug: isDuplicate ? '' : (data.slug || ''),
                additional_info: (() => {
                    if (!data.additional_info) return [];
                    try {
                        const parsed = typeof data.additional_info === 'string' ? JSON.parse(data.additional_info) : data.additional_info;
                        if (!Array.isArray(parsed)) {
                            return [];
                        }

                        return hydrateAdditionalInfoRows(parsed);
                    } catch (e) { return []; }
                })(),
                bundle_title: data.bundle_title || '',
                site_domain_id: data.site_domain_id || ''
            };
            setFormData(loadedFormData);
            const normalizedImages = normalizeAdminImages(data.images || []);
            setImages(normalizedImages);
            initialImageSignatureRef.current = buildProductImageSignature(normalizedImages);
            hasNonImageFormChangesRef.current = false;
            duplicateDraftDefaultsRef.current = isDuplicate
                ? { parentSku: duplicateParentSku, variantSkus: [] }
                : null;

            // Handle Bundle Options organization
            if (data.type === 'bundle') {
                setBundleItemVariants({});
                const bItems = data.bundle_items || data.grouped_items || [];
                const optionsMap = {};
                bItems.forEach(item => {
                    const optionUid = item.pivot?.bundle_option_uid || '';
                    const title = item.pivot?.option_title || 'Tùy chọn';
                    const optionMapKey = optionUid ? `uid:${optionUid}` : title;
                    const optionImageUrl = normalizePersistedImageUrl(item.pivot?.option_image_url);
                    const optionStatus = normalizeBundleOptionStatus(item.pivot?.bundle_option_status);
                    if (!optionsMap[optionMapKey]) {
                        optionsMap[optionMapKey] = {
                            uid: optionUid,
                            title,
                            status: optionStatus,
                            post_id: item.pivot?.option_post_id || '',
                            post_title: item.pivot?.option_post_title || '',
                            image_url: optionImageUrl,
                            video_url: item.pivot?.option_video_url || '',
                            video_source: item.pivot?.option_video_source || '',
                            items: []
                        };
                    } else if (optionStatus === BUNDLE_OPTION_STATUS_INTERNAL) {
                        optionsMap[optionMapKey].status = BUNDLE_OPTION_STATUS_INTERNAL;
                    } else if (!optionsMap[optionMapKey].post_id && item.pivot?.option_post_id) {
                        optionsMap[optionMapKey].post_id = item.pivot.option_post_id;
                        optionsMap[optionMapKey].post_title = item.pivot?.option_post_title || '';
                    }

                    if (!optionsMap[optionMapKey].image_url && optionImageUrl) {
                        optionsMap[optionMapKey].image_url = optionImageUrl;
                    }

                    if (!optionsMap[optionMapKey].video_url && item.pivot?.option_video_url) {
                        optionsMap[optionMapKey].video_url = item.pivot.option_video_url;
                        optionsMap[optionMapKey].video_source = item.pivot?.option_video_source || '';
                    }

                        optionsMap[optionMapKey].items.push({
                            entry_id: createBundleItemEntryId(),
                            id: item.id,
                            product_id: item.id,
                            product_name: item.name,
                        product_sku: item.sku,
                        product_price: normalizeMoneyValue(item.price),
                        product_cost_price: resolveDuplicateSafeCost(item.cost_price),
                        product_image_url: resolveAdminImageUrl(item.images?.find(img => img.is_primary) || item.images?.[0], ''),
                        name: item.name,
                        sku: item.sku,
                        price: normalizeMoneyValue(item.pivot?.price ?? item.price),
                        cost_price: resolveDuplicateSafeCost(item.pivot?.cost_price, item.cost_price),
                        quantity: item.pivot?.quantity ?? 1,
                        is_required: !!item.pivot?.is_required,
                        is_default: !!item.pivot?.is_default,
                            image_url: resolveAdminImageUrl(item.images?.find(img => img.is_primary) || item.images?.[0], ''),
                            type: item.type,
                            variant_id: item.pivot?.variant_id || null,
                            variant_label: '',
                            legacy_missing_variant: item.type === 'configurable' && !item.pivot?.variant_id,
                        });
                });
                const loadedBundleOptions = Object.values(optionsMap).map((optionData) => ({
                    id: createBundleOptionId(),
                    uid: optionData.uid || '',
                    bundle_option_uid: optionData.uid || '',
                    title: optionData.title ?? '',
                    status: normalizeBundleOptionStatus(optionData.status),
                    bundle_option_status: normalizeBundleOptionStatus(optionData.status),
                    post_id: optionData.post_id || '',
                    post_title: optionData.post_title || '',
                    image_url: optionData.image_url || '',
                    video_url: optionData.video_url || '',
                    video_source: optionData.video_source || '',
                    items: optionData.items
                }));
                setBundleOptions(loadedBundleOptions);
                initialBundleOptionSignatureRef.current = buildBundleOptionSignature(loadedBundleOptions);

                Array.from(new Set(
                    bItems
                        .filter((item) => item.type === 'configurable')
                        .map((item) => Number(item.id))
                        .filter(Boolean)
                )).forEach((productId) => {
                    void loadBundleVariantsForProduct(productId, true);
                });
            } else {
                setBundleOptions([]);
                initialBundleOptionSignatureRef.current = buildBundleOptionSignature([]);
                setBundleItemVariants({});
            }

            // Handle variants from linked_products with 'super_link' type
            const variantsData = (data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
            const regularLinks = (data.linked_products || []).filter(p => p.pivot?.link_type === 'related');

            const initialIds = Array.from(new Set((regularLinks || []).map(p => p.id)));
            const initialData = Array.from(new Map((regularLinks || []).map(p => [p.id, p])).values());

            setFormData(prev => ({
                ...prev,
                linked_product_ids: initialIds
            }));
            setSelectedProductsData(initialData);
            setStagedRelatedIds(initialIds);
            setStagedRelatedData(initialData);
            initialFormDataSignatureRef.current = JSON.stringify({
                ...loadedFormData,
                linked_product_ids: initialIds,
            });

            if (variantsData.length > 0) {
                const baseLoadedVariants = variantsData.map(v => {
                    const attrs = (v.attribute_values || []).reduce((acc, av) => {
                        acc[av.attribute_id] = av.value;
                        return acc;
                    }, {});
                    const primaryImage = v.images?.find(img => img.is_primary) || v.images?.[0];
                    return {
                        ...v,
                        isExistingSourceVariant: !isDuplicate,
                        isConvertedSourceVariant: !isDuplicate && isConvertedSimpleSourceVariant(v, data.id),
                        price: normalizeMoneyValue(v.price),
                        expected_cost: normalizeImportCostValue(v.expected_cost),
                        current_cost: resolveDuplicateSafeCost(v.cost_price),
                        weight: v.weight ?? '',
                        inventory_unit_id: v.inventory_unit_id ? String(v.inventory_unit_id) : (data.inventory_unit_id ? String(data.inventory_unit_id) : ''),
                        status: normalizeVariantStatus(v.status, true),
                        sku: v.sku ?? '',
                        sku_auto: false,
                        is_default: !!v.pivot?.is_default,
                        attributes: attrs,
                        library_image_id: null,
                        image_reference_url: null,
                        image_preview_owned: false,
                        image_url: primaryImage ? resolveAdminImageUrl(primaryImage, primaryImage.image_url) : null,
                        label: v.name ?? (v.attribute_values || []).map(av => av.value).join(' / ') ?? ''
                    };
                });

                const loadedVariants = isDuplicate
                    ? buildDuplicateVariantDrafts(baseLoadedVariants, duplicateParentSku)
                        .map((variant) => ({
                            ...variant,
                            current_cost: '',
                        }))
                    : baseLoadedVariants;

                setLastDeletedVariantBatch(null);
                setVariants(loadedVariants);
                if (isDuplicate) {
                    duplicateDraftDefaultsRef.current = {
                        parentSku: duplicateParentSku,
                        variantSkus: loadedVariants.map((variant) => normalizeSkuSeed(variant?.sku)),
                    };
                }

                // Reconstruct selected values from variants
                const superAttrs = (data.super_attributes || []).map(sa => {
                    const uniqueVals = new Set();
                    loadedVariants.forEach(variant => {
                        if (variant.attributes[sa.id]) {
                            uniqueVals.add(variant.attributes[sa.id]);
                        }
                    });
                    return {
                        ...sa,
                        selected_values: Array.from(uniqueVals)
                    };
                });

                const normalizedSuperAttrs = normalizeExistingVariantSuperAttributes(superAttrs);
                setExistingVariantSuperAttributes(normalizedSuperAttrs);
                setSelectedSuperAttributes(normalizedSuperAttrs);
                setShowVariantConfig(true); // Tự động hiển thị danh sách biến thể / bảng cấu hình
            } else {
                setExistingVariantSuperAttributes([]);
            }
        } catch (error) {
            alert('Không thể tải thông tin sản phẩm.');
            navigateBackToOrigin();
        }
    };

    const handleAutoGenerateSKU = () => {
        if (!formData.name) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tên sản phẩm trước khi tạo mã tự động.', type: 'warning' });
            return;
        }

        let baseSku = generateSKUFromName(formData.name);
        let finalSku = baseSku;
        let counter = 1;

        // Ensure uniqueness against allProducts
        // Since allProducts is no longer loaded on start, we rely on the fact that the backend will validate uniqueness anyway.
        // Or if we really want to check here, we could call an API, but for simple auto-gen we'll just add a random suffix if name is too generic.
        while (suggestedProducts.some(p => p.sku === finalSku && (!id || p.id != id))) {
            const suffix = counter < 10 ? `0${counter}` : counter;
            finalSku = `${baseSku}-${suffix}`;
            counter++;
        }

        setFormData(prev => ({ ...prev, sku: finalSku }));
    };

    const moveImage = useCallback((dragIndex, hoverIndex) => {
        const newImages = [...images];
        const draggedImage = newImages[dragIndex];
        newImages.splice(dragIndex, 1);
        newImages.splice(hoverIndex, 0, draggedImage);

        setImages(normalizeAdminPrimarySelection(newImages));
    }, [images]);

    const handleImageUpload = async (e) => {
        const rawFiles = Array.from(e.target.files || []);
        e.target.value = '';
        if (rawFiles.length === 0) return;

        // Immediately add to list with skeleton/optimizing status
        const placeholderPrefix = `opt_${Date.now()}`;
        const newPlaceholders = rawFiles.map((f, i) => ({
            id: `${placeholderPrefix}_${i}`,
            image_url: URL.createObjectURL(f),
            file: f,
            optimizing: true,
            is_primary: false
        }));
        const placeholderIds = new Set(newPlaceholders.map((img) => img.id));
        setImages(prev => normalizeAdminPrimarySelection([...prev, ...newPlaceholders]));

        try {
            const processedImages = [];

            for (const placeholder of newPlaceholders) {
                const optimizedFile = await compressImage(placeholder.file);
                processedImages.push({ ...placeholder, file: optimizedFile, optimizing: false });
            }

            setImages((prev) => {
                const filtered = prev.filter((img) => !placeholderIds.has(img.id));
                const hasPrimary = filtered.some((img) => img.is_primary);
                const finalImages = processedImages.map((img, index) => ({
                    ...img,
                    is_primary: !hasPrimary && filtered.length === 0 && index === 0,
                }));

                return normalizeAdminPrimarySelection([...filtered, ...finalImages]);
            });
        } catch (error) {
            console.error("Lỗi tối ưu/tải ảnh:", error);
            setImages(prev => normalizeAdminPrimarySelection(
                prev.filter(img => !placeholderIds.has(img.id))
            ));
            newPlaceholders.forEach((img) => {
                if (img.image_url?.startsWith('blob:')) {
                    URL.revokeObjectURL(img.image_url);
                }
            });

            const errorMessage = resolveProductImageUploadErrorMessage(error)
                || 'Loi toi uu anh. Vui long thu lai.';

            showToast({ message: errorMessage, type: 'error', duration: 7000 });
        }
    };

    const handleSetPrimary = useCallback((imgId) => {
        setImages((prev) => normalizeAdminPrimarySelection(
            prev.map((img) => ({ ...img, is_primary: img.id === imgId }))
        ));
    }, []);

    const handleDeleteImage = useCallback((imgId) => {
        setImages((prev) => normalizeAdminPrimarySelection(
            prev.filter((img) => img.id !== imgId)
        ));
        setSelectedImages((prev) => prev.filter((id) => id !== imgId));
    }, []);

    const toggleSelectImage = useCallback((id, forceSelect = false) => {
        setSelectedImages(prev => {
            if (forceSelect && !prev.includes(id)) return [...prev, id];
            if (prev.includes(id) && !forceSelect) return prev.filter(i => i !== id);
            if (!prev.includes(id)) return [...prev, id];
            return prev;
        });
    }, []);

    const handleDeleteSelectedImages = useCallback(() => {
        if (selectedImages.length === 0) return;
        const toDelete = [...selectedImages];
        setSelectedImages([]); // clear
        setImages(prev => normalizeAdminPrimarySelection(
            prev.filter(img => !toDelete.includes(img.id))
        ));

    }, [selectedImages]);

    const markNonImageFormChanged = useCallback((event) => {
        const target = event?.target;
        if (!target || target.type === 'file' || target.closest?.('[data-product-image-section="true"]')) {
            return;
        }

        hasNonImageFormChangesRef.current = true;
    }, []);

    const handleCustomAttributeChange = (attrId, value) => {
        setFormData(prev => ({
            ...prev,
            custom_attributes: { ...prev.custom_attributes, [attrId]: value }
        }));
    };
    const addSpecRow = () => {
        setFormData(prev => ({
            ...prev,
            specifications: [...prev.specifications, { label: '', value: '' }]
        }));
    };

    const removeSpecRow = (index) => {
        setFormData(prev => ({
            ...prev,
            specifications: prev.specifications.filter((_, i) => i !== index)
        }));
    };

    const updateSpecRow = (index, field, value) => {
        setFormData(prev => {
            const newSpecs = [...prev.specifications];
            newSpecs[index] = { ...newSpecs[index], [field]: value };
            return { ...prev, specifications: newSpecs };
        });
    };

    const addAdditionalInfoRow = () => {
        setFormData(prev => ({
            ...prev,
            additional_info: [...prev.additional_info, createAdditionalInfoRow()]
        }));
    };

    const removeAdditionalInfoRow = (rowId) => {
        setFormData(prev => ({
            ...prev,
            additional_info: prev.additional_info.filter((item) => item.row_id !== rowId)
        }));

        setBlogSearchQuery((prev) => {
            const next = { ...prev };
            delete next[rowId];
            return next;
        });
        setBlogResults((prev) => {
            const next = { ...prev };
            delete next[rowId];
            return next;
        });
        setIsSearchingBlog((prev) => {
            const next = { ...prev };
            delete next[rowId];
            return next;
        });
        delete blogSearchRequestRef.current[rowId];
    };

    const updateAdditionalInfoRow = (rowId, field, value, extra = {}) => {
        setFormData(prev => {
            const nextInfo = prev.additional_info.map((item) => (
                item.row_id === rowId
                    ? { ...item, [field]: value, ...extra }
                    : item
            ));
            return { ...prev, additional_info: nextInfo };
        });
    };

    const copySpecifications = () => {
        if (!formData.specifications || formData.specifications.length === 0) {
            showToast('Không có thông số nào để copy', 'warning');
            return;
        }
        localStorage.setItem('product_form_clipboard', JSON.stringify({
            type: 'specifications',
            data: formData.specifications
        }));
        showToast('Đã copy bảng thông số kỹ thuật', 'success');
    };

    const pasteSpecifications = () => {
        const saved = localStorage.getItem('product_form_clipboard');
        if (!saved) {
            showToast('Chưa có dữ liệu đã copy', 'error');
            return;
        }
        try {
            const { type, data } = JSON.parse(saved);
            if (!Array.isArray(data)) throw new Error('Invalid data');

            let toPaste = [];
            let success = 0;
            let fail = 0;

            if (type === 'specifications') {
                toPaste = data.map(item => {
                    if (item.label || item.value) { success++; return { label: item.label || '', value: item.value || '' }; }
                    fail++; return null;
                }).filter(Boolean);
            } else if (type === 'additional_info') {
                toPaste = data.map(item => {
                    if (item.title || item.display_text || item.post_title) {
                        success++;
                        return { label: item.title || 'Thông tin', value: item.post_title || '' };
                    }
                    fail++; return null;
                }).filter(Boolean);
            }

            if (toPaste.length > 0) {
                setFormData(prev => ({ ...prev, specifications: [...prev.specifications, ...toPaste] }));
                const msg = type === 'specifications' ? `Đã dán ${success} thông số` : `Đã dán chéo ${success} mục từ Thông tin bổ sung`;
                showToast(msg + (fail > 0 ? `, bỏ qua ${fail} dòng lỗi` : ''), 'success');
            } else {
                showToast('Không tìm thấy dữ liệu hợp lệ để dán', 'warning');
            }
        } catch (e) {
            showToast('Lỗi khi dán dữ liệu', 'error');
        }
    };

    const copyAdditionalInfo = () => {
        if (!formData.additional_info || formData.additional_info.length === 0) {
            showToast('Không có thông tin bổ sung nào để copy', 'warning');
            return;
        }
        const clipboardData = formData.additional_info.map((item) => ({
            title: String(item?.title ?? ''),
            display_text: String(item?.display_text ?? ''),
            post_id: item?.post_id ? String(item.post_id) : '',
            post_title: String(item?.post_title ?? ''),
            post_slug: String(item?.post_slug ?? ''),
        }));

        localStorage.setItem('product_form_clipboard', JSON.stringify({
            type: 'additional_info',
            data: clipboardData
        }));
        showToast('Đã copy bảng thông tin bổ sung', 'success');
    };

    const pasteAdditionalInfo = () => {
        const saved = localStorage.getItem('product_form_clipboard');
        if (!saved) {
            showToast('Chưa có dữ liệu đã copy', 'error');
            return;
        }
        try {
            const { type, data } = JSON.parse(saved);
            if (!Array.isArray(data)) throw new Error('Invalid data');

            let toPaste = [];
            let success = 0;
            let fail = 0;

            if (type === 'additional_info') {
                toPaste = data.map(item => {
                    if (item?.title || item?.display_text || item?.post_title || item?.post_id) {
                        success++;
                        return createAdditionalInfoRow({
                            title: item?.title || '',
                            display_text: item?.display_text || '',
                            post_id: item?.post_id || '',
                            post_title: item?.post_title || '',
                            post_slug: item?.post_slug || '',
                        });
                    }
                    fail++;
                    return null;
                }).filter(Boolean);
            } else if (type === 'specifications') {
                toPaste = data.map(item => {
                    if (item.label || item.value) {
                        success++;
                        return { title: item.label || 'Thông tin', post_id: '', post_title: item.value || '' };
                    }
                    fail++; return null;
                }).filter(Boolean);
            }

            if (toPaste.length > 0) {
                const normalizedRows = hydrateAdditionalInfoRows(
                    toPaste.map((item) => ({
                        title: item?.title || item?.label || '',
                        display_text: item?.display_text || (!item?.post_id ? (item?.post_title || item?.value || '') : ''),
                        post_id: item?.post_id || '',
                        post_title: item?.post_title || '',
                        post_slug: item?.post_slug || '',
                    }))
                );
                setFormData(prev => ({ ...prev, additional_info: [...prev.additional_info, ...normalizedRows] }));
                const msg = type === 'additional_info' ? `Đã dán ${success} mục thông tin` : `Đã dán chéo ${success} mục từ Bảng thông số`;
                showToast(msg + (fail > 0 ? `, bỏ qua ${fail} dòng lỗi` : ''), 'success');
            } else {
                showToast('Không tìm thấy dữ liệu hợp lệ để dán', 'warning');
            }
        } catch (e) {
            showToast('Lỗi khi dán dữ liệu', 'error');
        }
    };

    const handleAIGenerate = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }
        if (!formData.name) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tên Sản Phẩm để AI có cơ sở viết mô tả.', type: 'warning' });
            return;
        }

        setAiGenerating(true);
        try {
            const categoryName = selectedCategoryNames.length > 0 ? selectedCategorySummary : 'Gốm sứ';
            const attrData = {};
            Object.entries(formData.custom_attributes).forEach(([id, val]) => {
                const attr = allAttributes.find(a => a.id == id);
                if (attr && val) attrData[attr.name] = val;
            });

            const response = await aiApi.generateProductDescription({
                name: formData.name,
                category: categoryName,
                attributes: attrData,
                custom_instruction: aiInstruction.trim() || undefined,
            });

            setFormData(prev => ({ ...prev, description: response.data.description }));
        } catch (error) {
            showModal({
                title: 'Lỗi AI',
                content: resolveAiRequestError(error, 'Không thể tạo mô tả bằng AI lúc này.'),
                type: 'error',
            });
        } finally {
            setAiGenerating(false);
        }
    };

    const buildAiSeoPayload = () => {
        const categoryName = selectedCategoryNames.length > 0 ? selectedCategorySummary : 'Gốm sứ';
        const attrData = {};

        Object.entries(formData.custom_attributes || {}).forEach(([attributeId, value]) => {
            const attribute = allAttributes.find((item) => String(item.id) === String(attributeId));
            if (!attribute) {
                return;
            }

            if (Array.isArray(value)) {
                const normalizedValues = value.map((item) => String(item || '').trim()).filter(Boolean);
                if (normalizedValues.length > 0) {
                    attrData[attribute.name] = normalizedValues;
                }
                return;
            }

            if (value !== null && value !== undefined && String(value).trim() !== '') {
                attrData[attribute.name] = value;
            }
        });

        const stableImages = (Array.isArray(images) ? images : [])
            .map((image, index) => ({
                id: image?.id ?? null,
                media_asset_id: image?.media_asset_id ?? null,
                image_url: image?.large_url || image?.medium_url || image?.image_url || '',
                large_url: image?.large_url || '',
                medium_url: image?.medium_url || '',
                is_primary: !!image?.is_primary,
                sort_order: Number.isFinite(Number(image?.sort_order)) ? Number(image.sort_order) : index,
                file_name: image?.file_name || '',
            }))
            .filter((image) => {
                const url = String(image.image_url || '').trim();
                return url !== '' && !url.startsWith('blob:') && !url.startsWith('data:');
            });

        const variationPayload = (Array.isArray(variants) ? variants : [])
            .map((variant) => ({
                id: variant?.id ?? null,
                name: variant?.name || variant?.label || '',
                label: variant?.label || variant?.name || '',
                sku: variant?.sku || '',
                price: variant?.price || '',
                weight: variant?.weight || '',
                attributes: variant?.attributes || {},
            }))
            .filter((variant) => variant.name || variant.sku);

        const groupedItemsPayload = formData.type === 'bundle'
            ? (Array.isArray(bundleOptions)
                ? bundleOptions.flatMap((option) => option?.items || [])
                : [])
            : (Array.isArray(formData.grouped_items) ? formData.grouped_items : []);

        return {
            product_id: isEdit && !isDuplicate ? Number(id) : undefined,
            name: formData.name,
            sku: formData.sku,
            type: formData.type,
            category: categoryName,
            categories: categoryName ? [categoryName] : [],
            price: formData.special_price || formData.price || '',
            weight: formData.weight || '',
            attributes: attrData,
            images: stableImages,
            variations: variationPayload,
            grouped_items: groupedItemsPayload,
            custom_instruction: aiInstruction.trim() || undefined,
        };
    };

    const handleAIGenerateSeo = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }

        if (!formData.name || String(formData.name).trim() === '') {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập Tên Sản Phẩm để AI có cơ sở tạo SEO.', type: 'warning' });
            return;
        }

        setAiGeneratingSeo(true);
        try {
            const response = await aiApi.generateProductSeo(buildAiSeoPayload());
            const generated = response?.data || {};

            setFormData((prev) => ({
                ...prev,
                description: generated.description || prev.description,
                specifications: normalizeSpecificationRows(generated.specifications || prev.specifications),
                meta_title: generated.meta_title || prev.meta_title,
                meta_description: generated.meta_description || prev.meta_description,
                meta_keywords: generated.meta_keywords || prev.meta_keywords,
            }));

            const insertedCount = Number(generated?.image_summary?.inserted_count || 0);
            showToast({
                message: insertedCount > 0
                    ? `Đã tạo SEO AI và chèn ${insertedCount} ảnh vào mô tả.`
                    : 'Đã tạo SEO AI. Hiện chưa chèn được ảnh công khai vào mô tả.',
                type: 'success',
            });
        } catch (error) {
            showModal({
                title: 'Lỗi AI',
                content: resolveAiRequestError(error, 'Không thể tạo SEO bằng AI lúc này.'),
                type: 'error',
            });
        } finally {
            setAiGeneratingSeo(false);
        }
    };

    const runProductDescriptionRewrite = useCallback(async (html, customInstruction = '', protectedFragments = []) => {
        const response = await aiApi.rewriteProductDescription({
            content: html,
            custom_instruction: customInstruction || undefined,
        });

        return {
            html: restoreDescriptionMediaHtml(response?.data?.description || response?.data?.text || '', protectedFragments),
            model: response?.data?.model || '',
        };
    }, []);

    const handleAIRewrite = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }
        if (!formData.description || formData.description.trim() === '' || formData.description === '<p><br></p>') {
            showModal({ title: 'Lưu ý', content: 'Vui lòng nhập định dạng thô hoặc copy nội dung vào khung mô tả trước khi yêu cầu AI viết lại.', type: 'warning' });
            return;
        }

        // Protect media embeds so AI only rewrites text and cannot mutate heavy HTML fragments.
        const protectedPayload = protectDescriptionMediaHtml(formData.description);
        const customInstruction = aiInstruction.trim();

        setAiRewriting(true);
        try {
            const result = await runProductDescriptionRewrite(
                protectedPayload.html,
                customInstruction,
                protectedPayload.fragments
            );

            setAiRewriteReview({
                open: true,
                sourceHtml: formData.description,
                draftHtml: result.html,
                revisionInstruction: '',
                model: result.model,
            });
        } catch (error) {
            console.error("Rewrite Error:", error.response?.data || error);
            showModal({
                title: 'Lỗi AI',
                content: resolveAiRequestError(
                    error,
                    'Không thể viết lại mô tả bằng AI lúc này. Có thể nội dung quá dài hoặc backend AI đang lỗi.'
                ),
                type: 'error',
            });
        } finally {
            setAiRewriting(false);
        }
    };

    const handleAiRewriteRevisionChange = useCallback((value) => {
        setAiRewriteReview((prev) => ({
            ...prev,
            revisionInstruction: value,
        }));
    }, []);

    const handleReviseAiRewriteDraft = useCallback(async () => {
        const instruction = aiRewriteReview.revisionInstruction.trim();
        if (!instruction || aiRewriting) {
            return;
        }

        const protectedPayload = protectDescriptionMediaHtml(aiRewriteReview.draftHtml || aiRewriteReview.sourceHtml);
        const revisionInstruction = [
            'Sửa tiếp bản nháp hiện tại theo yêu cầu của người dùng.',
            instruction,
            'Vẫn giữ nguyên cấu trúc HTML, ảnh, video, iframe, link, class, id và style.',
        ].join('\n');

        setAiRewriting(true);
        try {
            const result = await runProductDescriptionRewrite(
                protectedPayload.html,
                revisionInstruction,
                protectedPayload.fragments
            );

            setAiRewriteReview((prev) => ({
                ...prev,
                draftHtml: result.html,
                revisionInstruction: '',
                model: result.model || prev.model,
            }));
        } catch (error) {
            showModal({
                title: 'Lỗi AI',
                content: resolveAiRequestError(error, 'Không thể sửa tiếp nội dung bằng AI lúc này.'),
                type: 'error',
            });
        } finally {
            setAiRewriting(false);
        }
    }, [aiRewriteReview.draftHtml, aiRewriteReview.revisionInstruction, aiRewriteReview.sourceHtml, aiRewriting, runProductDescriptionRewrite, showModal]);

    const handleApplyAiRewriteDraft = useCallback(() => {
        const finalHtml = aiRewriteReview.draftHtml;
        if (!finalHtml || aiRewriting) {
            return;
        }

        setFormData((prev) => ({
            ...prev,
            description: finalHtml,
        }));
        setAiRewriteReview((prev) => ({
            ...prev,
            open: false,
        }));
        showToast({
            message: 'Đã áp dụng nội dung AI vào mô tả sản phẩm.',
            type: 'success',
        });
    }, [aiRewriteReview.draftHtml, aiRewriting, showToast]);

    const handleCopyAiRewriteHtml = useCallback(() => {
        const html = aiRewriteReview.draftHtml;
        if (!html) {
            showToast({
                message: 'Chưa có HTML để sao chép.',
                type: 'warning',
            });
            return;
        }

        navigator.clipboard.writeText(html).then(() => {
            showToast({
                message: 'Đã sao chép HTML bản nháp AI.',
                type: 'success',
            });
        }).catch(() => {
            showToast({
                message: 'Không thể sao chép HTML lúc này.',
                type: 'error',
            });
        });
    }, [aiRewriteReview.draftHtml, showToast]);

    const handleCloseAiRewriteReview = useCallback(() => {
        if (aiRewriting) {
            return;
        }

        setAiRewriteReview((prev) => ({
            ...prev,
            open: false,
        }));
    }, [aiRewriting]);

    const renderAttributeField = (attr) => {
        const value = formData.custom_attributes[attr.id] ?? (attr.frontend_type === 'multiselect' ? [] : '');
        const commonClass = "w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary text-[14px] font-bold min-h-[32px]";

        switch (attr.frontend_type) {
            case 'textarea':
                return <textarea className={`${commonClass} resize-none pt-2`} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} rows="3" />;
            case 'select':
                return (
                    <div className="w-full flex items-center justify-between">
                        <select className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)}>
                            <option value="">-- Chọn {attr.name} --</option>
                            {(attr.options || []).map(opt => <option key={opt.id} value={opt.value}>{opt.value}</option>)}
                        </select>
                        {attr.swatch_type === 'color' && value && (
                            <div
                                className="size-4 rounded-full border border-gold/20 shrink-0 ml-2"
                                style={{ backgroundColor: (attr.options?.find(o => o.value === value))?.swatch_value || 'transparent' }}
                            ></div>
                        )}
                    </div>
                );
            case 'multiselect': {
                const selected = Array.isArray(value) ? value : [];
                return (
                    <div className="py-2 w-full space-y-1 max-h-32 overflow-auto text-[14px]">
                        {(attr.options || []).map(opt => (
                            <label key={opt.id} className="flex items-center gap-2 cursor-pointer font-bold text-stone/70 hover:text-primary transition-colors">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(opt.value)}
                                    onChange={(e) => {
                                        const newVal = e.target.checked ? [...selected, opt.value] : selected.filter(v => v !== opt.value);
                                        handleCustomAttributeChange(attr.id, newVal);
                                    }}
                                    className="size-4 text-primary border-stone/30 rounded-sm"
                                />
                                {opt.value}
                            </label>
                        ))}
                    </div>
                );
            }
            case 'boolean':
                return (
                    <div className="flex gap-4 py-2">
                        <label className="flex items-center gap-2 cursor-pointer text-[14px] font-bold text-stone tracking-tighter">
                            <input type="radio" checked={value === '1' || value === 1 || value === true} onChange={() => handleCustomAttributeChange(attr.id, 1)} className="accent-primary" /> Có
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-[14px] font-bold text-stone tracking-tighter">
                            <input type="radio" checked={value === '0' || value === 0 || value === false} onChange={() => handleCustomAttributeChange(attr.id, 0)} className="accent-primary" /> Không
                        </label>
                    </div>
                );
            case 'date':
                // Ensure value is in yyyy-MM-dd format for HTML5 date input
                let formattedDate = value;
                if (value && typeof value === 'string' && value.includes('/')) {
                    const parts = value.split('/');
                    if (parts.length === 3 && parts[2].length === 4) {
                        formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                }
                return <input type="date" className={commonClass} value={formattedDate || ''} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
            case 'price':
                return <input type="number" className={`${commonClass} text-brick`} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
            default:
                return <input type="text" className={commonClass} value={value} onChange={(e) => handleCustomAttributeChange(attr.id, e.target.value)} />;
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;

        if (name === 'type' && value === 'configurable' && canConvertSimpleProduct) {
            openConvertToConfigurableModal();
            return;
        }

        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
        if (name === 'sku') {
            clearServerValidationErrors(['sku', 'variants.']);
        }

        if (name === 'type' && value === 'configurable' && variants.length === 0) {
            setShowVariantConfig(true);
        }
    };

    const handlePriceInputChange = (e, field) => {
        const raw = field === 'expected_cost' || field === 'cost_price'
            ? normalizeImportCostDraftValue(e.target.value)
            : normalizeWholeMoneyDraft(e.target.value);
        setFormData(prev => ({ ...prev, [field]: raw }));
    };

    const generateVariants = () => {
        if (selectedSuperAttributes.length === 0) {
            showModal({ title: 'Lưu ý', content: 'Vui lòng chọn ít nhất một thuộc tính để tạo biến thể.', type: 'warning' });
            return;
        }

        // Check if all selected attributes have values
        const invalidAttr = selectedSuperAttributes.find(attr => !attr.selected_values || attr.selected_values.length === 0);
        if (invalidAttr) {
            showModal({ title: 'Lưu ý', content: `Vui lòng chọn giá trị cho thuộc tính "${invalidAttr.name}".`, type: 'warning' });
            return;
        }

        // Cartesian product engine
        const combinations = selectedSuperAttributes.reduce((acc, attr) => {
            const results = [];
            attr.selected_values.forEach(val => {
                if (acc.length === 0) {
                    results.push({ [attr.id]: val });
                } else {
                    acc.forEach(prev => {
                        results.push({ ...prev, [attr.id]: val });
                    });
                }
            });
            return results;
        }, []);

                let availableOldVariants = [...variants];

        const newVariants = combinations.map((combo, index) => {
            const attrLabel = selectedSuperAttributes.map(attr => combo[attr.id]).join(' / ');

            const matchIndex = availableOldVariants.findIndex(oldVar => {
                if (!oldVar.attributes) return false;
                let isMatch = true;
                const oldAttributeKeys = Object.keys(oldVar.attributes);
                for (const key of oldAttributeKeys) {
                    if (combo[key] !== undefined && combo[key] !== oldVar.attributes[key]) {
                        isMatch = false; break;
                    }
                }
                if (!isMatch) return false;
                const newKeys = Object.keys(combo).filter(k => !oldAttributeKeys.includes(k));
                for (const key of newKeys) {
                    const attrConfig = selectedSuperAttributes.find(a => String(a.id) === String(key));
                    if (attrConfig && attrConfig.default_value) {
                        if (combo[key] !== attrConfig.default_value) return false;
                    }
                }
                return true;
            });

            let matchedVariant = null;
            if (matchIndex !== -1) {
                matchedVariant = availableOldVariants[matchIndex];
                availableOldVariants.splice(matchIndex, 1);
            }

            if (matchedVariant) {
                return {
                    ...matchedVariant,
                    isExistingSourceVariant: Boolean(matchedVariant?.isExistingSourceVariant),
                    isConvertedSourceVariant: Boolean(matchedVariant?.isConvertedSourceVariant),
                    attributes: combo,
                    label: `${formData.name} - ${attrLabel}`
                };
            }

            return {
                id: `new_${Date.now()}_${index}`,
                sku: '',
                price: formData.price,
                expected_cost: formData.expected_cost,
                current_cost: '',
                weight: formData.weight,
                inventory_unit_id: formData.inventory_unit_id || '',
                attributes: combo,
                status: true,
                isExistingSourceVariant: false,
                isConvertedSourceVariant: false,
                library_image_id: null,
                image_reference_url: null,
                image_preview_owned: false,
                label: `${formData.name} - ${attrLabel}`,
                sku_auto: true,
                is_default: false,
            };
        });

        setLastDeletedVariantBatch(null);
        setVariants(buildAutoVariantSkuList(formData.sku, newVariants));
        clearServerValidationErrors(['variants.']);
        setShowVariantConfig(false);
    };

    const handleVariantChange = (index, field, value) => {
        const updated = [...variants];
        if (field === 'price') {
            value = normalizeWholeMoneyDraft(value);
        } else if (field === 'expected_cost') {
            value = normalizeImportCostDraftValue(value);
        } else if (field === 'weight') {
            value = value.toString().replace(/[^0-9]/g, '');
        }
        if (field === 'sku') {
            value = normalizeSkuDraft(value);
            updated[index].sku_auto = false;
            clearServerValidationErrors([`variants.${index}.sku`, 'sku']);
        }
        updated[index][field] = value;
        setVariants(updated);
    };

    const handleDefaultVariantToggle = useCallback((index) => {
        hasNonImageFormChangesRef.current = true;
        setVariants((prev) => prev.map((variant, variantIndex) => ({
            ...variant,
            is_default: variantIndex === index,
        })));
        clearServerValidationErrors(['variants.']);
    }, [clearServerValidationErrors]);

    const openVariantUploadDialog = useCallback((index) => {
        variantImageInputRefs.current[index]?.click();
    }, []);

    const openVariantImagePickerForIndex = useCallback((index, anchorElement) => {
        if (variantImageLibraryItems.length === 0) {
            closeVariantImagePicker();
            openVariantUploadDialog(index);
            return;
        }

        const nextPosition = buildVariantImagePickerPosition(anchorElement?.getBoundingClientRect?.());

        setVariantImagePicker((prev) => {
            if (prev.index === index) {
                variantImagePickerAnchorRef.current = null;
                return {
                    index: null,
                    top: 0,
                    left: 0,
                    width: prev.width || nextPosition.width,
                };
            }

            variantImagePickerAnchorRef.current = anchorElement || null;
            return {
                index,
                ...nextPosition,
            };
        });
    }, [closeVariantImagePicker, openVariantUploadDialog, variantImageLibraryItems.length]);

    const handleVariantImageCellClick = useCallback((index, anchorElement) => {
        if (variantImageCellClickTimeoutRef.current) {
            window.clearTimeout(variantImageCellClickTimeoutRef.current);
        }

        variantImageCellClickTimeoutRef.current = window.setTimeout(() => {
            openVariantImagePickerForIndex(index, anchorElement);
            variantImageCellClickTimeoutRef.current = null;
        }, IMAGE_PREVIEW_DOUBLE_CLICK_DELAY);
    }, [openVariantImagePickerForIndex]);

    const handleVariantImageCellDoubleClick = useCallback((imageUrl, alt) => {
        if (variantImageCellClickTimeoutRef.current) {
            window.clearTimeout(variantImageCellClickTimeoutRef.current);
            variantImageCellClickTimeoutRef.current = null;
        }

        openImageLightbox(imageUrl, alt);
    }, [openImageLightbox]);

    const handleSelectVariantLibraryImage = useCallback((index, image) => {
        if (!image) {
            return;
        }

        const isPersistedLibraryImage = !isTemporaryProductImageId(image?.id);
        const clonedPreviewUrl = !isPersistedLibraryImage && image?.file
            ? URL.createObjectURL(image.file)
            : '';

        setVariants((prev) => prev.map((variant, variantIndex) => {
            if (variantIndex !== index) {
                return variant;
            }

            return {
                ...variant,
                image_file: isPersistedLibraryImage ? null : (image?.file || null),
                image_url: clonedPreviewUrl || image?.image_url || '',
                image_preview_owned: Boolean(clonedPreviewUrl),
                library_image_id: isPersistedLibraryImage ? (Number(image?.id) || null) : null,
                image_reference_url: isPersistedLibraryImage ? (image?.image_url || null) : null,
                remove_image: false,
            };
        }));

        clearServerValidationErrors(['variants.']);
        closeVariantImagePicker();
    }, [clearServerValidationErrors, closeVariantImagePicker]);

    const handleVariantLibraryImageClick = useCallback((index, image) => {
        if (variantLibraryImageClickTimeoutRef.current) {
            window.clearTimeout(variantLibraryImageClickTimeoutRef.current);
        }

        variantLibraryImageClickTimeoutRef.current = window.setTimeout(() => {
            handleSelectVariantLibraryImage(index, image);
            variantLibraryImageClickTimeoutRef.current = null;
        }, IMAGE_PREVIEW_DOUBLE_CLICK_DELAY);
    }, [handleSelectVariantLibraryImage]);

    const handleVariantLibraryImageDoubleClick = useCallback((image) => {
        if (variantLibraryImageClickTimeoutRef.current) {
            window.clearTimeout(variantLibraryImageClickTimeoutRef.current);
            variantLibraryImageClickTimeoutRef.current = null;
        }

        openImageLightbox(image?.image_url, image?.display_name);
    }, [openImageLightbox]);

    const handleVariantImageUpload = useCallback((index, e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        const previewUrl = URL.createObjectURL(file);

        setVariants((prev) => prev.map((variant, variantIndex) => (
            variantIndex !== index
                ? variant
                : {
                    ...variant,
                    image_file: file,
                    image_url: previewUrl,
                    image_preview_owned: true,
                    library_image_id: null,
                    image_reference_url: null,
                    remove_image: false,
                }
        )));

        clearServerValidationErrors(['variants.']);
        closeVariantImagePicker();
    }, [clearServerValidationErrors, closeVariantImagePicker]);

    const handleRemoveVariantImage = useCallback((index) => {
        setVariants((prev) => prev.map((variant, variantIndex) => (
            variantIndex !== index
                ? variant
                : {
                    ...variant,
                    image_file: null,
                    image_url: null,
                    image_preview_owned: false,
                    library_image_id: null,
                    image_reference_url: null,
                    remove_image: true,
                }
        )));

        clearServerValidationErrors(['variants.']);
        if (variantImagePicker.index === index) {
            closeVariantImagePicker();
        }
    }, [clearServerValidationErrors, closeVariantImagePicker, variantImagePicker.index]);

    /*
        if (variants[index]?.id && !String(variants[index].id).startsWith('new_')) {
            if (!window.confirm("BẠN CÓ CHẮC MUỐN XÓA BIẾN THỂ NÀY? SKU và Tồn kho của mã này sẽ bị mất khỏi hệ thống sau khi Lưu.")) {
                return;
            }
        }
        setVariants(variants.filter((_, i) => i !== index));
        clearServerValidationErrors(['variants.']);
    */

    const deleteVariantBatch = useCallback((indices = [], options = {}) => {
        const normalizedIndices = Array.from(new Set(
            (Array.isArray(indices) ? indices : [])
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value >= 0 && value < variants.length)
        )).sort((left, right) => left - right);

        if (normalizedIndices.length === 0) {
            return false;
        }

        if (options.confirmMessage && !window.confirm(options.confirmMessage)) {
            return false;
        }

        const deletedEntries = normalizedIndices
            .map((index) => {
                const variant = variants[index];
                if (!variant) {
                    return null;
                }

                return {
                    index,
                    selectionKey: getVariantSelectionKey(variant, index),
                    variant: cloneVariantDraft(variant),
                };
            })
            .filter(Boolean);

        if (deletedEntries.length === 0) {
            return false;
        }

        const deletedIndexSet = new Set(deletedEntries.map((entry) => entry.index));
        const deletedSelectionKeySet = new Set(deletedEntries.map((entry) => entry.selectionKey));

        setVariants((prev) => prev.filter((_, index) => !deletedIndexSet.has(index)));
        setSelectedVariantIds((prev) => prev.filter((selectionKey) => !deletedSelectionKeySet.has(selectionKey)));
        setLastDeletedVariantBatch({ items: deletedEntries });
        closeVariantImagePicker();
        clearServerValidationErrors(['variants.']);

        if (options.successMessage) {
            showToast({
                type: 'success',
                message: options.successMessage,
            });
        }

        return true;
    }, [clearServerValidationErrors, closeVariantImagePicker, getVariantSelectionKey, showToast, variants]);

    const removeVariant = useCallback((index) => {
        const targetVariant = variants[index];
        if (!targetVariant) {
            return;
        }

        const isPersistedVariant = targetVariant.id
            && !String(targetVariant.id).startsWith('new_')
            && !String(targetVariant.id).startsWith('manual_');

        deleteVariantBatch([index], {
            confirmMessage: isPersistedVariant
                ? 'BẠN CÓ CHẮC MUỐN XÓA BIẾN THỂ NÀY? SKU và tồn kho của mã này sẽ bị mất khỏi hệ thống sau khi Lưu.'
                : '',
            successMessage: 'Đã xóa biến thể khỏi danh sách. Có thể bấm "Khôi phục vừa xóa" để hoàn tác ngay.',
        });
    }, [deleteVariantBatch, variants]);

    const handleDeleteSelectedVariants = useCallback(() => {
        if (selectedVariantCount === 0) {
            showToast({
                type: 'warning',
                message: 'Hãy chọn ít nhất một biến thể trước khi xóa hàng loạt.',
            });
            return;
        }

        const selectedIndices = visibleVariantEntries.reduce((results, entry) => {
            if (selectedVariantIdSet.has(entry.selectionKey)) {
                results.push(entry.index);
            }
            return results;
        }, []);

        const persistedVariantCount = selectedIndices.reduce((count, index) => {
            const variantId = variants[index]?.id;
            const isPersistedVariant = variantId
                && !String(variantId).startsWith('new_')
                && !String(variantId).startsWith('manual_');
            return isPersistedVariant ? count + 1 : count;
        }, 0);

        deleteVariantBatch(selectedIndices, {
            confirmMessage: persistedVariantCount > 0
                ? `BẠN CÓ CHẮC MUỐN XÓA ${selectedVariantCount} BIẾN THỂ ĐÃ CHỌN? Các biến thể đã tồn tại sẽ bị xóa khỏi hệ thống sau khi Lưu.`
                : `Bạn có chắc muốn xóa ${selectedVariantCount} biến thể đã chọn khỏi danh sách này không?`,
            successMessage: `Đã xóa ${selectedVariantCount} biến thể đã chọn. Có thể bấm "Khôi phục vừa xóa" để hoàn tác ngay.`,
        });
    }, [deleteVariantBatch, selectedVariantCount, selectedVariantIdSet, showToast, variants, visibleVariantEntries]);

    const handleRestoreLastDeletedVariants = useCallback(() => {
        const deletedItems = Array.isArray(lastDeletedVariantBatch?.items)
            ? [...lastDeletedVariantBatch.items].sort((left, right) => left.index - right.index)
            : [];

        if (deletedItems.length === 0) {
            return;
        }

        setVariants((prev) => {
            const next = [...prev];
            deletedItems.forEach((entry) => {
                const insertIndex = Math.max(0, Math.min(entry.index, next.length));
                next.splice(insertIndex, 0, cloneVariantDraft(entry.variant));
            });
            return next;
        });
        setSelectedVariantIds((prev) => Array.from(new Set([
            ...prev,
            ...deletedItems.map((entry) => entry.selectionKey).filter(Boolean),
        ])));
        setLastDeletedVariantBatch(null);
        closeVariantImagePicker();
        clearServerValidationErrors(['variants.']);
        showToast({
            type: 'success',
            message: `Đã khôi phục ${deletedItems.length} biến thể vừa xóa.`,
        });
    }, [clearServerValidationErrors, closeVariantImagePicker, lastDeletedVariantBatch, showToast]);

    const closeHiddenVariantsModal = useCallback(() => {
        setShowHiddenVariantsModal(false);
        setSelectedHiddenVariantIds([]);
    }, []);

    const openHiddenVariantsModal = useCallback(() => {
        setSelectedHiddenVariantIds([]);
        setShowHiddenVariantsModal(true);
    }, []);

    const hideVariantBatch = useCallback((indices = [], options = {}) => {
        const normalizedIndices = Array.from(new Set(
            (Array.isArray(indices) ? indices : [])
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value >= 0 && value < variants.length)
        )).sort((left, right) => left - right);

        if (normalizedIndices.length === 0) {
            return false;
        }

        if (options.confirmMessage && !window.confirm(options.confirmMessage)) {
            return false;
        }

        const hiddenSelectionKeySet = new Set(
            normalizedIndices
                .map((index) => {
                    const variant = variants[index];
                    return variant ? getVariantSelectionKey(variant, index) : null;
                })
                .filter(Boolean)
        );

        setVariants((prev) => prev.map((variant, index) => (
            hiddenSelectionKeySet.has(getVariantSelectionKey(variant, index))
                ? { ...variant, status: false }
                : variant
        )));
        setSelectedVariantIds((prev) => prev.filter((selectionKey) => !hiddenSelectionKeySet.has(selectionKey)));
        closeVariantImagePicker();
        clearServerValidationErrors(['variants.']);

        if (options.successMessage) {
            showToast({
                type: 'success',
                message: options.successMessage,
            });
        }

        return true;
    }, [clearServerValidationErrors, closeVariantImagePicker, getVariantSelectionKey, showToast, variants]);

    const handleHideSelectedVariants = useCallback(() => {
        if (selectedVariantCount === 0) {
            showToast({
                type: 'warning',
                message: 'Hãy chọn ít nhất một biến thể trước khi ẩn hàng loạt.',
            });
            return;
        }

        const selectedIndices = visibleVariantEntries.reduce((results, entry) => {
            if (selectedVariantIdSet.has(entry.selectionKey)) {
                results.push(entry.index);
            }

            return results;
        }, []);

        hideVariantBatch(selectedIndices, {
            confirmMessage: `Ẩn ${selectedVariantCount} biến thể đã chọn? Các mẫu này sẽ biến khỏi giao diện bán hàng và có thể khôi phục từ danh sách "Mẫu đã ẩn".`,
            successMessage: `Đã ẩn ${selectedVariantCount} biến thể đã chọn. Có thể khôi phục trong "Mẫu đã ẩn".`,
        });
    }, [hideVariantBatch, selectedVariantCount, selectedVariantIdSet, showToast, visibleVariantEntries]);

    const toggleHiddenVariantSelection = useCallback((selectionKey) => {
        setSelectedHiddenVariantIds((prev) => (
            prev.includes(selectionKey)
                ? prev.filter((id) => id !== selectionKey)
                : [...prev, selectionKey]
        ));
    }, []);

    const toggleSelectAllHiddenVariants = useCallback(() => {
        const allIds = hiddenVariantEntries.map((entry) => entry.selectionKey);
        setSelectedHiddenVariantIds((prev) => (
            prev.length === allIds.length && allIds.every((id) => prev.includes(id))
                ? []
                : allIds
        ));
    }, [hiddenVariantEntries]);

    const restoreHiddenVariantBatch = useCallback((selectionKeys = []) => {
        const normalizedSelectionKeys = Array.from(new Set(
            (Array.isArray(selectionKeys) ? selectionKeys : []).filter(Boolean)
        ));

        if (normalizedSelectionKeys.length === 0) {
            return false;
        }

        const selectionKeySet = new Set(normalizedSelectionKeys);

        setVariants((prev) => prev.map((variant, index) => (
            selectionKeySet.has(getVariantSelectionKey(variant, index))
                ? { ...variant, status: true }
                : variant
        )));
        setSelectedHiddenVariantIds((prev) => prev.filter((selectionKey) => !selectionKeySet.has(selectionKey)));
        clearServerValidationErrors(['variants.']);

        return true;
    }, [clearServerValidationErrors, getVariantSelectionKey]);

    const handleRestoreSelectedHiddenVariants = useCallback(() => {
        if (selectedHiddenVariantCount === 0) {
            showToast({
                type: 'warning',
                message: 'Hãy chọn ít nhất một mẫu đã ẩn trước khi khôi phục.',
            });
            return;
        }

        const shouldCloseModal = selectedHiddenVariantCount === hiddenVariantCount;
        if (!restoreHiddenVariantBatch(selectedHiddenVariantIds)) {
            return;
        }

        if (shouldCloseModal) {
            closeHiddenVariantsModal();
        }

        showToast({
            type: 'success',
            message: `Đã khôi phục ${selectedHiddenVariantCount} mẫu đã ẩn.`,
        });
    }, [closeHiddenVariantsModal, hiddenVariantCount, restoreHiddenVariantBatch, selectedHiddenVariantCount, selectedHiddenVariantIds, showToast]);

    const handleRestoreSingleHiddenVariant = useCallback((selectionKey) => {
        const shouldCloseModal = hiddenVariantCount === 1;
        if (!restoreHiddenVariantBatch([selectionKey])) {
            return;
        }

        if (shouldCloseModal) {
            closeHiddenVariantsModal();
        }

        showToast({
            type: 'success',
            message: 'Đã khôi phục biến thể đã ẩn.',
        });
    }, [closeHiddenVariantsModal, hiddenVariantCount, restoreHiddenVariantBatch, showToast]);

    const toggleVariantSelection = useCallback((selectionKey) => {
        setSelectedVariantIds((prev) => (
            prev.includes(selectionKey)
                ? prev.filter((id) => id !== selectionKey)
                : [...prev, selectionKey]
        ));
    }, []);

    const toggleSelectAllVariants = useCallback(() => {
        const allIds = visibleVariantEntries.map((entry) => entry.selectionKey);
        setSelectedVariantIds((prev) => (
            prev.length === allIds.length && allIds.every((id) => prev.includes(id))
                ? []
                : allIds
        ));
    }, [visibleVariantEntries]);

    const openVariantQuickUpdateModal = useCallback(() => {
        setVariantQuickUpdateForm(createEmptyVariantQuickUpdateForm());
        setVariantQuickUpdateScope(selectedVariantCount > 0 ? 'selected' : 'all');
        setShowVariantQuickUpdateModal(true);
    }, [selectedVariantCount]);

    const closeVariantQuickUpdateModal = useCallback(() => {
        setShowVariantQuickUpdateModal(false);
        setVariantQuickUpdateForm(createEmptyVariantQuickUpdateForm());
        setVariantQuickUpdateScope(selectedVariantCount > 0 ? 'selected' : 'all');
    }, [selectedVariantCount]);

    const handleVariantQuickUpdateFieldChange = useCallback((field, value) => {
        let nextValue = value;
        if (field === 'price') {
            nextValue = normalizeWholeMoneyDraft(value);
        } else if (field === 'expected_cost') {
            nextValue = normalizeImportCostDraftValue(value);
        } else if (field === 'weight') {
            nextValue = value.replace(/[^0-9]/g, '');
        }

        setVariantQuickUpdateForm((prev) => ({
            ...prev,
            [field]: nextValue,
        }));
    }, []);

    const handleApplyVariantQuickUpdate = useCallback(() => {
        if (!canApplyVariantQuickUpdate) {
            showToast({
                type: 'warning',
                message: 'Vui lòng nhập ít nhất một trường để cập nhật nhanh cho biến thể.',
            });
            return;
        }

        if (variantQuickUpdateScope === 'selected' && selectedVariantCount === 0) {
            showToast({
                type: 'warning',
                message: 'Hãy chọn ít nhất một biến thể trước khi áp dụng cập nhật nhanh.',
            });
            return;
        }

        const updates = {};
        if (variantQuickUpdateForm.price !== '') updates.price = variantQuickUpdateForm.price;
        if (variantQuickUpdateForm.expected_cost !== '') updates.expected_cost = variantQuickUpdateForm.expected_cost;
        if (variantQuickUpdateForm.weight !== '') updates.weight = variantQuickUpdateForm.weight;
        if (variantQuickUpdateForm.inventory_unit_id !== '') updates.inventory_unit_id = variantQuickUpdateForm.inventory_unit_id;

        const targetIds = variantQuickUpdateScope === 'selected' ? new Set(selectedVariantIds) : null;

        setVariants((prev) => prev.map((variant, index) => {
            const selectionKey = getVariantSelectionKey(variant, index);
            if (targetIds && !targetIds.has(selectionKey)) {
                return variant;
            }

            if (!targetIds && !isActiveVariantDraft(variant)) {
                return variant;
            }

            return {
                ...variant,
                ...updates,
            };
        }));

        setShowVariantQuickUpdateModal(false);
        setVariantQuickUpdateForm(createEmptyVariantQuickUpdateForm());
        showToast({
            type: 'success',
            message: variantQuickUpdateScope === 'selected'
                ? `Đã cập nhật nhanh ${selectedVariantCount} biến thể đã chọn.`
                : `Đã cập nhật nhanh toàn bộ ${visibleVariantCount} biến thể đang bán.`,
        });
    }, [
        canApplyVariantQuickUpdate,
        getVariantSelectionKey,
        selectedVariantCount,
        selectedVariantIds,
        showToast,
        variantQuickUpdateForm,
        variantQuickUpdateScope,
        visibleVariantCount,
    ]);

    const handleWeightInputChange = (e) => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, weight: raw }));
    };

    const toggleSupplierSelection = (supplierId) => {
        const normalizedId = String(supplierId);
        setFormData((prev) => {
            const currentValues = Array.isArray(prev.supplier_ids) ? prev.supplier_ids : [];
            const nextValues = currentValues.includes(normalizedId)
                ? currentValues.filter((value) => value !== normalizedId)
                : [...currentValues, normalizedId];

            return {
                ...prev,
                supplier_ids: nextValues,
            };
        });
    };

    const selectedSuppliers = useMemo(() => {
        const activeIds = new Set((formData.supplier_ids || []).map((value) => String(value)));
        return suppliers.filter((supplier) => activeIds.has(String(supplier.id)));
    }, [formData.supplier_ids, suppliers]);

    const handleAddGroupItem = (product) => {
        if (formData.grouped_items.some(item => item.id === product.id)) {
            showToast({ message: 'Sản phẩm này đã có trong nhóm.', type: 'info' });
            return;
        }

        const primaryImage = product.images?.find(img => img.is_primary) || product.images?.[0];
        const newItem = {
            id: product.id,
            name: product.name,
            sku: product.sku,
            price: product.price,
            quantity: 1,
            is_required: true,
            image_url: primaryImage?.image_url
        };

        setFormData(prev => ({
            ...prev,
            grouped_items: [...prev.grouped_items, newItem]
        }));
    };

    const handleRemoveGroupItem = (id) => {
        setFormData(prev => ({
            ...prev,
            grouped_items: prev.grouped_items.filter(item => item.id !== id)
        }));
    };

    const handleGroupItemChange = (id, field, value) => {
        setFormData(prev => ({
            ...prev,
            grouped_items: prev.grouped_items.map(item =>
                item.id === id ? { ...item, [field]: value } : item
            )
        }));
    };

    // --- Bundle Specific Handlers ---
    const handleAddBundleOption = () => {
        setBundleOptions(prev => [{
            id: createBundleOptionId(),
            status: BUNDLE_OPTION_STATUS_VISIBLE,
            bundle_option_status: BUNDLE_OPTION_STATUS_VISIBLE,
            title: 'Tùy chọn mới',
            post_id: '',
            post_title: '',
            video_url: '',
            video_source: '',
            items: []
        }, ...prev]);
    };

    const handleCopyBundleOption = (optionId) => {
        const { copiedOption, nextOptions } = copyBundleOptionBelowSource(bundleOptions, optionId, {
            createOptionId: createBundleOptionId,
            createEntryId: createBundleItemEntryId,
            createOptionUid: createBundleOptionId,
        });

        if (!copiedOption) {
            showToast({ message: 'Không tìm thấy tùy chọn để sao chép.', type: 'error' });
            return;
        }

        pendingCopiedBundleOptionIdRef.current = copiedOption.id;
        setBundleOptions(nextOptions);
        setShowBundleSearch((prev) => (prev === optionId ? copiedOption.id : prev));
        setIsSortingBundle((prev) => ({ ...prev, [copiedOption.id]: false }));
        setBlogSearchQuery((prev) => ({ ...prev, [copiedOption.id]: '' }));
        setBlogResults((prev) => ({ ...prev, [copiedOption.id]: [] }));
        setIsSearchingBlog((prev) => ({ ...prev, [copiedOption.id]: false }));
        showToast({ message: 'Đã copy tùy chọn ngay bên dưới tùy chọn gốc.', type: 'success' });
    };

    const closeBundleItemQuickSorter = useCallback(() => {
        setBundleItemQuickSorter({
            optionId: null,
            items: [],
            positionDrafts: {},
        });
    }, []);

    const updateBundleItemQuickSorterItems = useCallback((nextItemsOrUpdater) => {
        setBundleItemQuickSorter((prev) => {
            const nextItems = typeof nextItemsOrUpdater === 'function'
                ? nextItemsOrUpdater(prev.items)
                : nextItemsOrUpdater;
            const normalizedItems = Array.isArray(nextItems) ? nextItems : [];

            return {
                ...prev,
                items: normalizedItems,
                positionDrafts: buildBundleItemSorterPositionDrafts(normalizedItems),
            };
        });
    }, []);

    const openBundleItemQuickSorter = useCallback((optionId) => {
        const targetOption = bundleOptions.find((option) => option.id === optionId);
        if (!targetOption) {
            return;
        }

        const draftItems = Array.isArray(targetOption.items)
            ? targetOption.items.map((item) => ({ ...item }))
            : [];

        setIsSortingBundle((prev) => ({
            ...prev,
            [optionId]: false,
        }));
        setBundleItemQuickSorter({
            optionId,
            items: draftItems,
            positionDrafts: buildBundleItemSorterPositionDrafts(draftItems),
        });
    }, [bundleOptions]);

    const handleUploadBundleOptionImage = useCallback((optionId, event) => {
        const file = event.target.files[0];
        if (!file) return;

        const uploadData = new FormData();
        uploadData.append('image', file);

        mediaApi.upload(uploadData).then(res => {
            const url = res.data.url;
            setBundleOptions(prev => prev.map(opt => opt.id === optionId ? { ...opt, image_url: url } : opt));
            showToast('Tải ảnh thành công', 'success');
        }).catch(err => {
            showToast('Lỗi khi tải ảnh', 'error');
        });
    }, [showToast]);

    const handleUploadBundleOptionImageSafe = useCallback(async (optionId, event) => {
        const input = event.target;
        const file = input.files[0];
        input.value = '';

        if (!file) {
            return;
        }

        try {
            const url = await uploadImageViaMediaApi(file);
            setBundleOptions((prev) => prev.map((opt) => (
                opt.id === optionId ? { ...opt, image_url: url } : opt
            )));
            showToast({
                message: 'Da tai anh bundle thanh cong.',
                type: 'success',
            });
        } catch (error) {
            showToast({
                message: resolveProductImageUploadErrorMessage(error),
                type: 'error',
                duration: 7000,
            });
        }
    }, [showToast]);

    const handleRemoveBundleOptionImage = useCallback((optionId) => {
        setBundleOptions(prev => prev.map(opt => opt.id === optionId ? { ...opt, image_url: '' } : opt));
    }, []);

    const syncParentVideoUrls = useCallback((updater) => {
        setFormData((prev) => {
            const currentVideos = normalizeProductVideoDraftItems(prev.video_urls, prev.video_url);
            const nextVideos = typeof updater === 'function' ? updater(currentVideos) : updater;
            const draftVideos = normalizeProductVideoDraftItems(nextVideos);
            const firstVideoUrl = draftVideos.find((video) => String(video.url || '').trim())?.url || '';

            return {
                ...prev,
                video_urls: draftVideos,
                video_url: firstVideoUrl,
            };
        });
    }, []);

    const handleAddParentVideo = useCallback(() => {
        syncParentVideoUrls((videos) => [...videos, { title: '', url: '' }]);
    }, [syncParentVideoUrls]);

    const handleUpdateParentVideo = useCallback((index, field, value) => {
        syncParentVideoUrls((videos) => {
            const nextVideos = videos.length > 0 ? [...videos] : [{ title: '', url: '' }];
            nextVideos[index] = {
                ...(nextVideos[index] || { title: '', url: '' }),
                [field]: value,
            };
            return nextVideos;
        });
    }, [syncParentVideoUrls]);

    const handleParentVideoTitleKeyDown = useCallback((event, index) => {
        if (event.key !== ' ' && event.key !== 'Spacebar') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const input = event.currentTarget;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const nextValue = `${input.value.slice(0, start)} ${input.value.slice(end)}`;
        handleUpdateParentVideo(index, 'title', nextValue);

        window.requestAnimationFrame(() => {
            input.setSelectionRange(start + 1, start + 1);
        });
    }, [handleUpdateParentVideo]);

    const handleRemoveParentVideo = useCallback((index) => {
        syncParentVideoUrls((videos) => videos.filter((_, videoIndex) => videoIndex !== index));
    }, [syncParentVideoUrls]);

    const moveParentVideo = useCallback((index, direction) => {
        syncParentVideoUrls((videos) => {
            const targetIndex = index + direction;
            if (targetIndex < 0 || targetIndex >= videos.length) {
                return videos;
            }

            const nextVideos = [...videos];
            [nextVideos[index], nextVideos[targetIndex]] = [nextVideos[targetIndex], nextVideos[index]];
            return nextVideos;
        });
    }, [syncParentVideoUrls]);

    const handleChangeBundleOptionVideo = useCallback((optionId, source, url = '') => {
        const normalizedUrl = String(url || '').trim();
        setBundleOptions((prev) => prev.map((option) => (
            option.id === optionId
                ? {
                    ...option,
                    video_source: source === 'parent' ? 'parent' : '',
                    video_url: source === 'parent' ? normalizedUrl : '',
                }
                : option
        )));
        setBundleOptionVideoPicker(null);
    }, []);

    const handleUpdateBundleOptionCustomVideo = useCallback((optionId, url) => {
        setBundleOptions((prev) => prev.map((option) => (
            option.id === optionId
                ? { ...option, video_source: 'custom', video_url: url }
                : option
        )));
    }, []);

    const getBundleOptionVideoLabel = useCallback((option) => {
        if (!option?.video_url) {
            return 'Dùng video bundle cha';
        }

        const parentVideo = normalizeProductVideoItems(formData.video_urls, formData.video_url)
            .find((video) => video.url === option.video_url);

        return parentVideo?.title || 'Video riêng';
    }, [formData.video_url, formData.video_urls]);


    const handleRemoveBundleOption = (optionId) => {
        setBundleOptions(prev => prev.filter(o => o.id !== optionId));
        setBundleOptionVideoPicker((prev) => (prev === optionId ? null : prev));
        setShowBundleSearch((prev) => (prev === optionId ? null : prev));
        setIsSortingBundle((prev) => {
            const next = { ...prev };
            delete next[optionId];
            return next;
        });
        setBlogSearchQuery(prev => {
            const next = { ...prev };
            delete next[optionId];
            return next;
        });
        setBlogResults(prev => {
            const next = { ...prev };
            delete next[optionId];
            return next;
        });
        setIsSearchingBlog(prev => {
            const next = { ...prev };
            delete next[optionId];
            return next;
        });
    };

    const handleUpdateOptionTitle = (optionId, title) => {
        setBundleOptions(prev => prev.map(o => o.id === optionId ? { ...o, title } : o));
    };

    const handleUpdateBundleOptionStatus = (optionId, status) => {
        const normalizedStatus = normalizeBundleOptionStatus(status);
        setBundleOptions(prev => prev.map(option => (
            option.id === optionId
                ? {
                    ...option,
                    status: normalizedStatus,
                    bundle_option_status: normalizedStatus,
                }
                : option
        )));
    };

    const handleSelectBundleOptionPost = (optionId, post) => {
        setBundleOptions(prev => prev.map(option => (
            option.id === optionId
                ? { ...option, post_id: post.id, post_title: post.title || '' }
                : option
        )));
        setBlogSearchQuery(prev => ({ ...prev, [optionId]: '' }));
        setBlogResults(prev => ({ ...prev, [optionId]: [] }));
    };

    const handleClearBundleOptionPost = (optionId) => {
        setBundleOptions(prev => prev.map(option => (
            option.id === optionId
                ? { ...option, post_id: '', post_title: '' }
                : option
        )));
        setBlogSearchQuery(prev => ({ ...prev, [optionId]: '' }));
        setBlogResults(prev => ({ ...prev, [optionId]: [] }));
    };

    const handleAddItemToOption = (optionId, product) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            if (o.items.some(it => it.id === product.id && it.variant_id === null && product.type === 'simple')) {
                showToast({ message: 'Sản phẩm này đã có trong tùy chọn.', type: 'info' });
                return o;
            }

            const primaryImage = product.images?.find(img => img.is_primary) || product.images?.[0];
            const newItem = {
                entry_id: createBundleItemEntryId(),
                id: product.id,
                product_id: product.id,
                product_name: product.name,
                product_sku: product.sku,
                product_price: normalizeMoneyValue(product.price),
                product_cost_price: isDuplicate ? '' : normalizeImportCostValue(product.cost_price),
                product_image_url: primaryImage?.image_url,
                name: product.name,
                sku: product.sku,
                price: normalizeMoneyValue(product.price),
                cost_price: isDuplicate ? '' : normalizeImportCostValue(product.cost_price),
                quantity: 1,
                is_required: true,
                is_default: o.items.length === 0,
                image_url: primaryImage?.image_url,
                type: product.type,
                variant_id: null,
                variant_label: ''
            };
            return { ...o, items: [...o.items, newItem] };
        }));

        if (product.type === 'configurable') {
            void loadBundleVariantsForProduct(product.id);
            showToast({ message: 'Hãy chọn một biến thể cụ thể cho item bundle này để hệ thống ghi nhận đúng tồn kho.', type: 'info' });
        }
    };

    const handleRemoveItemFromOption = (optionId, entryId) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            const newItems = o.items.filter(it => it.entry_id !== entryId);
            // Nếu xóa trúng sp đang là default, đặt sp đầu tiên còn lại làm default
            if (o.items.find(it => it.entry_id === entryId)?.is_default && newItems.length > 0) {
                newItems[0] = { ...newItems[0], is_default: true };
            }
            return { ...o, items: newItems };
        }));
    };

    const handleSetDefaultInOption = (optionId, entryId) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            return {
                ...o,
                items: o.items.map(it => ({ ...it, is_default: it.entry_id === entryId }))
            };
        }));
    };

    const handleUpdateBundleItemQty = (optionId, entryId, quantity) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            return {
                ...o,
                items: o.items.map(it => it.entry_id === entryId ? { ...it, quantity: Math.max(1, parseInt(quantity) || 1) } : it)
            };
        }));
    };

    const handleUpdateBundleItemVariant = (optionId, entryId, variantId) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;

            return {
                ...o,
                items: o.items.map(it => {
                    if (it.entry_id !== entryId) return it;

                    const variants = bundleItemVariants[getBundleItemProductId(it)] || [];
                    const selectedVariant = variants.find(v => Number(v.id) === Number(variantId));

                    return selectedVariant
                        ? applyBundleItemVariantDisplay(it, selectedVariant)
                        : restoreBundleItemBaseDisplay(it);
                })
            };
        }));
    };

    const moveBundleItem = (optionId, dragIndex, hoverIndex) => {
        setBundleOptions(prev => prev.map(o => {
            if (o.id !== optionId) return o;
            const newItems = [...o.items];
            const dragItem = newItems[dragIndex];
            newItems.splice(dragIndex, 1);
            newItems.splice(hoverIndex, 0, dragItem);
            return { ...o, items: newItems };
        }));
    };

    const moveBundleOption = (dragIndex, hoverIndex) => {
        setBundleOptions((prev) => {
            if (
                dragIndex === hoverIndex
                || dragIndex < 0
                || hoverIndex < 0
                || dragIndex >= prev.length
                || hoverIndex >= prev.length
            ) {
                return prev;
            }

            const next = [...prev];
            const [draggedOption] = next.splice(dragIndex, 1);
            next.splice(hoverIndex, 0, draggedOption);
            return next;
        });
    };

    const moveBundleOptionByOffset = (index, offset) => {
        moveBundleOption(index, index + offset);
    };

    const toggleBundleSorting = (optionId) => {
        setIsSortingBundle(prev => ({
            ...prev,
            [optionId]: !prev[optionId]
        }));
    };

    const moveBundleItemQuickSorterItem = useCallback((dragIndex, hoverIndex) => {
        updateBundleItemQuickSorterItems((prevItems) => moveListItem(prevItems, dragIndex, hoverIndex));
    }, [updateBundleItemQuickSorterItems]);

    const moveBundleItemQuickSorterItemByOffset = useCallback((index, offset) => {
        moveBundleItemQuickSorterItem(index, index + offset);
    }, [moveBundleItemQuickSorterItem]);

    const handleBundleItemQuickSorterPositionChange = useCallback((entryId, value) => {
        const sanitizedValue = String(value ?? '').replace(/[^0-9]/g, '');
        setBundleItemQuickSorter((prev) => ({
            ...prev,
            positionDrafts: {
                ...prev.positionDrafts,
                [entryId]: sanitizedValue,
            },
        }));
    }, []);

    const handleBundleItemQuickSorterPositionCommit = useCallback((entryId, value) => {
        updateBundleItemQuickSorterItems((prevItems) => {
            const currentIndex = prevItems.findIndex((item) => getBundleItemEntryKey(item) === entryId);
            if (currentIndex < 0 || prevItems.length === 0) {
                return prevItems;
            }

            const parsedPosition = Number.parseInt(String(value ?? '').trim(), 10);
            if (!Number.isFinite(parsedPosition)) {
                return prevItems;
            }

            const targetIndex = Math.max(0, Math.min(prevItems.length - 1, parsedPosition - 1));
            return moveListItem(prevItems, currentIndex, targetIndex);
        });
    }, [updateBundleItemQuickSorterItems]);

    const handleSaveBundleItemQuickSorter = useCallback(() => {
        if (!bundleItemQuickSorter.optionId) {
            return;
        }

        const orderedEntryIds = (Array.isArray(bundleItemQuickSorter.items) ? bundleItemQuickSorter.items : [])
            .map(getBundleItemEntryKey)
            .filter(Boolean);

        setBundleOptions((prev) => prev.map((option) => {
            if (option.id !== bundleItemQuickSorter.optionId) {
                return option;
            }

            const liveItems = Array.isArray(option.items) ? option.items : [];
            const liveItemsByEntryId = new Map(
                liveItems.map((item) => [getBundleItemEntryKey(item), item])
            );
            const orderedEntryIdSet = new Set(orderedEntryIds);
            const orderedItems = orderedEntryIds
                .map((entryId) => liveItemsByEntryId.get(entryId))
                .filter(Boolean);
            const remainingItems = liveItems.filter((item) => !orderedEntryIdSet.has(getBundleItemEntryKey(item)));

            return {
                ...option,
                items: [...orderedItems, ...remainingItems],
            };
        }));

        closeBundleItemQuickSorter();
        showToast({ message: 'Đã cập nhật thứ tự sản phẩm trong tùy chọn.', type: 'success' });
    }, [bundleItemQuickSorter.items, bundleItemQuickSorter.optionId, closeBundleItemQuickSorter, showToast]);

    const handleRefreshBundlePrices = async () => {
        if (bundleOptions.length === 0) {
            showToast('Không có sản phẩm nào để làm mới', 'warning');
            return;
        }

        setIsRefreshingPrices(true);
        try {
            const allItems = bundleOptions.flatMap(opt => opt.items);
            const parentItemMap = {};
            const variantItemMap = {};

            // Collect unique product IDs to fetch
            const productIds = [...new Set(allItems.map(it => getBundleItemProductId(it)).filter(Boolean))];

            await Promise.all(productIds.map(async (pId) => {
                try {
                    const res = await productApi.getOne(pId, { context: 'edit' });
                    const product = res.data;
                    const primaryImage = resolveBundleItemImage(product);

                    parentItemMap[pId] = {
                        product_name: product.name,
                        product_sku: product.sku,
                        product_price: normalizeMoneyValue(product.price),
                        product_cost_price: isDuplicate ? '' : normalizeImportCostValue(product.cost_price),
                        product_image_url: primaryImage,
                    };

                    // Variant prices
                    if (product.type === 'configurable') {
                        const variants = (product.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
                        variants.forEach(v => {
                            variantItemMap[`${pId}_${v.id}`] = {
                                variant_id: v.id,
                                variant_label: getBundleVariantLabel(v),
                                name: v.name || product.name,
                                sku: v.sku || product.sku,
                                price: normalizeMoneyValue(v.price),
                                cost_price: isDuplicate ? '' : normalizeImportCostValue(v.cost_price),
                                image_url: resolveBundleItemImage(v) || primaryImage
                            };
                        });
                        // Update cache for variant selectors
                        setBundleItemVariants(prev => ({ ...prev, [pId]: variants }));
                    }
                } catch (e) {
                    console.error(`Failed to refresh item ${pId}`, e);
                }
            }));

            setBundleOptions(prev => prev.map(opt => ({
                ...opt,
                items: opt.items.map(item => {
                    const productId = getBundleItemProductId(item);
                    const parentUpdates = parentItemMap[productId];
                    const withParentData = parentUpdates
                        ? {
                            ...item,
                            ...parentUpdates,
                        }
                        : item;

                    if (item.variant_id) {
                        const variantUpdates = variantItemMap[`${productId}_${item.variant_id}`];
                        if (variantUpdates) {
                            return {
                                ...withParentData,
                                ...variantUpdates,
                            };
                        }
                    }

                    return restoreBundleItemBaseDisplay(withParentData);
                })
            })));

            showToast('Đã làm mới giá bán từ sản phẩm gốc.', 'success');
        } catch (error) {
            showToast('Lỗi khi làm mới giá.', 'error');
        } finally {
            setIsRefreshingPrices(false);
        }
    };

    const processVideoLinks = (html) => {
        if (!html) return '';
        // Comprehensive regex for YouTube and Facebook links
        return html.replace(/(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|facebook\.com\/(?:watch\/\?v=|.*\/videos\/|video\.php\?v=))[^\s<"']+)/gi, (match, url, offset, fullString) => {
            // Only skip if it's an attribute value (src, href)
            const before = fullString.substring(Math.max(0, offset - 10), offset).toLowerCase();
            if (before.includes('src=') || before.includes('href=')) {
                return match;
            }

            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                const idMatch = url.match(/(?:\/watch\?v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                if (idMatch) {
                    return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="https://www.youtube.com/embed/${idMatch[1]}" allowfullscreen="true" frameborder="0" style="width:100%; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
                }
            } else if (url.includes('facebook.com')) {
                const fbEmbed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
                return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="${fbEmbed}" allowfullscreen="true" frameborder="0" style="width:800px; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
            }
            return match;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setServerValidationErrors({});
        if (localSkuValidation.hasErrors) {
            setIsSaving(false);
            showToast({
                message: 'Mã sản phẩm hoặc mã biến thể đang bị trùng trong form. Vui lòng kiểm tra lại trước khi lưu.',
                type: 'error',
            });
            return;
        }
        let submitCompositeItems = compositeItemsForPricing;
        let submitCompositeSumPrice = compositeSumPrice;

        if (formData.type === 'bundle') {
            setIsSaving(true);
            setSaveStatusText('Đang kiểm tra biến thể bundle...');

            try {
                const resolvedBundleSubmit = await resolveBundleOptionsForSubmit();
                submitCompositeItems = resolvedBundleSubmit.compositeItems;
                submitCompositeSumPrice = calculateCompositeItemsTotal(submitCompositeItems);

                if (resolvedBundleSubmit.autoResolvedCount > 0) {
                    showToast({
                        message: `Đã tự chọn biến thể cho ${resolvedBundleSubmit.autoResolvedCount} item bundle còn thiếu.`,
                        type: 'info',
                    });
                }
            } catch (error) {
                console.error('Failed to resolve bundle variants before submit', error);
                setIsSaving(false);
                showToast({
                    message: 'Không thể kiểm tra biến thể bundle. Vui lòng thử lưu lại.',
                    type: 'error',
                });
                return;
            }
        }

        const missingBundleVariantItems = formData.type === 'bundle'
            ? submitCompositeItems.filter((item) => item?.type === 'configurable' && !item?.variant_id)
            : [];
        if (missingBundleVariantItems.length > 0) {
            setIsSaving(false);
            showToast({
                message: `Còn ${missingBundleVariantItems.length} item bundle dạng configurable chưa chọn biến thể. Vui lòng chọn biến thể trước khi lưu.`,
                type: 'error',
            });
            return;
        }
        setIsSaving(true);
        setSaveStatusText('Đang chuẩn bị dữ liệu...');
        let duplicateCloneId = null;
        let duplicateCloneData = null;
        try {
            const imageDraftPayload = buildProductImageSubmissionPayload(images);
            const hasPendingImageOptimization = images.some((img) => img?.optimizing);

            if (hasPendingImageOptimization) {
                showToast({
                    message: 'Ảnh vẫn đang tối ưu. Vui lòng chờ vài giây rồi lưu lại.',
                    type: 'warning',
                });
                return;
            }

            const currentImageSignature = buildProductImageSignature(images);
            const currentBundleOptionSignature = buildBundleOptionSignature(bundleOptions);
            const hasImageChanges = currentImageSignature !== initialImageSignatureRef.current;
            const hasFormDataChanges = JSON.stringify(formData) !== initialFormDataSignatureRef.current;
            const hasBundleOptionChanges = currentBundleOptionSignature !== initialBundleOptionSignatureRef.current;
            const canUseImageOnlySave = isEdit
                && !isDuplicate
                && hasImageChanges
                && !hasFormDataChanges
                && !hasBundleOptionChanges
                && !hasNonImageFormChangesRef.current;

            if (canUseImageOnlySave) {
                setSaveStatusText(imageDraftPayload.files.length > 0
                    ? `Đang tải ${imageDraftPayload.files.length} ảnh mới...`
                    : 'Đang lưu thứ tự ảnh...');

                const imageOnlyData = new FormData();
                appendProductImageSubmissionPayload(imageOnlyData, imageDraftPayload);
                const imageResponse = await productImageApi.syncProductImages(id, imageOnlyData);
                const normalizedImages = normalizeAdminImages(imageResponse.data?.images || []);
                setImages(normalizedImages);
                initialImageSignatureRef.current = buildProductImageSignature(normalizedImages);
                showToast({ message: 'Đã lưu hình ảnh sản phẩm thành công!', type: 'success' });
                navigateBackToOrigin();
                return;
            }

            if (isDuplicate) {
                const duplicateResponse = await productApi.duplicate(id);
                duplicateCloneData = duplicateResponse.data?.data || duplicateResponse.data || null;
                duplicateCloneId = Number(duplicateCloneData?.id || 0) || null;

                if (!duplicateCloneId) {
                    throw new Error('Khong the tao ban nhan ban tam thoi.');
                }
            }

            const shouldAutoSumCompositePrice = ['grouped', 'bundle'].includes(formData.type) && formData.price_type === 'sum';
            const duplicateDefaults = duplicateDraftDefaultsRef.current || { parentSku: '', variantSkus: [] };
            const orderedDuplicateVariants = isDuplicate ? getOrderedSuperLinkVariants(duplicateCloneData) : [];
            const groupedItemsSubmitPayload = ['grouped', 'bundle'].includes(formData.type)
                ? buildCompositeItemsSubmitPayload(submitCompositeItems)
                : [];
            const hasVariantImageUploads = formData.type === 'configurable'
                && variants.some((variant) => isFileLikeValue(variant?.image_file));
            const hasProductImageUploads = (isEdit || isDuplicate)
                ? imageDraftPayload.files.length > 0
                : images.some((image) => isFileLikeValue(image?.file));
            const useMultipartSubmit = hasProductImageUploads || hasVariantImageUploads;
            const submitData = useMultipartSubmit ? new FormData() : {};
            const appendSubmitValue = (key, value) => {
                if (submitData instanceof FormData) {
                    submitData.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : value);
                } else {
                    submitData[key] = value;
                }
            };
            const setSubmitValue = (key, value) => {
                if (submitData instanceof FormData) {
                    submitData.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : value);
                } else {
                    submitData[key] = value;
                }
            };
            const appendSubmitArray = (key, values) => {
                const normalizedValues = Array.isArray(values) ? values : [];
                if (submitData instanceof FormData) {
                    normalizedValues.forEach((value) => appendSubmitValue(`${key}[]`, value));
                } else if (normalizedValues.length > 0) {
                    submitData[key] = [...normalizedValues];
                }
            };
            const setGroupedItemsPayload = () => {
                if (!['grouped', 'bundle'].includes(formData.type)) {
                    return;
                }

                if (submitData instanceof FormData) {
                    submitData.append('grouped_items_json', JSON.stringify(groupedItemsSubmitPayload));
                } else {
                    submitData.grouped_items = groupedItemsSubmitPayload;
                }
            };

            // Build FormData from state
            Object.entries(formData).forEach(([key, val]) => {
                if (key === 'custom_attributes') {
                    if (submitData instanceof FormData) {
                        Object.entries(val).forEach(([attrId, attrVal]) => {
                            if (Array.isArray(attrVal)) {
                                attrVal.forEach(av => submitData.append(`custom_attributes[${attrId}][]`, av));
                            } else {
                                submitData.append(`custom_attributes[${attrId}]`, attrVal);
                            }
                        });
                    } else if (val && typeof val === 'object') {
                        submitData.custom_attributes = { ...val };
                    }
                } else if (key === 'super_attribute_ids') {
                    appendSubmitArray('super_attribute_ids', selectedSuperAttributes.map((attr) => attr.id));
                } else if (key === 'linked_product_ids') {
                    if (selectedProductsData.length === 0) {
                        // Gửi tham số tường minh để Backend thực hiện detach/sync
                        appendSubmitValue('clear_linked_products', true);
                    } else {
                        const linkedProductsPayload = selectedProductsData.map((v) => {
                            const payload = { id: v.id };
                            const optionTitle = v.option_title || v.pivot?.option_title || '';
                            if (optionTitle) {
                                payload.option_title = optionTitle;
                            }
                            return payload;
                        });

                        if (submitData instanceof FormData) {
                            linkedProductsPayload.forEach((linkedProduct, idx) => {
                                submitData.append(`linked_product_ids[${idx}][id]`, linkedProduct.id);
                                if (linkedProduct.option_title) {
                                    submitData.append(`linked_product_ids[${idx}][option_title]`, linkedProduct.option_title);
                                }
                            });
                        } else {
                            submitData.linked_product_ids = linkedProductsPayload;
                        }
                    }
                } else if (key === 'grouped_items') {
                    setGroupedItemsPayload();
                } else if (key === 'video_urls') {
                    const videoPayload = normalizeProductVideoItems(val, formData.video_url);
                    appendSubmitValue(key, submitData instanceof FormData ? JSON.stringify(videoPayload) : videoPayload);
                } else if (key === 'specifications') {
                    appendSubmitValue(key, JSON.stringify(normalizeSpecificationRows(val)));
                } else if (key === 'additional_info') {
                    appendSubmitValue(key, JSON.stringify(normalizeAdditionalInfoRows(val)));
                } else if (key === 'supplier_ids') {
                    if (Array.isArray(val) && val.length > 0) {
                        appendSubmitArray('supplier_ids', val);
                    } else {
                        appendSubmitValue('clear_supplier_ids', true);
                    }
                } else if (key === 'stock_quantity') {
                    const normalizedCurrentStock = normalizeStockQuantityComparableValue(val);
                    if (
                        normalizedCurrentStock !== ''
                        && normalizedCurrentStock !== initialStockQuantityRef.current
                    ) {
                        appendSubmitValue(key, String(val).trim());
                    }
                } else if (Array.isArray(val)) {
                    appendSubmitArray(key, val);
                } else if (typeof val === 'boolean') {
                    appendSubmitValue(key, val);
                } else if (val !== '' && val !== null && val !== undefined) {
                    if (key === 'expected_cost' || key === 'cost_price') {
                        const normalizedValue = normalizeRoundedImportCostNumber(val);
                        if (normalizedValue !== null) {
                            appendSubmitValue(key, normalizedValue);
                        }
                    } else if (key === 'description') {
                        appendSubmitValue(key, processVideoLinks(val));
                    } else if (isDuplicate && key === 'sku') {
                        const normalizedDraftSku = normalizeSkuSeed(val);
                        const normalizedDefaultSku = normalizeSkuSeed(duplicateDefaults.parentSku);
                        const resolvedSku = (
                            normalizedDraftSku === ''
                            || normalizedDraftSku === normalizedDefaultSku
                        )
                            ? (duplicateCloneData?.sku || normalizeSkuDraft(val))
                            : normalizeSkuDraft(val);

                        if (resolvedSku) {
                            appendSubmitValue(key, resolvedSku);
                        }
                    } else {
                        appendSubmitValue(key, val);
                    }
                }
            });

            if (Array.isArray(formData.category_ids) && formData.category_ids.length > 0) {
                setSubmitValue('category_id', formData.category_ids[0]);
            } else if (isEdit || isDuplicate) {
                appendSubmitValue('clear_category_ids', true);
            }

            if (shouldAutoSumCompositePrice) {
                setSubmitValue('price', String(submitCompositeSumPrice));
            }

            // Add variants if configurable
            if (formData.type === 'configurable') {
                const variantsPayload = [];

                variants.forEach((v, idx) => {
                    const duplicateVariant = orderedDuplicateVariants[idx] || null;
                    const variantPayload = {};
                    const setVariantValue = (field, value) => {
                        if (submitData instanceof FormData) {
                            submitData.append(`variants[${idx}][${field}]`, value);
                        } else {
                            variantPayload[field] = value;
                        }
                    };

                    if (isDuplicate) {
                        if (duplicateVariant?.id) {
                            setVariantValue('id', duplicateVariant.id);
                        }
                    } else if (v.id && !v.id.toString().startsWith('new_') && !v.id.toString().startsWith('manual_')) {
                        // If variant already has an ID, send it for update
                        setVariantValue('id', v.id);
                    }

                    const normalizedVariantDraftSku = normalizeSkuSeed(v?.sku);
                    const normalizedVariantDefaultSku = normalizeSkuSeed(duplicateDefaults.variantSkus[idx] || '');
                    const resolvedVariantSku = (
                        isDuplicate
                        && (normalizedVariantDraftSku === '' || normalizedVariantDraftSku === normalizedVariantDefaultSku)
                    )
                        ? (duplicateVariant?.sku || normalizeSkuDraft(v.sku))
                        : normalizeSkuDraft(v.sku);

                    setVariantValue('sku', resolvedVariantSku);
                    setVariantValue('name', v.label); // Send label as name
                    setVariantValue('price', v.price);
                    const normalizedVariantExpectedCost = normalizeRoundedImportCostNumber(v.expected_cost);
                    setVariantValue('expected_cost', normalizedVariantExpectedCost ?? '');
                    setVariantValue('weight', v.weight || '');
                    setVariantValue('inventory_unit_id', v.inventory_unit_id || formData.inventory_unit_id || '');
                    setVariantValue('status', submitData instanceof FormData ? (isActiveVariantDraft(v) ? '1' : '0') : isActiveVariantDraft(v));
                    setVariantValue('is_default', submitData instanceof FormData ? (v.is_default ? '1' : '0') : Boolean(v.is_default));

                    if (submitData instanceof FormData && v.image_file) {
                        submitData.append(`variants[${idx}][image]`, v.image_file);
                    } else if (v.library_image_id) {
                        setVariantValue('library_image_id', v.library_image_id);
                    }
                    if (v.image_reference_url) {
                        setVariantValue('image_reference_url', v.image_reference_url);
                    }
                    if (v.remove_image) {
                        setVariantValue('remove_image', submitData instanceof FormData ? 'true' : true);
                    }

                    if (submitData instanceof FormData) {
                        Object.entries(v.attributes).forEach(([attrId, attrVal]) => {
                            submitData.append(`variants[${idx}][attributes][${attrId}]`, attrVal);
                        });
                    } else {
                        variantPayload.attributes = { ...v.attributes };
                        variantsPayload.push(variantPayload);
                    }
                });

                if (!(submitData instanceof FormData)) {
                    submitData.variants = variantsPayload;
                }
            }

            if (isEdit || isDuplicate) {
                appendProductImageSubmissionPayload(submitData, imageDraftPayload);
            } else {
                images.forEach((img) => {
                    if (img.file && submitData instanceof FormData) submitData.append('images[]', img.file);
                });
            }

            let response;
            if (isDuplicate) {
                setSaveStatusText('Đang lưu bản nhân bản...');
                response = await productApi.update(duplicateCloneId, submitData);
            } else if (isEdit) {
                // For updates, we use POST but can add method override if needed
                // productApi.update is already POST /api/products/:id
                setSaveStatusText(imageDraftPayload.files.length > 0
                    ? `Đang lưu sản phẩm và tải ${imageDraftPayload.files.length} ảnh mới...`
                    : 'Đang lưu sản phẩm...');
                response = await productApi.update(id, submitData);
            } else {
                setSaveStatusText('Đang tạo sản phẩm...');
                response = await productApi.store(submitData);
            }

            initialStockQuantityRef.current = normalizeStockQuantityComparableValue(
                response.data?.stock_quantity ?? formData.stock_quantity
            );

            if (!isEdit && !isDuplicate) {
                const productId = response.data.id;

                let persistedImages = Array.isArray(response.data?.images) ? response.data.images : [];
                if (persistedImages.length === 0 && productId) {
                    try {
                        const refreshedProduct = await productApi.getOne(productId, { context: 'edit' });
                        persistedImages = Array.isArray(refreshedProduct.data?.images) ? refreshedProduct.data.images : [];
                    } catch (refreshError) {
                        console.error('Unable to refresh product images after save:', refreshError);
                    }
                }

                const remainingServerImages = [...persistedImages];
                const resolvedImageIds = images
                    .map((img) => {
                        if (!isTemporaryProductImageId(img.id)) {
                            return Number(img.id) || null;
                        }

                        const nextServerImage = remainingServerImages.shift();
                        return nextServerImage?.id ? Number(nextServerImage.id) : null;
                    })
                    .filter(Boolean);

                const preferredPrimaryIndex = images.findIndex((img) => Boolean(img.is_primary));
                const preferredPrimaryId = preferredPrimaryIndex >= 0
                    ? resolvedImageIds[preferredPrimaryIndex] || null
                    : (resolvedImageIds[0] || null);

                if (resolvedImageIds.length > 0) {
                    await productImageApi.reorder(resolvedImageIds);

                    if (preferredPrimaryId) {
                        await productImageApi.setPrimary(preferredPrimaryId);
                    }
                }
            }

            showToast({ message: 'Sản phẩm đã được lưu thành công!', type: 'success' });
            navigateBackToOrigin();
        } catch (error) {
            console.error("Save error:", error.response?.data);
            if (isDuplicate && duplicateCloneId) {
                try {
                    await productApi.forceDelete(duplicateCloneId);
                } catch (cleanupError) {
                    console.error('Duplicate cleanup error:', cleanupError);
                }
            }
            const data = error.response?.data;
            setServerValidationErrors(data?.errors || {});
            let message = data?.message || 'Vui lòng kiểm tra lại thông tin.';

            if (data?.errors) {
                const errorList = Object.values(data.errors).flat();
                if (errorList.length > 0) {
                    message = (
                        <div className="text-left">
                            <p className="font-bold mb-2">{data.message}</p>
                            <ul className="list-disc pl-4 space-y-1 text-[12px]">
                                {errorList.map((err, i) => <li key={i}>{err}</li>)}
                            </ul>
                        </div>
                    );
                }
            }

            showToast({ message, type: 'error' });
        } finally {
            setIsSaving(false);
            setSaveStatusText('');
        }
    };

    // handleCancel handles navigation directly without confirm for a faster experience

    const TYPE_INFO = PRODUCT_TYPE_FORM_META;


    const selectedDomain = useMemo(() => (
        domains.find(d => String(d.id) === String(formData.site_domain_id))
        || domains.find(d => d.is_default)
        || { domain: 'di-san.com' }
    ), [domains, formData.site_domain_id]);

    const previewSlug = useMemo(() => (
        String((showSlugModal ? tempSlug : formData.slug) || formData.slug || '').trim()
    ), [formData.slug, showSlugModal, tempSlug]);

    const baseProductLink = useMemo(() => {
        const domain = String(selectedDomain?.domain || '').trim().replace(/^https?:\/\//, '');
        if (!previewSlug || !domain) {
            return '';
        }

        try {
            return new URL(`/product/${encodeURIComponent(previewSlug)}`, `https://${domain}`).toString();
        } catch (error) {
            return '';
        }
    }, [previewSlug, selectedDomain]);

    const hasValidProductLink = Boolean(baseProductLink);

    const buildTrackingLink = useCallback((url, source) => {
        if (!url) {
            return '';
        }

        try {
            const trackingUrl = new URL(url);
            trackingUrl.searchParams.set('utm_source', source);
            return trackingUrl.toString();
        } catch (error) {
            return `${url}${url.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(source)}`;
        }
    }, []);

    const buildUrlWithQueryParams = useCallback((url, params = {}) => {
        if (!url) {
            return '';
        }

        const entries = Object.entries(params)
            .map(([key, value]) => [key, normalizeBundleOptionLinkText(value)])
            .filter(([, value]) => value !== '');

        if (entries.length === 0) {
            return url;
        }

        try {
            const nextUrl = new URL(url);
            entries.forEach(([key, value]) => nextUrl.searchParams.set(key, value));
            return nextUrl.toString();
        } catch (error) {
            const query = new URLSearchParams(entries).toString();
            return `${url}${url.includes('?') ? '&' : '?'}${query}`;
        }
    }, []);

    const buildBundleOptionUrl = useCallback((option = {}) => {
        return buildUrlWithQueryParams(baseProductLink, {
            o: buildCompactBundleOptionLinkValue(option),
        });
    }, [baseProductLink, buildUrlWithQueryParams]);

    const trackingLinks = useMemo(() => (
        AD_TRACKING_LINK_DEFINITIONS.map((definition) => ({
            ...definition,
            url: buildTrackingLink(baseProductLink, definition.source),
        }))
    ), [baseProductLink, buildTrackingLink]);

    const bundleOptionLinks = useMemo(() => {
        if (formData.type !== 'bundle' || !Array.isArray(bundleOptions) || bundleOptions.length === 0) {
            return [];
        }

        return bundleOptions.map((option, index) => {
            const title = normalizeBundleOptionLinkText(option.title ?? option.bundle_option_title) || `Tuy chon ${index + 1}`;
            const uid = normalizeBundleOptionLinkText(option.uid ?? option.bundle_option_uid);
            const optionKey = buildBundleOptionLinkKey(option);
            const compactValue = buildCompactBundleOptionLinkValue(option);
            const url = buildBundleOptionUrl(option);

            return {
                id: option.id || uid || `${optionKey}-${index}`,
                title,
                uid,
                optionKey,
                compactValue,
                isInternal: isInternalBundleOption(option),
                url,
                trackingLinks: AD_TRACKING_LINK_DEFINITIONS.map((definition) => ({
                    ...definition,
                    url: buildTrackingLink(url, definition.source),
                })),
            };
        });
    }, [buildBundleOptionUrl, buildTrackingLink, bundleOptions, formData.type]);

    const copyTextToClipboard = useCallback((value, successMessage) => {
        if (!value) {
            showToast({ message: 'Sản phẩm chưa có link hợp lệ để sao chép.', type: 'warning' });
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value)
                .then(() => {
                    showToast({ message: successMessage, type: 'success' });
                })
                .catch(err => {
                    console.error('Copy failed:', err);
                    showToast({ message: 'Lỗi khi sao chép link.', type: 'error' });
                });
            return;
        }

        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast({ message: successMessage, type: 'success' });
        } catch (err) {
            showToast({ message: 'Trình duyệt không hỗ trợ sao chép tự động.', type: 'error' });
        }
        document.body.removeChild(textArea);
    }, [showToast]);

    const handleCopyLink = () => {
        copyTextToClipboard(baseProductLink, 'Đã sao chép link hiển thị của sản phẩm!');
    };

    const handleOpenProductPage = useCallback(() => {
        if (!hasValidProductLink) {
            showToast({ message: 'Sản phẩm chưa có link hợp lệ để mở.', type: 'warning' });
            return;
        }

        window.open(baseProductLink, '_blank', 'noopener,noreferrer');
    }, [baseProductLink, hasValidProductLink, showToast]);

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 8px;
                        height: 8px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: rgba(182, 143, 84, 0.05);
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: rgba(182, 143, 84, 0.2);
                        border-radius: 4px;
                        border: 2px solid transparent;
                        background-clip: content-box;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: rgba(182, 143, 84, 0.4);
                    }
                `}
            </style>

            {/* Premium Header - Sticky */}
            <div className="flex-none sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gold/10 px-6 py-3">
                <div className="max-w-[1800px] mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="size-10 rounded-full border border-stone/10 flex items-center justify-center text-stone hover:text-brick hover:border-brick/20 bg-white shadow-sm transition-all group"
                            title="Hủy & Thoát"
                        >
                            <span className="material-symbols-outlined text-xl group-hover:-translate-x-0.5 transition-transform">west</span>
                        </button>
                        <div className="flex flex-col">
                            <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider leading-none mb-1">
                                {isDuplicate ? 'Nhân bản sản phẩm' : (isEdit ? 'Chỉnh sửa sản phẩm' : 'Tạo sản phẩm mới')}
                            </h1>
                            <div className="flex items-center gap-1 lg:gap-2 mt-1">
                                <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none">
                                    {formData.sku ? `SKU: ${formData.sku}` : 'Cấu hình thông tin sản phẩm và thương mại'}
                                </p>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTempSlug(formData.slug || (formData.name ? formData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') : ''));
                                            setSlugError('');
                                            setShowSlugModal(true);
                                        }}
                                        className="flex items-center gap-1.5 px-2 py-0.5 bg-gold/10 text-gold rounded-full hover:bg-gold/20 transition-all border border-gold/10 group/slug"
                                        title="Quản lý đường dẫn sản phẩm"
                                    >
                                            <span className="material-symbols-outlined text-[14px] group-hover/slug:rotate-12 transition-transform">link</span>
                                            <span className="text-[9px] font-black uppercase tracking-wider">{formData.slug || (formData.name ? 'Tự động tạo...' : 'Thiết lập link')}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenProductPage();
                                            }}
                                            disabled={!hasValidProductLink}
                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-all ${hasValidProductLink ? 'border-primary/10 bg-primary/5 text-primary hover:bg-primary hover:text-white' : 'cursor-not-allowed border-stone/10 bg-stone/5 text-stone/35'}`}
                                            title={hasValidProductLink ? 'Mở trang sản phẩm ở website' : 'Sản phẩm chưa có link hợp lệ để mở'}
                                        >
                                            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                                            <span className="text-[9px] font-black uppercase tracking-wider">
                                                {hasValidProductLink ? 'Mở trang' : 'Chưa có link'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCopyLink();
                                            }}
                                            disabled={!hasValidProductLink}
                                            className={`size-5 flex items-center justify-center rounded-full transition-all group/copy ${hasValidProductLink ? 'bg-stone/5 text-stone/40 hover:bg-gold hover:text-white' : 'cursor-not-allowed bg-stone/5 text-stone/20'}`}
                                            title={hasValidProductLink ? 'Sao chép nhanh link sản phẩm' : 'Sản phẩm chưa có link để sao chép'}
                                        >
                                            <span className="material-symbols-outlined text-[12px] group-hover/copy:scale-110 transition-transform">content_copy</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                    </div>

                    <div className="flex gap-3 w-full md:w-auto">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="flex-1 md:flex-none px-8 py-2.5 bg-white border border-stone/20 text-stone text-[11px] font-bold uppercase tracking-widest hover:bg-stone/5 transition-all rounded-sm"
                        >
                            Hủy
                        </button>
                        <button
                            form="product-form"
                            type="submit"
                            disabled={isSaving}
                            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-primary text-white px-10 py-2.5 rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-umber transition-all disabled:opacity-50 shadow-premium-sm"
                        >
                            {isSaving && <span className="material-symbols-outlined text-sm animate-spin">refresh</span>}
                            {isSaving && saveStatusText ? saveStatusText : (isDuplicate ? 'Lưu nhân bản' : (isEdit ? 'Lưu cập nhật' : 'Tạo ngay'))}
                        </button>
                    </div>
                </div>
            </div>

            {/* Scrollable Form Content */}
            <DndProvider backend={HTML5Backend}>
            <div className="flex-1 overflow-y-auto custom-scrollbar pt-4 pb-12">
                <form id="product-form" onSubmit={handleSubmit} onChangeCapture={markNonImageFormChanged} onInputCapture={markNonImageFormChanged} className="grid grid-cols-1 lg:grid-cols-12 gap-4 max-w-[1800px] mx-auto px-1">
                    <div className="lg:col-span-8 space-y-4">
                        {/* Basic Info */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="shopping_bag" title="Thông tin cơ bản" />

                            <div className="grid grid-cols-1 gap-y-8">
                                <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.45fr)_minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,0.85fr)]">
                                    <div className="min-w-0 self-start">
                                        <Field label={<>Mã sản phẩm (SKU) <span className="text-brick text-[14px] ml-1">*</span></>} className={`group/sku ${parentSkuError ? 'border-brick/50 bg-brick/5' : 'border-gold/20'}`}>
                                            <OverflowPreviewInput
                                                name="sku"
                                                value={formData.sku}
                                                onChange={handleChange}
                                                required
                                                placeholder="GỐM-VH-001"
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-gold font-bold tracking-widest text-[14px]"
                                                mirrorClassName="text-[14px] font-bold tracking-widest text-gold"
                                                popoverInputClassName="font-mono tracking-[0.18em] text-gold"
                                                tooltipLabel="Mã sản phẩm"
                                            />
                                            <button
                                                type="button"
                                                onClick={handleAutoGenerateSKU}
                                                title="Tự động tạo mã thông minh"
                                                className="size-7 flex items-center justify-center bg-stone/5 rounded-full text-stone/40 hover:bg-primary hover:text-white transition-all transform hover:scale-110 shrink-0"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">magic_button</span>
                                            </button>
                                        </Field>
                                        {parentSkuError ? <p className="mt-2 text-[12px] font-semibold text-brick">{parentSkuError}</p> : null}
                                    </div>

                                    <div className="min-w-0 self-start lg:col-span-2 xl:col-span-1">
                                        <Field label={<>Tên sản phẩm <span className="text-brick text-[14px] ml-1">*</span></>}>
                                            <OverflowPreviewInput
                                                name="name"
                                                value={formData.name}
                                                onChange={handleChange}
                                                required
                                                editor="textarea"
                                                rows={3}
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[16px] placeholder:text-stone/20"
                                                mirrorClassName="text-[16px] font-bold text-primary"
                                                popoverInputClassName="min-h-[92px] leading-6"
                                                tooltipLabel="Tên sản phẩm"
                                                placeholder="Nhập tên nghệ thuật của tác phẩm..."
                                            />
                                        </Field>
                                    </div>

                                    {productMeta.parentConfigurable ? (
                                        <div className="sm:col-span-2 lg:col-span-2">
                                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3">
                                                <div>
                                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-800/70">Biến thể con</p>
                                                    <p className="mt-1 text-[13px] font-bold text-amber-950">
                                                        Sản phẩm này đang thuộc nhóm biến thể <span className="font-black">{productMeta.parentConfigurable.name}</span>.
                                                    </p>
                                                </div>
                                                <Link
                                                    to={`/admin/products/edit/${productMeta.parentConfigurable.id}`}
                                                    className="inline-flex items-center gap-2 rounded-sm bg-amber-500 px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-amber-600"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">account_tree</span>
                                                    Mở sản phẩm cha
                                                </Link>
                                            </div>
                                        </div>
                                    ) : null}

                                    <div className="min-w-0 self-start">
                                        <Field label={<>Loại sản phẩm <span className="text-brick text-[14px] ml-1">*</span></>}>
                                            <div className="flex items-center gap-2">
                                                <select
                                                    name="type"
                                                    value={formData.type}
                                                    onChange={handleChange}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                                >
                                                    {Object.entries(TYPE_INFO).map(([key, info]) => (
                                                        <option
                                                            key={key}
                                                            value={key}
                                                            disabled={false}
                                                        >
                                                            {info.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </Field>
                                        {canConvertSimpleProduct ? (
                                            <p className="mt-2 text-[11px] font-semibold text-emerald-700/80">
                                                Chọn "Sản phẩm có biến thể" để mở bảng chuyển đổi an toàn, giữ nguyên tồn kho và đơn hàng cũ trên ID hiện tại.
                                            </p>
                                        ) : null}
                                    </div>

                                    <div className="min-w-0 self-start lg:col-span-2 xl:col-span-1">
                                        <Field label="Danh mục">
                                            <div className="w-full">
                                                <AdminMultiSelect
                                                    options={categories}
                                                    value={formData.category_ids}
                                                    onChange={applySelectedCategoryIds}
                                                    placeholder="Chọn danh mục"
                                                />
                                            </div>
                                        </Field>
                                    </div>

                                    <div className="min-w-0 self-start lg:col-span-2 xl:col-span-1">
                                        <Field label="ĐVT" className="border-primary/20 bg-stone/5">
                                            <div className="flex items-center gap-2 w-full">
                                                <select
                                                    name="inventory_unit_id"
                                                    value={formData.inventory_unit_id || ''}
                                                    onChange={(e) => setFormData((prev) => ({ ...prev, inventory_unit_id: e.target.value }))}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                                >
                                                    <option value="">Chọn ĐVT</option>
                                                    {inventoryUnits.map((unit) => (
                                                        <option key={unit.id} value={unit.id}>{unit.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={openInventoryUnitSorter}
                                                    disabled={inventoryUnits.length === 0}
                                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-white text-primary/70 transition hover:border-primary/35 hover:text-primary disabled:cursor-not-allowed disabled:border-stone/10 disabled:text-stone/25"
                                                    title="Sắp xếp đơn vị tính"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">reorder</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCreateInventoryUnit()}
                                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-white text-primary/70 transition hover:border-primary/35 hover:text-primary"
                                                    title="Thêm đơn vị tính"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">add</span>
                                                </button>
                                            </div>
                                        </Field>
                                    </div>

                                </div>
                            </div>
                        </div>

                        {/* Pricing & Details */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="payments" title="Giá và thông số" />
                            <div className="grid grid-cols-1 gap-y-8">
                                <div className="grid grid-cols-1 gap-4">
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                                        <Field label={expectedCostLabel} className="border-primary/20 bg-stone/5">
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="expected_cost"
                                                    value={formatImportCostInput(formData.expected_cost)}
                                                    onChange={(e) => handlePriceInputChange(e, 'expected_cost')}
                                                    onBlur={() => handleImportCostFieldBlur('expected_cost')}
                                                    inputMode="numeric"
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]"
                                                />
                                                <span className="font-bold text-primary opacity-30 ml-2">₫</span>
                                            </div>
                                        </Field>
                                        <Field label="Giá bán lẻ (VNĐ)" className={`border-brick/30 bg-brick/[0.02] ${formData.price_type === 'sum' ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="price"
                                                    value={formData.price_type === 'sum'
                                                        ? formatNumberOutput(compositeSumPrice)
                                                        : formatNumberOutput(formData.price)}
                                                    onChange={(e) => handlePriceInputChange(e, 'price')}
                                                    required={formData.price_type !== 'sum'}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-brick font-black text-[16px]"
                                                />
                                                <span className="font-bold text-brick opacity-40 ml-2">₫</span>
                                            </div>
                                        </Field>
                                        <Field label={currentCostLabel} className="border-primary/20 bg-stone/10">
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="cost_price"
                                                    value={formatImportCostOutput(formData.cost_price)}
                                                    readOnly
                                                    className="w-full cursor-not-allowed bg-transparent border-none focus:outline-none focus:ring-0 text-primary/70 font-bold text-[15px]"
                                                />
                                                <span className="font-bold text-primary opacity-30 ml-2">₫</span>
                                            </div>
                                        </Field>
                                        <Field label="Khối lượng SP" className="border-primary/20 bg-stone/5">
                                            <div className="flex items-center w-full">
                                                <input
                                                    type="text"
                                                    name="weight"
                                                    value={formData.weight}
                                                    onChange={handleWeightInputChange}
                                                    placeholder="0"
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]"
                                                />
                                                <span className="font-bold text-primary opacity-30 ml-2 italic">gram</span>
                                            </div>
                                        </Field>
                                        <Field label="Nhà cung cấp" className="border-primary/20 bg-stone/5">
                                            <div className="relative w-full" ref={supplierDropdownRef}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSupplierPickerOpen((prev) => !prev)}
                                                    className="flex w-full items-center justify-between gap-2 bg-transparent text-left"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        {selectedSuppliers.length > 0 ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {selectedSuppliers.slice(0, 2).map((supplier) => (
                                                                    <span key={supplier.id} className="inline-flex max-w-full items-center rounded-full bg-primary/10 px-2 py-1 text-[11px] font-black text-primary">
                                                                        <span className="truncate">{supplier.name}</span>
                                                                    </span>
                                                                ))}
                                                                {selectedSuppliers.length > 2 ? (
                                                                    <span className="inline-flex items-center rounded-full bg-gold/15 px-2 py-1 text-[11px] font-black text-gold">
                                                                        +{selectedSuppliers.length - 2}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        ) : (
                                                            <span className="text-primary/45 font-bold text-[14px]">Chọn nhiều nhà cung cấp</span>
                                                        )}
                                                    </div>
                                                    <span className={`material-symbols-outlined text-[18px] text-primary/40 transition-transform ${supplierPickerOpen ? 'rotate-180' : ''}`}>expand_more</span>
                                                </button>

                                                {supplierPickerOpen ? (
                                                    <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-sm border border-primary/20 bg-white shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]">
                                                        <div className="flex items-center justify-between border-b border-primary/10 px-3 py-2">
                                                            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/40">Nhà cung cấp</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setFormData((prev) => ({ ...prev, supplier_ids: [] }))}
                                                                className="text-[10px] font-black uppercase tracking-[0.14em] text-brick hover:underline"
                                                            >
                                                                Xóa hết
                                                            </button>
                                                        </div>
                                                        <div className="max-h-60 overflow-y-auto py-1">
                                                            {suppliers.length === 0 ? (
                                                                <div className="px-3 py-4 text-[12px] text-primary/45">Chưa có nhà cung cấp trong kho.</div>
                                                            ) : suppliers.map((supplier) => {
                                                                const checked = (formData.supplier_ids || []).includes(String(supplier.id));
                                                                return (
                                                                    <label
                                                                        key={supplier.id}
                                                                        className={`flex cursor-pointer items-start gap-3 px-3 py-2 transition ${checked ? 'bg-primary/5' : 'hover:bg-primary/[0.03]'}`}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={checked}
                                                                            onChange={() => toggleSupplierSelection(supplier.id)}
                                                                            className="mt-0.5 size-4 accent-primary"
                                                                        />
                                                                        <div className="min-w-0">
                                                                            <div className={`truncate text-[13px] ${checked ? 'font-black text-primary' : 'font-semibold text-primary/80'}`}>
                                                                                {supplier.name}
                                                                            </div>
                                                                            <div className="truncate text-[11px] text-primary/40">
                                                                                {supplier.code || supplier.phone || 'Nhà cung cấp từ quản lý kho'}
                                                                            </div>
                                                                        </div>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </Field>
                                    </div>
                                    {['grouped', 'bundle'].includes(formData.type) && (
                                        <div className="max-w-[280px]">
                                            <Field label={formData.type === 'bundle' ? "Loại giá bộ / combo" : "Loại giá nhóm"} className="border-gold/30 bg-gold/[0.02]">
                                                <select
                                                    name="price_type"
                                                    value={formData.price_type}
                                                    onChange={handleChange}
                                                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px]"
                                                >
                                                    <option value="fixed">Cố định</option>
                                                    <option value="sum">Tổng giá các thành phần</option>
                                                </select>
                                            </Field>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-stone/5 p-2 rounded-sm border border-stone/10">
                                        <span className="text-[12px] font-bold text-primary uppercase">Bảng thông số kĩ thuật</span>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={copySpecifications}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Sắp chép bảng thông số"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                                Copy
                                            </button>
                                            <button
                                                type="button"
                                                onClick={pasteSpecifications}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Dán bảng thông số"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_paste</span>
                                                Paste
                                            </button>
                                            <button
                                                type="button"
                                                onClick={addSpecRow}
                                                className="size-8 bg-primary text-white flex items-center justify-center rounded-sm hover:bg-gold transition-colors shadow-sm"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">add</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                                        {formData.specifications.map((spec, idx) => (
                                            <div key={idx} className="flex gap-2 items-center group animate-fade-in-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                                                <div className="flex-1 grid grid-cols-2 gap-2 border border-stone/15 rounded-sm p-1.5 bg-white shadow-sm transition-all hover:border-primary/30">
                                                    <input
                                                        placeholder="Nhãn (VD: Kích thước)"
                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-bold text-primary border-r border-stone/10 placeholder:font-normal placeholder:opacity-30 pr-2"
                                                        value={spec.label ?? ''}
                                                        onChange={(e) => updateSpecRow(idx, 'label', e.target.value)}
                                                    />
                                                    <input
                                                        placeholder="Giá trị (VD: 20x30cm)"
                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] text-stone placeholder:opacity-40"
                                                        value={spec.value ?? ''}
                                                        onChange={(e) => updateSpecRow(idx, 'value', e.target.value)}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeSpecRow(idx)}
                                                    className="size-8 bg-brick/5 text-brick rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-brick hover:text-white transition-all shadow-sm shrink-0"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            </div>
                                        ))}
                                        {formData.specifications.length === 0 && (
                                            <div className="py-8 border-2 border-dashed border-stone/10 rounded-sm flex flex-col items-center justify-center text-stone/30">
                                                <span className="material-symbols-outlined text-[32px] mb-1">table_rows</span>
                                                <p className="text-[11px] font-bold uppercase tracking-widest">Chưa có thông số nào</p>
                                                <button type="button" onClick={addSpecRow} className="mt-2 text-[10px] text-primary hover:text-gold font-black uppercase">Thêm ngay</button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Bảng Thông tin bổ sung */}
                                <div className="space-y-3 mt-8">
                                    <div className="flex justify-between items-center bg-stone/5 p-2 rounded-sm border border-stone/10">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined text-primary/40 text-[18px]">library_books</span>
                                            <span className="text-[12px] font-bold text-primary uppercase">Thông tin bổ sung</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={copyAdditionalInfo}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Sao chép thông tin bổ sung"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                                Copy
                                            </button>
                                            <button
                                                type="button"
                                                onClick={pasteAdditionalInfo}
                                                className="h-8 px-2.5 bg-white border border-stone/20 text-stone hover:text-primary hover:border-primary flex items-center gap-1.5 rounded-sm transition-all text-[10px] font-bold uppercase"
                                                title="Dán thông tin bổ sung"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">content_paste</span>
                                                Paste
                                            </button>
                                            <button
                                                type="button"
                                                onClick={addAdditionalInfoRow}
                                                className="size-8 bg-primary text-white flex items-center justify-center rounded-sm hover:bg-gold transition-colors shadow-sm"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">add</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-3 overflow-visible pr-1 pb-24">
                                        {formData.additional_info.map((info, idx) => (
                                            (() => {
                                                const rowId = info.row_id || `additional-info-${idx}`;
                                                const searchValue = blogSearchQuery[rowId] || '';
                                                const searchResults = blogResults[rowId] || [];
                                                const previewText = resolveAdditionalInfoPreviewText(info);
                                                const showNoResults = !info.post_id && searchValue.trim().length >= 2 && !isSearchingBlog[rowId] && searchResults.length === 0;
                                                const hasOpenSearchDropdown = !info.post_id && (searchResults.length > 0 || showNoResults);

                                                return (
                                                    <div key={rowId} className={`relative flex gap-2 items-start group animate-fade-in-up ${hasOpenSearchDropdown ? 'z-[140]' : 'z-0'}`} style={{ animationDelay: `${idx * 0.05}s` }}>
                                                        <div className="flex-1 rounded-sm border border-stone/15 bg-white p-2 shadow-sm transition-all hover:border-primary/30">
                                                            <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.05fr)_minmax(0,1.15fr)]">
                                                                <div className="rounded-sm border border-stone/10 bg-stone/[0.02] px-3 py-2">
                                                                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-stone/35">Nhãn mục</p>
                                                                    <input
                                                                        placeholder="VD: Hướng dẫn lựa chọn"
                                                                        className="mt-1 w-full bg-transparent border-none p-0 text-[13px] font-bold text-primary placeholder:font-normal placeholder:text-stone/30 focus:outline-none focus:ring-0"
                                                                        value={info.title ?? ''}
                                                                        onChange={(e) => updateAdditionalInfoRow(rowId, 'title', e.target.value)}
                                                                    />
                                                                </div>

                                                                <div className="rounded-sm border border-stone/10 bg-stone/[0.02] px-3 py-2">
                                                                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-stone/35">Text hiển thị</p>
                                                                    <input
                                                                        placeholder="Để trống sẽ tự rút gọn tiêu đề bài viết"
                                                                        className="mt-1 w-full bg-transparent border-none p-0 text-[13px] font-bold text-primary placeholder:font-normal placeholder:text-stone/30 focus:outline-none focus:ring-0"
                                                                        value={info.display_text ?? ''}
                                                                        onChange={(e) => updateAdditionalInfoRow(rowId, 'display_text', e.target.value)}
                                                                    />
                                                                    <p className="mt-1 text-[10px] text-stone/45" title={previewText || undefined}>
                                                                        {info.display_text
                                                                            ? 'Frontend sẽ ưu tiên text này.'
                                                                            : previewText
                                                                                ? `Tự động rút gọn: ${previewText}`
                                                                                : 'Chọn bài viết để xem text fallback tự động.'}
                                                                    </p>
                                                                </div>

                                                                <div className="relative rounded-sm border border-stone/10 bg-stone/[0.02] px-3 py-2">
                                                                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-stone/35">Bài viết liên kết</p>
                                                                    {info.post_id ? (
                                                                        <div className="mt-1 flex items-start gap-2">
                                                                            <div className="min-w-0 flex-1">
                                                                                <p className={`truncate text-[12px] font-bold ${info.post_invalid ? 'text-brick' : 'text-gold'}`} title={info.post_title || `Bài viết #${info.post_id}`}>
                                                                                    {info.post_title || `Bài viết #${info.post_id}`}
                                                                                </p>
                                                                                {info.post_invalid ? (
                                                                                    <p className="mt-1 text-[10px] font-semibold text-brick">
                                                                                        Bài viết này không hợp lệ hoặc không thuộc tài khoản hiện tại. Khi lưu, hệ thống sẽ bỏ liên kết này.
                                                                                    </p>
                                                                                ) : null}
                                                                                {previewText ? (
                                                                                    <p className="mt-1 truncate text-[10px] text-stone/45" title={previewText}>
                                                                                        Hiển thị: {previewText}
                                                                                    </p>
                                                                                ) : null}
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => updateAdditionalInfoRow(rowId, 'post_id', '', { post_title: '', post_slug: '', post_invalid: false, post_error: '' })}
                                                                                className="mt-0.5 shrink-0 text-stone/40 transition-colors hover:text-brick"
                                                                                title="Bỏ liên kết bài viết"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[16px]">cancel</span>
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="relative mt-1">
                                                                            <div className="flex items-center gap-2 rounded-sm bg-white px-2.5 py-2 shadow-inner">
                                                                                <span className="material-symbols-outlined text-[16px] text-stone/25">search</span>
                                                                                <input
                                                                                    placeholder="Tìm bài viết trên web..."
                                                                                    className="w-full bg-transparent border-none p-0 text-[12px] text-primary placeholder:text-stone/35 focus:outline-none focus:ring-0"
                                                                                    value={searchValue}
                                                                                    onChange={(e) => {
                                                                                        const q = e.target.value;
                                                                                        setBlogSearchQuery(prev => ({ ...prev, [rowId]: q }));
                                                                                        searchBlogPosts(rowId, q);
                                                                                    }}
                                                                                />
                                                                                {isSearchingBlog[rowId] ? (
                                                                                    <span className="material-symbols-outlined text-[12px] animate-spin text-gold">refresh</span>
                                                                                ) : null}
                                                                            </div>

                                                                            {searchResults.length > 0 ? (
                                                                                <div className="absolute left-0 right-0 top-full z-[100] mt-1 max-h-[220px] overflow-y-auto rounded-sm border border-stone/15 bg-white shadow-xl custom-scrollbar">
                                                                                    {searchResults.map((post) => (
                                                                                        <button
                                                                                            key={post.id}
                                                                                            type="button"
                                                                                            onClick={() => {
                                                                                                updateAdditionalInfoRow(rowId, 'post_id', String(post.id), {
                                                                                                    post_title: post.title || '',
                                                                                                    post_slug: post.slug || '',
                                                                                                    post_invalid: false,
                                                                                                    post_error: '',
                                                                                                });
                                                                                                setBlogSearchQuery(prev => ({ ...prev, [rowId]: '' }));
                                                                                                setBlogResults(prev => ({ ...prev, [rowId]: [] }));
                                                                                            }}
                                                                                            className="block w-full border-b border-stone/5 px-3 py-2 text-left transition-colors last:border-0 hover:bg-gold/5"
                                                                                        >
                                                                                            <p className="text-[11px] font-bold leading-tight text-primary">{post.title}</p>
                                                                                            {post.slug ? (
                                                                                                <p className="mt-0.5 truncate text-[10px] text-stone/40">/{post.slug}</p>
                                                                                            ) : null}
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            ) : null}

                                                                            {showNoResults ? (
                                                                                <div className="absolute left-0 right-0 top-full z-[90] mt-1 rounded-sm border border-stone/15 bg-white px-3 py-2 text-[11px] text-stone/55 shadow-lg">
                                                                                    Không tìm thấy bài viết phù hợp.
                                                                                </div>
                                                                            ) : null}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeAdditionalInfoRow(rowId)}
                                                            className="size-8 bg-brick/5 text-brick rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-brick hover:text-white transition-all shadow-sm shrink-0"
                                                            title="Xóa dòng"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                                        </button>
                                                    </div>
                                                );
                                            })() /*
                                            <div key={idx} className="flex gap-2 items-start group animate-fade-in-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                                                <div className="flex-1 grid grid-cols-2 gap-2 border border-stone/15 rounded-sm p-1.5 bg-white shadow-sm transition-all hover:border-primary/30">
                                                    <input
                                                        placeholder="Tiêu đề mục (VD: Hướng dẫn sử dụng)"
                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[13px] font-bold text-primary border-r border-stone/10 placeholder:font-normal placeholder:opacity-30 pr-2"
                                                        value={info.title ?? ''}
                                                        onChange={(e) => updateAdditionalInfoRow(idx, 'title', e.target.value)}
                                                    />

                                                    Blog Post Selector
                                                    <div className="relative">
                                                        <div className="flex items-center gap-2 px-2 py-0.5 min-h-[28px]">
                                                            {info.post_id ? (
                                                                <div className="flex-1 flex items-center justify-between overflow-hidden">
                                                                    <span className="text-[12px] font-bold text-gold truncate mr-2" title={info.post_title}>
                                                                        {info.post_title}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => updateAdditionalInfoRow(idx, 'post_id', '', { post_title: '' })}
                                                                        className="text-stone/40 hover:text-brick shrink-0"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="flex-1 relative">
                                                                    <input
                                                                        placeholder="Tìm bài viết trên web..."
                                                                        className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-[12px] text-stone italic placeholder:opacity-40"
                                                                        value={blogSearchQuery[idx] || ''}
                                                                        onChange={(e) => {
                                                                            const q = e.target.value;
                                                                            setBlogSearchQuery(prev => ({ ...prev, [idx]: q }));
                                                                            searchBlogPosts(idx, q);
                                                                        }}
                                                                    />
                                                                    {isSearchingBlog[idx] && (
                                                                        <span className="absolute right-0 top-1/2 -translate-y-1/2 material-symbols-outlined text-[12px] animate-spin text-gold">refresh</span>
                                                                    )}

                                                                    {blogResults[idx]?.length > 0 && !info.post_id && (
                                                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone/15 shadow-xl rounded-sm z-[100] max-h-[200px] overflow-y-auto custom-scrollbar">
                                                                            {blogResults[idx].map(post => (
                                                                                <div
                                                                                    key={post.id}
                                                                                    onClick={() => {
                                                                                        updateAdditionalInfoRow(idx, 'post_id', post.id, { post_title: post.title });
                                                                                        setBlogSearchQuery(prev => ({ ...prev, [idx]: '' }));
                                                                                        setBlogResults(prev => ({ ...prev, [idx]: [] }));
                                                                                    }}
                                                                                    className="px-3 py-2 hover:bg-gold/5 cursor-pointer border-b border-stone/5 last:border-0 transition-colors"
                                                                                >
                                                                                    <p className="text-[11px] font-bold text-primary leading-tight">{post.title}</p>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                            <span className="material-symbols-outlined text-[16px] text-stone/20">search</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAdditionalInfoRow(idx)}
                                                    className="size-8 bg-brick/5 text-brick rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-brick hover:text-white transition-all shadow-sm shrink-0"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">close</span>
                                                </button>
                                            */
                                        ))}
                                        {formData.additional_info.length === 0 && (
                                            <div className="py-8 border-2 border-dashed border-stone/10 rounded-sm flex flex-col items-center justify-center text-stone/30">
                                                <span className="material-symbols-outlined text-[32px] mb-1">library_books</span>
                                                <p className="text-[11px] font-bold uppercase tracking-widest">Chưa có thông tin bổ sung</p>
                                                <button type="button" onClick={addAdditionalInfoRow} className="mt-2 text-[10px] text-primary hover:text-gold font-black uppercase">Thêm ngay</button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Variant Management - Only for Configurable Products */}
                        {formData.type === 'configurable' && (
                            <div className="bg-white border border-purple-200 p-5 shadow-premium-sm rounded-sm">
                                <div className="flex justify-between items-center mb-6 border-b border-purple-100 pb-2">
                                    <div className="flex items-center gap-2.5">
                                        <span className="material-symbols-outlined text-purple-600/40 p-1.5 bg-purple-50 rounded-full text-base">account_tree</span>
                                        <h3 className="font-sans text-[15px] font-bold text-purple-900 uppercase tracking-tight">Quản lý biến thể</h3>
                                    </div>
<div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowVariantExpansionGuide(true)}
                                            className="flex items-center gap-1.5 px-3 py-1 bg-teal-500 text-white rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-teal-600 transition-all shadow-sm min-h-[38px]"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">library_add</span>
                                            <div className="flex flex-col items-start leading-[1.1] text-left uppercase"><span>Hướng dẫn</span><span>mở rộng</span></div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => window.open('/admin/attributes', '_blank')}
                                            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-purple-200 text-purple-600 rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm min-h-[38px]"
                                            title="Đi tới trang quản lý thuộc tính"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">display_settings</span>
                                            <div className="flex flex-col items-start leading-[1.1] text-left uppercase"><span>Quản lý</span><span>thuộc tính</span></div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={openVariantQuickUpdateModal}
                                            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-purple-200 text-purple-700 rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm min-h-[38px]"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">tune</span>
                                            <div className="flex flex-col items-start leading-[1.1] text-left uppercase"><span>Cập nhật</span><span>nhanh</span></div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleResetVariants}
                                            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-brick/20 text-brick rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-brick/5 transition-all shadow-sm min-h-[38px]"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                                            <div className="flex flex-col items-start leading-[1.1] text-left uppercase"><span>Xóa hết</span><span>& Reset</span></div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleRefreshAttributes}
                                            disabled={refreshingAttributes}
                                            className="flex items-center gap-1.5 px-3 py-1 bg-white border border-purple-100 text-purple-600 rounded-sm font-bold text-[10px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm disabled:opacity-50 min-h-[38px]"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">sync</span>
                                            <div className="flex flex-col items-start leading-[1.1] text-left uppercase">
                                                <span>{refreshingAttributes ? "Đang làm" : "Làm mới"}</span>
                                                <span>{refreshingAttributes ? "mới..." : "thuộc tính"}</span>
                                            </div>
                                        </button>
                                    </div>
                                </div>

                                {showVariantConfig && (
                                    <div className="mb-8 p-4 bg-purple-50/50 border border-purple-100 rounded-sm space-y-6 animate-fade-in">
                                        {existingVariantSuperAttributes.length > 0 && (
                                            <div className="rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-3">
                                                <div className="flex flex-wrap items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">Biến thể hiện tại đang dùng</p>
                                                        <p className="mt-1 text-[12px] text-emerald-900/70">
                                                            Giữ lại các thuộc tính gốc này nếu bạn chỉ đang mở rộng thêm biến thể mới.
                                                        </p>
                                                    </div>
                                                    {removedExistingVariantAttributes.length > 0 && (
                                                        <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                                                            Đang bỏ chọn: {removedExistingVariantAttributes.map((attribute) => attribute.name).join(', ')}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {existingVariantSuperAttributes.map((attribute) => {
                                                        const isSelected = selectedSuperAttributeIdSet.has(String(attribute.id));
                                                        return (
                                                            <div
                                                                key={`variant-summary-${attribute.id}`}
                                                                className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${isSelected ? 'border-emerald-300 bg-white text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                                                            >
                                                                {attribute.name}: {summarizeVariantSelectionValues(attribute.selected_values)}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-4">
                                                <label className="text-[11px] font-black uppercase tracking-widest text-purple-900/40">1. Chọn thuộc tính tạo biến thể</label>
                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                    {variantReadyAttributes.map((attr) => {
                                                        const isSelected = selectedSuperAttributeIdSet.has(String(attr.id));
                                                        const isExistingVariantAttribute = existingVariantSuperAttributeIdSet.has(String(attr.id));
                                                        const existingAttribute = existingVariantSuperAttributes.find((attribute) => String(attribute.id) === String(attr.id));
                                                        const selectedDraft = selectedSuperAttributes.find((attribute) => String(attribute.id) === String(attr.id));
                                                        const helperText = isExistingVariantAttribute
                                                            ? `Gốc: ${summarizeVariantSelectionValues(existingAttribute?.selected_values)}`
                                                            : (isSelected
                                                                ? `Đã chọn: ${summarizeVariantSelectionValues(selectedDraft?.selected_values)}`
                                                                : `Có ${normalizeVariantSelectionValues((attr.options || []).map((option) => option.value)).length} giá trị sẵn có`);

                                                        return (
                                                            <button
                                                                key={attr.id}
                                                                type="button"
                                                                onClick={() => toggleSuperAttributeSelection(existingAttribute || attr)}
                                                                className={`flex items-start gap-3 p-3 border rounded-sm text-left transition-all ${isSelected ? (isExistingVariantAttribute ? 'bg-emerald-500 border-emerald-500 text-white shadow-md' : 'bg-purple-600 border-purple-600 text-white shadow-md') : (isExistingVariantAttribute ? 'bg-white border-emerald-200 text-emerald-900 hover:border-emerald-400' : 'bg-white border-stone/20 text-stone hover:border-purple-300')}`}
                                                            >
                                                                <span className="material-symbols-outlined mt-0.5 text-[18px]">{isSelected ? 'check_box' : 'check_box_outline_blank'}</span>
                                                                <span className="min-w-0 flex-1">
                                                                    <span className="block text-[12px] font-black">{attr.name}</span>
                                                                    <span className={`mt-1 block text-[10px] ${isSelected ? 'text-white/80' : (isExistingVariantAttribute ? 'text-emerald-900/65' : 'text-stone/55')}`}>
                                                                        {helperText}
                                                                    </span>
                                                                </span>
                                                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${isSelected ? 'bg-white/15 text-white' : (isExistingVariantAttribute ? 'bg-emerald-50 text-emerald-700' : 'bg-purple-50 text-purple-700')}`}>
                                                                    {isExistingVariantAttribute ? 'Gốc' : 'Thêm'}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <label className="text-[11px] font-black uppercase tracking-widest text-purple-900/40">2. Chọn giá trị cho từng thuộc tính</label>
                                                <div className="space-y-3">
                                                    {selectedSuperAttributes.length === 0 ? (
                                                        <p className="text-[12px] italic text-stone/40 py-4">Chưa chọn thuộc tính nào...</p>
                                                    ) : (
                                                        selectedSuperAttributes.map((attr, idx) => (
                                                            <div key={attr.id} className="p-3 bg-white border border-purple-100 rounded-sm shadow-sm">
                                                                <div className="flex justify-between items-center mb-2">
                                                                    <p className="text-[12px] font-black text-purple-900 uppercase m-0">{attr.name}</p>
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const updated = [...selectedSuperAttributes];
                                                                                updated[idx].selected_values = normalizeVariantSelectionValues((attr.options || []).map((option) => option.value));
                                                                                setSelectedSuperAttributes(sanitizeSelectedSuperAttributes(updated));
                                                                            }}
                                                                            className="px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors"
                                                                        >
                                                                            Chọn tất cả
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const updated = [...selectedSuperAttributes];
                                                                                updated[idx].selected_values = [];
                                                                                setSelectedSuperAttributes(sanitizeSelectedSuperAttributes(updated));
                                                                            }}
                                                                            className="px-2 py-0.5 text-[10px] font-bold bg-stone-100 text-stone-600 hover:bg-stone-200 rounded transition-colors"
                                                                        >
                                                                            Bỏ chọn tất cả
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                {(() => {
                                                                    const isExistingVariantAttribute = existingVariantSuperAttributeIdSet.has(String(attr.id));
                                                                    const selectedValues = normalizeVariantSelectionValues(attr.selected_values);
                                                                    const mappedDefaultValue = isExistingVariantAttribute
                                                                        ? ''
                                                                        : (selectedValues.find((value) => value === String(attr.default_value ?? '').trim()) || selectedValues[0] || '');
                                                                    const originalAttribute = existingVariantSuperAttributes.find((attribute) => String(attribute.id) === String(attr.id));

                                                                    return (
                                                                        <>
                                                                            <div className="mb-3">
                                                                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-purple-900/45">
                                                                                    {isExistingVariantAttribute ? 'Thuộc tính gốc' : 'Thuộc tính mới thêm'}
                                                                                </p>
                                                                                <p className="mt-1 text-[11px] text-stone/55">
                                                                                    {isExistingVariantAttribute
                                                                                        ? `Giá trị đang có: ${summarizeVariantSelectionValues(originalAttribute?.selected_values)}`
                                                                                        : (existingVariantSuperAttributes.length > 0
                                                                                            ? 'Chọn một giá trị gốc để dữ liệu của biến thể cũ bám đúng nhánh khi mở rộng.'
                                                                                            : 'Chọn các giá trị sẽ dùng để sinh tổ hợp biến thể.')}
                                                                                </p>
                                                                            </div>

                                                                            {!isExistingVariantAttribute && existingVariantSuperAttributes.length > 0 && (
                                                                                selectedValues.length > 0 ? (
                                                                                    <div className="mb-3 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2">
                                                                                        <label className="block text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
                                                                                            Giá trị gốc để map biến thể cũ
                                                                                        </label>
                                                                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                                                                            <select
                                                                                                value={mappedDefaultValue}
                                                                                                onChange={(event) => {
                                                                                                    const updated = [...selectedSuperAttributes];
                                                                                                    updated[idx].default_value = event.target.value;
                                                                                                    setSelectedSuperAttributes(sanitizeSelectedSuperAttributes(updated));
                                                                                                }}
                                                                                                className="rounded-sm border border-emerald-300 bg-white px-3 py-2 text-[12px] font-bold text-emerald-900 focus:border-emerald-400 focus:outline-none"
                                                                                            >
                                                                                                {selectedValues.map((value) => (
                                                                                                    <option key={`${attr.id}-${value}`} value={value}>{value}</option>
                                                                                                ))}
                                                                                            </select>
                                                                                            <span className="text-[11px] text-emerald-900/75">
                                                                                                Dữ liệu của biến thể cũ sẽ giữ lại ở nhánh này.
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>
                                                                                ) : (
                                                                                    <p className="mb-3 rounded-sm border border-dashed border-stone/20 bg-stone-50 px-3 py-2 text-[11px] text-stone/55">
                                                                                        Chọn ít nhất một giá trị trước, rồi đặt giá trị gốc cho biến thể cũ.
                                                                                    </p>
                                                                                )
                                                                            )}
                                                                        </>
                                                                    );
                                                                })()}

                                                                <div className="flex flex-wrap gap-2">
                                                                    {(attr.options || []).map((opt) => {
                                                                        const optionValue = String(opt.value ?? '').trim();
                                                                        const selectedValues = normalizeVariantSelectionValues(attr.selected_values);
                                                                        const isExistingVariantAttribute = existingVariantSuperAttributeIdSet.has(String(attr.id));
                                                                        const mappedDefaultValue = isExistingVariantAttribute
                                                                            ? ''
                                                                            : (selectedValues.find((value) => value === String(attr.default_value ?? '').trim()) || selectedValues[0] || '');
                                                                        const isValSelected = selectedValues.includes(optionValue);
                                                                        const isMappedFromExisting = !isExistingVariantAttribute && mappedDefaultValue === optionValue;

                                                                        return (
                                                                            <button
                                                                                key={opt.id}
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const updated = [...selectedSuperAttributes];
                                                                                    updated[idx].selected_values = isValSelected
                                                                                        ? selectedValues.filter((value) => value !== optionValue)
                                                                                        : [...selectedValues, optionValue];
                                                                                    setSelectedSuperAttributes(sanitizeSelectedSuperAttributes(updated));
                                                                                }}
                                                                                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold transition-all ${isValSelected
                                                                                    ? (isMappedFromExisting ? 'border-emerald-500 bg-emerald-100 text-emerald-900' : 'border-purple-400 bg-purple-100 text-purple-800')
                                                                                    : 'border-transparent bg-stone/5 text-stone/60 hover:bg-stone/10'}`}
                                                                            >
                                                                                {opt.value}
                                                                                {isMappedFromExisting && (
                                                                                    <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-white">
                                                                                        Gốc
                                                                                    </span>
                                                                                )}
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-purple-100">
                                            <button
                                                type="button"
                                                onClick={handleAddManualVariant}
                                                className="flex items-center gap-2 px-5 py-2 bg-white border border-purple-200 text-purple-700 rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                                                Tạo biến thể trống
                                            </button>
                                            {visibleVariantCount > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={openVariantQuickUpdateModal}
                                                    className="flex items-center gap-2 px-5 py-2 bg-white border border-purple-200 text-purple-700 rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-purple-50 transition-all shadow-sm"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">tune</span>
                                                    Cập nhật nhanh
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={generateVariants}
                                                className="flex items-center gap-2 px-6 py-2 bg-purple-900 text-white rounded-sm font-bold text-[11px] uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95"
                                            >
                                                Tạo tổ hợp biến thể
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {visibleVariantCount > 0 || hiddenVariantCount > 0 ? (
                                    <div className="space-y-3">
                                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-purple-100 bg-purple-50/40 px-4 py-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-purple-700 shadow-sm">
                                                    {visibleVariantCount} biến thể đang bán
                                                </span>
                                                {hiddenVariantCount > 0 && (
                                                    <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 shadow-sm">
                                                        {hiddenVariantCount} mẫu đã ẩn
                                                    </span>
                                                )}
                                                <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${selectedVariantCount > 0 ? 'bg-purple-600 text-white' : 'bg-white text-purple-400'}`}>
                                                    {selectedVariantCount > 0 ? `Đã chọn ${selectedVariantCount}` : 'Chưa chọn biến thể'}
                                                </span>
                                                <span className="text-[11px] text-purple-900/55">
                                                    Ẩn biến thể sẽ giữ nguyên lịch sử đơn hàng và doanh số cũ.
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={handleHideSelectedVariants}
                                                    disabled={selectedVariantCount === 0}
                                                    className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition-all ${selectedVariantCount > 0 ? 'border-amber-200 bg-white text-amber-700 hover:border-amber-500 hover:bg-amber-500 hover:text-white shadow-sm' : 'cursor-not-allowed border-stone/15 bg-white text-stone/30'}`}
                                                    title={selectedVariantCount > 0 ? `Ẩn nhanh ${selectedVariantCount} biến thể đã chọn` : 'Chọn biến thể trước khi ẩn hàng loạt'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">visibility_off</span>
                                                    Ẩn biến thể đã chọn
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleDeleteSelectedVariants}
                                                    disabled={selectedVariantCount === 0}
                                                    className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition-all ${selectedVariantCount > 0 ? 'border-brick/20 bg-white text-brick hover:border-brick hover:bg-brick hover:text-white shadow-sm' : 'cursor-not-allowed border-stone/15 bg-white text-stone/30'}`}
                                                    title={selectedVariantCount > 0 ? `Xóa nhanh ${selectedVariantCount} biến thể đã chọn` : 'Chọn biến thể trước khi xóa hàng loạt'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                                                    Xóa biến thể đã chọn
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleRestoreLastDeletedVariants}
                                                    disabled={!hasRestorableDeletedVariantBatch}
                                                    className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition-all ${hasRestorableDeletedVariantBatch ? 'border-emerald-200 bg-white text-emerald-700 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white shadow-sm' : 'cursor-not-allowed border-stone/15 bg-white text-stone/30'}`}
                                                    title={hasRestorableDeletedVariantBatch ? `Khôi phục ${lastDeletedVariantCount} biến thể vừa xóa` : 'Chưa có batch biến thể nào để khôi phục'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">undo</span>
                                                    Khôi phục vừa xóa
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={openHiddenVariantsModal}
                                                    className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition-all ${hiddenVariantCount > 0 ? 'border-amber-200 bg-white text-amber-700 hover:border-amber-500 hover:bg-amber-50 shadow-sm' : 'border-stone/15 bg-white text-stone/40 hover:border-stone/25 hover:text-stone/60'}`}
                                                    title={hiddenVariantCount > 0 ? `Mở danh sách ${hiddenVariantCount} biến thể đã ẩn` : 'Chưa có biến thể nào bị ẩn'}
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                                                    Mẫu đã ẩn
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                                                        {hiddenVariantCount}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={toggleSelectAllVariants}
                                                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-purple-700 transition-colors hover:text-purple-900"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">
                                                        {isAllVariantsSelected ? 'check_box' : hasPartialVariantSelection ? 'indeterminate_check_box' : 'check_box_outline_blank'}
                                                    </span>
                                                    {isAllVariantsSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto border border-stone/10 rounded-sm custom-scrollbar bg-white">
                                        <table className="w-full text-left border-collapse" style={{ tableLayout: 'fixed' }}>
                                            <thead>
                                                <tr className="bg-stone/5 text-[10px] font-black uppercase tracking-widest text-stone/50 border-b border-stone/10">
                                                    <th className="px-3 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.select }}>
                                                        <button
                                                            type="button"
                                                            onClick={toggleSelectAllVariants}
                                                            className="inline-flex items-center justify-center text-purple-700 transition-colors hover:text-purple-900"
                                                            title={isAllVariantsSelected ? 'Bỏ chọn tất cả biến thể' : 'Chọn tất cả biến thể'}
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">
                                                                {isAllVariantsSelected ? 'check_box' : hasPartialVariantSelection ? 'indeterminate_check_box' : 'check_box_outline_blank'}
                                                            </span>
                                                        </button>
                                                    </th>
                                                    <th className="relative px-3 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.default_variant }}>
                                                        Mặc định
                                                        <div onMouseDown={(e) => handleVariantColumnResize('default_variant', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.image }}>
                                                        Ảnh
                                                        <div onMouseDown={(e) => handleVariantColumnResize('image', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.name }}>
                                                        Tên & Phân loại
                                                        <div onMouseDown={(e) => handleVariantColumnResize('name', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.sku }}>
                                                        Mã SKU
                                                        <div onMouseDown={(e) => handleVariantColumnResize('sku', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.expected_cost }}>
                                                        {expectedCostLabel}
                                                        <div onMouseDown={(e) => handleVariantColumnResize('expected_cost', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.price }}>
                                                        Giá bán (VNĐ)
                                                        <div onMouseDown={(e) => handleVariantColumnResize('price', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.current_cost }}>
                                                        {currentCostLabel}
                                                        <div onMouseDown={(e) => handleVariantColumnResize('current_cost', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.weight }}>
                                                        Khối lượng SP
                                                        <div onMouseDown={(e) => handleVariantColumnResize('weight', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3 border-r border-stone/20 text-center" style={{ width: variantTableWidths.unit }}>
                                                        ĐVT
                                                        <div onMouseDown={(e) => handleVariantColumnResize('unit', e)} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-gold/50 active:bg-gold transition-colors z-10" />
                                                    </th>
                                                    <th className="relative px-4 py-3" style={{ width: variantTableWidths.actions }}></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-stone/20">
                                                {visibleVariantCount === 0 ? (
                                                    <tr>
                                                        <td colSpan={11} className="px-6 py-12">
                                                            <div className="flex flex-col items-center justify-center gap-3 text-center">
                                                                <span className="material-symbols-outlined text-4xl text-amber-300">inventory_2</span>
                                                                <div>
                                                                    <p className="text-[13px] font-bold text-primary">Tất cả biến thể đang được ẩn</p>
                                                                    <p className="mt-1 text-[11px] text-stone/50">
                                                                        Mở danh sách "Mẫu đã ẩn" để khôi phục biến thể cần bán lại.
                                                                    </p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={openHiddenVariantsModal}
                                                                    className="inline-flex items-center gap-2 rounded-sm border border-amber-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-amber-700 transition-all hover:border-amber-500 hover:bg-amber-50"
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                                                                    Mở mẫu đã ẩn
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : visibleVariantEntries.map(({ variant: v, index, selectionKey: variantSelectionKey }) => {
                                                    const parentPrimaryImage = images.find(img => img.is_primary) || images[0];
                                                    const displayImageUrl = v.image_url || parentPrimaryImage?.image_url;
                                                    const isVariantSelected = selectedVariantIdSet.has(variantSelectionKey);
                                                    const isConvertedSourceVariant = Boolean(v.isConvertedSourceVariant);
                                                    const shouldHighlightExistingVariant = Boolean(
                                                        isConvertedSourceVariant
                                                        || (hasLocalDraftVariants && v.isExistingSourceVariant)
                                                    );
                                                    const variantOriginLabel = isConvertedSourceVariant ? 'Biến thể gốc' : 'Biến thể cũ';
                                                    const isImagePickerOpenForRow = variantImagePicker.index === index;
                                                    const hasVariantLibraryImages = variantImageLibraryItems.length > 0;
                                                    const variantRowClassName = shouldHighlightExistingVariant
                                                        ? (isVariantSelected
                                                            ? 'bg-[#fdf0d8] hover:bg-[#fae7c2]'
                                                            : 'bg-[#fff9ef] hover:bg-[#fff1dc]')
                                                        : (isVariantSelected
                                                            ? 'bg-purple-50/50 hover:bg-purple-50/70'
                                                            : 'hover:bg-purple-50/30');

                                                    return (
                                                        <tr key={`${v.id ?? 'variant'}-${index}`} className={`transition-colors ${variantRowClassName}`}>
                                                            <td className="px-3 py-3 border-r border-stone/20 text-center align-top">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleVariantSelection(variantSelectionKey)}
                                                                    className={`inline-flex items-center justify-center transition-colors ${isVariantSelected ? 'text-purple-700' : 'text-stone/35 hover:text-purple-700'}`}
                                                                    title={isVariantSelected ? 'Bỏ chọn biến thể này' : 'Chọn biến thể này'}
                                                                >
                                                                    <span className="material-symbols-outlined text-[20px]">
                                                                        {isVariantSelected ? 'check_box' : 'check_box_outline_blank'}
                                                                    </span>
                                                                </button>
                                                            </td>
                                                            <td className="px-3 py-3 border-r border-stone/20 text-center align-top">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDefaultVariantToggle(index)}
                                                                    className={`mx-auto inline-flex size-9 items-center justify-center rounded-sm border transition-all ${v.is_default ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-stone/15 bg-white text-stone/35 hover:border-emerald-200 hover:text-emerald-700'}`}
                                                                    title={v.is_default ? 'Biến thể mặc định' : 'Đặt làm biến thể mặc định'}
                                                                >
                                                                    <span className="material-symbols-outlined text-[19px]">
                                                                        {v.is_default ? 'verified' : 'radio_button_unchecked'}
                                                                    </span>
                                                                </button>
                                                                {v.is_default ? (
                                                                    <span className="mt-1 block text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700">
                                                                        Mặc định
                                                                    </span>
                                                                ) : null}
                                                            </td>
                                                            <td className="px-3 py-2 border-r border-stone/20 text-center">
                                                                <div
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    data-variant-image-anchor="true"
                                                                    onClick={(e) => handleVariantImageCellClick(index, e.currentTarget)}
                                                                    onDoubleClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        handleVariantImageCellDoubleClick(displayImageUrl, v.label || v.name || `Biến thể ${index + 1}`);
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                                            e.preventDefault();
                                                                            handleVariantImageCellClick(index, e.currentTarget);
                                                                        }
                                                                    }}
                                                                    className={`relative group/vimg mx-auto size-16 bg-white border rounded flex items-center justify-center overflow-hidden shadow-sm transition-all ${isImagePickerOpenForRow ? 'border-purple-300 ring-2 ring-purple-200' : 'border-stone/15'} ${hasVariantLibraryImages ? 'cursor-pointer' : 'cursor-pointer'}`}
                                                                    title={hasVariantLibraryImages ? 'Mở thư viện ảnh của sản phẩm để chọn nhanh' : 'Chọn ảnh cho biến thể'}
                                                                >
                                                                    <input
                                                                        ref={(node) => {
                                                                            if (node) {
                                                                                variantImageInputRefs.current[index] = node;
                                                                            } else {
                                                                                delete variantImageInputRefs.current[index];
                                                                            }
                                                                        }}
                                                                        type="file"
                                                                        className="hidden"
                                                                        accept="image/*"
                                                                        onChange={(e) => handleVariantImageUpload(index, e)}
                                                                    />
                                                                    {displayImageUrl ? (
                                                                        <img
                                                                            src={displayImageUrl || 'https://placehold.co/100'}
                                                                            className="h-full w-full cursor-zoom-in object-cover"
                                                                            alt=""
                                                                        />
                                                                    ) : (
                                                                        <span className="material-symbols-outlined text-stone/20 text-2xl">image</span>
                                                                    )}

                                                                    {/* Variant image actions overlay */}
                                                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 bg-black/60 opacity-0 transition-opacity group-hover/vimg:pointer-events-auto group-hover/vimg:opacity-100">
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                openVariantUploadDialog(index);
                                                                            }}
                                                                            className="text-white hover:text-gold transition-colors"
                                                                            title="Tải ảnh riêng cho biến thể"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[18px]">{v.image_url ? 'upload' : 'add_a_photo'}</span>
                                                                        </button>
                                                                        {v.image_url && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    handleRemoveVariantImage(index);
                                                                                }}
                                                                                className="text-white hover:text-brick transition-colors"
                                                                                title="Bỏ ảnh riêng, dùng ảnh cha"
                                                                            >
                                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    {hasVariantLibraryImages && (
                                                                        <div className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-primary shadow-sm">
                                                                            <span className="material-symbols-outlined text-[10px]">photo_library</span>
                                                                            {variantImageLibraryItems.length}
                                                                        </div>
                                                                    )}

                                                                    {/* Badge if inheriting from parent */}
                                                                    {!v.image_url && parentPrimaryImage && (
                                                                        <div className="absolute bottom-0 right-0 left-0 bg-gold/90 text-white text-[8px] py-0.5 font-bold uppercase tracking-tighter text-center">Kế thừa cha</div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative group/vname">
                                                                    {shouldHighlightExistingVariant ? (
                                                                        <div className="mb-2 flex justify-center">
                                                                            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gold">
                                                                                <span className="inline-block size-1.5 rounded-full bg-gold" />
                                                                                {variantOriginLabel}
                                                                            </span>
                                                                        </div>
                                                                    ) : null}
                                                                    <textarea
                                                                        rows={1}
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white px-2 py-1.5 rounded text-[12px] font-bold text-primary text-center transition-all resize-none overflow-hidden min-h-[32px] custom-scrollbar h-auto"
                                                                        value={v.label ?? ''}
                                                                        onChange={(e) => {
                                                                            handleVariantChange(index, 'label', e.target.value);
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onFocus={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onBlur={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                        }}
                                                                        placeholder="Tên biến thể"
                                                                    />
                                                                    {v.label && v.label.length > 30 && (
                                                                        <div className="absolute invisible group-hover/vname:visible z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[300px] bg-primary text-white text-[11px] p-2.5 rounded shadow-2xl pointer-events-none animate-fade-in border border-white/10">
                                                                            <p className="font-bold border-b border-white/20 pb-1 mb-1 opacity-60 uppercase text-[9px]">Xem đầy đủ tên:</p>
                                                                            {v.label}
                                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-primary"></div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative group/vsku">
                                                                    <textarea
                                                                        rows={1}
                                                                        className={`w-full px-2 py-1.5 rounded text-[12px] font-mono font-bold text-center transition-all resize-none shadow-inner overflow-hidden min-h-[32px] flex items-center justify-center leading-[32px] ${getVariantSkuError(index) ? 'bg-brick/5 border border-brick/40 text-brick focus:border-brick' : 'bg-[#f4f6f8] border border-transparent focus:border-purple-300 focus:bg-white text-stone-600'}`}
                                                                        value={v.sku ?? ''}
                                                                        onChange={(e) => {
                                                                            handleVariantChange(index, 'sku', e.target.value);
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onFocus={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                            e.target.style.height = e.target.scrollHeight + 'px';
                                                                        }}
                                                                        onBlur={(e) => {
                                                                            e.target.style.height = 'auto';
                                                                        }}
                                                                    />
                                                                    {v.sku && v.sku.length > 20 && (
                                                                        <div className="absolute invisible group-hover/vsku:visible z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[250px] bg-gold text-white text-[11px] p-2.5 rounded shadow-2xl pointer-events-none animate-fade-in border border-white/10 translate-y-[-5px]">
                                                                            <p className="font-bold border-b border-white/20 pb-1 mb-1 opacity-80 uppercase text-[9px]">Mã SKU đầy đủ:</p>
                                                                            <span className="font-mono">{v.sku}</span>
                                                                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gold"></div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {getVariantSkuError(index) ? <p className="mt-1 text-[11px] font-semibold text-brick">{getVariantSkuError(index)}</p> : null}
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-primary/50 focus:bg-white pl-2 pr-5 py-2 rounded text-[13px] font-bold text-primary text-center transition-all"
                                                                        value={formatImportCostInput(v.expected_cost)}
                                                                        onChange={(e) => handleVariantChange(index, 'expected_cost', e.target.value)}
                                                                        onBlur={() => handleVariantImportCostBlur(index)}
                                                                        inputMode="numeric"
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-primary/30 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-[#fcf8f0] border border-transparent focus:border-brick/50 focus:bg-white pl-2 pr-5 py-2 rounded text-[13px] font-black text-brick text-center transition-all"
                                                                        value={formatNumberOutput(v.price)}
                                                                        onChange={(e) => handleVariantChange(index, 'price', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-brick/40 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full cursor-not-allowed bg-stone/10 border border-transparent pl-2 pr-5 py-2 rounded text-[13px] font-bold text-primary/60 text-center transition-all"
                                                                        value={formatImportCostOutput(v.current_cost)}
                                                                        readOnly
                                                                    />
                                                                    <span className="absolute right-2 text-[10px] text-primary/30 font-bold">₫</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <div className="relative flex items-center justify-center">
                                                                    <input
                                                                        className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white pl-2 pr-8 py-1 rounded text-[13px] font-bold text-primary text-center"
                                                                        value={v.weight ?? ''}
                                                                        onChange={(e) => handleVariantChange(index, 'weight', e.target.value)}
                                                                    />
                                                                    <span className="absolute right-2 text-[9px] opacity-30 font-bold italic">gram</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 border-r border-stone/20">
                                                                <select
                                                                    className="w-full bg-stone/5 border border-transparent focus:border-purple-300 focus:bg-white px-2 py-2 rounded text-[12px] font-bold text-primary text-center transition-all"
                                                                    value={v.inventory_unit_id || ''}
                                                                    onChange={async (e) => {
                                                                        if (e.target.value === '__create__') {
                                                                            const newUnit = await handleCreateInventoryUnit();
                                                                            if (newUnit) {
                                                                                handleVariantChange(index, 'inventory_unit_id', String(newUnit.id));
                                                                            }
                                                                            return;
                                                                        }
                                                                        handleVariantChange(index, 'inventory_unit_id', e.target.value);
                                                                    }}
                                                                >
                                                                    <option value="">ĐVT</option>
                                                                    {inventoryUnits.map((unit) => (
                                                                        <option key={unit.id} value={unit.id}>{unit.name}</option>
                                                                    ))}
                                                                    <option value="__create__">+ Thêm mới</option>
                                                                </select>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeVariant(index)}
                                                                    className="text-stone/30 hover:text-brick transition-colors"
                                                                >
                                                                    <span className="material-symbols-outlined text-[20px]">delete</span>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-12 bg-stone/5 border-2 border-dashed border-purple-100 rounded-sm">
                                        <span className="material-symbols-outlined text-4xl text-purple-200 mb-3">account_tree</span>
                                        <p className="text-[13px] font-bold text-stone/40 italic">Chưa có biến thể nào được tạo...</p>
                                        <p className="text-[11px] text-stone/30 mt-1">Bấm "Cấu hình biến thể" để bắt đầu</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Grouped Product Management */}
                        {formData.type === 'grouped' && (
                            <div className="bg-white border border-gold/20 p-5 shadow-premium-sm rounded-sm animate-fade-in mb-8">
                                <SectionTitle
                                    icon="group_work"
                                    title="Thiết lập nhóm sản phẩm thành phần"
                                />

                                <div className="mb-6">
                                    <p className="text-[12px] text-stone/60 mb-4 italic">Tìm kiếm và chọn các sản phẩm đơn hoặc biến thể cụ thể để thêm vào bộ sưu tập này.</p>

                                    <div className="relative">
                                        <div className="flex gap-2 mb-4">
                                            <div className="relative flex-1" ref={searchContainerRef}>
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-stone/40 text-[20px] z-10">search</span>
                                                <input
                                                    type="text"
                                                    autoComplete="off"
                                                    placeholder="Tìm theo tên hoặc SKU..."
                                                    value={relatedQuery}
                                                    onChange={(e) => setRelatedQuery(e.target.value)}
                                                    onFocus={() => setShowSearchHistory(true)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            setShowSearchHistory(false);
                                                            addToSearchHistory(relatedQuery);
                                                        }
                                                    }}
                                                    className="w-full pl-10 pr-10 py-2.5 bg-primary/5 border border-primary/10 rounded-sm focus:outline-none focus:border-gold/30 text-[14px] transition-all relative z-0 font-bold"
                                                />
                                                {relatedQuery && (
                                                    <button
                                                        onClick={() => { setRelatedQuery(''); setShowSearchHistory(false); }}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors z-10"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">cancel</span>
                                                    </button>
                                                )}

                                                {showSearchHistory && searchHistory.length > 0 && (
                                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[70] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                                        <div className="flex justify-between items-center px-3 mb-2 border-b border-primary/10 pb-1">
                                                            <span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest">Tìm kiếm gần đây</span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('product_search_history'); }}
                                                                className="text-[10px] text-brick hover:underline font-bold"
                                                            >Xóa tất cả</button>
                                                        </div>
                                                        <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                                            {searchHistory.map((item, idx) => (
                                                                <div
                                                                    key={idx}
                                                                    className="group flex items-center justify-between px-3 py-2 hover:bg-primary/5 cursor-pointer transition-colors"
                                                                    onClick={() => {
                                                                        setRelatedQuery(item);
                                                                        setShowSearchHistory(false);
                                                                        addToSearchHistory(item);
                                                                    }}
                                                                >
                                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                                        <span className="material-symbols-outlined text-[18px] text-primary/30">history</span>
                                                                        <span className="text-[13px] text-primary truncate font-bold">{item}</span>
                                                                    </div>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const updated = searchHistory.filter(h => h !== item);
                                                                            setSearchHistory(updated);
                                                                            localStorage.setItem('product_search_history', JSON.stringify(updated));
                                                                        }}
                                                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5 text-stone/40"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <select
                                                value={relatedCategory}
                                                onChange={(e) => setRelatedCategory(e.target.value)}
                                                className="px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-sm focus:outline-none focus:border-gold/30 text-[14px] font-bold text-primary"
                                            >
                                                <option value="all">Tất cả danh mục</option>
                                                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>

                                        {(relatedQuery.length > 0 || relatedCategory !== 'all') && (
                                            <div className="absolute top-[calc(100%-8px)] left-0 right-0 max-h-[300px] overflow-y-auto bg-white border border-gold/10 shadow-xl rounded-sm z-[60] custom-scrollbar">
                                                {searchingRelated ? (
                                                    <div className="p-8 flex flex-col items-center justify-center text-stone/40">
                                                        <div className="size-6 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-2"></div>
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">Đang tìm...</span>
                                                    </div>
                                                ) : filteredSuggestedProducts.length === 0 ? (
                                                    <div className="p-8 text-center text-stone/40 italic text-[12px]">
                                                        <span className="material-symbols-outlined block text-[24px] mb-1">sentiment_dissatisfied</span>
                                                        Không tìm thấy sản phẩm nào
                                                    </div>
                                                ) : (
                                                    filteredSuggestedProducts.map(p => (
                                                        <div
                                                            key={p.id}
                                                            onClick={() => {
                                                                handleAddGroupItem(p);
                                                                setRelatedQuery('');
                                                                addToSearchHistory(relatedQuery);
                                                            }}
                                                            className="flex items-center gap-3 p-3 hover:bg-gold/5 cursor-pointer border-b border-stone/5 transition-colors group"
                                                        >
                                                            <div className="size-10 rounded border border-stone/10 bg-stone/5 overflow-hidden shrink-0">
                                                                <img
                                                                    src={(p.images?.find(img => img.is_primary) || p.images?.[0])?.image_url || 'https://placehold.co/100'}
                                                                    alt=""
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="text-[13px] font-bold text-primary leading-tight group-hover:text-gold transition-colors">{p.name}</p>
                                                                <p className="text-[10px] font-mono text-gold uppercase">{p.sku}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-[12px] font-black text-brick">{formatNumberOutput(p.price)}₫</p>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="grid grid-cols-12 gap-2 px-3 pb-2 border-b border-stone/5">
                                        <div className="col-span-1 text-[10px] font-black uppercase text-black">Ảnh</div>
                                        <div className="col-span-4 text-[10px] font-black uppercase text-black">Sản phẩm</div>
                                        <div className="col-span-2 text-[10px] font-black uppercase text-black text-center">Số lượng</div>
                                        {formData.type === 'bundle' ? (
                                            <div className="col-span-2 text-[10px] font-black uppercase text-black text-right">Tổng giá</div>
                                        ) : (
                                            <div className="col-span-2 text-[10px] font-black uppercase text-black text-center">Bắt buộc?</div>
                                        )}
                                        <div className="col-span-2 text-[10px] font-black uppercase text-black text-right">Giá gốc</div>
                                        <div className="col-span-1"></div>
                                    </div>

                                    {formData.grouped_items.length === 0 ? (
                                        <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-stone/10 rounded-sm bg-stone/[0.02]">
                                            <span className="material-symbols-outlined text-[48px] text-stone/20 mb-2">inventory_2</span>
                                            <p className="text-[13px] font-bold text-stone/40 uppercase tracking-widest">Chưa có thành phần nào</p>
                                            <p className="text-[11px] text-stone/30 mt-1">Sử dụng thanh tìm kiếm phía trên để thêm sản phẩm</p>
                                        </div>
                                    ) : (
                                        formData.grouped_items.map((item, idx) => (
                                            <div key={item.id} className="grid grid-cols-12 gap-2 p-3 bg-stone/[0.03] rounded-sm group/item items-center border border-transparent hover:border-gold/20 transition-all">
                                                <div className="col-span-1">
                                                    <div className="size-10 rounded border border-stone/10 bg-white overflow-hidden">
                                                        <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                                                    </div>
                                                </div>
                                                <div className="col-span-4 min-w-0">
                                                    <div className="flex items-center gap-1">
                                                        <p className="text-[13px] font-bold text-primary truncate" title={item.name}>{item.name}</p>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(item.name);
                                                                showToast('Đã sao chép tên sản phẩm', 'success');
                                                            }}
                                                            className="opacity-0 group-hover/item:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                                            title="Sao chép tên"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <p className="text-[10px] font-mono text-gold uppercase">{item.sku}</p>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(item.sku);
                                                                showToast('Đã sao chép mã sản phẩm', 'success');
                                                            }}
                                                            className="opacity-0 group-hover/item:opacity-100 p-0.5 text-stone/40 hover:text-gold transition-all"
                                                            title="Sao chép SKU"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="col-span-2 flex justify-center">
                                                    <div className="flex items-center gap-1 bg-white border border-stone/10 rounded-full px-2 py-0.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleGroupItemChange(item.id, 'quantity', Math.max(1, item.quantity - 1))}
                                                            className="material-symbols-outlined text-[16px] text-stone/40 hover:text-brick"
                                                        >remove</button>
                                                        <input
                                                            type="number"
                                                            value={item.quantity}
                                                            onChange={(e) => handleGroupItemChange(item.id, 'quantity', parseInt(e.target.value) || 1)}
                                                            className="w-8 text-center bg-transparent border-none p-0 text-[12px] font-black text-primary focus:ring-0"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => handleGroupItemChange(item.id, 'quantity', item.quantity + 1)}
                                                            className="material-symbols-outlined text-[16px] text-stone/40 hover:text-primary"
                                                        >add</button>
                                                    </div>
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    {formData.type === 'bundle' ? (
                                                        <p className="text-[12px] font-black text-brick">{formatNumberOutput(item.price * item.quantity)}₫</p>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleGroupItemChange(item.id, 'is_required', !item.is_required)}
                                                            className={`size-6 mx-auto rounded-full flex items-center justify-center transition-all ${item.is_required ? 'bg-primary text-white' : 'bg-stone/10 text-stone/40 hover:bg-stone/20'}`}
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">{item.is_required ? 'check' : 'close'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    <p className="text-[12px] font-black text-black">{formatNumberOutput(item.price)}₫</p>
                                                </div>
                                                <div className="col-span-1 flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveGroupItem(item.id)}
                                                        className="size-8 rounded-full flex items-center justify-center text-stone/20 hover:text-brick hover:bg-brick/5 opacity-0 group-hover/item:opacity-100 transition-all"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Bundle Product Management */}
                        {formData.type === 'bundle' && (
                            <div className="bg-white border border-gold/20 p-6 shadow-premium-sm rounded-sm animate-fade-in mb-8">
                                <div className="flex justify-between items-center mb-5 pb-3 border-b border-gold/10">
                                    <div className="flex items-center gap-2.5">
                                        <span className="material-symbols-outlined text-primary/40 p-1.5 bg-stone/5 rounded-full text-base">inventory_2</span>
                                        <h3 className="font-sans text-[15px] font-bold text-primary uppercase tracking-tight">Cấu hình tùy chọn Bộ / Combo</h3>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleRefreshBundlePrices}
                                            disabled={isRefreshingPrices || bundleOptions.length === 0}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-sm transition-all text-[11px] font-bold uppercase tracking-widest ${isRefreshingPrices ? 'bg-stone/10 text-stone/40' : 'bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20'}`}
                                            title="Lấy giá mới nhất từ sản phẩm gốc"
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${isRefreshingPrices ? 'animate-spin' : ''}`}>refresh</span>
                                            {isRefreshingPrices ? 'Đang làm mới...' : 'Làm mới giá'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowBundleOptionSorter(true)}
                                            disabled={bundleOptions.length < 2}
                                            className="flex items-center gap-2 rounded-sm border border-primary/15 bg-primary/[0.04] px-3 py-1.5 text-[0px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary/[0.08] disabled:cursor-not-allowed disabled:border-stone/10 disabled:bg-stone/5 disabled:text-stone/35"
                                            title="Mở bảng sắp xếp nhanh cho toàn bộ tùy chọn bundle"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">view_list</span>
                                            <span className="text-[11px] font-black uppercase tracking-widest">Sắp xếp tùy chọn</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleAddBundleOption}
                                            className="flex items-center gap-2 bg-gold/10 hover:bg-gold/20 text-gold px-3 py-1.5 rounded-sm transition-all text-[11px] font-black uppercase tracking-widest"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">add_circle</span>
                                            Thêm Tùy chọn mới
                                        </button>
                                    </div>
                                </div>

                                {/* Dynamic Bundle Header/Title */}
                                <div className="mb-4 p-4 bg-primary/[0.02] border border-primary/5 rounded-sm">
                                    <Field label="Tiêu đề hiển thị cho vùng chọn bộ (Frontend)" icon="title">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                name="bundle_title"
                                                value={formData.bundle_title}
                                                onChange={handleChange}
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[14px] placeholder:text-stone/20"
                                                placeholder="VD: Chọn cấu hình theo ban thờ, Chọn kích thước..."
                                            />
                                            {formData.bundle_title && (
                                                <span className="material-symbols-outlined text-green-500 text-[18px]">verified</span>
                                            )}
                                        </div>
                                    </Field>
                                    <p className="text-[10px] text-stone/40 mt-1.5 ml-1 italic">Văn bản này sẽ hiển thị ngay phía trên các nút chọn cấu hình ngoài trang chủ. Nếu để trống, tiêu đề sẽ tự động được ẩn.</p>
                                </div>

                                <div className="space-y-4">
                                    {bundleOptions.length === 0 ? (
                                        <div className="py-20 flex flex-col items-center justify-center border-2 border-dashed border-gold/10 bg-gold/[0.02] rounded-sm">
                                            <span className="material-symbols-outlined text-[64px] text-gold/20 mb-4 font-thin">grid_view</span>
                                            <p className="text-[14px] font-bold text-gold/40 uppercase tracking-[0.2em] mb-2">Bắt đầu tạo bộ combo</p>
                                            <p className="text-[11px] text-stone/40 italic max-w-sm text-center px-8">Nhấn nút "Thêm Tùy chọn mới" để bắt đầu nhóm các sản phẩm thành từng phần của bộ.</p>
                                        </div>
                                    ) : (
                                        bundleOptions.map((option, optIdx) => (
                                            <div
                                                key={option.id}
                                                ref={(node) => registerBundleOptionCardRef(option.id, node)}
                                                className={`rounded-sm border shadow-sm ${isInternalBundleOption(option) ? 'border-amber-300 bg-amber-50/45' : 'border-gold/15 bg-[#fcfaf7]/30'} ${(showBundleSearch === option.id || bundleOptionVideoPicker === option.id || bundleOptionImagePicker.optionId === option.id) ? 'relative z-[140]' : 'relative z-10'}`}
                                            >
                                                <div className={`${isInternalBundleOption(option) ? 'bg-amber-100/70 border-amber-200' : 'bg-[#f2eddf]/40 border-gold/10'} px-5 py-3 flex items-center gap-4 border-b rounded-t-sm`}>
                                                     <div
                                                         className="size-8 rounded-full bg-gold/10 flex items-center justify-center shrink-0 cursor-pointer hover:bg-gold/20 hover:scale-105 transition-all text-gold flex-col"
                                                         onClick={() => toggleBundleOptionExpanded(option.id)}
                                                         title={expandedBundleOptions[option.id] ? "Thu gọn danh sách" : "Mở rộng danh sách"}
                                                     >
                                                        <span className="text-[13px] font-black text-gold">{optIdx + 1}</span>
                                                     </div>

                                                     <div className="flex min-w-0 flex-1 items-center gap-4">
                                                        <div className="min-w-0 flex-1">
                                                            <input
                                                                ref={(node) => registerBundleOptionTitleInputRef(option.id, node)}
                                                                type="text"
                                                                value={option.title ?? ''}
                                                                onChange={(e) => handleUpdateOptionTitle(option.id, e.target.value)}
                                                                className="w-full bg-transparent border-none p-0 text-[15px] font-black text-primary focus:ring-0"
                                                                placeholder="Nhập tên tùy chọn..."
                                                            />
                                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                                                                <span className="inline-flex items-center rounded-full border border-gold/10 bg-white px-2.5 py-1 font-black text-primary shadow-sm">
                                                                    {Array.isArray(option?.items) ? option.items.length : 0} SP
                                                                </span>
                                                                <span className="inline-flex items-center rounded-full border border-brick/10 bg-brick/[0.08] px-2.5 py-1 font-black text-brick shadow-sm">
                                                                    {'T\u1ed5ng ti\u1ec1n: '}{formatNumberOutput(calculateBundleOptionSubtotal(option))}{"\u20ab"}
                                                                </span>
                                                                {isInternalBundleOption(option) && (
                                                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 font-black text-amber-800 shadow-sm">
                                                                        <span className="material-symbols-outlined text-[13px]">lock</span>
                                                                        {'N\u1ed9i b\u1ed9'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <BundleOptionPostSelector
                                                            option={option}
                                                            blogSearchQuery={blogSearchQuery}
                                                            setBlogSearchQuery={setBlogSearchQuery}
                                                            isSearchingBlog={isSearchingBlog}
                                                            blogResults={blogResults}
                                                            searchBlogPosts={searchBlogPosts}
                                                            onSelectPost={handleSelectBundleOptionPost}
                                                            onClearPost={handleClearBundleOptionPost}
                                                        />
                                                     </div>
                                                     <div className="flex shrink-0 items-center gap-3">
                                                         <div className="relative">
                                                             <input
                                                                 type="file"
                                                                 id={`bundle-option-image-${option.id}`}
                                                                 className="hidden"
                                                                 accept="image/*"
                                                                 onChange={(e) => handleUploadBundleOptionImageSafe(option.id, e)}
                                                             />
                                                             {option.image_url ? (
                                                                 <div
                                                                     role="button"
                                                                     tabIndex={0}
                                                                     onClick={(e) => openBundleOptionImagePicker(option.id, e.currentTarget)}
                                                                     onKeyDown={(e) => {
                                                                         if (e.key === 'Enter' || e.key === ' ') {
                                                                             e.preventDefault();
                                                                             openBundleOptionImagePicker(option.id, e.currentTarget);
                                                                         }
                                                                     }}
                                                                     className="relative group/optimg size-10 cursor-pointer rounded-sm border border-gold/20 overflow-hidden shadow-sm"
                                                                     title="Chọn ảnh từ gallery sản phẩm"
                                                                 >
                                                                     <img src={option.image_url} alt="" className="size-full object-cover" />
                                                                     <button
                                                                        type="button"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleRemoveBundleOptionImage(option.id);
                                                                        }}
                                                                        className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover/optimg:opacity-100 transition-opacity"
                                                                     >
                                                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                                                     </button>
                                                                 </div>
                                                             ) : (
                                                                 <button
                                                                     type="button"
                                                                     onClick={(e) => openBundleOptionImagePicker(option.id, e.currentTarget)}
                                                                     className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-sm bg-gold/10 text-gold transition-all hover:bg-gold/20"
                                                                     title="Thêm ảnh tùy chọn"
                                                                 >
                                                                     <span className="material-symbols-outlined text-[20px]">add_a_photo</span>
                                                                 </button>
                                                             )}
                                                         </div>
                                                         <div className="relative">
                                                             <button
                                                                type="button"
                                                                onClick={() => setBundleOptionVideoPicker((prev) => (prev === option.id ? null : option.id))}
                                                                className={`inline-flex h-10 w-10 items-center justify-center rounded-sm text-[0px] transition-all ${option.video_url ? 'bg-red-600 text-white shadow-sm' : 'bg-red-600/5 text-red-600 hover:bg-red-600/10'}`}
                                                                title={getBundleOptionVideoLabel(option)}
                                                                aria-label="Chọn video cho tùy chọn"
                                                             >
                                                                <span className="material-symbols-outlined text-[18px]">smart_display</span>
                                                                Chọn video
                                                             </button>
                                                             {bundleOptionVideoPicker === option.id && (
                                                                <div className="absolute right-0 top-full z-[120] mt-2 w-72 rounded-sm border border-gold/20 bg-white p-2 shadow-premium">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleChangeBundleOptionVideo(option.id, '', '')}
                                                                        className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-[12px] font-bold transition hover:bg-gold/10 ${!option.video_url ? 'text-gold' : 'text-primary'}`}
                                                                    >
                                                                        <span>Dùng video bundle cha</span>
                                                                        {!option.video_url && <span className="material-symbols-outlined text-[16px]">check</span>}
                                                                    </button>
                                                                    {normalizeProductVideoItems(formData.video_urls, formData.video_url).map((video) => (
                                                                        <button
                                                                            key={video.url}
                                                                            type="button"
                                                                            onClick={() => handleChangeBundleOptionVideo(option.id, 'parent', video.url)}
                                                                            className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-[12px] font-bold transition hover:bg-red-600/5 ${option.video_url === video.url ? 'text-red-600' : 'text-primary'}`}
                                                                        >
                                                                            <span className="truncate">{video.title}</span>
                                                                            {option.video_url === video.url && <span className="material-symbols-outlined text-[16px]">check</span>}
                                                                        </button>
                                                                    ))}
                                                                    <div className="mt-2 border-t border-gold/10 pt-2">
                                                                        <input
                                                                            value={option.video_source === 'custom' ? (option.video_url || '') : ''}
                                                                            onChange={(event) => handleUpdateBundleOptionCustomVideo(option.id, event.target.value)}
                                                                            placeholder="Nhập link video riêng"
                                                                            className="w-full rounded-sm border border-gold/20 px-3 py-2 text-[12px] font-bold text-primary outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/10"
                                                                        />
                                                                    </div>
                                                                </div>
                                                             )}
                                                         </div>
                                                         <button
                                                            type="button"
                                                            onClick={() => openBundleItemQuickSorter(option.id)}
                                                            disabled={(option.items || []).length === 0}
                                                            aria-label={bundleItemQuickSorter.optionId === option.id ? 'Đang mở sắp xếp nhanh' : 'Sắp xếp nhanh'}
                                                            className={`inline-flex h-10 w-10 items-center justify-center rounded-sm text-[0px] transition-all ${bundleItemQuickSorter.optionId === option.id ? 'bg-primary text-white shadow-premium' : 'bg-primary/5 text-primary hover:bg-primary/10'} disabled:cursor-not-allowed disabled:bg-stone/5 disabled:text-stone/35`}
                                                            title="Sáº¯p xáº¿p nhanh toÃ n bá»™ sáº£n pháº©m trong tÃ¹y chá»n"
                                                         >
                                                            <span className="material-symbols-outlined text-[18px]">format_list_numbered</span>
                                                            {bundleItemQuickSorter.optionId === option.id ? 'Äang má»Ÿ' : 'Sáº¯p xáº¿p nhanh'}
                                                         </button>
                                                         <button
                                                            type="button"
                                                            onClick={() => handleCopyBundleOption(option.id)}
                                                            aria-label="Copy tùy chọn"
                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-sm bg-primary/5 text-[0px] text-primary transition-all hover:bg-primary/10"
                                                            title="Copy tùy chọn"
                                                         >
                                                            <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                                            Copy tùy chọn
                                                         </button>
                                                         <button
                                                            type="button"
                                                            onClick={() => setShowBundleSearch(showBundleSearch === option.id ? null : option.id)}
                                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-black uppercase transition-all ${showBundleSearch === option.id ? 'bg-primary text-white' : 'bg-gold/10 text-gold hover:bg-gold/20'}`}
                                                         >
                                                            <span className="material-symbols-outlined text-[16px]">{showBundleSearch === option.id ? 'close' : 'add'}</span>
                                                            {showBundleSearch === option.id ? 'Đóng tìm kiếm' : 'Thêm sản phẩm'}
                                                         </button>
                                                         <button
                                                            type="button"
                                                            onClick={() => handleRemoveBundleOption(option.id)}
                                                            className="text-stone/20 hover:text-brick transition-all"
                                                         >
                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                         </button>
                                                     </div>
                                                </div>

                                                <div className={`${isInternalBundleOption(option) ? 'border-amber-200 bg-amber-50/70' : 'border-gold/10 bg-white'} flex flex-wrap items-center gap-2 border-b px-5 py-2`}>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-stone/45">
                                                        {'Tr\u1ea1ng th\u00e1i t\u00f9y ch\u1ecdn'}
                                                    </span>
                                                    <div className="inline-flex overflow-hidden rounded-sm border border-stone/15 bg-white shadow-sm">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateBundleOptionStatus(option.id, BUNDLE_OPTION_STATUS_VISIBLE)}
                                                            className={`inline-flex h-8 items-center gap-1.5 px-3 text-[10px] font-black uppercase transition ${!isInternalBundleOption(option) ? 'bg-emerald-600 text-white' : 'text-stone/55 hover:bg-emerald-50 hover:text-emerald-700'}`}
                                                            title="Hien thi ngoai website"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">visibility</span>
                                                            {'Hi\u1ec3n th\u1ecb website'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateBundleOptionStatus(option.id, BUNDLE_OPTION_STATUS_INTERNAL)}
                                                            className={`inline-flex h-8 items-center gap-1.5 border-l border-stone/10 px-3 text-[10px] font-black uppercase transition ${isInternalBundleOption(option) ? 'bg-amber-600 text-white' : 'text-stone/55 hover:bg-amber-50 hover:text-amber-700'}`}
                                                            title="Chi dung noi bo admin"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">lock</span>
                                                            {'N\u1ed9i b\u1ed9'}
                                                        </button>
                                                    </div>
                                                </div>

                                                {showBundleSearch === option.id && (
                                                    <div className="px-5 py-4 bg-white border-b border-gold/10">
                                                        <div className="relative">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-stone/30 text-[18px]">search</span>
                                                            <input
                                                                type="text"
                                                                placeholder="Tìm sản phẩm..."
                                                                className="w-full pl-9 pr-4 py-2 bg-stone/[0.02] border border-stone/10 rounded text-[13px] font-bold"
                                                                value={bundleQuery}
                                                                onChange={(e) => setBundleQuery(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        fetchBundleItems();
                                                                    }
                                                                }}
                                                                autoFocus
                                                            />
                                                            {bundleQuery.length > 0 && (
                                                                <div className="absolute top-full left-0 right-0 mt-1 max-h-[200px] overflow-y-auto bg-white border border-gold/15 shadow-xl rounded-sm z-[75] custom-scrollbar">
                                                                    {searchingBundle ? (
                                                                        <div className="p-6 flex flex-col items-center justify-center text-stone/40">
                                                                            <div className="size-5 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-2"></div>
                                                                            <span className="text-[9px] font-bold uppercase tracking-widest">Đang tìm...</span>
                                                                        </div>
                                                                    ) : suggestedBundleProducts.length === 0 ? (
                                                                        <div className="p-6 text-center text-stone/30 italic text-[11px]">Không tìm thấy sản phẩm</div>
                                                                    ) : (
                                                                        suggestedBundleProducts.map(p => (
                                                                            <div key={p.id} onClick={() => handleAddItemToOption(option.id, p)} className="flex items-center gap-3 p-2 hover:bg-gold/5 cursor-pointer border-b border-stone/5 group transition-colors">
                                                                                <img src={(p.images?.find(i => i.is_primary) || p.images?.[0])?.image_url || 'https://placehold.co/100'} alt="" className="size-8 object-cover rounded shadow-sm border border-stone/5" />
                                                                                <div className="flex-1">
                                                                                    <p className="text-[12px] font-bold text-primary truncate leading-tight group-hover:text-gold transition-colors">{p.name}</p>
                                                                                    <p className="text-[10px] font-mono text-gold uppercase">{p.sku}</p>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <p className="text-[11px] font-black text-brick">{formatNumberOutput(p.price)}₫</p>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            navigator.clipboard.writeText(p.sku);
                                                                                            showToast('Đã sao chép mã SP', 'success');
                                                                                        }}
                                                                                        className="opacity-0 group-hover:opacity-100 p-1 text-stone/40 hover:text-gold transition-all"
                                                                                        title="Sao chép mã"
                                                                                    >
                                                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {expandedBundleOptions[option.id] && (
                                                 <div className="bg-white">
                                                    {option.items.length > 0 && (
                                                        <table className="w-full text-left text-[12px]">
                                                            <thead>
                                                                <tr className="bg-[#f2eddf]/20 text-black border-b border-gold/10">
                                                                    <th className="pl-5 py-2.5 w-16 text-center uppercase font-black tracking-widest text-[10px] border-r border-gold/10">
                                                                        {isSortingBundle[option.id] ? 'Vị trí' : 'Default'}
                                                                    </th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] border-r border-gold/10">Sản phẩm</th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] border-r border-gold/10">Biến thể</th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] text-center border-r border-gold/10">Giá bán</th>
                                                                    <th className="px-3 py-2.5 uppercase font-black tracking-widest text-[10px] text-center border-r border-gold/10">Số lượng</th>
                                                                    <th className="px-3 py-2 w-12"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {option.items.map((item, idx) => (
                                                                    <DraggableBundleItem
                                                                        key={item.entry_id || item.id}
                                                                        index={idx}
                                                                        optionId={option.id}
                                                                        item={item}
                                                                        moveBundleItem={moveBundleItem}
                                                                        handleSetDefaultInOption={handleSetDefaultInOption}
                                                                        handleUpdateBundleItemVariant={handleUpdateBundleItemVariant}
                                                                        bundleItemVariants={bundleItemVariants}
                                                                        handleUpdateBundleItemQty={handleUpdateBundleItemQty}
                                                                        handleRemoveItemFromOption={handleRemoveItemFromOption}
                                                                        formatNumberOutput={formatNumberOutput}
                                                                        isSortingMode={isSortingBundle[option.id]}
                                                                    />
                                                                ))}
                                                            </tbody>
                                                            <tfoot>
                                                                <tr className="border-t border-gold/10 bg-[#fcfaf7]">
                                                                    <td colSpan={4} className="px-5 py-3 text-right text-[11px] font-black uppercase tracking-[0.14em] text-primary/65">
                                                                        {'T\u1ed5ng ti\u1ec1n t\u00f9y ch\u1ecdn'}
                                                                    </td>
                                                                    <td colSpan={2} className="px-5 py-3 text-right text-[13px] font-black text-brick">
                                                                        {formatNumberOutput(calculateBundleOptionSubtotal(option))}{"\u20ab"}
                                                                    </td>
                                                                </tr>
                                                            </tfoot>
                                                        </table>
                                                    )}
                                                </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Images Management */}
                        <div className="bg-white border border-gold/10 p-4 shadow-premium-sm rounded-sm" data-product-image-section="true">
                            <div className="flex justify-between items-center mb-4 border-b border-gold/10 pb-2">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary/40 p-2 bg-stone/5 rounded-full text-lg">photo_library</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary italic uppercase tracking-tight">Thư viện hình ảnh</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedImages.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={handleDeleteSelectedImages}
                                            className="flex items-center gap-2 bg-brick text-white px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-widest hover:bg-umber transition-all shadow-premium-sm"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">delete</span>
                                            Xoá {selectedImages.length} ảnh
                                        </button>
                                    )}
                                    <label className="cursor-pointer bg-primary text-white px-4 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-widest hover:bg-gold transition-all shadow-premium-sm flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[16px]">add_photo_alternate</span>
                                        Tải ảnh lên
                                        <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                                    </label>
                                </div>
                            </div>

                            {/* Image Grid */}
                            <div
                                className="flex flex-nowrap overflow-x-auto gap-3 min-h-[140px] p-3 bg-stone/5 border-2 border-dashed border-gold/10 rounded-sm items-start custom-scrollbar"
                                onMouseDown={(e) => {
                                    if (e.target.closest('.image-item-card') || e.target.closest('button') || e.target.closest('input')) return;
                                    setSelectedImages([]);
                                    setIsDragSelecting(true);
                                }}
                            >
                                {images.map((img, index) => (
                                    <DraggableImage
                                        key={img.id}
                                        img={img}
                                        index={index}
                                        moveImage={moveImage}
                                        handleSetPrimary={handleSetPrimary}
                                        handleDeleteImage={handleDeleteImage}
                                        isSelected={selectedImages.includes(img.id)}
                                        toggleSelectImage={toggleSelectImage}
                                        isDragSelecting={isDragSelecting}
                                        handlePreviewImage={openImageLightbox}
                                    />
                                ))}
                                {images.length === 0 && (
                                    <div className="col-span-full flex flex-col items-center justify-center py-12 text-stone/30">
                                        <span className="material-symbols-outlined text-5xl mb-2">collections</span>
                                        <p className="font-bold italic text-sm">Chưa có hình ảnh nào cho tác phẩm này</p>
                                    </div>
                                )}
                            </div>

                            {/* YouTube Video List */}
                            <div className="mb-6 px-1 mt-6">
                                <Field label="Danh sách video YouTube" className="border-red-100 bg-red-50/10">
                                    <div className="space-y-3">
                                        {normalizeProductVideoDraftItems(formData.video_urls, formData.video_url).map((video, videoIndex) => (
                                            <div key={`product-video-${videoIndex}`} className="grid gap-2 md:grid-cols-[minmax(160px,0.45fr)_minmax(260px,1fr)_auto]">
                                                <input
                                                    value={video.title || ''}
                                                    onChange={(event) => handleUpdateParentVideo(videoIndex, 'title', event.target.value)}
                                                    onKeyDown={(event) => handleParentVideoTitleKeyDown(event, videoIndex)}
                                                    placeholder="Tên video"
                                                    className="w-full rounded-sm border border-gold/15 bg-white px-3 py-2 text-[13px] font-bold text-primary outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/10"
                                                />
                                                <input
                                                    value={video.url || ''}
                                                    onChange={(event) => handleUpdateParentVideo(videoIndex, 'url', event.target.value)}
                                                    placeholder="Link video"
                                                    className="w-full rounded-sm border border-gold/15 bg-white px-3 py-2 text-[13px] font-bold text-primary outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/10"
                                                />
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveParentVideo(videoIndex, -1)}
                                                        disabled={videoIndex === 0}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-stone/5 text-stone transition hover:bg-gold/10 hover:text-gold disabled:cursor-not-allowed disabled:opacity-35"
                                                        title="Đưa lên"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveParentVideo(videoIndex, 1)}
                                                        disabled={videoIndex === normalizeProductVideoDraftItems(formData.video_urls, formData.video_url).length - 1}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-stone/5 text-stone transition hover:bg-gold/10 hover:text-gold disabled:cursor-not-allowed disabled:opacity-35"
                                                        title="Đưa xuống"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveParentVideo(videoIndex)}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-sm bg-brick/5 text-brick transition hover:bg-brick hover:text-white"
                                                        title="Xóa video"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}

                                        {normalizeProductVideoDraftItems(formData.video_urls, formData.video_url).length === 0 && (
                                            <div className="rounded-sm border border-dashed border-gold/20 bg-white/60 px-4 py-5 text-center text-[12px] font-bold text-stone/45">
                                                Chưa có video cho sản phẩm này.
                                            </div>
                                        )}

                                        <button
                                            type="button"
                                            onClick={handleAddParentVideo}
                                            className="inline-flex items-center gap-2 rounded-sm bg-red-600 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-brick"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">add</span>
                                            Thêm video
                                        </button>
                                    </div>
                                </Field>
                            </div>
                        </div>

                        {/* Description */}
                        <div className="bg-white border border-gold/10 shadow-premium-sm rounded-sm overflow-hidden">
                            <div className="flex flex-col gap-3 xl:flex-row xl:justify-between xl:items-center p-4 border-b border-gold/10">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-primary/40 p-2 bg-stone/5 rounded-full text-lg">description</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary italic uppercase tracking-tight">Mô tả sản phẩm</h3>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleAIRewrite}
                                        disabled={aiRewriting || !aiAvailable}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiRewriting ? 'opacity-50 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                        title={!aiAvailable ? disabledReason : 'Viết lại mô tả bằng AI'}
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${aiRewriting ? 'animate-pulse' : ''}`}>edit_document</span>
                                        {aiRewriting ? 'AI đang viết lại...' : 'AI Viết lại'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAIGenerate}
                                        disabled={aiGenerating || !aiAvailable}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiGenerating ? 'opacity-50 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                        title={!aiAvailable ? disabledReason : 'Tạo mô tả mới bằng AI'}
                                    >
                                        <span className={`material-symbols-outlined text-[16px] ${aiGenerating ? 'animate-spin' : ''}`}>auto_awesome</span>
                                        {aiGenerating ? 'AI đang tạo...' : 'AI Viết mới'}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleOpenDescriptionImageLibrary}
                                        disabled={descriptionImageLibraryItems.length === 0}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-gold/20 text-gold font-bold text-[11px] uppercase tracking-widest transition-all hover:bg-gold/5 active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed"
                                        title="Chèn ảnh có sẵn trong thư viện sản phẩm"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">photo_library</span>
                                        Chèn ảnh
                                    </button>

                                    <div className="h-6 w-px bg-gold/10 mx-1"></div>

                                    <button
                                        type="button"
                                        onClick={handleCopyContent}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-gold/20 text-gold font-bold text-[11px] uppercase tracking-widest transition-all hover:bg-gold/5 active:scale-95"
                                        title="Copy HTML mô tả để gửi sang ChatGPT"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                        Copy HTML
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setDescriptionHtmlPasteOpen(true)}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-primary/20 text-primary font-bold text-[11px] uppercase tracking-widest transition-all hover:bg-primary/5 active:scale-95"
                                        title="Dán HTML đã được ChatGPT viết lại"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">code_blocks</span>
                                        Dán HTML
                                    </button>

                                    <label className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-gold/20 text-gold font-bold text-[11px] uppercase tracking-widest transition-all hover:bg-gold/5 active:scale-95 cursor-pointer" title="Nhập từ file Word (.docx)">
                                        <span className="material-symbols-outlined text-[16px]">description</span>
                                        Import Word
                                        <input type="file" accept=".docx" className="hidden" onChange={handleWordImport} />
                                    </label>

                                    <button
                                        type="button"
                                        onClick={() => setIsEditorFullscreen(!isEditorFullscreen)}
                                        className={`flex items-center gap-2 px-4 py-1.5 rounded-sm border-2 font-bold text-[11px] uppercase tracking-widest transition-all shadow-md active:scale-95 ${isEditorFullscreen ? 'bg-red-500 border-red-500 text-white' : 'border-primary text-primary hover:bg-primary hover:text-white'}`}
                                        title={isEditorFullscreen ? "Thu nhỏ" : "Phóng to toàn màn hình"}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{isEditorFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
                                        {isEditorFullscreen ? 'ĐÓNG PHÓNG TO' : 'PHÓNG TO EDITOR'}
                                    </button>
                                </div>
                            </div>
                            <div className="px-4 py-3 border-b border-gold/10 bg-stone/[0.02]">
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                        <div>
                                            <p className="text-[12px] font-black uppercase tracking-[0.18em] text-primary">Yêu cầu thêm cho AI</p>
                                            <p className="text-[12px] text-stone/70 mt-1">
                                                Áp dụng cho cả <span className="font-bold text-primary">AI Viết lại</span> và <span className="font-bold text-primary">AI Viết mới</span>. Bạn có thể yêu cầu kiểu như viết ngắn hơn, theo format chuẩn, hoặc thêm gợi ý ảnh minh họa.
                                            </p>
                                        </div>
                                        {aiInstruction.trim() && (
                                            <button
                                                type="button"
                                                onClick={() => setAiInstruction('')}
                                                className="inline-flex items-center gap-1 self-start px-3 py-1.5 rounded-sm border border-stone/15 text-stone/70 font-bold text-[11px] uppercase tracking-widest transition-all hover:border-red-300 hover:text-red-500 hover:bg-red-50 active:scale-95"
                                            >
                                                <span className="material-symbols-outlined text-[15px]">mop</span>
                                                Xóa yêu cầu
                                            </button>
                                        )}
                                    </div>

                                    <textarea
                                        value={aiInstruction}
                                        onChange={(e) => setAiInstruction(e.target.value)}
                                        rows={3}
                                        placeholder={'Ví dụ: Viết lại ngắn hơn khoảng 3 đoạn, giữ giọng sang trọng; thêm gợi ý vị trí ảnh minh họa cho từng phần; trình bày theo format chuẩn gồm mở bài, chất liệu, ý nghĩa và bài trí.'}
                                        className="w-full rounded-sm border border-gold/20 bg-white px-4 py-3 text-[13px] text-primary placeholder:text-stone/35 focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold/40 resize-y min-h-[92px]"
                                    />

                                    <div className="flex flex-wrap gap-2">
                                        {AI_INSTRUCTION_SUGGESTIONS.map((suggestion) => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                onClick={() => appendAiInstruction(suggestion)}
                                                className="px-3 py-1.5 rounded-full border border-gold/20 bg-white text-[11px] font-bold text-gold transition-all hover:bg-gold/5 hover:border-gold/40 active:scale-95"
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className={`p-1 ${isEditorFullscreen ? 'editor-fullscreen-container' : 'min-h-[400px]'}`}>
                                {isEditorFullscreen && (
                                    <div className="flex justify-between items-center p-3 bg-primary text-white shadow-md">
                                        <div className="flex items-center gap-2">
                                            <span className="material-symbols-outlined">edit_note</span>
                                            <span className="font-bold uppercase tracking-tight text-sm">Chế độ soạn thảo toàn màn hình</span>
                                        </div>
                                        <button
                                            onClick={() => setIsEditorFullscreen(false)}
                                            className="flex items-center gap-1 px-3 py-1 bg-white/10 hover:bg-white/20 rounded transition-all text-xs font-bold"
                                        >
                                            <span className="material-symbols-outlined text-sm">fullscreen_exit</span>
                                            ĐÓNG PHÓNG TO
                                        </button>
                                    </div>
                                )}
                                <ReactQuill
                                    ref={quillRef}
                                    theme="snow"
                                    value={formData.description}
                                    onChange={(content) => setFormData(prev => ({ ...prev, description: content }))}
                                    modules={quillModules}
                                    formats={quillFormats}
                                    className={`${isEditorFullscreen ? '' : 'h-[400px] mb-12'} border-none`}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="lg:col-span-4 space-y-4">
                        {/* Standalone Status Toggle */}
                        <div className="bg-white border border-gold/10 p-4 shadow-premium-sm rounded-sm flex items-center justify-between group transition-all hover:border-gold/30">
                            <div className="flex items-center gap-3">
                                <div className={`size-10 rounded-full flex items-center justify-center transition-all duration-300 ${formData.status ? 'bg-green-50 text-green-600 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]' : 'bg-stone/5 text-stone/40'}`}>
                                    <span className="material-symbols-outlined text-[20px]">{formData.status ? 'inventory_2' : 'inventory'}</span>
                                </div>
                                <div className="space-y-0.5">
                                    <p className="text-[13px] font-black text-primary uppercase tracking-tight leading-none">Trạng thái kinh doanh</p>
                                    <p className={`text-[11px] font-bold transition-colors duration-300 ${formData.status ? 'text-green-600' : 'text-stone/40'}`}>
                                        {formData.status ? 'Đang mở bán trên toàn hệ thống' : 'Sản phẩm đang được tạm ẩn'}
                                    </p>
                                </div>
                            </div>
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    name="status"
                                    checked={formData.status}
                                    onChange={handleChange}
                                    className="sr-only peer"
                                    id="main-status-toggle"
                                />
                                <label
                                    htmlFor="main-status-toggle"
                                    className="block w-14 h-7 bg-stone/20 rounded-full cursor-pointer transition-all duration-300 peer-checked:bg-green-500 relative shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] overflow-hidden"
                                >
                                    <div className="absolute top-1 left-1 bg-white w-5 h-5 rounded-full shadow-md transition-all duration-300 transform peer-checked:translate-x-7 flex items-center justify-center">
                                        <span className={`material-symbols-outlined text-[12px] font-bold transition-colors duration-300 ${formData.status ? 'text-green-500' : 'text-stone/30'}`}>
                                            {formData.status ? 'done' : 'close'}
                                        </span>
                                    </div>
                                    {/* Subtle ON/OFF text inside track */}
                                    <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/40 uppercase transition-opacity duration-300 ${formData.status ? 'opacity-0' : 'opacity-100'}`}>Off</span>
                                    <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-white/60 uppercase transition-opacity duration-300 ${formData.status ? 'opacity-100' : 'opacity-0'}`}>On</span>
                                </label>
                            </div>
                        </div>

                        {/* Custom Attributes */}
                        {allAttributes.filter(a => a.entity_type === 'product').length > 0 && (
                            <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                                <SectionTitle icon="fingerprint" title="Thuộc tính nghệ thuật" />
                                <div className="grid grid-cols-1 gap-y-10">
                                    {allAttributes.filter(a => a.entity_type === 'product').map(attr => (
                                        <Field key={attr.id} label={attr.name}>
                                            {renderAttributeField(attr)}
                                        </Field>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Related Products */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <div className="flex justify-between items-center mb-5">
                                <SectionTitle icon="link" title="Đề xuất liên quan" />
                                <div className="flex items-center gap-2">
                                    {(() => {
                                        const hasRelatedChanges = (stagedRelatedIds.length !== formData.linked_product_ids.length || !stagedRelatedIds.every(id => formData.linked_product_ids.includes(id))) || (JSON.stringify(stagedRelatedData.map(p => ({id: p.id, t: p.option_title || ''}))) !== JSON.stringify(selectedProductsData.map(p => ({id: p.id, t: p.option_title || p.pivot?.option_title || ''}))));
                                        return hasRelatedChanges && (
                                        <div className="flex items-center gap-2 mr-2 animate-in fade-in slide-in-from-right-2 duration-300">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setStagedRelatedIds([...formData.linked_product_ids]);
                                                    setStagedRelatedData([...selectedProductsData]);
                                                }}
                                                className="px-2 py-1.5 text-[9px] font-black uppercase text-stone/40 hover:text-brick transition-all"
                                            >
                                                Hủy thay đổi
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setFormData(prev => ({ ...prev, linked_product_ids: [...stagedRelatedIds] }));
                                                    setSelectedProductsData([...stagedRelatedData]);
                                                    showToast({ message: `Đã ghi nhận ${stagedRelatedIds.length} sản phẩm liên quan. Hãy nhấn "Lưu cập nhật" để hoàn tất.`, type: 'success' });
                                                }}
                                                className="bg-gold px-3 py-1.5 rounded-sm text-white text-[10px] font-black uppercase tracking-widest shadow-premium hover:bg-gold/80 transition-all"
                                            >
                                                Ghi nhận danh sách
                                            </button>
                                        </div>
                                        );
                                    })()}
                                    <button
                                        type="button"
                                        onClick={() => setShowSelectedRelated(!showSelectedRelated)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-sm transition-all text-[11px] font-bold uppercase tracking-widest ${showSelectedRelated ? 'bg-primary text-white shadow-lg' : 'bg-gold/5 text-gold border border-gold/10 hover:bg-gold/10'}`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">{showSelectedRelated ? 'visibility_off' : 'visibility'}</span>
                                        {showSelectedRelated ? 'Đóng DS Đã Chọn' : `Đã chọn (${stagedRelatedIds.length})`}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-4">
                                {/* Search & Filters Area */}
                                <div className="space-y-3 p-3 bg-stone/5 border border-stone/10 rounded-sm">
                                    <div className="flex gap-2">
                                        <div className="relative flex-1" ref={relatedSearchContainerRef}>
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-stone/40 z-10">search</span>
                                            <input
                                                type="text"
                                                autoComplete="off"
                                                placeholder="Tìm theo tên hoặc mã SKU..."
                                                value={relatedQuery}
                                                onChange={(e) => setRelatedQuery(e.target.value)}
                                                onFocus={() => setShowSearchHistory(true)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault(); // Tránh submit form chính
                                                        setShowSearchHistory(false);
                                                        addToSearchHistory(relatedQuery);
                                                        fetchSuggestedProducts(); // Thực hiện tìm kiếm ngay lập tức
                                                    }
                                                }}
                                                className="w-full bg-white border border-stone/20 rounded-sm pl-9 pr-9 py-2 text-[12px] font-bold text-primary focus:outline-none focus:border-gold/30 transition-all shadow-sm relative z-0"
                                            />
                                            {relatedQuery && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setRelatedQuery(''); setShowSearchHistory(false); }}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 hover:text-brick transition-colors z-10"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">cancel</span>
                                                </button>
                                            )}

                                            {showSearchHistory && searchHistory.length > 0 && (
                                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-primary/20 shadow-2xl z-[70] rounded-sm py-2 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                                                    <div className="flex justify-between items-center px-3 mb-1 border-b border-primary/10 pb-1">
                                                        <span className="text-[9px] font-bold text-primary/40 uppercase tracking-widest">Gần đây</span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); setSearchHistory([]); localStorage.removeItem('product_search_history'); }}
                                                            className="text-[9px] text-brick hover:underline font-bold"
                                                        >Xóa</button>
                                                    </div>
                                                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                                        {searchHistory.map((item, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="group flex items-center justify-between px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors"
                                                                onClick={() => {
                                                                    setRelatedQuery(item);
                                                                    setShowSearchHistory(false);
                                                                    addToSearchHistory(item);
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-2 overflow-hidden">
                                                                    <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                                    <span className="text-[11px] text-primary truncate font-bold">{item}</span>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const updated = searchHistory.filter(h => h !== item);
                                                                        setSearchHistory(updated);
                                                                        localStorage.setItem('product_search_history', JSON.stringify(updated));
                                                                    }}
                                                                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-brick transition-all rounded-full hover:bg-primary/5 text-stone/40"
                                                                >
                                                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowRelatedFilters(!showRelatedFilters)}
                                            className={`flex items-center gap-1.5 px-4 py-2 rounded-sm border font-black text-[11px] uppercase tracking-widest transition-all ${showRelatedFilters ? 'bg-primary text-white border-primary shadow-premium' : 'bg-white border-gold/20 text-gold hover:bg-gold/5'}`}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">filter_list</span>
                                            Lọc
                                            {Object.values(relatedAttrFilter).concat([relatedCategory]).some(v => v !== 'all' && v !== '') && (
                                                <span className="size-2 bg-brick rounded-full animate-pulse"></span>
                                            )}
                                        </button>
                                    </div>

                                    {/* Filters Panel */}
                                    {showRelatedFilters && (
                                        <div className="grid grid-cols-1 gap-4 pt-3 mt-3 border-t border-stone/10 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <div className="grid grid-cols-2 gap-3">
                                                {/* Category Filter */}
                                                <div className="space-y-1">
                                                    <span className="text-[9px] font-black uppercase text-stone/40 px-1">Danh mục</span>
                                                    <select
                                                        value={relatedCategory}
                                                        onChange={(e) => setRelatedCategory(e.target.value)}
                                                        className="w-full bg-white border border-stone/20 rounded-sm px-2 py-1.5 text-[11px] font-bold text-primary focus:outline-none"
                                                    >
                                                        <option value="all">Tất cả danh mục</option>
                                                        {categories.map(cat => (
                                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                {/* Filterable Attributes */}
                                                {allAttributes
                                                    .filter(a => [
                                                        'Chứng chỉ chất lượng', 'Ngày ra lò', 'Đường kính',
                                                        'Giấy chứng nhận', 'Phí bảo hiểm vận chuyển',
                                                        'Hàng phi mậu dịch', 'Câu chuyện sản phẩm', 'Loại men'
                                                    ].includes(a.name))
                                                    .map(attr => (
                                                        <div key={attr.id} className="space-y-1">
                                                            <span className="text-[9px] font-black uppercase text-stone/40 px-1">{attr.name}</span>
                                                            <select
                                                                value={relatedAttrFilter[attr.id] || 'all'}
                                                                onChange={(e) => setRelatedAttrFilter(prev => ({ ...prev, [attr.id]: e.target.value }))}
                                                                className="w-full bg-white border border-stone/20 rounded-sm px-2 py-1.5 text-[11px] font-bold text-primary focus:outline-none"
                                                            >
                                                                <option value="all">Tất cả {attr.name}</option>
                                                                {(attr.options || []).map(opt => (
                                                                    <option key={opt.id} value={opt.value}>{opt.value}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                ))}
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[9px] font-black uppercase text-stone/30">Auto-search:</span>
                                                    <div className="size-2 bg-gold/40 rounded-full animate-pulse"></div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setRelatedCategory('all');
                                                        setRelatedAttrFilter({});
                                                    }}
                                                    className="text-[9px] font-black uppercase text-brick hover:underline px-2 py-1"
                                                >
                                                    Mặc định tất cả
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="max-h-[400px] overflow-y-auto custom-scrollbar space-y-2 pr-1 border-t border-stone/10 pt-4">
                                    {showSelectedRelated ? (
                                        <>
                                            <div className="flex justify-between items-center px-1 mb-3">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-brick italic bg-brick/5 px-2 py-0.5 rounded-full">
                                                    Danh sách đang chọn ({stagedRelatedIds.length})
                                                </span>
                                                {stagedRelatedIds.length > 0 && (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setFormData(prev => ({ ...prev, linked_product_ids: [...stagedRelatedIds] }));
                                                                setSelectedProductsData(stagedRelatedData.map(p => ({...p})));
                                                                showToast({ message: `Đã ghi nhận thay đổi! Đừng quên bấm nút "Lưu cập nhật" ở trên cùng để lưu lại.`, type: 'success' });
                                                            }}
                                                            className="bg-gold/10 text-gold hover:bg-gold/20 hover:text-gold-dark px-3 py-1 rounded-[4px] text-[10px] font-bold uppercase transition-all flex items-center gap-1.5"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">save</span>
                                                            Lưu thay đổi
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setStagedRelatedIds([]);
                                                                setStagedRelatedData([]);
                                                            }}
                                                            className="text-[9px] font-black uppercase text-brick hover:underline px-2 py-1"
                                                        >
                                                            Xóa toàn bộ
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {stagedRelatedData.length === 0 ? (
                                                <div className="py-12 text-center text-stone/30 italic text-[11px]">Chưa có sản phẩm nào được chọn.</div>
                                            ) : (
                                                stagedRelatedData.map((prod, idx) => (
                                                    <div key={`${prod.id}-${idx}`} className="flex items-center gap-3 p-2 border rounded-sm bg-gold/5 border-gold/20 shadow-sm relative group">
                                                        <div className="size-10 bg-white border border-stone/10 p-0.5 rounded shadow-sm overflow-hidden flex-shrink-0">
                                                            <img src={(prod.images?.find(img => img.is_primary) || prod.images?.[0])?.image_url || 'https://placehold.co/100'} className="w-full h-full object-cover" alt="" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[12px] font-bold text-primary truncate leading-tight">{prod.name}</p>
                                                            <p className="text-[9px] font-black text-gold uppercase mt-0.5 mb-1">{prod.sku}</p>
                                                            <input
                                                                type="text"
                                                                placeholder="Tên hiển thị frontend (Tùy chỉnh)"
                                                                value={prod.option_title || prod.pivot?.option_title || ''}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setStagedRelatedData(prev => prev.map(p => String(p.id) === String(prod.id) ? { ...p, option_title: val } : p));
                                                                }}
                                                                className="w-full bg-white border border-stone/20 rounded-sm px-2 py-1 text-[10px] text-primary focus:border-primary/50 focus:outline-none placeholder:text-stone/30"
                                                                title="Nhập tên này để ưu tiên hiển thị trên frontend thay vì tên gốc"
                                                            />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                const prodIdStr = String(prod.id);
                                                                setStagedRelatedIds(prev => prev.filter(id => String(id) !== prodIdStr));
                                                                setStagedRelatedData(prev => prev.filter(p => String(p.id) !== prodIdStr));
                                                            }}
                                                            className="size-8 rounded-full flex items-center justify-center text-stone/20 hover:text-brick hover:bg-brick/5 transition-all"
                                                            title="Gỡ bỏ khỏi danh sách đang chọn"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">close</span>
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex justify-between items-center px-1 mb-2">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-stone/50">
                                                    {!relatedQuery && relatedCategory === 'all' && !Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '')
                                                        ? 'Gợi ý tương đương'
                                                        : `Kết quả (${filteredSuggestedProducts.length})`}
                                                </span>
                                                <div className="flex items-center gap-3">
                                                    {!relatedQuery && relatedCategory === 'all' && !Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '') && (
                                                        <button
                                                            type="button"
                                                            onClick={() => fetchSuggestedProducts()}
                                                            className="flex items-center gap-1 text-[9px] font-bold text-gold hover:underline"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">refresh</span>
                                                            Làm mới
                                                        </button>
                                                    )}
                                                    {Object.values(relatedAttrFilter).concat([relatedQuery, relatedCategory]).some(v => v !== 'all' && v !== '') && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setRelatedQuery('');
                                                                setRelatedCategory('all');
                                                                setRelatedAttrFilter({});
                                                            }}
                                                            className="text-[9px] font-bold text-brick hover:underline"
                                                        >
                                                            Xóa lọc
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {searchingRelated ? (
                                                <div className="py-12 flex flex-col items-center justify-center text-stone/40">
                                                    <div className="size-8 border-2 border-gold/20 border-t-gold rounded-full animate-spin mb-3"></div>
                                                    <span className="text-[11px] font-bold uppercase tracking-widest animate-pulse">Đang tải dữ liệu...</span>
                                                </div>
                                            ) : filteredSuggestedProducts.length > 0 ? (
                                                filteredSuggestedProducts.map(prod => (
                                                    <label key={prod.id} className={`flex items-center gap-3 p-2 border rounded-sm cursor-pointer transition-all ${stagedRelatedIds.includes(prod.id) ? 'bg-gold/10 border-gold/30 shadow-sm' : 'bg-white border-stone/10 hover:bg-gold/5 hover:border-gold/20'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={stagedRelatedIds.includes(prod.id)}
                                                            onChange={(e) => {
                                                                const prodId = prod.id;
                                                                const prodIdStr = String(prodId);
                                                                if (e.target.checked) {
                                                                    setStagedRelatedIds(prev => Array.from(new Set([...prev, prodId])));
                                                                    setStagedRelatedData(prev => {
                                                                        if (prev.some(p => String(p.id) === prodIdStr)) return prev;
                                                                        return [...prev, prod];
                                                                    });
                                                                } else {
                                                                    setStagedRelatedIds(prev => prev.filter(id => String(id) !== prodIdStr));
                                                                    setStagedRelatedData(prev => prev.filter(p => String(p.id) !== prodIdStr));
                                                                }
                                                            }}
                                                            className="size-4 accent-primary"
                                                        />
                                                        <div className="size-10 bg-white border border-stone/10 p-0.5 rounded shadow-sm overflow-hidden flex-shrink-0">
                                                            <img src={(prod.images?.find(img => img.is_primary) || prod.images?.[0])?.image_url || 'https://placehold.co/100'} className="w-full h-full object-cover" alt="" />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[12px] font-bold text-primary truncate leading-tight">{prod.name}</p>
                                                            <p className="text-[9px] font-black text-gold uppercase mt-0.5">{prod.sku}</p>
                                                        </div>
                                                    </label>
                                                ))
                                            ) : (relatedQuery || relatedCategory !== 'all' || Object.values(relatedAttrFilter).some(v => v !== 'all' && v !== '')) ? (
                                                <div className="py-12 text-center text-stone/30 italic text-[11px]">
                                                    <span className="material-symbols-outlined block text-[24px] mb-1">sentiment_dissatisfied</span>
                                                    Không tìm thấy sản phẩm phù hợp...
                                                </div>
                                            ) : (
                                                <div className="py-12 flex flex-col items-center justify-center text-stone/30 italic text-[11px] border-2 border-dashed border-stone/5 rounded-sm">
                                                    <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">Saved_Search</span>
                                                    <p className="font-bold uppercase tracking-tighter mb-1">Bắt đầu tìm kiếm</p>
                                                    <p className="max-w-[180px] leading-relaxed">Nhập từ khóa hoặc sử dụng bộ lọc để tìm sản phẩm đề xuất</p>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* SEO Tools */}
                        <div className="bg-white border border-gold/10 p-5 shadow-premium-sm rounded-sm">
                            <SectionTitle icon="search" title="Tối ưu tìm kiếm (SEO)" />
                            <div className="grid grid-cols-1 gap-y-10">
                                <div className="rounded-sm border border-gold/15 bg-stone/[0.03] px-4 py-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/45">AI SEO tổng thể</p>
                                            <p className="mt-2 text-[13px] text-primary/65">
                                                Tự điền mô tả HTML sạch, bảng thông số kỹ thuật và toàn bộ meta SEO. Nếu thư viện ảnh sản phẩm có URL công khai, AI sẽ chèn cả ảnh sản phẩm và ảnh tập thể nhân sự vào mô tả.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAIGenerateSeo}
                                            disabled={aiGeneratingSeo || !aiAvailable}
                                            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm border border-gold/30 text-gold font-bold text-[11px] uppercase tracking-widest transition-all shadow-sm ${aiGeneratingSeo ? 'opacity-60 cursor-wait' : 'hover:bg-primary hover:text-white hover:border-primary active:scale-95'}`}
                                            title={!aiAvailable ? disabledReason : 'Tạo bộ SEO hoàn chỉnh bằng AI'}
                                        >
                                            <span className={`material-symbols-outlined text-[16px] ${aiGeneratingSeo ? 'animate-spin' : ''}`}>auto_awesome</span>
                                            {aiGeneratingSeo ? 'AI đang tạo SEO...' : 'AI Tạo SEO'}
                                        </button>
                                    </div>
                                </div>
                                <Field label="Meta Title">
                                    <input name="meta_title" value={formData.meta_title} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[13px]" placeholder="Tiêu đề hiển thị trên Google..." />
                                </Field>
                                <Field label="Meta Description" className="min-h-[80px] items-start pt-3">
                                    <textarea name="meta_description" value={formData.meta_description} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary text-[13px] resize-none h-[80px]" placeholder="Mô tả tóm tắt nội dung..." />
                                </Field>
                                <Field label="Meta Keywords" className="min-h-[80px] items-start pt-3">
                                    <textarea name="meta_keywords" value={formData.meta_keywords} onChange={handleChange} className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary text-[13px] resize-none h-[80px]" placeholder="Từ khóa liên quan, ngăn cách bằng dấu phẩy..." />
                                </Field>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
            <AnimatePresence>
                {showVariantExpansionGuide && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
                        <div className="w-full max-w-lg rounded-md bg-white p-6 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200">
                            <div className="flex items-center gap-3 border-b border-stone/10 pb-4">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                                    <span className="material-symbols-outlined">library_add</span>
                                </div>
                                <h3 className="text-lg font-black uppercase text-secondary">
                                    Hu?ng d?n th�m chi?u bi?n th?
                                </h3>
                            </div>

                            <div className="space-y-4 text-[13px] text-stone leading-relaxed">
                                <p className="font-bold text-[14px]">
                                    �? m? r?ng th�m thu?c t�nh (VD: �ang c� K�ch Thu?c, mu?n th�m Lo?i Men) m� KH�NG L�M M?T d? li?u bi?n th? cu, vui l�ng l�m chu?n 3 bu?c:
                                </p>
                                <div className="flex flex-col gap-3 rounded-sm bg-[#f7f4ec] p-4 border border-stone/10">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gold text-white flex items-center justify-center font-bold text-[11px]">1</div>
                                        <div>
                                            <p className="font-bold text-secondary">Gi? & ch?n Thu?c t�nh m?i</p>
                                            <p className="opacity-80">Ph?i d?m b?o Thu?c t�nh CU (v� d? K�ch thu?c) v?n dang du?c t�ch trong danh s�ch. Sau d� b?n t�ch ch?n th�m thu?c t�nh M?I (ch?ng h?n Lo?i men).</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gold text-white flex items-center justify-center font-bold text-[11px]">2</div>
                                        <div>
                                            <p className="font-bold text-secondary">T�ch l?i To�n b? Gi� tr?</p>
                                            <p className="opacity-80">? c?t b�n ph?i, ph?i t�ch d?y d? nh�n gi� tr? CU d? h? th?ng nh?n di?n. V� d? ph?i d�nh d?u l?i Phi 12, Phi 14.. r?i sau d� d�nh d?u th�m Men Lam, Men R?n..</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gold text-white flex items-center justify-center font-bold text-[11px]">3</div>
                                        <div>
                                            <p className="font-bold text-secondary">B?m "T?o t? h?p bi?n th?"</p>
                                            <p className="opacity-80">B?m n�t m�u t�m s?m ? du?i c�ng. H? th?ng s? t? d?ng d?i chi?u th�ng minh: K? th?a T?N KHO & M� SKU cu cho c?m k?t h?p d?u ti�n, d?ng th?i sinh c�c d�ng m?i cho c�c men (ho?c k�ch thu?c) m?i!</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-2 flex justify-end gap-3 pt-4 border-t border-stone/10">
                                <button
                                    type="button"
                                    onClick={() => setShowVariantExpansionGuide(false)}
                                    className="rounded-sm bg-primary px-6 py-2 text-[12px] font-bold uppercase text-white hover:bg-hover active:bg-pressed transition-all"
                                >
                                    �� hi?u & L�m ngay
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showConvertToConfigurableModal && (
                    <div className="fixed inset-0 z-[106] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeConvertToConfigurableModal}
                            className="absolute inset-0 bg-primary/50 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 24 }}
                            className="relative w-full max-w-5xl overflow-hidden rounded-sm bg-white shadow-premium-lg"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-emerald-100 bg-[#f7fbf8] px-6 py-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined rounded-full bg-emerald-100 p-2 text-emerald-700">conversion_path</span>
                                        <div>
                                            <h3 className="text-[16px] font-black uppercase tracking-tight text-primary">Chuyển thành sản phẩm có biến thể</h3>
                                            <p className="mt-1 text-[12px] text-primary/65">
                                                Hệ thống sẽ tạo một sản phẩm cha mới để gom nhóm. Sản phẩm hiện tại giữ nguyên ID, tồn kho và lịch sử, rồi trở thành biến thể đầu tiên.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeConvertToConfigurableModal}
                                    className="text-stone/35 transition-colors hover:text-brick"
                                    title="Đóng popup"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-6 px-6 py-6">
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-sm border border-stone/15 bg-white px-3 py-3">
                                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.16em] text-primary/55">Tên sản phẩm cha</label>
                                        <input
                                            type="text"
                                            value={convertToConfigurableForm.parent_name}
                                            onChange={(event) => setConvertToConfigurableForm((prev) => ({ ...prev, parent_name: event.target.value }))}
                                            className="w-full rounded-sm border border-stone/15 bg-stone/5 px-3 py-2 text-[14px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                            placeholder="Ví dụ: Nậm thờ"
                                        />
                                        <p className="mt-2 text-[11px] text-primary/50">SKU của sản phẩm cha sẽ được hệ thống tự tạo riêng để không đụng SKU cũ.</p>
                                    </div>

                                    <div className="rounded-sm border border-stone/15 bg-white px-3 py-3">
                                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.16em] text-primary/55">Thuộc tính biến thể</label>
                                        <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                                            <select
                                                value={convertToConfigurableForm.attribute_source}
                                                onChange={(event) => setConvertToConfigurableForm((prev) => ({ ...prev, attribute_source: event.target.value, attribute_id: '', custom_attribute_name: prev.custom_attribute_name }))}
                                                className="rounded-sm border border-stone/15 bg-stone/5 px-3 py-2 text-[13px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                            >
                                                <option value="preset">Gợi ý nhanh</option>
                                                <option value="existing">Thuộc tính có sẵn</option>
                                                <option value="custom">Tự nhập</option>
                                            </select>

                                            {convertToConfigurableForm.attribute_source === 'existing' ? (
                                                <select
                                                    value={convertToConfigurableForm.attribute_id}
                                                    onChange={(event) => setConvertToConfigurableForm((prev) => ({ ...prev, attribute_id: event.target.value }))}
                                                    className="rounded-sm border border-stone/15 bg-stone/5 px-3 py-2 text-[13px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                >
                                                    <option value="">Chọn thuộc tính</option>
                                                    {variantReadyAttributes.map((attribute) => (
                                                        <option key={attribute.id} value={attribute.id}>{attribute.name}</option>
                                                    ))}
                                                </select>
                                            ) : convertToConfigurableForm.attribute_source === 'custom' ? (
                                                <input
                                                    type="text"
                                                    value={convertToConfigurableForm.custom_attribute_name}
                                                    onChange={(event) => setConvertToConfigurableForm((prev) => ({ ...prev, custom_attribute_name: event.target.value }))}
                                                    className="rounded-sm border border-stone/15 bg-stone/5 px-3 py-2 text-[13px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                    placeholder="Ví dụ: Mẫu, Loại men, Kích thước"
                                                />
                                            ) : (
                                                <select
                                                    value={convertToConfigurableForm.preset_attribute_name}
                                                    onChange={(event) => setConvertToConfigurableForm((prev) => ({ ...prev, preset_attribute_name: event.target.value }))}
                                                    className="rounded-sm border border-stone/15 bg-stone/5 px-3 py-2 text-[13px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                >
                                                    {SIMPLE_TO_CONFIG_PRESET_ATTRIBUTES.map((attributeName) => (
                                                        <option key={attributeName} value={attributeName}>{attributeName}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                        <p className="mt-2 text-[11px] text-primary/50">
                                            Thuộc tính đang áp dụng: <span className="font-black text-emerald-700">{resolvedConvertAttributeName || 'Chưa chọn'}</span>
                                        </p>
                                        {convertToConfigurableForm.attribute_source === 'existing' && selectedConvertAttribute ? (
                                            <p className="mt-1 text-[11px] text-primary/50">
                                                {selectedConvertAttributeOptions.length > 0 ? (
                                                    <>
                                                        Giá trị sẵn có: <span className="font-bold text-primary/75">{selectedConvertAttributeOptions.map((option) => option.value).join(' / ')}</span>
                                                    </>
                                                ) : (
                                                    <span className="font-bold text-brick">Thuộc tính này chưa có giá trị để tạo biến thể.</span>
                                                )}
                                            </p>
                                        ) : null}
                                        {convertToConfigurableForm.attribute_source === 'existing' && currentConvertAttributeValue ? (
                                            <p className="mt-1 text-[11px] text-emerald-700">
                                                Sản phẩm hiện tại sẽ tự map vào giá trị đầu tiên: <span className="font-black">{currentConvertAttributeValue}</span>
                                            </p>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="rounded-sm border border-emerald-100 bg-emerald-50/40 p-4">
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">Danh sách biến thể sau chuyển đổi</p>
                                            <p className="mt-1 text-[12px] text-primary/60">
                                                Dòng đầu tiên luôn là sản phẩm cũ. Bạn có thể đổi tên hiển thị và đặt giá trị thuộc tính cho nó, nhưng SKU cũ sẽ được giữ nguyên.
                                            </p>
                                            <p className="mt-1 text-[12px] text-primary/55">
                                                {convertVariantValueGuide.helper}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAddConvertVariant}
                                            disabled={convertToConfigurableForm.attribute_source === 'existing' && remainingConvertAttributeOptions.length === 0}
                                            className="inline-flex items-center gap-2 rounded-sm border border-emerald-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">add</span>
                                            Thêm biến thể
                                        </button>
                                    </div>

                                    <div className="overflow-hidden rounded-sm border border-stone/10">
                                        <div className="grid grid-cols-[160px_minmax(0,1fr)_160px_64px] border-b border-stone/10 bg-[#f7f4ec] text-[10px] font-black uppercase tracking-[0.18em] text-stone/55">
                                            <div className="border-r border-stone/10 px-4 py-3">Giá trị phân loại</div>
                                            <div className="border-r border-stone/10 px-4 py-3">Tên biến thể</div>
                                            <div className="border-r border-stone/10 px-4 py-3">SKU</div>
                                            <div className="px-4 py-3 text-center">Xóa</div>
                                        </div>
                                        <div className="max-h-[320px] overflow-y-auto custom-scrollbar bg-white">
                                            {convertToConfigurableForm.variants.map((variant, index) => (
                                                <div key={variant.entry_id} className="grid grid-cols-[160px_minmax(0,1fr)_160px_64px] border-b border-stone/10 last:border-b-0">
                                                    <div className="border-r border-stone/10 px-3 py-3">
                                                        {convertToConfigurableForm.attribute_source === 'existing' && selectedConvertAttributeOptions.length > 0 ? (
                                                            <select
                                                                value={variant.value}
                                                                onChange={(event) => handleConvertVariantFieldChange(variant.entry_id, 'value', event.target.value)}
                                                                className="w-full rounded-sm border border-stone/15 bg-stone/5 px-2 py-2 text-[12px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                            >
                                                                <option value="">
                                                                    {index === 0 ? 'Chọn giá trị cho sản phẩm hiện tại' : 'Chọn giá trị'}
                                                                </option>
                                                                {(convertVariantOptionsByEntryId[variant.entry_id] || selectedConvertAttributeOptions).map((option) => (
                                                                    <option key={`${variant.entry_id}-${option.id}`} value={option.value}>{option.value}</option>
                                                                ))}
                                                            </select>
                                                        ) : convertToConfigurableForm.attribute_source === 'existing' ? (
                                                            <input
                                                                type="text"
                                                                value=""
                                                                readOnly
                                                                className="w-full cursor-not-allowed rounded-sm border border-stone/10 bg-stone/10 px-2 py-2 text-[12px] font-bold text-stone/55 focus:outline-none"
                                                                placeholder="Thuộc tính này chưa có giá trị"
                                                            />
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={variant.value}
                                                                onChange={(event) => handleConvertVariantFieldChange(variant.entry_id, 'value', event.target.value)}
                                                                className="w-full rounded-sm border border-stone/15 bg-stone/5 px-2 py-2 text-[12px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                                placeholder={index === 0 ? convertVariantValueGuide.firstPlaceholder : convertVariantValueGuide.nextPlaceholder}
                                                            />
                                                        )}
                                                        {variant.is_existing ? (
                                                            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Sản phẩm cũ giữ nguyên ID</p>
                                                        ) : null}
                                                    </div>
                                                    <div className="border-r border-stone/10 px-3 py-3">
                                                        <input
                                                            type="text"
                                                            value={variant.name}
                                                            onChange={(event) => handleConvertVariantFieldChange(variant.entry_id, 'name', event.target.value)}
                                                            className="w-full rounded-sm border border-stone/15 bg-stone/5 px-2 py-2 text-[12px] font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                            placeholder="Tên biến thể hiển thị"
                                                        />
                                                    </div>
                                                    <div className="border-r border-stone/10 px-3 py-3">
                                                        <input
                                                            type="text"
                                                            value={variant.sku}
                                                            onChange={(event) => handleConvertVariantFieldChange(variant.entry_id, 'sku', event.target.value)}
                                                            className="w-full rounded-sm border border-stone/15 bg-stone/5 px-2 py-2 text-[12px] font-mono font-bold text-primary focus:border-emerald-300 focus:bg-white focus:outline-none"
                                                            placeholder="Để trống để tự sinh"
                                                        />
                                                        {variant.is_existing ? (
                                                            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">SKU này sẽ cập nhật cho sản phẩm cũ</p>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex items-center justify-center px-3 py-3">
                                                        {variant.is_existing ? (
                                                            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-stone/35">Khóa</span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveConvertVariant(variant.entry_id)}
                                                                className="text-stone/30 transition hover:text-brick"
                                                                title="Xóa biến thể"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone/10 bg-stone/5 px-6 py-4">
                                <button
                                    type="button"
                                    onClick={closeConvertToConfigurableModal}
                                    className="px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-stone transition-all hover:text-primary"
                                >
                                    Đóng
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConvertToConfigurable}
                                    disabled={isConvertingToConfigurable}
                                    className="inline-flex items-center gap-2 rounded-sm bg-emerald-600 px-6 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isConvertingToConfigurable ? <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span> : <span className="material-symbols-outlined text-[16px]">check_circle</span>}
                                    Hoàn tất chuyển đổi
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
                {showBundleOptionSorter && (
                    <div className="fixed inset-0 z-[104] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowBundleOptionSorter(false)}
                            className="absolute inset-0 bg-primary/45 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.97, y: 18 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97, y: 18 }}
                            className="relative w-full max-w-5xl overflow-hidden rounded-sm bg-white shadow-premium-lg"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-gold/10 bg-[#fcfaf7] px-6 py-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined rounded-full bg-gold/10 p-2 text-gold">swap_vert</span>
                                        <div className="text-[0px]">
                                            <h3 className="text-[16px] font-black uppercase tracking-tight text-primary">Sáº¯p xáº¿p tÃ¹y chá»n bundle</h3>
                                            <p className="mt-1 text-[12px] text-stone/55">
                                                KÃ©o tháº£ hoáº·c báº¥m mÅ©i tÃªn Ä‘á»ƒ Ä‘á»•i thá»© tá»± hiá»ƒn thá»‹. Sau khi lÆ°u sáº£n pháº©m, frontend sáº½ Ä‘i theo thá»© tá»± nÃ y.
                                            </p>
                                            <h3 className="text-[16px] font-black uppercase tracking-tight text-primary">Sap xep tuy chon bundle</h3>
                                            <p className="mt-1 text-[12px] text-stone/55">
                                                Keo tha hoac bam mui ten de doi thu tu hien thi. Sau khi luu san pham, frontend se di theo thu tu nay.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowBundleOptionSorter(false)}
                                    className="text-stone/35 transition-colors hover:text-brick"
                                    title="Dong bang sap xep"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-4 px-6 py-5">
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-gold/15 bg-gold/[0.03] px-4 py-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gold">Bang sap xep nhanh</p>
                                        <p className="mt-1 text-[12px] text-stone/55">Moi dong la mot tuy chon trong bundle. Thu tu tren cung se hien thi truoc.</p>
                                    </div>
                                    <span className="inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-black text-primary shadow-sm">
                                        {bundleOptions.length} tuy chon
                                    </span>
                                </div>

                                <div className="overflow-hidden rounded-sm border border-stone/10">
                                    <div className="max-h-[420px] overflow-auto">
                                        <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)_120px_124px] border-b border-stone/10 bg-[#f7f4ec] text-[10px] font-black uppercase tracking-[0.18em] text-stone/55">
                                            <div className="border-r border-stone/10 px-4 py-3 text-center">Vi tri</div>
                                            <div className="border-r border-stone/10 px-4 py-3">Tuy chon</div>
                                            <div className="border-r border-stone/10 px-4 py-3">Bai viet web</div>
                                            <div className="border-r border-stone/10 px-4 py-3 text-center">San pham</div>
                                            <div className="px-4 py-3 text-center">Di chuyen</div>
                                        </div>
                                        <table className="min-w-full table-fixed">
                                            <thead className="hidden sticky top-0 z-10 bg-[#f7f4ec] text-left">
                                                <tr className="border-b border-stone/10 text-[10px] font-black uppercase tracking-[0.18em] text-stone/55">
                                                    <th className="w-[88px] px-4 py-3 border-r border-stone/10 text-center">Vá»‹ trÃ­</th>
                                                    <th className="px-4 py-3 border-r border-stone/10">TÃ¹y chá»n</th>
                                                    <th className="px-4 py-3 border-r border-stone/10">BÃ i viáº¿t web</th>
                                                    <th className="w-[120px] px-4 py-3 border-r border-stone/10 text-center">Sáº£n pháº©m</th>
                                                    <th className="w-[124px] px-4 py-3 text-center">Di chuyá»ƒn</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white">
                                                {bundleOptions.map((option, index) => (
                                                    <DraggableBundleOptionRow
                                                        key={option.id}
                                                        index={index}
                                                        option={option}
                                                        optionCount={bundleOptions.length}
                                                        moveBundleOption={moveBundleOption}
                                                        onMoveUp={() => moveBundleOptionByOffset(index, -1)}
                                                        onMoveDown={() => moveBundleOptionByOffset(index, 1)}
                                                    />
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone/10 bg-stone/5 px-6 py-4">
                                <button
                                    type="button"
                                    onClick={() => setShowBundleOptionSorter(false)}
                                    className="px-6 py-2 text-[0px] font-bold uppercase tracking-widest text-stone transition-all hover:text-primary"
                                >
                                    <span className="text-[11px] font-bold uppercase tracking-widest">Dong</span>
                                    ÄÃ³ng
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
            </DndProvider>

            <AnimatePresence>
                {showInventoryUnitSorter && (
                    <div className="fixed inset-0 z-[106] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeInventoryUnitSorter}
                            className="absolute inset-0 bg-primary/45 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 24 }}
                            className="relative w-full max-w-2xl overflow-hidden rounded-sm bg-white shadow-premium-lg"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-gold/10 bg-[#fcfaf7] px-6 py-5">
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gold">ĐVT sản phẩm</p>
                                    <h3 className="mt-2 text-[20px] font-black text-primary">Sắp xếp thứ tự đơn vị tính</h3>
                                    <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-stone/60">
                                        Thứ tự này sẽ được dùng lại cho toàn bộ danh sách ĐVT trong form tạo và sửa sản phẩm.
                                    </p>
                                    <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-stone/50">
                                        Bạn cũng có thể chọn ĐVT mặc định để hệ thống tự chọn sẵn khi tạo sản phẩm mới.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeInventoryUnitSorter}
                                    className="rounded-full p-2 text-stone/35 transition hover:bg-white hover:text-primary"
                                    title="Đóng"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto p-6">
                                <div className="space-y-3">
                                    {inventoryUnitsDraft.map((unit, index) => {
                                        const isFirst = index === 0;
                                        const isLast = index === inventoryUnitsDraft.length - 1;

                                        return (
                                            <div
                                                key={unit.id}
                                                className="flex items-center gap-4 rounded-sm border border-gold/10 bg-white px-4 py-3 shadow-sm"
                                            >
                                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/15 bg-gold/5 text-[13px] font-black text-primary">
                                                    {index + 1}
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="truncate text-[14px] font-black text-primary">{unit.name}</p>
                                                        {unit.is_default ? (
                                                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                                                                Mặc định
                                                            </span>
                                                        ) : null}
                                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${unit.is_system ? 'bg-stone/10 text-stone/60' : 'bg-amber-50 text-amber-700'}`}>
                                                            {unit.is_system ? 'Hệ thống' : 'Tự tạo'}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 text-[11px] text-stone/55">
                                                        Di chuyển lên hoặc xuống để thay đổi thứ tự hiển thị.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={() => setInventoryUnitDraftDefault(unit.id)}
                                                        className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition ${unit.is_default ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-stone/15 bg-white text-stone/55 hover:border-emerald-200 hover:text-emerald-700'}`}
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">{unit.is_default ? 'verified' : 'radio_button_unchecked'}</span>
                                                        {unit.is_default ? 'ĐVT mặc định' : 'Đặt mặc định'}
                                                    </button>
                                                </div>

                                                <div className="flex shrink-0 items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveInventoryUnitDraftByOffset(index, -1)}
                                                        disabled={isFirst}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone/15 text-stone/55 transition hover:border-gold/35 hover:text-primary disabled:cursor-not-allowed disabled:border-stone/10 disabled:text-stone/20"
                                                        title="Đẩy lên trên"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveInventoryUnitDraftByOffset(index, 1)}
                                                        disabled={isLast}
                                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone/15 text-stone/55 transition hover:border-gold/35 hover:text-primary disabled:cursor-not-allowed disabled:border-stone/10 disabled:text-stone/20"
                                                        title="Đẩy xuống dưới"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone/10 bg-stone/5 px-6 py-4">
                                <p className="text-[11px] text-stone/55">
                                    Danh sách ĐVT trong toàn bộ form sẽ cập nhật ngay theo thứ tự mới, và ĐVT mặc định sẽ được tự chọn sẵn khi tạo sản phẩm.
                                </p>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={closeInventoryUnitSorter}
                                        className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-stone transition-all hover:text-primary"
                                    >
                                        Đóng
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveInventoryUnitOrder}
                                        disabled={!inventoryUnitOrderChanged || isSavingInventoryUnitOrder}
                                        className="inline-flex items-center gap-2 rounded-sm bg-primary px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            {isSavingInventoryUnitOrder ? 'hourglass_top' : 'save'}
                                        </span>
                                        {isSavingInventoryUnitOrder ? 'Đang lưu' : 'Lưu thứ tự'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
                {bundleItemQuickSorter.optionId && activeBundleItemQuickSorterOption && (
                    <DndProvider backend={HTML5Backend}>
                    <div className="fixed inset-0 z-[105] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeBundleItemQuickSorter}
                            className="absolute inset-0 bg-primary/45 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.97, y: 18 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97, y: 18 }}
                            className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-sm bg-white shadow-premium-lg"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-gold/10 bg-[#fcfaf7] px-6 py-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined rounded-full bg-primary/[0.06] p-2 text-primary">format_list_numbered</span>
                                        <div>
                                            <h3 className="text-[16px] font-black uppercase tracking-tight text-primary">
                                                Sắp xếp nhanh sản phẩm trong tùy chọn
                                            </h3>
                                            <p className="mt-1 text-[12px] text-stone/55">
                                                Kéo thả nhanh hoặc nhập số vị trí trực tiếp. Chỉ khi bấm lưu thì thứ tự mới áp dụng vào tùy chọn này.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeBundleItemQuickSorter}
                                    className="text-stone/35 transition-colors hover:text-brick"
                                    title="Đóng bảng sắp xếp nhanh"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-4 overflow-auto px-6 py-5 custom-scrollbar">
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-gold/15 bg-gold/[0.03] px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gold">
                                            {activeBundleItemQuickSorterOption.title || 'Tùy chọn bundle'}
                                        </p>
                                        <p className="mt-1 text-[12px] text-stone/55">
                                            Danh sách dài sẽ thao tác nhanh hơn trong khung này. Dữ liệu về biến thể, số lượng và mặc định vẫn được giữ nguyên.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex rounded-full border border-primary/10 bg-white px-3 py-1 text-[11px] font-black text-primary shadow-sm">
                                            {(bundleItemQuickSorter.items || []).length} sản phẩm
                                        </span>
                                        <span className="inline-flex rounded-full border border-brick/10 bg-brick/[0.06] px-3 py-1 text-[11px] font-black text-brick shadow-sm">
                                            {formatNumberOutput(calculateBundleOptionSubtotal({ items: bundleItemQuickSorter.items }))}₫
                                        </span>
                                    </div>
                                </div>

                                <div className="overflow-hidden rounded-sm border border-stone/10">
                                    <div className="grid grid-cols-[88px_minmax(0,1fr)_132px_104px] border-b border-stone/10 bg-[#f7f4ec] text-[10px] font-black uppercase tracking-[0.18em] text-stone/55">
                                        <div className="border-r border-stone/10 px-4 py-3 text-center">Vị trí</div>
                                        <div className="border-r border-stone/10 px-4 py-3">Sản phẩm</div>
                                        <div className="border-r border-stone/10 px-4 py-3 text-center">Nhập số</div>
                                        <div className="px-4 py-3 text-center">Di chuyển</div>
                                    </div>

                                    {bundleItemQuickSorter.items.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center gap-2 bg-white px-6 py-16 text-center">
                                            <span className="material-symbols-outlined text-[42px] text-stone/20">inventory_2</span>
                                            <p className="text-[13px] font-black uppercase tracking-[0.16em] text-stone/35">Tùy chọn này chưa có sản phẩm</p>
                                            <p className="text-[12px] text-stone/45">Thêm sản phẩm ở bảng chính rồi mở lại sắp xếp nhanh để chỉnh thứ tự.</p>
                                        </div>
                                    ) : (
                                        <div className="max-h-[62vh] overflow-auto custom-scrollbar">
                                            {bundleItemQuickSorter.items.map((item, index) => (
                                                <DraggableBundleItemSorterRow
                                                    key={getBundleItemEntryKey(item)}
                                                    optionId={bundleItemQuickSorter.optionId}
                                                    index={index}
                                                    item={item}
                                                    itemCount={bundleItemQuickSorter.items.length}
                                                    positionValue={bundleItemQuickSorter.positionDrafts[getBundleItemEntryKey(item)] ?? String(index + 1)}
                                                    moveBundleItemQuickSorterItem={moveBundleItemQuickSorterItem}
                                                    onPositionChange={handleBundleItemQuickSorterPositionChange}
                                                    onPositionCommit={handleBundleItemQuickSorterPositionCommit}
                                                    onMoveUp={() => moveBundleItemQuickSorterItemByOffset(index, -1)}
                                                    onMoveDown={() => moveBundleItemQuickSorterItemByOffset(index, 1)}
                                                    formatNumberOutput={formatNumberOutput}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone/10 bg-stone/5 px-6 py-4">
                                <p className="text-[11px] text-stone/55">
                                    Thứ tự ngoài bảng chỉ cập nhật khi bạn bấm <span className="font-black text-primary">Lưu thứ tự</span>.
                                </p>
                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={closeBundleItemQuickSorter}
                                        className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-stone transition-all hover:text-primary"
                                    >
                                        Hủy
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveBundleItemQuickSorter}
                                        disabled={!bundleItemQuickSorterHasChanges}
                                        className="inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-umber disabled:cursor-not-allowed disabled:bg-stone/30"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">save</span>
                                        Lưu thứ tự
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                    </DndProvider>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showVariantQuickUpdateModal && (
                    <div className="fixed inset-0 z-[105] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeVariantQuickUpdateModal}
                            className="absolute inset-0 bg-primary/45 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 24 }}
                            className="relative w-full max-w-3xl overflow-hidden rounded-sm bg-white shadow-premium-lg"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-purple-100 bg-[#fcfafc] px-6 py-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined rounded-full bg-purple-100 p-2 text-purple-700">tune</span>
                                        <div>
                                            <h3 className="text-[16px] font-bold uppercase tracking-tight text-purple-950">Cập nhật nhanh biến thể</h3>
                                            <p className="mt-1 text-[12px] text-purple-900/55">
                                                Nhập giá trị một lần, hệ thống sẽ tự đổ xuống đúng các biến thể theo phạm vi bạn chọn.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeVariantQuickUpdateModal}
                                    className="text-stone/35 transition-colors hover:text-brick"
                                    title="Đóng popup"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-6 px-6 py-6">
                                <div className="rounded-sm border border-purple-100 bg-purple-50/40 p-4">
                                    <div className="mb-3 text-[11px] font-black uppercase tracking-[0.14em] text-purple-900/45">
                                        Phạm vi áp dụng
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <button
                                            type="button"
                                            onClick={() => setVariantQuickUpdateScope('all')}
                                            className={`rounded-sm border px-4 py-4 text-left transition-all ${variantQuickUpdateScope === 'all' ? 'border-purple-500 bg-white shadow-sm' : 'border-purple-100 bg-white/70 hover:border-purple-300'}`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-[13px] font-bold text-purple-950">Tất cả biến thể đang bán</div>
                                                        <div className="mt-1 text-[11px] text-purple-900/55">Áp dụng cho toàn bộ danh sách biến thể hiện đang hiển thị trong bảng.</div>
                                                    </div>
                                                    <span className="rounded-full bg-purple-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-purple-700">
                                                        {visibleVariantCount} biến thể
                                                    </span>
                                                </div>
                                            </button>
                                        <button
                                            type="button"
                                            onClick={() => selectedVariantCount > 0 && setVariantQuickUpdateScope('selected')}
                                            disabled={selectedVariantCount === 0}
                                            className={`rounded-sm border px-4 py-4 text-left transition-all ${variantQuickUpdateScope === 'selected' ? 'border-purple-500 bg-white shadow-sm' : 'border-purple-100 bg-white/70'} ${selectedVariantCount === 0 ? 'cursor-not-allowed opacity-50' : 'hover:border-purple-300'}`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[13px] font-bold text-purple-950">Biến thể đã chọn</div>
                                                    <div className="mt-1 text-[11px] text-purple-900/55">
                                                        Chỉ cập nhật cho những biến thể đã tick trong bảng bên dưới.
                                                    </div>
                                                </div>
                                                <span className="rounded-full bg-stone/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-purple-700">
                                                    {selectedVariantCount} đã chọn
                                                </span>
                                            </div>
                                        </button>
                                    </div>
                                    <p className="mt-3 text-[11px] text-purple-900/50">
                                        Ô nào để trống sẽ được giữ nguyên. Tổng số biến thể sẽ được cập nhật: <span className="font-black text-purple-800">{variantQuickUpdateTargetCount}</span>.
                                    </p>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div className="relative rounded-sm border border-stone/20 bg-white px-3 pt-3 pb-2 focus-within:border-purple-300">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                                            {expectedCostLabel}
                                        </label>
                                        <div className="relative">
                                            <input
                                                value={formatImportCostInput(variantQuickUpdateForm.expected_cost)}
                                                onChange={(event) => handleVariantQuickUpdateFieldChange('expected_cost', event.target.value)}
                                                onBlur={handleVariantQuickUpdateImportCostBlur}
                                                inputMode="numeric"
                                                className="w-full bg-transparent py-2 pr-5 text-[14px] font-bold text-primary focus:outline-none"
                                                placeholder="Nhập giá nhập dự kiến"
                                            />
                                            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold text-primary/35">₫</span>
                                        </div>
                                    </div>

                                    <div className="relative rounded-sm border border-stone/20 bg-white px-3 pt-3 pb-2 focus-within:border-purple-300">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-brick">
                                            Giá bán (VNĐ)
                                        </label>
                                        <div className="relative">
                                            <input
                                                value={formatNumberOutput(variantQuickUpdateForm.price)}
                                                onChange={(event) => handleVariantQuickUpdateFieldChange('price', event.target.value)}
                                                className="w-full bg-transparent py-2 pr-5 text-[14px] font-black text-brick focus:outline-none"
                                                placeholder="Nhập giá bán áp dụng"
                                            />
                                            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold text-brick/40">₫</span>
                                        </div>
                                    </div>

                                    <div className="relative rounded-sm border border-stone/20 bg-white px-3 pt-3 pb-2 focus-within:border-purple-300">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                                            Khối lượng SP
                                        </label>
                                        <div className="relative">
                                            <input
                                                value={variantQuickUpdateForm.weight}
                                                onChange={(event) => handleVariantQuickUpdateFieldChange('weight', event.target.value)}
                                                className="w-full bg-transparent py-2 pr-10 text-[14px] font-bold text-primary focus:outline-none"
                                                placeholder="Nhập khối lượng"
                                            />
                                            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] font-bold italic text-primary/35">gram</span>
                                        </div>
                                    </div>

                                    <div className="relative rounded-sm border border-stone/20 bg-white px-3 pt-3 pb-2 focus-within:border-purple-300">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                                            Đơn vị tính
                                        </label>
                                        <select
                                            value={variantQuickUpdateForm.inventory_unit_id}
                                            onChange={(event) => handleVariantQuickUpdateFieldChange('inventory_unit_id', event.target.value)}
                                            className="w-full bg-transparent py-2 text-[14px] font-bold text-primary focus:outline-none"
                                        >
                                            <option value="">Giữ nguyên ĐVT hiện tại</option>
                                            {inventoryUnits.map((unit) => (
                                                <option key={unit.id} value={unit.id}>{unit.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-stone/10 bg-stone/5 px-6 py-4">
                                <button
                                    type="button"
                                    onClick={closeVariantQuickUpdateModal}
                                    className="px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-stone transition-all hover:text-primary"
                                >
                                    Hủy bỏ
                                </button>
                                <button
                                    type="button"
                                    onClick={handleApplyVariantQuickUpdate}
                                    disabled={!canApplyVariantQuickUpdate}
                                    className="inline-flex items-center gap-2 rounded-sm bg-purple-700 px-8 py-2 text-[11px] font-bold uppercase tracking-widest text-white shadow-sm transition-all hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-[16px]">bolt</span>
                                    Cập nhật
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showHiddenVariantsModal && (
                    <div className="fixed inset-0 z-[106] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeHiddenVariantsModal}
                            className="absolute inset-0 bg-primary/45 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: 24 }}
                            className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-sm bg-white shadow-premium-lg"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-amber-100 bg-[#fffaf3] px-6 py-5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined rounded-full bg-amber-100 p-2 text-amber-700">inventory_2</span>
                                        <div>
                                            <h3 className="text-[16px] font-bold uppercase tracking-tight text-primary">Mẫu đã ẩn</h3>
                                            <p className="mt-1 text-[12px] text-stone/55">
                                                Các biến thể trong danh sách này đang được giữ lại để bảo toàn lịch sử đơn hàng, nhưng không còn hiện ngoài frontend và ô tìm kiếm bán hàng.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeHiddenVariantsModal}
                                    className="text-stone/35 transition-colors hover:text-brick"
                                    title="Đóng popup"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-4 overflow-auto px-6 py-5 custom-scrollbar">
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-100 bg-amber-50/50 px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 shadow-sm">
                                            {hiddenVariantCount} mẫu đã ẩn
                                        </span>
                                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${selectedHiddenVariantCount > 0 ? 'bg-amber-600 text-white' : 'bg-white text-amber-700/60'}`}>
                                            {selectedHiddenVariantCount > 0 ? `Đã chọn ${selectedHiddenVariantCount}` : 'Chưa chọn mẫu'}
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={toggleSelectAllHiddenVariants}
                                            disabled={hiddenVariantCount === 0}
                                            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 transition-colors hover:text-amber-900 disabled:cursor-not-allowed disabled:text-stone/30"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">
                                                {isAllHiddenVariantsSelected ? 'check_box' : hasPartialHiddenVariantSelection ? 'indeterminate_check_box' : 'check_box_outline_blank'}
                                            </span>
                                            {isAllHiddenVariantsSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleRestoreSelectedHiddenVariants}
                                            disabled={selectedHiddenVariantCount === 0}
                                            className={`inline-flex items-center gap-2 rounded-sm border px-4 py-2 text-[11px] font-black uppercase tracking-[0.14em] transition-all ${selectedHiddenVariantCount > 0 ? 'border-emerald-200 bg-white text-emerald-700 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white shadow-sm' : 'cursor-not-allowed border-stone/15 bg-white text-stone/30'}`}
                                        >
                                            <span className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
                                            Khôi phục đã chọn
                                        </button>
                                    </div>
                                </div>

                                {hiddenVariantCount === 0 ? (
                                    <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-amber-200 bg-stone/5 px-6 py-16 text-center">
                                        <span className="material-symbols-outlined text-[42px] text-amber-200">inventory_2</span>
                                        <div>
                                            <p className="text-[13px] font-bold text-stone/45">Chưa có biến thể nào bị ẩn</p>
                                            <p className="mt-1 text-[12px] text-stone/40">
                                                Tick biến thể ở bảng chính rồi bấm "Ẩn biến thể đã chọn" để chuyển chúng vào đây.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="overflow-hidden rounded-sm border border-stone/10">
                                        <div className="grid grid-cols-[64px_88px_minmax(0,1.6fr)_1fr_124px_136px] border-b border-stone/10 bg-[#faf7ef] text-[10px] font-black uppercase tracking-[0.18em] text-stone/55">
                                            <div className="border-r border-stone/10 px-4 py-3 text-center">Chọn</div>
                                            <div className="border-r border-stone/10 px-4 py-3 text-center">Ảnh</div>
                                            <div className="border-r border-stone/10 px-4 py-3">Biến thể</div>
                                            <div className="border-r border-stone/10 px-4 py-3">SKU</div>
                                            <div className="border-r border-stone/10 px-4 py-3 text-center">Giá bán</div>
                                            <div className="px-4 py-3 text-center">Khôi phục</div>
                                        </div>

                                        <div className="max-h-[58vh] overflow-auto custom-scrollbar">
                                            {hiddenVariantEntries.map(({ variant, index, selectionKey }) => {
                                                const parentPrimaryImage = images.find((img) => img.is_primary) || images[0];
                                                const displayImageUrl = variant.image_url || parentPrimaryImage?.image_url;
                                                const isHiddenVariantSelected = selectedHiddenVariantIdSet.has(selectionKey);
                                                const variantAttributeSummary = Object.entries(variant.attributes || {})
                                                    .map(([attrId, attrValue]) => {
                                                        const attribute = selectedSuperAttributes.find((item) => String(item.id) === String(attrId));
                                                        if (!attrValue) {
                                                            return '';
                                                        }

                                                        return attribute?.name ? `${attribute.name}: ${attrValue}` : String(attrValue);
                                                    })
                                                    .filter(Boolean)
                                                    .join(' • ');

                                                return (
                                                    <div
                                                        key={`hidden-${variant.id ?? 'variant'}-${index}`}
                                                        className={`grid grid-cols-[64px_88px_minmax(0,1.6fr)_1fr_124px_136px] border-b border-stone/10 last:border-b-0 ${isHiddenVariantSelected ? 'bg-amber-50/60' : 'bg-white'}`}
                                                    >
                                                        <div className="flex items-center justify-center border-r border-stone/10 px-4 py-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleHiddenVariantSelection(selectionKey)}
                                                                className={`inline-flex items-center justify-center transition-colors ${isHiddenVariantSelected ? 'text-amber-700' : 'text-stone/35 hover:text-amber-700'}`}
                                                                title={isHiddenVariantSelected ? 'Bỏ chọn mẫu này' : 'Chọn mẫu này'}
                                                            >
                                                                <span className="material-symbols-outlined text-[20px]">
                                                                    {isHiddenVariantSelected ? 'check_box' : 'check_box_outline_blank'}
                                                                </span>
                                                            </button>
                                                        </div>

                                                        <div className="flex items-center justify-center border-r border-stone/10 px-4 py-3">
                                                            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-sm border border-stone/10 bg-stone/5">
                                                                {displayImageUrl ? (
                                                                    <img
                                                                        src={displayImageUrl}
                                                                        alt=""
                                                                        className="h-full w-full cursor-zoom-in object-cover"
                                                                        onDoubleClick={(e) => {
                                                                            e.preventDefault();
                                                                            e.stopPropagation();
                                                                            openImageLightbox(displayImageUrl, variant.label || variant.name || `Biến thể ẩn ${index + 1}`);
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <span className="material-symbols-outlined text-stone/25">image</span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="min-w-0 border-r border-stone/10 px-4 py-3">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <p className="truncate text-[13px] font-bold text-primary">
                                                                    {variant.label || variant.name || 'Biến thể chưa có tên'}
                                                                </p>
                                                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700">
                                                                    Đang ẩn
                                                                </span>
                                                            </div>
                                                            {variantAttributeSummary ? (
                                                                <p className="mt-1 line-clamp-2 text-[11px] text-stone/55">{variantAttributeSummary}</p>
                                                            ) : (
                                                                <p className="mt-1 text-[11px] text-stone/35">Không có phân loại bổ sung.</p>
                                                            )}
                                                        </div>

                                                        <div className="flex items-center border-r border-stone/10 px-4 py-3">
                                                            <p className="truncate font-mono text-[12px] font-bold text-stone-600">{variant.sku || 'Chưa có SKU'}</p>
                                                        </div>

                                                        <div className="flex items-center justify-center border-r border-stone/10 px-4 py-3">
                                                            <p className="text-[12px] font-black text-brick">{formatNumberOutput(variant.price)}₫</p>
                                                        </div>

                                                        <div className="flex items-center justify-center px-4 py-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRestoreSingleHiddenVariant(selectionKey)}
                                                                className="inline-flex items-center gap-1.5 rounded-sm border border-emerald-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700 transition-all hover:border-emerald-600 hover:bg-emerald-600 hover:text-white shadow-sm"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
                                                                Khôi phục
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone/10 bg-stone/5 px-6 py-4">
                                <p className="text-[11px] text-stone/55">
                                    Khôi phục xong là biến thể sẽ xuất hiện lại trong bảng chính và có thể bán lại như bình thường.
                                </p>
                                <button
                                    type="button"
                                    onClick={closeHiddenVariantsModal}
                                    className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-stone transition-all hover:text-primary"
                                >
                                    Đóng
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {bundleOptionImagePicker.optionId !== null && bundleOptionImagePickerOption && (
                    <motion.div
                        ref={bundleOptionImagePickerRef}
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{
                            top: bundleOptionImagePicker.top,
                            left: bundleOptionImagePicker.left,
                            width: bundleOptionImagePicker.width,
                        }}
                        className="fixed z-[160] overflow-hidden rounded-sm border border-gold/20 bg-white shadow-[0_28px_60px_rgba(48,33,18,0.24)]"
                    >
                        <div className="border-b border-gold/10 bg-[#fcfaf7] px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone/45">Anh tuy chon bundle</p>
                                    <h4 className="mt-1 truncate text-[14px] font-black text-primary">
                                        {bundleOptionImagePickerOption.title || 'Tuy chon bundle'}
                                    </h4>
                                    <p className="mt-1 text-[11px] text-stone/50">
                                        Chon anh trong gallery cua san pham bundle nay.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeBundleOptionImagePicker}
                                    className="shrink-0 text-stone/35 transition-colors hover:text-brick"
                                    title="Dong bo chon anh"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[320px] overflow-y-auto bg-white p-3">
                            {bundleOptionImageLibraryItems.length > 0 ? (
                                <div className="grid grid-cols-4 gap-2">
                                    {bundleOptionImageLibraryItems.map((image, imageIndex) => {
                                        const imageUrl = String(image?.image_url || '').trim();
                                        const isActive = imageUrl && imageUrl === String(bundleOptionImagePickerOption.image_url || '').trim();

                                        return (
                                            <button
                                                key={`${image.library_source || 'product'}-${image.id || imageUrl || imageIndex}`}
                                                type="button"
                                                onClick={() => handleSelectBundleOptionLibraryImage(bundleOptionImagePicker.optionId, image)}
                                                onDoubleClick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    openImageLightbox(imageUrl, image.display_name);
                                                }}
                                                className={`group/library relative overflow-hidden rounded-sm border bg-stone/5 text-left transition-all ${isActive ? 'border-primary ring-2 ring-primary/20' : 'border-stone/10 hover:border-gold/40 hover:shadow-sm'}`}
                                                title={image.display_name}
                                            >
                                                <div className="aspect-square overflow-hidden bg-stone/5">
                                                    {imageUrl ? (
                                                        <img
                                                            src={imageUrl}
                                                            alt={image.display_name}
                                                            className="size-full object-cover transition-transform duration-300 group-hover/library:scale-105"
                                                        />
                                                    ) : (
                                                        <div className="flex size-full items-center justify-center text-stone/20">
                                                            <span className="material-symbols-outlined text-[24px]">image</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="border-t border-stone/10 bg-white px-2 py-1.5">
                                                    <p className="truncate text-[10px] font-bold text-primary">{image.display_name}</p>
                                                </div>
                                                {isActive && (
                                                    <div className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-white shadow-sm">
                                                        <span className="material-symbols-outlined text-[12px]">check</span>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex h-32 items-center justify-center text-center text-[11px] text-stone/45">
                                    San pham bundle nay chua co anh trong gallery.
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-stone/10 bg-stone/5 px-4 py-3">
                            <p className="min-w-0 text-[11px] text-stone/50">
                                {bundleOptionImageLibraryItems.length} anh trong gallery san pham.
                            </p>
                            <div className="flex shrink-0 items-center gap-2">
                                {bundleOptionImagePickerOption.image_url && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            handleRemoveBundleOptionImage(bundleOptionImagePicker.optionId);
                                            closeBundleOptionImagePicker();
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-sm border border-stone/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-stone/70 transition-all hover:border-brick/30 hover:bg-brick/5 hover:text-brick"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                                        Xoa anh
                                    </button>
                                )}
                                <label
                                    htmlFor={`bundle-option-image-${bundleOptionImagePicker.optionId}`}
                                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-gold/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-all hover:border-gold hover:bg-gold/10"
                                >
                                    <span className="material-symbols-outlined text-[14px]">upload</span>
                                    Tai anh moi
                                </label>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {variantImagePicker.index !== null && variantImagePickerVariant && (
                    <motion.div
                        ref={variantImagePickerRef}
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: 'easeOut' }}
                        style={{
                            top: variantImagePicker.top,
                            left: variantImagePicker.left,
                            width: variantImagePicker.width,
                        }}
                        className="fixed z-[95] overflow-hidden rounded-sm border border-gold/20 bg-white shadow-[0_28px_60px_rgba(48,33,18,0.24)]"
                    >
                        <div className="border-b border-gold/10 bg-[#fcfaf7] px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone/45">Ảnh Biến Thể</p>
                                    <h4 className="mt-1 truncate text-[14px] font-black text-primary">
                                        Chọn nhanh từ thư viện sản phẩm
                                    </h4>
                                    <p className="mt-1 text-[11px] text-stone/50">
                                        {variantImageLibraryItems.length} ảnh có sẵn, chọn là cập nhật ngay cho biến thể này.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeVariantImagePicker}
                                    className="shrink-0 text-stone/35 transition-colors hover:text-brick"
                                    title="Đóng bộ chọn ảnh"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                        </div>

                        <div className="max-h-[320px] overflow-y-auto bg-white p-3">
                            <div className="grid grid-cols-4 gap-2">
                                {variantImageLibraryItems.map((image, imageIndex) => {
                                    const isActive = activeVariantLibraryImage
                                        ? (
                                            (String(activeVariantLibraryImage?.id || '') !== ''
                                                && String(activeVariantLibraryImage?.id || '') === String(image?.id || ''))
                                            || (
                                                String(activeVariantLibraryImage?.image_url || '') !== ''
                                                && String(activeVariantLibraryImage?.image_url || '') === String(image?.image_url || '')
                                            )
                                        )
                                        : false;

                                    return (
                                        <button
                                            key={String(image?.id || `variant-library-${imageIndex}`)}
                                            type="button"
                                            onClick={() => handleVariantLibraryImageClick(variantImagePicker.index, image)}
                                            onDoubleClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleVariantLibraryImageDoubleClick(image);
                                            }}
                                            className={`group/library relative overflow-hidden rounded-sm border bg-stone/5 text-left transition-all ${isActive ? 'border-primary ring-2 ring-primary/20' : 'border-stone/10 hover:border-gold/40 hover:shadow-sm'}`}
                                            title={image.display_name}
                                        >
                                            <div className="aspect-square overflow-hidden bg-stone/5">
                                                {image?.image_url ? (
                                                    <img
                                                        src={image.image_url}
                                                        alt={image.display_name}
                                                        className="size-full cursor-zoom-in object-cover transition-transform duration-300 group-hover/library:scale-105"
                                                    />
                                                ) : (
                                                    <div className="flex size-full items-center justify-center text-stone/20">
                                                        <span className="material-symbols-outlined text-[24px]">image</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="border-t border-stone/10 bg-white px-2 py-1.5">
                                                <p className="truncate text-[10px] font-bold text-primary">{image.display_name}</p>
                                            </div>
                                            {image?.is_primary && (
                                                <div className="absolute left-1.5 top-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-white shadow-sm">
                                                    Chính
                                                </div>
                                            )}
                                            {isActive && (
                                                <div className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-white shadow-sm">
                                                    <span className="material-symbols-outlined text-[12px]">check</span>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-stone/10 bg-stone/5 px-4 py-3">
                            <p className="min-w-0 text-[11px] text-stone/50">
                                {variantImagePickerVariant?.image_url
                                    ? (activeVariantLibraryImage
                                        ? 'Biến thể đang bám theo ảnh đã chọn trong thư viện.'
                                        : 'Biến thể đang dùng ảnh riêng, bạn có thể đổi sang ảnh thư viện hoặc tải ảnh khác.')
                                    : 'Biến thể đang kế thừa ảnh chính của sản phẩm cha.'}
                            </p>
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => openVariantUploadDialog(variantImagePicker.index)}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-gold/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-all hover:border-gold hover:bg-gold/10"
                                >
                                    <span className="material-symbols-outlined text-[14px]">upload</span>
                                    Tải ảnh riêng
                                </button>
                                {variantImagePickerVariant?.image_url && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveVariantImage(variantImagePicker.index)}
                                        className="inline-flex items-center gap-1.5 rounded-sm border border-stone/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-stone/70 transition-all hover:border-brick/30 hover:bg-brick/5 hover:text-brick"
                                    >
                                        <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                                        Dùng ảnh cha
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {lightboxImage?.url && (
                    <ImageLightboxModal image={lightboxImage} onClose={closeImageLightbox} />
                )}
            </AnimatePresence>

            <ProductDescriptionAiReviewModal
                open={aiRewriteReview.open}
                draftHtml={aiRewriteReview.draftHtml}
                revisionInstruction={aiRewriteReview.revisionInstruction}
                isLoading={aiRewriting}
                model={aiRewriteReview.model}
                onRevisionInstructionChange={handleAiRewriteRevisionChange}
                onRevise={handleReviseAiRewriteDraft}
                onApply={handleApplyAiRewriteDraft}
                onCopyHtml={handleCopyAiRewriteHtml}
                onClose={handleCloseAiRewriteReview}
            />

            <ProductDescriptionImageLibraryModal
                open={descriptionImageLibraryOpen}
                images={descriptionImageLibraryItems}
                onInsert={handleInsertDescriptionLibraryImage}
                onPreview={openImageLightbox}
                onClose={() => setDescriptionImageLibraryOpen(false)}
            />

            <ProductDescriptionHtmlPasteModal
                open={descriptionHtmlPasteOpen}
                initialHtml={formData.description}
                onApply={handleApplyDescriptionHtmlPaste}
                onClose={() => setDescriptionHtmlPasteOpen(false)}
            />

            {/* Slug Management Modal */}
            <AnimatePresence>
                {showSlugModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowSlugModal(false)}
                            className="absolute inset-0 bg-primary/40 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col bg-white shadow-premium-lg rounded-sm overflow-hidden"
                        >
                            <div className="shrink-0 bg-[#fcfaf7] px-6 py-4 border-b border-gold/10 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-gold">link</span>
                                    <h3 className="font-sans text-[16px] font-bold text-primary uppercase tracking-tight">Quản lý đường dẫn hiển thị</h3>
                                </div>
                                <button onClick={() => setShowSlugModal(false)} className="text-stone/30 hover:text-brick transition-colors">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto custom-scrollbar">
                                <div className="mb-6">
                                    <label className="block text-[11px] font-black uppercase text-stone/40 mb-2 tracking-widest">Xem trước URL sản phẩm</label>
                                    <div
                                        className="p-4 bg-stone/5 border border-gold/10 rounded-sm flex items-center justify-between group/link cursor-pointer hover:bg-gold/5 transition-all"
                                        onClick={handleCopyLink}
                                        title="Click để sao chép link"
                                    >
                                        <div className="flex items-baseline gap-1 overflow-hidden">
                                            <span className="text-[12px] text-stone/40 shrink-0 font-medium">
                                                {domains.find(d => String(d.id) === String(formData.site_domain_id))?.domain || domains.find(d => d.is_default)?.domain || 'di-san.com'}/product/
                                            </span>
                                            <span className="text-[12px] text-primary font-bold truncate">{tempSlug || '...' }</span>
                                        </div>
                                        <span className="material-symbols-outlined text-[16px] text-stone/30 group-hover/link:text-gold transition-colors">content_copy</span>
                                    </div>
                                    <p className="text-[10px] text-stone/40 mt-2 italic">* Đây là đường dẫn tĩnh để khách hàng truy cập trực tiếp vào sản phẩm.</p>
                                </div>

                                <div className="mb-6 rounded-sm border border-gold/10 bg-[#fcfaf7] p-4">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Link tracking quảng cáo</h4>
                                            <p className="mt-1 text-[11px] text-stone/50">
                                                Hệ thống tự sinh 3 link phụ từ link sản phẩm hiện tại theo UTM.
                                            </p>
                                        </div>
                                        <span className="rounded-full bg-primary/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                            Tự động
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        {trackingLinks.map((trackingLink) => (
                                            <div key={trackingLink.key} className="rounded-sm border border-stone/10 bg-white p-3 shadow-sm">
                                                <div className="mb-2 flex items-center justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[12px] font-bold text-primary">{trackingLink.label}</div>
                                                        <div className="text-[10px] font-medium text-stone/45">{trackingLink.helper}</div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => copyTextToClipboard(trackingLink.url, `Đã sao chép ${trackingLink.label.toLowerCase()}!`)}
                                                        className="inline-flex items-center gap-1.5 rounded-sm border border-gold/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-all hover:border-gold hover:bg-gold/10"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                        Copy
                                                    </button>
                                                </div>
                                                <div className="truncate text-[12px] text-stone/65" title={trackingLink.url || 'Chưa có link tracking'}>
                                                    {trackingLink.url || 'Sản phẩm cần có domain và slug để sinh link tracking.'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {bundleOptionLinks.length > 0 && (
                                    <div className="mb-6 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <h4 className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Link riêng từng tùy chọn</h4>
                                                <p className="mt-1 text-[11px] text-stone/50">
                                                    Mỗi link giữ slug sản phẩm, mã/tên tùy chọn và UTM nguồn quảng cáo.
                                                </p>
                                            </div>
                                            <span className="shrink-0 rounded-full bg-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                                {bundleOptionLinks.length} tùy chọn
                                            </span>
                                        </div>

                                        <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                                            {bundleOptionLinks.map((optionLink) => (
                                                <div key={optionLink.id} className="rounded-sm border border-stone/10 bg-[#fcfaf7] p-3">
                                                    <div className="mb-2 flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <div className="text-[12px] font-black text-primary">{optionLink.title}</div>
                                                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${optionLink.isInternal ? 'bg-brick/10 text-brick' : 'bg-emerald-50 text-emerald-700'}`}>
                                                                    {optionLink.isInternal ? 'Nội bộ' : 'Hiển thị'}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 truncate text-[10px] font-medium text-stone/45" title={[optionLink.compactValue ? `o=${optionLink.compactValue}` : '', optionLink.uid ? `uid=${optionLink.uid}` : '', `key=${optionLink.optionKey}`].filter(Boolean).join(' | ')}>
                                                                {[optionLink.compactValue ? `o=${optionLink.compactValue}` : '', optionLink.uid ? `uid=${optionLink.uid}` : '', `key=${optionLink.optionKey}`].filter(Boolean).join(' | ')}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => copyTextToClipboard(optionLink.url, `Đã sao chép link tùy chọn ${optionLink.title}!`)}
                                                            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-gold/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-primary transition-all hover:border-gold hover:bg-gold/10"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                                            Copy link
                                                        </button>
                                                    </div>

                                                    <div className="truncate rounded-sm bg-white px-2.5 py-2 text-[11px] text-stone/65" title={optionLink.url || 'Chưa có link tùy chọn'}>
                                                        {optionLink.url || 'Sản phẩm cần có domain và slug để sinh link tùy chọn.'}
                                                    </div>

                                                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                        {optionLink.trackingLinks.map((trackingLink) => (
                                                            <button
                                                                key={`${optionLink.id}-${trackingLink.key}`}
                                                                type="button"
                                                                onClick={() => copyTextToClipboard(trackingLink.url, `Đã sao chép ${trackingLink.label.toLowerCase()} cho ${optionLink.title}!`)}
                                                                className="inline-flex min-w-0 items-center justify-between gap-2 rounded-sm border border-stone/10 bg-white px-2.5 py-2 text-left text-[10px] font-black uppercase tracking-[0.1em] text-primary transition-all hover:border-gold/40 hover:bg-gold/5"
                                                                title={trackingLink.url || 'Chưa có link tracking'}
                                                            >
                                                                <span className="truncate">{trackingLink.label.replace('Link ', '')}</span>
                                                                <span className="material-symbols-outlined shrink-0 text-[14px]">content_copy</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-6">
                                    <div className="relative border border-stone/30 rounded-sm px-3 focus-within:border-primary/30 transition-colors flex flex-col justify-center min-h-[50px] bg-white">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 font-sans text-[11px] font-black text-gold tracking-widest leading-none uppercase">
                                            Chọn Tên Miền Hiển Thị
                                        </label>
                                        <select
                                            name="site_domain_id"
                                            value={formData.site_domain_id || ''}
                                            onChange={(e) => setFormData(prev => ({ ...prev, site_domain_id: e.target.value }))}
                                            className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[13px] pt-1"
                                        >
                                            <option value="">Sử dụng tên miền mặc định</option>
                                            {domains.map(d => (
                                                <option key={d.id} value={d.id}>{d.domain} {d.is_default ? '(Mặc định)' : ''}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="relative border border-stone/30 rounded-sm px-3 focus-within:border-primary/30 transition-colors flex flex-col justify-center min-h-[50px] bg-white">
                                        <label className="absolute -top-3 left-2 bg-white px-1.5 font-sans text-[11px] font-black text-brick tracking-widest leading-none uppercase">
                                            Chỉnh sửa Slug
                                        </label>
                                        <div className="flex items-center gap-2 pt-2">
                                            <input
                                                type="text"
                                                value={tempSlug}
                                                onChange={(e) => {
                                                    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
                                                    setTempSlug(val);
                                                    setSlugError('');
                                                }}
                                                className="w-full bg-transparent border-none focus:outline-none focus:ring-0 text-primary font-bold text-[15px]"
                                                placeholder="VD: binh-hoa-chu-tinh-tinh-hoa"
                                            />
                                        </div>
                                    </div>
                                    {slugError && <p className="text-[11px] text-brick font-bold">{slugError}</p>}
                                    <div className="bg-amber-50 border border-amber-100 p-3 rounded-sm">
                                        <p className="text-[11px] text-amber-700 leading-relaxed">
                                            <span className="font-bold">Lưu ý:</span> Việc đổi slug sẽ thay đổi URL của sản phẩm. Các link cũ đã chia sẻ hoặc được index bởi Google có thể bị lỗi 404 nếu không có redirect.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="shrink-0 p-4 bg-stone/5 border-t border-stone/10 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowSlugModal(false)}
                                    className="px-6 py-2 text-[11px] font-bold uppercase tracking-widest text-stone hover:text-primary transition-all"
                                >
                                    Hủy bỏ
                                </button>
                                <button
                                    onClick={() => {
                                        if (!tempSlug.trim()) {
                                            setSlugError('Đường dẫn không được để trống.');
                                            return;
                                        }
                                        setFormData(prev => ({ ...prev, slug: tempSlug }));
                                        setShowSlugModal(false);
                                        showToast({ message: 'Đã cập nhật slug mới cho sản phẩm. Đừng quên nhấn "Lưu cập nhật"!', type: 'info' });
                                    }}
                                    className="px-8 py-2 bg-gold text-white text-[11px] font-bold uppercase tracking-widest rounded-sm hover:bg-gold/80 transition-all shadow-sm"
                                >
                                    Xác nhận thay đổi
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ProductForm;
