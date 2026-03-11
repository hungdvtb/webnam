import React, { useState, useEffect } from 'react';
import { reportApi } from '../../services/api';

const ReportDashboard = () => {
    const [summary, setSummary] = useState(null);
    const [topProducts, setTopProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        setLoading(true);
        try {
            const [sRes, tRes] = await Promise.all([
                reportApi.getDashboard(),
                reportApi.getTopProducts()
            ]);
            setSummary(sRes.data);
            setTopProducts(tRes.data);
        } catch (error) {
            console.error("Error loading reports", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-12 text-center text-primary italic">Đang phân tích dữ liệu kinh doanh...</div>;

    return (
        <div className="space-y-10 p-6 animate-fade-in">
            <div className="flex justify-between items-center">

                <button onClick={fetchReports} className="text-primary hover:text-gold transition-colors">
                    <span className="material-symbols-outlined">refresh</span>
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-white border border-gold/10 p-8 shadow-premium relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                        <span className="material-symbols-outlined text-6xl">payments</span>
                    </div>
                    <div className="relative z-10">
                        <p className="text-[10px] font-bold text-stone uppercase tracking-widest mb-2">Doanh thu hôm nay</p>
                        <h3 className="text-4xl font-display font-bold text-brick italic">
                            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(summary?.sales_today || 0)}
                        </h3>
                    </div>
                </div>
                <div className="bg-white border border-gold/10 p-8 shadow-premium relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                        <span className="material-symbols-outlined text-6xl">shopping_bag</span>
                    </div>
                    <div className="relative z-10">
                        <p className="text-[10px] font-bold text-stone uppercase tracking-widest mb-2">Đơn hàng mới hôm nay</p>
                        <h3 className="text-4xl font-display font-bold text-primary italic">{summary?.orders_today || 0}</h3>
                    </div>
                </div>
                <div className="bg-white border border-gold/10 p-8 shadow-premium relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                        <span className="material-symbols-outlined text-6xl">warning</span>
                    </div>
                    <div className="relative z-10">
                        <p className="text-[10px] font-bold text-stone uppercase tracking-widest mb-2">Cảnh báo tồn kho thấp</p>
                        <h3 className="text-4xl font-display font-bold text-gold italic">{summary?.low_stock_alerts || 0}</h3>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                {/* Top Products */}
                <div className="bg-white border border-gold/10 shadow-2xl p-8">
                    <h3 className="font-display font-bold text-xl text-primary mb-6 border-b border-gold/10 pb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined">trending_up</span>
                        Top Sản Phẩm Bán Chạy
                    </h3>
                    <div className="space-y-4">
                        {topProducts.map((p, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 bg-background-light border border-gold/5 group hover:border-gold/20 transition-all">
                                <div className="flex items-center gap-4">
                                    <span className="font-display font-bold text-gold text-lg">0{idx + 1}</span>
                                    <div className="flex flex-col">
                                        <span className="font-bold text-sm text-primary">{p.name}</span>
                                        <span className="text-[10px] text-stone font-ui uppercase">{p.sku}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block font-bold text-sm">{p.total_qty} <span className="text-[10px] text-stone uppercase">Đã bán</span></span>
                                    <span className="text-[10px] text-brick font-bold">
                                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(p.total_revenue)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Sales Chart Placeholder */}
                <div className="bg-white border border-gold/10 shadow-2xl p-8 flex flex-col">
                    <h3 className="font-display font-bold text-xl text-primary mb-6 border-b border-gold/10 pb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined">show_chart</span>
                        Xu Hướng Doanh Thu (30 ngày)
                    </h3>
                    <div className="flex-grow flex items-center justify-center border border-dashed border-gold/20 bg-background-light">
                        <div className="text-center p-8">
                            <span className="material-symbols-outlined text-4xl text-gold/30 mb-2">bar_chart</span>
                            <p className="text-[10px] text-stone uppercase tracking-widest">Biểu đồ đang được xử lý dữ liệu</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportDashboard;
