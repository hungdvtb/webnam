import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Pagination from '../Pagination';
import AdminStatusBadge from './AdminStatusBadge';
import { orderApi } from '../../services/api';
import { getOrderTypeMeta } from '../../config/orderTypes';

const FOLLOWUP_FILTER_ALL = 'all';

const FOLLOWUP_FILTER_OPTIONS = [
    {
        value: FOLLOWUP_FILTER_ALL,
        label: 'Tất cả',
        description: 'Toàn bộ đơn đang treo cần rà soát.',
        tone: 'border-primary/15 bg-[#F7F9FC] text-primary',
        activeTone: 'border-primary bg-primary text-white shadow-sm',
    },
    {
        value: 'pending_return',
        label: 'Chờ hoàn',
        description: 'Đơn đã vào Chờ hoàn từ 10 ngày trở lên.',
        tone: 'border-amber-200 bg-amber-50 text-amber-800',
        activeTone: 'border-amber-500 bg-amber-500 text-white shadow-sm',
    },
    {
        value: 'exchange_return',
        label: 'Đổi hàng',
        description: 'Đơn đổi hàng có hàng nhận về nhưng chưa sang trạng thái đích.',
        tone: 'border-orange-200 bg-orange-50 text-orange-800',
        activeTone: 'border-orange-500 bg-orange-500 text-white shadow-sm',
    },
    {
        value: 'partial_delivery',
        label: 'Giao 1 phần',
        description: 'Đơn giao 1 phần đã gửi đi lâu nhưng còn treo.',
        tone: 'border-sky-200 bg-sky-50 text-sky-800',
        activeTone: 'border-sky-500 bg-sky-500 text-white shadow-sm',
    },
];

const FOLLOWUP_CATEGORY_LABELS = {
    pending_return: 'Chờ hoàn',
    exchange_return: 'Đổi hàng',
    partial_delivery: 'Giao hàng 1 phần',
};

const FOLLOWUP_CATEGORY_BADGES = {
    pending_return: 'border-amber-200 bg-amber-50 text-amber-800',
    exchange_return: 'border-orange-200 bg-orange-50 text-orange-800',
    partial_delivery: 'border-sky-200 bg-sky-50 text-sky-800',
};

const EMPTY_COUNTS = {
    all: 0,
    pending_return: 0,
    exchange_return: 0,
    partial_delivery: 0,
};

const formatDateTimeParts = (value) => {
    if (!value) {
        return { date: '-', time: '', text: '-' };
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { date: '-', time: '', text: '-' };
    }

    const date = new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(parsed);
    const time = new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
    }).format(parsed);

    return {
        date,
        time,
        text: `${date} ${time}`,
    };
};

const formatNumber = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0));

const getRelevantDateCaption = (mode) => (
    mode === 'status_changed'
        ? 'Vào Chờ hoàn'
        : 'Ngày gửi đi'
);

const normalizeSearchTerms = (terms = []) => (
    Array.isArray(terms)
        ? terms
            .map((term) => String(term || '').trim())
            .filter(Boolean)
            .slice(0, 20)
        : []
);

