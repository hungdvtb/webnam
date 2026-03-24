import React from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
}).format(Number(value || 0));

const getItemLink = (item) => (item.product_id ? `/old/details/${item.product_id}` : '/old/shop');

const getItemImage = (item) => item.product?.images?.[0]?.image_url || 'https://placehold.co/200x200?text=No+Image';

const getItemMeta = (item) => {
    const chips = [];
    const options = item?.options;

    if (item?.product?.category?.name) {
        chips.push(item.product.category.name);
    }

    if (options && typeof options === 'object') {
        [
            options.bundle_option_title,
            options.variant_label,
            options.variant_name,
            options.option_label,
            options.color,
            options.size
        ].filter(Boolean).forEach((entry) => chips.push(entry));

        if (Array.isArray(options.attributes)) {
            options.attributes.forEach((attribute) => {
                if (!attribute) return;

                if (typeof attribute === 'string') {
                    chips.push(attribute);
                    return;
                }

                const label = [attribute.name, attribute.value].filter(Boolean).join(': ');
                if (label) chips.push(label);
            });
        }
    }

    return Array.from(new Set(chips.filter(Boolean))).slice(0, 3);
};

const Cart = () => {
    const { cart, loading, updateQuantity, removeFromCart, cartTotal } = useCart();
    const itemCount = cart?.items?.reduce((total, item) => total + Number(item.quantity || 0), 0) || 0;

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center bg-background-light">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-gold"></div>
            </div>
        );
    }

    if (!cart || cart.items.length === 0) {
        return (
            <main className="bg-background-light px-6 py-24 text-center lg:px-12 lg:py-32">
                <div className="mx-auto max-w-md space-y-7">
                    <div className="relative inline-block">
                        <span className="material-symbols-outlined text-7xl text-gold/20 lg:text-8xl">shopping_bag</span>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="material-symbols-outlined text-4xl text-gold">production_quantity_limits</span>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <h1 className="font-display text-3xl font-bold text-primary lg:text-4xl">Giỏ hàng trống</h1>
                        <p className="font-body text-base italic text-stone lg:text-lg">Bạn chưa có sản phẩm nào trong giỏ hàng.</p>
                    </div>
                    <Link
                        to="/old/shop"
                        className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-8 text-sm font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-umber"
                    >
                        Quay lại cửa hàng
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <>
            <main className="mx-auto w-full max-w-[1280px] bg-background-light px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] sm:px-5 sm:py-6 sm:pb-[calc(env(safe-area-inset-bottom)+8rem)] lg:px-12 lg:py-20 lg:pb-20">
                <div className="mb-5 flex items-end justify-between gap-4 border-b border-gold/15 pb-4 lg:mb-12 lg:pb-6">
                    <div className="space-y-1.5">
                        <p className="font-ui text-[10px] font-black uppercase tracking-[0.18em] text-gold lg:hidden">Cart mobile</p>
                        <h1 className="font-display text-[28px] font-bold leading-none text-primary lg:text-4xl">Giỏ hàng của bạn</h1>
                        <p className="font-body text-sm text-stone lg:text-base">
                            {itemCount} sản phẩm • Xem nhanh, chỉnh số lượng và chốt đơn gọn hơn trên mobile.
                        </p>
                    </div>

                    <div className="hidden rounded-2xl border border-gold/15 bg-white px-4 py-3 text-right shadow-sm lg:block">
                        <p className="font-ui text-[10px] font-bold uppercase tracking-[0.18em] text-stone">Tạm tính</p>
                        <p className="mt-1 font-display text-2xl font-bold italic text-brick">{formatCurrency(cartTotal)}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-16">
                    <div className="space-y-3 lg:col-span-8 lg:space-y-8">
                        {cart.items.map((item) => {
                            const itemMeta = getItemMeta(item);
                            const lineTotal = item.price * item.quantity;

                            return (
                                <div key={item.id}>
                                    <div className="rounded-[24px] border border-stone-200 bg-white p-3 shadow-[0_12px_34px_rgba(27,54,93,0.06)] lg:hidden">
                                        <div className="flex gap-3">
                                            <Link
                                                to={getItemLink(item)}
                                                className="block h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl bg-background-light"
                                            >
                                                <img
                                                    src={getItemImage(item)}
                                                    alt={item.product?.name}
                                                    className="h-full w-full object-cover"
                                                />
                                            </Link>

                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <Link
                                                            to={getItemLink(item)}
                                                            className="block text-[14px] font-bold leading-[1.35] text-primary line-clamp-2"
                                                        >
                                                            {item.product?.name}
                                                        </Link>

                                                        {itemMeta.length > 0 ? (
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {itemMeta.map((meta) => (
                                                                    <span
                                                                        key={`${item.id}-${meta}`}
                                                                        className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-600"
                                                                    >
                                                                        {meta}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : null}
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => removeFromCart(item.id)}
                                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-50 text-stone-500 transition-colors hover:bg-brick/10 hover:text-brick"
                                                        aria-label={`Xóa ${item.product?.name}`}
                                                    >
                                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                                    </button>
                                                </div>

                                                <div className="mt-3 flex items-end justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Đơn giá</p>
                                                        <p className="mt-1 text-sm font-black text-brick">{formatCurrency(item.price)}</p>
                                                    </div>

                                                    <div className="flex h-11 items-center rounded-2xl border border-stone-200 bg-stone-50 px-1">
                                                        <button
                                                            type="button"
                                                            className="flex h-9 w-9 items-center justify-center rounded-xl text-primary transition-colors hover:bg-white"
                                                            onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                                                            aria-label="Giảm số lượng"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">remove</span>
                                                        </button>
                                                        <span className="flex min-w-[34px] items-center justify-center text-sm font-black text-primary">
                                                            {item.quantity}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="flex h-9 w-9 items-center justify-center rounded-xl text-primary transition-colors hover:bg-white"
                                                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                                            aria-label="Tăng số lượng"
                                                        >
                                                            <span className="material-symbols-outlined text-[18px]">add</span>
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="mt-3 flex items-center justify-between rounded-2xl bg-background-light px-3 py-2.5">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Tổng sản phẩm</span>
                                                    <span className="text-sm font-black text-primary">{formatCurrency(lineTotal)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="hidden gap-6 border border-gold/10 bg-white p-6 transition-all hover:shadow-hover lg:flex">
                                        <div className="aspect-square w-32 overflow-hidden bg-background-light">
                                            <img
                                                src={getItemImage(item)}
                                                alt={item.product?.name}
                                                className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
                                            />
                                        </div>

                                        <div className="flex flex-1 flex-col justify-between py-2">
                                            <div className="space-y-2">
                                                <div className="flex items-start justify-between gap-4">
                                                    <div className="space-y-2">
                                                        <Link
                                                            to={getItemLink(item)}
                                                            className="font-display text-xl font-bold text-primary transition-colors hover:text-gold"
                                                        >
                                                            {item.product?.name}
                                                        </Link>

                                                        {itemMeta.length > 0 ? (
                                                            <div className="flex flex-wrap gap-2">
                                                                {itemMeta.map((meta) => (
                                                                    <span
                                                                        key={`${item.id}-desktop-${meta}`}
                                                                        className="rounded-full bg-background-light px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-stone"
                                                                    >
                                                                        {meta}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : null}

                                                        <p className="font-body text-lg italic text-brick">{formatCurrency(item.price)}</p>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => removeFromCart(item.id)}
                                                        className="text-stone transition-colors hover:text-brick"
                                                        aria-label={`Xóa ${item.product?.name}`}
                                                    >
                                                        <span className="material-symbols-outlined text-sm">close</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="mt-6 flex items-center justify-between">
                                                <div className="flex h-10 w-28 items-center rounded-sm border border-gold/30 bg-background-light">
                                                    <button
                                                        type="button"
                                                        className="flex h-full w-8 items-center justify-center text-primary"
                                                        onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                                                    >
                                                        <span className="material-symbols-outlined text-xs">remove</span>
                                                    </button>
                                                    <span className="w-full text-center font-ui text-sm font-bold">{item.quantity}</span>
                                                    <button
                                                        type="button"
                                                        className="flex h-full w-8 items-center justify-center text-primary"
                                                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                                    >
                                                        <span className="material-symbols-outlined text-xs">add</span>
                                                    </button>
                                                </div>

                                                <p className="font-ui font-bold text-primary">{formatCurrency(lineTotal)}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        <div className="rounded-[24px] border border-primary/10 bg-white px-4 py-4 shadow-[0_10px_28px_rgba(27,54,93,0.06)] lg:hidden">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Tạm tính</p>
                                    <p className="mt-1 text-xl font-black text-primary">{formatCurrency(cartTotal)}</p>
                                </div>
                                <div className="rounded-2xl bg-primary/5 px-3 py-2 text-right">
                                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">Vận chuyển</p>
                                    <p className="mt-1 text-xs font-bold text-primary">Xác nhận ở bước thanh toán</p>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2 lg:pt-6">
                            <Link
                                to="/old/shop"
                                className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-primary transition-colors hover:text-gold"
                            >
                                <span className="material-symbols-outlined text-sm">west</span>
                                Tiếp tục chọn hàng
                            </Link>
                        </div>
                    </div>

                    <div className="hidden h-fit lg:sticky lg:top-24 lg:col-span-4 lg:block">
                        <div className="space-y-8 border-2 border-gold bg-white p-8 shadow-xl">
                            <h2 className="border-b border-gold/20 pb-4 font-display text-2xl font-bold uppercase text-primary">Tóm tắt đơn hàng</h2>

                            <div className="space-y-4 font-ui text-sm">
                                <div className="flex justify-between text-stone">
                                    <span>Tạm tính ({itemCount} món)</span>
                                    <span>{formatCurrency(cartTotal)}</span>
                                </div>
                                <div className="flex justify-between text-stone">
                                    <span>Vận chuyển</span>
                                    <span className="italic">Xác nhận ở bước thanh toán</span>
                                </div>
                                <div className="flex items-end justify-between border-t border-gold/10 pt-4">
                                    <span className="font-bold uppercase tracking-wider text-primary">Tổng cộng</span>
                                    <span className="font-display text-2xl font-bold italic text-brick">{formatCurrency(cartTotal)}</span>
                                </div>
                            </div>

                            <Link
                                to="/old/checkout"
                                className="flex w-full items-center justify-center gap-3 bg-primary py-4 font-ui text-white shadow-lg shadow-primary/20 transition-all hover:bg-umber"
                            >
                                <span className="font-bold uppercase tracking-widest">Tiến hành thanh toán</span>
                                <span className="material-symbols-outlined text-sm">east</span>
                            </Link>

                            <div className="flex items-center justify-center gap-4 pt-4 text-gold/50">
                                <span className="material-symbols-outlined text-4xl">payments</span>
                                <span className="material-symbols-outlined text-4xl">local_shipping</span>
                                <span className="material-symbols-outlined text-4xl">verified_user</span>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 pt-3 shadow-[0_-16px_40px_rgba(27,54,93,0.14)] backdrop-blur lg:hidden">
                <div className="mx-auto flex max-w-[1280px] items-center gap-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-400">Tổng thanh toán</p>
                        <p className="mt-1 truncate text-lg font-black text-primary">{formatCurrency(cartTotal)}</p>
                        <p className="mt-1 text-[11px] text-stone">{itemCount} sản phẩm trong giỏ</p>
                    </div>

                    <Link
                        to="/old/checkout"
                        className="inline-flex min-h-[52px] shrink-0 items-center justify-center rounded-2xl bg-primary px-5 text-xs font-black uppercase tracking-[0.18em] text-white shadow-lg shadow-primary/20 transition-all hover:bg-umber"
                    >
                        Chốt đơn
                    </Link>
                </div>
            </div>
        </>
    );
};

export default Cart;
