import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import api from '../services/api';
import TrackingScripts, { trackLead } from '../components/TrackingScripts';
import { buildHeaderConfig } from '../utils/headerSettings';
import { buildFooterConfig } from '../utils/footerSettings';
import { rememberLeadAttribution } from '../utils/leadAttribution';

const StickyActionBar = ({ phone, messengerUrl }) => (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-stone-200 bg-white/95 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur-xl md:hidden">
        <div className="flex h-14 items-stretch">
            <a href={`tel:${phone || '0123456789'}`} className="flex flex-1 items-center justify-center gap-2 bg-red-600 text-sm font-bold text-white transition-all active:brightness-90">
                <span className="material-symbols-outlined text-lg">call</span>
                Gọi ngay
            </a>
            <a href={messengerUrl || 'https://m.me/'} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-2 bg-blue-600 text-sm font-bold text-white transition-all active:brightness-90">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.434 5.503 3.683 7.197V22l3.38-1.856c.903.25 1.86.383 2.937.383 5.523 0 10-4.145 10-9.243C22 6.145 17.523 2 12 2zm1.039 12.458l-2.545-2.715L5.5 14.458l5.474-5.81 2.608 2.715L18.5 8.148l-5.461 6.31z"/></svg>
                Chat ngay
            </a>
            <Link to="/dat-hang" className="flex flex-1 items-center justify-center gap-2 bg-amber-600 text-sm font-bold text-white transition-all active:brightness-90">
                <span className="material-symbols-outlined text-lg">shopping_bag</span>
                Đặt hàng
            </Link>
        </div>
    </div>
);

