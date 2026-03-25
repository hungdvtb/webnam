const DECIMAL_MONEY_PATTERN = /^-?\d+[.,]\d{1,2}$/;

export const parseWholeMoneyValue = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.trunc(value) : null;
    }

    const normalized = String(value)
        .trim()
        .replace(/\s+/g, '')
        .replace(/[\u20ab\u0111]/gi, '');

    if (!normalized) {
        return null;
    }

    if (DECIMAL_MONEY_PATTERN.test(normalized)) {
        const parsedDecimal = Number(normalized.replace(',', '.'));
        return Number.isFinite(parsedDecimal) ? Math.trunc(parsedDecimal) : null;
    }

    const sign = normalized.startsWith('-') ? -1 : 1;
    const digits = normalized.replace(/[^0-9]/g, '');
    if (!digits) {
        return null;
    }

    return sign * Number(digits);
};

export const normalizeWholeMoneyDraft = (value) => {
    const parsed = parseWholeMoneyValue(value);
    if (parsed === null) {
        return '';
    }

    return String(Math.max(0, parsed));
};

export const normalizeWholeMoneyNumber = (value) => {
    const parsed = parseWholeMoneyValue(value);
    if (parsed === null) {
        return null;
    }

    return Math.max(0, parsed);
};

export const formatWholeMoneyInput = (value, locale = 'vi-VN') => {
    const parsed = normalizeWholeMoneyNumber(value);
    if (parsed === null) {
        return '';
    }

    return new Intl.NumberFormat(locale).format(parsed);
};
