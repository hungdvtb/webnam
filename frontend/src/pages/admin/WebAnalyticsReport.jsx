import React, { useEffect, useMemo, useRef, useState } from 'react';
import AccountSelector from '../../components/AccountSelector';
import { reportApi } from '../../services/api';

const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
});

const toDateInputValue = (date) => {
    const safeDate = new Date(date);
    const offset = safeDate.getTimezoneOffset() * 60000;
    return new Date(safeDate.getTime() - offset).toISOString().slice(0, 10);
};

const quickRanges = [
    { key: 'today', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
];

const sourceOptions = [
    { value: 'all', label: 'Tất cả' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'google', label: 'Google' },
];

const createQuickRange = (rangeKey) => {
    const today = new Date();
    const from = new Date(today);

    if (rangeKey === 'week') {
        const day = today.getDay();
        const daysFromMonday = day === 0 ? 6 : day - 1;
        from.setDate(today.getDate() - daysFromMonday);
    }

    if (rangeKey === 'month') {
        from.setDate(1);
    }

    return {
        date_from: toDateInputValue(from),
        date_to: toDateInputValue(today),
    };
};

const createDefaultRange = () => ({
    ...createQuickRange('today'),
    source: 'all',
});

const resolveActiveQuickRange = (filters) => (
    quickRanges.find((range) => {
        const rangeValue = createQuickRange(range.key);
        return rangeValue.date_from === filters.date_from && rangeValue.date_to === filters.date_to;
    })?.key || ''
);

const formatNumber = (value) => numberFormatter.format(Number(value || 0));
const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
const formatMoney = (value) => moneyFormatter.format(Number(value || 0));

const MetricCard = ({ icon, label, value, subValue, tone = 'primary' }) => {
    const toneClass = {
        primary: 'bg-primary text-white border-primary',
        green: 'bg-emerald-600 text-white border-emerald-600',
        amber: 'bg-amber-500 text-white border-amber-500',
        brick: 'bg-brick text-white border-brick',
        slate: 'bg-slate-700 text-white border-slate-700',
    }[tone] || 'bg-primary text-white border-primary';

    return (
        <div className="min-h-[136px] rounded-sm border border-primary/10 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/40">{label}</div>
                    <div className="mt-3 text-[30px] font-black leading-none tracking-tight text-primary">{value}</div>
                    {subValue ? <div className="mt-2 text-[12px] font-bold text-primary/50">{subValue}</div> : null}
                </div>
                <div className={`flex size-11 shrink-0 items-center justify-center rounded-sm border ${toneClass}`}>
                    <span className="material-symbols-outlined text-[22px]">{icon}</span>
                </div>
            </div>
        </div>
    );
};

const DailyBars = ({ series }) => {
    const maxValue = Math.max(
        1,
        ...series.flatMap((row) => [
            Number(row.page_views || 0),
            Number(row.add_to_carts || 0),
            Number(row.orders_count || 0),
        ])
    );

    return (
        <div className="rounded-sm border border-primary/10 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-primary/10 px-5 py-4">
                <div>
                    <h3 className="text-[16px] font-black text-primary">Phân tích theo ngày</h3>
                    <p className="mt-1 text-[12px] font-semibold text-primary/45">Xanh: truy cập, vàng: thêm giỏ, đỏ: đặt hàng</p>
                </div>
                <span className="material-symbols-outlined text-primary/30">bar_chart</span>
            </div>
            <div className="overflow-x-auto px-5 py-5">
                <div className="flex h-[260px] min-w-[760px] items-end gap-3">
                    {series.map((row) => (
                        <div key={row.date} className="flex min-w-[42px] flex-1 flex-col items-center justify-end gap-2">
                            <div className="flex h-[190px] w-full items-end justify-center gap-1.5">
                                <div
                                    className="w-2 rounded-t-sm bg-primary"
                                    title={`${row.label}: ${formatNumber(row.page_views)} lượt truy cập`}
                                    style={{ height: `${Math.max(4, (Number(row.page_views || 0) / maxValue) * 190)}px` }}
                                />
                                <div
                                    className="w-2 rounded-t-sm bg-amber-500"
                                    title={`${row.label}: ${formatNumber(row.add_to_carts)} thêm giỏ`}
                                    style={{ height: `${Math.max(4, (Number(row.add_to_carts || 0) / maxValue) * 190)}px` }}
                                />
                                <div
                                    className="w-2 rounded-t-sm bg-brick"
                                    title={`${row.label}: ${formatNumber(row.orders_count)} don`}
                                    style={{ height: `${Math.max(4, (Number(row.orders_count || 0) / maxValue) * 190)}px` }}
                                />
                            </div>
                            <div className="text-[11px] font-black text-primary/45">{row.label}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const ProductTable = ({ products }) => (
    <div className="rounded-sm border border-primary/10 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-primary/10 px-5 py-4">
            <div>
                <h3 className="text-[16px] font-black text-primary">Sản phẩm cần theo dõi</h3>
                <p className="mt-1 text-[12px] font-semibold text-primary/45">Sắp xếp theo mức độ tương tác trong khoảng ngày đã chọn</p>
            </div>
            <span className="material-symbols-outlined text-primary/30">inventory_2</span>
        </div>
        <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full border-collapse text-left">
                <thead className="bg-[#F8FAFC]">
                    <tr>
                        {['Sản phẩm', 'Lượt xem', 'Thêm giỏ', 'Đơn', 'Tỷ lệ thêm giỏ', 'Tỷ lệ chuyển đổi', 'Doanh thu đặt'].map((label) => (
                            <th key={label} className="border-b border-primary/10 px-4 py-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">
                                {label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {products.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="px-5 py-14 text-center text-[13px] font-bold text-primary/45">
                                Chưa có dữ liệu sản phẩm trong khoảng ngày này.
                            </td>
                        </tr>
                    ) : products.map((product) => (
                        <tr key={product.product_id} className="border-b border-primary/10 last:border-b-0">
                            <td className="max-w-[360px] px-4 py-3">
                                <div className="truncate text-[13px] font-black text-primary" title={product.product_name}>
                                    {product.product_name}
                                </div>
                                <div className="mt-0.5 text-[11px] font-bold text-primary/40">
                                    {product.product_sku || `#${product.product_id}`}
                                </div>
                            </td>
                            <td className="px-4 py-3 text-[13px] font-black text-primary">{formatNumber(product.product_views)}</td>
                            <td className="px-4 py-3 text-[13px] font-black text-amber-600">{formatNumber(product.add_to_carts)}</td>
                            <td className="px-4 py-3 text-[13px] font-black text-brick">{formatNumber(product.orders_count)}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-primary/70">{formatPercent(product.add_to_cart_rate)}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-primary/70">{formatPercent(product.product_conversion_rate)}</td>
                            <td className="px-4 py-3 text-[13px] font-black text-primary">{formatMoney(product.ordered_revenue)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const DailyTable = ({ series }) => (
    <div className="rounded-sm border border-primary/10 bg-white shadow-sm">
        <div className="border-b border-primary/10 px-5 py-4">
            <h3 className="text-[16px] font-black text-primary">Bảng số liệu ngày</h3>
        </div>
        <div className="max-h-[440px] overflow-auto">
            <table className="min-w-[820px] w-full border-collapse text-left">
                <thead className="sticky top-0 bg-[#F8FAFC]">
                    <tr>
                        {['Ngày', 'Truy cập', 'Xem SP', 'Thêm giỏ', 'Checkout', 'Đơn', 'CVR'].map((label) => (
                            <th key={label} className="border-b border-primary/10 px-4 py-3 text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">{label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {series.map((row) => (
                        <tr key={row.date} className="border-b border-primary/10 last:border-b-0">
                            <td className="px-4 py-3 text-[13px] font-black text-primary">{row.date}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-primary">{formatNumber(row.page_views)}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-primary/70">{formatNumber(row.product_views)}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-amber-600">{formatNumber(row.add_to_carts)}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-slate-600">{formatNumber(row.checkout_started)}</td>
                            <td className="px-4 py-3 text-[13px] font-bold text-brick">{formatNumber(row.orders_count)}</td>
                            <td className="px-4 py-3 text-[13px] font-black text-primary">{formatPercent(row.conversion_rate)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

export default function WebAnalyticsReport() {
    const [filters, setFilters] = useState(() => createDefaultRange());
    const [report, setReport] = useState({ summary: {}, series: [], products: [], filters: {} });
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const requestIdRef = useRef(0);

    const loadReport = async (nextFilters = filters) => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setErrorMessage('');

        try {
            const response = await reportApi.getWebAnalytics({
                ...nextFilters,
                product_limit: 30,
            });
            if (requestId !== requestIdRef.current) return;
            setReport({
                summary: response?.data?.summary || {},
                series: response?.data?.series || [],
                products: response?.data?.products || [],
                filters: response?.data?.filters || {},
            });
        } catch (error) {
            if (requestId !== requestIdRef.current) return;
            console.error('Error loading web analytics report', error);
            setErrorMessage('Không tải được báo cáo phân tích web.');
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        loadReport();
    }, []);

    const summary = report.summary || {};
    const metricCards = useMemo(() => ([
        {
            icon: 'visibility',
            label: 'Luot truy cap',
            value: formatNumber(summary.page_views),
            subValue: `${formatNumber(summary.unique_visitors)} khách riêng`,
            tone: 'primary',
        },
        {
            icon: 'shopping_cart',
            label: 'Thêm vào giỏ',
            value: formatNumber(summary.add_to_carts),
            subValue: `Tỷ lệ: ${formatPercent(summary.add_to_cart_rate)}`,
            tone: 'amber',
        },
        {
            icon: 'receipt_long',
            label: 'Đơn đặt hàng',
            value: formatNumber(summary.orders_count),
            subValue: formatMoney(summary.order_revenue),
            tone: 'brick',
        },
        {
            icon: 'percent',
            label: 'Tỷ lệ chuyển đổi',
            value: formatPercent(summary.conversion_rate),
            subValue: `Giỏ -> đơn: ${formatPercent(summary.cart_to_order_rate)}`,
            tone: 'green',
        },
    ]), [summary]);

    const updateFilter = (key, value) => {
        setFilters((current) => ({ ...current, [key]: value }));
    };
    const activeQuickRange = resolveActiveQuickRange(filters);

    const applyQuickRange = (rangeKey) => {
        const nextFilters = {
            ...filters,
            ...createQuickRange(rangeKey),
        };
        setFilters(nextFilters);
        loadReport(nextFilters);
    };

    const updateSource = (source) => {
        const nextFilters = {
            ...filters,
            source,
        };
        setFilters(nextFilters);
        loadReport(nextFilters);
    };

    return (
        <div className="space-y-6 font-sans">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-sm bg-primary text-white shadow-sm">
                            <span className="material-symbols-outlined">monitoring</span>
                        </span>
                        <div>
                            <h1 className="text-[30px] font-black tracking-tight text-primary">Phân tích web</h1>
                            <p className="mt-1 text-[13px] font-semibold text-primary/50">
                                Theo dõi truy cập, thêm giỏ, đặt hàng và tỷ lệ chuyển đổi.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <AccountSelector />
                    <div className="inline-flex h-10 rounded-sm border border-primary/10 bg-white p-1">
                        {quickRanges.map((range) => (
                            <button
                                key={range.key}
                                type="button"
                                onClick={() => applyQuickRange(range.key)}
                                disabled={loading && activeQuickRange === range.key}
                                className={`h-8 rounded-sm px-3 text-[12px] font-black uppercase tracking-[0.08em] transition ${activeQuickRange === range.key ? 'bg-primary text-white shadow-sm' : 'text-primary/55 hover:bg-primary/5 hover:text-primary'} disabled:opacity-60`}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>
                    <label className="flex h-10 items-center gap-2 rounded-sm border border-primary/10 bg-white pl-3 focus-within:border-primary">
                        <span className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Nguồn</span>
                        <select
                            value={filters.source || 'all'}
                            onChange={(event) => updateSource(event.target.value)}
                            className="h-full rounded-sm bg-transparent pr-3 text-[13px] font-bold text-primary outline-none"
                        >
                            {sourceOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <input
                        type="date"
                        value={filters.date_from}
                        onChange={(event) => updateFilter('date_from', event.target.value)}
                        className="h-10 rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-primary outline-none focus:border-primary"
                    />
                    <span className="text-primary/30">-</span>
                    <input
                        type="date"
                        value={filters.date_to}
                        onChange={(event) => updateFilter('date_to', event.target.value)}
                        className="h-10 rounded-sm border border-primary/10 bg-white px-3 text-[13px] font-bold text-primary outline-none focus:border-primary"
                    />
                    <button
                        type="button"
                        onClick={() => loadReport(filters)}
                        disabled={loading}
                        className="inline-flex h-10 items-center gap-2 rounded-sm bg-primary px-4 text-[12px] font-black uppercase tracking-[0.12em] text-white transition hover:bg-primary/90 disabled:opacity-60"
                    >
                        <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        Cập nhật
                    </button>
                </div>
            </div>

            {errorMessage ? (
                <div className="rounded-sm border border-brick/20 bg-brick/5 px-4 py-3 text-[13px] font-bold text-brick">
                    {errorMessage}
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card) => <MetricCard key={card.label} {...card} />)}
            </div>

            <DailyBars series={report.series || []} />

            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(520px,0.85fr)]">
                <ProductTable products={report.products || []} />
                <DailyTable series={report.series || []} />
            </div>

            {loading ? (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/45 backdrop-blur-[1px]">
                    <div className="flex items-center gap-3 rounded-sm border border-primary/10 bg-white px-5 py-3 shadow-xl">
                        <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary/10 border-t-primary" />
                        <span className="text-[13px] font-black uppercase tracking-[0.16em] text-primary">Đang tải báo cáo</span>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
