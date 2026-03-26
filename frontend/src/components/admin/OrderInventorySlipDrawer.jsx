import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { inventoryApi, orderApi } from '../../services/api';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))}d`;
const todayValue = () => new Date().toISOString().slice(0, 10);
const stripNumericValue = (value) => String(value ?? '').replace(/[^0-9]/g, '');

const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
};

const summaryToneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-primary/15 bg-primary/[0.04] text-primary/70',
};

const slipTypeMeta = {
    export: {
        label: 'Phieu xuat',
        icon: 'outbox',
        classes: 'border-cyan-200 bg-cyan-50 text-cyan-700',
        actionLabel: 'Tao phieu xuat',
        helper: 'Cho phep giu theo don nhung khai bao SKU thuc te neu kho xuat khac.',
    },
    return: {
        label: 'Phieu hoan',
        icon: 'assignment_return',
        classes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        actionLabel: 'Tao phieu hoan',
        helper: 'Uu tien hoan theo lich su thuc xuat thuc te, khong khoa cung theo san pham tren don.',
    },
    damaged: {
        label: 'Phieu hong',
        icon: 'broken_image',
        classes: 'border-rose-200 bg-rose-50 text-rose-700',
        actionLabel: 'Tao phieu hong',
        helper: 'Tach rieng so luong thuc te bi hong de ton kho va canh bao khop nhau.',
    },
};

const emptyDetail = {
    order: null,
    summary: {
        label: 'Chua tao phieu',
        tone: 'slate',
        required_quantity: 0,
        document_export_quantity: 0,
        exported_quantity: 0,
        returned_quantity: 0,
        damaged_quantity: 0,
        remaining_quantity: 0,
        difference_quantity: 0,
        export_slip_count: 0,
        return_slip_count: 0,
        damaged_slip_count: 0,
        has_variance: false,
        quick_summary: '',
    },
    products: [],
    documents: {
        export: [],
        return: [],
        damaged: [],
    },
};

const normalizeKnownProduct = (product) => {
    if (!product || !product.id) return null;
    return {
        id: Number(product.id),
        name: product.name || `San pham #${product.id}`,
        sku: product.sku || '',
    };
};

const buildDraftItems = (detail, type) => {
    const products = detail?.products || [];
    const sourceProducts = type === 'export'
        ? products.filter((product) => Number(product.required_quantity || 0) > 0)
        : products.filter((product) => Number(product.reversible_planned_quantity || product.reversible_quantity || 0) > 0);

    return sourceProducts.map((product) => ({
        product_id: product.product_id,
        quantity: '',
        notes: '',
        custom_actual: false,
        actual_product_id: product.product_id,
        actual_product_name: product.product_name,
        actual_product_sku: product.product_sku,
        actual_quantity: '',
        actual_reason: '',
    }));
};

const buildDraftForm = (detail, type) => ({
    document_date: todayValue(),
    notes: '',
    items: buildDraftItems(detail, type),
    type,
});

const MetricCard = ({ label, value, hint, tone = 'slate' }) => (
    <div className={`rounded-sm border px-4 py-3 ${summaryToneClasses[tone] || summaryToneClasses.slate}`}>
        <div className="text-[10px] font-black uppercase tracking-[0.16em]">{label}</div>
        <div className="mt-1 text-[22px] font-black">{value}</div>
        {hint ? <div className="mt-1 text-[11px] opacity-75">{hint}</div> : null}
    </div>
);

const EmptyState = ({ title, description }) => (
    <div className="rounded-sm border border-dashed border-primary/20 bg-white px-5 py-8 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-primary/[0.04] text-primary/60">
            <span className="material-symbols-outlined text-[22px]">inventory_2</span>
        </div>
        <div className="mt-3 text-[15px] font-black text-primary">{title}</div>
        <div className="mt-1 text-[12px] text-primary/55">{description}</div>
    </div>
);

const QuantityInput = ({ value, onChange, disabled, placeholder = '0' }) => (
    <input
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(stripNumericValue(event.target.value))}
        placeholder={placeholder}
        className={`h-10 w-full rounded-sm border px-3 text-right text-[13px] font-black outline-none transition ${
            disabled
                ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                : 'border-primary/15 bg-white text-primary focus:border-primary'
        }`}
    />
);

