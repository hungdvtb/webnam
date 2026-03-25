import React, { useEffect, useState } from 'react';
import { mediaApi } from '../../services/api';
import { useUI } from '../../context/UIContext';
import {
    buildImageGalleryItem,
    buildVideoGalleryItem,
    extractYouTubeVideoId,
    normalizeGalleryItems,
    parseYouTubeLinks,
    resolveYouTubeThumbnailUrl,
} from '../../utils/blogMediaGallery';

const overlayClassName = 'fixed inset-0 z-[10010] flex items-center justify-center bg-primary/25 p-4 backdrop-blur-sm';
const panelClassName = 'relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden border border-gold/20 bg-[#fcfaf7] shadow-premium-lg';
const iconButtonClassName = 'inline-flex h-10 w-10 items-center justify-center border border-gold/20 text-primary transition-colors hover:border-primary hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-40';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const BlogMediaGalleryModal = ({
    open,
    initialItems = [],
    editing = false,
    onClose,
    onSave,
    onRemoveBlock,
}) => {
    const { showModal, showToast } = useUI();
    const [items, setItems] = useState(() => normalizeGalleryItems(initialItems));
    const [youtubeInput, setYoutubeInput] = useState('');
    const [uploadingImages, setUploadingImages] = useState(false);

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
    }, [initialItems, onClose, open]);

    if (!open) {
        return null;
    }

    const imageCount = items.filter((item) => item.type === 'image').length;
    const videoCount = items.filter((item) => item.type === 'video').length;

    const updateItem = (index, updater) => {
        setItems((prevItems) => prevItems.map((item, itemIndex) => (
            itemIndex === index
                ? (typeof updater === 'function' ? updater(item) : updater)
                : item
        )));
    };

    const moveItem = (index, direction) => {
        setItems((prevItems) => {
            const nextIndex = index + direction;

            if (nextIndex < 0 || nextIndex >= prevItems.length) {
                return prevItems;
            }

            const cloned = [...prevItems];
            const [movedItem] = cloned.splice(index, 1);
            cloned.splice(nextIndex, 0, movedItem);
            return cloned;
        });
    };

    const handleImageUpload = async (event) => {
        const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
        event.target.value = '';

        if (!files.length) {
            return;
        }

        setUploadingImages(true);

        const results = await Promise.allSettled(files.map(async (file) => {
            const formData = new FormData();
            formData.append('image', file);

            const response = await mediaApi.upload(formData);
            const sourceUrl = response?.data?.url;

            if (!sourceUrl) {
                throw new Error('UPLOAD_FAILED');
            }

            return buildImageGalleryItem(sourceUrl, {
                alt: file.name.replace(/\.[^.]+$/, ''),
            });
        }));

        const uploadedItems = results
            .filter((result) => result.status === 'fulfilled' && result.value)
            .map((result) => result.value);

        if (uploadedItems.length) {
            setItems((prevItems) => [...prevItems, ...uploadedItems]);
            showToast({
                message: `Đã thêm ${uploadedItems.length} ảnh vào block media.`,
                type: 'success',
            });
        }

        const failedCount = results.length - uploadedItems.length;
        if (failedCount > 0) {
            showModal({
                title: 'Upload ảnh chưa hoàn tất',
                content: `Có ${failedCount} ảnh upload lỗi. Các ảnh upload thành công vẫn đã được giữ lại.`,
                type: 'warning',
            });
        }

        setUploadingImages(false);
    };

    const handleAddVideos = () => {
        const { links, invalid } = parseYouTubeLinks(youtubeInput);

        if (!links.length) {
            showModal({
                title: 'Chưa có video hợp lệ',
                content: invalid.length
                    ? 'Các link YouTube vừa nhập chưa đúng định dạng.'
                    : 'Hãy dán ít nhất một link YouTube để thêm video.',
                type: 'warning',
            });
            return;
        }

        const existingKeys = new Set(items.map((item) => (
            item.type === 'video'
                ? item.youtubeId || item.url
                : item.src
        )));

        const nextItems = links
            .map((link) => buildVideoGalleryItem(link))
            .filter((item) => item && !existingKeys.has(item.youtubeId || item.url));

        if (!nextItems.length) {
            showToast({
                message: 'Các video này đã có trong block media.',
                type: 'info',
            });
            return;
        }

        setItems((prevItems) => [...prevItems, ...nextItems]);
        setYoutubeInput('');
        showToast({
            message: `Đã thêm ${nextItems.length} video YouTube.`,
            type: 'success',
        });

        if (invalid.length) {
            showModal({
                title: 'Có link chưa hợp lệ',
                content: `Một vài link không được thêm vì không nhận diện được YouTube:<br/>${invalid.map((value) => `- ${escapeHtml(value)}`).join('<br/>')}`,
                type: 'warning',
            });
        }
    };

    const handleSave = () => {
        const normalizedItems = normalizeGalleryItems(items);
        const invalidVideoCount = items.filter((item) => item.type === 'video' && !extractYouTubeVideoId(item.url)).length;

        if (invalidVideoCount > 0) {
            showModal({
                title: 'Video chưa hợp lệ',
                content: 'Có video YouTube đang bị sai link. Hãy sửa lại trước khi lưu block media.',
                type: 'warning',
            });
            return;
        }

        if (!normalizedItems.length) {
            showModal({
                title: 'Block media đang trống',
                content: 'Hãy thêm ít nhất một ảnh hoặc một video YouTube trước khi chèn vào bài viết.',
                type: 'warning',
            });
            return;
        }

        onSave(normalizedItems);
    };

    return (
        <div className={overlayClassName} onClick={onClose}>
            <div className={panelClassName} onClick={(event) => event.stopPropagation()}>
                <div className="border-b border-gold/15 bg-white px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-stone/45">Media Gallery Cho Bài Viết</p>
                            <h3 className="font-display text-2xl font-bold italic text-primary">
                                {editing ? 'Chỉnh block media' : 'Thêm block media mới'}
                            </h3>
                            <p className="max-w-3xl text-sm leading-relaxed text-stone/70">
                                Chèn đồng thời nhiều ảnh và nhiều video YouTube, rồi sắp xếp đúng thứ tự muốn hiển thị ngoài frontend.
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

                <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
                    <aside className="border-b border-gold/15 bg-[#f8f2e8] p-6 lg:border-b-0 lg:border-r">
                        <div className="space-y-6">
                            <div className="rounded-sm border border-gold/20 bg-white p-5">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone/45">Tóm Tắt</p>
                                        <h4 className="mt-2 font-display text-lg font-bold text-primary">Danh sách media</h4>
                                    </div>
                                    <span className="inline-flex min-w-[42px] items-center justify-center rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                                        {items.length}
                                    </span>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                                    <div className="border border-gold/15 bg-[#fcfaf7] px-3 py-3">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-stone/45">Ảnh</p>
                                        <p className="mt-2 font-display text-2xl font-bold text-primary">{imageCount}</p>
                                    </div>
                                    <div className="border border-gold/15 bg-[#fcfaf7] px-3 py-3">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-stone/45">Video</p>
                                        <p className="mt-2 font-display text-2xl font-bold text-primary">{videoCount}</p>
                                    </div>
                                </div>

                                <p className="mt-4 text-xs leading-relaxed text-stone/65">
                                    Thứ tự bên phải sẽ được giữ nguyên ngoài website, từ thumbnail đến khung media lớn.
                                </p>
                            </div>

                            <div className="rounded-sm border border-gold/20 bg-white p-5">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-lg text-primary">imagesmode</span>
                                    <div>
                                        <h4 className="font-display text-lg font-bold text-primary">Thêm ảnh</h4>
                                        <p className="text-xs text-stone/65">Upload nhiều file ảnh trực tiếp lên server.</p>
                                    </div>
                                </div>

                                <label className={`mt-4 flex cursor-pointer items-center justify-center gap-3 border border-dashed border-gold/30 px-4 py-4 text-center text-sm font-bold uppercase tracking-[0.18em] text-primary transition-colors ${uploadingImages ? 'pointer-events-none bg-primary/5 opacity-70' : 'hover:border-primary hover:bg-primary/5'}`}>
                                    <span className="material-symbols-outlined text-[18px]">{uploadingImages ? 'progress_activity' : 'upload_file'}</span>
                                    {uploadingImages ? 'Đang tải ảnh...' : 'Chọn nhiều ảnh'}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        onChange={handleImageUpload}
                                        disabled={uploadingImages}
                                    />
                                </label>
                            </div>

                            <div className="rounded-sm border border-gold/20 bg-white p-5">
                                <div className="flex items-center gap-3">
                                    <span className="material-symbols-outlined text-lg text-primary">smart_display</span>
                                    <div>
                                        <h4 className="font-display text-lg font-bold text-primary">Thêm video YouTube</h4>
                                        <p className="text-xs text-stone/65">Dán nhiều link, mỗi dòng một link hoặc phân tách bằng dấu phẩy.</p>
                                    </div>
                                </div>

                                <textarea
                                    rows="5"
                                    value={youtubeInput}
                                    onChange={(event) => setYoutubeInput(event.target.value)}
                                    className="mt-4 w-full resize-none border border-gold/20 bg-[#fcfaf7] p-4 text-sm leading-relaxed text-stone/80 outline-none transition-colors focus:border-primary"
                                    placeholder={'https://youtu.be/abc123\nhttps://www.youtube.com/watch?v=xyz789'}
                                />

                                <button
                                    type="button"
                                    onClick={handleAddVideos}
                                    className="mt-4 inline-flex items-center gap-2 bg-primary px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition-colors hover:bg-umber"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add_circle</span>
                                    Thêm video
                                </button>
                            </div>
                        </div>
                    </aside>

                    <div className="flex min-h-0 flex-col bg-[#fcfaf7]">
                        <div className="flex items-center justify-between gap-4 border-b border-gold/15 px-6 py-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone/45">Danh Sách Đã Thêm</p>
                                <h4 className="mt-1 font-display text-xl font-bold text-primary">Preview, sửa, xóa và đổi thứ tự</h4>
                            </div>
                            <div className="text-right text-xs leading-relaxed text-stone/60">
                                <p>Ảnh và video có thể trộn chung trong một block.</p>
                                <p>Thumbnail ngoài site sẽ chạy đúng theo danh sách này.</p>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
                            {items.length === 0 ? (
                                <div className="flex h-full min-h-[320px] flex-col items-center justify-center border border-dashed border-gold/25 bg-white/80 px-8 text-center">
                                    <span className="material-symbols-outlined text-[52px] text-gold/60">gallery_thumbnail</span>
                                    <h5 className="mt-5 font-display text-2xl font-bold text-primary">Chưa có media nào</h5>
                                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone/65">
                                        Thêm ảnh hoặc video YouTube ở cột bên trái, sau đó sắp xếp thứ tự hiển thị ngay tại đây.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {items.map((item, index) => {
                                        const isVideo = item.type === 'video';
                                        const previewUrl = isVideo ? (item.thumbnail || resolveYouTubeThumbnailUrl(item.url)) : item.src;
                                        const isInvalidVideo = isVideo && !extractYouTubeVideoId(item.url);

                                        return (
                                            <div key={item.id || `${item.type}-${index}`} className="grid gap-4 border border-gold/20 bg-white p-4 shadow-sm lg:grid-cols-[180px_minmax(0,1fr)_auto]">
                                                <div className="relative overflow-hidden rounded-sm bg-[#f5efe4]">
                                                    <div className="aspect-[16/10] w-full">
                                                        {previewUrl ? (
                                                            <img
                                                                src={previewUrl}
                                                                alt={item.alt || item.title || `Media ${index + 1}`}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="flex h-full items-center justify-center text-stone/35">
                                                                <span className="material-symbols-outlined text-[40px]">broken_image</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="absolute left-3 top-3 inline-flex items-center gap-2 bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                                                        <span className="material-symbols-outlined text-[14px]">
                                                            {isVideo ? 'smart_display' : 'image'}
                                                        </span>
                                                        {isVideo ? 'Video' : 'Ảnh'} #{index + 1}
                                                    </div>

                                                    {isVideo ? (
                                                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                                            <span className="material-symbols-outlined rounded-full bg-black/55 p-3 text-[30px] text-white">
                                                                play_arrow
                                                            </span>
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <div className="space-y-4">
                                                    {isVideo ? (
                                                        <>
                                                            <div className="space-y-2">
                                                                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Link YouTube</label>
                                                                <input
                                                                    type="text"
                                                                    value={item.url || ''}
                                                                    onChange={(event) => {
                                                                        const nextUrl = event.target.value;
                                                                        updateItem(index, (currentItem) => ({
                                                                            ...currentItem,
                                                                            url: nextUrl,
                                                                            youtubeId: extractYouTubeVideoId(nextUrl),
                                                                            thumbnail: resolveYouTubeThumbnailUrl(nextUrl) || currentItem.thumbnail,
                                                                        }));
                                                                    }}
                                                                    className={`w-full border p-3 text-sm outline-none transition-colors ${isInvalidVideo ? 'border-brick bg-brick/5 text-brick' : 'border-gold/20 bg-[#fcfaf7] text-stone/80 focus:border-primary'}`}
                                                                    placeholder="https://www.youtube.com/watch?v=..."
                                                                />
                                                                <p className={`text-xs ${isInvalidVideo ? 'text-brick' : 'text-stone/55'}`}>
                                                                    {isInvalidVideo
                                                                        ? 'Link này chưa được nhận diện là YouTube hợp lệ.'
                                                                        : 'Hỗ trợ watch, short, embed, live, youtu.be và youtube-nocookie.'}
                                                                </p>
                                                            </div>

                                                            <div className="space-y-2">
                                                                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Tiêu đề phụ (tùy chọn)</label>
                                                                <input
                                                                    type="text"
                                                                    value={item.title || ''}
                                                                    onChange={(event) => updateItem(index, { ...item, title: event.target.value })}
                                                                    className="w-full border border-gold/20 bg-[#fcfaf7] p-3 text-sm text-stone/80 outline-none transition-colors focus:border-primary"
                                                                    placeholder="Ví dụ: Video quy trình làm gốm"
                                                                />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-stone/45">Mô tả ảnh / alt</label>
                                                            <input
                                                                type="text"
                                                                value={item.alt || ''}
                                                                onChange={(event) => updateItem(index, { ...item, alt: event.target.value })}
                                                                className="w-full border border-gold/20 bg-[#fcfaf7] p-3 text-sm text-stone/80 outline-none transition-colors focus:border-primary"
                                                                placeholder="Mô tả ngắn cho ảnh nếu cần"
                                                            />
                                                            <p className="text-xs text-stone/55">
                                                                Ảnh sẽ dùng đúng URL đã upload, chỉ cần chỉnh mô tả nếu muốn SEO hoặc alt tốt hơn.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex flex-row items-start gap-2 lg:flex-col">
                                                    <button
                                                        type="button"
                                                        onClick={() => moveItem(index, -1)}
                                                        className={iconButtonClassName}
                                                        disabled={index === 0}
                                                        title="Đưa lên trên"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => moveItem(index, 1)}
                                                        className={iconButtonClassName}
                                                        disabled={index === items.length - 1}
                                                        title="Đưa xuống dưới"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setItems((prevItems) => prevItems.filter((_, itemIndex) => itemIndex !== index))}
                                                        className="inline-flex h-10 w-10 items-center justify-center border border-brick/20 text-brick transition-colors hover:border-brick hover:bg-brick hover:text-white"
                                                        title="Xóa media"
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gold/15 bg-white px-6 py-4">
                    <div className="text-xs leading-relaxed text-stone/60">
                        <p>Block media sẽ được chèn đúng vị trí con trỏ hiện tại trong nội dung bài viết.</p>
                        <p>Khi bấm lại vào block trong editor, bạn có thể mở form này để chỉnh sửa tiếp.</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        {editing && onRemoveBlock ? (
                            <button
                                type="button"
                                onClick={onRemoveBlock}
                                className="inline-flex items-center gap-2 border border-brick/20 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brick transition-colors hover:bg-brick hover:text-white"
                            >
                                <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                                Xóa block
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
                            <span className="material-symbols-outlined text-[18px]">gallery_thumbnail</span>
                            {editing ? 'Cập nhật block media' : 'Chèn block media'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BlogMediaGalleryModal;
