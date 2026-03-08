import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orderApi } from '../../services/api';

const OrderDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        fetchOrder();
    }, [id]);

    const fetchOrder = async () => {
        try {
            const response = await orderApi.getOne(id);
            setOrder(response.data);
        } catch (error) {
            console.error("Error fetching order", error);
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
        const labels = {
            'new': 'Mới',
            'confirmed': 'Đã xác nhận',
            'processing': 'Đang xử lý',
            'shipping': 'Đang giao hàng',
            'completed': 'Hoàn thành',
            'cancelled': 'Đã hủy',
            'returned': 'Trả hàng'
        };
        return labels[status] || status;
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'new': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'confirmed': return 'bg-gold/10 text-gold border-gold/20';
            case 'processing': return 'bg-orange-50 text-orange-700 border-orange-200';
            case 'shipping': return 'bg-umber/10 text-umber border-umber/20';
            case 'completed': return 'bg-green-50 text-green-700 border-green-200';
            case 'cancelled': return 'bg-red-50 text-red-700 border-red-200';
            case 'returned': return 'bg-stone-100 text-stone-700 border-stone-300';
            default: return 'bg-stone-50 text-stone-600 border-stone-200';
        }
    };

    if (loading) return <div className="p-8 text-center italic text-primary">Đang tải chi tiết đơn hàng...</div>;
    if (!order) return <div className="p-8 text-center text-brick">Không tìm thấy đơn hàng.</div>;

    return (
        <div className="space-y-8 p-6 animate-fade-in max-w-6xl mx-auto">
            <div className="flex justify-between items-start">
                <div>
                    <div className="flex items-center gap-4 mb-2">
                        <button onClick={() => navigate('/admin/orders')} className="text-stone hover:text-primary transition-colors">
                            <span className="material-symbols-outlined">arrow_back</span>
                        </button>
                        <h1 className="text-3xl font-display font-bold text-primary italic">Chi Tiết Đơn Hàng #{order.order_number}</h1>
                    </div>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold">Ngày đặt: {new Date(order.created_at).toLocaleString('vi-VN')}</p>
                </div>

                <div className="flex gap-2 print:hidden">
                    <button
                        onClick={() => window.print()}
                        className="px-6 py-2 bg-stone-100 text-stone-700 border border-stone-200 font-ui text-[10px] font-bold uppercase tracking-widest hover:bg-stone-200 transition-all flex items-center gap-2 shadow-sm"
                    >
                        <span className="material-symbols-outlined text-sm">print</span>
                        In Hóa Đơn
                    </button>
                    <select
                        value={order.status}
                        onChange={(e) => handleUpdateStatus(e.target.value)}
                        disabled={updating}
                        className={`px-4 py-2 border font-ui text-xs font-bold uppercase tracking-widest focus:outline-none ${getStatusColor(order.status)}`}
                    >
                        <option value="new">Mới</option>
                        <option value="confirmed">Đã xác nhận</option>
                        <option value="processing">Đang xử lý</option>
                        <option value="shipping">Đang giao hàng</option>
                        <option value="completed">Hoàn thành</option>
                        <option value="cancelled">Đã hủy</option>
                        <option value="returned">Trả hàng</option>
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
                    <div className="bg-white border border-gold/10 shadow-xl overflow-hidden">
                        <div className="p-4 border-b border-gold/10 bg-background-light">
                            <h3 className="font-display font-bold text-lg text-primary">Danh sách sản phẩm</h3>
                        </div>
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-stone/5 font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                                <tr>
                                    <th className="p-4">Sản Phẩm</th>
                                    <th className="p-4 text-center">Đơn Giá</th>
                                    <th className="p-4 text-center">Số Lượng</th>
                                    <th className="p-4 text-right">Tổng</th>
                                </tr>
                            </thead>
                            <tbody className="font-body">
                                {order.items?.map(item => (
                                    <tr key={item.id} className="border-b border-gold/5">
                                        <td className="p-4">
                                            <div className="flex items-center gap-4">
                                                <div className="size-12 bg-stone/5 flex-shrink-0">
                                                    {item.product?.image_url && <img src={item.product.image_url} alt={item.product.name} className="size-full object-cover" />}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-primary">{item.product?.name}</span>
                                                    <span className="text-[10px] text-stone uppercase font-ui">SKU: {item.product?.sku}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center text-sm">{new Intl.NumberFormat('vi-VN').format(item.price)}đ</td>
                                        <td className="p-4 text-center font-bold text-sm">x{item.quantity}</td>
                                        <td className="p-4 text-right font-bold text-brick">{new Intl.NumberFormat('vi-VN').format(item.price * item.quantity)}đ</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-background-light font-ui">
                                <tr>
                                    <td colSpan="3" className="p-4 text-right font-bold text-stone uppercase text-[10px] tracking-widest">Tổng tiền hàng</td>
                                    <td className="p-4 text-right font-display font-bold text-xl text-primary">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total_price)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Custom Attributes (EAV) */}
                    {order.attribute_values?.length > 0 && (
                        <div className="bg-white border border-gold/10 shadow-xl">
                            <div className="p-4 border-b border-gold/10 bg-background-light">
                                <h3 className="font-display font-bold text-lg text-primary">Thông tin bổ sung (EAV)</h3>
                            </div>
                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                {order.attribute_values.map(av => (
                                    <div key={av.id} className="flex flex-col border-b border-gold/5 pb-2">
                                        <span className="text-[10px] font-bold text-stone uppercase tracking-widest mb-1">{av.attribute?.name}</span>
                                        <span className="font-body text-primary">{av.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    <div className="bg-white border border-gold/10 shadow-xl">
                        <div className="p-4 border-b border-gold/10 bg-background-light">
                            <h3 className="font-display font-bold text-lg text-primary">Ghi chú đơn hàng</h3>
                        </div>
                        <div className="p-6 font-body text-stone italic">
                            {order.notes || "Không có ghi chú nào từ khách hàng."}
                        </div>
                    </div>
                </div>

                {/* Sidebar Info */}
                <div className="space-y-8">
                    {/* Customer Info */}
                    <div className="bg-primary text-white p-6 shadow-xl relative overflow-hidden group customer-info-box">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-125 transition-transform">
                            <span className="material-symbols-outlined text-6xl">person</span>
                        </div>
                        <h3 className="font-ui font-bold text-[10px] uppercase tracking-[0.2em] text-gold mb-6 relative">Thông tin khách hàng</h3>
                        <div className="space-y-4 relative">
                            <div className="flex flex-col">
                                <span className="text-xs text-stone/60">Tên khách hàng</span>
                                <span className="font-display font-bold text-xl">{order.customer_name}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs text-stone/60">Số điện thoại</span>
                                <span className="font-body font-bold">{order.customer_phone}</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs text-stone/60">Email</span>
                                <span className="font-body">{order.customer_email || "N/A"}</span>
                            </div>
                        </div>
                    </div>

                    {/* Shipping Address */}
                    <div className="bg-white border border-gold/10 p-6 shadow-xl">
                        <h3 className="font-ui font-bold text-[10px] uppercase tracking-[0.2em] text-gold mb-6">Địa chỉ giao hàng</h3>
                        <div className="flex gap-4">
                            <span className="material-symbols-outlined text-primary">location_on</span>
                            <p className="font-body text-sm leading-loose text-primary">
                                {order.shipping_address}
                            </p>
                        </div>
                    </div>

                    {/* Internal Info */}
                    <div className="bg-background-light border border-gold/10 p-6">
                        <h3 className="font-ui font-bold text-[10px] uppercase tracking-[0.2em] text-gold mb-4 text-center">Thông tin hệ thống</h3>
                        <div className="space-y-3 text-xs">
                            <div className="flex justify-between border-b border-gold/5 pb-2">
                                <span className="text-stone">Tài khoản đặt:</span>
                                <span className="font-bold text-primary">{order.user?.name || "Khách vãng lai"}</span>
                            </div>
                            <div className="flex justify-between border-b border-gold/5 pb-2">
                                <span className="text-stone">Lần cập nhật cuối:</span>
                                <span className="font-bold text-primary">{new Date(order.updated_at).toLocaleDateString('vi-VN')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderDetail;
