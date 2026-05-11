const PRODUCT_TYPE_LABELS = {
    bundle: 'Bundle',
    configurable: 'San pham co bien the',
    grouped: 'Nhom san pham',
    downloadable: 'San pham tai xuong',
    simple: 'San pham don',
    virtual: 'San pham ao',
};

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const sanitizeText = (value = '') => String(value || '').trim();

export const normalizeCategoryAssignmentSearchValue = (value = '') => String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase()
    .trim();

export const buildCategoryAssignmentKey = (item = {}) => {
    const itemType = item?.item_type === 'bundle_option' ? 'bundle_option' : 'product';
    const productId = toNumber(item?.product_id ?? item?.admin_product_id ?? item?.id) || 0;
    const bundleOptionUid = sanitizeText(item?.bundle_option_uid || item?.uid || '');
    const bundleOptionKey = sanitizeText(item?.bundle_option_key || '');

    return itemType === 'bundle_option'
        ? `bundle_option:${productId}:${bundleOptionUid ? `uid:${bundleOptionUid}` : bundleOptionKey}`
        : `product:${productId}`;
};

export const getCategoryAssignmentDisplayLabel = (item = {}) => {
    if (item?.item_type === 'bundle_option' || item?.display_type === 'bundle_option') {
        return 'Tuy chon bundle';
    }

    if (item?.display_type === 'variant' || item?.is_variant_child) {
        return 'Bien the';
    }

    if (sanitizeText(item?.display_label)) {
        return sanitizeText(item.display_label);
    }

    return PRODUCT_TYPE_LABELS[sanitizeText(item?.product_type)] || 'San pham';
};

export const buildCategoryAssignmentSearchText = (item = {}) => [
    item?.name,
    item?.sku,
    item?.variant_parent_name,
    item?.bundle_parent_name,
    item?.bundle_option_uid,
    item?.bundle_option_title,
    item?.option_key_display,
    item?.bundle_option_key,
    item?.category_name,
    ...(Array.isArray(item?.bundle_items_summary)
        ? item.bundle_items_summary.flatMap((summary) => [summary?.name, summary?.sku])
        : []),
]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .join(' ');

export const normalizeCategoryAssignmentItem = (item = {}) => {
    const itemType = item?.item_type === 'bundle_option' ? 'bundle_option' : 'product';
    const productId = toNumber(item?.product_id ?? item?.admin_product_id ?? (itemType === 'product' ? item?.id : null));
    const adminProductId = toNumber(item?.admin_product_id ?? productId);
    const bundleOptionUid = itemType === 'bundle_option'
        ? sanitizeText(item?.bundle_option_uid || item?.uid || '')
        : '';
    const bundleOptionKey = itemType === 'bundle_option'
        ? sanitizeText(item?.bundle_option_key || '')
        : '';
    const assignmentKey = sanitizeText(item?.assignment_key) || buildCategoryAssignmentKey({
        item_type: itemType,
        product_id: productId,
        bundle_option_uid: bundleOptionUid,
        bundle_option_key: bundleOptionKey,
    });

    return {
        ...item,
        id: assignmentKey,
        assignment_key: assignmentKey,
        item_type: itemType,
        product_id: productId,
        admin_product_id: adminProductId,
        name: sanitizeText(item?.name),
        slug: sanitizeText(item?.slug),
        sku: sanitizeText(item?.sku),
        display_sku: sanitizeText(item?.display_sku || item?.sku),
        product_type: sanitizeText(item?.product_type || item?.type),
        display_type: sanitizeText(item?.display_type || item?.product_type || item?.type),
        display_label: getCategoryAssignmentDisplayLabel(item),
        variant_parent_name: sanitizeText(item?.variant_parent_name),
        variant_parent_product_id: toNumber(item?.variant_parent_product_id),
        bundle_parent_name: sanitizeText(item?.bundle_parent_name),
        bundle_parent_product_id: toNumber(item?.bundle_parent_product_id ?? item?.product_id),
        bundle_option_uid: bundleOptionUid,
        bundle_option_key: bundleOptionKey,
        option_key_display: itemType === 'bundle_option'
            ? sanitizeText(item?.option_key_display || bundleOptionKey)
            : '',
        bundle_option_post_id: toNumber(item?.bundle_option_post_id),
        bundle_option_title: sanitizeText(item?.bundle_option_title || item?.name),
        bundle_items_count: Number(item?.bundle_items_count || 0) || 0,
        bundle_items_summary: Array.isArray(item?.bundle_items_summary)
            ? item.bundle_items_summary
                .map((summary) => ({
                    name: sanitizeText(summary?.name),
                    sku: sanitizeText(summary?.sku),
                }))
                .filter((summary) => summary.name || summary.sku)
            : [],
        status: Boolean(item?.status),
        is_primary_category: Boolean(item?.is_primary_category),
        is_variant_child: Boolean(item?.is_variant_child),
        is_removable: item?.is_removable === false ? false : !Boolean(item?.is_primary_category && itemType === 'product'),
        sort_order: Number(item?.sort_order || 0) || 0,
        category_id: toNumber(item?.category_id),
        category_name: sanitizeText(item?.category_name),
        main_image: sanitizeText(item?.main_image),
        search_text: sanitizeText(item?.search_text) || buildCategoryAssignmentSearchText(item),
    };
};

