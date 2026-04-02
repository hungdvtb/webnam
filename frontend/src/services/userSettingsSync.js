const STORAGE_AREAS = ['localStorage', 'sessionStorage'];
const CACHE_OWNER_KEY = '__user_settings_cache_owner_v1';
const FLUSH_DEBOUNCE_MS = 250;
const RETRY_FLUSH_MS = 1500;

const SYNCED_EXACT_KEYS = new Set([
    'activeAccountId',
    'activeSiteCode',
    'shipping_notification_settings_v1',
    'order_column_widths',
    'added_cost_price_migrated_form',
]);

const SYNCED_PREFIXES = [
    'product_',
    'order_',
    'shipment_',
    'inventory_',
    'lead_',
    'daily_sales_report_',
    'pending_order_list_',
];

const LOCAL_ONLY_EXACT_KEYS = new Set([
    'token',
    'user',
    'accounts_list',
    'ai_chat_id',
    'lead_attribution_snapshot',
    'lead_attribution_snapshot_session',
    'storefront-checkout-selection',
    'lead_list_view_state_v1',
    'lead_list_return_hint_v1',
]);

let prototypePatched = false;
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;
let activeSyncState = null;
let detachLifecycleListeners = null;

const createEmptySnapshot = () => ({
    localStorage: {},
    sessionStorage: {},
});

const normalizeBucket = (bucket) => {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
        return {};
    }

    return Object.entries(bucket).reduce((result, [key, value]) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) {
            return result;
        }

        result[normalizedKey] = String(value ?? '');
        return result;
    }, {});
};

const normalizeSnapshot = (payload) => ({
    localStorage: normalizeBucket(payload?.localStorage),
    sessionStorage: normalizeBucket(payload?.sessionStorage),
});

const getStorageArea = (storageName) => {
    if (typeof window === 'undefined') return null;

    try {
        return window[storageName];
    } catch (error) {
        console.error(`Unable to access ${storageName}`, error);
        return null;
    }
};

const resolveStorageName = (storage) => {
    if (typeof window === 'undefined' || !storage) return null;

    try {
        if (storage === window.localStorage) return 'localStorage';
        if (storage === window.sessionStorage) return 'sessionStorage';
    } catch (error) {
        return null;
    }

    return null;
};

const shouldSyncKey = (storageName, key) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || normalizedKey === CACHE_OWNER_KEY) {
        return false;
    }

    if (LOCAL_ONLY_EXACT_KEYS.has(normalizedKey)) {
        return false;
    }

    if (SYNCED_EXACT_KEYS.has(normalizedKey)) {
        return true;
    }

    return SYNCED_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix));
};

const withSyncSuspended = (callback) => {
    if (!activeSyncState) {
        return callback();
    }

    activeSyncState.suspendCount += 1;
    try {
        return callback();
    } finally {
        activeSyncState.suspendCount = Math.max(0, activeSyncState.suspendCount - 1);
    }
};

const collectStorageBucket = (storageName) => {
    const storage = getStorageArea(storageName);
    if (!storage) return {};

    const bucket = {};

    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!shouldSyncKey(storageName, key)) {
            continue;
        }

        const value = storage.getItem(key);
        if (value !== null) {
            bucket[key] = value;
        }
    }

    return bucket;
};

const collectStorageSnapshot = () => ({
    localStorage: collectStorageBucket('localStorage'),
    sessionStorage: collectStorageBucket('sessionStorage'),
});

const readCacheOwner = () => {
    const storage = getStorageArea('localStorage');
    if (!storage) return '';

    try {
        return storage.getItem(CACHE_OWNER_KEY) || '';
    } catch (error) {
        return '';
    }
};

const writeCacheOwner = (userId) => {
    const storage = getStorageArea('localStorage');
    if (!storage) return;

    try {
        storage.setItem(CACHE_OWNER_KEY, String(userId));
    } catch (error) {
        console.error('Unable to persist settings cache owner', error);
    }
};

const clearCacheOwner = () => {
    const storage = getStorageArea('localStorage');
    if (!storage) return;

    try {
        storage.removeItem(CACHE_OWNER_KEY);
    } catch (error) {
        console.error('Unable to clear settings cache owner', error);
    }
};

const mergeServerSnapshot = (serverSnapshot, localSnapshot, allowLocalFallback) => {
    const mergedSnapshot = createEmptySnapshot();

    STORAGE_AREAS.forEach((storageName) => {
        const remoteBucket = normalizeBucket(serverSnapshot?.[storageName]);
        const cacheBucket = allowLocalFallback ? normalizeBucket(localSnapshot?.[storageName]) : {};

        mergedSnapshot[storageName] = {
            ...cacheBucket,
            ...remoteBucket,
        };
    });

    return mergedSnapshot;
};

