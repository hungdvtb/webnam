import React from 'react';
import { Link, Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountSelector from '../components/AccountSelector';


const AdminLayout = () => {
    const { user, logout, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [isSettingsOpen, setIsSettingsOpen] = React.useState(location.pathname.startsWith('/admin/attributes') || location.pathname.startsWith('/admin/carrier-mappings') || location.pathname.startsWith('/admin/users') || location.pathname.startsWith('/admin/settings'));
    const [isOrdersOpen, setIsOrdersOpen] = React.useState(location.pathname.startsWith('/admin/orders') || location.pathname.startsWith('/admin/customers') || location.pathname.startsWith('/admin/shipments') || location.pathname.startsWith('/admin/pending-orders') || location.pathname.startsWith('/admin/leads'));
    const [isDesignOpen, setIsDesignOpen] = React.useState(location.pathname.startsWith('/admin/categories') || location.pathname.startsWith('/admin/blog'));

    const isOrderForm = location.pathname.startsWith('/admin/orders/new') || location.pathname.startsWith('/admin/orders/edit');

    React.useEffect(() => {
        if (location.pathname.startsWith('/admin/attributes') || location.pathname.startsWith('/admin/carrier-mappings') || location.pathname.startsWith('/admin/users') || location.pathname.startsWith('/admin/settings')) setIsSettingsOpen(true);
        if (location.pathname.startsWith('/admin/orders') || location.pathname.startsWith('/admin/customers') || location.pathname.startsWith('/admin/shipments') || location.pathname.startsWith('/admin/pending-orders') || location.pathname.startsWith('/admin/leads')) setIsOrdersOpen(true);
        if (location.pathname.startsWith('/admin/categories') || location.pathname.startsWith('/admin/blog')) setIsDesignOpen(true);
    }, [location.pathname]);


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
        return <Navigate to="/old/login" replace />;
    }

    const canAccess = (permId) => {
        if (!user) return false;
        if (user.is_admin) return true;
        let perms = [];
        try { perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || []); } catch(e){}
        return perms.includes(permId);
    };

    const getCurrentPermId = () => {
        const path = location.pathname;
        if (path === '/admin') return 'dashboard';
        if (path.startsWith('/admin/accounts')) return 'accounts';
        if (path.startsWith('/admin/products')) return 'products';
        if (path.startsWith('/admin/categories')) return 'categories';
        if (path.startsWith('/admin/orders')) return 'orders';
        if (path.startsWith('/admin/customers')) return 'customers';
        if (path.startsWith('/admin/inventory')) return 'inventory';
        if (path.startsWith('/admin/warehouses')) return 'warehouses';
        if (path.startsWith('/admin/attributes')) return 'attributes';
        if (path.startsWith('/admin/carrier-mappings')) return 'settings';
        if (path.startsWith('/admin/settings')) return 'settings';
        if (path.startsWith('/admin/shipments')) return 'orders';
        if (path.startsWith('/admin/menus')) return 'menus';
        if (path.startsWith('/admin/users')) return 'users';
        return null;
    };

    return (
        <div className="flex h-screen bg-background-light font-sans overflow-hidden">
            {/* Sidebar */}
            {!isOrderForm && (
                <aside className="w-64 bg-primary text-white flex flex-col shadow-2xl z-20 shrink-0">
                <div className="p-8 border-b border-white/10 flex items-center gap-4 justify-start overflow-hidden">
                    <div className="size-11 bg-white rounded-sm flex items-center justify-center shrink-0">
                        <img src="/logo-brand.jpg" alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <div className="flex flex-col text-left">
                        <h1 className="font-sans text-lg font-bold tracking-tight text-white leading-tight uppercase">GÔM <br/> ĐẠI THÀNH</h1>
                    </div>
                </div>

                <nav className="flex-grow p-4 space-y-2 py-8 overflow-y-auto custom-scrollbar-thin">
                        <Link to="/admin/accounts" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                            <span className="material-symbols-outlined w-6 text-center text-stone group-hover:text-gold transition-colors">storefront</span>
                            <span className="font-sans text-sm font-medium tracking-wider">Danh sách cửa hàng</span>
                        </Link>

                    {canAccess('dashboard') && (
                        <Link to="/admin" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                            <span className="material-symbols-outlined w-6 text-center text-stone group-hover:text-gold transition-colors">dashboard</span>
                            <span className="font-sans text-sm font-medium tracking-wider">Tổng quan</span>
                        </Link>
                    )}

                    {/* Collapsible Settings Menu */}
                    {(canAccess('attributes') || canAccess('settings') || canAccess('users')) && (
                        <div className="space-y-1">
                            <button 
                                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                                className={`w-full flex items-center justify-between p-3 hover:bg-white/10 rounded-sm transition-colors group ${isSettingsOpen ? 'bg-white/5' : ''}`}
                            >
                                <div className="flex items-center gap-4 text-left">
                                    <span className={`material-symbols-outlined w-6 text-center ${isSettingsOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold transition-colors`}>settings</span>
                                    <span className="font-sans text-sm font-medium tracking-wider text-left">Cấu hình hệ thống</span>
                                </div>
                                <span className={`material-symbols-outlined text-xs transition-transform duration-300 ${isSettingsOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>
                                    expand_more
                                </span>
                            </button>
                            
                            {isSettingsOpen && (
                                <div className="pl-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                                    {canAccess('settings') && (
                                        <Link 
                                            to="/admin/settings" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/settings' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/settings' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>web</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Cài đặt web</span>
                                        </Link>
                                    )}
                                    {canAccess('attributes') && (
                                        <Link 
                                            to="/admin/attributes" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/attributes' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/attributes' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>list_alt</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Thuộc tính sản phẩm</span>
                                        </Link>
                                    )}
                                    {canAccess('users') && (
                                        <Link 
                                            to="/admin/users" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/users' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/users' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>manage_accounts</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Quản lý nhân sự</span>
                                        </Link>
                                    )}
                                    {canAccess('orders') && (
                                        <Link 
                                            to="/admin/order-status-settings" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/order-status-settings' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone/80 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/order-status-settings' ? 'text-gold' : 'group-hover:text-gold'}`}>label</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Trạng thái đơn hàng</span>
                                        </Link>
                                    )}
                                    {canAccess('orders') && (
                                        <Link 
                                            to="/admin/settings?tab=shipping&shippingTab=integrations" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/carrier-mappings' || (location.pathname === '/admin/settings' && location.search.includes('tab=shipping')) ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone/80 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/carrier-mappings' || (location.pathname === '/admin/settings' && location.search.includes('tab=shipping')) ? 'text-gold' : 'group-hover:text-gold'}`}>local_shipping</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Mapping vận chuyển</span>
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    )}


                    {canAccess('products') && (
                        <Link to="/admin/products" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                            <span className="material-symbols-outlined w-6 text-center text-stone group-hover:text-gold transition-colors">inventory_2</span>
                            <span className="font-sans text-sm font-medium tracking-wider">Quản lý sản phẩm</span>
                        </Link>
                    )}

                    {/* Collapsible Orders Menu */}
                    {(canAccess('orders') || canAccess('customers') || canAccess('leads')) && (
                        <div className="space-y-1">
                            <button 
                                onClick={() => setIsOrdersOpen(!isOrdersOpen)}
                                className={`w-full flex items-center justify-between p-3 hover:bg-white/10 rounded-sm transition-colors group ${isOrdersOpen ? 'bg-white/5' : ''}`}
                            >
                                <div className="flex items-center gap-4 text-left">
                                    <span className={`material-symbols-outlined w-6 text-center ${isOrdersOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold transition-colors`}>shopping_cart_checkout</span>
                                    <span className="font-sans text-sm font-medium tracking-wider text-left">Quản lý bán hàng</span>
                                </div>
                                <span className={`material-symbols-outlined text-xs transition-transform duration-300 ${isOrdersOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>
                                    expand_more
                                </span>
                            </button>
                            
                            {isOrdersOpen && (
                                <div className="pl-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                                    {canAccess('orders') && (
                                        <>
                                            <Link 
                                                to="/admin/leads" 
                                                className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/leads' || location.pathname === '/admin/pending-orders' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/leads' || location.pathname === '/admin/pending-orders' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>pending_actions</span>
                                                <span className="font-sans text-xs font-medium tracking-wide">Xử lý lead</span>
                                            </Link>
                                            <Link 
                                                to="/admin/orders" 
                                                className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/orders' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/orders' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>receipt_long</span>
                                                <span className="font-sans text-xs font-medium tracking-wide">Đơn hàng</span>
                                            </Link>
                                            <Link 
                                                to="/admin/shipments" 
                                                className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/shipments' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/shipments' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>local_shipping</span>
                                                <span className="font-sans text-xs font-medium tracking-wide">Vận đơn</span>
                                            </Link>
                                        </>
                                    )}
                                    {canAccess('customers') && (
                                        <>
                                            <Link 
                                                to="/admin/customers" 
                                                className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/customers' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/customers' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>group</span>
                                                <span className="font-sans text-xs font-medium tracking-wide">Khách hàng</span>
                                            </Link>
                                            <Link 
                                                to="/admin/leads" 
                                                className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/leads' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/leads' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>support_agent</span>
                                                <span className="font-sans text-xs font-medium tracking-wide">Khách liên hệ</span>
                                            </Link>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Collapsible Design & Content Menu */}
                    {(canAccess('categories') || canAccess('blog')) && (
                        <div className="space-y-1">
                            <button 
                                onClick={() => setIsDesignOpen(!isDesignOpen)}
                                className={`w-full flex items-center justify-between p-3 hover:bg-white/10 rounded-sm transition-colors group ${isDesignOpen ? 'bg-white/5' : ''}`}
                            >
                                <div className="flex items-center gap-4 text-left">
                                    <span className={`material-symbols-outlined w-6 text-center ${isDesignOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold transition-colors`}>design_services</span>
                                    <span className="font-sans text-sm font-medium tracking-wider text-left">Web</span>
                                </div>
                                <span className={`material-symbols-outlined text-xs transition-transform duration-300 ${isDesignOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>
                                    expand_more
                                </span>
                            </button>
                            
                            {isDesignOpen && (
                                <div className="pl-4 space-y-1 animate-in slide-in-from-top-2 duration-200">
                                    {canAccess('categories') && (
                                        <Link 
                                            to="/admin/categories" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/categories' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/categories' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>category</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Danh mục sản phẩm</span>
                                        </Link>
                                    )}
                                    {canAccess('blog') && (
                                        <Link 
                                            to="/admin/blog" 
                                            className={`flex items-center gap-4 p-3 rounded-sm transition-colors group ${location.pathname === '/admin/blog' ? 'bg-gold/10 text-gold' : 'hover:bg-white/5 text-stone hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined text-[20px] w-6 text-center ${location.pathname === '/admin/blog' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>book_2</span>
                                            <span className="font-sans text-xs font-medium tracking-wide">Bài viết trên web</span>
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-stone uppercase tracking-[0.2em] opacity-50">Kho & Vận Chuyển</div>
                        <Link to="/admin/warehouses" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                            <span className="material-symbols-outlined w-6 text-center text-stone group-hover:text-gold transition-colors">warehouse</span>
                            <span className="font-sans text-sm font-medium tracking-wider">Danh mục kho</span>
                        </Link>
                    {canAccess('inventory') && (
                        <Link to="/admin/inventory" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                            <span className="material-symbols-outlined w-6 text-center text-stone group-hover:text-gold transition-colors">inventory</span>
                            <span className="font-sans text-sm font-medium tracking-wider">Nhập xuất & Kiểm kê</span>
                        </Link>
                    )}



                    <div className="pt-4 pb-2 px-3 text-[10px] font-bold text-stone uppercase tracking-[0.2em] opacity-50">Báo cáo & Phân tích</div>
                    <Link to="/admin/reports" className="flex items-center gap-4 p-3 hover:bg-white/10 rounded-sm transition-colors group">
                        <span className="material-symbols-outlined w-6 text-center text-stone group-hover:text-gold transition-colors">analytics</span>
                        <span className="font-sans text-sm font-medium tracking-wider">Báo cáo tổng hợp</span>
                    </Link>
                </nav>

                <div className="p-4 border-t border-white/10 mt-auto">
                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-sm">
                        <div className="size-10 rounded-full bg-gold/20 flex items-center justify-center text-gold shrink-0 border border-gold/30">
                            <span className="material-symbols-outlined text-xl">person</span>
                        </div>
                        <div className="flex flex-col overflow-hidden text-left items-start">
                            <span className="text-[9px] font-bold text-stone uppercase tracking-widest mb-0.5 text-left">
                                {user?.is_admin ? 'Quản trị viên' : 'Nhân viên'}
                            </span>
                            <span className="text-sm font-sans font-bold truncate leading-none mb-1.5 text-left">{user.name}</span>
                            <button onClick={handleLogout} className="text-[10px] text-gold/60 text-left hover:text-gold transition-colors flex items-center gap-1 uppercase tracking-tighter w-full justify-start">
                                <span className="material-symbols-outlined text-xs">logout</span>
                                Đăng xuất
                            </button>
                        </div>
                    </div>
                </div>
            </aside>
            )}

            {/* Main Content */}
            <main className={`flex-grow flex flex-col overflow-hidden bg-background-light relative ${isOrderForm ? 'w-full' : ''}`}>
                <div className={`flex-grow overflow-auto relative ${isOrderForm ? 'p-0' : 'p-8'}`}>
                    {(() => {
                        const permNeeded = getCurrentPermId();
                        if (permNeeded && !canAccess(permNeeded)) {
                            return (
                                <div className="flex items-center justify-center h-full">
                                    <div className="text-center p-8 bg-white border border-brick/40 shadow-xl max-w-sm rounded-lg">
                                        <span className="material-symbols-outlined text-brick text-5xl mb-4">gpp_maybe</span>
                                        <h1 className="text-xl font-sans font-bold text-brick mb-2 uppercase tracking-wide">Truy cập bị từ chối</h1>
                                        <p className="text-stone text-sm mb-6 font-sans">Tài khoản của bạn chưa được cấp quyền xem phân hệ này.</p>
                                    </div>
                                </div>
                            );
                        }
                        return <Outlet />;
                    })()}
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
