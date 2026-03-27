import React, { useEffect, useRef, useState } from 'react';
import { orderApi } from '../../services/api';
import { formatReturnOrderCurrency, formatReturnOrderDate } from '../../config/returnOrderStatus';

const inputClass = 'h-11 w-full rounded-sm border border-primary/10 bg-white px-3 text-[13px] text-[#0F172A] outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10';

const buildOriginOrderLabel = (order) => {
    if (!order) return '';
    const number = order.order_number ? `#${order.order_number}` : `Don #${order.id}`;
    return `${number}${order.customer_name ? ` - ${order.customer_name}` : ''}`;
};

const OriginOrderLookupField = ({ value, onSelect }) => {
    const containerRef = useRef(null);
    const [query, setQuery] = useState(() => buildOriginOrderLabel(value));
    const [results, setResults] = useState([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setQuery(buildOriginOrderLabel(value));
    }, [value?.id]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setOpen(false);
                setQuery(buildOriginOrderLabel(value));
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [value]);

    useEffect(() => {
        if (!open) return undefined;

        const keyword = query.trim();
        if (!keyword) {
            setResults([]);
            setLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const response = await orderApi.getAll({
                    search: keyword,
                    per_page: 8,
                }, controller.signal);
                setResults(response.data?.data || []);
            } catch (error) {
                if (error?.code !== 'ERR_CANCELED') setResults([]);
            } finally {
                setLoading(false);
            }
        }, 220);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [open, query]);

    return (
        <div className="relative" ref={containerRef}>
            <div className="flex items-center gap-2">
                <input
                    type="text"
                    value={query}
                    onFocus={() => setOpen(true)}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setOpen(true);
                    }}
                    placeholder="Tim don goc theo ma don, ten khach, so dien thoai..."
                    className={inputClass}
                />
                {value ? (
                    <button
                        type="button"
                        onClick={() => {
                            onSelect(null);
                            setQuery('');
                            setResults([]);
                            setOpen(false);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/50 transition-all hover:border-primary/30 hover:text-primary"
                        title="Bo lien ket"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                ) : null}
            </div>

            {open ? (
                <div className="absolute left-0 right-0 top-full z-[120] mt-2 overflow-hidden rounded-sm border border-primary/15 bg-white shadow-2xl">
                    <div className="max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="px-4 py-6 text-center text-[12px] font-semibold text-primary/45">Dang tim don goc...</div>
                        ) : results.length === 0 ? (
                            <div className="px-4 py-6 text-center text-[12px] font-semibold text-primary/35">Khong tim thay don goc phu hop.</div>
                        ) : (
                            results.map((order) => (
                                <button
                                    key={order.id}
                                    type="button"
                                    onClick={() => {
                                        onSelect(order);
                                        setQuery(buildOriginOrderLabel(order));
                                        setOpen(false);
                                    }}
                                    className="flex w-full flex-col gap-1 border-b border-primary/5 px-4 py-3 text-left transition-all hover:bg-primary/5"
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="truncate text-[13px] font-bold text-[#0F172A]">#{order.order_number}</span>
                                        <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.2em] text-primary/40">{formatReturnOrderCurrency(order.total_price)}d</span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
                                        <span>{order.customer_name || 'Khach chua ro'}</span>
                                        <span>{order.customer_phone || 'Khong co SDT'}</span>
                                        <span>{formatReturnOrderDate(order.created_at)}</span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default OriginOrderLookupField;
