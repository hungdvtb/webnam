import config from './config';

const ABSOLUTE_URL_PATTERN = /^(https?:)?\/\//i;
const DATA_URL_PATTERN = /^data:image\//i;
const BLOB_URL_PATTERN = /^blob:/i;

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

export const resolveVideoEmbedUrl = (value) => {
  const normalized = normalizeMediaCandidate(value);

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

  let youtubeVideoId = '';

  if (/youtube\.com\/watch\?v=/i.test(normalized)) {
    youtubeVideoId = normalized.split('v=')[1]?.split('&')[0] || '';
  } else if (/youtu\.be\//i.test(normalized)) {
    youtubeVideoId = normalized.split('youtu.be/')[1]?.split('?')[0] || '';
  } else if (/youtube\.com\/live\//i.test(normalized)) {
    youtubeVideoId = normalized.split('live/')[1]?.split('?')[0] || '';
  } else if (/youtube\.com\/shorts\//i.test(normalized)) {
    youtubeVideoId = normalized.split('shorts/')[1]?.split('?')[0] || '';
  }

  if (youtubeVideoId) {
    return appendPlayerParams(`https://www.youtube.com/embed/${youtubeVideoId}`);
  }

  return '';
};
