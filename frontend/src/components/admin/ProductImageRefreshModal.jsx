import React, { useEffect, useRef, useState } from 'react';
import { productImageApi } from '../../services/api';

const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);

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

function buildUploadPayload(files, selectedIds, scopeSelectedOnly, updateAllMatches) {
    const formData = new FormData();

    files.forEach((file) => {
        formData.append('images[]', file);
    });

    selectedIds.forEach((id) => {
        formData.append('product_ids[]', String(id));
    });

    formData.append('scope_selected_only', scopeSelectedOnly ? '1' : '0');
    formData.append('update_all_matches', updateAllMatches ? '1' : '0');

    return formData;
}

function getStatusMeta(status) {
    if (status === 'ready') {
        return {
            label: 'Sẵn sàng cập nhật',
            badgeClass: 'bg-green-50 text-green-700 border-green-200',
            cardClass: 'border-green-200 bg-green-50/60',
        };
    }

    if (status === 'unmatched') {
        return {
            label: 'Không match',
            badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
            cardClass: 'border-stone-200 bg-stone-50',
        };
    }

    if (status === 'ambiguous') {
        return {
            label: 'Trùng nhiều kết quả',
            badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
            cardClass: 'border-amber-200 bg-amber-50/70',
        };
    }

    return {
        label: 'Trùng tên trong bộ upload',
        badgeClass: 'bg-brick/10 text-brick border-brick/20',
        cardClass: 'border-brick/20 bg-brick/5',
    };
}

