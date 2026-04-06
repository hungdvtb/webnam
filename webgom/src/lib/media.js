import config from './config';

const ABSOLUTE_URL_PATTERN = /^(https?:)?\/\//i;
const DATA_URL_PATTERN = /^data:image\//i;
const BLOB_URL_PATTERN = /^blob:/i;
const YOUTUBE_DIRECT_URL_PATTERN = /^(?:www\.|m\.youtube\.com|youtube\.com|youtu\.be|youtube-nocookie\.com)/i;
const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{6,}$/;
const IMAGE_PREFERENCE_KEYS = ['thumbnail', 'medium', 'large', 'original'];
const DIRECT_IMAGE_FIELDS = [
  'thumbnail_url',
  'medium_url',
  'large_url',
  'original_url',
  'image_url',
  'url',
  'path',
  'src',
];

const normalizeMediaCandidate = (value) => {
  const normalized = String(value || '').trim();

  if (
    !normalized ||
    normalized === '/' ||
    normalized === '#' ||
    normalized === 'null' ||
    normalized === 'undefined' ||
    /^javascript:/i.test(normalized)
  ) {
    return '';
  }

  return normalized;
};

const safeDecodeURIComponent = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const sanitizeYouTubeVideoId = (value) => {
  const normalized = String(value || '').trim();
  return YOUTUBE_VIDEO_ID_PATTERN.test(normalized) ? normalized : '';
};

