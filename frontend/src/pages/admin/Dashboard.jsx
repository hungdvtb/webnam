import React from 'react';

const AdminDashboard = () => {
    const stats = [
        { label: 'Tổng doanh thu', value: '128.500.000 ₫', icon: 'payments', color: 'text-primary' },
        { label: 'Đơn hàng mới', value: '42', icon: 'shopping_basket', color: 'text-brick' },
        { label: 'Sản phẩm', value: '156', icon: 'inventory_2', color: 'text-gold' },
        { label: 'Khách hàng', value: '1,204', icon: 'group', color: 'text-stone' },
    ];

    return (
        <div className="absolute inset-0 flex flex-col bg-[#fcfcfa] animate-fade-in p-6 z-10 w-full h-full overflow-hidden">
             {/* Header Area */}
            <div className="flex-none bg-[#fcfcfa] pb-4">
                <div className="flex justify-between items-center mb-4">
                    <div className="flex flex-col">
                        <h1 className="text-2xl font-display font-bold text-primary italic">Bảng điều khiển</h1>
                        <p className="text-[10px] font-black text-stone/40 uppercase tracking-[0.2em] leading-none mt-1">Chào mừng bạn quay lại với hệ thống quản trị</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="bg-white border border-gold/10 px-4 py-2 rounded-sm shadow-sm flex items-center gap-3">
                             <span className="material-symbols-outlined text-[20px] text-gold">calendar_today</span>
                             <span className="font-ui text-[12px] font-black uppercase tracking-widest text-primary italic">Thứ Tư, 04 tháng 03, 2026</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Area - Scrollable */}
            <div className="flex-1 overflow-auto custom-scrollbar space-y-8 pr-2">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {stats.map((stat, index) => (
                        <div key={index} className="bg-white p-6 border border-gold/10 rounded-sm shadow-sm relative group hover:border-gold/30 transition-all">
                            <div className={`absolute top-4 right-4 ${stat.color} opacity-20 group-hover:opacity-100 transition-opacity`}>
                                <span className="material-symbols-outlined text-4xl">{stat.icon}</span>
                            </div>
                            <p className="font-ui text-[10px] font-black text-stone/50 uppercase tracking-[0.15em] mb-4">{stat.label}</p>
                            <h3 className="text-3xl font-display font-bold text-primary">{stat.value}</h3>
                            <div className="mt-6 pt-4 border-t border-gold/5 flex items-center text-[10px] text-green-600 font-bold gap-1">
                                <span className="material-symbols-outlined text-[14px]">trending_up</span>
                                <span>+12% so với tháng trước</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 bg-white border border-gold/10 p-6 shadow-sm rounded-sm">
                        <h2 className="font-display font-bold text-lg text-primary mb-6 flex items-center gap-3 italic">
                            <span className="material-symbols-outlined text-gold">insights</span>
                            Biểu đồ doanh thu
                        </h2>
                        <div className="h-72 border border-gold/5 bg-gold/[0.02] rounded-sm flex items-center justify-center p-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-stone/30 italic">
                                [ Dữ liệu biểu đồ đang được cập nhật ]
                            </div>
                        </div>
                    </div>
                    <div className="bg-white border border-gold/10 p-6 shadow-sm rounded-sm">
                        <h2 className="font-display font-bold text-lg text-primary mb-6 flex items-center gap-3 italic">
                            <span className="material-symbols-outlined text-brick">notifications_active</span>
                            Hoạt động mới
                        </h2>
                        <div className="space-y-4">
                            {[1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="flex gap-4 items-start pb-4 border-b border-gold/5 last:border-0 group cursor-pointer hover:bg-gold/[0.02] -mx-2 px-2 transition-colors">
                                    <div className="w-1.5 h-1.5 rounded-full bg-gold mt-2 shrink-0"></div>
                                    <div>
                                        <p className="text-[13px] font-bold text-primary group-hover:text-umber transition-colors">Đơn hàng #3452 vừa được đặt</p>
                                        <p className="text-[10px] text-stone/50 mt-1 italic font-ui">3 phút trước</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
