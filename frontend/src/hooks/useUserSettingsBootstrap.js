import { useEffect, useState } from 'react';
import { userSettingsApi } from '../services/api';
import {
    bootstrapUserSettingsSync,
    stopUserSettingsSync,
} from '../services/userSettingsSync';

const useUserSettingsBootstrap = (user) => {
    const userId = user?.id ?? null;
    // Ready is tied to the user whose settings were loaded. A plain boolean started as `true`
    // before the user was known, so pages rendered once, unmounted while settings loaded, then mounted again.
    const [readyUserId, setReadyUserId] = useState(null);
    const [source, setSource] = useState('server');

    useEffect(() => {
        let cancelled = false;

        if (!userId) {
            stopUserSettingsSync();
            setSource('server');
            return undefined;
        }

        const bootstrap = async () => {
            const result = await bootstrapUserSettingsSync({
                userId,
                fetchSettings: () => userSettingsApi.get(),
                patchSettings: (payload) => userSettingsApi.update(payload),
            });

            if (cancelled) {
                stopUserSettingsSync();
                return;
            }

            setSource(result.source);
            setReadyUserId(userId);
        };

        bootstrap();

        return () => {
            cancelled = true;
            stopUserSettingsSync();
        };
    }, [userId]);

    return { ready: !userId || readyUserId === userId, source };
};

export default useUserSettingsBootstrap;
