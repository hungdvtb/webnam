import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { orderApi, shipmentApi } from '../../services/api';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import TableColumnSettingsPanel from '../../components/TableColumnSettingsPanel';
import SortIndicator from '../../components/SortIndicator';

const COPY_RESET_MS = 1800;

const SHIPMENT_STATUSES = [
    { code: 'created', label: 'Đã tạo', color: '#9ca3af', icon: 'add_circle' },
    { code: 'waiting_pickup', label: 'Chờ lấy hàng', color: '#6b7280', icon: 'schedule' },
    { code: 'picked_up', label: 'Đã lấy hàng', color: '#60a5fa', icon: 'inventory' },
    { code: 'shipped', label: 'Đã gửi', color: '#4f46e5', icon: 'flight_takeoff' },
    { code: 'in_transit', label: 'Đang trung chuyển', color: '#3b82f6', icon: 'local_shipping' },
    { code: 'out_for_delivery', label: 'Đang giao', color: '#1d4ed8', icon: 'delivery_dining' },
    { code: 'delivered', label: 'Giao thành công', color: '#16a34a', icon: 'check_circle' },
    { code: 'delivery_failed', label: 'Giao thất bại', color: '#f97316', icon: 'error' },
    { code: 'returning', label: 'Đang hoàn', color: '#eab308', icon: 'undo' },
    { code: 'returned', label: 'Đã hoàn', color: '#ef4444', icon: 'assignment_return' },
    { code: 'canceled', label: 'Đã hủy', color: '#dc2626', icon: 'cancel' },
];

const RECONCILIATION_STATUSES = [
    { code: 'pending', label: 'Chưa đối soát', color: '#9ca3af' },
    { code: 'reconciled', label: 'Đã đối soát', color: '#16a34a' },
    { code: 'mismatch', label: 'Lệch tiền', color: '#ef4444' },
];

const DEFAULT_COLUMNS = [
    { id: 'shipment_number', label: 'Mã vận đơn', minWidth: '170px' },
    { id: 'order_code', label: 'Đơn hàng', minWidth: '126px' },
    { id: 'carrier_name', label: 'Hãng VC', minWidth: '124px' },
    { id: 'customer_name', label: 'Khách hàng', minWidth: '152px' },
    { id: 'customer_phone', label: 'SĐT', minWidth: '116px' },
    { id: 'customer_info', label: 'Thông tin khách hàng', minWidth: '142px' },
    { id: 'staff_notes', label: 'Ghi chú nhân viên', minWidth: '168px' },
    { id: 'order_status', label: 'Trạng thái đơn hàng', minWidth: '164px' },
    { id: 'shipment_status', label: 'Trạng thái vận đơn', minWidth: '164px' },
    { id: 'cod_amount', label: 'COD', minWidth: '124px' },
    { id: 'shipping_cost', label: 'Phí ship', minWidth: '124px' },
    { id: 'actual_received_amount', label: 'Thực nhận', minWidth: '128px' },
    { id: 'reconciliation_status', label: 'Đối soát', minWidth: '118px' },
    { id: 'shipped_at', label: 'Ngày gửi vận chuyển', minWidth: '132px' },
    { id: 'created_at', label: 'Ngày tạo', minWidth: '112px' },
];

const SHIPMENT_FILTER_STORAGE_KEY = 'shipment_list_filters_v2';
const LEGACY_SEARCH_STORAGE_KEY = 'shipment_list_search_current';

const DEFAULT_FILTERS = {
    search: '',
    order_status: [],
    shipment_status: [],
    customer_name: '',
    shipment_number: '',
    order_code: '',
    customer_phone: '',
    customer_address: '',
    carrier_code: '',
    reconciliation_status: '',
    created_at_from: '',
    created_at_to: '',
    shipping_dispatched_from: '',
    shipping_dispatched_to: '',
    cod_min: '',
    cod_max: '',
    quick_range: '',
};

const EMPTY_STATS = {
    counts: {
        total_orders: 0,
        in_delivery: 0,
        delivered: 0,
        pending_return: 0,
        reconciliation_total: 0,
        reconciliation_done: 0,
        reconciliation_pending: 0,
    },
    amounts: {
        total_revenue: 0,
        carrier_collected: 0,
        shipping_service_fees: 0,
        pending_return_amount: 0,
        percentages: {
            total_revenue: 0,
            carrier_collected: 0,
            shipping_service_fees: 0,
            pending_return_amount: 0,
        },
    },
};

const FILTER_QUERY_KEYS = [
    'search',
    'order_status',
    'shipment_status',
    'customer_name',
    'shipment_number',
    'order_code',
    'customer_phone',
    'customer_address',
    'carrier_code',
    'reconciliation_status',
    'created_at_from',
    'created_at_to',
    'shipping_dispatched_from',
    'shipping_dispatched_to',
    'cod_min',
    'cod_max',
    'quick_range',
];

const parseFilterList = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const normalizeDateFilter = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
const formatDateInput = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const getQuickRangeLabel = (preset) => ({
    last_30_days: '30 ngày vừa qua',
    previous_month: 'Tháng qua',
}[preset] || preset || '');
const getQuickRangeDates = (preset) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (preset === 'last_30_days') {
        const start = new Date(today);
        start.setDate(start.getDate() - 29);
        return {
            shipping_dispatched_from: formatDateInput(start),
            shipping_dispatched_to: formatDateInput(today),
        };
    }

    if (preset === 'previous_month') {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return {
            shipping_dispatched_from: formatDateInput(start),
            shipping_dispatched_to: formatDateInput(end),
        };
    }

    return null;
};
const normalizeShipmentFilters = (raw = {}) => {
    const normalized = {
        ...DEFAULT_FILTERS,
        ...raw,
        search: String(raw?.search ?? DEFAULT_FILTERS.search),
        order_status: Array.isArray(raw?.order_status) ? raw.order_status.filter(Boolean) : parseFilterList(raw?.order_status),
        shipment_status: Array.isArray(raw?.shipment_status) ? raw.shipment_status.filter(Boolean) : parseFilterList(raw?.shipment_status),
        customer_name: String(raw?.customer_name ?? ''),
        shipment_number: String(raw?.shipment_number ?? ''),
        order_code: String(raw?.order_code ?? ''),
        customer_phone: String(raw?.customer_phone ?? ''),
        customer_address: String(raw?.customer_address ?? ''),
        carrier_code: String(raw?.carrier_code ?? ''),
        reconciliation_status: String(raw?.reconciliation_status ?? ''),
        created_at_from: normalizeDateFilter(raw?.created_at_from),
        created_at_to: normalizeDateFilter(raw?.created_at_to),
        shipping_dispatched_from: normalizeDateFilter(raw?.shipping_dispatched_from),
        shipping_dispatched_to: normalizeDateFilter(raw?.shipping_dispatched_to),
        cod_min: raw?.cod_min === undefined || raw?.cod_min === null ? '' : String(raw.cod_min),
        cod_max: raw?.cod_max === undefined || raw?.cod_max === null ? '' : String(raw.cod_max),
        quick_range: String(raw?.quick_range ?? ''),
    };

    if (normalized.quick_range) {
        const range = getQuickRangeDates(normalized.quick_range);
        if (range) {
            normalized.shipping_dispatched_from = range.shipping_dispatched_from;
            normalized.shipping_dispatched_to = range.shipping_dispatched_to;
        } else {
            normalized.quick_range = '';
        }
    }

    return normalized;
};
const hasAnyShipmentFilter = (filters) => Boolean(
    filters.search?.trim()
    || filters.order_status?.length
    || filters.shipment_status?.length
    || filters.customer_name
    || filters.shipment_number
    || filters.order_code
    || filters.customer_phone
    || filters.customer_address
    || filters.carrier_code
    || filters.reconciliation_status
    || filters.created_at_from
    || filters.created_at_to
    || filters.shipping_dispatched_from
    || filters.shipping_dispatched_to
    || filters.cod_min !== ''
    || filters.cod_max !== ''
    || filters.quick_range
);
const buildShipmentRequestParams = (filters) => {
    const params = {};
    if (filters.search?.trim()) params.search = filters.search.trim();
    if (filters.order_status?.length) params.order_status = filters.order_status.join(',');
    if (filters.shipment_status?.length) params.shipment_status = filters.shipment_status.join(',');
    if (filters.customer_name?.trim()) params.customer_name = filters.customer_name.trim();
    if (filters.shipment_number?.trim()) params.shipment_number = filters.shipment_number.trim();
    if (filters.order_code?.trim()) params.order_code = filters.order_code.trim();
    if (filters.customer_phone?.trim()) params.customer_phone = filters.customer_phone.trim();
    if (filters.customer_address?.trim()) params.customer_address = filters.customer_address.trim();
    if (filters.carrier_code) params.carrier_code = filters.carrier_code;
    if (filters.reconciliation_status) params.reconciliation_status = filters.reconciliation_status;
    if (filters.created_at_from) params.created_at_from = filters.created_at_from;
    if (filters.created_at_to) params.created_at_to = filters.created_at_to;
    if (filters.shipping_dispatched_from) params.shipping_dispatched_from = filters.shipping_dispatched_from;
    if (filters.shipping_dispatched_to) params.shipping_dispatched_to = filters.shipping_dispatched_to;
    if (filters.cod_min !== '') params.cod_min = filters.cod_min;
    if (filters.cod_max !== '') params.cod_max = filters.cod_max;
    return params;
};
const buildShipmentFilterQueryString = (filters) => {
    const params = new URLSearchParams();
    const requestParams = buildShipmentRequestParams(filters);

    Object.entries(requestParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });

    if (filters.quick_range) {
        params.set('quick_range', filters.quick_range);
    }

    return params.toString();
};
const loadFiltersFromUrl = () => {
    if (typeof window === 'undefined') return null;

    const params = new URLSearchParams(window.location.search);
    const hasKnownFilter = FILTER_QUERY_KEYS.some((key) => params.has(key));
    if (!hasKnownFilter) return null;

    return normalizeShipmentFilters({
        search: params.get('search') || '',
        order_status: parseFilterList(params.get('order_status')),
        shipment_status: parseFilterList(params.get('shipment_status')),
        customer_name: params.get('customer_name') || '',
        shipment_number: params.get('shipment_number') || '',
        order_code: params.get('order_code') || '',
        customer_phone: params.get('customer_phone') || '',
        customer_address: params.get('customer_address') || '',
        carrier_code: params.get('carrier_code') || '',
        reconciliation_status: params.get('reconciliation_status') || '',
        created_at_from: params.get('created_at_from') || '',
        created_at_to: params.get('created_at_to') || '',
        shipping_dispatched_from: params.get('shipping_dispatched_from') || '',
        shipping_dispatched_to: params.get('shipping_dispatched_to') || '',
        cod_min: params.get('cod_min') || '',
        cod_max: params.get('cod_max') || '',
        quick_range: params.get('quick_range') || '',
    });
};
const loadFiltersFromStorage = () => {
    if (typeof window === 'undefined') return null;

    try {
        const saved = window.localStorage.getItem(SHIPMENT_FILTER_STORAGE_KEY);
        if (!saved) return null;
        return normalizeShipmentFilters(JSON.parse(saved));
    } catch (error) {
        console.error('Failed to restore shipment filters from storage', error);
        return null;
    }
};
const getInitialFilters = () => {
    const fromUrl = loadFiltersFromUrl();
    if (fromUrl) return fromUrl;

    const fromStorage = loadFiltersFromStorage();
    if (fromStorage) return fromStorage;

    if (typeof window !== 'undefined') {
        return normalizeShipmentFilters({
            search: window.localStorage.getItem(LEGACY_SEARCH_STORAGE_KEY) || '',
        });
    }

    return normalizeShipmentFilters();
};

const getStatus = (code, list) => list.find((status) => status.code === code) || { label: code || '-', color: '#9ca3af' };
const fmtMoney = (value) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
const fmtDateTime = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '-' : `${parsed.toLocaleDateString('vi-VN')} ${parsed.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
};
const ORDER_KIND_LABELS = {
    official: 'Chính thức',
    template: 'Đơn mẫu',
    draft: 'Nháp',
};
const NOTE_TYPE_META = {
    general: {
        label: 'Chung',
        icon: 'notes',
        className: 'border-gold/10 bg-gold/5 text-primary',
        badgeClassName: 'border-gold/15 bg-gold/10 text-gold',
    },
    internal: {
        label: 'Nhân viên',
        icon: 'badge',
        className: 'border-primary/10 bg-primary/5 text-primary',
        badgeClassName: 'border-primary/10 bg-primary/10 text-primary',
    },
    warning: {
        label: 'Cảnh báo',
        icon: 'warning',
        className: 'border-red-200 bg-red-50 text-red-700',
        badgeClassName: 'border-red-200 bg-red-100 text-red-600',
    },
};
const copyTextToClipboard = async (value) => {
    const text = String(value ?? '');
    if (!text.trim()) return false;

    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();

    try {
        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);
        return copied;
    } catch (error) {
        document.body.removeChild(textArea);
        throw error;
    }
};
const formatDateTimeParts = (value) => {
    if (!value) return { date: '-', time: '' };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { date: '-', time: '' };
    return { date: parsed.toLocaleDateString('vi-VN'), time: parsed.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) };
};
const getCompactColumnLabelLines = (columnId, label) => {
    if (columnId === 'created_at') return ['Ngày', 'tạo'];
    if (columnId === 'shipped_at') return ['Ngày gửi', 'VC'];
    if (columnId === 'customer_info') return ['Thông tin', 'khách hàng'];
    if (columnId === 'staff_notes') return ['Ghi chú', 'nhân viên'];
    return [label];
};
const buildCustomerAddress = (shipment) => {
    const addressParts = [
        shipment?.customer_address,
        [shipment?.customer_ward, shipment?.customer_district, shipment?.customer_province].filter(Boolean).join(', '),
    ].filter(Boolean);

    return addressParts.join(', ') || '-';
};
const getShipmentProductLines = (shipment) => {
    const rawItems = Array.isArray(shipment?.order?.items) && shipment.order.items.length > 0
        ? shipment.order.items
        : Array.isArray(shipment?.items)
            ? shipment.items.map((item) => item?.orderItem || item).filter(Boolean)
            : [];

    return rawItems.map((item, index) => ({
        id: item?.id || item?.product_id || `shipment-item-${index}`,
        name: item?.product_name_snapshot || item?.product?.name || item?.name || 'Sản phẩm',
        sku: item?.product_sku_snapshot || item?.product?.sku || item?.sku || '',
        quantity: Number(item?.quantity || item?.qty || item?.actual_quantity || 0) || 1,
    }));
};
const isCopyableValue = (value) => {
    const text = String(value ?? '').trim();
    return Boolean(text) && text !== '-';
};
const mergeCarrierOptions = (...groups) => {
    const carrierMap = new Map();
    groups.flat().forEach((carrier) => {
        const code = String(carrier?.carrier_code ?? carrier?.code ?? '').trim();
        if (!code) return;
        const existing = carrierMap.get(code);
        carrierMap.set(code, { code, name: carrier?.carrier_name || carrier?.name || existing?.name || code });
    });
    return Array.from(carrierMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
};
const parseEditableMoney = (value) => {
    const normalized = String(value ?? '').replace(/[^\d.-]/g, '');
    if (!normalized) return 0;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const sanitizeOrderPayload = (order) => {
    if (!order || typeof order !== 'object') return null;
    const safeOrder = { ...order };
    delete safeOrder.items;
    delete safeOrder.shipments;
    delete safeOrder.customer;
    delete safeOrder.attributeValues;
    delete safeOrder.statusLogs;
    return safeOrder;
};
const getNoteTypeMeta = (noteType) => NOTE_TYPE_META[noteType] || NOTE_TYPE_META.internal;
const getShipmentNotesCount = (shipment) => {
    const fromCount = Number(shipment?.notes_count || 0);
    const fromNotes = Array.isArray(shipment?.notes) ? shipment.notes.length : 0;
    return Math.max(fromCount, fromNotes);
};
const getOrderKindLabel = (orderKind) => ORDER_KIND_LABELS[String(orderKind || '').toLowerCase()] || (orderKind || '-');
const getOrderAttributeEntries = (order) => {
    if (!Array.isArray(order?.attribute_values)) return [];

    return order.attribute_values
        .map((attributeValue) => {
            const label = attributeValue?.attribute?.name || attributeValue?.attribute?.code || '';
            const value = String(attributeValue?.value ?? '').trim();

            return {
                id: attributeValue?.id || `${label}-${value}`,
                label,
                value,
            };
        })
        .filter((entry) => entry.label && entry.value);
};

const ShipmentCenteredModal = ({
    eyebrow,
    title,
    meta,
    maxWidth = 'max-w-3xl',
    onClose,
    children,
}) => createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" onClick={onClose}>
        <div
            role="dialog"
            aria-modal="true"
            className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-[28px] border border-primary/10 bg-white shadow-2xl ${maxWidth}`}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="border-b border-primary/10 bg-[#fcfcfa] px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-stone/40">{eyebrow}</p>
                        <h3 className="mt-1 truncate text-[22px] font-black tracking-tight text-primary">{title}</h3>
                        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
                    </div>
                    <button type="button" onClick={onClose} className="flex size-10 items-center justify-center rounded-full text-stone/40 transition-colors hover:bg-stone/5 hover:text-stone-800">
                        <span className="material-symbols-outlined text-[22px]">close</span>
                    </button>
                </div>
            </div>
            {children}
        </div>
    </div>,
    document.body,
);

