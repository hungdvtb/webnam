export const DEFAULT_MANUAL_ORDER_SOURCE = 'FB';
export const UNKNOWN_ORDER_SOURCE = 'Chua ro';

export const ORDER_SOURCE_OPTIONS = [
    { value: 'FB', label: 'Facebook' },
    { value: 'GG', label: 'Google' },
    { value: 'Website', label: 'Website' },
    { value: 'Zalo', label: 'Zalo' },
    { value: 'Tiktok', label: 'Tiktok' },
    { value: 'Khach cu', label: 'Kh\u00e1ch c\u0169' },
    { value: 'Chua ro', label: 'Ch\u01b0a r\u00f5' },
];

const ORDER_SOURCE_VALUE_SET = new Set(ORDER_SOURCE_OPTIONS.map((option) => option.value));

const ORDER_SOURCE_ALIASES = new Map([
    ['fb', 'FB'],
    ['facebook', 'FB'],
    ['facebook ads', 'FB'],
    ['facebook ad', 'FB'],
    ['fb ads', 'FB'],
    ['meta', 'FB'],
    ['messenger', 'FB'],
    ['gg', 'GG'],
    ['google', 'GG'],
    ['google ads', 'GG'],
    ['google ad', 'GG'],
    ['googleads', 'GG'],
    ['adwords', 'GG'],
    ['website', 'Website'],
    ['web', 'Website'],
    ['site', 'Website'],
    ['direct', 'Website'],
    ['website order', 'Website'],
    ['website lead', 'Website'],
    ['zalo', 'Zalo'],
    ['zalo oa', 'Zalo'],
    ['tiktok', 'Tiktok'],
    ['tik tok', 'Tiktok'],
    ['khach cu', 'Khach cu'],
    ['customer old', 'Khach cu'],
    ['old customer', 'Khach cu'],
    ['repeat customer', 'Khach cu'],
    ['chua ro', 'Chua ro'],
    ['unknown', 'Chua ro'],
    ['none', 'Chua ro'],
]);

export const normalizeOrderSourceKey = (value = '') => (
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0111/g, 'd')
        .replace(/\u0110/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

export const normalizeOrderSource = (value, fallback = UNKNOWN_ORDER_SOURCE) => {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return fallback;

    if (ORDER_SOURCE_VALUE_SET.has(rawValue)) {
        return rawValue;
    }

    const matchedOption = ORDER_SOURCE_OPTIONS.find((option) => (
        option.value.toLowerCase() === rawValue.toLowerCase()
        || option.label.toLowerCase() === rawValue.toLowerCase()
    ));
    if (matchedOption) {
        return matchedOption.value;
    }

    return ORDER_SOURCE_ALIASES.get(normalizeOrderSourceKey(rawValue)) || rawValue;
};

export const getOrderSourceMeta = (value, fallback = UNKNOWN_ORDER_SOURCE) => {
    const normalizedValue = normalizeOrderSource(value, fallback);
    const option = ORDER_SOURCE_OPTIONS.find((item) => item.value === normalizedValue);

    return {
        value: normalizedValue,
        label: option?.label || normalizedValue || ORDER_SOURCE_OPTIONS.find((item) => item.value === fallback)?.label || fallback,
    };
};
