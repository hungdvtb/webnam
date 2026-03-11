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
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
            <style>
                {`
                    .custom-scrollbar::-webkit-scrollbar {
                        width: 8px;
                        height: 8px;
                    }
                    .custom-scrollbar::-webkit-scrollbar-track {
                        background: rgba(182, 143, 84, 0.05);
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb {
                        background: rgba(182, 143, 84, 0.2);
                        border-radius: 4px;
                        border: 2px solid transparent;
                        background-clip: content-box;
                    }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                        background: rgba(182, 143, 84, 0.4);
                    }
                `}
            </style>

            {/* Header Area */}
            <div className="flex-none bg-[#fcfcfa] pb-4">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-display font-bold text-primary italic">Dữ liệu khách hàng</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Lịch sử tương tác và giá trị đơn hàng tích lũy</p>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="bg-white border border-gold/10 p-2 shadow-sm rounded-sm flex items-center justify-between">
                    <div className="flex gap-1.5 items-center">
                        <div className="relative group max-w-md">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-stone/30 text-[18px] group-focus-within:text-primary transition-colors">search</span>
                            <input
                                type="text"
                                placeholder="Tìm tên, email, sđt..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                onKeyPress={e => e.key === 'Enter' && fetchCustomers()}
                                className="bg-stone/5 border border-gold/10 pl-10 pr-4 py-1.5 focus:outline-none focus:border-primary font-body text-[13px] rounded-sm w-64 md:w-80 transition-all placeholder:text-stone/30"
                            />
                        </div>
                        <button
                            onClick={fetchCustomers}
                            className={`bg-primary text-white border border-primary p-1.5 hover:bg-umber transition-all flex items-center justify-center rounded-sm w-9 h-9 ${loading ? 'opacity-70' : ''}`}
                            title="Làm mới"
                            disabled={loading}
                        >
                            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
                        </button>
                    </div>
                    <div className="text-[11px] font-bold text-stone/40 uppercase tracking-[0.1em]">
                        {customers.length} khách hàng được tìm thấy
                    </div>
                </div>
            </div>

            {/* Content Area - Table */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white border border-gold/10 rounded-sm shadow-sm relative">
                <table className="w-full text-left border-collapse table-fixed">
                    <thead className="sticky top-0 z-20 bg-[#fcf8f1] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                        <tr className="border-b border-gold/20">
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[30%]">Hồ sơ khách</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-center">Phân loại</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%] text-center">Đơn</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[15%] text-right font-bold">Chi tiêu</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[20%] text-center">Gia nhập</th>
                            <th className="px-4 py-3 font-ui text-[11px] font-black uppercase tracking-widest text-primary w-[10%] text-right">#</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gold/5">
                        {loading ? (
                            <tr>
                                <td colSpan="6" className="py-20">
                                    <div className="flex flex-col items-center justify-center gap-4 opacity-30">
                                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                                        <span className="text-[11px] font-black text-stone/30 uppercase tracking-[0.2em]">Đang truy xuất dữ liệu...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : customers.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="py-20">
                                    <div className="flex flex-col items-center justify-center gap-3 opacity-20">
                                        <span className="material-symbols-outlined text-[64px]">person_search</span>
                                        <span className="text-[14px] font-bold uppercase tracking-widest italic">Không có dữ liệu phù hợp</span>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            customers.map(c => (
                                <tr key={c.id} className="hover:bg-gold/5 transition-all group active:bg-gold/10">
                                    <td className="px-4 py-3.5">
                                        <div className="flex items-center gap-3">
                                            <div className="size-9 rounded-sm bg-primary/5 border border-gold/20 flex items-center justify-center text-primary font-bold text-sm shrink-0 shadow-inner group-hover:bg-primary group-hover:text-white transition-all">
                                                {c.name.charAt(0)}
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-bold text-[14px] text-primary truncate leading-tight group-hover:text-umber transition-colors">{c.name}</span>
                                                <span className="text-[10px] text-stone/50 font-ui truncate mt-0.5">{c.phone} {c.email ? `| ${c.email}` : ''}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border rounded-[2px] ${getGroupBadge(c.group)}`}>
                                            {c.group}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className="font-ui text-[13px] font-black text-stone/60">{c.total_orders}</span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="font-bold text-[14px] text-brick leading-none">
                                                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(c.total_spent)}
                                            </span>
                                            <span className="text-[9px] font-black text-stone/30 uppercase tracking-tighter mt-1 italic">Tích lũy</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3.5 text-center">
                                        <span className="text-[12px] text-stone/60 font-medium italic">
                                            {new Date(c.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <button className="size-8 flex items-center justify-center text-stone/30 hover:text-primary hover:bg-primary/5 rounded-sm transition-all active:scale-90" title="Xem lịch sử">
                                            <span className="material-symbols-outlined text-[20px]">history</span>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CustomerManagement;
