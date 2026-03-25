const GALLERY_PAYLOAD_VERSION = 1;
const GALLERY_BLOCK_CLASS = 'ql-bdt-media-gallery';
const GALLERY_PAYLOAD_ATTRIBUTE = 'data-gallery-payload';
const YOUTUBE_HOST_PATTERN = /(?:youtube(?:-nocookie)?\.com|youtu\.be)/i;

function createGalleryItemId(prefix = 'media') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMediaText(value) {
    return String(value || '').trim();
}

function normalizeVideoCandidate(value) {
    const normalized = normalizeMediaText(value).replace(/&amp;/gi, '&');

    if (!normalized) {
        return '';
    }

    if (normalized.startsWith('//')) {
        return `https:${normalized}`;
    }

    if (!/^https?:\/\//i.test(normalized) && YOUTUBE_HOST_PATTERN.test(normalized)) {
        return `https://${normalized.replace(/^\/+/, '')}`;
    }

    return normalized;
}

export function extractYouTubeVideoId(value) {
    const normalized = normalizeVideoCandidate(value);

    if (!normalized) {
        return '';
    }

    const fallbackMatch = normalized.match(
        /(?:youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i
    );

    try {
        const parsedUrl = new URL(normalized);
        const host = parsedUrl.hostname.toLowerCase();
        const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);

        if (host.includes('youtu.be')) {
            return pathSegments[0] || fallbackMatch?.[1] || '';
        }

        if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
            if (parsedUrl.searchParams.has('v')) {
                return parsedUrl.searchParams.get('v') || fallbackMatch?.[1] || '';
            }

            const embedIndex = pathSegments.findIndex((segment) => ['embed', 'live', 'shorts'].includes(segment));
            if (embedIndex >= 0 && pathSegments[embedIndex + 1]) {
                return pathSegments[embedIndex + 1];
            }
        }
    } catch {
        return fallbackMatch?.[1] || '';
    }

    return fallbackMatch?.[1] || '';
}

export function resolveYouTubeThumbnailUrl(value) {
    const videoId = extractYouTubeVideoId(value);

    if (!videoId) {
        return '';
    }

    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function resolveYouTubeEmbedUrl(value) {
    const videoId = extractYouTubeVideoId(value);

    if (!videoId) {
        return '';
    }

    const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
    embedUrl.searchParams.set('playsinline', '1');
    embedUrl.searchParams.set('controls', '1');
    embedUrl.searchParams.set('fs', '1');
    embedUrl.searchParams.set('rel', '0');
    embedUrl.searchParams.set('modestbranding', '1');

    return embedUrl.toString();
}

export function buildImageGalleryItem(sourceUrl, overrides = {}) {
    const src = normalizeMediaText(sourceUrl);

    if (!src) {
        return null;
    }

    return {
        id: overrides.id || createGalleryItemId('image'),
        type: 'image',
        src,
        alt: normalizeMediaText(overrides.alt || overrides.title),
    };
}

export function buildVideoGalleryItem(sourceUrl, overrides = {}) {
    const url = normalizeVideoCandidate(sourceUrl);
    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
        return null;
    }

    return {
        id: overrides.id || createGalleryItemId('video'),
        type: 'video',
        url,
        youtubeId: videoId,
        thumbnail: resolveYouTubeThumbnailUrl(url),
        title: normalizeMediaText(overrides.title),
    };
}

export function normalizeGalleryItems(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return null;
            }

            if (item.type === 'video') {
                return buildVideoGalleryItem(item.url || item.src, item);
            }

            return buildImageGalleryItem(item.src || item.url, item);
        })
        .filter(Boolean);
}

export function encodeGalleryPayload(value) {
    const items = normalizeGalleryItems(Array.isArray(value) ? value : value?.items);

    return encodeURIComponent(JSON.stringify({
        version: GALLERY_PAYLOAD_VERSION,
        items,
    }));
}

export function decodeGalleryPayload(value) {
    const rawValue = normalizeMediaText(value);

    if (!rawValue) {
        return [];
    }

    const parsePayload = (input) => {
        const parsed = JSON.parse(input);
        return normalizeGalleryItems(Array.isArray(parsed) ? parsed : parsed?.items);
    };

    try {
        return parsePayload(decodeURIComponent(rawValue));
    } catch {
        try {
            return parsePayload(rawValue);
        } catch {
            return [];
        }
    }
}

