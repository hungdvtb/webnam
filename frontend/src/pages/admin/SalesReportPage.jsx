import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import Pagination from '../../components/Pagination';
import { ACTIVE_PRODUCT_TYPE_OPTIONS as productTypeOptions, PRODUCT_TYPE_LABELS } from '../../config/productTypes';
import { categoryApi, orderStatusApi, reportApi, warehouseApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const PRODUCT_COLUMN_WIDTH = 320;
const TOTAL_COLUMN_WIDTH = 228;
const DAY_COLUMN_WIDTH = 208;

const moneyFormatter = new Intl.NumberFormat('vi-VN');
const integerFormatter = new Intl.NumberFormat('vi-VN');

const invalidStatusKeywords = [
    'cancel',
    'canceled',
    'cancelled',
    'return',
    'returned',
    'returning',
    'pending return',
    'pending_return',
    'draft',
    'nhap',
    'huy',
    'hoan',
    'void',
];

const toLocalDateInput = (date) => {
    const safeDate = new Date(date);
    const tzOffset = safeDate.getTimezoneOffset() * 60000;

    return new Date(safeDate.getTime() - tzOffset).toISOString().slice(0, 10);
};

const getDefaultDateRange = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 6);

    return {
        date_from: toLocalDateInput(from),
        date_to: toLocalDateInput(to),
    };
};

const getDefaultFilters = () => ({
    ...getDefaultDateRange(),
    search: '',
    category_ids: [],
    product_types: [],
    warehouse_ids: [],
    status: [],
    per_page: 20,
});

const getEmptyReportState = () => ({
    dates: [],
    items: [],
    pagination: {
        current_page: 1,
        last_page: 1,
        per_page: 20,
        total: 0,
        from: null,
        to: null,
    },
    summary: {
        total_products: 0,
        total_quantity: 0,
        total_net_revenue: 0,
        total_cost_amount: 0,
        range_days: 0,
    },
    totals_row: {
        label: 'Tổng tất cả sản phẩm',
        totals: {
            quantity: 0,
            net_revenue: 0,
            cost_amount: 0,
        },
        days: {},
    },
    meta: {
        effective_statuses: [],
        available_statuses: [],
    },
});