const ShipmentCustomerInfoModal = ({
    customerInfo,
    onClose,
}) => {
    if (!customerInfo) return null;

    return (
        <ShipmentCenteredModal
            eyebrow="Thông tin khách hàng"
            title={customerInfo.shipmentNumber || 'Vận đơn'}
            onClose={onClose}
            maxWidth="max-w-3xl"
            meta={customerInfo.products?.length > 0 ? (
                <span className="rounded-full border border-gold/10 bg-gold/5 px-3 py-1 text-[11px] font-black text-gold">{customerInfo.products.length} sản phẩm</span>
            ) : null}
        >
            <div className="custom-scrollbar overflow-y-auto bg-[#fcfcfa] px-6 py-5">
                <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-stone/10 bg-white px-4 py-4 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">Tên khách</p>
                            <p className="mt-1 text-[15px] font-black text-primary">{customerInfo.customerName || '-'}</p>
                        </div>
                        <div className="rounded-2xl border border-stone/10 bg-white px-4 py-4 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">SĐT</p>
                            <p className="mt-1 text-[15px] font-black text-primary">{customerInfo.customerPhone || '-'}</p>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-stone/10 bg-white px-4 py-4 shadow-sm">
                        <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">Địa chỉ</p>
                        <p className="mt-1 whitespace-pre-wrap text-[14px] font-bold leading-relaxed text-primary">{customerInfo.customerAddress || '-'}</p>
                    </div>

                    <div className="rounded-2xl border border-stone/10 bg-white px-4 py-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">Sản phẩm khách đặt</p>
                            {customerInfo.loading ? <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" /> : null}
                        </div>

                        {customerInfo.products?.length > 0 ? (
                            <div className="space-y-2">
                                {customerInfo.products.map((product) => (
                                    <div key={product.id} className="rounded-2xl border border-primary/10 bg-[#fcfcfa] px-4 py-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-[13px] font-black text-primary">{product.name}</p>
                                                {product.sku ? <p className="mt-1 truncate font-mono text-[10px] text-stone/40">SKU: {product.sku}</p> : null}
                                            </div>
                                            <span className="shrink-0 rounded-full border border-primary/10 bg-primary/5 px-2.5 py-1 text-[10px] font-black text-primary">x{product.quantity}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-stone/15 bg-[#fcfcfa] px-4 py-6 text-center text-[12px] font-bold text-stone/35">
                                {customerInfo.loading ? 'Đang tải danh sách sản phẩm...' : (customerInfo.error || 'Chưa có dữ liệu sản phẩm.')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ShipmentCenteredModal>
    );
};

const ShipmentStaffNotesPanel = ({
    notePanel,
    onClose,
    onDraftChange,
    onSubmit,
}) => {
    if (!notePanel) return null;

    const notes = Array.isArray(notePanel.shipment?.notes) ? notePanel.shipment.notes : [];
    const notesCount = getShipmentNotesCount(notePanel.shipment);

    return (
        <ShipmentCenteredModal
            eyebrow="Ghi chú nhân viên"
            title={notePanel.shipmentNumber || 'Vận đơn'}
            onClose={onClose}
            maxWidth="max-w-4xl"
            meta={(
                <>
                    {notePanel.orderCode ? <span className="rounded-full border border-primary/10 bg-primary/5 px-3 py-1 text-[11px] font-black text-primary">Đơn {notePanel.orderCode}</span> : null}
                    <span className="rounded-full border border-gold/10 bg-gold/5 px-3 py-1 text-[11px] font-black text-gold">{notesCount} ghi chú</span>
                </>
            )}
        >
            <div className="flex min-h-0 flex-1 flex-col bg-[#fcfcfa]">
                <div className="border-b border-primary/10 bg-white px-6 py-5">
                    <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.2em] text-stone/45">Thêm ghi chú mới</label>
                    <textarea
                        value={notePanel.draft}
                        onChange={(event) => onDraftChange(event.target.value)}
                        rows={4}
                        placeholder="Nhập ghi chú xử lý, nhắc việc, cảnh báo nội bộ..."
                        className="min-h-[112px] w-full resize-none rounded-2xl border border-primary/10 bg-[#fcfcfa] px-4 py-3 text-[14px] text-[#0F172A] outline-none transition-all focus:border-primary/35 focus:ring-2 focus:ring-primary/10"
                        onKeyDown={(event) => {
                            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                                event.preventDefault();
                                onSubmit();
                            }
                        }}
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[12px] text-stone/35">`Ctrl/Cmd + Enter` để gửi nhanh.</p>
                        <button
                            type="button"
                            onClick={onSubmit}
                            disabled={!notePanel.draft.trim() || notePanel.loading || notePanel.saving}
                            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[12px] font-black uppercase tracking-wider text-white transition-all hover:bg-umber disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {notePanel.saving ? <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> : <span className="material-symbols-outlined text-[18px]">send</span>}
                            Lưu ghi chú
                        </button>
                    </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex items-center justify-between border-b border-primary/10 bg-[#fcfcfa] px-6 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone/45">Lịch sử ghi chú</p>
                        {!notePanel.loading && !notePanel.error ? <span className="text-[11px] font-bold text-stone/35">{notesCount} mục</span> : null}
                    </div>

                    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        {notePanel.loading ? (
                            <div className="flex min-h-[240px] items-center justify-center">
                                <div className="h-9 w-9 animate-spin rounded-full border-b-2 border-primary" />
                            </div>
                        ) : notePanel.error ? (
                            <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-6 text-center">
                                <span className="material-symbols-outlined text-[34px] text-red-400">error</span>
                                <p className="mt-2 text-[14px] font-black text-red-600">{notePanel.error}</p>
                            </div>
                        ) : notes.length > 0 ? (
                            <div className="relative pl-8">
                                <div className="absolute left-[11px] top-2 bottom-2 w-px bg-primary/10" />
                                <div className="space-y-4">
                                    {notes.map((note) => {
                                        const noteMeta = getNoteTypeMeta(note.note_type);

                                        return (
                                            <div key={note.id || `${note.created_at}-${note.content}`} className="relative">
                                                <div className="absolute left-[-5px] top-5 flex size-4 items-center justify-center rounded-full border-4 border-[#fcfcfa] bg-primary shadow-sm">
                                                    <span className="sr-only">{noteMeta.label}</span>
                                                </div>
                                                <div className="rounded-2xl border border-primary/10 bg-white px-5 py-4 shadow-sm">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div className="min-w-0 flex-1">
                                                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${noteMeta.badgeClassName}`}>
                                                                    <span className="material-symbols-outlined text-[12px]">{noteMeta.icon}</span>
                                                                    {noteMeta.label}
                                                                </span>
                                                                <span className="text-[12px] font-black text-primary">{note.created_by_user?.name || 'Hệ thống'}</span>
                                                            </div>
                                                            <p className="whitespace-pre-wrap break-words text-[14px] font-semibold leading-relaxed text-primary">{note.content}</p>
                                                        </div>
                                                        <div className="shrink-0 text-right text-[11px] font-medium text-stone/45">
                                                            {fmtDateTime(note.created_at)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-stone/15 bg-white px-6 py-10 text-center">
                                <span className="material-symbols-outlined text-[42px] text-stone/20">sticky_note_2</span>
                                <p className="mt-3 text-[14px] font-black text-stone/35">Chưa có ghi chú nhân viên</p>
                                <p className="mt-1 text-[12px] text-stone/30">Nhập nội dung ở phía trên để bắt đầu lưu lịch sử xử lý nội bộ.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ShipmentCenteredModal>
    );
};

const ShipmentCopyableCell = ({
    children,
    copyValue = '',
    copyId,
    copyLabel = 'nội dung ô',
    copiedCellId,
    onCopy,
    iconTopClassName = 'top-0',
    className = '',
    buttonClassName = '',
}) => {
    const canCopy = isCopyableValue(copyValue);

    return (
        <div className={`group/copy relative min-w-0 ${className}`}>
            <div className={canCopy ? 'pr-6' : ''}>{children}</div>
            {canCopy ? (
                <button
                    type="button"
                    onClick={(event) => onCopy(copyValue, event, copyId, copyLabel)}
                    className={`absolute right-0 inline-flex size-5 items-center justify-center rounded-sm transition-all ${iconTopClassName} ${copiedCellId === copyId ? 'text-green-600 opacity-100' : 'text-primary/20 opacity-0 group-hover/copy:opacity-100 hover:text-primary'} ${buttonClassName}`}
                    title={`Sao chép ${copyLabel}`}
                >
                    <span className="material-symbols-outlined text-[14px]">{copiedCellId === copyId ? 'check' : 'content_copy'}</span>
                </button>
            ) : null}
        </div>
    );
};

const StatusBadge = ({ code, list, className = '' }) => {
    const status = getStatus(code, list);
    return (
        <span className={`inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md border px-2.5 py-1 text-[11px] font-black uppercase tracking-wider transition-all ${className}`} title={status.label} style={{ backgroundColor: `${status.color}12`, color: status.color, borderColor: `${status.color}30` }}>
            <span className="truncate">{status.label}</span>
        </span>
    );
};

const StatusDropdownPortal = ({ title, options, currentValue, onSelect, anchorRef, visible, onClose, statusMenuRef }) => {
    const [position, setPosition] = useState(null);
    useEffect(() => {
        if (!visible || !anchorRef.current) return undefined;
        const updatePosition = () => {
            const rect = anchorRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const dropdownWidth = 280;
            const estimatedHeight = Math.min(options.length * 48 + 64, viewportHeight * 0.7);
            let top = rect.bottom + 6;
            let left = rect.left + (rect.width / 2) - (dropdownWidth / 2);
            let placement = 'bottom';
            if (viewportHeight - rect.bottom < estimatedHeight + 10 && rect.top > viewportHeight - rect.bottom) {
                top = rect.top - 6;
                placement = 'top';
            }
            left = Math.max(10, Math.min(left, window.innerWidth - dropdownWidth - 10));
            setPosition({ top, left, placement });
        };
        updatePosition();
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [visible, anchorRef, options]);
    if (!visible) return null;
    return createPortal(
        <div ref={statusMenuRef} style={{ position: 'fixed', top: position?.top || 0, left: position?.left || 0, transform: position?.placement === 'top' ? 'translateY(-100%)' : 'none', zIndex: 999999, width: 280, opacity: position ? 1 : 0 }} className={`overflow-hidden rounded-sm border border-primary/10 bg-white py-2 shadow-2xl ${position?.placement === 'top' ? 'origin-bottom' : 'origin-top'}`} onClick={(event) => event.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2.5 border-b border-primary/5 px-5 py-2.5 opacity-40">
                <span className="material-symbols-outlined text-[16px]">swap_vert</span>
                <p className="text-[10px] font-black uppercase tracking-[0.2em]">{title}</p>
                <button type="button" onClick={onClose} className="ml-auto text-primary/30 hover:text-brick">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
                {options.map((option) => (
                    <button key={option.value} type="button" onClick={() => { onSelect(option.value); onClose(); }} className={`relative flex w-full items-center justify-between px-5 py-3.5 text-sm transition-all hover:bg-primary/5 ${currentValue === option.value ? 'bg-primary/5 font-bold text-primary' : 'text-primary'}`}>
                        <div className="flex min-w-0 items-center gap-4">
                            <div className="h-4 w-4 shrink-0 rounded-full border-2 border-white ring-1 ring-primary/10" style={{ backgroundColor: option.color || '#9ca3af' }} />
                            <span className="truncate text-[14px] font-bold">{option.label}</span>
                        </div>
                        {currentValue === option.value && <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10"><span className="material-symbols-outlined text-[18px] font-bold text-primary">check</span></div>}
                    </button>
                ))}
            </div>
        </div>,
        document.body,
    );
};

const fmtPercent = (value) => `${Number(value || 0).toFixed(1).replace(/\.0$/, '')}%`;

const ShipmentStatsPanel = ({ stats, loading }) => {
    const countCards = [
        {
            key: 'total_orders',
            label: 'Tổng đơn hàng',
            hint: 'Toàn bộ vận đơn theo bộ lọc hiện tại',
            icon: 'inventory_2',
            color: '#4f46e5',
            value: stats?.counts?.total_orders ?? 0,
        },
        {
            key: 'in_delivery',
            label: 'Đang giao',
            hint: 'Chờ lấy, đã lấy, đã gửi, trung chuyển, đang giao',
            icon: 'local_shipping',
            color: '#2563eb',
            value: stats?.counts?.in_delivery ?? 0,
        },
        {
            key: 'delivered',
            label: 'Giao thành công',
            hint: 'Vận đơn đã giao thành công',
            icon: 'check_circle',
            color: '#16a34a',
            value: stats?.counts?.delivered ?? 0,
        },
        {
            key: 'pending_return',
            label: 'Chờ hoàn',
            hint: 'Đang hoàn hoặc đã hoàn nhưng chưa xử lý xong',
            icon: 'assignment_return',
            color: '#d97706',
            value: stats?.counts?.pending_return ?? 0,
        },
    ];

    const reconciliationCards = [
        {
            key: 'reconciliation_total',
            label: 'Tổng số đơn đối soát',
            color: '#0f766e',
            value: stats?.counts?.reconciliation_total ?? 0,
        },
        {
            key: 'reconciliation_done',
            label: 'Đã đối soát',
            color: '#15803d',
            value: stats?.counts?.reconciliation_done ?? 0,
        },
        {
            key: 'reconciliation_pending',
            label: 'Chưa đối soát',
            color: '#b45309',
            value: stats?.counts?.reconciliation_pending ?? 0,
        },
    ];

    const moneyRows = [
        {
            key: 'total_revenue',
            label: 'Tổng doanh số',
            formula: '100% nền so sánh, lấy theo tổng COD sau lọc',
            color: '#4f46e5',
            amount: stats?.amounts?.total_revenue ?? 0,
            percent: stats?.amounts?.percentages?.total_revenue ?? 0,
        },
        {
            key: 'carrier_collected',
            label: 'Tổng tiền bên vận chuyển thu được',
            formula: 'Ưu tiên số đối soát, chưa có thì lấy thực nhận dự kiến của đơn đã giao',
            color: '#0891b2',
            amount: stats?.amounts?.carrier_collected ?? 0,
            percent: stats?.amounts?.percentages?.carrier_collected ?? 0,
        },
        {
            key: 'shipping_service_fees',
            label: 'Tổng phí dịch vụ vận chuyển',
            formula: 'Phí ship + phí dịch vụ + bảo hiểm + phí khác + phí hoàn',
            color: '#dc2626',
            amount: stats?.amounts?.shipping_service_fees ?? 0,
            percent: stats?.amounts?.percentages?.shipping_service_fees ?? 0,
        },
        {
            key: 'pending_return_amount',
            label: 'Tổng tiền hoàn còn lại',
            formula: 'COD của đơn đang hoàn / đã hoàn nhưng vẫn chưa xử lý xong',
            color: '#d97706',
            amount: stats?.amounts?.pending_return_amount ?? 0,
            percent: stats?.amounts?.percentages?.pending_return_amount ?? 0,
        },
    ];

    return (
        <div className="overflow-hidden rounded-[22px] border border-primary/10 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <div className="grid xl:grid-cols-[1.04fr_1fr]">
                <section className="border-b border-primary/10 p-5 xl:border-b-0 xl:border-r xl:p-6">
                    <div className="mb-5 flex items-center justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/35">Thống kê theo số đơn</p>
                            <h3 className="mt-1 text-[22px] font-black tracking-tight text-primary">Tổng quan vận đơn</h3>
                        </div>
                        <div className="rounded-2xl border border-primary/10 bg-primary/[0.04] px-4 py-3 text-right">
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/35">Đang hiển thị</p>
                            <p className="text-[24px] font-black tracking-tight text-primary">{loading ? '...' : (stats?.counts?.total_orders ?? 0)}</p>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        {countCards.map((card) => (
                            <div key={card.key} className="rounded-2xl border border-primary/10 bg-[#fcfcfa] p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/35">{card.label}</p>
                                        <p className="mt-3 text-[28px] font-black tracking-tight" style={{ color: card.color }}>
                                            {loading ? '...' : card.value}
                                        </p>
                                    </div>
                                    <div className="flex size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: `${card.color}12` }}>
                                        <span className="material-symbols-outlined text-[22px]" style={{ color: card.color }}>{card.icon}</span>
                                    </div>
                                </div>
                                <p className="mt-3 text-[12px] leading-relaxed text-primary/45">{card.hint}</p>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 rounded-2xl border border-primary/10 bg-primary/[0.03] p-4">
                        <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">account_balance</span>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/35">Đối soát</p>
                                <p className="text-[14px] font-black text-primary">Thống kê theo số đơn đối soát</p>
                            </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                            {reconciliationCards.map((card) => (
                                <div key={card.key} className="rounded-2xl border border-primary/10 bg-white p-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/35">{card.label}</p>
                                    <p className="mt-3 text-[24px] font-black tracking-tight" style={{ color: card.color }}>
                                        {loading ? '...' : card.value}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="p-5 xl:p-6">
                    <div className="mb-5">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-primary/35">Thống kê theo số tiền</p>
                        <h3 className="mt-1 text-[22px] font-black tracking-tight text-primary">Giá trị và tỷ lệ</h3>
                        <p className="mt-2 text-[12px] leading-relaxed text-primary/45">Tất cả tỷ lệ phần trăm đều tính trên tổng doanh số trong bộ lọc hiện tại.</p>
                    </div>

                    <div className="space-y-3">
                        {moneyRows.map((row) => (
                            <div key={row.key} className="rounded-2xl border border-primary/10 bg-[#fcfcfa] p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-primary/35">{row.label}</p>
                                        <p className="mt-2 text-[12px] leading-relaxed text-primary/45">{row.formula}</p>
                                    </div>
                                    <div className="shrink-0 text-left sm:text-right">
                                        <p className="text-[20px] font-black tracking-tight" style={{ color: row.color }}>
                                            {loading ? '...' : fmtMoney(row.amount)}
                                        </p>
                                        <p className="mt-1 text-[12px] font-black" style={{ color: row.color }}>
                                            {loading ? '...' : fmtPercent(row.percent)}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-primary/5">
                                    <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                            width: `${Math.min(Number(row.percent || 0), 100)}%`,
                                            backgroundColor: row.color,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
};

const ShipmentList = () => {
    const { user } = useAuth();
    const filterRef = useRef(null);
    const columnSettingsRef = useRef(null);
    const searchContainerRef = useRef(null);
    const statusMenuRef = useRef(null);
    const statusMenuAnchorRef = useRef(null);
    const abortRef = useRef(null);
    const copyFeedbackTimeoutRef = useRef(null);

    const [orderStatuses, setOrderStatuses] = useState([]);
    const [shipments, setShipments] = useState([]);
    const [stats, setStats] = useState(EMPTY_STATS);
    const [statsLoading, setStatsLoading] = useState(false);
    const [carriers, setCarriers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState([]);
    const [copiedCellId, setCopiedCellId] = useState(null);
    const [statusMenu, setStatusMenu] = useState(null);
    const [showFilters, setShowFilters] = useState(false);
    const [showStatsPanel, setShowStatsPanel] = useState(() => localStorage.getItem('shipment_list_show_stats') === '1');
    const [showColumnSettings, setShowColumnSettings] = useState(false);
    const [detailShipment, setDetailShipment] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [customerInfoModal, setCustomerInfoModal] = useState(null);
    const [notePanel, setNotePanel] = useState(null);
    const [noteText, setNoteText] = useState('');
    const [drawerTab, setDrawerTab] = useState('overview');
    const [reconcileForm, setReconcileForm] = useState({ amount: '', note: '' });
    const [reconcileLoading, setReconcileLoading] = useState(false);
    const [notification, setNotification] = useState(null);
    const [bulkReconciling, setBulkReconciling] = useState(false);
    const [bulkSyncing, setBulkSyncing] = useState(false);
    const [searchHistory, setSearchHistory] = useState(() => {
        const saved = localStorage.getItem('shipment_search_history');
        return saved ? JSON.parse(saved) : [];
    });
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [tempFilters, setTempFilters] = useState(null);
    const [moneyEditor, setMoneyEditor] = useState(null);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 20 });
    const [filters, setFilters] = useState(() => getInitialFilters());
    const [sortConfig, setSortConfig] = useState(() => {
        const saved = localStorage.getItem('shipment_list_sort');
        return saved ? JSON.parse(saved) : { key: 'created_at', direction: 'desc', phase: 1 };
    });

    const {
        visibleColumns,
        availableColumns,
        renderedColumns,
        columnWidths,
        totalTableWidth,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
        setAvailableColumns,
    } = useTableColumns('shipment_list', DEFAULT_COLUMNS);

    const statusMap = useMemo(() => new Map(orderStatuses.map((status) => [String(status.code), status])), [orderStatuses]);
    const carrierMap = useMemo(() => new Map(carriers.map((carrier) => [String(carrier.code), carrier])), [carriers]);
    const orderStatusOptions = useMemo(() => orderStatuses.map((status) => ({ value: status.code, label: status.name, color: status.color || '#9ca3af' })), [orderStatuses]);
    const shipmentStatusOptions = useMemo(() => SHIPMENT_STATUSES.map((status) => ({ value: status.code, label: status.label, color: status.color })), []);
    const activeStatusMenuShipment = useMemo(() => statusMenu ? shipments.find((shipment) => String(shipment.id) === String(statusMenu.shipmentId)) || null : null, [shipments, statusMenu]);

    const closeDetail = useCallback(() => {
        setDetailShipment(null);
        setDetailLoading(false);
        setDrawerTab('overview');
        setNoteText('');
        setReconcileForm({ amount: '', note: '' });
    }, []);
    const closeCustomerInfo = useCallback(() => {
        setCustomerInfoModal(null);
    }, []);
    const closeNotePanel = useCallback(() => {
        setNotePanel(null);
    }, []);

    const showToast = useCallback((type, message) => setNotification({ type, message }), []);

    const getOrderStatusStyle = useCallback((statusCode) => {
        const status = statusMap.get(String(statusCode));
        return status ? { backgroundColor: `${status.color}15`, color: status.color, borderColor: `${status.color}30` } : { backgroundColor: '#e5e7eb', color: '#6b7280', borderColor: '#d1d5db' };
    }, [statusMap]);

    const addToSearchHistory = useCallback((term) => {
        if (!term?.trim() || term.length < 2) return;
        setSearchHistory((previous) => {
            const updated = [term, ...previous.filter((item) => item !== term)].slice(0, 10);
            localStorage.setItem('shipment_search_history', JSON.stringify(updated));
            return updated;
        });
    }, []);

    const syncShipmentIntoState = useCallback((updatedShipment) => {
        if (!updatedShipment?.id) return;
        setShipments((previous) => previous.map((shipment) => shipment.id === updatedShipment.id ? { ...shipment, ...updatedShipment, order: updatedShipment.order ?? shipment.order, carrier: updatedShipment.carrier ?? shipment.carrier, integration: updatedShipment.integration ?? shipment.integration } : shipment));
        setDetailShipment((previous) => !previous || previous.id !== updatedShipment.id ? previous : { ...previous, ...updatedShipment, order: updatedShipment.order ?? previous.order, carrier: updatedShipment.carrier ?? previous.carrier, integration: updatedShipment.integration ?? previous.integration });
    }, []);

    const syncOrderIntoState = useCallback((updatedOrder) => {
        const safeOrder = sanitizeOrderPayload(updatedOrder);
        if (!safeOrder?.id) return;
        setShipments((previous) => previous.map((shipment) => String(shipment.order?.id ?? shipment.order_id) !== String(safeOrder.id) ? shipment : { ...shipment, order: { ...shipment.order, ...safeOrder }, order_status_snapshot: safeOrder.status ?? shipment.order_status_snapshot }));
        setDetailShipment((previous) => !previous || String(previous.order?.id ?? previous.order_id) !== String(safeOrder.id) ? previous : { ...previous, order: { ...previous.order, ...safeOrder }, order_status_snapshot: safeOrder.status ?? previous.order_status_snapshot });
    }, []);
    const appendShipmentNoteToState = useCallback((shipmentId, note) => {
        if (!shipmentId || !note) return;

        const mergeNoteCollection = (shipment) => {
            const existingNotes = Array.isArray(shipment?.notes) ? shipment.notes : [];
            const dedupedNotes = [note, ...existingNotes.filter((existingNote) => String(existingNote?.id) !== String(note.id))];
            const nextCount = Math.max(getShipmentNotesCount(shipment), existingNotes.length) + (existingNotes.some((existingNote) => String(existingNote?.id) === String(note.id)) ? 0 : 1);

            return {
                ...shipment,
                notes: dedupedNotes,
                notes_count: nextCount,
                latest_note: note,
            };
        };

        setShipments((previous) => previous.map((shipment) => String(shipment.id) !== String(shipmentId) ? shipment : {
            ...shipment,
            notes_count: Math.max(getShipmentNotesCount(shipment), Array.isArray(shipment.notes) ? shipment.notes.length : 0) + (Array.isArray(shipment.notes) && shipment.notes.some((existingNote) => String(existingNote?.id) === String(note.id)) ? 0 : 1),
            latest_note: note,
        }));
        setDetailShipment((previous) => !previous || String(previous.id) !== String(shipmentId) ? previous : mergeNoteCollection(previous));
        setNotePanel((previous) => !previous || String(previous.shipmentId) !== String(shipmentId) ? previous : {
            ...previous,
            shipment: mergeNoteCollection(previous.shipment || {}),
            draft: '',
        });
    }, []);
    const fetchShipmentDetailById = useCallback(async (shipmentId) => {
        const response = await shipmentApi.getOne(shipmentId);
        return response.data;
    }, []);

    const fetchStats = useCallback(async (currentFilters = filters) => {
        setStatsLoading(true);
        try {
            const response = await shipmentApi.getStats(buildShipmentRequestParams(currentFilters));
            setStats(response.data || EMPTY_STATS);
        } catch (error) {
            console.error('Error fetching shipment stats', error);
        } finally {
            setStatsLoading(false);
        }
    }, [filters]);

    const fetchInitialData = useCallback(async () => {
        try {
            const [bootstrapResponse, carrierResponse] = await Promise.all([orderApi.getBootstrap({ mode: 'list' }), shipmentApi.getCarriers()]);
            const bootstrap = bootstrapResponse.data || {};
            setOrderStatuses(bootstrap.order_statuses || []);
            setCarriers(mergeCarrierOptions(bootstrap.connected_carriers || [], carrierResponse.data || []));
            setAvailableColumns(DEFAULT_COLUMNS);
        } catch (error) {
            console.error('Error fetching shipment bootstrap data', error);
            showToast('error', 'Không thể tải cấu hình bảng vận đơn.');
        }
    }, [setAvailableColumns, showToast]);

    const fetchShipments = useCallback(async (page = 1, currentFilters = filters, perPage = pagination.per_page, currentSort = sortConfig) => {
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        try {
            const params = {
                page,
                per_page: perPage,
                sort_by: currentSort.key,
                sort_order: currentSort.direction,
                ...buildShipmentRequestParams(currentFilters),
            };
            const response = await shipmentApi.getAll(params, controller.signal);
            if (controller.signal.aborted) return;
            setShipments(response.data.data || []);
            setPagination({ current_page: response.data.current_page, last_page: response.data.last_page, total: response.data.total, per_page: response.data.per_page });
        } catch (error) {
            if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
            console.error('Error fetching shipments', error);
            showToast('error', 'Không thể tải danh sách vận đơn.');
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
                setLoading(false);
            }
        }
    }, [filters, pagination.per_page, showToast, sortConfig]);

    useEffect(() => { fetchInitialData(); }, [fetchInitialData]);
    useEffect(() => {
        const delay = filters.search?.trim() ? 250 : 0;
        const timer = window.setTimeout(() => {
            fetchShipments(1, filters);
            fetchStats(filters);
        }, delay);
        return () => window.clearTimeout(timer);
    }, [fetchShipments, fetchStats, filters]);
    useEffect(() => { setSelectedIds((previous) => previous.filter((id) => shipments.some((shipment) => shipment.id === id))); }, [shipments]);
    useEffect(() => {
        const queryString = buildShipmentFilterQueryString(filters);

        if (hasAnyShipmentFilter(filters)) {
            localStorage.setItem(SHIPMENT_FILTER_STORAGE_KEY, JSON.stringify(filters));
            localStorage.setItem(LEGACY_SEARCH_STORAGE_KEY, filters.search || '');
        } else {
            localStorage.removeItem(SHIPMENT_FILTER_STORAGE_KEY);
            localStorage.removeItem(LEGACY_SEARCH_STORAGE_KEY);
        }

        if (typeof window !== 'undefined') {
            const nextUrl = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname;
            window.history.replaceState({}, '', nextUrl);
        }
    }, [filters]);
    useEffect(() => {
        if (!notification) return undefined;
        const timer = window.setTimeout(() => setNotification(null), 3500);
        return () => window.clearTimeout(timer);
    }, [notification]);
    useEffect(() => {
        localStorage.setItem('shipment_list_show_stats', showStatsPanel ? '1' : '0');
    }, [showStatsPanel]);
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterRef.current && !filterRef.current.contains(event.target) && !event.target.closest('[data-filter-btn]')) setShowFilters(false);
            if (columnSettingsRef.current && !columnSettingsRef.current.contains(event.target) && !event.target.closest('[data-column-settings-btn]')) setShowColumnSettings(false);
            if (statusMenuRef.current && !statusMenuRef.current.contains(event.target) && !event.target.closest('[data-status-edit-btn]')) setStatusMenu(null);
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key !== 'Escape') return;
            setStatusMenu(null);
            setMoneyEditor(null);
            closeDetail();
            closeCustomerInfo();
            closeNotePanel();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [closeCustomerInfo, closeDetail, closeNotePanel]);
    useEffect(() => {
        const intervalId = window.setInterval(async () => {
            try {
                await shipmentApi.sync({ mode: 'active' });
                fetchShipments(pagination.current_page || 1, filters);
                fetchStats(filters);
            } catch (error) {
                console.error('Shipment auto sync failed', error);
            }
        }, 30000);
        return () => window.clearInterval(intervalId);
    }, [fetchShipments, fetchStats, filters, pagination.current_page]);
    useEffect(() => () => {
        abortRef.current?.abort();
        if (copyFeedbackTimeoutRef.current) window.clearTimeout(copyFeedbackTimeoutRef.current);
    }, []);

    const handleCopy = useCallback(async (text, event, copyId = text, label = 'nội dung ô') => {
        const normalizedText = String(text ?? '').trim();
        if (!isCopyableValue(normalizedText)) return;
        event?.stopPropagation?.();

        try {
            await copyTextToClipboard(normalizedText);
            setCopiedCellId(copyId || normalizedText);
            if (copyFeedbackTimeoutRef.current) {
                window.clearTimeout(copyFeedbackTimeoutRef.current);
            }
            copyFeedbackTimeoutRef.current = window.setTimeout(() => {
                setCopiedCellId((previous) => (previous === (copyId || normalizedText) ? null : previous));
            }, COPY_RESET_MS);
        } catch (error) {
            console.error('Failed to copy shipment cell value', error);
            showToast('error', `Không thể sao chép ${label}.`);
        }
    }, [showToast]);

    const handleSort = (columnId) => {
        if (columnId === 'actions') return;
        const validSortColumns = ['created_at', 'shipment_number', 'order_code', 'carrier_name', 'customer_name', 'customer_phone', 'order_status', 'shipment_status', 'cod_amount', 'shipping_cost', 'actual_received_amount', 'shipped_at'];
        if (!validSortColumns.includes(columnId)) return;
        let nextSort;
        if (sortConfig.key !== columnId) nextSort = { key: columnId, direction: 'desc', phase: 1 };
        else {
            const nextPhase = ((sortConfig.phase || 1) % 3) + 1;
            nextSort = nextPhase === 3 ? { key: 'created_at', direction: 'desc', phase: 1 } : { key: columnId, direction: nextPhase === 2 ? 'asc' : 'desc', phase: nextPhase };
        }
        setSortConfig(nextSort);
        localStorage.setItem('shipment_list_sort', JSON.stringify(nextSort));
    };

    const toggleSelect = useCallback((id) => setSelectedIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]), []);
    const toggleSelectAll = useCallback(() => setSelectedIds((previous) => shipments.length > 0 && previous.length === shipments.length ? [] : shipments.map((shipment) => shipment.id)), [shipments]);
    const activeCount = () => {
        let count = 0;
        if (filters.order_status?.length) count += 1;
        if (filters.shipment_status?.length) count += 1;
        if (filters.customer_name) count += 1;
        if (filters.shipment_number) count += 1;
        if (filters.order_code) count += 1;
        if (filters.customer_phone) count += 1;
        if (filters.customer_address) count += 1;
        if (filters.carrier_code) count += 1;
        if (filters.reconciliation_status) count += 1;
        if (filters.created_at_from || filters.created_at_to) count += 1;
        if (filters.quick_range || filters.shipping_dispatched_from || filters.shipping_dispatched_to) count += 1;
        if (filters.cod_min !== '' || filters.cod_max !== '') count += 1;
        return count;
    };
    const handleTempFilterChange = (event) => {
        const { name, value } = event.target;
        setTempFilters((previous) => normalizeShipmentFilters({
            ...previous,
            [name]: value,
            ...((name === 'shipping_dispatched_from' || name === 'shipping_dispatched_to') ? { quick_range: '' } : {}),
        }));
    };
    const applyFilters = () => {
        if (!tempFilters) return;
        setFilters(normalizeShipmentFilters(tempFilters));
        setShowFilters(false);
    };
    const handleQuickRangeToggle = (preset) => {
        const nextFilters = filters.quick_range === preset
            ? normalizeShipmentFilters({
                ...filters,
                quick_range: '',
                shipping_dispatched_from: '',
                shipping_dispatched_to: '',
            })
            : normalizeShipmentFilters({
                ...filters,
                quick_range: preset,
            });

        setFilters(nextFilters);
        if (showFilters) {
            setTempFilters(nextFilters);
        }
    };
    const removeFilter = (key) => {
        setFilters((previous) => {
            const nextFilters = { ...previous };
            if (key === 'order_status') nextFilters.order_status = [];
            else if (key === 'shipment_status') nextFilters.shipment_status = [];
            else if (key === 'created_at') { nextFilters.created_at_from = ''; nextFilters.created_at_to = ''; }
            else if (key === 'shipping_dispatched_at' || key === 'quick_range') { nextFilters.quick_range = ''; nextFilters.shipping_dispatched_from = ''; nextFilters.shipping_dispatched_to = ''; }
            else if (key === 'cod_amount') { nextFilters.cod_min = ''; nextFilters.cod_max = ''; }
            else nextFilters[key] = '';
            return normalizeShipmentFilters(nextFilters);
        });
    };
    const hasAppliedFilters = hasAnyShipmentFilter(filters);
    const handleReset = () => {
        const resetFilters = normalizeShipmentFilters();
        setFilters(resetFilters);
        setTempFilters(resetFilters);
        const defaultSort = { key: 'created_at', direction: 'desc', phase: 1 };
        setSortConfig(defaultSort);
        localStorage.setItem('shipment_list_sort', JSON.stringify(defaultSort));
    };
    const handleRefresh = () => {
        fetchShipments(pagination.current_page || 1, filters);
        fetchStats(filters);
    };
    const openCustomerInfo = useCallback(async (shipment, event) => {
        event?.stopPropagation?.();
        if (customerInfoModal?.shipmentId === shipment.id) {
            closeCustomerInfo();
            return;
        }

        const fallbackData = {
            shipmentId: shipment.id,
            shipmentNumber: shipment.shipment_number,
            customerName: shipment.customer_name || shipment.order?.customer_name || '-',
            customerPhone: shipment.customer_phone || shipment.order?.customer_phone || '-',
            customerAddress: buildCustomerAddress(shipment),
            products: [],
            loading: true,
            error: null,
        };
        setCustomerInfoModal(fallbackData);

        try {
            const detailData = detailShipment?.id === shipment.id && Array.isArray(detailShipment?.order?.items)
                ? detailShipment
                : await fetchShipmentDetailById(shipment.id);

            setCustomerInfoModal({
                shipmentId: shipment.id,
                shipmentNumber: detailData?.shipment_number || shipment.shipment_number,
                customerName: detailData?.customer_name || detailData?.order?.customer_name || fallbackData.customerName,
                customerPhone: detailData?.customer_phone || detailData?.order?.customer_phone || fallbackData.customerPhone,
                customerAddress: buildCustomerAddress(detailData),
                products: getShipmentProductLines(detailData),
                loading: false,
                error: null,
            });
        } catch (error) {
            console.error('Error loading customer shipment info', error);
            setCustomerInfoModal((previous) => previous ? {
                ...previous,
                loading: false,
                error: 'Không thể tải danh sách sản phẩm của vận đơn này.',
            } : previous);
            showToast('error', 'Không thể tải thông tin khách hàng.');
        }
    }, [closeCustomerInfo, customerInfoModal?.shipmentId, detailShipment, fetchShipmentDetailById, showToast]);
    const openDetail = async (id) => {
        setDetailLoading(true);
        setDetailShipment(null);
        setDrawerTab('overview');
        setReconcileForm({ amount: '', note: '' });
        setNoteText('');
        try {
            const shipmentDetail = await fetchShipmentDetailById(id);
            syncShipmentIntoState(shipmentDetail);
            setDetailShipment(shipmentDetail);
        } catch (error) {
            console.error('Error fetching shipment detail', error);
            showToast('error', 'Không thể tải chi tiết vận đơn.');
        } finally {
            setDetailLoading(false);
        }
    };
    const openNotePanel = useCallback(async (shipment, event) => {
        event?.stopPropagation?.();

        if (notePanel?.shipmentId === shipment.id) {
            closeNotePanel();
            return;
        }

        setNotePanel({
            shipmentId: shipment.id,
            shipmentNumber: shipment.shipment_number,
            orderCode: shipment.order_code || shipment.order?.order_number || '',
            shipment,
            draft: '',
            loading: true,
            saving: false,
            error: null,
        });

        try {
            const shipmentDetail = detailShipment?.id === shipment.id && Array.isArray(detailShipment?.notes)
                ? detailShipment
                : await fetchShipmentDetailById(shipment.id);

            syncShipmentIntoState(shipmentDetail);
            setNotePanel((previous) => !previous || previous.shipmentId !== shipment.id ? previous : {
                ...previous,
                shipment: shipmentDetail,
                shipmentNumber: shipmentDetail.shipment_number || shipment.shipment_number,
                orderCode: shipmentDetail.order_code || shipmentDetail.order?.order_number || shipment.order_code || shipment.order?.order_number || '',
                loading: false,
                error: null,
            });
        } catch (error) {
            console.error('Error loading shipment notes', error);
            setNotePanel((previous) => !previous || previous.shipmentId !== shipment.id ? previous : {
                ...previous,
                loading: false,
                error: 'Không thể tải lịch sử ghi chú cho vận đơn này.',
            });
            showToast('error', 'Không thể tải ghi chú nhân viên.');
        }
    }, [closeNotePanel, detailShipment, fetchShipmentDetailById, notePanel?.shipmentId, showToast, syncShipmentIntoState]);
    const handleAddNote = async () => {
        if (!noteText.trim() || !detailShipment) return;
        try {
            const response = await shipmentApi.addNote(detailShipment.id, { content: noteText.trim(), note_type: 'internal' });
            setNoteText('');
            appendShipmentNoteToState(detailShipment.id, response.data);
            showToast('success', 'Đã thêm ghi chú nhân viên.');
        } catch (error) {
            console.error('Error adding shipment note', error);
            showToast('error', 'Không thể thêm ghi chú vận đơn.');
        }
    };
    const handleSubmitNotePanel = useCallback(async () => {
        const content = notePanel?.draft?.trim();
        if (!notePanel?.shipmentId || !content || notePanel.loading || notePanel.saving) return;

        setNotePanel((previous) => previous ? { ...previous, saving: true } : previous);

        try {
            const response = await shipmentApi.addNote(notePanel.shipmentId, { content, note_type: 'internal' });
            appendShipmentNoteToState(notePanel.shipmentId, response.data);
            setNotePanel((previous) => previous ? { ...previous, saving: false } : previous);
            showToast('success', 'Đã lưu ghi chú nhân viên.');
        } catch (error) {
            console.error('Error adding shipment note from staff note panel', error);
            setNotePanel((previous) => previous ? { ...previous, saving: false } : previous);
            showToast('error', 'Không thể lưu ghi chú nhân viên.');
        }
    }, [appendShipmentNoteToState, notePanel, showToast]);
    const handleReconcile = async () => {
        if (!reconcileForm.amount || !detailShipment) return;
        setReconcileLoading(true);
        try {
            await shipmentApi.markReconciled(detailShipment.id, { reconciled_amount: parseFloat(reconcileForm.amount), note: reconcileForm.note });
            setReconcileForm({ amount: '', note: '' });
            await openDetail(detailShipment.id);
            fetchStats(filters);
            fetchShipments(pagination.current_page || 1, filters);
            showToast('success', 'Đã đối soát vận đơn.');
        } catch (error) {
            console.error('Error reconciling shipment', error);
            showToast('error', error.response?.data?.message || 'Không thể đối soát vận đơn.');
        } finally {
            setReconcileLoading(false);
        }
    };
    const getRiskWarnings = (shipment) => {
        const warnings = [];
        if (Number(shipment.cod_amount || 0) >= 5000000) warnings.push({ type: 'high_cod', label: 'COD cao', icon: 'payments', color: '#f59e0b' });
        if (Number(shipment.attempt_delivery_count || 0) >= 2) warnings.push({ type: 'multi_fail', label: `Giao thất bại ${shipment.attempt_delivery_count} lần`, icon: 'warning', color: '#ef4444' });
        if (['shipped', 'in_transit', 'out_for_delivery'].includes(shipment.shipment_status)) {
            const shippedDate = shipment.shipped_at ? new Date(shipment.shipped_at) : null;
            if (shippedDate && (Date.now() - shippedDate.getTime()) > 3 * 86400000) warnings.push({ type: 'stuck', label: 'Quá 3 ngày chưa giao', icon: 'schedule', color: '#f97316' });
        }
        if (shipment.reconciliation_status === 'mismatch') warnings.push({ type: 'mismatch', label: 'Lệch đối soát', icon: 'error', color: '#dc2626' });
        if (shipment.shipment_status === 'delivered' && shipment.reconciliation_status === 'pending') warnings.push({ type: 'unreconciled', label: 'Chưa đối soát', icon: 'pending_actions', color: '#f59e0b' });
        return warnings;
    };
    const toggleStatusMenu = (shipmentId, type, anchor) => {
        statusMenuAnchorRef.current = anchor;
        setStatusMenu((previous) => previous && previous.shipmentId === shipmentId && previous.type === type ? null : { shipmentId, type });
    };
    const handleShipmentStatusUpdate = async (shipmentId, nextStatus) => {
        try {
            const response = await shipmentApi.updateStatus(shipmentId, { status: nextStatus, reason: 'Cập nhật từ bảng vận đơn', admin_override: Boolean(user?.is_admin) });
            const updatedShipment = response.data?.shipment || response.data;
            syncShipmentIntoState(updatedShipment);
            orderApi.invalidateOne(updatedShipment?.order?.id || updatedShipment?.order_id);
            fetchStats(filters);
            showToast('success', response.data?.message || 'Đã cập nhật trạng thái vận đơn.');
        } catch (error) {
            console.error('Error updating shipment status', error);
            showToast('error', error.response?.data?.message || 'Không thể cập nhật trạng thái vận đơn.');
        }
    };
    const handleOrderStatusUpdate = async (shipment, nextStatus) => {
        if (!shipment?.order?.id) return;
        try {
            const response = await orderApi.updateStatus(shipment.order.id, { status: nextStatus, allow_shipping_override: true, reason: 'Cập nhật từ bảng vận đơn' });
            syncOrderIntoState(response.data);
            showToast('success', 'Đã cập nhật trạng thái đơn hàng.');
        } catch (error) {
            console.error('Error updating order status from shipment list', error);
            showToast('error', error.response?.data?.message || 'Không thể cập nhật trạng thái đơn hàng.');
        }
    };
    const handleBulkStatus = async (nextStatus) => {
        if (!selectedIds.length) return;
        const nextStatusLabel = getStatus(nextStatus, SHIPMENT_STATUSES).label;
        if (!window.confirm(`Cập nhật ${selectedIds.length} vận đơn sang "${nextStatusLabel}"?`)) return;
        try {
            const impactedOrderIds = shipments
                .filter((shipment) => selectedIds.includes(shipment.id))
                .map((shipment) => shipment.order?.id || shipment.order_id)
                .filter(Boolean);
            await shipmentApi.bulkUpdateStatus({ ids: selectedIds, status: nextStatus, admin_override: Boolean(user?.is_admin) });
            impactedOrderIds.forEach((orderId) => orderApi.invalidateOne(orderId));
            const count = selectedIds.length;
            setSelectedIds([]);
            fetchShipments(pagination.current_page || 1, filters);
            fetchStats(filters);
            showToast('success', `Đã cập nhật ${count} vận đơn.`);
        } catch (error) {
            console.error('Error bulk updating shipment status', error);
            showToast('error', error.response?.data?.message || 'Không thể cập nhật trạng thái hàng loạt.');
        }
    };
    const handleBulkReconcileSelected = async () => {
        if (!selectedIds.length) return;
        setBulkReconciling(true);
        try {
            const response = await shipmentApi.bulkReconcile({ shipment_ids: selectedIds });
            showToast('success', response.data?.message || `Đã đối soát ${response.data?.success_count || selectedIds.length} vận đơn.`);
            setSelectedIds([]);
            fetchShipments(pagination.current_page || 1, filters);
            fetchStats(filters);
        } catch (error) {
            console.error('Error bulk reconciling shipments', error);
            showToast('error', error.response?.data?.message || 'Không thể đối soát các vận đơn đã chọn.');
        } finally {
            setBulkReconciling(false);
        }
    };
    const handleSyncShipments = async (mode = 'selected') => {
        const shipmentIds = mode === 'selected' ? selectedIds : [];
        if (mode === 'selected' && shipmentIds.length === 0) return;
        setBulkSyncing(true);
        try {
            const response = await shipmentApi.sync(mode === 'selected' ? { shipment_ids: shipmentIds, mode } : { mode });
            showToast('success', response.data?.message || 'Đã đồng bộ trạng thái vận đơn.');
            fetchShipments(mode === 'selected' ? pagination.current_page || 1 : 1, filters);
            fetchStats(filters);
        } catch (error) {
            console.error('Error syncing shipments', error);
            showToast('error', error.response?.data?.message || 'Không thể đồng bộ vận đơn.');
        } finally {
            setBulkSyncing(false);
        }
    };
    const openMoneyEditor = (shipment, field) => setMoneyEditor({ shipmentId: shipment.id, field, value: String(Number(shipment[field] || 0)), saving: false });
    const saveMoneyEditor = async () => {
        if (!moneyEditor || moneyEditor.saving) return;
        const parsedValue = parseEditableMoney(moneyEditor.value);
        if (parsedValue === null) {
            showToast('error', 'Giá trị COD hoặc phí ship không hợp lệ.');
            return;
        }
        setMoneyEditor((previous) => ({ ...previous, saving: true }));
        try {
            const response = await shipmentApi.update(moneyEditor.shipmentId, { [moneyEditor.field]: parsedValue });
            syncShipmentIntoState(response.data || response);
            setMoneyEditor(null);
            fetchStats(filters);
            showToast('success', moneyEditor.field === 'cod_amount' ? 'Đã cập nhật COD.' : 'Đã cập nhật phí ship.');
        } catch (error) {
            console.error('Error updating shipment money field', error);
            setMoneyEditor((previous) => ({ ...previous, saving: false }));
            showToast('error', error.response?.data?.message || 'Không thể cập nhật số tiền vận đơn.');
        }
    };
    const renderMoneyCell = (shipment, field, value, className) => {
        const isEditing = moneyEditor?.shipmentId === shipment.id && moneyEditor?.field === field;
        const formattedValue = fmtMoney(value);
        const copyId = `${shipment.id}-${field}`;
        const copyLabel = field === 'cod_amount' ? 'giá trị COD' : 'phí ship';
        if (isEditing) {
            return (
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    <input type="number" min="0" step="1000" autoFocus value={moneyEditor.value} onChange={(event) => setMoneyEditor((previous) => ({ ...previous, value: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') saveMoneyEditor(); if (event.key === 'Escape') setMoneyEditor(null); }} className="h-9 w-28 rounded-sm border border-primary/20 px-2 text-[13px] font-bold text-primary focus:border-primary focus:outline-none" />
                    <button type="button" onClick={saveMoneyEditor} disabled={moneyEditor.saving} className="flex h-9 w-9 items-center justify-center rounded-sm border border-primary/20 text-primary transition-all hover:bg-primary/5 disabled:opacity-40" title="Lưu"><span className="material-symbols-outlined text-[16px]">{moneyEditor.saving ? 'progress_activity' : 'check'}</span></button>
                    <button type="button" onClick={() => setMoneyEditor(null)} className="flex h-9 w-9 items-center justify-center rounded-sm border border-primary/10 text-primary/40 transition-all hover:border-brick/20 hover:bg-brick/5 hover:text-brick" title="Hủy"><span className="material-symbols-outlined text-[16px]">close</span></button>
                </div>
            );
        }
        return (
            <div className="group/money flex flex-col items-start">
                <div className="flex items-center gap-1">
                    <span className={className}>{formattedValue}</span>
                    <button type="button" onClick={(event) => handleCopy(formattedValue, event, copyId, copyLabel)} className={`inline-flex size-5 items-center justify-center rounded-sm transition-all ${copiedCellId === copyId ? 'text-green-600 opacity-100' : 'text-primary/20 opacity-0 group-hover/money:opacity-100 hover:text-primary'}`} title={`Sao chép ${copyLabel}`}>
                        <span className="material-symbols-outlined text-[13px]">{copiedCellId === copyId ? 'check' : 'content_copy'}</span>
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); openMoneyEditor(shipment, field); }} className="inline-flex size-5 items-center justify-center rounded-sm text-primary/30 opacity-0 transition-all hover:bg-primary/5 hover:text-primary group-hover/money:opacity-100" title="Sửa tay">
                        <span className="material-symbols-outlined text-[13px] font-normal">edit</span>
                    </button>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider text-stone/25">Sync VTPost</span>
            </div>
        );
    };

    return (
        <div className="absolute inset-0 z-10 flex h-full w-full flex-col bg-[#fcfcfa] p-6 animate-fade-in">
            {notification && (
                <div className={`fixed right-6 top-6 z-[100] flex items-center gap-3 rounded-sm border p-4 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 ${notification.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                    <span className="material-symbols-outlined">{notification.type === 'error' ? 'error' : 'check_circle'}</span>
                    <span className="font-bold">{notification.message}</span>
                    <button type="button" onClick={() => setNotification(null)} className="ml-2 opacity-50 transition-opacity hover:opacity-100">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
            )}

            <div className="flex-none space-y-4 pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                            <span className="material-symbols-outlined text-[22px] text-primary">local_shipping</span>
                        </div>
                        <div>
                            <h1 className="font-display text-2xl font-bold italic text-primary">Quản lý vận đơn</h1>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone/40">Shipment Management • Theo dõi giao nhận & COD</p>
                        </div>
                    </div>
                    <div className="hidden origin-right scale-90 md:block">
                        <AccountSelector user={user} />
                    </div>
                </div>

                <div className="rounded-sm border border-gold/10 bg-white p-2 shadow-sm">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                            <button type="button" data-filter-btn onClick={() => { if (!showFilters) setTempFilters({ ...filters }); setShowFilters(!showFilters); }} className={`flex h-9 w-9 items-center justify-center rounded-sm border p-1.5 transition-all ${showFilters || activeCount() > 0 ? 'border-primary bg-primary text-white shadow-inner' : 'border-primary/20 bg-white text-primary hover:bg-primary/5'}`} title="Bộ lọc nâng cao">
                                <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                            </button>
                            <button type="button" onClick={() => setShowStatsPanel((previous) => !previous)} className={`flex h-9 items-center gap-1.5 rounded-sm border px-3 transition-all ${showStatsPanel ? 'border-primary bg-primary text-white shadow-inner' : 'border-primary/20 bg-white text-primary hover:bg-primary/5'}`} title={showStatsPanel ? 'Ẩn thống kê' : 'Hiển thị thống kê'}>
                                <span className="material-symbols-outlined text-[18px]">bar_chart</span>
                                <span className="hidden text-[12px] font-black md:inline">{showStatsPanel ? 'Ẩn thống kê' : 'Thống kê'}</span>
                            </button>
                            <button type="button" onClick={handleRefresh} disabled={loading} className={`flex h-9 w-9 items-center justify-center rounded-sm border border-primary bg-primary p-1.5 text-white transition-all hover:bg-umber ${loading ? 'opacity-70' : ''}`} title="Làm mới">
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            </button>
                            <button type="button" onClick={() => handleSyncShipments(selectedIds.length > 0 ? 'selected' : 'active')} disabled={bulkSyncing} className={`flex h-9 w-9 items-center justify-center rounded-sm border p-1.5 transition-all ${(bulkSyncing || selectedIds.length > 0) ? 'border-primary/20 bg-primary/10 text-primary hover:bg-primary/15' : 'border-gold/20 bg-white text-primary hover:bg-gold/5'}`} title={selectedIds.length > 0 ? 'Đồng bộ vận đơn đã chọn' : 'Đồng bộ vận đơn đang hoạt động'}>
                                <span className={`material-symbols-outlined text-[18px] ${bulkSyncing ? 'animate-spin' : ''}`}>sync</span>
                            </button>
                            <button type="button" onClick={handleBulkReconcileSelected} disabled={selectedIds.length === 0 || bulkReconciling} className={`flex h-9 w-9 items-center justify-center rounded-sm border transition-all ${selectedIds.length > 0 ? 'border-primary bg-primary text-white hover:bg-primary/90' : 'cursor-not-allowed border-primary/10 bg-white text-primary/30'}`} title="Đối soát vận đơn đã chọn">
                                <span className={`material-symbols-outlined text-[18px] ${bulkReconciling ? 'animate-spin' : ''}`}>account_balance</span>
                            </button>
                        </div>

                        {selectedIds.length > 0 && (
                            <div className="flex items-center gap-1 rounded-sm border border-gold/20 bg-gold/5 p-1">
                                <select defaultValue="" onChange={(event) => { if (event.target.value) handleBulkStatus(event.target.value); event.target.value = ''; }} className="rounded-sm border border-gold/20 bg-white p-1.5 text-[11px] font-bold focus:outline-none">
                                    <option value="" disabled>Đổi trạng thái ({selectedIds.length})</option>
                                    {SHIPMENT_STATUSES.map((status) => <option key={status.code} value={status.code}>{status.label}</option>)}
                                </select>
                                <button type="button" onClick={() => setSelectedIds([])} className="flex h-8 w-8 items-center justify-center rounded-sm p-1 text-gold transition-all hover:bg-gold hover:text-white" title="Bỏ chọn">
                                    <span className="material-symbols-outlined text-[18px]">cancel</span>
                                </button>
                                <span className="px-1 text-[12px] font-bold text-gold">{selectedIds.length} đã chọn</span>
                            </div>
                        )}

                        <div className="relative flex-1" ref={searchContainerRef}>
                            <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[16px] text-primary/40">search</span>
                            <input type="text" autoComplete="off" placeholder="Tìm mã vận đơn, mã đơn, tracking, tên, SĐT..." className="relative z-0 w-full rounded-sm border border-primary/10 bg-primary/5 px-8 py-1.5 text-[14px] transition-all focus:border-primary/30 focus:outline-none" value={filters.search} onChange={(event) => setFilters((previous) => normalizeShipmentFilters({ ...previous, search: event.target.value }))} onFocus={() => setShowSearchHistory(true)} onKeyDown={(event) => { if (event.key !== 'Enter') return; const nextFilters = normalizeShipmentFilters({ ...filters, search: filters.search }); setShowSearchHistory(false); addToSearchHistory(filters.search); fetchShipments(1, nextFilters); fetchStats(nextFilters); }} />
                            {filters.search && <button type="button" onClick={() => { setFilters((previous) => normalizeShipmentFilters({ ...previous, search: '' })); setShowSearchHistory(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-primary/40 transition-colors hover:text-brick"><span className="material-symbols-outlined text-[16px]">cancel</span></button>}
                            {showSearchHistory && searchHistory.length > 0 && (
                                <div className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-sm border border-primary/20 bg-white py-2 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-200">
                                    <div className="mb-2 flex items-center justify-between border-b border-primary/10 px-3 pb-1">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary/40">Tìm kiếm gần đây</span>
                                        <button type="button" onClick={(event) => { event.stopPropagation(); setSearchHistory([]); localStorage.removeItem('shipment_search_history'); }} className="text-[10px] font-bold text-brick hover:underline">Xóa tất cả</button>
                                    </div>
                                    <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                        {searchHistory.map((historyItem) => (
                                            <div key={historyItem} className="group flex cursor-pointer items-center justify-between px-3 py-1.5 transition-colors hover:bg-primary/5" onClick={() => { setFilters((previous) => normalizeShipmentFilters({ ...previous, search: historyItem })); setShowSearchHistory(false); }}>
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                    <span className="truncate text-[13px] font-medium text-[#0F172A]">{historyItem}</span>
                                                </div>
                                                <button type="button" onClick={(event) => { event.stopPropagation(); const updated = searchHistory.filter((item) => item !== historyItem); setSearchHistory(updated); localStorage.setItem('shipment_search_history', JSON.stringify(updated)); }} className="rounded-full p-1 opacity-0 transition-all hover:bg-primary/5 hover:text-brick group-hover:opacity-100">
                                                    <span className="material-symbols-outlined text-[14px]">close</span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <button type="button" data-column-settings-btn onClick={() => setShowColumnSettings(!showColumnSettings)} className={`flex h-9 w-9 items-center justify-center rounded-sm border p-1.5 transition-all ${showColumnSettings ? 'border-primary bg-primary text-white' : 'border-primary/20 bg-white text-primary hover:bg-primary/5'}`} title="Cấu hình cột">
                            <span className="material-symbols-outlined text-[18px]">view_column</span>
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {[
                        { key: 'last_30_days', label: '30 ngày vừa qua' },
                        { key: 'previous_month', label: 'Tháng qua' },
                    ].map((preset) => {
                        const isActive = filters.quick_range === preset.key;
                        return (
                            <button
                                key={preset.key}
                                type="button"
                                onClick={() => handleQuickRangeToggle(preset.key)}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-black transition-all ${isActive ? 'border-primary bg-primary text-white shadow-sm' : 'border-primary/15 bg-white text-primary hover:border-primary/30 hover:bg-primary/[0.04]'}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">date_range</span>
                                <span>{preset.label}</span>
                            </button>
                        );
                    })}
                </div>

                {showStatsPanel && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                        <ShipmentStatsPanel stats={stats} loading={statsLoading} />
                    </div>
                )}

                {showFilters && tempFilters && (
                    <div ref={filterRef} className="relative z-50 mb-4 rounded-sm border border-primary/20 bg-white p-5 text-[#0F172A] shadow-2xl animate-in slide-in-from-top-4 duration-300">
                        <div className="mb-6 flex items-center justify-between border-b border-primary/10 pb-3">
                            <h4 className="flex items-center gap-2 text-[15px] font-bold text-primary"><span className="material-symbols-outlined text-[20px]">tune</span>Cấu hình bộ lọc vận đơn</h4>
                            <div className="flex gap-4">
                                <button type="button" onClick={handleReset} className="text-[13px] font-bold text-primary/40 transition-colors hover:text-brick">Thiết lập lại</button>
                                <button type="button" onClick={applyFilters} className="rounded-sm bg-primary px-8 py-2 text-[13px] font-bold text-white shadow-md transition-all active:scale-95 hover:bg-primary/90">Áp dụng bộ lọc</button>
                            </div>
                        </div>
                        <div className="mb-6 grid grid-cols-1 overflow-hidden rounded-sm border-l border-t border-primary/10 bg-primary/[0.02] md:grid-cols-4 lg:grid-cols-5">
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Tên khách</label><input name="customer_name" type="text" className="h-10 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.customer_name} onChange={handleTempFilterChange} /></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Mã vận đơn</label><input name="shipment_number" type="text" className="h-10 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.shipment_number} onChange={handleTempFilterChange} /></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Mã đơn</label><input name="order_code" type="text" className="h-10 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.order_code} onChange={handleTempFilterChange} /></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">SĐT khách</label><input name="customer_phone" type="text" className="h-10 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.customer_phone} onChange={handleTempFilterChange} /></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Địa chỉ giao</label><input name="customer_address" type="text" className="h-10 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.customer_address} onChange={handleTempFilterChange} /></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Trạng thái đơn hàng</label><div className="relative"><select className="h-10 w-full appearance-none rounded-sm border border-primary/20 bg-white px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.order_status?.[0] || ''} onChange={(event) => setTempFilters((previous) => normalizeShipmentFilters({ ...previous, order_status: event.target.value ? [event.target.value] : [] }))}><option value="">Tất cả</option>{orderStatuses.map((status) => <option key={status.id} value={status.code}>{status.name}</option>)}</select><span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span></div></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Trạng thái vận đơn</label><div className="relative"><select className="h-10 w-full appearance-none rounded-sm border border-primary/20 bg-white px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.shipment_status?.[0] || ''} onChange={(event) => setTempFilters((previous) => normalizeShipmentFilters({ ...previous, shipment_status: event.target.value ? [event.target.value] : [] }))}><option value="">Tất cả</option>{SHIPMENT_STATUSES.map((status) => <option key={status.code} value={status.code}>{status.label}</option>)}</select><span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span></div></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Đối soát</label><div className="relative"><select name="reconciliation_status" className="h-10 w-full appearance-none rounded-sm border border-primary/20 bg-white px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.reconciliation_status} onChange={handleTempFilterChange}><option value="">Tất cả</option>{RECONCILIATION_STATUSES.map((status) => <option key={status.code} value={status.code}>{status.label}</option>)}</select><span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span></div></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Đơn vị vận chuyển</label><div className="relative"><select name="carrier_code" className="h-10 w-full appearance-none rounded-sm border border-primary/20 bg-white px-3 pr-8 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.carrier_code} onChange={handleTempFilterChange}><option value="">Tất cả</option>{carriers.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.name}</option>)}</select><span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span></div></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Ngày tạo</label><div className="flex h-10 items-center gap-2"><input name="created_at_from" type="date" className="h-full flex-1 cursor-pointer rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.created_at_from} onChange={handleTempFilterChange} /><span className="text-primary/20">-</span><input name="created_at_to" type="date" className="h-full flex-1 cursor-pointer rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.created_at_to} onChange={handleTempFilterChange} /></div></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Ngày gửi vận chuyển</label><div className="flex h-10 items-center gap-2"><input name="shipping_dispatched_from" type="date" className="h-full flex-1 cursor-pointer rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.shipping_dispatched_from} onChange={handleTempFilterChange} /><span className="text-primary/20">-</span><input name="shipping_dispatched_to" type="date" className="h-full flex-1 cursor-pointer rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.shipping_dispatched_to} onChange={handleTempFilterChange} /></div></div>
                            <div className="space-y-1.5 border-b border-r border-primary/10 p-4"><label className="text-[13px] font-medium text-stone-600">Khoảng COD</label><div className="flex h-10 items-center gap-2"><input name="cod_min" type="number" min="0" className="h-full flex-1 rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.cod_min} onChange={handleTempFilterChange} placeholder="Từ" /><span className="text-primary/20">-</span><input name="cod_max" type="number" min="0" className="h-full flex-1 rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] focus:border-primary focus:outline-none" value={tempFilters.cod_max} onChange={handleTempFilterChange} placeholder="Đến" /></div></div>
                        </div>
                    </div>
                )}

                {hasAppliedFilters && (
                    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-sm border border-primary/10 bg-primary/5 p-2 animate-in fade-in duration-300">
                        <span className="mr-1 flex items-center gap-1.5 border-r border-primary/20 px-1 text-[13px] font-bold text-primary"><span className="material-symbols-outlined text-[16px]">filter_list</span>Đang lọc:</span>
                        {filters.search?.trim() && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Tìm kiếm:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.search.trim()}</span><button type="button" onClick={() => removeFilter('search')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.order_status?.length > 0 && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Đơn hàng:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.order_status.map((status) => statusMap.get(String(status))?.name || status).join(', ')}</span><button type="button" onClick={() => removeFilter('order_status')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.shipment_status?.length > 0 && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Vận đơn:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.shipment_status.map((status) => getStatus(status, SHIPMENT_STATUSES).label).join(', ')}</span><button type="button" onClick={() => removeFilter('shipment_status')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.customer_name && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Khách:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.customer_name}</span><button type="button" onClick={() => removeFilter('customer_name')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.shipment_number && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Mã vận đơn:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.shipment_number}</span><button type="button" onClick={() => removeFilter('shipment_number')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.order_code && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Mã đơn:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.order_code}</span><button type="button" onClick={() => removeFilter('order_code')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.customer_phone && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">SĐT:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.customer_phone}</span><button type="button" onClick={() => removeFilter('customer_phone')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.customer_address && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Địa chỉ:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.customer_address}</span><button type="button" onClick={() => removeFilter('customer_address')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.carrier_code && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Vận chuyển:</span><span className="text-[13px] font-bold text-[#0F172A]">{carrierMap.get(String(filters.carrier_code))?.name || filters.carrier_code}</span><button type="button" onClick={() => removeFilter('carrier_code')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.reconciliation_status && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Đối soát:</span><span className="text-[13px] font-bold text-[#0F172A]">{getStatus(filters.reconciliation_status, RECONCILIATION_STATUSES).label}</span><button type="button" onClick={() => removeFilter('reconciliation_status')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {(filters.created_at_from || filters.created_at_to) && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Ngày tạo:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.created_at_from || '?'} → {filters.created_at_to || '?'}</span><button type="button" onClick={() => removeFilter('created_at')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {filters.quick_range && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Nhanh:</span><span className="text-[13px] font-bold text-[#0F172A]">{getQuickRangeLabel(filters.quick_range)}</span><button type="button" onClick={() => removeFilter('quick_range')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {!filters.quick_range && (filters.shipping_dispatched_from || filters.shipping_dispatched_to) && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">Ngày gửi VC:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.shipping_dispatched_from || '?'} → {filters.shipping_dispatched_to || '?'}</span><button type="button" onClick={() => removeFilter('shipping_dispatched_at')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        {(filters.cod_min !== '' || filters.cod_max !== '') && <div className="flex items-center gap-2 rounded-sm border border-primary/30 bg-white px-2 py-1 shadow-sm"><span className="text-[11px] text-primary/40">COD:</span><span className="text-[13px] font-bold text-[#0F172A]">{filters.cod_min || '0'} → {filters.cod_max || '∞'}</span><button type="button" onClick={() => removeFilter('cod_amount')} className="text-primary/40 hover:text-brick"><span className="material-symbols-outlined text-[14px]">close</span></button></div>}
                        <button type="button" onClick={handleReset} className="ml-auto border-primary/20 px-2 pr-1 text-[13px] font-bold text-brick hover:underline">Xóa tất cả bộ lọc</button>
                    </div>
                )}

                {showColumnSettings && (
                    <div ref={columnSettingsRef}>
                        <TableColumnSettingsPanel availableColumns={availableColumns} visibleColumns={visibleColumns} toggleColumn={toggleColumn} setAvailableColumns={setAvailableColumns} resetDefault={resetDefault} saveAsDefault={saveAsDefault} onClose={() => setShowColumnSettings(false)} storageKey="shipment_list" />
                    </div>
                )}
            </div>

            <div className="relative flex-1 overflow-auto rounded-sm border border-primary/10 bg-white shadow-xl table-scrollbar">
                <table className="min-w-full table-fixed border-collapse text-left" style={{ width: `${totalTableWidth}px`, minWidth: '100%' }}>
                    <thead className="sticky top-0 z-20 border-b border-primary/10 bg-[#fcfcfa] shadow-sm">
                        <tr>
                            <th className="sticky left-0 z-30 w-12 border border-primary/20 bg-[#fcfcfa] p-3">
                                <label className="flex items-center justify-center">
                                    <input aria-label="Chọn tất cả vận đơn" type="checkbox" checked={shipments.length > 0 && selectedIds.length === shipments.length} onChange={toggleSelectAll} className="size-4 cursor-pointer accent-primary" />
                                </label>
                            </th>
                            {renderedColumns.map((column, index) => (
                                <th key={column.id} draggable onDragStart={(event) => handleHeaderDragStart(event, index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleHeaderDrop(event, index)} onDoubleClick={() => handleSort(column.id)} className="group relative border border-primary/10 bg-[#fcfcfa] px-3 py-2.5 text-left cursor-move transition-colors hover:bg-primary/5" style={{ width: columnWidths[column.id] || column.minWidth }}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-[14px] text-primary opacity-20 transition-opacity group-hover:opacity-100">drag_indicator</span>
                                        <span className={`text-[12px] font-black text-primary ${['created_at', 'shipped_at', 'customer_info', 'staff_notes'].includes(column.id) ? 'leading-[1.05]' : 'truncate'}`}>{['created_at', 'shipped_at', 'customer_info', 'staff_notes'].includes(column.id) ? <span className="flex flex-col"><span className="whitespace-nowrap">{getCompactColumnLabelLines(column.id, column.label)[0]}</span><span className="whitespace-nowrap">{getCompactColumnLabelLines(column.id, column.label)[1]}</span></span> : column.label}</span>
                                        <SortIndicator colId={column.id} sortConfig={sortConfig} />
                                    </div>
                                    <div onMouseDown={(event) => handleColumnResize(column.id, event)} className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize transition-colors hover:bg-primary/20" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="font-body text-sm">
                        {shipments.length === 0 && !loading ? (
                            <tr><td colSpan={renderedColumns.length + 1} className="p-12 text-center"><div className="flex flex-col items-center gap-2 text-primary/40"><span className="material-symbols-outlined text-[48px]">inventory_2</span><p className="text-[15px] font-bold">Không tìm thấy vận đơn nào</p><p className="text-[13px]">Kiểm tra lại từ khóa tìm kiếm hoặc bộ lọc đang áp dụng.</p></div></td></tr>
                        ) : (
                            shipments.map((shipment) => {
                                const shipmentStatus = getStatus(shipment.shipment_status, SHIPMENT_STATUSES);
                                const orderStatusName = statusMap.get(String(shipment.order?.status))?.name || shipment.order?.status || '-';
                                const orderStatusStyle = getOrderStatusStyle(shipment.order?.status);
                                const createdAtParts = formatDateTimeParts(shipment.created_at);
                                const shippedAtParts = formatDateTimeParts(shipment.shipped_at || shipment.order?.shipping_dispatched_at);
                                const shipmentNumberCopyValue = [shipment.shipment_number, shipment.tracking_number ? `#${shipment.tracking_number}` : null].filter(Boolean).join('\n');
                                const orderCodeValue = shipment.order_code || shipment.order?.order_number || '-';
                                const carrierNameValue = shipment.carrier_name || shipment.carrier?.name || '-';
                                const customerNameValue = shipment.customer_name || shipment.order?.customer_name || '-';
                                const customerPhoneValue = shipment.customer_phone || shipment.order?.customer_phone || '-';
                                const customerAddressValue = buildCustomerAddress(shipment);
                                const notesCount = getShipmentNotesCount(shipment);
                                const shippedAtValue = [shippedAtParts.date, shippedAtParts.time].filter(Boolean).join(' ');
                                const createdAtValue = [createdAtParts.date, createdAtParts.time].filter(Boolean).join(' ');

                                return (
                                    <tr key={shipment.id} onClick={() => toggleSelect(shipment.id)} onDoubleClick={(event) => { event.stopPropagation(); openDetail(shipment.id); }} className={`group cursor-pointer transition-all ${selectedIds.includes(shipment.id) ? 'bg-gold/10' : 'hover:bg-gold/5'}`}>
                                        <td className="sticky left-0 z-10 border border-primary/20 bg-inherit p-3">
                                            <div className="flex items-center justify-center">
                                                <input type="checkbox" checked={selectedIds.includes(shipment.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelect(shipment.id)} className="size-4 cursor-pointer accent-primary" aria-label={`Chọn vận đơn ${shipment.shipment_number}`} />
                                            </div>
                                        </td>
                                        {renderedColumns.map((column) => {
                                            const cellStyle = { width: columnWidths[column.id] || column.minWidth };
                                            if (column.id === 'shipment_number') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={shipmentNumberCopyValue} copyId={`${shipment.id}-shipment_number`} copyLabel="mã vận đơn" copiedCellId={copiedCellId} onCopy={handleCopy}><span className="min-w-0 truncate text-[13px] font-black tracking-tight text-primary">{shipment.shipment_number}</span>{shipment.tracking_number && <p className="mt-0.5 truncate text-[10px] font-mono text-stone/40" title={shipment.tracking_number}>#{shipment.tracking_number}</p>}</ShipmentCopyableCell></td>;
                                            if (column.id === 'order_code') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={orderCodeValue} copyId={`${shipment.id}-order_code`} copyLabel="mã đơn hàng" copiedCellId={copiedCellId} onCopy={handleCopy}><span className="truncate text-[12px] font-bold text-primary">{orderCodeValue}</span></ShipmentCopyableCell></td>;
                                            if (column.id === 'carrier_name') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={[carrierNameValue, shipment.carrier_code].filter(Boolean).join('\n')} copyId={`${shipment.id}-carrier_name`} copyLabel="hãng vận chuyển" copiedCellId={copiedCellId} onCopy={handleCopy}><span className="truncate text-[12px] font-bold text-stone-700">{carrierNameValue}</span>{shipment.carrier_code && <p className="mt-0.5 truncate text-[10px] font-mono text-stone/35">{shipment.carrier_code}</p>}</ShipmentCopyableCell></td>;
                                            if (column.id === 'customer_name') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={[customerNameValue, customerAddressValue !== '-' ? customerAddressValue : null].filter(Boolean).join('\n')} copyId={`${shipment.id}-customer_name`} copyLabel="tên khách hàng" copiedCellId={copiedCellId} onCopy={handleCopy}><span className="block truncate text-[13px] font-bold text-primary">{customerNameValue}</span>{shipment.customer_address && <p className="mt-0.5 truncate text-[10px] text-stone/35">{shipment.customer_address}</p>}</ShipmentCopyableCell></td>;
                                            if (column.id === 'customer_phone') {
                                                return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={customerPhoneValue} copyId={`${shipment.id}-customer_phone`} copyLabel="số điện thoại khách hàng" copiedCellId={copiedCellId} onCopy={handleCopy}><span className="min-w-0 truncate text-[13px] font-bold text-stone/80">{customerPhoneValue}</span></ShipmentCopyableCell></td>;
                                            }
                                            if (column.id === 'customer_info') return <td key={column.id} style={cellStyle} className="border border-primary/20 px-3 py-2"><button type="button" onClick={(event) => openCustomerInfo(shipment, event)} className="inline-flex items-center rounded-sm border border-primary/15 bg-primary/5 px-3 py-1.5 text-[11px] font-black text-primary transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary" title="Xem thông tin khách hàng">Chi tiết</button></td>;
                                            if (column.id === 'staff_notes') return <td key={column.id} style={cellStyle} className="border border-primary/20 px-3 py-2"><button type="button" onClick={(event) => openNotePanel(shipment, event)} className="inline-flex items-center gap-1.5 rounded-sm border border-primary/15 bg-primary/5 px-3 py-1.5 text-[11px] font-black text-primary transition-all hover:border-primary/30 hover:bg-primary/10" title="Xem và thêm ghi chú nhân viên"><span className="material-symbols-outlined text-[15px]">sticky_note_2</span>{notesCount > 0 ? `Xem (${notesCount})` : 'Thêm ghi chú'}</button></td>;
                                            if (column.id === 'order_status') return <td key={column.id} style={cellStyle} className="relative border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={orderStatusName} copyId={`${shipment.id}-order_status`} copyLabel="trạng thái đơn hàng" copiedCellId={copiedCellId} onCopy={handleCopy} iconTopClassName="top-1/2 -translate-y-1/2" className="max-w-full">{shipment.order?.id ? <button type="button" data-status-edit-btn onClick={(event) => { event.stopPropagation(); toggleStatusMenu(shipment.id, 'order', event.currentTarget); }} className="inline-flex max-w-full items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-black shadow-sm transition-all hover:scale-[1.03] active:scale-95" style={orderStatusStyle}><span className="truncate">{orderStatusName}</span><span className="material-symbols-outlined text-[16px] leading-none opacity-40">expand_more</span></button> : <span className="inline-flex rounded-sm border border-primary/10 bg-primary/5 px-2 py-1 text-[11px] font-black text-primary/40">-</span>}</ShipmentCopyableCell></td>;
                                            if (column.id === 'shipment_status') return <td key={column.id} style={cellStyle} className="relative border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={[shipmentStatus.label, shipment.carrier_status_text && shipment.carrier_status_text !== shipmentStatus.label ? shipment.carrier_status_text : null].filter(Boolean).join('\n')} copyId={`${shipment.id}-shipment_status`} copyLabel="trạng thái vận đơn" copiedCellId={copiedCellId} onCopy={handleCopy} iconTopClassName="top-1/2 -translate-y-1/2" className="max-w-full"><button type="button" data-status-edit-btn onClick={(event) => { event.stopPropagation(); toggleStatusMenu(shipment.id, 'shipment', event.currentTarget); }} className="inline-flex max-w-full items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-black shadow-sm transition-all hover:scale-[1.03] active:scale-95" style={{ backgroundColor: `${shipmentStatus.color}12`, color: shipmentStatus.color, borderColor: `${shipmentStatus.color}30` }}><span className="truncate">{shipmentStatus.label}</span><span className="material-symbols-outlined text-[16px] leading-none opacity-40">expand_more</span></button>{shipment.carrier_status_text && shipment.carrier_status_text !== shipmentStatus.label && <p className="mt-1 truncate text-[9px] font-black uppercase tracking-wider text-stone/25">{shipment.carrier_status_text}</p>}</ShipmentCopyableCell></td>;
                                            if (column.id === 'cod_amount') return <td key={column.id} style={cellStyle} className="border border-primary/20 px-3 py-2">{renderMoneyCell(shipment, 'cod_amount', shipment.cod_amount, 'text-[13px] font-black tracking-tight text-brick')}</td>;
                                            if (column.id === 'shipping_cost') return <td key={column.id} style={cellStyle} className="border border-primary/20 px-3 py-2">{renderMoneyCell(shipment, 'shipping_cost', shipment.shipping_cost, 'text-[13px] font-black tracking-tight text-stone-600')}</td>;
                                            if (column.id === 'actual_received_amount') return <td key={column.id} style={cellStyle} className="border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={fmtMoney(shipment.actual_received_amount)} copyId={`${shipment.id}-actual_received_amount`} copyLabel="số tiền thực nhận" copiedCellId={copiedCellId} onCopy={handleCopy} iconTopClassName="top-1/2 -translate-y-1/2" className="max-w-full"><span className="text-[13px] font-black text-primary">{fmtMoney(shipment.actual_received_amount)}</span></ShipmentCopyableCell></td>;
                                            if (column.id === 'reconciliation_status') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2"><ShipmentCopyableCell copyValue={getStatus(shipment.reconciliation_status, RECONCILIATION_STATUSES).label} copyId={`${shipment.id}-reconciliation_status`} copyLabel="trạng thái đối soát" copiedCellId={copiedCellId} onCopy={handleCopy} iconTopClassName="top-1/2 -translate-y-1/2" className="max-w-full"><StatusBadge code={shipment.reconciliation_status} list={RECONCILIATION_STATUSES} /></ShipmentCopyableCell></td>;
                                            if (column.id === 'shipped_at') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2 text-[13px] text-stone"><ShipmentCopyableCell copyValue={shippedAtValue} copyId={`${shipment.id}-shipped_at`} copyLabel="ngày gửi vận chuyển" copiedCellId={copiedCellId} onCopy={handleCopy}><div className="flex flex-col"><span>{shippedAtParts.date}</span>{shippedAtParts.time && <span className="text-[10px] text-stone/35">{shippedAtParts.time}</span>}</div></ShipmentCopyableCell></td>;
                                            if (column.id === 'created_at') return <td key={column.id} style={cellStyle} className="overflow-hidden border border-primary/20 px-3 py-2 text-[13px] text-stone"><ShipmentCopyableCell copyValue={createdAtValue} copyId={`${shipment.id}-created_at`} copyLabel="ngày tạo vận đơn" copiedCellId={copiedCellId} onCopy={handleCopy}><div className="flex flex-col"><span>{createdAtParts.date}</span>{createdAtParts.time && <span className="text-[10px] text-stone/35">{createdAtParts.time}</span>}</div></ShipmentCopyableCell></td>;
                                            return <td key={column.id} style={cellStyle} className="border border-primary/20" />;
                                        })}
                                    </tr>
                                );
                            })
                        )}
                        {loading && <tr><td colSpan={renderedColumns.length + 1} className="py-20 text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></td></tr>}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 flex flex-none flex-col items-center justify-between gap-3 border-t-2 border-primary/20 pt-4 text-[13px] text-stone sm:flex-row">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="hidden whitespace-nowrap font-bold lg:block">Hiển thị</span>
                        <select className="cursor-pointer rounded border border-stone/20 bg-white px-2 py-1.5 font-bold text-primary focus:border-primary focus:outline-none" value={pagination.per_page} onChange={(event) => { const nextPerPage = parseInt(event.target.value, 10); setPagination((previous) => ({ ...previous, per_page: nextPerPage })); fetchShipments(1, filters, nextPerPage); fetchStats(filters); }}>
                            <option value="20">20</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
                        </select>
                    </div>
                    <p className="hidden text-stone/80 sm:block">Tổng <span className="font-bold text-primary">{pagination.total}</span> vận đơn</p>
                </div>
                <div className="origin-right scale-90">
                    <Pagination pagination={pagination} onPageChange={(page) => fetchShipments(page, filters)} />
                </div>
            </div>
            <ShipmentCustomerInfoModal customerInfo={customerInfoModal} onClose={closeCustomerInfo} />
            {(detailShipment || detailLoading) && (
                <div className="fixed inset-0 z-[9999] flex">
                    <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={closeDetail} />
                    <div className="flex w-full max-w-[660px] flex-col border-l border-stone/20 bg-white shadow-2xl animate-in slide-in-from-right duration-300">
                        {detailLoading ? (
                            <div className="flex flex-1 items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary" /></div>
                        ) : detailShipment && (() => {
                            const warnings = getRiskWarnings(detailShipment);
                            const orderProductLines = getShipmentProductLines(detailShipment);
                            const orderAttributeEntries = getOrderAttributeEntries(detailShipment.order);
                            const orderStatusName = statusMap.get(String(detailShipment.order?.status))?.name || detailShipment.order?.status || '-';
                            const orderStatusStyle = getOrderStatusStyle(detailShipment.order?.status);
                            const latestShipmentNote = detailShipment.latest_note?.content || detailShipment.notes?.[0]?.content || '';
                            const tabs = [
                                { id: 'overview', label: 'Tổng quan', icon: 'info' },
                                { id: 'tracking', label: 'Tracking', icon: 'timeline' },
                                { id: 'reconciliation', label: 'Đối soát', icon: 'account_balance' },
                                { id: 'notes', label: 'Ghi chú', icon: 'sticky_note_2' },
                                { id: 'logs', label: 'Log', icon: 'history' },
                            ];
                            return (
                                <>
                                    <div className="flex-none border-b border-stone/10 bg-[#fcfcfa] p-5">
                                        <div className="mb-3 flex items-start justify-between">
                                            <div>
                                                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-stone/40">Chi tiết vận đơn</p>
                                                <h2 className="text-xl font-black tracking-tight text-primary">{detailShipment.shipment_number}</h2>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <StatusBadge code={detailShipment.shipment_status} list={SHIPMENT_STATUSES} />
                                                    <StatusBadge code={detailShipment.reconciliation_status} list={RECONCILIATION_STATUSES} />
                                                    {detailShipment.carrier_name && <span className="rounded-md border border-stone/10 px-2 py-0.5 text-[11px] font-bold text-stone/50">{detailShipment.carrier_name}</span>}
                                                </div>
                                            </div>
                                            <button type="button" onClick={closeDetail} className="flex size-9 items-center justify-center rounded-full text-stone/40 transition-colors hover:bg-stone/5 hover:text-stone-800"><span className="material-symbols-outlined text-[22px]">close</span></button>
                                        </div>
                                        {warnings.length > 0 && <div className="mb-3 flex flex-wrap gap-1.5">{warnings.map((warning) => <span key={warning.type} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wider animate-pulse" style={{ backgroundColor: `${warning.color}12`, color: warning.color, borderColor: `${warning.color}30` }}><span className="material-symbols-outlined text-[13px]">{warning.icon}</span>{warning.label}</span>)}</div>}
                                        <div className="flex gap-1 rounded-lg bg-stone/5 p-1">
                                            {tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setDrawerTab(tab.id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-bold transition-all ${drawerTab === tab.id ? 'border border-stone/10 bg-white text-primary shadow-sm' : 'text-stone/50 hover:bg-white/50 hover:text-stone-700'}`}><span className="material-symbols-outlined text-[15px]">{tab.icon}</span><span className="hidden sm:inline">{tab.label}</span></button>)}
                                        </div>
                                    </div>

                                    <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-5">
                                        {drawerTab === 'overview' && (
                                            <>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {[
                                                        ['Mã đơn hàng', detailShipment.order_code || detailShipment.order?.order_number],
                                                        ['Hãng vận chuyển', detailShipment.carrier_name],
                                                        ['Tracking', detailShipment.tracking_number],
                                                        ['Kênh tạo', ({ manual: 'Thủ công', api: 'API', import: 'Import' })[detailShipment.channel] || detailShipment.channel],
                                                        ['Người nhận', detailShipment.customer_name],
                                                        ['SĐT', detailShipment.customer_phone],
                                                        ['Địa chỉ', detailShipment.customer_address],
                                                        ['Khu vực', [detailShipment.customer_ward, detailShipment.customer_district, detailShipment.customer_province].filter(Boolean).join(', ')],
                                                        ['Số lần giao', `${detailShipment.attempt_delivery_count || 0} lần`],
                                                        ['Ưu tiên', ({ low: 'Thấp', normal: 'Bình thường', high: 'Cao', urgent: 'Khẩn cấp' })[detailShipment.priority_level] || 'Bình thường'],
                                                    ].map(([label, value]) => <div key={label} className="space-y-0.5"><p className="text-[10px] font-black uppercase tracking-widest text-stone/40">{label}</p><p className="truncate text-[14px] font-bold text-primary">{value || '-'}</p></div>)}
                                                </div>
                                                <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                    <div className="mb-3 flex items-center justify-between gap-3">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">Đơn hàng liên quan</p>
                                                        <span className="inline-flex max-w-full items-center rounded-sm border px-2 py-1 text-[11px] font-black" style={orderStatusStyle}>{orderStatusName}</span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {[
                                                            ['Loại đơn', getOrderKindLabel(detailShipment.order?.order_kind)],
                                                            ['Nguồn đơn', detailShipment.order?.source || '-'],
                                                            ['Phân loại', detailShipment.order?.type || '-'],
                                                            ['Email khách', detailShipment.order?.customer_email || '-'],
                                                            ['Tổng đơn', fmtMoney(detailShipment.order?.total_price || 0)],
                                                            ['Phí ship đơn', fmtMoney(detailShipment.order?.shipping_fee || 0)],
                                                            ['Giảm giá', fmtMoney(detailShipment.order?.discount || 0)],
                                                            ['Lợi nhuận', fmtMoney(detailShipment.order?.profit_total || 0)],
                                                            ['Trạng thái giao đơn', detailShipment.order?.shipping_status || '-'],
                                                            ['Nguồn sync giao hàng', detailShipment.order?.shipping_status_source || '-'],
                                                            ['Nhân viên tạo đơn', detailShipment.order?.user?.name || '-'],
                                                            ['Cập nhật cuối', fmtDateTime(detailShipment.order?.updated_at)],
                                                        ].map(([label, value]) => <div key={label} className="space-y-0.5"><p className="text-[10px] font-black uppercase tracking-widest text-stone/40">{label}</p><p className="truncate text-[13px] font-bold text-primary">{value || '-'}</p></div>)}
                                                    </div>
                                                </div>
                                                {orderProductLines.length > 0 && (
                                                    <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                        <div className="mb-3 flex items-center justify-between gap-3">
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">Sản phẩm trong đơn</p>
                                                            <span className="rounded-full border border-primary/10 bg-white px-2.5 py-1 text-[10px] font-black text-primary">{orderProductLines.length} dòng</span>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {orderProductLines.map((product) => (
                                                                <div key={product.id} className="rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div className="min-w-0">
                                                                            <p className="truncate text-[13px] font-black text-primary">{product.name}</p>
                                                                            {product.sku && <p className="mt-0.5 truncate font-mono text-[10px] text-stone/40">SKU: {product.sku}</p>}
                                                                        </div>
                                                                        <span className="shrink-0 rounded-full border border-primary/10 bg-primary/5 px-2 py-0.5 text-[10px] font-black text-primary">x{product.quantity}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {orderAttributeEntries.length > 0 && (
                                                    <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                        <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Thuộc tính đơn hàng</p>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            {orderAttributeEntries.map((entry) => (
                                                                <div key={entry.id} className="rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
                                                                    <p className="text-[10px] font-black uppercase tracking-widest text-stone/35">{entry.label}</p>
                                                                    <p className="mt-1 text-[13px] font-bold text-primary">{entry.value}</p>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {(detailShipment.order?.notes || latestShipmentNote) && (
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-stone/40">Ghi chú đơn hàng</p>
                                                            <p className="whitespace-pre-wrap text-[13px] font-semibold leading-relaxed text-primary">{detailShipment.order?.notes || 'Không có ghi chú đơn hàng.'}</p>
                                                        </div>
                                                        <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                                <p className="text-[10px] font-black uppercase tracking-widest text-stone/40">Ghi chú nhân viên mới nhất</p>
                                                                <button type="button" onClick={(event) => openNotePanel(detailShipment, event)} className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-white px-3 py-1 text-[10px] font-black text-primary transition-all hover:border-primary/30 hover:bg-primary/5">
                                                                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                                                    Mở modal
                                                                </button>
                                                            </div>
                                                            <p className="whitespace-pre-wrap text-[13px] font-semibold leading-relaxed text-primary">{latestShipmentNote || 'Chưa có ghi chú nhân viên.'}</p>
                                                        </div>
                                                    </div>
                                                )}
                                                {detailShipment.failed_reason && <div className="rounded-lg border border-red-200 bg-red-50 p-3"><p className="mb-1 text-[10px] font-black uppercase tracking-widest text-red-400">Lý do giao thất bại</p><p className="text-[13px] font-bold text-red-600">{detailShipment.failed_reason}</p></div>}
                                                <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                    <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Tài chính</p>
                                                    <div className="grid grid-cols-3 gap-3">
                                                        {[
                                                            ['COD', detailShipment.cod_amount, 'text-brick'],
                                                            ['Phí ship', detailShipment.shipping_cost, 'text-stone-600'],
                                                            ['Phí DV', detailShipment.service_fee, 'text-stone-600'],
                                                            ['Phí hoàn', detailShipment.return_fee, 'text-orange-500'],
                                                            ['Bảo hiểm', detailShipment.insurance_fee, 'text-stone-600'],
                                                            ['Thực nhận', detailShipment.actual_received_amount, 'text-primary'],
                                                        ].map(([label, value, className]) => <div key={label}><p className="text-[10px] font-bold uppercase text-stone/40">{label}</p><p className={`text-[15px] font-black ${className}`}>{fmtMoney(value)}</p></div>)}
                                                    </div>
                                                </div>
                                                <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                    <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Tích hợp vận chuyển</p>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div><p className="text-[10px] font-bold text-stone/40">Tracking hãng VC</p><p className="text-[13px] font-bold text-primary">{detailShipment.carrier_tracking_code || '-'}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Đồng bộ lần cuối</p><p className="text-[13px] font-bold text-primary">{detailShipment.last_synced_at ? fmtDateTime(detailShipment.last_synced_at) : 'Chưa sync'}</p></div>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {drawerTab === 'tracking' && (
                                            <>
                                                <div className="mb-4 rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                    <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Dòng thời gian vận đơn</p>
                                                    <div className="relative pl-6">
                                                        <div className="absolute left-[9px] top-2 bottom-2 w-[2px] bg-stone/10" />
                                                        {[
                                                            { label: 'Tạo vận đơn', time: detailShipment.created_at, icon: 'add_circle', status: 'created' },
                                                            { label: 'Chờ lấy hàng', time: detailShipment.created_at, icon: 'schedule', status: 'waiting_pickup' },
                                                            { label: 'Đã lấy hàng', time: detailShipment.picked_at, icon: 'inventory', status: 'picked_up' },
                                                            { label: 'Xuất kho', time: detailShipment.shipped_at, icon: 'flight_takeoff', status: 'shipped' },
                                                            { label: 'Đang trung chuyển', time: detailShipment.in_transit_at, icon: 'local_shipping', status: 'in_transit' },
                                                            { label: 'Đang giao hàng', time: detailShipment.out_for_delivery_at, icon: 'delivery_dining', status: 'out_for_delivery' },
                                                            { label: 'Giao thành công', time: detailShipment.delivered_at, icon: 'check_circle', status: 'delivered' },
                                                            { label: 'Giao thất bại', time: detailShipment.delivery_failed_at, icon: 'error', status: 'delivery_failed' },
                                                            { label: 'Đang hoàn', time: detailShipment.returning_at, icon: 'undo', status: 'returning' },
                                                            { label: 'Đã hoàn', time: detailShipment.returned_at, icon: 'assignment_return', status: 'returned' },
                                                            { label: 'Đối soát COD', time: detailShipment.reconciled_at, icon: 'account_balance', status: 'reconciled' },
                                                        ].map(({ label, time, icon, status }) => {
                                                            const statusInfo = getStatus(status, SHIPMENT_STATUSES);
                                                            const isActive = Boolean(time);
                                                            const isCurrent = detailShipment.shipment_status === status;
                                                            return <div key={`${label}-${status}`} className={`relative flex items-start gap-3 pb-5 ${isActive ? '' : 'opacity-30'}`}><div className={`absolute left-[-15px] z-10 flex size-5 items-center justify-center rounded-full border-2 ${isCurrent ? 'scale-125 border-primary bg-primary text-white shadow-lg shadow-primary/30' : isActive ? 'border-green-500 bg-green-500 text-white' : 'border-stone/20 bg-white text-stone/30'}`}><span className="material-symbols-outlined text-[11px]">{isActive ? 'check' : ''}</span></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]" style={{ color: isActive ? statusInfo.color : '#d1d5db' }}>{icon}</span><span className={`text-[13px] font-bold ${isCurrent ? 'text-primary' : isActive ? 'text-stone-700' : 'text-stone/40'}`}>{label}</span></div>{isActive && <p className="ml-6 mt-0.5 text-[11px] font-mono text-stone/50">{fmtDateTime(time)}</p>}</div></div>;
                                                        })}
                                                    </div>
                                                </div>
                                                {detailShipment.tracking_histories?.length > 0 ? <div className="rounded-lg border border-stone/10 bg-stone/5 p-4"><p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Tracking từ hãng vận chuyển</p><div className="space-y-2">{detailShipment.tracking_histories.map((history, index) => <div key={index} className="flex items-start gap-3 rounded-md border border-stone/10 bg-white p-2"><div className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /><div className="min-w-0 flex-1"><p className="text-[12px] font-bold text-primary">{history.description || history.status}</p><div className="mt-0.5 flex items-center gap-2"><span className="text-[10px] font-mono text-stone/40">{fmtDateTime(history.event_time)}</span>{history.location && <span className="text-[10px] text-stone/40">• {history.location}</span>}</div></div></div>)}</div></div> : <div className="py-8 text-center"><span className="material-symbols-outlined text-[40px] text-stone/15">cloud_off</span><p className="mt-2 text-[12px] font-bold text-stone/30">Chưa có dữ liệu tracking từ hãng vận chuyển</p><p className="mt-1 text-[10px] text-stone/20">Tích hợp API sẽ tự động đồng bộ khi được kích hoạt</p></div>}
                                            </>
                                        )}

                                        {drawerTab === 'reconciliation' && (
                                            <>
                                                <div className="rounded-lg border border-stone/10 bg-stone/5 p-4">
                                                    <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Thông tin đối soát</p>
                                                    <div className="mb-4 grid grid-cols-2 gap-4">
                                                        <div><p className="text-[10px] font-bold text-stone/40">COD dự kiến</p><p className="text-[18px] font-black text-brick">{fmtMoney(detailShipment.cod_amount)}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Thực nhận dự kiến</p><p className="text-[18px] font-black text-primary">{fmtMoney(detailShipment.actual_received_amount)}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Đã đối soát</p><p className="text-[18px] font-black text-green-600">{fmtMoney(detailShipment.reconciled_amount)}</p></div>
                                                        <div><p className="text-[10px] font-bold text-stone/40">Chênh lệch</p><p className={`text-[18px] font-black ${detailShipment.reconciliation_diff_amount !== 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtMoney(detailShipment.reconciliation_diff_amount)}</p></div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <StatusBadge code={detailShipment.reconciliation_status} list={RECONCILIATION_STATUSES} />
                                                        {detailShipment.reconciled_at && <span className="text-[10px] text-stone/40">vào {fmtDateTime(detailShipment.reconciled_at)}</span>}
                                                    </div>
                                                </div>
                                                {detailShipment.shipment_status === 'delivered' && <div className="rounded-lg border-2 border-dashed border-gold/30 bg-white p-4"><p className="mb-3 text-[10px] font-black uppercase tracking-widest text-gold">Đối soát COD</p><div className="space-y-3"><div><label className="mb-1 block text-[11px] font-bold text-stone/60">Số tiền đối soát thực tế (₫)</label><input type="number" value={reconcileForm.amount} onChange={(event) => setReconcileForm((previous) => ({ ...previous, amount: event.target.value }))} placeholder={`Dự kiến: ${detailShipment.actual_received_amount}`} className="w-full rounded-md border border-stone/10 bg-stone/5 px-3 py-2.5 text-[14px] font-bold focus:border-primary focus:outline-none" /></div><div><label className="mb-1 block text-[11px] font-bold text-stone/60">Ghi chú đối soát</label><input type="text" value={reconcileForm.note} onChange={(event) => setReconcileForm((previous) => ({ ...previous, note: event.target.value }))} placeholder="Ghi chú..." className="w-full rounded-md border border-stone/10 bg-stone/5 px-3 py-2 text-[13px] focus:border-primary focus:outline-none" /></div><button type="button" onClick={handleReconcile} disabled={!reconcileForm.amount || reconcileLoading} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-[13px] font-bold text-white transition-all hover:bg-umber disabled:opacity-30">{reconcileLoading ? <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> : <span className="material-symbols-outlined text-[18px]">account_balance</span>}Xác nhận đối soát</button></div></div>}
                                                {detailShipment.reconciliations?.length > 0 && <div><p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Lịch sử đối soát</p>{detailShipment.reconciliations.map((reconciliation, index) => <div key={index} className={`mb-2 rounded-md border p-3 ${reconciliation.status === 'mismatch' ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}><div className="flex justify-between"><span className="text-[12px] font-bold">{reconciliation.status === 'mismatch' ? 'Lệch tiền' : 'Khớp'}</span><span className="text-[10px] text-stone/40">{fmtDateTime(reconciliation.reconciled_at)}</span></div><div className="mt-2 grid grid-cols-3 gap-2 text-[11px]"><div><span className="text-stone/40">Thực nhận:</span> <span className="font-bold">{fmtMoney(reconciliation.actual_received_amount)}</span></div><div><span className="text-stone/40">Dự kiến:</span> <span className="font-bold">{fmtMoney(reconciliation.system_expected_amount)}</span></div><div><span className="text-stone/40">Lệch:</span> <span className={`font-bold ${reconciliation.diff_amount !== 0 ? 'text-red-500' : 'text-green-600'}`}>{fmtMoney(reconciliation.diff_amount)}</span></div></div>{reconciliation.note && <p className="mt-1 text-[11px] italic text-stone/50">{reconciliation.note}</p>}</div>)}</div>}
                                            </>
                                        )}

                                        {drawerTab === 'notes' && (
                                            <>
                                                {detailShipment.notes?.length > 0 ? detailShipment.notes.map((note) => {
                                                    const noteMeta = getNoteTypeMeta(note.note_type);
                                                    return <div key={note.id || `${note.created_at}-${note.content}`} className={`rounded-md border p-3 ${noteMeta.className}`}>{note.note_type === 'warning' && <span className="text-[9px] font-black uppercase tracking-widest text-red-400">Cảnh báo</span>}<p className="text-[13px] font-bold text-primary">{note.content}</p><p className="mt-1 text-[10px] text-stone/40">{note.created_by_user?.name || 'Hệ thống'} • {fmtDateTime(note.created_at)}</p></div>;
                                                }) : <div className="py-8 text-center"><span className="material-symbols-outlined text-[40px] text-stone/15">sticky_note_2</span><p className="mt-2 text-[12px] font-bold text-stone/30">Chưa có ghi chú nào</p></div>}
                                                <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 bg-white py-2"><input type="text" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Thêm ghi chú..." className="min-w-[220px] flex-1 rounded-md border border-stone/10 bg-stone/5 px-3 py-2.5 text-[13px] focus:border-primary focus:outline-none" onKeyDown={(event) => { if (event.key === 'Enter') handleAddNote(); }} /><button type="button" onClick={handleAddNote} disabled={!noteText.trim()} className="rounded-md bg-primary px-4 py-2.5 text-[12px] font-bold text-white transition-all hover:bg-umber disabled:opacity-30">Gửi</button><button type="button" onClick={(event) => openNotePanel(detailShipment, event)} className="rounded-md border border-primary/15 bg-primary/5 px-4 py-2.5 text-[12px] font-bold text-primary transition-all hover:border-primary/30 hover:bg-primary/10">Mở modal ghi chú</button></div>
                                            </>
                                        )}

                                        {drawerTab === 'logs' && (
                                            <>
                                                <div>
                                                    <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">Lịch sử thay đổi trạng thái</p>
                                                    {detailShipment.status_logs?.length > 0 ? <div className="space-y-2">{detailShipment.status_logs.map((log, index) => <div key={index} className="flex items-center gap-2 rounded-md border border-stone/10 bg-white p-2.5 text-[12px] transition-colors hover:bg-stone/5"><span className="shrink-0 font-mono text-[10px] text-stone/30">{fmtDateTime(log.created_at)}</span><div className="flex items-center gap-1.5"><span className="font-bold text-stone/40">{log.from_status ? getStatus(log.from_status, SHIPMENT_STATUSES).label : '—'}</span><span className="material-symbols-outlined text-[14px] text-gold">arrow_forward</span><span className="font-black" style={{ color: getStatus(log.to_status, SHIPMENT_STATUSES).color }}>{getStatus(log.to_status, SHIPMENT_STATUSES).label}</span></div><div className="ml-auto flex shrink-0 items-center gap-1.5"><span className="rounded border border-stone/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-stone/20">{log.change_source || 'manual'}</span>{log.changed_by_user && <span className="text-[10px] text-stone/30">{log.changed_by_user.name}</span>}</div></div>)}</div> : <p className="py-4 text-center text-[12px] text-stone/30">Chưa có log nào</p>}
                                                </div>
                                                <div className="rounded-lg border border-stone/10 bg-stone/5 p-4"><p className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone/40">API / Webhook Sync</p><div className="grid grid-cols-2 gap-3"><div><p className="text-[10px] font-bold text-stone/40">Carrier Code</p><p className="font-mono text-[13px] font-bold text-primary">{detailShipment.carrier_code || '-'}</p></div><div><p className="text-[10px] font-bold text-stone/40">Last Synced</p><p className="text-[13px] font-bold text-primary">{detailShipment.last_synced_at ? fmtDateTime(detailShipment.last_synced_at) : 'N/A'}</p></div></div>{detailShipment.raw_tracking_payload && <details className="mt-3"><summary className="cursor-pointer text-[10px] font-bold text-stone/40 hover:text-primary">Raw Payload</summary><pre className="mt-2 max-h-40 overflow-x-auto rounded border border-stone/10 bg-white p-2 text-[10px] font-mono text-stone/60">{JSON.stringify(detailShipment.raw_tracking_payload, null, 2)}</pre></details>}</div>
                                            </>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}
            <ShipmentStaffNotesPanel
                notePanel={notePanel}
                onClose={closeNotePanel}
                onDraftChange={(value) => setNotePanel((previous) => previous ? { ...previous, draft: value } : previous)}
                onSubmit={handleSubmitNotePanel}
            />
            <StatusDropdownPortal title={statusMenu?.type === 'order' ? 'Cập nhật trạng thái đơn hàng' : 'Cập nhật trạng thái vận đơn'} options={statusMenu?.type === 'order' ? orderStatusOptions : shipmentStatusOptions} currentValue={statusMenu?.type === 'order' ? activeStatusMenuShipment?.order?.status : activeStatusMenuShipment?.shipment_status} onSelect={(value) => { if (!activeStatusMenuShipment) return; if (statusMenu?.type === 'order') { handleOrderStatusUpdate(activeStatusMenuShipment, value); return; } handleShipmentStatusUpdate(activeStatusMenuShipment.id, value); }} anchorRef={statusMenuAnchorRef} visible={Boolean(statusMenu && activeStatusMenuShipment)} onClose={() => setStatusMenu(null)} statusMenuRef={statusMenuRef} />
        </div>
    );
};

export default ShipmentList;
