import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Pagination from '../../components/Pagination';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { leadApi } from '../../services/api';

const inputClassName = 'w-full h-10 rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] shadow-sm transition-all focus:border-primary/30 focus:outline-none';
const textareaClassName = 'w-full min-h-[132px] rounded-sm border border-primary/10 bg-white px-3 py-2 text-[13px] text-[#0F172A] shadow-sm transition-all focus:border-primary/30 focus:outline-none resize-none';
const buttonClassName = 'inline-flex h-10 items-center gap-2 rounded-sm border border-primary/10 bg-white px-3 text-[12px] font-black uppercase tracking-[0.08em] text-primary/80 shadow-sm transition-all hover:border-primary/30 hover:text-primary';
const iconButtonClassName = 'relative inline-flex size-10 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/70 shadow-sm transition-all hover:border-primary/30 hover:text-primary';
const MAX_NOTIFICATION_ITEMS = 12;
const emptyFilters = { status: '', tag: '', date_from: '', date_to: '' };
const leadNotificationSettingsKey = 'lead_notification_sound_settings';
const LEAD_COLUMNS = [
    { id: 'placed_at', label: 'Thời gian đặt', minWidth: '150px' },
    { id: 'product', label: 'Sản phẩm', minWidth: '280px' },
    { id: 'customer_name', label: 'Tên khách hàng', minWidth: '170px' },
    { id: 'phone', label: 'Số điện thoại', minWidth: '150px' },
    { id: 'address', label: 'Địa chỉ', minWidth: '220px' },
    { id: 'tag', label: 'Tag', minWidth: '110px' },
    { id: 'status', label: 'Trạng thái đơn', minWidth: '190px' },
    { id: 'notes', label: 'Ghi chú', minWidth: '180px' },
    { id: 'link', label: 'Link', minWidth: '100px' },
];
const STATUS_LABEL_MAP = {
    'don moi': 'Đơn mới',
    'da tao don': 'Đã tạo đơn',
    'huy don': 'Hủy đơn',
    'sai sdt': 'Sai SĐT',
    'cho xem lai': 'Chờ xem lại',
    'hen goi lai': 'Hẹn gọi lại',
    'da chot': 'Đã chốt',
    'tat ca': 'Tất cả',
};

const formatMoney = (value) => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;

const parsePageParam = (value) => {
    const page = Number.parseInt(value, 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
};

const normalizeSearchText = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();

const normalizeSearchTextSafe = (value) => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();

const getLeadProductSummary = (lead) => {
    if (Array.isArray(lead?.items) && lead.items.length > 0) {
        return lead.items
            .map((item) => {
                const name = item?.product_name || item?.product_sku || '';
                const quantity = Math.max(1, Number(item?.quantity || 1));
                return name ? `${name}${quantity > 1 ? ` x${quantity}` : ''}` : '';
            })
            .filter(Boolean)
            .join(' | ');
    }

    return lead?.product_summary || '';
};

const formatStatusLabel = (value, code = '') => {
    const source = `${value || ''} ${code || ''}`.trim();
    const normalized = normalizeSearchTextSafe(source);

    for (const [key, label] of Object.entries(STATUS_LABEL_MAP)) {
        if (normalized.includes(key)) return label;
    }

    if (!String(value || '').trim()) return '';

    return String(value)
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const buildProductTooltip = (lead) => (
    Array.isArray(lead?.items)
        ? lead.items.map((item) => {
            const optionTitle = item?.bundle_option_title ? ` - ${item.bundle_option_title}` : '';
            const bundleChildren = Array.isArray(item?.bundle_items) && item.bundle_items.length > 0
                ? `\n  ${item.bundle_items.map((child) => `• ${child.product_name} x${child.quantity || 1}`).join('\n  ')}`
                : '';

            return `${item?.product_name || item?.product_sku || 'Sản phẩm'} x${item?.quantity || 1}${optionTitle}${bundleChildren}`;
        }).join('\n')
        : ''
);

const getLeadDetailKey = (leadId) => `lead-${leadId}`;

const hasExpandableProductDetails = (lead) => (
    Array.isArray(lead?.items)
    && lead.items.length > 0
    && (
        lead.items.length > 1
        || lead.items.some((item) => item?.is_bundle || (item?.bundle_items || []).length > 0)
    )
);

const areFiltersEqual = (left, right) => (
    left.status === right.status
    && left.tag === right.tag
    && left.date_from === right.date_from
    && left.date_to === right.date_to
);

const buildFiltersFromParams = (searchParams) => ({
    status: searchParams.get('status') || '',
    tag: searchParams.get('tag') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
});

const buildQueryParams = (page, filters, quickSearch) => {
    const params = new URLSearchParams();
    if (page > 1) params.set('page', String(page));
    if (filters.status) params.set('status', filters.status);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    if (quickSearch.trim()) params.set('search', quickSearch.trim());
    return params;
};

const leadMatchesSearch = (lead, search) => {
    const normalizedSearch = normalizeSearchTextSafe(search);
    if (!normalizedSearch) return true;

    const values = [
        lead?.lead_number,
        lead?.customer_name,
        lead?.phone,
        lead?.email,
        lead?.address,
        lead?.product_summary,
        lead?.latest_note_excerpt,
        lead?.order_number,
        lead?.tag,
        lead?.link_url,
        ...(Array.isArray(lead?.items)
            ? lead.items.flatMap((item) => [item?.product_name, item?.product_sku])
            : []),
    ];

    return values.some((value) => normalizeSearchTextSafe(value).includes(normalizedSearch));
};

const leadMatchesFilters = (lead, filters, quickSearch) => {
    if (!leadMatchesSearch(lead, quickSearch)) return false;

    if (filters.status) {
        const matchesStatus = String(lead?.lead_status_id ?? lead?.status_config?.id ?? '') === String(filters.status)
            || String(lead?.status ?? '') === String(filters.status)
            || String(lead?.status_config?.code ?? '') === String(filters.status);

        if (!matchesStatus) return false;
    }

    if (filters.tag && String(lead?.tag ?? '') !== String(filters.tag)) return false;

    const placedDate = String(lead?.placed_date || '').slice(0, 10);
    if (filters.date_from && placedDate && placedDate < filters.date_from) return false;
    if (filters.date_to && placedDate && placedDate > filters.date_to) return false;

    return true;
};

const mergeLeadCollections = (incoming, current, perPage = 20) => {
    const map = new Map();
    [...incoming, ...current].forEach((lead) => {
        if (lead?.id) map.set(lead.id, lead);
    });

    return Array.from(map.values())
        .sort((left, right) => {
            const leftTime = new Date(left?.placed_at || left?.created_at || 0).getTime();
            const rightTime = new Date(right?.placed_at || right?.created_at || 0).getTime();

            if (leftTime === rightTime) return Number(right?.id || 0) - Number(left?.id || 0);
            return rightTime - leftTime;
        })
        .slice(0, perPage);
};

const mergeNotificationItems = (incoming, current) => {
    const map = new Map();
    [...incoming, ...current].forEach((lead) => {
        if (lead?.id) map.set(lead.id, lead);
    });

    return Array.from(map.values())
        .sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0))
        .slice(0, MAX_NOTIFICATION_ITEMS);
};

const getStoredNotificationSettings = () => {
    if (typeof window === 'undefined') {
        return { enabled: true, useDefault: true, customAudioDataUrl: '' };
    }

    try {
        const raw = window.localStorage.getItem(leadNotificationSettingsKey);
        if (!raw) return { enabled: true, useDefault: true, customAudioDataUrl: '' };

        const parsed = JSON.parse(raw);
        return {
            enabled: parsed?.enabled !== false,
            useDefault: parsed?.useDefault !== false,
            customAudioDataUrl: typeof parsed?.customAudioDataUrl === 'string' ? parsed.customAudioDataUrl : '',
        };
    } catch (error) {
        console.error('Failed to read lead notification settings', error);
        return { enabled: true, useDefault: true, customAudioDataUrl: '' };
    }
};

const playDefaultNotificationSound = async (audioContextRef) => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = audioContextRef.current || new AudioContextCtor();
    audioContextRef.current = context;

    if (context.state === 'suspended') {
        await context.resume();
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.18);
    gainNode.gain.setValueAtTime(0.0001, context.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
};

const isAutoplayBlockedError = (error) => {
    const signature = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
    return signature.includes('notallowed')
        || signature.includes('gesture')
        || signature.includes('interaction')
        || signature.includes('play() failed');
};

