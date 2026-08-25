import { orderApi } from '../services/api';

const isExportSlipConfirmationResponse = (error) => (
    error?.response?.status === 409
    && error?.response?.data?.requires_export_slip_confirmation
);

const buildExportSlipConfirmationMessage = (payload = {}) => {
    const orderNumber = payload.order_number ? `Đơn ${payload.order_number}` : 'Đơn này';
    const totalQuantity = Number(payload.total_quantity || 0);
    const quantityText = totalQuantity > 0 ? ` (${totalQuantity} sản phẩm)` : '';

    return [
        payload.message || `${orderNumber} chưa có mã vận đơn hoặc phiếu xuất kho.`,
        '',
        `OK: Tạo phiếu xuất bù${quantityText} và trừ kho.`,
        'Hủy: Chỉ đổi trạng thái, không tạo phiếu và không trừ kho.',
    ].join('\n');
};

export const updateOrderStatusWithExportSlipPrompt = async (id, payloadOrStatus) => {
    const basePayload = (payloadOrStatus && typeof payloadOrStatus === 'object')
        ? payloadOrStatus
        : { status: payloadOrStatus };

    try {
        return await orderApi.updateStatus(id, basePayload);
    } catch (error) {
        if (!isExportSlipConfirmationResponse(error)) {
            throw error;
        }

        const createExportSlip = typeof window !== 'undefined'
            ? window.confirm(buildExportSlipConfirmationMessage(error.response.data))
            : false;

        return orderApi.updateStatus(id, {
            ...basePayload,
            auto_create_export_slip: createExportSlip,
        });
    }
};
