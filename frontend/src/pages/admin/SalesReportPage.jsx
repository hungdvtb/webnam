import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import { orderApi, reportApi } from '../../services/api';

const PRODUCT_COLUMN_WIDTH = 180;
const TOTAL_COLUMN_WIDTH = 150;
const DAY_COLUMN_WIDTH = 118;
const HEADER_ROW_HEIGHT = 74;
const SEARCH_HISTORY_KEY = 'daily_sales_report_search_history';

const INVENTORY_SLIP_FILTERS = [
    { key: 'export_slip_state', label: 'Phiếu xuất', options: [{ value: 'created', label: 'Đã tạo phiếu xuất' }, { value: 'missing', label: 'Chưa tạo phiếu xuất' }] },
    { key: 'return_slip_state', label: 'Phiếu hoàn', options: [{ value: 'created', label: 'Đã tạo phiếu hoàn' }, { value: 'missing', label: 'Chưa tạo phiếu hoàn' }] },
    { key: 'damaged_slip_state', label: 'Phiếu hỏng', options: [{ value: 'created', label: 'Đã tạo phiếu hỏng' }, { value: 'missing', label: 'Chưa tạo phiếu hỏng' }] },
];

const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const formatWholeNumber = (value) => numberFormatter.format(Math.round(Number(value || 0)));

const toDateInputValue = (date) => {
    const safeDate = new Date(date);
    const offset = safeDate.getTimezoneOffset() * 60000;
    return new Date(safeDate.getTime() - offset).toISOString().slice(0, 10);
};

const getDefaultDateRange = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 6);
    return { date_from: toDateInputValue(from), date_to: toDateInputValue(to) };
};

const createDefaultFilters = () => ({
    ...getDefaultDateRange(),
    search: '',
    status: [],
    customer_name: '',
    order_number: '',
    customer_phone: '',
    created_at_from: '',
    created_at_to: '',
    shipping_carrier_code: '',
    export_slip_state: '',
    return_slip_state: '',
    damaged_slip_state: '',
    shipping_dispatched_from: '',
    shipping_dispatched_to: '',
    attributes: {},
});

const createEmptyState = () => ({
    dates: [],
    rows: [],
    summary_row: { totals: { quantity: 0, cost_amount: 0, revenue_amount: 0 }, days: {} },
    summary: { top_level_count: 0, leaf_count: 0, total_quantity: 0, total_cost_amount: 0, total_revenue_amount: 0 },
    meta: { effective_statuses: [], date_basis: 'completed_or_created' },
});

const normalizeDatePair = (fromValue, toValue) => {
    const from = String(fromValue || '').trim();
    const to = String(toValue || '').trim();
    return from && to && from > to ? { from: to, to: from } : { from, to };
};

const normalizeFilters = (rawFilters) => {
    const fallback = getDefaultDateRange();
    const reportRange = normalizeDatePair(rawFilters?.date_from || fallback.date_from, rawFilters?.date_to || fallback.date_to);
    const createdRange = normalizeDatePair(rawFilters?.created_at_from, rawFilters?.created_at_to);
    const shippingRange = normalizeDatePair(rawFilters?.shipping_dispatched_from, rawFilters?.shipping_dispatched_to);
    const status = Array.isArray(rawFilters?.status) ? rawFilters.status : String(rawFilters?.status || '').split(',');
    const attributes = Object.fromEntries(
        Object.entries(rawFilters?.attributes || {})
            .map(([key, value]) => [key, Array.from(new Set((Array.isArray(value) ? value : String(value || '').split(',')).map((item) => String(item).trim()).filter(Boolean)))])
            .filter(([, value]) => value.length > 0)
    );

    return {
        date_from: reportRange.from,
        date_to: reportRange.to,
        search: String(rawFilters?.search || ''),
        status: Array.from(new Set(status.map((item) => String(item).trim()).filter(Boolean))),
        customer_name: String(rawFilters?.customer_name || ''),
        order_number: String(rawFilters?.order_number || ''),
        customer_phone: String(rawFilters?.customer_phone || ''),
        created_at_from: createdRange.from,
        created_at_to: createdRange.to,
        shipping_carrier_code: String(rawFilters?.shipping_carrier_code || ''),
        export_slip_state: String(rawFilters?.export_slip_state || ''),
        return_slip_state: String(rawFilters?.return_slip_state || ''),
        damaged_slip_state: String(rawFilters?.damaged_slip_state || ''),
        shipping_dispatched_from: shippingRange.from,
        shipping_dispatched_to: shippingRange.to,
        attributes,
    };
};

