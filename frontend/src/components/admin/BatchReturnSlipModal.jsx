import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { orderApi, productApi } from '../../services/api';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const todayValue = () => new Date().toISOString().slice(0, 10);
const sanitizeWholeNumber = (value) => String(value ?? '').replace(/[^0-9]/g, '');

const normalizeRow = (item, index = 0) => ({
    key: item?.item_id ? `item-${item.item_id}` : `row-${item?.product_id || 'new'}-${index}`,
    item_id: item?.item_id || null,
    product_id: Number(item?.product_id || 0),
    product_name: item?.product_name || '',
    product_sku: item?.product_sku || '',
    exported_quantity: Number(item?.exported_quantity || 0),
    actual_quantity: item?.actual_quantity != null ? String(item.actual_quantity) : '',
    notes: item?.notes || '',
    is_extra_product: Boolean(item?.is_extra_product),
    can_remove: Boolean(item?.can_remove ?? item?.is_extra_product ?? Number(item?.exported_quantity || 0) === 0),
    order_breakdown: Array.isArray(item?.order_breakdown) ? item.order_breakdown : [],
});

const normalizePayload = (payload) => ({
    document: {
        id: payload?.document?.id || null,
        document_number: payload?.document?.document_number || null,
        document_date: payload?.document?.document_date || todayValue(),
        notes: payload?.document?.notes || '',
        adjustment_document_id: payload?.document?.adjustment_document_id || null,
        adjustment_document_number: payload?.document?.adjustment_document_number || null,
    },
    orders: Array.isArray(payload?.orders) ? payload.orders : [],
    rows: Array.isArray(payload?.products) ? payload.products.map((item, index) => normalizeRow(item, index)) : [],
});

const summaryCardTone = {
    matched: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    positive: 'border-sky-200 bg-sky-50 text-sky-700',
    negative: 'border-amber-200 bg-amber-50 text-amber-700',
};

const discrepancyTone = (value) => {
    if (Number(value || 0) === 0) return 'matched';
    return Number(value || 0) > 0 ? 'positive' : 'negative';
};

const MetricCard = ({ label, value, hint, tone = 'matched' }) => (
    <div className={`rounded-sm border px-4 py-3 ${summaryCardTone[tone] || summaryCardTone.matched}`}>
        <div className="text-[10px] font-black uppercase tracking-[0.14em]">{label}</div>
        <div className="mt-1 text-[22px] font-black">{value}</div>
        {hint ? <div className="mt-1 text-[11px] opacity-80">{hint}</div> : null}
    </div>
);

const EmptyState = ({ title, description }) => (
    <div className="rounded-sm border border-dashed border-primary/20 bg-white px-5 py-7 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-primary/[0.04] text-primary/55">
            <span className="material-symbols-outlined text-[22px]">inventory_2</span>
        </div>
        <div className="mt-3 text-[15px] font-black text-primary">{title}</div>
        <div className="mt-1 text-[12px] text-primary/55">{description}</div>
    </div>
);