const StorefrontHeader = ({ headerConfig, siteInfo }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [scrolled, setScrolled] = useState(false);
    const location = useLocation();

    const noticeText = (headerConfig?.topNoticeText || '').trim();
    const logoUrl = headerConfig?.logoUrl || '/logo-brand.jpg';
    const navMenus = headerConfig?.activeMenus?.length
        ? headerConfig.activeMenus
        : [
            { id: 'home', label: 'Trang chủ', link: '/' },
            { id: 'products', label: 'Sản phẩm', link: '/san-pham' },
            { id: 'about', label: 'Về chúng tôi', link: '/about' },
            { id: 'knowledge', label: 'Kiến thức gốm', link: '/blog' },
        ];

    useEffect(() => {
        setMenuOpen(false);
        setSearchOpen(false);
    }, [location]);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <>
            <header className={`fixed left-0 right-0 top-0 z-40 transition-all duration-300 ${scrolled ? 'bg-white/95 shadow-md backdrop-blur-xl' : 'bg-white/80 backdrop-blur-sm'}`}>
                {noticeText ? (
                    <div className="h-7 bg-primary px-4 text-center text-[10px] font-black uppercase tracking-[0.16em] text-white flex items-center justify-center">
                        {noticeText}
                    </div>
                ) : null}

                <div className={`mx-auto flex max-w-7xl items-center justify-between px-4 ${noticeText ? 'h-[56px] md:h-[64px]' : 'h-14 md:h-16'}`}>
                    <button onClick={() => setMenuOpen((prev) => !prev)} className="p-2 -ml-2 text-stone-700 md:hidden">
                        <span className="material-symbols-outlined text-2xl">{menuOpen ? 'close' : 'menu'}</span>
                    </button>

                    <Link to="/" className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-primary md:h-9 md:w-9">
                            <img src={logoUrl} alt={headerConfig?.brandText || siteInfo?.name || 'Cửa hàng'} className="h-full w-full object-contain bg-white" />
                        </div>
                        <div className="hidden sm:block">
                            <h1 className="text-sm font-black uppercase leading-none tracking-tight text-stone-900 md:text-base">
                                {headerConfig?.brandText || siteInfo?.name || 'Cửa hàng'}
                            </h1>
                            <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-stone-500 md:text-[9px]">
                                Gốm sứ Việt
                            </p>
                        </div>
                    </Link>

                    <nav className="hidden items-center gap-1 md:flex">
                        {navMenus.map((menu) => (
                            <Link key={menu.id || menu.link} to={menu.link || '/'} className="rounded-lg px-3 py-2 text-sm font-bold text-stone-700 transition-colors hover:bg-primary/5 hover:text-primary">
                                {menu.label}
                            </Link>
                        ))}
                    </nav>

                    <div className="flex items-center gap-1">
                        <button onClick={() => setSearchOpen((prev) => !prev)} className="p-2 text-stone-600 transition-colors hover:text-primary">
                            <span className="material-symbols-outlined text-xl">{searchOpen ? 'close' : 'search'}</span>
                        </button>
                        <a href={`tel:${siteInfo?.phone || '0123456789'}`} className="ml-2 hidden items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition-all hover:brightness-90 md:flex">
                            <span className="material-symbols-outlined text-sm">call</span>
                            Hotline
                        </a>
                    </div>
                </div>

                {searchOpen ? (
                    <div className="border-t border-stone-100 bg-white px-4 py-3">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (searchQuery.trim()) window.location.href = `/san-pham?search=${encodeURIComponent(searchQuery)}`;
                            }}
                            className="mx-auto flex max-w-2xl gap-2"
                        >
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={headerConfig?.searchPlaceholder || 'Bạn cần tìm kiếm sản phẩm gì?'}
                                autoFocus
                                className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                            />
                            <button type="submit" className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-all hover:brightness-90">
                                Tìm
                            </button>
                        </form>
                    </div>
                ) : null}
            </header>

            {menuOpen ? (
                <div className="fixed inset-0 z-[45] md:hidden">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
                    <div className={`absolute left-0 right-0 max-h-[70vh] overflow-auto border-t border-stone-100 bg-white shadow-2xl ${noticeText ? 'top-[84px]' : 'top-14'}`}>
                        <div className="space-y-1 p-4">
                            {navMenus.map((menu) => (
                                <Link
                                    key={menu.id || menu.link}
                                    to={menu.link || '/'}
                                    className="block rounded-xl px-4 py-3 text-base font-bold text-stone-800 transition-colors hover:bg-primary/5"
                                >
                                    {menu.label}
                                </Link>
                            ))}
                            <div className="border-t border-stone-100 pt-3">
                                <a href={`tel:${siteInfo?.phone || '0123456789'}`} className="flex items-center gap-3 rounded-xl bg-red-50 px-4 py-3 font-bold text-red-700">
                                    <span className="material-symbols-outlined">call</span>
                                    Gọi tư vấn: {siteInfo?.phone || '0123 456 789'}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
};

const StorefrontFooter = ({ siteInfo, footerConfig }) => (
    <footer className="bg-stone-900 pb-20 text-stone-300 md:pb-0">
        <div className="mx-auto max-w-7xl px-4 py-12 md:py-16">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,1fr))] md:gap-12">
                <div className="space-y-4">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-primary">
                            <img src={footerConfig?.logoUrl || '/logo-brand.jpg'} alt={footerConfig?.brandText || siteInfo?.name || 'Cửa hàng'} className="h-full w-full object-contain bg-white" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black uppercase tracking-tight text-white">{footerConfig?.brandText || siteInfo?.name || 'Cửa hàng'}</h3>
                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-stone-400">Gốm sứ Bát Tràng</p>
                        </div>
                    </div>
                    <p className="max-w-md text-sm leading-relaxed text-stone-400">
                        {footerConfig?.description}
                    </p>
                    <div className="space-y-3 text-sm text-stone-300">
                        {footerConfig?.hotline ? (
                            <a href={`tel:${footerConfig.hotline}`} className="flex items-center gap-2 transition-colors hover:text-white">
                                <span className="material-symbols-outlined text-base text-primary">call</span>
                                {footerConfig.hotline}
                            </a>
                        ) : null}
                        {footerConfig?.email ? (
                            <a href={`mailto:${footerConfig.email}`} className="flex items-center gap-2 transition-colors hover:text-white">
                                <span className="material-symbols-outlined text-base text-primary">mail</span>
                                {footerConfig.email}
                            </a>
                        ) : null}
                        {footerConfig?.address ? (
                            <p className="flex items-start gap-2">
                                <span className="material-symbols-outlined mt-0.5 text-base text-primary">location_on</span>
                                {footerConfig.address}
                            </p>
                        ) : null}
                    </div>
                </div>

                {footerConfig?.activeGroups?.map((group) => (
                    <div key={group.id}>
                        <h4 className="mb-4 text-sm font-bold uppercase tracking-widest text-white">{group.title}</h4>
                        <div className="space-y-2">
                            {group.items.map((item) => (
                                <a key={item.id} href={item.link || '#'} className="block text-sm transition-colors hover:text-white">
                                    {item.label}
                                </a>
                            ))}
                        </div>
                    </div>
                ))}

                <div>
                    <h4 className="mb-4 text-sm font-bold uppercase tracking-widest text-white">Bản tin</h4>
                    <p className="mb-4 text-sm text-stone-400">Nhận thông tin về các bộ sưu tập mới nhất và ưu đãi đặc quyền.</p>
                    <div className="flex gap-2">
                        <input
                            type="email"
                            placeholder={footerConfig?.newsletterPlaceholder || 'Email của bạn'}
                            className="w-full rounded-xl border border-stone-700 bg-stone-800 px-4 py-3 text-sm text-white placeholder:text-stone-500 outline-none focus:border-primary"
                        />
                        <button type="button" className="rounded-xl bg-primary px-4 text-sm font-bold text-white transition-all hover:brightness-90">
                            Gửi
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-12 border-t border-stone-800 pt-6 text-center text-xs text-stone-500">
                {footerConfig?.copyrightText}
            </div>
        </div>
    </footer>
);

