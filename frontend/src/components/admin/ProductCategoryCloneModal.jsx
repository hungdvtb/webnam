import React, { useEffect, useMemo, useRef, useState } from 'react';
import { productCategoryCloneApi } from '../../services/api';
import { formatWholeMoneyInput, normalizeWholeMoneyDraft } from '../../utils/money';

const PRODUCT_TYPE_LABELS = {
    simple: 'Sản phẩm',
    configurable: 'Có biến thể',
    bundle: 'Combo',
    grouped: 'Nhóm',
};

const cloneName = (value = '') => String(value)
    .replace(/M2/g, 'M3')
    .replace(/m2/g, 'm3')
    .replace(/mẫu 2/gi, 'mẫu 3');

const parseApiErrors = (error) => {
    const errors = error?.response?.data?.errors;
    if (!errors || typeof errors !== 'object') {
        return { rowErrors: {}, message: error?.response?.data?.message || 'Không thể thực hiện thao tác.' };
    }

    const rowErrors = {};
    let message = '';

    Object.entries(errors).forEach(([key, values]) => {
        const text = Array.isArray(values) ? values.join(' ') : String(values || '');
        const match = key.match(/^rows\.(\d+)\.(name|sku|expected_cost|price)$/);
        if (match) {
            rowErrors[`${match[1]}.${match[2]}`] = text;
            return;
        }

        if (!message && text) {
            message = text;
        }
    });

    return { rowErrors, message: message || 'Một số dòng chưa hợp lệ.' };
};

