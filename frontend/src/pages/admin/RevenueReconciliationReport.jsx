import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { financeApi } from '../../services/api';

const formatNumber = (value) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value || 0));

const formatMonthInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const formatDateTime = (value) => {
    if (!value) return '-';

    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

const normalizeText = (value) =>
    String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

const AD_CHANNEL_OPTIONS = [
    { value: 'all', label: 'Tất cả kênh' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'google', label: 'Google' },
];

const STATUS_LABELS = {
    pending: 'Chờ xử lý',
    processing: 'Đang xử lý',
    confirmed: 'Đã xác nhận',
    shipping: 'Đang giao',
    shipped: 'Đã gửi',
    delivered: 'Đã giao',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
    canceled: 'Đã hủy',
    returned: 'Hoàn',
};

const ORDER_TYPE_LABELS = {
    standard: 'Đơn thường',
    exchange_return: 'Đổi trả',
    partial_delivery: 'Giao 1 phần',
};

const reasonBadgeClass = (code) => {
    switch (code) {
        case 'status_not_completed':
            return 'border-amber-200 bg-amber-50 text-amber-700';
        case 'report_revenue_zero':
            return 'border-red-200 bg-red-50 text-red-700';
        case 'amount_mismatch':
            return 'border-blue-200 bg-blue-50 text-blue-700';
        case 'order_type_mismatch':
            return 'border-purple-200 bg-purple-50 text-purple-700';
        default:
            return 'border-gray-200 bg-gray-50 text-gray-600';
    }
};

const statusBadgeClass = (status) => {
    switch (String(status || '').toLowerCase()) {
        case 'completed':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        case 'cancelled':
        case 'canceled':
            return 'border-red-200 bg-red-50 text-red-700';
        case 'processing':
        case 'shipping':
        case 'shipped':
            return 'border-blue-200 bg-blue-50 text-blue-700';
        default:
            return 'border-gray-200 bg-gray-50 text-gray-600';
    }
};

const getStatusLabel = (status) => STATUS_LABELS[String(status || '').toLowerCase()] || status || '-';
const getOrderTypeLabel = (type) => ORDER_TYPE_LABELS[String(type || 'standard').toLowerCase()] || type || 'Đơn thường';

const moneyClass = (value) => {
    const number = Number(value || 0);
    if (number > 0) return 'text-red-600';
    if (number < 0) return 'text-emerald-700';
    return 'text-gray-700';
};

const SummaryMetric = ({ label, value, tone = 'default' }) => {
    const toneClass = {
        default: 'text-gray-900',
        red: 'text-red-600',
        green: 'text-emerald-700',
        blue: 'text-blue-700',
    }[tone] || 'text-gray-900';

    return (
        <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
            <div className={`mt-2 text-[24px] font-black leading-tight ${toneClass}`}>{value}</div>
        </div>
    );
};

const RevenueReconciliationReport = () => {
    const navigate = useNavigate();
    const [month, setMonth] = useState(() => formatMonthInput(new Date()));
    const [adChannel, setAdChannel] = useState('all');
    const [search, setSearch] = useState('');
    const [reasonFilter, setReasonFilter] = useState('all');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [report, setReport] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    const loadReport = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            const response = await financeApi.getRevenueReconciliation({
                month,
                ad_channel: adChannel,
            });

            setReport(response?.data?.data || null);
        } catch (requestError) {
            setReport(null);
            setError(requestError.response?.data?.message || 'Không tải được bảng đối soát doanh thu.');
        } finally {
            setLoading(false);
        }
    }, [adChannel, month]);

    useEffect(() => {
        loadReport();
    }, [loadReport, reloadKey]);

    const orders = report?.orders || [];
    const summary = report?.summary || {};
    const reasonSummary = report?.reason_summary || [];

    const filteredOrders = useMemo(() => {
        const normalizedSearch = normalizeText(search);

        return orders.filter((order) => {
            if (reasonFilter !== 'all' && !(order.reason_codes || []).includes(reasonFilter)) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            const haystack = normalizeText([
                order.order_number,
                order.customer_name,
                order.customer_phone,
                order.status,
                order.order_type,
                ...(order.reason_labels || []),
            ].join(' '));

            return haystack.includes(normalizedSearch);
        });
    }, [orders, reasonFilter, search]);

    const reasonOptions = useMemo(() => {
        const options = new Map();

        reasonSummary.forEach((item) => {
            if (item?.code) {
                options.set(item.code, item.label || item.code);
            }
        });

        orders.forEach((order) => {
            (order.reason_codes || []).forEach((code, index) => {
                if (!options.has(code)) {
                    options.set(code, order.reason_labels?.[index] || code);
                }
            });
        });

        return Array.from(options.entries()).map(([value, label]) => ({ value, label }));
    }, [orders, reasonSummary]);

    const difference = Number(summary.difference || 0);

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="mb-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                            <span className="material-symbols-outlined text-[22px]">difference</span>
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-[22px] font-black tracking-tight text-gray-900">Đối soát doanh thu</h1>
                            <div className="mt-1 text-[12px] font-semibold text-gray-500">
                                {report?.month_label || month} · {report?.ad_channel_label || 'Tất cả'}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Tháng</span>
                            <input
                                type="month"
                                value={month}
                                onChange={(event) => setMonth(event.target.value)}
                                className="h-8 rounded-sm border border-gray-200 bg-white px-2 text-[13px] font-bold text-gray-700 outline-none focus:border-emerald-500"
                            />
                        </label>
                        <label className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Kênh</span>
                            <select
                                value={adChannel}
                                onChange={(event) => setAdChannel(event.target.value)}
                                className="h-8 rounded-sm border border-gray-200 bg-white px-2 text-[13px] font-bold text-gray-700 outline-none focus:border-emerald-500"
                            >
                                {AD_CHANNEL_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            onClick={() => setReloadKey((value) => value + 1)}
                            disabled={loading}
                            className="inline-flex h-12 items-center gap-2 rounded-md bg-gray-900 px-4 text-[13px] font-bold text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-70"
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                            {loading ? 'Đang tải' : 'Làm mới'}
                        </button>
                    </div>
                </div>
            </div>

            {error ? (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-red-700">
                    {error}
                </div>
            ) : null}

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SummaryMetric label="Doanh thu báo cáo ngày" value={formatNumber(summary.daily_revenue)} tone="blue" />
                <SummaryMetric label="Doanh thu báo cáo tháng" value={formatNumber(summary.monthly_revenue)} tone="green" />
                <SummaryMetric label="Chênh lệch" value={formatNumber(difference)} tone={difference >= 0 ? 'red' : 'green'} />
                <SummaryMetric label="Đơn gây lệch" value={formatNumber(summary.different_order_count)} />
            </div>

            <div className="mb-4 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                        <div className="relative min-w-[240px] flex-1">
                            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-gray-400">search</span>
                            <input
                                type="search"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Tìm mã đơn, khách, số điện thoại"
                                className="h-10 w-full rounded-md border border-gray-200 bg-gray-50 pl-10 pr-3 text-[13px] font-semibold text-gray-700 outline-none focus:border-emerald-500 focus:bg-white"
                            />
                        </div>
                        <select
                            value={reasonFilter}
                            onChange={(event) => setReasonFilter(event.target.value)}
                            className="h-10 rounded-md border border-gray-200 bg-gray-50 px-3 text-[13px] font-bold text-gray-700 outline-none focus:border-emerald-500 focus:bg-white"
                        >
                            <option value="all">Tất cả lý do</option>
                            {reasonOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {reasonSummary.length === 0 ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-bold text-emerald-700">
                                Không có lệch
                            </span>
                        ) : reasonSummary.map((item) => (
                            <button
                                key={item.code}
                                type="button"
                                onClick={() => setReasonFilter((current) => (current === item.code ? 'all' : item.code))}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-bold transition ${reasonBadgeClass(item.code)} ${reasonFilter === item.code ? 'ring-2 ring-offset-1 ring-gray-300' : ''}`}
                            >
                                <span>{item.label}</span>
                                <span>{formatNumber(item.order_count)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
                <div className="max-h-[68vh] min-h-[420px] overflow-auto">
                    <table className="min-w-[1320px] w-full border-collapse text-left text-[13px]">
                        <thead className="sticky top-0 z-20 border-b border-gray-200 bg-gray-100 text-[11px] uppercase tracking-wide text-gray-600">
                            <tr>
                                <th className="w-[190px] px-4 py-3 font-black">Đơn hàng</th>
                                <th className="w-[170px] px-4 py-3 font-black">Ngày chốt</th>
                                <th className="w-[150px] px-4 py-3 font-black">Trạng thái</th>
                                <th className="w-[130px] px-4 py-3 font-black">Loại đơn</th>
                                <th className="w-[150px] px-4 py-3 text-right font-black">DT ngày</th>
                                <th className="w-[150px] px-4 py-3 text-right font-black">DT tháng</th>
                                <th className="w-[150px] px-4 py-3 text-right font-black">Lệch</th>
                                <th className="min-w-[280px] px-4 py-3 font-black">Lý do</th>
                                <th className="w-[70px] px-4 py-3 text-center font-black">Mở</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-14 text-center text-[13px] font-bold text-gray-400">
                                        Đang tải dữ liệu đối soát...
                                    </td>
                                </tr>
                            ) : filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-14 text-center text-[13px] font-bold text-gray-400">
                                        Không có đơn chênh lệch trong bộ lọc này.
                                    </td>
                                </tr>
                            ) : filteredOrders.map((order) => (
                                <tr key={order.id} className="transition hover:bg-gray-50">
                                    <td className="px-4 py-3 align-top">
                                        <div className="font-black text-gray-900">{order.order_number || `#${order.id}`}</div>
                                        <div className="mt-1 max-w-[180px] truncate text-[12px] font-semibold text-gray-500">
                                            {order.customer_name || 'Khách lẻ'}{order.customer_phone ? ` · ${order.customer_phone}` : ''}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 align-top font-semibold text-gray-600">{formatDateTime(order.officialized_at)}</td>
                                    <td className="px-4 py-3 align-top">
                                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${statusBadgeClass(order.status)}`}>
                                            {getStatusLabel(order.status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 align-top font-semibold text-gray-600">{getOrderTypeLabel(order.order_type)}</td>
                                    <td className="px-4 py-3 text-right align-top font-black text-blue-700">{formatNumber(order.daily_revenue)}</td>
                                    <td className="px-4 py-3 text-right align-top font-black text-emerald-700">{formatNumber(order.monthly_revenue)}</td>
                                    <td className={`px-4 py-3 text-right align-top font-black ${moneyClass(order.difference)}`}>{formatNumber(order.difference)}</td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="flex flex-wrap gap-1.5">
                                            {(order.reason_codes || ['other']).map((code, index) => (
                                                <span
                                                    key={`${order.id}-${code}-${index}`}
                                                    className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${reasonBadgeClass(code)}`}
                                                >
                                                    {order.reason_labels?.[index] || code}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center align-top">
                                        <button
                                            type="button"
                                            onClick={() => navigate(`/admin/orders/${order.id}`)}
                                            className="inline-flex size-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:border-emerald-300 hover:text-emerald-700"
                                            title="Mở đơn hàng"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default RevenueReconciliationReport;
