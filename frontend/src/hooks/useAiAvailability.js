import { useCallback, useEffect, useRef, useState } from 'react';
import { aiApi, isRetryableNetworkError } from '../services/api';

const defaultStatus = {
    provider: 'gemini',
    enabled: false,
    configured: false,
    available: false,
    model: 'gemini-2.5-flash',
    key_source: null,
};

export const useAiAvailability = (autoFetch = true) => {
    const [status, setStatus] = useState(defaultStatus);
    const [loading, setLoading] = useState(autoFetch);
    const retryTimeoutRef = useRef(null);

    const clearScheduledRefresh = useCallback(() => {
        if (retryTimeoutRef.current) {
            window.clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
    }, []);

    const refresh = useCallback(async ({ silent = false } = {}) => {
        clearScheduledRefresh();

        if (!silent) {
            setLoading(true);
        }

        try {
            const response = await aiApi.getStatus();
            setStatus({
                ...defaultStatus,
                ...(response.data || {}),
            });
        } catch (error) {
            if (isRetryableNetworkError(error)) {
                retryTimeoutRef.current = window.setTimeout(() => {
                    refresh({ silent: true });
                }, 3000);
            } else {
                setStatus(defaultStatus);
            }
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [clearScheduledRefresh]);

    useEffect(() => {
        if (!autoFetch) {
            return undefined;
        }

        refresh();

        return () => {
            clearScheduledRefresh();
        };
    }, [autoFetch, clearScheduledRefresh, refresh]);

    useEffect(() => {
        const handleOnline = () => {
            refresh({ silent: true });
        };

        window.addEventListener('online', handleOnline);

        return () => {
            window.removeEventListener('online', handleOnline);
        };
    }, [refresh]);

    const disabledReason = !status.configured
        ? 'Chua cau hinh API key Gemini trong Cai dat web.'
        : !status.enabled
            ? 'AI dang tam tat trong Cai dat web.'
            : '';

    return {
        status,
        loading,
        available: Boolean(status.available),
        disabledReason,
        refresh,
    };
};

export default useAiAvailability;
