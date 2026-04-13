import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Pagination from '../Pagination';
import { productApi, productImageApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { compressImage } from '../../utils/imageUtils';
import { resolveImageObjectUrl, resolveMediaUrl } from '../../utils/mediaUrl';
import { resolveImageUploadError } from '../../utils/uploadError';

const ACCEPTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const ACCEPTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
]);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_SERVER_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_BATCH_SIZE = 2;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];
const DRAG_SELECTION_THRESHOLD = 6;
const FILE_INPUT_VISUALLY_HIDDEN_CLASS = 'sr-only';

function chunkItems(items = [], size = 1) {
    const normalizedSize = Math.max(1, Number(size) || 1);
    const chunks = [];

    for (let index = 0; index < items.length; index += normalizedSize) {
        chunks.push(items.slice(index, index + normalizedSize));
    }

    return chunks;
}

function moveArrayItem(items = [], fromIndex, toIndex) {
    const normalizedItems = Array.isArray(items) ? [...items] : [];

    if (
        fromIndex < 0
        || toIndex < 0
        || fromIndex >= normalizedItems.length
        || toIndex >= normalizedItems.length
        || fromIndex === toIndex
    ) {
        return normalizedItems;
    }

    const [movedItem] = normalizedItems.splice(fromIndex, 1);
    normalizedItems.splice(toIndex, 0, movedItem);
    return normalizedItems;
}

function extractFileExtension(name = '') {
    const normalizedName = String(name || '').trim();
    const lastDotIndex = normalizedName.lastIndexOf('.');

    if (lastDotIndex < 0) {
        return '';
    }

    return normalizedName.slice(lastDotIndex + 1).toLowerCase();
}

function createClientActionError(message) {
    const error = new Error(message);
    error.userMessage = message;
    return error;
}

function buildOrderedUniqueKeys(keys = []) {
    return Array.from(
        new Set(
            (Array.isArray(keys) ? keys : [])
                .map((key) => String(key || '').trim())
                .filter(Boolean),
        ),
    );
}

function toSelectedFileArray(fileList) {
    return Array.from(fileList || []).filter(Boolean);
}

function normalizeNoticeType(type = 'info') {
    if (type === 'error' || type === 'success' || type === 'warning') {
        return type;
    }

    return 'info';
}

function getNoticeClassName(type = 'info') {
    switch (normalizeNoticeType(type)) {
    case 'error':
        return 'border-brick/20 bg-brick/5 text-brick';
    case 'success':
        return 'border-green-200 bg-green-50 text-green-800';
    case 'warning':
        return 'border-gold/25 bg-gold/10 text-gold';
    default:
        return 'border-primary/20 bg-primary/[0.04] text-primary';
    }
}

function openFilePicker(inputElement, actionLabel = 'thêm ảnh') {
    if (!inputElement || typeof inputElement !== 'object') {
        throw createClientActionError(`Không tìm thấy ô chọn file để ${actionLabel}.`);
    }

    if (inputElement.disabled) {
        throw createClientActionError(`Ô chọn file đang bận nên chưa thể ${actionLabel}.`);
    }

    if (typeof inputElement.showPicker === 'function') {
        inputElement.showPicker();
        return;
    }

    if (typeof inputElement.click === 'function') {
        inputElement.click();
        return;
    }

    throw createClientActionError(`Trình duyệt không hỗ trợ mở ô chọn file để ${actionLabel}.`);
}

function isSelectionToggleModifier(event) {
    return Boolean(event?.ctrlKey || event?.metaKey);
}

function buildImageRangeKeys(images = [], startKey, endKey) {
    const orderedKeys = (Array.isArray(images) ? images : []).map((image) => String(image?.key || ''));
    const normalizedStartKey = String(startKey || '').trim();
    const normalizedEndKey = String(endKey || '').trim();
    const startIndex = orderedKeys.findIndex((key) => key === normalizedStartKey);
    const endIndex = orderedKeys.findIndex((key) => key === normalizedEndKey);

    if (startIndex < 0 || endIndex < 0) {
        return normalizedEndKey ? [normalizedEndKey] : [];
    }

    const [fromIndex, toIndex] = startIndex <= endIndex
        ? [startIndex, endIndex]
        : [endIndex, startIndex];

    return orderedKeys.slice(fromIndex, toIndex + 1);
}

function normalizeSelectionRect(startX, startY, endX, endY) {
    const left = Math.min(startX, endX);
    const right = Math.max(startX, endX);
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);

    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

function rectanglesIntersect(rect, targetRect) {
    if (!rect || !targetRect) {
        return false;
    }

    return !(
        rect.right < targetRect.left
        || rect.left > targetRect.right
        || rect.bottom < targetRect.top
        || rect.top > targetRect.bottom
    );
}

function getImageSortScore(image) {
    return [
        image?.is_primary ? 0 : 1,
        Number(image?.sort_order ?? Number.MAX_SAFE_INTEGER),
        Number(image?.id ?? Number.MAX_SAFE_INTEGER),
    ];
}

function normalizeProductImages(images = []) {
    if (!Array.isArray(images)) {
        return [];
    }

    return [...images]
        .map((image) => ({
            ...image,
            preview_url: resolveImageObjectUrl(image, 'thumbnail', image?.image_url || ''),
            full_url: resolveImageObjectUrl(image, 'large', image?.image_url || ''),
        }))
        .sort((left, right) => {
            const leftScore = getImageSortScore(left);
            const rightScore = getImageSortScore(right);

            for (let index = 0; index < leftScore.length; index += 1) {
                if (leftScore[index] !== rightScore[index]) {
                    return leftScore[index] - rightScore[index];
                }
            }

            return 0;
        });
}

function normalizeProductItem(product) {
    const normalizedImages = normalizeProductImages(product?.images || []);
    const categoryName = String(product?.category?.name || product?.category_name || '').trim();
    const searchText = [
        product?.name,
        product?.sku,
        categoryName,
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

    return {
        ...product,
        images: normalizedImages,
        search_text: searchText,
        primary_image_url: normalizedImages[0]?.preview_url || resolveMediaUrl(product?.main_image || ''),
    };
}

function getImageFileLabel(image, index) {
    const explicitFileName = String(image?.file_name || '').trim();
    if (explicitFileName) {
        return explicitFileName;
    }

    const resolvedUrl = String(image?.image_url || image?.full_url || image?.preview_url || '').trim();
    if (resolvedUrl) {
        try {
            const pathname = new URL(resolvedUrl, window.location.origin).pathname;
            const derivedName = pathname.split('/').pop();
            if (derivedName) {
                return decodeURIComponent(derivedName);
            }
        } catch {
            const fallbackName = resolvedUrl.split('/').pop();
            if (fallbackName) {
                return fallbackName;
            }
        }
    }

    return `Ảnh ${index + 1}`;
}

function validateUploadFile(file) {
    if (!file) {
        return 'Vui lòng chọn ảnh hợp lệ.';
    }

    const fileType = String(file.type || '').trim().toLowerCase();
    const extension = extractFileExtension(file.name);
    const isAcceptedType = (fileType && ACCEPTED_IMAGE_MIME_TYPES.has(fileType))
        || (extension && ACCEPTED_IMAGE_EXTENSIONS.has(extension));

    if (!isAcceptedType) {
        return 'Chỉ hỗ trợ ảnh JPG, JPEG, PNG, GIF hoặc WEBP cho thao tác này.';
    }

    if (Number(file.size || 0) > MAX_UPLOAD_BYTES) {
        return 'Ảnh vượt quá giới hạn 15MB. Hãy chọn ảnh nhẹ hơn rồi thử lại.';
    }

    return '';
}

function resolveActionErrorMessage(error, fallbackMessage) {
    const uploadError = resolveImageUploadError(error);
    if (uploadError?.message) {
        return uploadError.message;
    }

    const serverMessage = error?.response?.data?.message || error?.response?.data?.error;
    if (typeof serverMessage === 'string' && serverMessage.trim() !== '') {
        return serverMessage;
    }

    const validationErrors = error?.response?.data?.errors;
    if (validationErrors && typeof validationErrors === 'object') {
        const firstError = Object.values(validationErrors)
            .flat()
            .find((value) => typeof value === 'string' && value.trim() !== '');

        if (firstError) {
            return firstError;
        }
    }

    if (typeof error?.message === 'string' && error.message.trim() !== '') {
        return error.message;
    }

    return fallbackMessage;
}

function createServerDraftImage(image, index) {
    return {
        key: `existing-${image.id}`,
        persistedId: image.id,
        file: null,
        preview_url: image.preview_url || resolveImageObjectUrl(image, 'thumbnail', image?.image_url || ''),
        full_url: image.full_url || resolveImageObjectUrl(image, 'large', image?.image_url || ''),
        file_name: image.file_name || getImageFileLabel(image, index),
        file_size: Number(image.file_size || 0),
        is_primary: Boolean(image.is_primary),
        sort_order: Number(image.sort_order ?? index),
        uploading: false,
        upload_status_label: '',
    };
}

function normalizeDraftImages(images = []) {
    const normalized = (Array.isArray(images) ? images : [])
        .filter(Boolean)
        .map((image, index) => ({
            ...image,
            key: String(image.key || `draft-${index}`),
            persistedId: image.persistedId ?? null,
            file: image.file || null,
            preview_url: image.preview_url || '',
            full_url: image.full_url || image.preview_url || '',
            file_name: image.file_name || `Ảnh ${index + 1}`,
            file_size: Number(image.file_size || 0),
            is_primary: Boolean(image.is_primary),
            sort_order: Number(image.sort_order ?? index),
            uploading: Boolean(image.uploading),
            upload_status_label: String(image.upload_status_label || '').trim(),
        }));

    if (normalized.length === 0) {
        return [];
    }

    const primaryIndex = normalized.findIndex((image) => image.is_primary);
    const targetPrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;
    const orderedImages = targetPrimaryIndex > 0
        ? [
            normalized[targetPrimaryIndex],
            ...normalized.filter((_, index) => index !== targetPrimaryIndex),
        ]
        : normalized;

    return orderedImages.map((image, index) => ({
        ...image,
        is_primary: index === 0,
        sort_order: index,
    }));
}

function buildBaseDraftImages(product) {
    return normalizeDraftImages((product?.images || []).map((image, index) => createServerDraftImage(image, index)));
}

function hasDraftChanges(baseImages = [], draftImages = []) {
    if (baseImages.length !== draftImages.length) {
        return true;
    }

    return draftImages.some((draftImage, index) => {
        if (!draftImage?.persistedId) {
            return true;
        }

        const baseImage = baseImages[index];
        return String(baseImage?.persistedId || baseImage?.id || '') !== String(draftImage.persistedId || '');
    });
}

function extractUploadedImages(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    const candidateGroups = [
        payload?.data,
        payload?.images,
        payload?.uploadedImages,
        payload?.uploaded_images,
        payload?.items,
        payload?.result,
        payload?.results,
        payload?.payload,
    ];

    for (const candidate of candidateGroups) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }

    if (payload?.data && typeof payload.data === 'object') {
        return extractUploadedImages(payload.data);
    }

    if (payload && typeof payload === 'object' && payload.id) {
        return [payload];
    }

    return [];
}

