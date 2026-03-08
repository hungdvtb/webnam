import React, { useState, useEffect } from 'react';
import { customerApi } from '../../services/api';

const CustomerManagement = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        fetchCustomers();
    }, []);

    const fetchCustomers = async () => {
        setLoading(true);
        try {
            const response = await customerApi.getAll({ search: searchTerm });
            setCustomers(response.data.data || response.data);
        } catch (error) {
            console.error("Error fetching customers", error);
        } finally {
            setLoading(false);
        }
    };

    const getGroupBadge = (group) => {
        switch (group) {
            case 'vip': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'wholesaler': return 'bg-blue-100 text-blue-700 border-blue-200';
            default: return 'bg-stone-100 text-stone-700 border-stone-200';
        }
    };

    return (
        <div className="space-y-8 p-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary italic">Hệ Thống Khách Hàng</h1>
                    <p className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold mt-1">Quản lý quan hệ & lịch sử mua hàng</p>
                </div>
                <div className="flex gap-4">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Tìm tên, email, sđt..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && fetchCustomers()}
                            className="bg-white border border-gold/30 pl-10 pr-4 py-2 font-body text-sm focus:outline-none focus:border-primary shadow-sm"
                        />
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone text-sm">search</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <div className="bg-white border border-gold/10 shadow-2xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-background-light font-ui text-[10px] font-bold text-stone uppercase tracking-widest border-b border-gold/10">
                            <tr>
                                <th className="p-4">Khách Hàng</th>
                                <th className="p-4">Phân Loại</th>
                                <th className="p-4">Số Đơn</th>
                                <th className="p-4">Tổng Chi Tiêu</th>
                                <th className="p-4">Ngày Tham Gia</th>
                                <th className="p-4 text-right">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody className="font-body">
                            {customers.map(c => (
                                <tr key={c.id} className="border-b border-gold/5 hover:bg-gold/5 transition-colors group">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="size-10 rounded-full bg-primary/5 flex items-center justify-center text-primary font-bold border border-primary/10">
                                                {c.name.charAt(0)}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-bold text-sm text-primary">{c.name}</span>
                                                <span className="text-[10px] text-stone font-ui">{c.phone} | {c.email || 'N/A'}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 text-[9px] font-bold uppercase tracking-widest border rounded-full ${getGroupBadge(c.group)}`}>
                                            {c.group}
                                        </span>
                                    </td>
                                    <td className="p-4 font-ui font-bold text-stone">{c.total_orders}</td>
                                    <td className="p-4 font-bold text-brick">
                                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(c.total_spent)}
                                    </td>
                                    <td className="p-4 text-xs text-stone">
                                        {new Date(c.created_at).toLocaleDateString('vi-VN')}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button className="text-primary hover:text-gold transition-colors">
                                            <span className="material-symbols-outlined text-xl">history</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {!loading && customers.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="p-12 text-center text-gold italic">Chưa tìm thấy khách hàng nào.</td>
                                </tr>
                            )}
                            {loading && (
                                <tr>
                                    <td colSpan="6" className="p-12 text-center text-primary italic">Đang tải dữ liệu khách hàng...</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default CustomerManagement;
