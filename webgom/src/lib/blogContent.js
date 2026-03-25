import { resolveMediaUrl, resolveVideoEmbedUrl } from './media';
import {
  decodeGalleryPayload,
  extractGalleryPayloadFromAttributes,
  renderMediaGalleryMarkup,
} from './blogMediaGallery';

const STANDALONE_YOUTUBE_BLOCK_PATTERN = /<(p|div)\b[^>]*>\s*(?:<a\b[^>]*href=(["'])([^"']+)\2[^>]*>[\s\S]*?<\/a>|(((https?:)?\/\/|www\.)[^\s<]+|(?:youtube\.com|youtu\.be)\/[^\s<]+))\s*<\/\1>/gi;
const YOUTUBE_IFRAME_PATTERN = /<iframe\b[^>]*src=(["'])([^"']+)\1[^>]*>(?:<\/iframe>)?/gi;
const STANDALONE_IMAGE_PATTERN = /<p\b[^>]*>\s*((?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)\s*<\/p>/gi;
const IMAGE_TAG_PATTERN = /<img\b([^>]*?)>/gi;
const VIDEO_PLACEHOLDER_PATTERN = /__BLOG_VIDEO_EMBED_(\d+)__/g;
const MEDIA_GALLERY_BLOCK_PATTERN = /<div\b([^>]*\bclass=(["'])[^"']*\bql-bdt-media-gallery\b[^"']*\2[^>]*)>[\s\S]*?<\/div>/gi;
const MEDIA_GALLERY_PLACEHOLDER_PATTERN = /__BLOG_MEDIA_GALLERY_(\d+)__/g;
const NON_BREAKING_SPACE_PATTERN = /(?:&nbsp;|&#160;|&#xa0;|\u00a0)/gi;

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeMediaLink(value) {
  return String(value || '').trim().replace(/&amp;/gi, '&');
}

function normalizeEditorWhitespace(html) {
  return String(html || '').replace(NON_BREAKING_SPACE_PATTERN, ' ');
}

function upsertAttribute(tag, name, value) {
  const attributePattern = new RegExp(`\\b${name}\\s*=\\s*(["']).*?\\1`, 'i');
  const serialized = `${name}="${escapeAttribute(value)}"`;

  if (attributePattern.test(tag)) {
    return tag.replace(attributePattern, serialized);
  }

  return tag.replace(/<([a-z0-9-]+)/i, `<$1 ${serialized}`);
}

function appendClass(tag, className) {
  if (!className) {
    return tag;
  }

  const classPattern = /\bclass\s*=\s*(["'])(.*?)\1/i;
  const nextClasses = className.split(/\s+/).filter(Boolean);

  if (classPattern.test(tag)) {
    return tag.replace(classPattern, (match, quote, currentValue) => {
      const merged = new Set(String(currentValue).split(/\s+/).filter(Boolean));
      nextClasses.forEach((item) => merged.add(item));
      return `class=${quote}${Array.from(merged).join(' ')}${quote}`;
    });
  }

  return tag.replace(/<([a-z0-9-]+)/i, `<$1 class="${escapeAttribute(className)}"`);
}

function buildVideoEmbedMarkup(url) {
  const embedUrl = resolveVideoEmbedUrl(normalizeMediaLink(url));

  if (!embedUrl) {
    return '';
  }

  return [
    '<figure class="bdt-embedded-video">',
    '  <div class="bdt-video-frame">',
    `    <iframe src="${escapeAttribute(embedUrl)}" title="YouTube video player" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`,
    '  </div>',
    '</figure>',
  ].join('');
}

function createVideoPlaceholder(url, videoEmbeds) {
  const embedMarkup = buildVideoEmbedMarkup(url);

  if (!embedMarkup) {
    return '';
  }

  videoEmbeds.push(embedMarkup);

  return `__BLOG_VIDEO_EMBED_${videoEmbeds.length - 1}__`;
}

function enhanceImageTag(rawTag) {
  let nextTag = rawTag;
  const sourceMatch = rawTag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);

  if (sourceMatch) {
    const resolvedSource = resolveMediaUrl(normalizeMediaLink(sourceMatch[2]));

    if (resolvedSource) {
      nextTag = upsertAttribute(nextTag, 'src', resolvedSource);
    }
  }

  nextTag = appendClass(nextTag, 'bdt-inline-image');

  if (!/\bloading\s*=/i.test(nextTag)) {
    nextTag = upsertAttribute(nextTag, 'loading', 'lazy');
  }

  if (!/\bdecoding\s*=/i.test(nextTag)) {
    nextTag = upsertAttribute(nextTag, 'decoding', 'async');
  }

  return nextTag;
}

export function transformBlogContent(html) {
  if (!html) {
    return '';
  }

  let output = normalizeEditorWhitespace(html);
  const videoEmbeds = [];
  const mediaGalleryEmbeds = [];

  output = output.replace(
    MEDIA_GALLERY_BLOCK_PATTERN,
    (_match, attributes) => {
      const payload = extractGalleryPayloadFromAttributes(attributes);
      const galleryMarkup = renderMediaGalleryMarkup(decodeGalleryPayload(payload), mediaGalleryEmbeds.length);

      if (!galleryMarkup) {
        return '';
      }

      mediaGalleryEmbeds.push(galleryMarkup);

      return `__BLOG_MEDIA_GALLERY_${mediaGalleryEmbeds.length - 1}__`;
    }
  );

  output = output.replace(
    STANDALONE_YOUTUBE_BLOCK_PATTERN,
    (match, _tagName, _quote, hrefUrl, rawUrl) => {
      const candidate = normalizeMediaLink(hrefUrl || rawUrl);
      const placeholder = createVideoPlaceholder(candidate, videoEmbeds);

      if (!placeholder) {
        return match;
      }

      return placeholder;
    }
  );

  output = output.replace(
    YOUTUBE_IFRAME_PATTERN,
    (match, _quote, sourceUrl) => createVideoPlaceholder(sourceUrl, videoEmbeds) || match
  );
  output = output.replace(/<(p|div)\b[^>]*>\s*(__BLOG_VIDEO_EMBED_\d+__)\s*<\/\1>/gi, '$2');
  output = output.replace(/<figure\b[^>]*>\s*(__BLOG_VIDEO_EMBED_\d+__)\s*<\/figure>/gi, '$1');

  output = output.replace(
    STANDALONE_IMAGE_PATTERN,
    (_match, innerMarkup) => `<figure class="bdt-inline-media"><div class="bdt-inline-media-frame">${innerMarkup}</div></figure>`
  );

  output = output.replace(IMAGE_TAG_PATTERN, (match, attributes) => enhanceImageTag(`<img${attributes}>`));
  output = output.replace(
    /<figure\b([^>]*)>/gi,
    (match) => (/bdt-embedded-video/i.test(match) ? match : appendClass(match, 'bdt-inline-media'))
  );
  output = output.replace(/<a\b([^>]*)>\s*(<img\b[\s\S]*?>)\s*<\/a>/gi, (_match, attributes, imageMarkup) => {
    const safeLink = `<a${attributes}>${imageMarkup}</a>`;
    return appendClass(safeLink, 'bdt-inline-media-link');
  });
  output = output.replace(VIDEO_PLACEHOLDER_PATTERN, (_match, index) => videoEmbeds[Number(index)] || '');
  output = output.replace(MEDIA_GALLERY_PLACEHOLDER_PATTERN, (_match, index) => mediaGalleryEmbeds[Number(index)] || '');

  return output;
}

export function buildBlogContentMarkup(html) {
  return {
    __html: transformBlogContent(html),
  };
}
