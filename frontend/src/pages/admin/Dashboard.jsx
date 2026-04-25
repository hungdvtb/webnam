import React, { useEffect, useState } from 'react';
import { reportApi } from '../../services/api';

const pageTitle = 'Tổng quan doanh thu';
const panelClass = 'overflow-hidden rounded-[28px] border border-primary/10 bg-white shadow-[0_28px_70px_-44px_rgba(15,23,42,0.55)]';
const infoCardClass = 'rounded-[22px] border border-primary/10 bg-[#f7f3ea] p-4';
const inputClass = 'h-11 rounded-2xl border border-primary/15 bg-white px-4 text-[13px] font-semibold text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10';
const buttonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[13px] font-black text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60';

const currencyFormatter = new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 0,
});

const today = new Date();
const fallbackMonth = today.getMonth() + 1;
const fallbackYear = today.getFullYear();
const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;

    return {
        value,
        label: `Tháng ${String(value).padStart(2, '0')}`,
    };
});

function formatCurrency(value) {
    return currencyFormatter.format(Number(value || 0));
}

function formatNumber(value) {
    return numberFormatter.format(Number(value || 0));
}

function formatCompactCurrency(value) {
    const numericValue = Number(value || 0);
    const absValue = Math.abs(numericValue);

    if (absValue >= 1_000_000_000) {
        return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(numericValue / 1_000_000_000)} tỷ`;
    }

    if (absValue >= 1_000_000) {
        return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(numericValue / 1_000_000)} triệu`;
    }

    if (absValue >= 1_000) {
        return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(numericValue / 1_000)} nghìn`;
    }

    return `${formatNumber(numericValue)} đ`;
}

function formatDateTime(value) {
    if (!value) {
        return 'Chưa cập nhật';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString('vi-VN');
}

function buildMonthLabel(month, year) {
    return `Tháng ${String(month).padStart(2, '0')}/${year}`;
}

function calculateAverage(totalRevenue, totalOrders) {
    if (!Number(totalOrders)) {
        return 0;
    }

    return Number(totalRevenue || 0) / Number(totalOrders || 0);
}

function resolveBarHeight(value, maxValue) {
    const numericValue = Number(value || 0);

    if (maxValue <= 0) {
        return 4;
    }

    if (numericValue <= 0) {
        return 4;
    }

    return Math.max((numericValue / maxValue) * 100, 8);
}

function SkeletonCard() {
    return (
        <div className={`${panelClass} animate-pulse p-5`}>
            <div className="h-3 w-24 rounded-full bg-primary/10" />
            <div className="mt-4 h-8 w-2/3 rounded-full bg-primary/10" />
            <div className="mt-6 h-12 rounded-[20px] bg-primary/5" />
        </div>
    );
}

function MetricCard({ icon, label, value, subtext, accent, glow }) {
    return (
        <article className={`${panelClass} relative p-5`}>
            <div className={`absolute inset-x-5 top-0 h-1 rounded-b-full bg-gradient-to-r ${accent}`} />
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary/45">{label}</p>
                    <div className="mt-4 text-[28px] font-black tracking-tight text-primary sm:text-[32px]">{value}</div>
                    <p className="mt-3 text-[13px] font-semibold text-primary/60">{subtext}</p>
                </div>
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-gradient-to-br ${accent} ${glow}`}>
                    <span className="material-symbols-outlined text-[28px] text-white">{icon}</span>
                </div>
            </div>
        </article>
    );
}

function SummaryChip({ label, value }) {
    return (
        <div className={infoCardClass}>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/40">{label}</div>
            <div className="mt-2 text-[18px] font-black text-primary">{value}</div>
        </div>
    );
}

