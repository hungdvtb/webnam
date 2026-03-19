import Link from 'next/link';
import { getBlogPost, getBlogPosts } from '@/lib/blogApi';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getPostImage(post) {
  return post?.image || post?.thumbnail || post?.featured_image || null;
}

function extractPosts(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.data)) return res.data.data;
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
      const res = await getBlogPosts({ per_page: 10 });
      const all = extractPosts(res);
      related = all
        .filter((p) => String(p.id) !== String(post.id) && String(p.slug || '') !== String(post.slug || slugOrId))
        .slice(0, 3);
    }
  } catch (e) {
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
            min-height: 60vh; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 1rem;
            font-family: 'EB Garamond', serif; color: #1B365D;
            background: #F9F5F0;
          }
          .bdt-nf-icon { font-size: 4rem; color: #C5A059; }
          h1 { font-family: 'Playfair Display', serif; font-size: 2rem; }
          a { color: #C5A059; font-weight: 700; }
        `}</style>
      </main>
    );
  }

  const heroImg = getPostImage(post);
  const content = post.content || post.body || '';
  const hasContent = content.trim().length > 50;

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
            {(post.category?.name || post.category || post.tag) && (
              <div className="bdt-category-badge">{post.category?.name || post.category || post.tag}</div>
            )}
            <h1 className="bdt-title">{post.title}</h1>
            <div className="bdt-meta">
              {post.created_at && <span>{formatDate(post.created_at)}</span>}
              {post.created_at && post.author && <span className="bdt-meta-dot" />}
              {post.author && <span>Tác giả: {post.author}</span>}
            </div>
          </header>

          {heroImg && (
            <div className="bdt-hero-img-wrap">
              <div className="bdt-hero-img-inner">
                <img src={heroImg} alt={post.title} className="bdt-hero-img" />
              </div>
              {post.image_caption && (
                <div className="bdt-img-caption">{post.image_caption}</div>
              )}
            </div>
          )}

          {post.excerpt && (
            <p className="bdt-excerpt-dropcap">{post.excerpt}</p>
          )}

          {hasContent && (
            <div
              className="bdt-content"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          )}

          {!hasContent && !post.excerpt && (
            <div className="bdt-content">
              <p>Nội dung bài viết đang được cập nhật...</p>
            </div>
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="bdt-tags">
              <span className="bdt-tags-label">Thẻ:</span>
              {post.tags.map((tag, i) => (
                <span key={i} className="bdt-tag">
                  #{typeof tag === 'string' ? tag : tag.name}
                </span>
              ))}
            </div>
          )}
        </article>

        <div className="bdt-divider">
          <div className="bdt-divider-line" />
          <span className="material-symbols-outlined bdt-divider-icon">flare</span>
          <div className="bdt-divider-line" />
        </div>

        <section className="bdt-related">
          <h3 className="bdt-related-title">Bài viết liên quan</h3>
          <div className="bdt-related-grid">
            {related.length > 0 ? related.map((rel) => (
              <Link key={rel.id} href={`/blog/${rel.slug || rel.id}`} className="bdt-related-card">
                <div className="bdt-related-img">
                  {getPostImage(rel)
                    ? <img src={getPostImage(rel)} alt={rel.title} />
                    : (
                      <div className="bdt-related-placeholder">
                        <span className="material-symbols-outlined">article</span>
                      </div>
                    )
                  }
                </div>
                <h4 className="bdt-related-name">{rel.title}</h4>
                {rel.created_at && (
                  <p className="bdt-related-date">{formatDate(rel.created_at)}</p>
                )}
              </Link>
            )) : (
              [
                { title: 'Tâm hồn Việt trong chén trà Bát Tràng', date: 'Ngày 12 tháng 10, 2023' },
                { title: 'Men chàm: Sắc lam vĩnh cửu của thời đại', date: 'Ngày 05 tháng 10, 2023' },
                { title: 'Quy trình vẽ tay trên gốm sứ thủ công', date: 'Ngày 28 tháng 09, 2023' },
              ].map((item, i) => (
                <div key={i} className="bdt-related-card">
                  <div className="bdt-related-img bdt-related-placeholder-bg">
                    <span className="material-symbols-outlined">article</span>
                  </div>
                  <h4 className="bdt-related-name">{item.title}</h4>
                  <p className="bdt-related-date">{item.date}</p>
                </div>
              ))
            )}
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
          max-width: 960px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem 3rem;
        }

        .bdt-breadcrumb {
          display: flex; align-items: center; gap: 0.3rem;
          font-size: 0.85rem; color: rgba(27,54,93,0.6);
          font-style: italic; margin-bottom: 2.5rem; flex-wrap: wrap;
        }
        .bdt-breadcrumb a { color: rgba(27,54,93,0.7); transition: color 0.2s; }
        .bdt-breadcrumb a:hover { color: #1B365D; }
        .bdt-breadcrumb .material-symbols-outlined { font-size: 1rem; }
        .bdt-bc-current {
          color: #1B365D; font-weight: 500;
          max-width: 350px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .bdt-article-header {
          text-align: center;
          margin-bottom: 3rem;
        }
        .bdt-category-badge {
          display: inline-block;
          border: 1px solid #C5A059;
          color: #C5A059;
          font-size: 0.65rem; font-weight: 700;
          letter-spacing: 0.3em; text-transform: uppercase;
          padding: 0.3rem 1rem; margin-bottom: 1.5rem;
          font-family: 'EB Garamond', serif;
        }
        .bdt-title {
          font-family: 'Playfair Display', serif;
          font-size: clamp(2rem, 7vw, 4.5rem);
          font-weight: 900; color: #1B365D;
          line-height: 1.1; margin: 0 0 1.5rem; font-style: italic;
        }
        .bdt-meta {
          display: flex; align-items: center; justify-content: center;
          gap: 1rem; color: rgba(27,54,93,0.7);
          font-size: 1rem; font-style: italic; flex-wrap: wrap;
        }
        .bdt-meta-dot {
          width: 5px; height: 5px; border-radius: 50%;
          background: #C5A059;
        }

        .bdt-hero-img-wrap {
          position: relative;
          padding: 0.5rem;
          border: 2px solid rgba(197,160,89,0.35);
          margin-bottom: 4rem;
        }
        .bdt-hero-img-inner {
          padding: 3px;
          border: 1px solid #C5A059;
        }
        .bdt-hero-img {
          display: block; width: 100%;
          aspect-ratio: 16/9; object-fit: cover;
          filter: grayscale(15%);
          transition: filter 0.7s;
        }
        .bdt-hero-img-wrap:hover .bdt-hero-img { filter: grayscale(0); }
        .bdt-img-caption {
          position: absolute;
          bottom: -1.5rem; right: 1.5rem;
          background: #F9F5F0;
          border-left: 4px solid #C5A059;
          padding: 0.5rem 1rem;
          font-size: 0.85rem; font-style: italic;
          color: rgba(27,54,93,0.8);
        }

        .bdt-excerpt-dropcap {
          font-size: 1.2rem; line-height: 1.85;
          color: rgba(27,54,93,0.9); margin-bottom: 2.5rem;
        }
        .bdt-excerpt-dropcap::first-letter {
          float: left;
          font-size: 5rem; line-height: 4rem;
          padding-top: 0.35rem; padding-right: 0.6rem;
          font-family: 'Playfair Display', serif;
          color: #1B365D; font-weight: 900;
        }

        .bdt-content {
          font-size: 1.1rem; line-height: 1.9;
          color: rgba(27,54,93,0.9);
        }
        .bdt-content p { margin: 0 0 1.4rem; }
        .bdt-content h2 {
          font-family: 'Playfair Display', serif; font-size: 1.8rem;
          color: #1B365D; font-style: italic; font-weight: 700;
          margin: 3.5rem 0 1.25rem; display: flex; align-items: center; gap: 1rem;
        }
        .bdt-content h2::after {
          content: ''; flex: 1; height: 1px;
          background: rgba(197,160,89,0.35);
        }
        .bdt-content h3 {
          font-family: 'Playfair Display', serif; font-size: 1.4rem;
          color: #1B365D; font-weight: 700; margin: 2.5rem 0 1rem;
        }
        .bdt-content blockquote {
          border-top: 1px solid rgba(197,160,89,0.4);
          border-bottom: 1px solid rgba(197,160,89,0.4);
          padding: 1.5rem 0; margin: 2.5rem 0;
          font-size: 1.4rem; font-style: italic;
          color: #1B365D; text-align: center; line-height: 1.6;
        }
        .bdt-content img {
          max-width: 100%; border: 1px solid rgba(197,160,89,0.25);
          margin: 1.5rem 0;
        }
        .bdt-content figure { margin: 2rem 0; }
        .bdt-content figcaption {
          font-size: 0.85rem; text-align: center; font-style: italic;
          color: rgba(27,54,93,0.6); margin-top: 0.5rem;
        }
        .bdt-content .highlight-section {
          background: rgba(27,54,93,0.05); padding: 2rem;
          border-left: 6px solid #1B365D; margin: 2.5rem 0;
          position: relative; overflow: hidden;
        }
        .bdt-content ul, .bdt-content ol {
          padding-left: 1.5rem; margin: 1.25rem 0;
        }
        .bdt-content li { margin-bottom: 0.5rem; }
        .bdt-content a { color: #C5A059; text-decoration: underline; }
        .bdt-content .grid-2 {
          display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 2rem 0;
        }
        @media (max-width: 600px) { .bdt-content .grid-2 { grid-template-columns: 1fr; } }

        .bdt-tags {
          display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
          padding: 1.5rem 0; border-top: 1px solid rgba(197,160,89,0.2);
          margin-top: 2rem;
        }
        .bdt-tags-label { font-size: 0.85rem; color: #94a3b8; font-weight: 600; }
        .bdt-tag {
          font-size: 0.8rem; color: #1B365D;
          background: rgba(27,54,93,0.07); padding: 0.25rem 0.8rem;
          border: 1px solid rgba(27,54,93,0.15); border-radius: 99px;
        }

        .bdt-divider {
          display: flex; align-items: center; justify-content: center;
          gap: 0; margin: 4rem 0;
        }
        .bdt-divider-line { height: 1px; width: 6rem; background: #C5A059; }
        .bdt-divider-icon {
          color: #C5A059; padding: 0 1rem; font-size: 1.4rem;
        }

        .bdt-related { margin-bottom: 4rem; }
        .bdt-related-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.4rem; color: #1B365D; font-weight: 700; font-style: italic;
          text-align: center; text-transform: uppercase; letter-spacing: 0.15em;
          margin: 0 0 2.5rem;
        }
        .bdt-related-grid {
          display: grid; gap: 1.25rem;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        @media (max-width: 900px) {
          .bdt-related-grid { grid-template-columns: 1fr; }
        }
        .bdt-related-card {
          border: 1px solid rgba(197,160,89,0.25);
          background: #fff;
          text-decoration: none;
          color: inherit;
          display: block;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .bdt-related-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 22px rgba(27,54,93,0.12);
        }
        .bdt-related-img {
          height: 140px;
          background: rgba(27,54,93,0.08);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .bdt-related-img img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .bdt-related-placeholder,
        .bdt-related-placeholder-bg {
          width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center;
          color: rgba(27,54,93,0.4);
        }
        .bdt-related-name {
          margin: 0; padding: 0.85rem 0.9rem 0.45rem;
          font-family: 'Playfair Display', serif;
          color: #1B365D;
          font-size: 1rem;
          line-height: 1.4;
        }
        .bdt-related-date {
          padding: 0 0.9rem 0.9rem;
          font-size: 0.8rem; color: rgba(27,54,93,0.5); font-style: italic; margin: 0;
        }

        .bdt-back-wrap { text-align: center; }
        .bdt-back-btn {
          display: inline-flex; align-items: center; gap: 0.5rem;
          color: #1B365D;
          text-decoration: none;
          border: 1px solid rgba(197,160,89,0.35);
          padding: 0.55rem 1rem;
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .bdt-back-btn:hover {
          background: #1B365D;
          color: #F9F5F0;
          border-color: #1B365D;
        }
      `}</style>
    </main>
  );
}
