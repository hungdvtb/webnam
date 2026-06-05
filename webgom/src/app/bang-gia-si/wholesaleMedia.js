import {
  resolveCanonicalVideoUrl,
  resolveEntityPrimaryVideoUrl,
  resolveImageObjectUrl,
} from "@/lib/media";

const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const normalizeText = (value = "") => String(value ?? "").trim();

const isInheritedImage = (image, entityId = 0) => {
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    return false;
  }

  if (image.is_inherited === true || image.isInherited === true) {
    return true;
  }

  const sourceProductId = Number(image.source_product_id || image.sourceProductId || 0);
  return entityId > 0 && sourceProductId > 0 && sourceProductId !== entityId;
};

const getImageKey = (src = "") => normalizeText(src).toLowerCase();

export const buildWholesaleMediaImages = (entity = {}, productName = "") => {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
    return [];
  }

  const entityId = Number(entity.id || entity.product_id || entity.target_product_id || 0);
  const primaryImage = entity.primary_image || entity.primaryImage || null;
  const primaryImageIsInherited = isInheritedImage(primaryImage, entityId);
  const imageCollection = [
    ...toArray(entity.images),
    ...toArray(entity.gallery),
    ...toArray(entity.gallery_images),
    ...toArray(entity.galleryImages),
  ];
  const directCandidates = [
    primaryImage,
    ...imageCollection,
    !primaryImageIsInherited && entity.main_image ? { path: entity.main_image } : null,
    !primaryImageIsInherited && entity.mainImage ? { path: entity.mainImage } : null,
    !primaryImageIsInherited && entity.image_url ? { path: entity.image_url } : null,
    !primaryImageIsInherited && entity.imageUrl ? { path: entity.imageUrl } : null,
    !primaryImageIsInherited && entity.url ? { path: entity.url } : null,
    !primaryImageIsInherited && entity.src ? { path: entity.src } : null,
  ].filter(Boolean);
  const seen = new Set();

  return directCandidates
    .filter((candidate) => !isInheritedImage(candidate, entityId))
    .map((candidate) => {
      const src = resolveImageObjectUrl(candidate, "large", "");
      const key = getImageKey(src);

      if (!src || seen.has(key)) {
        return null;
      }

      seen.add(key);

      return {
        src,
        alt: normalizeText(candidate?.alt || candidate?.name || productName) || "Sản phẩm",
      };
    })
    .filter(Boolean);
};

export const buildWholesaleVideoHref = (entity = {}) => {
  const videoUrl = resolveEntityPrimaryVideoUrl(entity);
  return resolveCanonicalVideoUrl(videoUrl) || videoUrl;
};