const normalizeArray = (value) => {
    if (Array.isArray(value)) {
        return value
            .flat()
            .map((item) => String(item).trim())
            .filter(Boolean);
    }

    if (value === null || value === undefined || value === '') {
        return [];
    }

    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const formatMoney = (value) => `${moneyFormatter.format(Math.round(Number(value || 0)))} đ`;
const formatInteger = (value) => integerFormatter.format(Number(value || 0));

const isInvalidStatus = (status) => {
    const haystack = `${status?.code || ''} ${status?.name || ''}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    return invalidStatusKeywords.some((keyword) => haystack.includes(keyword));
};

const sanitizeFilters = (rawFilters) => {
    const fallbackRange = getDefaultDateRange();
    let dateFrom = rawFilters?.date_from || fallbackRange.date_from;
    let dateTo = rawFilters?.date_to || fallbackRange.date_to;

    if (dateFrom && dateTo && dateFrom > dateTo) {
        [dateFrom, dateTo] = [dateTo, dateFrom];
    }

    return {
        date_from: dateFrom,
        date_to: dateTo,
        search: String(rawFilters?.search || '').trim(),
        category_ids: normalizeArray(rawFilters?.category_ids),
        product_types: normalizeArray(rawFilters?.product_types),
        warehouse_ids: normalizeArray(rawFilters?.warehouse_ids),
        status: normalizeArray(rawFilters?.status),
        per_page: Math.min(Math.max(Number(rawFilters?.per_page || 20), 10), 100),
    };
};

const mergeStatusOptions = (primaryOptions = [], fallbackOptions = []) => {
    const map = new Map();

    [...primaryOptions, ...fallbackOptions]
        .filter(Boolean)
        .forEach((option) => {
            const code = String(option.code || option.value || '').trim();
            if (!code || isInvalidStatus(option)) return;

            map.set(code, {
                code,
                name: option.name || option.label || code,
                color: option.color || null,
            });
        });

    return Array.from(map.values());
};

const SalesMetricCell = ({ metric, emphasized = false }) => {
    const safeMetric = metric || {
        quantity: 0,
        net_revenue: 0,
        cost_amount: 0,
    };
    const hasData = Number(safeMetric.quantity || 0) > 0
        || Number(safeMetric.net_revenue || 0) > 0
        || Number(safeMetric.cost_amount || 0) > 0;

    return (
        <div
            className={`rounded-sm border px-3 py-2.5 transition-colors ${
                emphasized
                    ? 'border-primary/20 bg-primary/[0.035]'
                    : hasData
                        ? 'border-primary/10 bg-white'
                        : 'border-primary/8 bg-[#F8FAFC]'
            }`}
        >
            <div className="flex items-center justify-between gap-3 text-[11px] font-bold uppercase tracking-[0.14em]">
                <span className="text-primary/35">SL bán</span>
                <span className="text-primary">{formatInteger(safeMetric.quantity)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[12px]">
                <span className="font-semibold text-primary/50">Doanh số thực</span>
                <span className="font-black text-primary">{formatMoney(safeMetric.net_revenue)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[12px]">
                <span className="font-semibold text-primary/50">Tiền hàng</span>
                <span className="font-black text-brick">{formatMoney(safeMetric.cost_amount)}</span>
            </div>
        </div>
    );
};

const FilterCheckboxGroup = ({ title, items, selectedValues, onToggle, emptyText = 'Không có dữ liệu' }) => (
    <div className="rounded-sm border border-primary/10 bg-[#FBFCFD] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-black uppercase tracking-[0.16em] text-primary/50">{title}</h3>
            <span className="rounded-full bg-primary/8 px-2.5 py-1 text-[11px] font-bold text-primary">
                {selectedValues.length}
            </span>
        </div>
        {items.length === 0 ? (
            <div className="rounded-sm border border-dashed border-primary/10 bg-white px-3 py-4 text-center text-[12px] font-semibold text-primary/35">
                {emptyText}
            </div>
        ) : (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar-thin">
                {items.map((item) => {
                    const checked = selectedValues.includes(String(item.value));

                    return (
                        <label
                            key={item.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5 transition-all ${
                                checked
                                    ? 'border-primary/25 bg-primary/5'
                                    : 'border-primary/10 bg-white hover:border-primary/20 hover:bg-primary/[0.025]'
                            }`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => onToggle(item.value)}
                                className="mt-0.5 h-4 w-4 rounded border-primary/20 accent-primary"
                            />
                            <div className="min-w-0">
                                <div className="truncate text-[13px] font-bold text-primary">{item.label}</div>
                                {item.meta ? (
                                    <div className="mt-0.5 text-[11px] font-medium text-primary/45">{item.meta}</div>
                                ) : null}
                            </div>
                        </label>
                    );
                })}
            </div>
        )}
    </div>
);

