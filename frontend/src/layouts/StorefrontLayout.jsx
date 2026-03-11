import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import api from '../services/api';
import TrackingScripts, { trackLead } from '../components/TrackingScripts';

/* ── Sticky Action Bar (Mobile) ── */
const StickyActionBar = ({ phone, messengerUrl }) => (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white/95 backdrop-blur-xl border-t border-stone-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="flex items-stretch h-14">
            <a href={`tel:${phone || '0123456789'}`}
               className="flex-1 flex items-center justify-center gap-2 text-white bg-red-600 font-bold text-sm active:brightness-90 transition-all">
                <span className="material-symbols-outlined text-lg">call</span>
                Gọi ngay
            </a>
            <a href={messengerUrl || 'https://m.me/'}
               target="_blank" rel="noopener noreferrer"
               className="flex-1 flex items-center justify-center gap-2 text-white bg-blue-600 font-bold text-sm active:brightness-90 transition-all">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.434 5.503 3.683 7.197V22l3.38-1.856c.903.25 1.86.383 2.937.383 5.523 0 10-4.145 10-9.243C22 6.145 17.523 2 12 2zm1.039 12.458l-2.545-2.715L5.5 14.458l5.474-5.81 2.608 2.715L18.5 8.148l-5.461 6.31z"/></svg>
                Chat ngay
            </a>
            <Link to="/dat-hang"
               className="flex-1 flex items-center justify-center gap-2 text-white bg-amber-600 font-bold text-sm active:brightness-90 transition-all">
                <span className="material-symbols-outlined text-lg">shopping_bag</span>
                Đặt hàng
            </Link>
        </div>
    </div>
);

