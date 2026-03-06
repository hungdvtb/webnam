import React, { useState, useEffect } from 'react';
import { productApi, categoryApi } from '../services/api';
import ProductCard from '../components/ProductCard';

const Shop = () => {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [priceRange, setPriceRange] = useState('');
    const [pagination, setPagination] = useState({ current_page: 1, last_page: 1 });

    useEffect(() => {
        fetchCategories();
        fetchProducts();
    }, [selectedCategory, searchQuery, priceRange, pagination.current_page]);

    const fetchCategories = async () => {
        try {
            const response = await categoryApi.getAll();
            setCategories(response.data);
        } catch (error) {
            console.error("Error fetching categories", error);
        }
    };

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const params = {
                page: pagination.current_page,
                category_id: selectedCategory,
                search: searchQuery,
            };

            // Handle price range mapping if needed
            if (priceRange) {
                const [min, max] = priceRange.split('-');
                if (min) params.min_price = min;
                if (max) params.max_price = max;
            }

            const response = await productApi.getAll(params);
            setProducts(response.data.data);
            setPagination({
                current_page: response.data.current_page,
                last_page: response.data.last_page
            });
        } catch (error) {
            console.error("Error fetching products", error);
        } finally {
            setLoading(false);
        }
    };

    const handleCategoryClick = (id) => {
        setSelectedCategory(id === selectedCategory ? null : id);
        setPagination({ ...pagination, current_page: 1 });
    };

    return (
        <main className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 py-12 grid grid-cols-12 gap-12 bg-background-light">
            {/* Sidebar */}
            <aside className="col-span-12 lg:col-span-3 hidden lg:block">
                <div className="sticky top-24 space-y-12">
                    {/* Search */}
                    <div className="relative">
                        <input
                            className="w-full bg-transparent border-b border-gold py-2 pr-8 text-umber placeholder-stone/50 focus:outline-none focus:border-primary font-ui text-sm transition-colors"
                            placeholder="Tìm kiếm phẩm vật..."
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <span className="material-symbols-outlined absolute right-0 top-2 text-gold">search</span>
                    </div>

                    {/* Categories Filter */}
                    <div>
                        <h3 className="font-display text-xl font-bold text-primary mb-6 border-l-4 border-gold pl-3 uppercase tracking-wider">Loại Men</h3>
                        <ul className="space-y-4">
                            <li
                                className={`flex items-center gap-3 group cursor-pointer ${selectedCategory === null ? 'text-primary font-bold' : 'text-umber hover:text-primary transition-colors'}`}
                                onClick={() => handleCategoryClick(null)}
                            >
                                <div className={`size-4 border border-gold rotate-45 flex items-center justify-center ${selectedCategory === null ? 'bg-gold/20' : ''}`}>
                                    {selectedCategory === null && <div className="size-2 bg-primary rotate-45"></div>}
                                </div>
                                <span className="font-ui font-medium">Tất Cả</span>
                            </li>
                            {categories.map(cat => (
                                <li
                                    key={cat.id}
                                    className={`flex items-center gap-3 group cursor-pointer ${selectedCategory === cat.id ? 'text-primary font-bold' : 'text-umber hover:text-primary transition-colors'}`}
                                    onClick={() => handleCategoryClick(cat.id)}
                                >
                                    <div className={`size-4 border border-gold rotate-45 flex items-center justify-center ${selectedCategory === cat.id ? 'bg-gold/20' : ''}`}>
                                        {selectedCategory === cat.id && <div className="size-2 bg-primary rotate-45"></div>}
                                    </div>
                                    <span className="font-ui font-medium">{cat.name}</span>
                                    <span className="ml-auto text-stone text-xs italic">({cat.products_count})</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Price Filter */}
                    <div>
                        <h3 className="font-display text-xl font-bold text-primary mb-6 border-l-4 border-gold pl-3 uppercase tracking-wider">Mức Giá</h3>
                        <ul className="space-y-4">
                            {[
                                { label: 'Dưới 1 triệu', value: '0-1000000' },
                                { label: '1 triệu - 5 triệu', value: '1000000-5000000' },
                                { label: '5 triệu - 20 triệu', value: '5000000-20000000' },
                                { label: 'Trên 20 triệu', value: '20000000-999999999' }
                            ].map(range => (
                                <li
                                    key={range.value}
                                    className={`flex items-center gap-3 group cursor-pointer ${priceRange === range.value ? 'text-primary font-bold' : 'text-umber hover:text-primary transition-colors'}`}
                                    onClick={() => setPriceRange(priceRange === range.value ? '' : range.value)}
                                >
                                    <div className={`size-4 border border-gold rotate-45 flex items-center justify-center ${priceRange === range.value ? 'bg-gold/20' : ''}`}>
                                        {priceRange === range.value && <div className="size-2 bg-primary rotate-45"></div>}
                                    </div>
                                    <span className="font-ui font-medium">{range.label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </aside>

            {/* Product Grid Area */}
            <section className="col-span-12 lg:col-span-9 flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center mb-10 pb-4 border-b border-gold/20">
                    <h1 className="font-display text-4xl text-primary font-bold">
                        {selectedCategory ? categories.find(c => c.id === selectedCategory)?.name : 'Tất Cả Sản Phẩm'}
                    </h1>
                    <div className="flex items-center gap-2 mt-4 sm:mt-0">
                        <span className="text-stone font-ui text-sm italic">Hiển thị {products.length} sản phẩm</span>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
                    </div>
                ) : products.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-16">
                        {products.map(product => (
                            <ProductCard key={product.id} product={{
                                ...product,
                                image: product.images?.[0]?.image_url || 'https://via.placeholder.com/400'
                            }} />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-40 space-y-4">
                        <span className="material-symbols-outlined text-6xl text-gold/30">filter_list_off</span>
                        <h3 className="font-display text-2xl text-primary">Không tìm thấy sản phẩm nào</h3>
                        <p className="font-body text-stone italic">Vui lòng thử lại với các tiêu chí lọc khác.</p>
                        <button
                            className="bg-primary text-white font-ui font-bold uppercase tracking-widest text-xs px-8 py-3 mt-4"
                            onClick={() => { setSelectedCategory(null); setSearchQuery(''); setPriceRange(''); }}
                        >
                            Xóa tất cả bộ lọc
                        </button>
                    </div>
                )}

                {/* Pagination */}
                {!loading && pagination.last_page > 1 && (
                    <div className="mt-20 flex justify-center items-center gap-8 border-t border-gold/20 pt-8">
                        <button
                            disabled={pagination.current_page === 1}
                            className="flex items-center gap-2 text-stone hover:text-primary transition-colors disabled:opacity-30 uppercase font-ui font-bold text-xs tracking-widest cursor-pointer"
                            onClick={() => setPagination({ ...pagination, current_page: pagination.current_page - 1 })}
                        >
                            <span className="material-symbols-outlined text-sm">west</span> Trước
                        </button>
                        <div className="flex items-center gap-4">
                            {[...Array(pagination.last_page)].map((_, i) => (
                                <button
                                    key={i + 1}
                                    className={`w-10 h-10 flex items-center justify-center font-display text-xl transition-all ${pagination.current_page === i + 1 ? 'text-primary font-bold border-b-2 border-primary' : 'text-stone hover:text-primary'}`}
                                    onClick={() => setPagination({ ...pagination, current_page: i + 1 })}
                                >
                                    {i + 1}
                                </button>
                            ))}
                        </div>
                        <button
                            disabled={pagination.current_page === pagination.last_page}
                            className="flex items-center gap-2 text-primary hover:text-brick transition-colors disabled:opacity-30 uppercase font-ui font-bold text-xs tracking-widest cursor-pointer"
                            onClick={() => setPagination({ ...pagination, current_page: pagination.current_page + 1 })}
                        >
                            Sau <span className="material-symbols-outlined text-sm">east</span>
                        </button>
                    </div>
                )}
            </section>
        </main>
    );
};

export default Shop;
