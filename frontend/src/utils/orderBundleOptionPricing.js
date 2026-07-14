const toMoneyNumber = (value, fallback = null) => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const calculateBundleItemsSubtotal = (items = []) => (
    (Array.isArray(items) ? items : []).reduce((total, item) => {
        const quantity = Math.max(1, Number(item?.quantity) || 1);
        return total + ((toMoneyNumber(item?.price, 0) || 0) * quantity);
    }, 0)
);

export const resolveBundleOptionEntryPrice = (entry = {}, items = entry?.bundle_items ?? entry?.items) => {
    const itemsSubtotal = calculateBundleItemsSubtotal(items);
    if (itemsSubtotal > 0) {
        return itemsSubtotal;
    }

    const fallbackCandidates = [
        entry?.bundle_option_discounted_price,
        entry?.discounted_price,
        entry?.bundle_option_total_price,
        entry?.total_price,
        entry?.subtotal,
        entry?.price,
    ];

    for (const candidate of fallbackCandidates) {
        const numericValue = toMoneyNumber(candidate);
        if (numericValue !== null) {
            return numericValue;
        }
    }

    return 0;
};
