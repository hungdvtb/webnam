import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminLayout = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    if (!user || !user.is_admin) {
        return (
            <div className="flex items-center justify-center h-screen bg-background-light">
                <div className="text-center p-8 bg-white border border-gold shadow-xl">
                    <h1 className="text-2xl font-display font-bold text-brick mb-4">Truy cập bị từ chối</h1>
                    <p className="text-stone mb-6">Bạn không có quyền truy cập vào khu vực này.</p>
                    <Link to="/" className="bg-primary text-white px-6 py-2 uppercase font-ui text-sm font-bold tracking-widest">Quay lại trang chủ</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-background-light font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-primary text-white flex flex-col shadow-2xl z-20">
                <div className="p-6 border-b border-white/10">
                    <Link to="/admin" className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-gold">dashboard_customize</span>
                        <span className="font-display font-bold text-xl tracking-wide">Quản Trị Viên</span>
                    </Link>
                </div>

                <nav className="flex-grow p-4 space-y-2 py-8">
                    <Link to="/admin" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">dashboard</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Tổng quan</span>
                    </Link>
                    <Link to="/admin/products" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">inventory_2</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Sản phẩm</span>
                    </Link>
                    <Link to="/admin/categories" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">category</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Danh mục</span>
                    </Link>
                    <Link to="/admin/orders" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">shopping_cart_checkout</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Đơn hàng</span>
                    </Link>
                </nav>

                <div className="p-4 border-t border-white/10">
                    <div className="flex items-center gap-3 p-3">
                        <div className="size-8 rounded-full bg-gold/20 flex items-center justify-center text-gold">
                            <span className="material-symbols-outlined text-sm">person</span>
                        </div>
                        <div className="flex flex-col overflow-hidden">
                            <span className="text-xs font-bold truncate">{user.name}</span>
                            <button onClick={handleLogout} className="text-[10px] text-stone text-left hover:text-brick transition-colors">Đăng xuất</button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-grow flex flex-col overflow-hidden">
                <header className="h-16 bg-white border-b border-gold/10 flex items-center justify-between px-8 shrink-0">
                    <h2 className="text-secondary font-display font-bold text-lg uppercase tracking-widest text-primary">Di Sản Gốm Việt / Quản lý</h2>
                    <div className="flex items-center gap-4">
                        <Link to="/" className="text-xs font-ui font-bold text-gold hover:text-primary transition-colors flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">open_in_new</span>
                            Xem cửa hàng
                        </Link>
                    </div>
                </header>

                <div className="flex-grow overflow-auto p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