const SalesReportPage = () => {
    const { user } = useAuth();
    const filterPanelRef = useRef(null);
    const [filters, setFilters] = useState(() => sanitizeFilters(getDefaultFilters()));
    const [draftFilters, setDraftFilters] = useState(() => sanitizeFilters(getDefaultFilters()));
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [reportData, setReportData] = useState(getEmptyReportState());
    const [categories, setCategories] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [statusOptions, setStatusOptions] = useState([]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!showAdvancedFilters) return;
            if (filterPanelRef.current && !filterPanelRef.current.contains(event.target)) {
                setShowAdvancedFilters(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showAdvancedFilters]);

    useEffect(() => {
        const bootstrap = async () => {
            const initialFilters = sanitizeFilters(getDefaultFilters());

            try {
                const [categoryRes, warehouseRes, statusRes] = await Promise.allSettled([
                    categoryApi.getAll(),
                    warehouseApi.getAll({ active_only: 1 }),
                    orderStatusApi.getAll({ active_only: 'true' }),
                ]);

                if (categoryRes.status === 'fulfilled') {
                    setCategories(Array.isArray(categoryRes.value?.data) ? categoryRes.value.data : []);
                }

                if (warehouseRes.status === 'fulfilled') {
                    setWarehouses(Array.isArray(warehouseRes.value?.data) ? warehouseRes.value.data : []);
                }

                if (statusRes.status === 'fulfilled') {
                    const baseStatuses = Array.isArray(statusRes.value?.data)
                        ? statusRes.value.data.filter((item) => !isInvalidStatus(item))
                        : [];
                    setStatusOptions(mergeStatusOptions(baseStatuses));
                }
            } catch (error) {
                console.error('Error preparing sales report filters', error);
            }

            fetchSalesReport(1, initialFilters);
        };

        bootstrap();
    }, []);

    const fetchSalesReport = async (page = 1, targetFilters = filters) => {
        const normalizedFilters = sanitizeFilters(targetFilters);
        setLoading(true);
        setErrorMessage('');

        try {
            const response = await reportApi.getSalesMatrix({
                ...normalizedFilters,
                page,
            });
            const payload = response?.data || getEmptyReportState();

            setReportData({
                ...getEmptyReportState(),
                ...payload,
                pagination: {
                    ...getEmptyReportState().pagination,
                    ...(payload.pagination || {}),
                },
                summary: {
                    ...getEmptyReportState().summary,
                    ...(payload.summary || {}),
                },
                totals_row: {
                    ...getEmptyReportState().totals_row,
                    ...(payload.totals_row || {}),
                    totals: {
                        ...getEmptyReportState().totals_row.totals,
                        ...(payload.totals_row?.totals || {}),
                    },
                    days: payload.totals_row?.days || {},
                },
                meta: {
                    ...getEmptyReportState().meta,
                    ...(payload.meta || {}),
                },
            });

            if (Array.isArray(payload?.meta?.available_statuses) && payload.meta.available_statuses.length > 0) {
                setStatusOptions((previous) => mergeStatusOptions(payload.meta.available_statuses, previous));
            }
        } catch (error) {
            console.error('Error loading sales matrix report', error);
            setReportData(getEmptyReportState());
            setErrorMessage(error.response?.data?.message || 'Không thể tải báo cáo doanh số.');
        } finally {
            setLoading(false);
        }
    };

    const applyFilters = () => {
        const normalized = sanitizeFilters(draftFilters);
        setFilters(normalized);
        setDraftFilters(normalized);
        fetchSalesReport(1, normalized);
    };

    const handleResetFilters = () => {
        const resetFilters = sanitizeFilters(getDefaultFilters());
        setFilters(resetFilters);
        setDraftFilters(resetFilters);
        setShowAdvancedFilters(false);
        fetchSalesReport(1, resetFilters);
    };

    const handleRefresh = () => {
        fetchSalesReport(reportData.pagination.current_page || 1, filters);
    };

    const handlePageChange = (page) => {
        fetchSalesReport(page, filters);
    };

    const handlePerPageChange = (event) => {
        const nextFilters = sanitizeFilters({
            ...filters,
            per_page: Number(event.target.value || 20),
        });

        setFilters(nextFilters);
        setDraftFilters((previous) => ({
            ...previous,
            per_page: nextFilters.per_page,
        }));
        fetchSalesReport(1, nextFilters);
    };

    const updateDraftField = (field, value) => {
        setDraftFilters((previous) => ({
            ...previous,
            [field]: value,
        }));
    };

    const toggleDraftArrayValue = (field, value) => {
        const normalizedValue = String(value);

        setDraftFilters((previous) => {
            const currentValues = normalizeArray(previous[field]);
            const nextValues = currentValues.includes(normalizedValue)
                ? currentValues.filter((item) => item !== normalizedValue)
                : [...currentValues, normalizedValue];

            return {
                ...previous,
                [field]: nextValues,
            };
        });
    };

    const removeAppliedFilter = (field, value = null) => {
        let nextFilters;

        if (Array.isArray(filters[field])) {
            nextFilters = sanitizeFilters({
                ...filters,
                [field]: filters[field].filter((item) => item !== String(value)),
            });
        } else if (field === 'date_range') {
            nextFilters = sanitizeFilters({
                ...filters,
                ...getDefaultDateRange(),
            });
        } else {
            nextFilters = sanitizeFilters({
                ...filters,
                [field]: '',
            });
        }

        setFilters(nextFilters);
        setDraftFilters(nextFilters);
        fetchSalesReport(1, nextFilters);
    };

    const availableStatusOptions = useMemo(
        () => mergeStatusOptions(reportData.meta?.available_statuses, statusOptions),
        [reportData.meta?.available_statuses, statusOptions]
    );

    const categoryOptions = useMemo(
        () => categories.map((category) => ({
            value: String(category.id),
            label: category.name,
            meta: category.products_count ? `${formatInteger(category.products_count)} sản phẩm` : null,
        })),
        [categories]
    );

    const warehouseOptions = useMemo(
        () => warehouses.map((warehouse) => ({
            value: String(warehouse.id),
            label: warehouse.name,
            meta: warehouse.code ? `Mã kho: ${warehouse.code}` : null,
        })),
        [warehouses]
    );

    const statusLabelMap = useMemo(
        () => Object.fromEntries(availableStatusOptions.map((option) => [option.code, option.name])),
        [availableStatusOptions]
    );

    const categoryLabelMap = useMemo(
        () => Object.fromEntries(categories.map((category) => [String(category.id), category.name])),
        [categories]
    );

    const warehouseLabelMap = useMemo(
        () => Object.fromEntries(warehouses.map((warehouse) => [String(warehouse.id), warehouse.name])),
        [warehouses]
    );

    const typeLabelMap = useMemo(
        () => PRODUCT_TYPE_LABELS,
        []
    );

    const activeFilterChips = useMemo(() => {
        const chips = [];

        if (filters.search) {
            chips.push({
                id: `search-${filters.search}`,
                label: `Tìm: ${filters.search}`,
                onRemove: () => removeAppliedFilter('search'),
            });
        }

        const defaultRange = getDefaultDateRange();
        if (filters.date_from !== defaultRange.date_from || filters.date_to !== defaultRange.date_to) {
            chips.push({
                id: 'date-range',
                label: `${filters.date_from} → ${filters.date_to}`,
                onRemove: () => removeAppliedFilter('date_range'),
            });
        }

        filters.category_ids.forEach((id) => {
            chips.push({
                id: `category-${id}`,
                label: categoryLabelMap[id] || `Danh mục #${id}`,
                onRemove: () => removeAppliedFilter('category_ids', id),
            });
        });

        filters.product_types.forEach((type) => {
            chips.push({
                id: `type-${type}`,
                label: typeLabelMap[type] || type,
                onRemove: () => removeAppliedFilter('product_types', type),
            });
        });

        filters.warehouse_ids.forEach((id) => {
            chips.push({
                id: `warehouse-${id}`,
                label: warehouseLabelMap[id] || `Kho #${id}`,
                onRemove: () => removeAppliedFilter('warehouse_ids', id),
            });
        });

        filters.status.forEach((status) => {
            chips.push({
                id: `status-${status}`,
                label: statusLabelMap[status] || status,
                onRemove: () => removeAppliedFilter('status', status),
            });
        });

        return chips;
    }, [filters, categoryLabelMap, statusLabelMap, typeLabelMap, warehouseLabelMap]);

    const effectiveStatusBadges = useMemo(() => {
        const effectiveCodes = normalizeArray(reportData.meta?.effective_statuses);
        if (effectiveCodes.length === 0) return [];

        return effectiveCodes.map((code) => ({
            code,
            label: statusLabelMap[code] || code,
            color: availableStatusOptions.find((option) => option.code === code)?.color || null,
        }));
    }, [availableStatusOptions, reportData.meta?.effective_statuses, statusLabelMap]);

    return (
        <div className="space-y-6 text-[#0F172A]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.22em] text-primary/35">
                        <span>Báo cáo</span>
                        <span className="text-primary/20">/</span>
                        <span className="text-primary">Báo cáo doanh số</span>
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-black tracking-tight text-primary">Báo cáo doanh số</h1>
                        <p className="max-w-3xl text-[15px] leading-6 text-primary/60">
                            Theo dõi từng sản phẩm bán ra trong khoảng thời gian đã chọn, đối chiếu số lượng,
                            doanh số thực sau giảm giá và tiền hàng theo từng ngày trong cùng một bảng cuộn ngang.
                        </p>
                    </div>
                </div>
                <AccountSelector user={user} />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-sm border border-primary/10 bg-white p-5 shadow-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Sản phẩm có bán</div>
                    <div className="mt-3 text-3xl font-black tracking-tight text-primary">{formatInteger(reportData.summary.total_products)}</div>
                    <div className="mt-2 text-[12px] font-semibold text-primary/45">Theo tổng số dòng sản phẩm phát sinh trong kỳ</div>
                </div>
                <div className="rounded-sm border border-primary/10 bg-white p-5 shadow-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Tổng số lượng bán</div>
                    <div className="mt-3 text-3xl font-black tracking-tight text-primary">{formatInteger(reportData.summary.total_quantity)}</div>
                    <div className="mt-2 text-[12px] font-semibold text-primary/45">Cộng dồn toàn bộ sản phẩm đã đi trong giai đoạn</div>
                </div>
                <div className="rounded-sm border border-primary/10 bg-white p-5 shadow-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Doanh số thực</div>
                    <div className="mt-3 text-3xl font-black tracking-tight text-primary">{formatMoney(reportData.summary.total_net_revenue)}</div>
                    <div className="mt-2 text-[12px] font-semibold text-primary/45">Đã trừ giảm giá ở cấp đơn và cấp dòng nếu có</div>
                </div>
                <div className="rounded-sm border border-primary/10 bg-white p-5 shadow-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Tổng tiền hàng</div>
                    <div className="mt-3 text-3xl font-black tracking-tight text-brick">{formatMoney(reportData.summary.total_cost_amount)}</div>
                    <div className="mt-2 text-[12px] font-semibold text-primary/45">Lấy từ giá vốn hoặc tổng tiền nhập của lượng đã bán</div>
                </div>
                <div className="rounded-sm border border-primary/10 bg-white p-5 shadow-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Số ngày theo dõi</div>
                    <div className="mt-3 text-3xl font-black tracking-tight text-primary">{formatInteger(reportData.summary.range_days)}</div>
                    <div className="mt-2 text-[12px] font-semibold text-primary/45">{filters.date_from} đến {filters.date_to}</div>
                </div>
            </div>

            <div ref={filterPanelRef} className="rounded-sm border border-primary/10 bg-white p-5 shadow-xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-4">
                        <div className="space-y-1.5 md:col-span-2">
                            <label className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Tìm kiếm nhanh</label>
                            <div className="relative">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-primary/25">search</span>
                                <input
                                    type="text"
                                    value={draftFilters.search}
                                    onChange={(event) => updateDraftField('search', event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            applyFilters();
                                        }
                                    }}
                                    placeholder="Mã sản phẩm, tên sản phẩm hoặc ghi chú đơn hàng"
                                    className="h-11 w-full rounded-sm border border-primary/15 bg-[#FCFDFE] pl-11 pr-4 text-[14px] font-semibold text-primary outline-none transition-all focus:border-primary focus:bg-white"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Từ ngày</label>
                            <input
                                type="date"
                                value={draftFilters.date_from}
                                onChange={(event) => updateDraftField('date_from', event.target.value)}
                                className="h-11 w-full rounded-sm border border-primary/15 bg-[#FCFDFE] px-3 text-[14px] font-semibold text-primary outline-none transition-all focus:border-primary focus:bg-white"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary/40">Đến ngày</label>
                            <input
                                type="date"
                                value={draftFilters.date_to}
                                onChange={(event) => updateDraftField('date_to', event.target.value)}
                                className="h-11 w-full rounded-sm border border-primary/15 bg-[#FCFDFE] px-3 text-[14px] font-semibold text-primary outline-none transition-all focus:border-primary focus:bg-white"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setShowAdvancedFilters((previous) => !previous)}
                            className={`inline-flex h-11 items-center gap-2 rounded-sm border px-4 text-[13px] font-black uppercase tracking-[0.12em] transition-all ${
                                showAdvancedFilters || activeFilterChips.length > 0
                                    ? 'border-primary bg-primary text-white shadow-sm'
                                    : 'border-primary/15 bg-white text-primary hover:bg-primary/5'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[18px]">filter_alt</span>
                            Bộ lọc phụ
                        </button>
                        <button
                            type="button"
                            onClick={handleResetFilters}
                            className="inline-flex h-11 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-black uppercase tracking-[0.12em] text-primary/70 transition-all hover:border-primary/30 hover:text-primary"
                        >
                            <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="inline-flex h-11 items-center gap-2 rounded-sm border border-primary/15 bg-white px-4 text-[13px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:bg-primary/5"
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>refresh</span>
                            Làm mới
                        </button>
                        <button
                            type="button"
                            onClick={applyFilters}
                            className="inline-flex h-11 items-center gap-2 rounded-sm bg-primary px-5 text-[13px] font-black uppercase tracking-[0.12em] text-white shadow-md transition-all hover:bg-primary/95"
                        >
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            Áp dụng lọc
                        </button>
                    </div>
                </div>

                {showAdvancedFilters ? (
                    <div className="mt-5 border-t border-primary/10 pt-5">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <FilterCheckboxGroup
                                title="Danh mục"
                                items={categoryOptions}
                                selectedValues={draftFilters.category_ids}
                                onToggle={(value) => toggleDraftArrayValue('category_ids', value)}
                                emptyText="Chưa có danh mục để lọc"
                            />
                            <FilterCheckboxGroup
                                title="Loại sản phẩm"
                                items={productTypeOptions.map((option) => ({
                                    value: option.value,
                                    label: option.label,
                                }))}
                                selectedValues={draftFilters.product_types}
                                onToggle={(value) => toggleDraftArrayValue('product_types', value)}
                                emptyText="Chưa có loại sản phẩm"
                            />
                            <FilterCheckboxGroup
                                title="Kho / Chi nhánh"
                                items={warehouseOptions}
                                selectedValues={draftFilters.warehouse_ids}
                                onToggle={(value) => toggleDraftArrayValue('warehouse_ids', value)}
                                emptyText="Chưa có kho hoặc chi nhánh"
                            />
                            <FilterCheckboxGroup
                                title="Trạng thái đơn"
                                items={availableStatusOptions.map((option) => ({
                                    value: option.code,
                                    label: option.name,
                                    meta: option.code,
                                }))}
                                selectedValues={draftFilters.status}
                                onToggle={(value) => toggleDraftArrayValue('status', value)}
                                emptyText="Không có trạng thái hợp lệ"
                            />
                        </div>
                    </div>
                ) : null}

                {activeFilterChips.length > 0 ? (
                    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-primary/10 pt-4">
                        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Đang lọc</span>
                        {activeFilterChips.map((chip) => (
                            <button
                                key={chip.id}
                                type="button"
                                onClick={chip.onRemove}
                                className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-[#F8FAFC] px-3 py-1.5 text-[12px] font-bold text-primary transition-all hover:border-primary/30 hover:bg-white"
                            >
                                <span>{chip.label}</span>
                                <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="rounded-sm border border-primary/10 bg-white p-4 shadow-xl">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Điều kiện tính doanh số</div>
                        <p className="text-[13px] font-semibold text-primary/65">
                            Báo cáo chỉ lấy các đơn hợp lệ, tự bỏ trạng thái hủy, hoàn, nháp hoặc trạng thái không phù hợp.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {effectiveStatusBadges.length > 0 ? effectiveStatusBadges.map((status) => (
                            <span
                                key={status.code}
                                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-bold"
                                style={{
                                    borderColor: status.color ? `${status.color}55` : 'rgba(15, 23, 42, 0.12)',
                                    color: status.color || '#0F172A',
                                    backgroundColor: status.color ? `${status.color}12` : '#F8FAFC',
                                }}
                            >
                                <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color || '#0F172A' }} />
                                {status.label}
                            </span>
                        )) : (
                            <span className="rounded-full border border-primary/15 bg-[#F8FAFC] px-3 py-1.5 text-[12px] font-bold text-primary/55">
                                Chưa có trạng thái hợp lệ để tính báo cáo
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-xl">
                <div className="flex flex-col gap-3 border-b border-primary/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Bảng doanh số theo sản phẩm</div>
                        <p className="mt-1 text-[13px] font-semibold text-primary/55">
                            Mỗi dòng là 1 sản phẩm, cột tổng cộng cộng cả kỳ, từng cột ngày hiển thị số lượng bán, doanh số thực và tiền hàng.
                        </p>
                    </div>
                    <div className="flex items-center gap-3 text-[12px] font-bold text-primary/50">
                        <span>Hiển thị</span>
                        <select
                            value={filters.per_page}
                            onChange={handlePerPageChange}
                            className="h-10 rounded-sm border border-primary/15 bg-white px-3 text-[13px] font-black text-primary outline-none"
                        >
                            {[10, 20, 50, 100].map((value) => (
                                <option key={value} value={value}>{value} dòng</option>
                            ))}
                        </select>
                    </div>
                </div>

                {errorMessage ? (
                    <div className="border-b border-primary/10 bg-brick/5 px-5 py-4 text-[13px] font-bold text-brick">
                        {errorMessage}
                    </div>
                ) : null}

                <div className="relative max-h-[72vh] overflow-auto table-scrollbar">
                    <table
                        className="min-w-full border-collapse text-left"
                        style={{
                            width: `${PRODUCT_COLUMN_WIDTH + TOTAL_COLUMN_WIDTH + (reportData.dates.length * DAY_COLUMN_WIDTH)}px`,
                        }}
                    >
                        <thead className="sticky top-0 z-30 bg-[#F8FAFC] shadow-sm">
                            <tr>
                                <th
                                    className="sticky left-0 z-40 border-b border-r border-primary/10 bg-[#F8FAFC] px-4 py-4"
                                    style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}
                                >
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Sản phẩm / Mã</div>
                                    <div className="mt-2 text-[13px] font-bold text-primary">Tên sản phẩm, SKU, loại và danh mục</div>
                                </th>
                                <th
                                    className="sticky z-40 border-b border-r border-primary/10 bg-[#F8FAFC] px-4 py-4"
                                    style={{
                                        left: PRODUCT_COLUMN_WIDTH,
                                        width: TOTAL_COLUMN_WIDTH,
                                        minWidth: TOTAL_COLUMN_WIDTH,
                                    }}
                                >
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Tổng cộng</div>
                                    <div className="mt-2 text-[13px] font-bold text-primary">Cộng dồn trong cả khoảng thời gian</div>
                                </th>
                                {reportData.dates.map((date) => (
                                    <th
                                        key={date.date}
                                        className="border-b border-r border-primary/10 bg-[#F8FAFC] px-4 py-4"
                                        style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}
                                    >
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">{date.weekday}</div>
                                        <div className="mt-1 text-[16px] font-black tracking-tight text-primary">{date.label}</div>
                                        <div className="mt-1 text-[12px] font-semibold text-primary/45">{date.full_label}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>

                        <tbody>
                            {reportData.items.length === 0 && !loading ? (
                                <tr>
                                    <td colSpan={2 + reportData.dates.length} className="px-6 py-16 text-center">
                                        <div className="mx-auto max-w-xl space-y-3">
                                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/5 text-primary/35">
                                                <span className="material-symbols-outlined text-4xl">table_view</span>
                                            </div>
                                            <h3 className="text-xl font-black text-primary">Chưa có dữ liệu doanh số trong khoảng này</h3>
                                            <p className="text-[14px] leading-6 text-primary/55">
                                                Thử mở rộng khoảng ngày hoặc bỏ bớt bộ lọc để xem thêm sản phẩm phát sinh đơn hàng.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : null}

                            {reportData.items.map((item, index) => (
                                <tr key={item.row_key} className="group even:bg-[#FCFDFE] hover:bg-primary/[0.03]">
                                    <td
                                        className="sticky left-0 z-20 border-b border-r border-primary/10 bg-inherit px-4 py-4 align-top"
                                        style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-primary/10 bg-white text-[13px] font-black text-primary shadow-sm">
                                                {formatInteger((reportData.pagination.from || 1) + index)}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        {item.product_id ? (
                                                            <Link
                                                                to={`/admin/products/edit/${item.product_id}`}
                                                                className="line-clamp-2 text-[15px] font-black leading-6 text-primary transition-colors hover:text-gold"
                                                            >
                                                                {item.product_name}
                                                            </Link>
                                                        ) : (
                                                            <div className="line-clamp-2 text-[15px] font-black leading-6 text-primary">
                                                                {item.product_name}
                                                            </div>
                                                        )}
                                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                                            <span className="rounded-sm border border-primary/12 bg-white px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-primary/70">
                                                                {item.product_sku || 'Không có mã'}
                                                            </span>
                                                            <span className="rounded-sm border border-primary/12 bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-primary/60">
                                                                {typeLabelMap[item.product_type] || item.product_type}
                                                            </span>
                                                            <span className="rounded-sm border border-primary/12 bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-bold text-primary/60">
                                                                {item.category_name || 'Chưa phân loại'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {item.product_id ? (
                                                        <Link
                                                            to={`/admin/products/edit/${item.product_id}`}
                                                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-primary/12 bg-white text-primary/55 transition-all hover:border-primary/30 hover:text-primary"
                                                            title="Mở sản phẩm"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                                        </Link>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td
                                        className="sticky z-20 border-b border-r border-primary/10 bg-inherit px-3 py-3 align-top"
                                        style={{
                                            left: PRODUCT_COLUMN_WIDTH,
                                            width: TOTAL_COLUMN_WIDTH,
                                            minWidth: TOTAL_COLUMN_WIDTH,
                                        }}
                                    >
                                        <SalesMetricCell metric={item.totals} emphasized />
                                    </td>
                                    {reportData.dates.map((date) => (
                                        <td
                                            key={`${item.row_key}-${date.date}`}
                                            className="border-b border-r border-primary/10 px-3 py-3 align-top"
                                            style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}
                                        >
                                            <SalesMetricCell metric={item.days?.[date.date]} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>

                        <tfoot>
                            <tr className="bg-primary text-white">
                                <td
                                    className="sticky left-0 z-20 border-r border-white/10 px-4 py-4"
                                    style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}
                                >
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/65">Tổng toàn bảng</div>
                                    <div className="mt-2 text-[16px] font-black">{reportData.totals_row.label}</div>
                                </td>
                                <td
                                    className="sticky z-20 border-r border-white/10 px-3 py-3"
                                    style={{
                                        left: PRODUCT_COLUMN_WIDTH,
                                        width: TOTAL_COLUMN_WIDTH,
                                        minWidth: TOTAL_COLUMN_WIDTH,
                                    }}
                                >
                                    <SalesMetricCell metric={reportData.totals_row.totals} emphasized />
                                </td>
                                {reportData.dates.map((date) => (
                                    <td
                                        key={`totals-${date.date}`}
                                        className="border-r border-white/10 px-3 py-3"
                                        style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}
                                    >
                                        <SalesMetricCell metric={reportData.totals_row.days?.[date.date]} />
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    </table>

                    {loading ? (
                        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                            <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-3 shadow-xl">
                                <div className="h-6 w-6 animate-refresh-spin rounded-full border-4 border-primary/10 border-t-primary" />
                                <span className="text-[13px] font-black uppercase tracking-[0.16em] text-primary">Đang tính doanh số</span>
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="flex flex-col gap-4 border-t border-primary/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="text-[13px] font-bold text-primary/55">
                        Hiển thị {reportData.pagination.from || 0} - {reportData.pagination.to || 0} trên tổng {formatInteger(reportData.pagination.total || 0)} sản phẩm
                    </div>
                    <Pagination pagination={reportData.pagination} onPageChange={handlePageChange} />
                </div>
            </div>
        </div>
    );
};

export default SalesReportPage;
