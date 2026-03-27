export const ORDER_TYPE_STANDARD = 'standard';
export const ORDER_TYPE_EXCHANGE_RETURN = 'exchange_return';
export const ORDER_TYPE_PARTIAL_DELIVERY = 'partial_delivery';

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
