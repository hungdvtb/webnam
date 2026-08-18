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

const normalizePasteMoney = (value) => normalizeWholeMoneyDraft(String(value || '').trim());

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
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [rowErrors, setRowErrors] = useState({});
    const [search, setSearch] = useState('');

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
        setErrorMessage('');
        setRowErrors({});
        setSearch('');
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
            setPreview(nextPreview);
            setRows(Array.isArray(nextPreview.rows) ? nextPreview.rows : []);
            if (nextPreview.target_category?.name) {
                setTargetCategoryName(nextPreview.target_category.name);
            }
        } catch (error) {
            if (requestRef.current !== requestId) {
                return;
            }

            setPreview(null);
            setRows([]);
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

    const applyPercent = (field) => {
        const rawPercent = window.prompt(field === 'expected_cost' ? 'Tăng giá nhập bao nhiêu %?' : 'Tăng giá bán bao nhiêu %?', '10');
        if (rawPercent === null) {
            return;
        }

        const percent = Number(String(rawPercent).replace(',', '.'));
        if (!Number.isFinite(percent)) {
            setErrorMessage('Tỷ lệ % không hợp lệ.');
            return;
        }

        setRows((currentRows) => currentRows.map((row) => {
            const value = Number(row[field] || 0);
            const nextValue = Math.max(0, Math.round(value * (1 + percent / 100)));
            return { ...row, [field]: String(nextValue) };
        }));
    };

    const addFixedMoney = () => {
        const rawAmount = window.prompt('Cộng thêm bao nhiêu tiền cho cả giá nhập và giá bán?', '10000');
        if (rawAmount === null) {
            return;
        }

        const amount = Number(normalizeWholeMoneyDraft(rawAmount));
        if (!Number.isFinite(amount)) {
            setErrorMessage('Số tiền cộng thêm không hợp lệ.');
            return;
        }

        setRows((currentRows) => currentRows.map((row) => ({
            ...row,
            expected_cost: row.expected_cost === null || row.expected_cost === ''
                ? row.expected_cost
                : String(Math.max(0, Math.round(Number(row.expected_cost || 0) + amount))),
            price: String(Math.max(0, Math.round(Number(row.price || 0) + amount))),
        })));
    };

    const pasteFromClipboard = async () => {
        if (!navigator.clipboard?.readText) {
            setErrorMessage('Trình duyệt chưa cho phép đọc clipboard.');
            return;
        }

        try {
            const text = await navigator.clipboard.readText();
            const pastedRows = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => line.split('\t'));

            if (pastedRows.length === 0) {
                setErrorMessage('Clipboard chưa có dữ liệu để paste.');
                return;
            }

            setRows((currentRows) => currentRows.map((row, index) => {
                const cells = pastedRows[index];
                if (!cells) {
                    return row;
                }

                if (cells.length >= 4) {
                    return {
                        ...row,
                        name: cells[0] ?? row.name,
                        sku: cells[1] ?? row.sku,
                        expected_cost: normalizePasteMoney(cells[2]),
                        price: normalizePasteMoney(cells[3]),
                    };
                }

                if (cells.length >= 2) {
                    return {
                        ...row,
                        name: cells[0] ?? row.name,
                        expected_cost: normalizePasteMoney(cells[1]),
                    };
                }

                return {
                    ...row,
                    expected_cost: normalizePasteMoney(cells[0]),
                };
            }));
            setErrorMessage('');
        } catch (error) {
            console.error('Paste category clone rows error:', error);
            setErrorMessage('Không đọc được clipboard.');
        }
    };

    const handleApply = async () => {
        if (!sourceCategoryId || rows.length === 0 || submitting) {
            return;
        }

        setSubmitting(true);
        setErrorMessage('');
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
    const filteredRows = useMemo(() => {
        if (!normalizedSearch) {
            return rows;
        }

        return rows.filter((row) => [
            row.current_name,
            row.name,
            row.current_sku,
            row.sku,
        ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)));
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

    const canApply = rows.length > 0
        && sourceCategoryId
        && targetCategoryName.trim()
        && duplicateSkuSet.size === 0
        && !submitting
        && !loadingPreview;

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
                                    setErrorMessage('');
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

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {(preview?.rules || [
                            { from: 'M2', to: 'M3' },
                            { from: 'mẫu 2', to: 'mẫu 3' },
                            { from: 'MR71', to: 'MR72' },
                            { from: 'ML71', to: 'ML72' },
                        ]).map((rule) => (
                            <span key={`${rule.from}-${rule.to}`} className="rounded-sm border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[12px] font-bold text-primary">
                                {rule.from} → {rule.to}
                            </span>
                        ))}
                        {rows.length > 0 && (
                            <span className="rounded-sm border border-emerald-100 bg-emerald-50 px-3 py-1 text-[12px] font-bold text-emerald-700">
                                {rows.length} dòng · sửa được cả cha và con
                            </span>
                        )}
                        {Number(preview?.summary?.skipped_products || 0) > 0 && (
                            <span className="rounded-sm border border-amber-100 bg-amber-50 px-3 py-1 text-[12px] font-bold text-amber-700">
                                Bỏ qua {preview.summary.skipped_products} sản phẩm đã xoá/không truy cập
                            </span>
                        )}
                        {duplicateSkuSet.size > 0 && (
                            <span className="rounded-sm border border-red-100 bg-red-50 px-3 py-1 text-[12px] font-bold text-red-700">
                                Có SKU trùng trong bảng
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => applyPercent('expected_cost')} disabled={rows.length === 0 || submitting} className="rounded-sm border border-primary/15 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5 disabled:opacity-40">
                                Tăng giá nhập %
                            </button>
                            <button type="button" onClick={() => applyPercent('price')} disabled={rows.length === 0 || submitting} className="rounded-sm border border-primary/15 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5 disabled:opacity-40">
                                Tăng giá bán %
                            </button>
                            <button type="button" onClick={addFixedMoney} disabled={rows.length === 0 || submitting} className="rounded-sm border border-primary/15 px-3 py-2 text-[12px] font-bold text-primary hover:bg-primary/5 disabled:opacity-40">
                                Cộng tiền
                            </button>
                            <button type="button" onClick={pasteFromClipboard} disabled={rows.length === 0 || submitting} className="rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                                Paste Excel
                            </button>
                        </div>
                        <input
                            type="text"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="h-9 w-full rounded-sm border border-primary/15 px-3 text-[13px] outline-none focus:border-primary sm:w-72"
                            placeholder="Tìm tên hoặc SKU..."
                        />
                    </div>

                    {errorMessage && (
                        <div className="mb-3 rounded-sm border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700">
                            {errorMessage}
                        </div>
                    )}

                    <div className="min-h-[360px] flex-1 overflow-auto rounded-sm border border-primary/10 custom-scrollbar">
                        <table className="min-w-[1220px] w-full border-collapse text-left text-[13px]">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-primary/55">
                                <tr>
                                    <th className="w-[90px] border-b border-primary/10 px-3 py-3">Cấp</th>
                                    <th className="w-[110px] border-b border-primary/10 px-3 py-3">Loại</th>
                                    <th className="w-[250px] border-b border-primary/10 px-3 py-3">Tên hiện tại</th>
                                    <th className="w-[310px] border-b border-primary/10 px-3 py-3">Tên mới</th>
                                    <th className="w-[170px] border-b border-primary/10 px-3 py-3">SKU mới</th>
                                    <th className="w-[150px] border-b border-primary/10 px-3 py-3 text-right">Giá nhập mới</th>
                                    <th className="w-[150px] border-b border-primary/10 px-3 py-3 text-right">Giá bán mới</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-[13px] text-primary/50">
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
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-primary/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[12px] font-semibold text-primary/55">
                        {preview?.summary
                            ? `${preview.summary.root_products} cha · ${preview.summary.child_products} con · ${preview.summary.total_rows} dòng${Number(preview.summary.skipped_products || 0) > 0 ? ` · bỏ qua ${preview.summary.skipped_products}` : ''}`
                            : 'Chưa tải preview'}
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="h-10 rounded-sm border border-primary/20 px-5 text-[13px] font-bold text-primary hover:bg-primary/5 disabled:opacity-50"
                        >
                            Hủy
                        </button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={!canApply}
                            className="h-10 rounded-sm bg-primary px-5 text-[13px] font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {submitting ? 'Đang tạo...' : 'Tạo bản copy'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProductCategoryCloneModal;
