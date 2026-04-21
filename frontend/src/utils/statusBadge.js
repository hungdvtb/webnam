const DEFAULT_STATUS_BADGE_COLOR = '#475569';
const WHITE_RGB = { r: 255, g: 255, b: 255 };

const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

const parseHexColor = (value) => {
    const normalized = String(value || '').trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return null;

    const hex = normalized.length === 4
        ? normalized.slice(1).split('').map((char) => `${char}${char}`).join('')
        : normalized.slice(1);

    return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
    };
};

const parseRgbColor = (value) => {
    const normalized = String(value || '').trim();
    const matched = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (!matched) return null;

    const channels = matched[1]
        .split(',')
        .map((item) => Number.parseFloat(item.trim()))
        .filter((item) => Number.isFinite(item));

    if (channels.length < 3) return null;

    return {
        r: clampChannel(channels[0]),
        g: clampChannel(channels[1]),
        b: clampChannel(channels[2]),
    };
};

const parseColor = (value) => parseHexColor(value) || parseRgbColor(value);

const rgbToHex = ({ r, g, b }) => `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;

const getLinearChannel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
};

const getLuminance = ({ r, g, b }) => (
    (0.2126 * getLinearChannel(r))
    + (0.7152 * getLinearChannel(g))
    + (0.0722 * getLinearChannel(b))
);

const getContrastRatio = (foreground, background) => {
    const lighter = Math.max(getLuminance(foreground), getLuminance(background));
    const darker = Math.min(getLuminance(foreground), getLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
};

const darkenColor = ({ r, g, b }, factor = 0.88) => ({
    r: clampChannel(r * factor),
    g: clampChannel(g * factor),
    b: clampChannel(b * factor),
});

export const getStatusBadgeColor = (inputColor, fallbackColor = DEFAULT_STATUS_BADGE_COLOR) => {
    const baseColor = parseColor(inputColor) || parseColor(fallbackColor) || parseColor(DEFAULT_STATUS_BADGE_COLOR);
    let currentColor = baseColor;
    let attempts = 0;

    while (getContrastRatio(currentColor, WHITE_RGB) < 4.5 && attempts < 12) {
        currentColor = darkenColor(currentColor);
        attempts += 1;
    }

    return rgbToHex(currentColor);
};

export const getStatusBadgeStyle = (inputColor, fallbackColor = DEFAULT_STATUS_BADGE_COLOR) => {
    const backgroundColor = getStatusBadgeColor(inputColor, fallbackColor);
    return {
        backgroundColor,
        color: '#ffffff',
        borderColor: backgroundColor,
    };
};

export { DEFAULT_STATUS_BADGE_COLOR };