const OrderReturnFollowupPanel = ({
    statusMap,
    onOpenOrder,
    refreshToken = 0,
    searchTerms = [],
}) => {
    const abortRef = useRef(null);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState(FOLLOWUP_FILTER_ALL);
    const [pagination, setPagination] = useState({
        current_page: 1,
        last_page: 1,
        total: 0,
        per_page: 20,
    });
    const [meta, setMeta] = useState({
        minimum_stalled_days: 10,
        counts: EMPTY_COUNTS,
    });

    const preparedSearchTerms = useMemo(
        () => normalizeSearchTerms(searchTerms),
        [searchTerms]
    );
    const searchKey = useMemo(
        () => JSON.stringify(preparedSearchTerms),
        [preparedSearchTerms]
    );

    const fetchRecords = useCallback(async (
        page = 1,
        nextFilter = filter,
        perPage = pagination.per_page,
        nextSearchTerms = preparedSearchTerms,
    ) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        setError('');

        try {
            const response = await orderApi.getReturnFollowups({
                page,
                per_page: perPage,
                category: nextFilter,
                search_terms: nextSearchTerms,
            }, controller.signal);

            if (controller.signal.aborted) {
                return;
            }

            setRecords(Array.isArray(response.data?.data) ? response.data.data : []);
            setPagination({
                current_page: Number(response.data?.current_page || 1),
                last_page: Number(response.data?.last_page || 1),
                total: Number(response.data?.total || 0),
                per_page: Number(response.data?.per_page || perPage),
            });
            setMeta({
                minimum_stalled_days: Number(response.data?.meta?.minimum_stalled_days || 10),
                counts: {
                    all: Number(response.data?.meta?.counts?.all || 0),
                    pending_return: Number(response.data?.meta?.counts?.pending_return || 0),
                    exchange_return: Number(response.data?.meta?.counts?.exchange_return || 0),
                    partial_delivery: Number(response.data?.meta?.counts?.partial_delivery || 0),
                },
            });
        } catch (fetchError) {
            if (fetchError?.code === 'ERR_CANCELED' || fetchError?.name === 'CanceledError') {
                return;
            }

            setError(fetchError?.response?.data?.message || 'Không tải được bảng rà soát đơn treo.');
            setRecords([]);
            setPagination((current) => ({
                ...current,
                current_page: 1,
                last_page: 1,
                total: 0,
            }));
            setMeta((current) => ({
                ...current,
                counts: EMPTY_COUNTS,
            }));
        } finally {
            if (!controller.signal.aborted) {
                setLoading(false);
            }
        }
    }, [filter, pagination.per_page, preparedSearchTerms]);

    useEffect(() => () => {
        abortRef.current?.abort();
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            fetchRecords(1, filter, pagination.per_page, preparedSearchTerms);
        }, 250);

        return () => {
            window.clearTimeout(timer);
            abortRef.current?.abort();
        };
    }, [fetchRecords, filter, pagination.per_page, preparedSearchTerms, refreshToken, searchKey]);

    const hasActiveSearch = preparedSearchTerms.length > 0;
    const resultCountLabel = hasActiveSearch ? 'đơn khớp' : 'đơn hiển thị';
    const emptyStateTitle = hasActiveSearch
        ? 'Không có đơn nào khớp tìm kiếm hiện tại.'
        : 'Không có đơn nào khớp bộ lọc hiện tại.';
    const emptyStateDescription = hasActiveSearch
        ? 'Thử đổi từ khóa theo tên, SĐT, mã đơn hoặc mã vận đơn.'
        : `Khi có đơn treo quá ${meta.minimum_stalled_days} ngày, bảng này sẽ tự gom lên đây.`;

    return (
        <div className="flex h-full flex-col gap-4">
            <div className="rounded-[24px] border border-primary/10 bg-white px-4 py-4 shadow-sm lg:rounded-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.05] px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-primary/70">
                                Rà soát treo hoàn
                            </span>
                            {FOLLOWUP_FILTER_OPTIONS.map((option) => {
                                const isActive = filter === option.value;
                                const count = option.value === FOLLOWUP_FILTER_ALL
                                    ? meta.counts.all
                                    : meta.counts[option.value] || 0;

                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setFilter(option.value)}
                                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[12px] font-black transition-all ${isActive ? option.activeTone : option.tone}`}
                                    >
                                        <span>{option.label}</span>
                                        <span className={`inline-flex min-w-[34px] items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-black ${isActive ? 'bg-white/15 text-white' : 'bg-white text-current shadow-sm'}`}>
                                            {formatNumber(count)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                    </div>

                    <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                        <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/[0.04] px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-primary/70">
                            {formatNumber(pagination.total)} {resultCountLabel}
                        </span>
                        <button
                            type="button"
                            onClick={() => fetchRecords(pagination.current_page || 1, filter, pagination.per_page, preparedSearchTerms)}
                            disabled={loading}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-[14px] border border-primary/15 bg-white px-4 text-[12px] font-black uppercase tracking-[0.12em] text-primary transition-all hover:bg-primary/[0.03]"
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-refresh-spin' : ''}`}>
                                {loading ? 'progress_activity' : 'refresh'}
                            </span>
                            Làm mới
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-bold text-rose-700">
                    {error}
                </div>
            )}

            <div className="hidden min-h-0 flex-1 overflow-hidden rounded-[24px] border border-primary/10 bg-white shadow-sm lg:flex lg:rounded-sm">
                <div className="flex min-h-0 w-full flex-col">
                    <div className="table-scrollbar min-h-0 flex-1 overflow-auto">
                        <table className="min-w-full table-auto border-collapse">
                            <thead className="sticky top-0 z-10 bg-[#F0F4F8] text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                                <tr>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Mã đơn</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Khách hàng</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">SĐT</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Trạng thái</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Loại đơn</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Mã vận đơn</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Ngày liên quan</th>
                                    <th className="border border-primary/10 px-3 py-3 text-center">Số ngày treo</th>
                                    <th className="border border-primary/10 px-3 py-3 text-left">Ghi chú</th>
                                </tr>
                            </thead>
                            <tbody>
                                {!loading && records.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-14 text-center">
                                            <div className="flex flex-col items-center gap-2 text-primary/45">
                                                <span className="material-symbols-outlined text-[44px]">fact_check</span>
                                                <div className="text-[15px] font-black">{emptyStateTitle}</div>
                                                <div className="text-[13px] font-semibold">
                                                    {emptyStateDescription}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    records.map((record) => {
                                        const relevantDate = formatDateTimeParts(record.relevant_date);
                                        const statusName = statusMap?.get(String(record.status))?.name || record.status || '-';
                                        const actualOrderTypeLabel = getOrderTypeMeta(record.order_type)?.label || record.order_type || '-';

                                        return (
                                            <tr
                                                key={record.id}
                                                onDoubleClick={() => onOpenOrder?.(record.id)}
                                                title="Kích đúp để mở chi tiết"
                                                className="transition-all hover:bg-primary/[0.03]"
                                            >
                                                <td className="border border-primary/10 px-3 py-3 align-top">
                                                    <div className="flex flex-col gap-2">
                                                        <div className="w-fit font-mono text-[13px] font-black text-primary">
                                                            {record.order_number}
                                                        </div>
                                                        <span className="text-[11px] font-semibold text-primary/45">
                                                            Kích đúp để mở chi tiết
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top text-[13px] font-bold text-primary">
                                                    {record.customer_name || '-'}
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top text-[13px] font-black text-primary">
                                                    {record.customer_phone || '-'}
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top">
                                                    <AdminStatusBadge
                                                        label={statusName}
                                                        color={statusMap?.get(String(record.status))?.color}
                                                        className="text-[11px] font-black shadow-sm"
                                                    />
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top">
                                                    <div className="flex flex-col gap-1">
                                                        <span className={`inline-flex w-fit rounded-sm border px-2.5 py-1 text-[11px] font-black ${FOLLOWUP_CATEGORY_BADGES[record.followup_category] || FOLLOWUP_CATEGORY_BADGES.pending_return}`}>
                                                            {FOLLOWUP_CATEGORY_LABELS[record.followup_category] || record.followup_category}
                                                        </span>
                                                        <span className="text-[11px] font-semibold text-primary/50">
                                                            {actualOrderTypeLabel}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top font-mono text-[13px] font-black text-primary">
                                                    {record.tracking_code || '-'}
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top">
                                                    <div className="flex flex-col leading-[1.2] text-primary">
                                                        <span className="text-[13px] font-black">{relevantDate.date}</span>
                                                        {relevantDate.time && (
                                                            <span className="text-[12px] font-semibold text-primary/70">
                                                                {relevantDate.time}
                                                            </span>
                                                        )}
                                                        <span className="mt-1 text-[11px] font-semibold text-primary/45">
                                                            {getRelevantDateCaption(record.relevant_date_mode)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top text-center">
                                                    <span className="inline-flex min-w-[54px] items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[12px] font-black text-rose-700">
                                                        {formatNumber(record.stalled_days)}
                                                    </span>
                                                </td>
                                                <td className="border border-primary/10 px-3 py-3 align-top text-[13px] font-semibold leading-6 text-primary/75">
                                                    {record.notes || '-'}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="space-y-3 lg:hidden">
                {!loading && records.length === 0 ? (
                    <div className="rounded-[24px] border border-dashed border-primary/15 bg-white px-5 py-12 text-center shadow-sm">
                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/35">
                            Không có đơn treo
                        </div>
                        <div className="mt-2 text-[16px] font-black text-primary">
                            {emptyStateTitle}
                        </div>
                        <div className="mt-2 text-[13px] font-semibold leading-6 text-primary/55">
                            {emptyStateDescription}
                        </div>
                    </div>
                ) : (
                    records.map((record) => {
                        const relevantDate = formatDateTimeParts(record.relevant_date);
                        const statusName = statusMap?.get(String(record.status))?.name || record.status || '-';

                        return (
                            <button
                                key={record.id}
                                type="button"
                                onDoubleClick={() => onOpenOrder?.(record.id)}
                                title="Kích đúp để mở chi tiết"
                                className="w-full rounded-[24px] border border-primary/10 bg-white px-4 py-4 text-left shadow-sm transition-all hover:border-primary/20 hover:bg-primary/[0.02]"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-mono text-[14px] font-black text-primary">
                                            {record.order_number}
                                        </div>
                                        <div className="mt-1 text-[14px] font-bold text-[#0F172A]">
                                            {record.customer_name || '-'}
                                        </div>
                                        <div className="mt-1 text-[13px] font-black text-primary/75">
                                            {record.customer_phone || '-'}
                                        </div>
                                    </div>
                                    <span className="inline-flex min-w-[52px] items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-black text-rose-700">
                                        {formatNumber(record.stalled_days)} ngày
                                    </span>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <AdminStatusBadge
                                        label={statusName}
                                        color={statusMap?.get(String(record.status))?.color}
                                        className="text-[10px] font-black shadow-sm"
                                    />
                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${FOLLOWUP_CATEGORY_BADGES[record.followup_category] || FOLLOWUP_CATEGORY_BADGES.pending_return}`}>
                                        {FOLLOWUP_CATEGORY_LABELS[record.followup_category] || record.followup_category}
                                    </span>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-3 text-[12px] font-semibold text-primary/70">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">
                                            Mã vận đơn
                                        </div>
                                        <div className="mt-1 font-mono text-[12px] text-primary">
                                            {record.tracking_code || '-'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-primary/40">
                                            {getRelevantDateCaption(record.relevant_date_mode)}
                                        </div>
                                        <div className="mt-1 text-primary">
                                            {relevantDate.date}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 text-[12px] font-semibold leading-5 text-primary/65">
                                    {record.notes || 'Không có ghi chú.'}
                                </div>
                                <div className="mt-3 text-[11px] font-semibold text-primary/40">
                                    Kích đúp để mở chi tiết
                                </div>
                            </button>
                        );
                    })
                )}
            </div>

            <div className="flex flex-col gap-3 border-t border-primary/10 pt-4 text-[13px] font-bold text-primary/50 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-4">
                    <span>Hiển thị {records.length} / {pagination.total}</span>
                    <div className="flex items-center gap-2">
                        <span>Số dòng:</span>
                        <select
                            value={pagination.per_page}
                            onChange={(event) => {
                                const nextPerPage = Number(event.target.value || 20);
                                setPagination((current) => ({ ...current, per_page: nextPerPage }));
                            }}
                            className="cursor-pointer bg-transparent font-black text-primary outline-none"
                        >
                            {[20, 50, 100].map((value) => (
                                <option key={value} value={value}>{value}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <Pagination
                    pagination={pagination}
                    onPageChange={(page) => fetchRecords(page, filter, pagination.per_page, preparedSearchTerms)}
                />
            </div>
        </div>
    );
};

export default OrderReturnFollowupPanel;
