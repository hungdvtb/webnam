import {
  resolveCanonicalVideoUrl,
  resolveMediaUrl,
  resolveVideoEmbedUrl,
  resolveVideoThumbnailUrl,
  resolveYouTubeVideoId,
} from './media';

const GALLERY_PAYLOAD_ATTRIBUTE = 'data-gallery-payload';

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return normalizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

export function decodeGalleryPayload(value) {
  const rawValue = normalizeText(value);

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
        const rawVideoSource = normalizeText(item.url || item.src || item.youtubeId);
        const youtubeId = resolveYouTubeVideoId(rawVideoSource);
        const url = resolveCanonicalVideoUrl(rawVideoSource) || rawVideoSource;
        const thumbnail = resolveVideoThumbnailUrl(youtubeId || url);
        const embedUrl = resolveVideoEmbedUrl(youtubeId || url);

        if (!youtubeId || !embedUrl || !thumbnail) {
          return null;
        }

        return {
          type: 'video',
          url,
          youtubeId,
          embedUrl,
          thumbnail,
          title: normalizeText(item.title),
        };
      }

      const src = resolveMediaUrl(item.src || item.url);

      if (!src) {
        return null;
      }

      return {
        type: 'image',
        src,
        alt: normalizeText(item.alt || item.title),
      };
    })
    .filter(Boolean);
}

export function encodeGalleryPayload(value) {
  const items = normalizeGalleryItems(Array.isArray(value) ? value : value?.items);

  return encodeURIComponent(JSON.stringify({
    version: 1,
    items,
  }));
}

export function extractGalleryPayloadFromAttributes(attributes) {
  const payloadMatch = String(attributes || '').match(/\bdata-gallery-payload=(["'])(.*?)\1/i);
  return payloadMatch?.[2] || '';
}

export function buildGalleryStageMarkup(item) {
  if (!item) {
    return '';
  }

  if (item.type === 'video') {
    const embedUrl = item.embedUrl || resolveVideoEmbedUrl(item.youtubeId || item.url);

    if (!embedUrl) {
      return '';
    }

    return [
      '<div class="bdt-media-gallery-stage-video">',
      `  <iframe src="${escapeAttribute(embedUrl)}" title="${escapeAttribute(item.title || 'YouTube video player')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`,
      '</div>',
    ].join('');
  }

  return [
    '<div class="bdt-media-gallery-stage-image-wrap">',
    `  <img class="bdt-media-gallery-stage-image" src="${escapeAttribute(item.src)}" alt="${escapeAttribute(item.alt || 'Hình ảnh bài viết')}" decoding="async" />`,
    '</div>',
  ].join('');
}

function buildThumbMarkup(item, index, isActive) {
  const thumbImage = item.type === 'video'
    ? (item.thumbnail || resolveVideoThumbnailUrl(item.youtubeId || item.url))
    : item.src;
  const label = item.type === 'video'
    ? (item.title || 'Video YouTube')
    : (item.alt || `Hình ảnh ${index + 1}`);

  return [
    `<button type="button" class="bdt-media-gallery-thumb${isActive ? ' is-active' : ''}" data-gallery-index="${index}" aria-pressed="${isActive ? 'true' : 'false'}" title="${escapeAttribute(label)}">`,
    '  <span class="bdt-media-gallery-thumb-frame">',
    `    <img src="${escapeAttribute(thumbImage)}" alt="${escapeAttribute(label)}" loading="lazy" decoding="async" />`,
    item.type === 'video' ? '    <span class="bdt-media-gallery-thumb-play material-symbols-outlined">play_arrow</span>' : '',
    '  </span>',
    `  <span class="bdt-media-gallery-thumb-label">${escapeHtml(item.type === 'video' ? 'Video' : 'Ảnh')}</span>`,
    '</button>',
  ].filter(Boolean).join('');
}

export function renderMediaGalleryMarkup(value, galleryKey = 0) {
  const items = normalizeGalleryItems(Array.isArray(value) ? value : value?.items);

  if (!items.length) {
    return '';
  }

  const initialItem = items[0];
  const payload = encodeGalleryPayload(items);
  const galleryId = `bdt-media-gallery-${galleryKey}`;

  return [
    `<figure class="bdt-media-gallery" data-gallery-id="${escapeAttribute(galleryId)}" data-gallery-active-index="0" ${GALLERY_PAYLOAD_ATTRIBUTE}="${escapeAttribute(payload)}">`,
    `  <div class="bdt-media-gallery-main" data-gallery-stage>${buildGalleryStageMarkup(initialItem)}</div>`,
    '  <div class="bdt-media-gallery-thumbs" data-gallery-thumbs>',
    items.map((item, index) => buildThumbMarkup(item, index, index === 0)).join(''),
    '  </div>',
    '</figure>',
  ].join('');
}
