import { useCallback, useEffect, useState } from 'react';
import { aiApi } from '../services/api';

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

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const response = await aiApi.getStatus();
            setStatus({
                ...defaultStatus,
                ...(response.data || {}),
            });
        } catch {
            setStatus(defaultStatus);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (autoFetch) {
            refresh();
        }
    }, [autoFetch, refresh]);

    const disabledReason = !status.configured
        ? 'Chưa cấu hình API key Gemini trong Cài đặt web.'
        : !status.enabled
            ? 'AI đang tạm tắt trong Cài đặt web.'
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
