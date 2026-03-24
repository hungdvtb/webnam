import Link from 'next/link';
import { getBlogPosts } from '@/lib/blogApi';

export const metadata = {
  title: 'Tin tức và Blog | Di sản Gốm Việt',
  description: 'Danh sách bài viết được phân loại theo danh mục từ admin.',
};

const DEFAULT_CATEGORY_LABEL = 'Kiến thức gốm';
const CATEGORY_TOKEN_STOP_WORDS = new Set(['cua', 'cac', 'cacs', 'va', 'cho', 'the', 'mot', 'nhung', 'trong']);
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
    excerpt: 'Tổng hợp các cột mốc quan trọng của gốm Việt với cách kể ngắn gọn, dễ theo dõi trên di động.',
    category: { name: 'Lịch sử gốm' },
    created_at: '2026-03-12T08:00:00.000Z',
    featured_image: null,
  },
  {
    id: 2,
    title: 'Quy trình tạo hình thủ công truyền thống',
    excerpt: 'Từ đất thô đến sản phẩm hoàn chỉnh qua nhiều công đoạn và bí quyết giữ hồn gốm.',
    category: { name: 'Kỹ thuật chế tác' },
    created_at: '2026-03-10T08:00:00.000Z',
    featured_image: null,
  },
  {
    id: 3,
    title: 'Chân dung nghệ nhân giữ lửa làng gốm',
    excerpt: 'Những câu chuyện về con người, kỹ nghệ và niềm tự hào phía sau từng lớp men.',
    category: { name: 'Nghệ nhân' },
    created_at: '2026-03-08T08:00:00.000Z',
    featured_image: null,
  },
];

function stripHtml(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeSearch(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getExcerpt(post) {
  const content = String(post?.excerpt || '').trim() || stripHtml(post?.content || post?.body || '');

  if (!content) {
    return 'Nội dung đang được cập nhật. Chạm để xem chi tiết bài viết.';
  }

  return content.length > 168 ? `${content.slice(0, 165).trim()}...` : content;
}

function formatDate(value) {
  if (!value) return 'Đang cập nhật';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Đang cập nhật';
  }

  return date.toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

function extractCategories(res) {
  if (Array.isArray(res?.categories)) return res.categories;
  if (Array.isArray(res?.data?.categories)) return res.data.categories;
  return [];
}

function getCategoryName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value?.name || '').trim();
}

function resolveCategoryLabel(post, categoriesById) {
  const directCategory =
    getCategoryName(post?.category) ||
    String(post?.category_name || '').trim() ||
    String(post?.blog_category?.name || '').trim();

  if (directCategory) {
    return directCategory;
  }

  return categoriesById.get(String(post?.blog_category_id)) || DEFAULT_CATEGORY_LABEL;
}

function sanitizeCategories(categories) {
  return categories.filter((category) => String(category?.name || '').trim() && String(category?.slug || '').trim());
}

function buildCategoryKeywordCandidates(category) {
  const phrases = new Set();
  const addPhrase = (value) => {
    const normalized = normalizeSearch(value);
    if (normalized && normalized.length >= 6) {
      phrases.add(normalized);
    }
  };

  addPhrase(category?.name);
  addPhrase(String(category?.slug || '').replace(/-/g, ' '));

  [category?.name, String(category?.slug || '').replace(/-/g, ' ')].forEach((value) => {
    const tokens = normalizeSearch(value)
      .split(' ')
      .filter(Boolean);

    for (let size = 2; size <= Math.min(3, tokens.length); size += 1) {
      for (let index = 0; index <= tokens.length - size; index += 1) {
        const slice = tokens.slice(index, index + size);
        const hasMeaningfulToken = slice.some((token) => !CATEGORY_TOKEN_STOP_WORDS.has(token) && token.length >= 3);

        if (hasMeaningfulToken) {
          phrases.add(slice.join(' '));
        }
      }
    }
  });

  return Array.from(phrases);
}