const ProductSearchSelect = ({ value, disabled, onSelect }) => {
    const [query, setQuery] = useState(value ? `${value.sku ? `${value.sku} • ` : ''}${value.name}` : '');
    const [options, setOptions] = useState(value ? [value] : []);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            setQuery(value ? `${value.sku ? `${value.sku} • ` : ''}${value.name}` : '');
        }
    }, [open, value]);

    useEffect(() => {
        if (disabled || !open) return undefined;

        const normalizedQuery = query.trim();
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            try {
                setLoading(true);
                const response = await inventoryApi.getProducts({
                    search: normalizedQuery,
                    per_page: 8,
                }, controller.signal);

                const rows = (response.data?.data || [])
                    .map((row) => normalizeKnownProduct({
                        id: row.id,
                        name: row.name,
                        sku: row.sku,
                    }))
                    .filter(Boolean);

                if (value?.id && !rows.some((row) => Number(row.id) === Number(value.id))) {
                    rows.unshift(value);
                }

                setOptions(rows);
            } catch (error) {
                if (error.name !== 'CanceledError' && error.code !== 'ERR_CANCELED') {
                    setOptions(value ? [value] : []);
                }
            } finally {
                setLoading(false);
            }
        }, 250);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [disabled, open, query, value]);

    return (
        <div className="relative">
            <input
                type="text"
                value={query}
                disabled={disabled}
                onFocus={() => setOpen(true)}
                onBlur={() => window.setTimeout(() => setOpen(false), 120)}
                onChange={(event) => {
                    setQuery(event.target.value);
                    setOpen(true);
                }}
                placeholder="Tim SKU thuc te"
                className={`h-10 w-full rounded-sm border px-3 text-[13px] font-semibold outline-none transition ${
                    disabled
                        ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                        : 'border-primary/15 bg-white text-primary focus:border-primary'
                }`}
            />
            {open ? (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-56 overflow-auto rounded-sm border border-primary/10 bg-white shadow-[0_18px_40px_-18px_rgba(15,23,42,0.35)]">
                    {loading ? (
                        <div className="px-3 py-3 text-[12px] font-semibold text-primary/55">Dang tim san pham...</div>
                    ) : options.length === 0 ? (
                        <div className="px-3 py-3 text-[12px] font-semibold text-primary/55">Khong tim thay SKU phu hop.</div>
                    ) : (
                        options.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    onSelect?.(option);
                                    setOpen(false);
                                }}
                                className="flex w-full flex-col items-start border-b border-primary/5 px-3 py-2 text-left transition hover:bg-primary/[0.04]"
                            >
                                <span className="text-[13px] font-black text-primary">{option.name}</span>
                                <span className="mt-0.5 text-[11px] font-bold text-orange-600/80">{option.sku || 'Khong co SKU'}</span>
                            </button>
                        ))
                    )}
                </div>
            ) : null}
        </div>
    );
};