const BatchReturnSlipModal = ({
    open,
    mode = 'create',
    orderIds = [],
    documentId = null,
    onClose,
    onSaved,
    onNotify,
}) => {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formState, setFormState] = useState(() => normalizePayload(null));
    const [pickerQuery, setPickerQuery] = useState('');
    const [pickerLoading, setPickerLoading] = useState(false);
    const [pickerResults, setPickerResults] = useState([]);
    const pickerAbortRef = useRef(null);

    const rows = formState.rows || [];
    const orders = formState.orders || [];
    const documentState = formState.document || {};

    useEffect(() => {
        if (!open) {
            setPickerQuery('');
            setPickerResults([]);
            return;
        }

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            try {
                const response = mode === 'edit' && documentId
                    ? await orderApi.getBatchReturn(documentId)
                    : await orderApi.previewBatchReturn({ order_ids: orderIds });

                if (cancelled) return;
                setFormState(normalizePayload(response.data));
            } catch (error) {
                if (cancelled) return;
                onNotify?.({
                    type: 'error',
                    message: error.response?.data?.message
                        || Object.values(error.response?.data?.errors || {}).flat()[0]
                        || 'Khong the tai phieu hoan theo lo.',
                });
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        load();

        return () => {
            cancelled = true;
        };
    }, [documentId, mode, onNotify, open, orderIds]);

    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = window.document.body.style.overflow;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onClose?.();
            }
        };

            window.document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, open]);

    useEffect(() => {
        if (!open) return undefined;
        if (pickerAbortRef.current) {
            pickerAbortRef.current.abort();
        }

        const keyword = pickerQuery.trim();
        if (keyword.length < 2) {
            setPickerResults([]);
            setPickerLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        pickerAbortRef.current = controller;
        const timeoutId = window.setTimeout(async () => {
            setPickerLoading(true);
            try {
                const response = await productApi.getAll({
                    picker: 1,
                    search: keyword,
                    per_page: 8,
                }, controller.signal);

                const results = Array.isArray(response.data?.data) ? response.data.data : [];
                setPickerResults(results);
            } catch (error) {
                if (error.name !== 'CanceledError' && error.code !== 'ERR_CANCELED') {
                    setPickerResults([]);
                }
            } finally {
                setPickerLoading(false);
            }
        }, 250);

        return () => {
            controller.abort();
            window.clearTimeout(timeoutId);
        };
    }, [open, pickerQuery]);

    const computedRows = useMemo(
        () => rows.map((row) => {
            const actualQuantity = Number(row.actual_quantity || 0);
            const discrepancyQuantity = actualQuantity - Number(row.exported_quantity || 0);

            return {
                ...row,
                actualQuantity,
                discrepancyQuantity,
                discrepancyState: discrepancyTone(discrepancyQuantity),
            };
        }),
        [rows]
    );

    const summary = useMemo(() => {
        const exportedQuantity = computedRows.reduce((sum, row) => sum + Number(row.exported_quantity || 0), 0);
        const actualQuantity = computedRows.reduce((sum, row) => sum + Number(row.actualQuantity || 0), 0);
        const discrepancyQuantity = computedRows.reduce((sum, row) => sum + Number(row.discrepancyQuantity || 0), 0);

        return {
            exportedQuantity,
            actualQuantity,
            discrepancyQuantity,
            discrepancyAbsQuantity: computedRows.reduce((sum, row) => sum + Math.abs(Number(row.discrepancyQuantity || 0)), 0),
        };
    }, [computedRows]);

    const updateDocumentField = (field, value) => {
        setFormState((current) => ({
            ...current,
            document: {
                ...current.document,
                [field]: value,
            },
        }));
    };

    const updateRow = (rowKey, field, value) => {
        setFormState((current) => ({
            ...current,
            rows: current.rows.map((row) => (
                row.key === rowKey
                    ? { ...row, [field]: value }
                    : row
            )),
        }));
    };

    const removeRow = (rowKey) => {
        setFormState((current) => ({
            ...current,
            rows: current.rows.filter((row) => row.key !== rowKey),
        }));
    };

    const handleSelectProduct = (product) => {
        const productId = Number(product?.id || 0);
        if (!productId) return;

        if (rows.some((row) => Number(row.product_id || 0) === productId)) {
            onNotify?.({
                type: 'error',
                message: 'San pham nay da co trong bang doi chieu.',
            });
            return;
        }

        setFormState((current) => ({
            ...current,
            rows: [
                ...current.rows,
                normalizeRow({
                    product_id: productId,
                    product_name: product.name,
                    product_sku: product.sku,
                    exported_quantity: 0,
                    actual_quantity: '',
                    notes: '',
                    is_extra_product: true,
                    can_remove: true,
                    order_breakdown: [],
                }, current.rows.length),
            ],
        }));

        setPickerQuery('');
        setPickerResults([]);
    };

    const handleSubmit = async () => {
        const payload = {
            document_date: documentState.document_date || todayValue(),
            notes: documentState.notes || null,
            items: rows
                .filter((row) => Number(row.product_id || 0) > 0)
                .map((row) => ({
                    product_id: Number(row.product_id),
                    quantity: Number(row.actual_quantity || 0),
                    notes: row.notes || null,
                    product_name: row.product_name || null,
                    product_sku: row.product_sku || null,
                })),
        };

        if (!payload.items.length) {
            onNotify?.({
                type: 'error',
                message: 'Can it nhat mot dong san pham de lap phieu hoan theo lo.',
            });
            return;
        }

        if (mode === 'create') {
            payload.order_ids = orderIds;
        }

        setSaving(true);
        try {
            const response = mode === 'edit' && documentId
                ? await orderApi.updateBatchReturn(documentId, payload)
                : await orderApi.createBatchReturn(payload);

            onNotify?.({
                type: 'success',
                message: mode === 'edit'
                    ? 'Da cap nhat phieu hoan theo lo.'
                    : 'Da tao phieu hoan theo lo.',
            });

            await onSaved?.(response.data);
        } catch (error) {
            onNotify?.({
                type: 'error',
                message: error.response?.data?.message
                    || Object.values(error.response?.data?.errors || {}).flat()[0]
                    || 'Khong the luu phieu hoan theo lo.',
            });
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100001]">
            <div className="absolute inset-0 bg-primary/20 backdrop-blur-[2px]" onClick={onClose} />
            <div className="absolute inset-0 overflow-y-auto p-4 md:p-8">
                <div className="mx-auto flex min-h-full w-full max-w-[1320px] items-start justify-center">
                    <div className="relative w-full overflow-hidden rounded-sm border border-primary/10 bg-[#f8fafc] shadow-[0_30px_80px_-20px_rgba(15,23,42,0.35)]">
                        <div className="border-b border-primary/10 bg-white px-6 py-5">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-700">
                                            <span className="material-symbols-outlined text-[24px]">assignment_return</span>
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Phieu hoan theo lo</div>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <div className="text-[22px] font-black text-primary">
                                                    {mode === 'edit'
                                                        ? (documentState.document_number || `Phieu #${documentId}`)
                                                        : 'Tao phieu hoan tong hop'}
                                                </div>
                                                <span className="inline-flex items-center gap-1 rounded-sm border border-primary/15 bg-primary/[0.04] px-2.5 py-1 text-[11px] font-black text-primary/70">
                                                    <span className="material-symbols-outlined text-[14px]">inventory</span>
                                                    {formatNumber(orders.length)} don
                                                </span>
                                                {documentState.adjustment_document_number ? (
                                                    <span className="inline-flex items-center gap-1 rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                                                        <span className="material-symbols-outlined text-[14px]">tune</span>
                                                        Phieu dieu chinh {documentState.adjustment_document_number}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {orders.map((order) => (
                                            <span
                                                key={order.id}
                                                className="inline-flex items-center gap-1 rounded-sm border border-primary/10 bg-[#fbfcfe] px-2.5 py-1 text-[11px] font-black text-primary/70"
                                            >
                                                <span>{order.order_number || `Don #${order.id}`}</span>
                                                {order.customer_name ? <span className="text-primary/45">| {order.customer_name}</span> : null}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition hover:bg-primary/5"
                                >
                                    <span className="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                        </div>

                        {loading ? (
                            <div className="px-6 py-12">
                                <EmptyState
                                    title="Dang tai du lieu doi chieu"
                                    description="He thong dang tong hop san pham da xuat tu cac don duoc chon."
                                />
                            </div>
                        ) : (
                            <>
                                <div className="grid gap-4 border-b border-primary/10 bg-[#f8fafc] px-6 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                                    <div className="space-y-4">
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <MetricCard label="Da Xuat" value={formatNumber(summary.exportedQuantity)} hint="Tong so luong nguon" tone="matched" />
                                            <MetricCard label="Hoan Thuc Te" value={formatNumber(summary.actualQuantity)} hint="So luong se ghi vao phieu hoan" tone="matched" />
                                            <MetricCard
                                                label="Chenh Lech"
                                                value={`${summary.discrepancyQuantity > 0 ? '+' : ''}${formatNumber(summary.discrepancyQuantity)}`}
                                                hint={`Tong lech tuyet doi ${formatNumber(summary.discrepancyAbsQuantity)}`}
                                                tone={discrepancyTone(summary.discrepancyQuantity)}
                                            />
                                        </div>

                                        <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
                                            <input
                                                type="date"
                                                value={documentState.document_date || todayValue()}
                                                onChange={(event) => updateDocumentField('document_date', event.target.value)}
                                                className="h-11 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                            />
                                            <textarea
                                                value={documentState.notes || ''}
                                                onChange={(event) => updateDocumentField('notes', event.target.value)}
                                                placeholder="Ghi chu chung cho phieu hoan"
                                                className="min-h-[44px] rounded-sm border border-primary/15 bg-white p-3 text-[13px] text-primary outline-none focus:border-primary"
                                            />
                                        </div>
                                    </div>

                                    <div className="rounded-sm border border-primary/10 bg-white p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/40">Them san pham ngoai danh sach xuat</div>
                                        <div className="mt-3 relative">
                                            <input
                                                type="text"
                                                value={pickerQuery}
                                                onChange={(event) => setPickerQuery(event.target.value)}
                                                placeholder="Nhap ten hoac SKU de tim san pham"
                                                className="h-11 w-full rounded-sm border border-primary/15 bg-[#fbfcfe] px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                            />
                                            {(pickerLoading || pickerResults.length > 0 || pickerQuery.trim().length >= 2) ? (
                                                <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-[280px] overflow-auto rounded-sm border border-primary/10 bg-white shadow-xl">
                                                    {pickerLoading ? (
                                                        <div className="px-3 py-4 text-[12px] font-semibold text-primary/55">Dang tim san pham...</div>
                                                    ) : pickerResults.length === 0 ? (
                                                        <div className="px-3 py-4 text-[12px] font-semibold text-primary/55">Khong co san pham phu hop.</div>
                                                    ) : (
                                                        pickerResults.map((product) => (
                                                            <button
                                                                key={product.id}
                                                                type="button"
                                                                onClick={() => handleSelectProduct(product)}
                                                                className="flex w-full items-center justify-between gap-3 border-b border-primary/10 px-3 py-3 text-left transition last:border-b-0 hover:bg-primary/[0.04]"
                                                            >
                                                                <div className="min-w-0">
                                                                    <div className="truncate text-[13px] font-black text-primary">{product.name}</div>
                                                                    <div className="mt-1 truncate text-[11px] font-bold text-orange-600/70">{product.sku || 'Khong co SKU'}</div>
                                                                </div>
                                                                <div className="text-[11px] font-black text-primary/45">{formatNumber(product.stock_quantity || 0)}</div>
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="mt-3 text-[12px] text-primary/55">Dung khi kho hoan ve san pham chua tung xuat trong cac don da chon.</div>
                                    </div>
                                </div>

                                <div className="px-6 py-5">
                                    {computedRows.length === 0 ? (
                                        <EmptyState
                                            title="Chua co dong san pham"
                                            description="Hay them san pham hoan thuc te hoac chon lai danh sach don nguon."
                                        />
                                    ) : (
                                        <div className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                            <div className="overflow-auto">
                                                <table className="w-full min-w-[980px] border-collapse">
                                                    <thead className="bg-[#fbfcfe]">
                                                        <tr>
                                                            <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">San pham</th>
                                                            <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Da xuat</th>
                                                            <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Hoan thuc te</th>
                                                            <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Chenh lech</th>
                                                            <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Nguon xuat</th>
                                                            <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Ghi chu</th>
                                                            <th className="border-b border-primary/10 px-3 py-3 text-center text-[11px] font-black uppercase tracking-[0.14em] text-primary/45">Xoa</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {computedRows.map((row) => (
                                                            <tr key={row.key} className="hover:bg-primary/[0.02]">
                                                                <td className="border-b border-r border-primary/10 px-4 py-3 align-top">
                                                                    <div className="text-[13px] font-black text-primary">{row.product_name || `San pham #${row.product_id}`}</div>
                                                                    <div className="mt-1 text-[11px] font-bold text-orange-600/70">{row.product_sku || 'Khong co SKU'}</div>
                                                                    {row.is_extra_product ? (
                                                                        <div className="mt-2 inline-flex items-center gap-1 rounded-sm border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-black text-sky-700">
                                                                            <span className="material-symbols-outlined text-[13px]">add_box</span>
                                                                            San pham them moi
                                                                        </div>
                                                                    ) : null}
                                                                </td>
                                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary align-top">{formatNumber(row.exported_quantity)}</td>
                                                                <td className="border-b border-r border-primary/10 px-3 py-3 align-top">
                                                                    <div className="flex justify-end">
                                                                        <input
                                                                            type="text"
                                                                            inputMode="numeric"
                                                                            value={row.actual_quantity}
                                                                            onChange={(event) => updateRow(row.key, 'actual_quantity', sanitizeWholeNumber(event.target.value))}
                                                                            placeholder="0"
                                                                            className="h-10 w-[120px] rounded-sm border border-primary/15 bg-white px-3 text-right text-[13px] font-black text-primary outline-none focus:border-primary"
                                                                        />
                                                                    </div>
                                                                </td>
                                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-right align-top">
                                                                    <span className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${summaryCardTone[row.discrepancyState] || summaryCardTone.matched}`}>
                                                                        {row.discrepancyQuantity > 0 ? '+' : ''}
                                                                        {formatNumber(row.discrepancyQuantity)}
                                                                    </span>
                                                                </td>
                                                                <td className="border-b border-r border-primary/10 px-4 py-3 align-top">
                                                                    {row.order_breakdown?.length ? (
                                                                        <div className="space-y-1">
                                                                            {row.order_breakdown.map((entry, index) => (
                                                                                <div key={`${row.key}-src-${index}`} className="text-[12px] text-primary/70">
                                                                                    <span className="font-black text-primary">{entry.order_number || `Don #${entry.order_id}`}</span>
                                                                                    <span>{` | Xuat ${formatNumber(entry.exported_quantity || 0)}`}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-[12px] font-semibold text-primary/50">San pham them ngoai danh sach xuat</div>
                                                                    )}
                                                                </td>
                                                                <td className="border-b border-r border-primary/10 px-4 py-3 align-top">
                                                                    <input
                                                                        type="text"
                                                                        value={row.notes}
                                                                        onChange={(event) => updateRow(row.key, 'notes', event.target.value)}
                                                                        placeholder="Ghi chu dong san pham"
                                                                        className="h-10 w-full rounded-sm border border-primary/15 bg-white px-3 text-[13px] text-primary outline-none focus:border-primary"
                                                                    />
                                                                </td>
                                                                <td className="border-b border-primary/10 px-3 py-3 text-center align-top">
                                                                    {row.can_remove ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => removeRow(row.key)}
                                                                            className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50"
                                                                        >
                                                                            <span className="material-symbols-outlined text-[18px]">delete</span>
                                                                        </button>
                                                                    ) : (
                                                                        <span className="text-[11px] font-bold text-primary/25">-</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-white px-6 py-4">
                                    <div className="text-[12px] text-primary/55">Phieu hoan luu dung so luong thuc te ban nhap. Moi phan lech se tu chuyen sang phieu dieu chinh ton kho rieng.</div>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={onClose}
                                            className="h-10 rounded-sm border border-primary/20 bg-white px-4 text-[12px] font-black uppercase tracking-wide text-primary transition hover:bg-primary/5"
                                        >
                                            Huy
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleSubmit}
                                            disabled={saving || loading}
                                            className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-5 text-[12px] font-black uppercase tracking-wide text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">{saving ? 'progress_activity' : 'save'}</span>
                                            {saving ? 'Dang luu...' : (mode === 'edit' ? 'Cap nhat phieu' : 'Tao phieu hoan')}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        window.document.body
    );
};

export default BatchReturnSlipModal;
