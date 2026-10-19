import React, { useCallback, useEffect, useState } from 'react';
import { orderApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AccountSelector from '../../components/AccountSelector';

const formatMoney = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.floor(Number(value || 0)))}₫`;

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
};

const BackupOrderList = () => {
    const { user } = useAuth();
    const [orders, setOrders] = useState([]);
    const [summary, setSummary] = useState({ total: 0, first_order: null, last_order: null });
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
    const [queryInput, setQueryInput] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [reloadKey, setReloadKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        const loadOrders = async () => {
            setLoading(true);
            setError('');
            try {
                const response = await orderApi.getBackupOrders({
                    q: search || undefined,
                    page,
                    per_page: pagination.per_page,
                }, controller.signal);
                if (!active) return;
                const payload = response.data || {};
                setOrders(Array.isArray(payload.data) ? payload.data : []);
                setSummary(payload.summary || { total: 0, first_order: null, last_order: null });
                setPagination({
                    current_page: payload.current_page || 1,
                    last_page: payload.last_page || 1,
                    per_page: payload.per_page || 25,
                    total: payload.total || 0,
                });
            } catch (requestError) {
                if (!active || controller.signal.aborted) return;
                setOrders([]);
                setError(requestError.response?.data?.message || 'Không thể tải đơn hàng từ nguồn backup.');
            } finally {
                if (active) setLoading(false);
            }
        };

        loadOrders();
        return () => {
            active = false;
            controller.abort();
        };
    }, [page, pagination.per_page, reloadKey, search]);

    const handleSearch = useCallback((event) => {
        event.preventDefault();
        setPage(1);
        setSearch(queryInput.trim());
    }, [queryInput]);

    const handleRefresh = () => setReloadKey((value) => value + 1);

    return (
        <div className="mx-auto max-w-7xl space-y-5 p-4 pb-16 md:p-6">
            <header className="flex flex-col gap-4 border border-gold/10 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="font-display text-2xl font-bold italic text-primary">Đơn hàng từ backup</h1>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">Chỉ đọc</span>
                    </div>
                    <p className="mt-1 text-xs text-stone/70">Dữ liệu lấy trực tiếp từ máy chủ backup; không làm thay đổi đơn hàng hiện tại.</p>
                </div>
                <AccountSelector user={user} />
            </header>

            <section className="grid gap-3 sm:grid-cols-3">
                <div className="border border-gold/10 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-stone/60">Tổng đơn nguồn backup</p>
                    <p className="mt-1 font-display text-2xl font-bold text-primary">{new Intl.NumberFormat('vi-VN').format(summary.total || 0)}</p>
                </div>
                <div className="border border-gold/10 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-stone/60">Đơn cũ nhất</p>
                    <p className="mt-1 font-ui text-sm font-semibold text-primary">{formatDate(summary.first_order)}</p>
                </div>
                <div className="border border-gold/10 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-stone/60">Đơn mới nhất</p>
                    <p className="mt-1 font-ui text-sm font-semibold text-primary">{formatDate(summary.last_order)}</p>
                </div>
            </section>

            <section className="overflow-hidden border border-gold/10 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-gold/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2">
                        <input
                            value={queryInput}
                            onChange={(event) => setQueryInput(event.target.value)}
                            className="min-w-0 flex-1 border border-gold/20 bg-background-light px-3 py-2 text-sm outline-none focus:border-gold"
                            placeholder="Tìm mã đơn hoặc tên khách hàng"
                            aria-label="Tìm đơn backup"
                        />
                        <button type="submit" className="bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-umber">Tìm</button>
                    </form>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={loading}
                        className="flex items-center justify-center gap-2 border border-gold/30 px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary hover:bg-gold/5 disabled:opacity-50"
                    >
                        <span className={`material-symbols-outlined text-base ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        Tải lại
                    </button>
                </div>

                {error && (
                    <div className="m-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
                        {error}
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-left">
                        <thead className="sticky top-0 border-b border-gold/10 bg-[#fcfcfa] text-[10px] font-bold uppercase tracking-widest text-stone/70">
                            <tr>
                                <th className="whitespace-nowrap px-4 py-3">Mã đơn</th>
                                <th className="whitespace-nowrap px-4 py-3">Khách hàng</th>
                                <th className="whitespace-nowrap px-4 py-3">Ngày tạo</th>
                                <th className="whitespace-nowrap px-4 py-3 text-right">Tổng tiền</th>
                                <th className="whitespace-nowrap px-4 py-3">Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gold/5 text-sm">
                            {orders.map((order) => (
                                <tr key={order.id} className="hover:bg-gold/[0.03]">
                                    <td className="whitespace-nowrap px-4 py-3 font-ui font-bold text-primary">{order.order_number || `#${order.id}`}</td>
                                    <td className="min-w-48 px-4 py-3">
                                        <div className="font-semibold text-primary">{order.customer_name || '—'}</div>
                                        {order.customer_phone && <div className="mt-0.5 text-xs text-stone/70">{order.customer_phone}</div>}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-xs text-stone">{formatDate(order.created_at)}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-primary">{formatMoney(order.total_price)}</td>
                                    <td className="whitespace-nowrap px-4 py-3">
                                        <span className="rounded-full border border-gold/20 bg-background-light px-2.5 py-1 text-[10px] font-bold text-primary">
                                            {order.deleted_at ? 'Đã xóa' : (order.status || '—')}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {!loading && !error && orders.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="px-4 py-12 text-center text-sm text-stone/60">Không tìm thấy đơn hàng nào.</td>
                                </tr>
                            )}
                            {loading && orders.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="px-4 py-12 text-center text-sm text-stone/60">Đang tải đơn hàng backup…</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <footer className="flex flex-col gap-3 border-t border-gold/10 px-4 py-3 text-xs text-stone/70 sm:flex-row sm:items-center sm:justify-between">
                    <span>Trang {pagination.current_page} / {pagination.last_page} · {new Intl.NumberFormat('vi-VN').format(pagination.total)} đơn</span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((value) => Math.max(1, value - 1))}
                            disabled={loading || pagination.current_page <= 1}
                            className="border border-gold/20 px-3 py-1.5 font-semibold text-primary hover:bg-gold/5 disabled:opacity-40"
                        >
                            Trước
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((value) => Math.min(pagination.last_page, value + 1))}
                            disabled={loading || pagination.current_page >= pagination.last_page}
                            className="border border-gold/20 px-3 py-1.5 font-semibold text-primary hover:bg-gold/5 disabled:opacity-40"
                        >
                            Sau
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    );
};

export default BackupOrderList;
