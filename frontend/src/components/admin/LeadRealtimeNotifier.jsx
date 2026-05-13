import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { leadApi } from '../../services/api';
import { ACTIVE_ACCOUNT_CHANGED_EVENT, readActiveAccountId } from '../../utils/activeAccount';
import {
    createDefaultLeadNotificationSettings,
    dispatchLeadNotificationSettingsEvent,
    dispatchLeadRealtimeEvent,
    getUnsoundedLeadItems,
    isAutoplayBlockedError,
    LEAD_NOTIFICATION_SETTINGS_EVENT,
    normalizeLeadNotificationSettings,
    normalizeRealtimeCursor,
    playDefaultLeadNotificationSound,
    rememberSoundedLeadIds,
    shouldPlayLeadSound,
} from '../../utils/leadRealtimeNotifications';

const POLL_DELAY_MS = 2000;
const FAST_POLL_DELAY_MS = 350;
const ERROR_POLL_DELAY_MS = 5000;

const LeadRealtimeNotifier = ({ enabled = true }) => {
    const { user } = useAuth();
    const { showToast } = useUI();
    const location = useLocation();
    const [settings, setSettings] = useState(() => createDefaultLeadNotificationSettings());
    const [ready, setReady] = useState(false);
    const [audioReady, setAudioReady] = useState(false);
    const [activeAccountId, setActiveAccountId] = useState(() => readActiveAccountId());

    const cursorRef = useRef({ changedAt: '', id: 0 });
    const requestInFlightRef = useRef(false);
    const audioElementRef = useRef(null);
    const audioContextRef = useRef(null);
    const queuedSoundRef = useRef(false);
    const settingsRef = useRef(settings);

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    const primeAudio = useCallback(async ({ userInitiated = false, force = false } = {}) => {
        const currentSettings = settingsRef.current;
        if (typeof window === 'undefined' || (!currentSettings.enabled && !force)) return false;

        if (!currentSettings.useDefault && currentSettings.customAudioUrl) {
            const audio = audioElementRef.current || new Audio();
            audioElementRef.current = audio;
            audio.preload = 'auto';

            if (audio.src !== currentSettings.customAudioUrl) {
                audio.src = currentSettings.customAudioUrl;
                audio.load?.();
            }

            if (!userInitiated) return true;

            try {
                audio.currentTime = 0;
                await audio.play();
                audio.pause();
                audio.currentTime = 0;
                return true;
            } catch (error) {
                if (!isAutoplayBlockedError(error)) {
                    console.error('Failed to unlock lead notification audio', error);
                }
                return false;
            }
        }

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return false;

        const context = audioContextRef.current || new AudioContextCtor();
        audioContextRef.current = context;

        if (context.state === 'running') return true;
        if (!userInitiated) return false;

        try {
            await context.resume();
            return context.state === 'running';
        } catch (error) {
            if (!isAutoplayBlockedError(error)) {
                console.error('Failed to unlock default lead notification audio', error);
            }
            return false;
        }
    }, []);

    const playLeadSound = useCallback(async ({ userInitiated = false, force = false } = {}) => {
        const currentSettings = settingsRef.current;

        if (!currentSettings.enabled && !force) {
            queuedSoundRef.current = false;
            return false;
        }

        if (!userInitiated && !audioReady) {
            queuedSoundRef.current = true;
            return false;
        }

        try {
            if (!currentSettings.useDefault && currentSettings.customAudioUrl) {
                const audio = audioElementRef.current || new Audio();
                audioElementRef.current = audio;
                audio.preload = 'auto';

                if (audio.src !== currentSettings.customAudioUrl) {
                    audio.src = currentSettings.customAudioUrl;
                    audio.load?.();
                }

                audio.currentTime = 0;
                await audio.play();
                queuedSoundRef.current = false;
                return true;
            }

            const unlocked = await primeAudio({ userInitiated, force });
            if (!unlocked) {
                queuedSoundRef.current = true;
                return false;
            }

            await playDefaultLeadNotificationSound(audioContextRef);
            queuedSoundRef.current = false;
            return true;
        } catch (error) {
            if (isAutoplayBlockedError(error)) {
                queuedSoundRef.current = true;
                return false;
            }

            console.error('Failed to play lead notification sound', error);
            return false;
        }
    }, [audioReady, primeAudio]);

    const handleEnableAudio = useCallback(async () => {
        if (!settingsRef.current.enabled) {
            try {
                const response = await leadApi.updateNotificationSettings({
                    enabled: 1,
                    use_default: settingsRef.current.useDefault ? 1 : 0,
                });
                const nextSettings = normalizeLeadNotificationSettings(response.data?.settings);
                setSettings(nextSettings);
                dispatchLeadNotificationSettingsEvent(nextSettings);
            } catch (error) {
                console.error('Failed to enable lead notification sound', error);
            }
        }

        const unlocked = await playLeadSound({ userInitiated: true, force: true });
        setAudioReady(unlocked);

        if (unlocked) {
            queuedSoundRef.current = false;
            showToast({ message: 'Đã bật âm báo đơn mới.', type: 'success', duration: 1800 });
        } else {
            showToast({ message: 'Trình duyệt vẫn đang chặn âm thanh. Hãy bấm lại nút bật âm báo.', type: 'warning', duration: 2600 });
        }
    }, [playLeadSound, showToast]);

    useEffect(() => {
        if (!enabled || !user?.id || !settings.enabled || audioReady) return undefined;

        const unlockAudio = async () => {
            const unlocked = await primeAudio({ userInitiated: true });
            setAudioReady(unlocked);

            if (unlocked && queuedSoundRef.current) {
                queuedSoundRef.current = false;
                window.setTimeout(() => {
                    playLeadSound({ userInitiated: true, force: true });
                }, 0);
            }
        };

        window.addEventListener('pointerdown', unlockAudio, true);
        window.addEventListener('keydown', unlockAudio, true);

        return () => {
            window.removeEventListener('pointerdown', unlockAudio, true);
            window.removeEventListener('keydown', unlockAudio, true);
        };
    }, [audioReady, enabled, playLeadSound, primeAudio, settings.enabled, user?.id]);

    useEffect(() => {
        const handleSettingsUpdated = (event) => {
            setSettings(normalizeLeadNotificationSettings(event.detail));
            setAudioReady(false);
            queuedSoundRef.current = false;
        };

        window.addEventListener(LEAD_NOTIFICATION_SETTINGS_EVENT, handleSettingsUpdated);
        return () => window.removeEventListener(LEAD_NOTIFICATION_SETTINGS_EVENT, handleSettingsUpdated);
    }, []);

    useEffect(() => {
        const handleActiveAccountChanged = (event) => {
            setActiveAccountId(String(event.detail?.accountId || readActiveAccountId()).trim());
        };

        window.addEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
        window.addEventListener('storage', handleActiveAccountChanged);
        return () => {
            window.removeEventListener(ACTIVE_ACCOUNT_CHANGED_EVENT, handleActiveAccountChanged);
            window.removeEventListener('storage', handleActiveAccountChanged);
        };
    }, []);

    useEffect(() => {
        if (!enabled || !user?.id || !activeAccountId) {
            setReady(false);
            cursorRef.current = { changedAt: '', id: 0 };
            return undefined;
        }

        let disposed = false;
        setReady(false);
        cursorRef.current = { changedAt: '', id: 0 };

        const initialize = async () => {
            try {
                const [notificationResponse, realtimeResponse] = await Promise.allSettled([
                    leadApi.getNotifications(),
                    leadApi.realtime({ init: 1 }),
                ]);

                if (disposed) return;

                if (notificationResponse.status === 'fulfilled') {
                    setSettings(normalizeLeadNotificationSettings(notificationResponse.value.data?.settings));
                }

                if (realtimeResponse.status === 'fulfilled') {
                    cursorRef.current = normalizeRealtimeCursor(realtimeResponse.value.data);
                }

                setReady(true);
            } catch (error) {
                if (!disposed) {
                    console.error('Failed to initialize lead realtime notifier', error);
                    setReady(true);
                }
            }
        };

        initialize();

        return () => {
            disposed = true;
        };
    }, [activeAccountId, enabled, user?.id]);

    useEffect(() => {
        if (!enabled || !ready || !user?.id || !activeAccountId) return undefined;

        let disposed = false;
        let timeoutId = null;

        const scheduleNextPoll = (delay = POLL_DELAY_MS) => {
            if (disposed) return;
            timeoutId = window.setTimeout(pollRealtime, delay);
        };

        const pollRealtime = async () => {
            if (requestInFlightRef.current) {
                scheduleNextPoll();
                return;
            }

            requestInFlightRef.current = true;
            let nextDelay = POLL_DELAY_MS;

            try {
                const cursor = cursorRef.current;
                const response = await leadApi.realtime(
                    cursor.changedAt
                        ? { after_changed_at: cursor.changedAt, after_id: cursor.id || 0 }
                        : { init: 1 }
                );

                if (disposed) return;

                const payload = response.data || {};
                const nextCursor = normalizeRealtimeCursor(payload);
                if (nextCursor.changedAt || nextCursor.id) {
                    cursorRef.current = nextCursor;
                }

                dispatchLeadRealtimeEvent(payload);

                const incoming = Array.isArray(payload.items) ? payload.items : [];
                const soundItems = getUnsoundedLeadItems(incoming.filter(shouldPlayLeadSound));

                if (soundItems.length > 0) {
                    rememberSoundedLeadIds(soundItems.map((lead) => lead.id));
                    await playLeadSound();

                    showToast({
                        message: soundItems.length === 1
                            ? 'Có 1 đơn mới vừa vào bảng xử lý lead.'
                            : `Có ${soundItems.length} đơn mới vừa vào bảng xử lý lead.`,
                        type: 'info',
                        duration: 2600,
                    });
                }

                if (payload.has_more === true) {
                    nextDelay = FAST_POLL_DELAY_MS;
                }
            } catch (error) {
                console.error('Lead realtime notifier polling failed', error);
                nextDelay = ERROR_POLL_DELAY_MS;
            } finally {
                requestInFlightRef.current = false;
                scheduleNextPoll(nextDelay);
            }
        };

        pollRealtime();

        return () => {
            disposed = true;
            requestInFlightRef.current = false;
            if (timeoutId) window.clearTimeout(timeoutId);
        };
    }, [activeAccountId, enabled, playLeadSound, ready, showToast, user?.id]);

    useEffect(() => () => {
        audioElementRef.current?.pause?.();
    }, []);

    const isLeadBoardRoute = location.pathname.startsWith('/admin/leads')
        || location.pathname.startsWith('/admin/pending-orders');

    if (!enabled || !user?.id || !settings.enabled || audioReady || isLeadBoardRoute) {
        return null;
    }

    return (
        <button
            type="button"
            onClick={handleEnableAudio}
            className="fixed bottom-5 right-5 z-[90] inline-flex min-h-11 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 py-2.5 text-[12px] font-black uppercase tracking-[0.08em] text-primary shadow-2xl transition-all hover:border-primary/30 hover:bg-primary hover:text-white"
            title="Cho phép trình duyệt phát âm báo khi có đơn mới"
        >
            <span className="material-symbols-outlined text-[18px]">notifications_active</span>
            Bật âm báo đơn mới
        </button>
    );
};

export default LeadRealtimeNotifier;
