import React, { useState, useEffect } from 'react';
import { orderApi } from '../../services/api';
import { useNavigate, Link } from 'react-router-dom';

const OrderList = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchOrders();
    }, []);

    const fetchOrders = async () => {
        try {
            const response = await orderApi.getAll();
            // Handle paginated response (Laravel uses .data.data)
            const orderData = response.data.data || response.data;
            setOrders(Array.isArray(orderData) ? orderData : []);
        } catch (error) {
            console.error("Error fetching orders", error);
        } finally {
            setLoading(false);
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

    return (
        <div className="space-y-8 p-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary italic">Danh Sách Đơn Hàng</h1>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold mt-1">Quản lý giao dịch khách hàng</p>
                </div>
            </div>

            <div className="bg-white border border-gold/10 shadow-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                        <tr>
                            <th className="p-4">Mã Đơn</th>
                            <th className="p-4">Khách Hàng</th>
                            <th className="p-4">Ngày Đặt</th>
                            <th className="p-4">Tổng Tiền</th>
                            <th className="p-4 text-center">Trạng Thái</th>
                            <th className="p-4 text-right">Thao Tác</th>
                        </tr>
                    </thead>
                    <tbody className="font-body">
                        {orders.map(order => (
                            <tr key={order.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                <td className="p-4 font-ui font-bold text-primary">#{order.order_number}</td>
                                <td className="p-4">
                                    <div className="flex flex-col">
                                        <span className="font-bold text-sm">{order.customer_name}</span>
                                        <span className="text-[10px] text-stone font-ui">{order.customer_phone}</span>
                                    </div>
                                </td>
                                <td className="p-4 text-sm text-stone">{new Date(order.created_at).toLocaleDateString('vi-VN')}</td>
                                <td className="p-4 font-bold text-brick">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.total_price)}</td>
                                <td className="p-4 text-center">
                                    <span className={`px-2 py-1 text-[9px] font-bold uppercase tracking-widest border ${getStatusColor(order.status)}`}>
                                        {getStatusLabel(order.status)}
                                    </span>
                                </td>
                                <td className="p-4 text-right">
                                    <Link to={`/admin/orders/${order.id}`} className="text-primary hover:text-gold transition-colors inline-block">
                                        <span className="material-symbols-outlined text-xl">visibility</span>
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {!loading && orders.length === 0 && (
                            <tr>
                                <td colSpan="6" className="p-12 text-center text-gold italic">Chưa có đơn hàng nào.</td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan="6" className="p-12 text-center text-primary italic">Đang tải đơn hàng...</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default OrderList;