const ProductImageRefreshModal = ({
    open,
    selectedIds = [],
    onClose,
    onApplied,
}) => {
    const folderInputRef = useRef(null);
    const filesInputRef = useRef(null);
    const [queuedFiles, setQueuedFiles] = useState([]);
    const [selectionNote, setSelectionNote] = useState('');
    const [scopeSelectedOnly, setScopeSelectedOnly] = useState(selectedIds.length > 0);
    const [updateAllMatches, setUpdateAllMatches] = useState(false);
    const [previewData, setPreviewData] = useState(null);
    const [previewError, setPreviewError] = useState('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [applyLoading, setApplyLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            return;
        }

        setQueuedFiles([]);
        setSelectionNote('');
        setScopeSelectedOnly(selectedIds.length > 0);
        setUpdateAllMatches(false);
        setPreviewData(null);
        setPreviewError('');
        setPreviewLoading(false);
        setApplyLoading(false);
    }, [open, selectedIds.length]);

    useEffect(() => {
        if (!open || selectedIds.length > 0) {
            return;
        }

        setScopeSelectedOnly(false);
    }, [open, selectedIds.length]);

    useEffect(() => {
        if (!folderInputRef.current) {
            return;
        }

        folderInputRef.current.setAttribute('webkitdirectory', '');
        folderInputRef.current.setAttribute('directory', '');
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }

        setPreviewData(null);
        setPreviewError('');
    }, [queuedFiles, scopeSelectedOnly, updateAllMatches, open]);

    if (!open) {
        return null;
    }

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
            setPreviewError('Hãy chọn thư mục hoặc thêm nhiều ảnh trước khi xem trước.');
            return;
        }

        setPreviewLoading(true);
        setPreviewError('');

        try {
            const response = await productImageApi.bulkRefreshPreview(
                buildUploadPayload(queuedFiles, selectedIds, scopeSelectedOnly && selectedIds.length > 0, updateAllMatches)
            );

            setPreviewData(response.data);
        } catch (error) {
            setPreviewData(null);
            setPreviewError(error.response?.data?.message || 'Không thể xem trước kết quả match ảnh.');
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleApply = async () => {
        if (!previewData || Number(previewData?.summary?.ready_files || 0) === 0) {
            setPreviewError('Cần xem trước và có ít nhất 1 ảnh match được trước khi cập nhật thật.');
            return;
        }

        setApplyLoading(true);
        setPreviewError('');

        try {
            const response = await productImageApi.bulkRefreshApply(
                buildUploadPayload(queuedFiles, selectedIds, scopeSelectedOnly && selectedIds.length > 0, updateAllMatches)
            );

            await Promise.resolve(onApplied?.(response.data));
            onClose?.();
        } catch (error) {
            setPreviewError(error.response?.data?.message || 'Không thể cập nhật ảnh hàng loạt.');
        } finally {
            setApplyLoading(false);
        }
    };

    const readyItems = (previewData?.items || []).filter((item) => item.status === 'ready');
    const unmatchedItems = (previewData?.items || []).filter((item) => item.status === 'unmatched');
    const ambiguousItems = (previewData?.items || []).filter((item) => item.status === 'ambiguous');
    const duplicateInputItems = (previewData?.items || []).filter((item) => item.status === 'duplicate_input');
    const canClose = !previewLoading && !applyLoading;

    const renderMatchItem = (item) => {
        const statusMeta = getStatusMeta(item.status);

        return (
            <div key={item.normalized_name} className={`rounded-sm border p-4 ${statusMeta.cardClass}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-bold text-primary">{item.file_name}</p>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${statusMeta.badgeClass}`}>
                                {statusMeta.label}
                            </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-primary/60">
                            <span>{item.input_count} file trong lần upload này</span>
                            <span>{item.candidate_count} bản ghi đang dùng tên này</span>
                            {item.status === 'ready' && <span>Sẽ cập nhật {item.target_count} bản ghi</span>}
                        </div>
                    </div>
                </div>

                {item.status === 'duplicate_input' && (
                    <div className="mt-3 rounded-sm border border-brick/15 bg-white/80 px-3 py-2 text-[12px] text-brick">
                        Bộ ảnh vừa chọn đang có nhiều file trùng cùng tên này. Hãy giữ lại 1 file duy nhất để map ổn định.
                    </div>
                )}

                {item.status === 'unmatched' && (
                    <div className="mt-3 rounded-sm border border-stone-200 bg-white/80 px-3 py-2 text-[12px] text-stone-600">
                        Không tìm thấy ProductImage nào đang lưu theo tên file này trong phạm vi hiện tại.
                    </div>
                )}

                {item.status === 'ambiguous' && (
                    <div className="mt-3 rounded-sm border border-amber-200 bg-white/80 px-3 py-2 text-[12px] text-amber-800">
                        Tên file này đang khớp nhiều ProductImage. Bật tùy chọn cập nhật tất cả nếu bạn muốn đè ảnh này lên ảnh cũ cho toàn bộ các bản ghi đang dùng chung.
                    </div>
                )}

                {item.candidate_records?.length > 0 && (
                    <div className="mt-3 space-y-2">
                        {item.candidate_records.map((record) => (
                            <div key={record.product_image_id} className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white/90 px-3 py-2">
                                <div className="size-12 shrink-0 overflow-hidden rounded-sm border border-primary/10 bg-primary/5">
                                    {record.thumbnail_url ? (
                                        <img src={record.thumbnail_url} alt="" className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center text-primary/30">
                                            <span className="material-symbols-outlined text-[18px]">image</span>
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="truncate text-[12px] font-bold text-primary">{record.product_name}</p>
                                        {record.is_primary && (
                                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                                Ảnh đại diện
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-primary/55">
                                        <span>{record.product_sku || 'Chưa có SKU'}</span>
                                        <span>Match theo {record.matched_by === 'file_name' ? 'file_name' : 'tên asset gốc'}</span>
                                        <span>{record.matched_name || record.file_name || 'Không có tên lưu'}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-[115] bg-black/60 flex items-center justify-center p-4" onClick={() => { if (canClose) onClose?.(); }}>
            <div
                className="bg-white rounded p-6 w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                    <div>
                        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                            <span className="material-symbols-outlined">imagesmode</span>
                            Cập nhật lại ảnh
                        </h2>
                        <p className="mt-2 text-[13px] text-primary/70">
                            Chọn 1 thư mục hoặc nhiều ảnh mới. Hệ thống sẽ so khớp theo đúng tên file đã lưu trước đó, sau đó hiển thị preview match trước khi cập nhật thật.
                        </p>
                    </div>
                    <button type="button" onClick={() => { if (canClose) onClose?.(); }} disabled={!canClose} className="text-gray-500 hover:text-brick disabled:cursor-not-allowed disabled:opacity-40">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="overflow-y-auto pr-2 custom-scrollbar flex-1 space-y-5 mt-4">
                    <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3 text-[13px] text-primary/70">
                        {selectedIds.length > 0 && scopeSelectedOnly
                            ? `Đang giới hạn trong ${selectedIds.length} sản phẩm đã chọn.`
                            : 'Đang quét toàn bộ danh sách sản phẩm hiện có.'}
                        {' '}Nếu 1 tên ảnh đang được nhiều bản ghi dùng chung, bạn có thể bật tùy chọn cập nhật tất cả bên dưới.
                    </div>

                    <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                        <div className="rounded-sm border border-primary/10 bg-white p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => folderInputRef.current?.click()}
                                    className="inline-flex items-center justify-center gap-2 rounded-sm border border-primary/20 px-4 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-primary hover:border-primary hover:bg-primary/5"
                                >
                                    <span className="material-symbols-outlined text-[18px]">folder_open</span>
                                    Chọn thư mục
                                </button>
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
                                ref={folderInputRef}
                                type="file"
                                className="hidden"
                                multiple
                                onChange={handleInputChange}
                            />
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
                                        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary/60">Bộ ảnh mới</p>
                                        <p className="mt-1 text-[13px] text-primary/70">
                                            Nên giữ nguyên tên file đã upload trước đó để hệ thống tự so khớp ổn định.
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
                                    <div className="mt-4 max-h-[220px] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                                        {queuedFiles.map((file) => (
                                            <div key={buildFileIdentity(file)} className="flex items-center justify-between gap-3 rounded-sm border border-primary/10 bg-white px-3 py-2">
                                                <div className="min-w-0">
                                                    <p className="truncate text-[12px] font-bold text-primary">{file.name}</p>
                                                    <p className="mt-1 text-[11px] text-primary/55">{formatFileSize(file.size) || 'Kích thước không xác định'}</p>
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
                                        ))}
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-sm border border-dashed border-primary/10 bg-white px-4 py-8 text-center text-[12px] text-primary/45">
                                        Chưa có ảnh nào trong danh sách chờ preview.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="rounded-sm border border-primary/10 bg-white p-4 space-y-4">
                            <div>
                                <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-primary">Phạm vi cập nhật</h3>
                                <p className="mt-2 text-[12px] text-primary/60">
                                    Bạn có thể giới hạn trong các sản phẩm đang tick hoặc quét cả danh sách.
                                </p>
                            </div>

                            <label className={`flex items-start gap-3 rounded-sm border px-3 py-3 ${selectedIds.length > 0 ? 'border-primary/15 bg-primary/[0.03] cursor-pointer' : 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed'}`}>
                                <input
                                    type="checkbox"
                                    className="mt-1 size-4 accent-primary"
                                    checked={scopeSelectedOnly && selectedIds.length > 0}
                                    disabled={selectedIds.length === 0}
                                    onChange={(event) => setScopeSelectedOnly(event.target.checked)}
                                />
                                <span className="text-[12px] leading-5">
                                    <strong className="block text-primary">Chỉ quét trong sản phẩm đang chọn</strong>
                                    {selectedIds.length > 0
                                        ? `Chỉ map trong ${selectedIds.length} sản phẩm đang tick.`
                                        : 'Chưa có sản phẩm nào được tick, nên hệ thống sẽ quét toàn bộ.'}
                                </span>
                            </label>

                            <label className="flex items-start gap-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="mt-1 size-4 accent-amber-600"
                                    checked={updateAllMatches}
                                    onChange={(event) => setUpdateAllMatches(event.target.checked)}
                                />
                                <span className="text-[12px] leading-5 text-amber-900">
                                    <strong className="block">Cập nhật tất cả bản ghi đang dùng chung tên ảnh</strong>
                                    Nếu 1 tên file khớp nhiều ProductImage, hệ thống sẽ cập nhật đè ảnh này lên ảnh cũ cho toàn bộ bản ghi đang match.
                                </span>
                            </label>

                            <button
                                type="button"
                                onClick={handlePreview}
                                disabled={previewLoading || queuedFiles.length === 0}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {previewLoading ? (
                                    <span className="material-symbols-outlined animate-spin text-[18px]">sync</span>
                                ) : (
                                    <span className="material-symbols-outlined text-[18px]">preview</span>
                                )}
                                Xem trước kết quả match
                            </button>

                            {previewError && (
                                <div className="rounded-sm border border-brick/20 bg-brick/5 px-3 py-3 text-[12px] text-brick">
                                    {previewError}
                                </div>
                            )}

                            {previewData?.summary && (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="rounded-sm bg-primary/[0.04] px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Match sẵn sàng</p>
                                        <p className="mt-2 text-xl font-black text-primary">{previewData.summary.ready_files || 0}</p>
                                    </div>
                                    <div className="rounded-sm bg-primary/[0.04] px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/45">Bản ghi sẽ đổi</p>
                                        <p className="mt-2 text-xl font-black text-primary">{previewData.summary.matched_records || 0}</p>
                                    </div>
                                    <div className="rounded-sm bg-stone-100 px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone-500">Không match</p>
                                        <p className="mt-2 text-xl font-black text-stone-700">{previewData.summary.unmatched_files || 0}</p>
                                    </div>
                                    <div className="rounded-sm bg-amber-50 px-3 py-3">
                                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-700/70">Cần xử lý tay</p>
                                        <p className="mt-2 text-xl font-black text-amber-700">{(previewData.summary.ambiguous_files || 0) + (previewData.summary.duplicate_input_files || 0)}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    {previewData && (
                        <section className="space-y-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                                <div>
                                    <h3 className="text-[14px] font-black uppercase tracking-[0.14em] text-primary">Kết quả preview</h3>
                                    <p className="mt-1 text-[12px] text-primary/60">
                                        Dữ liệu chỉ được ghi vào server khi bạn bấm xác nhận cập nhật thật.
                                    </p>
                                </div>
                                <div className="rounded-sm bg-primary/[0.03] px-3 py-2 text-[11px] text-primary/60">
                                    {previewData.options?.scope_selected_only
                                        ? `Đang preview trong ${previewData.options?.scoped_product_count || 0} sản phẩm được chọn`
                                        : 'Đang preview trên toàn bộ danh sách sản phẩm'}
                                </div>
                            </div>

                            {readyItems.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-[13px] font-black uppercase tracking-[0.14em] text-green-700">Match được và sẵn sàng cập nhật</h4>
                                    {readyItems.map(renderMatchItem)}
                                </div>
                            )}

                            {ambiguousItems.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-[13px] font-black uppercase tracking-[0.14em] text-amber-700">Trùng nhiều kết quả</h4>
                                    {ambiguousItems.map(renderMatchItem)}
                                </div>
                            )}

                            {unmatchedItems.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-[13px] font-black uppercase tracking-[0.14em] text-stone-700">Không match được</h4>
                                    {unmatchedItems.map(renderMatchItem)}
                                </div>
                            )}

                            {duplicateInputItems.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-[13px] font-black uppercase tracking-[0.14em] text-brick">Trùng tên ngay trong bộ upload</h4>
                                    {duplicateInputItems.map(renderMatchItem)}
                                </div>
                            )}
                        </section>
                    )}
                </div>

                <div className="mt-6 flex flex-col gap-3 border-t border-primary/10 pt-4 md:flex-row md:items-center md:justify-between">
                    <p className="text-[12px] text-primary/60">
                        {previewData?.summary?.ready_files > 0
                            ? `Sẵn sàng cập nhật ${previewData.summary.matched_records} bản ghi ảnh.`
                            : 'Chưa có bản ghi sẵn sàng cập nhật.'}
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
                            disabled={applyLoading || previewLoading || !previewData || Number(previewData?.summary?.ready_files || 0) === 0}
                            className="px-6 py-2 bg-primary text-white rounded-sm font-bold text-[13px] hover:bg-primary/90 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {applyLoading ? (
                                <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                            ) : (
                                <span className="material-symbols-outlined text-[16px]">publish</span>
                            )}
                            Xác nhận cập nhật thật
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductImageRefreshModal;
