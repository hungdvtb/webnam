import Link from 'next/link';
import { getBlogPost } from '@/lib/blogApi';

export const metadata = {
  title: 'Chính sách & Quy định | Di Sản Gốm Việt',
  description:
    'Chính sách bán hàng, vận chuyển, đổi trả và bảo mật thông tin tại Di Sản Gốm Việt. Cam kết minh bạch và chất lượng trong mọi giao dịch.',
};

const POLICY_MENU_ITEMS = [
  {
    id: 'ban-hang',
    icon: 'shopping_bag',
    label: 'Chính sách bán hàng',
    postSlug: 'chinh-sach-bao-hanh',
    legacyTabs: ['ban-hang'],
  },
  {
    id: 'van-chuyen',
    icon: 'local_shipping',
    label: 'Vận chuyển & Giao hàng',
    postSlug: 'chinh-sach-giao-hang',
    legacyTabs: ['van-chuyen'],
  },
  {
    id: 'doi-tra',
    icon: 'assignment_return',
    label: 'Đổi trả & Hoàn tiền',
    postSlug: 'chinh-sach-doi-tra-hang-va-hoan-tien',
    legacyTabs: ['doi-tra'],
  },
  {
    id: 'bao-mat',
    icon: 'verified_user',
    label: 'Bảo mật thông tin',
    postSlug: 'chinh-sach-bao-mat',
    legacyTabs: ['bao-mat'],
  },
];

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPolicyBySlug(postSlug) {
  const normalizedSlug = normalizeValue(postSlug);
  return POLICY_MENU_ITEMS.find((item) => item.postSlug === normalizedSlug) || null;
}

function getPolicyByLegacyTab(tab) {
  const normalizedTab = normalizeValue(tab);
  return (
    POLICY_MENU_ITEMS.find(
      (item) => item.id === normalizedTab || item.legacyTabs?.includes(normalizedTab)
    ) || null
  );
}

function resolveActivePolicy(searchParams) {
  const fromSlug = getPolicyBySlug(searchParams?.slug);
  if (fromSlug) {
    return fromSlug;
  }

  const fromLegacyTab = getPolicyByLegacyTab(searchParams?.tab);
  if (fromLegacyTab) {
    return fromLegacyTab;
  }

  return POLICY_MENU_ITEMS[0];
}

function buildPolicyHref(item) {
  return `/policy?slug=${encodeURIComponent(item.postSlug)}`;
}

function getPolicyContent(post) {
  const content = typeof post?.content === 'string' ? post.content.trim() : '';
  return content;
}

