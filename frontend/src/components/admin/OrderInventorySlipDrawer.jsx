import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { orderApi } from '../../services/api';

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))}đ`;
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

const statusToneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-primary/15 bg-primary/[0.04] text-primary/70',
};

const slipTypeMeta = {
    export: {
        label: 'Phiếu xuất',
        icon: 'outbox',
        classes: 'border-cyan-200 bg-cyan-50 text-cyan-700',
        actionLabel: 'Tạo phiếu xuất',
        helper: 'Chỉ cho nhập phần còn thiếu so với số lượng cần xuất của đơn.',
    },
    return: {
        label: 'Phiếu hoàn',
        icon: 'assignment_return',
        classes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        actionLabel: 'Tạo phiếu hoàn',
        helper: 'Chỉ cho nhập trên số lượng đã xuất nhưng chưa ghi nhận hoàn hoặc hỏng.',
    },
    damaged: {
        label: 'Phiếu hỏng',
        icon: 'broken_image',
        classes: 'border-rose-200 bg-rose-50 text-rose-700',
        actionLabel: 'Tạo phiếu hỏng',
        helper: 'Dùng khi hàng của đơn bị hỏng sau khi đã xuất và cần tách riêng theo phiếu.',
    },
};

const emptyDetail = {
    order: null,
    summary: {
        label: 'Chưa tạo phiếu',
        tone: 'slate',
        required_quantity: 0,
        exported_quantity: 0,
        returned_quantity: 0,
        damaged_quantity: 0,
        remaining_quantity: 0,
        export_slip_count: 0,
        return_slip_count: 0,
        damaged_slip_count: 0,
        quick_summary: '',
    },
    products: [],
    documents: {
        export: [],
        return: [],
        damaged: [],
    },
};

const buildDraftForm = (detail, type) => ({
    document_date: todayValue(),
    notes: '',
    items: (detail?.products || []).map((product) => ({
        product_id: product.product_id,
        quantity: '',
        notes: '',
    })),
    type,
});

const MetricCard = ({ label, value, hint }) => (
    <div className="rounded-sm border border-primary/10 bg-[#fbfcfe] px-4 py-3">
        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">{label}</div>
        <div className="mt-1 text-[22px] font-black text-primary">{value}</div>
        {hint ? <div className="mt-1 text-[11px] text-primary/50">{hint}</div> : null}
    </div>
);

const QuantityInput = ({ value, onChange, disabled, max }) => (
    <input
        type="text"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(stripNumericValue(event.target.value))}
        placeholder="0"
        className={`h-9 w-20 rounded-sm border px-2 text-right text-[13px] font-black outline-none transition ${
            disabled
                ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                : 'border-primary/15 bg-white text-primary focus:border-primary'
        }`}
        title={disabled ? 'Không còn số lượng khả dụng cho loại phiếu này.' : `Tối đa ${formatNumber(max)}`}
    />
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
                message: error.response?.data?.message || 'Không thể tải chi tiết phiếu kho của đơn hàng.',
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

    const exportableTotal = useMemo(
        () => products.reduce((sum, product) => sum + Number(product.exportable_quantity || 0), 0),
        [products]
    );

    const reversibleTotal = useMemo(
        () => products.reduce((sum, product) => sum + Number(product.reversible_quantity || 0), 0),
        [products]
    );

    const activeTypeMeta = composerType ? slipTypeMeta[composerType] : null;

    const draftRows = useMemo(
        () => (form.items || []).map((item) => {
            const product = products.find((entry) => String(entry.product_id) === String(item.product_id));
            const maxQuantity = composerType === 'export'
                ? Number(product?.exportable_quantity || 0)
                : Number(product?.reversible_quantity || 0);

            return {
                ...item,
                product,
                maxQuantity,
                disabled: maxQuantity <= 0,
            };
        }),
        [composerType, form.items, products]
    );

    const draftTotalQuantity = useMemo(
        () => draftRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
        [draftRows]
    );

    const openComposer = (type) => {
        setComposerType(type);
        setForm(buildDraftForm(detail, type));
    };

    const closeComposer = () => {
        setComposerType(null);
    };

    const updateFormRow = (productId, field, value) => {
        setForm((current) => ({
            ...current,
            items: current.items.map((item) => {
                if (String(item.product_id) !== String(productId)) return item;
                return { ...item, [field]: value };
            }),
        }));
    };

    const submitSlip = async () => {
        if (!composerType || !orderId) return;

        const payloadItems = draftRows
            .map((row) => ({
                product_id: row.product_id,
                quantity: Number(row.quantity || 0),
                notes: row.notes || '',
            }))
            .filter((row) => row.quantity > 0);

        if (payloadItems.length === 0) {
            onNotify?.({ type: 'error', message: 'Cần nhập ít nhất một sản phẩm có số lượng lớn hơn 0.' });
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
                message: `${slipTypeMeta[composerType].label} đã được tạo thành công.`,
            });
            closeComposer();
            await loadDetail();
            await onUpdated?.();
        } catch (error) {
            const serverMessage = error.response?.data?.message
                || Object.values(error.response?.data?.errors || {}).flat()[0]
                || 'Không thể lưu phiếu kho.';
            onNotify?.({ type: 'error', message: serverMessage });
        } finally {
            setSaving(false);
        }
    };

    const removeSlip = async (document) => {
        if (!document || !orderId) return;

        const confirmed = window.confirm(`Xóa ${document.type_label?.toLowerCase() || 'phiếu kho'} ${document.document_number}?`);
        if (!confirmed) return;

        setDeletingId(document.id);
        try {
            await orderApi.deleteInventorySlip(orderId, document.id);
            onNotify?.({
                type: 'success',
                message: `${document.type_label || 'Phiếu kho'} đã được xóa.`,
            });
            await loadDetail();
            await onUpdated?.();
        } catch (error) {
            const serverMessage = error.response?.data?.message
                || Object.values(error.response?.data?.errors || {}).flat()[0]
                || 'Không thể xóa phiếu kho.';
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
                <div className="relative flex h-full w-full max-w-[860px] flex-col border-l border-primary/10 bg-[#f8fafc] shadow-[0_20px_70px_-20px_rgba(15,23,42,0.35)]">
                    <div className="border-b border-primary/10 bg-white px-6 py-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-primary/[0.04] text-primary">
                                        <span className="material-symbols-outlined text-[24px]">inventory</span>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Phiếu kho theo đơn</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <div className="text-[20px] font-black text-primary">{detail?.order?.order_number || `Đơn #${orderId}`}</div>
                                            <span className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${summaryToneClasses[summary.tone] || summaryToneClasses.slate}`}>
                                                <span className="material-symbols-outlined text-[14px]">
                                                    {summary.state === 'fulfilled' ? 'verified' : summary.state === 'partial' ? 'rule' : 'inventory_2'}
                                                </span>
                                                {summary.label}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-[12px] text-primary/55">
                                            {detail?.order?.customer_name || 'Khách chưa có tên'}
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
                                        className={`inline-flex h-10 items-center gap-2 rounded-sm border px-4 text-[12px] font-black transition ${
                                            disabled
                                                ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                                                : composerType === type
                                                    ? 'border-primary bg-primary text-white'
                                                    : 'border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/[0.04]'
                                        }`}
                                        title={disabled ? 'Không còn số lượng khả dụng cho loại phiếu này.' : meta.helper}
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
                                    Đang tải chi tiết phiếu kho...
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                                    <MetricCard label="Cần xuất" value={formatNumber(summary.required_quantity)} hint="Tổng số lượng theo đơn" />
                                    <MetricCard label="Đã xuất" value={formatNumber(summary.exported_quantity)} hint={`${formatNumber(summary.export_slip_count)} phiếu xuất`} />
                                    <MetricCard label="Còn thiếu" value={formatNumber(summary.remaining_quantity)} hint="Phần chưa có phiếu xuất" />
                                    <MetricCard label="Đã hoàn" value={formatNumber(summary.returned_quantity)} hint={`${formatNumber(summary.return_slip_count)} phiếu hoàn`} />
                                    <MetricCard label="Đã hỏng" value={formatNumber(summary.damaged_quantity)} hint={`${formatNumber(summary.damaged_slip_count)} phiếu hỏng`} />
                                </div>

                                <div className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                        <div>
                                            <div className="text-[13px] font-black text-primary">Tổng hợp theo sản phẩm</div>
                                            <div className="mt-1 text-[11px] text-primary/55">Xem nhanh cần xuất, đã xuất, hoàn, hỏng và số lượng còn thiếu của từng SKU trong đơn.</div>
                                        </div>
                                        <div className="text-[11px] font-bold text-primary/55">{summary.quick_summary}</div>
                                    </div>
                                    {products.length === 0 ? (
                                        <EmptyState title="Đơn hàng chưa có sản phẩm" description="Không có dòng sản phẩm nào để tổng hợp phiếu kho." />
                                    ) : (
                                        <div className="max-h-[300px] overflow-auto">
                                            <table className="w-full border-collapse">
                                                <thead className="sticky top-0 bg-white">
                                                    <tr>
                                                        <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Sản phẩm</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Cần</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Xuất</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Hoàn</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Hỏng</th>
                                                        <th className="border-b border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thiếu</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {products.map((product) => (
                                                        <tr key={product.product_id} className="hover:bg-primary/[0.03]">
                                                            <td className="border-b border-r border-primary/10 px-4 py-3">
                                                                <div className="text-[13px] font-black text-primary">{product.product_name}</div>
                                                                <div className="mt-1 text-[11px] font-bold text-orange-600/70">{product.product_sku || 'Không có SKU'}</div>
                                                            </td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(product.required_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-cyan-700">{formatNumber(product.exported_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-emerald-700">{formatNumber(product.returned_quantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-rose-700">{formatNumber(product.damaged_quantity)}</td>
                                                            <td className="border-b border-primary/10 px-3 py-3 text-right text-[13px] font-black text-amber-700">{formatNumber(product.remaining_quantity)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                {composerType ? (
                                    <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                            <div>
                                                <div className="flex items-center gap-2 text-[14px] font-black text-primary">
                                                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-sm border ${activeTypeMeta.classes}`}>
                                                        <span className="material-symbols-outlined text-[18px]">{activeTypeMeta.icon}</span>
                                                    </span>
                                                    {activeTypeMeta.actionLabel}
                                                </div>
                                                <div className="mt-1 text-[11px] text-primary/55">{activeTypeMeta.helper}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={closeComposer}
                                                className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-black text-primary transition hover:border-primary hover:bg-primary/[0.04]"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                                Đóng form
                                            </button>
                                        </div>

                                        <div className="grid gap-3 border-b border-primary/10 px-4 py-4 md:grid-cols-[180px,1fr]">
                                            <div>
                                                <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ngày phiếu</label>
                                                <input
                                                    type="date"
                                                    value={form.document_date}
                                                    onChange={(event) => setForm((current) => ({ ...current, document_date: event.target.value }))}
                                                    className="h-10 w-full rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-bold text-primary outline-none focus:border-primary"
                                                />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ghi chú chung</label>
                                                <input
                                                    type="text"
                                                    value={form.notes}
                                                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                                                    className="h-10 w-full rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-semibold text-primary outline-none focus:border-primary"
                                                    placeholder="Ví dụ: Xuất đợt 1, hoàn đổi size, hàng hỏng do vận chuyển..."
                                                />
                                            </div>
                                        </div>

                                        <div className="max-h-[320px] overflow-auto">
                                            <table className="w-full border-collapse">
                                                <thead className="sticky top-0 bg-white">
                                                    <tr>
                                                        <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Sản phẩm</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Cần</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">{composerType === 'export' ? 'Còn xuất' : 'Còn xử lý'}</th>
                                                        <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Nhập SL</th>
                                                        <th className="border-b border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ghi chú dòng</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {draftRows.map((row) => (
                                                        <tr key={row.product_id} className={row.disabled ? 'bg-stone-50' : 'hover:bg-primary/[0.03]'}>
                                                            <td className="border-b border-r border-primary/10 px-4 py-3">
                                                                <div className={`text-[13px] font-black ${row.disabled ? 'text-primary/45' : 'text-primary'}`}>{row.product?.product_name || `Sản phẩm #${row.product_id}`}</div>
                                                                <div className="mt-1 text-[11px] font-bold text-orange-600/70">{row.product?.product_sku || 'Không có SKU'}</div>
                                                            </td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary/70">{formatNumber(row.product?.required_quantity || 0)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(row.maxQuantity)}</td>
                                                            <td className="border-b border-r border-primary/10 px-3 py-3 text-right">
                                                                <div className="flex justify-end">
                                                                    <QuantityInput
                                                                        value={row.quantity}
                                                                        max={row.maxQuantity}
                                                                        disabled={row.disabled}
                                                                        onChange={(value) => updateFormRow(row.product_id, 'quantity', value)}
                                                                    />
                                                                </div>
                                                            </td>
                                                            <td className="border-b border-primary/10 px-4 py-3">
                                                                <input
                                                                    type="text"
                                                                    value={row.notes || ''}
                                                                    disabled={row.disabled}
                                                                    onChange={(event) => updateFormRow(row.product_id, 'notes', event.target.value)}
                                                                    placeholder="Ghi chú riêng cho dòng này"
                                                                    className={`h-9 w-full rounded-sm border px-3 text-[12px] outline-none transition ${
                                                                        row.disabled
                                                                            ? 'cursor-not-allowed border-primary/10 bg-stone-100 text-primary/35'
                                                                            : 'border-primary/15 bg-white text-primary focus:border-primary'
                                                                    }`}
                                                                />
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                            <div className="text-[12px] text-primary/60">
                                                Sẽ tạo <span className="font-black text-primary">{activeTypeMeta.label.toLowerCase()}</span> với tổng <span className="font-black text-primary">{formatNumber(draftTotalQuantity)}</span> đơn vị.
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={closeComposer}
                                                    className="inline-flex h-10 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[12px] font-black text-primary transition hover:border-primary hover:bg-primary/[0.04]"
                                                >
                                                    Hủy
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={submitSlip}
                                                    disabled={saving || draftTotalQuantity <= 0}
                                                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">save</span>
                                                    {saving ? 'Đang lưu...' : 'Lưu phiếu'}
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
                                                        <div className="text-[11px] text-primary/55">{formatNumber(rows.length)} phiếu</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {rows.length === 0 ? (
                                                <div className="px-4 py-4">
                                                    <EmptyState
                                                        title={`Chưa có ${meta.label.toLowerCase()}`}
                                                        description="Khi cần xem sâu hoặc quản lý theo từng đợt, bạn có thể tạo phiếu trực tiếp ngay trong drawer này."
                                                    />
                                                </div>
                                            ) : (
                                                <div className="space-y-3 px-4 py-4">
                                                    {rows.map((document) => (
                                                        <div key={document.id} className="overflow-hidden rounded-sm border border-primary/10 bg-white">
                                                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 px-4 py-3">
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <div className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${meta.classes}`}>
                                                                            <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                                                                            {document.document_number}
                                                                        </div>
                                                                        <div className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[11px] font-black ${statusToneClasses[document.status_tone] || statusToneClasses.slate}`}>
                                                                            <span className="material-symbols-outlined text-[14px]">verified</span>
                                                                            {document.status_label}
                                                                        </div>
                                                                    </div>
                                                                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-primary/60">
                                                                        <span>Ngày phiếu: <span className="font-black text-primary">{formatDateTime(document.document_date)}</span></span>
                                                                        <span>Tổng SL: <span className="font-black text-primary">{formatNumber(document.total_quantity)}</span></span>
                                                                        {document.created_by_name ? <span>Người tạo: <span className="font-black text-primary">{document.created_by_name}</span></span> : null}
                                                                    </div>
                                                                    {document.notes ? <div className="mt-2 text-[12px] text-primary/65">{document.notes}</div> : null}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeSlip(document)}
                                                                    disabled={deletingId === document.id}
                                                                    className="inline-flex h-9 items-center gap-1 rounded-sm border border-rose-200 bg-white px-3 text-[12px] font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                                                    {deletingId === document.id ? 'Đang xóa...' : 'Xóa'}
                                                                </button>
                                                            </div>

                                                            <div className="overflow-auto">
                                                                <table className="w-full border-collapse">
                                                                    <thead className="bg-[#fbfcfe]">
                                                                        <tr>
                                                                            <th className="border-b border-r border-primary/10 px-4 py-2.5 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Sản phẩm</th>
                                                                            <th className="border-b border-r border-primary/10 px-3 py-2.5 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL phiếu</th>
                                                                            <th className="border-b border-r border-primary/10 px-3 py-2.5 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Đơn giá</th>
                                                                            <th className="border-b border-primary/10 px-3 py-2.5 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Thành tiền</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {document.items.map((item) => (
                                                                            <tr key={item.id} className="hover:bg-primary/[0.02]">
                                                                                <td className="border-b border-r border-primary/10 px-4 py-3">
                                                                                    <div className="text-[13px] font-black text-primary">{item.product_name}</div>
                                                                                    <div className="mt-1 text-[11px] font-bold text-orange-600/70">{item.product_sku || 'Không có SKU'}</div>
                                                                                    {item.notes ? <div className="mt-1 text-[11px] text-primary/55">{item.notes}</div> : null}
                                                                                </td>
                                                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(item.quantity)}</td>
                                                                                <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{item.unit_price != null ? formatCurrency(item.unit_price) : '-'}</td>
                                                                                <td className="border-b border-primary/10 px-3 py-3 text-right text-[13px] font-black text-brick">{item.total_price != null ? formatCurrency(item.total_price) : '-'}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
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
