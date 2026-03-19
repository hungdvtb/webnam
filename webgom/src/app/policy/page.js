import Link from 'next/link';

export const metadata = {
  title: 'Chính sách & Quy định | Di Sản Gốm Việt',
  description: 'Chính sách bán hàng, vận chuyển, đổi trả và bảo mật thông tin tại Di Sản Gốm Việt. Cam kết minh bạch và chất lượng trong mọi giao dịch.',
};

const POLICIES = [
  {
    id: 'ban-hang',
    icon: 'shopping_bag',
    label: 'Chính sách bán hàng',
  },
  {
    id: 'van-chuyen',
    icon: 'local_shipping',
    label: 'Vận chuyển & Giao hàng',
  },
  {
    id: 'doi-tra',
    icon: 'assignment_return',
    label: 'Đổi trả & Hoàn tiền',
  },
  {
    id: 'bao-mat',
    icon: 'verified_user',
    label: 'Bảo mật thông tin',
  },
  {
    id: 'faq',
    icon: 'help_center',
    label: 'Câu hỏi thường gặp',
  },
];

export default function PolicyPage({ searchParams }) {
  const activeId = searchParams?.tab || 'ban-hang';

  return (
    <main className="pol-page">

      {/* ── Hero Banner ── */}
      <div className="pol-hero">
        <div className="pol-hero-inner">
          <h1 className="pol-hero-title">Chính sách &amp; Quy định</h1>
          <p className="pol-hero-sub">
            Cam kết về chất lượng và sự minh bạch trong mọi giao dịch tại Di Sản Gốm Việt.
          </p>
        </div>
      </div>

      {/* ── Content Layout ── */}
      <div className="pol-container">
        <div className="pol-layout">

          {/* ── Sidebar ── */}
          <aside className="pol-sidebar">
            <div className="pol-sidebar-sticky">
              <h3 className="pol-sidebar-heading">Danh mục chính sách</h3>
              <nav className="pol-sidebar-nav">
                {POLICIES.map(p => (
                  <Link
                    key={p.id}
                    href={`/policy?tab=${p.id}`}
                    className={`pol-nav-item${activeId === p.id ? ' pol-nav-item--active' : ''}`}
                  >
                    <span className="material-symbols-outlined">{p.icon}</span>
                    {p.label}
                  </Link>
                ))}
              </nav>
            </div>
          </aside>

          {/* ── Main Policy Content ── */}
          <div className="pol-content">

            {/* ══ BAN HANG ══ */}
            {activeId === 'ban-hang' && (
              <section className="pol-section">
                <h2 className="pol-section-title">Chính sách bán hàng</h2>
                <p className="pol-intro">
                  Chào mừng quý khách đến với Di Sản Gốm Việt. Chúng tôi tự hào mang đến những sản phẩm gốm sứ tinh xảo, đậm đà bản sắc dân tộc. Để đảm bảo quyền lợi của khách hàng, chúng tôi xin thông báo các quy định về mua hàng và thanh toán như sau:
                </p>

                <div className="pol-blocks">
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">payments</span>
                      1. Quy định đặt hàng và Thanh toán
                    </h3>
                    <p>Quý khách có thể đặt hàng trực tuyến qua website hoặc trực tiếp tại các showroom của chúng tôi. Hệ thống chấp nhận các hình thức thanh toán:</p>
                    <ul className="pol-list">
                      <li>Thanh toán khi nhận hàng (COD) cho các đơn hàng nội địa dưới 5.000.000 VNĐ.</li>
                      <li>Chuyển khoản ngân hàng qua hệ thống các ngân hàng lớn tại Việt Nam.</li>
                      <li>Thanh toán trực tuyến qua thẻ tín dụng (Visa, Mastercard) hoặc ví điện tử (MoMo, ZaloPay).</li>
                    </ul>
                  </div>

                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">inventory_2</span>
                      2. Chất lượng sản phẩm
                    </h3>
                    <p>Mỗi sản phẩm gốm sứ tại Di Sản Gốm Việt là một tác phẩm nghệ thuật thủ công. Do tính chất đặc thù của gốm:</p>
                    <blockquote className="pol-quote">
                      "Sắc độ màu sắc và hoa văn có thể có những sai lệch nhỏ không đáng kể so với hình ảnh hiển thị, điều này tạo nên tính độc bản của mỗi sản phẩm."
                    </blockquote>
                  </div>

                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">shield</span>
                      3. Cam kết bảo hành
                    </h3>
                    <p>Chúng tôi cam kết bảo hành về nước men và lỗi kỹ thuật của sản phẩm trong vòng <strong>12 tháng</strong> kể từ ngày mua hàng. Không áp dụng bảo hành đối với các trường hợp nứt vỡ do tác động ngoại lực trong quá trình sử dụng của khách hàng.</p>
                  </div>

                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">price_check</span>
                      4. Chính sách giá
                    </h3>
                    <p>Giá niêm yết trên website là mức giá chính thức. Chúng tôi không thu thêm bất kỳ khoản phí ẩn nào. Mọi chương trình khuyến mãi và giảm giá sẽ được thông báo công khai trên hệ thống.</p>
                    <ul className="pol-list">
                      <li>Giá đã bao gồm thuế VAT theo quy định.</li>
                      <li>Phí vận chuyển được tính riêng và hiển thị trước khi xác nhận đơn hàng.</li>
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* ══ VAN CHUYEN ══ */}
            {activeId === 'van-chuyen' && (
              <section className="pol-section">
                <h2 className="pol-section-title">Vận chuyển &amp; Giao hàng</h2>
                <p className="pol-intro">
                  Chúng tôi hợp tác với các đơn vị vận chuyển uy tín để đảm bảo sản phẩm đến tay quý khách trong tình trạng tốt nhất.
                </p>
                <div className="pol-blocks">
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">local_shipping</span>
                      1. Khu vực giao hàng
                    </h3>
                    <ul className="pol-list">
                      <li>Giao hàng toàn quốc — 63 tỉnh thành.</li>
                      <li>Giao hàng quốc tế theo thỏa thuận riêng.</li>
                      <li>Ưu tiên giao hàng nhanh trong nội thành Hà Nội và TP.HCM.</li>
                    </ul>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">schedule</span>
                      2. Thời gian giao hàng
                    </h3>
                    <ul className="pol-list">
                      <li><strong>Nội thành:</strong> 1–2 ngày làm việc.</li>
                      <li><strong>Ngoại thành và tỉnh lân cận:</strong> 2–4 ngày làm việc.</li>
                      <li><strong>Tỉnh xa và vùng sâu:</strong> 4–7 ngày làm việc.</li>
                    </ul>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">package_2</span>
                      3. Đóng gói sản phẩm
                    </h3>
                    <p>Mỗi sản phẩm gốm sứ được đóng gói đặc biệt với nhiều lớp bảo vệ, hộp quà cao cấp đi kèm tem chứng nhận nghệ nhân. Đảm bảo an toàn trong suốt quá trình vận chuyển.</p>
                    <blockquote className="pol-quote">
                      "Mỗi kiện hàng được kiểm tra kỹ lưỡng trước khi bàn giao cho đơn vị vận chuyển."
                    </blockquote>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">payments</span>
                      4. Phí vận chuyển
                    </h3>
                    <ul className="pol-list">
                      <li>Miễn phí vận chuyển cho đơn hàng từ <strong>500.000 VNĐ</strong>.</li>
                      <li>Đơn dưới ngưỡng: phí vận chuyển tính theo khu vực và khối lượng.</li>
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* ══ DOI TRA ══ */}
            {activeId === 'doi-tra' && (
              <section className="pol-section">
                <h2 className="pol-section-title">Đổi trả &amp; Hoàn tiền</h2>
                <p className="pol-intro">
                  Sự hài lòng của quý khách là ưu tiên hàng đầu. Chúng tôi áp dụng chính sách đổi trả minh bạch và nhanh chóng.
                </p>
                <div className="pol-blocks">
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">assignment_return</span>
                      1. Điều kiện đổi trả
                    </h3>
                    <ul className="pol-list">
                      <li>Sản phẩm bị lỗi kỹ thuật từ nhà sản xuất.</li>
                      <li>Sản phẩm giao không đúng với đơn đặt hàng.</li>
                      <li>Sản phẩm bị vỡ trong quá trình vận chuyển.</li>
                    </ul>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">schedule</span>
                      2. Thời hạn yêu cầu đổi trả
                    </h3>
                    <p>Quý khách cần phản hồi trong vòng <strong>48 giờ</strong> kể từ khi nhận hàng kèm theo ảnh/video chứng minh. Yêu cầu sau thời hạn này sẽ không được xử lý.</p>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">currency_exchange</span>
                      3. Quy trình hoàn tiền
                    </h3>
                    <ul className="pol-list">
                      <li>Hoàn tiền 100% qua hình thức thanh toán ban đầu.</li>
                      <li>Thời gian xử lý: 3–7 ngày làm việc sau khi xác nhận yêu cầu hợp lệ.</li>
                      <li>Không áp dụng hoàn tiền mặt tại nhà.</li>
                    </ul>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">block</span>
                      4. Trường hợp không chấp nhận đổi trả
                    </h3>
                    <ul className="pol-list">
                      <li>Sản phẩm đã qua sử dụng, có dấu hiệu hư hỏng do người dùng.</li>
                      <li>Mất hộp đựng hoặc tem bảo hành.</li>
                      <li>Yêu cầu sau 48 giờ nhận hàng mà không có bằng chứng.</li>
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* ══ BAO MAT ══ */}
            {activeId === 'bao-mat' && (
              <section className="pol-section">
                <h2 className="pol-section-title">Bảo mật thông tin</h2>
                <p className="pol-intro">
                  Di Sản Gốm Việt cam kết bảo vệ toàn bộ thông tin cá nhân của quý khách theo tiêu chuẩn bảo mật cao nhất.
                </p>
                <div className="pol-blocks">
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">verified_user</span>
                      1. Thu thập thông tin
                    </h3>
                    <p>Chúng tôi chỉ thu thập các thông tin cần thiết để phục vụ giao dịch: tên, địa chỉ, số điện thoại và email. Không thu thập thông tin nhạy cảm ngoài phạm vi này.</p>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">lock</span>
                      2. Bảo vệ dữ liệu
                    </h3>
                    <ul className="pol-list">
                      <li>Mã hóa SSL cho toàn bộ giao dịch trực tuyến.</li>
                      <li>Không chia sẻ dữ liệu với bên thứ ba vì mục đích thương mại.</li>
                      <li>Dữ liệu được lưu trữ trên server bảo mật theo chuẩn quốc tế.</li>
                    </ul>
                  </div>
                  <div className="pol-block">
                    <h3 className="pol-block-title">
                      <span className="material-symbols-outlined">manage_accounts</span>
                      3. Quyền của khách hàng
                    </h3>
                    <ul className="pol-list">
                      <li>Quyền truy cập và chỉnh sửa thông tin cá nhân.</li>
                      <li>Quyền yêu cầu xóa dữ liệu khỏi hệ thống.</li>
                      <li>Quyền từ chối nhận email marketing.</li>
                    </ul>
                    <blockquote className="pol-quote">
                      "Thông tin của quý khách là tài sản quý giá. Chúng tôi cam kết không bao giờ bán hay cho thuê dữ liệu của bạn."
                    </blockquote>
                  </div>
                </div>
              </section>
            )}

            {/* ══ FAQ ══ */}
            {activeId === 'faq' && (
              <section className="pol-section">
                <h2 className="pol-section-title">Câu hỏi thường gặp</h2>
                <p className="pol-intro">
                  Tổng hợp những câu hỏi phổ biến từ khách hàng. Nếu không tìm thấy câu trả lời, vui lòng liên hệ với chúng tôi.
                </p>
                <div className="pol-faq-list">
                  {[
                    {
                      q: 'Tôi có thể đặt hàng số lượng lớn cho doanh nghiệp không?',
                      a: 'Có, chúng tôi hỗ trợ đặt hàng B2B với chính sách giá ưu đãi riêng. Vui lòng liên hệ trực tiếp để được tư vấn.'
                    },
                    {
                      q: 'Sản phẩm có chứng nhận xuất xứ không?',
                      a: 'Mỗi sản phẩm đều đi kèm chứng chỉ nghệ nhân và giấy chứng nhận xuất xứ từ làng nghề, đảm bảo tính chính hãng.'
                    },
                    {
                      q: 'Tôi có thể theo dõi đơn hàng bằng cách nào?',
                      a: 'Sau khi đơn hàng được xác nhận, bạn sẽ nhận được mã vận đơn qua SMS/email để tra cứu tình trạng vận chuyển.'
                    },
                    {
                      q: 'Sản phẩm bị vỡ khi vận chuyển thì phải làm gì?',
                      a: 'Vui lòng chụp ảnh kiện hàng nguyên trạng và sản phẩm bị vỡ, gửi về email hoặc hotline trong vòng 48 giờ. Chúng tôi sẽ xử lý ngay trong ngày làm việc tiếp theo.'
                    },
                    {
                      q: 'Có thể đặt làm sản phẩm theo yêu cầu riêng không?',
                      a: 'Có. Chúng tôi nhận đặt làm sản phẩm gốm theo thiết kế riêng (OEM), thời gian thực hiện từ 15–30 ngày tùy độ phức tạp.'
                    },
                  ].map((item, i) => (
                    <div key={i} className="pol-faq-item">
                      <div className="pol-faq-q">
                        <span className="pol-faq-num">{String(i + 1).padStart(2, '0')}</span>
                        <p>{item.q}</p>
                      </div>
                      <div className="pol-faq-a">{item.a}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Support CTA ── */}
            <div className="pol-support-cta">
              <div className="pol-support-left">
                <h4 className="pol-support-title">Cần hỗ trợ thêm?</h4>
                <p className="pol-support-sub">Đội ngũ tư vấn của chúng tôi luôn sẵn sàng giải đáp mọi thắc mắc.</p>
              </div>
              <div className="pol-support-btns">
                <a href="tel:19001234" className="pol-support-btn pol-support-btn--primary">
                  <span className="material-symbols-outlined">call</span> Gọi ngay
                </a>
                <a href="https://zalo.me" target="_blank" rel="noopener" className="pol-support-btn pol-support-btn--ghost">
                  <span className="material-symbols-outlined">chat</span> Chat với chúng tôi
                </a>
              </div>
            </div>

          </div>
        </div>
      </div>

      <style>{`
        /* ── Page ── */
        .pol-page {
          background: #f6f7f8; min-height: 100vh;
          font-family: 'EB Garamond', serif;
        }

        /* ── Hero ── */
        .pol-hero {
          background:
            linear-gradient(0deg, rgba(14,19,27,0.82) 0%, rgba(14,19,27,0.2) 65%),
            url('https://lh3.googleusercontent.com/aida-public/AB6AXuD1v6f0GytbOKFckdkE5YkP0gsNIWLjmpXfQTJ7R6Jk98hPNYLZ06GgYoR02eZKSplubI8119qNfwJpLrl39blQE8fWDVHOaZl77ShsF3zV18Ta8Ct_Uomqf9hM3hLthV8DriWKMZciKO4FrkxTywkFdmFffzgcPrmla_PUqa3d6zHymNKQVzDXIZXSj-W7lNAp8arkN02lsxrVE8-RK4JuLmBX5kjGxvqEfcUSWEGKtmaxizWUL1wuZBsNDmCn2qN4T7bSfZldkdo') center/cover no-repeat;
          min-height: 280px;
          display: flex; align-items: flex-end; padding: 0;
        }
        .pol-hero-inner {
          max-width: 1200px; width: 100%; margin: 0 auto;
          padding: 2.5rem 2rem 3rem;
        }
        .pol-hero-title {
          font-family: 'Playfair Display', serif;
          font-size: clamp(2rem, 5vw, 3.2rem);
          font-weight: 700; color: white; margin: 0 0 0.75rem;
        }
        .pol-hero-sub {
          font-family: 'EB Garamond', serif; font-size: 1.1rem;
          color: #cbd5e1; font-style: italic; margin: 0; max-width: 600px;
        }

        /* ── Container ── */
        .pol-container {
          max-width: 1200px; margin: 0 auto;
          padding: 2.5rem 1.5rem 4rem;
        }
        .pol-layout {
          display: flex; gap: 3rem; align-items: flex-start;
        }

        /* ── Sidebar ── */
        .pol-sidebar {
          width: 260px; flex-shrink: 0;
        }
        .pol-sidebar-sticky {
          position: sticky; top: 6rem;
        }
        .pol-sidebar-heading {
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.2em;
          text-transform: uppercase; color: #506d95;
          margin: 0 0 1rem; padding: 0 1rem;
        }
        .pol-sidebar-nav {
          display: flex; flex-direction: column; gap: 0.25rem;
        }
        .pol-nav-item {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.75rem 1rem; border-radius: 0.375rem;
          font-size: 0.9rem; font-weight: 500; color: #506d95;
          transition: all 0.2s; font-family: 'EB Garamond', serif;
        }
        .pol-nav-item:hover {
          background: rgba(24,85,170,0.06); color: #1855aa;
        }
        .pol-nav-item--active {
          background: #1855aa; color: white !important;
          box-shadow: 0 2px 8px rgba(24,85,170,0.25);
        }
        .pol-nav-item .material-symbols-outlined { font-size: 1.1rem; flex-shrink: 0; }

        /* ── Content ── */
        .pol-content {
          flex: 1; min-width: 0;
        }

        /* ── Section ── */
        .pol-section { margin-bottom: 2rem; }
        .pol-section-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.9rem; font-weight: 700;
          color: #0e131b; margin: 0 0 1.25rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(24,85,170,0.12);
        }
        .pol-intro {
          font-size: 1.05rem; color: #506d95; line-height: 1.8;
          margin: 0 0 2rem; font-style: normal;
        }

        /* ── Blocks ── */
        .pol-blocks { display: flex; flex-direction: column; gap: 2rem; }
        .pol-block { }
        .pol-block-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.15rem; font-weight: 600;
          color: #1855aa; margin: 0 0 0.75rem;
          display: flex; align-items: center; gap: 0.5rem;
        }
        .pol-block-title .material-symbols-outlined { font-size: 1.2rem; }
        .pol-block p {
          font-size: 1rem; color: #374151; line-height: 1.8; margin: 0 0 0.75rem;
        }
        .pol-block strong { color: #0e131b; }

        /* ── List ── */
        .pol-list {
          list-style: disc; padding-left: 1.5rem;
          display: flex; flex-direction: column; gap: 0.5rem;
          color: #506d95; font-size: 1rem; line-height: 1.7; margin: 0.5rem 0;
        }

        /* ── Blockquote ── */
        .pol-quote {
          background: rgba(24,85,170,0.05);
          border-left: 4px solid #1855aa;
          padding: 1rem 1.25rem; margin: 1rem 0;
          font-style: italic; color: #0e131b; font-size: 0.98rem; line-height: 1.7;
        }

        /* ── FAQ ── */
        .pol-faq-list { display: flex; flex-direction: column; gap: 0; }
        .pol-faq-item {
          border-bottom: 1px solid rgba(24,85,170,0.1);
          padding: 1.5rem 0;
        }
        .pol-faq-item:last-child { border-bottom: none; }
        .pol-faq-q {
          display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 0.6rem;
        }
        .pol-faq-num {
          font-family: 'Playfair Display', serif; font-size: 1.3rem;
          font-weight: 700; color: #1855aa; opacity: 0.4;
          flex-shrink: 0; line-height: 1.3;
        }
        .pol-faq-q p {
          font-family: 'Playfair Display', serif; font-size: 1.05rem;
          font-weight: 600; color: #0e131b; margin: 0; line-height: 1.4;
        }
        .pol-faq-a {
          padding-left: calc(1.3rem + 1rem);
          font-size: 0.98rem; color: #506d95; line-height: 1.8; font-style: italic;
        }

        /* ── Support CTA ── */
        .pol-support-cta {
          background: #0e131b; color: white;
          padding: 2rem 2.5rem; border-radius: 0.5rem; margin-top: 3rem;
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 1.5rem;
        }
        .pol-support-title {
          font-family: 'Playfair Display', serif;
          font-size: 1.3rem; font-weight: 700; margin: 0 0 0.4rem;
        }
        .pol-support-sub {
          font-size: 0.9rem; color: #94a3b8; margin: 0; font-style: italic;
        }
        .pol-support-btns { display: flex; gap: 0.75rem; flex-wrap: wrap; }
        .pol-support-btn {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.6rem 1.5rem; border-radius: 0.4rem;
          font-weight: 600; font-size: 0.9rem; transition: all 0.2s;
          font-family: 'EB Garamond', serif; cursor: pointer;
        }
        .pol-support-btn .material-symbols-outlined { font-size: 1rem; }
        .pol-support-btn--primary {
          background: #1855aa; color: white; border: none;
        }
        .pol-support-btn--primary:hover { background: #1245a0; }
        .pol-support-btn--ghost {
          background: rgba(255,255,255,0.1); color: white; border: none;
        }
        .pol-support-btn--ghost:hover { background: rgba(255,255,255,0.18); }

        @media (max-width: 900px) {
          .pol-layout { flex-direction: column; }
          .pol-sidebar { width: 100%; }
          .pol-sidebar-sticky { position: static; }
          .pol-sidebar-nav { flex-direction: row; flex-wrap: wrap; gap: 0.5rem; }
          .pol-nav-item { flex: 1; min-width: 140px; justify-content: center; font-size: 0.85rem; }
        }
        @media (max-width: 640px) {
          .pol-hero { min-height: 220px; }
          .pol-support-cta { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </main>
  );
}
