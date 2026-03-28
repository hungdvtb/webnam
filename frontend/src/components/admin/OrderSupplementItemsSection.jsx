import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { productApi } from '../../services/api';
import { getOrderTypeMeta, isSpecialOrderType } from '../../config/orderTypes';

const moneyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

const toNumber = (value, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

const buildItemFromProduct = (product) => ({
    product_id: Number(product?.id) || 0,
    name: product?.name || '',
    sku: product?.sku || '',
    quantity: 1,
    price: toNumber(product?.price, 0),
    cost_price: toNumber(product?.cost_price ?? product?.expected_cost, 0),
    notes: '',
});

const searchInputClassName = 'w-full h-11 rounded-sm border border-primary/10 bg-white pl-10 pr-10 text-[13px] text-[#0F172A] focus:outline-none focus:border-primary/30 transition-all';
const tableInputClassName = 'w-full h-9 rounded-sm border border-primary/10 bg-white px-2 text-[13px] text-[#0F172A] focus:outline-none focus:border-primary transition-all';

const OrderSupplementItemsSection = ({
    open = false,
    orderType,
    items = [],
    onChange,
    onClose,
}) => {
    const normalizedItems = Array.isArray(items) ? items : [];
    const orderTypeMeta = getOrderTypeMeta(orderType);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const abortRef = useRef(null);

    useEffect(() => {
        if (open && isSpecialOrderType(orderType)) return undefined;

        abortRef.current?.abort();
        abortRef.current = null;
        setSearchTerm('');
        setSearchResults([]);
        setLoading(false);

        return undefined;
    }, [open, orderType]);

    useEffect(() => {
        if (!open || !isSpecialOrderType(orderType) || typeof document === 'undefined') return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [open, orderType]);

    useEffect(() => {
        if (!open || !isSpecialOrderType(orderType)) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, orderType, onClose]);

    useEffect(() => {
        if (!open || !isSpecialOrderType(orderType)) return undefined;

        const trimmedSearch = searchTerm.trim();
        if (!trimmedSearch) {
            setSearchResults([]);
            setLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        abortRef.current?.abort();
        abortRef.current = controller;
        setLoading(true);

        const timeoutId = window.setTimeout(async () => {
            try {
                const response = await productApi.getAll({ search: trimmedSearch, per_page: 8 }, controller.signal);
                if (controller.signal.aborted) return;
                setSearchResults(response?.data?.data || []);
            } catch (error) {
                if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return;
                console.error('Error loading supplement products', error);
                setSearchResults([]);
            } finally {
                if (abortRef.current === controller) {
                    abortRef.current = null;
                    setLoading(false);
                }
            }
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
            if (abortRef.current === controller) {
                abortRef.current = null;
            }
        };
    }, [open, orderType, searchTerm]);

    const totals = useMemo(() => normalizedItems.reduce((summary, item) => {
        const quantity = Math.max(0, toNumber(item?.quantity, 0));
        const price = toNumber(item?.price, 0);
        const costPrice = toNumber(item?.cost_price, 0);

        summary.totalPrice += quantity * price;
        summary.totalCost += quantity * costPrice;

        return summary;
    }, { totalPrice: 0, totalCost: 0 }), [normalizedItems]);

    const updateItems = (nextItems) => {
        onChange?.(Array.isArray(nextItems) ? nextItems : []);
    };

    const handleAddProduct = (product) => {
        if (!product?.id) return;

        const existingIndex = normalizedItems.findIndex((item) => Number(item?.product_id) === Number(product.id));
        if (existingIndex >= 0) {
            updateItems(normalizedItems.map((item, index) => (
                index === existingIndex
                    ? { ...item, quantity: Math.max(1, toNumber(item.quantity, 1)) + 1 }
                    : item
            )));
        } else {
            updateItems([...normalizedItems, buildItemFromProduct(product)]);
        }

        setSearchTerm('');
        setSearchResults([]);
    };

    const handleItemChange = (index, field, value) => {
        updateItems(normalizedItems.map((item, itemIndex) => (
            itemIndex === index ? { ...item, [field]: value } : item
        )));
    };

    const handleRemoveItem = (index) => {
        updateItems(normalizedItems.filter((_, itemIndex) => itemIndex !== index));
    };

    if (!isSpecialOrderType(orderType)) return null;

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[240] bg-slate-950/40 backdrop-blur-[2px]"
                        onClick={() => onClose?.()}
                    />

                    <motion.div
                        initial={{ opacity: 0, y: 18, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 18, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="fixed inset-0 z-[250] flex items-center justify-center p-4 sm:p-6 lg:p-8"
                    >
                        <div
                            className="flex h-full max-h-[88vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-sm border border-primary/10 bg-[#F8FAFC] shadow-[0_32px_80px_rgba(15,23,42,0.22)]"
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-primary/10 bg-white px-5 py-4 sm:px-6">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex size-9 items-center justify-center rounded-sm bg-primary/5 text-primary">
                                            <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                                        </span>
                                        <h3 className="text-[15px] font-black uppercase tracking-[0.12em] text-primary">
                                            Khai báo sp đổi trả
                                        </h3>
                                        <span className="inline-flex items-center rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                                            {orderTypeMeta.shortLabel}
                                        </span>
                                    </div>
                                    <p className="mt-2 max-w-3xl text-[12px] leading-5 text-primary/45">
                                        {orderTypeMeta.sectionDescription}
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => onClose?.()}
                                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-sm border border-primary/10 bg-white text-primary/40 transition-all hover:border-brick/20 hover:text-brick"
                                    title="Đóng popup khai báo"
                                >
                                    <span className="material-symbols-outlined text-[18px]">close</span>
                                </button>
                            </div>

                            <div className="border-b border-primary/10 bg-primary/[0.02] px-5 py-4 sm:px-6">
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                    <div className="relative w-full xl:max-w-[440px]">
                                        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-primary/35">
                                            search
                                        </span>
                                        <input
                                            type="text"
                                            value={searchTerm}
                                            onChange={(event) => setSearchTerm(event.target.value)}
                                            placeholder="Tìm sản phẩm để thêm vào phần khai báo..."
                                            className={searchInputClassName}
                                        />
                                        {searchTerm.trim() && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSearchTerm('');
                                                    setSearchResults([]);
                                                }}
                                                className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-primary/35 transition-all hover:bg-primary/5 hover:text-brick"
                                                title="Xóa từ khóa tìm kiếm"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                            </button>
                                        )}

                                        {(loading || searchResults.length > 0) && searchTerm.trim() && (
                                            <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-sm border border-primary/10 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.14)]">
                                                {loading ? (
                                                    <div className="px-4 py-3 text-[12px] font-semibold text-primary/45">
                                                        Đang tìm sản phẩm...
                                                    </div>
                                                ) : (
                                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                                        {searchResults.length > 0 ? searchResults.map((product) => (
                                                            <button
                                                                key={product.id}
                                                                type="button"
                                                                onClick={() => handleAddProduct(product)}
                                                                className="w-full border-b border-primary/5 px-4 py-3 text-left transition-all last:border-b-0 hover:bg-primary/5"
                                                            >
                                                                <div className="flex items-center justify-between gap-3">
                                                                    <div className="min-w-0">
                                                                        <div className="truncate text-[13px] font-bold text-primary">
                                                                            {product.name}
                                                                        </div>
                                                                        <div className="mt-0.5 text-[11px] font-black text-orange-600/70">
                                                                            {product.sku || 'Không có SKU'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="shrink-0 text-[12px] font-black text-brick">
                                                                        {moneyFormatter.format(toNumber(product.price, 0))}đ
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        )) : (
                                                            <div className="px-4 py-3 text-[12px] font-semibold text-primary/45">
                                                                Không tìm thấy sản phẩm phù hợp.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[450px]">
                                        <div className="rounded-sm border border-primary/10 bg-white px-4 py-3 shadow-sm">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                Số dòng khai báo
                                            </div>
                                            <div className="mt-2 text-[22px] font-black text-primary">
                                                {normalizedItems.length}
                                            </div>
                                        </div>
                                        <div className="rounded-sm border border-primary/10 bg-white px-4 py-3 shadow-sm">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                Tổng giá trị
                                            </div>
                                            <div className="mt-2 text-[22px] font-black text-brick">
                                                {moneyFormatter.format(totals.totalPrice)}đ
                                            </div>
                                        </div>
                                        <div className="rounded-sm border border-primary/10 bg-white px-4 py-3 shadow-sm">
                                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary/45">
                                                Tổng giá vốn
                                            </div>
                                            <div className="mt-2 text-[22px] font-black text-primary">
                                                {moneyFormatter.format(totals.totalCost)}đ
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="min-h-0 flex-1 px-5 py-4 sm:px-6">
                                <div className="h-full overflow-auto rounded-sm border border-primary/10 bg-white shadow-sm">
                                    <table className="min-w-full border-collapse text-left">
                                        <thead className="sticky top-0 z-10 bg-[#F8FAFC] text-[11px] font-black uppercase tracking-[0.14em] text-primary/55">
                                            <tr>
                                                <th className="border-b border-r border-primary/10 px-4 py-3">Sản phẩm</th>
                                                <th className="w-[92px] border-b border-r border-primary/10 px-3 py-3 text-center">SL</th>
                                                <th className="w-[150px] border-b border-r border-primary/10 px-3 py-3 text-right">Đơn giá</th>
                                                <th className="w-[150px] border-b border-r border-primary/10 px-3 py-3 text-right">Giá vốn</th>
                                                <th className="w-[280px] border-b border-r border-primary/10 px-3 py-3">Ghi chú</th>
                                                <th className="w-[160px] border-b border-r border-primary/10 px-3 py-3 text-right">Thành tiền</th>
                                                <th className="w-[68px] border-b border-primary/10 px-3 py-3 text-center">Xóa</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {normalizedItems.length > 0 ? normalizedItems.map((item, index) => {
                                                const quantity = Math.max(0, toNumber(item?.quantity, 0));
                                                const lineTotal = quantity * toNumber(item?.price, 0);

                                                return (
                                                    <tr key={`${item?.product_id || 'supplement'}-${index}`} className="align-top hover:bg-primary/[0.015]">
                                                        <td className="border-b border-r border-primary/10 px-4 py-3">
                                                            <div className="font-bold text-primary">
                                                                {item?.name || `Sản phẩm #${item?.product_id || index + 1}`}
                                                            </div>
                                                            <div className="mt-1 text-[11px] font-black text-orange-600/70">
                                                                {item?.sku || 'Không có SKU'}
                                                            </div>
                                                        </td>
                                                        <td className="border-b border-r border-primary/10 px-3 py-3">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={quantity}
                                                                onChange={(event) => handleItemChange(index, 'quantity', Math.max(0, Number(event.target.value) || 0))}
                                                                className={`${tableInputClassName} text-center font-bold`}
                                                            />
                                                        </td>
                                                        <td className="border-b border-r border-primary/10 px-3 py-3">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={toNumber(item?.price, 0)}
                                                                onChange={(event) => handleItemChange(index, 'price', Math.max(0, Number(event.target.value) || 0))}
                                                                className={`${tableInputClassName} text-right font-bold`}
                                                            />
                                                        </td>
                                                        <td className="border-b border-r border-primary/10 px-3 py-3">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={toNumber(item?.cost_price, 0)}
                                                                onChange={(event) => handleItemChange(index, 'cost_price', Math.max(0, Number(event.target.value) || 0))}
                                                                className={`${tableInputClassName} text-right font-bold`}
                                                            />
                                                        </td>
                                                        <td className="border-b border-r border-primary/10 px-3 py-3">
                                                            <input
                                                                type="text"
                                                                value={item?.notes || ''}
                                                                onChange={(event) => handleItemChange(index, 'notes', event.target.value)}
                                                                className={tableInputClassName}
                                                                placeholder="Ghi chú thêm..."
                                                            />
                                                        </td>
                                                        <td className="border-b border-r border-primary/10 px-3 py-3 text-right text-[13px] font-black text-brick">
                                                            {moneyFormatter.format(lineTotal)}đ
                                                        </td>
                                                        <td className="border-b border-primary/10 px-3 py-3 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveItem(index)}
                                                                className="inline-flex size-8 items-center justify-center rounded-sm border border-primary/10 text-primary/35 transition-all hover:border-brick/20 hover:text-brick"
                                                                title="Xóa dòng khai báo"
                                                            >
                                                                <span className="material-symbols-outlined text-[18px]">delete</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            }) : (
                                                <tr>
                                                    <td colSpan={7} className="px-6 py-16 text-center">
                                                        <div className="mx-auto max-w-md">
                                                            <div className="text-[13px] font-bold text-primary">
                                                                Chưa có sản phẩm nào được khai báo trong phần này.
                                                            </div>
                                                            <div className="mt-2 text-[12px] leading-5 text-primary/45">
                                                                Dùng ô tìm kiếm phía trên để thêm sản phẩm khách trả về, chưa nhận hoặc hoàn lại vào danh sách theo dõi.
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3 border-t border-primary/10 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                                <div className="text-[12px] font-medium text-primary/45">
                                    Dữ liệu khai báo được lưu cùng đơn hàng, không tạo phiếu nhập xuất và không tác động kho.
                                </div>
                                <div className="flex items-center justify-end gap-3">
                                    <div className="rounded-sm border border-primary/10 bg-primary/[0.02] px-3 py-2 text-[12px] font-bold text-primary/60">
                                        {moneyFormatter.format(totals.totalPrice)}đ / {moneyFormatter.format(totals.totalCost)}đ
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onClose?.()}
                                        className="inline-flex h-10 items-center justify-center rounded-sm border border-primary/10 bg-white px-4 text-[12px] font-semibold text-primary/70 transition-all hover:border-primary/25 hover:text-primary"
                                    >
                                        Đóng
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default OrderSupplementItemsSection;
