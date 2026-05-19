import React from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';

const ProductDescriptionImageLibraryModal = ({
    open,
    images,
    onInsert,
    onPreview,
    onClose,
}) => {
    if (!open) {
        return null;
    }

    const imageItems = Array.isArray(images) ? images : [];

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[118] flex items-center justify-center p-4">
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
                            <span className="material-symbols-outlined rounded-full bg-gold/10 p-2 text-gold">photo_library</span>
                            <div>
                                <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">Chèn ảnh sản phẩm</h3>
                                <p className="mt-1 text-[12px] font-medium text-stone/55">Chọn ảnh có sẵn trong thư viện của sản phẩm để chèn vào mô tả.</p>
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
                        {imageItems.length === 0 ? (
                            <div className="flex min-h-[260px] items-center justify-center rounded-sm border border-dashed border-stone/20 bg-stone/[0.02] text-[13px] font-bold text-stone/40">
                                Sản phẩm này chưa có ảnh trong thư viện.
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                                {imageItems.map((image, index) => {
                                    const imageUrl = String(image?.image_url || '').trim();
                                    const displayName = image?.display_name || `Ảnh ${index + 1}`;

                                    return (
                                        <div
                                            key={`${image?.id || imageUrl || index}`}
                                            className="group overflow-hidden rounded-sm border border-stone/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-gold/35 hover:shadow-md"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => onInsert(image)}
                                                className="block w-full"
                                                title={displayName}
                                            >
                                                <div className="aspect-square bg-stone/5">
                                                    {imageUrl ? (
                                                        <img src={imageUrl} alt={displayName} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center text-stone/25">
                                                            <span className="material-symbols-outlined text-[28px]">image</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </button>

                                            <div className="flex items-center justify-between gap-2 border-t border-stone/10 px-2 py-2">
                                                <p className="min-w-0 flex-1 truncate text-[10px] font-bold text-primary" title={displayName}>
                                                    {displayName}
                                                </p>
                                                {imageUrl && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onPreview(imageUrl, displayName)}
                                                        className="inline-flex size-7 items-center justify-center rounded-sm text-stone/45 transition hover:bg-gold/10 hover:text-gold"
                                                        title="Xem ảnh"
                                                    >
                                                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </Motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ProductDescriptionImageLibraryModal;
