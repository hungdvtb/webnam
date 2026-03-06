import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useState } from 'react';

const Navbar = () => {
    const { user, logout } = useAuth();
    const { cartCount } = useCart();
    const navigate = useNavigate();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    return (
        <header className="sticky top-0 z-50 flex items-center justify-between whitespace-nowrap border-b border-gold/20 bg-background-light/95 backdrop-blur-sm px-6 py-4 lg:px-12 transition-all">
            <div className="flex items-center gap-8">
                <Link className="flex items-center gap-3 text-primary group" to="/">
                    <div className="size-8 text-primary">
                        <span className="material-symbols-outlined text-4xl">local_florist</span>
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-primary text-xl font-display font-bold leading-none tracking-wide group-hover:opacity-80 transition-opacity">
                            Di Sản Gốm Việt
                        </h2>
                        <span className="text-[10px] text-gold uppercase tracking-[0.3em] font-ui font-bold">Tinh Hoa Đất Việt</span>
                    </div>
                </Link>
                <nav className="hidden lg:flex items-center gap-8 pl-8">
                    <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/">Trang Chủ</Link>
                    <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/shop">Cửa Hàng</Link>
                    <Link className="text-umber hover:text-primary font-ui text-sm font-medium uppercase tracking-widest transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:h-[1px] after:w-0 after:bg-primary after:transition-all hover:after:w-full" to="/about">Cốt Cách</Link>
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
                            <button onClick={handleLogout} className="text-[10px] text-stone hover:text-brick transition-colors uppercase tracking-widest">Đăng xuất</button>
                        </div>
                        <div className="size-10 rounded-full border border-gold/30 bg-white flex items-center justify-center text-primary group cursor-pointer hover:border-primary transition-all">
                            <span className="material-symbols-outlined">person</span>
                        </div>
                    </div>
                ) : (
                    <Link to="/login" className="hidden lg:flex items-center gap-2 text-stone hover:text-primary transition-colors font-ui text-sm font-bold uppercase tracking-widest border border-gold/30 px-4 py-2 hover:bg-gold/5 transition-all">
                        <span className="material-symbols-outlined text-base">person</span>
                        Đăng Nhập
                    </Link>
                )}

                <button className="lg:hidden flex items-center justify-center text-primary" onClick={() => setIsMenuOpen(!isMenuOpen)}>
                    <span className="material-symbols-outlined">{isMenuOpen ? 'close' : 'menu'}</span>
                </button>
            </div>

            {/* Mobile Menu Backdrop */}
            {isMenuOpen && (
                <div className="fixed inset-0 top-20 bg-background-light z-40 lg:hidden animate-fade-in px-6 py-12 flex flex-col gap-8 text-center border-t border-gold/10">
                    <Link to="/" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Trang Chủ</Link>
                    <Link to="/shop" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Cửa Hàng</Link>
                    <Link to="/about" onClick={() => setIsMenuOpen(false)} className="text-2xl font-display font-bold text-primary">Cốt Cách</Link>
                    {!user && (
                        <Link to="/login" onClick={() => setIsMenuOpen(false)} className="mt-4 bg-primary text-white py-4 font-ui font-bold uppercase tracking-widest">Đăng Nhập</Link>
                    )}
                </div>
            )}
        </header>
    );
};

export default Navbar;