const buildReportParams = (rawFilters) => {
    const filters = normalizeFilters(rawFilters);
    const params = { date_from: filters.date_from, date_to: filters.date_to };
    ['search', 'customer_name', 'order_number', 'customer_phone', 'created_at_from', 'created_at_to', 'shipping_carrier_code', 'export_slip_state', 'return_slip_state', 'damaged_slip_state', 'shipping_dispatched_from', 'shipping_dispatched_to']
        .forEach((key) => {
            if (String(filters[key] || '').trim()) params[key] = String(filters[key]).trim();
        });
    if (filters.status.length > 0) params.status = filters.status.join(',');
    Object.entries(filters.attributes).forEach(([attributeId, values]) => {
        if (values.length > 0) params[`attr_order_${attributeId}`] = values.join(',');
    });
    return params;
};

const countActiveAdvancedFilters = (filters) => (
    [
        filters.status.length > 0,
        Boolean(filters.customer_name.trim()),
        Boolean(filters.order_number.trim()),
        Boolean(filters.customer_phone.trim()),
        Boolean(filters.created_at_from || filters.created_at_to),
        Boolean(filters.shipping_carrier_code),
        Boolean(filters.export_slip_state),
        Boolean(filters.return_slip_state),
        Boolean(filters.damaged_slip_state),
        Boolean(filters.shipping_dispatched_from || filters.shipping_dispatched_to),
    ].filter(Boolean).length + Object.keys(filters.attributes || {}).length
);

const getMetricValues = (metric) => ({
    quantity: Number(metric?.quantity || 0),
    costAmount: Math.round(Number(metric?.cost_amount || 0)),
    revenueAmount: Math.round(Number(metric?.revenue_amount || 0)),
});

const getProductCode = (row) => String(row?.product_sku || '').trim() || (row?.product_id ? `#${row.product_id}` : 'N/A');

const FieldBox = ({ label, children }) => (
    <div className="space-y-1.5 border-b border-r border-primary/10 p-4">
        <label className="text-[13px] font-medium text-stone-600">{label}</label>
        {children}
    </div>
);

const inputClass = 'h-10 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-[#0F172A] outline-none focus:border-primary';
const selectClass = 'h-10 w-full appearance-none rounded-sm border border-primary/20 bg-white px-3 pr-8 text-[13px] font-bold text-[#0F172A] outline-none focus:border-primary';

const MetricCellContent = ({ metric, inverse = false }) => {
    const { quantity, costAmount, revenueAmount } = getMetricValues(metric);
    const quantityClass = inverse ? 'text-white' : 'text-primary';
    const amountClass = inverse ? 'text-white/75' : 'text-primary/55';
    if (!quantity && !costAmount && !revenueAmount) return <div className={`text-[12px] font-black ${quantityClass}`}>0</div>;

    return (
        <div className="space-y-0.5 leading-none">
            <div className={`text-[13px] font-black ${quantityClass}`}>{formatWholeNumber(quantity)}</div>
            <div className={`text-[10px] font-semibold ${amountClass}`}>{formatWholeNumber(costAmount)}-{formatWholeNumber(revenueAmount)}</div>
        </div>
    );
};