function buildUniqueCategoryKeywords(categories) {
  const keywordsBySlug = new Map();
  const phraseFrequency = new Map();

  categories.forEach((category) => {
    const slug = String(category?.slug || '').trim();
    const candidates = buildCategoryKeywordCandidates(category);

    keywordsBySlug.set(slug, candidates);
    candidates.forEach((phrase) => {
      phraseFrequency.set(phrase, (phraseFrequency.get(phrase) || 0) + 1);
    });
  });

  return new Map(
    Array.from(keywordsBySlug.entries()).map(([slug, candidates]) => [
      slug,
      candidates
        .filter((phrase) => phraseFrequency.get(phrase) === 1)
        .sort((left, right) => right.length - left.length),
    ]),
  );
}

function postMatchesCategory(post, category) {
  const normalizedCategoryName = normalizeSearch(category?.name);
  const normalizedCategorySlug = normalizeSearch(String(category?.slug || '').replace(/-/g, ' '));

  if (String(post?.blog_category_id || '').trim() && String(post.blog_category_id) === String(category?.id)) {
    return true;
  }

  const categoryValue = post?.category;

  if (categoryValue && typeof categoryValue === 'object') {
    if (String(categoryValue?.id || '').trim() && String(categoryValue.id) === String(category?.id)) {
      return true;
    }

    if (normalizeSearch(categoryValue?.name) === normalizedCategoryName) {
      return true;
    }

    if (normalizeSearch(String(categoryValue?.slug || '').replace(/-/g, ' ')) === normalizedCategorySlug) {
      return true;
    }
  }

  if (typeof categoryValue === 'string' && normalizeSearch(categoryValue) === normalizedCategoryName) {
    return true;
  }

  return normalizeSearch(post?.category_name) === normalizedCategoryName;
}

function filterPostsByCategory(posts, category, categoryKeywords) {
  if (!category) return posts;

  const explicitlyMatchedPosts = posts.filter((post) => postMatchesCategory(post, category));

  if (explicitlyMatchedPosts.length > 0) {
    return explicitlyMatchedPosts;
  }

  const keywords = categoryKeywords.get(String(category.slug)) || [];

  if (!keywords.length) {
    return [];
  }

  return posts.filter((post) => {
    const searchableText = normalizeSearch(`${post?.title || ''} ${post?.excerpt || ''}`);
    return keywords.some((keyword) => searchableText.includes(keyword));
  });
}