const LeadExpandedProductsPanel = ({ lead, onCollapse }) => {
    if (!Array.isArray(lead?.items) || lead.items.length === 0) {
        return null;
    }

    const totalQuantity = lead.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0);

    return (
        <div className="rounded-md border border-primary/10 bg-[#F8FAFC] p-4 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.45)]">
            <div className="mb-4 flex flex-col gap-3 border-b border-primary/10 pb-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="text-[12px] font-black uppercase tracking-[0.08em] text-primary">Chi tiết sản phẩm</div>
                    <div className="mt-1 text-[13px] font-semibold text-[#0F172A]">
                        {lead.customer_name || 'Khách chưa có tên'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-primary/55">
                        <span>{lead.items.length} sản phẩm</span>
                        <span>Tổng SL {totalQuantity}</span>
                        {lead.order_number ? <span>{lead.order_number}</span> : null}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onCollapse}
                    className="inline-flex h-9 items-center gap-1 rounded-sm border border-primary/10 bg-white px-3 text-[11px] font-black uppercase tracking-[0.08em] text-primary transition-all hover:border-primary/30"
                >
                    <span className="material-symbols-outlined text-[16px]">expand_less</span>
                    Thu gọn
                </button>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
                {lead.items.map((item, index) => {
                    const itemKey = item.id || `${item.product_sku || 'item'}-${item.product_name || 'product'}-${index}`;
                    const bundleChildren = Array.isArray(item.bundle_items) ? item.bundle_items : [];
                    const itemTotal = item.bundle_subtotal || item.line_total || item.unit_price || 0;

                    return (
                        <div key={itemKey} className="rounded-md border border-primary/10 bg-white px-3 py-3 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[13px] font-bold leading-5 text-[#0F172A]">
                                        {item.product_name || item.product_sku || 'Sản phẩm'}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-primary/55">
                                        {item.product_sku ? <span>{item.product_sku}</span> : null}
                                        <span>x{item.quantity || 1}</span>
                                        {item.bundle_option_title ? (
                                            <span className="rounded-sm bg-primary/[0.05] px-1.5 py-0.5 text-primary">
                                                {item.bundle_option_title}
                                            </span>
                                        ) : null}
                                        {item.is_bundle ? <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-primary">Bundle</span> : null}
                                    </div>
                                </div>

                                <div className="shrink-0 text-right text-[11px] font-semibold text-primary/60">
                                    <div>{formatMoney(item.unit_price || 0)}</div>
                                    <div className="mt-1 font-black text-primary">{formatMoney(itemTotal)}</div>
                                </div>
                            </div>

                            {bundleChildren.length > 0 ? (
                                <div className="mt-3 rounded-sm border border-primary/10 bg-[#F8FAFC] p-3">
                                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-primary/70">
                                        Sản phẩm trong gói
                                    </div>

                                    <div className="space-y-2">
                                        {bundleChildren.map((child, childIndex) => (
                                            <div
                                                key={`${itemKey}-${child.product_id || childIndex}`}
                                                className="flex items-start justify-between gap-3 text-[12px] text-[#0F172A]"
                                            >
                                                <div className="min-w-0">
                                                    <div className="font-semibold">{child.product_name || child.product_sku || 'Sản phẩm con'}</div>
                                                    <div className="mt-1 text-[11px] text-primary/50">
                                                        {(child.product_sku || 'N/A')} x{child.quantity || 1}
                                                    </div>
                                                </div>

                                                <div className="shrink-0 text-right text-[11px] font-semibold text-primary/60">
                                                    <div>{formatMoney(child.unit_price || 0)}</div>
                                                    <div className="mt-1 text-primary">{formatMoney(child.line_total || 0)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const ProductCell = ({ lead, expandedBundleIds, onToggleBundle }) => {
    if (!Array.isArray(lead?.items) || lead.items.length === 0) {
        return <div className="text-[13px] text-primary/50">{lead?.product_summary || 'Không có sản phẩm'}</div>;
    }

    const resizingColumnId = null;

    const legacyRenderTableCellA = useCallback((lead, columnId) => {
        switch (columnId) {
        case 'placed_at':
            return (
                <div className="text-[13px] text-[#0F172A]">
                    <div>{lead.placed_date || '-'}</div>
                    <div className="mt-1 font-semibold text-primary/60">{lead.placed_time || '-'}</div>
                    {lead.order_number ? (
                        <div className="mt-2 truncate text-[11px] font-bold text-primary/45" title={lead.order_number}>{lead.order_number}</div>
                    ) : null}
                </div>
            );
        case 'product':
            return <CompactProductCell lead={lead} expandedBundleIds={expandedBundleIds} onToggleBundle={handleToggleBundle} />;
        case 'customer_name':
            return <div className="truncate text-[13px] font-semibold text-[#0F172A]" title={lead.customer_name || 'Khách chưa có tên'}>{lead.customer_name || 'Khách chưa có tên'}</div>;
        case 'phone':
            return <div className="truncate text-[13px] font-semibold text-[#0F172A]" title={lead.phone || '-'}>{lead.phone || '-'}</div>;
        case 'address':
            return <div className="text-[13px] leading-5 text-[#0F172A]" title={lead.address || '-'}>{lead.address || '-'}</div>;
        case 'tag':
            return (
                <span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-bold text-primary">
                    {lead.tag || 'Website'}
                </span>
            );
        case 'status':
            return (
                <select
                    value={lead.status_config?.id || ''}
                    title={formatStatusLabel(lead.status_config?.name || lead.status, lead.status_config?.code)}
                    onChange={(event) => handleLeadStatusChange(lead, event.target.value)}
                    className={`${inputClassName} w-full min-w-0 max-w-full`}
                >
                    {statuses.map((status) => (
                        <option key={status.id} value={status.id}>{formatStatusLabel(status.name, status.code)}</option>
                    ))}
                </select>
            );
        case 'notes':
            return (
                <button type="button" onClick={() => setNotesLead(lead)} className="w-full text-left">
                    <div className="text-[12px] font-bold text-primary">Chi tiết</div>
                    <div className="mt-1 truncate text-[13px] text-primary/60" title={lead.latest_note_excerpt || 'Chưa có ghi chú'}>
                        {lead.latest_note_excerpt || 'Chưa có ghi chú'}
                    </div>
                </button>
            );
        case 'link':
            return lead.link_url ? (
                <a
                    href={lead.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-primary transition-all hover:text-brick"
                    title="Mở link"
                >
                    Mở
                    <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                </a>
            ) : (
                <span className="text-[13px] text-primary/40">Không có link</span>
            );
        default:
            return null;
        }
    }, [expandedBundleIds, handleToggleBundle, statuses]);

    const legacyRenderTableCellB = useCallback((lead, columnId) => {
        switch (columnId) {
        case 'placed_at':
            return (
                <div className="text-[13px] text-[#0F172A]">
                    <div>{lead.placed_date || '-'}</div>
                    <div className="mt-1 font-semibold text-primary/60">{lead.placed_time || '-'}</div>
                    {lead.order_number ? (
                        <div className="mt-2 truncate text-[11px] font-bold text-primary/45" title={lead.order_number}>{lead.order_number}</div>
                    ) : null}
                </div>
            );
        case 'product':
            return <CompactProductCell lead={lead} expandedBundleIds={expandedBundleIds} onToggleBundle={handleToggleBundle} />;
        case 'customer_name':
            return <div className="truncate text-[13px] font-semibold text-[#0F172A]" title={lead.customer_name || 'Khách chưa có tên'}>{lead.customer_name || 'Khách chưa có tên'}</div>;
        case 'phone':
            return <div className="truncate text-[13px] font-semibold text-[#0F172A]" title={lead.phone || '-'}>{lead.phone || '-'}</div>;
        case 'address':
            return <div className="text-[13px] leading-5 text-[#0F172A]" title={lead.address || '-'}>{lead.address || '-'}</div>;
        case 'tag':
            return (
                <span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-bold text-primary">
                    {lead.tag || 'Website'}
                </span>
            );
        case 'status':
            return (
                <select
                    value={lead.status_config?.id || ''}
                    title={formatStatusLabel(lead.status_config?.name || lead.status, lead.status_config?.code)}
                    onChange={(event) => handleLeadStatusChange(lead, event.target.value)}
                    className={`${inputClassName} w-full min-w-0 max-w-full`}
                >
                    {statuses.map((status) => (
                        <option key={status.id} value={status.id}>{formatStatusLabel(status.name, status.code)}</option>
                    ))}
                </select>
            );
        case 'notes':
            return (
                <button type="button" onClick={() => setNotesLead(lead)} className="w-full text-left">
                    <div className="text-[12px] font-bold text-primary">Chi tiết</div>
                    <div className="mt-1 truncate text-[13px] text-primary/60" title={lead.latest_note_excerpt || 'Chưa có ghi chú'}>
                        {lead.latest_note_excerpt || 'Chưa có ghi chú'}
                    </div>
                </button>
            );
        case 'link':
            return lead.link_url ? (
                <a
                    href={lead.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-primary transition-all hover:text-brick"
                    title="Mở link"
                >
                    Mở
                    <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                </a>
            ) : (
                <span className="text-[13px] text-primary/40">Không có link</span>
            );
        default:
            return null;
        }
    }, [expandedBundleIds, handleToggleBundle, statuses]);

    const renderLeadTable = () => (
        <div className="lead-table-scrollbar min-h-0 flex-1 overflow-auto">
            <table className="min-h-full table-fixed border-collapse" style={{ width: `${leadTableWidth}px`, minWidth: '100%' }}>
                <thead>
                    <tr className="lead-table-head sticky top-0 z-10 border-b border-primary/10 text-left shadow-sm">
                        {renderedColumns.map((column, index) => (
                            <th
                                key={column.id}
                                draggable
                                onDragStart={(event) => handleHeaderDragStart(event, index)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleHeaderDrop(event, index)}
                                className="group relative border-r border-primary/10 px-4 py-3 text-[12px] font-bold text-primary last:border-r-0"
                                style={{
                                    width: columnWidths[column.id] || column.minWidth,
                                    minWidth: columnWidths[column.id] || column.minWidth,
                                }}
                                title="Kéo để đổi vị trí cột"
                            >
                                <div className="truncate pr-3">{column.label}</div>
                                <span
                                    onMouseDown={(event) => handleColumnResize(column.id, event)}
                                    className="group/resize absolute right-[-4px] top-0 z-20 flex h-full w-2.5 cursor-col-resize items-center justify-center"
                                    title="Kéo để đổi độ rộng cột"
                                >
                                    <span
                                        className={`pointer-events-none block w-px rounded-full bg-primary/45 transition-all ${
                                            resizingColumnId === column.id
                                                ? 'h-10 opacity-100 bg-primary/70'
                                                : 'h-6 opacity-0 group-hover/resize:h-8 group-hover/resize:opacity-100'
                                        }`}
                                    />
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={renderedColumns.length || 1} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55" style={{ height: 'calc(100vh - 430px)' }}>
                                Đang tải danh sách lead...
                            </td>
                        </tr>
                    ) : leads.length === 0 ? (
                        <tr>
                            <td colSpan={renderedColumns.length || 1} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55" style={{ height: 'calc(100vh - 430px)' }}>
                                Không tìm thấy lead phù hợp với bộ lọc hiện tại.
                            </td>
                        </tr>
                    ) : leads.map((lead) => (
                        <tr
                            key={lead.id}
                            id={`lead-row-${lead.id}`}
                            className={`border-b border-primary/10 align-top transition-all ${highlightedLeadId === lead.id ? 'bg-amber-50' : 'bg-white hover:bg-primary/[0.025]'}`}
                            onDoubleClick={() => handleOpenOrderForm(lead)}
                        >
                            {renderedColumns.map((column) => (
                                <td
                                    key={`${lead.id}-${column.id}`}
                                    className="overflow-hidden px-4 py-3 align-top text-[13px]"
                                    style={{
                                        width: columnWidths[column.id] || column.minWidth,
                                        minWidth: columnWidths[column.id] || column.minWidth,
                                    }}
                                >
                                    {renderTableCell(lead, column.id)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    return (
        <div className="space-y-2.5">
            {lead.items.slice(0, 2).map((item) => {
                const bundleKey = `${lead.id}-${item.id}`;
                const isExpanded = expandedBundleIds.has(bundleKey);
                const bundleChildren = Array.isArray(item.bundle_items) ? item.bundle_items : [];

                return (
                    <div key={item.id || `${item.product_sku}-${item.product_name}`} className="rounded-sm border border-primary/10 bg-white px-3 py-2 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[13px] font-bold text-[#0F172A]">{item.product_name || item.product_sku || 'Không có sản phẩm'}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                                    {item.product_sku ? <span>{item.product_sku}</span> : null}
                                    <span>x{item.quantity || 1}</span>
                                    {item.is_bundle && item.bundle_option_title ? <span>{item.bundle_option_title}</span> : null}
                                    {item.is_bundle ? <span className="rounded-sm bg-primary/[0.06] px-1.5 py-0.5 text-primary">Bundle</span> : null}
                                </div>
                            </div>

                            {item.is_bundle && bundleChildren.length > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => onToggleBundle(bundleKey)}
                                    className="inline-flex h-8 items-center gap-1 rounded-sm border border-primary/10 px-2 text-[11px] font-black uppercase tracking-[0.08em] text-primary transition-all hover:border-primary/30"
                                >
                                    <span className="material-symbols-outlined text-[16px]">{isExpanded ? 'expand_less' : 'expand_more'}</span>
                                    {isExpanded ? 'Ẩn món' : 'Xem món'}
                                </button>
                            ) : null}
                        </div>

                        {item.is_bundle ? (
                            <div className="mt-2 text-[12px] font-semibold text-primary/60">
                                Giá bộ: <span className="font-black text-primary">{formatMoney(item.bundle_subtotal || item.line_total || 0)}</span>
                            </div>
                        ) : null}

                        {item.is_bundle && bundleChildren.length > 0 && isExpanded ? (
                            <div className="mt-3 space-y-2 border-t border-primary/10 pt-3">
                                {bundleChildren.map((child, index) => (
                                    <div key={`${bundleKey}-${child.product_id || index}`} className="flex items-start justify-between gap-3 text-[12px] text-[#0F172A]">
                                        <div className="min-w-0">
                                            <div className="font-semibold">{child.product_name}</div>
                                            <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-primary/45">
                                                {child.product_sku || 'N/A'} x{child.quantity || 1}
                                            </div>
                                        </div>
                                        <div className="shrink-0 text-right text-[11px] font-bold text-primary/60">
                                            <div>{formatMoney(child.unit_price || 0)}</div>
                                            <div className="mt-1 text-primary">{formatMoney(child.line_total || 0)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                );
            })}

            {lead.items.length > 2 ? (
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                    +{lead.items.length - 2} sản phẩm khác
                </div>
            ) : null}
        </div>
    );
};

const CompactProductCell = ({ lead, expandedBundleIds, onToggleBundle }) => {
    if (!Array.isArray(lead?.items) || lead.items.length === 0) {
        return <div className="truncate text-[13px] text-primary/50">{lead?.product_summary || 'Không có sản phẩm'}</div>;
    }

    const detailKey = getLeadDetailKey(lead.id);
    const isOpen = expandedBundleIds.has(detailKey);
    const primaryItem = lead.items[0];
    const totalItemCount = lead.items.length;
    const totalQuantity = lead.items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
    const hasDetailButton = hasExpandableProductDetails(lead);
    const summaryTitle = primaryItem?.product_name || primaryItem?.product_sku || 'Sản phẩm';
    const productTooltip = buildProductTooltip(lead);

    return (
        <div className="relative max-w-full" title={productTooltip}>
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div
                        className="overflow-hidden text-[13px] font-bold leading-5 text-[#0F172A]"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                    >
                        {summaryTitle}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-primary/55">
                        {primaryItem?.bundle_option_title ? (
                            <span className="rounded-sm bg-primary/[0.05] px-1.5 py-0.5 text-primary">{primaryItem.bundle_option_title}</span>
                        ) : null}
                        {primaryItem?.product_sku ? <span className="truncate">{primaryItem.product_sku}</span> : null}
                        <span>{totalItemCount > 1 ? `${totalItemCount} sản phẩm` : `x${primaryItem?.quantity || 1}`}</span>
                        {lead.items.some((item) => item?.is_bundle) ? <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-primary">Bundle</span> : null}
                    </div>
                    {totalItemCount > 1 ? (
                        <div className="mt-1 truncate text-[11px] text-primary/45">
                            +{totalItemCount - 1} sản phẩm khác, tổng SL {totalQuantity}
                        </div>
                    ) : null}
                </div>

                {hasDetailButton ? (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggleBundle(detailKey);
                        }}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/65 transition-all hover:border-primary/30 hover:text-primary"
                        aria-expanded={isOpen}
                        aria-controls={`lead-product-details-${lead.id}`}
                        title={isOpen ? 'Ẩn chi tiết sản phẩm' : 'Xem chi tiết sản phẩm'}
                    >
                        <span className="material-symbols-outlined text-[18px]">{isOpen ? 'expand_less' : 'expand_more'}</span>
                    </button>
                ) : null}
            </div>

            {false && isOpen ? (
                <div
                    className="absolute left-0 top-[calc(100%+8px)] z-20 w-[360px] max-w-[min(360px,calc(100vw-120px))] rounded-sm border border-primary/15 bg-white p-3 shadow-[0_18px_50px_-18px_rgba(15,23,42,0.45)]"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[12px] font-black tracking-[0.08em] text-primary">Chi tiết sản phẩm</div>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleBundle(detailKey);
                            }}
                            className="inline-flex size-7 items-center justify-center rounded-sm text-primary/45 transition-all hover:bg-primary/5 hover:text-primary"
                            title="Đóng"
                        >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                    </div>

                    <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                        {lead.items.map((item) => (
                            <div key={item.id || `${item.product_sku}-${item.product_name}`} className="rounded-sm border border-primary/10 bg-[#F8FAFC] px-3 py-2">
                                <div className="text-[12px] font-bold leading-5 text-[#0F172A]">{item.product_name || item.product_sku || 'Sản phẩm'}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-primary/55">
                                    {item.product_sku ? <span>{item.product_sku}</span> : null}
                                    <span>x{item.quantity || 1}</span>
                                    {item.bundle_option_title ? <span>{item.bundle_option_title}</span> : null}
                                </div>

                                {Array.isArray(item.bundle_items) && item.bundle_items.length > 0 ? (
                                    <div className="mt-2 space-y-1 border-t border-primary/10 pt-2">
                                        {item.bundle_items.map((child, index) => (
                                            <div key={`${item.id || item.product_sku}-${child.product_id || index}`} className="flex items-start justify-between gap-3 text-[11px] text-primary/70">
                                                <div className="min-w-0 truncate">{child.product_name}</div>
                                                <div className="shrink-0">x{child.quantity || 1}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

const LeadColumnVisibilityPanel = ({
    availableColumns,
    visibleColumns,
    toggleColumn,
    resetDefault,
    saveAsDefault,
    onClose,
}) => (
    <div className="border-t border-primary/10 bg-[#F8FAFC] px-4 py-4">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
                <div className="text-[13px] font-black text-primary">Ẩn / hiện cột</div>
                <div className="text-[12px] text-primary/55">Kéo tiêu đề cột trực tiếp trên bảng để đổi vị trí, kéo mép phải của cột để đổi độ rộng.</div>
            </div>
            <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetDefault} className={buttonClassName}>
                    Khôi phục
                </button>
                <button type="button" onClick={saveAsDefault} className={buttonClassName}>
                    Lưu mặc định
                </button>
                <button type="button" onClick={onClose} className={`${buttonClassName} bg-primary text-white hover:bg-primary/90 hover:text-white`}>
                    Xong
                </button>
            </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            {availableColumns.map((column) => (
                <label key={column.id} className={`flex items-center gap-2 rounded-sm border px-3 py-2 text-[13px] transition-all ${visibleColumns.includes(column.id) ? 'border-primary/20 bg-white text-primary shadow-sm' : 'border-primary/10 bg-white/60 text-primary/45'}`}>
                    <input
                        type="checkbox"
                        checked={visibleColumns.includes(column.id)}
                        onChange={() => toggleColumn(column.id)}
                        className="size-4 accent-primary"
                    />
                    <span>{column.label}</span>
                </label>
            ))}
        </div>
    </div>
);

const FilterPanel = ({ filters, draftFilters, statuses, tags, onDraftChange, onApply, onReset }) => (
    <div className="grid gap-4 border-t border-primary/10 bg-[#f8fafc] px-4 py-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Trạng thái</label>
            <select
                value={draftFilters.status}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, status: event.target.value }))}
                className={inputClassName}
            >
                <option value="">Tất cả trạng thái</option>
                {statuses.map((status) => (
                    <option key={status.id} value={status.id}>{status.name}</option>
                ))}
            </select>
        </div>

        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tag</label>
            <select
                value={draftFilters.tag}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, tag: event.target.value }))}
                className={inputClassName}
            >
                <option value="">Tất cả tag</option>
                {tags.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                ))}
            </select>
        </div>

        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Từ ngày</label>
            <input
                type="date"
                value={draftFilters.date_from}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, date_from: event.target.value }))}
                className={inputClassName}
            />
        </div>

        <div className="space-y-1.5">
            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Đến ngày</label>
            <input
                type="date"
                value={draftFilters.date_to}
                onChange={(event) => onDraftChange((prev) => ({ ...prev, date_to: event.target.value }))}
                className={inputClassName}
            />
        </div>

        <div className="flex items-end gap-2">
            <button type="button" onClick={onApply} className={`${buttonClassName} bg-primary text-white hover:bg-primary/90 hover:text-white`}>
                Áp dụng
            </button>
            <button type="button" onClick={() => onReset(filters)} className={buttonClassName}>
                Đặt lại
            </button>
        </div>
    </div>
);

const NotesModal = ({ lead, onClose, onSaved, currentUserName }) => {
    const { showModal, showToast } = useUI();
    const [notes, setNotes] = useState([]);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const fetchNotes = useCallback(async () => {
        try {
            setLoading(true);
            const response = await leadApi.getNotes(lead.id);
            setNotes(response.data?.data || []);
        } catch (error) {
            console.error('Failed to load lead notes', error);
            showModal({ title: 'Lỗi', content: 'Không thể tải lịch sử ghi chú.', type: 'error' });
        } finally {
            setLoading(false);
        }
    }, [lead.id, showModal]);

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!content.trim()) {
            showToast({ message: 'Vui lòng nhập nội dung ghi chú.', type: 'warning' });
            return;
        }

        try {
            setSaving(true);
            const response = await leadApi.addNote(lead.id, { content: content.trim() });
            const nextNote = response.data;
            setNotes((prev) => [nextNote, ...prev]);
            setContent('');
            showToast({ message: 'Đã lưu ghi chú lead.', type: 'success' });
            onSaved?.(nextNote);
        } catch (error) {
            console.error('Failed to save lead note', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu ghi chú lead.', type: 'error' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4">
            <div className="w-full max-w-5xl overflow-hidden rounded-sm border border-primary/10 bg-white shadow-2xl">
                <div className="flex items-start justify-between gap-4 border-b border-primary/10 px-6 py-5">
                    <div>
                        <h2 className="text-[24px] font-black uppercase tracking-[0.06em] text-primary">Lịch sử ghi chú</h2>
                        <p className="mt-1 text-[13px] text-primary/55">
                            {lead.customer_name || 'Khách chưa có tên'}
                            {lead.phone ? ` - ${lead.phone}` : ''}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className={iconButtonClassName} title="Đóng">
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="grid gap-0 lg:grid-cols-[1.35fr_0.85fr]">
                    <div className="max-h-[520px] overflow-y-auto border-b border-primary/10 p-6 lg:border-b-0 lg:border-r">
                        {loading ? (
                            <div className="py-10 text-center text-[13px] font-semibold text-primary/55">Đang tải ghi chú...</div>
                        ) : notes.length === 0 ? (
                            <div className="py-10 text-center text-[13px] font-semibold text-primary/55">Chưa có ghi chú nào cho lead này.</div>
                        ) : (
                            <div className="space-y-4">
                                {notes.map((note) => (
                                    <div key={note.id} className="rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.08em] text-primary/45">
                                            <span>{note.staff_name || 'Nhân viên'}</span>
                                            <span>{note.created_label || ''}</span>
                                        </div>
                                        <div className="whitespace-pre-wrap text-[13px] leading-6 text-[#0F172A]">{note.content}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4 p-6">
                        <div className="rounded-sm border border-primary/10 bg-primary/[0.03] px-4 py-3">
                            <div className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/50">Người ghi chú</div>
                            <div className="mt-1 text-[14px] font-semibold text-[#0F172A]">{currentUserName || 'Nhân viên'}</div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Nội dung ghi chú</label>
                            <textarea
                                value={content}
                                onChange={(event) => setContent(event.target.value)}
                                className={textareaClassName}
                                placeholder="Nhập ghi chú xử lý lead..."
                            />
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="inline-flex h-11 items-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-[0.08em] text-white shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className="material-symbols-outlined text-[18px]">save</span>
                                {saving ? 'Đang lưu...' : 'Lưu ghi chú'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

const LeadSettingsModal = ({ open, onClose, statuses, staffs, tagRules, onReload }) => {
    const { showModal, showToast } = useUI();
    const [tab, setTab] = useState('status');
    const [statusForm, setStatusForm] = useState({ name: '', code: '', color: '#1f3b73', blocks_order_create: false, is_default: false, is_active: true });
    const [staffForm, setStaffForm] = useState({ name: '', is_active: true });
    const [tagRuleForm, setTagRuleForm] = useState({ tag: '', match_type: 'contains', pattern: '', priority: 0, notes: '', is_active: true });
    const [busy, setBusy] = useState(false);

    if (!open) return null;

    const handleDelete = async (type, item) => {
        try {
            setBusy(true);
            if (type === 'status') await leadApi.deleteStatusConfig(item.id);
            if (type === 'staff') await leadApi.deleteStaff(item.id);
            if (type === 'tag-rule') await leadApi.deleteTagRule(item.id);
            showToast({ message: 'Đã xóa cấu hình lead.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to delete lead setting', error);
            const message = error?.response?.data?.message || 'Không thể xóa cấu hình này.';
            showModal({ title: 'Lỗi', content: message, type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleCreateStatus = async (event) => {
        event.preventDefault();
        try {
            setBusy(true);
            await leadApi.createStatus(statusForm);
            setStatusForm({ name: '', code: '', color: '#1f3b73', blocks_order_create: false, is_default: false, is_active: true });
            showToast({ message: 'Đã thêm trạng thái lead.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to create lead status', error);
            showModal({ title: 'Lỗi', content: 'Không thể thêm trạng thái lead.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleCreateStaff = async (event) => {
        event.preventDefault();
        try {
            setBusy(true);
            await leadApi.createStaff(staffForm);
            setStaffForm({ name: '', is_active: true });
            showToast({ message: 'Đã thêm nhân viên lead.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to create lead staff', error);
            showModal({ title: 'Lỗi', content: 'Không thể thêm nhân viên lead.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const handleCreateTagRule = async (event) => {
        event.preventDefault();
        try {
            setBusy(true);
            await leadApi.createTagRule(tagRuleForm);
            setTagRuleForm({ tag: '', match_type: 'contains', pattern: '', priority: 0, notes: '', is_active: true });
            showToast({ message: 'Đã thêm quy tắc tag.', type: 'success' });
            await onReload?.();
        } catch (error) {
            console.error('Failed to create tag rule', error);
            showModal({ title: 'Lỗi', content: 'Không thể thêm quy tắc tag.', type: 'error' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
            <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-sm border border-primary/10 bg-white shadow-2xl">
                <div className="flex items-center justify-between gap-4 border-b border-primary/10 px-6 py-5">
                    <div>
                        <h2 className="text-[24px] font-black uppercase tracking-[0.06em] text-primary">Cài đặt lead</h2>
                        <p className="mt-1 text-[13px] text-primary/55">Quản lý trạng thái, nhân viên và quy tắc gắn tag.</p>
                    </div>
                    <button type="button" onClick={onClose} className={iconButtonClassName} title="Đóng">
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="flex gap-2 border-b border-primary/10 px-6 py-3">
                    {[
                        { key: 'status', label: 'Trạng thái' },
                        { key: 'staff', label: 'Nhân viên' },
                        { key: 'tag-rule', label: 'Quy tắc tag' },
                    ].map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => setTab(item.key)}
                            className={`rounded-sm px-4 py-2 text-[12px] font-black uppercase tracking-[0.08em] transition-all ${
                                tab === item.key ? 'bg-primary text-white' : 'border border-primary/10 bg-white text-primary/70'
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="border-b border-primary/10 p-6 lg:border-b-0 lg:border-r">
                        {tab === 'status' ? (
                            <form onSubmit={handleCreateStatus} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tên trạng thái</label>
                                    <input value={statusForm.name} onChange={(event) => setStatusForm((prev) => ({ ...prev, name: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Mã trạng thái</label>
                                    <input value={statusForm.code} onChange={(event) => setStatusForm((prev) => ({ ...prev, code: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Màu hiển thị</label>
                                    <input type="color" value={statusForm.color} onChange={(event) => setStatusForm((prev) => ({ ...prev, color: event.target.value }))} className="h-10 w-full rounded-sm border border-primary/10 bg-white px-2" />
                                </div>
                                <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                    <input type="checkbox" checked={statusForm.blocks_order_create} onChange={(event) => setStatusForm((prev) => ({ ...prev, blocks_order_create: event.target.checked }))} />
                                    Chặn tạo đơn khi lead ở trạng thái này
                                </label>
                                <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                    <input type="checkbox" checked={statusForm.is_default} onChange={(event) => setStatusForm((prev) => ({ ...prev, is_default: event.target.checked }))} />
                                    Đặt làm trạng thái mặc định
                                </label>
                                <button type="submit" disabled={busy} className={`${buttonClassName} bg-primary text-white hover:text-white`}>
                                    Thêm trạng thái
                                </button>
                            </form>
                        ) : null}

                        {tab === 'staff' ? (
                            <form onSubmit={handleCreateStaff} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tên nhân viên</label>
                                    <input value={staffForm.name} onChange={(event) => setStaffForm((prev) => ({ ...prev, name: event.target.value }))} className={inputClassName} />
                                </div>
                                <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                    <input type="checkbox" checked={staffForm.is_active} onChange={(event) => setStaffForm((prev) => ({ ...prev, is_active: event.target.checked }))} />
                                    Đang hoạt động
                                </label>
                                <button type="submit" disabled={busy} className={`${buttonClassName} bg-primary text-white hover:text-white`}>
                                    Thêm nhân viên
                                </button>
                            </form>
                        ) : null}

                        {tab === 'tag-rule' ? (
                            <form onSubmit={handleCreateTagRule} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Tag</label>
                                    <input value={tagRuleForm.tag} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, tag: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Kiểu khớp</label>
                                    <select value={tagRuleForm.match_type} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, match_type: event.target.value }))} className={inputClassName}>
                                        <option value="contains">Chứa</option>
                                        <option value="equals">Bằng đúng</option>
                                        <option value="regex">Regex</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Mẫu so khớp</label>
                                    <input value={tagRuleForm.pattern} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, pattern: event.target.value }))} className={inputClassName} />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Ghi chú</label>
                                    <textarea value={tagRuleForm.notes} onChange={(event) => setTagRuleForm((prev) => ({ ...prev, notes: event.target.value }))} className={textareaClassName} />
                                </div>
                                <button type="submit" disabled={busy} className={`${buttonClassName} bg-primary text-white hover:text-white`}>
                                    Thêm quy tắc
                                </button>
                            </form>
                        ) : null}
                    </div>

                    <div className="min-h-0 overflow-y-auto p-6">
                        {tab === 'status' ? (
                            <div className="space-y-3">
                                {statuses.map((status) => (
                                    <div key={status.id} className="flex items-start justify-between gap-4 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex size-3 rounded-full" style={{ backgroundColor: status.color || '#1f3b73' }} />
                                                <div className="text-[14px] font-bold text-[#0F172A]">{status.name}</div>
                                            </div>
                                            <div className="mt-1 text-[12px] text-primary/55">{status.code}</div>
                                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                                                {status.is_default ? <span>Mặc định</span> : null}
                                                {status.blocks_order_create ? <span>Chặn tạo đơn</span> : null}
                                                {!status.is_active ? <span>Đang tắt</span> : null}
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => handleDelete('status', status)} className={buttonClassName}>Xóa</button>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {tab === 'staff' ? (
                            <div className="space-y-3">
                                {staffs.map((staff) => (
                                    <div key={staff.id} className="flex items-center justify-between gap-4 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div>
                                            <div className="text-[14px] font-bold text-[#0F172A]">{staff.name}</div>
                                            <div className="mt-1 text-[12px] text-primary/55">{staff.is_active ? 'Đang hoạt động' : 'Đang tắt'}</div>
                                        </div>
                                        <button type="button" onClick={() => handleDelete('staff', staff)} className={buttonClassName}>Xóa</button>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {tab === 'tag-rule' ? (
                            <div className="space-y-3">
                                {tagRules.map((rule) => (
                                    <div key={rule.id} className="flex items-start justify-between gap-4 rounded-sm border border-primary/10 bg-white p-4 shadow-sm">
                                        <div className="space-y-1">
                                            <div className="text-[14px] font-bold text-[#0F172A]">{rule.tag}</div>
                                            <div className="text-[12px] text-primary/55">{rule.match_type} - {rule.pattern}</div>
                                            {rule.notes ? <div className="text-[13px] text-[#0F172A]">{rule.notes}</div> : null}
                                        </div>
                                        <button type="button" onClick={() => handleDelete('tag-rule', rule)} className={buttonClassName}>Xóa</button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
};

const LeadList = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const { showModal, showToast } = useUI();

    const [loading, setLoading] = useState(true);
    const [statuses, setStatuses] = useState([]);
    const [staffs, setStaffs] = useState([]);
    const [tagRules, setTagRules] = useState([]);
    const [tags, setTags] = useState([]);
    const [leads, setLeads] = useState([]);
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 20, total: 0 });
    const [latestId, setLatestId] = useState(0);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [columnPanelOpen, setColumnPanelOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const [soundSettingsOpen, setSoundSettingsOpen] = useState(false);
    const [notesLead, setNotesLead] = useState(null);
    const [unreadNotifications, setUnreadNotifications] = useState([]);
    const [soundSettings, setSoundSettings] = useState(() => getStoredNotificationSettings());
    const [realtimeReady, setRealtimeReady] = useState(false);
    const [page, setPage] = useState(parsePageParam(searchParams.get('page')));
    const [filters, setFilters] = useState(() => buildFiltersFromParams(searchParams));
    const [draftFilters, setDraftFilters] = useState(() => buildFiltersFromParams(searchParams));
    const [quickSearch, setQuickSearch] = useState(searchParams.get('search') || '');
    const [debouncedQuickSearch, setDebouncedQuickSearch] = useState(searchParams.get('search') || '');
    const [highlightedLeadId, setHighlightedLeadId] = useState(null);
    const [pendingFocusLeadId, setPendingFocusLeadId] = useState(null);
    const [expandedBundleIds, setExpandedBundleIds] = useState(() => new Set());

    const {
        availableColumns,
        visibleColumns,
        renderedColumns,
        columnWidths,
        resizingColumnId,
        toggleColumn,
        handleColumnResize,
        handleHeaderDragStart,
        handleHeaderDrop,
        resetDefault,
        saveAsDefault,
    } = useTableColumns('lead_list', LEAD_COLUMNS);

    const notificationPanelRef = useRef(null);
    const latestIdRef = useRef(0);
    const pageRef = useRef(page);
    const filtersRef = useRef(filters);
    const searchRef = useRef(debouncedQuickSearch);
    const paginationRef = useRef(pagination);
    const leadsRef = useRef(leads);
    const fetchSeqRef = useRef(0);
    const abortControllerRef = useRef(null);
    const highlightTimeoutRef = useRef(null);
    const audioElementRef = useRef(null);
    const audioContextRef = useRef(null);
    const notificationSoundQueuedRef = useRef(false);
    const notificationInteractionReadyRef = useRef(false);
    const realtimeRequestInFlightRef = useRef(false);

    const totalAcrossStatuses = useMemo(
        () => statuses.reduce((sum, status) => sum + Number(status.count || 0), 0),
        [statuses]
    );
    const unreadNotificationCount = unreadNotifications.length;
    const leadTableWidth = useMemo(
        () => renderedColumns.reduce((total, column) => {
            const width = columnWidths[column.id] || column.minWidth || 0;
            const numericWidth = typeof width === 'string' ? parseInt(width, 10) : Number(width || 0);
            return total + numericWidth;
        }, 0),
        [columnWidths, renderedColumns]
    );

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedQuickSearch(quickSearch.trim());
        }, 300);

        return () => window.clearTimeout(timer);
    }, [quickSearch]);

    useEffect(() => {
        const nextPage = parsePageParam(searchParams.get('page'));
        const nextFilters = buildFiltersFromParams(searchParams);
        const nextSearch = searchParams.get('search') || '';

        setPage((prev) => (prev === nextPage ? prev : nextPage));
        setFilters((prev) => (areFiltersEqual(prev, nextFilters) ? prev : nextFilters));
        setDraftFilters((prev) => (areFiltersEqual(prev, nextFilters) ? prev : nextFilters));
        setQuickSearch((prev) => (prev === nextSearch ? prev : nextSearch));
        setDebouncedQuickSearch((prev) => (prev === nextSearch ? prev : nextSearch));
    }, [searchParams]);

    useEffect(() => { pageRef.current = page; }, [page]);
    useEffect(() => { filtersRef.current = filters; }, [filters]);
    useEffect(() => { searchRef.current = debouncedQuickSearch; }, [debouncedQuickSearch]);
    useEffect(() => { paginationRef.current = pagination; }, [pagination]);
    useEffect(() => { leadsRef.current = leads; }, [leads]);
    useEffect(() => { latestIdRef.current = latestId; }, [latestId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(leadNotificationSettingsKey, JSON.stringify(soundSettings));
    }, [soundSettings]);

    useEffect(() => {
        const nextParams = buildQueryParams(page, filters, debouncedQuickSearch);
        const nextSearchString = nextParams.toString();
        const currentSearchString = location.search.startsWith('?') ? location.search.slice(1) : location.search;

        if (nextSearchString !== currentSearchString) {
            setSearchParams(nextParams, { replace: true });
        }
    }, [page, filters, debouncedQuickSearch, location.search, setSearchParams]);

    const focusLeadRow = useCallback((leadId) => {
        if (!leadId) return false;
        const row = document.getElementById(`lead-row-${leadId}`);
        if (!row) return false;

        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedLeadId(leadId);

        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = window.setTimeout(() => {
            setHighlightedLeadId((prev) => (prev === leadId ? null : prev));
        }, 2200);

        return true;
    }, []);

    const primeLeadNotificationAudio = useCallback(async ({ userInitiated = false } = {}) => {
        if (typeof window === 'undefined' || !soundSettings.enabled) return false;

        if (!soundSettings.useDefault && soundSettings.customAudioDataUrl) {
            if (!audioElementRef.current) {
                audioElementRef.current = new Audio();
                audioElementRef.current.preload = 'auto';
            }

            const audio = audioElementRef.current;
            if (audio.src !== soundSettings.customAudioDataUrl) {
                audio.src = soundSettings.customAudioDataUrl;
                audio.load?.();
            }

            if (!userInitiated) return true;

            const previousMuted = audio.muted;
            audio.muted = true;

            try {
                audio.currentTime = 0;
                await audio.play();
                audio.pause();
                audio.currentTime = 0;
                return true;
            } catch (error) {
                if (!isAutoplayBlockedError(error)) {
                    console.error('Failed to prime lead notification audio', error);
                }
                return false;
            } finally {
                audio.muted = previousMuted;
            }
        }

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return false;

        const context = audioContextRef.current || new AudioContextCtor();
        audioContextRef.current = context;

        if (context.state === 'running') return true;
        if (!userInitiated) return false;

        try {
            await context.resume();
            return context.state === 'running';
        } catch (error) {
            if (!isAutoplayBlockedError(error)) {
                console.error('Failed to unlock default lead notification audio', error);
            }
            return false;
        }
    }, [soundSettings.enabled, soundSettings.useDefault, soundSettings.customAudioDataUrl]);

    const playLeadNotificationSound = useCallback(async ({ allowQueue = true, userInitiated = false } = {}) => {
        if (!soundSettings.enabled) {
            notificationSoundQueuedRef.current = false;
            return false;
        }

        if (userInitiated) {
            notificationInteractionReadyRef.current = true;
            await primeLeadNotificationAudio({ userInitiated: true });
        }

        if (!userInitiated && !notificationInteractionReadyRef.current) {
            if (allowQueue) notificationSoundQueuedRef.current = true;
            return false;
        }

        try {
            if (!soundSettings.useDefault && soundSettings.customAudioDataUrl) {
                const audio = audioElementRef.current || new Audio();
                audioElementRef.current = audio;
                audio.preload = 'auto';

                if (audio.src !== soundSettings.customAudioDataUrl) {
                    audio.src = soundSettings.customAudioDataUrl;
                    audio.load?.();
                }

                audio.currentTime = 0;
                await audio.play();
                notificationSoundQueuedRef.current = false;
                return true;
            }

            const unlocked = await primeLeadNotificationAudio({ userInitiated });
            if (!unlocked) {
                if (allowQueue) notificationSoundQueuedRef.current = true;
                return false;
            }

            await playDefaultNotificationSound(audioContextRef);
            notificationSoundQueuedRef.current = false;
            return true;
        } catch (error) {
            if (allowQueue && isAutoplayBlockedError(error)) {
                notificationSoundQueuedRef.current = true;
                return false;
            }

            console.error('Failed to play lead notification sound', error);
            return false;
        }
    }, [primeLeadNotificationAudio, soundSettings.enabled, soundSettings.useDefault, soundSettings.customAudioDataUrl]);

    useEffect(() => {
        if (!soundSettings.enabled) {
            notificationSoundQueuedRef.current = false;
            return;
        }

        primeLeadNotificationAudio({ userInitiated: false });
    }, [primeLeadNotificationAudio, soundSettings.enabled]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const unlockAudio = async () => {
            if (notificationInteractionReadyRef.current) return;
            notificationInteractionReadyRef.current = true;
            await primeLeadNotificationAudio({ userInitiated: true });

            if (notificationSoundQueuedRef.current) {
                notificationSoundQueuedRef.current = false;
                window.setTimeout(() => {
                    playLeadNotificationSound({ allowQueue: false });
                }, 0);
            }
        };

        window.addEventListener('pointerdown', unlockAudio, true);
        window.addEventListener('keydown', unlockAudio, true);

        return () => {
            window.removeEventListener('pointerdown', unlockAudio, true);
            window.removeEventListener('keydown', unlockAudio, true);
        };
    }, [playLeadNotificationSound, primeLeadNotificationAudio]);

    const reloadSettings = useCallback(async () => {
        try {
            const [staffResponse, tagRuleResponse, statusResponse] = await Promise.all([
                leadApi.getStaffs(),
                leadApi.getTagRules(),
                leadApi.getStatuses(),
            ]);

            setStaffs(staffResponse.data || []);
            setTagRules(tagRuleResponse.data || []);
            setStatuses((prev) => {
                const nextStatuses = statusResponse.data || [];
                return nextStatuses.length ? nextStatuses : prev;
            });
        } catch (error) {
            console.error('Failed to reload lead settings', error);
        }
    }, []);

    const fetchLeads = useCallback(async (targetPage = pageRef.current, options = {}) => {
        const { silent = false, replaceData = true } = options;
        const requestId = ++fetchSeqRef.current;

        if (abortControllerRef.current) abortControllerRef.current.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        if (!silent) setLoading(true);

        try {
            const response = await leadApi.getAll({
                page: targetPage,
                per_page: paginationRef.current.per_page || 20,
                ...filtersRef.current,
                search: searchRef.current || undefined,
            }, controller.signal);

            if (requestId !== fetchSeqRef.current) return null;

            const payload = response.data || {};
            const nextLeads = payload.data || [];

            setPagination({
                current_page: payload.current_page || targetPage,
                last_page: payload.last_page || 1,
                per_page: payload.per_page || paginationRef.current.per_page || 20,
                total: payload.total || 0,
            });
            setStatuses(payload.statuses || []);
            setTags(payload.tags || []);
            setLatestId(payload.latest_id || 0);
            if (replaceData) setLeads(nextLeads);

            return payload;
        } catch (error) {
            if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') return null;
            console.error('Failed to fetch leads', error);
            if (!silent) showModal({ title: 'Lỗi', content: 'Không thể tải danh sách lead.', type: 'error' });
            return null;
        } finally {
            if (!silent) setLoading(false);
        }
    }, [showModal]);

    useEffect(() => {
        let isMounted = true;

        const loadLeads = async () => {
            await fetchLeads(page, { silent: false, replaceData: true });
            if (isMounted) setRealtimeReady(true);
        };

        loadLeads();

        return () => {
            isMounted = false;
        };
    }, [page, filters, debouncedQuickSearch, fetchLeads]);

    useEffect(() => {
        reloadSettings();
    }, [reloadSettings]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (notificationPanelRef.current && !notificationPanelRef.current.contains(event.target)) {
                setNotificationsOpen(false);
            }
        };

        if (notificationsOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [notificationsOpen]);

    useEffect(() => {
        if (!realtimeReady) return undefined;

        let isDisposed = false;
        let timeoutId = null;

        const scheduleNextPoll = () => {
            if (isDisposed) return;
            timeoutId = window.setTimeout(pollRealtime, 2000);
        };

        const pollRealtime = async () => {
            if (realtimeRequestInFlightRef.current) {
                scheduleNextPoll();
                return;
            }

            realtimeRequestInFlightRef.current = true;

            try {
                const response = await leadApi.realtime({ after_id: latestIdRef.current || 0 });
                if (isDisposed) return;

                const payload = response.data || {};
                const incoming = payload.items || [];
                const nextLatestId = payload.latest_id || latestIdRef.current || 0;

                if (latestIdRef.current === 0) {
                    if (nextLatestId > 0) setLatestId(nextLatestId);
                    return;
                }

                if (nextLatestId > latestIdRef.current) setLatestId(nextLatestId);
                if (!incoming.length) return;

                let newlyQueued = [];
                setUnreadNotifications((prev) => {
                    const prevIds = new Set(prev.map((lead) => lead.id));
                    newlyQueued = incoming.filter((lead) => !prevIds.has(lead.id));
                    return mergeNotificationItems(newlyQueued, prev);
                });

                if (newlyQueued.length === 0) {
                    return;
                }

                playLeadNotificationSound();
                showToast({
                    message: newlyQueued.length === 1
                        ? 'Có 1 lead mới vừa vào bảng xử lý.'
                        : `Có ${newlyQueued.length} lead mới vừa vào bảng xử lý.`,
                    type: 'info',
                    duration: 2500,
                });

                const activePage = pageRef.current;
                const activeFilters = filtersRef.current;
                const activeSearch = searchRef.current;
                const matchedIncoming = newlyQueued.filter((lead) => leadMatchesFilters(lead, activeFilters, activeSearch));

                if (activePage === 1 && matchedIncoming.length > 0) {
                    setLeads((prev) => mergeLeadCollections(matchedIncoming, prev, paginationRef.current.per_page || 20));
                }

                fetchLeads(activePage, { silent: true, replaceData: activePage === 1 && matchedIncoming.length === 0 });
            } catch (error) {
                console.error('Lead realtime polling failed', error);
            } finally {
                realtimeRequestInFlightRef.current = false;
                scheduleNextPoll();
            }
        };

        pollRealtime();

        return () => {
            isDisposed = true;
            realtimeRequestInFlightRef.current = false;
            if (timeoutId) window.clearTimeout(timeoutId);
        };
    }, [fetchLeads, playLeadNotificationSound, realtimeReady, showToast]);

    useEffect(() => {
        if (!pendingFocusLeadId) return;
        if (focusLeadRow(pendingFocusLeadId)) setPendingFocusLeadId(null);
    }, [focusLeadRow, leads, pendingFocusLeadId]);

    useEffect(() => () => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    }, []);

    const handleApplyFilters = () => {
        setPage(1);
        setFilters(draftFilters);
    };

    const handleResetFilters = useCallback(() => {
        setDraftFilters(emptyFilters);
        setFilters(emptyFilters);
        setPage(1);
    }, []);

    const handleStatusTabClick = (statusId) => {
        const nextFilters = { ...filtersRef.current, status: statusId ? String(statusId) : '' };
        setDraftFilters(nextFilters);
        setFilters(nextFilters);
        setPage(1);
    };

    const handleRefresh = () => {
        fetchLeads(pageRef.current, { silent: false, replaceData: true });
    };

    const handleLeadStatusChange = async (lead, nextStatusId) => {
        try {
            const response = await leadApi.update(lead.id, { lead_status_id: Number(nextStatusId) });
            const updatedLead = response.data;
            setLeads((prev) => prev.map((item) => (item.id === lead.id ? updatedLead : item)));
            setUnreadNotifications((prev) => prev.filter((item) => item.id !== lead.id));
            fetchLeads(pageRef.current, { silent: true, replaceData: false });
            showToast({ message: 'Đã cập nhật trạng thái lead.', type: 'success', duration: 1500 });
        } catch (error) {
            console.error('Failed to update lead status', error);
            showModal({ title: 'Lỗi', content: 'Không thể cập nhật trạng thái lead.', type: 'error' });
        }
    };

    const handleOpenOrderForm = (lead) => {
        if (lead?.status_config?.blocks_order_create) {
            showModal({ title: 'Không thể tạo đơn', content: 'Trạng thái hiện tại của lead đang chặn thao tác tạo đơn.', type: 'warning' });
            return;
        }

        const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
        setUnreadNotifications((prev) => prev.filter((item) => item.id !== lead.id));
        navigate(`/admin/orders/new?lead_id=${lead.id}&return_to=${returnTo}`);
    };

    const handleNotificationItemClick = (lead) => {
        setNotificationsOpen(false);
        setUnreadNotifications((prev) => prev.filter((item) => item.id !== lead.id));

        const existsInCurrentPage = leadsRef.current.some((item) => item.id === lead.id);
        if (pageRef.current !== 1 || !existsInCurrentPage) {
            setPendingFocusLeadId(lead.id);
            setPage(1);
            return;
        }

        focusLeadRow(lead.id);
    };

    const handleNoteSaved = (savedNote) => {
        setLeads((prev) => prev.map((lead) => (
            lead.id === notesLead?.id
                ? { ...lead, latest_note_excerpt: savedNote.latest_note_excerpt || savedNote.content }
                : lead
        )));
    };

    const handleToggleBundle = (bundleKey) => {
        setExpandedBundleIds((prev) => {
            const next = new Set(prev);
            if (next.has(bundleKey)) next.delete(bundleKey);
            else next.add(bundleKey);
            return next;
        });
    };

    const normalizedTabItems = useMemo(() => ([
        { id: '', label: 'Tất cả', count: totalAcrossStatuses },
        ...statuses.map((status) => ({
            id: String(status.id),
            label: formatStatusLabel(status.name, status.code),
            count: Number(status.count || 0),
        })),
    ]), [statuses, totalAcrossStatuses]);

    const renderLeadTableCell = useCallback((lead, columnId) => {
        switch (columnId) {
        case 'placed_at':
            return (
                <div className="text-[13px] text-[#0F172A]">
                    <div>{lead.placed_date || '-'}</div>
                    <div className="mt-1 font-semibold text-primary/60">{lead.placed_time || '-'}</div>
                    {lead.order_number ? (
                        <div className="mt-2 truncate text-[11px] font-bold text-primary/45" title={lead.order_number}>{lead.order_number}</div>
                    ) : null}
                </div>
            );
        case 'product':
            return <CompactProductCell lead={lead} expandedBundleIds={expandedBundleIds} onToggleBundle={handleToggleBundle} />;
        case 'customer_name':
            return <div className="truncate text-[13px] font-semibold text-[#0F172A]" title={lead.customer_name || 'Khách chưa có tên'}>{lead.customer_name || 'Khách chưa có tên'}</div>;
        case 'phone':
            return <div className="truncate text-[13px] font-semibold text-[#0F172A]" title={lead.phone || '-'}>{lead.phone || '-'}</div>;
        case 'address':
            return <div className="text-[13px] leading-5 text-[#0F172A]" title={lead.address || '-'}>{lead.address || '-'}</div>;
        case 'tag':
            return <span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-bold text-primary">{lead.tag || 'Website'}</span>;
        case 'status':
            return (
                <select
                    value={lead.status_config?.id || ''}
                    title={formatStatusLabel(lead.status_config?.name || lead.status, lead.status_config?.code)}
                    onChange={(event) => handleLeadStatusChange(lead, event.target.value)}
                    className={`${inputClassName} w-full min-w-0 max-w-full`}
                >
                    {statuses.map((status) => (
                        <option key={status.id} value={status.id}>{formatStatusLabel(status.name, status.code)}</option>
                    ))}
                </select>
            );
        case 'notes':
            return (
                <button type="button" onClick={() => setNotesLead(lead)} className="w-full text-left">
                    <div className="text-[12px] font-bold text-primary">Chi tiết</div>
                    <div className="mt-1 truncate text-[13px] text-primary/60" title={lead.latest_note_excerpt || 'Chưa có ghi chú'}>
                        {lead.latest_note_excerpt || 'Chưa có ghi chú'}
                    </div>
                </button>
            );
        case 'link':
            return lead.link_url ? (
                <a
                    href={lead.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-bold text-primary transition-all hover:text-brick"
                    title="Mở link"
                >
                    Mở
                    <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                </a>
            ) : <span className="text-[13px] text-primary/40">Không có link</span>;
        default:
            return null;
        }
    }, [expandedBundleIds, statuses]);

    const renderLeadTable = () => (
        <div className="lead-table-scrollbar min-h-0 flex-1 overflow-auto">
            <table className="min-h-full table-fixed border-collapse" style={{ width: `${leadTableWidth}px`, minWidth: '100%' }}>
                <thead>
                    <tr className="lead-table-head sticky top-0 z-10 border-b border-primary/10 text-left shadow-sm">
                        {renderedColumns.map((column, index) => (
                            <th
                                key={column.id}
                                draggable
                                onDragStart={(event) => handleHeaderDragStart(event, index)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleHeaderDrop(event, index)}
                                className="group relative border-r border-primary/10 px-4 py-3 text-[12px] font-bold text-primary last:border-r-0"
                                style={{ width: columnWidths[column.id] || column.minWidth, minWidth: columnWidths[column.id] || column.minWidth, maxWidth: columnWidths[column.id] || column.minWidth }}
                                title="Kéo để đổi vị trí cột"
                            >
                                <div className="truncate pr-4">{column.label}</div>
                                <span
                                    onMouseDown={(event) => handleColumnResize(column.id, event)}
                                    className="group/resize absolute right-[-4px] top-0 z-20 flex h-full w-2.5 cursor-col-resize items-center justify-center"
                                    title="Kéo để đổi độ rộng cột"
                                >
                                    <span
                                        className={`pointer-events-none block w-px rounded-full bg-primary/45 transition-all ${
                                            resizingColumnId === column.id
                                                ? 'h-10 opacity-100 bg-primary/70'
                                                : 'h-6 opacity-0 group-hover/resize:h-8 group-hover/resize:opacity-100'
                                        }`}
                                    />
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr>
                            <td colSpan={renderedColumns.length || 1} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55" style={{ height: 'calc(100vh - 430px)' }}>
                                Đang tải danh sách lead...
                            </td>
                        </tr>
                    ) : leads.length === 0 ? (
                        <tr>
                            <td colSpan={renderedColumns.length || 1} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55" style={{ height: 'calc(100vh - 430px)' }}>
                                Không tìm thấy lead phù hợp với bộ lọc hiện tại.
                            </td>
                        </tr>
                    ) : leads.map((lead) => {
                        const detailKey = getLeadDetailKey(lead.id);
                        const isExpanded = expandedBundleIds.has(detailKey);
                        const highlightClass = highlightedLeadId === lead.id ? 'bg-amber-50' : 'bg-white hover:bg-primary/[0.025]';

                        return (
                            <React.Fragment key={lead.id}>
                                <tr
                                    id={`lead-row-${lead.id}`}
                                    className={`align-top transition-all ${highlightClass} ${isExpanded ? '' : 'border-b border-primary/10'}`}
                                    onDoubleClick={() => handleOpenOrderForm(lead)}
                                >
                                    {renderedColumns.map((column) => (
                                        <td
                                            key={`${lead.id}-${column.id}`}
                                            className="overflow-hidden px-4 py-3 align-top text-[13px]"
                                            style={{ width: columnWidths[column.id] || column.minWidth, minWidth: columnWidths[column.id] || column.minWidth, maxWidth: columnWidths[column.id] || column.minWidth }}
                                        >
                                            {renderLeadTableCell(lead, column.id)}
                                        </td>
                                    ))}
                                </tr>

                                {isExpanded && hasExpandableProductDetails(lead) ? (
                                    <tr className={`border-b border-primary/10 ${highlightedLeadId === lead.id ? 'bg-amber-50' : 'bg-[#FCFDFE]'}`}>
                                        <td id={`lead-product-details-${lead.id}`} colSpan={renderedColumns.length || 1} className="px-4 pb-4 pt-0">
                                            <LeadExpandedProductsPanel
                                                lead={lead}
                                                onCollapse={() => handleToggleBundle(detailKey)}
                                            />
                                        </td>
                                    </tr>
                                ) : null}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );

    const tabItems = useMemo(() => ([
        { id: '', label: 'Tất cả', count: totalAcrossStatuses },
        ...statuses.map((status) => ({ id: String(status.id), label: status.name, count: Number(status.count || 0) })),
    ]), [statuses, totalAcrossStatuses]);

    return (
        <div className="min-h-screen bg-[#fcfcfa] p-6">
            <style>{`
                .lead-table-scrollbar::-webkit-scrollbar { width: 10px; height: 10px; }
                .lead-table-scrollbar::-webkit-scrollbar-track { background: #F0F4F8; }
                .lead-table-scrollbar::-webkit-scrollbar-thumb { background: #1B365D; border: 2px solid #F0F4F8; border-radius: 5px; }
                .lead-table-head { font-size: 11px; font-weight: 900; color: #1B365D; letter-spacing: 0.02em; background-color: #F0F4F8; }
            `}</style>
            <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-[1700px] flex-col gap-5">
                <div>
                    <h1 className="text-[15px] font-black uppercase tracking-[0.1em] text-primary">Xử lý lead</h1>
                </div>

                <div className="flex flex-wrap gap-3">
                    {normalizedTabItems.map((item) => {
                        const active = String(filters.status || '') === String(item.id || '');
                        return (
                            <button
                                key={String(item.id || 'all')}
                                type="button"
                                onClick={() => handleStatusTabClick(item.id)}
                                className={`rounded-full border px-4 py-2.5 text-[13px] font-bold transition-all ${
                                    active
                                        ? 'border-primary bg-primary text-white shadow-sm'
                                        : 'border-primary/10 bg-white text-primary/70 hover:border-primary/25 hover:text-primary'
                                }`}
                            >
                                {item.label} ({item.count})
                            </button>
                        );
                    })}
                </div>

                <div className="flex min-h-[calc(100vh-250px)] flex-1 flex-col overflow-hidden rounded-md border border-primary/10 bg-white shadow-xl">
                    <div className="flex flex-col gap-3 border-b border-primary/10 bg-[#F8FAFC] px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
                            <div className="relative" ref={notificationPanelRef}>
                                <button
                                    type="button"
                                    onClick={() => setNotificationsOpen((prev) => !prev)}
                                    className={iconButtonClassName}
                                    title="Thông báo lead mới"
                                >
                                    <span className="material-symbols-outlined text-[20px]">notifications</span>
                                    {unreadNotificationCount > 0 ? (
                                        <span className="absolute -right-1 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-brick px-1.5 py-0.5 text-[10px] font-black text-white">
                                            {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                                        </span>
                                    ) : null}
                                </button>

                                {notificationsOpen ? (
                                    <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[380px] rounded-sm border border-primary/10 bg-white shadow-2xl">
                                        <div className="flex items-center justify-between border-b border-primary/10 px-4 py-3">
                                            <div>
                                                <div className="text-[13px] font-black uppercase tracking-[0.08em] text-primary">Lead mới về</div>
                                                <div className="text-[12px] text-primary/55">Badge sẽ tự xóa khi bạn đánh dấu đã xem.</div>
                                            </div>
                                            <button type="button" onClick={() => setUnreadNotifications([])} className="text-[12px] font-bold text-primary hover:text-brick">
                                                Đã xem
                                            </button>
                                        </div>

                                        <div className="max-h-[360px] overflow-y-auto">
                                            {unreadNotifications.length === 0 ? (
                                                <div className="px-4 py-6 text-center text-[13px] text-primary/55">Chưa có lead mới.</div>
                                            ) : unreadNotifications.map((lead) => (
                                                <button
                                                    key={lead.id}
                                                    type="button"
                                                    onClick={() => handleNotificationItemClick(lead)}
                                                    className="flex w-full items-start justify-between gap-3 border-b border-primary/10 px-4 py-3 text-left transition-all last:border-b-0 hover:bg-primary/[0.04]"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-[13px] font-bold text-[#0F172A]">{lead.customer_name || 'Khách chưa có tên'}</div>
                                                        <div className="mt-1 text-[12px] text-primary/60">{lead.phone || 'Chưa có số điện thoại'}</div>
                                                        <div className="mt-1 truncate text-[12px] text-primary/50">{getLeadProductSummary(lead) || 'Không có sản phẩm'}</div>
                                                    </div>
                                                    <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary/45">
                                                        {lead.placed_time || lead.placed_date || 'Mới'}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-3 border-t border-primary/10 bg-[#F8FAFC] px-4 py-4">
                                            <button
                                                type="button"
                                                onClick={() => setSoundSettingsOpen((prev) => !prev)}
                                                className="flex w-full items-center justify-between text-left"
                                            >
                                                <div>
                                                    <div className="text-[12px] font-black uppercase tracking-[0.08em] text-primary">Âm thanh thông báo</div>
                                                    <div className="text-[12px] text-primary/55">
                                                        {soundSettings.enabled ? (soundSettings.useDefault ? 'Đang dùng âm mặc định' : 'Đang dùng file tùy chọn') : 'Đang tắt âm thanh'}
                                                    </div>
                                                </div>
                                                <span className="material-symbols-outlined text-[18px] text-primary/45">{soundSettingsOpen ? 'expand_less' : 'expand_more'}</span>
                                            </button>

                                            {soundSettingsOpen ? (
                                                <div className="space-y-3">
                                                    <label className="flex items-center gap-2 text-[13px] text-[#0F172A]">
                                                        <input
                                                            type="checkbox"
                                                            checked={soundSettings.enabled}
                                                            onChange={(event) => setSoundSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
                                                        />
                                                        Bật âm thanh khi có lead mới
                                                    </label>

                                                    <div className="flex flex-wrap gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSoundSettings((prev) => ({ ...prev, useDefault: true }))}
                                                            className={buttonClassName}
                                                        >
                                                            Dùng âm mặc định
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => playLeadNotificationSound({ allowQueue: false, userInitiated: true })}
                                                            className={buttonClassName}
                                                        >
                                                            Phát thử
                                                        </button>

                                                        {!soundSettings.useDefault && soundSettings.customAudioDataUrl ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => setSoundSettings((prev) => ({
                                                                    ...prev,
                                                                    useDefault: true,
                                                                    customAudioDataUrl: '',
                                                                }))}
                                                                className={buttonClassName}
                                                            >
                                                                Xóa file
                                                            </button>
                                                        ) : null}
                                                    </div>

                                                    <label className="block">
                                                        <span className="mb-1 block text-[11px] font-black uppercase tracking-[0.08em] text-primary/55">Chọn file âm thanh</span>
                                                        <input
                                                            type="file"
                                                            accept="audio/*"
                                                            className={`${inputClassName} h-auto py-2`}
                                                            onChange={(event) => {
                                                                const file = event.target.files?.[0];
                                                                if (!file) return;

                                                                const reader = new FileReader();
                                                                reader.onload = () => {
                                                                    setSoundSettings({
                                                                        enabled: true,
                                                                        useDefault: false,
                                                                        customAudioDataUrl: typeof reader.result === 'string' ? reader.result : '',
                                                                    });
                                                                };
                                                                reader.readAsDataURL(file);
                                                            }}
                                                        />
                                                        <span className="mt-2 block text-[12px] text-primary/55">
                                                            {soundSettings.useDefault || !soundSettings.customAudioDataUrl
                                                                ? 'Chưa chọn file âm thanh riêng.'
                                                                : 'Đã lưu file âm thanh tùy chọn cho chuông lead.'}
                                                        </span>
                                                    </label>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <button type="button" onClick={() => setFiltersOpen((prev) => !prev)} className={iconButtonClassName} title="Bộ lọc">
                                <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                            </button>

                            <button type="button" onClick={() => setColumnPanelOpen((prev) => !prev)} className={iconButtonClassName} title="Ẩn / hiện cột">
                                <span className="material-symbols-outlined text-[18px]">view_column</span>
                            </button>

                            <button type="button" onClick={() => setSettingsOpen(true)} className={iconButtonClassName} title="Cài đặt lead">
                                <span className="material-symbols-outlined text-[18px]">settings</span>
                            </button>

                            <button type="button" onClick={handleRefresh} className={iconButtonClassName} title="Làm mới">
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                            </button>
                        </div>

                        <div className="w-full xl:min-w-0 xl:flex-1">
                            <div className="relative">
                                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                <input
                                    value={quickSearch}
                                    onChange={(event) => {
                                        setQuickSearch(event.target.value);
                                        setPage(1);
                                    }}
                                    className={`${inputClassName} pl-10`}
                                    placeholder="Tìm nhanh theo tên khách, SĐT, địa chỉ, mã đơn, ghi chú, tên sản phẩm, mã sản phẩm..."
                                />
                            </div>
                        </div>
                    </div>

                    {filtersOpen ? (
                        <FilterPanel
                            filters={filters}
                            draftFilters={draftFilters}
                            statuses={statuses}
                            tags={tags}
                            onDraftChange={setDraftFilters}
                            onApply={handleApplyFilters}
                            onReset={handleResetFilters}
                        />
                    ) : null}

                    {columnPanelOpen ? (
                        <LeadColumnVisibilityPanel
                            availableColumns={availableColumns}
                            visibleColumns={visibleColumns}
                            toggleColumn={toggleColumn}
                            resetDefault={resetDefault}
                            saveAsDefault={saveAsDefault}
                            onClose={() => setColumnPanelOpen(false)}
                        />
                    ) : null}

                    {renderLeadTable()}

                    {false ? (
                    <div className="lead-table-scrollbar min-h-0 flex-1 overflow-auto">
                        <table className="min-h-full min-w-full table-fixed border-collapse">
                            <thead>
                                <tr className="lead-table-head sticky top-0 z-10 border-b border-primary/10 text-left shadow-sm">
                                    <th className="px-4 py-4">Thời gian đặt</th>
                                    <th className="px-4 py-4">Sản phẩm</th>
                                    <th className="px-4 py-4">Tên khách hàng</th>
                                    <th className="px-4 py-4">Số điện thoại</th>
                                    <th className="px-4 py-4">Địa chỉ</th>
                                    <th className="px-4 py-4">Tag</th>
                                    <th className="px-4 py-4">Trạng thái đơn</th>
                                    <th className="px-4 py-4">Ghi chú</th>
                                    <th className="px-4 py-4">Link</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55" style={{ height: 'calc(100vh - 430px)' }}>
                                            Đang tải danh sách lead...
                                        </td>
                                    </tr>
                                ) : leads.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-14 text-center text-[13px] font-semibold text-primary/55" style={{ height: 'calc(100vh - 430px)' }}>
                                            Không tìm thấy lead phù hợp với bộ lọc hiện tại.
                                        </td>
                                    </tr>
                                ) : leads.map((lead) => (
                                    <tr
                                        key={lead.id}
                                        id={`lead-row-${lead.id}`}
                                        className={`border-b border-primary/10 align-top transition-all ${
                                            highlightedLeadId === lead.id ? 'bg-amber-50' : 'bg-white hover:bg-primary/[0.025]'
                                        }`}
                                        onDoubleClick={() => handleOpenOrderForm(lead)}
                                    >
                                        <td className="px-4 py-4 text-[13px] text-[#0F172A]">
                                            <div>{lead.placed_date || '-'}</div>
                                            <div className="mt-1 font-semibold text-primary/60">{lead.placed_time || '-'}</div>
                                            {lead.order_number ? (
                                                <div className="mt-2 text-[11px] font-black uppercase tracking-[0.08em] text-primary/40">{lead.order_number}</div>
                                            ) : null}
                                        </td>
                                        <td className="px-4 py-4">
                                            <ProductCell lead={lead} expandedBundleIds={expandedBundleIds} onToggleBundle={handleToggleBundle} />
                                        </td>
                                        <td className="px-4 py-4 text-[13px] font-semibold text-[#0F172A]">{lead.customer_name || 'Khách chưa có tên'}</td>
                                        <td className="px-4 py-4 text-[13px] font-semibold text-[#0F172A]">{lead.phone || '-'}</td>
                                        <td className="px-4 py-4 text-[13px] text-[#0F172A]">{lead.address || '-'}</td>
                                        <td className="px-4 py-4">
                                            <span className="inline-flex rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-primary">
                                                {lead.tag || 'Website'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <select
                                                value={lead.status_config?.id || ''}
                                                onChange={(event) => handleLeadStatusChange(lead, event.target.value)}
                                                className={`${inputClassName} min-w-[190px]`}
                                            >
                                                {statuses.map((status) => (
                                                    <option key={status.id} value={status.id}>{status.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="px-4 py-4">
                                            <button type="button" onClick={() => setNotesLead(lead)} className="text-left">
                                                <div className="text-[12px] font-black uppercase tracking-[0.08em] text-primary">Chi tiết</div>
                                                <div className="mt-1 max-w-[220px] truncate text-[13px] text-primary/60">{lead.latest_note_excerpt || 'Chưa có ghi chú'}</div>
                                            </button>
                                        </td>
                                        <td className="px-4 py-4">
                                            {lead.link_url ? (
                                                <a
                                                    href={lead.link_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-1 text-[12px] font-black uppercase tracking-[0.08em] text-primary transition-all hover:text-brick"
                                                >
                                                    Mở link
                                                    <span className="material-symbols-outlined text-[17px]">open_in_new</span>
                                                </a>
                                            ) : (
                                                <span className="text-[13px] text-primary/40">Không có link</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    ) : null}

                    <div className="flex flex-col gap-4 border-t border-primary/10 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="text-[13px] font-semibold text-primary/60">
                            Tổng giá trị lead đang xem: <span className="font-black text-primary">{formatMoney(leads.reduce((sum, lead) => sum + Number(lead.total_amount || 0), 0))}</span>
                        </div>
                        <div className="flex flex-col items-start gap-3 md:items-end">
                            <div className="text-[13px] font-semibold text-primary/60">
                                Tổng số đơn: <span className="font-black text-primary">{pagination.total || 0}</span>
                            </div>
                            <Pagination pagination={pagination} onPageChange={(nextPage) => setPage(nextPage)} />
                        </div>
                    </div>
                </div>
            </div>

            {notesLead ? (
                <NotesModal
                    lead={notesLead}
                    onClose={() => setNotesLead(null)}
                    onSaved={handleNoteSaved}
                    currentUserName={user?.name || ''}
                />
            ) : null}

            <LeadSettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                statuses={statuses}
                staffs={staffs}
                tagRules={tagRules}
                onReload={async () => {
                    await reloadSettings();
                    await fetchLeads(pageRef.current, { silent: true, replaceData: true });
                }}
            />
        </div>
    );
};

export default LeadList;
