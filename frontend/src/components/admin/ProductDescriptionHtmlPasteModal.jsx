import React, { useRef } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';

const ProductDescriptionHtmlPasteModal = ({
    open,
    initialHtml = '',
    onApply,
    onClose,
}) => {
    const textareaRef = useRef(null);

    if (!open) {
        return null;
    }

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[119] flex items-center justify-center p-4">
                <Motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-primary/45 backdrop-blur-sm"
                    onClick={onClose}
                />

                <Motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 18 }}
                    className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-sm bg-white shadow-premium-lg"
                >
                    <div className="flex items-center justify-between gap-3 border-b border-gold/10 bg-[#fcfaf7] px-5 py-4">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined rounded-full bg-gold/10 p-2 text-gold">code_blocks</span>
                            <div>
                                <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">Dán HTML mô tả</h3>
                                <p className="mt-1 text-[12px] font-medium text-stone/55">
                                    Dán HTML đã được ChatGPT viết lại, sau đó áp dụng vào editor.
                                </p>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex size-9 items-center justify-center rounded-sm border border-stone/10 text-stone/45 transition hover:border-brick/30 hover:text-brick"
                            title="Đóng"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-auto p-5">
                        <textarea
                            ref={textareaRef}
                            defaultValue={initialHtml || ''}
                            className="min-h-[420px] w-full resize-y rounded-sm border border-gold/20 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-primary placeholder:text-stone/35 focus:border-gold/40 focus:outline-none focus:ring-2 focus:ring-gold/25"
                            placeholder="Dán HTML từ ChatGPT vào đây..."
                            spellCheck={false}
                        />
                    </div>

                    <div className="flex flex-col gap-2 border-t border-stone/10 bg-stone/[0.02] p-4 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex items-center justify-center rounded-sm border border-stone/15 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-stone/55 transition hover:border-stone/30 hover:text-primary"
                        >
                            Hủy
                        </button>
                        <button
                            type="button"
                            onClick={() => onApply(String(textareaRef.current?.value || '').trim())}
                            className="inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-brick"
                        >
                            <span className="material-symbols-outlined text-[16px]">done</span>
                            Áp dụng HTML
                        </button>
                    </div>
                </Motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ProductDescriptionHtmlPasteModal;
