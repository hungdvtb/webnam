import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams, useParams, useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';

/* ── Product Card (Shared) ── */
const ProductCard = ({ product, onConsult }) => {
    const [imgLoaded, setImgLoaded] = useState(false);
    const hasDiscount = product.special_price && product.current_price < product.price;

    return (
        <div className="group bg-white rounded-2xl border border-stone-100 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
            <Link to={`/san-pham/${product.slug || product.id}`} className="block relative aspect-square overflow-hidden bg-stone-100">
                {!imgLoaded && <div className="absolute inset-0 animate-pulse bg-stone-200" />}
                <img src={product.main_image || 'https://placehold.co/400'} alt={product.name} loading="lazy"
                     onLoad={() => setImgLoaded(true)}
                     className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`} />
                {hasDiscount && <div className="absolute top-2 left-2 px-2 py-0.5 bg-red-600 text-white text-[9px] font-black rounded-md">-{Math.round((1 - product.current_price / product.price) * 100)}%</div>}
                {product.is_new && <div className="absolute top-2 right-2 px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black rounded-md">Mới</div>}
            </Link>
            <div className="p-3 md:p-4">
                <Link to={`/san-pham/${product.slug || product.id}`}>
                    <h3 className="text-xs md:text-sm font-bold text-stone-800 line-clamp-2 leading-snug hover:text-primary transition-colors">{product.name}</h3>
                </Link>
                {product.category && <p className="text-[9px] font-bold text-stone-400 uppercase tracking-wider mt-1">{product.category.name}</p>}
                <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-sm md:text-base font-black text-red-600">{Number(product.current_price).toLocaleString()}đ</span>
                    {hasDiscount && <span className="text-[10px] text-stone-400 line-through">{Number(product.price).toLocaleString()}đ</span>}
                </div>
                <div className="flex gap-2 mt-3">
                    <Link to={`/san-pham/${product.slug || product.id}`}
                          className="flex-1 py-2 bg-primary text-white rounded-lg text-[10px] md:text-xs font-bold text-center hover:brightness-90 transition-all">
                        Xem chi tiết
                    </Link>
                    <button onClick={(e) => { e.preventDefault(); onConsult?.(product); }}
                            className="py-2 px-2.5 border border-stone-200 rounded-lg text-[10px] md:text-xs font-bold text-stone-600 hover:bg-stone-50 transition-all">
                        <span className="material-symbols-outlined text-sm">chat</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const SORT_OPTIONS = [
    { value: 'newest', label: 'Mới nhất' },
    { value: 'price_asc', label: 'Giá tăng dần' },
    { value: 'price_desc', label: 'Giá giảm dần' },
    { value: 'name_asc', label: 'Tên A-Z' },
    { value: 'popular', label: 'Nổi bật' },
];

const StorefrontProducts = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { slug: categorySlug } = useParams();
    const { categories } = useOutletContext();

    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({});
    const [consultProduct, setConsultProduct] = useState(null);
    const [showFilter, setShowFilter] = useState(false);

    const sort = searchParams.get('sort') || 'newest';
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const featured = searchParams.get('featured');

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        try {
            const params = { sort, page, per_page: 20 };
            if (categorySlug) params.category = categorySlug;
            if (search) params.search = search;
            if (featured) params.featured = 1;

            const res = await api.get('/storefront/products', { params });
            setProducts(res.data.data || []);
            setPagination({
                current: res.data.current_page,
                last: res.data.last_page,
                total: res.data.total,
            });
        } catch (e) {
            console.error('Failed to load products', e);
        }
        setLoading(false);
    }, [sort, page, categorySlug, search, featured]);

    useEffect(() => { fetchProducts(); window.scrollTo({ top: 0, behavior: 'smooth' }); }, [fetchProducts]);

    const updateParam = (key, value) => {
        const p = new URLSearchParams(searchParams);
        if (value) p.set(key, value); else p.delete(key);
        if (key !== 'page') p.delete('page');
        setSearchParams(p);
    };

    const currentCategory = categories?.find(c => c.slug === categorySlug);

    return (
        <div className="animate-fade-in">
            {/* Breadcrumb */}
            <div className="bg-stone-50 border-b border-stone-100">
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center gap-2 text-xs text-stone-500 font-medium">
                        <Link to="/" className="hover:text-primary">Trang chủ</Link>
                        <span>/</span>
                        {categorySlug ? (
                            <>
                                <Link to="/san-pham" className="hover:text-primary">Sản phẩm</Link>
                                <span>/</span>
                                <span className="text-stone-800 font-bold">{currentCategory?.name || categorySlug}</span>
                            </>
                        ) : (
                            <span className="text-stone-800 font-bold">{search ? `Tìm: "${search}"` : 'Tất cả sản phẩm'}</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-xl md:text-2xl font-black text-stone-900 uppercase tracking-tight">
                            {currentCategory?.name || (search ? `Kết quả: "${search}"` : 'Tất cả sản phẩm')}
                        </h1>
                        <p className="text-xs text-stone-500 font-medium mt-1">{pagination.total || 0} sản phẩm</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Mobile filter toggle */}
                        <button onClick={() => setShowFilter(!showFilter)} className="md:hidden flex items-center gap-1.5 px-3 py-2 border border-stone-200 rounded-xl text-xs font-bold text-stone-700">
                            <span className="material-symbols-outlined text-sm">tune</span>
                            Lọc
                        </button>
                        {/* Sort */}
                        <select value={sort} onChange={e => updateParam('sort', e.target.value)}
                                className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs font-bold text-stone-700 outline-none">
                            {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex gap-6">
                    {/* Sidebar Categories (Desktop) */}
                    <aside className={`${showFilter ? 'block' : 'hidden'} md:block w-full md:w-56 shrink-0 ${showFilter ? 'mb-6 md:mb-0' : ''}`}>
                        <div className="bg-white border border-stone-100 rounded-2xl p-4">
                            <h3 className="text-[10px] font-black text-stone-800 uppercase tracking-widest mb-3">DANH MỤC</h3>
                            <div className="space-y-1">
                                <Link to="/san-pham"
                                      className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${!categorySlug ? 'bg-primary/5 text-primary font-bold' : 'text-stone-600 hover:bg-stone-50'}`}>
                                    Tất cả
                                </Link>
                                {categories?.map(cat => (
                                    <Link key={cat.id} to={`/danh-muc/${cat.slug}`}
                                          className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${categorySlug === cat.slug ? 'bg-primary/5 text-primary font-bold' : 'text-stone-600 hover:bg-stone-50'}`}>
                                        {cat.name}
                                        {cat.products_count > 0 && <span className="text-[10px] text-stone-400 ml-1">({cat.products_count})</span>}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </aside>

                    {/* Product Grid */}
                    <div className="flex-1 min-w-0">
                        {loading ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                                {Array(8).fill(0).map((_, i) => (
                                    <div key={i} className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
                                        <div className="aspect-square bg-stone-200 animate-pulse" />
                                        <div className="p-4 space-y-2">
                                            <div className="h-3 bg-stone-200 rounded animate-pulse w-3/4" />
                                            <div className="h-4 bg-stone-200 rounded animate-pulse w-1/2" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : products.length === 0 ? (
                            <div className="text-center py-20 opacity-40">
                                <span className="material-symbols-outlined text-6xl text-stone-300 mb-3 block">inventory_2</span>
                                <p className="font-bold text-lg text-stone-700">Không tìm thấy sản phẩm</p>
                                <p className="text-sm text-stone-500 mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
                                    {products.map(p => <ProductCard key={p.id} product={p} onConsult={setConsultProduct} />)}
                                </div>

                                {/* Pagination */}
                                {pagination.last > 1 && (
                                    <div className="flex items-center justify-center gap-2 mt-8">
                                        {page > 1 && (
                                            <button onClick={() => updateParam('page', page - 1)} className="px-3 py-2 border border-stone-200 rounded-lg text-sm font-bold text-stone-600 hover:bg-stone-50">
                                                <span className="material-symbols-outlined text-sm">chevron_left</span>
                                            </button>
                                        )}
                                        {Array.from({ length: Math.min(pagination.last, 7) }, (_, i) => {
                                            let p;
                                            if (pagination.last <= 7) p = i + 1;
                                            else if (page <= 4) p = i + 1;
                                            else if (page >= pagination.last - 3) p = pagination.last - 6 + i;
                                            else p = page - 3 + i;
                                            return (
                                                <button key={p} onClick={() => updateParam('page', p)}
                                                        className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-bold transition-colors ${p === page ? 'bg-primary text-white' : 'border border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                                                    {p}
                                                </button>
                                            );
                                        })}
                                        {page < pagination.last && (
                                            <button onClick={() => updateParam('page', page + 1)} className="px-3 py-2 border border-stone-200 rounded-lg text-sm font-bold text-stone-600 hover:bg-stone-50">
                                                <span className="material-symbols-outlined text-sm">chevron_right</span>
                                            </button>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            <LeadFormModal show={!!consultProduct} onClose={() => setConsultProduct(null)} product={consultProduct} />
        </div>
    );
};

export default StorefrontProducts;
