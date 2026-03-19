import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { blogApi } from '../services/api';

const Blog = () => {
    const [posts, setPosts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [activeCategory, setActiveCategory] = useState('all');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPosts();
    }, []);

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

    const visiblePosts = useMemo(() => {
        if (activeCategory === 'all') {
            return posts;
        }

        return posts.filter((post) => Number(post.blog_category_id) === Number(activeCategory));
    }, [activeCategory, posts]);

    return (
        <main className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 py-16 bg-background-light">
            <header className="text-center mb-10 space-y-4">
                <h1 className="font-display text-5xl font-bold text-primary italic uppercase tracking-wider">Cẩm nang gốm sứ</h1>
                <div className="flex items-center justify-center gap-4">
                    <div className="h-px w-12 bg-gold"></div>
                    <p className="font-ui text-xs font-bold uppercase tracking-[0.3em] text-gold">Kiến thức và văn hóa Việt</p>
                    <div className="h-px w-12 bg-gold"></div>
                </div>
            </header>

            <section className="mb-10 flex flex-wrap items-center justify-center gap-2">
                <button
                    type="button"
                    onClick={() => setActiveCategory('all')}
                    className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-widest transition-colors ${
                        activeCategory === 'all'
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-primary border-gold/25 hover:border-primary/30'
                    }`}
                >
                    Tất cả
                </button>
                {categories.map((category) => (
                    <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveCategory(String(category.id))}
                        className={`h-9 px-4 rounded-full border text-[10px] font-black uppercase tracking-widest transition-colors ${
                            Number(activeCategory) === Number(category.id)
                                ? 'bg-primary text-white border-primary'
                                : 'bg-white text-primary border-gold/25 hover:border-primary/30'
                        }`}
                    >
                        {category.name}
                    </button>
                ))}
            </section>

            {loading ? (
                <div className="flex justify-center py-40">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
                </div>
            ) : visiblePosts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
                    {visiblePosts.map((post) => (
                        <Link
                            key={post.id}
                            to={`/blog/${post.slug || post.id}`}
                            className="group bg-white border border-gold/10 hover:border-gold/30 shadow-[0_4px_20px_-10px_rgba(44,61,64,0.1)] hover:shadow-premium overflow-hidden flex flex-col hover:-translate-y-2 transition-all duration-700"
                        >
                            <article className="h-full flex flex-col">
                                <div className="aspect-[16/10] overflow-hidden relative">
                                    <img
                                        src={post.featured_image || 'https://placehold.co/800x500'}
                                        alt={post.title}
                                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1.5s] ease-out"
                                    />
                                    <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                                </div>
                                <div className="p-8 flex flex-col flex-grow space-y-4 relative">
                                    <div className="flex items-center gap-3">
                                        <div className="h-px w-6 bg-gold/40"></div>
                                        <span className="font-ui text-[9px] font-bold uppercase tracking-[0.2em] text-gold">
                                            {new Date(post.published_at || post.created_at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </span>
                                    </div>
                                    <h2 className="font-display text-2xl font-bold text-primary group-hover:text-brick transition-colors line-clamp-2 leading-tight">
                                        {post.title}
                                    </h2>
                                    <p className="font-body text-stone/80 text-sm line-clamp-3 leading-relaxed mb-6 italic">
                                        {post.excerpt || (post.content ? post.content.replace(/<[^>]*>?/gm, '').substring(0, 120) + '...' : 'Đang cập nhật nội dung...')}
                                    </p>
                                    <div className="mt-auto pt-6 border-t border-gold/10 flex items-center justify-between">
                                        <span className="font-ui text-[9px] font-bold uppercase tracking-[0.3em] text-primary transition-all flex items-center gap-3 group/btn">
                                            Đọc tiếp <span className="material-symbols-outlined text-[14px] group-hover/btn:translate-x-1 transition-transform">east</span>
                                        </span>
                                        <span className="material-symbols-outlined text-gold/20 text-xl">auto_stories</span>
                                    </div>
                                </div>
                            </article>
                        </Link>
                    ))}
                </div>
            ) : (
                <div className="text-center py-40 space-y-6">
                    <span className="material-symbols-outlined text-6xl text-gold/30">auto_stories</span>
                    <h3 className="font-display text-2xl text-primary">Chưa có bài viết nào</h3>
                    <p className="font-body text-stone italic max-w-md mx-auto">Danh mục này chưa có bài viết. Vui lòng quay lại sau.</p>
                </div>
            )}
        </main>
    );
};

export default Blog;