const ProductCategoryCloneModal = ({
    open,
    categories = [],
    initialSourceCategoryId = '',
    onClose,
    onCopied,
}) => {
    const requestRef = useRef(0);
    const [sourceCategoryId, setSourceCategoryId] = useState('');
    const [targetCategoryName, setTargetCategoryName] = useState('');
    const [preview, setPreview] = useState(null);
    const [rows, setRows] = useState([]);
    const [viewStep, setViewStep] = useState('idle');
    const [selectedProductIds, setSelectedProductIds] = useState(() => new Set());
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [noticeMessage, setNoticeMessage] = useState('');
    const [rowErrors, setRowErrors] = useState({});
    const [search, setSearch] = useState('');
    const [replaceFind, setReplaceFind] = useState('');
    const [replaceWith, setReplaceWith] = useState('');
    const [replaceScope, setReplaceScope] = useState('both');

    const sourceCategory = useMemo(
        () => categories.find((category) => String(category.id) === String(sourceCategoryId)),
        [categories, sourceCategoryId],
    );

    useEffect(() => {
        if (!open) {
            return;
        }

        const resolvedSourceId = initialSourceCategoryId
            && categories.some((category) => String(category.id) === String(initialSourceCategoryId))
            ? String(initialSourceCategoryId)
            : '';

        setSourceCategoryId(resolvedSourceId);
        setTargetCategoryName('');
        setPreview(null);
        setRows([]);
        setViewStep('idle');
        setSelectedProductIds(new Set());
        setErrorMessage('');
        setNoticeMessage('');
        setRowErrors({});
        setSearch('');
        setReplaceFind('');
        setReplaceWith('');
        setReplaceScope('both');
    }, [categories, initialSourceCategoryId, open]);

    useEffect(() => {
        if (!open || !sourceCategory || targetCategoryName) {
            return;
        }

        setTargetCategoryName(cloneName(sourceCategory.name));
    }, [open, sourceCategory, targetCategoryName]);

    const loadPreview = async () => {
        if (!sourceCategoryId) {
            setErrorMessage('Chọn danh mục nguồn trước.');
            return;
        }

        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        setLoadingPreview(true);
        setErrorMessage('');
        setNoticeMessage('');
        setRowErrors({});

        try {
            const response = await productCategoryCloneApi.preview({
                source_category_id: sourceCategoryId,
                target_category_name: targetCategoryName,
            });

            if (requestRef.current !== requestId) {
                return;
            }

            const nextPreview = response.data || {};
            const nextRows = Array.isArray(nextPreview.rows) ? nextPreview.rows : [];
            setPreview(nextPreview);
            setRows([]);
            setSelectedProductIds(new Set(nextRows.map((row) => String(row.source_product_id))));
            setViewStep('select');
            if (nextPreview.target_category?.name) {
                setTargetCategoryName(nextPreview.target_category.name);
            }
        } catch (error) {
            if (requestRef.current !== requestId) {
                return;
            }

            setPreview(null);
            setRows([]);
            setSelectedProductIds(new Set());
            setViewStep('idle');
            setNoticeMessage('');
            setErrorMessage(error?.response?.data?.message || 'Không tải được danh sách copy.');
        } finally {
            if (requestRef.current === requestId) {
                setLoadingPreview(false);
            }
        }
    };

    const updateRow = (sourceProductId, field, value) => {
        const rowIndex = rows.findIndex((row) => String(row.source_product_id) === String(sourceProductId));
        setRows((currentRows) => currentRows.map((row) => (
            String(row.source_product_id) === String(sourceProductId)
                ? { ...row, [field]: value }
                : row
        )));
        setRowErrors((currentErrors) => {
            const nextErrors = { ...currentErrors };
            if (rowIndex >= 0) {
                delete nextErrors[`${rowIndex}.${field}`];
            }
            return nextErrors;
        });
    };

    const previewRows = useMemo(() => (Array.isArray(preview?.rows) ? preview.rows : []), [preview]);

    const collectDescendantIds = (rowToCollect, sourceRows = previewRows) => {
        const ids = new Set([String(rowToCollect.source_product_id)]);
        let foundChild = true;

        while (foundChild) {
            foundChild = false;
            sourceRows.forEach((row) => {
                const parentId = row.parent_source_product_id === null || row.parent_source_product_id === undefined
                    ? ''
                    : String(row.parent_source_product_id);
                const sourceId = String(row.source_product_id);

                if (parentId && ids.has(parentId) && !ids.has(sourceId)) {
                    ids.add(sourceId);
                    foundChild = true;
                }
            });
        }

        return ids;
    };

    const toggleSelection = (rowToToggle, checked) => {
        setSelectedProductIds((currentIds) => {
            const nextIds = new Set(currentIds);
            const sourceId = String(rowToToggle.source_product_id);

            if (checked) {
                if (rowToToggle.level === 'parent') {
                    collectDescendantIds(rowToToggle).forEach((id) => nextIds.add(id));
                    return nextIds;
                }

                nextIds.add(sourceId);

                let parentId = rowToToggle.parent_source_product_id === null || rowToToggle.parent_source_product_id === undefined
                    ? ''
                    : String(rowToToggle.parent_source_product_id);
                while (parentId) {
                    nextIds.add(parentId);
                    const parentRow = previewRows.find((row) => String(row.source_product_id) === parentId);
                    parentId = parentRow?.parent_source_product_id === null || parentRow?.parent_source_product_id === undefined
                        ? ''
                        : String(parentRow.parent_source_product_id);
                }

                return nextIds;
            }

            const idsToRemove = rowToToggle.level === 'parent'
                ? collectDescendantIds(rowToToggle)
                : new Set([sourceId]);
            idsToRemove.forEach((id) => nextIds.delete(id));

            return nextIds;
        });
        setErrorMessage('');
        setNoticeMessage('');
    };

    const selectAllRows = () => {
        setSelectedProductIds(new Set(previewRows.map((row) => String(row.source_product_id))));
        setErrorMessage('');
        setNoticeMessage('');
    };

    const clearSelectedRows = () => {
        setSelectedProductIds(new Set());
        setErrorMessage('');
        setNoticeMessage('');
    };

    const continueToEditRows = () => {
        const nextRows = previewRows.filter((row) => selectedProductIds.has(String(row.source_product_id)));

        if (nextRows.length === 0) {
            setErrorMessage('Chọn ít nhất một sản phẩm để copy.');
            setNoticeMessage('');
            return;
        }

        setRows(nextRows);
        setViewStep('edit');
        setSearch('');
        setReplaceFind('');
        setReplaceWith('');
        setReplaceScope('both');
        setRowErrors({});
        setErrorMessage('');
        setNoticeMessage('');
    };

    const backToSelectRows = () => {
        setSelectedProductIds(new Set(rows.map((row) => String(row.source_product_id))));
        setViewStep('select');
        setSearch('');
        setRowErrors({});
        setErrorMessage('');
        setNoticeMessage('');
    };

    const applyFindReplace = () => {
        const needle = replaceFind;
        if (!needle) {
            setErrorMessage('Nhập nội dung cần tìm trước.');
            setNoticeMessage('');
            return;
        }

        const shouldReplaceName = replaceScope === 'both' || replaceScope === 'name';
        const shouldReplaceSku = replaceScope === 'both' || replaceScope === 'sku';
        let replacementCount = 0;

        const replaceInText = (value) => {
            const text = String(value ?? '');
            if (!text.includes(needle)) {
                return text;
            }

            replacementCount += text.split(needle).length - 1;
            return text.split(needle).join(replaceWith);
        };

        const nextRows = rows.map((row) => ({
            ...row,
            name: shouldReplaceName ? replaceInText(row.name) : row.name,
            sku: shouldReplaceSku ? replaceInText(row.sku) : row.sku,
        }));

        setRows(nextRows);
        setRowErrors({});
        setErrorMessage('');
        setNoticeMessage(replacementCount > 0
            ? `Đã thay thế ${replacementCount} lần.`
            : 'Không tìm thấy nội dung cần thay thế.');
    };

    const removeRow = (rowToRemove) => {
        const removeIds = new Set([String(rowToRemove.source_product_id)]);

        if (rowToRemove.level === 'parent') {
            let foundChild = true;
            while (foundChild) {
                foundChild = false;
                rows.forEach((row) => {
                    const parentId = row.parent_source_product_id === null || row.parent_source_product_id === undefined
                        ? ''
                        : String(row.parent_source_product_id);
                    const sourceId = String(row.source_product_id);

                    if (parentId && removeIds.has(parentId) && !removeIds.has(sourceId)) {
                        removeIds.add(sourceId);
                        foundChild = true;
                    }
                });
            }
        }

        const nextRows = rows.filter((row) => !removeIds.has(String(row.source_product_id)));
        const removedCount = rows.length - nextRows.length;

        setRows(nextRows);
        setRowErrors({});
        setErrorMessage('');
        setNoticeMessage(removedCount > 1
            ? `Đã bỏ ${removedCount} dòng khỏi bản copy.`
            : 'Đã bỏ 1 dòng khỏi bản copy.');
    };

    const handleApply = async () => {
        if (viewStep !== 'edit' || !sourceCategoryId || rows.length === 0 || submitting) {
            return;
        }

        setSubmitting(true);
        setErrorMessage('');
        setNoticeMessage('');
        setRowErrors({});

        try {
            const response = await productCategoryCloneApi.apply({
                source_category_id: sourceCategoryId,
                target_category_name: targetCategoryName,
                rows: rows.map((row) => ({
                    source_product_id: row.source_product_id,
                    name: row.name,
                    sku: row.sku,
                    expected_cost: row.expected_cost === '' ? null : row.expected_cost,
                    price: row.price,
                })),
            });

            onCopied?.(response.data);
        } catch (error) {
            const parsedErrors = parseApiErrors(error);
            setRowErrors(parsedErrors.rowErrors);
            setNoticeMessage('');
            setErrorMessage(parsedErrors.message);
        } finally {
            setSubmitting(false);
        }
    };

    const duplicateSkuSet = useMemo(() => {
        const counts = new Map();
        rows.forEach((row) => {
            const sku = String(row.sku || '').trim().toUpperCase();
            if (!sku) {
                return;
            }
            counts.set(sku, (counts.get(sku) || 0) + 1);
        });

        return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([sku]) => sku));
    }, [rows]);

    const normalizedSearch = search.trim().toLowerCase();
    const matchesSearch = (row) => [
            row.current_name,
            row.name,
            row.current_sku,
            row.sku,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch));

    const filteredSelectionRows = useMemo(() => {
        if (!normalizedSearch) {
            return previewRows;
        }

        return previewRows.filter(matchesSearch);
    }, [normalizedSearch, previewRows]);

    const filteredRows = useMemo(() => {
        if (!normalizedSearch) {
            return rows;
        }

        return rows.filter(matchesSearch);
    }, [normalizedSearch, rows]);

    const sourceOptions = useMemo(() => (
        categories
            .filter((category) => category?.id && category?.name)
            .map((category) => ({
                value: String(category.id),
                label: category.products_count !== undefined
                    ? `${category.name} (${category.products_count})`
                    : category.name,
            }))
    ), [categories]);

    const removedRowCount = preview?.summary?.total_rows
        ? Math.max(0, Number(preview.summary.total_rows) - rows.length)
        : 0;
    const selectedRowCount = previewRows.filter((row) => selectedProductIds.has(String(row.source_product_id))).length;
    const selectedRootCount = previewRows.filter((row) => row.level === 'parent' && selectedProductIds.has(String(row.source_product_id))).length;
    const selectedChildCount = selectedRowCount - selectedRootCount;
    const selectedRemovedCount = preview?.summary?.total_rows
        ? Math.max(0, Number(preview.summary.total_rows) - selectedRowCount)
        : 0;

    const canContinue = viewStep === 'select'
        && selectedRowCount > 0
        && !submitting
        && !loadingPreview;

    const canApply = viewStep === 'edit'
        && rows.length > 0
        && sourceCategoryId
        && targetCategoryName.trim()
        && duplicateSkuSet.size === 0
        && !submitting
        && !loadingPreview;

    const footerSummary = (() => {
        if (!preview?.summary) {
            return 'Chưa tải preview';
        }

        if (viewStep === 'select') {
            return `${selectedRootCount} cha · ${selectedChildCount} con · đã chọn ${selectedRowCount}/${preview.summary.total_rows} dòng${selectedRemovedCount > 0 ? ` · bỏ ${selectedRemovedCount}` : ''}${Number(preview.summary.skipped_products || 0) > 0 ? ` · bỏ qua ${preview.summary.skipped_products}` : ''}`;
        }

        return `${preview.summary.root_products} cha · ${preview.summary.child_products} con · ${rows.length}/${preview.summary.total_rows} dòng${removedRowCount > 0 ? ` · đã bỏ ${removedRowCount}` : ''}${Number(preview.summary.skipped_products || 0) > 0 ? ` · bỏ qua ${preview.summary.skipped_products}` : ''}`;
    })();

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/60 p-3" onClick={() => !submitting && onClose?.()}>
            <div
                className="flex max-h-[94vh] w-full max-w-[1380px] flex-col overflow-hidden rounded bg-white shadow-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-primary/10 px-5 py-4">
                    <div>
                        <h2 className="text-lg font-black text-primary">Copy danh mục sản phẩm</h2>
                        <div className="mt-1 text-[12px] text-primary/55">
                            Preview trước khi tạo bản copy.
                        </div>
                    </div>
                    <button type="button" onClick={onClose} disabled={submitting} className="text-primary/50 hover:text-brick disabled:opacity-50">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="border-b border-primary/10 px-5 py-4">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr_auto] lg:items-end">
                        <label className="block">
                            <span className="text-[12px] font-bold text-primary/70">Danh mục nguồn</span>
                            <select
                                value={sourceCategoryId}
                                onChange={(event) => {
                                    const nextId = event.target.value;
                                    const nextCategory = categories.find((category) => String(category.id) === String(nextId));
                                    setSourceCategoryId(nextId);
                                    setTargetCategoryName(nextCategory ? cloneName(nextCategory.name) : '');
                                    setPreview(null);
                                    setRows([]);
                                    setViewStep('idle');
                                    setSelectedProductIds(new Set());
                                    setErrorMessage('');
                                    setNoticeMessage('');
                                    setRowErrors({});
                                }}
                                disabled={loadingPreview || submitting}
                                className="mt-1 h-10 w-full rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                            >
                                <option value="">Chọn danh mục nguồn...</option>
                                {sourceOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>

                        <span className="hidden pb-2 text-primary/45 lg:block">
                            <span className="material-symbols-outlined">arrow_forward</span>
                        </span>

                        <label className="block">
                            <span className="text-[12px] font-bold text-primary/70">Danh mục đích</span>
                            <input
                                type="text"
                                value={targetCategoryName}
                                onChange={(event) => setTargetCategoryName(event.target.value)}
                                disabled={loadingPreview || submitting}
                                className="mt-1 h-10 w-full rounded-sm border border-primary/20 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                placeholder="Nhập tên danh mục mẫu mới"
                            />
                        </label>

                        <button
                            type="button"
                            onClick={loadPreview}
                            disabled={!sourceCategoryId || loadingPreview || submitting}
                            className="h-10 rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-wider text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loadingPreview ? 'Đang tải...' : 'Tải danh sách'}
                        </button>
                    </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
                    <div className="mb-3">
                        {viewStep === 'select' ? (
                            <div className="flex flex-wrap items-end justify-between gap-2 rounded-sm border border-primary/10 bg-slate-50 px-3 py-2">
                                <label className="block">
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-primary/50">Tìm tên/SKU</span>
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        disabled={previewRows.length === 0 || submitting}
                                        className="mt-1 h-9 w-64 rounded-sm border border-primary/15 bg-white px-3 text-[13px] outline-none focus:border-primary"
                                        placeholder="Tìm tên hoặc SKU..."
                                    />
                                </label>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-sm border border-primary/10 bg-white px-3 py-2 text-[12px] font-bold text-primary">
                                        Đã chọn {selectedRowCount}/{previewRows.length} dòng
                                    </span>
                                    <button
                                        type="button"
                                        onClick={selectAllRows}
                                        disabled={previewRows.length === 0 || submitting}
                                        className="h-9 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-bold text-primary hover:bg-primary/5 disabled:opacity-40"
                                    >
                                        Chọn tất cả
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearSelectedRows}
                                        disabled={previewRows.length === 0 || submitting}
                                        className="h-9 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-bold text-primary hover:bg-primary/5 disabled:opacity-40"
                                    >
                                        Bỏ chọn
                                    </button>
                                </div>
                            </div>
                        ) : viewStep === 'edit' ? (
                            <div className="flex flex-wrap items-end gap-2 rounded-sm border border-primary/10 bg-slate-50 px-3 py-2">
                                <label className="block">
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-primary/50">Tìm tên/SKU</span>
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        disabled={rows.length === 0 || submitting}
                                        className="mt-1 h-9 w-56 rounded-sm border border-primary/15 bg-white px-3 text-[13px] outline-none focus:border-primary"
                                        placeholder="Tìm tên hoặc SKU..."
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-primary/50">Tìm</span>
                                    <input
                                        type="text"
                                        value={replaceFind}
                                        onChange={(event) => setReplaceFind(event.target.value)}
                                        disabled={rows.length === 0 || submitting}
                                        className="mt-1 h-9 w-40 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold outline-none focus:border-primary"
                                        placeholder="MR70"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-primary/50">Thay bằng</span>
                                    <input
                                        type="text"
                                        value={replaceWith}
                                        onChange={(event) => setReplaceWith(event.target.value)}
                                        disabled={rows.length === 0 || submitting}
                                        className="mt-1 h-9 w-40 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold outline-none focus:border-primary"
                                        placeholder="MR71"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-[11px] font-bold uppercase tracking-wide text-primary/50">Cột</span>
                                    <select
                                        value={replaceScope}
                                        onChange={(event) => setReplaceScope(event.target.value)}
                                        disabled={rows.length === 0 || submitting}
                                        className="mt-1 h-9 w-32 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                    >
                                        <option value="both">Tên + SKU</option>
                                        <option value="name">Tên mới</option>
                                        <option value="sku">SKU mới</option>
                                    </select>
                                </label>
                                <button
                                    type="button"
                                    onClick={applyFindReplace}
                                    disabled={rows.length === 0 || !replaceFind || submitting}
                                    className="inline-flex h-9 items-center gap-1 rounded-sm bg-primary px-3 text-[12px] font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    <span className="material-symbols-outlined text-[18px]">find_replace</span>
                                    Thay thế
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {errorMessage && (
                        <div className="mb-3 rounded-sm border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
                            {errorMessage}
                        </div>
                    )}
                    {noticeMessage && (
                        <div className="mb-3 rounded-sm border border-primary/10 bg-primary/[0.04] px-4 py-3 text-[13px] font-semibold text-primary">
                            {noticeMessage}
                        </div>
                    )}

                    <div className="min-h-[360px] flex-1 overflow-auto rounded-sm border border-primary/10 custom-scrollbar">
                        {viewStep === 'select' ? (
                            <table className="min-w-[1080px] w-full border-collapse text-left text-[13px]">
                                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-primary/55">
                                    <tr>
                                        <th className="w-[70px] border-b border-primary/10 px-3 py-3 text-center">Chọn</th>
                                        <th className="w-[90px] border-b border-primary/10 px-3 py-3">Cấp</th>
                                        <th className="w-[120px] border-b border-primary/10 px-3 py-3">Loại</th>
                                        <th className="w-[300px] border-b border-primary/10 px-3 py-3">Tên hiện tại</th>
                                        <th className="w-[170px] border-b border-primary/10 px-3 py-3">SKU hiện tại</th>
                                        <th className="w-[300px] border-b border-primary/10 px-3 py-3">Tên dự kiến</th>
                                        <th className="w-[170px] border-b border-primary/10 px-3 py-3">SKU dự kiến</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSelectionRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-12 text-center text-[13px] text-primary/50">
                                                {loadingPreview ? 'Đang tải danh sách...' : 'Không có sản phẩm phù hợp.'}
                                            </td>
                                        </tr>
                                    ) : filteredSelectionRows.map((row) => {
                                        const checked = selectedProductIds.has(String(row.source_product_id));
                                        const levelLabel = row.level === 'child' ? 'Con' : 'Cha';

                                        return (
                                            <tr key={row.row_key || row.source_product_id} className={`${row.level === 'parent' ? 'bg-primary/[0.025]' : 'bg-white'} border-b border-primary/5`}>
                                                <td className="px-3 py-2 text-center align-top">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={(event) => toggleSelection(row, event.target.checked)}
                                                        disabled={submitting}
                                                        className="h-4 w-4 rounded-sm border-primary/25 text-primary focus:ring-primary"
                                                    />
                                                </td>
                                                <td className="px-3 py-2 align-top">
                                                    <div className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-black ${row.level === 'child' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                                                        {row.level === 'child' && <span className="text-primary/25">└</span>}
                                                        {levelLabel}
                                                    </div>
                                                    {row.level === 'parent' && row.children_count > 0 && (
                                                        <div className="mt-1 text-[11px] font-semibold text-primary/45">{row.children_count} con</div>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 align-top font-semibold text-primary/70">
                                                    {row.level === 'child' ? 'Biến thể' : (PRODUCT_TYPE_LABELS[row.product_type] || row.product_type || 'Sản phẩm')}
                                                </td>
                                                <td className="px-3 py-2 align-top">
                                                    <div className="font-bold text-primary">{row.current_name}</div>
                                                </td>
                                                <td className="px-3 py-2 align-top font-mono text-[12px] font-semibold text-primary/55">
                                                    {row.current_sku || '-'}
                                                </td>
                                                <td className="px-3 py-2 align-top font-semibold text-primary">
                                                    {row.name || '-'}
                                                </td>
                                                <td className="px-3 py-2 align-top font-mono text-[12px] font-semibold text-primary/70">
                                                    {row.sku || '-'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : (
                        <table className="min-w-[1300px] w-full border-collapse text-left text-[13px]">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-primary/55">
                                <tr>
                                    <th className="w-[90px] border-b border-primary/10 px-3 py-3">Cấp</th>
                                    <th className="w-[110px] border-b border-primary/10 px-3 py-3">Loại</th>
                                    <th className="w-[250px] border-b border-primary/10 px-3 py-3">Tên hiện tại</th>
                                    <th className="w-[310px] border-b border-primary/10 px-3 py-3">Tên mới</th>
                                    <th className="w-[170px] border-b border-primary/10 px-3 py-3">SKU mới</th>
                                    <th className="w-[150px] border-b border-primary/10 px-3 py-3 text-right">Giá nhập mới</th>
                                    <th className="w-[150px] border-b border-primary/10 px-3 py-3 text-right">Giá bán mới</th>
                                    <th className="w-[70px] border-b border-primary/10 px-3 py-3 text-center">Xóa</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-4 py-12 text-center text-[13px] text-primary/50">
                                            {loadingPreview ? 'Đang tải danh sách...' : 'Chọn danh mục nguồn rồi tải danh sách.'}
                                        </td>
                                    </tr>
                                ) : filteredRows.map((row, visibleIndex) => {
                                    const sourceIndex = rows.findIndex((item) => String(item.source_product_id) === String(row.source_product_id));
                                    const levelLabel = row.level === 'child' ? 'Con' : 'Cha';
                                    const duplicateSku = duplicateSkuSet.has(String(row.sku || '').trim().toUpperCase());
                                    const nameError = rowErrors[`${sourceIndex}.name`];
                                    const skuError = rowErrors[`${sourceIndex}.sku`] || (duplicateSku ? 'SKU bị trùng trong bảng.' : '');
                                    const expectedCostError = rowErrors[`${sourceIndex}.expected_cost`];
                                    const priceError = rowErrors[`${sourceIndex}.price`];

                                    return (
                                        <tr key={row.row_key || row.source_product_id} className={`${row.level === 'parent' ? 'bg-primary/[0.025]' : 'bg-white'} border-b border-primary/5`}>
                                            <td className="px-3 py-2 align-top">
                                                <div className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-black ${row.level === 'child' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                                                    {row.level === 'child' && <span className="text-primary/25">└</span>}
                                                    {levelLabel}
                                                </div>
                                                {row.level === 'parent' && row.children_count > 0 && (
                                                    <div className="mt-1 text-[11px] font-semibold text-primary/45">{row.children_count} con</div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 align-top font-semibold text-primary/70">
                                                {row.level === 'child' ? 'Biến thể' : (PRODUCT_TYPE_LABELS[row.product_type] || row.product_type || 'Sản phẩm')}
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                <div className="font-bold text-primary">{row.current_name}</div>
                                                <div className="mt-1 font-mono text-[11px] text-primary/45">{row.current_sku || '-'}</div>
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                <input
                                                    type="text"
                                                    value={row.name || ''}
                                                    onChange={(event) => updateRow(row.source_product_id, 'name', event.target.value)}
                                                    disabled={submitting}
                                                    className={`h-9 w-full rounded-sm border px-3 text-[13px] font-semibold outline-none focus:border-primary ${nameError ? 'border-red-300 bg-red-50' : 'border-primary/15 bg-white'}`}
                                                />
                                                {nameError && <div className="mt-1 text-[11px] font-semibold text-red-600">{nameError}</div>}
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                <input
                                                    type="text"
                                                    value={row.sku || ''}
                                                    onChange={(event) => updateRow(row.source_product_id, 'sku', event.target.value)}
                                                    disabled={submitting}
                                                    className={`h-9 w-full rounded-sm border px-3 font-mono text-[12px] font-semibold outline-none focus:border-primary ${skuError ? 'border-red-300 bg-red-50' : 'border-primary/15 bg-white'}`}
                                                />
                                                {skuError && <div className="mt-1 text-[11px] font-semibold text-red-600">{skuError}</div>}
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                <input
                                                    type="text"
                                                    value={formatWholeMoneyInput(row.expected_cost)}
                                                    onChange={(event) => updateRow(row.source_product_id, 'expected_cost', normalizeWholeMoneyDraft(event.target.value))}
                                                    inputMode="numeric"
                                                    disabled={submitting}
                                                    className={`h-9 w-full rounded-sm border px-3 text-right text-[13px] font-semibold outline-none focus:border-primary ${expectedCostError ? 'border-red-300 bg-red-50' : 'border-primary/15 bg-white'}`}
                                                />
                                                {expectedCostError && <div className="mt-1 text-right text-[11px] font-semibold text-red-600">{expectedCostError}</div>}
                                            </td>
                                            <td className="px-3 py-2 align-top">
                                                <input
                                                    type="text"
                                                    value={formatWholeMoneyInput(row.price)}
                                                    onChange={(event) => updateRow(row.source_product_id, 'price', normalizeWholeMoneyDraft(event.target.value))}
                                                    inputMode="numeric"
                                                    disabled={submitting}
                                                    className={`h-9 w-full rounded-sm border px-3 text-right text-[13px] font-semibold outline-none focus:border-primary ${priceError ? 'border-red-300 bg-red-50' : 'border-primary/15 bg-white'}`}
                                                />
                                                {priceError && <div className="mt-1 text-right text-[11px] font-semibold text-red-600">{priceError}</div>}
                                            </td>
                                            <td className="px-3 py-2 text-center align-top">
                                                <button
                                                    type="button"
                                                    onClick={() => removeRow(row)}
                                                    disabled={submitting}
                                                    title={row.level === 'parent' ? 'Xóa cha và các dòng con khỏi bản copy' : 'Xóa dòng này khỏi bản copy'}
                                                    className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-red-100 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-primary/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[12px] font-semibold text-primary/55">
                        {footerSummary}
                    </div>
                    <div className="flex justify-end gap-2">
                        {viewStep === 'edit' && previewRows.length > 0 && (
                            <button
                                type="button"
                                onClick={backToSelectRows}
                                disabled={submitting}
                                className="h-10 rounded-sm border border-primary/20 px-5 text-[13px] font-bold text-primary hover:bg-primary/5 disabled:opacity-50"
                            >
                                Chọn lại
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="h-10 rounded-sm border border-primary/20 px-5 text-[13px] font-bold text-primary hover:bg-primary/5 disabled:opacity-50"
                        >
                            Hủy
                        </button>
                        {viewStep === 'select' ? (
                            <button
                                type="button"
                                onClick={continueToEditRows}
                                disabled={!canContinue}
                                className="h-10 rounded-sm bg-primary px-5 text-[13px] font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Tiếp tục copy
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={!canApply}
                                className="h-10 rounded-sm bg-primary px-5 text-[13px] font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {submitting ? 'Đang tạo...' : 'Tạo bản copy'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductCategoryCloneModal;
