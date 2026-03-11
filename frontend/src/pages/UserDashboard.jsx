import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const UserDashboard = () => {
    const { user } = useAuth();

    return (
        <div className="max-w-7xl mx-auto px-6 py-12">
            <div className="bg-white border border-gold/20 p-8 shadow-xl relative overflow-hidden">
                {/* Decorative Pattern */}
                <div className="absolute top-0 right-0 w-32 h-32 text-gold/5 pointer-events-none">
                    <span className="material-symbols-outlined text-9xl">local_florist</span>
                </div>

                <div className="mb-12">
                    <h1 className="font-display text-3xl font-bold text-primary mb-2 uppercase tracking-tight">
                        Chào mừng {user?.name},
                    </h1>
                    <p className="font-body text-stone italic">Đây là không gian dành riêng cho bạn tại Gốm Sứ Đại Thành.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-background-light p-6 border border-gold/10 hover-lift group">
                        <span className="material-symbols-outlined text-primary text-3xl mb-4 group-hover:scale-110 transition-transform block">shopping_bag</span>
                        <h3 className="font-ui font-bold text-primary uppercase tracking-widest mb-2">Đơn Hàng Của Tôi</h3>
                        <p className="font-body text-sm text-stone mb-4">Theo dõi quá trình vận chuyển và xem lại lịch sử mua hàng.</p>
                        <Link to="/orders" className="text-primary text-xs font-bold uppercase border-b border-primary/30 hover:border-primary transition-all pb-1">Xem chi tiết</Link>
                    </div>

                    <div className="bg-background-light p-6 border border-gold/10 hover-lift group">
                        <span className="material-symbols-outlined text-primary text-3xl mb-4 group-hover:scale-110 transition-transform block">favorite</span>
                        <h3 className="font-ui font-bold text-primary uppercase tracking-widest mb-2">Sản Phẩm Yêu Thích</h3>
                        <p className="font-body text-sm text-stone mb-4">Danh sách những tuyệt tác gốm sứ bạn đã lưu lại.</p>
                        <Link to="/shop" className="text-primary text-xs font-bold uppercase border-b border-primary/30 hover:border-primary transition-all pb-1">Khám phá thêm</Link>
                    </div>

                    <div className="bg-background-light p-6 border border-gold/10 hover-lift group">
                        <span className="material-symbols-outlined text-primary text-3xl mb-4 group-hover:scale-110 transition-transform block">manage_accounts</span>
                        <h3 className="font-ui font-bold text-primary uppercase tracking-widest mb-2">Thông Tin Tài Khoản</h3>
                        <p className="font-body text-sm text-stone mb-4">Cập nhật địa chỉ giao hàng và thông tin cá nhân.</p>
                        <Link to="#" className="text-primary text-xs font-bold uppercase border-b border-primary/30 hover:border-primary transition-all pb-1">Chỉnh sửa</Link>
                    </div>
                </div>

                <div className="mt-12 bg-primary/5 p-8 border border-primary/10">
                    <div className="flex flex-col md:flex-row items-center gap-8">
                        <div className="size-24 rounded-full bg-white border border-gold/30 flex items-center justify-center text-primary shrink-0 relative">
                            <span className="material-symbols-outlined text-4xl">loyalty</span>
                            <div className="absolute -bottom-2 -right-2 bg-gold text-white text-[10px] font-bold px-2 py-1 rounded-full px-2">GOLD</div>
                        </div>
                        <div className="text-center md:text-left">
                            <h4 className="font-display text-xl font-bold text-primary mb-2">Thành Viên Kim Hiền</h4>
                            <p className="font-body text-sm text-stone max-w-xl">
                                Bạn đang có 1,250 điểm tích lũy. Hãy tiếp tục mua sắm để đổi lấy những ưu đãi đặc biệt dành riêng cho hội viên tinh hoa.
                            </p>
                        </div>
                        <button className="md:ml-auto bg-primary text-white px-8 py-3 font-ui font-bold text-xs uppercase tracking-widest hover:bg-umber transition-all shadow-premium">
                            Đổi Ưu Đãi
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UserDashboard;
