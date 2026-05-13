export const LEAD_REALTIME_EVENT = 'lead:realtime';
export const LEAD_NOTIFICATION_SETTINGS_EVENT = 'lead:notification-settings';

const SOUNDED_LEAD_IDS_KEY = 'notification_sounded_lead_ids_v1';
const MAX_SOUNDED_LEAD_IDS = 300;

export const createDefaultLeadNotificationSettings = () => ({
    enabled: true,
    useDefault: true,
    customAudioUrl: '',
    customAudioName: '',
    hasCustomAudio: false,
});

export const normalizeLeadNotificationSettings = (settings) => {
    const customAudioUrl = typeof settings?.custom_audio_url === 'string'
        ? settings.custom_audio_url
        : typeof settings?.customAudioUrl === 'string'
            ? settings.customAudioUrl
            : '';
    const customAudioName = typeof settings?.custom_audio_name === 'string'
        ? settings.custom_audio_name
        : typeof settings?.customAudioName === 'string'
            ? settings.customAudioName
            : '';
    const hasCustomAudio = settings?.has_custom_audio === true
        || settings?.hasCustomAudio === true
        || Boolean(customAudioUrl);

    return {
        enabled: settings?.enabled !== false,
        useDefault: hasCustomAudio ? settings?.use_default !== false && settings?.useDefault !== false : true,
        customAudioUrl,
        customAudioName,
        hasCustomAudio,
    };
};

export const normalizeRealtimeCursor = (payload = {}) => {
    const cursor = payload?.realtime_cursor || {};

    return {
        changedAt: String(cursor.changed_at || payload?.latest_changed_at || '').trim(),
        id: Number(cursor.id || payload?.latest_id || 0) || 0,
    };
};

const readSoundedLeadIds = () => {
    if (typeof window === 'undefined') return [];

    try {
        const parsed = JSON.parse(window.localStorage.getItem(SOUNDED_LEAD_IDS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter(Boolean) : [];
    } catch {
        return [];
    }
};

export const rememberSoundedLeadIds = (leadIds = []) => {
    if (typeof window === 'undefined') return;

    const normalizedIds = Array.from(new Set(
        (Array.isArray(leadIds) ? leadIds : [])
            .map((id) => Number(id))
            .filter(Boolean)
    ));
    if (normalizedIds.length === 0) return;

    const existingIds = readSoundedLeadIds();
    const nextIds = Array.from(new Set([...normalizedIds, ...existingIds])).slice(0, MAX_SOUNDED_LEAD_IDS);
    window.localStorage.setItem(SOUNDED_LEAD_IDS_KEY, JSON.stringify(nextIds));
};

export const getUnsoundedLeadItems = (items = []) => {
    const soundedIds = new Set(readSoundedLeadIds());

    return (Array.isArray(items) ? items : [])
        .filter((item) => item?.id && !soundedIds.has(Number(item.id)));
};

export const shouldPlayLeadSound = (lead) => Boolean(lead?.id) && lead?.is_draft !== true;

export const dispatchLeadRealtimeEvent = (payload) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LEAD_REALTIME_EVENT, { detail: payload }));
};

export const dispatchLeadNotificationSettingsEvent = (settings) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LEAD_NOTIFICATION_SETTINGS_EVENT, { detail: settings }));
};

export const isAutoplayBlockedError = (error) => {
    const signature = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
    return signature.includes('notallowed')
        || signature.includes('not allowed')
        || signature.includes('gesture')
        || signature.includes('user activation')
        || signature.includes('autoplay');
};

export const playDefaultLeadNotificationSound = async (audioContextRef) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = audioContextRef.current || new AudioContextCtor();
    audioContextRef.current = context;

    if (context.state === 'suspended') {
        await context.resume();
    }

    const playTone = (startAt, frequency, duration = 0.16, peakGain = 0.36) => {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startAt);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.92, startAt + duration);
        gainNode.gain.setValueAtTime(0.0001, startAt);
        gainNode.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.018);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
        oscillator.connect(gainNode);
        gainNode.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.02);
    };

    const startAt = context.currentTime + 0.01;
    playTone(startAt, 1318.51, 0.15, 0.38);
    playTone(startAt + 0.19, 1760, 0.18, 0.42);
};
