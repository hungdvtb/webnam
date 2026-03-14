import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { blogApi } from '../services/api';

const PostDetail = () => {
    const { slug } = useParams();
    const [post, setPost] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchPost();
        window.scrollTo(0, 0);
    }, [slug]);

    const fetchPost = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getOne(slug);
            setPost(response.data);
        } catch (error) {
            console.error("Error fetching post detail", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-40 bg-background-light">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gold"></div>
            </div>
        );
    }

    if (!post) {
        return (
            <div className="text-center py-60 bg-background-light space-y-8">
                <h2 className="font-display text-3xl text-primary font-bold italic">Bài viết không hiện hữu.</h2>
                <Link to="/blog" className="px-10 py-4 bg-primary text-white font-ui font-bold uppercase tracking-[0.2em] shadow-premium">Trở lại cẩm nang</Link>
            </div>
        );
    }

    return (
        <article className="w-full bg-background-light min-h-screen">
            {/* Featured Image Banner */}
            <div className="relative h-[60vh] overflow-hidden border-b-4 border-gold group">
                <img src={post.image || 'https://placehold.co/1920x1080'} alt={post.title} className="w-full h-full object-cover transition-transform duration-[2s] group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
                <div className="absolute inset-x-6 bottom-16 lg:px-24">
                    <div className="max-w-4xl mx-auto space-y-6">
                        <div className="flex items-center gap-4 text-gold font-ui text-xs font-bold uppercase tracking-[0.5em]">
                            <div className="h-px w-8 bg-gold"></div>
                            Cẩm Nang Bát Tràng | {new Date(post.created_at).toLocaleDateString('vi-VN')}
                        </div>
                        <h1 className="font-display text-4xl lg:text-7xl font-extrabold text-white leading-tight italic drop-shadow-premium uppercase">{post.title}</h1>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-4xl mx-auto px-6 lg:px-24 py-24 pb-48">
                <div className="flex items-center justify-between mb-16 border-b border-gold/10 pb-8 h-10">
                    <Link to="/blog" className="font-ui text-[10px] font-bold uppercase tracking-[0.3em] text-primary hover:text-gold transition-colors flex items-center gap-2 group">
                        <span className="material-symbols-outlined text-sm group-hover:-translate-x-1 transition-transform">west</span> Khám Phá Thêm
                    </Link>
                    <div className="flex items-center gap-4 text-stone/40">
                        <span className="material-symbols-outlined text-lg">share</span>
                        <span className="material-symbols-outlined text-lg">bookmark</span>
                    </div>
                </div>

                <div
                    className="font-body text-xl lg:text-2xl text-umber/90 leading-[2.2] text-justify space-y-12 first-letter:text-8xl first-letter:font-display first-letter:font-bold first-letter:text-primary first-letter:float-left first-letter:mr-8 first-letter:leading-none"
                    dangerouslySetInnerHTML={{ __html: post.content }}
                />

                <div className="mt-24 p-12 bg-white border border-gold/20 shadow-premium relative text-center">
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gold text-white px-8 py-2 font-display text-4xl leading-none">“</span>
                    <p className="font-body text-2xl text-umber/80 italic leading-relaxed">
                        Tấc đất Bát Tràng, tâm hồn người thợ gốm. Nơi gìn giữ tinh hoa nghìn năm của dân tộc.
                    </p>
                    <p className="mt-8 font-ui text-[10px] font-bold uppercase tracking-widest text-gold">— Gốm Sứ Đại Thành</p>
                </div>
            </div>
        </article>
    );
};

export default PostDetail;
