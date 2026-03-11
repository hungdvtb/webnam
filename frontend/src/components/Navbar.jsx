import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useState, useEffect } from 'react';
import { menuApi } from '../services/api';

const Navbar = () => {
    const { user, logout } = useAuth();
    const { cartCount } = useCart();
    const navigate = useNavigate();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [headerMenu, setHeaderMenu] = useState(null);

    useEffect(() => {
        const fetchHeaderMenu = async () => {
            try {
                const res = await menuApi.getActive();
                if (res.data) {
                    setHeaderMenu(res.data);
                }
            } catch (err) {
                console.warn('Could not fetch active menu:', err.message);
            }
        };
        fetchHeaderMenu();
    }, []);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const renderMenuItems = (items, isMobile = false) => {
        if (!items || items.length === 0) return null;

        return items.map((item) => (
            <Link
                key={item.id}
                className={isMobile
                    ? "text-2xl font-display font-bold text-primary"
                    : "text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full"
                }
                to={item.url || '#'}
                onClick={() => isMobile && setIsMenuOpen(false)}
            >
                {item.title}
            </Link>
        ));
    };

    return (
        <header className="sticky top-0 z-50 flex items-center justify-between whitespace-nowrap border-b border-gold/20 bg-background-light/95 backdrop-blur-sm px-6 py-4 lg:px-12 transition-all">
            <div className="flex items-center gap-8">
                <Link className="flex items-center gap-3 text-primary group" to="/">
                    <div className="h-12">
                        <img src="/logo.png" alt="Gốm Sứ Đại Thành" className="h-full object-contain" />
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-primary text-xl font-display font-bold leading-none tracking-wide group-hover:opacity-80 transition-opacity">
                            Gốm Sứ Đại Thành
                        </h2>
                        <span className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold">Tinh Hoa Đất Việt</span>
                    </div>
                </Link>
                <nav className="hidden lg:flex items-center gap-8 pl-8">
                    {headerMenu ? (
                        renderMenuItems(headerMenu.root_items)
                    ) : (
                        <>
                            <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/">Trang Chủ</Link>
                            <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/shop">Cửa Hàng</Link>
                            <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/blog">Cẩm Nang</Link>
                            <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/about">Cốt Cách</Link>
                        </>
                    )}
                </nav>
            </div>
            <div className="flex items-center gap-6">
                <button className="hidden lg:flex items-center justify-center text-stone hover:text-primary transition-colors">
                    <span className="material-symbols-outlined">search</span>
                </button>
                <Link to="/cart" className="relative flex items-center justify-center text-stone hover:text-primary transition-colors">
                    <span className="material-symbols-outlined">shopping_bag</span>
                    {cartCount > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brick text-[10px] text-white font-bold animate-fade-in">
                            {cartCount}
                        </span>
                    )}
                </Link>

                {user ? (
                    <div className="flex items-center gap-4 border-l border-gold/20 pl-6">
                        <div className="hidden lg:flex flex-col items-end">
                            <span className="text-xs font-ui font-bold text-primary uppercase">{user.name}</span>
                            <div className="flex gap-3">
                                <Link to={user.is_admin ? "/admin" : "/dashboard"} className="text-[10px] text-primary hover:text-gold transition-colors uppercase tracking-widest font-bold">Bảng điều khiển</Link>
                                <button onClick={handleLogout} className="text-[10px] text-stone hover:text-brick transition-colors uppercase tracking-widest">Đăng xuất</button>
                            </div>
                        </div>
                        <div className="size-10 rounded-full border border-gold/30 bg-white flex items-center justify-center text-primary group cursor-pointer hover:border-primary transition-all">
                            <span className="material-symbols-outlined">person</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-4 border-l border-gold/20 pl-6">
                        <Link
                            to="/login"
                            className="hidden lg:block text-[10px] text-stone font-ui font-bold uppercase tracking-widest hover:text-primary transition-colors"
                        >
                            Đăng nhập
                        </Link>
                        <Link
                            to="/register"
                            className="bg-primary text-white px-6 py-2 font-ui font-bold text-[10px] uppercase tracking-widest hover:bg-umber transition-all shadow-premium"
                        >
                            Đăng ký
                        </Link>
                    </div>
                )}

                <button className="lg:hidden flex items-center justify-center text-primary" onClick={() => setIsMenuOpen(!isMenuOpen)}>
                    <span className="material-symbols-outlined">{isMenuOpen ? 'close' : 'menu'}</span>
                </button>
            </div>

            {/* Mobile Menu Backdrop */}
            {isMenuOpen && (
                <div className="fixed inset-0 top-20 bg-background-light z-40 lg:hidden animate-fade-in px-6 py-12 flex flex-col gap-8 text-center border-t border-gold/10 overflow-y-auto">
                    {headerMenu ? (
                        renderMenuItems(headerMenu.root_items, true)
                    ) : (
                        <>
                            <Link to="/" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Trang Chủ</Link>
                            <Link to="/shop" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Cửa Hàng</Link>
                            <Link to="/blog" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Cẩm Nang</Link>
                            <Link to="/about" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Cốt Cách</Link>
                        </>
                    )}
                </div>
            )}
        </header>
    );
};

export default Navbar;