export default async function BlogPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const activeCategorySlug = String(resolvedSearchParams?.category || '').trim();

  let allPosts = [];
  let categories = [];

  try {
    const response = await getBlogPosts({
      per_page: 200,
    });

    allPosts = extractPosts(response);
    categories = extractCategories(response);
  } catch (error) {
    allPosts = [];
    categories = [];
  }

  if (!allPosts.length && !activeCategorySlug) {
    allPosts = FALLBACK_POSTS;
  }

  if (!categories.length) {
    categories = FALLBACK_CATEGORIES;
  }

  const navigableCategories = sanitizeCategories(categories);
  const activeCategory = navigableCategories.find((category) => String(category.slug) === activeCategorySlug) || null;
  const categoryKeywords = buildUniqueCategoryKeywords(navigableCategories);
  const categoriesById = new Map(
    categories
      .filter((category) => String(category?.id ?? '').trim() !== '' && String(category?.name || '').trim())
      .map((category) => [String(category.id), String(category.name || '').trim()]),
  );
  const visiblePosts = activeCategory ? filterPostsByCategory(allPosts, activeCategory, categoryKeywords) : allPosts;
  const activeCategoryLabel = activeCategorySlug
    ? activeCategory?.name || 'Chủ đề đã chọn'
    : 'Tất cả bài viết';

  return (
    <main className="blog-page">
      <section className="blog-hero">
        <div className="container blog-hero__inner">
          <div className="blog-hero__copy">
            <span className="blog-hero__eyebrow">Kiến thức gốm</span>
            <h1 className="blog-hero__title">Blog gọn gàng, dễ đọc và thuận tay hơn trên mobile.</h1>
            <p className="blog-hero__description">
              Chọn nhanh theo chuyên mục, lướt từng bài viết trong một cột rõ ràng trên điện thoại và vẫn giữ bố cục
              rộng rãi khi xem trên màn hình lớn.
            </p>
          </div>

          <div className="blog-hero__stats" aria-label="Tổng quan blog">
            <div className="blog-stat-card">
              <span className="blog-stat-card__label">Bài viết</span>
              <strong className="blog-stat-card__value">{visiblePosts.length}</strong>
            </div>
            <div className="blog-stat-card">
              <span className="blog-stat-card__label">Chuyên mục</span>
              <strong className="blog-stat-card__value">{navigableCategories.length || 1}</strong>
            </div>
            <div className="blog-stat-card blog-stat-card--highlight">
              <span className="blog-stat-card__label">Đang xem</span>
              <strong className="blog-stat-card__value blog-stat-card__value--topic">{activeCategoryLabel}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="container blog-toolbar">
        <div className="blog-toolbar__head">
          <div className="blog-toolbar__copy">
            <span className="blog-toolbar__eyebrow">Lọc bài viết</span>
            <h2 className="blog-toolbar__title">Thanh lọc ngang dễ bấm trên điện thoại.</h2>
            <p className="blog-toolbar__description">
              Các nút được kéo ngang theo từng chủ đề để giữ bố cục gọn, không bị xuống dòng và không làm chật phần
              danh sách bài viết.
            </p>
          </div>

          <div className="blog-toolbar__count">{visiblePosts.length} bài viết</div>
        </div>

        <nav className="blog-category-nav" aria-label="Danh mục blog">
          <Link
            href="/blog"
            aria-current={activeCategorySlug === '' ? 'page' : undefined}
            className={`blog-cat-btn${activeCategorySlug === '' ? ' active' : ''}`}
          >
            Tất cả
          </Link>

          {navigableCategories.map((category) => (
            <Link
              key={category.id || category.slug || category.name}
              href={`/blog?category=${encodeURIComponent(category.slug)}`}
              aria-current={activeCategorySlug === String(category.slug) ? 'page' : undefined}
              className={`blog-cat-btn${activeCategorySlug === String(category.slug) ? ' active' : ''}`}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      </section>

      <section className="container blog-list-section">
        {visiblePosts.length > 0 ? (
          <div className="blog-grid">
            {visiblePosts.map((post) => {
              const categoryLabel = resolveCategoryLabel(post, categoriesById);

              return (
                <Link
                  key={post.id || post.slug || post.title}
                  href={`/blog/${post.slug || post.id}`}
                  className="blog-card-link-wrap"
                  aria-label={post.title}
                >
                  <article className="blog-card">
                    <div className="blog-card-img">
                      {getPostImage(post) ? (
                        <img
                          src={getPostImage(post)}
                          alt={post.title}
                          className="blog-card-img-el"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="blog-card-img-placeholder">
                          <span className="material-symbols-outlined">article</span>
                        </div>
                      )}

                      <span className="blog-card-category">{categoryLabel}</span>
                    </div>

                    <div className="blog-card-body">
                      <div className="blog-card-meta">
                        <span className="material-symbols-outlined">schedule</span>
                        <span>{formatDate(post.published_at || post.created_at)}</span>
                      </div>

                      <h3 className="blog-card-title">{post.title}</h3>

                      <p className="blog-card-excerpt">{getExcerpt(post)}</p>

                      <div className="blog-card-footer">
                        <span className="blog-card-link">
                          Xem thêm
                          <span className="material-symbols-outlined">east</span>
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="blog-empty">
            <span className="material-symbols-outlined">article</span>
            <h3>Chưa có bài viết phù hợp</h3>
            <p>
              Hiện chưa có nội dung trong nhóm <strong>{activeCategoryLabel}</strong>. Hãy thử quay lại mục tất cả bài
              viết hoặc chọn một chủ đề khác.
            </p>
          </div>
        )}
      </section>

      <style>{`
        .blog-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at top right, rgba(197, 160, 101, 0.18), transparent 34%),
            linear-gradient(180deg, #fdfbf7 0%, #f7f2eb 100%);
          padding-bottom: 3.5rem;
        }

        .blog-hero {
          position: relative;
          overflow: hidden;
          border-bottom: 1px solid rgba(197, 160, 101, 0.16);
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.94) 0%, rgba(249, 245, 240, 0.9) 100%);
        }

        .blog-hero::after {
          content: '';
          position: absolute;
          inset: auto -10% -56px auto;
          width: 220px;
          height: 220px;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(27, 54, 93, 0.09) 0%, rgba(27, 54, 93, 0) 72%);
          pointer-events: none;
        }

        .blog-hero__inner {
          position: relative;
          z-index: 1;
          display: grid;
          gap: 1.25rem;
          padding-top: 1.25rem;
          padding-bottom: 1.5rem;
        }

        .blog-hero__copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }

        .blog-hero__eyebrow,
        .blog-toolbar__eyebrow {
          display: inline-flex;
          align-items: center;
          align-self: flex-start;
          min-height: 32px;
          padding: 0.35rem 0.85rem;
          border: 1px solid rgba(197, 160, 101, 0.24);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.8);
          color: #1b365d;
          font-family: var(--font-sans);
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          box-shadow: 0 8px 20px rgba(27, 54, 93, 0.06);
        }

        .blog-hero__title {
          margin: 0;
          max-width: 13.5ch;
          color: #1b365d;
          font-family: var(--font-display);
          font-size: clamp(2rem, 7vw, 3.8rem);
          font-weight: 700;
          line-height: 1.04;
          text-wrap: balance;
        }

        .blog-hero__description,
        .blog-toolbar__description {
          max-width: 62ch;
          color: rgba(27, 54, 93, 0.78);
          font-size: 1rem;
          line-height: 1.72;
        }

        .blog-hero__stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.85rem;
        }

        .blog-stat-card {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          padding: 1rem;
          border: 1px solid rgba(197, 160, 101, 0.16);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 16px 34px rgba(27, 54, 93, 0.08);
        }

        .blog-stat-card--highlight {
          grid-column: 1 / -1;
          background: linear-gradient(135deg, #1b365d 0%, #2a4a7a 100%);
          color: #fff;
        }

        .blog-stat-card__label {
          color: rgba(27, 54, 93, 0.62);
          font-family: var(--font-sans);
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .blog-stat-card--highlight .blog-stat-card__label {
          color: rgba(255, 255, 255, 0.72);
        }

        .blog-stat-card__value {
          color: #1b365d;
          font-family: var(--font-display);
          font-size: clamp(1.45rem, 5vw, 2.1rem);
          font-weight: 700;
          line-height: 1.1;
        }

        .blog-stat-card__value--topic {
          color: #fff;
          font-size: clamp(1.1rem, 4vw, 1.55rem);
          line-height: 1.25;
          overflow-wrap: anywhere;
        }

        .blog-toolbar {
          padding-top: 1.35rem;
          padding-bottom: 0.6rem;
        }

        .blog-toolbar__head {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(197, 160, 101, 0.14);
        }

        .blog-toolbar__copy {
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
          min-width: 0;
        }

        .blog-toolbar__title {
          margin: 0;
          color: #1b365d;
          font-family: var(--font-display);
          font-size: clamp(1.6rem, 5vw, 2.2rem);
          line-height: 1.15;
        }

        .blog-toolbar__count {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          min-height: 42px;
          padding: 0 1rem;
          border: 1px solid rgba(197, 160, 101, 0.22);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          color: #1b365d;
          font-family: var(--font-sans);
          font-size: 0.8rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          box-shadow: 0 10px 20px rgba(27, 54, 93, 0.06);
        }

        .blog-category-nav {
          display: flex;
          gap: 0.75rem;
          margin-top: 1rem;
          padding-bottom: 0.35rem;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          scroll-snap-type: x proximity;
          scrollbar-width: thin;
          scrollbar-color: rgba(197, 160, 101, 0.55) transparent;
        }

        .blog-category-nav::-webkit-scrollbar {
          height: 6px;
        }

        .blog-category-nav::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(197, 160, 101, 0.45);
        }

        .blog-cat-btn {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 46px;
          padding: 0.65rem 1rem;
          border: 1px solid rgba(197, 160, 101, 0.22);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          color: #1b365d;
          font-family: var(--font-sans);
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          line-height: 1.2;
          text-transform: uppercase;
          white-space: nowrap;
          scroll-snap-align: start;
          box-shadow: 0 10px 22px rgba(27, 54, 93, 0.05);
          transition:
            background-color 180ms ease,
            color 180ms ease,
            border-color 180ms ease,
            transform 180ms ease,
            box-shadow 180ms ease;
        }

        .blog-cat-btn:hover,
        .blog-cat-btn:focus-visible,
        .blog-cat-btn.active {
          background: #1b365d;
          color: #fdfbf7;
          border-color: #1b365d;
          box-shadow: 0 16px 28px rgba(27, 54, 93, 0.16);
          outline: none;
        }

        .blog-list-section {
          padding-top: 1rem;
          padding-bottom: 0.5rem;
        }

        .blog-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.2rem;
        }

        .blog-card-link-wrap {
          display: block;
          color: inherit;
          text-decoration: none;
        }

        .blog-card {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(197, 160, 101, 0.16);
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 18px 40px rgba(27, 54, 93, 0.08);
          transition:
            transform 220ms ease,
            box-shadow 220ms ease,
            border-color 220ms ease;
        }

        .blog-card:hover,
        .blog-card-link-wrap:focus-visible .blog-card {
          transform: translateY(-3px);
          border-color: rgba(197, 160, 101, 0.34);
          box-shadow: 0 24px 48px rgba(27, 54, 93, 0.12);
        }

        .blog-card-img {
          position: relative;
          aspect-ratio: 16 / 10.8;
          overflow: hidden;
          background: linear-gradient(135deg, rgba(245, 241, 234, 1) 0%, rgba(27, 54, 93, 0.12) 100%);
        }

        .blog-card-img::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(15, 23, 42, 0.02) 0%, rgba(15, 23, 42, 0.18) 100%);
          pointer-events: none;
        }

        .blog-card-img-el {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          object-position: center;
          transition: transform 420ms ease;
        }

        .blog-card:hover .blog-card-img-el {
          transform: scale(1.04);
        }

        .blog-card-img-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.74);
          background: linear-gradient(135deg, #c5a065 0%, #1b365d 100%);
        }

        .blog-card-img-placeholder .material-symbols-outlined {
          font-size: 3rem;
        }

        .blog-card-category {
          position: absolute;
          left: 0.9rem;
          top: 0.9rem;
          z-index: 1;
          max-width: calc(100% - 1.8rem);
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0.35rem 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.5);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.92);
          color: #1b365d;
          font-family: var(--font-sans);
          font-size: 0.65rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          line-height: 1.2;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.12);
        }

        .blog-card-body {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
          padding: 1rem;
        }

        .blog-card-meta {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          min-width: 0;
          color: rgba(27, 54, 93, 0.68);
          font-family: var(--font-sans);
          font-size: 0.8rem;
          font-weight: 700;
          line-height: 1.35;
        }

        .blog-card-meta .material-symbols-outlined {
          font-size: 1rem;
          flex-shrink: 0;
          color: #c5a065;
        }

        .blog-card-title {
          margin: 0;
          color: #1b365d;
          font-family: var(--font-display);
          font-size: clamp(1.32rem, 4vw, 1.55rem);
          font-weight: 700;
          line-height: 1.22;
          overflow-wrap: anywhere;
          transition: color 180ms ease;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .blog-card:hover .blog-card-title {
          color: #a64b2a;
        }

        .blog-card-excerpt {
          margin: 0;
          flex: 1;
          color: rgba(27, 54, 93, 0.76);
          font-size: 1rem;
          line-height: 1.72;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .blog-card-footer {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-start;
          gap: 0.75rem;
          padding-top: 0.95rem;
          border-top: 1px solid rgba(197, 160, 101, 0.14);
        }

        .blog-card-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          min-height: 42px;
          padding: 0.65rem 0.95rem;
          border-radius: 999px;
          background: rgba(27, 54, 93, 0.08);
          color: #1b365d;
          font-family: var(--font-sans);
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          line-height: 1.2;
          text-transform: uppercase;
          transition:
            background-color 180ms ease,
            color 180ms ease,
            gap 180ms ease;
        }

        .blog-card:hover .blog-card-link {
          background: #1b365d;
          color: #fff;
          gap: 0.5rem;
        }

        .blog-card-link .material-symbols-outlined {
          font-size: 1rem;
        }

        .blog-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.9rem;
          padding: 2.2rem 1.25rem;
          border: 1px dashed rgba(197, 160, 101, 0.34);
          border-radius: 28px;
          background: rgba(255, 255, 255, 0.86);
          text-align: center;
          box-shadow: 0 16px 34px rgba(27, 54, 93, 0.06);
        }

        .blog-empty .material-symbols-outlined {
          font-size: 2.7rem;
          color: #c5a065;
        }

        .blog-empty h3 {
          margin: 0;
          color: #1b365d;
          font-family: var(--font-display);
          font-size: 1.8rem;
        }

        .blog-empty p {
          max-width: 36rem;
          margin: 0;
          color: rgba(27, 54, 93, 0.76);
          font-size: 1rem;
          line-height: 1.72;
        }

        .blog-empty strong {
          color: #1b365d;
        }

        @media (min-width: 768px) {
          .blog-hero__inner {
            grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
            align-items: end;
            gap: 1.5rem;
            padding-top: 1.6rem;
            padding-bottom: 1.9rem;
          }

          .blog-toolbar__head {
            flex-direction: row;
            align-items: end;
            justify-content: space-between;
          }

          .blog-toolbar__count {
            align-self: auto;
            flex-shrink: 0;
          }

          .blog-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1.35rem;
          }

          .blog-card-body {
            padding: 1.2rem;
          }
        }

        @media (min-width: 1080px) {
          .blog-hero__inner {
            padding-top: 2rem;
            padding-bottom: 2.2rem;
          }

          .blog-toolbar {
            padding-top: 1.7rem;
          }

          .blog-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 1.5rem;
          }
        }

        @media (max-width: 767px) {
          .blog-page {
            padding-bottom: 2.4rem;
          }

          .blog-hero__description,
          .blog-toolbar__description {
            font-size: 0.97rem;
            line-height: 1.68;
          }

          .blog-category-nav {
            margin-right: -0.1rem;
            margin-left: -0.1rem;
            padding-right: 0.1rem;
            padding-left: 0.1rem;
          }

          .blog-cat-btn {
            padding-right: 0.9rem;
            padding-left: 0.9rem;
          }

          .blog-card-link {
            width: 100%;
          }
        }

        @media (max-width: 420px) {
          .blog-hero__inner {
            gap: 1rem;
            padding-top: 1rem;
            padding-bottom: 1.25rem;
          }

          .blog-stat-card {
            padding: 0.9rem;
            border-radius: 20px;
          }

          .blog-toolbar {
            padding-top: 1.1rem;
          }

          .blog-toolbar__head {
            gap: 0.85rem;
          }

          .blog-card {
            border-radius: 20px;
          }

          .blog-card-category {
            left: 0.75rem;
            top: 0.75rem;
            max-width: calc(100% - 1.5rem);
          }

          .blog-card-body {
            gap: 0.72rem;
            padding: 0.95rem;
          }

          .blog-card-excerpt {
            font-size: 0.96rem;
          }

          .blog-card-footer {
            align-items: stretch;
          }
        }
      `}</style>
    </main>
  );
}