const DocumentItemsTable = ({ document }) => (
    <div className="overflow-auto">
        <table className="w-full border-collapse">
            <thead className="bg-[#fbfcfe]">
                <tr>
                    <th className="border-b border-r border-primary/10 px-4 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Theo phieu</th>
                    <th className="border-b border-r border-primary/10 px-3 py-2.5 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL phieu</th>
                    <th className="border-b border-r border-primary/10 px-4 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thuc te</th>
                    <th className="border-b border-r border-primary/10 px-3 py-2.5 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL thuc te</th>
                    <th className="border-b border-primary/10 px-4 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ghi chu / ly do</th>
                </tr>
            </thead>
            <tbody>
                {(document.items || []).map((item) => (
                    <tr key={item.id} className="align-top hover:bg-primary/[0.02]">
                        <td className="border-b border-r border-primary/10 px-4 py-3">
                            <div className="text-[13px] font-black text-primary">{item.product_name}</div>
                            <div className="mt-1 text-[11px] font-bold text-orange-600/70">{item.product_sku || 'Khong co SKU'}</div>
                        </td>
                        <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(item.quantity)}</td>
                        <td className="border-b border-r border-primary/10 px-4 py-3">
                            <div className="text-[13px] font-black text-primary">{item.actual_product_name || item.product_name}</div>
                            <div className="mt-1 text-[11px] font-bold text-orange-600/70">{item.actual_product_sku || item.product_sku || 'Khong co SKU'}</div>
                            {item.has_variance ? (
                                <div className="mt-2 inline-flex items-center gap-1 rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-amber-700">
                                    <span className="material-symbols-outlined text-[12px]">warning</span>
                                    Lech
                                </div>
                            ) : null}
                        </td>
                        <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(item.actual_quantity ?? item.quantity)}</td>
                        <td className="border-b border-primary/10 px-4 py-3 text-[12px] text-primary/65">{item.actual_reason || item.notes || '-'}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const OrderInventorySlipDrawer = ({ open, orderId, onClose, onUpdated, onNotify }) => {
    const [detail, setDetail] = useState(emptyDetail);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [composerType, setComposerType] = useState(null);
    const [form, setForm] = useState(buildDraftForm(emptyDetail, 'export'));

    const loadDetail = useCallback(async () => {
        if (!orderId) return;
        setLoading(true);
        try {
            const response = await orderApi.getInventorySlips(orderId);
            setDetail(response.data || emptyDetail);
        } catch (error) {
            setDetail(emptyDetail);
            onNotify?.({
                type: 'error',
                message: error.response?.data?.message || 'Khong the tai chi tiet phieu kho cua don hang.',
            });
        } finally {
            setLoading(false);
        }
    }, [onNotify, orderId]);

    useEffect(() => {
        if (!open) {
            setComposerType(null);
            return;
        }

        loadDetail();
    }, [loadDetail, open]);

    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                if (composerType) setComposerType(null);
                else onClose?.();
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, composerType, onClose]);

    const summary = detail?.summary || emptyDetail.summary;
    const products = useMemo(() => detail?.products || [], [detail]);
    const documents = useMemo(() => detail?.documents || emptyDetail.documents, [detail]);

    const knownProducts = useMemo(() => {
        const map = new Map();
        products.forEach((product) => {
            map.set(Number(product.product_id), {
                id: Number(product.product_id),
                name: product.product_name,
                sku: product.product_sku || '',
            });
        });

        Object.values(documents || {}).forEach((rows) => {
            (rows || []).forEach((documentRow) => {
                (documentRow.items || []).forEach((item) => {
                    if (item.product_id) {
                        map.set(Number(item.product_id), {
                            id: Number(item.product_id),
                            name: item.product_name,
                            sku: item.product_sku || '',
                        });
                    }
                    if (item.actual_product_id) {
                        map.set(Number(item.actual_product_id), {
                            id: Number(item.actual_product_id),
                            name: item.actual_product_name || item.product_name,
                            sku: item.actual_product_sku || item.product_sku || '',
                        });
                    }
                });
            });
        });

        return map;
    }, [documents, products]);

    const exportableTotal = useMemo(
        () => products.reduce((sum, product) => sum + Number(product.remaining_planned_export_quantity || product.exportable_quantity || 0), 0),
        [products]
    );

    const reversibleTotal = useMemo(
        () => products.reduce((sum, product) => sum + Number(product.reversible_planned_quantity || product.reversible_quantity || 0), 0),
        [products]
    );

    const openComposer = (type) => {
        setComposerType(type);
        setForm(buildDraftForm(detail, type));
    };

    const closeComposer = () => setComposerType(null);

    const updateRow = (productId, patch) => {
        setForm((current) => ({
            ...current,
            items: (current.items || []).map((item) => (
                String(item.product_id) === String(productId)
                    ? { ...item, ...patch }
                    : item
            )),
        }));
    };

    const composerRows = useMemo(() => {
        return (form.items || []).map((item) => {
            const product = products.find((entry) => String(entry.product_id) === String(item.product_id));
            const knownActualProduct = item.custom_actual
                ? (knownProducts.get(Number(item.actual_product_id)) || normalizeKnownProduct({
                    id: item.actual_product_id,
                    name: item.actual_product_name,
                    sku: item.actual_product_sku,
                }))
                : normalizeKnownProduct({
                    id: product?.product_id,
                    name: product?.product_name,
                    sku: product?.product_sku,
                });

            const maxQuantity = composerType === 'export'
                ? Number(product?.remaining_planned_export_quantity || product?.exportable_quantity || 0)
                : Number(product?.reversible_planned_quantity || product?.reversible_quantity || 0);
            const actualQuantityValue = item.custom_actual
                ? (item.actual_quantity || '')
                : (item.quantity || '');
            const actualProductId = item.custom_actual
                ? Number(item.actual_product_id || 0)
                : Number(item.product_id || 0);
            const plannedQuantityNumber = Number(item.quantity || 0);
            const actualQuantityNumber = Number(actualQuantityValue || item.quantity || 0);
            const hasVariance = actualProductId > 0 && (
                actualProductId !== Number(item.product_id || 0)
                || actualQuantityNumber !== plannedQuantityNumber
            );

            return {
                ...item,
                product,
                maxQuantity,
                disabled: maxQuantity <= 0,
                knownActualProduct,
                actualQuantityValue,
                actualProductId,
                hasVariance,
            };
        });
    }, [composerType, form.items, knownProducts, products]);

    const draftPlannedTotal = useMemo(
        () => composerRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
        [composerRows]
    );

    const draftActualTotal = useMemo(
        () => composerRows.reduce((sum, row) => sum + Number(row.actualQuantityValue || row.quantity || 0), 0),
        [composerRows]
    );

    const submitSlip = async () => {
        if (!composerType || !orderId) return;

        const payloadItems = composerRows
            .map((row) => {
                const quantity = Number(row.quantity || 0);
                const actualProductId = row.custom_actual
                    ? Number(row.actualProductId || 0)
                    : Number(row.product_id || 0);
                const actualQuantity = row.custom_actual
                    ? Number(row.actualQuantityValue || row.quantity || 0)
                    : quantity;

                return {
                    product_id: Number(row.product_id || 0),
                    quantity,
                    actual_product_id: actualProductId || undefined,
                    actual_quantity: actualQuantity || undefined,
                    notes: row.notes || '',
                    actual_reason: row.custom_actual ? (row.actual_reason || '') : '',
                };
            })
            .filter((row) => row.quantity > 0);

        if (payloadItems.length === 0) {
            onNotify?.({ type: 'error', message: 'Can nhap it nhat 1 dong san pham co so luong lon hon 0.' });
            return;
        }

        const invalidCustomRow = composerRows.find((row) => {
            if (!row.custom_actual || Number(row.quantity || 0) <= 0) return false;
            const actualProductId = Number(row.actualProductId || 0);
            const actualQuantity = Number(row.actualQuantityValue || row.quantity || 0);
            return actualProductId <= 0 || actualQuantity <= 0 || (row.hasVariance && !(row.actual_reason || '').trim());
        });

        if (invalidCustomRow) {
            onNotify?.({
                type: 'error',
                message: 'Dong khai bao thuc te khac can co SKU thuc te, so luong thuc te va ly do neu co lech.',
            });
            return;
        }

        setSaving(true);
        try {
            await orderApi.createInventorySlip(orderId, {
                type: composerType,
                document_date: form.document_date || todayValue(),
                notes: form.notes || '',
                items: payloadItems,
            });

            onNotify?.({
                type: 'success',
                message: `${slipTypeMeta[composerType].label} da duoc tao thanh cong.`,
            });
            closeComposer();
            await loadDetail();
            await onUpdated?.();
        } catch (error) {
            const serverMessage = error.response?.data?.message
                || Object.values(error.response?.data?.errors || {}).flat()[0]
                || 'Khong the luu phieu kho.';
            onNotify?.({ type: 'error', message: serverMessage });
        } finally {
            setSaving(false);
        }
    };

    const removeSlip = async (document) => {
        if (!document || !orderId) return;

        const confirmed = window.confirm(`Xoa ${document.type_label?.toLowerCase() || 'phieu kho'} ${document.document_number}?`);
        if (!confirmed) return;

        setDeletingId(document.id);
        try {
            await orderApi.deleteInventorySlip(orderId, document.id);
            onNotify?.({
                type: 'success',
                message: `${document.type_label || 'Phieu kho'} da duoc xoa.`,
            });
            await loadDetail();
            await onUpdated?.();
        } catch (error) {
            const serverMessage = error.response?.data?.message
                || Object.values(error.response?.data?.errors || {}).flat()[0]
                || 'Khong the xoa phieu kho.';
            onNotify?.({ type: 'error', message: serverMessage });
        } finally {
            setDeletingId(null);
        }
    };

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100000]">
            <div className="absolute inset-0 bg-primary/15 backdrop-blur-[2px]" onClick={onClose} />
            <div className="absolute inset-y-0 right-0 flex w-full justify-end">
                <div className="relative flex h-full w-full max-w-[980px] flex-col border-l border-primary/10 bg-[#f8fafc] shadow-[0_20px_70px_-20px_rgba(15,23,42,0.35)]">
                    <div className="border-b border-primary/10 bg-white px-6 py-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-primary/[0.04] text-primary">
                                        <span className="material-symbols-outlined text-[24px]">inventory</span>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Phieu kho theo don</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <div className="text-[20px] font-black text-primary">{detail?.order?.order_number || `Don #${orderId}`}</div>
                                            <span className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${summaryToneClasses[summary.tone] || summaryToneClasses.slate}`}>
                                                <span className="material-symbols-outlined text-[14px]">
                                                    {summary.state === 'fulfilled' ? 'verified' : summary.has_variance ? 'warning' : 'inventory_2'}
                                                </span>
                                                {summary.label}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-[12px] text-primary/55">
                                            {detail?.order?.customer_name || 'Khach chua co ten'}
                                            {detail?.order?.customer_phone ? ` • ${detail.order.customer_phone}` : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary/65 transition hover:border-primary hover:bg-primary/[0.04] hover:text-primary"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            {Object.entries(slipTypeMeta).map(([type, meta]) => {
                                const disabled = type === 'export' ? exportableTotal <= 0 : reversibleTotal <= 0;
                                return (
                                    <button
                                        key={type}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => openComposer(type)}
                                        title={disabled ? 'Khong con so luong kha dung cho loai phieu nay.' : meta.helper}
                                        className={`inline-flex h-10 items-center gap-2 rounded-sm border px-4 text-[12px] font-black transition ${
                                            disabled
                                                ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                                                : composerType === type
                                                    ? 'border-primary bg-primary text-white'
                                                    : 'border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/[0.04]'
                                        }`}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                                        {meta.actionLabel}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-5">
                        {loading ? (
                            <div className="flex h-full items-center justify-center">
                                <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-4 text-[13px] font-semibold text-primary">
                                    <div className="h-6 w-6 rounded-full border-2 border-primary/15 border-t-primary animate-spin" />
                                    Dang tai chi tiet phieu kho...
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                                    <MetricCard label="Theo don" value={formatNumber(summary.required_quantity)} hint="San pham khach dat" />
                                    <MetricCard label="Theo phieu xuat" value={formatNumber(summary.document_export_quantity)} hint={`${formatNumber(summary.export_slip_count)} phieu`} />
                                    <MetricCard label="Thuc xuat" value={formatNumber(summary.exported_quantity)} hint="Tinh theo SKU thuc te" tone={summary.has_variance ? 'amber' : 'slate'} />
                                    <MetricCard label="Thuc hoan" value={formatNumber(summary.returned_quantity)} hint={`${formatNumber(summary.return_slip_count)} phieu hoan`} />
                                    <MetricCard label="Thuc hong" value={formatNumber(summary.damaged_quantity)} hint={`${formatNumber(summary.damaged_slip_count)} phieu hong`} />
                                    <MetricCard label="Chenh lech" value={formatNumber(summary.difference_quantity)} hint={summary.quick_summary} tone={summary.has_variance ? 'amber' : 'emerald'} />
                                </div>

                                {summary.has_variance ? (
                                    <div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                                        <div className="flex items-start gap-2">
                                            <span className="material-symbols-outlined text-[18px]">warning</span>
                                            <div>
                                                <div className="font-black">Don hang dang co lech giua theo don, theo phieu va thuc te.</div>
                                                <div className="mt-1">{summary.quick_summary}</div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                <div className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                    <div className="border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                        <div className="text-[13px] font-black text-primary">Tong hop lech theo SKU</div>
                                        <div className="mt-1 text-[11px] text-primary/55">Hien ro 3 lop du lieu: theo don, theo phieu va thuc te xuat/hoan/hong.</div>
                                    </div>
                                    {products.length === 0 ? (
                                        <div className="px-4 py-4">
                                            <EmptyState title="Don hang chua co san pham" description="Khong co dong nao de tong hop phieu kho." />
                                        </div>
                                    ) : (
                                        <div className="max-h-[320px] overflow-auto">
                                            <table className="w-full border-collapse">
                                                <thead className="sticky top-0 bg-white">
                                                    <tr>
                                                        <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SKU</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Theo don</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Theo phieu</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thuc xuat</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thuc hoan</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thuc hong</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Con phieu</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Co the hoan</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Chenh lech</th>
                                                        <th className="border-b border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Canh bao</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {products.map((product) => (
                                                        <tr key={product.product_id} className={product.has_warning ? 'bg-amber-50/40' : 'hover:bg-primary/[0.03]'}>
                                                            <td className="border-b border-r border-primary/10 px-4 py-3">
                                                                <div className="text-[13px] font-black text-primary">{product.product_name}</div>
                                                                <div className="mt-1 text-[11px] font-bold text-orange-600/70">{product.product_sku || 'Khong co SKU'}</div>
                                                            </td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.required_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.document_export_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.actual_exported_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.actual_returned_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.actual_damaged_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.remaining_planned_export_quantity || product.exportable_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.reversible_planned_quantity || product.reversible_quantity)}</td>
                                                            <td className={`border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black ${Number(product.difference_quantity || 0) === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{formatNumber(product.difference_quantity)}</td>
                                                            <td className="border-b border-primary/10 px-4 py-3 text-[12px] text-primary/65">{product.warnings?.length ? product.warnings.join(' ') : '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                {composerType ? (
                                    <div className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                        <div className="border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-[14px] font-black text-primary">{slipTypeMeta[composerType].label}</div>
                                                    <div className="mt-1 text-[11px] text-primary/55">{slipTypeMeta[composerType].helper}</div>
                                                </div>
                                                <div className="text-[11px] font-bold text-primary/55">
                                                    Theo phieu {formatNumber(draftPlannedTotal)} • Thuc te {formatNumber(draftActualTotal)}
                                                </div>
                                            </div>
                                            <div className="mt-4 grid gap-3 md:grid-cols-[180px,1fr]">
                                                <input
                                                    type="date"
                                                    value={form.document_date || todayValue()}
                                                    onChange={(event) => setForm((current) => ({ ...current, document_date: event.target.value }))}
                                                    className="h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                                />
                                                <input
                                                    type="text"
                                                    value={form.notes || ''}
                                                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                                                    placeholder="Ghi chu chung cho phieu"
                                                    className="h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                                />
                                            </div>
                                        </div>

                                        <div className="max-h-[420px] overflow-y-auto px-4 py-4">
                                            <div className="space-y-3">
                                                {composerRows.map((row) => (
                                                    <div key={row.product_id} className={`rounded-sm border px-4 py-4 ${row.disabled ? 'border-primary/10 bg-stone-50' : 'border-primary/10 bg-white'}`}>
                                                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr),140px,140px,minmax(0,1fr)]">
                                                            <div>
                                                                <div className={`text-[13px] font-black ${row.disabled ? 'text-primary/40' : 'text-primary'}`}>{row.product?.product_name || `San pham #${row.product_id}`}</div>
                                                                <div className="mt-1 text-[11px] font-bold text-orange-600/70">{row.product?.product_sku || 'Khong co SKU'}</div>
                                                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                                                    <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2 text-[11px] text-primary/60">
                                                                        <div className="font-black uppercase tracking-[0.08em] text-primary/35">Theo don</div>
                                                                        <div className="mt-1 text-[13px] font-black text-primary">{formatNumber(row.product?.required_quantity || 0)}</div>
                                                                    </div>
                                                                    <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-3 py-2 text-[11px] text-primary/60">
                                                                        <div className="font-black uppercase tracking-[0.08em] text-primary/35">{composerType === 'export' ? 'Con phieu' : 'Co the xu ly'}</div>
                                                                        <div className="mt-1 text-[13px] font-black text-primary">{formatNumber(row.maxQuantity)}</div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL theo phieu</div>
                                                                <QuantityInput
                                                                    value={row.quantity}
                                                                    disabled={row.disabled}
                                                                    onChange={(value) => updateRow(row.product_id, { quantity: value })}
                                                                />
                                                            </div>

                                                            <div>
                                                                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Che do</div>
                                                                <div className="grid gap-2">
                                                                    <button
                                                                        type="button"
                                                                        disabled={row.disabled}
                                                                        onClick={() => updateRow(row.product_id, {
                                                                            custom_actual: false,
                                                                            actual_product_id: row.product_id,
                                                                            actual_product_name: row.product?.product_name,
                                                                            actual_product_sku: row.product?.product_sku,
                                                                            actual_quantity: '',
                                                                            actual_reason: '',
                                                                        })}
                                                                        className={`rounded-sm border px-3 py-2 text-left text-[12px] font-black transition ${!row.custom_actual ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary'}`}
                                                                    >
                                                                        Dung theo phieu
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        disabled={row.disabled}
                                                                        onClick={() => updateRow(row.product_id, { custom_actual: true, actual_quantity: row.actual_quantity || row.quantity || '' })}
                                                                        className={`rounded-sm border px-3 py-2 text-left text-[12px] font-black transition ${row.custom_actual ? 'border-primary bg-primary text-white' : 'border-primary/15 bg-white text-primary hover:border-primary'}`}
                                                                    >
                                                                        Khai bao thuc te khac
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                {row.custom_actual ? (
                                                                    <>
                                                                        <div>
                                                                            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SKU thuc te</div>
                                                                            <ProductSearchSelect
                                                                                disabled={row.disabled}
                                                                                value={row.knownActualProduct}
                                                                                onSelect={(product) => updateRow(row.product_id, {
                                                                                    actual_product_id: product.id,
                                                                                    actual_product_name: product.name,
                                                                                    actual_product_sku: product.sku,
                                                                                })}
                                                                            />
                                                                        </div>
                                                                        <div className="grid gap-3 sm:grid-cols-[160px,1fr]">
                                                                            <div>
                                                                                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL thuc te</div>
                                                                                <QuantityInput
                                                                                    value={row.actualQuantityValue}
                                                                                    disabled={row.disabled}
                                                                                    onChange={(value) => updateRow(row.product_id, { actual_quantity: value })}
                                                                                />
                                                                            </div>
                                                                            <div>
                                                                                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ly do lech</div>
                                                                                <input
                                                                                    type="text"
                                                                                    value={row.actual_reason || ''}
                                                                                    disabled={row.disabled}
                                                                                    onChange={(event) => updateRow(row.product_id, { actual_reason: event.target.value })}
                                                                                    placeholder="Vi du: kho dong nham, doi SKU, thieu 1 san pham..."
                                                                                    className={`h-10 w-full rounded-sm border px-3 text-[13px] font-semibold outline-none transition ${
                                                                                        row.disabled
                                                                                            ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                                                                                            : 'border-primary/15 bg-white text-primary focus:border-primary'
                                                                                    }`}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <div className="rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-3 text-[12px] text-emerald-800">
                                                                        Ton kho va phieu se di theo SKU tren dong nay.
                                                                    </div>
                                                                )}

                                                                <input
                                                                    type="text"
                                                                    value={row.notes || ''}
                                                                    disabled={row.disabled}
                                                                    onChange={(event) => updateRow(row.product_id, { notes: event.target.value })}
                                                                    placeholder="Ghi chu dong"
                                                                    className={`h-10 w-full rounded-sm border px-3 text-[13px] font-semibold outline-none transition ${
                                                                        row.disabled
                                                                            ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                                                                            : 'border-primary/15 bg-white text-primary focus:border-primary'
                                                                    }`}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                            <div className="text-[12px] text-primary/60">
                                                Luu theo phieu <span className="font-black text-primary">{formatNumber(draftPlannedTotal)}</span> • thuc te <span className="font-black text-primary">{formatNumber(draftActualTotal)}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={closeComposer}
                                                    className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[12px] font-black text-primary transition hover:border-primary hover:bg-primary/[0.04]"
                                                >
                                                    Huy
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={submitSlip}
                                                    disabled={saving || draftPlannedTotal <= 0}
                                                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">save</span>
                                                    {saving ? 'Dang luu...' : 'Luu phieu'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                {Object.entries(slipTypeMeta).map(([type, meta]) => {
                                    const rows = documents[type] || [];

                                    return (
                                        <div key={type} className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-sm border ${meta.classes}`}>
                                                        <span className="material-symbols-outlined text-[18px]">{meta.icon}</span>
                                                    </span>
                                                    <div>
                                                        <div className="text-[14px] font-black text-primary">{meta.label}</div>
                                                        <div className="text-[11px] text-primary/55">{formatNumber(rows.length)} phieu</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {rows.length === 0 ? (
                                                <div className="px-4 py-4">
                                                    <EmptyState
                                                        title={`Chua co ${meta.label.toLowerCase()}`}
                                                        description="Ban co the tao ngay trong drawer nay khi can doi chieu lai ton kho theo thuc te."
                                                    />
                                                </div>
                                            ) : (
                                                <div className="space-y-3 px-4 py-4">
                                                    {rows.map((documentRow) => (
                                                        <div key={documentRow.id} className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 px-4 py-3">
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <div className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${meta.classes}`}>
                                                                            <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                                                                            {documentRow.document_number}
                                                                        </div>
                                                                        {documentRow.source_label ? (
                                                                            <div className="inline-flex items-center gap-1 rounded-sm border border-primary/15 bg-primary/[0.04] px-2.5 py-1 text-[11px] font-black text-primary/70">
                                                                                <span className="material-symbols-outlined text-[14px]">sync</span>
                                                                                {documentRow.source_label}
                                                                            </div>
                                                                        ) : null}
                                                                        <div className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${summaryToneClasses[documentRow.status_tone] || summaryToneClasses.slate}`}>
                                                                            <span className="material-symbols-outlined text-[14px]">verified</span>
                                                                            {documentRow.status_label}
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-primary/60">
                                                                        <span>Ngay phieu: <span className="font-black text-primary">{formatDateTime(documentRow.document_date)}</span></span>
                                                                        <span>Theo phieu: <span className="font-black text-primary">{formatNumber(documentRow.planned_total_quantity || documentRow.total_quantity)}</span></span>
                                                                        <span>Thuc te: <span className="font-black text-primary">{formatNumber(documentRow.actual_total_quantity || documentRow.total_quantity)}</span></span>
                                                                        {documentRow.created_by_name ? <span>Nguoi tao: <span className="font-black text-primary">{documentRow.created_by_name}</span></span> : null}
                                                                    </div>
                                                                    {documentRow.notes ? <div className="mt-2 text-[12px] text-primary/65">{documentRow.notes}</div> : null}
                                                                </div>
                                                                {documentRow.can_delete !== false ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeSlip(documentRow)}
                                                                        disabled={deletingId === documentRow.id}
                                                                        className="inline-flex h-9 items-center gap-1 rounded-sm border border-rose-200 bg-white px-3 text-[12px] font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                        {deletingId === documentRow.id ? 'Dang xoa...' : 'Xoa'}
                                                                    </button>
                                                                ) : null}
                                                            </div>

                                                            <DocumentItemsTable document={documentRow} />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default OrderInventorySlipDrawer;
