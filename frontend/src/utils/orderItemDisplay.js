const normalizeText = (value) => {
    const normalized = String(value ?? '').trim();

    return normalized !== '' ? normalized : '';
};

const compareIdentity = (left, right) => normalizeText(left) === normalizeText(right);

export const getOrderItemSnapshotName = (item) => (
    normalizeText(item?.snapshot_name)
    || normalizeText(item?.product_name_snapshot)
    || ''
);

export const getOrderItemSnapshotSku = (item) => (
    normalizeText(item?.snapshot_sku)
    || normalizeText(item?.product_sku_snapshot)
    || ''
);

export const getOrderItemCurrentName = (item) => (
    normalizeText(item?.current_product_name)
    || normalizeText(item?.product?.name)
    || ''
);

export const getOrderItemCurrentSku = (item) => (
    normalizeText(item?.current_product_sku)
    || normalizeText(item?.product?.sku)
    || ''
);

export const getOrderItemActualSnapshotName = (item) => (
    normalizeText(item?.actual_snapshot_name)
    || normalizeText(item?.actual_product_name_snapshot)
    || ''
);

export const getOrderItemActualSnapshotSku = (item) => (
    normalizeText(item?.actual_snapshot_sku)
    || normalizeText(item?.actual_product_sku_snapshot)
    || ''
);

export const getOrderItemCurrentActualName = (item) => (
    normalizeText(item?.current_actual_product_name)
    || normalizeText(item?.actual_product?.name)
    || ''
);

export const getOrderItemCurrentActualSku = (item) => (
    normalizeText(item?.current_actual_product_sku)
    || normalizeText(item?.actual_product?.sku)
    || ''
);

export const hasOrderItemActualProductOverride = (item) => {
    if (typeof item?.has_actual_product_override === 'boolean') {
        return item.has_actual_product_override;
    }

    const actualProductId = Number(item?.actual_product_id || 0);
    const orderedProductId = Number(item?.product_id || 0);

    return actualProductId > 0 && actualProductId !== orderedProductId;
};

export const getOrderItemActualDisplayName = (item, fallback = '') => {
    if (!hasOrderItemActualProductOverride(item)) {
        return '';
    }

    const resolvedFallback = normalizeText(fallback)
        || (Number(item?.actual_product_id) ? `San pham #${item.actual_product_id}` : '');

    return (
        normalizeText(item?.actual_display_name)
        || getOrderItemCurrentActualName(item)
        || getOrderItemActualSnapshotName(item)
        || resolvedFallback
    );
};

export const getOrderItemActualDisplaySku = (item, fallback = '') => {
    if (!hasOrderItemActualProductOverride(item)) {
        return '';
    }

    return (
        normalizeText(item?.actual_display_sku)
        || getOrderItemCurrentActualSku(item)
        || getOrderItemActualSnapshotSku(item)
        || normalizeText(fallback)
    );
};

export const getOrderItemDisplayName = (item, fallback = '') => {
    const resolvedFallback = normalizeText(fallback)
        || (Number(item?.product_id) ? `San pham #${item.product_id}` : 'San pham');

    return (
        getOrderItemCurrentName(item)
        || normalizeText(item?.display_name)
        || getOrderItemSnapshotName(item)
        || normalizeText(item?.name)
        || resolvedFallback
    );
};

export const getOrderItemDisplaySku = (item, fallback = '') => (
    getOrderItemCurrentSku(item)
    || normalizeText(item?.display_sku)
    || getOrderItemSnapshotSku(item)
    || normalizeText(item?.sku)
    || normalizeText(fallback)
);

export const hasOrderItemSnapshotMismatch = (item) => {
    if (typeof item?.has_product_snapshot_mismatch === 'boolean') {
        return item.has_product_snapshot_mismatch;
    }

    const currentName = getOrderItemCurrentName(item);
    const currentSku = getOrderItemCurrentSku(item);
    const snapshotName = getOrderItemSnapshotName(item);
    const snapshotSku = getOrderItemSnapshotSku(item);

    if (!currentName && !currentSku) {
        return false;
    }

    return (currentName && snapshotName && !compareIdentity(currentName, snapshotName))
        || (currentSku && snapshotSku && !compareIdentity(currentSku, snapshotSku));
};
