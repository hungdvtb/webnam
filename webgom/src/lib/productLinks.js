const normalizeText = (value = '') => String(value ?? '').trim();

const resolveBundleOptionKey = (product = {}) => (
  normalizeText(product?.bundle_option_key || product?.bundleOptionKey)
);

const resolveBundleOptionUid = (product = {}) => (
  normalizeText(product?.bundle_option_uid || product?.bundleOptionUid || product?.option_uid)
);

const resolveBundleOptionTitle = (product = {}) => (
  normalizeText(product?.bundle_option_title || product?.bundleOptionTitle)
);

const resolveProductItemType = (product = {}) => (
  normalizeText(product?.item_type || product?.itemType).toLowerCase()
);

const resolveProductType = (product = {}) => (
  normalizeText(product?.type || product?.productType).toLowerCase()
);

const resolveProductSlugOrId = (product = {}) => (
  normalizeText(product?.slug || product?.id)
);

const resolvePositiveId = (value) => {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
};

const buildProductPathname = (slugOrId = '') => {
  const normalized = normalizeText(slugOrId);

  if (!normalized || normalized === '/' || normalized === '#') {
    return '';
  }

  return `/product/${encodeURIComponent(normalized)}`;
};

export function buildProductDetailHref(product = {}) {
  const slugOrId = resolveProductSlugOrId(product);
  const pathname = slugOrId ? `/product/${slugOrId}` : '/products';
  const bundleOptionUid = resolveBundleOptionUid(product);
  const bundleOptionKey = resolveBundleOptionKey(product);
  const bundleOptionTitle = resolveBundleOptionTitle(product);
  const itemType = resolveProductItemType(product);
  const productType = resolveProductType(product);

  if (itemType !== 'bundle_option' && !bundleOptionUid && !bundleOptionKey && !bundleOptionTitle) {
    return productType === 'bundle'
      ? { pathname, query: { bundle_preview: '1' } }
      : pathname;
  }

  const query = {};

  if (bundleOptionUid) {
    query.bundle_option_uid = bundleOptionUid;
  }

  if (bundleOptionKey) {
    query.bundle_option_key = bundleOptionKey;
  }

  if (bundleOptionTitle) {
    query.bundle_option = bundleOptionTitle;
  }

  return Object.keys(query).length > 0 ? { pathname, query } : pathname;
}

export function stringifyProductHref(href = '') {
  if (typeof href === 'string') {
    return href || '/products';
  }

  const pathname = normalizeText(href?.pathname) || '/products';
  const query = href?.query && typeof href.query === 'object' ? href.query : {};
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    params.set(key, String(value));
  });

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function buildBundleComponentDetailHref(item = {}) {
  const parentSlugOrId = normalizeText(
    item?.base_product_slug
    || item?.baseProductSlug
    || item?.base_product_id
    || item?.baseProductId
  );
  const directSlugOrId = normalizeText(
    item?.selected_variant?.slug
    || item?.selectedVariant?.slug
    || item?.slug
    || item?.product_slug
    || item?.productSlug
    || item?.selected_product_id
    || item?.selectedProductId
    || item?.id
  );
  const pathname = buildProductPathname(parentSlugOrId || directSlugOrId);

  if (!pathname) {
    return null;
  }

  const baseProductId = resolvePositiveId(
    item?.base_product_id
    ?? item?.baseProductId
    ?? item?.product_id
    ?? item?.productId
    ?? item?.id
  );
  const selectedProductId = resolvePositiveId(
    item?.selected_product_id
    ?? item?.selectedProductId
    ?? item?.pivot?.variant_id
    ?? item?.variant_id
    ?? item?.variantId
    ?? item?.selected_variant?.id
    ?? item?.selectedVariant?.id
    ?? item?.id
  );
  const variantId = resolvePositiveId(
    item?.pivot?.variant_id
    ?? item?.variant_id
    ?? item?.variantId
    ?? item?.selected_variant?.id
    ?? item?.selectedVariant?.id
  );
  const resolvedVariantId = variantId || (
    parentSlugOrId && selectedProductId > 0 && selectedProductId !== baseProductId
      ? selectedProductId
      : 0
  );

  if (!parentSlugOrId || resolvedVariantId <= 0) {
    return pathname;
  }

  return {
    pathname,
    query: {
      variant_id: String(resolvedVariantId),
    },
  };
}

export function buildProductCardKey(product = {}) {
  const productId = resolveProductSlugOrId(product) || 'product';
  const bundleOptionUid = resolveBundleOptionUid(product);
  const bundleOptionKey = resolveBundleOptionKey(product);
  const bundleOptionTitle = resolveBundleOptionTitle(product);
  const itemType = resolveProductItemType(product);

  if (itemType !== 'bundle_option' && !bundleOptionUid && !bundleOptionKey && !bundleOptionTitle) {
    return productId;
  }

  return `${productId}:${bundleOptionUid || bundleOptionKey || bundleOptionTitle || 'bundle-option'}`;
}
