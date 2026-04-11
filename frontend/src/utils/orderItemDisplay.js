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

export const getOrderItemDisplayName = (item, fallback = '') => {
    const resolvedFallback = normalizeText(fallback)
        || (Number(item?.product_id) ? `Sản phẩm #${item.product_id}` : 'Sản phẩm');

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
