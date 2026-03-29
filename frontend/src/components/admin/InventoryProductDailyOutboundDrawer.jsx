import React, { useEffect, useMemo, useState } from 'react';
import { reportApi } from '../../services/api';

const emptyState = {
    dates: [],
    rows: [],
    summary_row: { totals: { quantity: 0, cost_amount: 0, revenue_amount: 0 }, days: {} },
    summary: { total_quantity: 0, total_cost_amount: 0, total_revenue_amount: 0 },
    filters: { date_from: '', date_to: '', product_id: null },
};

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));
const formatCurrency = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0)))}đ`;
const formatShortDate = (value) => {
    if (!value) return '-';
    const matched = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (matched) return `${matched[3]}/${matched[2]}/${matched[1]}`;
    return value;
};

const toDateInputValue = (date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const buildDefaultRange = (daysBack = 6) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - daysBack);
    return {
        date_from: toDateInputValue(from),
        date_to: toDateInputValue(to),
    };
};

const getStockAlertMeta = (product) => {
    const stock = Number(product?.computed_stock ?? 0);
    const normalizedAlert = String(product?.stock_alert || '').trim();

    if (normalizedAlert === 'out' || stock <= 0) {
        return {
            label: 'Hết hàng',
            badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
        };
    }

    if (normalizedAlert === 'low' || stock <= 5) {
        return {
            label: 'Sắp hết',
            badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
        };
    }

    return {
        label: 'An toàn',
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
};

const clampDateRange = (dateFrom, dateTo) => {
    const from = String(dateFrom || '').trim();
    const to = String(dateTo || '').trim();
    if (from && to && from > to) {
        return { date_from: to, date_to: from };
    }
    return { date_from: from, date_to: to };
};

const InventoryProductDailyOutboundDrawer = ({ open, product, onClose }) => {
    const [filters, setFilters] = useState(() => buildDefaultRange());
    const [reportState, setReportState] = useState(emptyState);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        if (!open) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose?.();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    useEffect(() => {
        if (!open || !product?.id) return;
        setFilters(buildDefaultRange());
    }, [open, product?.id]);

    useEffect(() => {
        if (!open || !product?.id) return undefined;

        const normalizedRange = clampDateRange(filters.date_from, filters.date_to);
        let active = true;
        setLoading(true);
        setErrorMessage('');

        reportApi.getProductSalesByDay({
            product_id: product.id,
            date_from: normalizedRange.date_from,
            date_to: normalizedRange.date_to,
            force_refresh: 1,
        })
            .then((response) => {
                if (!active) return;
                setReportState({ ...emptyState, ...(response?.data || {}) });
            })
            .catch((error) => {
                if (!active) return;
                console.error('Error loading product daily outbound report', error);
                setReportState(emptyState);
                setErrorMessage(error.response?.data?.message || 'Không thể tải hàng đi hàng ngày cho sản phẩm này.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [filters.date_from, filters.date_to, open, product?.id]);

    const dayRows = useMemo(() => (
        (reportState.dates || []).map((date) => ({
            ...date,
            metrics: reportState.summary_row?.days?.[date.date] || { quantity: 0, cost_amount: 0, revenue_amount: 0 },
        }))
    ), [reportState.dates, reportState.summary_row]);

    const childRows = useMemo(() => (
        (reportState.rows || [])
            .flatMap((row) => Array.isArray(row.children) ? row.children : [])
            .filter((row) => row)
    ), [reportState.rows]);
    const stockAlertMeta = useMemo(() => getStockAlertMeta(product), [product]);

    const quickRanges = [
        { id: '7d', label: '7 ngày', daysBack: 6 },
        { id: '14d', label: '14 ngày', daysBack: 13 },
        { id: '30d', label: '30 ngày', daysBack: 29 },
    ];
    const activeQuickRangeId = quickRanges.find((range) => {
        const normalized = buildDefaultRange(range.daysBack);
        return normalized.date_from === filters.date_from && normalized.date_to === filters.date_to;
    })?.id;

    if (!open || !product) return null;

    return (
        <div className="fixed inset-0 z-[130]">
            <div className="absolute inset-0 bg-slate-950/35" onClick={onClose} />
            <div className="absolute inset-y-0 right-0 flex w-full justify-end">
                <div className="flex h-full w-full max-w-[920px] flex-col border-l border-primary/10 bg-[#f8fafc] shadow-[-24px_0_70px_-20px_rgba(15,23,42,0.35)]">
                    <div className="border-b border-primary/10 bg-white px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary/40">Hàng đi hàng ngày</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="rounded-sm border border-primary/10 bg-primary/[0.04] px-2.5 py-1 font-mono text-[11px] font-black text-primary">{product.sku || 'Chưa có mã'}</span>
                                    <span className={`rounded-sm border px-2.5 py-1 text-[11px] font-black ${stockAlertMeta.badgeClass}`}>
                                        {stockAlertMeta.label}
                                    </span>
                                </div>
                                <div className="mt-2 truncate text-[20px] font-black text-primary">{product.name}</div>
                                <div className="mt-1 text-[12px] text-primary/55">
                                    Tồn hiện tại: <span className="font-black text-primary">{formatNumber(product.computed_stock || 0)}</span>
                                    {' '}• Giá trị tồn: <span className="font-black text-primary">{formatCurrency(product.inventory_value || 0)}</span>
                                </div>
                            </div>
                            <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-primary/15 bg-white text-primary/65 transition hover:border-primary hover:bg-primary/[0.04] hover:text-primary">
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            {quickRanges.map((range) => (
                                <button
                                    key={range.id}
                                    type="button"
                                    onClick={() => setFilters(buildDefaultRange(range.daysBack))}
                                    className={`inline-flex h-8 items-center rounded-sm border px-3 text-[12px] font-black transition ${
                                        activeQuickRangeId === range.id
                                            ? 'border-primary bg-primary text-white'
                                            : 'border-primary/15 bg-white text-primary hover:border-primary hover:bg-primary/[0.04]'
                                    }`}
                                >
                                    {range.label}
                                </button>
                            ))}
                            <input
                                type="date"
                                value={filters.date_from}
                                onChange={(event) => setFilters((prev) => clampDateRange(event.target.value, prev.date_to))}
                                className="h-8 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-semibold text-primary outline-none focus:border-primary"
                            />
                            <input
                                type="date"
                                value={filters.date_to}
                                onChange={(event) => setFilters((prev) => clampDateRange(prev.date_from, event.target.value))}
                                className="h-8 rounded-sm border border-primary/15 bg-white px-3 text-[12px] font-semibold text-primary outline-none focus:border-primary"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-5">
                        <div className="grid gap-3 md:grid-cols-3">
                            <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Tổng hàng đi</div>
                                <div className="mt-2 text-[24px] font-black text-primary">{formatNumber(reportState.summary?.total_quantity || 0)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Giá vốn</div>
                                <div className="mt-2 text-[24px] font-black text-primary">{formatCurrency(reportState.summary?.total_cost_amount || 0)}</div>
                            </div>
                            <div className="rounded-sm border border-primary/10 bg-white px-4 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Doanh thu</div>
                                <div className="mt-2 text-[24px] font-black text-primary">{formatCurrency(reportState.summary?.total_revenue_amount || 0)}</div>
                            </div>
                        </div>

                        <div className="mt-5 overflow-hidden rounded-sm border border-primary/10 bg-white">
                            <div className="border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                <div className="text-[14px] font-black text-primary">Theo ngày</div>
                                <div className="mt-1 text-[11px] text-primary/55">Dữ liệu lấy từ báo cáo hàng đi hàng ngày hiện có, lọc riêng theo sản phẩm đang xem.</div>
                            </div>
                            {loading ? (
                                <div className="px-4 py-10 text-center text-[13px] text-primary/55">Đang tải dữ liệu...</div>
                            ) : errorMessage ? (
                                <div className="px-4 py-10 text-center text-[13px] text-rose-600">{errorMessage}</div>
                            ) : dayRows.length === 0 ? (
                                <div className="px-4 py-10 text-center text-[13px] text-primary/55">Không có hàng đi trong khoảng thời gian đang chọn.</div>
                            ) : (
                                <div className="overflow-auto">
                                    <table className="w-full border-collapse">
                                        <thead className="sticky top-0 bg-white">
                                            <tr>
                                                <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Ngày</th>
                                                <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL đi</th>
                                                <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Giá vốn</th>
                                                <th className="border-b border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Doanh thu</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dayRows.map((row) => (
                                                <tr key={row.date} className="hover:bg-primary/[0.02]">
                                                    <td className="border-b border-r border-primary/10 px-4 py-3 text-[13px] font-semibold text-primary">
                                                        <div>{row.label}</div>
                                                        <div className="mt-0.5 text-[11px] text-primary/45">{formatShortDate(row.date)}</div>
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(row.metrics.quantity || 0)}</td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatCurrency(row.metrics.cost_amount || 0)}</td>
                                                    <td className="border-b border-primary/10 px-3 py-3 text-right text-[13px] font-black text-brick">{formatCurrency(row.metrics.revenue_amount || 0)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {childRows.length > 0 ? (
                            <div className="mt-5 overflow-hidden rounded-sm border border-primary/10 bg-white">
                                <div className="border-b border-primary/10 bg-[#fbfcfe] px-4 py-3">
                                    <div className="text-[14px] font-black text-primary">Chi tiết biến thể</div>
                                    <div className="mt-1 text-[11px] text-primary/55">Nếu sản phẩm gốc có biến thể, phần này hiển thị lượng hàng đi của từng biến thể trong cùng khoảng ngày.</div>
                                </div>
                                <div className="overflow-auto">
                                    <table className="w-full border-collapse">
                                        <thead className="bg-white">
                                            <tr>
                                                <th className="border-b border-r border-primary/10 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Biến thể</th>
                                                <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">SL đi</th>
                                                <th className="border-b border-r border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Giá vốn</th>
                                                <th className="border-b border-primary/10 px-3 py-3 text-right text-[11px] font-black uppercase tracking-[0.12em] text-primary/45">Doanh thu</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {childRows.map((row) => (
                                                <tr key={row.row_key} className="hover:bg-primary/[0.02]">
                                                    <td className="border-b border-r border-primary/10 px-4 py-3">
                                                        <div className="text-[13px] font-black text-primary">{row.product_name}</div>
                                                        <div className="mt-0.5 font-mono text-[11px] font-bold text-primary/55">{row.product_sku || 'Không có mã'}</div>
                                                    </td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatNumber(row.totals?.quantity || 0)}</td>
                                                    <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-primary">{formatCurrency(row.totals?.cost_amount || 0)}</td>
                                                    <td className="border-b border-primary/10 px-3 py-3 text-right text-[13px] font-black text-brick">{formatCurrency(row.totals?.revenue_amount || 0)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InventoryProductDailyOutboundDrawer;
