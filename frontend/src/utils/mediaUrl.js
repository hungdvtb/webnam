import { STORAGE_BASE_URL } from '../services/api';

const ABSOLUTE_URL_PATTERN = /^(?:[a-z][a-z\d+\-.]*:)?\/\//i;
const SPECIAL_URL_PATTERN = /^(?:data|blob|mailto|tel):/i;

const normalizeUrlValue = (value) => String(value || '').trim();

export const resolveMediaUrl = (value) => {
    const rawValue = normalizeUrlValue(value);

    if (!rawValue) {
        return '';
    }

    if (ABSOLUTE_URL_PATTERN.test(rawValue) || SPECIAL_URL_PATTERN.test(rawValue)) {
        return rawValue;
    }

    const normalizedBaseUrl = String(STORAGE_BASE_URL || '').replace(/\/$/, '');
    const normalizedPath = rawValue.replace(/^\/+/, '');

    if (!normalizedBaseUrl) {
        return rawValue.startsWith('/') ? rawValue : `/${normalizedPath}`;
    }

    if (rawValue.startsWith('/')) {
        return `${normalizedBaseUrl}${rawValue}`;
    }

    return `${normalizedBaseUrl}/${normalizedPath}`;
};

export const pickMediaVariant = (media, preferred = 'large') => {
    if (!media || typeof media !== 'object') {
        return '';
    }

    const candidates = [
        preferred === 'thumbnail' ? media.thumbnail_url : '',
        preferred === 'medium' ? media.medium_url : '',
        preferred === 'large' ? media.large_url : '',
        media.thumbnail_url,
        media.medium_url,
        media.large_url,
        media.url,
        media.image_url,
        media.path,
        media.src,
    ].filter(Boolean);

    return resolveMediaUrl(candidates.find(Boolean) || '');
};

export const resolveImageObjectUrl = (image, preferred = 'large', fallback = '') => {
    const resolved = pickMediaVariant(image, preferred);
    return resolved || resolveMediaUrl(fallback);
};

export const pickPrimaryImageObject = (images = []) => {
    if (!Array.isArray(images)) {
        return null;
    }

    const normalizedImages = images.filter((image) => image && typeof image === 'object');
    return normalizedImages.find((image) => Boolean(image.is_primary)) || normalizedImages[0] || null;
};

export const resolveEntityImageUrl = (entity, preferred = 'large', fallback = '') => {
    if (!entity || typeof entity !== 'object') {
        return resolveMediaUrl(fallback);
    }

    const candidates = [
        entity.image,
        entity.primary_image,
        entity.featured_image_media,
        entity.banner_image,
        entity.logo_image,
    ];

    for (const candidate of candidates) {
        const resolved = resolveImageObjectUrl(candidate, preferred);
        if (resolved) {
            return resolved;
        }
    }

    const rawCandidates = [
        preferred === 'thumbnail' ? entity.thumbnail_url : '',
        preferred === 'medium' ? entity.medium_url : '',
        preferred === 'large' ? entity.large_url : '',
        entity.main_image,
        entity.featured_image,
        entity.banner_path,
        entity.logo_path,
        entity.image_url,
        entity.url,
        entity.path,
    ];

    for (const candidate of rawCandidates) {
        const resolved = resolveMediaUrl(candidate);
        if (resolved) {
            return resolved;
        }
    }

    return resolveMediaUrl(fallback);
};

export const resolveProductPrimaryImageUrl = (entity, preferred = 'large', fallback = '') => {
    if (!entity || typeof entity !== 'object') {
        return resolveMediaUrl(fallback);
    }

    const explicitPrimaryUrl = resolveImageObjectUrl(entity.primary_image, preferred);
    if (explicitPrimaryUrl) {
        return explicitPrimaryUrl;
    }

    const collectionPrimaryUrl = resolveImageObjectUrl(
        pickPrimaryImageObject(entity.images),
        preferred,
    );
    if (collectionPrimaryUrl) {
        return collectionPrimaryUrl;
    }

    return resolveEntityImageUrl(entity, preferred, fallback);
};

export const resolvePostFeaturedImageUrl = (post, preferred = 'large') => resolveEntityImageUrl(
    post,
    preferred,
    post?.featured_image || post?.image || ''
);
