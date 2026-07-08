import { calculateRoundedImportCostLineTotal } from './money.js';

const cloneBundleValue = (value) => {
    if (Array.isArray(value)) {
        return value.map(cloneBundleValue);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [key, cloneBundleValue(nestedValue)])
        );
    }

    return value;
};

export const createBundleOptionId = () => (
    `bundle-option-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

export const createBundleItemEntryId = () => (
    `bundle-item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

const buildCopiedBundleOptionTitle = (title) => {
    const normalizedTitle = String(title ?? '').trim();
    return normalizedTitle ? `Copy ${normalizedTitle}` : 'Copy';
};

export const resolveBundleImportCostValue = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') {
            continue;
        }

        const normalizedValue = calculateRoundedImportCostLineTotal(value, 1);
        if (Number.isFinite(normalizedValue)) {
            return normalizedValue;
        }
    }

    return '';
};

export const calculateBundleOptionImportCostTotal = (option) => {
    const items = Array.isArray(option?.items) ? option.items : [];

    return items.reduce((total, item) => (
        total + calculateRoundedImportCostLineTotal(item?.cost_price, item?.quantity)
    ), 0);
};

export const cloneBundleOptionForCopy = (
    option,
    {
        createOptionId = createBundleOptionId,
        createEntryId = createBundleItemEntryId,
        createOptionUid = createBundleOptionId,
    } = {},
) => {
    const clonedOption = cloneBundleValue(option || {});
    const optionId = createOptionId();
    const optionUid = createOptionUid();
    const clonedItems = Array.isArray(clonedOption.items)
        ? clonedOption.items.map((item) => {
            const clonedItem = { ...item };
            const productId = clonedItem.product_id ?? clonedItem.id ?? null;

            return {
                ...clonedItem,
                id: productId,
                product_id: productId,
                entry_id: createEntryId(),
            };
        })
        : [];

    return {
        ...clonedOption,
        id: optionId,
        uid: optionUid,
        bundle_option_uid: optionUid,
        title: buildCopiedBundleOptionTitle(clonedOption.title),
        items: clonedItems,
    };
};

export const copyBundleOptionBelowSource = (
    options,
    sourceOptionId,
    factories = {},
) => {
    const currentOptions = Array.isArray(options) ? [...options] : [];
    const sourceIndex = currentOptions.findIndex((option) => option?.id === sourceOptionId);
    const sourceOption = sourceIndex >= 0 ? currentOptions[sourceIndex] : null;

    if (!sourceOption) {
        return {
            copiedOption: null,
            nextOptions: currentOptions,
        };
    }

    const copiedOption = cloneBundleOptionForCopy(sourceOption, factories);

    return {
        copiedOption,
        nextOptions: [
            ...currentOptions.slice(0, sourceIndex + 1),
            copiedOption,
            ...currentOptions.slice(sourceIndex + 1),
        ],
    };
};
