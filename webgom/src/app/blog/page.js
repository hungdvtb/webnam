import Link from 'next/link';
import { getBlogPosts } from '@/lib/blogApi';

export const metadata = {
  title: 'Tin tức & Blog | Di Sản Gốm Việt',
  description: 'Khám phá những bài viết về lịch sử, kỹ thuật chế tác, nghệ nhân và văn hóa di sản gốm Việt.',
};

const CATEGORIES = [
  { key: '', label: 'Tất Cả' },
  { key: 'Lịch Sử Gốm', label: 'Lịch Sử Gốm' },
  { key: 'Kỹ Thuật Chế Tác', label: 'Kỹ Thuật Chế Tác' },
  { key: 'Nghệ Nhân', label: 'Nghệ Nhân' },
  { key: 'Văn Hóa', label: 'Văn Hóa' },
  { key: 'Sự Kiện', label: 'Sự Kiện' },
];

const FALLBACK_POSTS = [
  { id: 1, title: 'Gốm Chu Đậu: Tìm Lại Ánh Hào Quang Một Thời Đại', excerpt: 'Hành trình tìm về những vết tích rực rỡ của dòng gốm quý tộc từng vang danh khắp các hải cảng quốc tế thế kỷ 14-17.', category: 'Lịch Sử Gốm', read_time: '15 Phút', image: null },
  { id: 2, title: 'Bí Quyết Phối Trộn Đất Sét Trắng Làng Gốm Bát Tràng', excerpt: 'Tỷ lệ vàng và những công đoạn tinh luyện khắt khe để tạo nên cốt gốm mịn màng, bền bỉ cùng thời gian.', category: 'Kỹ Thuật Chế Tác', read_time: '12 Phút', image: null },
  { id: 3, title: 'Nghệ Nhân Ưu Tú Trần Nam: Người Thổi Hồn Vào Đất', excerpt: 'Gần 50 năm miệt mài bên bàn xoay, ông đã hồi sinh hàng nghìn mẫu gốm cổ bị thất truyền của triều đình Huế.', category: 'Nghệ Nhân', read_time: '20 Phút', image: null },
  { id: 4, title: 'Gốm Sứ Trong Nghi Lễ Thờ Cúng Của Người Việt', excerpt: 'Tầng sâu ý nghĩa tâm linh đằng sau những bộ đồ thờ bằng gốm men rạn, biểu tượng cho lòng hiếu thảo và sự tôn nghiêm.', category: 'Văn Hóa', read_time: '10 Phút', image: null },
  { id: 5, title: 'Nghệ Thuật Đắp Nổi Tứ Linh Trên Gốm Sứ Cổ', excerpt: 'Cách thức các nghệ nhân xưa tạo nên những hình tượng Long - Lân - Quy - Phụng sống động như thật trên gốm.', category: 'Kỹ Thuật Chế Tác', read_time: '18 Phút', image: null },
  { id: 6, title: 'Triển Lãm "Gốm Việt: Từ Di Sản Đến Đời Sống Hiện Đại"', excerpt: 'Không gian trưng bày những tác phẩm gốm đương đại mang hơi thở truyền thống tại trung tâm bảo tồn di sản.', category: 'Sự Kiện', read_time: '5 Phút', image: null },
];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getPostImage(post) {
  if (post.image) return post.image;
  if (post.thumbnail) return post.thumbnail;
  if (post.featured_image) return post.featured_image;
  return null;
}

