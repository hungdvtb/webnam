import { useEffect, useState } from 'react';
import { userSettingsApi } from '../services/api';
import {
    bootstrapUserSettingsSync,
    stopUserSettingsSync,
} from '../services/userSettingsSync';

const useUserSettingsBootstrap = (user) => {
    const [ready, setReady] = useState(() => !user?.id);
    const [source, setSource] = useState('server');

    useEffect(() => {
        let cancelled = false;

        if (!user?.id) {
            stopUserSettingsSync();
            setReady(true);
            setSource('server');
            return undefined;
        }

        setReady(false);

        const bootstrap = async () => {
            const result = await bootstrapUserSettingsSync({
                userId: user.id,
                fetchSettings: () => userSettingsApi.get(),
                patchSettings: (payload) => userSettingsApi.update(payload),
            });

            if (cancelled) {
                stopUserSettingsSync();
                return;
            }

            setSource(result.source);
            setReady(true);
        };

        bootstrap();

        return () => {
            cancelled = true;
            stopUserSettingsSync();
        };
    }, [user?.id]);

    return { ready, source };
};

export default useUserSettingsBootstrap;
