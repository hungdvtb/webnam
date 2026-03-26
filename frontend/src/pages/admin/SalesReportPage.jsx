import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AccountSelector from '../../components/AccountSelector';
import { useAuth } from '../../context/AuthContext';
import { reportApi } from '../../services/api';

const PRODUCT_COLUMN_WIDTH = 340;
const TOTAL_COLUMN_WIDTH = 250;
const DAY_COLUMN_WIDTH = 170;
const SEARCH_HISTORY_KEY = 'daily_sales_report_search_history';

const numberFormatter = new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 0,
});

const toDateInputValue = (date) => {
    const safeDate = new Date(date);
    const offset = safeDate.getTimezoneOffset() * 60000;

    return new Date(safeDate.getTime() - offset).toISOString().slice(0, 10);
};

const getDefaultDateRange = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 7);

    return {
        date_from: toDateInputValue(from),
        date_to: toDateInputValue(to),
    };
};

const createEmptyState = () => ({
    dates: [],
    rows: [],
    summary_row: {
        totals: {
            quantity: 0,
            cost_amount: 0,
            revenue_amount: 0,
        },
        days: {},
    },
    summary: {
        top_level_count: 0,
        leaf_count: 0,
        total_quantity: 0,
        total_cost_amount: 0,
        total_revenue_amount: 0,
    },
    meta: {
        effective_statuses: [],
        date_basis: 'completed_or_created',
    },
});

const formatWholeNumber = (value) => numberFormatter.format(Math.round(Number(value || 0)));

const formatMetricText = (metric) => {
    const quantity = Number(metric?.quantity || 0);
    const costAmount = Math.round(Number(metric?.cost_amount || 0));
    const revenueAmount = Math.round(Number(metric?.revenue_amount || 0));

    if (!quantity && !costAmount && !revenueAmount) {
        return '0';
    }

    return `${formatWholeNumber(quantity)}(${formatWholeNumber(costAmount)}-${formatWholeNumber(revenueAmount)})`;
};

const normalizeFilters = (rawFilters) => {
    const fallback = getDefaultDateRange();
    let dateFrom = rawFilters?.date_from || fallback.date_from;
    let dateTo = rawFilters?.date_to || fallback.date_to;

    if (dateFrom && dateTo && dateFrom > dateTo) {
        [dateFrom, dateTo] = [dateTo, dateFrom];
    }

    return {
        date_from: dateFrom,
        date_to: dateTo,
        search: String(rawFilters?.search || ''),
    };
};

