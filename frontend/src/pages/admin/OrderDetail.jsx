import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orderApi, orderStatusApi } from '../../services/api';
import { getOrderTypeMeta, isSpecialOrderType } from '../../config/orderTypes';

const moneyFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const formatMoney = (value) => `${moneyFormatter.format(Number(value || 0))}đ`;

const OrderDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    const [orderStatuses, setOrderStatuses] = useState([]);

    useEffect(() => {
        fetchInitialData();
    }, [id]);

    const fetchInitialData = async () => {
        try {
            const [orderRes, statusRes] = await Promise.all([
                orderApi.getOne(id),
                orderStatusApi.getAll()
            ]);
            setOrder(orderRes.data);
            setOrderStatuses(statusRes.data);
        } catch (error) {
            console.error("Error fetching order detail data", error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateStatus = async (newStatus) => {
        setUpdating(true);
        try {
            const response = await orderApi.updateStatus(id, newStatus);
            setOrder(response.data);
        } catch (error) {
            console.error("Error updating status", error);
        } finally {
            setUpdating(false);
        }
    };

    const getStatusLabel = (status) => {
        const found = orderStatuses.find(s => s.code === status);
        return found ? found.name : status;
    };

    const getStatusColorStyle = (status) => {
        const found = orderStatuses.find(s => s.code === status);
        if (found) {
            return {
                backgroundColor: `${found.color}15`,
                color: found.color,
                borderColor: `${found.color}30`
            };
        }
        return {};
    };

    const orderTypeMeta = getOrderTypeMeta(order?.order_type);
    const specialOrderType = isSpecialOrderType(order?.order_type);
    const supplementItems = order?.supplement_items || order?.supplementItems || [];

    if (loading) return <div className="p-8 text-center italic text-primary">Đang tải chi tiết đơn hàng...</div>;
    if (!order) return <div className="p-8 text-center text-brick">Không tìm thấy đơn hàng.</div>;

    return (
        <div className="space-y-8 p-6 animate-fade-in max-w-6xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <div className="flex items-center gap-4 mb-2">
                        <button onClick={() => navigate('/admin/orders')} className="text-primary/60 hover:text-primary transition-colors">
                            <span className="material-symbols-outlined">arrow_back</span>
                        </button>
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary/40">Chi tiết đơn hàng</div>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                <span className="text-[18px] font-black text-primary">{order.order_number}</span>
                                <span className="inline-flex items-center rounded-sm border border-primary/15 bg-primary/[0.03] px-2 py-1 text-[11px] font-black text-primary/70">
                                    {orderTypeMeta.label}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 print:hidden">
                    <button
                        onClick={() => window.print()}
                        className="px-6 py-2 bg-primary/5 text-primary border border-primary/20 font-ui text-[10px] font-bold uppercase tracking-widest hover:bg-primary/10 transition-all flex items-center gap-2 shadow-sm"
                    >
                        <span className="material-symbols-outlined text-sm">print</span>
                        In Hóa Đơn
                    </button>
                    <select
                        value={order.status}
                        onChange={(e) => handleUpdateStatus(e.target.value)}
                        disabled={updating}
                        style={getStatusColorStyle(order.status)}
                        className="px-4 py-2 border font-ui text-xs font-bold uppercase tracking-widest focus:outline-none"
                    >
                        {orderStatuses.filter(s => s.is_active || s.code === order.status).map(s => (
                            <option key={s.id} value={s.code}>{s.name}</option>
                        ))}
                    </select>
                </div>

                <style dangerouslySetInnerHTML={{
                    __html: `
                    @media print {
                        body { background: white !important; padding: 0 !important; margin: 0 !important; }
                        header, nav, .sidebar, .print\\:hidden, button, select { display: none !important; }
                        .p-6 { padding: 0 !important; }
                        .max-w-6xl { max-width: 100% !important; margin: 0 !important; }
                        .shadow-xl, .shadow-2xl { shadow: none !important; border: 1px solid #eee !important; }
                        .bg-primary { color: black !important; background: transparent !important; border: 1px solid #eee !important; }
                        .text-white { color: black !important; }
                        .md\\:grid-cols-3 { grid-template-cols: 1fr !important; }
                        .md\\:col-span-2 { grid-column: span 1 / span 1 !important; }
                        .animate-fade-in { animation: none !important; }
                        .bg-background-light { background: #f9f9f9 !important; }
                        img { max-width: 100px !important; }
                        .material-symbols-outlined { display: none !important; }
                        .customer-info-box { background: white !important; border: 1px solid #eee !important; color: black !important; }
                    }
                `}} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Main Content */}
                <div className="md:col-span-2 space-y-8">
                    {/* Items Table */}
                    <div className="bg-white border border-primary/10 shadow-xl overflow-hidden">
                        <div className="p-4 border-b border-primary/10 bg-primary/5">
                            <h3 className="font-display font-bold text-lg text-primary">Danh sách sản phẩm</h3>
                        </div>
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-primary/5 font-ui text-[10px] font-bold text-primary/60 uppercase tracking-widest border-b border-primary/10">
                                <tr>
                                    <th className="p-4">Sản Phẩm</th>
                                    <th className="p-4 text-center">Đơn Giá</th>
                                    <th className="p-4 text-center">Số Lượng</th>
                                    <th className="p-4 text-right">Tổng</th>
                                </tr>
                            </thead>
                            <tbody className="font-body">
                                {order.items?.map(item => (
                                    <tr key={item.id} className="border-b border-primary/5">
                                        <td className="p-4">
                                            <div className="flex items-center gap-4">
                                                <div className="size-12 bg-primary/5 flex-shrink-0">
                                                    {item.product?.image_url && <img src={item.product.image_url} alt={item.product.name} className="size-full object-cover" />}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-primary">{item.product?.name}</span>
                                                    <span className="text-[10px] text-primary/40 uppercase font-ui font-black">SKU: {item.product?.sku}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center text-sm">{new Intl.NumberFormat('vi-VN').format(item.price)}đ</td>
                                        <td className="p-4 text-center font-bold text-sm">x{item.quantity}</td>
                                        <td className="p-4 text-right font-bold text-brick">{new Intl.NumberFormat('vi-VN').format(item.price * item.quantity)}đ</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-primary/5 font-ui">
                                <tr>
                                    <td colSpan="3" className="p-4 text-right font-bold text-primary/40 uppercase text-[10px] tracking-widest">Tổng tiền hàng</td>
                                    <td className="p-4 text-right font-display font-bold text-xl text-primary">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total_price)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {specialOrderType && (
                        <div className="bg-white border border-primary/10 shadow-xl overflow-hidden rounded-sm">
                            <div className="p-4 border-b border-primary/10 bg-amber-50">
                                <h3 className="font-display font-bold text-lg text-primary">{orderTypeMeta.sectionTitle}</h3>
                                <p className="mt-1 text-[12px] text-primary/55">{orderTypeMeta.sectionDescription}</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-primary/5 font-ui text-[10px] font-bold text-primary/60 uppercase tracking-widest border-b border-primary/10">
                                        <tr>
                                            <th className="p-4">Sản phẩm</th>
                                            <th className="p-4 text-center">Số lượng</th>
                                            <th className="p-4 text-right">Đơn giá</th>
                                            <th className="p-4 text-right">Giá vốn</th>
                                            <th className="p-4">Ghi chú</th>
                                            <th className="p-4 text-right">Thành tiền</th>
                                        </tr>
                                    </thead>
                                    <tbody className="font-body">
                                        {supplementItems.length > 0 ? supplementItems.map((item) => (
                                            <tr key={item.id || `${item.product_id}-${item.notes || ''}`} className="border-b border-primary/5">
                                                <td className="p-4">
                                                    <div className="font-bold text-primary">{item.product?.name || item.product_name_snapshot || item.name || `Sản phẩm #${item.product_id}`}</div>
                                                    <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-orange-600/70">
                                                        SKU: {item.product?.sku || item.product_sku_snapshot || item.sku || 'N/A'}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-center font-bold text-sm">x{item.quantity}</td>
                                                <td className="p-4 text-right text-sm">{formatMoney(item.price)}</td>
                                                <td className="p-4 text-right text-sm">{formatMoney(item.cost_price)}</td>
                                                <td className="p-4 text-sm text-primary/70">{item.notes || '-'}</td>
                                                <td className="p-4 text-right font-bold text-brick">{formatMoney(item.total_price ?? (Number(item.price || 0) * Number(item.quantity || 0)))}</td>
                                            </tr>
                                        )) : (
                                            <tr>
                                                <td colSpan="6" className="p-6 text-center text-sm text-primary/40 italic">Chưa có sản phẩm khai báo bổ sung.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Custom Attributes (EAV) */}
                    {order.attribute_values?.length > 0 && (
                        <div className="bg-white border border-primary/10 shadow-xl overflow-hidden rounded-sm">
                            <div className="p-4 border-b border-primary/10 bg-primary/5">
                                <h3 className="font-display font-bold text-lg text-primary">Thông tin bổ sung</h3>
                            </div>
                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                {order.attribute_values.map(av => (
                                    <div key={av.id} className="flex flex-col border-b border-primary/5 pb-2">
                                        <span className="text-[10px] font-bold text-primary/40 uppercase tracking-widest mb-1">{av.attribute?.name}</span>
                                        <span className="font-body text-[#0F172A] font-medium">{av.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    <div className="bg-white border border-primary/10 shadow-xl overflow-hidden rounded-sm">
                        <div className="p-4 border-b border-primary/10 bg-primary/5">
                            <h3 className="font-display font-bold text-lg text-primary">Ghi chú đơn hàng</h3>
                        </div>
                        <div className="p-6 font-body text-primary/60 italic text-sm">
                            {order.notes || "Không có ghi chú nào từ khách hàng."}
                        </div>
                    </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-8">
                    {/* Customer Info */}
                    <div className="bg-primary text-white p-6 shadow-xl relative overflow-hidden group customer-info-box border border-primary/20">
                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-125 transition-transform">
                            <span className="material-symbols-outlined text-6xl">person</span>
                        </div>
                        <h3 className="font-ui font-black text-[10px] uppercase tracking-[0.2em] text-white/40 mb-6 relative">Thông tin khách hàng</h3>
                        <div className="space-y-4 relative">
                            <div className="flex flex-col">
                                <span className="text-[11px] text-white/30 uppercase font-black tracking-widest mb-0.5">Khách hàng</span>
                                <span className="font-display font-bold text-xl">{order.customer_name}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[11px] text-white/30 uppercase font-black tracking-widest mb-0.5">Số điện thoại</span>
                                <span className="font-body font-bold text-lg">{order.customer_phone}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[11px] text-white/30 uppercase font-black tracking-widest mb-0.5">Email liên hệ</span>
                                <span className="font-body text-sm text-white/70">{order.customer_email || "N/A"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Shipping Address */}
                    <div className="bg-white border border-primary/10 p-6 shadow-xl">
                        <h3 className="font-ui font-black text-[10px] uppercase tracking-[0.2em] text-primary/30 mb-6">Địa chỉ giao hàng</h3>
                        <div className="flex gap-4">
                            <span className="material-symbols-outlined text-primary/40">location_on</span>
                            <p className="font-body text-sm leading-loose text-[#0F172A] font-medium">
                                {order.shipping_address}
                            </p>
                        </div>
                    </div>

                    {/* Internal Info */}
                    <div className="bg-primary/5 border border-primary/10 p-6">
                        <h3 className="font-ui font-black text-[10px] uppercase tracking-[0.2em] text-primary/30 mb-4 text-center">Thông tin hệ thống</h3>
                        <div className="space-y-3 text-xs">
                            <div className="flex justify-between border-b border-primary/5 pb-2">
                                <span className="text-primary/40">Tài khoản đặt:</span>
                                <span className="font-bold text-primary">{order.user?.name || "Khách vãng lai"}</span>
                            </div>
                            <div className="flex justify-between border-b border-primary/5 pb-2">
                                <span className="text-primary/40">Loại đơn:</span>
                                <span className="font-bold text-primary">{orderTypeMeta.label}</span>
                            </div>
                            {specialOrderType && (
                                <div className="flex justify-between border-b border-primary/5 pb-2">
                                    <span className="text-primary/40">{orderTypeMeta.settlementLabel}:</span>
                                    <span className={`font-bold ${Number(order.settlement_delta || 0) >= 0 ? 'text-emerald-700' : 'text-brick'}`}>
                                        {formatMoney(order.settlement_delta)}
                                    </span>
                                </div>
                            )}
                            <div className="flex justify-between border-b border-primary/5 pb-2">
                                <span className="text-primary/40">Lần cập nhật cuối:</span>
                                <span className="font-bold text-primary">{new Date(order.updated_at).toLocaleDateString('vi-VN')}</span>
                            </div>
                        </div>
                    </div>
                    {specialOrderType && (
                        <div className="bg-amber-50 border border-amber-200 p-6 shadow-xl">
                            <h3 className="font-ui font-black text-[10px] uppercase tracking-[0.2em] text-amber-700/60 mb-4 text-center">Chỉ số báo cáo</h3>
                            <div className="space-y-3 text-xs">
                                <div className="flex justify-between border-b border-amber-200/70 pb-2">
                                    <span className="text-amber-900/60">Doanh thu báo cáo:</span>
                                    <span className="font-bold text-amber-900">{formatMoney(order.report_revenue_total)}</span>
                                </div>
                                <div className="flex justify-between border-b border-amber-200/70 pb-2">
                                    <span className="text-amber-900/60">Giá vốn báo cáo:</span>
                                    <span className="font-bold text-amber-900">{formatMoney(order.report_cost_total)}</span>
                                </div>
                                <div className="flex justify-between border-b border-amber-200/70 pb-2">
                                    <span className="text-amber-900/60">Giá trị hàng khai báo:</span>
                                    <span className="font-bold text-amber-900">{formatMoney(order.supplement_items_total_price)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-amber-900/60">Lãi / lỗ báo cáo:</span>
                                    <span className={`font-bold ${Number(order.report_profit_total || 0) >= 0 ? 'text-emerald-700' : 'text-brick'}`}>
                                        {formatMoney(order.report_profit_total)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OrderDetail;
