import React, { useEffect, useRef, useState } from 'react';
import { productImageApi } from '../../services/api';

const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
const PREVIEW_LIMIT = 24;

function formatFileSize(size) {
    const numericSize = Number(size || 0);
    if (!Number.isFinite(numericSize) || numericSize <= 0) {
        return '';
    }

    if (numericSize >= 1024 * 1024) {
        return `${(numericSize / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (numericSize >= 1024) {
        return `${Math.round(numericSize / 1024)} KB`;
    }

    return `${numericSize} B`;
}

function isAcceptedImageFile(file) {
    if (!file) {
        return false;
    }

    if (String(file.type || '').toLowerCase().startsWith('image/')) {
        return true;
    }

    const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
    return ACCEPTED_EXTENSIONS.has(extension);
}

function buildFileIdentity(file) {
    return `${file.name}::${file.size}::${file.lastModified}`;
}

function buildAppendPayload(files, selectedIds, scopeSelectedOnly, insertionMode, afterIndex) {
    const formData = new FormData();

    files.forEach((file) => {
        formData.append('images[]', file);
    });

    selectedIds.forEach((id) => {
        formData.append('product_ids[]', String(id));
    });

    formData.append('scope_selected_only', scopeSelectedOnly ? '1' : '0');
    formData.append('insertion_mode', insertionMode);

    if (insertionMode === 'after_index') {
        formData.append('after_index', String(Math.max(1, Number(afterIndex) || 1)));
    }

    formData.append('preview_limit', String(PREVIEW_LIMIT));

    return formData;
}

function resolveErrorMessage(error, fallbackMessage) {
    const message = error?.response?.data?.message;
    if (typeof message === 'string' && message.trim() !== '') {
        return message;
    }

    const errors = error?.response?.data?.errors;
    if (errors && typeof errors === 'object') {
        const firstMessage = Object.values(errors)
            .flat()
            .find((value) => typeof value === 'string' && value.trim() !== '');

        if (firstMessage) {
            return firstMessage;
        }
    }

    return fallbackMessage;
}

function getStatusMeta(status) {
    if (status === 'ready') {
        return {
            label: 'Sẵn sàng',
            badgeClass: 'bg-green-50 text-green-700 border-green-200',
            cardClass: 'border-green-200 bg-green-50/50',
        };
    }

    return {
        label: 'Không thể áp dụng',
        badgeClass: 'bg-brick/10 text-brick border-brick/20',
        cardClass: 'border-brick/20 bg-brick/5',
    };
}

function renderProgressBar(progress, tone = 'primary') {
    const width = Math.max(progress > 0 ? progress : 14, 14);
    const barClass = tone === 'amber' ? 'bg-amber-500' : 'bg-primary';

    return (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10">
            <div
                className={`h-full rounded-full transition-all duration-200 ${barClass}`}
                style={{ width: `${Math.min(width, 100)}%` }}
            />
        </div>
    );
}

const ProductImageBulkAppendModal = ({
    open,
    selectedIds = [],
    onClose,
    onApplied,
}) => {
    const filesInputRef = useRef(null);
    const [queuedFiles, setQueuedFiles] = useState([]);
    const [filePreviewUrls, setFilePreviewUrls] = useState({});
    const [selectionNote, setSelectionNote] = useState('');
    const [scopeSelectedOnly, setScopeSelectedOnly] = useState(selectedIds.length > 0);
    const [insertionMode, setInsertionMode] = useState('end');
    const [afterIndex, setAfterIndex] = useState(1);
    const [previewData, setPreviewData] = useState(null);
    const [previewError, setPreviewError] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewProgress, setPreviewProgress] = useState(0);
    const [applyLoading, setApplyLoading] = useState(false);
    const [applyProgress, setApplyProgress] = useState(0);

    useEffect(() => {
        if (!open) {
            return;
        }

        setQueuedFiles([]);
        setSelectionNote('');
        setScopeSelectedOnly(selectedIds.length > 0);
        setInsertionMode('end');
        setAfterIndex(1);
        setPreviewData(null);
        setPreviewError('');
        setPreviewLoading(false);
        setPreviewProgress(0);
        setApplyLoading(false);
        setApplyProgress(0);
    }, [open, selectedIds.length]);

    useEffect(() => {
        if (!open || selectedIds.length > 0) {
            return;
        }

        setScopeSelectedOnly(false);
    }, [open, selectedIds.length]);

    useEffect(() => {
        const nextUrls = {};

        queuedFiles.forEach((file) => {
            nextUrls[buildFileIdentity(file)] = URL.createObjectURL(file);
        });

        setFilePreviewUrls(nextUrls);

        return () => {
            Object.values(nextUrls).forEach((url) => {
                try {
                    URL.revokeObjectURL(url);
                } catch (error) {
                    // Ignore object URL cleanup failures.
                }
            });
        };
    }, [queuedFiles]);

    useEffect(() => {
        if (!open) {
            return;
        }

        setPreviewData(null);
        setPreviewError('');
        setPreviewProgress(0);
        setApplyProgress(0);
    }, [queuedFiles, scopeSelectedOnly, insertionMode, afterIndex, open]);

    if (!open) {
        return null;
    }

    const uploadPreviewUrlByIndex = {};
    queuedFiles.forEach((file, index) => {
        uploadPreviewUrlByIndex[index] = filePreviewUrls[buildFileIdentity(file)] || '';
    });

    const canClose = !previewLoading && !applyLoading;
    const canPreview = queuedFiles.length > 0 && !previewLoading && !applyLoading;
    const selectedScopeActive = scopeSelectedOnly && selectedIds.length > 0;
    const canApply = !!previewData?.summary?.can_apply && !previewLoading && !applyLoading;
    const supportedAfterIndexMax = Number(previewData?.summary?.supported_after_index_max_for_all_targets || 0);

    const handleAppendFiles = (fileList) => {
        const nextFiles = Array.from(fileList || []);
        if (nextFiles.length === 0) {
            return;
        }

        const acceptedFiles = [];
        const rejectedFiles = [];

        nextFiles.forEach((file) => {
            if (isAcceptedImageFile(file)) {
                acceptedFiles.push(file);
            } else {
                rejectedFiles.push(file.name || 'tệp không hợp lệ');
            }
        });

        setQueuedFiles((prev) => {
            const identityMap = new Map(prev.map((file) => [buildFileIdentity(file), file]));

            acceptedFiles.forEach((file) => {
                identityMap.set(buildFileIdentity(file), file);
            });

            return Array.from(identityMap.values());
        });

        const noteParts = [];

        if (acceptedFiles.length > 0) {
            noteParts.push(`Đã thêm ${acceptedFiles.length} ảnh`);
        }

        if (rejectedFiles.length > 0) {
            noteParts.push(`bỏ qua ${rejectedFiles.length} tệp không phải ảnh`);
        }

        setSelectionNote(noteParts.join(', '));
    };

    const handleInputChange = (event) => {
        handleAppendFiles(event.target.files);
        event.target.value = '';
    };

    const handleRemoveQueuedFile = (targetFile) => {
        setQueuedFiles((prev) => prev.filter((file) => buildFileIdentity(file) !== buildFileIdentity(targetFile)));
    };

    const handlePreview = async () => {
        if (queuedFiles.length === 0) {
            setPreviewError('Hãy chọn ít nhất 1 ảnh trước khi xem trước.');
            return;
        }

        setPreviewLoading(true);
        setPreviewProgress(0);
        setPreviewError('');

        try {
            const response = await productImageApi.bulkAppendPreview(
                buildAppendPayload(
                    queuedFiles,
                    selectedIds,
                    selectedScopeActive,
                    insertionMode,
                    afterIndex
                ),
                {
                    onUploadProgress: (event) => {
                        if (!event?.total) {
                            return;
                        }

                        setPreviewProgress(Math.round((event.loaded / event.total) * 100));
                    },
                }
            );

            setPreviewData(response.data);
            setPreviewProgress(100);
        } catch (error) {
            setPreviewData(null);
            setPreviewError(resolveErrorMessage(error, 'Không thể xem trước thứ tự ảnh sau khi chèn.'));
            setPreviewProgress(0);
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleApply = async () => {
        if (!previewData?.summary?.can_apply) {
            setPreviewError('Cần preview thành công và không có sản phẩm bị chặn trước khi chạy thật.');
            return;
        }

        setApplyLoading(true);
        setApplyProgress(0);
        setPreviewError('');

        try {
            const response = await productImageApi.bulkAppendApply(
                buildAppendPayload(
                    queuedFiles,
                    selectedIds,
                    selectedScopeActive,
                    insertionMode,
                    afterIndex
                ),
                {
                    onUploadProgress: (event) => {
                        if (!event?.total) {
                            return;
                        }

                        setApplyProgress(Math.round((event.loaded / event.total) * 100));
                    },
                }
            );

            setApplyProgress(100);
            await Promise.resolve(onApplied?.(response.data));
            onClose?.();
        } catch (error) {
            setPreviewError(resolveErrorMessage(error, 'Không thể thêm ảnh hàng loạt.'));
            setApplyProgress(0);
        } finally {
            setApplyLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[116] bg-black/60 flex items-center justify-center p-4" onClick={() => { if (canClose) onClose?.(); }}>
            <div
                className="bg-white rounded p-6 w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                    <div>
                        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                            <span className="material-symbols-outlined">add_photo_alternate</span>
                            Thêm ảnh hàng loạt
                        </h2>
                        <p className="mt-2 text-[13px] text-primary/70">
                            Tải lên một hoặc nhiều ảnh mới, chọn phạm vi áp dụng và vị trí chèn đồng bộ cho toàn bộ sản phẩm trong phạm vi đó.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => { if (canClose) onClose?.(); }}
                        disabled={!canClose}
                        className="text-gray-500 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 space-y-5 mt-4">
                    <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3 text-[13px] text-primary/70">
                        {selectedScopeActive
                            ? `Đang chuẩn bị áp dụng cho ${selectedIds.length} sản phẩm đã chọn.`
                            : 'Đang chuẩn bị áp dụng cho toàn bộ sản phẩm hiện có.'}
                        {' '}Ảnh mới sẽ được thêm vào danh sách hiện tại, không ghi đè ảnh cũ.
                    </div>

                    <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                        <div className="rounded-sm border border-primary/10 bg-white p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => filesInputRef.current?.click()}
                                    className="inline-flex items-center justify-center gap-2 rounded-sm border border-primary/20 px-4 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-primary hover:border-primary hover:bg-primary/5"
                                >
                                    <span className="material-symbols-outlined text-[18px]">upload_file</span>
                                    Chọn nhiều ảnh
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setQueuedFiles([]);
                                        setSelectionNote('');
                                    }}
                                    className="inline-flex items-center justify-center gap-2 rounded-sm border border-brick/20 px-4 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-brick hover:bg-brick hover:text-white"
                                >
                                    <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                                    Xóa danh sách
                                </button>
                            </div>

                            <input
                                ref={filesInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                multiple
                                onChange={handleInputChange}
                            />

                            <div className="mt-4 rounded-sm border border-dashed border-primary/15 bg-primary/[0.02] p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary/60">Ảnh mới sẽ chèn</p>
                                        <p className="mt-1 text-[13px] text-primary/70">
                                            Thứ tự file trong danh sách này cũng là thứ tự ảnh mới sẽ được chèn vào từng sản phẩm.
                                        </p>
                                    </div>
                                    <div className="rounded-sm bg-white px-3 py-2 text-[12px] font-bold text-primary shadow-sm">
                                        {queuedFiles.length} file
                                    </div>
                                </div>

                                {selectionNote && (
                                    <p className="mt-3 text-[12px] text-primary/60">{selectionNote}.</p>
                                )}

                                {queuedFiles.length > 0 ? (
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                        {queuedFiles.map((file, index) => {
                                            const previewUrl = uploadPreviewUrlByIndex[index];

                                            return (
                                                <div key={buildFileIdentity(file)} className="rounded-sm border border-primary/10 bg-white overflow-hidden">
                                                    <div className="aspect-square bg-primary/[0.04] overflow-hidden">
                                                        {previewUrl ? (
                                                            <img src={previewUrl} alt={file.name} className="h-full w-full object-cover" />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center text-primary/25">
                                                                <span className="material-symbols-outlined text-[30px]">image</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="p-3">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="truncate text-[12px] font-bold text-primary">Ảnh mới #{index + 1}</p>
                                                                <p className="mt-1 truncate text-[11px] text-primary/65">{file.name}</p>
                                                                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-primary/40">
                                                                    {formatFileSize(file.size) || 'Không rõ kích thước'}
                                                                </p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveQueuedFile(file)}
                                                                className="rounded-sm p-1 text-primary/35 hover:text-brick"
                                                                title="Bỏ ảnh này khỏi danh sách"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-sm border border-dashed border-primary/10 bg-white px-4 py-10 text-center text-[12px] text-primary/45">
                                        Chưa có ảnh nào trong danh sách chèn.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4 space-y-4">
                            <div>
                                <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-primary">Phạm vi áp dụng</h3>
                                <p className="mt-2 text-[12px] text-primary/60">
                                    Chọn chạy cho toàn bộ sản phẩm hoặc chỉ các sản phẩm đang được tick.
                                </p>
                            </div>

                            <label className={`flex items-start gap-3 rounded-sm border px-3 py-3 cursor-pointer ${!selectedScopeActive ? 'border-primary/20 bg-primary/[0.03]' : 'border-stone-200 bg-white'}`}>
                                <input
                                    type="radio"
                                    name="bulk-image-scope"
                                    className="mt-1 size-4 accent-primary"
                                    checked={!selectedScopeActive}
                                    onChange={() => setScopeSelectedOnly(false)}
                                />
                                <span className="text-[12px] leading-5">
                                    <strong className="block text-primary">Tất cả sản phẩm</strong>
                                    Áp dụng cho toàn bộ sản phẩm hiện có trong admin.
                                </span>
                            </label>

                            <label className={`flex items-start gap-3 rounded-sm border px-3 py-3 ${selectedIds.length > 0 ? 'cursor-pointer' : 'cursor-not-allowed'} ${selectedScopeActive ? 'border-primary/20 bg-primary/[0.03]' : 'border-stone-200 bg-white'} ${selectedIds.length === 0 ? 'opacity-45' : ''}`}>
                                <input
                                    type="radio"
                                    name="bulk-image-scope"
                                    className="mt-1 size-4 accent-primary"
                                    checked={selectedScopeActive}
                                    disabled={selectedIds.length === 0}
                                    onChange={() => setScopeSelectedOnly(true)}
                                />
                                <span className="text-[12px] leading-5">
                                    <strong className="block text-primary">Chỉ sản phẩm đã chọn</strong>
                                    {selectedIds.length > 0
                                        ? `Giới hạn trong ${selectedIds.length} sản phẩm đang được tick.`
                                        : 'Chưa có sản phẩm nào được tick để giới hạn phạm vi.'}
                                </span>
                            </label>

                            <div className="border-t border-primary/10 pt-4">
                                <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-primary">Vị trí chèn</h3>
                                <p className="mt-2 text-[12px] text-primary/60">
                                    Vị trí này sẽ được áp dụng đồng bộ cho từng sản phẩm trong cùng phạm vi.
                                </p>

                                <div className="mt-3 grid gap-2">
                                    <label className={`flex items-start gap-3 rounded-sm border px-3 py-3 cursor-pointer ${insertionMode === 'start' ? 'border-primary/20 bg-primary/[0.03]' : 'border-stone-200 bg-white'}`}>
                                        <input
                                            type="radio"
                                            name="bulk-image-position"
                                            className="mt-1 size-4 accent-primary"
                                            checked={insertionMode === 'start'}
                                            onChange={() => setInsertionMode('start')}
                                        />
                                        <span className="text-[12px] leading-5">
                                            <strong className="block text-primary">Chèn lên đầu</strong>
                                            Ảnh mới sẽ đứng trước toàn bộ ảnh gốc hiện có.
                                        </span>
                                    </label>

                                    <label className={`flex items-start gap-3 rounded-sm border px-3 py-3 cursor-pointer ${insertionMode === 'after_index' ? 'border-primary/20 bg-primary/[0.03]' : 'border-stone-200 bg-white'}`}>
                                        <input
                                            type="radio"
                                            name="bulk-image-position"
                                            className="mt-1 size-4 accent-primary"
                                            checked={insertionMode === 'after_index'}
                                            onChange={() => setInsertionMode('after_index')}
                                        />
                                        <span className="min-w-0 flex-1 text-[12px] leading-5">
                                            <strong className="block text-primary">Chèn sau ảnh số X</strong>
                                            <span className="block text-primary/60">Mọi sản phẩm trong phạm vi phải có ít nhất X ảnh gốc thì mới chạy đồng bộ được.</span>
                                            <div className="mt-3 flex items-center gap-3">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={afterIndex}
                                                    onChange={(event) => setAfterIndex(Math.max(1, Number(event.target.value) || 1))}
                                                    className="h-10 w-28 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-bold text-primary outline-none focus:border-primary"
                                                    disabled={insertionMode !== 'after_index'}
                                                />
                                                <span className="text-[11px] text-primary/50">Sau ảnh số...</span>
                                            </div>
                                        </span>
                                    </label>

                                    <label className={`flex items-start gap-3 rounded-sm border px-3 py-3 cursor-pointer ${insertionMode === 'end' ? 'border-primary/20 bg-primary/[0.03]' : 'border-stone-200 bg-white'}`}>
                                        <input
                                            type="radio"
                                            name="bulk-image-position"
                                            className="mt-1 size-4 accent-primary"
                                            checked={insertionMode === 'end'}
                                            onChange={() => setInsertionMode('end')}
                                        />
                                        <span className="text-[12px] leading-5">
                                            <strong className="block text-primary">Chèn xuống cuối</strong>
                                            Ảnh mới sẽ được thêm sau toàn bộ ảnh gốc hiện có.
                                        </span>
                                    </label>
                                </div>

                                {previewData?.summary && insertionMode === 'after_index' && (
                                    <div className={`mt-3 rounded-sm border px-3 py-3 text-[12px] ${previewData.summary.can_apply ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                                        {supportedAfterIndexMax > 0
                                            ? `Đồng bộ hiện tại chỉ an toàn tới ảnh số ${supportedAfterIndexMax} cho toàn bộ phạm vi đang chọn.`
                                            : 'Trong phạm vi hiện tại đang có sản phẩm chưa có ảnh gốc, nên chế độ chèn sau ảnh số X sẽ bị chặn.'}
                                    </div>
                                )}
                            </div>

                            <button
                                type="button"
                                onClick={handlePreview}
                                disabled={!canPreview}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {previewLoading ? (
                                    <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                                ) : (
                                    <span className="material-symbols-outlined text-[18px]">preview</span>
                                )}
                                Xem trước thứ tự sau chèn
                            </button>

                            {previewLoading ? renderProgressBar(previewProgress) : null}
                            {applyLoading ? renderProgressBar(applyProgress, 'amber') : null}

                            {previewError && (
                                <div className="rounded-sm border border-brick/20 bg-brick/5 px-3 py-3 text-[12px] text-brick">
                                    {previewError}
                                </div>
                            )}

                            {previewData?.summary && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="rounded-sm bg-primary/[0.04] px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Sản phẩm mục tiêu</p>
                                        <p className="mt-2 text-xl font-black text-primary">{previewData.summary.target_products || 0}</p>
                                    </div>
                                    <div className="rounded-sm bg-primary/[0.04] px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Ảnh mới / sản phẩm</p>
                                        <p className="mt-2 text-xl font-black text-primary">{previewData.summary.new_images_per_product || 0}</p>
                                    </div>
                                    <div className="rounded-sm bg-green-50 px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-green-700/70">Sẵn sàng chạy</p>
                                        <p className="mt-2 text-xl font-black text-green-700">{previewData.summary.eligible_products || 0}</p>
                                    </div>
                                    <div className="rounded-sm bg-amber-50 px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700/70">Bị chặn</p>
                                        <p className="mt-2 text-xl font-black text-amber-700">{previewData.summary.blocking_products || 0}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    {previewData && (
                        <section className="space-y-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                                <div>
                                    <h3 className="text-[14px] font-black uppercase tracking-[0.14em] text-primary">Preview thứ tự ảnh sau chèn</h3>
                                    <p className="mt-1 text-[12px] text-primary/60">
                                        Hệ thống chỉ ghi dữ liệu thật sau khi bạn xác nhận chạy.
                                    </p>
                                </div>
                                <div className="rounded-sm bg-primary/[0.03] px-3 py-2 text-[11px] text-primary/60">
                                    {previewData.summary.hidden_preview_products > 0
                                        ? `Đang hiển thị ${previewData.products.length} / ${previewData.summary.target_products} sản phẩm đầu tiên`
                                        : `Đang hiển thị toàn bộ ${previewData.summary.target_products} sản phẩm trong phạm vi`}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {previewData.products.map((product) => {
                                    const statusMeta = getStatusMeta(product.status);

                                    return (
                                        <div key={product.product_id} className={`rounded-sm border p-4 ${statusMeta.cardClass}`}>
                                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="truncate text-[13px] font-bold text-primary">{product.product_name}</p>
                                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${statusMeta.badgeClass}`}>
                                                            {statusMeta.label}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-primary/60">
                                                        <span>{product.product_sku || 'Chưa có SKU'}</span>
                                                        <span>{product.existing_image_count} ảnh gốc</span>
                                                        <span>{product.resulting_image_count} ảnh sau chèn</span>
                                                        <span>{product.insertion_label}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {product.error_message && (
                                                <div className="mt-3 rounded-sm border border-brick/20 bg-white/80 px-3 py-2 text-[12px] text-brick">
                                                    {product.error_message}
                                                </div>
                                            )}

                                            <div className="mt-4 overflow-x-auto pb-2 custom-scrollbar">
                                                <div className="flex min-w-max items-start gap-3">
                                                    {product.preview_items.map((item, index) => {
                                                        const previewUrl = item.kind === 'new'
                                                            ? uploadPreviewUrlByIndex[item.upload_index] || ''
                                                            : (item.thumbnail_url || item.image_url || '');

                                                        return (
                                                            <React.Fragment key={`${product.product_id}-${item.kind}-${item.image_id || item.upload_index || index}`}>
                                                                <div className={`relative w-28 overflow-hidden rounded-sm border bg-white ${item.kind === 'new' ? 'border-primary/15 shadow-sm' : 'border-stone-200'}`}>
                                                                    <div className="aspect-square overflow-hidden bg-primary/[0.04]">
                                                                        {previewUrl ? (
                                                                            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                                                                        ) : (
                                                                            <div className="flex h-full w-full items-center justify-center text-primary/20">
                                                                                <span className="material-symbols-outlined text-[24px]">image</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="p-2">
                                                                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                                            {item.kind === 'new' ? `Mới #${item.position_after}` : `Gốc #${item.position_after}`}
                                                                        </p>
                                                                        <p className="mt-1 line-clamp-2 text-[11px] font-bold text-primary">{item.file_name}</p>
                                                                    </div>

                                                                    {item.kind === 'new' && (
                                                                        <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-white">
                                                                            Mới
                                                                        </span>
                                                                    )}

                                                                    {item.is_primary_after && (
                                                                        <span className="absolute right-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-white">
                                                                            Chính
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {index < product.preview_items.length - 1 && (
                                                                    <span className="material-symbols-outlined mt-12 text-primary/20">east</span>
                                                                )}
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}
                </div>

                <div className="mt-6 flex flex-col gap-3 border-t border-primary/10 pt-4 md:flex-row md:items-center md:justify-between">
                    <p className="text-[12px] text-primary/60">
                        {previewData?.summary?.can_apply
                            ? `Sẵn sàng thêm ${previewData.summary.inserted_records} ảnh mới cho ${previewData.summary.eligible_products} sản phẩm.`
                            : 'Hãy preview và xử lý các sản phẩm bị chặn trước khi xác nhận chạy thật.'}
                    </p>
                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => { if (canClose) onClose?.(); }}
                            disabled={!canClose}
                            className="px-4 py-2 border border-primary/20 text-primary rounded-sm font-bold text-[13px] hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Hủy bỏ
                        </button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={!canApply}
                            className="px-6 py-2 bg-amber-600 text-white rounded-sm font-bold text-[13px] hover:bg-amber-700 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {applyLoading ? (
                                <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                            ) : (
                                <span className="material-symbols-outlined text-[16px]">publish</span>
                            )}
                            Xác nhận thêm ảnh
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductImageBulkAppendModal;
