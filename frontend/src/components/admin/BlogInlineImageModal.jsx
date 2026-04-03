import React, { useEffect, useMemo, useState } from 'react';
import { mediaApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { resolveMediaUrl } from '../../utils/mediaUrl';

const overlayClassName = 'fixed inset-0 z-[10020] flex items-center justify-center bg-primary/25 p-4 backdrop-blur-sm';
const panelClassName = 'relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden border border-gold/20 bg-[#fcfaf7] shadow-premium-lg';

const createEmptyDraft = () => ({
    src: '',
    alt: '',
    title: '',
});

const getFileLabel = (fileName = '') => String(fileName || '').replace(/\.[^.]+$/, '').trim();

const BlogInlineImageModal = ({
    open,
    editing = false,
    initialImage = null,
    onClose,
    onSave,
    onRemove,
}) => {
    const { showModal, showToast } = useUI();
    const [draft, setDraft] = useState(createEmptyDraft);
    const [uploadingImage, setUploadingImage] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }

        setDraft({
            src: String(initialImage?.src || '').trim(),
            alt: String(initialImage?.alt || '').trim(),
            title: String(initialImage?.title || '').trim(),
        });
        setUploadingImage(false);
    }, [initialImage, open]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        document.body.style.overflow = 'hidden';

        const handleEsc = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEsc);

        return () => {
            document.body.style.overflow = 'unset';
            window.removeEventListener('keydown', handleEsc);
        };
    }, [onClose, open]);

    const previewUrl = useMemo(() => resolveMediaUrl(draft.src), [draft.src]);

    if (!open) {
        return null;
    }

    const updateField = (fieldName, value) => {
        setDraft((prev) => ({
            ...prev,
            [fieldName]: value,
        }));
    };

    const handleUploadImage = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        setUploadingImage(true);

        try {
            const formData = new FormData();
            formData.append('image', file);

            const response = await mediaApi.upload(formData);
            const nextSourceUrl = String(response?.data?.url || '').trim();

            if (!nextSourceUrl) {
                throw new Error('UPLOAD_FAILED');
            }

            const defaultLabel = getFileLabel(file.name);

            setDraft((prev) => ({
                src: nextSourceUrl,
                alt: prev.alt || defaultLabel,
                title: prev.title || defaultLabel,
            }));

            showToast({
                message: 'Đã tải ảnh mới lên và gắn vào bài viết.',
                type: 'success',
            });
        } catch (error) {
            showModal({
                title: 'Upload ảnh thất bại',
                content: 'Không thể tải ảnh mới lên lúc này. Hãy thử lại hoặc dán link ảnh trực tiếp.',
                type: 'error',
            });
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSave = () => {
        const nextSourceUrl = String(draft.src || '').trim();

        if (!nextSourceUrl) {
            showModal({
                title: 'Thiếu link ảnh',
                content: 'Hãy nhập link ảnh hoặc upload ảnh mới trước khi lưu.',
                type: 'warning',
            });
            return;
        }

        onSave({
            src: nextSourceUrl,
            alt: String(draft.alt || '').trim(),
            title: String(draft.title || '').trim(),
        });
    };

    return (
        <div className={overlayClassName} onClick={onClose}>
            <div className={panelClassName} onClick={(event) => event.stopPropagation()}>
                <div className="border-b border-gold/15 bg-white px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-stone/45">Ảnh Trong Nội Dung</p>
                            <h3 className="font-display text-2xl font-bold italic text-primary">
                                {editing ? 'Chỉnh ảnh đang có' : 'Chèn ảnh mới'}
                            </h3>
                            <p className="max-w-2xl text-sm leading-relaxed text-stone/70">
                                Thay ảnh bằng link khác hoặc upload ảnh mới, rồi cập nhật tên ảnh và mô tả alt ngay trong editor.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex h-11 w-11 items-center justify-center border border-gold/20 text-primary transition-colors hover:border-primary hover:bg-primary hover:text-white"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                    </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-h-0 overflow-y-auto px-6 py-6">
                        <div className="space-y-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Link ảnh</label>
                                <input
                                    type="text"
                                    value={draft.src}
                                    onChange={(event) => updateField('src', event.target.value)}
                                    className="w-full border border-gold/20 bg-white p-3 text-sm text-stone/80 outline-none transition-colors focus:border-primary"
                                    placeholder="https://... hoặc /storage/uploads/..."
                                />
                                <p className="text-xs text-stone/55">
                                    Bạn có thể dán link ảnh online mới hoặc bấm upload để thay ảnh cũ.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Tên ảnh / title</label>
                                <input
                                    type="text"
                                    value={draft.title}
                                    onChange={(event) => updateField('title', event.target.value)}
                                    className="w-full border border-gold/20 bg-white p-3 text-sm text-stone/80 outline-none transition-colors focus:border-primary"
                                    placeholder="Ví dụ: Bộ đồ thờ men lam Bát Tràng"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Mô tả ảnh / alt</label>
                                <textarea
                                    rows="4"
                                    value={draft.alt}
                                    onChange={(event) => updateField('alt', event.target.value)}
                                    className="w-full resize-none border border-gold/20 bg-white p-3 text-sm leading-relaxed text-stone/80 outline-none transition-colors focus:border-primary"
                                    placeholder="Mô tả ngắn giúp SEO và vẫn có nội dung thay thế nếu ảnh lỗi"
                                />
                            </div>

                            <div className="rounded-sm border border-gold/20 bg-white p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Upload ảnh mới</p>
                                        <p className="mt-1 text-xs text-stone/60">
                                            Hệ thống sẽ upload ảnh lên server rồi tự gắn lại link ảnh cho bài viết.
                                        </p>
                                    </div>

                                    <label className={`inline-flex cursor-pointer items-center gap-2 border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${uploadingImage ? 'border-gold/20 bg-primary/5 text-primary/50' : 'border-gold/20 text-primary hover:border-primary hover:bg-primary hover:text-white'}`}>
                                        <span className="material-symbols-outlined text-[18px]">{uploadingImage ? 'progress_activity' : 'upload_file'}</span>
                                        {uploadingImage ? 'Đang tải ảnh...' : 'Chọn ảnh mới'}
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleUploadImage}
                                            disabled={uploadingImage}
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <aside className="border-t border-gold/15 bg-[#f8f2e8] p-6 lg:border-l lg:border-t-0">
                        <div className="space-y-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Preview</p>
                                <h4 className="mt-2 font-display text-xl font-bold text-primary">Xem nhanh ảnh sau khi sửa</h4>
                            </div>

                            <div className="overflow-hidden border border-gold/20 bg-white">
                                <div className="aspect-[4/3] bg-[#fcfaf7]">
                                    {previewUrl ? (
                                        <img
                                            src={previewUrl}
                                            alt={draft.alt || draft.title || 'Preview ảnh'}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-stone/35">
                                            <span className="material-symbols-outlined text-[44px]">image</span>
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2 border-t border-gold/15 px-4 py-4 text-sm text-stone/75">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Title</p>
                                        <p className="mt-1 break-words">{draft.title || 'Chưa có title riêng'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Alt</p>
                                        <p className="mt-1 break-words">{draft.alt || 'Chưa có mô tả alt'}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gold/15 bg-white px-6 py-4">
                    <div className="text-xs leading-relaxed text-stone/60">
                        <p>Bấm vào ảnh trong editor để mở lại form này và sửa tiếp.</p>
                        <p>Ảnh được lưu dưới dạng HTML nên link, title và alt sẽ đi theo bài viết khi export/import Excel.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {editing && onRemove ? (
                            <button
                                type="button"
                                onClick={onRemove}
                                className="inline-flex items-center gap-2 border border-brick/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brick transition-colors hover:bg-brick hover:text-white"
                            >
                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                Xóa ảnh
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={onClose}
                            className="border border-gold/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-stone transition-colors hover:border-primary hover:text-primary"
                        >
                            Hủy
                        </button>

                        <button
                            type="button"
                            onClick={handleSave}
                            className="inline-flex items-center gap-2 bg-primary px-5 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-umber"
                        >
                            <span className="material-symbols-outlined text-[18px]">image</span>
                            {editing ? 'Cập nhật ảnh' : 'Chèn ảnh'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BlogInlineImageModal;
