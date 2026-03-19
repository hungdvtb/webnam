import React from 'react';
import { Link, useLocation, useOutletContext, useSearchParams } from 'react-router-dom';

const formatCurrency = (value) =>
    new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
    }).format(Number(value || 0));

const formatDate = (value) => {
    if (!value) {
        return new Intl.DateTimeFormat('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).format(new Date());
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    }).format(date);
};

const paymentMethodLabel = (value) => {
    if (value === 'bank_transfer') return 'Chuyển khoản ngân hàng';
    if (value === 'cod') return 'Thanh toán khi nhận hàng';
    return value || 'Chưa xác định';
};

const fallbackItems = [];

const OrderThankYou = () => {
    const location = useLocation();
    const outletContext = useOutletContext();
    const [searchParams] = useSearchParams();
    const state = location.state || {};

    const orderNumber = state.orderNumber || searchParams.get('order') || 'Đang cập nhật';
    const siteInfo = outletContext?.siteInfo || state.siteInfo || null;
    const items = Array.isArray(state.items) ? state.items : fallbackItems;
    const customerName = state.customerName || 'Quý khách';
    const customerPhone = state.phone || '';
    const customerEmail = state.email || '';
    const shippingAddress = state.shippingAddress || 'Thông tin giao hàng sẽ được xác nhận sau khi nhân viên liên hệ.';
    const paymentMethod = paymentMethodLabel(state.paymentMethod);
    const continuePath = state.continuePath || '/san-pham';
    const continueLabel = state.continueLabel || 'Tiếp tục mua sắm';
    const secondaryPath = state.secondaryPath || '/';
    const secondaryLabel = state.secondaryLabel || 'Về trang chủ';
    const totalItems = state.totalItems || items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalAmount = state.totalAmount || items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
    const helperMessage =
        state.message ||
        'Đơn hàng của Quý khách đã được tiếp nhận thành công. Đội ngũ của chúng tôi sẽ xác nhận lại trong thời gian sớm nhất.';

    return (
        <div className="bg-[#f8f1e7]">
            <section className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
                <div className="overflow-hidden rounded-[28px] border border-[#d6c2a4]/60 bg-white shadow-[0_24px_80px_rgba(27,54,93,0.12)]">
                    <div className="relative overflow-hidden bg-[#1b365d] px-6 py-10 md:px-10 md:py-14">
                        <div className="absolute inset-x-0 top-0 h-[6px] bg-gradient-to-r from-[#c5a059] via-[#ecd6ab] to-[#c5a059]" />
                        <div className="absolute inset-x-0 bottom-0 h-[6px] bg-gradient-to-r from-[#c5a059] via-[#ecd6ab] to-[#c5a059]" />
                        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                            <div className="max-w-3xl">
                                <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#c5a059] text-white shadow-[0_12px_32px_rgba(197,160,89,0.35)]">
                                    <span className="material-symbols-outlined text-[34px]">check_circle</span>
                                </div>
                                <p className="mb-3 text-[11px] font-black uppercase tracking-[0.45em] text-[#ecd6ab]">
                                    Giao dịch hoàn tất
                                </p>
                                <h1 className="font-display text-3xl font-bold italic text-white md:text-5xl">
                                    Cảm ơn Quý khách đã trân trọng di sản
                                </h1>
                                <p className="mt-4 max-w-2xl text-base leading-7 text-white/80 md:text-lg">
                                    {helperMessage}
                                </p>
                            </div>

                            <div className="w-full max-w-[320px] rounded-[24px] border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
                                <div className="rounded-[18px] border border-[#ecd6ab]/40 bg-white/95 px-4 py-3 text-center">
                                    <p className="text-xs font-black uppercase tracking-[0.24em] text-[#1b365d]">
                                        Bảng xác nhận đơn hàng
                                    </p>
                                </div>
                                <div className="mt-4 space-y-3 text-white">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Mã đơn hàng</p>
                                        <p className="mt-1 text-2xl font-black tracking-wide">{orderNumber}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div className="rounded-2xl bg-white/10 px-4 py-3">
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/60">Ngày tạo</p>
                                            <p className="mt-1 font-semibold">{formatDate(state.createdAt)}</p>
                                        </div>
                                        <div className="rounded-2xl bg-white/10 px-4 py-3">
                                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/60">Tổng tiền</p>
                                            <p className="mt-1 font-semibold">{formatCurrency(totalAmount)}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-8 md:px-10 md:py-10">
                        <div className="grid gap-5 lg:grid-cols-[1.05fr,0.95fr]">
                            <div className="rounded-[24px] border border-[#d7c8b4] bg-[#f9f4ec] p-6">
                                <h2 className="font-display text-[28px] font-bold text-[#1b365d]">Chi tiết đơn hàng</h2>
                                <div className="mt-5 space-y-4 text-[15px] text-slate-700">
                                    <div className="flex items-center justify-between gap-4 border-b border-[#dccfbf] pb-3">
                                        <span className="font-medium text-slate-500">Mã đơn hàng</span>
                                        <span className="font-bold text-[#1b365d]">{orderNumber}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 border-b border-[#dccfbf] pb-3">
                                        <span className="font-medium text-slate-500">Ngày đặt</span>
                                        <span className="font-semibold">{formatDate(state.createdAt)}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 border-b border-[#dccfbf] pb-3">
                                        <span className="font-medium text-slate-500">Phương thức thanh toán</span>
                                        <span className="font-semibold">{paymentMethod}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 pt-1">
                                        <span className="text-xs font-black uppercase tracking-[0.26em] text-[#9b7a3f]">Tổng cộng</span>
                                        <span className="text-2xl font-black text-[#1b365d]">{formatCurrency(totalAmount)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-[24px] border border-[#d7c8b4] bg-[#fffdf8] p-6">
                                <div className="flex items-start gap-4">
                                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1b365d]/8 text-[#c5a059]">
                                        <span className="material-symbols-outlined text-[30px]">local_shipping</span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h2 className="font-display text-[28px] font-bold text-[#1b365d]">Thông tin giao nhận</h2>
                                        <p className="mt-1 text-sm text-slate-500">Chúng tôi sẽ xác nhận đơn hàng và lịch giao trong thời gian sớm nhất.</p>
                                    </div>
                                </div>

                                <div className="mt-5 space-y-3 text-[15px] leading-7 text-slate-700">
                                    <p className="text-xl font-bold text-[#1b365d]">{customerName}</p>
                                    {customerPhone ? <p>{customerPhone}</p> : null}
                                    {customerEmail ? <p>{customerEmail}</p> : null}
                                    <p>{shippingAddress}</p>
                                    <div className="rounded-2xl border border-[#e6d8c2] bg-[#f8f1e7] px-4 py-3 text-sm italic text-[#9b7a3f]">
                                        {siteInfo?.name || 'Gốm Đại Thành'} sẽ liên hệ để xác nhận và chuẩn bị giao hàng.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 rounded-[24px] border border-[#d7c8b4] bg-white">
                            <div className="flex items-center justify-between gap-4 border-b border-[#ede2d3] px-6 py-5">
                                <div>
                                    <h2 className="font-display text-[28px] font-bold text-[#1b365d]">Sản phẩm đã chọn</h2>
                                    <p className="mt-1 text-sm text-slate-500">Tóm tắt các sản phẩm nằm trong đơn hàng của Quý khách.</p>
                                </div>
                                <div className="hidden rounded-full bg-[#f5ecdf] px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#9b7a3f] md:block">
                                    {totalItems} món
                                </div>
                            </div>

                            {items.length > 0 ? (
                                <div className="divide-y divide-[#ede2d3]">
                                    {items.map((item, index) => (
                                        <div key={`${item.id || item.sku || item.name}-${index}`} className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center">
                                            <div className="flex min-w-0 flex-1 items-center gap-4">
                                                <div className="h-20 w-20 overflow-hidden rounded-[18px] border border-[#e6d8c2] bg-[#f8f1e7]">
                                                    {item.image ? (
                                                        <img src={item.image} alt={item.name || 'Sản phẩm'} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <div className="flex h-full w-full items-center justify-center text-[#c5a059]">
                                                            <span className="material-symbols-outlined text-[32px]">inventory_2</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="truncate font-display text-xl font-bold text-[#1b365d]">
                                                        {item.name || 'Sản phẩm trong đơn hàng'}
                                                    </h3>
                                                    <p className="mt-1 text-sm text-slate-500">
                                                        {[item.sku, item.meta].filter(Boolean).join(' • ') || 'Sản phẩm thủ công tuyển chọn'}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-4 text-right md:min-w-[220px] md:justify-end">
                                                <div>
                                                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Số lượng</p>
                                                    <p className="mt-1 text-lg font-bold text-[#1b365d]">{item.quantity || 1}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Thành tiền</p>
                                                    <p className="mt-1 text-lg font-black text-[#1b365d]">
                                                        {formatCurrency((Number(item.price || 0) * Number(item.quantity || 0)) || item.subtotal)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="px-6 py-10 text-center text-slate-500">
                                    Thông tin sản phẩm của đơn hàng sẽ được cập nhật khi hệ thống đồng bộ hoàn tất.
                                </div>
                            )}

                            <div className="grid gap-3 border-t border-[#ede2d3] bg-[#f9f4ec] px-6 py-5 md:grid-cols-[1fr,220px] md:items-center">
                                <div className="text-sm text-slate-500">Mọi thông tin xác nhận đơn hàng đã được lưu lại để đội ngũ chăm sóc khách hàng tiếp nhận.</div>
                                <div className="rounded-[18px] border border-[#d7c8b4] bg-white px-5 py-4 text-right">
                                    <p className="text-xs font-black uppercase tracking-[0.24em] text-[#9b7a3f]">Tổng thanh toán</p>
                                    <p className="mt-1 text-[28px] font-black text-[#1b365d]">{formatCurrency(totalAmount)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                            <Link
                                to={continuePath}
                                className="w-full rounded-2xl bg-[#1b365d] px-8 py-4 text-center text-sm font-black uppercase tracking-[0.22em] text-white transition-all hover:brightness-95 sm:w-auto"
                            >
                                {continueLabel}
                            </Link>
                            <Link
                                to={secondaryPath}
                                className="w-full rounded-2xl border-2 border-[#c5a059] px-8 py-4 text-center text-sm font-black uppercase tracking-[0.22em] text-[#9b7a3f] transition-all hover:bg-[#c5a059] hover:text-white sm:w-auto"
                            >
                                {secondaryLabel}
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default OrderThankYou;
