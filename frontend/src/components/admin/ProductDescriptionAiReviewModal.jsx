import React from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';

const ProductDescriptionAiReviewModal = ({
    open,
    draftHtml,
    revisionInstruction,
    isLoading,
    model,
    onRevisionInstructionChange,
    onRevise,
    onApply,
    onCopyHtml,
    onClose,
}) => {
    if (!open) {
        return null;
    }

    const hasDraft = String(draftHtml || '').trim() !== '';

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                <Motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-primary/50 backdrop-blur-sm"
                    onClick={isLoading ? undefined : onClose}
                />

                <Motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 18 }}
                    className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm bg-white shadow-premium-lg"
                >
                    <div className="flex flex-col gap-3 border-b border-gold/10 bg-[#fcfaf7] px-5 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined rounded-full bg-gold/10 p-2 text-gold">auto_fix_high</span>
                            <div>
                                <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">Duyệt nội dung AI</h3>
                                <p className="mt-1 text-[12px] font-medium text-stone/55">
                                    Nội dung này đã ổn chưa? Có cần tôi sửa tiếp theo hướng nào không?
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            {model && (
                                <span className="rounded-full border border-gold/15 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-gold">
                                    {model}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isLoading}
                                className="inline-flex size-9 items-center justify-center rounded-sm border border-stone/10 text-stone/45 transition hover:border-brick/30 hover:text-brick disabled:cursor-wait disabled:opacity-50"
                                title="Đóng"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
                        <div className="min-h-0 overflow-auto bg-white p-5">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/55">Bản xem trước</p>
                                <button
                                    type="button"
                                    onClick={onCopyHtml}
                                    disabled={!hasDraft || isLoading}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-gold/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-gold transition hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                    Copy HTML
                                </button>
                            </div>

                            <div className="min-h-[360px] rounded-sm border border-stone/10 bg-[#fdfcfb] p-5 shadow-inner">
                                {hasDraft ? (
                                    <div
                                        className="prose max-w-none text-primary [&_img]:my-4 [&_img]:max-w-full [&_iframe]:my-4 [&_iframe]:max-w-full"
                                        dangerouslySetInnerHTML={{ __html: draftHtml }}
                                    />
                                ) : (
                                    <div className="flex min-h-[300px] items-center justify-center text-[13px] font-bold text-stone/40">
                                        Chưa có bản nháp AI.
                                    </div>
                                )}
                            </div>
                        </div>

                        <aside className="flex min-h-0 flex-col border-t border-gold/10 bg-[#fcfaf7] p-5 lg:border-l lg:border-t-0">
                            <div className="mb-4">
                                <p className="text-[12px] font-black uppercase tracking-[0.16em] text-primary">Sửa tiếp nếu cần</p>
                                <p className="mt-1 text-[12px] leading-relaxed text-stone/55">
                                    Nhập yêu cầu ngắn gọn, ví dụ: ngắn hơn, sang hơn, bỏ bớt từ phong thủy, hoặc viết rõ hơn phần chất liệu.
                                </p>
                            </div>

                            <textarea
                                value={revisionInstruction}
                                onChange={(event) => onRevisionInstructionChange(event.target.value)}
                                disabled={isLoading}
                                rows={8}
                                className="min-h-[180px] w-full resize-y rounded-sm border border-gold/20 bg-white px-4 py-3 text-[13px] text-primary placeholder:text-stone/35 focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/25 disabled:cursor-wait disabled:opacity-60"
                                placeholder="Ví dụ: viết ngắn lại còn 3 đoạn, giọng văn tự nhiên hơn, không thêm thông số mới..."
                            />

                            <div className="mt-4 grid gap-2">
                                <button
                                    type="button"
                                    onClick={onRevise}
                                    disabled={isLoading || !String(revisionInstruction || '').trim()}
                                    className="inline-flex items-center justify-center gap-2 rounded-sm border border-gold/30 bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-gold transition hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className={`material-symbols-outlined text-[16px] ${isLoading ? 'animate-spin' : ''}`}>refresh</span>
                                    {isLoading ? 'Đang sửa...' : 'Sửa tiếp'}
                                </button>

                                <button
                                    type="button"
                                    onClick={onApply}
                                    disabled={!hasDraft || isLoading}
                                    className="inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-brick disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <span className="material-symbols-outlined text-[17px]">check</span>
                                    Nội dung OK, áp dụng
                                </button>
                            </div>
                        </aside>
                    </div>
                </Motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ProductDescriptionAiReviewModal;
