const normalizeKey = (value) => String(value ?? '').trim();

const readSetupItems = (store, namespace, setupKey) => {
    const normalizedNamespace = normalizeKey(namespace);
    const normalizedSetupKey = normalizeKey(setupKey);
    const namespaceStore = store?.[normalizedNamespace];
    const items = namespaceStore?.[normalizedSetupKey];

    return Array.isArray(items) ? items : [];
};

const cloneSetupItems = (items = []) => (
    (Array.isArray(items) ? items : []).map((item) => (
        item && typeof item === 'object' && !Array.isArray(item)
            ? { ...item }
            : item
    ))
);

export const findProductQuickSetupItems = (store = {}, namespace = '', setupKey = '') => {
    const normalizedNamespace = normalizeKey(namespace);
    const normalizedSetupKey = normalizeKey(setupKey);

    if (!normalizedSetupKey || !store || typeof store !== 'object' || Array.isArray(store)) {
        return { items: [], sourceNamespace: '' };
    }

    const exactItems = readSetupItems(store, normalizedNamespace, normalizedSetupKey);
    if (exactItems.length > 0) {
        return { items: exactItems, sourceNamespace: normalizedNamespace };
    }

    const fallback = Object.keys(store)
        .filter((candidateNamespace) => candidateNamespace !== normalizedNamespace)
        .map((candidateNamespace) => ({
            namespace: candidateNamespace,
            items: readSetupItems(store, candidateNamespace, normalizedSetupKey),
        }))
        .filter((candidate) => candidate.items.length > 0)
        .sort((left, right) => (
            right.items.length - left.items.length
            || left.namespace.localeCompare(right.namespace)
        ))[0];

    return fallback
        ? { items: fallback.items, sourceNamespace: fallback.namespace }
        : { items: [], sourceNamespace: '' };
};

export const copyProductQuickSetupItemsToNamespace = (store = {}, namespace = '', setupKey = '', items = []) => {
    const normalizedNamespace = normalizeKey(namespace);
    const normalizedSetupKey = normalizeKey(setupKey);
    const clonedItems = cloneSetupItems(items);

    if (!normalizedNamespace || !normalizedSetupKey || clonedItems.length === 0) {
        return store;
    }

    return {
        ...(store && typeof store === 'object' && !Array.isArray(store) ? store : {}),
        [normalizedNamespace]: {
            ...(store?.[normalizedNamespace] || {}),
            [normalizedSetupKey]: clonedItems,
        },
    };
};
