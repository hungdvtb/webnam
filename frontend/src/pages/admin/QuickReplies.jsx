import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import { mediaApi, quickReplyApi } from '../../services/api';
import { resolveImageObjectUrl } from '../../utils/mediaUrl';
import { resolveImageUploadError, validateImageFileForUpload } from '../../utils/uploadError';

const DEFAULT_TOPIC_COLOR = '#0ea5e9';
const TOPIC_COLORS = ['#22c55e', '#0ea5e9', '#e11d48', '#8b5cf6', '#f97316', '#14b8a6', '#2563eb', '#db2777'];
const STATUS_OPTIONS = [
    { value: 'active', label: 'Đang bật' },
    { value: 'all', label: 'Tất cả' },
    { value: 'disabled', label: 'Đã tắt' },
    { value: 'trashed', label: 'Thùng rác' },
];

const emptyStats = {
    topics: 0,
    replies: 0,
    active_replies: 0,
    trashed_replies: 0,
    images: 0,
};

const emptyPagination = {
    current_page: 1,
    last_page: 1,
    per_page: 50,
    total: 0,
};

const emptyGalleryStats = {
    folders: 0,
    images: 0,
    favorite_images: 0,
};

const emptyGalleryPagination = {
    current_page: 1,
    last_page: 1,
    per_page: 60,
    total: 0,
};

const GALLERY_FILTERS = [
    { value: 'all', label: 'Tất cả ảnh', icon: 'folder_open' },
    { value: 'recent', label: 'Tải lên gần đây', icon: 'history' },
    { value: 'favorite', label: 'Yêu thích', icon: 'favorite' },
];

const SIDEBAR_BASE_TITLE = 'Trả lời nhanh Zalo Sidebar';
const SIDEBAR_READY_SELECTOR = '[data-quick-reply-sidebar-root="true"]';
const ZALO_TARGET_STORAGE_KEY = 'quick-replies-zalo-target';
const ZALO_TARGET_OPTIONS = [
    { value: 'pc', label: 'Zalo PC', shortLabel: 'PC', icon: 'desktop_windows' },
    { value: 'web', label: 'Zalo Web', shortLabel: 'Web', icon: 'language' },
];

const normalizeZaloTarget = (value) => (String(value || '').trim().toLowerCase() === 'web' ? 'web' : 'pc');
const sidebarTitleForTarget = (value) => `${SIDEBAR_BASE_TITLE} ${normalizeZaloTarget(value) === 'web' ? 'Web' : 'PC'}`;
const sidebarWindowNameForTarget = (value) => `quick-reply-zalo-sidebar-${normalizeZaloTarget(value)}`;
const sidebarBrowserKeywordsForTarget = (value) => [sidebarTitleForTarget(value)];
const ZALO_WEB_URL = 'https://chat.zalo.me/';
const ZALO_WEB_POPUP_WINDOW_NAME = 'quick-reply-zalo-web-target';

const readInitialZaloTarget = () => {
    if (typeof window === 'undefined') {
        return 'pc';
    }

    try {
        const urlTarget = new URLSearchParams(window.location.search).get('zalo_target');
        if (urlTarget) {
            return normalizeZaloTarget(urlTarget);
        }

        return normalizeZaloTarget(window.localStorage?.getItem(ZALO_TARGET_STORAGE_KEY));
    } catch {
        return 'pc';
    }
};

const MAX_REPLY_CONTENTS = 10;
const MAX_REPLY_IMAGES = 120;
const GALLERY_UPLOAD_TIMEOUT_MS = 45000;

const emptyTopicForm = {
    id: null,
    name: '',
    color: DEFAULT_TOPIC_COLOR,
    is_active: true,
};

const inputClassName = 'h-10 w-full rounded-sm border border-slate-200 bg-white px-3 text-[13px] text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10';
const textareaClassName = 'min-h-[160px] w-full rounded-sm border border-slate-200 bg-white px-3 py-2.5 text-[13px] leading-6 text-slate-900 shadow-sm outline-none transition resize-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10';
const iconButtonClassName = 'inline-flex size-9 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50';
const tableIconButtonClassName = 'inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-sky-700 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClassName = 'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-rose-200 bg-white px-4 text-[13px] font-semibold text-rose-700 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50';

const isCanceledRequest = (error) => error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || error?.name === 'AbortError';
const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
const normalizeText = (value) => String(value || '').trim();