const diffSnapshots = (baseSnapshot, nextSnapshot) => {
    const patch = createEmptySnapshot();
    let hasChanges = false;

    STORAGE_AREAS.forEach((storageName) => {
        const currentBucket = normalizeBucket(baseSnapshot?.[storageName]);
        const nextBucket = normalizeBucket(nextSnapshot?.[storageName]);
        const keys = new Set([
            ...Object.keys(currentBucket),
            ...Object.keys(nextBucket),
        ]);

        keys.forEach((key) => {
            const currentValue = Object.prototype.hasOwnProperty.call(currentBucket, key)
                ? currentBucket[key]
                : undefined;
            const nextValue = Object.prototype.hasOwnProperty.call(nextBucket, key)
                ? nextBucket[key]
                : undefined;

            if (nextValue === undefined) {
                if (currentValue !== undefined) {
                    patch[storageName][key] = null;
                    hasChanges = true;
                }
                return;
            }

            if (currentValue !== nextValue) {
                patch[storageName][key] = nextValue;
                hasChanges = true;
            }
        });
    });

    return hasChanges ? patch : null;
};

const applySnapshotToStorage = (snapshot, { clearMissing = true } = {}) => {
    STORAGE_AREAS.forEach((storageName) => {
        const storage = getStorageArea(storageName);
        if (!storage) return;

        const nextBucket = normalizeBucket(snapshot?.[storageName]);

        if (clearMissing) {
            const existingBucket = collectStorageBucket(storageName);
            Object.keys(existingBucket).forEach((key) => {
                if (!Object.prototype.hasOwnProperty.call(nextBucket, key)) {
                    storage.removeItem(key);
                }
            });
        }

        Object.entries(nextBucket).forEach(([key, value]) => {
            if (storage.getItem(key) !== value) {
                storage.setItem(key, value);
            }
        });
    });
};

const hasPendingChanges = (pendingChanges) => STORAGE_AREAS.some(
    (storageName) => Object.keys(pendingChanges?.[storageName] || {}).length > 0
);

const pullPendingChanges = () => {
    if (!activeSyncState || !hasPendingChanges(activeSyncState.pendingChanges)) {
        return null;
    }

    const patch = activeSyncState.pendingChanges;
    activeSyncState.pendingChanges = createEmptySnapshot();
    return patch;
};

const mergePendingChanges = (patch) => {
    if (!activeSyncState || !patch) return;

    STORAGE_AREAS.forEach((storageName) => {
        const currentPendingBucket = activeSyncState.pendingChanges[storageName] || {};
        activeSyncState.pendingChanges[storageName] = {
            ...normalizeBucket(patch?.[storageName]),
            ...normalizeBucket(currentPendingBucket),
        };

        Object.entries(patch?.[storageName] || {}).forEach(([key, value]) => {
            if (value === null && !Object.prototype.hasOwnProperty.call(currentPendingBucket, key)) {
                activeSyncState.pendingChanges[storageName][key] = null;
            }
        });
    });
};

const scheduleFlush = (delayMs = FLUSH_DEBOUNCE_MS) => {
    if (!activeSyncState?.patchSettings) return;

    if (activeSyncState.flushTimer) {
        window.clearTimeout(activeSyncState.flushTimer);
    }

    activeSyncState.flushTimer = window.setTimeout(() => {
        flushPendingChanges();
    }, delayMs);
};

const flushPendingChanges = async () => {
    if (!activeSyncState?.patchSettings) {
        return;
    }

    if (activeSyncState.flushInFlight) {
        activeSyncState.flushQueued = true;
        return;
    }

    const patch = pullPendingChanges();
    if (!patch) {
        return;
    }

    activeSyncState.flushInFlight = true;
    if (activeSyncState.flushTimer) {
        window.clearTimeout(activeSyncState.flushTimer);
        activeSyncState.flushTimer = null;
    }

    try {
        const response = await activeSyncState.patchSettings(patch);
        activeSyncState.snapshot = normalizeSnapshot(response?.data);
        activeSyncState.lastError = null;
        writeCacheOwner(activeSyncState.userId);
    } catch (error) {
        console.error('Unable to sync user settings', error);
        activeSyncState.lastError = error;
        mergePendingChanges(patch);
        scheduleFlush(RETRY_FLUSH_MS);
    } finally {
        activeSyncState.flushInFlight = false;

        if (activeSyncState.flushQueued || hasPendingChanges(activeSyncState.pendingChanges)) {
            activeSyncState.flushQueued = false;
            scheduleFlush(activeSyncState.lastError ? RETRY_FLUSH_MS : FLUSH_DEBOUNCE_MS);
        }
    }
};

const handleStorageMutation = (storageName, key, value) => {
    if (!activeSyncState || activeSyncState.suspendCount > 0 || !shouldSyncKey(storageName, key)) {
        return;
    }

    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
        return;
    }

    if (value === null) {
        delete activeSyncState.snapshot[storageName][normalizedKey];
        activeSyncState.pendingChanges[storageName][normalizedKey] = null;
    } else {
        const normalizedValue = String(value);
        activeSyncState.snapshot[storageName][normalizedKey] = normalizedValue;
        activeSyncState.pendingChanges[storageName][normalizedKey] = normalizedValue;
    }

    if (normalizedKey === 'activeAccountId') {
        scheduleFlush(0);
        return;
    }

    scheduleFlush();
};

