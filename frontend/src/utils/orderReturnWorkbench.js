const ORDER_RETURN_WORKBENCH_STORAGE_KEY = 'order_return_workbench_v1';
const ORDER_RETURN_WORKBENCH_MAX_ITEMS = 500;

const normalizeOrderIds = (ids = []) => {
    const seen = new Set();

    return (Array.isArray(ids) ? ids : [])
        .map((id) => Number.parseInt(String(id ?? '').trim(), 10))
        .filter((id) => Number.isInteger(id) && id > 0)
        .filter((id) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .slice(0, ORDER_RETURN_WORKBENCH_MAX_ITEMS);
};

const resolveWorkbenchStorageKey = () => {
    if (typeof window === 'undefined') {
        return ORDER_RETURN_WORKBENCH_STORAGE_KEY;
    }

    const activeAccountId = window.localStorage.getItem('activeAccountId') || 'default';
    const activeSiteCode = window.localStorage.getItem('activeSiteCode') || 'default';

    return `${ORDER_RETURN_WORKBENCH_STORAGE_KEY}::${activeAccountId}::${activeSiteCode}`;
};

export const parseQuickSelectCodes = (value = '') => {
    const seen = new Set();

    return String(value || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((code) => {
            const normalized = code.toLocaleLowerCase('vi');
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });
};

export const loadOrderReturnWorkbenchOrderIds = () => {
    if (typeof window === 'undefined') return [];

    try {
        const rawValue = window.localStorage.getItem(resolveWorkbenchStorageKey());
        if (!rawValue) return [];

        const parsed = JSON.parse(rawValue);
        return normalizeOrderIds(parsed?.order_ids || parsed);
    } catch {
        return [];
    }
};

export const saveOrderReturnWorkbenchOrderIds = (ids = []) => {
    if (typeof window === 'undefined') return [];

    const normalizedIds = normalizeOrderIds(ids);
    window.localStorage.setItem(resolveWorkbenchStorageKey(), JSON.stringify({
        order_ids: normalizedIds,
        updated_at: Date.now(),
    }));

    return normalizedIds;
};

export const addOrderIdsToReturnWorkbench = (ids = []) => {
    const currentIds = loadOrderReturnWorkbenchOrderIds();
    return saveOrderReturnWorkbenchOrderIds([...currentIds, ...ids]);
};

export const removeOrderIdsFromReturnWorkbench = (ids = []) => {
    const idsToRemove = new Set(normalizeOrderIds(ids));
    const currentIds = loadOrderReturnWorkbenchOrderIds();

    return saveOrderReturnWorkbenchOrderIds(
        currentIds.filter((id) => !idsToRemove.has(id))
    );
};

export const clearOrderReturnWorkbench = () => {
    return saveOrderReturnWorkbenchOrderIds([]);
};
