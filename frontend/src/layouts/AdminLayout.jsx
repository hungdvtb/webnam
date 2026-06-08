import React from 'react';
import { Link, Outlet, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { INVENTORY_NAV_ITEMS, buildInventoryPath } from '../config/adminInventoryNavigation';
import useUserSettingsBootstrap from '../hooks/useUserSettingsBootstrap';
import { normalizeAdminPermissions } from '../utils/adminPermissions';
import LeadRealtimeNotifier from '../components/admin/LeadRealtimeNotifier';
import { describeApiConnectionError, isRetryableRequestError, reviewApi } from '../services/api';

const REVIEW_UNREAD_POLL_DELAY_MS = 60000;
const REVIEW_UNREAD_ERROR_DELAY_MS = 10000;
const REVIEW_UNREAD_MAX_ERROR_DELAY_MS = 120000;


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
    const { ready: settingsReady } = useUserSettingsBootstrap(user);
    const navigate = useNavigate();
    const location = useLocation();
    const isSettingsRoute =
        location.pathname.startsWith('/admin/attributes') ||
        location.pathname.startsWith('/admin/ai-training') ||
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
        location.pathname.startsWith('/admin/reviews') ||
        location.pathname.startsWith('/admin/product-faqs') ||
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
    const [isCompactSidebarMode, setIsCompactSidebarMode] = React.useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }

        return window.matchMedia('(max-width: 1023px)').matches;
    });
    const [isSidebarHovered, setIsSidebarHovered] = React.useState(false);
    const [isSidebarFocused, setIsSidebarFocused] = React.useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = React.useState(false);
    const [reviewUnreadCount, setReviewUnreadCount] = React.useState(0);

    const isOrderForm = location.pathname.startsWith('/admin/orders/new') || location.pathname.startsWith('/admin/orders/edit');
    const shouldShowSidebar = !isOrderForm;
    const isSidebarDrawerMode = shouldShowSidebar && isCompactSidebarMode;
    const isSidebarExpanded = isSidebarDrawerMode || !canHoverSidebar || isSidebarHovered || isSidebarFocused;

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

    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const syncCompactMode = (event) => {
            setIsCompactSidebarMode(event.matches);
        };

        syncCompactMode(mediaQuery);

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', syncCompactMode);
            return () => mediaQuery.removeEventListener('change', syncCompactMode);
        }

        mediaQuery.addListener(syncCompactMode);
        return () => mediaQuery.removeListener(syncCompactMode);
    }, []);

    React.useEffect(() => {
        if (!isSidebarDrawerMode && isMobileSidebarOpen) {
            setIsMobileSidebarOpen(false);
        }
    }, [isMobileSidebarOpen, isSidebarDrawerMode]);

    React.useEffect(() => {
        if (isMobileSidebarOpen) {
            setIsMobileSidebarOpen(false);
        }
    }, [location.pathname]);

    React.useEffect(() => {
        if (!isSidebarDrawerMode || !isMobileSidebarOpen || typeof document === 'undefined') {
            return undefined;
        }

        const { overflow } = document.body.style;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = overflow;
        };
    }, [isMobileSidebarOpen, isSidebarDrawerMode]);

    React.useEffect(() => {
        if (!isSidebarDrawerMode || !isMobileSidebarOpen || typeof window === 'undefined') {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsMobileSidebarOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isMobileSidebarOpen, isSidebarDrawerMode]);

    React.useEffect(() => {
        if (!user || loading || !settingsReady) {
            return undefined;
        }

        const normalized = normalizeAdminPermissions(user);
        const canSeeReviews = user.is_admin || normalized.includes('products');
        if (!canSeeReviews) {
            setReviewUnreadCount(0);
            return undefined;
        }

        let isMounted = true;
        let timeoutId = null;
        let retryCount = 0;

        const scheduleUnreadSync = (delayMs = REVIEW_UNREAD_POLL_DELAY_MS) => {
            if (!isMounted) return;
            if (timeoutId) window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(syncUnread, delayMs);
        };

        const syncUnread = () => {
            reviewApi.unreadSummary({ maxRetries: 0 })
                .then((response) => {
                    if (!isMounted) return;
                    retryCount = 0;
                    setReviewUnreadCount(Number(response?.data?.total || 0));
                })
                .catch((error) => {
                    retryCount += 1;
                    if (!isRetryableRequestError(error) || retryCount === 1 || retryCount % 5 === 0) {
                        console.warn('Review unread polling paused:', describeApiConnectionError(error));
                    }
                    if (isMounted) setReviewUnreadCount(0);
                })
                .finally(() => {
                    const delayMs = retryCount > 0
                        ? Math.min(REVIEW_UNREAD_ERROR_DELAY_MS * (2 ** Math.max(retryCount - 1, 0)), REVIEW_UNREAD_MAX_ERROR_DELAY_MS)
                        : REVIEW_UNREAD_POLL_DELAY_MS;
                    scheduleUnreadSync(delayMs);
                });
        };

        const handleUnreadUpdate = (event) => {
            if (typeof event.detail?.total === 'number') {
                setReviewUnreadCount(Math.max(0, event.detail.total));
                return;
            }

            syncUnread();
        };

        syncUnread();
        window.addEventListener('admin:review-unread-updated', handleUnreadUpdate);

        return () => {
            isMounted = false;
            if (timeoutId) window.clearTimeout(timeoutId);
            window.removeEventListener('admin:review-unread-updated', handleUnreadUpdate);
        };
    }, [user, loading, settingsReady]);

    const closeMobileSidebar = () => {
        setIsMobileSidebarOpen(false);
    };

    const toggleMobileSidebar = () => {
        setIsMobileSidebarOpen((previous) => !previous);
    };

    const handleSidebarNavClickCapture = (event) => {
        if (!isSidebarDrawerMode || !(event.target instanceof Element)) {
            return;
        }

        if (event.target.closest('a[href]')) {
            setIsMobileSidebarOpen(false);
        }
    };

    const handleLogout = async () => {
        closeMobileSidebar();
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

    if (!settingsReady) {
        return (
            <div className="flex items-center justify-center h-screen bg-background-light">
                <div className="text-center space-y-3">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto"></div>
                    <div className="text-primary/60 text-sm font-sans font-semibold">Đang tải cài đặt người dùng...</div>
                </div>
            </div>
        );
    }

    const normalizedPermissions = normalizeAdminPermissions(user);
    const canAccess = (permId) => {
        if (!user) return false;
        if (user.is_admin) return true;
        return normalizedPermissions.includes(permId);
    };

    const canAccessLeadBoard = canAccess('orders') || canAccess('customers') || canAccess('leads');
    const isLeadRoute = location.pathname === '/admin/leads' || location.pathname === '/admin/pending-orders';
    const sidebarCollapsedWidth = '5.75rem';
    const sidebarExpandedWidth = '19rem';
    const mobileSidebarWidth = 'min(19rem, calc(100vw - 1rem))';
    const shouldReserveSidebarSpace = shouldShowSidebar && !isSidebarDrawerMode;
    const sidebarReservedWidth = canHoverSidebar ? sidebarCollapsedWidth : sidebarExpandedWidth;
    const sidebarWidth = isSidebarExpanded ? sidebarExpandedWidth : sidebarCollapsedWidth;

    const getCurrentPermId = () => {
        const path = location.pathname;
        if (path === '/admin') return 'dashboard';
        if (path.startsWith('/admin/accounts')) return 'accounts';
        if (path.startsWith('/admin/products')) return 'products';
        if (path.startsWith('/admin/reviews')) return 'products';
        if (path.startsWith('/admin/product-faqs')) return 'products';
        if (path.startsWith('/admin/categories')) return 'categories';
        if (path.startsWith('/admin/orders')) return 'orders';
        if (path.startsWith('/admin/customers')) return 'customers';
        if (path.startsWith('/admin/inventory')) return 'inventory';
        if (path.startsWith('/admin/reports')) return 'reports';
        if (path.startsWith('/admin/finance/daily-profit')) return 'reports';
        if (path.startsWith('/admin/finance/monthly-profit')) return 'reports';
        if (path.startsWith('/admin/finance/revenue-reconciliation')) return 'reports';
        if (path.startsWith('/admin/payroll')) return 'payroll';
        if (path.startsWith('/admin/warehouses')) return 'warehouses';
        if (path.startsWith('/admin/attributes')) return 'attributes';
        if (path.startsWith('/admin/ai-training')) return 'orders';
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
    const sidebarHeaderClass = isSidebarDrawerMode
        ? 'justify-between gap-3 px-5 py-4 pr-4'
        : isSidebarExpanded
            ? 'justify-start gap-4 p-8'
            : 'justify-center px-4 py-6';
    const sidebarBrandWrapClass = isSidebarDrawerMode ? 'flex min-w-0 items-center gap-4' : 'flex min-w-0 items-center gap-4';
    const sidebarNavPaddingClass = isSidebarDrawerMode ? 'px-4 py-6' : isSidebarExpanded ? 'p-4 py-8' : 'px-3 py-6';

    return (
        <div
            className={`${shouldReserveSidebarSpace ? 'relative grid' : 'relative'} h-screen overflow-hidden bg-background-light font-sans`}
            style={shouldReserveSidebarSpace ? { gridTemplateColumns: `${sidebarReservedWidth} minmax(0, 1fr)` } : undefined}
        >
            {isSidebarDrawerMode && (
                <button
                    type="button"
                    aria-label="Đóng menu quản trị"
                    aria-hidden={!isMobileSidebarOpen}
                    tabIndex={isMobileSidebarOpen ? 0 : -1}
                    onClick={closeMobileSidebar}
                    className={`fixed inset-0 z-[60] bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-300 ease-out ${isMobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                />
            )}
            {shouldShowSidebar && (
                <aside
                    id={isSidebarDrawerMode ? 'admin-mobile-sidebar' : undefined}
                    role={isSidebarDrawerMode ? 'dialog' : undefined}
                    aria-modal={isSidebarDrawerMode ? true : undefined}
                    aria-label={isSidebarDrawerMode ? 'Menu quản trị' : undefined}
                    className={`${isSidebarDrawerMode
                        ? `fixed inset-y-0 left-0 z-[70] flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden bg-primary text-white shadow-[0_30px_80px_rgba(15,23,42,0.28)] transition-transform duration-300 ease-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-[110%] pointer-events-none'}`
                        : 'absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-primary text-white shadow-2xl transition-[width] duration-300 ease-out'
                    }`}
                    style={isSidebarDrawerMode ? { width: mobileSidebarWidth, willChange: 'transform' } : { width: sidebarWidth, willChange: 'width' }}
                    onMouseEnter={() => {
                        if (!isSidebarDrawerMode) {
                            setIsSidebarHovered(true);
                        }
                    }}
                    onMouseLeave={() => {
                        if (!isSidebarDrawerMode) {
                            setIsSidebarHovered(false);
                        }
                    }}
                    onFocusCapture={() => setIsSidebarFocused(true)}
                    onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) {
                            setIsSidebarFocused(false);
                        }
                    }}
                >
                    <div className={`flex items-center overflow-hidden border-b border-white/10 transition-all duration-300 ease-out ${sidebarHeaderClass}`}>
                        <div className={sidebarBrandWrapClass}>
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-white">
                                <img src="/logo-brand.jpg" alt="Logo" className="h-full w-full object-contain" />
                            </div>
                            <div className={brandTextClass}>
                                <h1 className="font-sans text-lg font-bold leading-tight tracking-tight text-white uppercase">GỐM <br /> ĐẠI THÀNH</h1>
                            </div>
                        </div>
                        {isSidebarDrawerMode && (
                            <button
                                type="button"
                                aria-label="Đóng menu"
                                onClick={closeMobileSidebar}
                                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/10 text-white transition-colors hover:bg-white/16"
                            >
                                <span className="material-symbols-outlined text-[20px] leading-none">close</span>
                            </button>
                        )}
                    </div>

                    <nav
                        className={`custom-scrollbar-thin flex-grow space-y-2 overflow-y-auto transition-all duration-300 ease-out ${sidebarNavPaddingClass}`}
                        onClickCapture={handleSidebarNavClickCapture}
                    >
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
                                                to="/admin/ai-training"
                                                title="Dữ liệu train AI"
                                                className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/ai-training' ? 'bg-gold/10 text-gold' : 'text-stone/80 hover:bg-white/5 hover:text-white'}`}
                                            >
                                                <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/ai-training' ? 'text-gold' : 'group-hover:text-gold'}`}>school</span>
                                                <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                    Dữ liệu train AI
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

                    {(canAccess('categories') || canAccess('products') || canAccess('blog')) && (
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
                                    {canAccess('products') && (
                                        <Link
                                            to="/admin/reviews"
                                            title="Đánh giá & bình luận"
                                            className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/reviews' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/reviews' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>reviews</span>
                                            <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                Đánh giá & bình luận
                                            </SidebarText>
                                            {reviewUnreadCount > 0 ? (
                                                <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brick px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
                                                    {reviewUnreadCount > 99 ? '99+' : reviewUnreadCount}
                                                </span>
                                            ) : null}
                                        </Link>
                                    )}
                                    {canAccess('products') && (
                                        <Link
                                            to="/admin/product-faqs"
                                            title="Hỏi đáp khách hàng"
                                            className={`group flex items-center gap-4 rounded-sm p-3 transition-colors ${location.pathname === '/admin/product-faqs' ? 'bg-gold/10 text-gold' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                                        >
                                            <span className={`material-symbols-outlined w-6 shrink-0 text-center text-[20px] ${location.pathname === '/admin/product-faqs' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>contact_support</span>
                                            <SidebarText isExpanded={isSidebarExpanded} className={submenuLabelClass}>
                                                Hỏi đáp khách hàng
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
                        to="/admin/finance/daily-profit"
                        aria-label="Báo cáo lãi lỗ ngày"
                        title={collapsedTitle('Báo cáo lãi lỗ ngày')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance/daily-profit' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance/daily-profit' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>query_stats</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Báo cáo lãi lỗ ngày
                        </SidebarText>
                    </Link>

                    <Link
                        to="/admin/finance/monthly-profit"
                        aria-label="Báo cáo lãi lỗ tháng"
                        title={collapsedTitle('Báo cáo lãi lỗ tháng')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance/monthly-profit' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance/monthly-profit' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>calendar_month</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Báo cáo lãi lỗ tháng
                        </SidebarText>
                    </Link>

                    <Link
                        to="/admin/finance/revenue-reconciliation"
                        aria-label="Đối soát doanh thu"
                        title={collapsedTitle('Đối soát doanh thu')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance/revenue-reconciliation' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance/revenue-reconciliation' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>difference</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Đối soát doanh thu
                        </SidebarText>
                    </Link>

                    {canAccess('payroll') && (
                        <Link
                            to="/admin/payroll"
                            aria-label="Công và lương"
                            title={collapsedTitle('Công và lương')}
                            className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname.startsWith('/admin/payroll') ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                        >
                            <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname.startsWith('/admin/payroll') ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>event_available</span>
                            <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                                Công và lương
                            </SidebarText>
                        </Link>
                    )}

                    <Link
                        to="/admin/reports/web-analytics"
                        aria-label="Phân tích web"
                        title={collapsedTitle('Phân tích web')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/reports/web-analytics' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/reports/web-analytics' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>monitoring</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Phân tích web
                        </SidebarText>
                    </Link>

                    <Link
                        to="/admin/reports"
                        aria-label="Hàng đi hàng ngày"
                        title={collapsedTitle('Hàng đi hàng ngày')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/reports' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/reports' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>table_chart</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Hàng đi hàng ngày
                        </SidebarText>
                    </Link>

                    <Link
                        to="/admin/finance/fixed-costs"
                        aria-label="Chi phí cố định"
                        title={collapsedTitle('Chi phí cố định')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance/fixed-costs' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance/fixed-costs' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>account_balance_wallet</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Chi phí cố định
                        </SidebarText>
                    </Link>

                    <Link
                        to="/admin/finance/funds"
                        aria-label="Sổ cái (Dòng tiền)"
                        title={collapsedTitle('Sổ cái (Dòng tiền)')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance/funds' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance/funds' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>savings</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Sổ cái (Dòng tiền)
                        </SidebarText>
                    </Link>

                    <Link
                        to="/admin/finance/debts"
                        aria-label="Sổ nợ"
                        title={collapsedTitle('Sổ nợ')}
                        className={`group flex items-center rounded-sm p-3 transition-all duration-300 ${location.pathname === '/admin/finance/debts' ? 'bg-gold/10 text-gold' : 'text-white hover:bg-white/10'} ${navItemLayoutClass}`}
                    >
                        <span className={`material-symbols-outlined w-6 shrink-0 text-center transition-colors ${location.pathname === '/admin/finance/debts' ? 'text-gold' : 'text-stone group-hover:text-gold'}`}>assignment_ind</span>
                        <SidebarText isExpanded={isSidebarExpanded} className={topLevelLabelClass}>
                            Sổ nợ
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

            <main className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background-light ${shouldReserveSidebarSpace ? 'col-start-2' : 'h-full w-full'}`}>
                <LeadRealtimeNotifier enabled={canAccessLeadBoard} />
                {isSidebarDrawerMode && (
                    <div className="relative z-[80] shrink-0 border-b border-primary/10 bg-background-light/95 px-3 py-3 backdrop-blur">
                        <button
                            type="button"
                            onClick={toggleMobileSidebar}
                            aria-expanded={isMobileSidebarOpen}
                            aria-controls="admin-mobile-sidebar"
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/10 bg-white px-4 py-2.5 text-primary shadow-[0_10px_28px_rgba(27,54,93,0.08)] transition-all duration-200 hover:border-primary/20 hover:bg-primary hover:text-white"
                        >
                            <span className="material-symbols-outlined text-[20px] leading-none">{isMobileSidebarOpen ? 'close' : 'menu'}</span>
                            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Menu</span>
                        </button>
                    </div>
                )}
                <div className={`relative flex-grow min-h-0 ${isOrderForm ? 'h-full overflow-auto p-0' : location.pathname === '/admin/leads' ? 'overflow-auto p-0' : isInventoryRoute ? 'overflow-auto p-4 md:p-5' : 'overflow-auto p-8'}`}>
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