export default async function BlogPage({ searchParams }) {
  const activeCategory = searchParams?.category || '';
  let posts = [];

  try {
    const res = await getBlogPosts({ per_page: 20 });
    const rawPosts = res?.data || res || [];
    posts = Array.isArray(rawPosts) ? rawPosts : [];
  } catch (e) {
    posts = FALLBACK_POSTS;
  }

  // Use fallback if no data from API
  if (!posts.length) posts = FALLBACK_POSTS;

  // Filter by category
  const filteredPosts = activeCategory
    ? posts.filter(p => (p.category || p.tag || '') === activeCategory)
    : posts;

  return (
    <main className="blog-page">
      <div className="container blog-container">
        {/* Category Nav */}
        <nav className="blog-category-nav">
          {CATEGORIES.map(cat => (
            <Link
              key={cat.key}
              href={cat.key ? `/blog?category=${encodeURIComponent(cat.key)}` : '/blog'}
              className={`blog-cat-btn${activeCategory === cat.key ? ' active' : ''}`}
            >
              {cat.label}
            </Link>
          ))}
        </nav>

        {/* Post Grid */}
        <div className="blog-grid">
          {filteredPosts.length > 0 ? filteredPosts.map(post => (
            <article key={post.id} className="blog-card">
              <div className="blog-card-img">
                {getPostImage(post) ? (
                  <img src={getPostImage(post)} alt={post.title} className="blog-card-img-el" />
                ) : (
                  <div className="blog-card-img-placeholder">
                    <span className="material-symbols-outlined">article</span>
                  </div>
                )}
                {(post.category || post.tag) && (
                  <span className="blog-card-cat">{post.category || post.tag}</span>
                )}
              </div>
              <div className="blog-card-body">
                <h3 className="blog-card-title">{post.title}</h3>
                {post.excerpt && (
                  <p className="blog-card-excerpt">{post.excerpt}</p>
                )}
                <div className="blog-card-footer">
                  <span className="blog-card-time">
                    {post.read_time || (post.created_at ? formatDate(post.created_at) : '')}
                  </span>
                  <Link href={`/blog/${post.id}`} className="blog-card-link">
                    Xem thêm <span className="material-symbols-outlined">east</span>
                  </Link>
                </div>
              </div>
            </article>
          )) : (
            <div className="blog-empty">
              <span className="material-symbols-outlined">article</span>
              <p>Không có bài viết nào trong danh mục này.</p>
            </div>
          )}
        </div>

        {/* Load More (decorative for now) */}
        <div className="blog-load-more-wrap">
          <div className="blog-load-more-box">
            <button className="blog-load-more-btn">
              Tải Thêm Bài Viết
              <span className="material-symbols-outlined blog-bounce">expand_more</span>
            </button>
            <div className="blog-load-more-shadow" />
          </div>
        </div>
      </div>

      <style>{`
        .blog-page { background: #F9F5F0; min-height: 100vh; }

        /* Container */
        .blog-container { padding-top: 1.25rem; padding-bottom: 3rem; }

        /* Category Nav */
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

        /* Grid */
        .blog-grid {
          display: grid;
          grid-template-columns: repeat(1, 1fr);
          gap: 2rem;
        }
        @media (min-width: 640px) {
          .blog-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 1024px) {
          .blog-grid { grid-template-columns: repeat(3, 1fr); }
        }

        /* Card */
        .blog-card {
          background: white; display: flex; flex-direction: column;
          border: 1px solid #e9e3da; overflow: hidden;
          box-shadow: 0 2px 8px rgba(27,54,93,0.06);
          transition: box-shadow 0.3s, transform 0.2s;
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
        .blog-card-cat {
          position: absolute; top: 1rem; left: 1rem;
          background: rgba(27,54,93,0.9); color: #C5A065;
          font-size: 0.6rem; font-weight: 800; letter-spacing: 0.2em;
          text-transform: uppercase; padding: 0.25rem 0.6rem;
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
        .blog-card-link:hover { color: #C5A065; gap: 0.5rem; }
        .blog-card-link .material-symbols-outlined { font-size: 1rem; }

        /* Empty */
        .blog-empty {
          grid-column: 1 / -1; text-align: center; padding: 4rem;
          color: #94a3b8; display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
        }
        .blog-empty .material-symbols-outlined { font-size: 3rem; }
        .blog-empty p { font-family: 'EB Garamond', serif; font-size: 1.1rem; font-style: italic; }

        /* Load More */
        .blog-load-more-wrap { margin-top: 4rem; text-align: center; }
        .blog-load-more-box { display: inline-block; position: relative; padding: 1rem 3rem; border: 2px solid rgba(197,160,101,0.4); cursor: pointer; }
        .blog-load-more-box:hover { border-color: #C5A065; }
        .blog-load-more-btn {
          font-family: 'Playfair Display', serif; font-weight: 700;
          letter-spacing: 0.2em; text-transform: uppercase; color: #1B365D;
          display: inline-flex; align-items: center; gap: 0.75rem;
          background: none; border: none; cursor: pointer; font-size: 0.95rem;
        }
        .blog-load-more-shadow {
          position: absolute; top: 4px; left: 4px; right: -4px; bottom: -4px;
          border: 1px solid rgba(197,160,101,0.2); pointer-events: none;
        }
        .blog-bounce { animation: blogBounce 1.2s ease-in-out infinite; }
        @keyframes blogBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(4px); }
        }

        @media (max-width: 768px) {
          .blog-container { padding-top: 1rem; padding-bottom: 2.5rem; }
        }
      `}</style>
    </main>
  );
}
