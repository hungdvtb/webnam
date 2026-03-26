import Link from 'next/link';
import { getBlogPosts } from '@/lib/blogApi';
import { resolveMediaUrl } from '@/lib/media';

export const metadata = {
  title: 'Tin tức và Blog | Di sản Gốm Việt',
  description: 'Danh sách bài viết được phân loại theo danh mục từ admin.',
};

const BLOG_POSTS_PER_PAGE = 9;

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
    excerpt: 'Tổng hợp các cột mốc quan trọng của gốm Việt để bạn lướt nhanh và nắm ý chính.',
    category: { name: 'Lịch sử gốm' },
    featured_image: null,
  },
  {
    id: 2,
    title: 'Quy trình tạo hình thủ công truyền thống',
    excerpt: 'Từ đất thô đến sản phẩm hoàn chỉnh qua nhiều công đoạn tinh xảo của làng nghề.',
    category: { name: 'Kỹ thuật chế tác' },
    featured_image: null,
  },
  {
    id: 3,
    title: 'Chân dung nghệ nhân giữ lửa làng gốm',
    excerpt: 'Câu chuyện ngắn về những người giữ hồn gốm sứ qua nhiều thế hệ.',
    category: { name: 'Nghệ nhân' },
    featured_image: null,
  },
];

function formatDate(dateStr) {
  if (!dateStr) return '';

  const date = new Date(dateStr);

  return date.toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'short',
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

function getPostCategory(post) {
  return post?.category?.name || post?.category || post?.tag || 'Kiến thức gốm';
}

function normalizeCategory(category, index) {
  return {
    id: category?.id ?? index,
    name: String(category?.name || '').trim(),
    slug: String(category?.slug || '').trim(),
  };
}

function extractPosts(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function extractCategories(payload) {
  if (Array.isArray(payload?.categories)) return payload.categories;
  if (Array.isArray(payload?.data?.categories)) return payload.data.categories;
  return [];
}

function extractPagination(payload, fallbackPage) {
  const source = payload?.data?.current_page ? payload.data : payload;

  return {
    currentPage: Number(source?.current_page || fallbackPage || 1),
    lastPage: Number(source?.last_page || 1),
    total: Number(source?.total || extractPosts(payload).length || 0),
  };
}

function buildBlogHref({ category = '', page = 1 } = {}) {
  const query = new URLSearchParams();

  if (category) {
    query.set('category', category);
  }

  if (page > 1) {
    query.set('page', String(page));
  }

  const queryString = query.toString();

  return queryString ? `/blog?${queryString}` : '/blog';
}

function buildVisiblePages(currentPage, lastPage) {
  if (lastPage <= 1) {
    return [];
  }

  const pages = new Set([1, lastPage, currentPage - 1, currentPage, currentPage + 1]);

  return Array.from(pages)
    .filter((page) => page >= 1 && page <= lastPage)
    .sort((left, right) => left - right)
    .reduce((items, page) => {
      const previous = items[items.length - 1];

      if (previous && typeof previous === 'number' && page - previous > 1) {
        items.push(`ellipsis-${previous}-${page}`);
      }

      items.push(page);
      return items;
    }, []);
}

export default async function BlogPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const activeCategorySlug = String(resolvedSearchParams?.category || '').trim();
  const currentPage = Math.max(1, Number.parseInt(String(resolvedSearchParams?.page || '1'), 10) || 1);

  let posts = [];
  let categories = [];
  let pagination = { currentPage, lastPage: 1, total: 0 };
  let apiLoaded = false;

  try {
    const response = await getBlogPosts({
      per_page: BLOG_POSTS_PER_PAGE,
      page: currentPage,
      ...(activeCategorySlug ? { category_slug: activeCategorySlug } : {}),
    });

    posts = extractPosts(response);
    categories = extractCategories(response);
    pagination = extractPagination(response, currentPage);
    apiLoaded = response?.__ok !== false;
  } catch {
    posts = [];
    categories = [];
    pagination = { currentPage, lastPage: 1, total: 0 };
    apiLoaded = false;
  }

  if (!apiLoaded && !activeCategorySlug && currentPage === 1) {
    posts = FALLBACK_POSTS;
  }

  if (!categories.length) {
    categories = FALLBACK_CATEGORIES;
  }

  const normalizedCategories = categories
    .map(normalizeCategory)
    .filter((category) => category.name && category.slug)
    .filter((category, index, list) => list.findIndex((item) => item.slug === category.slug) === index);

  const visiblePages = buildVisiblePages(pagination.currentPage, pagination.lastPage);
  const hasFilters = Boolean(activeCategorySlug);

  return (
    <main className="blog-page">
      <div className="container blog-container">
        <section className="blog-header">
          <div className="blog-title-wrap">
            <h1 className="blog-title">Kiến thức gốm</h1>
            <p className="blog-subtitle">Khám phá bài viết từ hệ thống admin theo từng danh mục nội dung.</p>
          </div>

          <nav className="blog-category-nav" aria-label="Danh mục blog">
            <Link
              href={buildBlogHref()}
              aria-current={activeCategorySlug === '' ? 'page' : undefined}
              className={`blog-cat-btn${activeCategorySlug === '' ? ' active' : ''}`}
            >
              Tất cả
            </Link>

            {normalizedCategories.map((category) => (
              <Link
                key={category.id || category.slug || category.name}
                href={buildBlogHref({ category: category.slug })}
                aria-current={activeCategorySlug === category.slug ? 'page' : undefined}
                className={`blog-cat-btn${activeCategorySlug === category.slug ? ' active' : ''}`}
              >
                {category.name}
              </Link>
            ))}
          </nav>
        </section>

        <section className="blog-posts" aria-label="Danh sách bài viết">
          {posts.length > 0 ? posts.map((post) => {
            const image = getPostImage(post);
            const categoryName = getPostCategory(post);
            const postHref = `/blog/${post.slug || post.id}`;

            return (
              <Link
                key={post.id || post.slug || post.title}
                href={postHref}
                className="blog-post-link-wrap"
                aria-label={post.title}
              >
                <article className="blog-post-card">
                  <div className="blog-post-thumb">
                    {image ? (
                      <img
                        src={image}
                        alt={post.title}
                        className="blog-post-image"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="blog-post-placeholder">
                        <span className="material-symbols-outlined">article</span>
                      </div>
                    )}
                  </div>

                  <div className="blog-post-body">
                    <div className="blog-post-meta">
                      <span className="blog-post-category">{categoryName}</span>
                      {post.created_at ? (
                        <time className="blog-post-date">{formatDate(post.created_at)}</time>
                      ) : null}
                    </div>

                    <h2 className="blog-post-title">{post.title}</h2>

                    {post.excerpt ? (
                      <p className="blog-post-excerpt">{post.excerpt}</p>
                    ) : null}

                    <div className="blog-post-footer">
                      <span className="blog-post-cta">
                        Đọc bài
                        <span className="material-symbols-outlined">arrow_outward</span>
                      </span>
                    </div>
                  </div>
                </article>
              </Link>
            );
          }) : (
            <div className="blog-empty">
              <span className="material-symbols-outlined">article</span>
              <p>
                {hasFilters
                  ? 'Không tìm thấy bài viết phù hợp với bộ lọc hiện tại.'
                  : 'Không có bài viết nào trong danh mục này.'}
              </p>
            </div>
          )}
        </section>

        {pagination.lastPage > 1 ? (
          <nav className="blog-pagination" aria-label="Phân trang bài viết">
            <Link
              href={buildBlogHref({
                category: activeCategorySlug,
                page: Math.max(1, pagination.currentPage - 1),
              })}
              aria-disabled={pagination.currentPage <= 1}
              className={`blog-page-btn blog-page-arrow${pagination.currentPage <= 1 ? ' is-disabled' : ''}`}
              tabIndex={pagination.currentPage <= 1 ? -1 : undefined}
            >
              <span className="material-symbols-outlined">chevron_left</span>
              Trước
            </Link>

            <div className="blog-page-numbers">
              {visiblePages.map((item) => (
                typeof item === 'number' ? (
                  <Link
                    key={item}
                    href={buildBlogHref({
                      category: activeCategorySlug,
                      page: item,
                    })}
                    aria-current={item === pagination.currentPage ? 'page' : undefined}
                    className={`blog-page-btn${item === pagination.currentPage ? ' active' : ''}`}
                  >
                    {item}
                  </Link>
                ) : (
                  <span key={item} className="blog-page-ellipsis" aria-hidden="true">…</span>
                )
              ))}
            </div>

            <Link
              href={buildBlogHref({
                category: activeCategorySlug,
                page: Math.min(pagination.lastPage, pagination.currentPage + 1),
              })}
              aria-disabled={pagination.currentPage >= pagination.lastPage}
              className={`blog-page-btn blog-page-arrow${pagination.currentPage >= pagination.lastPage ? ' is-disabled' : ''}`}
              tabIndex={pagination.currentPage >= pagination.lastPage ? -1 : undefined}
            >
              Sau
              <span className="material-symbols-outlined">chevron_right</span>
            </Link>
          </nav>
        ) : null}
      </div>

      <style>{`
        .blog-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at top left, rgba(197, 160, 101, 0.12), transparent 32%),
            linear-gradient(180deg, #f9f5f0 0%, #fdfbf7 44%, #f4eee5 100%);
        }

        .blog-container {
          padding-top: 1rem;
          padding-bottom: 2.5rem;
        }

        .blog-header {
          margin-bottom: 1.15rem;
          padding-top: 0.1rem;
        }

        .blog-title-wrap {
          margin-bottom: 0.9rem;
        }

        .blog-title {
          margin: 0 0 0.35rem;
          color: var(--primary);
          font-size: clamp(1.6rem, 4.8vw, 2.35rem);
          line-height: 1.08;
        }

        .blog-subtitle {
          margin: 0;
          color: #5f6f83;
          font-family: var(--font-sans);
          font-size: 0.95rem;
          line-height: 1.55;
        }

        .blog-category-nav {
          display: flex;
          gap: 0.65rem;
          overflow-x: auto;
          padding: 0.05rem 0 0.4rem;
          scrollbar-width: none;
          scroll-snap-type: x proximity;
          -webkit-overflow-scrolling: touch;
        }

        .blog-category-nav::-webkit-scrollbar {
          display: none;
        }

        .blog-cat-btn {
          flex: 0 0 auto;
          scroll-snap-align: start;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 2.55rem;
          padding: 0.62rem 1rem;
          border: 1px solid rgba(27, 54, 93, 0.1);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 8px 20px rgba(27, 54, 93, 0.05);
          color: var(--primary);
          font-family: var(--font-sans);
          font-size: 0.84rem;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
          transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease;
        }

        .blog-cat-btn:hover,
        .blog-cat-btn.active {
          border-color: var(--primary);
          background: var(--primary);
          color: var(--white);
          transform: translateY(-1px);
        }

        .blog-posts {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 0.8rem;
        }

        .blog-post-link-wrap {
          display: block;
          color: inherit;
          text-decoration: none;
        }

        .blog-post-link-wrap:focus-visible {
          outline: none;
        }

        .blog-post-card {
          display: grid;
          grid-template-columns: 88px minmax(0, 1fr);
          align-items: stretch;
          gap: 0.85rem;
          min-height: 118px;
          padding: 0.78rem;
          border: 1px solid rgba(27, 54, 93, 0.08);
          border-radius: 1.15rem;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 14px 28px rgba(27, 54, 93, 0.06);
          transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
        }

        .blog-post-link-wrap:hover .blog-post-card {
          transform: translateY(-2px);
          border-color: rgba(197, 160, 101, 0.45);
          box-shadow: 0 18px 34px rgba(27, 54, 93, 0.1);
        }

        .blog-post-link-wrap:focus-visible .blog-post-card {
          border-color: rgba(197, 160, 101, 0.85);
          box-shadow: 0 0 0 3px rgba(197, 160, 101, 0.18);
        }

        .blog-post-thumb {
          position: relative;
          width: 88px;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          border-radius: 0.95rem;
          background: linear-gradient(135deg, rgba(197, 160, 101, 0.18), rgba(27, 54, 93, 0.16));
        }

        .blog-post-image,
        .blog-post-placeholder {
          width: 100%;
          height: 100%;
        }

        .blog-post-image {
          display: block;
          object-fit: cover;
          transition: transform 0.3s ease;
        }

        .blog-post-link-wrap:hover .blog-post-image {
          transform: scale(1.04);
        }

        .blog-post-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, rgba(197, 160, 101, 0.22), rgba(27, 54, 93, 0.82));
        }

        .blog-post-placeholder .material-symbols-outlined {
          font-size: 2rem;
          color: rgba(255, 255, 255, 0.56);
        }

        .blog-post-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.42rem;
        }

        .blog-post-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.4rem 0.55rem;
          font-family: var(--font-sans);
          font-size: 0.72rem;
          line-height: 1.2;
          color: #62748a;
        }

        .blog-post-category {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          padding: 0.24rem 0.52rem;
          border-radius: 999px;
          background: rgba(27, 54, 93, 0.07);
          color: var(--primary);
          font-weight: 700;
          white-space: nowrap;
        }

        .blog-post-date {
          white-space: nowrap;
        }

        .blog-post-title {
          margin: 0;
          color: var(--primary);
          font-size: 1rem;
          line-height: 1.32;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          overflow: hidden;
        }

        .blog-post-excerpt {
          margin: 0;
          color: var(--text-muted);
          font-family: var(--font-sans);
          font-size: 0.86rem;
          line-height: 1.45;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          line-clamp: 2;
          overflow: hidden;
        }

        .blog-post-footer {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          min-height: 1.35rem;
        }

        .blog-post-cta {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          color: var(--primary);
          font-family: var(--font-sans);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .blog-post-cta .material-symbols-outlined {
          font-size: 0.95rem;
          transition: transform 0.2s ease;
        }

        .blog-post-link-wrap:hover .blog-post-cta {
          color: var(--accent-dark);
        }

        .blog-post-link-wrap:hover .blog-post-cta .material-symbols-outlined {
          transform: translate(2px, -2px);
        }

        .blog-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          padding: 3rem 1rem;
          border: 1px dashed rgba(27, 54, 93, 0.18);
          border-radius: 1.25rem;
          color: #708090;
          text-align: center;
          background: rgba(255, 255, 255, 0.68);
        }

        .blog-empty .material-symbols-outlined {
          font-size: 2.75rem;
          color: rgba(27, 54, 93, 0.32);
        }

        .blog-pagination {
          margin-top: 1.15rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          flex-wrap: wrap;
        }

        .blog-page-numbers {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: wrap;
          justify-content: center;
        }

        .blog-page-btn,
        .blog-page-ellipsis {
          min-width: 2.65rem;
          min-height: 2.65rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 0.9rem;
          font-family: var(--font-sans);
          font-size: 0.85rem;
          font-weight: 700;
        }

        .blog-page-btn {
          padding: 0.72rem 0.9rem;
          border: 1px solid rgba(27, 54, 93, 0.1);
          background: rgba(255, 255, 255, 0.94);
          color: var(--primary);
          box-shadow: 0 10px 20px rgba(27, 54, 93, 0.05);
          transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease;
        }

        .blog-page-btn:hover {
          transform: translateY(-1px);
          border-color: rgba(197, 160, 101, 0.45);
        }

        .blog-page-btn.active {
          border-color: var(--primary);
          background: var(--primary);
          color: var(--white);
        }

        .blog-page-arrow {
          gap: 0.1rem;
          min-width: auto;
        }

        .blog-page-arrow.is-disabled {
          pointer-events: none;
          opacity: 0.45;
        }

        .blog-page-ellipsis {
          color: #6b7d92;
        }

        @media (max-width: 639px) {
          .blog-title-wrap {
            display: none;
          }
        }

        @media (max-width: 389px) {
          .blog-post-card {
            grid-template-columns: 80px minmax(0, 1fr);
            gap: 0.72rem;
            min-height: 108px;
            padding: 0.7rem;
          }

          .blog-post-thumb {
            width: 80px;
          }

          .blog-post-title {
            font-size: 0.95rem;
          }

          .blog-post-excerpt {
            -webkit-line-clamp: 1;
            line-clamp: 1;
            font-size: 0.82rem;
          }
        }

        @media (min-width: 640px) {
          .blog-container {
            padding-top: 1.25rem;
          }

          .blog-header {
            margin-bottom: 1.15rem;
          }

          .blog-posts {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1rem;
          }

          .blog-post-card {
            grid-template-columns: 104px minmax(0, 1fr);
            min-height: 132px;
            padding: 0.88rem;
          }

          .blog-post-thumb {
            width: 104px;
          }
        }

        @media (min-width: 1200px) {
          .blog-container {
            padding-top: 1.4rem;
            padding-bottom: 3rem;
          }

          .blog-posts {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1.2rem;
          }

          .blog-post-card {
            grid-template-columns: minmax(0, 1fr);
            gap: 0;
            min-height: 100%;
            padding: 0;
            overflow: hidden;
          }

          .blog-post-thumb {
            width: 100%;
            border-radius: 0;
            aspect-ratio: 16 / 10;
          }

          .blog-post-body {
            gap: 0.6rem;
            padding: 1rem 1rem 1.05rem;
          }

          .blog-post-title {
            font-size: 1.08rem;
          }

          .blog-post-excerpt {
            -webkit-line-clamp: 3;
            line-clamp: 3;
          }
        }
      `}</style>
    </main>
  );
}