const normalizeVideoCandidate = (value) => {
  const normalized = safeDecodeURIComponent(normalizeMediaCandidate(value)).replace(/&amp;/gi, '&');

  if (!normalized) {
    return '';
  }

  const directVideoId = sanitizeYouTubeVideoId(normalized);
  if (directVideoId) {
    return directVideoId;
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  if (YOUTUBE_DIRECT_URL_PATTERN.test(normalized)) {
    return `https://${normalized.replace(/^\/+/, '')}`;
  }

  return normalized;
};

const buildCanonicalYouTubeUrl = (videoId) => {
  const normalizedVideoId = sanitizeYouTubeVideoId(videoId);

  return normalizedVideoId
    ? `https://www.youtube.com/watch?v=${normalizedVideoId}`
    : '';
};

export const getApiOrigin = () => {
  try {
    return new URL(config.apiUrl).origin;
  } catch {
    return '';
  }
};

export const resolveMediaUrl = (value) => {
  const normalized = normalizeMediaCandidate(value);

  if (!normalized) {
    return '';
  }

  if (
    ABSOLUTE_URL_PATTERN.test(normalized) ||
    DATA_URL_PATTERN.test(normalized) ||
    BLOB_URL_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  const apiOrigin = getApiOrigin();
  const storageBase = String(config.storageUrl || '').replace(/\/+$/, '');

  if (normalized.startsWith('/storage/')) {
    return apiOrigin ? `${apiOrigin}${normalized}` : normalized;
  }

  const cleanPath = normalized.replace(/^[/\\]+/, '');

  if (!cleanPath) {
    return '';
  }

  return storageBase ? `${storageBase}/${cleanPath}` : normalized;
};

const normalizeImagePreference = (value = 'large') => (
  IMAGE_PREFERENCE_KEYS.includes(value) ? value : 'large'
);

const toImageArray = (value) => (
  Array.isArray(value) ? value.filter(Boolean) : []
);

const pickDirectImageCandidate = (image) => {
  if (!image || typeof image !== 'object' || Array.isArray(image)) {
    return null;
  }

  const candidate = DIRECT_IMAGE_FIELDS.reduce((accumulator, field) => {
    if (image?.[field]) {
      accumulator[field] = image[field];
    }

    return accumulator;
  }, {});

  return Object.keys(candidate).length > 0 ? candidate : null;
};

export const resolveImageObjectUrl = (image, preferredOrFallback = 'large', fallback = '') => {
  const normalizedPreferred = normalizeImagePreference(preferredOrFallback);
  const resolvedFallback = normalizedPreferred === preferredOrFallback ? fallback : preferredOrFallback;

  if (!image) {
    return resolvedFallback;
  }

  if (typeof image === 'string') {
    return resolveMediaUrl(image) || resolvedFallback;
  }

  if (Array.isArray(image)) {
    for (const candidate of image) {
      const resolved = resolveImageObjectUrl(candidate, normalizedPreferred, '');
      if (resolved) {
        return resolved;
      }
    }

    return resolvedFallback;
  }

  if (typeof image !== 'object') {
    return resolvedFallback;
  }

  const candidates = [
    normalizedPreferred === 'thumbnail' ? image.thumbnail_url : null,
    normalizedPreferred === 'medium' ? image.medium_url : null,
    normalizedPreferred === 'large' ? image.large_url : null,
    normalizedPreferred === 'original' ? image.original_url : null,
    image.thumbnail_url,
    image.medium_url,
    image.large_url,
    image.original_url,
    image.image_url,
    image.url,
    image.path,
    image.src,
  ];

  for (const candidate of candidates) {
    const resolved = resolveMediaUrl(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return resolvedFallback;
};

export const getEntityImageCollection = (entity = {}) => {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    return [];
  }

  return [
    ...toImageArray(entity.images),
    ...toImageArray(entity.gallery),
    ...toImageArray(entity.gallery_images),
    ...toImageArray(entity.galleryImages),
  ];
};

export const getEntityImageCandidates = (entity = {}) => {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    return [];
  }

  return [
    entity.image,
    entity.primary_image,
    ...getEntityImageCollection(entity),
    pickDirectImageCandidate(entity),
    entity.main_image ? { path: entity.main_image } : null,
  ].filter(Boolean);
};

export const pickEntityPrimaryImage = (entity = {}, preferredOrFallback = 'large') => {
  const normalizedPreferred = normalizeImagePreference(preferredOrFallback);

  return getEntityImageCandidates(entity).find((candidate) => (
    Boolean(resolveImageObjectUrl(candidate, normalizedPreferred, ''))
  )) || null;
};

export const resolveEntityImageUrl = (entity, preferredOrFallback = 'large', fallback = '') => {
  const normalizedPreferred = normalizeImagePreference(preferredOrFallback);
  const resolvedFallback = normalizedPreferred === preferredOrFallback ? fallback : preferredOrFallback;

  for (const candidate of getEntityImageCandidates(entity)) {
    const resolved = resolveImageObjectUrl(candidate, normalizedPreferred, '');

    if (resolved) {
      return resolved;
    }
  }

  return resolvedFallback;
};

export const resolveCartItemImageUrl = (item, preferredOrFallback = 'medium', fallback = '') => {
  const normalizedPreferred = normalizeImagePreference(preferredOrFallback);
  const resolvedFallback = normalizedPreferred === preferredOrFallback ? fallback : preferredOrFallback;

  const candidates = [
    item?.variantImage,
    item?.variant_image,
    item?.variantPrimaryImage,
    item?.variant_primary_image,
    ...toImageArray(item?.variantImages),
    ...toImageArray(item?.variant_images),
    ...getEntityImageCandidates(item),
    item?.parentImage,
    item?.parent_image,
    item?.parentPrimaryImage,
    item?.parent_primary_image,
    ...toImageArray(item?.parentImages),
    ...toImageArray(item?.parent_images),
    item?.parentMainImage ? { path: item.parentMainImage } : null,
    item?.parent_main_image ? { path: item.parent_main_image } : null,
  ];

  for (const candidate of candidates) {
    const resolved = resolveImageObjectUrl(candidate, normalizedPreferred, '');

    if (resolved) {
      return resolved;
    }
  }

  return resolvedFallback;
};

export const resolveYouTubeVideoId = (value) => {
  const normalized = normalizeVideoCandidate(value);

  if (!normalized) {
    return '';
  }

  const directVideoId = sanitizeYouTubeVideoId(normalized);
  if (directVideoId) {
    return directVideoId;
  }

  const fallbackMatch = normalized.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\/?\?(?:[^#\s]*&)?(?:v|vi)=|embed\/|live\/|shorts\/|v\/|e\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i
  );

  try {
    const parsedUrl = new URL(normalized);
    const host = parsedUrl.hostname.toLowerCase();
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const nestedUrl = parsedUrl.searchParams.get('u');

    if (nestedUrl) {
      const normalizedNestedUrl = nestedUrl.startsWith('/')
        ? `https://www.youtube.com${safeDecodeURIComponent(nestedUrl)}`
        : safeDecodeURIComponent(nestedUrl);
      const nestedVideoId = resolveYouTubeVideoId(normalizedNestedUrl);

      if (nestedVideoId) {
        return nestedVideoId;
      }
    }

    if (host.includes('youtu.be')) {
      return sanitizeYouTubeVideoId(pathSegments[0]) || fallbackMatch?.[1] || '';
    }

    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const directParamVideoId = sanitizeYouTubeVideoId(parsedUrl.searchParams.get('v') || parsedUrl.searchParams.get('vi'));
      if (directParamVideoId) {
        return directParamVideoId;
      }

      const embedIndex = pathSegments.findIndex((segment) => ['embed', 'live', 'shorts', 'v', 'e'].includes(segment));
      if (embedIndex >= 0 && pathSegments[embedIndex + 1]) {
        return sanitizeYouTubeVideoId(pathSegments[embedIndex + 1]) || fallbackMatch?.[1] || '';
      }
    }
  } catch {
    return fallbackMatch?.[1] || '';
  }

  return fallbackMatch?.[1] || '';
};

export const resolveVideoThumbnailUrl = (value) => {
  const youtubeVideoId = resolveYouTubeVideoId(value);

  if (!youtubeVideoId) {
    return '';
  }

  return `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`;
};

export const resolveVideoEmbedUrl = (value) => {
  const normalized = normalizeVideoCandidate(value);

  if (!normalized) {
    return '';
  }

  const appendPlayerParams = (rawUrl) => {
    try {
      const parsedUrl = new URL(rawUrl);
      parsedUrl.searchParams.set('playsinline', '1');
      parsedUrl.searchParams.set('controls', '1');
      parsedUrl.searchParams.set('fs', '1');
      parsedUrl.searchParams.set('rel', '0');
      parsedUrl.searchParams.set('modestbranding', '1');
      parsedUrl.searchParams.set('enablejsapi', '1');

      if (typeof window !== 'undefined' && window.location?.origin) {
        parsedUrl.searchParams.set('origin', window.location.origin);
      }

      return parsedUrl.toString();
    } catch {
      return rawUrl;
    }
  };

  if (/youtube\.com\/embed\//i.test(normalized)) {
    return appendPlayerParams(normalized);
  }

  if (/facebook\.com\/plugins\/video\.php/i.test(normalized)) {
    return appendPlayerParams(normalized);
  }

  const youtubeVideoId = resolveYouTubeVideoId(normalized);

  if (youtubeVideoId) {
    return appendPlayerParams(`https://www.youtube.com/embed/${youtubeVideoId}`);
  }

  return '';
};

export const resolveCanonicalVideoUrl = (value) => {
  const youtubeVideoId = resolveYouTubeVideoId(value);

  return youtubeVideoId
    ? buildCanonicalYouTubeUrl(youtubeVideoId)
    : '';
};
