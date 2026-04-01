import React from 'react';
import { Link, Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { INVENTORY_NAV_ITEMS, buildInventoryPath } from '../config/adminInventoryNavigation';


const SidebarText = ({ isExpanded, className = '', children }) => (
    <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-out ${isExpanded ? 'max-w-[16rem] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-2'} ${className}`}>
        {children}
    </span>
);

const SidebarSectionLabel = ({ isExpanded, children }) => (
    <span className={`block overflow-hidden whitespace-nowrap text-[10px] font-bold text-stone uppercase tracking-[0.2em] transition-all duration-300 ease-out ${isExpanded ? 'max-w-[16rem] opacity-50' : 'max-w-0 opacity-0'}`}>
        {children}
    </span>
);

const AdminLayout = () => {
    const { user, logout, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isSettingsRoute =
        location.pathname.startsWith('/admin/attributes') ||
        location.pathname.startsWith('/admin/carrier-mappings') ||
        location.pathname.startsWith('/admin/order-status-settings') ||
        location.pathname.startsWith('/admin/users') ||
        location.pathname.startsWith('/admin/settings') ||
        location.pathname.startsWith('/admin/shipping-settings');
    const isOrdersRoute =
        location.pathname.startsWith('/admin/orders') ||
        location.pathname.startsWith('/admin/customers') ||
        location.pathname.startsWith('/admin/shipments') ||
        location.pathname.startsWith('/admin/pending-orders') ||
        location.pathname.startsWith('/admin/leads');
    const isDesignRoute =
        location.pathname.startsWith('/admin/categories') ||
        location.pathname.startsWith('/admin/blog');
    const isInventoryRoute = location.pathname.startsWith('/admin/inventory');

    const [isSettingsOpen, setIsSettingsOpen] = React.useState(isSettingsRoute);
    const [isOrdersOpen, setIsOrdersOpen] = React.useState(isOrdersRoute);
    const [isDesignOpen, setIsDesignOpen] = React.useState(isDesignRoute);
    const [isInventoryOpen, setIsInventoryOpen] = React.useState(isInventoryRoute);
    const [canHoverSidebar, setCanHoverSidebar] = React.useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }

        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    });
    const [isSidebarHovered, setIsSidebarHovered] = React.useState(false);
    const [isSidebarFocused, setIsSidebarFocused] = React.useState(false);

    const isOrderForm = location.pathname.startsWith('/admin/orders/new') || location.pathname.startsWith('/admin/orders/edit');
    const isSidebarExpanded = !canHoverSidebar || isSidebarHovered || isSidebarFocused;

    React.useEffect(() => {
        if (isSettingsRoute) setIsSettingsOpen(true);
        if (isOrdersRoute) setIsOrdersOpen(true);
        if (isDesignRoute) setIsDesignOpen(true);
        if (isInventoryRoute) setIsInventoryOpen(true);
    }, [isDesignRoute, isInventoryRoute, isOrdersRoute, isSettingsRoute]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
        const syncHoverCapability = (event) => {
            setCanHoverSidebar(event.matches);
        };

        syncHoverCapability(mediaQuery);

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', syncHoverCapability);
            return () => mediaQuery.removeEventListener('change', syncHoverCapability);
        }

        mediaQuery.addListener(syncHoverCapability);
        return () => mediaQuery.removeListener(syncHoverCapability);
    }, []);


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
        try { perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || []); } catch { perms = []; }
        return perms.includes(permId);
    };

    const canAccessLeadBoard = canAccess('orders') || canAccess('customers') || canAccess('leads');
    const isLeadRoute = location.pathname === '/admin/leads' || location.pathname === '/admin/pending-orders';
    const sidebarCollapsedWidth = '5.75rem';
    const sidebarExpandedWidth = '19rem';
    const shouldShowSidebar = !isOrderForm;
    const sidebarReservedWidth = canHoverSidebar ? sidebarCollapsedWidth : sidebarExpandedWidth;
    const sidebarWidth = isSidebarExpanded ? sidebarExpandedWidth : sidebarCollapsedWidth;

    const getCurrentPermId = () => {
        const path = location.pathname;
        if (path === '/admin') return 'dashboard';
        if (path.startsWith('/admin/accounts')) return 'accounts';
        if (path.startsWith('/admin/products')) return 'products';
        if (path.startsWith('/admin/categories')) return 'categories';
        if (path.startsWith('/admin/orders')) return 'orders';
        if (path.startsWith('/admin/customers')) return 'customers';
        if (path.startsWith('/admin/inventory')) return 'inventory';
        if (path.startsWith('/admin/reports')) return 'reports';
        if (path.startsWith('/admin/finance')) return 'reports';
        if (path.startsWith('/admin/warehouses')) return 'warehouses';
        if (path.startsWith('/admin/attributes')) return 'attributes';
        if (path.startsWith('/admin/carrier-mappings')) return 'settings';
        if (path.startsWith('/admin/shipping-settings')) return 'settings';
        if (path.startsWith('/admin/settings')) return 'settings';
        if (path.startsWith('/admin/shipments')) return 'orders';
        if (path.startsWith('/admin/menus')) return 'menus';
        if (path.startsWith('/admin/users')) return 'users';
        return null;
    };

    const topLevelLabelClass = 'font-sans text-sm font-medium tracking-[0.06em] leading-none text-left';
    const submenuLabelClass = 'font-sans text-[11px] font-medium tracking-[0.01em] leading-5 text-left';
    const collapsedTitle = (label) => (isSidebarExpanded ? undefined : label);
    const navItemLayoutClass = isSidebarExpanded ? 'justify-start gap-4' : 'justify-center gap-0';
    const navButtonLayoutClass = isSidebarExpanded ? 'justify-between' : 'justify-center';
    const navButtonContentClass = isSidebarExpanded ? 'flex min-w-0 flex-1 items-center gap-4 text-left' : 'flex min-w-0 items-center gap-0 text-left';
    const chevronClass = `material-symbols-outlined overflow-hidden text-xs transition-all duration-300 ease-out ${isSidebarExpanded ? 'ml-3 max-w-6 opacity-100' : 'ml-0 max-w-0 opacity-0'}`;
    const brandTextClass = `flex flex-col overflow-hidden text-left transition-all duration-300 ease-out ${isSidebarExpanded ? 'max-w-[9rem] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-2'}`;
    const userInfoClass = `flex flex-col overflow-hidden text-left items-start transition-all duration-300 ease-out ${isSidebarExpanded ? 'max-w-[12rem] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-2'}`;

    return (
        <div
            className={`${shouldShowSidebar ? 'relative grid' : 'relative'} h-screen overflow-hidden bg-background-light font-sans`}
            style={shouldShowSidebar ? { gridTemplateColumns: `${sidebarReservedWidth} minmax(0, 1fr)` } : undefined}
        >
            {shouldShowSidebar && (
                <aside
                    className="absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-primary text-white shadow-2xl transition-[width] duration-300 ease-out"
                    style={{ width: sidebarWidth, willChange: 'width' }}
                    onMouseEnter={() => setIsSidebarHovered(true)}
                    onMouseLeave={() => setIsSidebarHovered(false)}
                    onFocusCapture={() => setIsSidebarFocused(true)}
                    onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                            setIsSidebarFocused(false);
                        }
                    }}
                >
                    <div className={`flex items-center overflow-hidden border-b border-white/10 transition-all duration-300 ease-out ${isSidebarExpanded ? 'justify-start gap-4 p-8' : 'justify-center px-4 py-6'}`}>
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-white">
                            <img src="/logo-brand.jpg" alt="Logo" className="h-full w-full object-contain" />
                        </div>
                        <div className={brandTextClass}>
                            <h1 className="font-sans text-lg font-bold leading-tight tracking-tight text-white uppercase">GỐM <br /> ĐẠI THÀNH</h1>
                        </div>
                    </div>

                    <nav className={`custom-scrollbar-thin flex-grow space-y-2 overflow-y-auto transition-all duration-300 ease-out ${isSidebarExpanded ? 'p-4 py-8' : 'px-3 py-6'}`}>
                        <Link
                            to="/admin/accounts"
                            aria-label="Danh sách cửa hàng"
                            title={collapsedTitle('Danh sách cửa hàng')}
                            className={`group flex items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navItemLayoutClass}`}
                        >
                            <span className="material-symbols-outlined w-6 shrink-0 text-center text-stone transition-colors group-hover:text-gold">storefront</span>
                            <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                Danh sách cửa hàng
                            </SidebarText>
                        </Link>

                        {canAccess('dashboard') && (
                            <Link
                                to="/admin"
                                aria-label="Tổng quan"
                                title={collapsedTitle('Tổng quan')}
                                className={`group flex items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navItemLayoutClass}`}
                            >
                                <span className="material-symbols-outlined w-6 shrink-0 text-center text-stone transition-colors group-hover:text-gold">dashboard</span>
                                <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                    Tổng quan
                                </SidebarText>
                            </Link>
                        )}

                        {(canAccess('attributes') || canAccess('settings') || canAccess('users') || canAccess('orders')) && (
                            <div className="space-y-1">
                                <button
                                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                                    className={`group flex w-full items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navButtonLayoutClass} ${isSettingsOpen ? 'bg-white/5' : ''}`}
                                    aria-expanded={isSettingsOpen}
                                    aria-label="Cấu hình hệ thống"
                                    title={collapsedTitle('Cấu hình hệ thống')}
                                >
                                    <div className={navButtonContentClass}>
                                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${isSettingsOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold`}>settings</span>
                                        <SidebarText isExpanded={isSidebarExpanded} className={`${topLevelLabelClass} tracking-[0.04em]`}>
                                            Cấu hình hệ thống
                                        </SidebarText>
                                    </div>
                                    <span className={`${chevronClass} ${isSettingsOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>expand_more</span>
                                </button>

                                {isSettingsOpen && isSidebarExpanded && (
                                    <div className="animate-in space-y-1 pl-4 slide-in-from-top-2 duration-200">
                                        {canAccess('settings') && (
                                            <Link
                                                to="/admin/settings"
                                                title="Cài đặt web"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/settings' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/settings' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>web</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Cài đặt web
                                                </SidebarText>
                                            </Link>
                                        )}
                                        {canAccess('attributes') && (
                                            <Link
                                                to="/admin/attributes"
                                                title="Thuộc tính sản phẩm/đơn hàng"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/attributes' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/attributes' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>list_alt</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Thuộc tính sản phẩm/đơn hàng
                                                </SidebarText>
                                            </Link>
                                        )}
                                        {canAccess('users') && (
                                            <Link
                                                to="/admin/users"
                                                title="Quản lý nhân sự"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/users' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/users' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>manage_accounts</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Quản lý nhân sự
                                                </SidebarText>
                                            </Link>
                                        )}
                                        {canAccess('orders') && (
                                            <Link
                                                to="/admin/order-status-settings"
                                                title="Trạng thái đơn hàng"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/order-status-settings' ? 'bg-gold/10 text-gold' : 'text-stone/80 hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/order-status-settings' ? 'text-gold' : 'group-hover:text-gold'}`}>label</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Trạng thái đơn hàng
                                                </SidebarText>
                                            </Link>
                                        )}
                                        {canAccess('orders') && (
                                            <Link
                                                to="/admin/shipping-settings"
                                                title="Cài đặt vận chuyển"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/shipping-settings' || location.pathname === '/admin/carrier-mappings' ? 'bg-gold/10 text-gold' : 'text-stone/80 hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/shipping-settings' || location.pathname === '/admin/carrier-mappings' ? 'text-gold' : 'group-hover:text-gold'}`}>local_shipping</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Cài đặt vận chuyển
                                                </SidebarText>
                                            </Link>
                                        )}
                                </div>
                            )}
                        </div>
                    )}


                    {canAccess('products') && (
                        <Link
                            to="/admin/products"
                            aria-label="Quản lý sản phẩm"
                            title={collapsedTitle('Quản lý sản phẩm')}
                            className={`group flex items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navItemLayoutClass}`}
                        >
                            <span className="material-symbols-outlined w-6 shrink-0 text-center text-stone transition-colors group-hover:text-gold">inventory_2</span>
                            <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                Quản lý sản phẩm
                            </SidebarText>
                        </Link>
                    )}

                    {(canAccess('orders') || canAccess('customers') || canAccess('leads')) && (
                        <div className="space-y-1">
                            <button
                                onClick={() => setIsOrdersOpen(!isOrdersOpen)}
                                className={`group flex w-full items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navButtonLayoutClass} ${isOrdersOpen ? 'bg-white/5' : ''}`}
                                aria-expanded={isOrdersOpen}
                                aria-label="Quản lý bán hàng"
                                title={collapsedTitle('Quản lý bán hàng')}
                            >
                                <div className={navButtonContentClass}>
                                    <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${isOrdersOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold`}>shopping_cart_checkout</span>
                                    <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                        Quản lý bán hàng
                                    </SidebarText>
                                </div>
                                <span className={`${chevronClass} ${isOrdersOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>expand_more</span>
                            </button>
                            
                            {isOrdersOpen && isSidebarExpanded && (
                                <div className="animate-in space-y-1 pl-4 slide-in-from-top-2 duration-200">
                                    {canAccessLeadBoard && (
                                        <Link
                                            to="/admin/leads"
                                            title="Xử lý lead"
                                            className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${isLeadRoute ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${isLeadRoute ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>pending_actions</span>
                                            <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                Xử lý lead
                                            </SidebarText>
                                        </Link>
                                    )}
                                    {canAccess('orders') && (
                                        <>
                                            <Link
                                                to="/admin/orders"
                                                title="Đơn hàng"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/orders' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/orders' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>receipt_long</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Đơn hàng
                                                </SidebarText>
                                            </Link>
                                            <Link
                                                to="/admin/shipments"
                                                title="Vận đơn"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/shipments' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/shipments' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>local_shipping</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Vận đơn
                                                </SidebarText>
                                            </Link>
                                        </>
                                    )}
                                    {canAccess('customers') && (
                                        <Link
                                            to="/admin/customers"
                                            title="Khách hàng"
                                            className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/customers' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/customers' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>group</span>
                                            <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                Khách hàng
                                            </SidebarText>
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {(canAccess('categories') || canAccess('blog')) && (
                        <div className="space-y-1">
                            <button
                                onClick={() => setIsDesignOpen(!isDesignOpen)}
                                className={`group flex w-full items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navButtonLayoutClass} ${isDesignOpen ? 'bg-white/5' : ''}`}
                                aria-expanded={isDesignOpen}
                                aria-label="Web"
                                title={collapsedTitle('Web')}
                            >
                                <div className={navButtonContentClass}>
                                    <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${isDesignOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold`}>design_services</span>
                                    <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                        Web
                                    </SidebarText>
                                </div>
                                <span className={`${chevronClass} ${isDesignOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>expand_more</span>
                            </button>

                            {isDesignOpen && isSidebarExpanded && (
                                <div className="animate-in space-y-1 pl-4 slide-in-from-top-2 duration-200">
                                    {canAccess('categories') && (
                                        <Link
                                            to="/admin/categories"
                                            title="Danh mục sản phẩm"
                                            className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/categories' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/categories' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>category</span>
                                            <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                Danh mục sản phẩm
                                            </SidebarText>
                                        </Link>
                                    )}
                                    {canAccess('blog') && (
                                        <Link
                                            to="/admin/blog"
                                            title="Bài viết trên web"
                                            className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/blog' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/blog' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>book_2</span>
                                            <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                Bài viết trên web
                                            </SidebarText>
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className={`px-3 transition-all duration-300 ease-out ${isSidebarExpanded ? 'pb-2 pt-4' : 'py-1'}`}>
                        <SidebarSectionLabel isExpanded={isSidebarExpanded}>Kho & Vận chuyển</SidebarSectionLabel>
                    </div>
                    {canAccess('inventory') && (
                        <div className="space-y-1">
                            <button
                                onClick={() => setIsInventoryOpen(!isInventoryOpen)}
                                className={`group flex w-full items-center rounded-sm p-3 transition-all duration-300 hover:bg-white/10 ${navButtonLayoutClass} ${isInventoryOpen ? 'bg-white/5' : ''}`}
                                aria-expanded={isInventoryOpen}
                                aria-label="Quản lý kho"
                                title={collapsedTitle('Quản lý kho')}
                            >
                                <div className={navButtonContentClass}>
                                    <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${isInventoryOpen ? 'text-gold' : 'text-stone'} group-hover:text-gold`}>inventory</span>
                                    <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                        Quản lý kho
                                    </SidebarText>
                                </div>
                                <span className={`${chevronClass} ${isInventoryOpen ? 'rotate-180 text-gold' : 'text-stone'}`}>expand_more</span>
                            </button>

                            {isInventoryOpen && isSidebarExpanded && (
                                <div className="animate-in space-y-1 pl-4 slide-in-from-top-2 duration-200">
                                    {INVENTORY_NAV_ITEMS.map((item) => {
                                        const targetPath = buildInventoryPath(item.key);
                                        const isActive = location.pathname === targetPath;
                                        return (
                                            <Link
                                                key={item.key}
                                                to={targetPath}
                                                title={item.label}
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${isActive ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${isActive ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>{item.icon}</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    {item.label}
                                                </SidebarText>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}



                    <div className={`px-3 transition-all duration-300 ease-out ${isSidebarExpanded ? 'pb-2 pt-4' : 'py-1'}`}>
                        <SidebarSectionLabel isExpanded={isSidebarExpanded}>Báo cáo & Phân tích</SidebarSectionLabel>
                    </div>
                    <Link
                        to="/admin/reports"
                        aria-label="Hàng đi hàng ngày"
                        title={collapsedTitle('Hàng đi hàng ngày')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname.startsWith('/admin/reports') ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname.startsWith('/admin/reports') ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>table_chart</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Hàng đi hàng ngày
                        </SidebarText>
                    </Link>
                    <Link
                        to="/admin/finance"
                        aria-label="Quản lý tiền"
                        title={collapsedTitle('Quản lý tiền')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>account_balance_wallet</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Quản lý tiền
                        </SidebarText>
                    </Link>
                    <Link
                        to="/admin/finance/fixed-expenses"
                        aria-label="Chi phí cố định"
                        title={collapsedTitle('Chi phí cố định')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname.startsWith('/admin/finance/fixed-expenses') ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname.startsWith('/admin/finance/fixed-expenses') ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>receipt_long</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Chi phí cố định
                        </SidebarText>
                    </Link>
                    <Link
                        to="/admin/finance/daily-profit"
                        aria-label="Lãi lỗ theo ngày"
                        title={collapsedTitle('Lãi lỗ theo ngày')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname.startsWith('/admin/finance/daily-profit') ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname.startsWith('/admin/finance/daily-profit') ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>monitoring</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Lãi lỗ theo ngày
                        </SidebarText>
                    </Link>
                </nav>

                <div className={`mt-auto border-t border-white/10 p-4 transition-all duration-300 ease-out ${isSidebarExpanded ? '' : 'px-3'}`}>
                    <div className={`flex items-center rounded-sm bg-white/5 transition-all duration-300 ease-out ${isSidebarExpanded ? 'justify-start gap-3 p-3' : 'justify-center p-3'}`}>
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/20 text-gold">
                            <span className="material-symbols-outlined text-xl">person</span>
                        </div>
                        <div className={userInfoClass}>
                            <span className="mb-0.5 text-left text-[9px] font-bold uppercase tracking-widest text-stone">
                                {user?.is_admin ? 'Quản trị viên' : 'Nhân viên'}
                            </span>
                            <span className="mb-1.5 truncate text-left text-sm font-sans font-bold leading-none">{user.name}</span>
                            <button onClick={handleLogout} className="flex w-full items-center justify-start gap-1 whitespace-nowrap text-left text-[10px] uppercase tracking-tighter text-gold/60 transition-colors hover:text-gold">
                                <span className="material-symbols-outlined text-xs">logout</span>
                                Đăng xuất
                            </button>
                        </div>
                    </div>
                </div>
            </aside>
            )}

            <main className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background-light ${shouldShowSidebar ? 'col-start-2' : 'h-full w-full'}`}>
                <div className={`relative flex-grow min-h-0 ${isOrderForm ? 'h-full overflow-auto p-0' : isInventoryRoute ? 'overflow-auto p-4 md:p-5' : 'overflow-auto p-8'}`}>
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
