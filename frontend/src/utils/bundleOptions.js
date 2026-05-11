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

export const cloneBundleOptionForCopy = (
    option,
    {
        createOptionId = createBundleOptionId,
        createEntryId = createBundleItemEntryId,
    } = {},
) => {
    const clonedOption = cloneBundleValue(option || {});
    const clonedItems = Array.isArray(clonedOption.items)
        ? clonedOption.items.map((item) => ({
            ...item,
            entry_id: createEntryId(),
        }))
        : [];

    return {
        ...clonedOption,
        id: createOptionId(),
        uid: '',
        bundle_option_uid: '',
        items: clonedItems,
    };
};

export const copyBundleOptionToTop = (
    options,
    sourceOptionId,
    factories = {},
) => {
    const currentOptions = Array.isArray(options) ? [...options] : [];
    const sourceOption = currentOptions.find((option) => option?.id === sourceOptionId);

    if (!sourceOption) {
        return {
            copiedOption: null,
            nextOptions: currentOptions,
        };
    }

    const copiedOption = cloneBundleOptionForCopy(sourceOption, factories);

    return {
        copiedOption,
        nextOptions: [copiedOption, ...currentOptions],
    };
};
