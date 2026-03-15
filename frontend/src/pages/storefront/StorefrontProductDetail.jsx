import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';
import { trackAddToCart } from '../../components/TrackingScripts';

/* ── Image Gallery ── */
const ImageGallery = ({ images }) => {
    const [active, setActive] = useState(0);
    const [zoomed, setZoomed] = useState(false);
    const imgs = images?.length ? images : [{ url: 'https://placehold.co/600', id: 0 }];

    return (
        <div className="space-y-3">
            {/* Main Image */}
            <div className="relative aspect-square bg-stone-100 rounded-2xl overflow-hidden cursor-zoom-in" onClick={() => setZoomed(true)}>
                <img src={imgs[active]?.url || 'https://placehold.co/800'} alt="" className="w-full h-full object-cover" />
                {imgs.length > 1 && (
                    <>
                        <button onClick={e => { e.stopPropagation(); setActive((active - 1 + imgs.length) % imgs.length); }}
                                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow text-stone-700">
                            <span className="material-symbols-outlined text-lg">chevron_left</span>
                        </button>
                        <button onClick={e => { e.stopPropagation(); setActive((active + 1) % imgs.length); }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow text-stone-700">
                            <span className="material-symbols-outlined text-lg">chevron_right</span>
                        </button>
                    </>
                )}
            </div>
            {/* Thumbnails */}
            {imgs.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                    {imgs.map((img, i) => (
                        <button key={img.id} onClick={() => setActive(i)}
                                className={`w-16 h-16 md:w-20 md:h-20 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${i === active ? 'border-primary shadow-md' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                            <img src={img.url || 'https://placehold.co/1200x600'} alt="" className="w-full h-full object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
                        </button>
                    ))}
                </div>
            )}
            {/* Fullscreen Zoom */}
            {zoomed && (
                <div className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center" onClick={() => setZoomed(false)}>
                    <button className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                    <img src={imgs[active]?.url || 'https://placehold.co/800'} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
                </div>
            )}
        </div>
    );
};

/* ── Star Rating ── */
const Stars = ({ rating, size = 'text-sm' }) => (
    <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} className={`material-symbols-outlined ${size} ${s <= Math.round(rating) ? 'text-amber-500' : 'text-stone-200'}`}>star</span>
        ))}
    </div>
);

const StorefrontProductDetail = () => {
    const { slugOrId } = useParams();
    const [product, setProduct] = useState(null);
    const [related, setRelated] = useState([]);
    const [loading, setLoading] = useState(true);
    const [quantity, setQuantity] = useState(1);
    const [showLeadForm, setShowLeadForm] = useState(false);
    const [activeTab, setActiveTab] = useState('description');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/storefront/products/${slugOrId}`);
                setProduct(res.data);
                // Load related
                try {
                    const relRes = await api.get(`/storefront/products/${res.data.id}/related`);
                    setRelated(relRes.data || []);
                } catch {}
            } catch (e) {
                console.error('Failed to load product', e);
            }
            setLoading(false);
        };
        load();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [slugOrId]);

    if (loading) return (
        <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="grid md:grid-cols-2 gap-8">
                <div className="aspect-square bg-stone-200 rounded-2xl animate-pulse" />
                <div className="space-y-4">
                    <div className="h-6 bg-stone-200 rounded animate-pulse w-3/4" />
                    <div className="h-8 bg-stone-200 rounded animate-pulse w-1/3" />
                    <div className="h-32 bg-stone-200 rounded animate-pulse" />
                </div>
            </div>
        </div>
    );

    if (!product) return (
        <div className="max-w-7xl mx-auto px-4 py-20 text-center">
            <span className="material-symbols-outlined text-6xl text-stone-300 mb-3 block">error_outline</span>
            <p className="font-bold text-lg text-stone-700">Không tìm thấy sản phẩm</p>
            <Link to="/san-pham" className="text-primary font-bold text-sm mt-2 inline-block hover:underline">← Quay lại cửa hàng</Link>
        </div>
    );

    const hasDiscount = product.special_price && product.current_price < product.price;

    return (
        <div className="animate-fade-in">
            {/* Breadcrumb */}
            <div className="bg-stone-50 border-b border-stone-100">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2 text-xs text-stone-500 font-medium">
                    <Link to="/" className="hover:text-primary">Trang chủ</Link>
                    <span>/</span>
                    <Link to="/san-pham" className="hover:text-primary">Sản phẩm</Link>
                    {product.category && (
                        <>
                            <span>/</span>
                            <Link to={`/danh-muc/${product.category.slug}`} className="hover:text-primary">{product.category.name}</Link>
                        </>
                    )}
                    <span>/</span>
                    <span className="text-stone-800 font-bold truncate max-w-[200px]">{product.name}</span>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-6 md:py-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
                    {/* Left: Images */}
                    <ImageGallery images={product.images} />

                    {/* Right: Info */}
                    <div className="space-y-5">
                        {product.category && (
                            <Link to={`/danh-muc/${product.category.slug}`} className="text-[10px] font-black text-primary uppercase tracking-[0.2em] hover:underline">
                                {product.category.name}
                            </Link>
                        )}
                        <h1 className="text-xl md:text-2xl font-black text-stone-900 uppercase tracking-tight leading-tight">{product.name}</h1>

                        {/* Rating */}
                        {product.review_count > 0 && (
                            <div className="flex items-center gap-2">
                                <Stars rating={product.average_rating} />
                                <span className="text-xs text-stone-500 font-medium">({product.review_count} đánh giá)</span>
                            </div>
                        )}

                        {/* Price */}
                        <div className="flex items-baseline gap-3">
                            <span className="text-2xl md:text-3xl font-black text-red-600">{Number(product.current_price).toLocaleString()}đ</span>
                            {hasDiscount && (
                                <>
                                    <span className="text-lg text-stone-400 line-through">{Number(product.price).toLocaleString()}đ</span>
                                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-black rounded-md">
                                        -{Math.round((1 - product.current_price / product.price) * 100)}%
                                    </span>
                                </>
                            )}
                        </div>

                        {/* Stock */}
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${product.stock_quantity > 0 ? 'bg-green-500' : 'bg-red-500'}`}></span>
                            <span className="text-xs font-bold text-stone-600">{product.stock_quantity > 0 ? `Còn hàng (${product.stock_quantity})` : 'Hết hàng'}</span>
                        </div>

                        {/* Attributes */}
                        {product.attributes?.length > 0 && (
                            <div className="space-y-3 border-t border-stone-100 pt-4">
                                {product.attributes.map(attr => (
                                    <div key={attr.id} className="flex items-center gap-3">
                                        <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest w-24 shrink-0">{attr.name}:</span>
                                        <span className="text-sm font-bold text-stone-800">{attr.value}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Textarea Specifications Fallback */}
                        {product.specifications && (
                            <div className="space-y-3 border-t border-stone-100 pt-4">
                                {product.specifications.split('\n').filter(l => l.trim().length > 0).map((line, idx) => {
                                    const colonIndex = line.indexOf(':');
                                    let key = 'Thông số';
                                    let val = line;
                                    if (colonIndex !== -1) {
                                        key = line.substring(0, colonIndex).trim();
                                        val = line.substring(colonIndex + 1).trim();
                                        if (key === '-' || key === '*') key = 'Thông số';
                                    }
                                    return (
                                        <div key={idx} className="flex items-center gap-3">
                                            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest w-24 shrink-0">{key}:</span>
                                            <span className="text-sm font-bold text-stone-800 whitespace-pre-wrap">{val}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Super Attributes (Variants) */}
                        {product.super_attributes?.length > 0 && (
                            <div className="space-y-3 border-t border-stone-100 pt-4">
                                {product.super_attributes.map(sa => (
                                    <div key={sa.id}>
                                        <p className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-2">{sa.name}</p>
                                        <div className="flex flex-wrap gap-2">
                                            {sa.options?.map(opt => (
                                                <button key={opt.id} className="px-3 py-1.5 border border-stone-200 rounded-lg text-xs font-bold text-stone-700 hover:border-primary hover:text-primary transition-colors">
                                                    {opt.value}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Quantity + Actions */}
                        <div className="border-t border-stone-100 pt-5 space-y-3">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">Số lượng:</span>
                                <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden">
                                    <button onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                            className="w-9 h-9 flex items-center justify-center text-stone-600 hover:bg-stone-50 transition-colors">
                                        <span className="material-symbols-outlined text-sm">remove</span>
                                    </button>
                                    <span className="w-10 h-9 flex items-center justify-center text-sm font-bold text-stone-800 border-x border-stone-200">{quantity}</span>
                                    <button onClick={() => setQuantity(quantity + 1)}
                                            className="w-9 h-9 flex items-center justify-center text-stone-600 hover:bg-stone-50 transition-colors">
                                        <span className="material-symbols-outlined text-sm">add</span>
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <Link to={`/dat-hang?product=${product.id}&qty=${quantity}`}
                                      onClick={() => trackAddToCart(product, quantity)}
                                      className="flex-1 py-3.5 bg-primary text-white rounded-xl text-sm font-black uppercase tracking-widest text-center shadow-lg hover:brightness-90 active:scale-[0.98] transition-all">
                                    ĐẶT HÀNG NGAY
                                </Link>
                                <button onClick={() => setShowLeadForm(true)}
                                        className="py-3.5 px-5 border-2 border-primary text-primary rounded-xl text-sm font-black uppercase tracking-widest hover:bg-primary/5 transition-all">
                                    TƯ VẤN
                                </button>
                            </div>
                            <a href="tel:0123456789" className="flex items-center justify-center gap-2 py-2.5 text-red-600 font-bold text-sm hover:bg-red-50 rounded-xl transition-colors">
                                <span className="material-symbols-outlined text-lg">call</span>
                                Gọi ngay: 0123 456 789
                            </a>
                        </div>

                        {/* Policies */}
                        <div className="grid grid-cols-2 gap-3 border-t border-stone-100 pt-5">
                            {[
                                { icon: 'local_shipping', text: 'Giao hàng toàn quốc' },
                                { icon: 'verified', text: 'Cam kết chất lượng' },
                                { icon: 'autorenew', text: 'Đổi trả 7 ngày' },
                                { icon: 'support_agent', text: 'Hỗ trợ 24/7' },
                            ].map((p, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-stone-600">
                                    <span className="material-symbols-outlined text-primary text-base">{p.icon}</span>
                                    <span className="font-medium">{p.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Tabs: Description / Reviews */}
                <div className="mt-10 md:mt-16 border-t border-stone-100">
                    <div className="flex gap-6 border-b border-stone-100">
                        {[
                            { key: 'description', label: 'Mô tả sản phẩm' },
                            { key: 'reviews', label: `Đánh giá (${product.review_count || 0})` },
                        ].map(t => (
                            <button key={t.key} onClick={() => setActiveTab(t.key)}
                                    className={`py-4 text-sm font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div className="py-6">
                        {activeTab === 'description' ? (
                            <div className="prose prose-sm max-w-none text-stone-700 leading-relaxed"
                                 dangerouslySetInnerHTML={{ __html: product.description || '<p class="text-stone-400 italic">Chưa có mô tả sản phẩm</p>' }} />
                        ) : (
                            <div className="space-y-4">
                                {product.reviews?.length > 0 ? product.reviews.map(r => (
                                    <div key={r.id} className="bg-stone-50 rounded-xl p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <span className="text-sm font-bold text-stone-800">{r.customer_name}</span>
                                                <span className="text-xs text-stone-400 ml-2">{r.created_at}</span>
                                            </div>
                                            <Stars rating={r.rating} size="text-xs" />
                                        </div>
                                        <p className="text-sm text-stone-600">{r.comment}</p>
                                    </div>
                                )) : (
                                    <p className="text-sm text-stone-400 italic text-center py-8">Chưa có đánh giá nào</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Related Products */}
                {related.length > 0 && (
                    <div className="mt-10 border-t border-stone-100 pt-8">
                        <h2 className="text-lg font-black text-stone-900 uppercase tracking-tight mb-6">Sản phẩm liên quan</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                            {related.map(p => (
                                <Link key={p.id} to={`/san-pham/${p.slug || p.id}`}
                                      className="group bg-white rounded-2xl border border-stone-100 overflow-hidden hover:shadow-lg transition-all">
                                    <div className="aspect-square bg-stone-100 overflow-hidden">
                                        <img src={p.main_image || 'https://placehold.co/400'} alt={p.name} loading="lazy"
                                             className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                    </div>
                                    <div className="p-3">
                                        <h3 className="text-xs font-bold text-stone-800 line-clamp-2">{p.name}</h3>
                                        <p className="text-sm font-black text-red-600 mt-1">{Number(p.current_price).toLocaleString()}đ</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <LeadFormModal show={showLeadForm} onClose={() => setShowLeadForm(false)} product={product} />
        </div>
    );
};

export default StorefrontProductDetail;
