import Link from 'next/link';
import { getBlogPost, getBlogPosts } from '@/lib/blogApi';
import { buildBlogContentMarkup } from '@/lib/blogContent';
import BlogMediaGalleryEnhancer from '@/components/blog/BlogMediaGalleryEnhancer';
import { resolveMediaUrl } from '@/lib/media';

const FALLBACK_RELATED_POSTS = [
  { title: 'Tâm hồn Việt trong chén trà Bát Tràng', date: 'Ngày 12 tháng 10, 2023' },
  { title: 'Men chàm: Sắc lam vĩnh cửu của thời đại', date: 'Ngày 05 tháng 10, 2023' },
  { title: 'Quy trình vẽ tay trên gốm sứ thủ công', date: 'Ngày 28 tháng 09, 2023' },
];

function formatDate(dateStr) {
  if (!dateStr) return '';

  return new Date(dateStr).toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getPostImage(post) {
  return (
    resolveMediaUrl(post?.image)
    || resolveMediaUrl(post?.thumbnail)
    || resolveMediaUrl(post?.featured_image)
    || null
  );
}

function extractPosts(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.data)) return response.data.data;
  return [];
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const slugOrId = resolvedParams?.id;

  try {
    const post = await getBlogPost(slugOrId);

    if (!post) {
      return { title: 'Bài viết không tìm thấy' };
    }

    const image = getPostImage(post);

    return {
      title: `${post.title} | Di sản Gốm Việt`,
      description: post.excerpt || post.title,
      openGraph: {
        title: post.title,
        description: post.excerpt || post.title,
        images: image ? [image] : [],
      },
    };
  } catch {
    return { title: 'Bài viết | Di sản Gốm Việt' };
  }
}

