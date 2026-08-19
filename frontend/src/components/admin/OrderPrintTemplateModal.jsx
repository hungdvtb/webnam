import React, { useEffect } from 'react';
import {
    ORDER_PRINT_TEMPLATE_CUSTOMER,
    ORDER_PRINT_TEMPLATE_WAREHOUSE,
} from '../../utils/orderPrint';

const printTemplateOptions = [
    {
        key: ORDER_PRINT_TEMPLATE_WAREHOUSE,
        icon: 'inventory_2',
        title: 'In kho nhặt hàng',
        description: 'Mẫu mặc định A4 dọc, có vị trí kho và hàng thay thế.',
    },
    {
        key: ORDER_PRINT_TEMPLATE_CUSTOMER,
        icon: 'receipt_long',
        title: 'In gửi khách',
        description: 'Mẫu hiện tại, có đơn giá và thành tiền từng dòng.',
    },
];

const OrderPrintTemplateModal = ({
    open,
    orderCount = 1,
    loading = false,
    onClose,
    onSelect,
}) => {
    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !loading) {
                onClose?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [loading, onClose, open]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[129] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-primary/20 backdrop-blur-[2px]"
                onClick={() => {
                    if (!loading) onClose?.();
                }}
            />
            <div className="relative w-full max-w-xl overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl">
                <div className="border-b border-primary/10 bg-primary/[0.03] px-6 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/45">
                        Chọn mẫu in
                    </div>
                    <h3 className="mt-1 text-[20px] font-black text-primary">
                        {Number(orderCount || 0) > 1 ? `In ${orderCount} đơn đã chọn` : 'In đơn hàng'}
                    </h3>
                </div>

                <div className="space-y-3 px-6 py-5">
                    {printTemplateOptions.map((option, index) => {
                        const isDefault = option.key === ORDER_PRINT_TEMPLATE_WAREHOUSE;

                        return (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => onSelect?.(option.key)}
                                disabled={loading}
                                className={`flex w-full items-center gap-4 rounded-sm border px-4 py-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${isDefault ? 'border-primary/35 bg-primary/[0.04] hover:border-primary/50 hover:bg-primary/[0.07]' : 'border-primary/10 bg-white hover:border-primary/25 hover:bg-primary/[0.03]'}`}
                            >
                                <span className={`material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-sm ${isDefault ? 'bg-primary text-white' : 'border border-primary/15 text-primary/45'}`}>
                                    {loading && index === 0 ? 'progress_activity' : option.icon}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[15px] font-black text-primary">
                                        {option.title}
                                    </span>
                                    <span className="mt-1 block text-[12px] font-semibold leading-relaxed text-primary/55">
                                        {option.description}
                                    </span>
                                </span>
                                {isDefault ? (
                                    <span className="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                                        Mặc định
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center justify-end border-t border-primary/10 px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="h-10 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.14em] text-primary/60 transition hover:text-brick disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Hủy
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OrderPrintTemplateModal;
