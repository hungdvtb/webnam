import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { blogApi } from '../services/api';

const DEFAULT_CATEGORY_LABEL = 'Cẩm nang gốm sứ';

const stripHtml = (value = '') => String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const getExcerpt = (post) => {
    const content = String(post?.excerpt || '').trim() || stripHtml(post?.content || '');

    if (!content) {
        return 'Nội dung đang được cập nhật. Bấm vào để xem chi tiết bài viết.';
    }

    return content.length > 160 ? `${content.slice(0, 157).trim()}...` : content;
};

const formatDate = (value) => {
    if (!value) {
        return 'Đang cập nhật';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return 'Đang cập nhật';
    }

    return date.toLocaleDateString('vi-VN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
};

const resolveCategoryLabel = (post, categoryMap) => (
    post?.category?.name
    || categoryMap.get(Number(post?.blog_category_id))
    || DEFAULT_CATEGORY_LABEL
);

const isSystemPost = (post) => Boolean(post?.is_system);

const BlogImage = ({ src, alt, className, iconClassName = 'text-4xl', eager = false }) => {
    const [hasError, setHasError] = useState(!src);

    useEffect(() => {
        setHasError(!src);
    }, [src]);

    if (!src || hasError) {
        return (
            <div className={`flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(27,54,93,0.96),rgba(197,160,101,0.82))] ${className}`}>
                <div className="flex flex-col items-center gap-3 px-6 text-center text-white/90">
                    <span className={`material-symbols-outlined ${iconClassName}`}>auto_stories</span>
                    <div className="space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-white/80">Blog Gốm Sứ</p>
                        <p className="text-sm font-medium text-white/70">Hình ảnh bài viết đang được cập nhật</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <img
            src={src}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            onError={() => setHasError(true)}
            className={className}
        />
    );
};

const LoadingCard = () => (
    <div className="overflow-hidden rounded-[28px] border border-primary/10 bg-white shadow-[0_18px_45px_-32px_rgba(27,54,93,0.28)]">
        <div className="aspect-[16/11] animate-pulse bg-primary/10" />
        <div className="space-y-4 p-5 sm:p-6">
            <div className="h-3 w-28 animate-pulse rounded-full bg-primary/10" />
            <div className="h-8 w-5/6 animate-pulse rounded-2xl bg-primary/10" />
            <div className="space-y-2">
                <div className="h-3 animate-pulse rounded-full bg-primary/10" />
                <div className="h-3 animate-pulse rounded-full bg-primary/10" />
                <div className="h-3 w-2/3 animate-pulse rounded-full bg-primary/10" />
            </div>
        </div>
    </div>
);

const FeaturedPostCard = ({ post, categoryLabel }) => (
    <Link
        to={`/blog/${post.slug || post.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-[32px] border border-primary/10 bg-white shadow-[0_24px_60px_-32px_rgba(27,54,93,0.35)] transition duration-500 hover:-translate-y-1 hover:border-gold/40 hover:shadow-[0_28px_70px_-30px_rgba(27,54,93,0.42)]"
    >
        <div className="relative aspect-[16/11] overflow-hidden bg-primary/5">
            <BlogImage
                src={post.featured_image || post.image}
                alt={post.title}
                eager
                className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                iconClassName="text-5xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary/55 via-primary/10 to-transparent" />
            <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3">
                <span className="inline-flex min-h-[36px] items-center rounded-full bg-white/92 px-4 text-[10px] font-black uppercase tracking-[0.16em] text-primary shadow-sm">
                    {categoryLabel}
                </span>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/18 text-white backdrop-blur-sm">
                    <span className="material-symbols-outlined text-[18px]">north_east</span>
                </span>
            </div>
        </div>

        <div className="flex flex-1 flex-col p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-[0.16em] text-stone/80">
                <span className="inline-flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-gold">schedule</span>
                    {formatDate(post.published_at || post.created_at)}
                </span>
                <span className="h-1 w-1 rounded-full bg-gold/60" />
                <span>Bài nổi bật</span>
            </div>

            <h2 className="mt-4 text-[1.85rem] font-black leading-tight text-primary transition-colors duration-300 group-hover:text-brick sm:text-[2.15rem]">
                {post.title}
            </h2>

            <p className="mt-4 text-sm leading-7 text-stone/85 sm:text-[15px]">
                {getExcerpt(post)}
            </p>

            <div className="mt-auto pt-6">
                <span className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-primary px-5 text-[11px] font-black uppercase tracking-[0.16em] text-white transition duration-300 group-hover:bg-brick">
                    Đọc bài viết
                    <span className="material-symbols-outlined text-[18px] transition-transform duration-300 group-hover:translate-x-1">
                        arrow_forward
                    </span>
                </span>
            </div>
        </div>
    </Link>
);

const PostCard = ({ post, categoryLabel }) => (
    <Link
        to={`/blog/${post.slug || post.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-[28px] border border-primary/10 bg-white shadow-[0_18px_45px_-32px_rgba(27,54,93,0.28)] transition duration-500 hover:-translate-y-1 hover:border-gold/35 hover:shadow-[0_24px_55px_-28px_rgba(27,54,93,0.34)]"
    >
        <article className="flex h-full flex-col">
            <div className="relative aspect-[16/11] overflow-hidden bg-primary/5">
                <BlogImage
                    src={post.featured_image || post.image}
                    alt={post.title}
                    className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/35 via-transparent to-transparent opacity-80" />
                <span className="absolute left-4 top-4 inline-flex min-h-[34px] items-center rounded-full bg-white/92 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-primary shadow-sm">
                    {categoryLabel}
                </span>
            </div>

            <div className="flex flex-1 flex-col p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-stone/80">
                    <span>{formatDate(post.published_at || post.created_at)}</span>
                    <span className="material-symbols-outlined text-[18px] text-gold/70">menu_book</span>
                </div>

                <h2 className="mt-4 text-[1.35rem] font-black leading-tight text-primary transition-colors duration-300 group-hover:text-brick">
                    {post.title}
                </h2>

                <p className="mt-3 line-clamp-3 text-sm leading-7 text-stone/85">
                    {getExcerpt(post)}
                </p>

                <div className="mt-auto flex items-center justify-between border-t border-gold/10 pt-5">
                    <span className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Xem bài viết</span>
                    <span className="material-symbols-outlined text-[20px] text-primary transition-transform duration-300 group-hover:translate-x-1">
                        arrow_forward
                    </span>
                </div>
            </div>
        </article>
    </Link>
);

const EmptyState = ({ activeCategoryLabel }) => (
    <div className="rounded-[30px] border border-dashed border-gold/30 bg-white/85 px-6 py-14 text-center shadow-[0_18px_45px_-36px_rgba(27,54,93,0.3)] sm:px-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/6 text-primary">
            <span className="material-symbols-outlined text-[30px]">auto_stories</span>
        </div>
        <h3 className="mt-5 text-2xl font-black text-primary">Chưa có bài viết phù hợp</h3>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-stone/80 sm:text-[15px]">
            Chuyên mục {activeCategoryLabel.toLowerCase()} hiện chưa có bài viết nào. Hãy thử chọn nhóm khác hoặc quay lại sau.
        </p>
    </div>
);

const Blog = () => {
    const [posts, setPosts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [activeCategory, setActiveCategory] = useState('all');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPosts = async () => {
            setLoading(true);

            try {
                const response = await blogApi.getAll({ per_page: 200 });
                setPosts(Array.isArray(response.data?.data) ? response.data.data : []);
                setCategories(Array.isArray(response.data?.categories) ? response.data.categories : []);
            } catch (error) {
                console.error('Error fetching blog posts', error);
            } finally {
                setLoading(false);
            }
        };

        fetchPosts();
    }, []);

    const categoryMap = useMemo(
        () => new Map(categories.map((category) => [Number(category.id), category.name])),
        [categories],
    );

    const filteredPosts = useMemo(
        () => posts.filter((post) => !isSystemPost(post)),
        [posts],
    );

    const filteredCategories = useMemo(() => {
        const visibleCategoryIds = new Set(
            filteredPosts
                .map((post) => Number(post.blog_category_id))
                .filter((categoryId) => Number.isInteger(categoryId) && categoryId > 0),
        );

        return categories.filter((category) => visibleCategoryIds.has(Number(category.id)));
    }, [categories, filteredPosts]);

    useEffect(() => {
        if (activeCategory === 'all') {
            return;
        }

        const stillVisible = filteredCategories.some((category) => String(category.id) === String(activeCategory));
        if (!stillVisible) {
            setActiveCategory('all');
        }
    }, [activeCategory, filteredCategories]);

    const activeCategoryLabel = useMemo(() => {
        if (activeCategory === 'all') {
            return 'Tất cả chủ đề';
        }

        return filteredCategories.find((category) => String(category.id) === String(activeCategory))?.name || DEFAULT_CATEGORY_LABEL;
    }, [activeCategory, filteredCategories]);

    const visiblePosts = useMemo(() => {
        if (activeCategory === 'all') {
            return filteredPosts;
        }

        return filteredPosts.filter((post) => Number(post.blog_category_id) === Number(activeCategory));
    }, [activeCategory, filteredPosts]);

    const featuredPost = visiblePosts[0] || null;
    const listPosts = featuredPost ? visiblePosts.slice(1) : visiblePosts;

    return (
        <main className="w-full bg-background-light pb-12 md:pb-16">
            <section className="relative overflow-hidden border-b border-gold/10 bg-white">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(197,160,101,0.18),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(27,54,93,0.1),transparent_34%)]" />

                <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-12">
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,430px)] xl:items-end">
                        <div className="space-y-5">
                            <div className="inline-flex min-h-[34px] items-center rounded-full border border-gold/20 bg-white/90 px-4 text-[10px] font-black uppercase tracking-[0.18em] text-primary shadow-sm">
                                Blog thương hiệu
                            </div>

                            <div className="space-y-4">
                                <h1 className="max-w-3xl text-[2rem] font-black leading-none text-primary sm:text-[2.6rem] lg:text-[3.4rem]">
                                    Kiến thức gốm sứ được trình bày gọn, đẹp và dễ đọc hơn trên mobile.
                                </h1>
                                <p className="max-w-2xl text-sm leading-7 text-stone/85 sm:text-[15px]">
                                    Tổng hợp bài viết về men gốm, quy trình chế tác, văn hóa Bát Tràng và các hướng dẫn hữu ích.
                                    Mỗi thẻ bài được tối ưu để người dùng lướt nhanh bằng một tay, nhìn rõ nội dung chính và chọn bài cần đọc ngay.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                <div className="rounded-[24px] border border-primary/10 bg-white/90 p-4 shadow-sm">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone/70">Bài viết</p>
                                    <p className="mt-2 text-2xl font-black text-primary">{filteredPosts.length}</p>
                                </div>
                                <div className="rounded-[24px] border border-primary/10 bg-white/90 p-4 shadow-sm">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone/70">Chuyên mục</p>
                                    <p className="mt-2 text-2xl font-black text-primary">{filteredCategories.length || 1}</p>
                                </div>
                                <div className="col-span-2 rounded-[24px] border border-primary/10 bg-primary p-4 text-white shadow-sm sm:col-span-1">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/70">Đang xem</p>
                                    <p className="mt-2 text-lg font-black leading-tight">{activeCategoryLabel}</p>
                                </div>
                            </div>
                        </div>

                        {featuredPost ? (
                            <FeaturedPostCard
                                post={featuredPost}
                                categoryLabel={resolveCategoryLabel(featuredPost, categoryMap)}
                            />
                        ) : (
                            <div className="overflow-hidden rounded-[32px] border border-primary/10 bg-white shadow-[0_24px_60px_-32px_rgba(27,54,93,0.35)]">
                                <div className="aspect-[16/11] bg-primary/10">
                                    <BlogImage
                                        src=""
                                        alt="Khối blog"
                                        eager
                                        className="h-full w-full"
                                        iconClassName="text-5xl"
                                    />
                                </div>
                                <div className="space-y-3 p-6">
                                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone/70">Bài viết nổi bật</p>
                                    <h2 className="text-2xl font-black leading-tight text-primary">Khối nội dung đang được cập nhật</h2>
                                    <p className="text-sm leading-7 text-stone/80">
                                        Sau khi có bài viết đầu tiên, khu vực này sẽ hiện bài nổi bật với hình ảnh lớn và trích đoạn ngắn để người dùng mobile xem nhanh.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-12 lg:py-12">
                <div className="flex flex-col gap-4 border-b border-gold/10 pb-5 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">Lọc theo chuyên mục</p>
                        <h2 className="text-[1.6rem] font-black leading-tight text-primary sm:text-[1.9rem]">
                            Danh sách bài viết thân thiện với màn hình nhỏ
                        </h2>
                        <p className="max-w-2xl text-sm leading-7 text-stone/80">
                            Thanh lọc cuộn ngang, dễ bấm và giữ ngữ cảnh hiện tại khi người dùng đang đọc trên điện thoại.
                        </p>
                    </div>

                    <div className="inline-flex min-h-[42px] items-center rounded-full border border-gold/20 bg-white px-4 text-[11px] font-black uppercase tracking-[0.16em] text-primary shadow-sm">
                        {visiblePosts.length} bài viết
                    </div>
                </div>

                <div className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                    <div className="flex min-w-max gap-3 pb-2">
                        <button
                            type="button"
                            onClick={() => setActiveCategory('all')}
                            aria-pressed={activeCategory === 'all'}
                            className={`snap-start rounded-full px-5 py-3 text-[11px] font-black uppercase tracking-[0.16em] transition ${
                                activeCategory === 'all'
                                    ? 'bg-primary text-white shadow-[0_12px_24px_-16px_rgba(27,54,93,0.7)]'
                                    : 'border border-gold/20 bg-white text-primary hover:border-primary/30 hover:bg-primary/5'
                            }`}
                        >
                            Tất cả
                        </button>

                        {filteredCategories.map((category) => (
                            <button
                                key={category.id}
                                type="button"
                                onClick={() => setActiveCategory(String(category.id))}
                                aria-pressed={String(activeCategory) === String(category.id)}
                                className={`snap-start rounded-full px-5 py-3 text-[11px] font-black uppercase tracking-[0.16em] transition ${
                                    String(activeCategory) === String(category.id)
                                        ? 'bg-primary text-white shadow-[0_12px_24px_-16px_rgba(27,54,93,0.7)]'
                                        : 'border border-gold/20 bg-white text-primary hover:border-primary/30 hover:bg-primary/5'
                                }`}
                            >
                                {category.name}
                            </button>
                        ))}
                    </div>
                </div>

                {loading ? (
                    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <LoadingCard />
                        <LoadingCard />
                        <LoadingCard />
                    </div>
                ) : visiblePosts.length > 0 ? (
                    <>
                        {listPosts.length > 0 ? (
                            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {listPosts.map((post) => (
                                    <PostCard
                                        key={post.id}
                                        post={post}
                                        categoryLabel={resolveCategoryLabel(post, categoryMap)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="mt-8 rounded-[28px] border border-primary/10 bg-white px-6 py-8 text-sm leading-7 text-stone/80 shadow-sm">
                                Hiện tại chuyên mục này mới có 1 bài viết nổi bật. Phần danh sách sẽ tự động mở rộng khi có thêm nội dung mới.
                            </div>
                        )}
                    </>
                ) : (
                    <div className="mt-8">
                        <EmptyState activeCategoryLabel={activeCategoryLabel} />
                    </div>
                )}
            </section>
        </main>
    );
};

export default Blog;