const ProductCodeCell = ({ row, isParent, isChild, isExpanded, onToggle }) => {
    const code = getProductCode(row);
    const name = String(row?.product_name || '').trim() || code;
    const hasChildren = Array.isArray(row.children) && row.children.length > 0;
    const textClass = isParent ? 'text-primary' : isChild ? 'text-primary/75' : 'text-primary/90 hover:text-gold';

    return (
        <div className={`flex min-w-0 items-center gap-2 ${isChild ? 'pl-4' : ''}`}>
            {isParent && hasChildren ? (
                <button type="button" onClick={onToggle} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary/65 hover:border-primary/30 hover:text-primary" title={isExpanded ? 'Thu gọn biến thể' : 'Mở rộng biến thể'}>
                    <span className={`material-symbols-outlined text-[16px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>chevron_right</span>
                </button>
            ) : isChild ? <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/25" /> : null}
            <div className="group/sku relative min-w-0 flex-1">
                {row.product_id ? (
                    <Link to={`/admin/products/edit/${row.product_id}`} title={name} className={`block truncate text-[13px] font-black tracking-[0.05em] ${textClass}`}>{code}</Link>
                ) : (
                    <div title={name} className={`truncate text-[13px] font-black tracking-[0.05em] ${textClass}`}>{code}</div>
                )}
                {name !== code ? <div className="pointer-events-none absolute left-full top-1/2 z-[70] ml-2 hidden w-56 -translate-y-1/2 rounded-sm border border-primary/15 bg-[#0F172A] px-3 py-2 text-[11px] font-medium leading-5 text-white shadow-2xl group-hover/sku:block">{name}</div> : null}
            </div>
            {isParent && row.children_count > 0 ? <span className="shrink-0 rounded-sm border border-primary/12 bg-white px-1.5 py-0.5 text-[10px] font-black text-primary/45">+{row.children_count}</span> : null}
        </div>
    );
};

const SalesReportPage = () => {
    const { user } = useAuth();
    const searchContainerRef = useRef(null);
    const filterPanelRef = useRef(null);
    const filterButtonRef = useRef(null);
    const requestIdRef = useRef(0);
    const [filters, setFilters] = useState(() => normalizeFilters(createDefaultFilters()));
    const [tempFilters, setTempFilters] = useState(() => normalizeFilters(createDefaultFilters()));
    const [reportState, setReportState] = useState(createEmptyState());
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [expandedParents, setExpandedParents] = useState({});
    const [orderStatuses, setOrderStatuses] = useState([]);
    const [connectedCarriers, setConnectedCarriers] = useState([]);
    const [allAttributes, setAllAttributes] = useState([]);
    const [openAttrId, setOpenAttrId] = useState(null);
    const [searchHistory, setSearchHistory] = useState(() => {
        try {
            const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) setShowSearchHistory(false);
            if (!filterButtonRef.current?.contains(event.target) && !filterPanelRef.current?.contains(event.target)) setShowFilterPanel(false);
            if (!event.target.closest('[data-report-attr-dropdown]')) setOpenAttrId(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        orderApi.getBootstrap({ mode: 'list' })
            .then((response) => {
                const bootstrap = response?.data || {};
                setOrderStatuses(bootstrap.order_statuses || []);
                setConnectedCarriers(bootstrap.connected_carriers || []);
                setAllAttributes(bootstrap.order_attributes || []);
            })
            .catch((error) => console.error('Error loading report filter bootstrap', error));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => loadReport(filters), filters.search.trim() ? 320 : 0);
        return () => clearTimeout(timer);
    }, [filters]);

    const loadReport = async (nextFilters) => {
        const normalized = normalizeFilters(nextFilters);
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setErrorMessage('');

        try {
            const response = await reportApi.getProductSalesByDay(buildReportParams(normalized));
            if (requestId !== requestIdRef.current) return;
            setReportState({ ...createEmptyState(), ...(response?.data || {}) });
            if (normalized.search.trim()) addToSearchHistory(normalized.search.trim());
        } catch (error) {
            if (requestId !== requestIdRef.current) return;
            console.error('Error loading product sales by day report', error);
            setReportState(createEmptyState());
            setErrorMessage(error.response?.data?.message || 'Không thể tải báo cáo bán hàng theo ngày.');
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    };

    const addToSearchHistory = (value) => {
        if (!value) return;
        setSearchHistory((current) => {
            const next = [value, ...current.filter((item) => item !== value)].slice(0, 8);
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
            return next;
        });
    };

    const updateFilters = (patch) => {
        setFilters((current) => normalizeFilters({ ...current, ...patch }));
        setTempFilters((current) => normalizeFilters({ ...current, ...patch }));
    };

    const applyRangePreset = (daysBack) => {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - daysBack);
        updateFilters({ date_from: toDateInputValue(from), date_to: toDateInputValue(to) });
        setShowFilterPanel(false);
    };

    const resetAllFilters = () => {
        const next = normalizeFilters(createDefaultFilters());
        setFilters(next);
        setTempFilters(next);
        setShowFilterPanel(false);
        setOpenAttrId(null);
    };

    const flattenedRows = useMemo(() => {
        const rows = [];
        reportState.rows.forEach((row) => {
            rows.push({ ...row, depth: 0 });
            if (Array.isArray(row.children) && row.children.length > 0 && expandedParents[row.row_key]) {
                row.children.forEach((child) => rows.push({ ...child, depth: 1, parent_row_key: row.row_key }));
            }
        });
        return rows;
    }, [expandedParents, reportState.rows]);

    const tableWidth = useMemo(() => PRODUCT_COLUMN_WIDTH + TOTAL_COLUMN_WIDTH + ((reportState.dates?.length || 0) * DAY_COLUMN_WIDTH), [reportState.dates]);
    const activeAdvancedFilterCount = useMemo(() => countActiveAdvancedFilters(filters), [filters]);

    const clearSearchHistory = () => {
        localStorage.removeItem(SEARCH_HISTORY_KEY);
        setSearchHistory([]);
        setShowSearchHistory(false);
    };

    const removeSearchHistoryItem = (value) => {
        setSearchHistory((current) => {
            const next = current.filter((item) => item !== value);
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
            return next;
        });
    };

    const toggleParentRow = (rowKey) => setExpandedParents((current) => ({ ...current, [rowKey]: !current[rowKey] }));
    const applyAdvancedFilters = () => { setFilters(normalizeFilters(tempFilters)); setShowFilterPanel(false); setOpenAttrId(null); };
    const syncTempField = (name, value) => setTempFilters((current) => normalizeFilters({ ...current, [name]: value }));
    const toggleFilterPanel = () => setShowFilterPanel((current) => { if (!current) setTempFilters(normalizeFilters(filters)); else setOpenAttrId(null); return !current; });

    const toolbarDateFields = [
        { key: 'date_from', label: 'Từ ngày' },
        { key: 'date_to', label: 'Đến ngày' },
    ];

    return (
        <div className="space-y-4 text-[#0F172A]">
            <div className="flex justify-end">
                <AccountSelector user={user} />
            </div>

            <div className="space-y-3">
                <div className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                        <div className="flex items-center gap-2">
                            <button
                                ref={filterButtonRef}
                                type="button"
                                onClick={toggleFilterPanel}
                                className={`relative inline-flex h-11 w-11 items-center justify-center rounded-sm border transition-all ${showFilterPanel || activeAdvancedFilterCount > 0 ? 'border-primary bg-primary text-white shadow-lg' : 'border-primary/15 bg-primary/5 text-primary hover:bg-primary/10'}`}
                                title="Bộ lọc nâng cao"
                            >
                                <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                                {activeAdvancedFilterCount > 0 ? <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brick px-1 text-[10px] font-black text-white">{activeAdvancedFilterCount}</span> : null}
                            </button>
                            <button type="button" onClick={() => loadReport(filters)} className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary hover:bg-primary/5" title="Làm mới dữ liệu">
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>{loading ? 'progress_activity' : 'refresh'}</span>
                            </button>
                        </div>

                        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(150px,180px)_minmax(150px,180px)_minmax(0,1fr)]">
                            {toolbarDateFields.map((field) => (
                                <label key={field.key} className="space-y-1">
                                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/35">{field.label}</div>
                                    <input type="date" value={filters[field.key]} onChange={(event) => updateFilters({ [field.key]: event.target.value })} className="h-11 w-full rounded-sm border border-primary/15 bg-white px-3 text-[14px] font-bold text-primary outline-none focus:border-primary" />
                                </label>
                            ))}

                            <div className="space-y-1">
                                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/35">Tìm kiếm nhanh</div>
                                <div className="relative" ref={searchContainerRef}>
                                    <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">search</span>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={filters.search}
                                        onChange={(event) => updateFilters({ search: event.target.value })}
                                        onFocus={() => setShowSearchHistory(true)}
                                        onKeyDown={(event) => { if (event.key === 'Enter') { addToSearchHistory(filters.search.trim()); setShowSearchHistory(false); } }}
                                        placeholder="Tìm theo tên SP, SKU, mã đơn, khách, ghi chú..."
                                        className="h-11 w-full rounded-sm border border-primary/15 bg-primary/5 pl-10 pr-10 text-[14px] font-medium text-primary outline-none focus:border-primary"
                                    />
                                    {filters.search ? <button type="button" onClick={() => updateFilters({ search: '' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/35 hover:text-brick"><span className="material-symbols-outlined text-[18px]">cancel</span></button> : null}
                                    {showSearchHistory && searchHistory.length > 0 ? (
                                        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[70] overflow-hidden rounded-sm border border-primary/15 bg-white py-2 shadow-2xl">
                                            <div className="mb-2 flex items-center justify-between border-b border-primary/10 px-3 pb-2">
                                                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/35">Tìm kiếm gần đây</span>
                                                <button type="button" onClick={clearSearchHistory} className="text-[10px] font-bold text-brick hover:underline">Xóa tất cả</button>
                                            </div>
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                {searchHistory.map((item) => (
                                                    <div key={item} className="group flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-primary/5" onClick={() => { updateFilters({ search: item }); setShowSearchHistory(false); }}>
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                            <span className="truncate text-[13px] font-medium text-primary">{item}</span>
                                                        </div>
                                                        <button type="button" onClick={(event) => { event.stopPropagation(); removeSearchHistoryItem(item); }} className="rounded-full p-1 text-primary/30 opacity-0 hover:bg-primary/5 hover:text-brick group-hover:opacity-100">
                                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {showFilterPanel ? (
                    <div ref={filterPanelRef} className="rounded-sm border border-primary/15 bg-white p-5 shadow-2xl">
                        <div className="mb-6 flex items-start justify-between gap-4 border-b border-primary/10 pb-4">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Cấu hình bộ lọc báo cáo</div>
                                <h3 className="mt-1 text-[18px] font-black tracking-tight text-primary">Lọc giống màn quản lý đơn hàng</h3>
                                <p className="mt-2 text-[13px] leading-6 text-primary/55">Trục ngày của báo cáo lấy ngày hoàn tất nếu đơn đã chốt completed, nếu chưa thì lấy ngày tạo đơn.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button type="button" onClick={resetAllFilters} className="text-[13px] font-bold text-primary/45 hover:text-brick">Thiết lập lại</button>
                                <button type="button" onClick={applyAdvancedFilters} className="rounded-sm bg-primary px-5 py-2 text-[13px] font-bold text-white hover:bg-primary/90">Áp dụng bộ lọc</button>
                            </div>
                        </div>

                        <div className="mb-6">
                            <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Mốc ngày nhanh</div>
                            <div className="grid gap-2 sm:grid-cols-4">
                                {[{ label: 'Hôm nay', daysBack: 0 }, { label: '3 ngày', daysBack: 2 }, { label: '7 ngày', daysBack: 6 }, { label: '30 ngày', daysBack: 29 }].map((preset) => (
                                    <button key={preset.label} type="button" onClick={() => applyRangePreset(preset.daysBack)} className="rounded-sm border border-primary/12 bg-[#F8FAFC] px-3 py-3 text-left hover:border-primary/25 hover:bg-white">
                                        <div className="text-[13px] font-black text-primary">{preset.label}</div>
                                        <div className="mt-1 text-[12px] font-medium text-primary/50">Cập nhật dải ngày báo cáo</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 overflow-hidden rounded-sm border border-primary/10 bg-primary/[0.02] md:grid-cols-4 lg:grid-cols-5">
                            <FieldBox label="Tên khách"><input name="customer_name" type="text" value={tempFilters.customer_name} onChange={(event) => syncTempField('customer_name', event.target.value)} className={inputClass} /></FieldBox>
                            <FieldBox label="Mã đơn"><input name="order_number" type="text" value={tempFilters.order_number} onChange={(event) => syncTempField('order_number', event.target.value)} className={inputClass} /></FieldBox>
                            <FieldBox label="SĐT khách"><input name="customer_phone" type="text" value={tempFilters.customer_phone} onChange={(event) => syncTempField('customer_phone', event.target.value)} className={inputClass} /></FieldBox>
                            <FieldBox label="Trạng thái">
                                <div className="relative">
                                    <select value={tempFilters.status[0] || ''} onChange={(event) => syncTempField('status', event.target.value ? [event.target.value] : [])} className={selectClass}>
                                        <option value="">Tất cả</option>
                                        {orderStatuses.map((status) => <option key={status.id || status.code} value={status.code}>{status.name}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </FieldBox>
                            <FieldBox label="Ngày đặt">
                                <div className="flex h-10 items-center gap-2">
                                    <input type="date" value={tempFilters.created_at_from} onChange={(event) => syncTempField('created_at_from', event.target.value)} className="h-full flex-1 rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] outline-none focus:border-primary" />
                                    <span className="text-primary/20">-</span>
                                    <input type="date" value={tempFilters.created_at_to} onChange={(event) => syncTempField('created_at_to', event.target.value)} className="h-full flex-1 rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] outline-none focus:border-primary" />
                                </div>
                            </FieldBox>
                            <FieldBox label="Đơn vị vận chuyển">
                                <div className="relative">
                                    <select value={tempFilters.shipping_carrier_code} onChange={(event) => syncTempField('shipping_carrier_code', event.target.value)} className={selectClass}>
                                        <option value="">Tất cả</option>
                                        {connectedCarriers.map((carrier) => <option key={carrier.carrier_code} value={carrier.carrier_code}>{carrier.carrier_name}</option>)}
                                    </select>
                                    <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                </div>
                            </FieldBox>
                            {INVENTORY_SLIP_FILTERS.map(({ key, label, options }) => (
                                <FieldBox key={key} label={label}>
                                    <div className="relative">
                                        <select value={tempFilters[key]} onChange={(event) => syncTempField(key, event.target.value)} className={selectClass}>
                                            <option value="">Tất cả</option>
                                            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                        <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-primary/30">expand_more</span>
                                    </div>
                                </FieldBox>
                            ))}
                            <FieldBox label="Ngày gửi vận chuyển">
                                <div className="flex h-10 items-center gap-2">
                                    <input type="date" value={tempFilters.shipping_dispatched_from} onChange={(event) => syncTempField('shipping_dispatched_from', event.target.value)} className="h-full flex-1 rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] outline-none focus:border-primary" />
                                    <span className="text-primary/20">-</span>
                                    <input type="date" value={tempFilters.shipping_dispatched_to} onChange={(event) => syncTempField('shipping_dispatched_to', event.target.value)} className="h-full flex-1 rounded-sm border border-primary/10 bg-white px-2 text-[13px] font-bold text-[#0F172A] outline-none focus:border-primary" />
                                </div>
                            </FieldBox>
                        </div>

                        {allAttributes.length > 0 ? (
                            <div className="mt-8 border-t border-primary/10 pt-6">
                                <h5 className="mb-4 text-[15px] font-bold text-[#0F172A]">Lọc theo thuộc tính</h5>
                                <div className="grid grid-cols-1 rounded-sm border border-primary/10 bg-primary/[0.02] md:grid-cols-4 lg:grid-cols-5">
                                    {allAttributes.map((attribute) => {
                                        const selectedValues = tempFilters.attributes?.[attribute.id] || [];
                                        return (
                                            <div key={attribute.id} className="relative space-y-2.5 border-b border-r border-primary/10 p-4">
                                                <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">{attribute.name}</label>
                                                <div className="relative" data-report-attr-dropdown>
                                                    <button type="button" onClick={() => setOpenAttrId(openAttrId === attribute.id ? null : attribute.id)} className={`flex h-10 w-full items-center rounded-sm border bg-white px-3 pr-8 text-left ${openAttrId === attribute.id ? 'border-primary shadow-inner ring-1 ring-primary/5' : 'border-primary/20 shadow-sm hover:border-primary/40'}`}>
                                                        <span className="truncate text-[13px] font-bold text-primary">{selectedValues.length > 0 ? `${attribute.name}: ${selectedValues.length}` : `Chọn ${attribute.name}...`}</span>
                                                        <span className={`material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-primary/30 transition-transform ${openAttrId === attribute.id ? 'rotate-180' : ''}`}>expand_more</span>
                                                    </button>
                                                    {openAttrId === attribute.id ? (
                                                        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[80] min-w-[200px] rounded-sm border border-primary/30 bg-white py-1.5 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)]">
                                                            <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                                                {selectedValues.length > 0 ? <button type="button" className="mb-1 flex w-full items-center gap-2 border-b border-primary/5 px-3 py-2 text-left text-[11px] font-black uppercase tracking-widest text-brick hover:bg-brick/5" onClick={(event) => { event.stopPropagation(); setTempFilters((current) => normalizeFilters({ ...current, attributes: { ...current.attributes, [attribute.id]: [] } })); }}><span className="material-symbols-outlined text-[16px]">backspace</span>Xóa các mục đã chọn</button> : null}
                                                                {attribute.options?.length > 0 ? attribute.options.map((option) => (
                                                                    <label key={option.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-primary/5" onClick={(event) => event.stopPropagation()}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={selectedValues.includes(option.value)}
                                                                            onChange={() => setTempFilters((current) => {
                                                                                const values = current.attributes?.[attribute.id] || [];
                                                                                const nextValues = values.includes(option.value) ? values.filter((item) => item !== option.value) : [...values, option.value];
                                                                                return normalizeFilters({ ...current, attributes: { ...current.attributes, [attribute.id]: nextValues } });
                                                                            })}
                                                                            className="h-4 w-4 cursor-pointer rounded-sm border-2 border-primary/20 accent-primary"
                                                                        />
                                                                        <span className={`text-[13px] ${selectedValues.includes(option.value) ? 'font-bold text-primary' : 'text-stone-600'}`}>{option.value}</span>
                                                                    </label>
                                                                )) : <div className="px-4 py-6 text-center text-[12px] italic text-stone-400">Không có dữ liệu</div>}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-xl">
                {errorMessage ? <div className="border-b border-primary/10 bg-brick/5 px-5 py-4 text-[13px] font-bold text-brick">{errorMessage}</div> : null}
                <div className="relative max-h-[calc(100vh-230px)] min-h-[460px] overflow-auto table-scrollbar">
                    <table className="border-collapse text-left" style={{ width: `${tableWidth}px`, minWidth: `${tableWidth}px` }}>
                        <thead className="sticky top-0 z-40 bg-[#F8FAFC] shadow-sm">
                            <tr>
                                <th className="sticky left-0 z-50 h-[74px] border-b border-r border-primary/10 bg-[#F8FAFC] px-3 py-2 align-middle" style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}><div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Mã SP</div></th>
                                <th className="sticky z-50 h-[74px] border-b border-r border-primary/10 bg-[#F8FAFC] px-3 py-2 align-middle" style={{ left: PRODUCT_COLUMN_WIDTH, width: TOTAL_COLUMN_WIDTH, minWidth: TOTAL_COLUMN_WIDTH }}><div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Tổng</div></th>
                                {reportState.dates.map((date) => (
                                    <th key={date.date} className="h-[74px] border-b border-r border-primary/10 bg-[#F8FAFC] px-3 py-2 align-middle" style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}>
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/35">Ngày</div>
                                        <div className="mt-1 text-[15px] font-black tracking-tight text-primary">{date.label}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="sticky left-0 z-30 border-b border-r border-white/10 bg-primary px-3 py-3 align-middle" style={{ top: HEADER_ROW_HEIGHT, width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}>
                                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">SL</span><span className="text-[18px] font-black text-white">{formatWholeNumber(reportState.summary?.total_quantity || 0)}</span></div>
                                </td>
                                <td className="sticky z-30 border-b border-r border-white/10 bg-primary px-3 py-3 align-middle" style={{ top: HEADER_ROW_HEIGHT, left: PRODUCT_COLUMN_WIDTH, width: TOTAL_COLUMN_WIDTH, minWidth: TOTAL_COLUMN_WIDTH }}><MetricCellContent metric={reportState.summary_row?.totals} inverse /></td>
                                {reportState.dates.map((date) => <td key={`summary-${date.date}`} className="sticky z-20 border-b border-r border-white/10 bg-primary px-3 py-3 align-middle" style={{ top: HEADER_ROW_HEIGHT, width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}><MetricCellContent metric={reportState.summary_row?.days?.[date.date]} inverse /></td>)}
                            </tr>
                            {flattenedRows.length === 0 && !loading ? (
                                <tr>
                                    <td colSpan={2 + reportState.dates.length} className="px-6 py-20 text-center">
                                        <div className="mx-auto max-w-xl space-y-3">
                                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/5 text-primary/30"><span className="material-symbols-outlined text-[36px]">table_chart</span></div>
                                            <h3 className="text-[22px] font-black text-primary">Chưa có dữ liệu trong khoảng lọc này</h3>
                                            <p className="text-[14px] leading-6 text-primary/55">Thử đổi khoảng ngày hoặc nới bộ lọc để xem thêm kết quả.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : null}
                            {flattenedRows.map((row) => {
                                const isParent = row.row_type === 'parent';
                                const isChild = row.depth > 0;
                                const isExpanded = Boolean(expandedParents[row.row_key]);
                                const rowTone = isParent ? 'bg-[#F4F7FF]' : isChild ? 'bg-[#FBFCFF]' : 'bg-white';
                                return (
                                    <tr key={row.parent_row_key ? `${row.parent_row_key}-${row.row_key}` : row.row_key} className={`${rowTone} border-b border-primary/10`}>
                                        <td className={`sticky left-0 z-10 border-r border-primary/10 px-3 py-2.5 align-middle ${rowTone}`} style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}>
                                            <ProductCodeCell row={row} isParent={isParent} isChild={isChild} isExpanded={isExpanded} onToggle={() => toggleParentRow(row.row_key)} />
                                        </td>
                                        <td className={`sticky z-10 border-r border-primary/10 px-3 py-2.5 align-middle ${rowTone}`} style={{ left: PRODUCT_COLUMN_WIDTH, width: TOTAL_COLUMN_WIDTH, minWidth: TOTAL_COLUMN_WIDTH }}><MetricCellContent metric={row.totals} /></td>
                                        {reportState.dates.map((date) => <td key={`${row.row_key}-${date.date}`} className="border-r border-primary/10 px-3 py-2.5 align-middle" style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}><MetricCellContent metric={row.days?.[date.date]} /></td>)}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {loading ? (
                        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                            <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-3 shadow-xl">
                                <div className="h-6 w-6 animate-refresh-spin rounded-full border-4 border-primary/10 border-t-primary" />
                                <span className="text-[13px] font-black uppercase tracking-[0.16em] text-primary">Đang tính bảng</span>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default SalesReportPage;
