import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useEffect, useMemo, useState } from 'react';
import { cmsApi, menuApi } from '../services/api';
import { buildHeaderConfig } from '../utils/headerSettings';

const mapMenuApiItems = (menu) => {
    if (!menu?.root_items?.length) return [];
    return menu.root_items.map((item, index) => ({
        id: item.id || `menu-api-${index}`,
        label: item.title || 'Menu',
        link: item.url || '#',
    }));
};

const fallbackMenus = [
    { id: 'menu-home', label: 'Trang chủ', link: '/' },
    { id: 'menu-shop', label: 'Sản phẩm', link: '/shop' },
    { id: 'menu-blog', label: 'Kiến thức gốm', link: '/blog' },
    { id: 'menu-about', label: 'Về chúng tôi', link: '/about' },
];

const Navbar = () => {
    const { user, logout } = useAuth();
    const { cartCount } = useCart();
    const navigate = useNavigate();
    const location = useLocation();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [headerMenu, setHeaderMenu] = useState(null);
    const [headerConfig, setHeaderConfig] = useState(buildHeaderConfig({}));
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const fetchHeaderData = async () => {
            try {
                const [menuRes, settingsRes] = await Promise.all([
                    menuApi.getActive(),
                    cmsApi.settings.get(),
                ]);

                if (menuRes.data) setHeaderMenu(menuRes.data);
                setHeaderConfig(buildHeaderConfig(settingsRes.data || {}));
            } catch (err) {
                console.warn('Could not fetch header settings:', err.message);
            }
        };

        fetchHeaderData();
    }, []);

    const resolvedMenus = useMemo(() => {
        if (headerConfig?.activeMenus?.length) return headerConfig.activeMenus;
        const mappedMenus = mapMenuApiItems(headerMenu);
        return mappedMenus.length ? mappedMenus : fallbackMenus;
    }, [headerConfig, headerMenu]);

    const isLegacyPath = location.pathname.startsWith('/old');
    const searchPlaceholder = headerConfig.searchPlaceholder || 'Bạn cần tìm kiếm sản phẩm gì?';
    const topNoticeText = (headerConfig.topNoticeText || '').trim();
    const brandText = headerConfig.brandText || 'GỐM ĐẠI THÀNH';

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        const searchPath = isLegacyPath ? '/old/shop' : '/san-pham';
        navigate(`${searchPath}?search=${encodeURIComponent(searchQuery.trim())}`);
    };

    const mobileMenuTopClass = topNoticeText ? 'top-[106px]' : 'top-20';

    return (
        <header className="sticky top-0 z-50 bg-background-light/95 backdrop-blur-sm">
            {topNoticeText ? (
                <div className="border-b border-gold/20 bg-primary py-2 px-4 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white">
                    {topNoticeText}
                </div>
            ) : null}

            <div className="flex items-center justify-between whitespace-nowrap border-b border-gold/20 px-6 py-4 transition-all lg:px-12">
                <div className="flex items-center gap-8">
                    <Link className="group flex items-center gap-3 text-primary" to="/">
                        <div className="flex h-14 items-center overflow-hidden">
                            <img src="/logo-brand.jpg" alt={brandText} className="h-full object-contain" />
                        </div>
                        <div className="flex flex-col">
                            <h2 className="font-display text-xl font-bold leading-none tracking-wide text-primary transition-opacity group-hover:opacity-80">
                                {brandText}
                            </h2>
                            <span className="font-ui text-[10px] font-bold uppercase tracking-[0.3em] text-gold">Tinh hoa đất Việt</span>
                        </div>
                    </Link>

                    <nav className="hidden items-center gap-8 pl-8 lg:flex">
                        {resolvedMenus.map((item) => (
                            <Link
                                key={item.id}
                                className="relative font-ui text-sm font-medium uppercase tracking-widest text-umber transition-colors after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:text-primary hover:after:w-full"
                                to={item.link || '#'}
                            >
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-4">
                    <form onSubmit={handleSearchSubmit} className="hidden items-center gap-2 rounded-sm border border-gold/20 bg-white px-3 py-2 lg:flex">
                        <span className="material-symbols-outlined text-[18px] text-primary/40">search</span>
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={searchPlaceholder}
                            className="w-[220px] bg-transparent font-body text-sm text-primary placeholder:text-primary/30 focus:outline-none"
                        />
                    </form>

                    <Link to={isLegacyPath ? '/old/cart' : '/cart'} className="relative flex items-center justify-center text-stone transition-colors hover:text-primary">
                        <span className="material-symbols-outlined">shopping_bag</span>
                        {cartCount > 0 ? (
                            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brick text-[10px] font-bold text-white animate-fade-in">
                                {cartCount}
                            </span>
                        ) : null}
                    </Link>

                    {user ? (
                        <div className="flex items-center gap-4 border-l border-gold/20 pl-6">
                            <div className="hidden flex-col items-end lg:flex">
                                <span className="font-ui text-xs font-bold uppercase text-primary">{user.name}</span>
                                <div className="flex gap-3">
                                    <Link to={user.is_admin ? '/admin' : '/dashboard'} className="text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:text-gold">
                                        Bảng điều khiển
                                    </Link>
                                    <button onClick={handleLogout} className="text-[10px] uppercase tracking-widest text-stone transition-colors hover:text-brick">
                                        Đăng xuất
                                    </button>
                                </div>
                            </div>
                            <div className="group flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-gold/30 bg-white text-primary transition-all hover:border-primary">
                                <span className="material-symbols-outlined">person</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-4 border-l border-gold/20 pl-6">
                            <Link to="/login" className="hidden font-ui text-[10px] font-bold uppercase tracking-widest text-stone transition-colors hover:text-primary lg:block">
                                Đăng nhập
                            </Link>
                            <Link to="/register" className="bg-primary px-6 py-2 font-ui text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-umber shadow-premium">
                                Đăng ký
                            </Link>
                        </div>
                    )}

                    <button className="flex items-center justify-center text-primary lg:hidden" onClick={() => setIsMenuOpen((prev) => !prev)}>
                        <span className="material-symbols-outlined">{isMenuOpen ? 'close' : 'menu'}</span>
                    </button>
                </div>
            </div>

            {isMenuOpen ? (
                <div className={`fixed inset-x-0 bottom-0 z-40 overflow-y-auto border-t border-gold/10 bg-background-light px-6 py-12 lg:hidden ${mobileMenuTopClass}`}>
                    <div className="flex flex-col gap-8 text-center">
                        {resolvedMenus.map((item) => (
                            <Link
                                key={item.id}
                                to={item.link || '#'}
                                onClick={() => setIsMenuOpen(false)}
                                className="font-display text-2xl font-bold text-primary"
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>
                </div>
            ) : null}
        </header>
    );
};

export default Navbar;

