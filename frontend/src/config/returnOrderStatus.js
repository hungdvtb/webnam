export const RETURN_ORDER_STATUS_OPTIONS = [
    { value: 'new', label: 'Moi tao', color: '#2563EB' },
    { value: 'received', label: 'Da nhan hang hoan', color: '#0891B2' },
    { value: 'shipped', label: 'Da gui hang', color: '#7C3AED' },
    { value: 'completed', label: 'Hoan tat', color: '#15803D' },
    { value: 'cancelled', label: 'Huy', color: '#DC2626' },
];

export const RETURN_ORDER_STATUS_MAP = new Map(
    RETURN_ORDER_STATUS_OPTIONS.map((status) => [status.value, status])
);

export const resolveReturnOrderStatus = (status) => (
    RETURN_ORDER_STATUS_MAP.get(status) || RETURN_ORDER_STATUS_OPTIONS[0]
);

export const formatReturnOrderCurrency = (value) => (
    new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))
);

export const formatReturnOrderDate = (value) => {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('vi-VN');
};

export const formatReturnOrderDateTime = (value) => {
    if (!value) return '-';
    return new Date(value).toLocaleString('vi-VN');
};

export const resolveProfitLossMeta = (value) => {
    const amount = Number(value || 0);

    if (amount > 0) {
        return {
            tone: 'profit',
            label: 'Lai',
            color: '#15803D',
        };
    }

    if (amount < 0) {
        return {
            tone: 'loss',
            label: 'Lo',
            color: '#B91C1C',
        };
    }

    return {
        tone: 'balanced',
        label: 'Can bang',
        color: '#78716C',
    };
};