export const normalizeCategoryAssignmentItems = (items) => (
    Array.isArray(items)
        ? items
            .map((item) => normalizeCategoryAssignmentItem(item))
            .filter((item) => item.product_id)
        : []
);

const createBundleOptionKey = (option = {}) => {
    const optionPostId = toNumber(option?.option_post_id);
    if (optionPostId) {
        return `post:${optionPostId}`;
    }

    const optionTitle = sanitizeText(option?.option_title || 'Mac dinh').toLowerCase();
    return `title:${optionTitle || 'mac dinh'}`;
};

const calculateBundleOptionDiscountedPrice = (subtotal) => {
    const numericSubtotal = Number(subtotal || 0) || 0;
    if (numericSubtotal <= 0) {
        return 0;
    }

    return Math.max(numericSubtotal - Math.round(numericSubtotal * 0.1), 0);
};

const createProductPickerItem = (product = {}) => normalizeCategoryAssignmentItem({
    item_type: 'product',
    product_id: product?.id,
    admin_product_id: product?.id,
    name: product?.name,
    slug: product?.slug,
    sku: product?.sku,
    display_sku: product?.sku,
    product_type: product?.type,
    display_type: product?.type,
    display_label: PRODUCT_TYPE_LABELS[sanitizeText(product?.type)] || 'San pham',
    main_image: product?.main_image,
    status: true,
});

const createVariantPickerItem = (product = {}, variation = {}) => normalizeCategoryAssignmentItem({
    item_type: 'product',
    product_id: variation?.id,
    admin_product_id: variation?.id,
    name: variation?.name || product?.name,
    slug: variation?.slug || product?.slug,
    sku: variation?.sku,
    display_sku: variation?.sku,
    product_type: variation?.type || 'simple',
    display_type: 'variant',
    display_label: 'Bien the',
    variant_parent_name: product?.name,
    variant_parent_product_id: product?.id,
    main_image: variation?.main_image || product?.main_image,
    status: true,
    is_variant_child: true,
});

const createBundleOptionPickerItem = (product = {}, option = {}) => {
    const optionUid = sanitizeText(option?.bundle_option_uid || option?.uid || '');
    const optionKey = option?.key || createBundleOptionKey(option);
    const subtotal = Number(option?.subtotal || 0) || 0;
    const discountedPrice = calculateBundleOptionDiscountedPrice(subtotal);

    return normalizeCategoryAssignmentItem({
    item_type: 'bundle_option',
    product_id: product?.id,
    admin_product_id: product?.id,
    name: option?.option_title || 'Mac dinh',
    slug: product?.slug,
    sku: product?.sku || optionKey,
    display_sku: product?.sku || optionKey,
    product_type: 'bundle_option',
    display_type: 'bundle_option',
    display_label: 'Tuy chon bundle',
    bundle_parent_name: product?.name,
    bundle_parent_product_id: product?.id,
    bundle_option_uid: optionUid,
    bundle_option_key: optionKey,
    option_key_display: optionKey,
    bundle_option_post_id: option?.option_post_id,
    bundle_option_title: option?.option_title || 'Mac dinh',
    price: subtotal,
    current_price: discountedPrice,
    special_price: discountedPrice < subtotal ? discountedPrice : null,
    bundle_option_total_price: subtotal,
    bundle_option_discounted_price: discountedPrice,
    bundle_items_count: Array.isArray(option?.items) ? option.items.length : 0,
    bundle_items_summary: Array.isArray(option?.items)
        ? option.items.map((bundleItem) => ({
            name: sanitizeText(bundleItem?.display_name || bundleItem?.name),
            sku: sanitizeText(bundleItem?.display_sku || bundleItem?.sku),
        }))
        : [],
    main_image: product?.main_image || option?.items?.[0]?.main_image || '',
    status: true,
    });
};

export const buildCategoryPickerGroups = (products, query = '') => {
    const normalizedQuery = normalizeCategoryAssignmentSearchValue(query);

    return (Array.isArray(products) ? products : [])
        .map((product) => {
            const baseProduct = createProductPickerItem(product);
            const variationSearchText = (Array.isArray(product?.variations) ? product.variations : [])
                .map((variation) => createVariantPickerItem(product, variation))
                .map((item) => item.search_text)
                .join(' ');
            const baseMatches = normalizedQuery === ''
                || normalizeCategoryAssignmentSearchValue([
                    baseProduct.search_text,
                    variationSearchText,
                ].filter(Boolean).join(' ')).includes(normalizedQuery);
            const bundleOptions = (Array.isArray(product?.bundle_options) ? product.bundle_options : [])
                .map((option) => createBundleOptionPickerItem(product, option))
                .filter((item) => (
                    normalizedQuery === ''
                    || baseMatches
                    || normalizeCategoryAssignmentSearchValue(item.search_text).includes(normalizedQuery)
                ));
            const hasChildren = bundleOptions.length > 0;

            if (!baseMatches && !hasChildren) {
                return null;
            }

            return {
                product: baseProduct,
                showProductSelection: baseMatches || normalizedQuery === '',
                variations: [],
                bundleOptions,
            };
        })
        .filter(Boolean);
};
