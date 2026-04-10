import React, { useEffect } from 'react';

const PrintCompletionConfirmModal = ({
    open,
    orderCount = 1,
    confirming = false,
    onCancel,
    onConfirm,
}) => {
    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && !confirming) {
                onCancel?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [confirming, onCancel, open]);

    if (!open) return null;

    const isMultipleOrders = Number(orderCount || 0) > 1;

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-primary/20 backdrop-blur-[2px]"
                onClick={() => {
                    if (!confirming) onCancel?.();
                }}
            />
            <div className="relative w-full max-w-lg overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl">
                <div className="border-b border-primary/10 bg-primary/[0.03] px-6 py-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/45">
                        Xac nhan hoan tat in
                    </div>
                    <h3 className="mt-1 text-[20px] font-black text-primary">
                        {isMultipleOrders ? 'Da in xong cac don da chon?' : 'Da in xong don hang nay?'}
                    </h3>
                </div>

                <div className="space-y-4 px-6 py-5 text-[14px] leading-relaxed text-primary/75">
                    <p>
                        Trinh duyet khong the xac nhan chac chan viec in hay luu PDF da hoan tat.
                    </p>
                    <p>
                        Chi bam xac nhan neu ban da thuc su in xong hoac da luu PDF thanh cong.
                        {isMultipleOrders ? ` He thong se ghi nhan ${orderCount} don la da in.` : ' He thong se ghi nhan don nay la da in.'}
                    </p>
                    <p className="text-[12px] font-semibold text-primary/55">
                        Neu ban vua bam Huy, dong cua so print, hoac chua hoan tat in, hay chon "Chua in xong".
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-primary/10 px-6 py-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={confirming}
                        className="h-10 rounded-sm border border-primary/15 bg-white px-4 text-[11px] font-black uppercase tracking-[0.14em] text-primary/60 transition hover:text-brick disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Chua in xong
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={confirming}
                        className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-5 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${confirming ? 'animate-refresh-spin' : ''}`}>
                            {confirming ? 'progress_activity' : 'verified'}
                        </span>
                        {confirming ? 'Dang ghi nhan' : 'Da in / luu PDF xong'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PrintCompletionConfirmModal;
