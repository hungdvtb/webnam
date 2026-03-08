import React from 'react';
import { Link, Outlet, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AccountSelector = ({ user }) => {
    const [accounts, setAccounts] = React.useState([]);
    const [activeId, setActiveId] = React.useState(localStorage.getItem('activeAccountId') || 'all');

    React.useEffect(() => {
        import('../services/api').then(({ accountApi }) => {
            accountApi.getAll().then(res => setAccounts(res.data)).catch(console.error);
        });
    }, []);

    const handleAccountChange = (e) => {
        const newId = e.target.value;
        localStorage.setItem('activeAccountId', newId);
        setActiveId(newId);
        window.location.reload();
    };

    return (
        <div className="flex items-center gap-2 bg-background-light px-3 py-1.5 border border-gold/30 rounded-sm shadow-sm relative">
            <span className="material-symbols-outlined text-[18px] text-primary">store</span>
            <select
                value={activeId}
                onChange={handleAccountChange}
                className="bg-transparent text-sm font-body font-bold text-primary focus:outline-none pr-4 max-w-[200px] truncate cursor-pointer appearance-none"
            >
                {(user?.is_admin || accounts.length > 1) && (
                    <option value="all">{user?.is_admin ? 'Tất cả cửa hàng (ALL)' : 'Toàn bộ chi nhánh'}</option>
                )}
                {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-stone flex">
                <span className="material-symbols-outlined text-xs">expand_more</span>
            </div>
        </div>
    );
};

const AdminLayout = () => {
    const { user, logout, loading } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-background-light">
                <div className="text-gold italic font-body animate-pulse">Đang kiểm tra quyền truy cập...</div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!user.is_admin) {
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

                <nav className="flex-grow p-4 space-y-2 py-8 overflow-y-auto custom-scrollbar-thin">
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
                    <Link to="/admin/attributes" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">list_alt</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Thuộc tính</span>
                    </Link>
                    <Link to="/admin/accounts" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">storefront</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Cửa hàng (Accounts)</span>
                    </Link>
                    <Link to="/admin/orders" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">shopping_cart_checkout</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Đơn hàng</span>
                    </Link>
                    <Link to="/admin/customers" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">groups</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Khách hàng</span>
                    </Link>

                    <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-stone uppercase tracking-[0.2em] opacity-50">Kho & Vận Chuyển</div>
                    <Link to="/admin/warehouses" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">warehouse</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Danh mục kho</span>
                    </Link>
                    <Link to="/admin/inventory" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">inventory</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Nhập xuất & Kiểm kê</span>
                    </Link>
                    <Link to="/admin/shipments" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">local_shipping</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Lịch trình giao</span>
                    </Link>

                    <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-stone uppercase tracking-[0.2em] opacity-50">Marketing & Nội dung</div>
                    <Link to="/admin/blog" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">book_2</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Bài viết cẩm nang</span>
                    </Link>
                    <Link to="/admin/banners" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">gallery_thumbnail</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Quản lý Banners</span>
                    </Link>
                    <Link to="/admin/menus" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">account_tree</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Quản lý Menu</span>
                    </Link>
                    <Link to="/admin/settings" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">settings_suggest</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Cấu hình Website</span>
                    </Link>

                    <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-stone uppercase tracking-[0.2em] opacity-50">Báo cáo & Phân tích</div>
                    <Link to="/admin/reports" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined text-stone group-hover:text-gold transition-colors">analytics</span>
                        <span className="font-ui text-sm font-medium tracking-wider">Báo cáo tổng hợp</span>
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
                    <h2 className="text-secondary font-display font-bold text-lg uppercase tracking-widest text-primary">Gốm Sứ Đại Thành / Quản lý</h2>
                    <div className="flex items-center gap-6">
                        <AccountSelector user={user} />

                        <Link to="/" className="text-xs font-ui font-bold text-gold hover:text-primary transition-colors flex items-center gap-2">
                            <span className="material-symbols-outlined text-sm">open_in_new</span>
                            Xem cửa hàng
                        </Link>
                    </div>
                </header>

                <div className="flex-grow overflow-auto p-8 relative">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
