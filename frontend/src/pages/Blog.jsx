import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { blogApi } from '../services/api';

const Blog = () => {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPosts();
    }, []);

    const fetchPosts = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getAll();
            setPosts(response.data.data);
        } catch (error) {
            console.error("Error fetching blog posts", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 py-16 bg-background-light">
            <header className="text-center mb-16 space-y-4">
                <h1 className="font-display text-5xl font-bold text-primary italic uppercase tracking-wider">Cẩm Nang Gốm Sứ</h1>
                <div className="flex items-center justify-center gap-4">
                    <div className="h-px w-12 bg-gold"></div>
                    <p className="font-ui text-xs font-bold uppercase tracking-[0.3em] text-gold">Kiến thức & Văn hoá Việt</p>
                    <div className="h-px w-12 bg-gold"></div>
                </div>
            </header>

            {loading ? (
                <div className="flex justify-center py-40">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
                </div>
            ) : posts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
                    {posts.map(post => (
                        <article key={post.id} className="group bg-white border border-gold/10 hover:border-gold/30 shadow-[0_4px_20px_-10px_rgba(44,61,64,0.1)] hover:shadow-premium overflow-hidden flex flex-col hover:-translate-y-2 transition-all duration-700">
                            <div className="aspect-[16/10] overflow-hidden relative">
                                <img
                                    src={post.featured_image || 'https://via.placeholder.com/800x500'}
                                    alt={post.title}
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-[1.5s] ease-out"
                                />
                                <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                                <div className="absolute top-4 left-4">
                                    <span className="bg-white/90 backdrop-blur-sm text-primary font-ui text-[9px] font-bold uppercase tracking-[0.2em] px-3 py-1.5 shadow-sm border border-gold/10">
                                        Cảm Hứng
                                    </span>
                                </div>
                            </div>
                            <div className="p-8 flex flex-col flex-grow space-y-4 relative">
                                <div className="flex items-center gap-3">
                                    <div className="h-px w-6 bg-gold/40"></div>
                                    <span className="font-ui text-[9px] font-bold uppercase tracking-[0.2em] text-gold">
                                        {new Date(post.published_at || post.created_at).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' })}
                                    </span>
                                </div>
                                <Link to={`/blog/${post.slug}`} className="block">
                                    <h2 className="font-display text-2xl font-bold text-primary group-hover:text-brick transition-colors line-clamp-2 leading-tight">
                                        {post.title}
                                    </h2>
                                </Link>
                                <p className="font-body text-stone/80 text-sm line-clamp-3 leading-relaxed mb-6 italic">
                                    {post.excerpt || (post.content ? post.content.replace(/<[^>]*>?/gm, '').substring(0, 120) + '...' : 'Đang cập nhật nội dung...')}
                                </p>
                                <div className="mt-auto pt-6 border-t border-gold/10 flex items-center justify-between">
                                    <Link to={`/blog/${post.slug}`} className="font-ui text-[9px] font-bold uppercase tracking-[0.3em] text-primary hover:text-gold transition-all flex items-center gap-3 group/btn">
                                        Đọc tiếp <span className="material-symbols-outlined text-[14px] group-hover/btn:translate-x-1 transition-transform">east</span>
                                    </Link>
                                    <span className="material-symbols-outlined text-gold/20 text-xl">auto_stories</span>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="text-center py-40 space-y-6">
                    <span className="material-symbols-outlined text-6xl text-gold/30">auto_stories</span>
                    <h3 className="font-display text-2xl text-primary">Chưa có bài viết nào</h3>
                    <p className="font-body text-stone italic max-w-md mx-auto">Các nghệ nhân đang soạn thảo những kiến thức tinh hoa nhất về gốm sứ Bát Tràng để chia sẻ đến bạn.</p>
                </div>
            )}
        </main>
    );
};

export default Blog;
