export const ORDER_TYPE_STANDARD = 'standard';
export const ORDER_TYPE_EXCHANGE_RETURN = 'exchange_return';
export const ORDER_TYPE_PARTIAL_DELIVERY = 'partial_delivery';
export const SUPPLEMENT_RETURN_STATUS_NOT_RETURNED = 'not_returned';
export const SUPPLEMENT_RETURN_STATUS_RETURNED = 'returned';

export const SUPPLEMENT_RETURN_STATUS_OPTIONS = [
    { value: SUPPLEMENT_RETURN_STATUS_NOT_RETURNED, label: 'Chưa trả' },
    { value: SUPPLEMENT_RETURN_STATUS_RETURNED, label: 'Đã trả về' },
];

export const ORDER_TYPE_OPTIONS = [
    { value: ORDER_TYPE_STANDARD, label: 'Đơn thường' },
    { value: ORDER_TYPE_EXCHANGE_RETURN, label: 'Đơn đổi trả' },
    { value: ORDER_TYPE_PARTIAL_DELIVERY, label: 'Đơn giao hàng 1 phần' },
];

export const ORDER_TYPE_META = {
    [ORDER_TYPE_STANDARD]: {
        value: ORDER_TYPE_STANDARD,
        label: 'Đơn thường',
        shortLabel: 'Thường',
        sectionTitle: '',
        sectionDescription: '',
        settlementLabel: 'Chênh lệch tiền',
    },
    [ORDER_TYPE_EXCHANGE_RETURN]: {
        value: ORDER_TYPE_EXCHANGE_RETURN,
        label: 'Đơn đổi trả',
        shortLabel: 'Đổi trả',
        sectionTitle: 'Sản phẩm khách trả / đổi trả về',
        sectionDescription: 'Khu vực này chỉ khai báo dữ liệu để theo dõi, không tạo phiếu nhập xuất và không tác động kho.',
        settlementLabel: 'Chênh lệch tiền đổi / trả',
    },
    [ORDER_TYPE_PARTIAL_DELIVERY]: {
        value: ORDER_TYPE_PARTIAL_DELIVERY,
        label: 'Đơn giao hàng 1 phần',
        shortLabel: 'Giao 1 phần',
        sectionTitle: 'Sản phẩm trả về / chưa nhận / hoàn lại',
        sectionDescription: 'Khu vực này chỉ khai báo dữ liệu để theo dõi, không tạo phiếu nhập xuất và không tác động kho.',
        settlementLabel: 'Chênh lệch tiền giao 1 phần',
    },
};

export const normalizeOrderType = (value) => (
    ORDER_TYPE_META[String(value || '').trim()]?.value || ORDER_TYPE_STANDARD
);

export const isSpecialOrderType = (value) => normalizeOrderType(value) !== ORDER_TYPE_STANDARD;

export const getOrderTypeMeta = (value) => ORDER_TYPE_META[normalizeOrderType(value)] || ORDER_TYPE_META[ORDER_TYPE_STANDARD];

export const normalizeSupplementReturnStatus = (value) => (
    SUPPLEMENT_RETURN_STATUS_OPTIONS.some((option) => option.value === String(value || '').trim())
        ? String(value || '').trim()
        : SUPPLEMENT_RETURN_STATUS_NOT_RETURNED
);

export const getSupplementReturnStatusLabel = (value) => (
    SUPPLEMENT_RETURN_STATUS_OPTIONS.find((option) => option.value === normalizeSupplementReturnStatus(value))?.label
    || SUPPLEMENT_RETURN_STATUS_OPTIONS[0].label
);