function parseSelectedIds(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function ProductCategoryImageManagerModal({
    open,
    scopeLabel = '',
    listQueryParams = {},
    onClose,
    onChanged,
}) {
    const { showToast } = useUI();
    const addInputRef = useRef(null);
    const replaceInputRef = useRef(null);
    const bulkInputRef = useRef(null);
    const loadRequestRef = useRef(0);
    const pendingAddProductIdRef = useRef(null);
    const pendingReplaceRef = useRef(null);
    const noticeTimeoutRef = useRef(null);
    const draftImageSequenceRef = useRef(0);
    const draftObjectUrlsRef = useRef(new Set());
    const selectionAnchorMapRef = useRef({});
    const imageViewportRefs = useRef({});
    const imageCardRefs = useRef({});
    const dragSelectionRef = useRef(null);

    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [searchText, setSearchText] = useState('');
    const [showOnlyWithoutImages, setShowOnlyWithoutImages] = useState(false);
    const [selectedProductIds, setSelectedProductIds] = useState([]);
    const [busyProductMap, setBusyProductMap] = useState({});
    const [productUploadStateMap, setProductUploadStateMap] = useState({});
    const [notice, setNotice] = useState(null);
    const [bulkProgress, setBulkProgress] = useState({ running: false, current: 0, total: 0, mode: '' });
    const [previewImage, setPreviewImage] = useState(null);
    const [productDraftMap, setProductDraftMap] = useState({});
    const [selectedImageKeysMap, setSelectedImageKeysMap] = useState({});
    const [pageSize, setPageSize] = useState(10);
    const [currentPage, setCurrentPage] = useState(1);
    const [dragSelection, setDragSelection] = useState(null);
    const [imageSortDrag, setImageSortDrag] = useState(null);

    const canClose = !loading && !bulkProgress.running && Object.keys(busyProductMap).length === 0;
    const hasBusyProducts = Object.keys(busyProductMap).length > 0;

    const stopDragSelection = useCallback(() => {
        const activeDrag = dragSelectionRef.current;
        if (activeDrag?.moveHandler) {
            window.removeEventListener('mousemove', activeDrag.moveHandler);
        }
        if (activeDrag?.upHandler) {
            window.removeEventListener('mouseup', activeDrag.upHandler);
        }

        dragSelectionRef.current = null;
        setDragSelection(null);
    }, []);

    const clearImageSortDrag = useCallback(() => {
        setImageSortDrag(null);
    }, []);

    const revokeAllDraftObjectUrls = useCallback(() => {
        draftObjectUrlsRef.current.forEach((url) => {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // Ignore revoke failures for already released blobs.
            }
        });
        draftObjectUrlsRef.current.clear();
    }, []);

    useEffect(() => () => {
        revokeAllDraftObjectUrls();
    }, [revokeAllDraftObjectUrls]);

    useEffect(() => () => {
        stopDragSelection();
    }, [stopDragSelection]);

    const pushNotice = useCallback((type, message, options = {}) => {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) {
            return;
        }

        const normalizedType = normalizeNoticeType(type);
        setNotice({ type: normalizedType, message: normalizedMessage });

        const shouldToast = options.toast ?? normalizedType === 'error';
        if (shouldToast) {
            showToast({
                message: normalizedMessage,
                type: normalizedType,
                duration: Number(options.duration) > 0 ? Number(options.duration) : (normalizedType === 'error' ? 6500 : 2600),
            });
        }

        const consoleMethod = normalizedType === 'error'
            ? 'error'
            : normalizedType === 'warning'
                ? 'warn'
                : 'info';

        if (options.meta !== undefined) {
            console[consoleMethod]('[ProductCategoryImageManagerModal]', normalizedMessage, options.meta);
            return;
        }

        console[consoleMethod]('[ProductCategoryImageManagerModal]', normalizedMessage);
    }, [showToast]);

    useEffect(() => {
        if (noticeTimeoutRef.current) {
            clearTimeout(noticeTimeoutRef.current);
            noticeTimeoutRef.current = null;
        }

        if (!notice?.message) {
            return undefined;
        }

        noticeTimeoutRef.current = window.setTimeout(() => {
            setNotice(null);
            noticeTimeoutRef.current = null;
        }, 4200);

        return () => {
            if (noticeTimeoutRef.current) {
                clearTimeout(noticeTimeoutRef.current);
                noticeTimeoutRef.current = null;
            }
        };
    }, [notice]);

    const markProductBusy = useCallback((productId, busy) => {
        const normalizedKey = String(productId);

        setBusyProductMap((current) => {
            if (busy) {
                if (current[normalizedKey]) {
                    return current;
                }

                return {
                    ...current,
                    [normalizedKey]: true,
                };
            }

            if (!current[normalizedKey]) {
                return current;
            }

            const next = { ...current };
            delete next[normalizedKey];
            return next;
        });
    }, []);

    const updateProductInState = useCallback((productId, updater) => {
        const normalizedKey = String(productId);

        setProducts((currentProducts) => currentProducts.map((product) => {
            if (String(product.id) !== normalizedKey) {
                return product;
            }

            const nextProduct = typeof updater === 'function' ? updater(product) : updater;
            return normalizeProductItem(nextProduct);
        }));
    }, []);

    const createLocalDraftImage = useCallback((file, options = {}) => {
        draftImageSequenceRef.current += 1;
        const objectUrl = URL.createObjectURL(file);
        draftObjectUrlsRef.current.add(objectUrl);

        return {
            key: `local-${Date.now()}-${draftImageSequenceRef.current}`,
            persistedId: null,
            file,
            preview_url: objectUrl,
            full_url: objectUrl,
            file_name: file.name || options.fileName || 'Ảnh mới',
            file_size: Number(file.size || 0),
            is_primary: Boolean(options.isPrimary),
            sort_order: Number(options.sortOrder ?? 0),
            uploading: Boolean(options.uploading),
            upload_status_label: String(options.uploadStatusLabel || '').trim(),
        };
    }, []);

    const getProductById = useCallback((productId) => (
        products.find((product) => String(product.id) === String(productId)) || null
    ), [products]);

    const getWorkingImages = useCallback((product) => {
        const productKey = String(product.id);
        return productDraftMap[productKey]?.images || buildBaseDraftImages(product);
    }, [productDraftMap]);

    const clearProductDraft = useCallback((productId) => {
        const productKey = String(productId);

        setProductDraftMap((current) => {
            if (!current[productKey]) {
                return current;
            }

            const next = { ...current };
            delete next[productKey];
            return next;
        });

        setSelectedImageKeysMap((current) => {
            if (!current[productKey]) {
                return current;
            }

            const next = { ...current };
            delete next[productKey];
            return next;
        });

        setProductUploadStateMap((current) => {
            if (!current[productKey]) {
                return current;
            }

            const next = { ...current };
            delete next[productKey];
            return next;
        });

        delete selectionAnchorMapRef.current[productKey];
        delete imageViewportRefs.current[productKey];
        delete imageCardRefs.current[productKey];
        setImageSortDrag((current) => (
            current?.productId === productKey ? null : current
        ));
    }, []);

    const updateDraftImages = useCallback((productId, updater) => {
        const productKey = String(productId);
        const product = products.find((item) => String(item.id) === productKey);

        if (!product) {
            return [];
        }

        let nextImages = [];
        setProductDraftMap((current) => {
            const baseImages = current[productKey]?.images || buildBaseDraftImages(product);
            nextImages = normalizeDraftImages(
                typeof updater === 'function' ? updater(baseImages) : updater,
            );

            return {
                ...current,
                [productKey]: {
                    images: nextImages,
                },
            };
        });

        return nextImages;
    }, [products]);

    const clearAllDraftState = useCallback(() => {
        stopDragSelection();
        clearImageSortDrag();
        revokeAllDraftObjectUrls();
        setProductDraftMap({});
        setSelectedImageKeysMap({});
        setProductUploadStateMap({});
        setPreviewImage(null);
        selectionAnchorMapRef.current = {};
        imageViewportRefs.current = {};
        imageCardRefs.current = {};
    }, [clearImageSortDrag, revokeAllDraftObjectUrls, stopDragSelection]);

    const hasUnsavedChanges = useMemo(
        () => Object.keys(productDraftMap).length > 0,
        [productDraftMap],
    );

    const dirtyProductIds = useMemo(() => (
        Object.keys(productDraftMap).filter((productId) => {
            const product = getProductById(productId);
            if (!product) {
                return false;
            }

            return hasDraftChanges(buildBaseDraftImages(product), productDraftMap[productId]?.images || []);
        })
    ), [getProductById, productDraftMap]);

    const selectedImageCount = useMemo(
        () => Object.values(selectedImageKeysMap).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0),
        [selectedImageKeysMap],
    );

    const setSelectedImagesForProduct = useCallback((productId, nextValue) => {
        const productKey = String(productId);

        setSelectedImageKeysMap((current) => {
            const currentKeys = current[productKey] || [];
            const nextKeys = buildOrderedUniqueKeys(
                typeof nextValue === 'function' ? nextValue(currentKeys) : nextValue,
            );
            const normalizedCurrentKeys = buildOrderedUniqueKeys(currentKeys);

            if (
                normalizedCurrentKeys.length === nextKeys.length
                && normalizedCurrentKeys.every((key, index) => key === nextKeys[index])
            ) {
                return current;
            }

            if (nextKeys.length === 0) {
                if (!current[productKey]) {
                    return current;
                }

                const next = { ...current };
                delete next[productKey];
                return next;
            }

            return {
                ...current,
                [productKey]: nextKeys,
            };
        });
    }, []);

    const setProductUploadState = useCallback((productId, nextValue) => {
        const productKey = String(productId);

        setProductUploadStateMap((current) => {
            const currentValue = current[productKey] || null;
            const resolvedValue = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue;

            if (!resolvedValue?.message) {
                if (!current[productKey]) {
                    return current;
                }

                const next = { ...current };
                delete next[productKey];
                return next;
            }

            const normalizedValue = {
                type: normalizeNoticeType(resolvedValue.type),
                message: String(resolvedValue.message || '').trim(),
            };

            if (
                currentValue?.type === normalizedValue.type
                && currentValue?.message === normalizedValue.message
            ) {
                return current;
            }

            return {
                ...current,
                [productKey]: normalizedValue,
            };
        });
    }, []);

    const clearProductUploadState = useCallback((productId) => {
        const productKey = String(productId);

        setProductUploadStateMap((current) => {
            if (!current[productKey]) {
                return current;
            }

            const next = { ...current };
            delete next[productKey];
            return next;
        });
    }, []);

    const registerImageViewport = useCallback((productId, node) => {
        const productKey = String(productId);
        if (node) {
            imageViewportRefs.current[productKey] = node;
            return;
        }

        delete imageViewportRefs.current[productKey];
    }, []);

    const registerImageCard = useCallback((productId, imageKey, node) => {
        const productKey = String(productId);
        const normalizedImageKey = String(imageKey || '');

        if (!normalizedImageKey) {
            return;
        }

        if (node) {
            imageCardRefs.current[productKey] = imageCardRefs.current[productKey] || {};
            imageCardRefs.current[productKey][normalizedImageKey] = node;
            return;
        }

        if (!imageCardRefs.current[productKey]) {
            return;
        }

        delete imageCardRefs.current[productKey][normalizedImageKey];
        if (Object.keys(imageCardRefs.current[productKey]).length === 0) {
            delete imageCardRefs.current[productKey];
        }
    }, []);

    const applyImageSelection = useCallback((productId, workingImages, imageKey, options = {}) => {
        const productKey = String(productId);
        const normalizedImageKey = String(imageKey || '').trim();

        if (!normalizedImageKey) {
            return;
        }

        const orderedKeys = (Array.isArray(workingImages) ? workingImages : [])
            .map((image) => String(image?.key || '').trim())
            .filter(Boolean);
        if (!orderedKeys.includes(normalizedImageKey)) {
            return;
        }

        const shiftKey = Boolean(options.shiftKey);
        const toggleKey = Boolean(options.toggleKey);
        const currentAnchor = selectionAnchorMapRef.current[productKey];
        const rangeAnchor = currentAnchor || normalizedImageKey;

        setSelectedImagesForProduct(productId, (currentKeys) => {
            const normalizedCurrentKeys = buildOrderedUniqueKeys(currentKeys);

            if (shiftKey) {
                const rangeKeys = buildImageRangeKeys(workingImages, rangeAnchor, normalizedImageKey);
                if (toggleKey) {
                    const nextSet = new Set([...normalizedCurrentKeys, ...rangeKeys]);
                    return orderedKeys.filter((key) => nextSet.has(key));
                }

                return rangeKeys;
            }

            if (toggleKey) {
                return normalizedCurrentKeys.includes(normalizedImageKey)
                    ? normalizedCurrentKeys.filter((key) => key !== normalizedImageKey)
                    : [...normalizedCurrentKeys, normalizedImageKey];
            }

            return [normalizedImageKey];
        });

        if (!shiftKey || !currentAnchor) {
            selectionAnchorMapRef.current[productKey] = normalizedImageKey;
        }
    }, [setSelectedImagesForProduct]);

    const updateSelectionFromDrag = useCallback((dragState, clientX, clientY) => {
        if (!dragState) {
            return;
        }

        const viewportNode = imageViewportRefs.current[dragState.productKey];
        if (!viewportNode) {
            return;
        }

        const selectionRect = normalizeSelectionRect(
            dragState.originX,
            dragState.originY,
            clientX,
            clientY,
        );
        const viewportRect = viewportNode.getBoundingClientRect();
        const productCardNodes = imageCardRefs.current[dragState.productKey] || {};
        const hitKeys = dragState.orderedKeys.filter((imageKey) => rectanglesIntersect(
            productCardNodes[imageKey]?.getBoundingClientRect?.(),
            selectionRect,
        ));

        let nextKeys = hitKeys;
        if (dragState.mode === 'add') {
            const nextSet = new Set([...dragState.baseKeys, ...hitKeys]);
            nextKeys = dragState.orderedKeys.filter((key) => nextSet.has(key));
        } else if (dragState.mode === 'toggle') {
            const nextSet = new Set(dragState.baseKeys);
            hitKeys.forEach((key) => {
                if (nextSet.has(key)) {
                    nextSet.delete(key);
                } else {
                    nextSet.add(key);
                }
            });
            nextKeys = dragState.orderedKeys.filter((key) => nextSet.has(key));
        }

        setSelectedImagesForProduct(dragState.productId, nextKeys);
        setDragSelection({
            productId: dragState.productKey,
            left: selectionRect.left - viewportRect.left + viewportNode.scrollLeft,
            top: selectionRect.top - viewportRect.top + viewportNode.scrollTop,
            width: selectionRect.width,
            height: selectionRect.height,
        });
    }, [setSelectedImagesForProduct]);

    const beginImageDragSelection = useCallback((event, productId, imageKey, workingImages) => {
        if (event.button !== 0) {
            return;
        }

        const target = event.target;
        if (target instanceof HTMLElement && target.closest('button, input, label, a')) {
            return;
        }

        const orderedKeys = (Array.isArray(workingImages) ? workingImages : [])
            .map((image) => String(image?.key || '').trim())
            .filter(Boolean);
        const normalizedImageKey = String(imageKey || '').trim();
        const productKey = String(productId);

        if (!normalizedImageKey || !orderedKeys.includes(normalizedImageKey)) {
            return;
        }

        event.preventDefault();
        stopDragSelection();

        if (!event.shiftKey) {
            selectionAnchorMapRef.current[productKey] = normalizedImageKey;
        }

        const dragState = {
            productId,
            productKey,
            imageKey: normalizedImageKey,
            originX: event.clientX,
            originY: event.clientY,
            workingImages,
            orderedKeys,
            baseKeys: buildOrderedUniqueKeys(selectedImageKeysMap[productKey] || []),
            mode: isSelectionToggleModifier(event)
                ? 'toggle'
                : event.shiftKey
                    ? 'add'
                    : 'replace',
            didMove: false,
            moveHandler: null,
            upHandler: null,
        };

        const moveHandler = (moveEvent) => {
            if (
                !dragState.didMove
                && Math.max(
                    Math.abs(moveEvent.clientX - dragState.originX),
                    Math.abs(moveEvent.clientY - dragState.originY),
                ) < DRAG_SELECTION_THRESHOLD
            ) {
                return;
            }

            dragState.didMove = true;
            updateSelectionFromDrag(dragState, moveEvent.clientX, moveEvent.clientY);
        };

        const upHandler = (upEvent) => {
            const shouldToggle = isSelectionToggleModifier(upEvent);
            const shouldShiftSelect = Boolean(upEvent.shiftKey);

            if (!dragState.didMove) {
                applyImageSelection(productId, workingImages, normalizedImageKey, {
                    shiftKey: shouldShiftSelect,
                    toggleKey: shouldToggle,
                });
            }

            stopDragSelection();
        };

        dragState.moveHandler = moveHandler;
        dragState.upHandler = upHandler;
        dragSelectionRef.current = dragState;

        window.addEventListener('mousemove', moveHandler);
        window.addEventListener('mouseup', upHandler, { once: true });
    }, [applyImageSelection, selectedImageKeysMap, stopDragSelection, updateSelectionFromDrag]);

    const loadScopeProducts = useCallback(async () => {
        if (!open) {
            return;
        }

        const baseQueryParams = listQueryParams && typeof listQueryParams === 'object'
            ? listQueryParams
            : {};
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        setLoading(true);
        setErrorMessage('');

        try {
            let page = 1;
            let lastPage = 1;
            const loadedProducts = [];

            while (page <= lastPage) {
                const response = await productApi.getAll({
                    ...baseQueryParams,
                    page,
                    per_page: Math.max(100, Number(baseQueryParams.per_page || 100) || 100),
                    is_trash: 0,
                });

                const payload = response?.data || {};
                const pageItems = Array.isArray(payload.data) ? payload.data : [];

                loadedProducts.push(...pageItems);
                lastPage = Math.max(1, Number(payload.last_page || 1));
                page += 1;
            }

            if (loadRequestRef.current !== requestId) {
                return;
            }

            const normalizedProducts = loadedProducts.map((product) => normalizeProductItem(product));
            const requestedSelectedIds = new Set(parseSelectedIds(baseQueryParams.selected_ids));

            clearAllDraftState();
            setProducts(normalizedProducts);
            setSelectedProductIds(
                requestedSelectedIds.size > 0
                    ? normalizedProducts
                        .filter((product) => requestedSelectedIds.has(String(product.id)))
                        .map((product) => product.id)
                    : [],
            );
            setCurrentPage(1);
        } catch (error) {
            if (loadRequestRef.current !== requestId) {
                return;
            }

            clearAllDraftState();
            setProducts([]);
            setSelectedProductIds([]);
            setErrorMessage(resolveActionErrorMessage(error, 'Không thể tải danh sách sản phẩm cho bảng quản lí ảnh.'));
        } finally {
            if (loadRequestRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [clearAllDraftState, listQueryParams, open]);

    useEffect(() => {
        if (!open) {
            return;
        }

        setSearchText('');
        setShowOnlyWithoutImages(false);
        setNotice(null);
        setPageSize(10);
        setCurrentPage(1);
        void loadScopeProducts();
    }, [loadScopeProducts, open]);

    const refreshProduct = useCallback(async (productId) => {
        const response = await productApi.getOne(productId);
        updateProductInState(productId, response?.data || {});
    }, [updateProductInState]);

    const getProductDisplayLabel = useCallback((productId) => {
        const product = getProductById(productId);
        const productName = String(product?.name || '').trim();
        return productName || `sản phẩm #${productId}`;
    }, [getProductById]);

    const prepareFiles = useCallback(async (files) => {
        const normalizedFiles = Array.from(files || []).filter(Boolean);

        if (normalizedFiles.length === 0) {
            throw new Error('Hãy chọn ít nhất 1 ảnh để tiếp tục.');
        }

        normalizedFiles.forEach((file) => {
            const validationMessage = validateUploadFile(file);
            if (validationMessage) {
                throw new Error(validationMessage);
            }
        });

        const preparedFiles = [];
        for (const file of normalizedFiles) {
            try {
                preparedFiles.push(await compressImage(file));
            } catch {
                preparedFiles.push(file);
            }
        }

        return preparedFiles;
    }, []);

    const prepareUploadFiles = useCallback(async (files) => {
        const normalizedFiles = Array.from(files || []).filter(Boolean);

        if (normalizedFiles.length === 0) {
            throw createClientActionError('Hãy chọn ít nhất 1 ảnh để tiếp tục.');
        }

        normalizedFiles.forEach((file) => {
            const validationMessage = validateUploadFile(file);
            if (validationMessage) {
                throw createClientActionError(validationMessage);
            }
        });

        const preparedFiles = [];
        for (const file of normalizedFiles) {
            try {
                const preparedFile = await compressImage(file);
                if (Number(preparedFile?.size || 0) > MAX_SERVER_UPLOAD_BYTES) {
                    throw createClientActionError(
                        `Ảnh "${file.name}" vẫn vượt quá 5MB sau khi nén. Hãy dùng ảnh nhẹ hơn hoặc giảm kích thước ảnh gốc rồi thử lại.`,
                    );
                }

                preparedFiles.push(preparedFile);
            } catch (error) {
                if (error?.userMessage) {
                    throw error;
                }

                if (Number(file?.size || 0) > MAX_SERVER_UPLOAD_BYTES) {
                    throw createClientActionError(
                        `Không thể nén ảnh "${file.name}" xuống dưới 5MB để tải lên. Hãy đổi ảnh khác rồi thử lại.`,
                    );
                }

                preparedFiles.push(file);
            }
        }

        return preparedFiles;
    }, []);

    const uploadPreparedFiles = useCallback(async (productId, preparedFiles) => {
        const uploadBatch = async (files) => {
            const uploadedImages = [];

            for (const batch of chunkItems(files, UPLOAD_BATCH_SIZE)) {
                const formData = new FormData();
                batch.forEach((file) => {
                    formData.append('images[]', file, file.name || `image-${Date.now()}.jpg`);
                });

                const response = await productImageApi.upload(productId, formData);
                const batchImages = extractUploadedImages(response?.data);

                if (batchImages.length === 0) {
                    throw new Error('API upload không trả về dữ liệu ảnh hợp lệ.');
                }

                uploadedImages.push(...batchImages);
            }

            return uploadedImages;
        };

        try {
            return await uploadBatch(preparedFiles);
        } catch (error) {
            const uploadError = resolveImageUploadError(error);
            if (uploadError?.code === 'UPLOAD_REQUEST_FAILED') {
                return uploadBatch(preparedFiles);
            }

            throw error;
        }
    }, []);

    const uploadFilesIntoDraft = useCallback(async (productId, files, options = {}) => {
        const {
            mode = 'append',
            replaceImageKey = null,
            silentNotice = false,
        } = options;
        const normalizedFiles = toSelectedFileArray(files);

        if (normalizedFiles.length === 0) {
            throw createClientActionError('Không nhận được file ảnh nào từ hộp chọn file. Hãy chọn lại ảnh rồi thử tiếp.');
        }

        if (mode === 'replace' && normalizedFiles.length !== 1) {
            throw createClientActionError('Mỗi lần chỉ có thể thay đúng 1 ảnh.');
        }

        markProductBusy(productId, true);
        const productLabel = getProductDisplayLabel(productId);
        const placeholderImages = normalizedFiles.map((file) => createLocalDraftImage(file, {
            uploading: true,
            uploadStatusLabel: 'Đang nén ảnh',
        }));
        let placeholderKeys = [];
        let previousImageSnapshot = null;
        let previousReplaceKey = String(replaceImageKey || '').trim();

        try {
            placeholderKeys = placeholderImages.map((image) => String(image.key));

            if (mode === 'replace') {
                const replacementPlaceholder = placeholderImages[0];

                updateDraftImages(productId, (currentImages) => {
                    const targetIndex = currentImages.findIndex((image) => String(image.key) === previousReplaceKey);
                    if (targetIndex < 0) {
                        throw createClientActionError('Không tìm thấy ảnh cần thay trong bản nháp hiện tại.');
                    }

                    const targetImage = currentImages[targetIndex];
                    previousImageSnapshot = targetImage;
                    const nextImages = [...currentImages];
                    nextImages.splice(targetIndex, 1, {
                        ...replacementPlaceholder,
                        is_primary: targetImage.is_primary,
                        sort_order: targetImage.sort_order,
                    });
                    return nextImages;
                });

                setSelectedImagesForProduct(productId, (currentKeys) => currentKeys.map((key) => (
                    String(key) === previousReplaceKey
                        ? replacementPlaceholder.key
                        : key
                )));

                if (selectionAnchorMapRef.current[String(productId)] === previousReplaceKey) {
                    selectionAnchorMapRef.current[String(productId)] = replacementPlaceholder.key;
                }
                previousReplaceKey = replacementPlaceholder.key;
            } else if (placeholderImages.length > 0) {
                updateDraftImages(productId, (currentImages) => ([
                    ...currentImages,
                    ...placeholderImages,
                ]));
            }

            const compressingMessage = mode === 'replace'
                ? `Đã chọn 1 ảnh thay thế cho "${productLabel}". Đang nén ảnh...`
                : `Đã chọn ${normalizedFiles.length} ảnh cho "${productLabel}". Đang nén ảnh...`;
            setProductUploadState(productId, {
                type: 'info',
                message: compressingMessage,
            });
            if (!silentNotice) {
                pushNotice('info', compressingMessage, {
                    toast: true,
                    duration: 2400,
                    meta: {
                        productId,
                        stage: 'compressing',
                        fileCount: normalizedFiles.length,
                        mode,
                    },
                });
            }

            const preparedFiles = await prepareUploadFiles(normalizedFiles);

            if (placeholderKeys.length > 0) {
                const placeholderKeySet = new Set(placeholderKeys);
                let preparedIndex = 0;

                updateDraftImages(productId, (currentImages) => currentImages.map((image) => {
                    if (!placeholderKeySet.has(String(image.key))) {
                        return image;
                    }

                    const preparedFile = preparedFiles[preparedIndex];
                    preparedIndex += 1;

                    return {
                        ...image,
                        file: preparedFile || image.file,
                        file_name: preparedFile?.name || image.file_name,
                        file_size: Number(preparedFile?.size || image.file_size || 0),
                        upload_status_label: 'Đang tải lên',
                    };
                }));
            }

            const uploadingMessage = mode === 'replace'
                ? `Đang tải ảnh thay thế lên cho "${productLabel}"...`
                : `Đang tải ${preparedFiles.length} ảnh lên cho "${productLabel}"...`;
            setProductUploadState(productId, {
                type: 'info',
                message: uploadingMessage,
            });
            if (!silentNotice) {
                pushNotice('info', uploadingMessage, {
                    toast: true,
                    duration: 2400,
                    meta: {
                        productId,
                        stage: 'uploading',
                        fileCount: preparedFiles.length,
                        mode,
                    },
                });
            }

            const uploadedImages = await uploadPreparedFiles(productId, preparedFiles);
            if (uploadedImages.length !== preparedFiles.length) {
                throw createClientActionError('Máy chủ trả về thiếu ảnh sau khi upload. Vui lòng thử lại.');
            }

            const uploadedDraftImages = uploadedImages.map((image, index) => ({
                ...createServerDraftImage(image, index),
                file_name: preparedFiles[index]?.name || image?.file_name || getImageFileLabel(image, index),
                file_size: Number(preparedFiles[index]?.size || image?.file_size || 0),
            }));

            if (mode === 'replace') {
                const replacementImage = uploadedDraftImages[0];
                const activePlaceholderKey = String(placeholderKeys[0] || previousReplaceKey || '');

                updateDraftImages(productId, (currentImages) => {
                    const targetIndex = currentImages.findIndex((image) => String(image.key) === activePlaceholderKey);
                    if (targetIndex < 0) {
                        throw createClientActionError('Không tìm thấy ảnh cần thay trong bản nháp hiện tại.');
                    }

                    const targetImage = currentImages[targetIndex];
                    const nextImages = [...currentImages];
                    nextImages.splice(targetIndex, 1, {
                        ...replacementImage,
                        is_primary: targetImage.is_primary,
                    });
                    return nextImages;
                });

                setSelectedImagesForProduct(productId, (currentKeys) => currentKeys.map((key) => (
                    String(key) === activePlaceholderKey
                        ? replacementImage.key
                        : key
                )));
                if (selectionAnchorMapRef.current[String(productId)] === activePlaceholderKey) {
                    selectionAnchorMapRef.current[String(productId)] = replacementImage.key;
                }
            } else {
                const placeholderKeySet = new Set(placeholderKeys);
                updateDraftImages(productId, (currentImages) => {
                    const replacementQueue = [...uploadedDraftImages];

                    return currentImages.flatMap((image) => {
                        if (!placeholderKeySet.has(String(image.key))) {
                            return [image];
                        }

                        const nextImage = replacementQueue.shift();
                        return nextImage ? [nextImage] : [];
                    });
                });
            }

            if (!silentNotice) {
                pushNotice(
                    'success',
                    mode === 'replace'
                        ? 'Ảnh mới đã tải lên thành công và đang chờ Lưu để áp dụng thay thế.'
                        : `Đã tải lên ${uploadedDraftImages.length} ảnh và gắn vào đúng sản phẩm. Hãy bấm Lưu để chốt thứ tự hoặc ảnh chính.`,
                    {
                        toast: true,
                        duration: 3200,
                        meta: {
                            productId,
                            stage: 'success',
                            fileCount: uploadedDraftImages.length,
                            mode,
                        },
                    },
                );
            }

            return uploadedDraftImages;
        } catch (error) {
            if (mode === 'replace') {
                const activePlaceholderKey = String(placeholderKeys[0] || previousReplaceKey || '');

                if (activePlaceholderKey && previousImageSnapshot) {
                    updateDraftImages(productId, (currentImages) => currentImages.map((image) => (
                        String(image.key) === activePlaceholderKey
                            ? previousImageSnapshot
                            : image
                    )));

                    setSelectedImagesForProduct(productId, (currentKeys) => currentKeys.map((key) => (
                        String(key) === activePlaceholderKey
                            ? previousImageSnapshot.key
                            : key
                    )));

                    if (selectionAnchorMapRef.current[String(productId)] === activePlaceholderKey) {
                        selectionAnchorMapRef.current[String(productId)] = previousImageSnapshot.key;
                    }
                }
            } else if (placeholderKeys.length > 0) {
                const placeholderKeySet = new Set(placeholderKeys);
                updateDraftImages(productId, (currentImages) => (
                    currentImages.filter((image) => !placeholderKeySet.has(String(image.key)))
                ));
            }

            throw error;
        } finally {
            clearProductUploadState(productId);
            markProductBusy(productId, false);
        }
    }, [
        createLocalDraftImage,
        getProductDisplayLabel,
        markProductBusy,
        prepareUploadFiles,
        pushNotice,
        clearProductUploadState,
        setProductUploadState,
        setSelectedImagesForProduct,
        updateDraftImages,
        uploadPreparedFiles,
    ]);

    const discardUploadedDraftImages = useCallback(async () => {
        const cleanupTargets = Object.entries(productDraftMap).flatMap(([productId, draftEntry]) => {
            const product = getProductById(productId);
            if (!product) {
                return [];
            }

            const baseIds = new Set(
                buildBaseDraftImages(product).map((image) => String(image.persistedId || image.id || '')),
            );

            return (draftEntry?.images || [])
                .filter((image) => image?.persistedId && !baseIds.has(String(image.persistedId)))
                .map((image) => ({
                    productId,
                    imageId: image.persistedId,
                }));
        });

        if (cleanupTargets.length === 0) {
            clearAllDraftState();
            return true;
        }

        setBulkProgress({ running: true, current: 0, total: cleanupTargets.length, mode: 'discard' });

        try {
            for (let index = 0; index < cleanupTargets.length; index += 1) {
                const target = cleanupTargets[index];
                await productImageApi.destroy(target.imageId);
                setBulkProgress({
                    running: true,
                    current: index + 1,
                    total: cleanupTargets.length,
                    mode: 'discard',
                });
            }

            clearAllDraftState();
            return true;
        } catch (error) {
            pushNotice(
                'error',
                `${resolveActionErrorMessage(error, 'Không thể hoàn tác ảnh mới đã tải lên trong bản nháp.')} Một số ảnh mới có thể vẫn còn trên máy chủ.`,
            );
            return false;
        } finally {
            setBulkProgress({ running: false, current: 0, total: 0, mode: '' });
        }
    }, [clearAllDraftState, getProductById, productDraftMap, pushNotice]);

    const filteredProducts = useMemo(() => {
        const normalizedSearch = String(searchText || '').trim().toLowerCase();

        return products.filter((product) => {
            const workingImages = getWorkingImages(product);

            if (showOnlyWithoutImages && workingImages.length > 0) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            return String(product.search_text || '').includes(normalizedSearch);
        });
    }, [getWorkingImages, products, searchText, showOnlyWithoutImages]);

    useEffect(() => {
        setCurrentPage(1);
    }, [pageSize, searchText, showOnlyWithoutImages]);

    const lastPage = Math.max(1, Math.ceil(filteredProducts.length / pageSize));

    useEffect(() => {
        if (currentPage > lastPage) {
            setCurrentPage(lastPage);
        }
    }, [currentPage, lastPage]);

    const paginatedProducts = useMemo(() => {
        const startIndex = (Math.max(1, currentPage) - 1) * pageSize;
        return filteredProducts.slice(startIndex, startIndex + pageSize);
    }, [currentPage, filteredProducts, pageSize]);

    const paginationState = useMemo(() => ({
        current_page: Math.max(1, currentPage),
        last_page: lastPage,
        total: filteredProducts.length,
        per_page: pageSize,
    }), [currentPage, filteredProducts.length, lastPage, pageSize]);

    const visibleProductIds = useMemo(
        () => paginatedProducts.map((product) => String(product.id)),
        [paginatedProducts],
    );

    const selectedProductKeySet = useMemo(
        () => new Set(selectedProductIds.map((id) => String(id))),
        [selectedProductIds],
    );

    const allVisibleSelected = visibleProductIds.length > 0
        && visibleProductIds.every((id) => selectedProductKeySet.has(id));

    const toggleSelectProduct = useCallback((productId) => {
        const normalizedId = String(productId);

        setSelectedProductIds((current) => (
            current.some((id) => String(id) === normalizedId)
                ? current.filter((id) => String(id) !== normalizedId)
                : [...current, productId]
        ));
    }, []);

    const handleSelectAllVisible = useCallback(() => {
        setSelectedProductIds((current) => {
            const currentKeys = new Set(current.map((id) => String(id)));
            if (allVisibleSelected) {
                return current.filter((id) => !visibleProductIds.includes(String(id)));
            }

            const next = [...current];
            visibleProductIds.forEach((id) => {
                if (!currentKeys.has(id)) {
                    const matchedProduct = paginatedProducts.find((product) => String(product.id) === id);
                    if (matchedProduct) {
                        next.push(matchedProduct.id);
                    }
                }
            });

            return next;
        });
    }, [allVisibleSelected, paginatedProducts, visibleProductIds]);

    const stageFilesForProduct = useCallback((productId, files) => {
        const normalizedFiles = Array.from(files || []).filter(Boolean);

        if (normalizedFiles.length === 0) {
            throw new Error('Hãy chọn ít nhất 1 ảnh để tiếp tục.');
        }

        normalizedFiles.forEach((file) => {
            const validationMessage = validateUploadFile(file);
            if (validationMessage) {
                throw new Error(validationMessage);
            }
        });

        updateDraftImages(productId, (currentImages) => ([
            ...currentImages,
            ...normalizedFiles.map((file) => createLocalDraftImage(file)),
        ]));
    }, [createLocalDraftImage, updateDraftImages]);

    const handleAddImagesToProduct = useCallback((productId, files) => {
        try {
            stageFilesForProduct(productId, files);
            pushNotice('success', `Đã thêm ${Array.from(files || []).length} ảnh vào bản nháp của sản phẩm.`);
        } catch (error) {
            pushNotice('error', resolveActionErrorMessage(error, 'Không thể thêm ảnh vào bản nháp.'));
        }
    }, [pushNotice, stageFilesForProduct]);

    const handleReplaceImage = useCallback((productId, imageKey, file) => {
        try {
            const validationMessage = validateUploadFile(file);
            if (validationMessage) {
                throw new Error(validationMessage);
            }

            updateDraftImages(productId, (currentImages) => {
                const targetIndex = currentImages.findIndex((image) => String(image.key) === String(imageKey));
                if (targetIndex < 0) {
                    throw new Error('Không tìm thấy ảnh cần thay trong bản nháp hiện tại.');
                }

                const targetImage = currentImages[targetIndex];
                const replacementImage = createLocalDraftImage(file, {
                    isPrimary: targetImage.is_primary,
                });

                const nextImages = [...currentImages];
                nextImages.splice(targetIndex, 1, replacementImage);
                return nextImages;
            });

            setSelectedImageKeysMap((current) => {
                const productKey = String(productId);
                const currentKeys = current[productKey] || [];
                if (!currentKeys.includes(imageKey)) {
                    return current;
                }

                return {
                    ...current,
                    [productKey]: currentKeys.filter((key) => key !== imageKey),
                };
            });

            pushNotice('success', 'Đã thay ảnh trong bản nháp. Hãy bấm Lưu để áp dụng.');
        } catch (error) {
            pushNotice('error', resolveActionErrorMessage(error, 'Không thể thay ảnh này.'));
        }
    }, [createLocalDraftImage, pushNotice, updateDraftImages]);

    const handleUploadImagesToProduct = useCallback(async (productId, files) => {
        try {
            await uploadFilesIntoDraft(productId, files, { mode: 'append' });
        } catch (error) {
            pushNotice('error', resolveActionErrorMessage(error, 'Không thể tải ảnh lên cho sản phẩm này.'));
        }
    }, [pushNotice, uploadFilesIntoDraft]);

    const handleUploadReplacementImage = useCallback(async (productId, imageKey, file) => {
        try {
            await uploadFilesIntoDraft(productId, [file], {
                mode: 'replace',
                replaceImageKey: imageKey,
            });
        } catch (error) {
            pushNotice('error', resolveActionErrorMessage(error, 'Không thể thay ảnh này.'));
        }
    }, [pushNotice, uploadFilesIntoDraft]);

    const handleDeleteImage = useCallback((productId, imageKey) => {
        updateDraftImages(productId, (currentImages) => (
            currentImages.filter((image) => String(image.key) !== String(imageKey))
        ));

        setSelectedImagesForProduct(
            productId,
            (currentKeys) => currentKeys.filter((key) => String(key) !== String(imageKey)),
        );

        setImageSortDrag((current) => (
            current?.productId === String(productId)
            && (current?.imageKey === String(imageKey) || current?.overKey === String(imageKey))
                ? null
                : current
        ));

        pushNotice('success', 'Ảnh đã được đưa ra khỏi bản nháp của sản phẩm.');
    }, [pushNotice, setSelectedImagesForProduct, updateDraftImages]);

    const handleDeleteSelectedImages = useCallback(() => {
        const entries = Object.entries(selectedImageKeysMap)
            .filter(([, keys]) => Array.isArray(keys) && keys.length > 0);

        if (entries.length === 0) {
            pushNotice('error', 'Hãy chọn ít nhất 1 ảnh để xóa nhanh.');
            return;
        }

        const totalSelected = entries.reduce((sum, [, keys]) => sum + keys.length, 0);
        if (!window.confirm(`Đưa ${totalSelected} ảnh đã chọn ra khỏi bản nháp?`)) {
            return;
        }

        entries.forEach(([productId, keys]) => {
            const selectedKeys = new Set(keys.map((key) => String(key)));
            updateDraftImages(productId, (currentImages) => (
                currentImages.filter((image) => !selectedKeys.has(String(image.key)))
            ));
        });

        clearImageSortDrag();
        setSelectedImageKeysMap({});
        pushNotice('success', `Đã xóa nhanh ${totalSelected} ảnh khỏi bản nháp.`);
    }, [clearImageSortDrag, pushNotice, selectedImageKeysMap, updateDraftImages]);

    const handleSetPrimaryImage = useCallback((productId, imageKey) => {
        updateDraftImages(productId, (currentImages) => {
            const targetIndex = currentImages.findIndex((image) => String(image.key) === String(imageKey));
            if (targetIndex < 0) {
                return currentImages;
            }

            const nextImages = currentImages.map((image) => ({
                ...image,
                is_primary: String(image.key) === String(imageKey),
            }));
            return moveArrayItem(nextImages, targetIndex, 0);
        });

        pushNotice('success', 'Đã chọn ảnh chính trong bản nháp. Hãy bấm Lưu để áp dụng.');
    }, [pushNotice, updateDraftImages]);

    const resolveImageSortPlacement = useCallback((event, image) => {
        if (image?.is_primary) {
            return 'after';
        }

        const targetRect = event.currentTarget.getBoundingClientRect();
        return event.clientX >= targetRect.left + (targetRect.width / 2) ? 'after' : 'before';
    }, []);

    const handleImageSortDragStart = useCallback((event, productId, imageKey, image) => {
        const productKey = String(productId);
        const normalizedImageKey = String(imageKey || '').trim();

        if (!normalizedImageKey || image?.is_primary || image?.uploading) {
            event.preventDefault();
            return;
        }

        stopDragSelection();

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `${productKey}:${normalizedImageKey}`);
        }

        setImageSortDrag({
            productId: productKey,
            imageKey: normalizedImageKey,
            overKey: normalizedImageKey,
            placement: 'after',
        });
    }, [stopDragSelection]);

    const handleImageSortDragOver = useCallback((event, productId, imageKey, image) => {
        const productKey = String(productId);
        const normalizedImageKey = String(imageKey || '').trim();

        if (!imageSortDrag || imageSortDrag.productId !== productKey || !normalizedImageKey) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }

        const placement = resolveImageSortPlacement(event, image);
        setImageSortDrag((current) => {
            if (!current || current.productId !== productKey) {
                return current;
            }

            if (current.overKey === normalizedImageKey && current.placement === placement) {
                return current;
            }

            return {
                ...current,
                overKey: normalizedImageKey,
                placement,
            };
        });
    }, [imageSortDrag, resolveImageSortPlacement]);

    const handleImageSortDrop = useCallback((event, productId, imageKey, image) => {
        const productKey = String(productId);
        const normalizedImageKey = String(imageKey || '').trim();

        if (!imageSortDrag || imageSortDrag.productId !== productKey || !normalizedImageKey) {
            return;
        }

        event.preventDefault();
        const placement = resolveImageSortPlacement(event, image);

        updateDraftImages(productId, (currentImages) => {
            const sourceIndex = currentImages.findIndex((item) => String(item.key) === imageSortDrag.imageKey);
            const targetIndex = currentImages.findIndex((item) => String(item.key) === normalizedImageKey);

            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
                return currentImages;
            }

            if (currentImages[sourceIndex]?.is_primary) {
                return currentImages;
            }

            const nextImages = [...currentImages];
            const [movedImage] = nextImages.splice(sourceIndex, 1);
            let insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;

            if (placement === 'after') {
                insertIndex += 1;
            }

            const minimumIndex = nextImages[0]?.is_primary ? 1 : 0;
            insertIndex = Math.max(minimumIndex, Math.min(nextImages.length, insertIndex));
            nextImages.splice(insertIndex, 0, movedImage);
            return nextImages;
        });

        clearImageSortDrag();
    }, [clearImageSortDrag, imageSortDrag, resolveImageSortPlacement, updateDraftImages]);

    const handleBulkAddImages = useCallback(async (files) => {
        const targetIds = selectedProductIds
            .map((id) => String(id))
            .filter((id) => products.some((product) => String(product.id) === id));

        if (targetIds.length === 0) {
            pushNotice('error', 'Hãy chọn ít nhất 1 sản phẩm để thêm ảnh hàng loạt.');
            return;
        }

        const normalizedFiles = Array.from(files || []).filter(Boolean);
        if (normalizedFiles.length === 0) {
            return;
        }

        try {
            normalizedFiles.forEach((file) => {
                const validationMessage = validateUploadFile(file);
                if (validationMessage) {
                    throw new Error(validationMessage);
                }
            });

            setBulkProgress({ running: true, current: 0, total: targetIds.length, mode: 'draft' });

            for (let index = 0; index < targetIds.length; index += 1) {
                const productId = targetIds[index];

                updateDraftImages(productId, (currentImages) => ([
                    ...currentImages,
                    ...normalizedFiles.map((file) => createLocalDraftImage(file)),
                ]));

                setBulkProgress({
                    running: true,
                    current: index + 1,
                    total: targetIds.length,
                    mode: 'draft',
                });
            }

            pushNotice('success', `Đã áp cùng bộ ảnh vào bản nháp của ${targetIds.length} sản phẩm.`);
        } catch (error) {
            pushNotice('error', resolveActionErrorMessage(error, 'Không thể chuẩn bị bộ ảnh để thêm hàng loạt.'));
        } finally {
            setBulkProgress({ running: false, current: 0, total: 0, mode: '' });
        }
    }, [createLocalDraftImage, products, pushNotice, selectedProductIds, updateDraftImages]);

    const handleBulkUploadImages = useCallback(async (files) => {
        const targetIds = selectedProductIds
            .map((id) => String(id))
            .filter((id) => products.some((product) => String(product.id) === id));

        if (targetIds.length === 0) {
            pushNotice('error', 'Hãy chọn ít nhất 1 sản phẩm để thêm ảnh hàng loạt.');
            return;
        }

        const normalizedFiles = Array.from(files || []).filter(Boolean);
        if (normalizedFiles.length === 0) {
            return;
        }

        try {
            setBulkProgress({ running: true, current: 0, total: targetIds.length, mode: 'upload' });

            for (let index = 0; index < targetIds.length; index += 1) {
                await uploadFilesIntoDraft(targetIds[index], normalizedFiles, {
                    mode: 'append',
                    silentNotice: true,
                });

                setBulkProgress({
                    running: true,
                    current: index + 1,
                    total: targetIds.length,
                    mode: 'upload',
                });
            }

            pushNotice('success', `Đã tải cùng bộ ảnh lên ${targetIds.length} sản phẩm. Hãy bấm Lưu để chốt thứ tự hoặc ảnh chính.`);
        } catch (error) {
            pushNotice('error', resolveActionErrorMessage(error, 'Không thể tải bộ ảnh lên cho các sản phẩm đã chọn.'));
        } finally {
            setBulkProgress({ running: false, current: 0, total: 0, mode: '' });
        }
    }, [products, pushNotice, selectedProductIds, uploadFilesIntoDraft]);

    const persistProductDraft = useCallback(async (productId, options = {}) => {
        const { silent = false } = options;
        const product = getProductById(productId);

        if (!product) {
            const result = {
                status: 'error',
                message: `Không tìm thấy sản phẩm #${productId} trong danh sách hiện tại.`,
            };

            if (!silent) {
                pushNotice('error', result.message);
            }

            return result;
        }

        const productKey = String(productId);
        const draftImages = productDraftMap[productKey]?.images || [];
        const baseImages = buildBaseDraftImages(product);

        if (!hasDraftChanges(baseImages, draftImages)) {
            clearProductDraft(productId);

            const result = {
                status: 'noop',
                message: 'Không có thay đổi mới để lưu cho sản phẩm này.',
            };

            if (!silent) {
                pushNotice('success', result.message);
            }

            return result;
        }

        markProductBusy(productId, true);
        let didMutateServer = false;

        try {
            const localImages = draftImages.filter((image) => !image.persistedId && image.file);
            const uploadedByKey = {};

            if (localImages.length > 0) {
                const preparedFiles = await prepareUploadFiles(localImages.map((image) => image.file));
                const uploadedImages = await uploadPreparedFiles(productId, preparedFiles);
                didMutateServer = uploadedImages.length > 0;

                if (uploadedImages.length !== localImages.length) {
                    throw new Error('Máy chủ trả về thiếu ảnh sau khi upload. Vui lòng bấm Lưu lại.');
                }

                localImages.forEach((image, index) => {
                    uploadedByKey[image.key] = uploadedImages[index];
                });
            }

            const keptPersistedIds = new Set(
                draftImages
                    .filter((image) => image.persistedId)
                    .map((image) => String(image.persistedId)),
            );

            const deletedImageIds = baseImages
                .filter((image) => !keptPersistedIds.has(String(image.persistedId || image.id)))
                .map((image) => image.persistedId || image.id)
                .filter(Boolean);

            for (const imageId of deletedImageIds) {
                await productImageApi.destroy(imageId);
                didMutateServer = true;
            }

            const finalOrderedIds = draftImages.map((image) => {
                if (image.persistedId) {
                    return image.persistedId;
                }

                const uploadedImage = uploadedByKey[image.key];
                if (!uploadedImage?.id) {
                    throw new Error('Không xác định được ảnh mới vừa upload.');
                }

                return uploadedImage.id;
            });

            if (finalOrderedIds.length > 0) {
                const preferredPrimaryIndex = draftImages.findIndex((image) => image.is_primary);
                const preferredPrimaryId = preferredPrimaryIndex >= 0
                    ? finalOrderedIds[preferredPrimaryIndex] || null
                    : (finalOrderedIds[0] || null);

                await productImageApi.reorder(finalOrderedIds);

                if (preferredPrimaryId) {
                    await productImageApi.setPrimary(preferredPrimaryId);
                }

                didMutateServer = true;
            }

            await refreshProduct(productId);
            clearProductDraft(productId);
            onChanged?.();

            const result = {
                status: 'saved',
                message: `Đã lưu hình ảnh cho sản phẩm "${product.name || `#${productId}`}".`,
            };

            if (!silent) {
                pushNotice('success', result.message);
            }

            return result;
        } catch (error) {
            if (didMutateServer) {
                try {
                    await refreshProduct(productId);
                } catch {
                    // Ignore refresh failures after partial mutation.
                }

                clearProductDraft(productId);
            }

            const result = {
                status: 'error',
                message: didMutateServer
                    ? `${resolveActionErrorMessage(error, 'Không thể lưu thay đổi ảnh cho sản phẩm này.')} Dữ liệu sản phẩm đã được tải lại từ máy chủ để tránh lệch trạng thái.`
                    : resolveActionErrorMessage(error, 'Không thể lưu thay đổi ảnh cho sản phẩm này.'),
            };

            if (!silent) {
                pushNotice('error', result.message);
            }

            return result;
        } finally {
            markProductBusy(productId, false);
        }
    }, [
        clearProductDraft,
        getProductById,
        markProductBusy,
        onChanged,
        prepareUploadFiles,
        productDraftMap,
        pushNotice,
        refreshProduct,
        uploadPreparedFiles,
    ]);

    const handleSaveProduct = useCallback((productId) => {
        void persistProductDraft(productId);
    }, [persistProductDraft]);

    const handleSaveAllDrafts = useCallback(async () => {
        if (hasBusyProducts) {
            pushNotice('error', 'Có sản phẩm vẫn đang nén hoặc tải ảnh lên. Hãy chờ xong rồi lưu.');
            return;
        }

        const targetIds = dirtyProductIds
            .filter((productId) => Boolean(getProductById(productId)));

        if (targetIds.length === 0) {
            pushNotice('error', 'Không có sản phẩm nào đang có thay đổi ảnh chưa lưu.');
            return;
        }

        setBulkProgress({ running: true, current: 0, total: targetIds.length, mode: 'save' });

        let savedCount = 0;
        let failedCount = 0;

        for (let index = 0; index < targetIds.length; index += 1) {
            const productId = targetIds[index];
            const result = await persistProductDraft(productId, { silent: true });

            if (result.status === 'saved' || result.status === 'noop') {
                savedCount += 1;
            } else {
                failedCount += 1;
            }

            setBulkProgress({
                running: true,
                current: index + 1,
                total: targetIds.length,
                mode: 'save',
            });
        }

        setBulkProgress({ running: false, current: 0, total: 0, mode: '' });

        if (failedCount === 0) {
            pushNotice('success', `Đã lưu thay đổi ảnh cho ${savedCount} sản phẩm.`);
            return;
        }

        if (savedCount > 0) {
            pushNotice('error', `Đã lưu ${savedCount} sản phẩm, còn ${failedCount} sản phẩm bị lỗi khi lưu.`);
            return;
        }

        pushNotice('error', 'Không lưu được thay đổi ảnh cho các sản phẩm đã chỉnh.');
    }, [dirtyProductIds, getProductById, hasBusyProducts, persistProductDraft, pushNotice]);

    const openImageInputPicker = useCallback((inputRef, actionLabel, pendingCleanup) => {
        try {
            openFilePicker(inputRef?.current, actionLabel);
            return true;
        } catch (error) {
            if (typeof pendingCleanup === 'function') {
                pendingCleanup();
            }

            pushNotice('error', resolveActionErrorMessage(error, `Không thể mở hộp chọn file để ${actionLabel}.`), {
                toast: true,
                meta: error,
            });
            return false;
        }
    }, [pushNotice]);

    const triggerAddProductImages = useCallback((productId) => {
        pendingAddProductIdRef.current = productId;
        openImageInputPicker(addInputRef, 'thêm ảnh cho sản phẩm', () => {
            pendingAddProductIdRef.current = null;
        });
    }, [openImageInputPicker]);

    const triggerReplaceImage = useCallback((productId, imageKey) => {
        pendingReplaceRef.current = { productId, imageKey };
        openImageInputPicker(replaceInputRef, 'thay ảnh của sản phẩm', () => {
            pendingReplaceRef.current = null;
        });
    }, [openImageInputPicker]);

    const triggerBulkUploadImages = useCallback(() => {
        openImageInputPicker(bulkInputRef, 'thêm ảnh hàng loạt');
    }, [openImageInputPicker]);

    const handleAddInputChange = useCallback((event) => {
        const selectedFiles = toSelectedFileArray(event.target.files);
        const targetProductId = pendingAddProductIdRef.current;

        event.target.value = '';
        pendingAddProductIdRef.current = null;

        if (selectedFiles.length === 0) {
            return;
        }

        if (!targetProductId) {
            pushNotice('error', 'Không xác định được sản phẩm nhận ảnh. Hãy bấm Thêm ảnh lại.', { toast: true });
            return;
        }

        void handleUploadImagesToProduct(targetProductId, selectedFiles);
    }, [handleUploadImagesToProduct, pushNotice]);

    const handleReplaceInputChange = useCallback((event) => {
        const selectedFiles = toSelectedFileArray(event.target.files);
        const pendingTarget = pendingReplaceRef.current;

        event.target.value = '';
        pendingReplaceRef.current = null;

        if (selectedFiles.length === 0) {
            return;
        }

        if (!pendingTarget?.productId || !pendingTarget?.imageKey) {
            pushNotice('error', 'Không xác định được ảnh cần thay. Hãy bấm Thay ảnh lại.', { toast: true });
            return;
        }

        void handleUploadReplacementImage(pendingTarget.productId, pendingTarget.imageKey, selectedFiles[0]);
    }, [handleUploadReplacementImage, pushNotice]);

    const handleBulkInputChange = useCallback((event) => {
        const selectedFiles = toSelectedFileArray(event.target.files);
        event.target.value = '';

        if (selectedFiles.length === 0) {
            return;
        }

        pushNotice('info', `Đã chọn ${selectedFiles.length} ảnh để thêm cho các sản phẩm đã chọn.`, {
            toast: true,
            duration: 2200,
            meta: {
                stage: 'bulk-selected',
                fileCount: selectedFiles.length,
            },
        });

        void handleBulkUploadImages(selectedFiles);
    }, [handleBulkUploadImages, pushNotice]);

    const confirmDiscardUnsavedChanges = useCallback(() => {
        if (!hasUnsavedChanges) {
            return true;
        }

        return window.confirm('Bạn đang có thay đổi ảnh chưa lưu. Tiếp tục sẽ bỏ các thay đổi này.');
    }, [hasUnsavedChanges]);

    const handleReload = useCallback(() => {
        if (loading || bulkProgress.running) {
            return;
        }

        if (!confirmDiscardUnsavedChanges()) {
            return;
        }

        setSelectedProductIds([]);
        void loadScopeProducts();
    }, [bulkProgress.running, confirmDiscardUnsavedChanges, loadScopeProducts, loading]);

    const handleImageCheckboxToggle = useCallback((event, productId, imageKey, workingImages) => {
        const productKey = String(productId);
        const normalizedImageKey = String(imageKey || '').trim();
        const orderedKeys = (Array.isArray(workingImages) ? workingImages : [])
            .map((image) => String(image?.key || '').trim())
            .filter(Boolean);

        if (!normalizedImageKey || !orderedKeys.includes(normalizedImageKey)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.shiftKey) {
            const anchorKey = selectionAnchorMapRef.current[productKey] || normalizedImageKey;
            const rangeKeys = buildImageRangeKeys(workingImages, anchorKey, normalizedImageKey);

            setSelectedImagesForProduct(productId, (currentKeys) => {
                const nextSet = new Set(buildOrderedUniqueKeys(currentKeys));
                rangeKeys.forEach((key) => nextSet.add(key));
                return orderedKeys.filter((key) => nextSet.has(key));
            });
        } else {
            setSelectedImagesForProduct(productId, (currentKeys) => {
                const normalizedCurrentKeys = buildOrderedUniqueKeys(currentKeys);
                return normalizedCurrentKeys.includes(normalizedImageKey)
                    ? normalizedCurrentKeys.filter((key) => key !== normalizedImageKey)
                    : [...normalizedCurrentKeys, normalizedImageKey];
            });
        }

        selectionAnchorMapRef.current[productKey] = normalizedImageKey;
    }, [setSelectedImagesForProduct]);

    const confirmDiscardUnsavedChangesAsync = useCallback(async () => {
        if (!hasUnsavedChanges) {
            return true;
        }

        if (!window.confirm('Bạn đang có thay đổi ảnh chưa lưu. Tiếp tục sẽ bỏ các thay đổi này.')) {
            return false;
        }

        return discardUploadedDraftImages();
    }, [discardUploadedDraftImages, hasUnsavedChanges]);

    const confirmClosePopupAsync = useCallback(async () => {
        if (!hasUnsavedChanges) {
            return true;
        }

        if (!window.confirm('Bạn đang có ảnh hoặc dữ liệu nháp chưa lưu. Nếu đóng popup lúc này, toàn bộ thay đổi nháp sẽ mất. Bạn có chắc muốn đóng không?')) {
            return false;
        }

        return discardUploadedDraftImages();
    }, [discardUploadedDraftImages, hasUnsavedChanges]);

    const handleReloadAsync = useCallback(async () => {
        if (loading || bulkProgress.running) {
            return;
        }

        if (!(await confirmDiscardUnsavedChangesAsync())) {
            return;
        }

        setSelectedProductIds([]);
        void loadScopeProducts();
    }, [bulkProgress.running, confirmDiscardUnsavedChangesAsync, loadScopeProducts, loading]);

    const renderProductCard = (product) => {
        const isSelected = selectedProductKeySet.has(String(product.id));
        const isBusy = Boolean(busyProductMap[String(product.id)]);
        const workingImages = getWorkingImages(product);
        const productKey = String(product.id);
        const selectedImageKeys = new Set((selectedImageKeysMap[productKey] || []).map((key) => String(key)));
        const isDirty = dirtyProductIds.includes(productKey);
        const productUploadState = productUploadStateMap[productKey] || null;

        return (
            <div
                key={product.id}
                className={`rounded-sm border p-2.5 transition-all ${
                    isSelected ? 'border-primary/35 bg-primary/[0.03]' : 'border-primary/10 bg-white'
                }`}
            >
                <div className="flex items-start gap-2">
                    <label className="pt-1">
                        <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={isSelected}
                            onChange={() => toggleSelectProduct(product.id)}
                        />
                    </label>

                    <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-black text-[#0F172A]" title={product.name || `Sản phẩm #${product.id}`}>
                                    {product.name || `Sản phẩm #${product.id}`}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-primary/55">
                                    <span className="font-mono">{product.sku || 'Chưa có SKU'}</span>
                                    <span>ID {product.id}</span>
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold uppercase tracking-[0.12em] text-primary">
                                        {workingImages.length} ảnh
                                    </span>
                                    {isDirty ? (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold uppercase tracking-[0.12em] text-amber-700">
                                            Chưa lưu
                                        </span>
                                    ) : null}
                                    {(selectedImageKeysMap[productKey] || []).length > 0 ? (
                                        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold uppercase tracking-[0.12em] text-primary">
                                            {(selectedImageKeysMap[productKey] || []).length} chọn
                                        </span>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => triggerAddProductImages(product.id)}
                                    disabled={isBusy || bulkProgress.running || hasBusyProducts}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-primary/20 text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Thêm ảnh"
                                    aria-label="Thêm ảnh"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSaveProduct(product.id)}
                                    disabled={!isDirty || isBusy || bulkProgress.running || hasBusyProducts}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Lưu sản phẩm"
                                    aria-label="Lưu sản phẩm"
                                >
                                    <span className="material-symbols-outlined text-[18px]">save</span>
                                </button>
                            </div>
                        </div>

                        {productUploadState?.message ? (
                            <div className={`mt-2 rounded-sm border px-2.5 py-2 text-[11px] ${getNoticeClassName(productUploadState.type)}`}>
                                {productUploadState.message}
                            </div>
                        ) : null}

                        <div className="mt-3">
                            {workingImages.length === 0 ? (
                                <button
                                    type="button"
                                    onClick={() => triggerAddProductImages(product.id)}
                                    disabled={isBusy || bulkProgress.running || hasBusyProducts}
                                    className="w-full rounded-sm border border-dashed border-primary/20 bg-primary/[0.02] px-3 py-6 text-center text-[12px] text-primary/60 hover:bg-primary/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Thêm ảnh"
                                >
                                    <span className="material-symbols-outlined text-[24px]">imagesmode</span>
                                    <div className="mt-2 font-bold text-primary">Chưa có ảnh</div>
                                </button>
                            ) : (
                                <div
                                    ref={(node) => registerImageViewport(product.id, node)}
                                    className="relative"
                                >
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                                    {workingImages.map((image, index) => {
                                        const imageKey = String(image.key);
                                        const fileLabel = getImageFileLabel(image, index);
                                        const isImageSelected = selectedImageKeys.has(imageKey);
                                        const isImageSortDropTarget = imageSortDrag?.productId === productKey
                                            && imageSortDrag?.overKey === imageKey
                                            && imageSortDrag?.imageKey !== imageKey;
                                        const dragHandleDisabled = isBusy
                                            || bulkProgress.running
                                            || hasBusyProducts
                                            || image.uploading
                                            || image.is_primary
                                            || workingImages.length < 2;

                                        return (
                                            <div
                                                key={imageKey}
                                                ref={(node) => registerImageCard(product.id, imageKey, node)}
                                                onMouseDown={(event) => beginImageDragSelection(event, product.id, imageKey, workingImages)}
                                                onDragOver={(event) => handleImageSortDragOver(event, product.id, imageKey, image)}
                                                onDrop={(event) => handleImageSortDrop(event, product.id, imageKey, image)}
                                                className={`relative min-w-0 rounded-sm border overflow-hidden shadow-sm select-none transition-[border-color,box-shadow,background-color] ${isImageSelected ? 'border-primary/40 ring-1 ring-primary/15 bg-primary/[0.02]' : 'border-primary/10 bg-white'} ${image.uploading ? 'opacity-85' : ''} ${isImageSortDropTarget ? 'border-gold/45 bg-gold/5 ring-1 ring-gold/20' : ''}`}
                                            >
                                                {isImageSortDropTarget ? (
                                                    <div
                                                        className={`pointer-events-none absolute inset-y-0 z-30 w-1.5 bg-gold/70 ${imageSortDrag?.placement === 'before' ? 'left-0' : 'right-0'}`}
                                                    />
                                                ) : null}
                                                <div
                                                    className="relative w-full aspect-[4/3] overflow-hidden bg-primary/[0.04]"
                                                    onDoubleClick={() => setPreviewImage({
                                                        url: image.full_url || image.preview_url,
                                                        fileName: fileLabel,
                                                        productName: product.name,
                                                    })}
                                                    title="Bấm ảnh để chọn nhanh, bấm dấu tích để thêm hoặc bỏ chọn, double click để xem lớn"
                                                >
                                                    {image.preview_url ? (
                                                        <img
                                                            src={image.preview_url}
                                                            alt={fileLabel}
                                                            className="h-full w-full object-cover"
                                                            draggable="false"
                                                        />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center text-primary/20">
                                                            <span className="material-symbols-outlined text-[28px]">image</span>
                                                        </div>
                                                    )}

                                                    {image.uploading ? (
                                                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/78 text-primary backdrop-blur-[1px]">
                                                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                                            <span className="text-[9px] font-black uppercase tracking-[0.14em]">
                                                                {image.upload_status_label || 'Đang xử lý ảnh'}
                                                            </span>
                                                        </div>
                                                    ) : null}

                                                    <label className="absolute left-1.5 top-1.5 z-30 inline-flex items-center justify-center rounded-full bg-white/95 shadow px-1 py-0.5">
                                                        <input
                                                            type="checkbox"
                                                            className="size-3 accent-primary"
                                                            checked={isImageSelected}
                                                            onClick={(event) => handleImageCheckboxToggle(event, product.id, imageKey, workingImages)}
                                                            onChange={() => {}}
                                                        />
                                                    </label>

                                                    <span className="absolute left-7 top-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[8px] font-bold text-white">
                                                        #{index + 1}
                                                    </span>

                                                    {image.is_primary ? (
                                                        <span className="absolute right-1.5 top-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-white">
                                                            Chính
                                                        </span>
                                                    ) : null}

                                                    {!image.persistedId ? (
                                                        <span className="absolute right-1.5 bottom-1.5 rounded-full bg-sky-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-white">
                                                            Mới
                                                        </span>
                                                    ) : null}
                                                </div>

                                                <div className="flex items-center gap-1.5 border-t border-primary/10 px-2 py-1.5">
                                                    <p className="min-w-0 flex-1 truncate text-[9px] font-bold text-primary" title={fileLabel}>
                                                        {fileLabel}
                                                    </p>
                                                    <p className="shrink-0 text-[8px] uppercase tracking-[0.12em] text-primary/35">
                                                        {image.file_size ? `${Math.round(image.file_size / 1024)} KB` : 'Không rõ dung lượng'}
                                                    </p>
                                                </div>

                                                <div className="grid grid-cols-4 border-t border-primary/10">
                                                    <button
                                                        type="button"
                                                        disabled={isBusy || bulkProgress.running || hasBusyProducts || image.is_primary}
                                                        onClick={() => handleSetPrimaryImage(product.id, imageKey)}
                                                        className="h-7 border-r border-primary/10 text-primary/70 hover:bg-primary/[0.04] hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
                                                        title="Đặt làm ảnh chính"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">kid_star</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        draggable={!dragHandleDisabled}
                                                        disabled={dragHandleDisabled}
                                                        onDragStart={(event) => handleImageSortDragStart(event, product.id, imageKey, image)}
                                                        onDragEnd={clearImageSortDrag}
                                                        className="h-7 cursor-grab border-r border-primary/10 text-primary/70 hover:bg-primary/[0.04] hover:text-primary active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-35"
                                                        title={
                                                            image.is_primary
                                                                ? 'Ảnh chính luôn đứng đầu. Đổi ảnh chính nếu muốn thay thứ tự.'
                                                                : 'Kéo để sắp xếp trực tiếp'
                                                        }
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">drag_indicator</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={isBusy || bulkProgress.running || hasBusyProducts}
                                                        onClick={() => triggerReplaceImage(product.id, imageKey)}
                                                        className="h-7 border-r border-primary/10 text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-35"
                                                        title="Thay ảnh này"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">edit_square</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={isBusy || bulkProgress.running || hasBusyProducts}
                                                        onClick={() => handleDeleteImage(product.id, imageKey)}
                                                        className="h-7 text-brick hover:bg-brick/5 disabled:cursor-not-allowed disabled:opacity-35"
                                                        title="Đưa ảnh này ra khỏi bản nháp"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                            })}
                                    </div>
                                    {dragSelection?.productId === productKey ? (
                                        <div
                                            className="pointer-events-none absolute z-20 rounded-sm border border-primary/30 bg-primary/10"
                                            style={{
                                                left: dragSelection.left,
                                                top: dragSelection.top,
                                                width: dragSelection.width,
                                                height: dragSelection.height,
                                            }}
                                        />
                                    ) : null}
                                    </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const handleRequestCloseAsync = useCallback(async () => {
        if (!canClose) {
            return;
        }

        if (!(await confirmClosePopupAsync())) {
            return;
        }

        onClose?.();
    }, [canClose, confirmClosePopupAsync, onClose]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleWindowKeyDown = (event) => {
            if (event.key !== 'Escape') {
                return;
            }

            if (previewImage?.url) {
                event.preventDefault();
                setPreviewImage(null);
                return;
            }

            event.preventDefault();
            void handleRequestCloseAsync();
        };

        window.addEventListener('keydown', handleWindowKeyDown);
        return () => {
            window.removeEventListener('keydown', handleWindowKeyDown);
        };
    }, [handleRequestCloseAsync, open, previewImage?.url]);

    if (!open) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[118] bg-black/60 flex items-center justify-center p-4"
        >
            <div
                className="bg-white rounded p-6 w-full max-w-[1600px] max-h-[94vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                onClick={(event) => event.stopPropagation()}
            >
                <input
                    ref={addInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
                    className={FILE_INPUT_VISUALLY_HIDDEN_CLASS}
                    multiple
                    onChange={handleAddInputChange}
                />
                <input
                    ref={replaceInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
                    className={FILE_INPUT_VISUALLY_HIDDEN_CLASS}
                    onChange={handleReplaceInputChange}
                />
                <input
                    ref={bulkInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
                    className={FILE_INPUT_VISUALLY_HIDDEN_CLASS}
                    multiple
                    onChange={handleBulkInputChange}
                />

                <div className="flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                    <div>
                        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                            <span className="material-symbols-outlined">photo_library</span>
                            Quản lí nhanh hình ảnh sản phẩm
                        </h2>
                        <p className="mt-2 text-[13px] text-primary/70">
                            Đang thao tác cho <strong>{scopeLabel || 'danh sách hiện tại'}</strong>.
                            Mọi thay đổi ảnh được giữ ở bản nháp cho tới khi bấm <strong>Lưu</strong>.
                        </p>
                        <p className="mt-1 text-[11px] text-primary/55">
                            Dùng dấu tích để chọn nhiều ảnh, kéo biểu tượng sắp xếp để đổi vị trí trực tiếp ngay trên từng thẻ ảnh.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void handleRequestCloseAsync();
                        }}
                        disabled={!canClose}
                        className="text-gray-500 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40"
                        title={canClose ? 'Đóng bảng quản lí ảnh' : 'Đang xử lí thao tác ảnh'}
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-[260px] lg:w-[300px] xl:w-[340px]">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary/35 text-[18px]">
                                search
                            </span>
                            <input
                                type="text"
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                placeholder="Tìm tên hoặc SKU..."
                                className="h-10 w-full rounded-sm border border-primary/20 bg-primary/5 pl-10 pr-4 text-[13px] focus:border-primary focus:outline-none"
                            />
                        </div>

                        <label
                            className={`flex h-10 w-10 items-center justify-center rounded-sm border cursor-pointer transition-colors ${
                                showOnlyWithoutImages
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-primary/15 bg-white text-primary/65 hover:bg-primary/5'
                            }`}
                            title={showOnlyWithoutImages ? 'Đang lọc sản phẩm chưa có ảnh' : 'Chỉ hiện sản phẩm chưa có ảnh'}
                        >
                            <input
                                type="checkbox"
                                className="sr-only"
                                checked={showOnlyWithoutImages}
                                onChange={(event) => setShowOnlyWithoutImages(event.target.checked)}
                            />
                            <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                        </label>

                        <label className="flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-bold text-primary" title="Số sản phẩm mỗi trang">
                            <select
                                value={pageSize}
                                onChange={(event) => setPageSize(Number(event.target.value) || 10)}
                                className="h-7 rounded-sm border border-primary/15 bg-white px-2 text-[12px] font-bold text-primary focus:border-primary focus:outline-none"
                            >
                                {PAGE_SIZE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </select>
                            <span className="text-[10px] uppercase tracking-[0.14em] text-primary/45">/trang</span>
                        </label>

                        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                            <button
                                type="button"
                                onClick={handleSelectAllVisible}
                                disabled={visibleProductIds.length === 0}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/20 bg-white text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                                title={allVisibleSelected ? 'Bỏ chọn trang này' : 'Chọn hết trang này'}
                                aria-label={allVisibleSelected ? 'Bỏ chọn trang này' : 'Chọn hết trang này'}
                            >
                                <span className="material-symbols-outlined text-[18px]">{allVisibleSelected ? 'deselect' : 'select_all'}</span>
                            </button>

                            <button
                                type="button"
                                onClick={triggerBulkUploadImages}
                                disabled={selectedProductIds.length === 0 || bulkProgress.running || hasBusyProducts}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm bg-primary text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                                title="Thêm ảnh cho các sản phẩm đã chọn"
                                aria-label="Thêm ảnh cho các sản phẩm đã chọn"
                            >
                                <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleSaveAllDrafts}
                                disabled={dirtyProductIds.length === 0 || loading || bulkProgress.running || hasBusyProducts}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                title="Lưu tất cả sản phẩm đang có thay đổi"
                                aria-label="Lưu tất cả sản phẩm đang có thay đổi"
                            >
                                <span className="material-symbols-outlined text-[18px]">save</span>
                            </button>

                            <button
                                type="button"
                                onClick={handleDeleteSelectedImages}
                                disabled={selectedImageCount === 0 || loading || bulkProgress.running || hasBusyProducts}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-brick/20 bg-white text-brick hover:bg-brick/5 disabled:cursor-not-allowed disabled:opacity-50"
                                title="Xóa các ảnh đang chọn"
                                aria-label="Xóa các ảnh đang chọn"
                            >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    void handleReloadAsync();
                                }}
                                disabled={loading || bulkProgress.running}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/20 bg-white text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                                title="Tải lại danh sách"
                                aria-label="Tải lại danh sách"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            </button>
                        </div>
                    </div>

                    {notice?.message ? (
                        <div
                            className={`rounded-sm border px-4 py-3 text-[13px] ${getNoticeClassName(notice.type)}`}
                        >
                            {notice.message}
                        </div>
                    ) : null}

                    {bulkProgress.running ? (
                        <div className="rounded-sm border border-primary/15 bg-primary/[0.03] px-4 py-3 text-[13px] text-primary/70">
                            {bulkProgress.mode === 'save'
                                ? (
                                    <>
                                        Đang lưu thay đổi cho sản phẩm: <strong>{bulkProgress.current}</strong> / <strong>{bulkProgress.total}</strong>.
                                    </>
                                )
                                : (
                                    <>
                                        Đang áp bộ ảnh vào bản nháp của sản phẩm đã chọn: <strong>{bulkProgress.current}</strong> / <strong>{bulkProgress.total}</strong>.
                                    </>
                                )}
                        </div>
                    ) : null}
                </div>

                <div className="mt-3 overflow-y-auto pr-2 custom-scrollbar-lg flex-1">
                    {loading ? (
                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-12 text-center text-[13px] text-primary/70">
                            <div className="inline-flex items-center gap-2">
                                <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                Đang tải danh sách sản phẩm...
                            </div>
                        </div>
                    ) : errorMessage ? (
                        <div className="rounded-sm border border-brick/20 bg-brick/5 px-4 py-4 text-[13px] text-brick">
                            {errorMessage}
                        </div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="rounded-sm border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-12 text-center text-[13px] text-primary/60">
                            Không có sản phẩm nào phù hợp với điều kiện đang lọc trong bảng quản lí ảnh.
                        </div>
                    ) : (
                        <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                            {paginatedProducts.map(renderProductCard)}
                        </div>
                    )}
                </div>

                <div className="mt-4 border-t border-primary/10 pt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
                        <Pagination
                            pagination={paginationState}
                            onPageChange={(page) => setCurrentPage(Math.max(1, page))}
                        />
                        <button
                            type="button"
                            onClick={() => {
                                void handleRequestCloseAsync();
                            }}
                            disabled={!canClose}
                            className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Đóng
                        </button>
                    </div>
                </div>

                {previewImage?.url ? (
                    <div
                        className="fixed inset-0 z-[119] bg-black/80 flex items-center justify-center p-4"
                        onClick={() => setPreviewImage(null)}
                    >
                        <div className="max-w-[90vw] max-h-[90vh]">
                            <img
                                src={previewImage.url}
                                alt={previewImage.fileName || 'Ảnh xem trước'}
                                className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
                            />
                            <div className="mt-3 text-center text-white">
                                <div className="font-bold">{previewImage.productName}</div>
                                <div className="text-sm text-white/80">{previewImage.fileName}</div>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default ProductCategoryImageManagerModal;
