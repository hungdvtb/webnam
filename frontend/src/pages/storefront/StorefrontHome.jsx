import React, { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { LeadFormModal } from '../../layouts/StorefrontLayout';
import StoreLocationCards from '../../components/store/StoreLocationCards';

const ProductCard = ({ product, onConsult }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const hasDiscount = product.special_price && product.current_price < product.price;

    return (
        <div className="group overflow-hidden rounded-2xl border border-stone-100 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
            <Link to={`/san-pham/${product.slug || product.id}`} className="relative block aspect-square overflow-hidden bg-stone-100">
                {!imageLoaded ? <div className="absolute inset-0 animate-pulse bg-stone-200" /> : null}
                <img
                    src={product.main_image || 'https://placehold.co/400x400?text=No+Image'}
                    alt={product.name}
                    loading="lazy"
                    onLoad={() => setImageLoaded(true)}
                    className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                />

                {hasDiscount ? (
                    <div className="absolute left-3 top-3 rounded-lg bg-red-600 px-2.5 py-1 text-[10px] font-black uppercase text-white shadow-lg">
                        -{Math.round((1 - product.current_price / product.price) * 100)}%
                    </div>
                ) : null}

                {product.is_new ? (
                    <div className="absolute right-3 top-3 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase text-white shadow-lg">
                        Mới
                    </div>
                ) : null}
            </Link>

            <div className="p-4">
                <Link to={`/san-pham/${product.slug || product.id}`}>
                    <h3 className="line-clamp-2 text-sm font-bold leading-snug text-stone-800 transition-colors hover:text-primary">
                        {product.name}
                    </h3>
                </Link>

                {product.category ? (
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                        {product.category.name}
                    </p>
                ) : null}

                <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-base font-black text-red-600">
                        {Number(product.current_price).toLocaleString()}đ
                    </span>
                    {hasDiscount ? (
                        <span className="text-xs text-stone-400 line-through">
                            {Number(product.price).toLocaleString()}đ
                        </span>
                    ) : null}
                </div>

                <div className="mt-3 flex gap-2">
                    <Link
                        to={`/san-pham/${product.slug || product.id}`}
                        className="flex-1 rounded-xl bg-primary py-2 text-center text-xs font-bold text-white transition-all hover:brightness-90 active:scale-95"
                    >
                        Chi tiết
                    </Link>
                    <button
                        type="button"
                        onClick={(event) => {
                            event.preventDefault();
                            onConsult?.(product);
                        }}
                        className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-600 transition-all hover:bg-stone-50 active:scale-95"
                    >
                        Tư vấn
                    </button>
                </div>
            </div>
        </div>
    );
};

const BannerSlider = ({ banners }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const timerRef = useRef(null);

    useEffect(() => {
        if (banners.length <= 1) {
            return undefined;
        }

        timerRef.current = setInterval(() => {
            setCurrentIndex((current) => (current + 1) % banners.length);
        }, 5000);

        return () => clearInterval(timerRef.current);
    }, [banners.length]);

    if (!banners.length) {
        return (
            <div className="relative bg-gradient-to-br from-primary via-primary/90 to-stone-800 text-white">
                <div className="mx-auto max-w-7xl px-4 py-16 text-center md:py-24">
                    <h2 className="mb-4 text-3xl font-black uppercase tracking-tight md:text-5xl">
                        Gốm Sứ Bát Tràng
                    </h2>
                    <p className="mx-auto mb-8 max-w-xl text-base text-white/80 md:text-lg">
                        Nơi tôn vinh vẻ đẹp truyền thống qua từng sản phẩm thủ công tinh xảo.
                    </p>
                    <Link to="/san-pham" className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-black uppercase tracking-widest text-primary shadow-xl transition-all hover:bg-stone-50">
                        Xem sản phẩm
                        <span className="material-symbols-outlined text-lg">arrow_forward</span>
                    </Link>
                </div>
            </div>
        );
    }

    const banner = banners[currentIndex];

    return (
        <div className="relative h-[50vh] overflow-hidden bg-stone-100 md:h-[65vh]">
            {banners.map((item, index) => (
                <div
                    key={item.id || index}
                    className={`absolute inset-0 transition-opacity duration-700 ${index === currentIndex ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                >
                    <img
                        src={item.image_url || 'https://placehold.co/1200x600'}
                        alt={item.title}
                        className="h-full w-full object-cover"
                        loading={index === 0 ? 'eager' : 'lazy'}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </div>
            ))}

            <div className="absolute inset-0 flex items-end justify-start px-4 pb-12 md:pb-16">
                <div className="mx-auto w-full max-w-7xl">
                    <div className="max-w-lg text-white">
                        {banner?.title ? (
                            <h2 className="mb-2 text-2xl font-black uppercase tracking-tight drop-shadow-lg md:text-4xl">
                                {banner.title}
                            </h2>
                        ) : null}
                        {banner?.subtitle ? (
                            <p className="mb-5 text-sm text-white/90 drop-shadow md:text-base">
                                {banner.subtitle}
                            </p>
                        ) : null}
                        {banner?.button_text ? (
                            <Link
                                to={banner.link_url || '/san-pham'}
                                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-black uppercase tracking-wider text-stone-900 shadow-xl transition-all hover:bg-stone-50"
                            >
                                {banner.button_text}
                                <span className="material-symbols-outlined text-lg">arrow_forward</span>
                            </Link>
                        ) : null}
                    </div>
                </div>
            </div>

            {banners.length > 1 ? (
                <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
                    {banners.map((_, index) => (
                        <button
                            key={index}
                            type="button"
                            onClick={() => setCurrentIndex(index)}
                            className={`h-2 rounded-full transition-all ${index === currentIndex ? 'w-6 bg-white' : 'w-2 bg-white/50'}`}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
};

const SectionTitle = ({ title, subtitle, link, linkText }) => (
    <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-stone-900 md:text-2xl">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm font-medium text-stone-500">{subtitle}</p> : null}
        </div>
        {link ? (
            <Link to={link} className="flex items-center gap-1 text-sm font-bold text-primary hover:underline">
                {linkText || 'Xem tất cả'}
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </Link>
        ) : null}
    </div>
);

const CategoryGrid = ({ categories }) => {
    if (!categories?.length) {
        return null;
    }

    const gradients = [
        'from-amber-500/20 to-orange-500/10',
        'from-blue-500/20 to-cyan-500/10',
        'from-green-500/20 to-emerald-500/10',
        'from-red-500/20 to-rose-500/10',
        'from-teal-500/20 to-sky-500/10',
        'from-stone-500/20 to-stone-400/10',
    ];
    const icons = ['🏺', '🍵', '🎋', '🌸', '🎭', '🪷', '📿', '🎁'];

    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
            {categories.slice(0, 6).map((category, index) => (
                <Link
                    key={category.id}
                    to={`/danh-muc/${category.slug}`}
                    className={`group rounded-2xl border border-stone-100 bg-gradient-to-br ${gradients[index % gradients.length]} p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg`}
                >
                    <div className="mb-2 text-3xl">{icons[index % icons.length]}</div>
                    <h3 className="text-sm font-bold text-stone-800 transition-colors group-hover:text-primary">
                        {category.name}
                    </h3>
                    <p className="mt-1 text-[10px] font-medium text-stone-500">
                        {category.products_count || 0} sản phẩm
                    </p>
                </Link>
            ))}
        </div>
    );
};

const ReviewCard = ({ review }) => (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 transition-all hover:shadow-md">
        <div className="mb-3 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
                <span key={star} className={`material-symbols-outlined text-sm ${star <= review.rating ? 'text-amber-500' : 'text-stone-200'}`}>
                    star
                </span>
            ))}
        </div>
        <p className="mb-3 line-clamp-3 text-sm italic leading-relaxed text-stone-600">
            "{review.comment}"
        </p>
        <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-stone-800">{review.customer_name}</span>
            {review.product ? (
                <Link to={`/san-pham/${review.product.slug}`} className="max-w-[120px] truncate text-[10px] font-medium text-primary hover:underline">
                    {review.product.name}
                </Link>
            ) : null}
        </div>
    </div>
);

const StorefrontHome = () => {
    const { categories: navCategories, siteInfo, storeLocations = [] } = useOutletContext();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [consultProduct, setConsultProduct] = useState(null);

    const activeStores = storeLocations.filter((store) => store.isActive !== false);
    const phoneLabel = siteInfo?.phone || activeStores[0]?.hotline || '0123 456 789';
    const phoneHref = `tel:${phoneLabel.replace(/[^\d+]/g, '') || '0123456789'}`;

    useEffect(() => {
        const load = async () => {
            try {
                const response = await api.get('/storefront/homepage');
                setData(response.data);
            } catch (error) {
                console.error('Failed to load homepage', error);
            }

            setLoading(false);
        };

        load();
    }, []);

    if (loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            <BannerSlider banners={data?.banners || []} />

            <section className="mx-auto max-w-7xl px-4 py-10 md:py-14">
                <SectionTitle
                    title="Danh mục sản phẩm"
                    subtitle="Khám phá đa dạng bộ sưu tập gốm sứ."
                    link="/san-pham"
                />
                <CategoryGrid categories={data?.categories || navCategories} />
            </section>

            {data?.featured_products?.length > 0 ? (
                <section className="bg-stone-50/50 py-10 md:py-14">
                    <div className="mx-auto max-w-7xl px-4">
                        <SectionTitle
                            title="Sản phẩm nổi bật"
                            subtitle="Những tác phẩm được yêu thích nhất."
                            link="/san-pham?featured=1"
                        />
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
                            {data.featured_products.slice(0, 8).map((product) => (
                                <ProductCard key={product.id} product={product} onConsult={setConsultProduct} />
                            ))}
                        </div>
                    </div>
                </section>
            ) : null}

            {data?.new_arrivals?.length > 0 ? (
                <section className="mx-auto max-w-7xl px-4 py-10 md:py-14">
                    <SectionTitle
                        title="Sản phẩm mới"
                        subtitle="Vừa ra lò, độc bản và giàu chất liệu thủ công."
                        link="/san-pham?sort=newest"
                    />
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
                        {data.new_arrivals.slice(0, 8).map((product) => (
                            <ProductCard key={product.id} product={product} onConsult={setConsultProduct} />
                        ))}
                    </div>
                </section>
            ) : null}

            <section className="bg-[linear-gradient(180deg,rgba(249,245,240,0.92)_0%,rgba(255,255,255,1)_100%)] py-10 md:py-14">
                <div className="mx-auto max-w-4xl px-4">
                    <SectionTitle
                        title="Cửa hàng & showroom"
                        subtitle="Danh sách theo kiểu mobile-first: hiển thị dọc, nút lớn và phần bản đồ chỉ bung khi bạn cần."
                        link="/stores"
                        linkText="Xem toàn bộ"
                    />

                    <StoreLocationCards stores={activeStores} mode="home" limit={3} sitePhone={siteInfo?.phone || ''} />

                    {activeStores.length > 3 ? (
                        <div className="mt-5">
                            <Link
                                to="/stores"
                                className="inline-flex min-h-[54px] w-full items-center justify-center rounded-[22px] border border-primary/15 bg-white px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-primary transition hover:border-primary/30 hover:bg-primary/[0.03]"
                            >
                                Xem thêm cửa hàng
                            </Link>
                        </div>
                    ) : null}
                </div>
            </section>

            <section className="bg-primary text-white">
                <div className="mx-auto max-w-4xl px-4 py-12 text-center md:py-16">
                    <h2 className="mb-3 text-2xl font-black uppercase tracking-tight md:text-3xl">Bạn cần tư vấn?</h2>
                    <p className="mx-auto mb-8 max-w-md text-base text-white/80">
                        Hãy để chúng tôi giúp bạn chọn sản phẩm phù hợp nhất. Tư vấn miễn phí, không ràng buộc.
                    </p>
                    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <a href={phoneHref} className="flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-black uppercase tracking-widest text-primary shadow-xl transition-all hover:bg-stone-50">
                            <span className="material-symbols-outlined">call</span>
                            Gọi ngay: {phoneLabel}
                        </a>
                        <button
                            type="button"
                            onClick={() => setConsultProduct({})}
                            className="flex items-center gap-2 rounded-xl border-2 border-white px-8 py-3.5 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-white/10"
                        >
                            <span className="material-symbols-outlined">edit_note</span>
                            Gửi yêu cầu
                        </button>
                    </div>
                </div>
            </section>

            {data?.reviews?.length > 0 ? (
                <section className="mx-auto max-w-7xl px-4 py-10 md:py-14">
                    <SectionTitle
                        title="Khách hàng nói gì"
                        subtitle="Phản hồi từ khách hàng đã mua hàng."
                    />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {data.reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
                    </div>
                </section>
            ) : null}

            <LeadFormModal
                show={!!consultProduct}
                onClose={() => setConsultProduct(null)}
                product={consultProduct?.id ? consultProduct : null}
            />
        </div>
    );
};

export default StorefrontHome;