/* ── Header (Mobile-first) ── */
const StorefrontHeader = ({ categories, siteInfo }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [scrolled, setScrolled] = useState(false);
    const location = useLocation();

    useEffect(() => { setMenuOpen(false); setSearchOpen(false); }, [location]);

    useEffect(() => {
        const handler = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handler, { passive: true });
        return () => window.removeEventListener('scroll', handler);
    }, []);

    return (
        <>
            <header className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur-xl shadow-md' : 'bg-white/80 backdrop-blur-sm'}`}>
                <div className="max-w-7xl mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
                    {/* Mobile menu toggle */}
                    <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 -ml-2 text-stone-700">
                        <span className="material-symbols-outlined text-2xl">{menuOpen ? 'close' : 'menu'}</span>
                    </button>

                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg bg-primary flex items-center justify-center">
                            <span className="text-white font-black text-sm md:text-base">G</span>
                        </div>
                        <div className="hidden sm:block">
                            <h1 className="text-sm md:text-base font-black text-stone-900 uppercase tracking-tight leading-none">{siteInfo?.name || 'Cửa Hàng'}</h1>
                            <p className="text-[8px] md:text-[9px] text-stone-500 font-bold uppercase tracking-[0.2em]">Gốm Sứ Bát Tràng</p>
                        </div>
                    </Link>

                    {/* Desktop Navigation */}
                    <nav className="hidden md:flex items-center gap-1">
                        <Link to="/" className="px-3 py-2 text-sm font-bold text-stone-700 hover:text-primary transition-colors rounded-lg hover:bg-primary/5">Trang chủ</Link>
                        <div className="relative group">
                            <Link to="/san-pham" className="px-3 py-2 text-sm font-bold text-stone-700 hover:text-primary transition-colors rounded-lg hover:bg-primary/5 flex items-center gap-1">
                                Sản phẩm
                                <span className="material-symbols-outlined text-sm">expand_more</span>
                            </Link>
                            {categories && categories.length > 0 && (
                                <div className="absolute top-full left-0 pt-2 hidden group-hover:block">
                                    <div className="bg-white rounded-xl shadow-2xl border border-stone-100 p-2 min-w-[220px]">
                                        {categories.map(cat => (
                                            <Link key={cat.id} to={`/danh-muc/${cat.slug}`}
                                                  className="block px-4 py-2.5 text-sm font-medium text-stone-700 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
                                                {cat.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <Link to="/about" className="px-3 py-2 text-sm font-bold text-stone-700 hover:text-primary transition-colors rounded-lg hover:bg-primary/5">Giới thiệu</Link>
                        <Link to="/blog" className="px-3 py-2 text-sm font-bold text-stone-700 hover:text-primary transition-colors rounded-lg hover:bg-primary/5">Blog</Link>
                    </nav>

                    {/* Right actions */}
                    <div className="flex items-center gap-1">
                        <button onClick={() => setSearchOpen(!searchOpen)} className="p-2 text-stone-600 hover:text-primary transition-colors">
                            <span className="material-symbols-outlined text-xl">{searchOpen ? 'close' : 'search'}</span>
                        </button>
                        <a href="tel:0123456789" className="hidden md:flex items-center gap-2 ml-2 px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-black uppercase tracking-wider hover:brightness-90 transition-all">
                            <span className="material-symbols-outlined text-sm">call</span>
                            Hotline
                        </a>
                    </div>
                </div>

                {/* Search Bar */}
                {searchOpen && (
                    <div className="border-t border-stone-100 bg-white px-4 py-3">
                        <form onSubmit={(e) => { e.preventDefault(); if (searchQuery.trim()) window.location.href = `/san-pham?search=${encodeURIComponent(searchQuery)}`; }}
                              className="max-w-2xl mx-auto flex gap-2">
                            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                   placeholder="Tìm sản phẩm..." autoFocus
                                   className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            <button type="submit" className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:brightness-90 transition-all">
                                Tìm
                            </button>
                        </form>
                    </div>
                )}
            </header>

            {/* Mobile Menu Overlay */}
            {menuOpen && (
                <div className="fixed inset-0 z-[45] md:hidden">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
                    <div className="absolute top-14 left-0 right-0 bg-white shadow-2xl border-t border-stone-100 max-h-[70vh] overflow-auto">
                        <div className="p-4 space-y-1">
                            <Link to="/" className="block px-4 py-3 text-base font-bold text-stone-800 hover:bg-primary/5 rounded-xl transition-colors">🏠 Trang chủ</Link>
                            <Link to="/san-pham" className="block px-4 py-3 text-base font-bold text-stone-800 hover:bg-primary/5 rounded-xl transition-colors">🛍️ Tất cả sản phẩm</Link>
                            {categories?.map(cat => (
                                <Link key={cat.id} to={`/danh-muc/${cat.slug}`}
                                      className="block px-4 py-3 pl-10 text-sm font-medium text-stone-600 hover:bg-primary/5 rounded-xl transition-colors">
                                    {cat.name}
                                </Link>
                            ))}
                            <Link to="/about" className="block px-4 py-3 text-base font-bold text-stone-800 hover:bg-primary/5 rounded-xl transition-colors">📖 Giới thiệu</Link>
                            <Link to="/blog" className="block px-4 py-3 text-base font-bold text-stone-800 hover:bg-primary/5 rounded-xl transition-colors">📝 Blog</Link>
                            <div className="pt-3 border-t border-stone-100">
                                <a href="tel:0123456789" className="flex items-center gap-3 px-4 py-3 bg-red-50 text-red-700 rounded-xl font-bold">
                                    <span className="material-symbols-outlined">call</span> Gọi tư vấn: 0123 456 789
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

/* ── Footer ── */
const StorefrontFooter = ({ siteInfo }) => (
    <footer className="bg-stone-900 text-stone-300 pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 py-12 md:py-16">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-12">
                <div className="md:col-span-2">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
                            <span className="text-white font-black text-lg">G</span>
                        </div>
                        <div>
                            <h3 className="text-white font-black text-lg uppercase tracking-tight">{siteInfo?.name || 'Cửa Hàng'}</h3>
                            <p className="text-[9px] text-stone-400 font-bold uppercase tracking-[0.2em]">Gốm Sứ Bát Tràng</p>
                        </div>
                    </div>
                    <p className="text-sm leading-relaxed text-stone-400 max-w-md">
                        Chuyên cung cấp các sản phẩm gốm sứ Bát Tràng chất lượng cao. 
                        Mỗi sản phẩm là một tác phẩm nghệ thuật, được chế tác thủ công bởi nghệ nhân lành nghề.
                    </p>
                </div>
                <div>
                    <h4 className="text-white font-bold text-sm uppercase tracking-widest mb-4">Liên kết</h4>
                    <div className="space-y-2">
                        <Link to="/" className="block text-sm hover:text-white transition-colors">Trang chủ</Link>
                        <Link to="/san-pham" className="block text-sm hover:text-white transition-colors">Sản phẩm</Link>
                        <Link to="/about" className="block text-sm hover:text-white transition-colors">Giới thiệu</Link>
                        <Link to="/blog" className="block text-sm hover:text-white transition-colors">Blog</Link>
                    </div>
                </div>
                <div>
                    <h4 className="text-white font-bold text-sm uppercase tracking-widest mb-4">Liên hệ</h4>
                    <div className="space-y-3 text-sm">
                        <a href="tel:0123456789" className="flex items-center gap-2 hover:text-white transition-colors">
                            <span className="material-symbols-outlined text-base text-primary">call</span>
                            0123 456 789
                        </a>
                        <p className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-base text-primary mt-0.5">location_on</span>
                            Bát Tràng, Gia Lâm, Hà Nội
                        </p>
                    </div>
                </div>
            </div>
            <div className="mt-12 pt-6 border-t border-stone-800 text-center text-xs text-stone-500">
                © {new Date().getFullYear()} {siteInfo?.name || 'Cửa Hàng'}. Tất cả quyền được bảo lưu.
            </div>
        </div>
    </footer>
);

/* ── Lead Form Modal ── */
export const LeadFormModal = ({ show, onClose, product, source = 'website' }) => {
    const [form, setForm] = useState({ customer_name: '', phone: '', message: '' });
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.customer_name.trim() || !form.phone.trim()) return;
        setSubmitting(true);
        try {
            await api.post('/storefront/lead', {
                ...form,
                product_id: product?.id,
                source,
            });
            trackLead(product ? 'Product Inquiry' : 'General Inquiry');
            setSuccess(true);
            setTimeout(() => { setSuccess(false); onClose(); }, 2000);
        } catch {
            alert('Có lỗi xảy ra, vui lòng thử lại');
        }
        setSubmitting(false);
    };

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4" onClick={onClose}>
            <div className="bg-white w-full md:max-w-md md:rounded-2xl rounded-t-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="p-6 md:p-8">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-lg font-black text-stone-900 uppercase">Yêu cầu tư vấn</h3>
                            <p className="text-xs text-stone-500 font-medium mt-1">Chúng tôi sẽ liên hệ trong 15 phút</p>
                        </div>
                        <button onClick={onClose} className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>
                    {product && (
                        <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl mb-5">
                            {product.main_image && <img src={product.main_image} alt="" className="w-12 h-12 rounded-lg object-cover" />}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-stone-800 truncate">{product.name}</p>
                                <p className="text-xs text-primary font-black">{Number(product.current_price || product.price).toLocaleString()}đ</p>
                            </div>
                        </div>
                    )}
                    {success ? (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                                <span className="material-symbols-outlined text-green-600 text-3xl">check_circle</span>
                            </div>
                            <p className="font-bold text-stone-800">Gửi thành công!</p>
                            <p className="text-sm text-stone-500 mt-1">Chúng tôi sẽ liên hệ bạn sớm nhất.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Họ tên *</label>
                                <input type="text" required value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                                       placeholder="Nhập họ tên..."
                                       className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Số điện thoại *</label>
                                <input type="tel" required value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                                       placeholder="0xxx xxx xxx"
                                       className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-stone-700 uppercase tracking-widest block mb-1.5">Ghi chú</label>
                                <textarea rows={2} value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                                          placeholder="VD: Tôi muốn tư vấn về bộ đồ thờ..."
                                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none" />
                            </div>
                            <button type="submit" disabled={submitting}
                                    className="w-full py-3.5 bg-primary text-white rounded-xl font-black text-sm uppercase tracking-widest shadow-lg hover:brightness-90 active:scale-[0.98] transition-all disabled:opacity-50">
                                {submitting ? 'Đang gửi...' : 'GỬI YÊU CẦU TƯ VẤN'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

/* ── Main Layout ── */
const StorefrontLayout = () => {
    const [categories, setCategories] = useState([]);
    const [siteInfo, setSiteInfo] = useState(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [catRes] = await Promise.all([
                    api.get('/storefront/categories'),
                ]);
                setCategories(catRes.data || []);
            } catch (e) {
                console.error('Failed to load storefront data', e);
            }
        };
        load();
    }, []);

    return (
        <div className="flex flex-col min-h-screen bg-white text-stone-900 antialiased selection:bg-primary/20 selection:text-primary">
            <TrackingScripts />
            <StorefrontHeader categories={categories} siteInfo={siteInfo} />
            <main className="flex-grow pt-14 md:pt-16">
                <Outlet context={{ categories, siteInfo }} />
            </main>
            <StorefrontFooter siteInfo={siteInfo} />
            <StickyActionBar />
            {/* Desktop floating buttons */}
            <div className="hidden md:flex fixed bottom-6 right-6 z-50 flex-col gap-3">
                <a href="tel:0123456789" className="w-14 h-14 rounded-full bg-red-600 text-white flex items-center justify-center shadow-xl shadow-red-600/30 hover:scale-110 transition-transform" title="Gọi ngay">
                    <span className="material-symbols-outlined text-2xl">call</span>
                </a>
                <a href="https://m.me/" target="_blank" rel="noopener noreferrer" className="w-14 h-14 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xl shadow-blue-600/30 hover:scale-110 transition-transform" title="Chat Messenger">
                    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.434 5.503 3.683 7.197V22l3.38-1.856c.903.25 1.86.383 2.937.383 5.523 0 10-4.145 10-9.243C22 6.145 17.523 2 12 2zm1.039 12.458l-2.545-2.715L5.5 14.458l5.474-5.81 2.608 2.715L18.5 8.148l-5.461 6.31z"/></svg>
                </a>
            </div>
        </div>
    );
};

export default StorefrontLayout;
