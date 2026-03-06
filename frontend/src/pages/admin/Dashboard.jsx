import React from 'react';

const AdminDashboard = () => {
    const stats = [
        { label: 'Tổng doanh thu', value: '128.500.000 ₫', icon: 'payments', color: 'text-primary' },
        { label: 'Đơn hàng mới', value: '42', icon: 'shopping_basket', color: 'text-brick' },
        { label: 'Sản phẩm', value: '156', icon: 'inventory_2', color: 'text-gold' },
        { label: 'Khách hàng', value: '1,204', icon: 'group', color: 'text-stone' },
    ];

    return (
        <div className="space-y-12">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-display font-bold text-primary mb-2">Xin chào, Nghệ nhân!</h1>
                    <p className="text-stone italic">Chào mừng bạn quay lại với bảng quản trị Tinh Hoa Đất Việt.</p>
                </div>
                <div className="bg-white border border-gold/20 p-4 shadow-sm font-ui text-sm flex items-center gap-2">
                    <span className="material-symbols-outlined text-gold">calendar_today</span>
                    <span className="font-bold text-primary italic">Thứ Tư, 04 tháng 03, 2026</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {stats.map((stat, index) => (
                    <div key={index} className="bg-white p-8 border border-gold/10 hover-lift shadow-xl relative group">
                        <div className={`absolute top-4 right-4 ${stat.color} opacity-20 group-hover:opacity-100 transition-opacity`}>
                            <span className="material-symbols-outlined text-4xl">{stat.icon}</span>
                        </div>
                        <p className="font-ui text-xs font-bold text-stone uppercase tracking-widest mb-4">{stat.label}</p>
                        <h3 className="text-3xl font-display font-bold text-primary">{stat.value}</h3>
                        <div className="mt-6 pt-4 border-t border-gold/5 flex items-center text-[10px] text-green-600 font-bold gap-1">
                            <span className="material-symbols-outlined text-xs">trending_up</span>
                            <span>+12% so với tháng trước</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white border border-gold/10 p-8 shadow-xl">
                    <h2 className="font-display font-bold text-xl text-primary mb-8 flex items-center gap-3">
                        <span className="material-symbols-outlined text-gold">insights</span>
                        Biểu đồ doanh thu
                    </h2>
                    <div className="h-64 flex items-end gap-2 px-4 italic text-stone/20 text-xs">
                        {/* Placeholder for chart */}
                        <div className="w-full h-full border-2 border-dashed border-gold/10 flex items-center justify-center">
                            [ Dữ liệu biểu đồ đang được cập nhật ]
                        </div>
                    </div>
                </div>
                <div className="bg-white border border-gold/10 p-8 shadow-xl">
                    <h2 className="font-display font-bold text-xl text-primary mb-8 flex items-center gap-3">
                        <span className="material-symbols-outlined text-brick">notifications_active</span>
                        Hoạt động mới
                    </h2>
                    <div className="space-y-6">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="flex gap-4 items-start pb-4 border-b border-gold/5 last:border-0">
                                <div className="size-2 rounded-full bg-gold mt-2"></div>
                                <div>
                                    <p className="text-sm font-ui font-medium text-umber">Đơn hàng #3452 vừa được đặt</p>
                                    <p className="text-[10px] text-stone mt-1 italic">3 phút trước</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
