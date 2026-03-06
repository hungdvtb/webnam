import React, { useState, useEffect } from 'react';
import Hero from '../components/Hero';
import ProductCard from '../components/ProductCard';
import { productApi } from '../services/api';

const Home = () => {
    const [newProducts, setNewProducts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await productApi.getAll({ featured: 1, per_page: 6 });
                setNewProducts(response.data.data);
            } catch (error) {
                console.error("Error fetching products", error);
            } finally {
                setLoading(false);
            }
        };
        fetchProducts();
    }, []);

    return (
        <div className="flex flex-col">
            <Hero />

            {/* New Arrivals Section */}
            <section className="py-24 px-6 lg:px-12 bg-background-light">
                <div className="container mx-auto">
                    <div className="text-center mb-16">
                        <div className="flex items-center justify-center gap-4">
                            <span className="material-symbols-outlined text-gold">cloud</span>
                            <h2 className="text-primary font-display text-4xl md:text-5xl font-bold tracking-tight px-4">Tuyệt Tác Mới</h2>
                            <span className="material-symbols-outlined text-gold">cloud</span>
                        </div>
                        <p className="font-body text-lg text-stone italic mt-4">Những tác phẩm vừa rời lò nung với men màu độc bản</p>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-20">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 lg:gap-16">
                            {newProducts.map(product => (
                                <ProductCard key={product.id} product={{
                                    ...product,
                                    image: product.images?.[0]?.image_url || 'https://via.placeholder.com/400'
                                }} />
                            ))}
                        </div>
                    )}

                    <div className="flex justify-center mt-16">
                        <a className="inline-flex items-center gap-2 text-primary font-ui font-semibold uppercase tracking-widest text-sm hover:text-umber transition-colors border-b border-primary pb-1 hover:border-umber" href="/shop">
                            Xem Tất Cả
                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                        </a>
                    </div>
                </div>
            </section>

            {/* Story Section */}
            <section className="py-24 bg-white px-6 lg:px-12 border-y border-gold/10">
                <div className="container mx-auto grid grid-cols-1 md:grid-cols-2 items-center gap-16">
                    <div className="relative group">
                        <div className="absolute inset-0 border-2 border-gold -translate-x-4 translate-y-4 -z-10 group-hover:translate-x-0 group-hover:translate-y-0 transition-transform"></div>
                        <img
                            src="https://images.unsplash.com/photo-1595180630321-df62a690e515?auto=format&fit=crop&q=80&w=800"
                            alt="Brand Story"
                            className="w-full h-[500px] object-cover rounded-sm"
                        />
                    </div>
                    <div className="space-y-6">
                        <span className="font-ui text-sm font-bold uppercase tracking-[0.2em] text-gold">Cốt Cách & Tâm Hồn</span>
                        <h2 className="text-primary font-display text-4xl lg:text-5xl font-bold leading-tight">Di Sản Ngàn Năm Trong Tầm Tay</h2>
                        <p className="font-body text-xl text-stone italic leading-relaxed">
                            "Mỗi tác phẩm gốm là một bản tình ca của đất, nước và lửa. Chúng tôi không chỉ bán gốm, chúng tôi trao gửi một phần tâm hồn Việt."
                        </p>
                        <p className="font-body text-lg text-umber/80 leading-relaxed">
                            Từ những làng nghề truyền thống Bát Tràng, Chu Đậu, mỗi sản phẩm tại Di Sản Gốm Việt đều được chế tác thủ công bởi những nghệ nhân bậc thầy, lưu giữ những kỹ thuật phục dựng men cổ quý hiếm.
                        </p>
                        <div className="pt-4">
                            <a className="bg-primary text-white font-ui font-bold uppercase tracking-widest text-xs px-8 py-4 hover:bg-umber transition-all" href="/about">Tìm hiểu thêm</a>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Home;
