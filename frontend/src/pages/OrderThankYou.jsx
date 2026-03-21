import React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

const formatOrderDate = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return value || '';

    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    return `${day} Tháng ${month}, ${year}`;
};

const paymentMethodLabel = (method) => {
    if (method === 'bank_transfer') return 'Chuyển khoản Ngân hàng';
    if (method === 'cod') return 'Thanh toán khi nhận hàng';
    return method || 'Thanh toán khi nhận hàng';
};

const getItemSubtotal = (item) => {
    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const subtotal = Number(item.subtotal || 0);
    if (quantity > 0 && price > 0) return quantity * price;
    return subtotal;
};

const OrderThankYou = () => {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const state = location.state || {};
    const isLegacy = location.pathname.startsWith('/old/');

    const items = Array.isArray(state.items) ? state.items : [];
    const totalItems = state.totalItems || items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalAmount = state.totalAmount || items.reduce((sum, item) => sum + getItemSubtotal(item), 0);

    const orderNumber = state.orderNumber || searchParams.get('order') || 'WEB-00000000';
    const displayOrderNumber = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;

    const customerName = state.customerName || 'Quý khách';
    const customerPhone = state.phone || '';
    const shippingAddress =
        state.shippingAddress || 'Thông tin địa chỉ sẽ được xác nhận trong cuộc gọi chốt đơn.';

    const continuePath = state.continuePath || (isLegacy ? '/old/shop' : '/san-pham');
    const continueLabel = state.continueLabel || 'TIẾP TỤC MUA SẮM';
    const historyPath = state.secondaryPath || (isLegacy ? '/old/dashboard' : '/');
    const historyLabel = state.secondaryLabel || 'XEM LỊCH SỬ ĐƠN HÀNG';

    const description =
        state.message ||
        'Đơn hàng của anh chị đã được tiếp nhận. Bên em sẽ sớm gọi lại xác nhận đơn hàng và đóng gói gửi đến mình sớm nhất ạ.';

    return (
        <div className="min-h-screen bg-[#f8f5ef] px-4 py-10 text-[#223860] md:px-6 md:py-14">
            <main className="mx-auto w-full max-w-[860px]">
                <section className="overflow-hidden rounded-[6px] border border-[#dfd6c8] bg-[#fffdfa] shadow-[0_16px_35px_rgba(28,45,77,0.14)]">
                    <div className="relative bg-[linear-gradient(130deg,#2e3a62_0%,#34426f_52%,#2f3c66_100%)] px-6 pb-7 pt-12 text-center md:pb-8">
                        <div className="absolute inset-x-0 top-0 h-[4px] bg-[#c8a356]" />
                        <div className="absolute inset-x-0 bottom-0 h-[4px] bg-[#c8a356]" />
                        <div className="absolute left-1/2 top-4 h-14 w-14 -translate-x-1/2 rounded-full border-4 border-[#f3ead7] bg-[#c8a356] shadow-[0_8px_18px_rgba(200,163,86,0.35)]">
                            <span className="material-symbols-outlined mt-[11px] block text-center text-[24px] text-white">check</span>
                        </div>
                        <h1
                            className="mt-7 text-4xl font-semibold italic leading-tight text-white md:text-5xl"
                            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                        >
                            Giao dịch Hoàn tất
                        </h1>
                    </div>

                    <div className="px-6 py-8 md:px-10 md:py-10">
                        <div className="mx-auto max-w-[700px] text-center">
                            <h2
                                className="text-3xl italic leading-tight text-[#1f3560] md:text-[44px]"
                                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                            >
                                Cảm ơn anh chị đã tin tưởng đặt hàng em !
                            </h2>
                            <p
                                className="mt-3 text-[17px] leading-8 text-[#415171] md:text-[20px]"
                                style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                            >
                                {description}
                            </p>
                        </div>

                        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
                            <article className="rounded-[5px] border border-[#e6dccd] bg-[#fefdf9] p-5">
                                <h3
                                    className="flex items-center gap-2 text-[23px] font-medium text-[#223860]"
                                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                                >
                                    <span className="material-symbols-outlined text-[18px] text-[#c8a356]">receipt_long</span>
                                    Chi tiết Đơn hàng
                                </h3>
                                <div
                                    className="mt-3 border-t border-[#ebe2d5] pt-3 text-[18px] text-[#314363]"
                                    style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                                >
                                    <div className="flex items-center justify-between py-1.5">
                                        <span>Mã số đơn hàng:</span>
                                        <strong>{displayOrderNumber}</strong>
                                    </div>
                                    <div className="flex items-center justify-between py-1.5">
                                        <span>Ngày đặt:</span>
                                        <span>{formatOrderDate(state.createdAt)}</span>
                                    </div>
                                    <div className="flex items-center justify-between py-1.5">
                                        <span>Phương thức:</span>
                                        <span>{paymentMethodLabel(state.paymentMethod)}</span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between border-t border-[#ebe2d5] pt-2.5">
                                        <span className="text-[17px] font-semibold uppercase tracking-[0.08em]">Tổng cộng:</span>
                                        <strong className="text-[30px]">{formatCurrency(totalAmount)}</strong>
                                    </div>
                                </div>
                            </article>

                            <article className="rounded-[5px] border border-[#e6dccd] bg-[#fefdf9] p-5">
                                <h3
                                    className="flex items-center gap-2 text-[23px] font-medium text-[#223860]"
                                    style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                                >
                                    <span className="material-symbols-outlined text-[18px] text-[#c8a356]">local_shipping</span>
                                    Thông tin Giao nhận
                                </h3>
                                <div
                                    className="mt-3 border-t border-[#ebe2d5] pt-3 text-[18px] leading-7 text-[#314363]"
                                    style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                                >
                                    <p className="font-semibold">{customerName}</p>
                                    {customerPhone ? <p>{customerPhone}</p> : null}
                                    <p className="break-words">{shippingAddress}</p>
                                    <p className="pt-1 text-[16px] italic text-[#c8a356]">Dự kiến giao hàng: 3-5 ngày làm việc</p>
                                </div>
                            </article>
                        </div>

                        <section className="mt-7">
                            <h3
                                className="flex items-center gap-2 text-[31px] font-medium text-[#223860]"
                                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                            >
                                <span className="material-symbols-outlined text-[18px] text-[#c8a356]">inventory_2</span>
                                Sản phẩm đã chọn
                            </h3>

                            <div className="mt-3 divide-y divide-[#e9e0d2] border-y border-[#e9e0d2]">
                                {items.length > 0 ? (
                                    items.map((item, index) => {
                                        const quantity = Number(item.quantity || 1);
                                        const subtotal = getItemSubtotal(item);
                                        const meta = item.meta || item.sku || 'Sản phẩm thủ công tuyển chọn';
                                        return (
                                            <div
                                                key={`${item.id || item.sku || item.name || 'item'}-${index}`}
                                                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                                            >
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-[3px] border border-[#e4dbcf] bg-[#f3f3f3]">
                                                        {item.image ? (
                                                            <img
                                                                src={item.image}
                                                                alt={item.name || 'Sản phẩm'}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="flex h-full w-full items-center justify-center text-[#9ea6b0]">
                                                                <span className="material-symbols-outlined text-[20px]">image</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p
                                                            className="truncate text-[26px] leading-tight text-[#223860]"
                                                            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                                                        >
                                                            {item.name || 'Sản phẩm trong đơn hàng'}
                                                        </p>
                                                        <p
                                                            className="mt-0.5 text-[16px] text-[#6a7690]"
                                                            style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                                                        >
                                                            {meta}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div
                                                    className="text-right text-[20px] text-[#223860]"
                                                    style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                                                >
                                                    <p className="font-semibold">{formatCurrency(subtotal)}</p>
                                                    <p className="text-[16px] text-[#6a7690]">Số lượng: {String(quantity).padStart(2, '0')}</p>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div
                                        className="py-6 text-center text-[17px] text-[#6f7d97]"
                                        style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                                    >
                                        Chưa có dữ liệu sản phẩm để hiển thị.
                                    </div>
                                )}
                            </div>
                        </section>

                        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <Link
                                to={continuePath}
                                className="min-w-[210px] rounded-[4px] border border-[#203b67] bg-[#203b67] px-6 py-2.5 text-center text-[17px] font-semibold uppercase tracking-[0.07em] text-white transition-colors hover:bg-[#2a4a7d]"
                                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                            >
                                {continueLabel}
                            </Link>
                            <Link
                                to={historyPath}
                                className="min-w-[260px] rounded-[4px] border-2 border-[#c8a356] px-6 py-2.5 text-center text-[17px] font-semibold uppercase tracking-[0.07em] text-[#c8a356] transition-colors hover:bg-[#c8a356] hover:text-white"
                                style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                            >
                                {historyLabel}
                            </Link>
                        </div>
                    </div>

                    <footer
                        className="border-t border-[#ede4d8] bg-[#f9f4ea] px-6 py-4 text-center text-[17px] italic text-[#7a869e]"
                        style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                    >
                        Mọi thắc mắc vui lòng liên hệ: <span className="text-[#c8a356]">1900 1234</span> hoặc <span className="text-[#c8a356]">hotro@disangomviet.vn</span>
                    </footer>
                </section>

                <p
                    className="mt-6 text-center text-[14px] text-[#9ca8bd]"
                    style={{ fontFamily: "'EB Garamond', Georgia, serif" }}
                >
                    Tổng món: {totalItems}
                </p>
            </main>
        </div>
    );
};

export default OrderThankYou;