const normalizeShortcutInput = (value) => {
    const normalized = normalizeText(value).replace(/\s+/g, '').toLowerCase();

    if (!normalized) {
        return '';
    }

    return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const normalizeUploadedImagePayload = (image) => {
    if (!image || typeof image !== 'object') {
        return null;
    }

    const url = normalizeText(
        image.url
        || image.large_url
        || image.image_url
        || image.medium_url
        || image.original_url
    );

    if (!url) {
        return null;
    }

    return {
        ...image,
        url,
        image_url: image.image_url || url,
        large_url: image.large_url || url,
        media_asset_id: image.media_asset_id || image.id || null,
    };
};

const createContentKey = () => `content-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createEmptyContentForm = (overrides = {}) => ({
    client_id: overrides.client_id || createContentKey(),
    id: overrides.id ?? null,
    body: overrides.body || '',
    images: Array.isArray(overrides.images) ? overrides.images : [],
});

const createEmptyReplyForm = (overrides = {}) => ({
    id: overrides.id ?? null,
    topic_id: overrides.topic_id || '',
    shortcut: overrides.shortcut || '',
    title: overrides.title || '',
    body: overrides.body || '',
    images: Array.isArray(overrides.images) ? overrides.images : [],
    contents: Array.isArray(overrides.contents) && overrides.contents.length > 0
        ? overrides.contents
        : [createEmptyContentForm()],
    is_active: overrides.is_active ?? true,
});

const normalizeReplyContents = (reply) => {
    const rawContents = Array.isArray(reply?.contents) ? reply.contents : [];
    const contents = rawContents
        .map((content) => createEmptyContentForm({
            id: content?.id ?? null,
            body: content?.body || content?.content || '',
            images: Array.isArray(content?.images) ? content.images : [],
        }))
        .filter((content) => normalizeText(content.body) || content.images.length > 0);

    if (contents.length > 0) {
        return contents.slice(0, MAX_REPLY_CONTENTS);
    }

    return [createEmptyContentForm({
        body: reply?.body || '',
        images: Array.isArray(reply?.images) ? reply.images : [],
    })];
};

const createSendDraftFromReply = (reply) => ({
    reply,
    replyId: reply?.id ?? null,
    shortcut: reply?.shortcut || '',
    topic: reply?.topic || null,
    contents: normalizeReplyContents(reply).map((content, contentIndex) => ({
        client_id: content.client_id || createContentKey(),
        id: content.id ?? null,
        body: content.body || '',
        selected: true,
        images: (Array.isArray(content.images) ? content.images : []).map((image, imageIndex) => ({
            ...image,
            client_id: image?.id ? `send-image-${image.id}` : `send-image-${contentIndex}-${imageIndex}-${createContentKey()}`,
            selected: true,
        })),
    })),
});

const sendDraftTextareaRows = (body, expanded = false) => {
    const text = String(body || '');
    if (!expanded) {
        return 4;
    }

    const estimatedRows = text.split(/\r\n|\r|\n/).reduce((total, line) => (
        total + Math.max(1, Math.ceil(line.length / 40))
    ), 0);

    return Math.max(4, Math.min(32, estimatedRows + 1));
};
const buildSendDraftPayload = (draft) => ({
    contents: (Array.isArray(draft?.contents) ? draft.contents : [])
        .filter((content) => content.selected)
        .map((content) => {
            const images = (Array.isArray(content.images) ? content.images : [])
                .filter((image) => image.selected !== false)
                .map(({ client_id: clientId, selected, ...image }) => image);

            return {
                id: content.id ?? null,
                body: content.body || '',
                images,
            };
        })
        .filter((content) => normalizeText(content.body) || content.images.length > 0),
});

const sendPayloadClipboardText = (payload) => (Array.isArray(payload?.contents) ? payload.contents : [])
    .map((content) => normalizeText(content?.body || content?.content))
    .filter(Boolean)
    .join('\n\n');

const sendPayloadImageCount = (payload) => (Array.isArray(payload?.contents) ? payload.contents : [])
    .reduce((total, content) => total + (Array.isArray(content?.images) ? content.images.length : 0), 0);

const sendPayloadClipboardContents = (payload) => (Array.isArray(payload?.contents) ? payload.contents : [])
    .map((content) => {
        const body = normalizeText(content?.body || content?.content);
        const images = (Array.isArray(content?.images) ? content.images : [])
            .map((image) => ({
                image,
                src: imageSource(image, 'large'),
            }))
            .filter((item) => item.src);

        return { body, images };
    })
    .filter((content) => content.body || content.images.length > 0);

const focusZaloWebPopup = () => {
    let zaloWindow = null;

    try {
        zaloWindow = window.open('', ZALO_WEB_POPUP_WINDOW_NAME);
    } catch {
        zaloWindow = null;
    }

    if (zaloWindow) {
        try {
            const currentHref = String(zaloWindow.location?.href || '');
            if (!currentHref || currentHref === 'about:blank') {
                zaloWindow.location.href = ZALO_WEB_URL;
            }
        } catch {
            // Existing Zalo Web windows are cross-origin; keep their current chat untouched.
        }

        try {
            zaloWindow.focus();
        } catch {
            // Chrome may ignore focus, but opening/reusing the window is still useful.
        }
    }

    return zaloWindow;
};

const flattenReplyImages = (reply) => {
    const contents = Array.isArray(reply?.contents) ? reply.contents : [];
    if (contents.length > 0) {
        return contents.flatMap((content) => (Array.isArray(content?.images) ? content.images : []));
    }

    return Array.isArray(reply?.images) ? reply.images : [];
};

const replyContentCount = (reply) => {
    const contents = Array.isArray(reply?.contents) ? reply.contents : [];
    const validContents = contents.filter((content) => (
        normalizeText(content?.body || content?.content)
        || (Array.isArray(content?.images) && content.images.length > 0)
    ));

    return Math.max(validContents.length, 1);
};

const replyPreviewText = (reply) => {
    const contents = Array.isArray(reply?.contents) ? reply.contents : [];
    const contentText = contents
        .map((content) => normalizeText(content?.body || content?.content))
        .filter(Boolean)
        .join(' ... ');

    return contentText || normalizeText(reply?.body) || 'Mẫu chỉ có ảnh';
};
const replyFormImageCount = (replyForm) => (Array.isArray(replyForm?.contents) ? replyForm.contents : [])
    .reduce((total, content) => total + (Array.isArray(content?.images) ? content.images.length : 0), 0);

const replyFormImages = (replyForm) => (Array.isArray(replyForm?.contents) ? replyForm.contents : [])
    .flatMap((content) => (Array.isArray(content?.images) ? content.images : []));

const replyFormBody = (replyForm) => (Array.isArray(replyForm?.contents) ? replyForm.contents : [])
    .map((content) => normalizeText(content?.body))
    .filter(Boolean)
    .join('\n\n');

const rebuildReplyFormContentMirror = (form, contents) => ({
    ...form,
    contents,
    body: replyFormBody({ contents }),
    images: replyFormImages({ contents }),
});

const extractUploadedImages = (response) => {
    const items = Array.isArray(response?.data?.images)
        ? response.data.images
        : [response?.data?.image || response?.data];

    return items
        .map((item) => normalizeUploadedImagePayload(item))
        .filter(Boolean);
};

const imageSource = (image, preferred = 'thumbnail') => (
    resolveImageObjectUrl(image, preferred)
    || resolveImageObjectUrl(image, 'medium')
    || resolveImageObjectUrl(image, 'large')
    || resolveImageObjectUrl(image, 'original')
);

const replyImageSteps = (reply) => flattenReplyImages(reply)
    .map((image, index) => {
        const src = imageSource(image, 'large');

        if (!src) {
            return null;
        }

        return {
            id: image.id || `${reply?.id || 'reply'}-${index}`,
            src,
            label: `Ảnh ${index + 1}`,
        };
    })
    .filter(Boolean);

const copyTextFallback = async (text) => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
};

const shouldFetchWithCredentials = (url) => {
    try {
        return new URL(url, window.location.href).origin === window.location.origin;
    } catch {
        return false;
    }
};

const fetchImageBlob = async (url) => {
    const response = await fetch(url, {
        credentials: shouldFetchWithCredentials(url) ? 'include' : 'omit',
        cache: 'force-cache',
    });

    if (!response.ok) {
        throw new Error('Không tải được ảnh để copy.');
    }

    return response.blob();
};

const convertBlobToPng = async (blob) => {
    if (blob.type === 'image/png') {
        return blob;
    }

    if (typeof createImageBitmap !== 'function') {
        return blob;
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    return new Promise((resolve, reject) => {
        canvas.toBlob((pngBlob) => {
            if (pngBlob) {
                resolve(pngBlob);
            } else {
                reject(new Error('Không chuyển được ảnh sang PNG để copy.'));
            }
        }, 'image/png');
    });
};

const writeImageSourceToClipboard = async (src) => {
    const ClipboardItemCtor = window.ClipboardItem;

    if (!navigator.clipboard?.write || !ClipboardItemCtor) {
        await copyTextFallback(src);
        return 'link';
    }

    const imageBlob = await convertBlobToPng(await fetchImageBlob(src));
    await navigator.clipboard.write([
        new ClipboardItemCtor({
            [imageBlob.type || 'image/png']: imageBlob,
        }),
    ]);

    return 'image';
};

const apiErrorMessage = async (error, fallback) => {
    const data = error?.response?.data;

    if (data?.message) {
        return data.message;
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        try {
            const text = await data.text();
            const parsed = JSON.parse(text);
            if (parsed?.message) {
                return parsed.message;
            }
        } catch {
            return error?.message || fallback;
        }
    }

    return error?.message || fallback;
};

const sidebarWindowMetrics = () => {
    const width = 420;
    const screenRef = window.screen || {};
    const left = Number(screenRef.availLeft || 0);
    const top = Number(screenRef.availTop || 0);
    const availableWidth = Number(screenRef.availWidth || window.outerWidth || 1440);
    const availableHeight = Number(screenRef.availHeight || window.outerHeight || 900);

    return {
        width,
        height: availableHeight,
        left: Math.max(left + availableWidth - width, left),
        top,
    };
};

const isLocalBridgeNetworkError = (error) => {
    if (error?.response) {
        return false;
    }

    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();

    return ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(code)
        || message.includes('network error')
        || message.includes('failed to fetch')
        || message.includes('timeout')
        || message.includes('connection refused');
};

const localBridgeUnavailableMessage = (targetAppName) => (
    `Không thấy backend local tại 127.0.0.1:8003, nên web chính chưa kéo được ${targetAppName}. Bật backend local trên máy này rồi bấm Panel phải lại.`
);

const openZaloWebWindowBesideSidebar = (metrics) => {
    const screenRef = window.screen || {};
    const left = Number(screenRef.availLeft || 0);
    const top = Number(screenRef.availTop || 0);
    const availableWidth = Number(screenRef.availWidth || window.outerWidth || 1440);
    const availableHeight = Number(screenRef.availHeight || window.outerHeight || 900);
    const sidebarWidth = Math.max(Number(metrics?.width) || 420, 320);
    const zaloWidth = Math.max(availableWidth - sidebarWidth, 620);
    const features = [
        'popup=yes',
        'toolbar=yes',
        'location=yes',
        'menubar=no',
        'status=no',
        `width=${zaloWidth}`,
        `height=${availableHeight}`,
        `left=${left}`,
        `top=${top}`,
        'resizable=yes',
        'scrollbars=yes',
    ].join(',');
    const zaloWindow = window.open(ZALO_WEB_URL, ZALO_WEB_POPUP_WINDOW_NAME, features);

    if (zaloWindow) {
        try {
            zaloWindow.resizeTo(zaloWidth, availableHeight);
            zaloWindow.moveTo(left, top);
            zaloWindow.focus();
        } catch {
            // Browser window positioning can be restricted by Chrome settings.
        }
    }

    return zaloWindow;
};

const dockSidebarWindowToRight = (sidebarWindow, metrics, focusSidebar = true) => {
    if (!sidebarWindow || sidebarWindow.closed) {
        return false;
    }

    const screenRef = window.screen || {};
    const left = Number(screenRef.availLeft || 0);
    const top = Number(screenRef.availTop || 0);
    const availableWidth = Number(screenRef.availWidth || window.outerWidth || 1440);
    const availableHeight = Number(screenRef.availHeight || window.outerHeight || 900);
    const sidebarWidth = Math.max(Number(metrics?.width) || 420, 320);

    try {
        sidebarWindow.resizeTo(sidebarWidth, availableHeight);
        sidebarWindow.moveTo(Math.max(left + availableWidth - sidebarWidth, left), top);
        if (focusSidebar) {
            sidebarWindow.focus();
        }
    } catch {
        // Chrome can restrict popup positioning, but the panel is still usable.
    }

    return true;
};

const isLocalWindowControlHost = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    const hostname = String(window.location.hostname || '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
};

const shouldUseLocalWindowBridge = (target) => normalizeZaloTarget(target) === 'pc' && !isLocalWindowControlHost();
const shouldUseBrowserOnlyZaloWebDock = (target) => normalizeZaloTarget(target) === 'web' && !isLocalWindowControlHost();


const isWindowsBackendOnlyMessage = (message) => String(message || '').includes('backend đang chạy trên Windows');

const sleep = (delay) => new Promise((resolve) => window.setTimeout(resolve, delay));

const waitForSidebarWindowReady = async (sidebarWindow, sidebarUrl, timeoutMs = 9000) => {
    const startTime = Date.now();
    let reloaded = false;

    while (Date.now() - startTime < timeoutMs) {
        if (!sidebarWindow || sidebarWindow.closed) {
            return false;
        }

        try {
            const doc = sidebarWindow.document;
            const bodyReady = doc?.body?.dataset?.quickReplySidebarReady === '1';
            if (bodyReady || doc?.querySelector?.(SIDEBAR_READY_SELECTOR)) {
                return true;
            }

            const href = String(sidebarWindow.location?.href || '');
            if (!reloaded && Date.now() - startTime > 1200 && href === 'about:blank') {
                sidebarWindow.location.href = sidebarUrl.toString();
                reloaded = true;
            }
        } catch {
            if (!reloaded && Date.now() - startTime > 1200) {
                try {
                    sidebarWindow.location.href = sidebarUrl.toString();
                    reloaded = true;
                } catch {
                    // The popup can be briefly inaccessible while Chrome is navigating.
                }
            }
        }

        await sleep(150);
    }

    return false;
};

function QuickReplies() {
    const isSidebarMode = useMemo(() => {
        if (typeof window === 'undefined') {
            return false;
        }

        return new URLSearchParams(window.location.search).get('mode') === 'zalo-sidebar';
    }, []);
    const [topics, setTopics] = useState([]);
    const [stats, setStats] = useState(emptyStats);
    const [replies, setReplies] = useState([]);
    const [pagination, setPagination] = useState(emptyPagination);
    const [search, setSearch] = useState('');
    const [topicFilter, setTopicFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('active');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [importingPancake, setImportingPancake] = useState(false);
    const [pancakeImportPromptOpen, setPancakeImportPromptOpen] = useState(false);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [bulkRestoring, setBulkRestoring] = useState(false);
    const [copyingId, setCopyingId] = useState(null);
    const [splittingZalo, setSplittingZalo] = useState(false);
    const [zaloTarget, setZaloTarget] = useState(readInitialZaloTarget);
    const [copiedState, setCopiedState] = useState({ id: null, mode: '' });
    const [sendDraft, setSendDraft] = useState(null);
    const [hoveredSendContentKey, setHoveredSendContentKey] = useState(null);
    const [focusedSendContentKey, setFocusedSendContentKey] = useState(null);
    const [selectedReplyIds, setSelectedReplyIds] = useState(() => new Set());
    const [zaloPasteFlow, setZaloPasteFlow] = useState(null);
    const [zaloMirrorOpen, setZaloMirrorOpen] = useState(false);
    const [zaloMirrorSrc, setZaloMirrorSrc] = useState('');
    const [zaloMirrorLoading, setZaloMirrorLoading] = useState(false);
    const [zaloMirrorAutoRefresh, setZaloMirrorAutoRefresh] = useState(true);
    const [zaloMirrorText, setZaloMirrorText] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [replyForm, setReplyForm] = useState(() => createEmptyReplyForm());
    const [topicForm, setTopicForm] = useState(emptyTopicForm);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [galleryLoading, setGalleryLoading] = useState(false);
    const [galleryUploading, setGalleryUploading] = useState(false);
    const [galleryFolderSaving, setGalleryFolderSaving] = useState(false);
    const [gallerySending, setGallerySending] = useState(false);
    const [galleryImages, setGalleryImages] = useState([]);
    const [galleryFolders, setGalleryFolders] = useState([]);
    const [galleryStats, setGalleryStats] = useState(emptyGalleryStats);
    const [galleryPagination, setGalleryPagination] = useState(emptyGalleryPagination);
    const [gallerySearch, setGallerySearch] = useState('');
    const [galleryFolderFilter, setGalleryFolderFilter] = useState('all');
    const [galleryPage, setGalleryPage] = useState(1);
    const [galleryFolderName, setGalleryFolderName] = useState('');
    const [galleryFolderMenu, setGalleryFolderMenu] = useState(null);
    const [selectedGalleryImageIds, setSelectedGalleryImageIds] = useState(() => new Set());
    const [galleryZoomImage, setGalleryZoomImage] = useState(null);
    const [replyImagePreview, setReplyImagePreview] = useState(null);
    const [replyImageHoverPreview, setReplyImageHoverPreview] = useState(null);
    const zaloMirrorObjectUrlRef = useRef('');
    const sidebarWindowsRef = useRef({ pc: null, web: null });
    const pancakeImportInputRef = useRef(null);
    const pancakeImportModeRef = useRef('merge');
    const bulkSelectAllRef = useRef(null);
    const galleryUploadInputRef = useRef(null);
    const galleryUploadAbortRef = useRef(null);
    const replyImageClickTimerRef = useRef(null);
    const pageSize = isSidebarMode ? 20 : (pagination.per_page || 50);
    const galleryPageSize = 60;

    const selectedTopic = useMemo(() => {
        if (topicFilter === 'all') {
            return null;
        }

        return topics.find((topic) => String(topic.id) === String(topicFilter)) || null;
    }, [topicFilter, topics]);
    const isTrashMode = statusFilter === 'trashed';
    const selectedZaloTargetOption = ZALO_TARGET_OPTIONS.find((option) => option.value === zaloTarget) || ZALO_TARGET_OPTIONS[0];
    const zaloTargetLabel = selectedZaloTargetOption.label;
    const sendDraftPayload = useMemo(() => buildSendDraftPayload(sendDraft), [sendDraft]);
    const sendDraftSelectedCount = sendDraftPayload.contents.length;
    const sendDraftTotalCount = Array.isArray(sendDraft?.contents) ? sendDraft.contents.length : 0;

    const loadBootstrap = useCallback(async () => {
        const response = await quickReplyApi.bootstrap();
        setTopics(Array.isArray(response?.data?.topics) ? response.data.topics : []);
        setStats(response?.data?.stats || emptyStats);
    }, []);

    useEffect(() => {
        loadBootstrap().catch((err) => {
            setError(err?.response?.data?.message || 'Không tải được dữ liệu trả lời nhanh.');
        });
    }, [loadBootstrap]);

    useEffect(() => {
        setSelectedReplyIds(new Set());
    }, [statusFilter]);

    useEffect(() => {
        if (!message || message.startsWith('Đang ')) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setMessage('');
        }, 3500);

        return () => window.clearTimeout(timeoutId);
    }, [message]);

    const clearNotice = () => {
        setError('');
        setMessage('');
    };

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        try {
            window.localStorage?.setItem(ZALO_TARGET_STORAGE_KEY, zaloTarget);
        } catch {
            // Ignore storage errors; the selector still works for this session.
        }
    }, [zaloTarget]);

    useEffect(() => {
        if (!isSidebarMode || typeof document === 'undefined') {
            return undefined;
        }

        const previousTitle = document.title;
        const previousHtmlOverflowX = document.documentElement.style.overflowX;
        const previousBodyOverflowX = document.body.style.overflowX;
        document.title = sidebarTitleForTarget(zaloTarget);
        document.body.dataset.quickReplySidebarReady = '1';
        document.documentElement.style.overflowX = 'hidden';
        document.body.style.overflowX = 'hidden';

        const metrics = sidebarWindowMetrics();
        const shouldAutoDock = new URLSearchParams(window.location.search).get('dock') !== '0';

        const applyWindowMetrics = () => {
            try {
                window.resizeTo(metrics.width, metrics.height);
                window.moveTo(metrics.left, metrics.top);
            } catch (err) {
                console.warn('Cannot dock quick reply sidebar window.', err);
            }
        };

        applyWindowMetrics();
        const resizeTimeouts = [120, 420, 900, 1800, 3200].map((delay) => window.setTimeout(applyWindowMetrics, delay));
        const dockTimeouts = [];
        const dockPanel = (attempt = 1) => {
            applyWindowMetrics();
            quickReplyApi.splitZalo({
                mode: 'sidebar',
                sidebar_width: metrics.width,
                gap: 0,
                require_browser: false,
                manage_browser: true,
                browser_window_keywords: sidebarBrowserKeywordsForTarget(zaloTarget),
                zalo_target: zaloTarget,
            }).then((response) => {
                setMessage(response?.data?.message || '');
                if (!response?.data?.result?.browser_found && attempt < 6) {
                    dockTimeouts.push(window.setTimeout(() => dockPanel(attempt + 1), 650));
                }
            }).catch(async (err) => {
                const errorMessage = await apiErrorMessage(err, 'Không đặt được panel bên phải. Hãy mở Zalo Desktop rồi thử lại.');
                if (errorMessage.includes('cửa sổ trình duyệt')) {
                    console.warn(errorMessage);
                    if (attempt < 6) {
                        dockTimeouts.push(window.setTimeout(() => dockPanel(attempt + 1), 650));
                    }
                    return;
                }
                setError(errorMessage);
            });
        };

        if (shouldAutoDock) {
            dockTimeouts.push(window.setTimeout(() => dockPanel(), 350));
        }

        return () => {
            resizeTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
            dockTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
            document.title = previousTitle;
            delete document.body.dataset.quickReplySidebarReady;
            document.documentElement.style.overflowX = previousHtmlOverflowX;
            document.body.style.overflowX = previousBodyOverflowX;
        };
    }, [isSidebarMode, zaloTarget]);

    useEffect(() => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            setLoading(true);
            setError('');

            const params = {
                page,
                per_page: pageSize,
                status: statusFilter,
            };

            const normalizedSearch = normalizeText(search);
            if (normalizedSearch) {
                params.search = normalizedSearch;
            }
            if (topicFilter !== 'all') {
                params.topic_id = topicFilter;
            }

            quickReplyApi.getAll(params, controller.signal)
                .then((response) => {
                    setReplies(Array.isArray(response?.data?.data) ? response.data.data : []);
                    setPagination({
                        current_page: response?.data?.current_page || 1,
                        last_page: response?.data?.last_page || 1,
                        per_page: response?.data?.per_page || 50,
                        total: response?.data?.total || 0,
                    });
                })
                .catch((err) => {
                    if (isCanceledRequest(err)) {
                        return;
                    }
                    setError(err?.response?.data?.message || 'Không tải được danh sách mẫu.');
                })
                .finally(() => {
                    if (!controller.signal.aborted) {
                        setLoading(false);
                    }
                });
        }, 180);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [page, pageSize, search, statusFilter, topicFilter]);

    useEffect(() => {
        if (!copiedState.id) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setCopiedState({ id: null, mode: '' });
        }, 1600);

        return () => window.clearTimeout(timeoutId);
    }, [copiedState]);

    useEffect(() => {
        setSelectedReplyIds(new Set());
    }, [page, search, statusFilter, topicFilter]);

    const refreshReplies = useCallback(async () => {
        await loadBootstrap();
        setPage(1);
        const response = await quickReplyApi.getAll({
            page: 1,
            per_page: pageSize,
            status: statusFilter,
            ...(normalizeText(search) ? { search: normalizeText(search) } : {}),
            ...(topicFilter !== 'all' ? { topic_id: topicFilter } : {}),
        });
        setReplies(Array.isArray(response?.data?.data) ? response.data.data : []);
        setPagination({
            current_page: response?.data?.current_page || 1,
            last_page: response?.data?.last_page || 1,
            per_page: response?.data?.per_page || pageSize,
            total: response?.data?.total || 0,
        });
    }, [loadBootstrap, pageSize, search, statusFilter, topicFilter]);

    const applyGalleryResponse = (response) => {
        const imageData = response?.data?.images || {};
        setGalleryImages(Array.isArray(imageData.data) ? imageData.data : []);
        setGalleryFolders(Array.isArray(response?.data?.folders) ? response.data.folders : []);
        setGalleryStats(response?.data?.stats || emptyGalleryStats);
        setGalleryPagination({
            current_page: imageData.current_page || 1,
            last_page: imageData.last_page || 1,
            per_page: imageData.per_page || galleryPageSize,
            total: imageData.total || 0,
        });
    };

    const galleryRequestParams = useCallback(() => {
        const params = {
            page: galleryPage,
            per_page: galleryPageSize,
            folder_id: galleryFolderFilter,
        };
        const normalizedSearch = normalizeText(gallerySearch);
        if (normalizedSearch) {
            params.search = normalizedSearch;
        }

        return params;
    }, [galleryFolderFilter, galleryPage, gallerySearch, galleryPageSize]);

    const refreshGallery = useCallback(async () => {
        const response = await quickReplyApi.gallery(galleryRequestParams());
        applyGalleryResponse(response);
    }, [galleryRequestParams]);

    useEffect(() => {
        if (!galleryOpen) {
            return undefined;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            setGalleryLoading(true);
            quickReplyApi.gallery(galleryRequestParams(), controller.signal)
                .then((response) => {
                    applyGalleryResponse(response);
                })
                .catch((err) => {
                    if (isCanceledRequest(err)) {
                        return;
                    }
                    setError(err?.response?.data?.message || 'Không tải được kho ảnh.');
                })
                .finally(() => {
                    if (!controller.signal.aborted) {
                        setGalleryLoading(false);
                    }
                });
        }, 180);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [galleryOpen, galleryRequestParams]);

    useEffect(() => {
        setSelectedGalleryImageIds(new Set());
    }, [galleryFolderFilter, gallerySearch]);

    useEffect(() => {
        if (!galleryFolderMenu) {
            return undefined;
        }

        const closeMenu = () => setGalleryFolderMenu(null);
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };

        window.addEventListener('click', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('keydown', closeOnEscape);

        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [galleryFolderMenu]);

    useEffect(() => () => {
        galleryUploadAbortRef.current?.abort();
        galleryUploadAbortRef.current = null;
        if (replyImageClickTimerRef.current) {
            window.clearTimeout(replyImageClickTimerRef.current);
            replyImageClickTimerRef.current = null;
        }
    }, []);

    const updateReplyInList = (reply) => {
        if (!reply?.id) {
            return;
        }

        setReplies((current) => current.map((item) => (
            Number(item.id) === Number(reply.id) ? reply : item
        )));
    };

    const openCreateForm = () => {
        setReplyForm(createEmptyReplyForm({
            topic_id: selectedTopic?.id ? String(selectedTopic.id) : '',
        }));
        setError('');
        setMessage('');
        setFormOpen(true);
    };

    const openEditForm = (reply) => {
        const contents = normalizeReplyContents(reply);

        setReplyForm(createEmptyReplyForm({
            id: reply.id,
            topic_id: reply.topic_id ? String(reply.topic_id) : '',
            shortcut: reply.shortcut || '',
            title: reply.title || '',
            body: reply.body || '',
            images: flattenReplyImages(reply),
            contents,
            is_active: Boolean(reply.is_active),
        }));
        setError('');
        setMessage('');
        setFormOpen(true);
    };

    const closeForm = () => {
        if (saving || uploading) {
            return;
        }

        setFormOpen(false);
        setReplyForm(createEmptyReplyForm());
    };

    const handleReplyFormChange = (field, value) => {
        setReplyForm((current) => ({
            ...current,
            [field]: value,
        }));
    };

    const toggleReplySelection = (replyId, checked) => {
        const normalizedId = Number(replyId);
        if (!normalizedId) {
            return;
        }

        setSelectedReplyIds((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(normalizedId);
            } else {
                next.delete(normalizedId);
            }

            return next;
        });
    };

    const toggleVisibleReplySelection = (checked) => {
        const visibleIds = replies
            .map((reply) => Number(reply.id))
            .filter(Boolean);

        setSelectedReplyIds((current) => {
            const next = new Set(current);
            visibleIds.forEach((replyId) => {
                if (checked) {
                    next.add(replyId);
                } else {
                    next.delete(replyId);
                }
            });

            return next;
        });
    };

    const clearSelectedReplies = () => {
        setSelectedReplyIds(new Set());
    };

    const toggleTrashMode = () => {
        setStatusFilter(isTrashMode ? 'active' : 'trashed');
        setTopicFilter('all');
        setPage(1);
        clearSelectedReplies();
    };

    const openGallery = () => {
        setGalleryOpen(true);
        setGalleryPage(1);
        setError('');
        setMessage('');
    };

    const cancelGalleryUpload = (notify = true) => {
        galleryUploadAbortRef.current?.abort();
        galleryUploadAbortRef.current = null;
        setGalleryUploading(false);
        if (notify) {
            setError('Đã hủy tải ảnh.');
        }
    };

    const closeGallery = () => {
        if (gallerySending || galleryFolderSaving) {
            return;
        }

        if (galleryUploading) {
            cancelGalleryUpload(false);
        }

        setGalleryZoomImage(null);
        setGalleryFolderMenu(null);
        setGalleryOpen(false);
    };

    const selectGalleryFolder = (folderId) => {
        setGalleryFolderMenu(null);
        setGalleryFolderFilter(folderId);
        setGalleryPage(1);
    };

    const openGalleryFolderMenu = (event, folder) => {
        event.preventDefault();
        event.stopPropagation();

        if (!folder?.id) {
            return;
        }

        const menuWidth = 132;
        const menuHeight = 76;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || menuWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || menuHeight;
        const x = Math.max(8, Math.min(event.clientX, viewportWidth - menuWidth - 8));
        const y = Math.max(8, Math.min(event.clientY, viewportHeight - menuHeight - 8));

        setGalleryFolderMenu({ folder, x, y });
    };

    const renameGalleryFolder = async (folder) => {
        setGalleryFolderMenu(null);

        if (!folder?.id || galleryBusy) {
            return;
        }

        const nextNameInput = window.prompt('Đổi tên thư mục ảnh', folder.name || '');
        if (nextNameInput === null) {
            return;
        }

        const name = normalizeText(nextNameInput);
        if (!name) {
            setError('Nhập tên thư mục ảnh.');
            return;
        }

        if (name === normalizeText(folder.name)) {
            return;
        }

        setGalleryFolderSaving(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.updateGalleryFolder(folder.id, { name });
            setMessage(response?.data?.message || 'Đã đổi tên thư mục ảnh.');
            await refreshGallery();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không đổi tên được thư mục ảnh.');
        } finally {
            setGalleryFolderSaving(false);
        }
    };

    const createGalleryFolder = async (event) => {
        event.preventDefault();
        const name = normalizeText(galleryFolderName);
        if (!name) {
            setError('Nhập tên thư mục ảnh.');
            return;
        }

        setGalleryFolderSaving(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.createGalleryFolder({ name });
            const folder = response?.data?.folder;
            const nextFolderFilter = folder?.id ? String(folder.id) : galleryFolderFilter;
            setGalleryFolderName('');
            if (folder?.id) {
                setGalleryFolderFilter(nextFolderFilter);
                setGalleryPage(1);
            }
            setMessage(response?.data?.message || 'Đã tạo thư mục ảnh.');
            const listResponse = await quickReplyApi.gallery({
                ...galleryRequestParams(),
                folder_id: nextFolderFilter,
                page: 1,
            });
            applyGalleryResponse(listResponse);
        } catch (err) {
            setError(err?.response?.data?.message || 'Không tạo được thư mục ảnh.');
        } finally {
            setGalleryFolderSaving(false);
        }
    };

    const deleteGalleryFolder = async (folder) => {
        setGalleryFolderMenu(null);

        if (!folder?.id || !window.confirm(`Xóa thư mục ${folder.name}? Ảnh trong thư mục vẫn được giữ lại trong Tất cả ảnh.`)) {
            return;
        }

        setGallerySending(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.deleteGalleryFolder(folder.id);
            if (String(galleryFolderFilter) === String(folder.id)) {
                setGalleryFolderFilter('all');
                setGalleryPage(1);
            }
            setMessage(response?.data?.message || 'Đã xóa thư mục ảnh.');
            await refreshGallery();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không xóa được thư mục ảnh.');
        } finally {
            setGallerySending(false);
        }
    };

    const uploadGalleryImages = async (files) => {
        const selectedFiles = Array.from(files || []);
        if (selectedFiles.length === 0) {
            return;
        }

        const validationError = selectedFiles
            .map((file) => validateImageFileForUpload(file))
            .find(Boolean);

        if (validationError) {
            setError(validationError);
            return;
        }

        galleryUploadAbortRef.current?.abort();
        const controller = new AbortController();
        galleryUploadAbortRef.current = controller;
        const timeoutId = window.setTimeout(() => controller.abort(), GALLERY_UPLOAD_TIMEOUT_MS);

        const formData = new FormData();
        selectedFiles.forEach((file) => formData.append('images[]', file));
        if (/^\d+$/.test(String(galleryFolderFilter))) {
            formData.append('folder_id', galleryFolderFilter);
        }

        setGalleryUploading(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.uploadGalleryImages(formData, { signal: controller.signal });
            const createdCount = response?.data?.created_count || selectedFiles.length;
            setMessage(response?.data?.message || `Đã thêm ${createdCount} ảnh vào kho.`);
            setGalleryPage(1);
            const listResponse = await quickReplyApi.gallery({ ...galleryRequestParams(), page: 1 });
            applyGalleryResponse(listResponse);
        } catch (err) {
            if (isCanceledRequest(err) || controller.signal.aborted) {
                setError('Upload ảnh đã bị hủy hoặc chạy quá lâu. Thử chọn ít ảnh hơn, hoặc ảnh nhẹ hơn rồi tải lại.');
            } else {
                setError(resolveImageUploadError(err).message || err?.response?.data?.message || 'Upload ảnh vào kho thất bại.');
            }
        } finally {
            window.clearTimeout(timeoutId);
            if (galleryUploadAbortRef.current === controller) {
                galleryUploadAbortRef.current = null;
            }
            setGalleryUploading(false);
        }
    };

    const toggleGalleryImageSelection = (imageId, checked) => {
        const normalizedId = Number(imageId);
        if (!normalizedId) {
            return;
        }

        setSelectedGalleryImageIds((current) => {
            const next = new Set(current);
            if (checked) {
                next.add(normalizedId);
            } else {
                next.delete(normalizedId);
            }

            return next;
        });
    };

    const toggleVisibleGallerySelection = (checked) => {
        setSelectedGalleryImageIds((current) => {
            const next = new Set(current);
            galleryImages.forEach((image) => {
                const imageId = Number(image.id);
                if (!imageId) {
                    return;
                }

                if (checked) {
                    next.add(imageId);
                } else {
                    next.delete(imageId);
                }
            });

            return next;
        });
    };

    const clearSelectedGalleryImages = () => {
        setSelectedGalleryImageIds(new Set());
    };

    const updateGalleryImageFavorite = async (image) => {
        if (!image?.id) {
            return;
        }

        setError('');

        try {
            const response = await quickReplyApi.updateGalleryImage(image.id, {
                is_favorite: !image.is_favorite,
            });
            const nextImage = response?.data?.image;
            if (nextImage?.id) {
                setGalleryImages((current) => current.map((item) => (
                    Number(item.id) === Number(nextImage.id) ? nextImage : item
                )));
            }
            await refreshGallery();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không cập nhật được ảnh yêu thích.');
        }
    };

    const deleteGalleryImage = async (image) => {
        if (!image?.id || !window.confirm(`Xóa ảnh ${image.name || image.filename || image.id} khỏi kho ảnh?`)) {
            return;
        }

        setGallerySending(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.deleteGalleryImage(image.id);
            setGalleryImages((current) => current.filter((item) => Number(item.id) !== Number(image.id)));
            setSelectedGalleryImageIds((current) => {
                const next = new Set(current);
                next.delete(Number(image.id));
                return next;
            });
            setMessage(response?.data?.message || 'Đã xóa ảnh khỏi kho.');
            await refreshGallery();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không xóa được ảnh khỏi kho.');
        } finally {
            setGallerySending(false);
        }
    };

    const selectedGalleryIds = () => Array.from(selectedGalleryImageIds)
        .map((id) => Number(id))
        .filter(Boolean);

    const copySelectedGalleryImages = async () => {
        const ids = selectedGalleryIds();
        if (ids.length === 0) {
            setError('Chọn ít nhất một ảnh trong kho.');
            return;
        }

        setGallerySending(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.copyGalleryImages({ ids });
            setMessage(response?.data?.message || `Đã copy ${ids.length} ảnh. Sang Zalo bấm Ctrl+V để dán.`);
            await refreshGallery();
        } catch (err) {
            setError(await apiErrorMessage(err, 'Không copy được ảnh từ kho.'));
        } finally {
            setGallerySending(false);
        }
    };

    const sendSelectedGalleryImagesToZalo = async () => {
        const ids = selectedGalleryIds();
        if (ids.length === 0) {
            setError('Chọn ít nhất một ảnh trong kho.');
            return;
        }

        setGallerySending(true);
        setError('');
        setMessage('Đang gửi ảnh sang chat Zalo đang mở...');

        try {
            const response = await quickReplyApi.sendGalleryImagesToZalo({ ids, zalo_target: zaloTarget });
            setMessage(response?.data?.message || `Đã gửi ${ids.length} ảnh sang Zalo.`);
            await refreshGallery();
        } catch (err) {
            setError(await apiErrorMessage(err, 'Không gửi được ảnh sang Zalo. Hãy mở đúng khung chat Zalo rồi thử lại.'));
        } finally {
            setGallerySending(false);
        }
    };

    const handleContentImageUpload = async (contentIndex, files) => {
        const selectedFiles = Array.from(files || []);
        if (selectedFiles.length === 0) {
            return;
        }

        const validationError = selectedFiles
            .map((file) => validateImageFileForUpload(file))
            .find(Boolean);

        if (validationError) {
            setError(validationError);
            return;
        }

        setUploading(true);
        setError('');
        setMessage('');

        try {
            const uploadedImages = [];

            for (const file of selectedFiles) {
                const uploadData = new FormData();
                uploadData.append('image', file);
                uploadData.append('collection', 'quick-replies');

                const response = await mediaApi.upload(uploadData, { retryPolicy: 'never' });
                uploadedImages.push(...extractUploadedImages(response));
            }

            if (uploadedImages.length === 0) {
                throw new Error('API upload không trả về ảnh hợp lệ.');
            }

            setReplyForm((current) => {
                const contents = Array.isArray(current.contents) && current.contents.length > 0
                    ? current.contents.map((content) => ({ ...content, images: [...(content.images || [])] }))
                    : [createEmptyContentForm({ body: current.body, images: current.images })];
                const targetContent = contents[contentIndex] || createEmptyContentForm();
                const otherImageCount = contents.reduce((total, content, index) => (
                    index === contentIndex ? total : total + (content.images || []).length
                ), 0);
                const availableImages = Math.max(MAX_REPLY_IMAGES - otherImageCount, 0);

                contents[contentIndex] = {
                    ...targetContent,
                    images: [...(targetContent.images || []), ...uploadedImages].slice(0, availableImages),
                };

                return rebuildReplyFormContentMirror(current, contents);
            });
            setMessage(`Đã tải lên ${uploadedImages.length} ảnh.`);
        } catch (err) {
            setError(resolveImageUploadError(err).message || err?.message || 'Upload ảnh thất bại.');
        } finally {
            setUploading(false);
        }
    };

    const updateContentBody = (contentIndex, value) => {
        setReplyForm((current) => {
            const contents = Array.isArray(current.contents) && current.contents.length > 0
                ? current.contents.map((content) => ({ ...content }))
                : [createEmptyContentForm()];

            contents[contentIndex] = {
                ...contents[contentIndex],
                body: value,
            };

            return rebuildReplyFormContentMirror(current, contents);
        });
    };

    const addContentBlock = () => {
        setReplyForm((current) => {
            const contents = Array.isArray(current.contents) && current.contents.length > 0
                ? current.contents
                : [createEmptyContentForm()];

            if (contents.length >= MAX_REPLY_CONTENTS) {
                return current;
            }

            return rebuildReplyFormContentMirror(current, [...contents, createEmptyContentForm()]);
        });
    };

    const removeContentBlock = (contentIndex) => {
        setReplyForm((current) => {
            const contents = Array.isArray(current.contents) && current.contents.length > 0
                ? current.contents
                : [createEmptyContentForm()];

            if (contents.length <= 1) {
                return rebuildReplyFormContentMirror(current, [createEmptyContentForm()]);
            }

            return rebuildReplyFormContentMirror(current, contents.filter((_, index) => index !== contentIndex));
        });
    };

    const moveContentBlock = (contentIndex, direction) => {
        setReplyForm((current) => {
            const contents = Array.isArray(current.contents) && current.contents.length > 0
                ? [...current.contents]
                : [createEmptyContentForm()];
            const targetIndex = contentIndex + direction;
            if (targetIndex < 0 || targetIndex >= contents.length) {
                return current;
            }

            const [moved] = contents.splice(contentIndex, 1);
            contents.splice(targetIndex, 0, moved);

            return rebuildReplyFormContentMirror(current, contents);
        });
    };

    const moveContentImage = (contentIndex, imageIndex, direction) => {
        setReplyForm((current) => {
            const contents = Array.isArray(current.contents) && current.contents.length > 0
                ? current.contents.map((content) => ({ ...content, images: [...(content.images || [])] }))
                : [createEmptyContentForm()];
            const images = contents[contentIndex]?.images || [];
            const targetIndex = imageIndex + direction;
            if (targetIndex < 0 || targetIndex >= images.length) {
                return current;
            }

            const [moved] = images.splice(imageIndex, 1);
            images.splice(targetIndex, 0, moved);
            contents[contentIndex] = {
                ...contents[contentIndex],
                images,
            };

            return rebuildReplyFormContentMirror(current, contents);
        });
    };

    const removeContentImage = (contentIndex, imageIndex) => {
        setReplyForm((current) => {
            const contents = Array.isArray(current.contents) && current.contents.length > 0
                ? current.contents.map((content) => ({ ...content, images: [...(content.images || [])] }))
                : [createEmptyContentForm()];

            contents[contentIndex] = {
                ...contents[contentIndex],
                images: (contents[contentIndex]?.images || []).filter((_, index) => index !== imageIndex),
            };

            return rebuildReplyFormContentMirror(current, contents);
        });
    };

    const saveReply = async (event) => {
        event.preventDefault();
        const shortcut = normalizeShortcutInput(replyForm.shortcut);
        const contents = (Array.isArray(replyForm.contents) ? replyForm.contents : [])
            .map((content) => ({
                id: content.id || null,
                body: normalizeText(content.body),
                images: Array.isArray(content.images) ? content.images : [],
            }))
            .filter((content) => content.body || content.images.length > 0)
            .slice(0, MAX_REPLY_CONTENTS);
        const body = replyFormBody({ contents });
        const images = replyFormImages({ contents }).slice(0, MAX_REPLY_IMAGES);

        if (!shortcut) {
            setError('Nhập ký tự tắt cho mẫu.');
            return;
        }

        if (!body && images.length === 0) {
            setError('Nhập nội dung hoặc thêm ít nhất một ảnh.');
            return;
        }

        setSaving(true);
        setError('');
        setMessage('');

        try {
            const payload = {
                topic_id: replyForm.topic_id || null,
                shortcut,
                title: '',
                body,
                images,
                contents,
                is_active: Boolean(replyForm.is_active),
            };

            const response = replyForm.id
                ? await quickReplyApi.update(replyForm.id, payload)
                : await quickReplyApi.store(payload);

            setMessage(response?.data?.message || 'Đã lưu mẫu trả lời nhanh.');
            setFormOpen(false);
            setReplyForm(createEmptyReplyForm());
            await refreshReplies();
        } catch (err) {
            const errors = err?.response?.data?.errors;
            const firstError = errors ? Object.values(errors).flat()[0] : null;
            setError(firstError || err?.response?.data?.message || 'Không lưu được mẫu trả lời nhanh.');
        } finally {
            setSaving(false);
        }
    };

    const deleteReply = async (reply) => {
        if (!window.confirm(`Chuyển mẫu ${reply.shortcut} vào thùng rác?`)) {
            return;
        }

        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.destroy(reply.id);
            setMessage(response?.data?.message || 'Đã chuyển mẫu vào thùng rác.');
            setReplies((current) => current.filter((item) => Number(item.id) !== Number(reply.id)));
            setSelectedReplyIds((current) => {
                const next = new Set(current);
                next.delete(Number(reply.id));
                return next;
            });
            setZaloPasteFlow((current) => (
                Number(current?.replyId) === Number(reply.id) ? null : current
            ));
            if (Number(replyForm.id) === Number(reply.id)) {
                setFormOpen(false);
                setReplyForm(createEmptyReplyForm());
            }
            await loadBootstrap();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không chuyển mẫu vào thùng rác được.');
        }
    };

    const restoreReply = async (reply) => {
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.restore(reply.id);
            setMessage(response?.data?.message || 'Đã khôi phục mẫu.');
            setReplies((current) => current.filter((item) => Number(item.id) !== Number(reply.id)));
            setSelectedReplyIds((current) => {
                const next = new Set(current);
                next.delete(Number(reply.id));
                return next;
            });
            await loadBootstrap();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không khôi phục được mẫu.');
        }
    };

    const deleteSelectedReplies = async () => {
        const ids = Array.from(selectedReplyIds)
            .map((id) => Number(id))
            .filter(Boolean);

        if (ids.length === 0) {
            setError('Chọn ít nhất một mẫu cần chuyển vào thùng rác.');
            return;
        }

        if (!window.confirm(`Chuyển ${ids.length} mẫu trả lời nhanh đã chọn vào thùng rác?`)) {
            return;
        }

        setBulkDeleting(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.bulkDelete({ ids });
            const deletedCount = response?.data?.deleted_count ?? ids.length;
            setMessage(response?.data?.message || `Đã chuyển ${deletedCount} mẫu vào thùng rác.`);
            setSelectedReplyIds(new Set());
            setZaloPasteFlow((current) => (
                current && ids.includes(Number(current.replyId)) ? null : current
            ));
            if (ids.includes(Number(replyForm.id))) {
                setFormOpen(false);
                setReplyForm(createEmptyReplyForm());
            }
            await refreshReplies();
        } catch (err) {
            const errors = err?.response?.data?.errors;
            const firstError = errors ? Object.values(errors).flat()[0] : null;
            setError(firstError || err?.response?.data?.message || 'Không chuyển các mẫu đã chọn vào thùng rác được.');
        } finally {
            setBulkDeleting(false);
        }
    };

    const restoreSelectedReplies = async () => {
        const ids = Array.from(selectedReplyIds)
            .map((id) => Number(id))
            .filter(Boolean);

        if (ids.length === 0) {
            setError('Chọn ít nhất một mẫu cần khôi phục.');
            return;
        }

        setBulkRestoring(true);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.bulkRestore({ ids });
            const restoredCount = response?.data?.restored_count ?? ids.length;
            setMessage(response?.data?.message || `Đã khôi phục ${restoredCount} mẫu.`);
            setSelectedReplyIds(new Set());
            await refreshReplies();
        } catch (err) {
            const errors = err?.response?.data?.errors;
            const firstError = errors ? Object.values(errors).flat()[0] : null;
            setError(firstError || err?.response?.data?.message || 'Không khôi phục được các mẫu đã chọn.');
        } finally {
            setBulkRestoring(false);
        }
    };

    const duplicateReply = async (reply) => {
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.duplicate(reply.id);
            setMessage(response?.data?.message || 'Đã nhân bản mẫu.');
            await refreshReplies();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không nhân bản được mẫu.');
        }
    };

    const choosePancakeImportMode = (mode) => {
        pancakeImportModeRef.current = mode === 'replace' ? 'replace' : 'merge';
        setPancakeImportPromptOpen(false);
        window.setTimeout(() => pancakeImportInputRef.current?.click(), 0);
    };

    const importPancakeExcel = async (files) => {
        const file = Array.from(files || [])[0];
        if (!file) {
            return;
        }

        if (!file.name.toLowerCase().endsWith('.xlsx')) {
            setError('Chọn đúng file Excel .xlsx xuất từ Pancake.');
            return;
        }

        const importMode = pancakeImportModeRef.current === 'replace' ? 'replace' : 'merge';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('mode', importMode);

        setImportingPancake(true);
        setError('');
        setMessage(importMode === 'replace' ? 'Đang thay thế danh sách bằng file Pancake...' : 'Đang import file Pancake...');

        try {
            const response = await quickReplyApi.importPancake(formData);
            const warningCount = Array.isArray(response?.data?.errors) ? response.data.errors.length : 0;
            setMessage(warningCount > 0
                ? `${response?.data?.message || 'Đã import file Pancake.'} Có ${warningCount} dòng được bỏ qua.`
                : (response?.data?.message || 'Đã import file Pancake.'));
            await refreshReplies();
        } catch (err) {
            const errors = err?.response?.data?.errors;
            const firstError = errors ? Object.values(errors).flat()[0]?.message || Object.values(errors).flat()[0] : null;
            setError(firstError || err?.response?.data?.message || 'Không import được file Pancake.');
        } finally {
            setImportingPancake(false);
        }
    };

    const saveTopic = async (event) => {
        event.preventDefault();
        const name = normalizeText(topicForm.name);
        if (!name) {
            setError('Nhập tên chủ đề.');
            return;
        }

        setSaving(true);
        setError('');
        setMessage('');

        try {
            const payload = {
                name,
                color: topicForm.color || DEFAULT_TOPIC_COLOR,
                is_active: Boolean(topicForm.is_active),
            };
            const response = topicForm.id
                ? await quickReplyApi.updateTopic(topicForm.id, payload)
                : await quickReplyApi.createTopic(payload);

            setMessage(response?.data?.message || 'Đã lưu chủ đề.');
            setTopicForm(emptyTopicForm);
            await loadBootstrap();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không lưu được chủ đề.');
        } finally {
            setSaving(false);
        }
    };

    const editTopic = (topic) => {
        setTopicForm({
            id: topic.id,
            name: topic.name || '',
            color: topic.color || DEFAULT_TOPIC_COLOR,
            is_active: Boolean(topic.is_active),
        });
    };

    const deleteTopic = async (topic) => {
        if (!window.confirm(`Xóa chủ đề ${topic.name}?`)) {
            return;
        }

        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.deleteTopic(topic.id);
            setMessage(response?.data?.message || 'Đã xóa chủ đề.');
            if (String(topicFilter) === String(topic.id)) {
                setTopicFilter('all');
                setPage(1);
            }
            await loadBootstrap();
        } catch (err) {
            setError(err?.response?.data?.message || 'Không xóa được chủ đề.');
        }
    };

    const recordUse = async (reply) => {
        try {
            const response = await quickReplyApi.recordUse(reply.id);
            if (response?.data?.reply) {
                updateReplyInList(response.data.reply);
            }
            await loadBootstrap();
        } catch (err) {
            console.warn('Cannot record quick reply usage.', err);
        }
    };

    const copyReplyText = async (reply) => {
        setCopyingId(reply.id);
        setError('');
        setMessage('');

        try {
            await copyTextFallback(reply.body || '');
            setCopiedState({ id: reply.id, mode: 'text' });
            setMessage(`Đã copy chữ ${reply.shortcut}.`);
            await recordUse(reply);
        } catch (err) {
            setError(err?.message || 'Không copy được nội dung.');
        } finally {
            setCopyingId(null);
        }
    };

    const createPasteFlow = (reply, images, nextImageIndex = 0) => ({
        replyId: reply.id,
        shortcut: reply.shortcut,
        title: reply.title || reply.shortcut,
        body: reply.body || '',
        hasBody: Boolean(normalizeText(reply.body)),
        images,
        nextImageIndex,
    });

    const copyReplyImagesNative = async (reply, options = {}) => {
        const replyId = reply?.id;
        if (!replyId) {
            return;
        }

        const imageCount = replyImageSteps(reply).length;
        if (imageCount === 0) {
            setError('Mẫu này chưa có ảnh để copy.');
            return;
        }

        setCopyingId(replyId);
        setError('');
        setMessage('');

        try {
            const response = await quickReplyApi.copyImages(replyId, {
                record_use: options.recordUse ?? true,
            });
            const copiedImages = response?.data?.copied_images || imageCount;
            if (response?.data?.reply) {
                updateReplyInList(response.data.reply);
                await loadBootstrap();
            }
            setCopiedState({ id: replyId, mode: 'images' });
            setZaloPasteFlow((current) => {
                if (!current || Number(current.replyId) !== Number(replyId)) {
                    return current;
                }

                return {
                    ...current,
                    nextImageIndex: current.images.length,
                };
            });
            setMessage(response?.data?.message || `Đã copy ${copiedImages} ảnh. Sang Zalo bấm Ctrl+V để dán cùng lúc.`);
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Không copy được nhiều ảnh. Nếu PHP không truy cập được clipboard Windows, cần chạy app trong phiên Windows đang đăng nhập.');
        } finally {
            setCopyingId(null);
        }
    };

    const openReplyImagePreview = (reply, initialIndex = 0) => {
        const images = flattenReplyImages(reply).filter((image) => imageSource(image, 'large'));
        if (images.length === 0) {
            setError('Mẫu này chưa có ảnh để xem.');
            return;
        }

        setReplyImagePreview({
            reply,
            images,
            index: Math.max(0, Math.min(Number(initialIndex) || 0, images.length - 1)),
        });
    };

    const handleReplyThumbnailClick = (reply) => {
        if (replyImageClickTimerRef.current) {
            window.clearTimeout(replyImageClickTimerRef.current);
        }

        replyImageClickTimerRef.current = window.setTimeout(() => {
            replyImageClickTimerRef.current = null;
            void copyReplyImagesNative(reply);
        }, 220);
    };

    const handleReplyThumbnailDoubleClick = (reply, initialIndex = 0) => {
        if (replyImageClickTimerRef.current) {
            window.clearTimeout(replyImageClickTimerRef.current);
            replyImageClickTimerRef.current = null;
        }

        setReplyImageHoverPreview(null);
        openReplyImagePreview(reply, initialIndex);
    };

    const showReplyImageHoverPreview = (event, reply) => {
        const images = flattenReplyImages(reply);
        const firstImage = images[0] || null;
        const src = firstImage ? imageSource(firstImage, 'thumbnail') : '';
        if (!src) {
            setReplyImageHoverPreview(null);
            return;
        }

        const previewSize = 112;
        const offset = 12;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || previewSize;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || previewSize;
        const left = event.clientX + offset + previewSize > viewportWidth - 8
            ? Math.max(8, event.clientX - previewSize - offset)
            : event.clientX + offset;
        const top = event.clientY + offset + previewSize > viewportHeight - 8
            ? Math.max(8, event.clientY - previewSize - offset)
            : event.clientY + offset;

        setReplyImageHoverPreview({
            src,
            count: images.length,
            left,
            top,
        });
    };
    const openSendDraft = (reply) => {
        setSendDraft(createSendDraftFromReply(reply));
        setHoveredSendContentKey(null);
        setFocusedSendContentKey(null);
        setError('');
        setMessage('');
    };

    const updateSendDraftContent = (contentIndex, changes) => {
        setSendDraft((current) => {
            if (!current) {
                return current;
            }

            return {
                ...current,
                contents: current.contents.map((content, index) => (
                    index === contentIndex ? { ...content, ...changes } : content
                )),
            };
        });
    };

    const toggleSendDraftImage = (contentIndex, imageIndex) => {
        setSendDraft((current) => {
            if (!current) {
                return current;
            }

            return {
                ...current,
                contents: current.contents.map((content, index) => {
                    if (index !== contentIndex) {
                        return content;
                    }

                    return {
                        ...content,
                        images: (content.images || []).map((image, imagePosition) => (
                            imagePosition === imageIndex ? { ...image, selected: image.selected === false } : image
                        )),
                    };
                }),
            };
        });
    };

    const submitReplyToZalo = async (reply, payload = {}) => {
        const replyId = reply?.id;
        if (!replyId) {
            return;
        }

        const preparedPayload = Array.isArray(payload?.contents)
            ? payload
            : buildSendDraftPayload(createSendDraftFromReply(reply));
        const useBrowserClipboardForWeb = shouldUseBrowserOnlyZaloWebDock(zaloTarget);

        setCopyingId(replyId);
        setError('');
        setMessage(useBrowserClipboardForWeb ? 'Đang chuẩn bị nội dung cho Zalo Web...' : 'Đang gửi sang chat Zalo đang mở...');

        try {
            if (useBrowserClipboardForWeb) {
                const contents = sendPayloadClipboardContents(preparedPayload);
                const textToCopy = sendPayloadClipboardText(preparedPayload);
                const imageCount = sendPayloadImageCount(preparedPayload);

                if (contents.length === 0) {
                    throw new Error('Mẫu này chưa có nội dung để gửi.');
                }

                let sentSteps = 0;
                let sentText = 0;
                let sentImages = 0;
                let manualImages = 0;

                const fallbackToCopyOnly = async () => {
                    if (sentSteps > 0) {
                        throw new Error('Backend local bị ngắt khi đang gửi Zalo Web. Có thể đã gửi một phần, kiểm tra lại khung chat trước khi gửi lại.');
                    }

                    if (!textToCopy) {
                        throw new Error(imageCount > 0
                            ? 'Mẫu này chỉ có ảnh. Chưa thấy backend local nên Zalo Web không tự gửi ảnh được; hãy bật backend local hoặc dùng Zalo PC.'
                            : 'Mẫu này chưa có nội dung để gửi.');
                    }

                    await copyTextFallback(textToCopy);
                    focusZaloWebPopup();
                    await recordUse(reply);
                    setCopiedState({ id: replyId, mode: 'sent' });
                    setZaloPasteFlow(null);
                    setSendDraft(null);
                    setMessage(imageCount > 0
                        ? `Chưa thấy backend local nên mới copy chữ vào clipboard. Bật backend local để tự gửi; mẫu có ${imageCount} ảnh chưa gửi.`
                        : 'Chưa thấy backend local nên mới copy vào clipboard. Bật backend local để tự gửi sang Zalo Web.'
                    );
                };

                const pasteToZaloWeb = async (data = {}) => {
                    try {
                        return await quickReplyApi.localWindowBridgePasteZalo({
                            zalo_target: 'web',
                            ...data,
                        });
                    } catch (bridgeErr) {
                        if (!isLocalBridgeNetworkError(bridgeErr)) {
                            throw bridgeErr;
                        }

                        await fallbackToCopyOnly();
                        return null;
                    }
                };

                for (const content of contents) {
                    let pastedInStep = false;
                    let pastedImagesInStep = 0;

                    if (content.body) {
                        await copyTextFallback(content.body);
                        const pasteResponse = await pasteToZaloWeb({
                            paste: true,
                            enter: false,
                        });
                        if (!pasteResponse) {
                            return;
                        }
                        pastedInStep = true;
                        sentText += 1;
                        await sleep(260);
                    }

                    for (const item of content.images) {
                        let copyResult = null;
                        try {
                            copyResult = await writeImageSourceToClipboard(item.src);
                        } catch (imageErr) {
                            console.warn('Cannot copy image to clipboard for Zalo Web.', imageErr, item.image);
                            manualImages += 1;
                            continue;
                        }

                        if (copyResult !== 'image') {
                            manualImages += 1;
                            continue;
                        }

                        const pasteResponse = await pasteToZaloWeb({
                            paste: true,
                            enter: false,
                        });
                        if (!pasteResponse) {
                            return;
                        }
                        pastedInStep = true;
                        pastedImagesInStep += 1;
                        sentImages += 1;
                        await sleep(650);
                    }

                    if (pastedInStep) {
                        const sendResponse = await pasteToZaloWeb({
                            paste: false,
                            enter: true,
                            before_enter_delay_ms: pastedImagesInStep > 0 ? 1500 : 280,
                        });
                        if (!sendResponse) {
                            return;
                        }
                        sentSteps += 1;
                        await sleep(760);
                    }
                }

                if (sentSteps === 0) {
                    throw new Error(manualImages > 0
                        ? 'Không copy được ảnh sang clipboard để gửi Zalo Web. Hãy dùng Zalo PC hoặc gửi ảnh thủ công.'
                        : 'Mẫu này chưa có nội dung để gửi.');
                }

                await recordUse(reply);
                setCopiedState({ id: replyId, mode: 'sent' });
                setZaloPasteFlow(null);
                setSendDraft(null);
                setMessage(manualImages > 0
                    ? `Đã gửi ${sentSteps} tin sang Zalo Web. Đã gửi ${sentText} chữ, ${sentImages} ảnh; còn ${manualImages} ảnh trình duyệt không copy được.`
                    : `Đã gửi ${sentSteps} tin sang Zalo Web.`
                );
                return;
            }

            const response = await quickReplyApi.sendToZalo(replyId, { ...preparedPayload, zalo_target: zaloTarget });
            if (response?.data?.reply) {
                updateReplyInList(response.data.reply);
                await loadBootstrap();
            }
            setCopiedState({ id: replyId, mode: 'sent' });
            setZaloPasteFlow(null);
            setSendDraft(null);
            setMessage(response?.data?.message || 'Đã gửi mẫu sang chat Zalo đang mở.');
        } catch (err) {
            const targetName = zaloTarget === 'web' ? 'Zalo Web Chrome' : 'Zalo PC';
            setMessage('');
            setError(await apiErrorMessage(err, `Không gửi được sang ${targetName}. Hãy mở đúng khung chat rồi thử lại.`));
        } finally {
            setCopyingId(null);
        }
    };

    const sendPreparedReplyToZalo = async () => {
        if (!sendDraft) {
            return;
        }

        const payload = buildSendDraftPayload(sendDraft);
        if (payload.contents.length === 0) {
            setError('Chọn ít nhất 1 tin có nội dung hoặc ảnh để gửi.');
            return;
        }

        await submitReplyToZalo(sendDraft.reply, payload);
    };

    const sendReplyToZalo = async (reply, options = {}) => {
        const replyId = reply?.id;
        if (!replyId) {
            return;
        }

        const hasDraftData = Array.isArray(reply?.contents) || normalizeText(reply?.body || '') || replyImageSteps(reply).length > 0;
        if (!options.force && hasDraftData) {
            openSendDraft(reply);
            return;
        }

        await submitReplyToZalo(reply, options.payload || {});
    };
    const copyReplyAll = async (reply) => {
        setCopyingId(reply.id);
        setError('');
        setMessage('');

        try {
            const plainText = reply.body || '';
            const images = replyImageSteps(reply);
            const hasText = Boolean(normalizeText(plainText));

            if (hasText) {
                await copyTextFallback(plainText);
                setZaloPasteFlow(images.length > 0 ? createPasteFlow(reply, images, 0) : null);
                setCopiedState({ id: reply.id, mode: 'all' });
                setMessage(images.length > 0
                    ? `Đã copy chữ ${reply.shortcut}. Dán chữ xong, bấm Copy tất cả ảnh để dán ảnh vào Zalo.`
                    : `Đã copy ${reply.shortcut}.`);
                await recordUse(reply);
                return;
            }

            if (images.length > 0) {
                await copyReplyImagesNative(reply);
                return;
            }

            setError('Mẫu này chưa có nội dung hoặc ảnh để copy.');
        } catch (err) {
            setError(err?.message || 'Không copy được mẫu.');
        } finally {
            setCopyingId(null);
        }
    };

    const copySingleImage = async (reply, image) => {
        const src = imageSource(image, 'large');
        if (!src) {
            setError('Ảnh này chưa có URL hợp lệ.');
            return;
        }

        setCopyingId(reply.id);
        setError('');
        setMessage('');

        try {
            const result = await writeImageSourceToClipboard(src);
            setCopiedState({ id: reply.id, mode: `image-${image.id}` });
            setMessage(result === 'link' ? 'Đã copy link ảnh.' : 'Đã copy ảnh.');
            await recordUse(reply);
        } catch (err) {
            setError(err?.message || 'Không copy được ảnh. Có thể ảnh đang bị chặn bởi trình duyệt hoặc CORS.');
        } finally {
            setCopyingId(null);
        }
    };

    const copyPasteFlowText = async () => {
        if (!zaloPasteFlow?.body) {
            return;
        }

        setCopyingId(zaloPasteFlow.replyId);
        setError('');
        setMessage('');

        try {
            await copyTextFallback(zaloPasteFlow.body);
            setCopiedState({ id: zaloPasteFlow.replyId, mode: 'text' });
            setMessage(`Đã copy lại chữ ${zaloPasteFlow.shortcut}.`);
        } catch (err) {
            setError(err?.message || 'Không copy được nội dung.');
        } finally {
            setCopyingId(null);
        }
    };

    const copyPasteFlowAllImages = async () => {
        if (!zaloPasteFlow) {
            return;
        }

        await copyReplyImagesNative({
            id: zaloPasteFlow.replyId,
            images: zaloPasteFlow.images.map((image) => ({ id: image.id, url: image.src, large_url: image.src })),
        }, { recordUse: false });
    };

    const copyPasteFlowImage = async (imageStep, index) => {
        if (!imageStep?.src || !zaloPasteFlow) {
            return;
        }

        setCopyingId(zaloPasteFlow.replyId);
        setError('');
        setMessage('');

        try {
            const result = await writeImageSourceToClipboard(imageStep.src);
            setCopiedState({ id: zaloPasteFlow.replyId, mode: `image-${imageStep.id}` });
            setZaloPasteFlow((current) => {
                if (!current || current.replyId !== zaloPasteFlow.replyId) {
                    return current;
                }

                return {
                    ...current,
                    nextImageIndex: Math.max(current.nextImageIndex, index + 1),
                };
            });
            setMessage(result === 'link'
                ? `Trình duyệt chỉ copy được link ảnh ${index + 1}/${zaloPasteFlow.images.length}.`
                : `Đã copy ảnh ${index + 1}/${zaloPasteFlow.images.length}.`);
        } catch (err) {
            setError(err?.message || 'Không copy được ảnh. Có thể ảnh đang bị chặn bởi trình duyệt hoặc CORS.');
        } finally {
            setCopyingId(null);
        }
    };


    const openZaloSidebar = async () => {
        const panelTarget = normalizeZaloTarget(zaloTarget);
        const targetOption = ZALO_TARGET_OPTIONS.find((option) => option.value === panelTarget) || ZALO_TARGET_OPTIONS[0];
        const targetLabel = targetOption.label;
        const targetAppName = panelTarget === 'web' ? 'Zalo Web Chrome' : 'Zalo Desktop';
        const useLocalWindowBridge = shouldUseLocalWindowBridge(panelTarget);
        const useBrowserOnlyZaloWebDock = shouldUseBrowserOnlyZaloWebDock(panelTarget);
        const metrics = sidebarWindowMetrics();
        const sidebarUrl = new URL('/admin/quick-replies', window.location.origin);
        sidebarUrl.searchParams.set('mode', 'zalo-sidebar');
        sidebarUrl.searchParams.set('dock', '0');
        sidebarUrl.searchParams.set('zalo_target', panelTarget);

        setSplittingZalo(true);
        setError('');
        setMessage('');

        try {
            const currentPanel = sidebarWindowsRef.current[panelTarget];
            if (currentPanel && !currentPanel.closed) {
                currentPanel.close();
            }

            const popupFeatures = [
                'popup=yes',
                'toolbar=no',
                'location=no',
                'menubar=no',
                'status=no',
                `width=${metrics.width}`,
                `height=${metrics.height}`,
                `left=${metrics.left}`,
                `top=${metrics.top}`,
                'resizable=yes',
                'scrollbars=yes',
            ].join(',');
            let sidebarWindow = window.open(sidebarUrl.toString(), sidebarWindowNameForTarget(panelTarget), popupFeatures);
            let browserOnlyZaloWebWindow = null;
            if (useBrowserOnlyZaloWebDock) {
                browserOnlyZaloWebWindow = openZaloWebWindowBesideSidebar(metrics);
            }
            let sidebarReady = false;
            if (sidebarWindow) {
                sidebarWindowsRef.current[panelTarget] = sidebarWindow;
                try {
                    sidebarWindow.focus();
                    sidebarWindow.resizeTo(metrics.width, metrics.height);
                    sidebarWindow.moveTo(metrics.left, metrics.top);
                } catch {
                    // Some browsers block moving popup windows, but the backend split step can still dock it.
                }
                sidebarReady = await waitForSidebarWindowReady(sidebarWindow, sidebarUrl);
            }

            if (sidebarWindow && !sidebarReady && !useLocalWindowBridge) {
                try {
                    sidebarWindow.close();
                } catch {
                    // Ignore close errors; the main page will show a clear retry message.
                }
                if (sidebarWindowsRef.current[panelTarget] === sidebarWindow) {
                    sidebarWindowsRef.current[panelTarget] = null;
                }
                sidebarWindow = null;
            }

            const splitPayload = {
                mode: 'sidebar',
                sidebar_width: metrics.width,
                sidebar_url: sidebarWindow ? '' : sidebarUrl.toString(),
                require_browser: false,
                manage_browser: !sidebarWindow,
                browser_window_keywords: sidebarBrowserKeywordsForTarget(panelTarget),
                zalo_target: panelTarget,
                gap: 0,
            };

            if (useBrowserOnlyZaloWebDock) {
                if (!sidebarWindow || sidebarWindow.closed) {
                    throw new Error('Chrome đang chặn popup panel trả lời nhanh. Bật cho phép popup cho trang này rồi bấm Panel phải lại.');
                }

                if (!browserOnlyZaloWebWindow || browserOnlyZaloWebWindow.closed) {
                    throw new Error('Chrome đang chặn popup Zalo Web. Bật cho phép popup cho trang quản trị rồi bấm Panel phải lại.');
                }

                const dockBrowserOnlyWebWindows = (focusSidebar = false) => {
                    const screenRef = window.screen || {};
                    const left = Number(screenRef.availLeft || 0);
                    const top = Number(screenRef.availTop || 0);
                    const availableWidth = Number(screenRef.availWidth || window.outerWidth || 1440);
                    const availableHeight = Number(screenRef.availHeight || window.outerHeight || 900);
                    const sidebarWidth = Math.max(Number(metrics?.width) || 420, 320);
                    const zaloWidth = Math.max(availableWidth - sidebarWidth, 620);

                    try {
                        browserOnlyZaloWebWindow.resizeTo(zaloWidth, availableHeight);
                        browserOnlyZaloWebWindow.moveTo(left, top);
                    } catch {
                        // Chrome can ignore resize for some popup policies.
                    }

                    try {
                        sidebarWindow.resizeTo(sidebarWidth, availableHeight);
                        sidebarWindow.moveTo(Math.max(left + availableWidth - sidebarWidth, left), top);
                        if (focusSidebar) {
                            sidebarWindow.focus();
                        }
                    } catch {
                        // The panel was opened by this page, but Chrome may still restrict positioning.
                    }
                };

                dockBrowserOnlyWebWindows(true);
                [160, 520, 1100, 2100].forEach((delay) => {
                    window.setTimeout(() => dockBrowserOnlyWebWindows(false), delay);
                });
                setMessage('Đã mở Zalo Web bên trái, panel trả lời nhanh bên phải bằng Chrome.');
                return;
            }

            if (useLocalWindowBridge) {
                try {
                    const bridgeResponse = await quickReplyApi.localWindowBridgeSplitZalo(splitPayload);
                    setMessage(bridgeResponse?.data?.message || `Đã mở panel ${targetLabel} bên phải.`);
                    return;
                } catch (bridgeErr) {
                    if (isLocalBridgeNetworkError(bridgeErr)) {
                        if (sidebarWindow && !sidebarWindow.closed) {
                            try {
                                sidebarWindow.location.href = sidebarUrl.toString();
                            } catch {
                                // The popup may already be navigating to the sidebar.
                            }
                            dockSidebarWindowToRight(sidebarWindow, metrics, true);
                            [180, 620, 1400].forEach((delay) => {
                                window.setTimeout(() => dockSidebarWindowToRight(sidebarWindow, metrics, false), delay);
                            });
                            setMessage('Đã mở panel PC bên phải. Không thấy backend local nên chưa tự kéo được Zalo PC; kéo Zalo app sang trái hoặc bật backend local để tự kéo.');
                            return;
                        }

                        throw new Error(localBridgeUnavailableMessage(targetAppName));
                    }

                    const bridgeMessage = await apiErrorMessage(
                        bridgeErr,
                        `Không gọi được local bridge để kéo ${targetAppName}.`
                    );
                    throw new Error(bridgeMessage);
                }
            }

            let response;
            try {
                response = await quickReplyApi.splitZalo(splitPayload);
            } catch (splitErr) {
                const splitMessage = await apiErrorMessage(splitErr, `Không mở được panel ${targetLabel} bên phải. Hãy mở ${targetAppName} rồi thử lại.`);
                if (isWindowsBackendOnlyMessage(splitMessage)) {
                    if (panelTarget === 'web') {
                        setMessage('Đã mở panel Web. Backend hiện không chạy trên Windows nên đang chuyển cửa sổ chính sang Zalo Web.');
                        window.setTimeout(() => {
                            window.location.assign(ZALO_WEB_URL);
                        }, 120);
                    } else {
                        setMessage('Đã mở panel PC bên phải. Backend hiện không chạy trên Windows nên không tự kéo được Zalo PC; kéo Zalo app sang trái rồi gửi như bình thường.');
                    }
                    return;
                }
                throw new Error(splitMessage);
            }

            const result = response?.data?.result || {};
            if (!sidebarWindow && !result.browser_found) {
                setMessage(`Đã đặt ${targetLabel} bên trái. Nếu panel chưa hiện, bật cho phép popup rồi bấm Panel phải lại.`);
            } else {
                setMessage(response?.data?.message || `Đã mở panel ${targetLabel} bên phải.`);
            }
        } catch (err) {
            setError(await apiErrorMessage(err, `Không mở được panel ${targetLabel} bên phải. Hãy mở ${targetAppName} rồi thử lại.`));
        } finally {
            setSplittingZalo(false);
        }
    };
    const loadZaloMirrorScreenshot = useCallback(async ({ silent = false } = {}) => {
        if (!zaloMirrorOpen) {
            return;
        }

        if (!silent) {
            setZaloMirrorLoading(true);
        }

        try {
            const response = await quickReplyApi.getZaloMirrorScreenshot({ t: Date.now(), zalo_target: zaloTarget });
            const nextUrl = URL.createObjectURL(response.data);
            if (zaloMirrorObjectUrlRef.current) {
                URL.revokeObjectURL(zaloMirrorObjectUrlRef.current);
            }
            zaloMirrorObjectUrlRef.current = nextUrl;
            setZaloMirrorSrc(nextUrl);
        } catch (err) {
            setError(await apiErrorMessage(err, 'Không lấy được màn hình Zalo live. Hãy mở Zalo Desktop rồi thử lại.'));
        } finally {
            if (!silent) {
                setZaloMirrorLoading(false);
            }
        }
    }, [zaloMirrorOpen, zaloTarget]);

    useEffect(() => {
        if (!zaloMirrorOpen) {
            return undefined;
        }

        void loadZaloMirrorScreenshot();

        if (!zaloMirrorAutoRefresh) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            void loadZaloMirrorScreenshot({ silent: true });
        }, 1400);

        return () => window.clearInterval(intervalId);
    }, [loadZaloMirrorScreenshot, zaloMirrorAutoRefresh, zaloMirrorOpen]);

    useEffect(() => () => {
        if (zaloMirrorObjectUrlRef.current) {
            URL.revokeObjectURL(zaloMirrorObjectUrlRef.current);
            zaloMirrorObjectUrlRef.current = '';
        }
    }, []);

    useEffect(() => {
        if (zaloMirrorOpen || !zaloMirrorObjectUrlRef.current) {
            return;
        }

        URL.revokeObjectURL(zaloMirrorObjectUrlRef.current);
        zaloMirrorObjectUrlRef.current = '';
        setZaloMirrorSrc('');
        setZaloMirrorLoading(false);
    }, [zaloMirrorOpen, zaloTarget]);

    const handleZaloMirrorClick = async (event) => {
        if (!zaloMirrorSrc) {
            return;
        }

        const image = event.currentTarget;
        const rect = image.getBoundingClientRect();
        const naturalRatio = image.naturalWidth && image.naturalHeight
            ? image.naturalWidth / image.naturalHeight
            : rect.width / Math.max(rect.height, 1);
        const rectRatio = rect.width / Math.max(rect.height, 1);
        let renderedWidth = rect.width;
        let renderedHeight = rect.height;
        let offsetX = 0;
        let offsetY = 0;

        if (naturalRatio > rectRatio) {
            renderedHeight = rect.width / naturalRatio;
            offsetY = (rect.height - renderedHeight) / 2;
        } else {
            renderedWidth = rect.height * naturalRatio;
            offsetX = (rect.width - renderedWidth) / 2;
        }

        const xRatio = (event.clientX - rect.left - offsetX) / Math.max(renderedWidth, 1);
        const yRatio = (event.clientY - rect.top - offsetY) / Math.max(renderedHeight, 1);

        if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
            return;
        }

        setZaloMirrorLoading(true);
        setError('');

        try {
            await quickReplyApi.clickZaloMirror({
                x_ratio: Math.min(Math.max(xRatio, 0), 1),
                y_ratio: Math.min(Math.max(yRatio, 0), 1),
                double: false,
                zalo_target: zaloTarget,
            });
            await loadZaloMirrorScreenshot({ silent: true });
        } catch (err) {
            setError(await apiErrorMessage(err, 'Không click được vào Zalo live.'));
        } finally {
            setZaloMirrorLoading(false);
        }
    };

    const typeIntoZaloMirror = async (enter = false) => {
        const text = zaloMirrorText.trim();
        if (!text && !enter) {
            return;
        }

        setZaloMirrorLoading(true);
        setError('');

        try {
            await quickReplyApi.typeZaloMirror({ text, enter, zalo_target: zaloTarget });
            if (enter) {
                setZaloMirrorText('');
            }
            await loadZaloMirrorScreenshot({ silent: true });
        } catch (err) {
            setError(await apiErrorMessage(err, 'Không gõ được vào Zalo live.'));
        } finally {
            setZaloMirrorLoading(false);
        }
    };

    const handleSearchKeyDown = (event) => {
        if (event.key !== 'Enter' || isTrashMode) {
            return;
        }

        const firstReply = replies[0];
        if (firstReply) {
            event.preventDefault();
            void copyReplyAll(firstReply);
        }
    };

    const tableRows = replies;
    const selectedReplyIdList = Array.from(selectedReplyIds);
    const selectedGalleryIdList = Array.from(selectedGalleryImageIds);
    const visibleGalleryImageIds = galleryImages
        .map((image) => Number(image.id))
        .filter(Boolean);
    const selectedVisibleGalleryCount = visibleGalleryImageIds
        .filter((imageId) => selectedGalleryImageIds.has(imageId))
        .length;
    const allVisibleGalleryImagesSelected = visibleGalleryImageIds.length > 0 && selectedVisibleGalleryCount === visibleGalleryImageIds.length;
    const bulkBusy = bulkDeleting || bulkRestoring;
    const visibleReplyIds = tableRows
        .map((reply) => Number(reply.id))
        .filter(Boolean);
    const selectedVisibleReplyCount = visibleReplyIds
        .filter((replyId) => selectedReplyIds.has(replyId))
        .length;
    const allVisibleRepliesSelected = visibleReplyIds.length > 0 && selectedVisibleReplyCount === visibleReplyIds.length;

    useEffect(() => {
        if (bulkSelectAllRef.current) {
            bulkSelectAllRef.current.indeterminate = selectedVisibleReplyCount > 0 && !allVisibleRepliesSelected;
        }
    }, [allVisibleRepliesSelected, selectedVisibleReplyCount]);

    const galleryActionBusy = galleryLoading || galleryFolderSaving || gallerySending;
    const galleryBusy = galleryActionBusy || galleryUploading;
    const galleryZoomSrc = galleryZoomImage ? imageSource(galleryZoomImage, 'large') : '';
    const galleryZoomName = galleryZoomImage?.name || galleryZoomImage?.filename || 'Ảnh trong kho';

    const replyPreviewImages = Array.isArray(replyImagePreview?.images) ? replyImagePreview.images : [];
    const replyPreviewIndex = Math.max(0, Math.min(Number(replyImagePreview?.index) || 0, Math.max(replyPreviewImages.length - 1, 0)));
    const replyPreviewImage = replyPreviewImages[replyPreviewIndex] || null;
    const replyPreviewSrc = replyPreviewImage ? imageSource(replyPreviewImage, 'large') : '';
    const replyPreviewName = replyPreviewImage?.name || replyPreviewImage?.filename || `Ảnh ${replyPreviewIndex + 1}`;
    const replyImagePreviewModal = replyImagePreview ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-[2px]" onClick={() => setReplyImagePreview(null)}>
            <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-sm bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="inline-flex h-7 max-w-[150px] items-center truncate rounded-sm bg-slate-100 px-2 text-[12px] font-black text-slate-700" title={replyImagePreview.reply?.shortcut || ''}>
                                {replyImagePreview.reply?.shortcut || 'Ảnh'}
                            </span>
                            {replyImagePreview.reply?.topic && (
                                <span className="inline-flex max-w-[120px] items-center truncate rounded-full px-2.5 py-1 text-[11px] font-black text-white" style={{ backgroundColor: replyImagePreview.reply.topic.color || DEFAULT_TOPIC_COLOR }} title={replyImagePreview.reply.topic.name}>
                                    {replyImagePreview.reply.topic.name}
                                </span>
                            )}
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700">{formatNumber(replyPreviewImages.length)} ảnh</span>
                        </div>
                        <div className="mt-1 truncate text-[12px] font-semibold text-slate-500">{replyPreviewName}</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setReplyImagePreview(null)}
                        className={iconButtonClassName}
                        title="Đóng ảnh"
                        aria-label="Đóng ảnh"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </header>

                <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-2">
                    {replyPreviewSrc ? (
                        <img src={replyPreviewSrc} alt={replyPreviewName} className="max-h-[62vh] max-w-full object-contain" />
                    ) : (
                        <div className="flex h-64 w-full items-center justify-center text-sm font-bold text-slate-400">Không có ảnh để phóng to.</div>
                    )}
                </div>

                <div className="shrink-0 border-t border-slate-200 bg-white p-3">
                    {replyPreviewImages.length > 1 && (
                        <div className="mb-3 max-h-28 overflow-y-auto pr-1">
                            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
                                {replyPreviewImages.map((image, imageIndex) => {
                                    const src = imageSource(image, 'thumbnail');
                                    const active = imageIndex === replyPreviewIndex;
                                    const imageName = image.name || image.filename || `Ảnh ${imageIndex + 1}`;

                                    return (
                                        <button
                                            key={image.id || `${src}-${imageIndex}`}
                                            type="button"
                                            onClick={() => setReplyImagePreview((current) => current ? { ...current, index: imageIndex } : current)}
                                            className={`relative aspect-square overflow-hidden rounded-sm border bg-slate-100 transition ${active ? 'border-sky-500 ring-2 ring-sky-100' : 'border-slate-200 hover:border-sky-300'}`}
                                            title={imageName}
                                            aria-label={`Xem ảnh ${imageIndex + 1}`}
                                        >
                                            {src ? (
                                                <img src={src} alt={imageName} className="h-full w-full object-cover" />
                                            ) : (
                                                <span className="material-symbols-outlined flex h-full w-full items-center justify-center text-slate-300">image</span>
                                            )}
                                            <span className={`absolute left-0.5 top-0.5 inline-flex size-4 items-center justify-center rounded-sm text-[9px] font-black ${active ? 'bg-sky-600 text-white' : 'bg-white/90 text-slate-500'}`}>{imageIndex + 1}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-bold text-slate-500">Ảnh {formatNumber(replyPreviewIndex + 1)}/{formatNumber(replyPreviewImages.length)}</span>
                        <button
                            type="button"
                            onClick={() => copyReplyImagesNative(replyImagePreview.reply)}
                            disabled={Boolean(copyingId)}
                            className={secondaryButtonClassName}
                        >
                            <span className="material-symbols-outlined text-[18px]">content_copy</span>
                            Copy ảnh
                        </button>
                    </div>
                </div>
            </div>
        </div>
    ) : null;
    const replyImageHoverPreviewBubble = replyImageHoverPreview ? (
        <div
            className="pointer-events-none fixed z-[115] overflow-hidden rounded-sm border border-white bg-white shadow-2xl ring-1 ring-slate-900/15"
            style={{ left: replyImageHoverPreview.left, top: replyImageHoverPreview.top, width: 112, height: 112 }}
        >
            <img src={replyImageHoverPreview.src} alt="" className="h-full w-full object-cover" />
            {replyImageHoverPreview.count > 1 && (
                <span className="absolute bottom-1 right-1 rounded-sm bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-black text-white">
                    {formatNumber(replyImageHoverPreview.count)} ảnh
                </span>
            )}
        </div>
    ) : null;
    const galleryModal = galleryOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-2 text-slate-900 sm:p-4">
            <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-sm bg-white shadow-2xl">
                <header className="shrink-0 border-b border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-black text-slate-950">Thư mục ảnh</h2>
                            <p className="mt-0.5 text-[12px] font-semibold text-slate-400">
                                {formatNumber(galleryStats.images)} ảnh · {formatNumber(galleryStats.folders)} thư mục
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={closeGallery}
                            className={iconButtonClassName}
                            title="Đóng kho ảnh"
                            aria-label="Đóng kho ảnh"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </div>
                    <div className="mt-3 relative">
                        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">search</span>
                        <input
                            value={gallerySearch}
                            onChange={(event) => {
                                setGallerySearch(event.target.value);
                                setGalleryPage(1);
                            }}
                            placeholder="Tìm kiếm ảnh bằng tên..."
                            className={`${inputClassName} pl-10`}
                        />
                    </div>
                    {(error || message) && (
                        <div className={`mt-2 rounded-sm border px-3 py-2 text-[12px] font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                            {error || message}
                        </div>
                    )}
                </header>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
                        <div className="max-h-[146px] overflow-y-auto pr-1">
                            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                                {GALLERY_FILTERS.map((filter) => {
                                    const count = filter.value === 'all'
                                        ? galleryStats.images
                                        : filter.value === 'favorite'
                                            ? galleryStats.favorite_images
                                            : null;
                                    const active = galleryFolderFilter === filter.value;

                                    return (
                                        <button
                                            key={filter.value}
                                            type="button"
                                            onClick={() => selectGalleryFolder(filter.value)}
                                            className={`flex h-7 min-w-0 items-center rounded-sm border px-1.5 text-left transition ${active ? 'border-sky-500 bg-sky-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-sky-800'}`}
                                            title={filter.label}
                                        >
                                            <span className="min-w-0 flex-1 truncate text-[10px] font-bold leading-none">{filter.label}</span>
                                            {count !== null && <span className={`ml-1 shrink-0 text-[9px] font-black leading-none ${active ? 'text-white/85' : 'text-slate-400'}`}>{formatNumber(count)}</span>}
                                        </button>
                                    );
                                })}

                                {galleryFolders.map((folder) => {
                                    const active = String(galleryFolderFilter) === String(folder.id);

                                    return (
                                        <button
                                            key={folder.id}
                                            type="button"
                                            onClick={() => selectGalleryFolder(String(folder.id))}
                                            onContextMenu={(event) => openGalleryFolderMenu(event, folder)}
                                            className={`flex h-7 min-w-0 items-center rounded-sm border px-1.5 text-left transition ${active ? 'border-sky-500 bg-sky-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-sky-800'}`}
                                            title={`${folder.name} - bấm chuột phải để đổi tên hoặc xóa`}
                                        >
                                            <span className="min-w-0 flex-1 truncate text-[10px] font-bold leading-none">{folder.name}</span>
                                            <span className={`ml-1 shrink-0 text-[9px] font-black leading-none ${active ? 'text-white/85' : 'text-slate-400'}`}>{formatNumber(folder.images_count)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <form onSubmit={createGalleryFolder} className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
                            <input
                                value={galleryFolderName}
                                onChange={(event) => setGalleryFolderName(event.target.value)}
                                placeholder="Tên thư mục mới"
                                className="h-8 w-full rounded-sm border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10"
                            />
                            <button
                                type="submit"
                                disabled={galleryFolderSaving || !normalizeText(galleryFolderName)}
                                className="inline-flex h-8 items-center justify-center gap-1 rounded-sm border border-slate-200 bg-white px-2 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined text-[15px]">create_new_folder</span>
                                {galleryFolderSaving ? '...' : 'Thêm'}
                            </button>
                            <button
                                type="button"
                                onClick={() => toggleVisibleGallerySelection(!allVisibleGalleryImagesSelected)}
                                disabled={galleryImages.length === 0 || galleryBusy}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                                title={allVisibleGalleryImagesSelected ? 'Bỏ chọn ảnh đang hiển thị' : 'Chọn tất cả ảnh đang hiển thị'}
                                aria-label={allVisibleGalleryImagesSelected ? 'Bỏ chọn ảnh đang hiển thị' : 'Chọn tất cả ảnh đang hiển thị'}
                            >
                                <span className="material-symbols-outlined text-[16px]">select_all</span>
                            </button>
                        </form>
                    </div>

                    {galleryFolderMenu && (
                        <div
                            className="fixed z-[120] w-[132px] overflow-hidden rounded-sm border border-slate-200 bg-white py-1 text-[12px] font-bold text-slate-700 shadow-xl"
                            style={{ left: galleryFolderMenu.x, top: galleryFolderMenu.y }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={() => renameGalleryFolder(galleryFolderMenu.folder)}
                                disabled={galleryBusy}
                                className="block w-full px-3 py-2 text-left transition hover:bg-sky-50 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Đổi tên
                            </button>
                            <button
                                type="button"
                                onClick={() => deleteGalleryFolder(galleryFolderMenu.folder)}
                                disabled={galleryBusy}
                                className="block w-full px-3 py-2 text-left text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Xóa thư mục
                            </button>
                        </div>
                    )}

                    <section className="flex min-h-0 flex-1 flex-col bg-white">
                        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
                            {galleryLoading ? (
                                <div className="flex h-52 items-center justify-center rounded-sm border border-slate-200 bg-slate-50 text-[13px] font-bold text-slate-400">
                                    Đang tải kho ảnh...
                                </div>
                            ) : galleryImages.length === 0 ? (
                                <div className="flex h-52 items-center justify-center rounded-sm border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-[13px] font-bold text-slate-400">
                                    Chưa có ảnh phù hợp. Bấm Thêm ảnh để tải ảnh vào kho.
                                </div>
                            ) : (
                                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
                                    {galleryImages.map((image) => {
                                        const selected = selectedGalleryImageIds.has(Number(image.id));
                                        const src = imageSource(image, 'thumbnail');
                                        const imageName = image.name || `Ảnh ${image.id}`;

                                        return (
                                            <article key={image.id} className={`group relative overflow-hidden rounded-sm border bg-white p-1 shadow-sm transition ${selected ? 'border-sky-400 ring-2 ring-sky-100' : 'border-slate-200 hover:border-sky-200'}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleGalleryImageSelection(image.id, !selected)}
                                                    className="relative aspect-square w-full overflow-hidden rounded-sm bg-slate-100"
                                                    title={imageName}
                                                >
                                                    {src ? (
                                                        <img src={src} alt={imageName} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <span className="material-symbols-outlined flex h-full w-full items-center justify-center text-2xl text-slate-300">image</span>
                                                    )}
                                                </button>
                                                <span className={`pointer-events-none absolute left-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-sm border text-[11px] font-black shadow-sm ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-white/80 bg-white/90 text-slate-300'}`}>
                                                    {selected ? '✓' : ''}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setGalleryZoomImage(image)}
                                                    className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-sm border border-white/80 bg-white/95 text-slate-700 shadow-sm transition hover:bg-sky-50 hover:text-sky-800"
                                                    title="Phóng to ảnh"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                                                </button>
                                                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateGalleryImageFavorite(image)}
                                                        disabled={galleryBusy}
                                                        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-white/80 bg-white/95 shadow-sm transition ${image.is_favorite ? 'text-pink-600 hover:bg-pink-50' : 'text-slate-400 hover:bg-slate-100 hover:text-pink-600'} disabled:cursor-not-allowed disabled:opacity-50`}
                                                        title={image.is_favorite ? 'Bỏ yêu thích' : 'Đánh dấu yêu thích'}
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">{image.is_favorite ? 'favorite' : 'favorite_border'}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteGalleryImage(image)}
                                                        disabled={galleryBusy}
                                                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-white/80 bg-white/95 text-slate-400 shadow-sm transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                        title="Xóa ảnh khỏi kho"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            </article>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
                <footer className="shrink-0 border-t border-slate-200 bg-white p-3">
                    <input
                        ref={galleryUploadInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(event) => {
                            void uploadGalleryImages(event.target.files);
                            event.target.value = '';
                        }}
                        className="hidden"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] font-bold text-slate-500">
                            <span>Đã chọn {formatNumber(selectedGalleryIdList.length)} ảnh</span>
                            {selectedGalleryIdList.length > 0 && (
                                <button type="button" onClick={clearSelectedGalleryImages} disabled={galleryBusy} className="text-sky-700 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50">
                                    Bỏ chọn
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    if (galleryUploading) {
                                        cancelGalleryUpload();
                                        return;
                                    }
                                    galleryUploadInputRef.current?.click();
                                }}
                                disabled={galleryActionBusy && !galleryUploading}
                                className={secondaryButtonClassName}
                            >
                                <span className="material-symbols-outlined text-[18px]">{galleryUploading ? 'cancel' : 'add_photo_alternate'}</span>
                                {galleryUploading ? 'Hủy tải' : 'Thêm ảnh'}
                            </button>
                            <button
                                type="button"
                                onClick={copySelectedGalleryImages}
                                disabled={galleryBusy || selectedGalleryIdList.length === 0}
                                className={secondaryButtonClassName}
                            >
                                <span className="material-symbols-outlined text-[18px]">content_copy</span>
                                Copy ảnh
                            </button>
                            <button
                                type="button"
                                onClick={sendSelectedGalleryImagesToZalo}
                                disabled={galleryBusy || selectedGalleryIdList.length === 0}
                                className={primaryButtonClassName}
                            >
                                <span className="material-symbols-outlined text-[18px]">send</span>
                                {gallerySending ? 'Đang gửi...' : 'Gửi ảnh'}
                            </button>
                        </div>
                    </div>
                    {galleryPagination.last_page > 1 && (
                        <div className="mt-3 overflow-x-auto pb-1">
                            <Pagination pagination={galleryPagination} onPageChange={setGalleryPage} />
                        </div>
                    )}
                </footer>
            </div>

            {galleryZoomImage && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 p-3" onClick={() => setGalleryZoomImage(null)}>
                    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-sm bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white p-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-slate-950">{galleryZoomName}</div>
                                <div className="text-[12px] font-semibold text-slate-400">Bấm ra ngoài để đóng</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setGalleryZoomImage(null)}
                                className={iconButtonClassName}
                                title="Đóng ảnh phóng to"
                                aria-label="Đóng ảnh phóng to"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </header>
                        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-2">
                            {galleryZoomSrc ? (
                                <img src={galleryZoomSrc} alt={galleryZoomName} className="max-h-[78vh] max-w-full object-contain" />
                            ) : (
                                <div className="flex h-64 w-full items-center justify-center text-sm font-bold text-slate-400">Không có ảnh để phóng to.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    ) : null;

    const pancakeImportPromptModal = pancakeImportPromptOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px]">
            <div className="w-full max-w-lg rounded-sm bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0">
                        <h2 className="text-base font-black text-slate-950">Import Pancake</h2>
                        <p className="mt-1 text-[12px] font-semibold text-slate-500">Chọn cách đưa file Excel vào danh sách trả lời nhanh.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPancakeImportPromptOpen(false)}
                        disabled={importingPancake}
                        className={iconButtonClassName}
                        title="Đóng"
                        aria-label="Đóng"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={() => choosePancakeImportMode('merge')}
                        disabled={importingPancake}
                        className="rounded-sm border border-sky-200 bg-sky-50 p-4 text-left shadow-sm transition hover:border-sky-400 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[24px] text-sky-700">playlist_add</span>
                        <span className="mt-2 block text-sm font-black text-slate-950">Thêm/cập nhật</span>
                        <span className="mt-1 block text-[12px] font-semibold leading-5 text-slate-600">Giữ danh sách hiện có. Mẫu mới sẽ được thêm, mẫu trùng ký tự tắt sẽ được cập nhật.</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => choosePancakeImportMode('replace')}
                        disabled={importingPancake}
                        className="rounded-sm border border-rose-200 bg-rose-50 p-4 text-left shadow-sm transition hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[24px] text-rose-700">published_with_changes</span>
                        <span className="mt-2 block text-sm font-black text-slate-950">Thay thế danh sách</span>
                        <span className="mt-1 block text-[12px] font-semibold leading-5 text-slate-600">Chuyển toàn bộ mẫu hiện có vào thùng rác, rồi import danh sách mới từ file Pancake.</span>
                    </button>
                </div>
            </div>
        </div>
    ) : null;

    const sendDraftModal = sendDraft ? (
                <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-slate-950/45 p-2 backdrop-blur-[2px] sm:p-6">
                    <div className="mt-2 flex max-h-[calc(100vh-1rem)] w-full max-w-2xl flex-col rounded-sm bg-white shadow-2xl sm:mt-4 sm:max-h-[calc(100vh-3rem)]">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 sm:px-5">
                            <div className="min-w-0">
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                    <span className="inline-flex h-7 max-w-[150px] items-center truncate rounded-sm bg-slate-100 px-2 text-[12px] font-black text-slate-700" title={sendDraft.shortcut}>
                                        {sendDraft.shortcut}
                                    </span>
                                    {sendDraft.topic && (
                                        <span className="inline-flex max-w-[120px] items-center truncate rounded-full px-2.5 py-1 text-[11px] font-black text-white" style={{ backgroundColor: sendDraft.topic.color || DEFAULT_TOPIC_COLOR }} title={sendDraft.topic.name}>
                                            {sendDraft.topic.name}
                                        </span>
                                    )}
                                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700">{sendDraftTotalCount} tin</span>
                                </div>
                                <h2 className="mt-2 text-base font-black text-slate-950">Chuẩn bị gửi</h2>
                            </div>
                            <button type="button" onClick={() => { setSendDraft(null); setHoveredSendContentKey(null); setFocusedSendContentKey(null); }} disabled={Boolean(copyingId)} className={iconButtonClassName} title="Đóng">
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        {(message || error) && (
                            <div className={`mx-3 mt-3 rounded-sm border px-3 py-2 text-[12px] font-bold sm:mx-5 ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                                {error || message}
                            </div>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
                            <div className="grid gap-2.5">
                                {sendDraft.contents.map((content, contentIndex) => {
                                    const contentImages = Array.isArray(content.images) ? content.images : [];
                                    const selectedImageCount = contentImages.filter((image) => image.selected !== false).length;
                                    const contentKey = content.client_id || content.id || contentIndex;
                                    const isContentExpanded = hoveredSendContentKey === contentKey || focusedSendContentKey === contentKey;

                                    return (
                                        <section
                                            key={contentKey}
                                            onMouseEnter={() => setHoveredSendContentKey(contentKey)}
                                            onMouseLeave={() => setHoveredSendContentKey((current) => (current === contentKey ? null : current))}
                                            className={`rounded-sm border p-2.5 transition ${content.selected ? 'border-slate-200 bg-white hover:border-sky-200 hover:shadow-sm' : 'border-slate-200 bg-slate-50 opacity-70'}`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <label className="flex min-w-0 items-center gap-2 text-[13px] font-black text-slate-700">
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(content.selected)}
                                                        onChange={(event) => updateSendDraftContent(contentIndex, { selected: event.target.checked })}
                                                        disabled={Boolean(copyingId)}
                                                        className="size-4 rounded border-slate-300 text-sky-700"
                                                    />
                                                    <span>Tin {contentIndex + 1}</span>
                                                </label>
                                                {contentImages.length > 0 && (
                                                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">{selectedImageCount}/{contentImages.length} ảnh</span>
                                                )}
                                            </div>

                                            <textarea
                                                value={content.body}
                                                rows={sendDraftTextareaRows(content.body, isContentExpanded)}
                                                onFocus={() => setFocusedSendContentKey(contentKey)}
                                                onBlur={() => setFocusedSendContentKey((current) => (current === contentKey ? null : current))}
                                                onChange={(event) => updateSendDraftContent(contentIndex, { body: event.target.value })}
                                                disabled={!content.selected || Boolean(copyingId)}
                                                placeholder="Nội dung tin nhắn"
                                                className={`mt-2 w-full resize-none overflow-hidden rounded-sm border border-slate-200 bg-white px-3 py-2 text-[13px] leading-5 text-slate-900 shadow-sm outline-none transition-all duration-150 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 disabled:bg-slate-100 ${isContentExpanded ? 'min-h-[140px]' : 'min-h-[86px]'}`}
                                            />

                                            {contentImages.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {contentImages.map((image, imageIndex) => {
                                                        const src = imageSource(image, 'thumbnail');
                                                        const imageSelected = image.selected !== false;

                                                        return (
                                                            <button
                                                                key={image.client_id || image.id || `${contentIndex}-${imageIndex}`}
                                                                type="button"
                                                                onClick={() => toggleSendDraftImage(contentIndex, imageIndex)}
                                                                disabled={!content.selected || Boolean(copyingId)}
                                                                className={`relative size-12 overflow-hidden rounded-sm border bg-slate-100 transition disabled:cursor-not-allowed disabled:opacity-50 ${imageSelected ? 'border-sky-400 ring-2 ring-sky-100' : 'border-slate-200 opacity-45'}`}
                                                                title={imageSelected ? 'Bỏ ảnh này' : 'Gửi ảnh này'}
                                                            >
                                                                {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="material-symbols-outlined text-slate-400">image</span>}
                                                                <span className={`absolute right-0.5 top-0.5 inline-flex size-4 items-center justify-center rounded-full text-[10px] font-black text-white ${imageSelected ? 'bg-sky-600' : 'bg-slate-400'}`}>
                                                                    <span className="material-symbols-outlined text-[12px]">{imageSelected ? 'check' : 'close'}</span>
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <span className="text-[12px] font-bold text-slate-500">Đã chọn {sendDraftSelectedCount}/{sendDraftTotalCount} tin</span>
                            <div className="flex items-center justify-end gap-2">
                                <button type="button" onClick={() => { setSendDraft(null); setHoveredSendContentKey(null); setFocusedSendContentKey(null); }} disabled={Boolean(copyingId)} className={secondaryButtonClassName}>
                                    Hủy
                                </button>
                                <button type="button" onClick={sendPreparedReplyToZalo} disabled={Boolean(copyingId) || sendDraftSelectedCount === 0} className={primaryButtonClassName}>
                                    <span className="material-symbols-outlined text-[18px]">send</span>
                                    {copyingId ? 'Đang gửi...' : 'Gửi tin đã chọn'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
    ) : null;

    if (isSidebarMode) {
        return (
            <div data-quick-reply-sidebar-root="true" className="flex h-screen w-screen max-w-[420px] flex-col overflow-hidden border-l border-slate-200 bg-[#eef3f8] text-slate-900">
                {galleryModal}
                {replyImageHoverPreviewBubble}
                {replyImagePreviewModal}
                {sendDraftModal}
                <header className="shrink-0 border-b border-slate-200 bg-white p-2 shadow-sm">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-sky-700 text-white">
                                <span className="material-symbols-outlined text-[19px]">quickreply</span>
                            </div>
                            <div className="min-w-0">
                                <h1 className="truncate text-[14px] font-black text-slate-950">Trả lời nhanh</h1>
                                <div className="truncate text-[10px] font-semibold text-slate-400">
                                    {formatNumber(stats.replies)} mẫu · {formatNumber(stats.images)} ảnh
                                </div>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => window.open('/admin/quick-replies', '_blank')}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
                                title="Mở trang đầy đủ"
                            >
                                <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => window.close()}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
                                title="Đóng panel"
                            >
                                <span className="material-symbols-outlined text-[17px]">close</span>
                            </button>
                        </div>
                        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_72px] gap-1.5">
                            <div className="min-w-0 [&>div]:h-8 [&>div]:gap-2 [&>div]:px-2 [&>div]:py-0 [&_select]:w-full [&_select]:text-[12px]">
                                <AccountSelector reloadOnAutoSelect={false} />
                            </div>
                            <div className="relative min-w-0" title={`Đích gửi: ${zaloTargetLabel}`}>
                                <select
                                    value={zaloTarget}
                                    onChange={(event) => setZaloTarget(normalizeZaloTarget(event.target.value))}
                                    className="h-8 w-full appearance-none rounded-sm border border-slate-200 bg-white px-2 pr-6 text-[11px] font-black text-slate-700 shadow-sm outline-none transition hover:border-sky-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10"
                                    aria-label="Chọn đích Zalo"
                                >
                                    {ZALO_TARGET_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.shortLabel}</option>
                                    ))}
                                </select>
                                <span className="material-symbols-outlined pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[15px] text-slate-400">expand_more</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_34px_34px_34px] gap-1.5">
                        <div className="relative">
                            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">search</span>
                            <input
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                    setPage(1);
                                }}
                                onKeyDown={handleSearchKeyDown}
                                placeholder="/c1, báo giá..."
                                className="h-8 w-full rounded-sm border border-slate-200 bg-white pl-8 pr-2 text-[12px] text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10"
                            />
                        </div>
                        <div className="relative flex h-8 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700" title={selectedTopic?.name || 'Tất cả chủ đề'}>
                            <span className="material-symbols-outlined pointer-events-none text-[18px]">category</span>
                            <select
                                value={topicFilter}
                                onChange={(event) => {
                                    setTopicFilter(event.target.value);
                                    setPage(1);
                                }}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                aria-label="Chọn chủ đề"
                            >
                                <option value="all">Tất cả chủ đề</option>
                                {topics.map((topic) => (
                                    <option key={topic.id} value={topic.id}>{topic.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="relative flex h-8 items-center justify-center rounded-sm border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-sky-300 hover:text-sky-700" title={STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label || 'Trạng thái'}>
                            <span className="material-symbols-outlined pointer-events-none text-[18px]">{statusFilter === 'disabled' ? 'toggle_off' : statusFilter === 'all' ? 'select_all' : statusFilter === 'trashed' ? 'restore_from_trash' : 'toggle_on'}</span>
                            <select
                                value={statusFilter}
                                onChange={(event) => {
                                    setStatusFilter(event.target.value);
                                    setPage(1);
                                }}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                aria-label="Chọn trạng thái"
                            >
                                {STATUS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            type="button"
                            onClick={toggleTrashMode}
                            className={`relative inline-flex h-8 items-center justify-center rounded-sm border shadow-sm transition ${isTrashMode ? 'border-sky-200 bg-white text-sky-700 hover:border-sky-300' : 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300'}`}
                            title={isTrashMode ? 'Quay lại danh sách đang bật' : `Thùng rác ${formatNumber(stats.trashed_replies || 0)}`}
                        >
                            <span className="material-symbols-outlined text-[18px]">{isTrashMode ? 'list_alt' : 'restore_from_trash'}</span>
                            {!isTrashMode && Number(stats.trashed_replies || 0) > 0 && (
                                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-600 px-1 text-[9px] font-black leading-4 text-white">{formatNumber(stats.trashed_replies || 0)}</span>
                            )}
                        </button>
                    </div>
                </header>

                {(message || error) && (
                    <div className={`flex shrink-0 items-start gap-2 border-b px-2 py-1.5 text-[11px] font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        <span className="min-w-0 flex-1">{error || message}</span>
                        <button
                            type="button"
                            onClick={clearNotice}
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-current opacity-70 transition hover:bg-white/70 hover:opacity-100"
                            title="Đóng thông báo"
                            aria-label="Đóng thông báo"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>
                )}
                <div className="min-h-0 flex-1 overflow-hidden bg-white">
                    {loading ? (
                        <div className="flex h-full min-h-40 items-center justify-center border-t border-slate-200 bg-white text-[13px] font-bold text-slate-400">
                            Đang tải mẫu...
                        </div>
                    ) : tableRows.length === 0 ? (
                        <div className="flex h-full min-h-40 items-center justify-center border-t border-slate-200 bg-white text-[13px] font-bold text-slate-400">
                            {isTrashMode ? 'Thùng rác đang trống.' : 'Chưa có mẫu phù hợp.'}
                        </div>
                    ) : (
                        <div className="h-full overflow-y-auto overflow-x-hidden">
                            <table className="w-full table-fixed border-collapse text-[12px]">
                                <colgroup>
                                    <col className="w-9" />
                                    <col className="w-[76px]" />
                                    <col className="w-[78px]" />
                                    <col />
                                </colgroup>
                                <thead className="sticky top-0 z-10 bg-[#f6f9fc]">
                                    <tr className="border-b border-slate-200">
                                        <th className="h-[27px] px-1 text-left text-[10px] font-black uppercase tracking-[0.02em] text-slate-400" aria-label="Gửi" />
                                        <th className="h-[27px] px-1 text-left text-[10px] font-black uppercase tracking-[0.02em] text-slate-500">Ký tự</th>
                                        <th className="h-[27px] px-1 text-left text-[10px] font-black uppercase tracking-[0.02em] text-slate-500">Chủ đề</th>
                                        <th className="h-[27px] px-1.5 text-left text-[10px] font-black uppercase tracking-[0.02em] text-slate-500">Tin nhắn</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {tableRows.map((reply, index) => {
                                        const topic = reply.topic;
                                        const images = flattenReplyImages(reply);
                                        const firstImageSrc = images.length > 0 ? imageSource(images[0], 'thumbnail') : '';
                                        const contentCount = replyContentCount(reply);
                                        const previewText = replyPreviewText(reply);
                                        const isCopying = Number(copyingId) === Number(reply.id);
                                        const isCopied = Number(copiedState.id) === Number(reply.id);
                                        const isTrashedReply = isTrashMode || Boolean(reply.is_trashed);

                                        return (
                                            <tr key={reply.id} className={`h-[37px] transition hover:bg-sky-50/70 ${index % 2 === 1 ? 'bg-[#fbfdff]' : 'bg-white'} ${index === 0 && !isTrashMode ? 'bg-sky-50/60' : ''}`}>
                                                <td className="h-[37px] px-1 py-1 align-middle">
                                                    {isTrashedReply ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => restoreReply(reply)}
                                                            className="inline-flex size-[27px] items-center justify-center rounded-sm border border-emerald-200 bg-white text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50"
                                                            title="Khôi phục mẫu"
                                                            aria-label="Khôi phục mẫu"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">restore_from_trash</span>
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => sendReplyToZalo(reply)}
                                                            disabled={isCopying}
                                                            className="inline-flex size-[27px] items-center justify-center rounded-sm bg-sky-700 text-white shadow-sm transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
                                                            title="Gửi vào chat Zalo đang mở"
                                                            aria-label="Gửi vào chat Zalo đang mở"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">{isCopied && copiedState.mode === 'sent' ? 'check' : 'send'}</span>
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="h-[37px] px-1 py-1 align-middle">
                                                    <button
                                                        type="button"
                                                        onClick={() => copyReplyAll(reply)}
                                                        disabled={isTrashedReply}
                                                        className="block w-full truncate text-left text-[12px] font-black text-slate-800 transition hover:text-sky-700 disabled:cursor-not-allowed disabled:text-slate-400"
                                                        title={`${reply.shortcut} - bấm để copy nhanh`}
                                                    >
                                                        {reply.shortcut}
                                                    </button>
                                                </td>
                                                <td className="h-[37px] px-1 py-1 align-middle">
                                                    {topic ? (
                                                        <span
                                                            className="block h-[22px] w-[72px] overflow-hidden rounded-[3px] px-1.5 text-center text-[11px] font-black leading-[22px] text-white"
                                                            style={{ backgroundColor: topic.color || DEFAULT_TOPIC_COLOR }}
                                                            title={topic.name}
                                                        >
                                                            {topic.name}
                                                        </span>
                                                    ) : (
                                                        <span className="block h-[22px] w-[72px] overflow-hidden rounded-[3px] bg-slate-100 px-1.5 text-center text-[11px] font-black leading-[22px] text-slate-400">-</span>
                                                    )}
                                                </td>
                                                <td className="h-[37px] min-w-0 px-1.5 py-1 align-middle">
                                                    <div className="flex min-w-0 items-center gap-1.5">
                                                        <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-slate-700" title={previewText}>
                                                            {previewText}
                                                        </span>
                                                        {images.length > 0 && !isTrashedReply && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleReplyThumbnailClick(reply)}
                                                                onDoubleClick={() => handleReplyThumbnailDoubleClick(reply)}
                                                                onMouseEnter={(event) => showReplyImageHoverPreview(event, reply)}
                                                                onMouseMove={(event) => showReplyImageHoverPreview(event, reply)}
                                                                onMouseLeave={() => setReplyImageHoverPreview(null)}
                                                                disabled={isCopying}
                                                                className="relative inline-flex size-[22px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-slate-200 bg-slate-100 text-slate-400 shadow-sm transition hover:border-sky-300 hover:ring-2 hover:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                                title={`${images.length} ảnh - bấm 1 lần để copy, bấm đúp để xem lớn`}
                                                                aria-label={`${images.length} ảnh - bấm 1 lần để copy, bấm đúp để xem lớn`}
                                                            >
                                                                {firstImageSrc ? (
                                                                    <img src={firstImageSrc} alt="" className="h-full w-full object-cover" />
                                                                ) : (
                                                                    <span className="material-symbols-outlined text-[15px]">image</span>
                                                                )}
                                                                {images.length > 1 && (
                                                                    <span className="absolute bottom-0 right-0 min-w-[13px] rounded-tl-sm bg-slate-900/75 px-0.5 text-[8px] font-black leading-[11px] text-white">+{formatNumber(images.length - 1)}</span>
                                                                )}
                                                            </button>
                                                        )}
                                                        <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-sky-50 px-1.5 text-[10px] font-black text-sky-700" title={`${contentCount} tin nhắn`}>
                                                            {formatNumber(contentCount)} tin
                                                        </span>
                                                        {isTrashedReply && (
                                                            <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-rose-50 px-1.5 text-[10px] font-black text-rose-700">Rác</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                <footer className="shrink-0 border-t border-slate-200 bg-white px-2.5 py-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[12px] font-bold text-slate-500">Tổng {formatNumber(pagination.total)} mẫu</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                onClick={openGallery}
                                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2.5 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
                            >
                                <span className="material-symbols-outlined text-[17px]">photo_library</span>
                                Kho ảnh
                            </button>
                            <button
                                type="button"
                                onClick={() => window.open('/admin/quick-replies', '_blank')}
                                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2.5 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:text-sky-700"
                            >
                                <span className="material-symbols-outlined text-[17px]">settings</span>
                                Quản lý
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto pb-1">
                        <Pagination pagination={pagination} onPageChange={setPage} />
                    </div>
                </footer>
            </div>
        );
    }

    return (
        <div className="min-h-full bg-[#eef3f8] p-2 text-slate-900 sm:p-3 lg:p-4 xl:h-full xl:overflow-hidden">
            {galleryModal}
            {replyImageHoverPreviewBubble}
            {replyImagePreviewModal}
            {pancakeImportPromptModal}
            {sendDraftModal}
            <div className="flex w-full flex-col gap-3 xl:h-full xl:min-h-0">
                <header className="flex shrink-0 flex-col gap-3 rounded-sm border border-slate-200 bg-white px-4 py-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-sky-700 text-white">
                            <span className="material-symbols-outlined text-[25px]">quickreply</span>
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-black text-slate-950">Trả lời nhanh Zalo</h1>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-slate-500">
                                <span>{formatNumber(stats.replies)} mẫu</span>
                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                <span>{formatNumber(stats.topics)} chủ đề</span>
                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                <span>{formatNumber(stats.images)} ảnh</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <AccountSelector />
                        <div className="relative shrink-0" title={`Đích gửi hiện tại: ${zaloTargetLabel}`}>
                            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-600">{selectedZaloTargetOption.icon}</span>
                            <select
                                value={zaloTarget}
                                onChange={(event) => setZaloTarget(normalizeZaloTarget(event.target.value))}
                                className="h-10 w-full appearance-none rounded-sm border border-slate-200 bg-white pl-10 pr-8 text-[13px] font-semibold text-slate-700 shadow-sm outline-none transition hover:border-sky-300 hover:text-sky-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 sm:w-[132px]"
                                aria-label="Chọn đích Zalo"
                            >
                                {ZALO_TARGET_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-slate-400">expand_more</span>
                        </div>
                        <button
                            type="button"
                            onClick={openGallery}
                            className={secondaryButtonClassName}
                            title="Mở kho ảnh trả lời nhanh"
                        >
                            <span className="material-symbols-outlined text-[18px]">photo_library</span>
                            Kho ảnh
                        </button>
                        <input
                            ref={pancakeImportInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={(event) => {
                                void importPancakeExcel(event.target.files);
                                event.target.value = '';
                            }}
                            className="hidden"
                        />
                        <button
                            type="button"
                            onClick={() => setPancakeImportPromptOpen(true)}
                            disabled={importingPancake}
                            className={secondaryButtonClassName}
                            title="Import file Excel xuất từ Pancake"
                        >
                            <span className="material-symbols-outlined text-[18px]">upload_file</span>
                            {importingPancake ? 'Đang import...' : 'Import Pancake'}
                        </button>
                        <button
                            type="button"
                            onClick={openZaloSidebar}
                            disabled={splittingZalo}
                            className={secondaryButtonClassName}
                            title="Mở panel trả lời nhanh bên phải"
                        >
                            <span className="material-symbols-outlined text-[18px]">view_sidebar</span>
                            {splittingZalo ? 'Đang mở...' : 'Panel phải'}
                        </button>
                        <button type="button" onClick={openCreateForm} className={primaryButtonClassName}>
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            Thêm mẫu
                        </button>
                    </div>
                </header>

                {(message || error) && (
                    <div className={`flex shrink-0 items-start gap-3 rounded-sm border px-4 py-3 text-[13px] font-semibold shadow-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        <span className="min-w-0 flex-1">{error || message}</span>
                        <button
                            type="button"
                            onClick={clearNotice}
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-current opacity-70 transition hover:bg-white/70 hover:opacity-100"
                            title="Đóng thông báo"
                            aria-label="Đóng thông báo"
                        >
                            <span className="material-symbols-outlined text-[17px]">close</span>
                        </button>
                    </div>
                )}

                <div className={`grid gap-4 xl:min-h-0 xl:flex-1 ${zaloMirrorOpen ? 'xl:grid-cols-[minmax(0,1fr)_430px]' : ''}`}>
                    <main className="grid gap-3 xl:min-h-0 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <aside className="flex min-h-0 flex-col gap-3 rounded-sm border border-slate-200 bg-white p-3 shadow-sm xl:overflow-hidden">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-sm font-black text-slate-950">Chủ đề</h2>
                                <p className="mt-0.5 text-[12px] font-semibold text-slate-400">{formatNumber(stats.active_replies)} mẫu đang bật</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setTopicForm(emptyTopicForm)}
                                className={iconButtonClassName}
                                title="Tạo chủ đề mới"
                            >
                                <span className="material-symbols-outlined text-[18px]">add</span>
                            </button>
                        </div>

                        <div className="flex flex-col gap-2 xl:min-h-0 xl:flex-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setTopicFilter('all');
                                    setPage(1);
                                }}
                                className={`flex h-10 items-center justify-between rounded-sm border px-3 text-left text-[13px] font-bold transition ${topicFilter === 'all' ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200'}`}
                            >
                                <span>Tất cả chủ đề</span>
                                <span>{formatNumber(stats.replies)}</span>
                            </button>

                            <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1 xl:max-h-none xl:min-h-0 xl:flex-1">
                                {topics.map((topic) => (
                                    <div key={topic.id} className={`group flex items-center gap-2 rounded-sm border px-2 py-2 transition ${String(topicFilter) === String(topic.id) ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-200'}`}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTopicFilter(String(topic.id));
                                                setPage(1);
                                            }}
                                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                        >
                                            <span className="h-3 w-9 shrink-0 rounded-full" style={{ backgroundColor: topic.color || DEFAULT_TOPIC_COLOR }} />
                                            <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-700">{topic.name}</span>
                                            <span className="text-[12px] font-black text-slate-400">{formatNumber(topic.replies_count)}</span>
                                        </button>
                                        <button type="button" onClick={() => editTopic(topic)} className="text-slate-400 transition hover:text-sky-700" title="Sửa chủ đề">
                                            <span className="material-symbols-outlined text-[17px]">edit</span>
                                        </button>
                                        <button type="button" onClick={() => deleteTopic(topic)} className="text-slate-400 transition hover:text-rose-700" title="Xóa chủ đề">
                                            <span className="material-symbols-outlined text-[17px]">delete</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <form onSubmit={saveTopic} className="mt-auto grid shrink-0 gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3">
                            <input
                                value={topicForm.name}
                                onChange={(event) => setTopicForm((current) => ({ ...current, name: event.target.value }))}
                                placeholder="Tên chủ đề"
                                className={inputClassName}
                            />
                            <div className="flex flex-wrap gap-1.5">
                                {TOPIC_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        onClick={() => setTopicForm((current) => ({ ...current, color }))}
                                        className={`size-7 rounded-full border-2 transition ${topicForm.color === color ? 'border-slate-900' : 'border-white shadow-sm'}`}
                                        style={{ backgroundColor: color }}
                                        title={color}
                                    />
                                ))}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <label className="inline-flex items-center gap-2 text-[12px] font-bold text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={topicForm.is_active}
                                        onChange={(event) => setTopicForm((current) => ({ ...current, is_active: event.target.checked }))}
                                        className="size-4 rounded border-slate-300 text-sky-700"
                                    />
                                    Bật chủ đề
                                </label>
                                {topicForm.id && (
                                    <button type="button" onClick={() => setTopicForm(emptyTopicForm)} className="text-[12px] font-bold text-slate-400 hover:text-sky-700">
                                        Hủy sửa
                                    </button>
                                )}
                            </div>
                            <button type="submit" disabled={saving} className={secondaryButtonClassName}>
                                <span className="material-symbols-outlined text-[17px]">{topicForm.id ? 'save' : 'add'}</span>
                                {topicForm.id ? 'Lưu chủ đề' : 'Thêm chủ đề'}
                            </button>
                        </form>
                    </aside>

                    <section className="flex min-w-0 flex-col rounded-sm border border-slate-200 bg-white shadow-sm xl:min-h-0 xl:overflow-hidden">
                        <div className="grid shrink-0 gap-3 border-b border-slate-200 bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_190px_150px_auto_auto] lg:items-center">
                            <div className="relative min-w-0">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">search</span>
                                <input
                                    value={search}
                                    onChange={(event) => {
                                        setSearch(event.target.value);
                                        setPage(1);
                                    }}
                                    onKeyDown={handleSearchKeyDown}
                                    placeholder="/c1, báo giá, men lam..."
                                    className={`${inputClassName} pl-10`}
                                />
                            </div>

                            <select
                                value={topicFilter}
                                onChange={(event) => {
                                    setTopicFilter(event.target.value);
                                    setPage(1);
                                }}
                                className={inputClassName}
                            >
                                <option value="all">Tất cả chủ đề</option>
                                {topics.map((topic) => (
                                    <option key={topic.id} value={topic.id}>{topic.name}</option>
                                ))}
                            </select>

                            <select
                                value={statusFilter}
                                onChange={(event) => {
                                    setStatusFilter(event.target.value);
                                    setPage(1);
                                }}
                                className={inputClassName}
                            >
                                {STATUS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>

                            <button
                                type="button"
                                onClick={toggleTrashMode}
                                className={`${secondaryButtonClassName} ${isTrashMode ? 'border-sky-200 text-sky-700 hover:border-sky-300 hover:bg-sky-50' : 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100'}`}
                                title={isTrashMode ? 'Quay lại danh sách đang bật' : 'Xem các mẫu đã chuyển vào thùng rác'}
                            >
                                <span className="material-symbols-outlined text-[18px]">{isTrashMode ? 'list_alt' : 'restore_from_trash'}</span>
                                {isTrashMode ? 'Danh sách bật' : `Thùng rác ${formatNumber(stats.trashed_replies || 0)}`}
                            </button>

                            <button type="button" onClick={openCreateForm} className={primaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">add</span>
                                Thêm mẫu
                            </button>
                        </div>

                        {zaloPasteFlow && (
                            <div className="shrink-0 border-b border-sky-100 bg-sky-50 px-3 py-3">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="text-[11px] font-black uppercase tracking-[0.12em] text-sky-700">Dán cho Zalo cá nhân</div>
                                        <div className="mt-1 truncate text-[13px] font-bold text-slate-700">
                                            {zaloPasteFlow.shortcut} · {zaloPasteFlow.title}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setZaloPasteFlow(null)}
                                        className={iconButtonClassName}
                                        title="Đóng thanh bước"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {zaloPasteFlow.hasBody && (
                                        <button
                                            type="button"
                                            onClick={copyPasteFlowText}
                                            disabled={Number(copyingId) === Number(zaloPasteFlow.replyId)}
                                            className="inline-flex h-10 items-center gap-2 rounded-sm border border-sky-200 bg-white px-3 text-[12px] font-black text-sky-800 shadow-sm transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                                            title="Copy lại chữ"
                                        >
                                            <span className="material-symbols-outlined text-[17px]">article</span>
                                            Chữ
                                        </button>
                                    )}
                                    {zaloPasteFlow.images.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={copyPasteFlowAllImages}
                                            disabled={Number(copyingId) === Number(zaloPasteFlow.replyId)}
                                            className="inline-flex h-10 items-center gap-2 rounded-sm border border-emerald-300 bg-white px-3 text-[12px] font-black text-emerald-700 shadow-sm transition hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                                            title="Copy tất cả ảnh một lần"
                                        >
                                            <span className="material-symbols-outlined text-[17px]">photo_library</span>
                                            Tất cả ảnh
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => sendReplyToZalo({ id: zaloPasteFlow.replyId })}
                                        disabled={Number(copyingId) === Number(zaloPasteFlow.replyId)}
                                        className="inline-flex h-10 items-center gap-2 rounded-sm border border-blue-300 bg-blue-700 px-3 text-[12px] font-black text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        title="Gửi thẳng vào chat Zalo đang mở"
                                    >
                                        <span className="material-symbols-outlined text-[17px]">send</span>
                                        Gửi Zalo
                                    </button>
                                    {zaloPasteFlow.images.map((imageStep, index) => {
                                        const isDone = index < zaloPasteFlow.nextImageIndex;
                                        const isNext = index === zaloPasteFlow.nextImageIndex;

                                        return (
                                            <button
                                                key={imageStep.id}
                                                type="button"
                                                onClick={() => copyPasteFlowImage(imageStep, index)}
                                                disabled={Number(copyingId) === Number(zaloPasteFlow.replyId)}
                                                className={`inline-flex h-10 max-w-[150px] items-center gap-2 rounded-sm border bg-white px-2 text-[12px] font-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${isDone ? 'border-emerald-300 text-emerald-700' : isNext ? 'border-sky-400 text-sky-800' : 'border-slate-200 text-slate-600 hover:border-sky-300 hover:text-sky-700'}`}
                                                title={`Copy ${imageStep.label}`}
                                            >
                                                <span className="size-7 shrink-0 overflow-hidden rounded-sm border border-slate-200 bg-slate-100">
                                                    <img src={imageStep.src} alt="" className="h-full w-full object-cover" />
                                                </span>
                                                <span className="truncate">{imageStep.label}</span>
                                                <span className="material-symbols-outlined text-[16px]">{isDone ? 'check' : 'content_copy'}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {selectedReplyIdList.length > 0 && (
                            <div className={`shrink-0 border-b px-3 py-3 ${isTrashMode ? 'border-emerald-100 bg-emerald-50' : 'border-rose-100 bg-rose-50'}`}>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className={`text-[13px] font-black ${isTrashMode ? 'text-emerald-700' : 'text-rose-700'}`}>
                                        Đã chọn {formatNumber(selectedReplyIdList.length)} mẫu{isTrashMode ? ' trong thùng rác' : ''}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={clearSelectedReplies}
                                            disabled={bulkBusy}
                                            className={secondaryButtonClassName}
                                        >
                                            Bỏ chọn
                                        </button>
                                        {isTrashMode ? (
                                            <button
                                                type="button"
                                                onClick={restoreSelectedReplies}
                                                disabled={bulkBusy}
                                                className={`${secondaryButtonClassName} border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50`}
                                            >
                                                <span className="material-symbols-outlined text-[17px]">restore_from_trash</span>
                                                {bulkRestoring ? 'Đang khôi phục...' : 'Khôi phục mẫu đã chọn'}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={deleteSelectedReplies}
                                                disabled={bulkBusy}
                                                className={dangerButtonClassName}
                                            >
                                                <span className="material-symbols-outlined text-[17px]">delete</span>
                                                {bulkDeleting ? 'Đang chuyển...' : 'Chuyển vào thùng rác'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                            <table className="w-full table-fixed border-collapse text-left">
                                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                                    <tr>
                                        <th className="w-9 border-b border-slate-200 px-2 py-3 font-black">
                                            <input
                                                ref={bulkSelectAllRef}
                                                type="checkbox"
                                                checked={allVisibleRepliesSelected}
                                                disabled={loading || visibleReplyIds.length === 0}
                                                onChange={(event) => toggleVisibleReplySelection(event.target.checked)}
                                                className="size-4 rounded border-slate-300 text-sky-700"
                                                title="Chọn tất cả mẫu đang hiển thị"
                                                aria-label="Chọn tất cả mẫu đang hiển thị"
                                            />
                                        </th>
                                        <th className="w-10 border-b border-slate-200 px-2 py-3 font-black">STT</th>
                                        <th className="w-[132px] border-b border-slate-200 px-2 py-3 font-black">Ký tự tắt</th>
                                        <th className="w-[122px] border-b border-slate-200 px-2 py-3 font-black">Chủ đề</th>
                                        <th className="border-b border-slate-200 px-2 py-3 font-black">Tin nhắn</th>
                                        <th className="w-[118px] border-b border-slate-200 px-2 py-3 font-black">Ảnh</th>
                                        <th className="w-[68px] border-b border-slate-200 px-2 py-3 font-black">Dùng</th>
                                        <th className="w-[116px] border-b border-slate-200 px-2 py-3 text-right font-black">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-[13px]">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={8} className="h-52 text-center font-bold text-slate-400">Đang tải mẫu...</td>
                                        </tr>
                                    ) : tableRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="h-52 text-center font-bold text-slate-400">{isTrashMode ? 'Thùng rác đang trống.' : 'Chưa có mẫu phù hợp.'}</td>
                                        </tr>
                                    ) : tableRows.map((reply, index) => {
                                        const replyId = Number(reply.id);
                                        const topic = reply.topic;
                                        const images = flattenReplyImages(reply);
                                        const contentCount = replyContentCount(reply);
                                        const isCopying = Number(copyingId) === Number(reply.id);
                                        const isCopied = Number(copiedState.id) === Number(reply.id);
                                        const isSelected = selectedReplyIds.has(replyId);
                                        const isTrashedReply = isTrashMode || Boolean(reply.is_trashed);

                                        return (
                                            <tr key={reply.id} className={`group transition hover:bg-sky-50/45 ${isSelected ? 'bg-sky-50' : 'bg-white'}`}>
                                                <td className="px-2 py-3 align-top">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={(event) => toggleReplySelection(replyId, event.target.checked)}
                                                        className="size-4 rounded border-slate-300 text-sky-700"
                                                        aria-label={`Chọn mẫu ${reply.shortcut}`}
                                                    />
                                                </td>
                                                <td className="px-2 py-3 align-top text-center font-bold text-slate-400">
                                                    {(pagination.current_page - 1) * pagination.per_page + index + 1}
                                                </td>
                                                <td className="px-2 py-3 align-top">
                                                    <button
                                                        type="button"
                                                        onClick={() => copyReplyAll(reply)}
                                                        disabled={isTrashedReply}
                                                        className="inline-flex h-8 w-full max-w-full items-center justify-center overflow-hidden rounded-sm bg-slate-100 px-2.5 font-black text-slate-700 transition hover:bg-sky-100 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                                                        title={reply.shortcut}
                                                    >
                                                        <span className="min-w-0 truncate">{reply.shortcut}</span>
                                                    </button>
                                                </td>
                                                <td className="px-2 py-3 align-top">
                                                    {topic ? (
                                                        <span className="inline-flex max-w-full items-center justify-center truncate rounded-full px-2.5 py-1 text-[12px] font-black text-white" style={{ backgroundColor: topic.color || DEFAULT_TOPIC_COLOR }}>
                                                            {topic.name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[12px] font-bold text-slate-400">Chưa gán</span>
                                                    )}
                                                </td>
                                                <td className="min-w-0 px-2 py-3 align-top">
                                                    <div className="flex items-start gap-2">
                                                        <div className="min-w-0 flex-1 line-clamp-3 whitespace-pre-line text-[13px] leading-5 text-slate-700">{reply.body || 'Mẫu chỉ có ảnh'}</div>
                                                        {contentCount > 1 && (
                                                            <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700">{contentCount} tin</span>
                                                        )}
                                                    </div>
                                                    {!reply.is_active && (
                                                        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">Đã tắt</span>
                                                    )}
                                                    {isTrashedReply && (
                                                        <span className="mt-2 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-700">Trong thùng rác</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-3 align-top">
                                                    {images.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {images.slice(0, 3).map((image) => {
                                                                const src = imageSource(image, 'thumbnail');
                                                                return (
                                                                    <button
                                                                        key={image.id || src}
                                                                        type="button"
                                                                        onClick={() => copySingleImage(reply, image)}
                                                                        disabled={isTrashedReply}
                                                                        className="relative size-8 overflow-hidden rounded-sm border border-slate-200 bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                                                                        title={isTrashedReply ? 'Mẫu đang trong thùng rác' : 'Copy ảnh'}
                                                                    >
                                                                        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="material-symbols-outlined text-slate-400">image</span>}
                                                                    </button>
                                                                );
                                                            })}
                                                            {images.length > 3 && (
                                                                <span className="inline-flex size-8 items-center justify-center rounded-sm bg-slate-100 text-[11px] font-black text-slate-500">+{images.length - 3}</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-[12px] font-bold text-slate-400">Không có</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-3 align-top">
                                                    <span className="font-black text-slate-700">{formatNumber(reply.use_count)}</span>
                                                </td>
                                                <td className="px-2 py-3 align-top">
                                                    <div className="flex justify-end gap-1">
                                                        {isTrashedReply ? (
                                                            <button type="button" onClick={() => restoreReply(reply)} className={`${tableIconButtonClassName} hover:border-emerald-300 hover:text-emerald-700`} title="Khôi phục mẫu">
                                                                <span className="material-symbols-outlined text-[17px]">restore_from_trash</span>
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <button type="button" onClick={() => sendReplyToZalo(reply)} disabled={isCopying} className={`${tableIconButtonClassName} hover:border-blue-300 hover:text-blue-700`} title="Gửi vào chat Zalo đang mở">
                                                                    <span className="material-symbols-outlined text-[17px]">{isCopied && copiedState.mode === 'sent' ? 'check' : 'send'}</span>
                                                                </button>
                                                                <button type="button" onClick={() => openEditForm(reply)} className={tableIconButtonClassName} title="Sửa mẫu">
                                                                    <span className="material-symbols-outlined text-[17px]">edit</span>
                                                                </button>
                                                                <button type="button" onClick={() => deleteReply(reply)} className={`${tableIconButtonClassName} hover:border-rose-300 hover:text-rose-700`} title="Chuyển vào thùng rác">
                                                                    <span className="material-symbols-outlined text-[17px]">delete</span>
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-[12px] font-bold text-slate-500">
                                Tổng {formatNumber(pagination.total)} mẫu
                            </div>
                            <Pagination pagination={pagination} onPageChange={setPage} />
                        </div>
                    </section>
                    </main>

                    {zaloMirrorOpen && (
                        <aside className="flex min-h-[560px] min-w-0 flex-col rounded-sm border border-slate-200 bg-white shadow-sm xl:min-h-0 xl:overflow-hidden">
                            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-3">
                                <div className="min-w-0">
                                    <h2 className="truncate text-sm font-black text-slate-950">Zalo live</h2>
                                    <div className="mt-0.5 text-[12px] font-semibold text-slate-400">Zalo Desktop</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                    <label className="mr-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-500" title="Tự làm mới ảnh Zalo live">
                                        <input
                                            type="checkbox"
                                            checked={zaloMirrorAutoRefresh}
                                            onChange={(event) => setZaloMirrorAutoRefresh(event.target.checked)}
                                            className="size-4 rounded border-slate-300 text-sky-700"
                                        />
                                        Live
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => loadZaloMirrorScreenshot()}
                                        disabled={zaloMirrorLoading}
                                        className={iconButtonClassName}
                                        title="Làm mới"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setZaloMirrorOpen(false)}
                                        className={iconButtonClassName}
                                        title="Đóng"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                                <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-sm border border-slate-200 bg-slate-950">
                                    {zaloMirrorSrc ? (
                                        <img
                                            src={zaloMirrorSrc}
                                            alt="Zalo live"
                                            onClick={handleZaloMirrorClick}
                                            className="h-full w-full cursor-crosshair object-contain"
                                            draggable={false}
                                        />
                                    ) : (
                                        <div className="flex h-full min-h-[320px] items-center justify-center text-[13px] font-bold text-slate-400">
                                            Chưa mở Zalo live
                                        </div>
                                    )}

                                    {zaloMirrorLoading && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-[13px] font-black text-white">
                                            Đang xử lý...
                                        </div>
                                    )}
                                </div>

                                <div className="grid shrink-0 gap-2">
                                    <textarea
                                        value={zaloMirrorText}
                                        onChange={(event) => setZaloMirrorText(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                                event.preventDefault();
                                                void typeIntoZaloMirror(true);
                                            }
                                        }}
                                        placeholder="Nhập tin nhắn"
                                        className="min-h-[76px] w-full resize-none rounded-sm border border-slate-200 bg-white px-3 py-2.5 text-[13px] leading-5 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => typeIntoZaloMirror(false)}
                                            disabled={zaloMirrorLoading || !zaloMirrorText.trim()}
                                            className={secondaryButtonClassName}
                                            title="Dán vào Zalo"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">content_paste</span>
                                            Dán
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => typeIntoZaloMirror(true)}
                                            disabled={zaloMirrorLoading || !zaloMirrorText.trim()}
                                            className={primaryButtonClassName}
                                            title="Dán và gửi bằng Enter"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">send</span>
                                            Gửi
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </aside>
                    )}
                </div>
            </div>

            {formOpen && (
                <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-6">
                    <form onSubmit={saveReply} className="mt-4 w-full max-w-3xl rounded-sm bg-white shadow-2xl">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                            <div>
                                <h2 className="text-base font-black text-slate-950">{replyForm.id ? 'Sửa câu trả lời nhanh' : 'Thêm câu trả lời nhanh'}</h2>
                                <p className="mt-1 text-[12px] font-semibold text-slate-400">
                                    {replyForm.contents.length} nội dung · {replyFormImageCount(replyForm)} ảnh đính kèm
                                </p>
                            </div>
                            <button type="button" onClick={closeForm} className={iconButtonClassName} title="Đóng">
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <div className="grid gap-4 px-5 py-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="grid gap-1.5 text-[12px] font-black text-slate-600">
                                    Chủ đề
                                    <select
                                        value={replyForm.topic_id}
                                        onChange={(event) => handleReplyFormChange('topic_id', event.target.value)}
                                        className={inputClassName}
                                    >
                                        <option value="">Chưa gán chủ đề</option>
                                        {topics.map((topic) => (
                                            <option key={topic.id} value={topic.id}>{topic.name}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="grid gap-1.5 text-[12px] font-black text-slate-600">
                                    Ký tự tắt
                                    <input
                                        value={replyForm.shortcut}
                                        onChange={(event) => handleReplyFormChange('shortcut', event.target.value)}
                                        onBlur={(event) => handleReplyFormChange('shortcut', normalizeShortcutInput(event.target.value))}
                                        placeholder="/c1"
                                        className={inputClassName}
                                    />
                                </label>
                            </div>


                            <div className="grid gap-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[12px] font-black text-slate-600">Nội dung gửi</div>
                                        <div className="mt-0.5 text-[12px] font-semibold text-slate-400">Mỗi khối sẽ gửi thành một tin riêng trên Zalo</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={addContentBlock}
                                        disabled={replyForm.contents.length >= MAX_REPLY_CONTENTS || saving || uploading}
                                        className={secondaryButtonClassName}
                                    >
                                        <span className="material-symbols-outlined text-[17px]">add</span>
                                        Thêm nội dung
                                    </button>
                                </div>

                                {replyForm.contents.map((content, contentIndex) => {
                                    const contentImages = Array.isArray(content.images) ? content.images : [];

                                    return (
                                        <section key={content.client_id || content.id || contentIndex} className="rounded-sm border border-slate-200 bg-slate-50 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className="material-symbols-outlined cursor-grab text-[18px] text-slate-400">drag_indicator</span>
                                                    <span className="truncate text-[13px] font-black text-slate-700">Nội dung {contentIndex + 1}</span>
                                                    {contentImages.length > 0 && (
                                                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-500">{contentImages.length} ảnh</span>
                                                    )}
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1.5">
                                                    <button type="button" onClick={() => moveContentBlock(contentIndex, -1)} disabled={contentIndex === 0} className={iconButtonClassName} title="Đưa nội dung lên trước">
                                                        <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                                                    </button>
                                                    <button type="button" onClick={() => moveContentBlock(contentIndex, 1)} disabled={contentIndex === replyForm.contents.length - 1} className={iconButtonClassName} title="Đưa nội dung xuống sau">
                                                        <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                                                    </button>
                                                    <button type="button" onClick={() => removeContentBlock(contentIndex)} className={`${iconButtonClassName} hover:border-rose-300 hover:text-rose-700`} title="Xóa nội dung">
                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <textarea
                                                value={content.body}
                                                onChange={(event) => updateContentBody(contentIndex, event.target.value)}
                                                placeholder="Nhập nội dung tin nhắn"
                                                className={`${textareaClassName} mt-3 min-h-[120px] bg-white`}
                                            />

                                            <div className="mt-3 grid gap-2">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-[12px] font-black text-slate-600">Ảnh của nội dung {contentIndex + 1}</span>
                                                    <label className={`${secondaryButtonClassName} cursor-pointer`}>
                                                        <span className="material-symbols-outlined text-[17px]">upload</span>
                                                        {uploading ? 'Đang tải...' : 'Thêm ảnh'}
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            multiple
                                                            disabled={uploading || replyFormImageCount(replyForm) >= MAX_REPLY_IMAGES}
                                                            onChange={(event) => {
                                                                void handleContentImageUpload(contentIndex, event.target.files);
                                                                event.target.value = '';
                                                            }}
                                                            className="hidden"
                                                        />
                                                    </label>
                                                </div>

                                                {contentImages.length > 0 ? (
                                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                        {contentImages.map((image, imageIndex) => {
                                                            const src = imageSource(image, 'thumbnail');
                                                            return (
                                                                <div key={`${image.id || image.url}-${imageIndex}`} className="overflow-hidden rounded-sm border border-slate-200 bg-white">
                                                                    <div className="aspect-square bg-slate-100">
                                                                        {src ? (
                                                                            <img src={src} alt="" className="h-full w-full object-cover" />
                                                                        ) : (
                                                                            <div className="flex h-full items-center justify-center text-slate-400">
                                                                                <span className="material-symbols-outlined text-3xl">image</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-1 border-t border-slate-200 p-1">
                                                                        <button type="button" onClick={() => moveContentImage(contentIndex, imageIndex, -1)} disabled={imageIndex === 0} className={iconButtonClassName} title="Đưa ảnh lên trước">
                                                                            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                                                                        </button>
                                                                        <button type="button" onClick={() => moveContentImage(contentIndex, imageIndex, 1)} disabled={imageIndex === contentImages.length - 1} className={iconButtonClassName} title="Đưa ảnh xuống sau">
                                                                            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                                                                        </button>
                                                                        <button type="button" onClick={() => removeContentImage(contentIndex, imageIndex)} className={`${iconButtonClassName} hover:border-rose-300 hover:text-rose-700`} title="Xóa ảnh">
                                                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <div className="flex min-h-20 items-center justify-center rounded-sm border border-dashed border-slate-300 bg-white text-[13px] font-bold text-slate-400">
                                                        Chưa có ảnh cho nội dung này
                                                    </div>
                                                )}
                                            </div>
                                        </section>
                                    );
                                })}

                                <div className="text-[12px] font-semibold text-slate-400">
                                    Tối đa {MAX_REPLY_CONTENTS} nội dung và {MAX_REPLY_IMAGES} ảnh cho một mẫu.
                                </div>
                            </div>

                            <label className="inline-flex items-center gap-2 text-[13px] font-bold text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={replyForm.is_active}
                                    onChange={(event) => handleReplyFormChange('is_active', event.target.checked)}
                                    className="size-4 rounded border-slate-300 text-sky-700"
                                />
                                Bật mẫu
                            </label>
                        </div>

                        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
                            {replyForm.id && (
                                <button type="button" onClick={() => deleteReply(replyForm)} disabled={saving || uploading} className={dangerButtonClassName}>
                                    <span className="material-symbols-outlined text-[17px]">delete</span>
                                    Chuyển vào thùng rác
                                </button>
                            )}
                            <button type="button" onClick={closeForm} disabled={saving || uploading} className={secondaryButtonClassName}>
                                Hủy
                            </button>
                            <button type="submit" disabled={saving || uploading} className={primaryButtonClassName}>
                                <span className="material-symbols-outlined text-[18px]">save</span>
                                {saving ? 'Đang lưu...' : 'Lưu mẫu'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

export default QuickReplies;