export default async function BlogPostPage({ params }) {
  const resolvedParams = await params;
  const slugOrId = resolvedParams?.id;

  let post = null;
  let related = [];

  try {
    post = await getBlogPost(slugOrId);

    if (post) {
      const response = await getBlogPosts({ per_page: 10 });
      const allPosts = extractPosts(response);

      related = allPosts
        .filter((item) => String(item.id) !== String(post.id) && String(item.slug || '') !== String(post.slug || slugOrId))
        .slice(0, 3);
    }
  } catch {
    post = null;
    related = [];
  }

  if (!post) {
    return (
      <main className="bdt-not-found">
        <span className="material-symbols-outlined bdt-nf-icon">article</span>
        <h1>Bài viết không tìm thấy</h1>
        <Link href="/blog">← Quay lại Blog</Link>
        <style>{`
          .bdt-not-found {
            min-height: 60vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1rem;
            font-family: 'EB Garamond', serif;
            color: #1B365D;
            background: #F9F5F0;
          }

          .bdt-nf-icon {
            font-size: 4rem;
            color: #C5A059;
          }

          .bdt-not-found h1 {
            font-family: 'Playfair Display', serif;
            font-size: 2rem;
            margin: 0;
          }

          .bdt-not-found a {
            color: #C5A059;
            font-weight: 700;
          }
        `}</style>
      </main>
    );
  }

  const heroImage = getPostImage(post);
  const rawContent = post.content || post.body || '';
  const contentMarkup = buildBlogContentMarkup(rawContent);
  const hasContent = Boolean(contentMarkup.__html.trim());

  return (
    <main className="bdt-page">
      <div className="bdt-container">
        <nav className="bdt-breadcrumb">
          <Link href="/">Trang chủ</Link>
          <span className="material-symbols-outlined">chevron_right</span>
          <Link href="/blog">Blog</Link>
          <span className="material-symbols-outlined">chevron_right</span>
          <span className="bdt-bc-current">{post.title}</span>
        </nav>

        <article>
          <header className="bdt-article-header">
            {(post.category?.name || post.category || post.tag) ? (
              <div className="bdt-category-badge">{post.category?.name || post.category || post.tag}</div>
            ) : null}

            <h1 className="bdt-title">{post.title}</h1>

            <div className="bdt-meta">
              {post.created_at ? <span>{formatDate(post.created_at)}</span> : null}
              {post.created_at && post.author ? <span className="bdt-meta-dot" /> : null}
              {post.author ? <span>Tác giả: {post.author}</span> : null}
            </div>
          </header>

          {heroImage ? (
            <div className="bdt-hero-img-wrap">
              <div className="bdt-hero-img-inner">
                <img
                  src={heroImage}
                  alt={post.title}
                  className="bdt-hero-img"
                  loading="eager"
                  decoding="async"
                />
              </div>

              {post.image_caption ? (
                <div className="bdt-img-caption">{post.image_caption}</div>
              ) : null}
            </div>
          ) : null}

          {post.excerpt ? (
            <p className="bdt-excerpt-dropcap">{post.excerpt}</p>
          ) : null}

          {hasContent ? (
            <>
              <div className="bdt-content" dangerouslySetInnerHTML={contentMarkup} />
              <BlogMediaGalleryEnhancer contentKey={`${post.id || slugOrId}:${rawContent.length}`} />
            </>
          ) : null}

          {!hasContent && !post.excerpt ? (
            <div className="bdt-content">
              <p>Nội dung bài viết đang được cập nhật...</p>
            </div>
          ) : null}

          {post.tags && post.tags.length > 0 ? (
            <div className="bdt-tags">
              <span className="bdt-tags-label">Thẻ:</span>
              {post.tags.map((tag, index) => (
                <span key={index} className="bdt-tag">
                  #{typeof tag === 'string' ? tag : tag.name}
                </span>
              ))}
            </div>
          ) : null}
        </article>

        <div className="bdt-divider">
          <div className="bdt-divider-line" />
          <span className="material-symbols-outlined bdt-divider-icon">flare</span>
          <div className="bdt-divider-line" />
        </div>

        <section className="bdt-related">
          <h3 className="bdt-related-title">Bài viết liên quan</h3>

          <div className="bdt-related-grid">
            {related.length > 0 ? related.map((item) => (
              <Link key={item.id} href={`/blog/${item.slug || item.id}`} className="bdt-related-card">
                <div className="bdt-related-img">
                  {getPostImage(item) ? (
                    <img
                      src={getPostImage(item)}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="bdt-related-placeholder">
                      <span className="material-symbols-outlined">article</span>
                    </div>
                  )}
                </div>
                <h4 className="bdt-related-name">{item.title}</h4>
                {item.created_at ? (
                  <p className="bdt-related-date">{formatDate(item.created_at)}</p>
                ) : null}
              </Link>
            )) : FALLBACK_RELATED_POSTS.map((item) => (
              <div key={item.title} className="bdt-related-card">
                <div className="bdt-related-img bdt-related-placeholder-bg">
                  <span className="material-symbols-outlined">article</span>
                </div>
                <h4 className="bdt-related-name">{item.title}</h4>
                <p className="bdt-related-date">{item.date}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="bdt-back-wrap">
          <Link href="/blog" className="bdt-back-btn">
            <span className="material-symbols-outlined">arrow_back</span>
            Quay lại danh sách bài viết
          </Link>
        </div>
      </div>

      <style>{`
        .bdt-page {
          background: #F9F5F0;
          min-height: 100vh;
          font-family: 'EB Garamond', serif;
          color: #1a1a1a;
          padding-bottom: 4rem;
        }

        .bdt-container {
          width: 100%;
          min-width: 0;
          max-width: 960px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem 3rem;
        }

        article {
          width: 100%;
          min-width: 0;
        }

        .bdt-breadcrumb {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          flex-wrap: wrap;
          margin-bottom: 2.2rem;
          color: rgba(27, 54, 93, 0.62);
          font-size: 0.85rem;
          font-style: italic;
        }

        .bdt-breadcrumb a {
          color: rgba(27, 54, 93, 0.74);
          transition: color 0.2s ease;
        }

        .bdt-breadcrumb a:hover {
          color: #1B365D;
        }

        .bdt-breadcrumb .material-symbols-outlined {
          font-size: 1rem;
        }

        .bdt-bc-current {
          max-width: 360px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #1B365D;
          font-weight: 500;
        }

        .bdt-article-header {
          text-align: center;
          margin-bottom: 2.6rem;
        }

        .bdt-category-badge {
          display: inline-block;
          margin-bottom: 1.3rem;
          padding: 0.32rem 1rem;
          border: 1px solid #C5A059;
          color: #C5A059;
          font-size: 0.68rem;
          font-weight: 700;
          font-family: 'EB Garamond', serif;
          letter-spacing: 0.28em;
          text-transform: uppercase;
        }

        .bdt-title {
          margin: 0 0 1.25rem;
          color: #1B365D;
          font-family: 'Playfair Display', serif;
          font-size: clamp(2rem, 7vw, 4.25rem);
          font-style: italic;
          font-weight: 900;
          line-height: 1.08;
        }

        .bdt-meta {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 0.85rem;
          color: rgba(27, 54, 93, 0.7);
          font-size: 1rem;
          font-style: italic;
        }

        .bdt-meta-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #C5A059;
        }

        .bdt-hero-img-wrap {
          position: relative;
          margin-bottom: 3.4rem;
          padding: 0.6rem;
          border: 2px solid rgba(197, 160, 89, 0.35);
          border-radius: 1.35rem;
          background: rgba(255, 255, 255, 0.72);
          box-shadow: 0 18px 38px rgba(27, 54, 93, 0.08);
        }

        .bdt-hero-img-inner {
          padding: 4px;
          border: 1px solid rgba(197, 160, 89, 0.8);
          border-radius: 1rem;
          overflow: hidden;
        }

        .bdt-hero-img {
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
          object-fit: cover;
          object-position: center;
          transition: transform 0.35s ease;
        }

        .bdt-hero-img-wrap:hover .bdt-hero-img {
          transform: scale(1.015);
        }

        .bdt-img-caption {
          position: absolute;
          right: 1.35rem;
          bottom: -1.2rem;
          max-width: min(70%, 420px);
          padding: 0.55rem 0.95rem;
          border-left: 4px solid #C5A059;
          background: #F9F5F0;
          color: rgba(27, 54, 93, 0.8);
          font-size: 0.86rem;
          font-style: italic;
        }

        .bdt-excerpt-dropcap {
          display: flow-root;
          margin-bottom: 2.4rem;
          color: rgba(27, 54, 93, 0.9);
          font-size: 1.2rem;
          line-height: 1.85;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .bdt-excerpt-dropcap::first-letter {
          float: left;
          padding-top: 0.35rem;
          padding-right: 0.6rem;
          color: #1B365D;
          font-family: 'Playfair Display', serif;
          font-size: 5rem;
          font-weight: 900;
          line-height: 4rem;
        }

        .bdt-content {
          width: 100%;
          min-width: 0;
          color: rgba(27, 54, 93, 0.92);
          font-size: 1.1rem;
          line-height: 1.9;
          overflow-wrap: anywhere;
          word-break: break-word;
          word-wrap: break-word;
        }

        .bdt-content > :first-child {
          margin-top: 0;
        }

        .bdt-content :where(
          p,
          h2,
          h3,
          h4,
          h5,
          h6,
          li,
          blockquote,
          figcaption,
          td,
          th,
          a,
          span,
          strong,
          em
        ) {
          max-width: 100% !important;
          white-space: normal !important;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .bdt-content :where(
          div,
          section,
          article,
          aside,
          figure,
          picture,
          img,
          svg,
          video,
          iframe,
          table,
          pre,
          ul,
          ol,
          blockquote
        ) {
          max-width: 100% !important;
        }

        .bdt-content p {
          margin: 0 0 1.35rem;
        }

        .bdt-content h2 {
          display: flex;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
          min-width: 0;
          margin: 3.1rem 0 1.2rem;
          color: #1B365D;
          font-family: 'Playfair Display', serif;
          font-size: 1.8rem;
          font-style: italic;
          font-weight: 700;
          line-height: 1.32;
        }

        .bdt-content h2::after {
          content: '';
          flex: 1;
          min-width: min(140px, 100%);
          height: 1px;
          background: rgba(197, 160, 89, 0.35);
        }

        .bdt-content h3 {
          margin: 2.4rem 0 1rem;
          color: #1B365D;
          font-family: 'Playfair Display', serif;
          font-size: 1.4rem;
          font-weight: 700;
        }

        .bdt-content blockquote {
          margin: 2.2rem 0;
          padding: 1.45rem 0;
          border-top: 1px solid rgba(197, 160, 89, 0.4);
          border-bottom: 1px solid rgba(197, 160, 89, 0.4);
          color: #1B365D;
          font-size: 1.38rem;
          font-style: italic;
          line-height: 1.6;
          text-align: center;
        }

        .bdt-content ul,
        .bdt-content ol {
          margin: 1.25rem 0;
          padding-left: 1.5rem;
        }

        .bdt-content li {
          margin-bottom: 0.5rem;
        }

        .bdt-content table {
          display: block;
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-collapse: collapse;
          border-spacing: 0;
          background: rgba(255, 255, 255, 0.96);
        }

        .bdt-content th,
        .bdt-content td {
          min-width: 7rem;
          padding: 0.7rem 0.85rem;
          border: 1px solid rgba(197, 160, 89, 0.22);
          vertical-align: top;
        }

        .bdt-content a {
          color: #C5A059;
          text-decoration: underline;
          word-break: break-word;
        }

        .bdt-content .bdt-inline-media,
        .bdt-content .bdt-embedded-video {
          margin: clamp(1.7rem, 3vw, 2.4rem) 0;
          padding: clamp(0.38rem, 1vw, 0.6rem);
          border-radius: 1.25rem;
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 234, 223, 0.92));
          box-shadow: 0 16px 36px rgba(27, 54, 93, 0.08);
        }

        .bdt-content .bdt-inline-media-frame,
        .bdt-content .bdt-video-frame {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          border-radius: 1rem;
          background: #ece5d8;
        }

        .bdt-content .bdt-inline-media-link {
          display: block;
        }

        .bdt-content .bdt-inline-image {
          display: block;
          width: 100%;
          max-width: 100%;
          height: auto !important;
          max-height: none;
          margin: 0 auto;
          object-fit: contain;
          object-position: center;
          background: #f3eee5;
        }

        .bdt-content img,
        .bdt-content video {
          display: block;
          max-width: 100% !important;
          height: auto !important;
        }

        .bdt-content .bdt-video-frame {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          background: #0f172a;
        }

        .bdt-content iframe {
          display: block;
          width: 100% !important;
          max-width: 100% !important;
          border: 0;
        }

        .bdt-content .bdt-video-frame iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
        }

        .bdt-content figure {
          margin: 2rem 0;
        }

        .bdt-content figcaption {
          margin-top: 0.55rem;
          color: rgba(27, 54, 93, 0.65);
          font-size: 0.85rem;
          font-style: italic;
          text-align: center;
        }

        .bdt-content .bdt-media-gallery {
          margin: clamp(1.9rem, 3vw, 2.6rem) 0;
          padding: clamp(0.6rem, 1vw, 0.75rem);
          border-radius: 1.45rem;
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 234, 223, 0.92));
          box-shadow: 0 18px 38px rgba(27, 54, 93, 0.09);
        }

        .bdt-content .bdt-media-gallery-main {
          width: 100%;
          overflow: hidden;
          border-radius: 1.1rem;
          background:
            radial-gradient(circle at top left, rgba(255, 255, 255, 0.42), transparent 35%),
            linear-gradient(135deg, #ece4d7, #f4efe7);
        }

        .bdt-content .bdt-media-gallery-stage-image-wrap,
        .bdt-content .bdt-media-gallery-stage-video {
          display: block;
          width: 100%;
          aspect-ratio: 16 / 9;
        }

        .bdt-content .bdt-media-gallery-stage-image-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.46);
        }

        .bdt-content .bdt-media-gallery-stage-image {
          width: 100%;
          height: 100% !important;
          object-fit: contain;
          object-position: center;
        }

        .bdt-content .bdt-media-gallery-stage-video {
          position: relative;
          background: #0f172a;
        }

        .bdt-content .bdt-media-gallery-stage-video iframe {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
        }

        .bdt-content .bdt-media-gallery-thumbs {
          display: flex;
          gap: 0.8rem;
          margin-top: 0.9rem;
          padding-bottom: 0.15rem;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: rgba(197, 160, 89, 0.55) transparent;
        }

        .bdt-content .bdt-media-gallery-thumbs::-webkit-scrollbar {
          height: 6px;
        }

        .bdt-content .bdt-media-gallery-thumbs::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(197, 160, 89, 0.55);
        }

        .bdt-content .bdt-media-gallery-thumb {
          display: flex;
          flex: 0 0 108px;
          flex-direction: column;
          gap: 0.38rem;
          padding: 0;
          border: 1px solid rgba(197, 160, 89, 0.18);
          border-radius: 0.95rem;
          background: rgba(255, 255, 255, 0.92);
          color: #1B365D;
          transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
          overflow: hidden;
          cursor: pointer;
        }

        .bdt-content .bdt-media-gallery-thumb:hover {
          transform: translateY(-2px);
          border-color: rgba(27, 54, 93, 0.28);
          box-shadow: 0 12px 20px rgba(27, 54, 93, 0.08);
        }

        .bdt-content .bdt-media-gallery-thumb.is-active {
          border-color: rgba(197, 160, 89, 0.92);
          box-shadow: 0 0 0 2px rgba(197, 160, 89, 0.22);
        }

        .bdt-content .bdt-media-gallery-thumb-frame {
          position: relative;
          display: block;
          width: 100%;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          background: rgba(27, 54, 93, 0.06);
        }

        .bdt-content .bdt-media-gallery-thumb-frame img {
          width: 100%;
          height: 100% !important;
          object-fit: cover;
          object-position: center;
        }

        .bdt-content .bdt-media-gallery-thumb-play {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-size: 2rem;
          text-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
          pointer-events: none;
        }

        .bdt-content .bdt-media-gallery-thumb-label {
          display: block;
          padding: 0 0.7rem 0.7rem;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-align: center;
          text-transform: uppercase;
          color: rgba(27, 54, 93, 0.72);
        }

        .bdt-content .highlight-section {
          position: relative;
          max-width: 100%;
          overflow: visible;
          margin: 2.5rem 0;
          padding: 2rem;
          border-left: 6px solid #1B365D;
          background: rgba(27, 54, 93, 0.05);
        }

        .bdt-content .grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
          margin: 2rem 0;
        }

        .bdt-tags {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          margin-top: 2rem;
          padding: 1.5rem 0 0;
          border-top: 1px solid rgba(197, 160, 89, 0.2);
        }

        .bdt-tags-label {
          color: #94a3b8;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .bdt-tag {
          padding: 0.25rem 0.8rem;
          border: 1px solid rgba(27, 54, 93, 0.15);
          border-radius: 99px;
          background: rgba(27, 54, 93, 0.07);
          color: #1B365D;
          font-size: 0.8rem;
        }

        .bdt-divider {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0;
          margin: 4rem 0;
        }

        .bdt-divider-line {
          width: 6rem;
          height: 1px;
          background: #C5A059;
        }

        .bdt-divider-icon {
          padding: 0 1rem;
          color: #C5A059;
          font-size: 1.4rem;
        }

        .bdt-related {
          margin-bottom: 4rem;
        }

        .bdt-related-title {
          margin: 0 0 2.2rem;
          color: #1B365D;
          font-family: 'Playfair Display', serif;
          font-size: 1.4rem;
          font-style: italic;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-align: center;
          text-transform: uppercase;
        }

        .bdt-related-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.25rem;
        }

        .bdt-related-card {
          display: block;
          border: 1px solid rgba(197, 160, 89, 0.25);
          background: #fff;
          color: inherit;
          text-decoration: none;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .bdt-related-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 22px rgba(27, 54, 93, 0.12);
        }

        .bdt-related-img {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 140px;
          overflow: hidden;
          background: rgba(27, 54, 93, 0.08);
        }

        .bdt-related-img img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .bdt-related-placeholder,
        .bdt-related-placeholder-bg {
          display: flex;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
          color: rgba(27, 54, 93, 0.4);
        }

        .bdt-related-name {
          margin: 0;
          padding: 0.85rem 0.9rem 0.45rem;
          color: #1B365D;
          font-family: 'Playfair Display', serif;
          font-size: 1rem;
          line-height: 1.4;
        }

        .bdt-related-date {
          margin: 0;
          padding: 0 0.9rem 0.9rem;
          color: rgba(27, 54, 93, 0.5);
          font-size: 0.8rem;
          font-style: italic;
        }

        .bdt-back-wrap {
          text-align: center;
        }

        .bdt-back-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.55rem 1rem;
          border: 1px solid rgba(197, 160, 89, 0.35);
          color: #1B365D;
          font-size: 0.85rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-decoration: none;
          text-transform: uppercase;
          transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
        }

        .bdt-back-btn:hover {
          border-color: #1B365D;
          background: #1B365D;
          color: #F9F5F0;
        }

        @media (max-width: 900px) {
          .bdt-related-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 700px) {
          .bdt-container {
            padding: 1.6rem 1rem 2.5rem;
          }

          .bdt-hero-img-wrap {
            margin-bottom: 2.7rem;
          }

          .bdt-img-caption {
            position: static;
            max-width: none;
            margin-top: 0.75rem;
          }

          .bdt-excerpt-dropcap::first-letter {
            font-size: 4rem;
            line-height: 3.1rem;
          }
        }

        @media (max-width: 600px) {
          .bdt-content .grid-2 {
            grid-template-columns: 1fr;
          }

          .bdt-content {
            font-size: 1.03rem;
            line-height: 1.82;
          }

          .bdt-content h2 {
            display: block;
            font-size: 1.55rem;
          }

          .bdt-content h2::after {
            display: none;
          }

          .bdt-content h3 {
            font-size: 1.28rem;
          }

          .bdt-content blockquote {
            padding: 1.15rem 0;
            font-size: 1.16rem;
            text-align: left;
          }

          .bdt-content ul,
          .bdt-content ol {
            padding-left: 1.2rem;
          }

          .bdt-content .highlight-section {
            padding: 1.25rem;
          }

          .bdt-content .bdt-media-gallery {
            border-radius: 1.08rem;
            padding: 0.48rem;
          }

          .bdt-content .bdt-media-gallery-main {
            border-radius: 0.9rem;
          }

          .bdt-content .bdt-media-gallery-thumb {
            flex-basis: 92px;
            border-radius: 0.82rem;
          }

          .bdt-content .bdt-media-gallery-thumb-label {
            padding: 0 0.55rem 0.55rem;
            font-size: 0.66rem;
          }

          .bdt-content .bdt-inline-media,
          .bdt-content .bdt-embedded-video {
            margin: 1.45rem 0 1.8rem;
            border-radius: 1rem;
          }

          .bdt-content .bdt-inline-media-frame,
          .bdt-content .bdt-video-frame {
            border-radius: 0.82rem;
          }
        }
      `}</style>
    </main>
  );
}
