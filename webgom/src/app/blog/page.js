import Link from 'next/link';
import { getBlogPosts } from '@/lib/blogApi';

export const metadata = {
  title: 'Tin tức và Blog | Di sản Gốm Việt',
  description: 'Danh sách bài viết được phân loại theo danh mục từ admin.',
};

const FALLBACK_CATEGORIES = [
  { id: 0, name: 'Lịch sử gốm', slug: 'lich-su-gom' },
  { id: 1, name: 'Kỹ thuật chế tác', slug: 'ky-thuat-che-tac' },
  { id: 2, name: 'Nghệ nhân', slug: 'nghe-nhan' },
  { id: 3, name: 'Văn hóa', slug: 'van-hoa' },
  { id: 4, name: 'Sự kiện', slug: 'su-kien' },
];

const FALLBACK_POSTS = [
  {
    id: 1,
    title: 'Di sản gốm trong dòng chảy lịch sử Việt Nam',
    excerpt: 'Tổng hợp các cột mốc quan trọng của gốm Việt.',
    category: { name: 'Lịch sử gốm' },
    featured_image: null,
  },
  {
    id: 2,
    title: 'Quy trình tạo hình thủ công truyền thống',
    excerpt: 'Từ đất thô đến sản phẩm hoàn chỉnh qua nhiều công đoạn.',
    category: { name: 'Kỹ thuật chế tác' },
    featured_image: null,
  },
  {
    id: 3,
    title: 'Chân dung nghệ nhân giữ lửa làng gốm',
    excerpt: 'Câu chuyện về những người gìn giữ hồn gốm sứ.',
    category: { name: 'Nghệ nhân' },
    featured_image: null,
  },
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getPostImage(post) {
  return post?.image || post?.thumbnail || post?.featured_image || null;
}

export default async function BlogPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const activeCategorySlug = resolvedSearchParams?.category || '';

  let posts = [];
  let categories = [];

  try {
    const res = await getBlogPosts({
      per_page: 200,
      ...(activeCategorySlug ? { category_slug: activeCategorySlug } : {}),
    });

    if (Array.isArray(res)) {
      posts = res;
    } else if (Array.isArray(res?.data)) {
      posts = res.data;
    } else if (Array.isArray(res?.data?.data)) {
      posts = res.data.data;
    }

    if (Array.isArray(res?.categories)) {
      categories = res.categories;
    } else if (Array.isArray(res?.data?.categories)) {
      categories = res.data.categories;
    }
  } catch (error) {
    posts = [];
    categories = [];
  }

  if (!posts.length) {
    posts = FALLBACK_POSTS;
  }

  if (!categories.length) {
    categories = FALLBACK_CATEGORIES;
  }

  return (
    <main className="blog-page">
      <div className="container blog-container">
        <nav className="blog-category-nav">
          <Link href="/blog" className={`blog-cat-btn${activeCategorySlug === '' ? ' active' : ''}`}>
            Tất cả
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat.id || cat.slug || cat.name}
              href={`/blog?category=${encodeURIComponent(cat.slug || '')}`}
              className={`blog-cat-btn${activeCategorySlug === (cat.slug || '') ? ' active' : ''}`}
            >
              {cat.name}
            </Link>
          ))}
        </nav>

        <div className="blog-grid">
          {posts.length > 0 ? posts.map((post) => (
            <Link key={post.id} href={`/blog/${post.slug || post.id}`} className="blog-card-link-wrap" aria-label={post.title}>
              <article className="blog-card">
                <div className="blog-card-img">
                  {getPostImage(post) ? (
                    <img src={getPostImage(post)} alt={post.title} className="blog-card-img-el" />
                  ) : (
                    <div className="blog-card-img-placeholder">
                      <span className="material-symbols-outlined">article</span>
                    </div>
                  )}
                </div>
                <div className="blog-card-body">
                  <h3 className="blog-card-title">{post.title}</h3>
                  {post.excerpt && <p className="blog-card-excerpt">{post.excerpt}</p>}
                  <div className="blog-card-footer">
                    <span className="blog-card-time">
                      {post.created_at ? formatDate(post.created_at) : ''}
                    </span>
                    <span className="blog-card-link">
                      Xem thêm <span className="material-symbols-outlined">east</span>
                    </span>
                  </div>
                </div>
              </article>
            </Link>
          )) : (
            <div className="blog-empty">
              <span className="material-symbols-outlined">article</span>
              <p>Không có bài viết nào trong danh mục này.</p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .blog-page { background: #F9F5F0; min-height: 100vh; }
        .blog-container { padding-top: 1.25rem; padding-bottom: 3rem; }

        .blog-category-nav {
          display: flex; flex-wrap: wrap; gap: 0.65rem; justify-content: center;
          padding: 0.9rem 0; margin-bottom: 1.5rem;
          border-top: 1px solid #e2dbd0; border-bottom: 1px solid #e2dbd0;
        }
        .blog-cat-btn {
          padding: 0.45rem 1.4rem; border-radius: 99px; font-weight: 600;
          font-size: 0.85rem; transition: all 0.2s; border: 1px solid #d6cec2;
          background: white; color: #1B365D; cursor: pointer;
        }
        .blog-cat-btn:hover, .blog-cat-btn.active {
          background: #1B365D; color: #F9F5F0; border-color: #1B365D;
        }

        .blog-grid {
          display: grid;
          grid-template-columns: repeat(1, 1fr);
          gap: 2rem;
        }
        @media (min-width: 640px) { .blog-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1024px) { .blog-grid { grid-template-columns: repeat(3, 1fr); } }

        .blog-card-link-wrap {
          display: block;
          color: inherit;
          text-decoration: none;
        }

        .blog-card {
          background: white; display: flex; flex-direction: column;
          border: 1px solid #e9e3da; overflow: hidden;
          box-shadow: 0 2px 8px rgba(27,54,93,0.06);
          transition: box-shadow 0.3s, transform 0.2s;
          height: 100%;
        }
        .blog-card:hover {
          box-shadow: 0 12px 30px rgba(27,54,93,0.12);
          transform: translateY(-3px);
        }
        .blog-card-img {
          position: relative; height: 220px; overflow: hidden;
        }
        .blog-card-img-el {
          width: 100%; height: 100%; object-fit: cover;
          transition: transform 0.5s;
        }
        .blog-card:hover .blog-card-img-el { transform: scale(1.08); }
        .blog-card-img-placeholder {
          width: 100%; height: 100%;
          background: linear-gradient(135deg, #d6cec2, #1B365D 80%);
          display: flex; align-items: center; justify-content: center;
        }
        .blog-card-img-placeholder .material-symbols-outlined {
          font-size: 3rem; color: rgba(249,245,240,0.4);
        }
        .blog-card-body {
          padding: 1.5rem; display: flex; flex-direction: column; flex: 1;
          border-top: 2px solid rgba(197,160,101,0.25);
        }
        .blog-card-title {
          font-family: 'Playfair Display', serif; font-size: 1.1rem; font-weight: 700;
          color: #1B365D; margin: 0 0 0.75rem; line-height: 1.4;
          transition: color 0.2s;
        }
        .blog-card:hover .blog-card-title { color: #C5A065; }
        .blog-card-excerpt {
          font-family: 'EB Garamond', serif; font-size: 0.95rem; color: #64748b;
          margin: 0 0 1rem; flex: 1; font-style: italic; line-height: 1.6;
          display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }
        .blog-card-footer {
          display: flex; align-items: center; justify-content: space-between;
          border-top: 1px solid #f1ede8; padding-top: 1rem; margin-top: auto;
        }
        .blog-card-time { font-size: 0.75rem; color: #94a3b8; }
        .blog-card-link {
          display: inline-flex; align-items: center; gap: 0.25rem;
          font-size: 0.8rem; font-weight: 700; color: #1B365D;
          text-transform: uppercase; letter-spacing: 0.05em; transition: gap 0.2s, color 0.2s;
        }
        .blog-card:hover .blog-card-link { color: #C5A065; gap: 0.5rem; }
        .blog-card-link .material-symbols-outlined { font-size: 1rem; }

        .blog-empty {
          grid-column: 1 / -1; text-align: center; padding: 4rem;
          color: #94a3b8; display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
        }
        .blog-empty .material-symbols-outlined { font-size: 3rem; }
      `}</style>
    </main>
  );
}
