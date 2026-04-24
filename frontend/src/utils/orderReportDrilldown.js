const ORDER_REPORT_SCOPE_STORAGE_PREFIX = 'order_list_report_scope';

const buildStorageKey = (key) => `${ORDER_REPORT_SCOPE_STORAGE_PREFIX}:${key}`;

const createScopeKey = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const saveOrderReportDrilldownScope = (scope) => {
    if (typeof window === 'undefined' || !scope || typeof scope !== 'object') {
        return '';
    }

    const key = createScopeKey();

    try {
        window.sessionStorage.setItem(
            buildStorageKey(key),
            JSON.stringify({
                ...scope,
                saved_at: new Date().toISOString(),
            }),
        );
        return key;
    } catch (error) {
        console.warn('Cannot persist order report drilldown scope.', error);
        return '';
    }
};

export const readOrderReportDrilldownScope = (key) => {
    if (typeof window === 'undefined') {
        return null;
    }

    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
        return null;
    }

    try {
        const rawValue = window.sessionStorage.getItem(buildStorageKey(normalizedKey));
        if (!rawValue) {
            return null;
        }

        const parsedValue = JSON.parse(rawValue);
        return parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)
            ? parsedValue
            : null;
    } catch (error) {
        console.warn('Cannot restore order report drilldown scope.', error);
        return null;
    }
};

export const removeOrderReportDrilldownScope = (key) => {
    if (typeof window === 'undefined') {
        return;
    }

    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
        return;
    }

    try {
        window.sessionStorage.removeItem(buildStorageKey(normalizedKey));
    } catch {
        // Ignore storage cleanup errors.
    }
};