const ensureStoragePrototypePatched = () => {
    if (prototypePatched || typeof Storage === 'undefined') {
        return;
    }

    originalSetItem = Storage.prototype.setItem;
    originalRemoveItem = Storage.prototype.removeItem;
    originalClear = Storage.prototype.clear;

    Storage.prototype.setItem = function patchedSetItem(key, value) {
        originalSetItem.call(this, key, value);
        const storageName = resolveStorageName(this);
        if (storageName) {
            handleStorageMutation(storageName, key, value);
        }
    };

    Storage.prototype.removeItem = function patchedRemoveItem(key) {
        originalRemoveItem.call(this, key);
        const storageName = resolveStorageName(this);
        if (storageName) {
            handleStorageMutation(storageName, key, null);
        }
    };

    Storage.prototype.clear = function patchedClear() {
        const storageName = resolveStorageName(this);
        const keysToRemove = storageName ? Object.keys(collectStorageBucket(storageName)) : [];
        originalClear.call(this);

        if (storageName) {
            keysToRemove.forEach((key) => handleStorageMutation(storageName, key, null));
        }
    };

    prototypePatched = true;
};

const ensureLifecycleListeners = () => {
    if (detachLifecycleListeners || typeof window === 'undefined') {
        return;
    }

    const flushOnBackground = () => {
        if (document.visibilityState === 'hidden') {
            flushPendingChanges();
        }
    };
    const flushOnPageHide = () => {
        flushPendingChanges();
    };

    document.addEventListener('visibilitychange', flushOnBackground);
    window.addEventListener('pagehide', flushOnPageHide);

    detachLifecycleListeners = () => {
        document.removeEventListener('visibilitychange', flushOnBackground);
        window.removeEventListener('pagehide', flushOnPageHide);
        detachLifecycleListeners = null;
    };
};

export const bootstrapUserSettingsSync = async ({ userId, fetchSettings, patchSettings }) => {
    ensureStoragePrototypePatched();
    ensureLifecycleListeners();

    const normalizedUserId = String(userId);
    activeSyncState = {
        userId: normalizedUserId,
        patchSettings,
        snapshot: createEmptySnapshot(),
        pendingChanges: createEmptySnapshot(),
        flushTimer: null,
        flushInFlight: false,
        flushQueued: false,
        suspendCount: 0,
        lastError: null,
    };

    const cacheOwner = readCacheOwner();
    const allowLocalFallback = !cacheOwner || cacheOwner === normalizedUserId;
    const localSnapshot = collectStorageSnapshot();
    let serverSnapshot = createEmptySnapshot();
    let bootstrapSource = 'server';

    try {
        const response = await fetchSettings();
        serverSnapshot = normalizeSnapshot(response?.data);
    } catch (error) {
        console.error('Unable to fetch user settings from server, using local cache', error);
        bootstrapSource = 'local-cache';
    }

    if (!activeSyncState || activeSyncState.userId !== normalizedUserId) {
        return {
            source: 'cancelled',
            snapshot: createEmptySnapshot(),
        };
    }

    const mergedSnapshot = bootstrapSource === 'server'
        ? mergeServerSnapshot(serverSnapshot, localSnapshot, allowLocalFallback)
        : mergeServerSnapshot(createEmptySnapshot(), localSnapshot, allowLocalFallback);

    withSyncSuspended(() => {
        applySnapshotToStorage(mergedSnapshot, { clearMissing: true });
        writeCacheOwner(normalizedUserId);
    });

    activeSyncState.snapshot = mergedSnapshot;

    if (bootstrapSource === 'server') {
        const bootstrapPatch = diffSnapshots(serverSnapshot, mergedSnapshot);
        if (bootstrapPatch) {
            mergePendingChanges(bootstrapPatch);
            scheduleFlush(0);
        }
    }

    return {
        source: bootstrapSource,
        snapshot: mergedSnapshot,
    };
};

export const flushUserSettingsSync = async () => {
    await flushPendingChanges();
};

export const stopUserSettingsSync = () => {
    if (!activeSyncState) {
        return;
    }

    if (activeSyncState.flushTimer) {
        window.clearTimeout(activeSyncState.flushTimer);
    }

    activeSyncState = null;

    if (detachLifecycleListeners) {
        detachLifecycleListeners();
    }
};

export const clearSyncedUserSettingsCache = () => {
    withSyncSuspended(() => {
        STORAGE_AREAS.forEach((storageName) => {
            const storage = getStorageArea(storageName);
            if (!storage) return;

            Object.keys(collectStorageBucket(storageName)).forEach((key) => {
                storage.removeItem(key);
            });
        });

        clearCacheOwner();
    });
};