const SalesReportPage = () => {
    const { user } = useAuth();
    const searchContainerRef = useRef(null);
    const filterPanelRef = useRef(null);
    const filterButtonRef = useRef(null);
    const requestIdRef = useRef(0);

    const [filters, setFilters] = useState(() => normalizeFilters(getDefaultDateRange()));
    const [reportState, setReportState] = useState(createEmptyState());
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [expandedParents, setExpandedParents] = useState({});
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
            if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
                setShowSearchHistory(false);
            }

            const clickedFilterButton = filterButtonRef.current?.contains(event.target);
            const clickedFilterPanel = filterPanelRef.current?.contains(event.target);

            if (!clickedFilterButton && !clickedFilterPanel) {
                setShowFilterPanel(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            loadReport(filters);
        }, filters.search.trim() ? 320 : 0);

        return () => clearTimeout(timer);
    }, [filters]);

    const loadReport = async (nextFilters) => {
        const normalized = normalizeFilters(nextFilters);
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        setLoading(true);
        setErrorMessage('');

        try {
            const response = await reportApi.getProductSalesByDay(normalized);

            if (requestId !== requestIdRef.current) {
                return;
            }

            setReportState({
                ...createEmptyState(),
                ...(response?.data || {}),
            });

            if (normalized.search.trim()) {
                addToSearchHistory(normalized.search.trim());
            }
        } catch (error) {
            if (requestId !== requestIdRef.current) {
                return;
            }

            console.error('Error loading product sales by day report', error);
            setReportState(createEmptyState());
            setErrorMessage(error.response?.data?.message || 'Không thể tải bảng hàng đi hàng ngày.');
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
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
    };

    const applyRangePreset = (daysBack) => {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - daysBack);

        updateFilters({
            date_from: toDateInputValue(from),
            date_to: toDateInputValue(to),
        });
        setShowFilterPanel(false);
    };

    const handleResetFilters = () => {
        setFilters(normalizeFilters(getDefaultDateRange()));
        setShowFilterPanel(false);
    };

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

    const toggleParentRow = (rowKey) => {
        setExpandedParents((current) => ({
            ...current,
            [rowKey]: !current[rowKey],
        }));
    };

    const flattenedRows = useMemo(() => {
        const rows = [];

        reportState.rows.forEach((row) => {
            rows.push({
                ...row,
                depth: 0,
            });

            const hasChildren = Array.isArray(row.children) && row.children.length > 0;
            const isExpanded = expandedParents[row.row_key];

            if (hasChildren && isExpanded) {
                row.children.forEach((child) => {
                    rows.push({
                        ...child,
                        depth: 1,
                        parent_row_key: row.row_key,
                    });
                });
            }
        });

        return rows;
    }, [expandedParents, reportState.rows]);

    const tableWidth = useMemo(
        () => PRODUCT_COLUMN_WIDTH + TOTAL_COLUMN_WIDTH + ((reportState.dates?.length || 0) * DAY_COLUMN_WIDTH),
        [reportState.dates]
    );

    return (
        <div className="space-y-5 text-[#0F172A]">
            <div className="flex justify-end">
                <AccountSelector user={user} />
            </div>

            <div className="relative">
                <div className="rounded-sm border border-primary/10 bg-white p-3 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                        <div className="flex items-center gap-2">
                            <button
                                ref={filterButtonRef}
                                type="button"
                                onClick={() => setShowFilterPanel((current) => !current)}
                                className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
                                    showFilterPanel
                                        ? 'border-primary bg-primary text-white shadow-lg'
                                        : 'border-primary/15 bg-primary/5 text-primary hover:bg-primary/10'
                                }`}
                                title="Bộ lọc nhanh"
                            >
                                <span className="material-symbols-outlined text-[20px]">filter_alt</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => loadReport(filters)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary transition-all hover:bg-primary/5"
                                title="Làm mới dữ liệu"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>
                                    {loading ? 'progress_activity' : 'refresh'}
                                </span>
                            </button>
                        </div>

                        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(160px,200px)_minmax(160px,200px)_minmax(0,1fr)]">
                            <label className="space-y-1">
                                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/35">Từ ngày</div>
                                <input
                                    type="date"
                                    value={filters.date_from}
                                    onChange={(event) => updateFilters({ date_from: event.target.value })}
                                    className="h-11 w-full rounded-sm border border-primary/15 bg-white px-3 text-[14px] font-bold text-primary outline-none transition-all focus:border-primary"
                                />
                            </label>

                            <label className="space-y-1">
                                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/35">Đến ngày</div>
                                <input
                                    type="date"
                                    value={filters.date_to}
                                    onChange={(event) => updateFilters({ date_to: event.target.value })}
                                    className="h-11 w-full rounded-sm border border-primary/15 bg-white px-3 text-[14px] font-bold text-primary outline-none transition-all focus:border-primary"
                                />
                            </label>

                            <div className="space-y-1">
                                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-primary/35">Tìm kiếm nhanh</div>
                                <div className="relative" ref={searchContainerRef}>
                                    <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">
                                        search
                                    </span>
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={filters.search}
                                        onChange={(event) => updateFilters({ search: event.target.value })}
                                        onFocus={() => setShowSearchHistory(true)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                addToSearchHistory(filters.search.trim());
                                                setShowSearchHistory(false);
                                            }
                                        }}
                                        placeholder="Tìm kiếm nhanh (tên SP, SKU, ghi chú)"
                                        className="h-11 w-full rounded-sm border border-primary/15 bg-primary/5 pl-10 pr-10 text-[14px] font-medium text-primary outline-none transition-all focus:border-primary"
                                    />
                                    {filters.search && (
                                        <button
                                            type="button"
                                            onClick={() => updateFilters({ search: '' })}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/35 transition-colors hover:text-brick"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">cancel</span>
                                        </button>
                                    )}

                                    {showSearchHistory && searchHistory.length > 0 && (
                                        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[70] overflow-hidden rounded-sm border border-primary/15 bg-white py-2 shadow-2xl">
                                            <div className="mb-2 flex items-center justify-between border-b border-primary/10 px-3 pb-2">
                                                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-primary/35">Tìm kiếm gần đây</span>
                                                <button
                                                    type="button"
                                                    onClick={clearSearchHistory}
                                                    className="text-[10px] font-bold text-brick transition-colors hover:underline"
                                                >
                                                    Xóa tất cả
                                                </button>
                                            </div>
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                                {searchHistory.map((item) => (
                                                    <div
                                                        key={item}
                                                        className="group flex cursor-pointer items-center justify-between px-3 py-2 transition-colors hover:bg-primary/5"
                                                        onClick={() => {
                                                            updateFilters({ search: item });
                                                            setShowSearchHistory(false);
                                                        }}
                                                    >
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <span className="material-symbols-outlined text-[16px] text-primary/30">history</span>
                                                            <span className="truncate text-[13px] font-medium text-primary">{item}</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                removeSearchHistoryItem(item);
                                                            }}
                                                            className="rounded-full p-1 text-primary/30 opacity-0 transition-all hover:bg-primary/5 hover:text-brick group-hover:opacity-100"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px]">close</span>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {showFilterPanel && (
                    <div
                        ref={filterPanelRef}
                        className="absolute left-0 top-[calc(100%+10px)] z-[65] w-full max-w-[560px] rounded-sm border border-primary/15 bg-white p-4 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Bộ lọc nhanh</div>
                                <h3 className="mt-1 text-[18px] font-black tracking-tight text-primary">Tùy chọn khoảng ngày</h3>
                                <p className="mt-2 text-[13px] leading-6 text-primary/55">
                                    Báo cáo được tính theo ngày hoàn tất nếu đơn đã chốt trạng thái completed,
                                    nếu không sẽ lấy ngày tạo đơn.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowFilterPanel(false)}
                                className="rounded-full p-1 text-primary/35 transition-colors hover:bg-primary/5 hover:text-primary"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {[
                                { label: 'Hôm nay', daysBack: 0 },
                                { label: '3 ngày', daysBack: 2 },
                                { label: '7 ngày', daysBack: 6 },
                                { label: '30 ngày', daysBack: 29 },
                            ].map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => applyRangePreset(preset.daysBack)}
                                    className="rounded-sm border border-primary/12 bg-[#F8FAFC] px-3 py-3 text-left transition-all hover:border-primary/25 hover:bg-white"
                                >
                                    <div className="text-[13px] font-black text-primary">{preset.label}</div>
                                    <div className="mt-1 text-[12px] font-medium text-primary/50">Cập nhật ngày lập tức theo mốc này</div>
                                </button>
                            ))}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3 border-t border-primary/10 pt-4">
                            <button
                                type="button"
                                onClick={handleResetFilters}
                                className="rounded-sm border border-primary/15 px-4 py-2 text-[13px] font-bold text-primary transition-all hover:bg-primary/5"
                            >
                                Đặt lại bộ lọc
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowFilterPanel(false)}
                                className="rounded-sm bg-primary px-4 py-2 text-[13px] font-bold text-white transition-all hover:bg-primary/90"
                            >
                                Đóng bảng lọc
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="overflow-hidden rounded-sm border border-primary/10 bg-white shadow-xl">
                <div className="flex flex-col gap-3 border-b border-primary/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="text-[12px] font-bold text-primary/50">
                        Tổng số lượng: {formatWholeNumber(reportState.summary?.total_quantity || 0)}
                    </div>
                </div>

                {errorMessage ? (
                    <div className="border-b border-primary/10 bg-brick/5 px-5 py-4 text-[13px] font-bold text-brick">
                        {errorMessage}
                    </div>
                ) : null}

                <div className="relative max-h-[74vh] overflow-auto table-scrollbar">
                    <table
                        className="border-collapse text-left"
                        style={{
                            width: `${tableWidth}px`,
                            minWidth: `${tableWidth}px`,
                        }}
                    >
                        <thead className="sticky top-0 z-30 bg-[#F8FAFC] shadow-sm">
                            <tr>
                                <th
                                    className="sticky left-0 z-40 border-b border-r border-primary/10 bg-[#F8FAFC] px-4 py-4"
                                    style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}
                                >
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Sản phẩm</div>
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
                                </th>
                                {reportState.dates.map((date) => (
                                    <th
                                        key={date.date}
                                        className="border-b border-r border-primary/10 bg-[#F8FAFC] px-4 py-4"
                                        style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}
                                    >
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/35">Ngày</div>
                                        <div className="mt-1 text-[17px] font-black tracking-tight text-primary">{date.label}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>

                        <tbody>
                            <tr className="bg-primary text-white">
                                <td
                                    className="sticky left-0 z-20 border-b border-r border-white/10 bg-primary px-4 py-4 align-top"
                                    style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}
                                >
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">Dòng tổng hợp</div>
                                    <div className="mt-2 text-[16px] font-black">Tổng cộng toàn bảng</div>
                                </td>
                                <td
                                    className="sticky z-20 border-b border-r border-white/10 bg-primary px-4 py-4 align-top text-[14px] font-black"
                                    style={{
                                        left: PRODUCT_COLUMN_WIDTH,
                                        width: TOTAL_COLUMN_WIDTH,
                                        minWidth: TOTAL_COLUMN_WIDTH,
                                    }}
                                >
                                    {formatMetricText(reportState.summary_row?.totals)}
                                </td>
                                {reportState.dates.map((date) => (
                                    <td
                                        key={`summary-${date.date}`}
                                        className="border-b border-r border-white/10 bg-primary px-4 py-4 align-top text-[14px] font-black"
                                        style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}
                                    >
                                        {formatMetricText(reportState.summary_row?.days?.[date.date])}
                                    </td>
                                ))}
                            </tr>

                            {flattenedRows.length === 0 && !loading ? (
                                <tr>
                                    <td colSpan={2 + reportState.dates.length} className="px-6 py-20 text-center">
                                        <div className="mx-auto max-w-xl space-y-3">
                                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/5 text-primary/30">
                                                <span className="material-symbols-outlined text-[36px]">table_chart</span>
                                            </div>
                                            <h3 className="text-[22px] font-black text-primary">Chưa có dữ liệu trong khoảng lọc này</h3>
                                            <p className="text-[14px] leading-6 text-primary/55">
                                                Thử đổi khoảng ngày hoặc bỏ trống từ khóa tìm kiếm để xem thêm kết quả.
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : null}

                            {flattenedRows.map((row) => {
                                const isParent = row.row_type === 'parent';
                                const isChild = row.depth > 0;
                                const isExpanded = Boolean(expandedParents[row.row_key]);
                                const hasChildren = Array.isArray(row.children) && row.children.length > 0;

                                return (
                                    <tr
                                        key={row.parent_row_key ? `${row.parent_row_key}-${row.row_key}` : row.row_key}
                                        className={`group border-b border-primary/10 ${
                                            isParent
                                                ? 'bg-[#F4F7FF]'
                                                : isChild
                                                    ? 'bg-[#FBFCFF]'
                                                    : 'bg-white even:bg-[#FCFDFE]'
                                        }`}
                                    >
                                        <td
                                            className={`sticky left-0 z-10 border-r border-primary/10 bg-inherit px-4 py-4 align-top ${
                                                isChild ? 'text-primary/85' : ''
                                            }`}
                                            style={{ width: PRODUCT_COLUMN_WIDTH, minWidth: PRODUCT_COLUMN_WIDTH }}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div
                                                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border text-[12px] font-black ${
                                                        isParent
                                                            ? 'border-primary/20 bg-primary text-white'
                                                            : isChild
                                                                ? 'border-primary/10 bg-white text-primary/55'
                                                                : 'border-primary/10 bg-white text-primary'
                                                    }`}
                                                >
                                                    {isParent ? 'P' : isChild ? 'C' : 'SP'}
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className={`flex items-center gap-2 ${isChild ? 'pl-5' : ''}`}>
                                                                {isParent && hasChildren ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleParentRow(row.row_key)}
                                                                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary/65 transition-all hover:border-primary/30 hover:text-primary"
                                                                        title={isExpanded ? 'Thu gọn biến thể' : 'Mở rộng biến thể'}
                                                                    >
                                                                        <span className={`material-symbols-outlined text-[18px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                                                                            chevron_right
                                                                        </span>
                                                                    </button>
                                                                ) : null}

                                                                <div className="min-w-0">
                                                                    {row.product_id ? (
                                                                        <Link
                                                                            to={`/admin/products/edit/${row.product_id}`}
                                                                            className={`line-clamp-2 text-[15px] font-black leading-6 transition-colors ${
                                                                                isParent ? 'text-primary' : 'text-primary hover:text-gold'
                                                                            }`}
                                                                        >
                                                                            {row.product_name}
                                                                        </Link>
                                                                    ) : (
                                                                        <div className="line-clamp-2 text-[15px] font-black leading-6 text-primary">
                                                                            {row.product_name}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className={`mt-2 flex flex-wrap items-center gap-2 ${isChild ? 'pl-12' : ''}`}>
                                                                <span className="rounded-sm border border-primary/12 bg-white px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-primary/70">
                                                                    {row.product_sku || 'Không có SKU'}
                                                                </span>
                                                                {isParent && hasChildren ? (
                                                                    <span className="rounded-sm border border-primary/12 bg-white px-2.5 py-1 text-[11px] font-bold text-primary/55">
                                                                        {row.children_count || 0} biến thể
                                                                    </span>
                                                                ) : null}
                                                                {isChild ? (
                                                                    <span className="rounded-sm border border-primary/12 bg-white px-2.5 py-1 text-[11px] font-bold text-primary/55">
                                                                        Biến thể con
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>

                                        <td
                                            className={`sticky z-10 border-r border-primary/10 bg-inherit px-4 py-4 align-top text-[14px] font-bold ${
                                                isParent ? 'text-primary' : isChild ? 'text-primary/80' : 'text-primary/90'
                                            }`}
                                            style={{
                                                left: PRODUCT_COLUMN_WIDTH,
                                                width: TOTAL_COLUMN_WIDTH,
                                                minWidth: TOTAL_COLUMN_WIDTH,
                                            }}
                                        >
                                            {formatMetricText(row.totals)}
                                        </td>

                                        {reportState.dates.map((date) => (
                                            <td
                                                key={`${row.row_key}-${date.date}`}
                                                className={`border-r border-primary/10 px-4 py-4 align-top text-[14px] font-medium ${
                                                    isParent ? 'text-primary' : isChild ? 'text-primary/75' : 'text-primary/85'
                                                }`}
                                                style={{ width: DAY_COLUMN_WIDTH, minWidth: DAY_COLUMN_WIDTH }}
                                            >
                                                {formatMetricText(row.days?.[date.date])}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {loading ? (
                        <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
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
