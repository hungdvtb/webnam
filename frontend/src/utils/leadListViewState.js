const LEAD_LIST_VIEW_STATE_KEY = 'lead_list_view_state_v1';
const LEAD_LIST_RETURN_HINT_KEY = 'lead_list_return_hint_v1';
const VIEW_STATE_TTL_MS = 10 * 60 * 1000;
const RETURN_HINT_TTL_MS = 2 * 60 * 1000;

const canUseSessionStorage = () => (
    typeof window !== 'undefined'
    && typeof window.sessionStorage !== 'undefined'
);

const readJson = (key) => {
    if (!canUseSessionStorage()) return null;

    try {
        const raw = window.sessionStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.error(`Failed to read sessionStorage key: ${key}`, error);
        return null;
    }
};

const writeJson = (key, value) => {
    if (!canUseSessionStorage()) return;

    try {
        window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Failed to write sessionStorage key: ${key}`, error);
    }
};

const removeKey = (key) => {
    if (!canUseSessionStorage()) return;

    try {
        window.sessionStorage.removeItem(key);
    } catch (error) {
        console.error(`Failed to remove sessionStorage key: ${key}`, error);
    }
};

export const readLeadListViewState = (viewKey) => {
    const payload = readJson(LEAD_LIST_VIEW_STATE_KEY);
    if (!payload || payload.viewKey !== viewKey) return null;
    if (Date.now() - Number(payload.savedAt || 0) > VIEW_STATE_TTL_MS) {
        removeKey(LEAD_LIST_VIEW_STATE_KEY);
        return null;
    }

    return payload.snapshot || null;
};

export const writeLeadListViewState = (viewKey, snapshot) => {
    writeJson(LEAD_LIST_VIEW_STATE_KEY, {
        viewKey,
        savedAt: Date.now(),
        snapshot,
    });
};

export const writeLeadListReturnHint = (viewKey, hint) => {
    writeJson(LEAD_LIST_RETURN_HINT_KEY, {
        viewKey,
        savedAt: Date.now(),
        hint,
    });
};

export const consumeLeadListReturnHint = (viewKey) => {
    const payload = readJson(LEAD_LIST_RETURN_HINT_KEY);
    if (!payload) return null;

    if (Date.now() - Number(payload.savedAt || 0) > RETURN_HINT_TTL_MS) {
        removeKey(LEAD_LIST_RETURN_HINT_KEY);
        return null;
    }

    if (payload.viewKey !== viewKey) return null;

    removeKey(LEAD_LIST_RETURN_HINT_KEY);
    return payload.hint || null;
};