function RevenueChartCard({
    title,
    icon,
    subtitle,
    items,
    totalRevenue,
    totalOrders,
    loading,
    emptyLabel,
    minChartWidth,
}) {
    const maxValue = items.reduce((currentMax, item) => Math.max(currentMax, Number(item.revenue || 0)), 0);

    return (
        <section className={`${panelClass} relative p-5 sm:p-6`}>
            {loading ? (
                <div className="pointer-events-none absolute inset-0 z-10 bg-white/55 backdrop-blur-[1px]" />
            ) : null}
            <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-gold/15 text-gold">
                                <span className="material-symbols-outlined text-[24px]">{icon}</span>
                            </div>
                            <div>
                                <h2 className="text-[22px] font-black tracking-tight text-primary">{title}</h2>
                                <p className="mt-1 text-[13px] text-primary/60">{subtitle}</p>
                            </div>
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
                        <SummaryChip label="Tổng doanh thu" value={formatCompactCurrency(totalRevenue)} />
                        <SummaryChip label="Đơn hợp lệ" value={formatNumber(totalOrders)} />
                        <SummaryChip label="TB / đơn" value={formatCompactCurrency(calculateAverage(totalRevenue, totalOrders))} />
                    </div>
                </div>

                <div className="overflow-x-auto pb-2">
                    <div className="relative rounded-[26px] border border-primary/10 bg-[#f8f4ec] px-4 pb-5 pt-6">
                        <div className="pointer-events-none absolute inset-x-4 top-6 bottom-16 flex flex-col justify-between">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="border-t border-dashed border-primary/10" />
                            ))}
                        </div>
                        <div className="relative flex h-[296px] items-end gap-3" style={{ minWidth: `${minChartWidth}px` }}>
                            {items.map((item) => {
                                const revenue = Number(item.revenue || 0);
                                const ordersCount = Number(item.orders_count || 0);
                                const barHeight = resolveBarHeight(revenue, maxValue);
                                const isCurrent = Boolean(item.is_current);
                                const barTone = isCurrent
                                    ? 'from-primary to-primary/75'
                                    : revenue > 0
                                        ? 'from-gold to-brick/85'
                                        : 'from-primary/20 to-primary/10';

                                return (
                                    <div key={item.key} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-3">
                                        <div className="relative flex h-[234px] w-full items-end justify-center">
                                            <div className="pointer-events-none absolute -top-2 left-1/2 z-10 w-max -translate-x-1/2 rounded-2xl bg-primary px-3 py-2 text-center text-[11px] font-bold text-white opacity-0 shadow-xl transition duration-150 group-hover:-translate-y-1 group-hover:opacity-100">
                                                <div>{item.label}</div>
                                                <div className="mt-1">{formatCurrency(revenue)}</div>
                                                <div className="mt-1 text-white/75">{formatNumber(ordersCount)} đơn</div>
                                            </div>
                                            <div className="flex h-full w-full max-w-[26px] items-end">
                                                <div
                                                    className={`w-full rounded-[18px] bg-gradient-to-t ${barTone} shadow-[0_22px_34px_-22px_rgba(15,23,42,0.7)] transition duration-150 group-hover:brightness-110`}
                                                    style={{ height: `${barHeight}%` }}
                                                    title={`${item.label} - ${formatCurrency(revenue)} - ${formatNumber(ordersCount)} đơn`}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1 text-center">
                                            <div className={`text-[11px] font-black uppercase tracking-[0.18em] ${isCurrent ? 'text-primary' : 'text-primary/55'}`}>
                                                {item.short_label}
                                            </div>
                                            <div className="text-[11px] font-semibold text-primary/35">{formatNumber(ordersCount)}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {!totalOrders ? (
                    <div className="rounded-[22px] border border-dashed border-primary/15 bg-primary/[0.03] px-4 py-4 text-[13px] font-semibold text-primary/55">
                        {emptyLabel}
                    </div>
                ) : null}
            </div>
        </section>
    );
}

export default function AdminDashboard() {
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [filters, setFilters] = useState({
        month: fallbackMonth,
        year: fallbackYear,
    });
    const [isPending, startTransition] = React.useTransition();

    useEffect(() => {
        document.title = `${pageTitle} | Admin`;
    }, []);

    useEffect(() => {
        let ignore = false;

        async function loadDashboard() {
            setLoading(true);

            try {
                const response = await reportApi.getDashboard({
                    month: filters.month,
                    year: filters.year,
                });

                if (ignore) {
                    return;
                }

                setDashboard(response.data || {});
                setNotice(null);
            } catch (error) {
                if (!ignore) {
                    setNotice({
                        type: 'error',
                        message: error.response?.data?.message || 'Không thể tải dữ liệu dashboard.',
                    });
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        }

        loadDashboard();

        return () => {
            ignore = true;
        };
    }, [filters.month, filters.year, refreshKey]);

    const summary = dashboard?.summary || {};
    const todaySummary = summary.today || {};
    const currentMonthSummary = summary.current_month || {};
    const chartFilters = dashboard?.filters || {};
    const selectedMonth = Number(chartFilters.selected_month || filters.month || fallbackMonth);
    const selectedYear = Number(chartFilters.selected_year || filters.year || fallbackYear);
    const availableYears = (chartFilters.available_years || [selectedYear]).map((value) => Number(value));
    const dailyChart = dashboard?.charts?.daily_in_month || { series: [], total_revenue: 0, total_orders: 0, label: buildMonthLabel(selectedMonth, selectedYear) };
    const monthlyChart = dashboard?.charts?.monthly_in_year || { series: [], total_revenue: 0, total_orders: 0, label: String(selectedYear) };
    const meta = dashboard?.meta || {};

    const cards = [
        {
            icon: 'today',
            label: 'Doanh thu hôm nay',
            value: formatCurrency(todaySummary.revenue || 0),
            subtext: `${todaySummary.label || 'Hôm nay'} | ${formatNumber(todaySummary.orders_count || 0)} đơn hợp lệ`,
            accent: 'from-primary via-primary/90 to-primary/70',
            glow: 'shadow-[0_20px_34px_-20px_rgba(15,23,42,0.85)]',
        },
        {
            icon: 'calendar_month',
            label: 'Doanh thu tháng hiện tại',
            value: formatCurrency(currentMonthSummary.revenue || 0),
            subtext: `${currentMonthSummary.label || buildMonthLabel(fallbackMonth, fallbackYear)} | ${formatNumber(currentMonthSummary.orders_count || 0)} đơn hợp lệ`,
            accent: 'from-gold via-[#d6a84f] to-[#e2bc74]',
            glow: 'shadow-[0_20px_34px_-20px_rgba(198,154,57,0.65)]',
        },
        {
            icon: 'receipt_long',
            label: 'Số đơn hôm nay',
            value: formatNumber(todaySummary.orders_count || 0),
            subtext: `Giá trị TB ${formatCompactCurrency(todaySummary.average_order_value || 0)} / đơn`,
            accent: 'from-brick via-[#c46d43] to-[#d28862]',
            glow: 'shadow-[0_20px_34px_-20px_rgba(175,89,48,0.6)]',
        },
        {
            icon: 'stacked_line_chart',
            label: 'Số đơn tháng hiện tại',
            value: formatNumber(currentMonthSummary.orders_count || 0),
            subtext: `Giá trị TB ${formatCompactCurrency(currentMonthSummary.average_order_value || 0)} / đơn`,
            accent: 'from-stone via-[#6b7280] to-[#9ca3af]',
            glow: 'shadow-[0_20px_34px_-20px_rgba(100,116,139,0.55)]',
        },
    ];

    const handleFilterChange = (field, value) => {
        startTransition(() => {
            setFilters((previous) => ({
                ...previous,
                [field]: Number(value),
            }));
        });
    };

    return (
        <div className="min-h-full bg-[#f4efe6]">
            <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
                <section className={`${panelClass} p-5 sm:p-6`}>
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-primary/55">
                                Tổng quan
                            </div>
                            <h1 className="mt-4 text-[32px] font-black tracking-tight text-primary sm:text-[40px]">
                                Tổng quan doanh thu từ đơn hàng thật
                            </h1>
                            <p className="mt-3 max-w-2xl text-[14px] leading-7 text-primary/65">
                                Tổng hợp KPI và doanh số theo đúng logic doanh thu hiện tại của hệ thống. Chỉ tính đơn hoàn tất hợp lệ,
                                không dùng dữ liệu mẫu.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
                            <div className={infoCardClass}>
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/40">Cập nhật</div>
                                <div className="mt-2 text-[15px] font-black text-primary">{formatDateTime(meta.generated_at)}</div>
                            </div>
                            <div className={infoCardClass}>
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/40">Kỳ chart</div>
                                <div className="mt-2 text-[15px] font-black text-primary">
                                    {buildMonthLabel(selectedMonth, selectedYear)} / {selectedYear}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {notice ? (
                    <div className={`rounded-[24px] border px-4 py-3 text-[13px] font-semibold ${notice.type === 'error' ? 'border-brick/25 bg-brick/10 text-brick' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {notice.message}
                    </div>
                ) : null}

                {!dashboard && loading ? (
                    <>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <SkeletonCard />
                            <SkeletonCard />
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                        <div className="grid gap-6 xl:grid-cols-2">
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                    </>
                ) : (
                    <>
                        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            {cards.map((card) => (
                                <MetricCard
                                    key={card.label}
                                    icon={card.icon}
                                    label={card.label}
                                    value={card.value}
                                    subtext={card.subtext}
                                    accent={card.accent}
                                    glow={card.glow}
                                />
                            ))}
                        </section>

                        <section className={`${panelClass} p-5 sm:p-6`}>
                            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                                <div className="max-w-3xl">
                                    <h2 className="text-[24px] font-black tracking-tight text-primary">Bộ lọc và logic tính doanh thu</h2>
                                    <p className="mt-2 text-[14px] leading-7 text-primary/65">
                                        Chart ngày theo tháng dùng bộ lọc dưới đây. Chart tháng theo năm dùng cùng năm được chọn.
                                        KPI phía trên vẫn phản ánh hôm nay và tháng hiện tại.
                                    </p>
                                </div>

                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                    <label className="flex flex-col gap-2">
                                        <span className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/45">Tháng</span>
                                        <select
                                            className={inputClass}
                                            value={selectedMonth}
                                            onChange={(event) => handleFilterChange('month', event.target.value)}
                                        >
                                            {monthOptions.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="flex flex-col gap-2">
                                        <span className="text-[11px] font-black uppercase tracking-[0.22em] text-primary/45">Năm</span>
                                        <select
                                            className={inputClass}
                                            value={selectedYear}
                                            onChange={(event) => handleFilterChange('year', event.target.value)}
                                        >
                                            {availableYears.map((yearValue) => (
                                                <option key={yearValue} value={yearValue}>
                                                    {yearValue}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <button
                                        type="button"
                                        className={buttonClass}
                                        onClick={() => setRefreshKey((value) => value + 1)}
                                        disabled={loading || isPending}
                                    >
                                        <span className="material-symbols-outlined text-[18px]">refresh</span>
                                        {loading || isPending ? 'Đang tải' : 'Tải lại'}
                                    </button>
                                </div>
                            </div>

                            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                                <SummaryChip label="Trạng thái tính" value="Hoàn tất" />
                                <SummaryChip label="Phạm vi đơn" value="Đơn chính thức + đơn thường" />
                                <SummaryChip label="Cơ sở tính" value="Ngày chốt đơn + doanh thu báo cáo" />
                            </div>
                        </section>

                        <div className="grid gap-6 2xl:grid-cols-2">
                            <RevenueChartCard
                                title="Doanh số theo ngày trong tháng"
                                icon="bar_chart"
                                subtitle={`Kỳ đang xem: ${dailyChart.label || buildMonthLabel(selectedMonth, selectedYear)}`}
                                items={dailyChart.series || []}
                                totalRevenue={dailyChart.total_revenue || 0}
                                totalOrders={dailyChart.total_orders || 0}
                                loading={loading || isPending}
                                emptyLabel="Không có đơn hợp lệ trong tháng đang chọn."
                                minChartWidth={Math.max((dailyChart.series || []).length * 30, 760)}
                            />

                            <RevenueChartCard
                                title="Doanh số theo tháng trong năm"
                                icon="insights"
                                subtitle={`Tổng quan năm ${monthlyChart.label || selectedYear}`}
                                items={monthlyChart.series || []}
                                totalRevenue={monthlyChart.total_revenue || 0}
                                totalOrders={monthlyChart.total_orders || 0}
                                loading={loading || isPending}
                                emptyLabel="Không có đơn hợp lệ trong năm đang chọn."
                                minChartWidth={Math.max((monthlyChart.series || []).length * 56, 720)}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