export const LeadFormModal = ({ show, onClose, product, source = 'website' }) => {
    const [form, setForm] = useState({ customer_name: '', phone: '', message: '' });
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.customer_name.trim() || !form.phone.trim()) return;
        setSubmitting(true);
        try {
            await api.post('/storefront/lead', { ...form, product_id: product?.id, source });
            trackLead(product ? 'Product Inquiry' : 'General Inquiry');
            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                onClose();
            }, 2000);
        } catch {
            alert('Có lỗi xảy ra, vui lòng thử lại');
        }
        setSubmitting(false);
    };

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4" onClick={onClose}>
            <div className="w-full rounded-t-3xl bg-white shadow-2xl md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 md:p-8">
                    <div className="mb-6 flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-black uppercase text-stone-900">Yêu cầu tư vấn</h3>
                            <p className="mt-1 text-xs font-medium text-stone-500">Chúng tôi sẽ liên hệ trong 15 phút</p>
                        </div>
                        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                            <span className="material-symbols-outlined text-lg">close</span>
                        </button>
                    </div>

                    {product ? (
                        <div className="mb-5 flex items-center gap-3 rounded-xl bg-stone-50 p-3">
                            {product.main_image ? <img src={product.main_image} alt="" className="h-12 w-12 rounded-lg object-cover" /> : null}
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-stone-800">{product.name}</p>
                                <p className="text-xs font-black text-primary">{Number(product.current_price || product.price || 0).toLocaleString()}đ</p>
                            </div>
                        </div>
                    ) : null}

                    {success ? (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                                <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
                            </div>
                            <p className="font-bold text-stone-800">Gửi thành công!</p>
                            <p className="mt-1 text-sm text-stone-500">Chúng tôi sẽ liên hệ bạn sớm nhất.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <input type="text" required value={form.customer_name} onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))} placeholder="Nhập họ tên..." className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            <input type="tel" required value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="0xxx xxx xxx" className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            <textarea rows={2} value={form.message} onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))} placeholder="VD: Tôi muốn tư vấn về bộ đồ thờ..." className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium outline-none focus:border-primary focus:ring-1 focus:ring-primary/20" />
                            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-primary py-3.5 text-sm font-black uppercase tracking-widest text-white shadow-lg transition-all hover:brightness-90 disabled:opacity-50">
                                {submitting ? 'Đang gửi...' : 'GỬI YÊU CẦU TƯ VẤN'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

const StorefrontLayout = () => {
    const [categories, setCategories] = useState([]);
    const [siteInfo, setSiteInfo] = useState(null);
    const [headerConfig, setHeaderConfig] = useState(buildHeaderConfig({}));
    const [footerConfig, setFooterConfig] = useState(buildFooterConfig({}));

    useEffect(() => {
        rememberLeadAttribution();

        const load = async () => {
            try {
                const [catRes, settingRes] = await Promise.all([
                    api.get('/storefront/categories'),
                    api.get('/site-settings'),
                ]);

                const settings = settingRes.data || {};
                setCategories(catRes.data || []);
                setHeaderConfig(buildHeaderConfig(settings));
                setFooterConfig(buildFooterConfig(settings));
                setSiteInfo({
                    name: settings.site_name || settings.header_brand_text || '',
                    phone: settings.contact_phone || '',
                    messengerUrl: settings.messenger_link || '',
                });
            } catch (error) {
                console.error('Failed to load storefront data', error);
            }
        };

        load();
    }, []);

    const hasTopNotice = Boolean((headerConfig?.topNoticeText || '').trim());

    return (
        <div className="min-h-screen bg-white text-stone-900 antialiased selection:bg-primary/20 selection:text-primary">
            <TrackingScripts />
            <StorefrontHeader siteInfo={siteInfo} headerConfig={headerConfig} />
            <main className={`flex min-h-screen flex-col ${hasTopNotice ? 'pt-[84px] md:pt-[92px]' : 'pt-14 md:pt-16'}`}>
                <Outlet context={{ categories, siteInfo, headerConfig, footerConfig }} />
            </main>
            <StorefrontFooter siteInfo={siteInfo} footerConfig={footerConfig} />
            <StickyActionBar phone={siteInfo?.phone} messengerUrl={siteInfo?.messengerUrl} />
            <div className="fixed bottom-6 right-6 z-50 hidden flex-col gap-3 md:flex">
                <a href={`tel:${siteInfo?.phone || '0123456789'}`} className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-xl shadow-red-600/30 transition-transform hover:scale-110" title="Gọi ngay">
                    <span className="material-symbols-outlined text-2xl">call</span>
                </a>
                <a href={siteInfo?.messengerUrl || 'https://m.me/'} target="_blank" rel="noopener noreferrer" className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl shadow-blue-600/30 transition-transform hover:scale-110" title="Chat Messenger">
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.907 1.434 5.503 3.683 7.197V22l3.38-1.856c.903.25 1.86.383 2.937.383 5.523 0 10-4.145 10-9.243C22 6.145 17.523 2 12 2zm1.039 12.458l-2.545-2.715L5.5 14.458l5.474-5.81 2.608 2.715L18.5 8.148l-5.461 6.31z"/></svg>
                </a>
            </div>
        </div>
    );
};

export default StorefrontLayout;
