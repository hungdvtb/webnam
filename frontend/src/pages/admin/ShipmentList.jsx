import React, { useState, useEffect } from 'react';
import { shipmentApi } from '../../services/api';
import { useUI } from '../../context/UIContext';

const ShipmentList = () => {
    const [shipments, setShipments] = useState([]);
    const [loading, setLoading] = useState(true);
    const { showModal } = useUI();

    useEffect(() => {
        fetchShipments();
    }, []);

    const fetchShipments = async () => {
        setLoading(true);
        try {
            const response = await shipmentApi.getAll();
            setShipments(response.data);
        } catch (error) {
            console.error("Error fetching shipments", error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'pending': return 'bg-gold/10 text-gold border-gold/20';
            case 'processing': return 'bg-primary/10 text-primary border-primary/20';
            case 'shipped': return 'bg-umber/10 text-umber border-umber/20';
            case 'delivered': return 'bg-green-50 text-green-700 border-green-200';
            case 'cancelled': return 'bg-red-50 text-red-700 border-red-200';
            default: return 'bg-stone/10 text-stone border-stone/20';
        }
    };

    const handleUpdateStatus = async (id, status) => {
        try {
            await shipmentApi.updateStatus(id, status);
            fetchShipments();
        } catch (error) {
            showModal({
                title: 'Lỗi',
                content: 'Không thể cập nhật trạng thái vận đơn. Vui lòng thử lại.',
                type: 'error'
            });
        }
    };

    return (
        <div className="space-y-8 p-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary italic">Lịch Trình Vận Chuyển</h1>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold mt-1">Theo dõi đơn hàng & vận đơn</p>
                </div>
            </div>

            <div className="bg-white border border-gold/10 shadow-2xl">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                        <tr>
                            <th className="p-4">Mã Vận Đơn</th>
                            <th className="p-4">Đơn Hàng</th>
                            <th className="p-4">Kho Xuất</th>
                            <th className="p-4">Hãng Vận Chuyển</th>
                            <th className="p-4">Mã Tracking</th>
                            <th className="p-4 text-center">Trạng Thái</th>
                            <th className="p-4 text-right">Thao Tác</th>
                        </tr>
                    </thead>
                    <tbody className="font-body">
                        {shipments.map(shp => (
                            <tr key={shp.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                <td className="p-4 font-ui font-bold text-primary text-xs">{shp.shipment_number}</td>
                                <td className="p-4">
                                    <div className="flex flex-col">
                                        <span className="font-bold text-sm">#{shp.order?.order_number}</span>
                                        <span className="text-[10px] text-stone uppercase">{shp.order?.customer_name}</span>
                                    </div>
                                </td>
                                <td className="p-4 text-sm">{shp.warehouse?.name}</td>
                                <td className="p-4 font-bold text-sm">{shp.carrier_name || 'N/A'}</td>
                                <td className="p-4">
                                    <span className="text-xs font-ui text-stone bg-background-light px-2 py-1 rounded">{shp.tracking_number || 'Chưa cập nhật'}</span>
                                </td>
                                <td className="p-4 text-center">
                                    <span className={`px-2 py-1 text-[9px] font-bold uppercase tracking-widest border ${getStatusColor(shp.status)}`}>
                                        {shp.status}
                                    </span>
                                </td>
                                <td className="p-4 text-right">
                                    <select
                                        className="bg-transparent border border-gold/20 text-[10px] font-bold p-1 uppercase focus:outline-none focus:border-primary"
                                        value={shp.status}
                                        onChange={(e) => handleUpdateStatus(shp.id, e.target.value)}
                                    >
                                        <option value="pending">Pending</option>
                                        <option value="processing">Processing</option>
                                        <option value="shipped">Shipped</option>
                                        <option value="delivered">Delivered</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                </td>
                            </tr>
                        ))}
                        {!loading && shipments.length === 0 && (
                            <tr>
                                <td colSpan="7" className="p-12 text-center text-gold italic">Chưa có vận đơn nào được khởi tạo.</td>
                            </tr>
                        )}
                        {loading && (
                            <tr>
                                <td colSpan="7" className="p-12 text-center text-primary italic">Đang tải lịch trình vận chuyển...</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ShipmentList;
