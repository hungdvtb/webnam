import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { blogApi } from '../services/api';

const HeroFallback = () => (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(27,54,93,0.96),rgba(197,160,101,0.82))]">
        <div className="flex flex-col items-center gap-4 px-6 text-center text-white/90">
            <span className="material-symbols-outlined text-6xl">auto_stories</span>
            <div className="space-y-2">
                <p className="m-kicker text-xs font-black uppercase tracking-[0.35em] text-white/80">Cam Nang Gom Su</p>
                <p className="m-copy text-base font-medium text-white/75">Hinh anh bai viet dang duoc cap nhat</p>
            </div>
        </div>
    </div>
);

const PostDetail = () => {
    const { slug } = useParams();
    const [post, setPost] = useState(null);
    const [loading, setLoading] = useState(true);
    const [heroImageFailed, setHeroImageFailed] = useState(false);

    useEffect(() => {
        fetchPost();
        window.scrollTo(0, 0);
    }, [slug]);

    useEffect(() => {
        setHeroImageFailed(false);
    }, [post?.featured_image, post?.image]);

    const fetchPost = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getOne(slug);
            setPost(response.data);
        } catch (error) {
            console.error('Error fetching post detail', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center bg-background-light py-40">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-gold"></div>
            </div>
        );
    }

    if (!post) {
        return (
            <div className="space-y-8 bg-background-light py-60 text-center">
                <h2 className="m-display font-display text-3xl font-bold italic text-primary">Bài viết không hiện hữu.</h2>
                <Link to="/blog" className="m-btn inline-flex bg-primary px-10 py-4 font-ui font-bold uppercase tracking-[0.2em] text-white shadow-premium">
                    Trở lại cẩm nang
                </Link>
            </div>
        );
    }

    const heroImage = post.featured_image || post.image || '';
    const shouldRenderHeroImage = heroImage && !heroImageFailed;

    return (
        <article className="min-h-screen w-full bg-background-light">
            <div className="group relative h-[60vh] overflow-hidden border-b-4 border-gold">
                {shouldRenderHeroImage ? (
                    <img
                        src={heroImage}
                        alt={post.title}
                        onError={() => setHeroImageFailed(true)}
                        className="h-full w-full object-cover transition-transform duration-[2s] group-hover:scale-105"
                    />
                ) : (
                    <HeroFallback />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
                <div className="absolute inset-x-6 bottom-12 lg:px-24">
                    <div className="mx-auto max-w-4xl space-y-4 md:space-y-6">
                        <div className="m-kicker flex items-center gap-4 font-ui font-bold uppercase tracking-[0.5em] text-gold">
                            <div className="h-px w-8 bg-gold"></div>
                            Cẩm Nang Bát Tràng | {new Date(post.created_at).toLocaleDateString('vi-VN')}
                        </div>
                        <h1 className="m-display font-display text-4xl font-extrabold uppercase italic leading-tight text-white drop-shadow-premium lg:text-7xl">
                            {post.title}
                        </h1>
                    </div>
                </div>
            </div>

            <div className="mx-auto max-w-4xl px-4 py-12 pb-24 lg:px-24 lg:py-24 lg:pb-48">
                <div className="mb-10 flex h-10 items-center justify-between border-b border-gold/10 pb-6 md:mb-16 md:pb-8">
                    <Link to="/blog" className="m-kicker group flex items-center gap-2 font-ui font-bold uppercase tracking-[0.3em] text-primary transition-colors hover:text-gold">
                        <span className="material-symbols-outlined text-sm transition-transform group-hover:-translate-x-1">west</span>
                        Khám Phá Thêm
                    </Link>
                    <div className="flex items-center gap-4 text-stone/40">
                        <span className="material-symbols-outlined text-lg">share</span>
                        <span className="material-symbols-outlined text-lg">bookmark</span>
                    </div>
                </div>

                <div
                    className="mobile-prose font-body text-sm text-justify leading-7 text-umber/90 space-y-8 first-letter:float-left first-letter:mr-4 first-letter:text-5xl first-letter:font-display first-letter:font-bold first-letter:leading-none first-letter:text-primary md:space-y-12 md:text-lg md:leading-9 md:first-letter:mr-8 md:first-letter:text-8xl lg:text-2xl lg:leading-[2.2]"
                    dangerouslySetInnerHTML={{ __html: post.content }}
                />

                <div className="relative mt-12 border border-gold/20 bg-white p-6 text-center shadow-premium md:mt-24 md:p-12">
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gold px-8 py-2 font-display text-4xl leading-none text-white">“</span>
                    <p className="m-title font-body text-2xl italic leading-relaxed text-umber/80">
                        Tấc đất Bát Tràng, tâm hồn người thợ gốm. Nơi gìn giữ tinh hoa nghìn năm của dân tộc.
                    </p>
                    <p className="m-kicker mt-8 font-ui font-bold uppercase tracking-widest text-gold">Gốm Sứ Đại Thành</p>
                </div>
            </div>
        </article>
    );
};

export default PostDetail;
