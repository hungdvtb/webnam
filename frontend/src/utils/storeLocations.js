const parseMaybeJson = (value) => {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const stripDiacritics = (value = '') => String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (character) => (character === 'đ' ? 'd' : 'D'));

export const normalizePhoneHref = (value) => {
    const trimmed = String(value || '').trim();

    if (!trimmed) {
        return '';
    }

    if (trimmed.toLowerCase().startsWith('tel:')) {
        return trimmed;
    }

    const sanitized = trimmed.replace(/[^\d+]/g, '');
    return sanitized ? `tel:${sanitized}` : '';
};

const slugify = (value = '') => stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const createMapsQuery = (store = {}) => [store.name, store.address]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');

const createMapsSearchUrl = (store = {}) => {
    const providedLink = String(store.googleMapsLink || '').trim();

    if (providedLink) {
        return providedLink;
    }

    const query = createMapsQuery(store);
    return query
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
        : '';
};

const createDirectionsUrl = (store = {}) => {
    const query = createMapsQuery(store);

    if (query) {
        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
    }

    return createMapsSearchUrl(store);
};

const createEmbedUrl = (store = {}) => {
    const query = createMapsQuery(store);

    return query
        ? `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
        : '';
};

export const normalizeStoreLocations = (value) => {
    const parsed = parseMaybeJson(value);

    return parsed
        .map((item, index) => {
            const name = String(item?.name || item?.title || '').trim() || `Cửa hàng ${index + 1}`;
            const address = String(item?.address || '').trim();
            const hotline = String(item?.hotline || item?.phone || '').trim();
            const email = String(item?.email || '').trim();
            const openingHours = String(item?.opening_hours || item?.hours || '').trim();
            const googleMapsLink = String(item?.google_maps_link || item?.mapLink || '').trim();
            const imageUrl = String(item?.image_url || item?.imageUrl || '').trim();
            const note = String(item?.note || '').trim();
            const rawOrder = Number(item?.order ?? item?.sort_order ?? (index + 1));
            const order = Number.isFinite(rawOrder) && rawOrder > 0 ? rawOrder : (index + 1);
            const baseSlug = slugify(item?.slug || name || `store-${index + 1}`) || `store-${index + 1}`;
            const anchorId = `store-${baseSlug}-${index + 1}`;

            const normalizedStore = {
                id: String(item?.id || anchorId),
                anchorId,
                slug: baseSlug,
                name,
                address,
                hotline,
                phoneHref: normalizePhoneHref(hotline),
                email,
                openingHours,
                googleMapsLink,
                imageUrl,
                note,
                isActive: item?.is_active === undefined ? true : Boolean(item.is_active),
                order,
            };

            return {
                ...normalizedStore,
                mapsSearchUrl: createMapsSearchUrl(normalizedStore),
                directionsUrl: createDirectionsUrl(normalizedStore),
                mapEmbedUrl: createEmbedUrl(normalizedStore),
            };
        })
        .sort((firstStore, secondStore) => firstStore.order - secondStore.order)
        .map((store, index) => ({
            ...store,
            order: index + 1,
        }));
};

export const getActiveStoreLocations = (value) => normalizeStoreLocations(value)
    .filter((store) => store.isActive);

export const getPrimaryStoreLocation = (value) => {
    const activeStores = getActiveStoreLocations(value);

    if (activeStores.length > 0) {
        return activeStores[0];
    }

    const stores = normalizeStoreLocations(value);
    return stores[0] || null;
};
