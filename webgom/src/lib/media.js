import config from './config';

const ABSOLUTE_URL_PATTERN = /^(https?:)?\/\//i;
const DATA_URL_PATTERN = /^data:image\//i;
const BLOB_URL_PATTERN = /^blob:/i;
const YOUTUBE_DIRECT_URL_PATTERN = /^(?:www\.|m\.youtube\.com|youtube\.com|youtu\.be|youtube-nocookie\.com)/i;

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

const normalizeVideoCandidate = (value) => {
  const normalized = normalizeMediaCandidate(value).replace(/&amp;/gi, '&');

  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  if (YOUTUBE_DIRECT_URL_PATTERN.test(normalized)) {
    return `https://${normalized.replace(/^\/+/, '')}`;
  }

  return normalized;
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

export const resolveImageObjectUrl = (image, fallback = '') => {
  if (!image) {
    return fallback;
  }

  const candidates = [
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

  return fallback;
};

export const resolveYouTubeVideoId = (value) => {
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