export default async function PolicyPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const activePolicy = resolveActivePolicy(resolvedSearchParams);

  let activePost = null;

  try {
    activePost = await getBlogPost(activePolicy.postSlug);
  } catch {
    activePost = null;
  }

  const activeContent = getPolicyContent(activePost);
  const hasPost = Boolean(activePost?.id);
  const hasContent = activeContent.length > 0;

  return (
    <main className="pol-page">
      <div className="pol-hero">
        <div className="pol-hero-inner">
          <h1 className="pol-hero-title">Chính sách &amp; Quy định</h1>
          <p className="pol-hero-sub">
            Cam kết về chất lượng và sự minh bạch trong mọi giao dịch tại Di Sản Gốm Việt.
          </p>
        </div>
      </div>

      <div className="pol-container">
        <div className="pol-layout">
          <aside className="pol-sidebar">
            <div className="pol-sidebar-sticky">
              <h3 className="pol-sidebar-heading">Danh mục chính sách</h3>
              <nav className="pol-sidebar-nav">
                {POLICY_MENU_ITEMS.map((item) => (
                  <Link
                    key={item.id}
                    href={buildPolicyHref(item)}
                    className={`pol-nav-item${
                      activePolicy.id === item.id ? ' pol-nav-item--active' : ''
                    }`}
                  >
                    <span className="material-symbols-outlined">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </aside>

          <div className="pol-content">
            <section className="pol-section">
              <h2 className="pol-section-title">{activePost?.title || activePolicy.label}</h2>

              {activePost?.excerpt ? <p className="pol-intro">{activePost.excerpt}</p> : null}

              {hasPost && hasContent ? (
                <div
                  className="pol-article"
                  dangerouslySetInnerHTML={{ __html: activeContent }}
                />
              ) : (
                <div className="pol-fallback" role="status">
                  <div className="pol-fallback-icon-wrap">
                    <span className="material-symbols-outlined pol-fallback-icon">article</span>
                  </div>
                  <h3 className="pol-fallback-title">
                    {hasPost ? 'Bài viết chưa có nội dung' : 'Chưa tìm thấy bài viết'}
                  </h3>
                  <p className="pol-fallback-text">
                    {hasPost
                      ? 'Bài viết đã được gắn với menu này nhưng chưa có nội dung để hiển thị.'
                      : (
                        <>
                          Menu này đang gắn tới slug{' '}
                          <strong className="pol-fallback-slug">{activePolicy.postSlug}</strong> nhưng hệ
                          thống chưa tìm thấy bài viết tương ứng.
                        </>
                      )}
                  </p>
                </div>
              )}
            </section>

            <div className="pol-support-cta">
              <div className="pol-support-left">
                <h4 className="pol-support-title">Cần hỗ trợ thêm?</h4>
                <p className="pol-support-sub">
                  Đội ngũ tư vấn của chúng tôi luôn sẵn sàng giải đáp mọi thắc mắc.
                </p>
              </div>
              <div className="pol-support-btns">
                <a href="tel:19001234" className="pol-support-btn pol-support-btn--primary">
                  <span className="material-symbols-outlined">call</span> Gọi ngay
                </a>
                <a
                  href="https://zalo.me"
                  target="_blank"
                  rel="noopener"
                  className="pol-support-btn pol-support-btn--ghost"
                >
                  <span className="material-symbols-outlined">chat</span> Chat với chúng tôi
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .pol-page {
          background: #f6f7f8;
          min-height: 100vh;
          font-family: 'EB Garamond', serif;
        }

        .pol-hero {
          background:
            linear-gradient(0deg, rgba(14, 19, 27, 0.82) 0%, rgba(14, 19, 27, 0.2) 65%),
            url('https://lh3.googleusercontent.com/aida-public/AB6AXuD1v6f0GytbOKFckdkE5YkP0gsNIWLjmpXfQTJ7R6Jk98hPNYLZ06GgYoR02eZKSplubI8119qNfwJpLrl39blQE8fWDVHOaZl77ShsF3zV18Ta8Ct_Uomqf9hM3hLthV8DriWKMZciKO4FrkxTywkFdmFffzgcPrmla_PUqa3d6zHymNKQVzDXIZXSj-W7lNAp8arkN02lsxrVE8-RK4JuLmBX5kjGxvqEfcUSWEGKtmaxizWUL1wuZBsNDmCn2qN4T7bSfZldkdo')
              center/cover no-repeat;
          min-height: 280px;
          display: flex;
          align-items: flex-end;
          padding: 0;
        }

        .pol-hero-inner {
          max-width: 1200px;
          width: 100%;
          margin: 0 auto;
          padding: 2.5rem 2rem 3rem;
        }

        .pol-hero-title {
          font-family: 'Playfair Display', serif;
          font-size: clamp(2rem, 5vw, 3.2rem);
          font-weight: 700;
          color: white;
          margin: 0 0 0.75rem;
        }

        .pol-hero-sub {
          font-family: 'EB Garamond', serif;
          font-size: 1.1rem;
          color: #cbd5e1;
          font-style: italic;
          margin: 0;
          max-width: 600px;
        }

        .pol-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2.5rem 1.5rem 4rem;
        }

        .pol-layout {
          display: flex;
          gap: 3rem;
          align-items: flex-start;
        }

        .pol-sidebar {
          width: 260px;
          flex-shrink: 0;
        }

        .pol-sidebar-sticky {
          position: sticky;
          top: 6rem;
        }

        .pol-sidebar-heading {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #506d95;
          margin: 0 0 1rem;
          padding: 0 1rem;
        }

        .pol-sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .pol-nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-radius: 0.375rem;
          font-size: 0.9rem;
          font-weight: 500;
          color: #506d95;
          transition: all 0.2s;
          font-family: 'EB Garamond', serif;
        }

        .pol-nav-item:hover {
          background: rgba(24, 85, 170, 0.06);
          color: #1855aa;
        }

        .pol-nav-item--active {
          background: #1855aa;
          color: white !important;
          box-shadow: 0 2px 8px rgba(24, 85, 170, 0.25);
        }

        .pol-nav-item .material-symbols-outlined {
          font-size: 1.1rem;
          flex-shrink: 0;
        }

        .pol-content {
          flex: 1;
          min-width: 0;
        }

        .pol-section {
          margin-bottom: 2rem;
        }

        .pol-section-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.9rem;
          font-weight: 700;
          color: #0e131b;
          margin: 0 0 1.25rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(24, 85, 170, 0.12);
        }

        .pol-intro {
          font-size: 1.05rem;
          color: #506d95;
          line-height: 1.8;
          margin: 0 0 2rem;
          font-style: normal;
        }

        .pol-article {
          font-size: 1rem;
          color: #374151;
          line-height: 1.85;
        }

        .pol-article > :first-child {
          margin-top: 0;
        }

        .pol-article :where(h2, h3, h4) {
          font-family: 'Playfair Display', serif;
          color: #1855aa;
          margin-top: 2rem;
          margin-bottom: 0.85rem;
          line-height: 1.35;
        }

        .pol-article h2 {
          font-size: 1.15rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .pol-article h3 {
          font-size: 1.05rem;
          font-weight: 600;
        }

        .pol-article p {
          margin: 0 0 0.85rem;
        }

        .pol-article strong {
          color: #0e131b;
        }

        .pol-article ul,
        .pol-article ol {
          padding-left: 1.5rem;
          margin: 0.75rem 0 1rem;
          color: #506d95;
        }

        .pol-article li {
          margin-bottom: 0.5rem;
        }

        .pol-article blockquote {
          background: rgba(24, 85, 170, 0.05);
          border-left: 4px solid #1855aa;
          padding: 1rem 1.25rem;
          margin: 1rem 0;
          font-style: italic;
          color: #0e131b;
          font-size: 0.98rem;
          line-height: 1.7;
        }

        .pol-article img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 1rem 0;
          border-radius: 0.375rem;
        }

        .pol-article a {
          color: #1855aa;
          text-decoration: underline;
        }

        .pol-fallback {
          background: white;
          border: 1px dashed rgba(24, 85, 170, 0.25);
          border-radius: 0.5rem;
          padding: 2rem;
          text-align: center;
          color: #506d95;
        }

        .pol-fallback-icon-wrap {
          width: 4rem;
          height: 4rem;
          margin: 0 auto 1rem;
          border-radius: 999px;
          background: rgba(24, 85, 170, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .pol-fallback-icon {
          font-size: 2rem;
          color: #1855aa;
        }

        .pol-fallback-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.35rem;
          color: #0e131b;
          margin: 0 0 0.75rem;
        }

        .pol-fallback-text {
          margin: 0;
          line-height: 1.8;
        }

        .pol-fallback-slug {
          color: #0e131b;
        }

        .pol-support-cta {
          background: #0e131b;
          color: white;
          padding: 2rem 2.5rem;
          border-radius: 0.5rem;
          margin-top: 3rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 1.5rem;
        }

        .pol-support-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.3rem;
          font-weight: 700;
          margin: 0 0 0.4rem;
        }

        .pol-support-sub {
          font-size: 0.9rem;
          color: #94a3b8;
          margin: 0;
          font-style: italic;
        }

        .pol-support-btns {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .pol-support-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.6rem 1.5rem;
          border-radius: 0.4rem;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.2s;
          font-family: 'EB Garamond', serif;
          cursor: pointer;
        }

        .pol-support-btn .material-symbols-outlined {
          font-size: 1rem;
        }

        .pol-support-btn--primary {
          background: #1855aa;
          color: white;
          border: none;
        }

        .pol-support-btn--primary:hover {
          background: #1245a0;
        }

        .pol-support-btn--ghost {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          border: none;
        }

        .pol-support-btn--ghost:hover {
          background: rgba(255, 255, 255, 0.18);
        }

        @media (max-width: 900px) {
          .pol-layout {
            flex-direction: column;
          }

          .pol-sidebar {
            width: 100%;
          }

          .pol-sidebar-sticky {
            position: static;
          }

          .pol-sidebar-nav {
            flex-direction: row;
            flex-wrap: wrap;
            gap: 0.5rem;
          }

          .pol-nav-item {
            flex: 1;
            min-width: 140px;
            justify-content: center;
            font-size: 0.85rem;
          }
        }

        @media (max-width: 640px) {
          .pol-hero {
            min-height: 220px;
          }

          .pol-support-cta {
            flex-direction: column;
            align-items: flex-start;
          }

          .pol-fallback {
            padding: 1.5rem;
          }
        }
      `}</style>
    </main>
  );
}
