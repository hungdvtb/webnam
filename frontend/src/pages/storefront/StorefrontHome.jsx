import React, { useState, useEffect, useRef } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';

/* ── Product Card ── */
const ProductCard = ({ product, onConsult }) => {
    const [imgLoaded, setImgLoaded] = useState(false);
    const hasDiscount = product.special_price && product.current_price < product.price;

    return (
        <div className="group bg-white rounded-2xl border border-stone-100 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <Link to={`/san-pham/${product.slug || product.id}`} className="block relative aspect-square overflow-hidden bg-stone-100">
                {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-stone-200" />}
                <img
                    src={product.main_image || 'https://placehold.co/400x400?text=No+Image'}
                    alt={product.name}
                    loading="lazy"
                    onLoad={() => setImgLoaded(true)}
                    className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
                {hasDiscount && (
                    <div className="absolute top-3 left-3 px-2.5 py-1 bg-red-600 text-white text-[10px] font-black rounded-lg shadow-lg uppercase">
                        -{Math.round((1 - product.current_price / product.price) * 100)}%
                    </div>
                )}
                {product.is_new && (
                    <div className="absolute top-3 right-3 px-2.5 py-1 bg-emerald-600 text-white text-[10px] font-black rounded-lg shadow-lg uppercase">
                        Mới
                    </div>
                )}
            </Link>
            <div className="p-4">
                <Link to={`/san-pham/${product.slug || product.id}`}>
                    <h3 className="text-sm font-bold text-stone-800 line-clamp-2 leading-snug hover:text-primary transition-colors">
                        {product.name}
                    </h3>
                </Link>
                {product.category && (
                    <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mt-1">{product.category.name}</p>
                )}
                <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-base font-black text-red-600">{Number(product.current_price).toLocaleString()}đ</span>
                    {hasDiscount && (
                        <span className="text-xs text-stone-400 line-through">{Number(product.price).toLocaleString()}đ</span>
                    )}
                </div>
                <div className="flex gap-2 mt-3">
                    <Link to={`/san-pham/${product.slug || product.id}`}
                          className="flex-1 py-2 bg-primary text-white rounded-xl text-xs font-bold text-center hover:brightness-90 transition-all active:scale-95">
                        Chi tiết
                    </Link>
                    <button onClick={(e) => { e.preventDefault(); onConsult?.(product); }}
                            className="py-2 px-3 border border-stone-200 rounded-xl text-xs font-bold text-stone-600 hover:bg-stone-50 transition-all active:scale-95">
                        Tư vấn
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ── Banner Slider ── */
const BannerSlider = ({ banners }) => {
    const [current, setCurrent] = useState(0);
    const timerRef = useRef(null);

    useEffect(() => {
        if (banners.length <= 1) return;
        timerRef.current = setInterval(() => setCurrent(c => (c + 1) % banners.length), 5000);
        return () => clearInterval(timerRef.current);
    }, [banners.length]);

    if (!banners.length) return (
        <div className="relative bg-gradient-to-br from-primary via-primary/90 to-stone-800 text-white">
            <div className="max-w-7xl mx-auto px-4 py-16 md:py-24 text-center">
                <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tight mb-4">Gốm Sứ Bát Tràng</h2>
                <p className="text-base md:text-lg text-white/80 max-w-xl mx-auto mb-8">Nơi tôn vinh vẻ đẹp truyền thống qua từng sản phẩm thủ công tinh xảo</p>
                <Link to="/san-pham" className="inline-flex items-center gap-2 px-8 py-3.5 bg-white text-primary rounded-xl text-sm font-black uppercase tracking-widest hover:bg-stone-50 transition-all shadow-xl">
                    XEM SẢN PHẨM
                    <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </Link>
            </div>
        </div>
    );

    const banner = banners[current];
    return (
        <div className="relative h-[50vh] md:h-[65vh] overflow-hidden bg-stone-100">
            {banners.map((b, i) => (
                <div key={b.id || i} className={`absolute inset-0 transition-opacity duration-700 ${i === current ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <img src={b.image_url || 'https://placehold.co/1200x600'} alt={b.title} className="w-full h-full object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </div>
            ))}
            <div className="absolute inset-0 flex items-end justify-start max-w-7xl mx-auto px-4 pb-12 md:pb-16">
                <div className="text-white max-w-lg">
                    {banner?.title && <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tight mb-2 drop-shadow-lg">{banner.title}</h2>}
                    {banner?.subtitle && <p className="text-sm md:text-base text-white/90 mb-5 drop-shadow">{banner.subtitle}</p>}
                    {banner?.button_text && (
                        <Link to={banner.link_url || '/san-pham'} className="inline-flex items-center gap-2 px-6 py-3 bg-white text-stone-900 rounded-xl text-sm font-black uppercase tracking-wider hover:bg-stone-50 transition-all shadow-xl">
                            {banner.button_text}
                            <span className="material-symbols-outlined text-lg">arrow_forward</span>
                        </Link>
                    )}
                </div>
            </div>
            {/* Dots */}
            {banners.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                    {banners.map((_, i) => (
                        <button key={i} onClick={() => setCurrent(i)}
                                className={`w-2 h-2 rounded-full transition-all ${i === current ? 'bg-white w-6' : 'bg-white/50'}`} />
                    ))}
                </div>
            )}
        </div>
    );
};

/* ── Section Title ── */
const SectionTitle = ({ title, subtitle, link, linkText }) => (
    <div className="flex items-end justify-between mb-8">
        <div>
            <h2 className="text-xl md:text-2xl font-black text-stone-900 uppercase tracking-tight">{title}</h2>
            {subtitle && <p className="text-sm text-stone-500 font-medium mt-1">{subtitle}</p>}
        </div>
        {link && (
            <Link to={link} className="text-sm font-bold text-primary flex items-center gap-1 hover:underline whitespace-nowrap">
                {linkText || 'Xem tất cả'}
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </Link>
        )}
    </div>
);

/* ── Category Grid ── */
const CategoryGrid = ({ categories }) => {
    if (!categories?.length) return null;
    const colors = ['from-amber-500/20 to-orange-500/10', 'from-blue-500/20 to-cyan-500/10', 'from-green-500/20 to-emerald-500/10', 'from-purple-500/20 to-pink-500/10', 'from-red-500/20 to-rose-500/10', 'from-teal-500/20 to-sky-500/10'];
    const icons = ['🏺', '🍵', '🎋', '🌸', '🎭', '🏮', '🪷', '📿'];

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            {categories.slice(0, 6).map((cat, i) => (
                <Link key={cat.id} to={`/danh-muc/${cat.slug}`}
                      className={`bg-gradient-to-br ${colors[i % colors.length]} rounded-2xl p-5 text-center hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group border border-stone-100`}>
                    <div className="text-3xl mb-2">{icons[i % icons.length]}</div>
                    <h3 className="text-sm font-bold text-stone-800 group-hover:text-primary transition-colors">{cat.name}</h3>
                    <p className="text-[10px] text-stone-500 font-medium mt-1">{cat.products_count || 0} sản phẩm</p>
                </Link>
            ))}
        </div>
    );
};

/* ── Review Card ── */
const ReviewCard = ({ review }) => (
    <div className="bg-white rounded-2xl border border-stone-100 p-5 hover:shadow-md transition-all">
        <div className="flex items-center gap-1 mb-3">
            {[1, 2, 3, 4, 5].map(s => (
                <span key={s} className={`material-symbols-outlined text-sm ${s <= review.rating ? 'text-amber-500' : 'text-stone-200'}`}>star</span>
            ))}
        </div>
        <p className="text-sm text-stone-600 leading-relaxed line-clamp-3 italic mb-3">"{review.comment}"</p>
        <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-800">{review.customer_name}</span>
            {review.product && <Link to={`/san-pham/${review.product.slug}`} className="text-[10px] text-primary font-medium hover:underline truncate max-w-[120px]">{review.product.name}</Link>}
        </div>
    </div>
);

/* ── MAIN HOME PAGE ── */
const StorefrontHome = () => {
    const { categories: navCategories } = useOutletContext();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [consultProduct, setConsultProduct] = useState(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await api.get('/storefront/homepage');
                setData(res.data);
            } catch (e) {
                console.error('Failed to load homepage', e);
            }
            setLoading(false);
        };
        load();
    }, []);

    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="animate-fade-in">
            {/* Hero Banner */}
            <BannerSlider banners={data?.banners || []} />

            {/* Categories */}
            <section className="max-w-7xl mx-auto px-4 py-10 md:py-14">
                <SectionTitle title="Danh mục sản phẩm" subtitle="Khám phá đa dạng bộ sưu tập gốm sứ" link="/san-pham" />
                <CategoryGrid categories={data?.categories || navCategories} />
            </section>

            {/* Featured Products */}
            {data?.featured_products?.length > 0 && (
                <section className="bg-stone-50/50 py-10 md:py-14">
                    <div className="max-w-7xl mx-auto px-4">
                        <SectionTitle title="Sản phẩm nổi bật" subtitle="Những tác phẩm được yêu thích nhất" link="/san-pham?featured=1" />
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
                            {data.featured_products.slice(0, 8).map(p => (
                                <ProductCard key={p.id} product={p} onConsult={setConsultProduct} />
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* New Arrivals */}
            {data?.new_arrivals?.length > 0 && (
                <section className="max-w-7xl mx-auto px-4 py-10 md:py-14">
                    <SectionTitle title="Sản phẩm mới" subtitle="Vừa ra lò, độc bản" link="/san-pham?sort=newest" />
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-5">
                        {data.new_arrivals.slice(0, 8).map(p => (
                            <ProductCard key={p.id} product={p} onConsult={setConsultProduct} />
                        ))}
                    </div>
                </section>
            )}

            {/* CTA Banner */}
            <section className="bg-primary text-white">
                <div className="max-w-4xl mx-auto px-4 py-12 md:py-16 text-center">
                    <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight mb-3">Bạn cần tư vấn?</h2>
                    <p className="text-base text-white/80 mb-8 max-w-md mx-auto">Hãy để chúng tôi giúp bạn chọn sản phẩm phù hợp nhất. Tư vấn miễn phí, không ràng buộc.</p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <a href="tel:0123456789" className="flex items-center gap-2 px-8 py-3.5 bg-white text-primary rounded-xl text-sm font-black uppercase tracking-widest hover:bg-stone-50 transition-all shadow-xl">
                            <span className="material-symbols-outlined">call</span> GỌI NGAY: 0123 456 789
                        </a>
                        <button onClick={() => setConsultProduct({})} className="flex items-center gap-2 px-8 py-3.5 border-2 border-white text-white rounded-xl text-sm font-black uppercase tracking-widest hover:bg-white/10 transition-all">
                            <span className="material-symbols-outlined">edit_note</span> GỬI YÊU CẦU
                        </button>
                    </div>
                </div>
            </section>

            {/* Customer Reviews */}
            {data?.reviews?.length > 0 && (
                <section className="max-w-7xl mx-auto px-4 py-10 md:py-14">
                    <SectionTitle title="Khách hàng nói gì" subtitle="Phản hồi từ khách hàng đã mua hàng" />
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.reviews.map(r => <ReviewCard key={r.id} review={r} />)}
                    </div>
                </section>
            )}

            {/* Lead Form */}
            <LeadFormModal show={!!consultProduct} onClose={() => setConsultProduct(null)} product={consultProduct?.id ? consultProduct : null} />
        </div>
    );
};

export default StorefrontHome;