export function parseYouTubeLinks(rawValue) {
    const normalized = String(rawValue || '').replace(/\r/g, '').trim();

    if (!normalized) {
        return { links: [], invalid: [] };
    }

    const matches = normalized.match(
        /(?:https?:\/\/[^\s,]+|www\.[^\s,]+|(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s,]+)/gi
    );

    const candidates = matches?.length
        ? matches
        : normalized.split(/[\n,]+/g).map((part) => part.trim()).filter(Boolean);

    const uniqueLinks = [];
    const invalid = [];

    candidates.forEach((candidate) => {
        const normalizedLink = normalizeVideoCandidate(candidate);

        if (!normalizedLink) {
            return;
        }

        if (!extractYouTubeVideoId(normalizedLink)) {
            invalid.push(candidate.trim());
            return;
        }

        if (!uniqueLinks.includes(normalizedLink)) {
            uniqueLinks.push(normalizedLink);
        }
    });

    return { links: uniqueLinks, invalid };
}

export function buildGallerySummary(items) {
    const normalizedItems = normalizeGalleryItems(items);
    const imageCount = normalizedItems.filter((item) => item.type === 'image').length;
    const videoCount = normalizedItems.filter((item) => item.type === 'video').length;

    if (!normalizedItems.length) {
        return 'Khối media trống';
    }

    const parts = ['Block media'];

    if (imageCount) {
        parts.push(`${imageCount} ảnh`);
    }

    if (videoCount) {
        parts.push(`${videoCount} video`);
    }

    return parts.join(' • ');
}

function getGalleryPreviewUrl(items) {
    const firstItem = normalizeGalleryItems(items)[0];

    if (!firstItem) {
        return '';
    }

    return firstItem.type === 'video'
        ? resolveYouTubeThumbnailUrl(firstItem.url)
        : normalizeMediaText(firstItem.src);
}

export function readGalleryItemsFromNode(node) {
    return decodeGalleryPayload(node?.getAttribute?.(GALLERY_PAYLOAD_ATTRIBUTE));
}

export function renderBlogMediaGalleryNode(node, value) {
    const items = normalizeGalleryItems(Array.isArray(value) ? value : value?.items);
    const summary = buildGallerySummary(items);
    const previewUrl = getGalleryPreviewUrl(items);
    const imageCount = items.filter((item) => item.type === 'image').length;
    const videoCount = items.filter((item) => item.type === 'video').length;

    node.setAttribute('contenteditable', 'false');
    node.setAttribute(GALLERY_PAYLOAD_ATTRIBUTE, encodeGalleryPayload(items));
    node.setAttribute('data-gallery-count', String(items.length));
    node.setAttribute('data-image-count', String(imageCount));
    node.setAttribute('data-video-count', String(videoCount));
    node.setAttribute('data-gallery-summary', summary);
    node.setAttribute('title', 'Nhấn để chỉnh block media gallery');
    node.textContent = `${summary} • Nhấn để chỉnh`;

    if (previewUrl) {
        node.style.setProperty('--ql-bdt-media-gallery-preview', `url("${previewUrl.replace(/"/g, '\\"')}")`);
    } else {
        node.style.setProperty('--ql-bdt-media-gallery-preview', 'none');
    }
}

export function registerBlogMediaGalleryBlot(Quill) {
    if (!Quill || globalThis.__blogMediaGalleryBlotRegistered) {
        return;
    }

    const BlockEmbed = Quill.import('blots/block/embed');
    const icons = Quill.import('ui/icons');

    icons.mediaGallery = [
        '<svg viewBox="0 0 18 18">',
        '  <rect class="ql-fill" x="2" y="3" width="6" height="5" rx="1"></rect>',
        '  <rect class="ql-fill" x="10" y="3" width="6" height="5" rx="1"></rect>',
        '  <rect class="ql-fill" x="2" y="10" width="6" height="5" rx="1"></rect>',
        '  <path class="ql-fill" d="M12 10a1 1 0 0 0-1 1v3l4-2.5L11 9v1z"></path>',
        '  <rect class="ql-stroke" x="10" y="10" width="6" height="5" rx="1"></rect>',
        '</svg>',
    ].join('');

    class BlogMediaGalleryBlot extends BlockEmbed {
        static blotName = 'mediaGallery';

        static tagName = 'div';

        static className = GALLERY_BLOCK_CLASS;

        static create(value) {
            const node = super.create();
            renderBlogMediaGalleryNode(node, value);
            return node;
        }

        static value(node) {
            return readGalleryItemsFromNode(node);
        }
    }

    Quill.register(BlogMediaGalleryBlot);
    globalThis.__blogMediaGalleryBlotRegistered = true;
}

export {
    GALLERY_BLOCK_CLASS,
    GALLERY_PAYLOAD_ATTRIBUTE,
    createGalleryItemId,
};
