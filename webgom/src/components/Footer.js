"use client";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-content">
        <div className="footer-grid">
          <div className="footer-col about-col">
            <div className="footer-logo">
              <img src="/logo-brand.jpg" alt="Logo Gôm Đại Thành" className="footer-logo-img" />
              <h2>GÔM ĐẠI THÀNH</h2>
            </div>
            <p className="footer-desc">
              Tự hào gìn giữ và phát triển tinh hoa gốm sứ Bát Tràng, mang những tác phẩm nghệ thuật độc bản từ Gôm Đại Thành đến với mọi không gian sống.
            </p>
            <div className="social-links">
              <span className="material-symbols-outlined">share</span>
              <span className="material-symbols-outlined">mail</span>
              <span className="material-symbols-outlined">call</span>
            </div>
          </div>

          <div className="footer-col">
            <h3>SẢN PHẨM</h3>
            <ul>
              <li><a href="#">Gốm Men Lam</a></li>
              <li><a href="#">Gốm Men Rạn</a></li>
              <li><a href="#">Bộ Trà Nghệ Nhân</a></li>
              <li><a href="#">Đồ Thờ Cúng</a></li>
              <li><a href="#">Quà Tặng Gốm Sứ</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h3>HỖ TRỢ</h3>
            <ul>
              <li><a href="#">Chính sách vận chuyển</a></li>
              <li><a href="#">Chính sách bảo hành</a></li>
              <li><a href="#">Hướng dẫn thanh toán</a></li>
              <li><a href="#">Câu hỏi thường gặp</a></li>
              <li><a href="#">Liên hệ đại lý</a></li>
            </ul>
          </div>

          <div className="footer-col newsletter-col">
            <h3>BẢN TIN</h3>
            <p>Nhận thông tin về các bộ sưu tập mới nhất và ưu đãi đặc quyền.</p>
            <div className="newsletter-form">
              <input type="email" placeholder="Email của bạn" />
              <button>GỬI</button>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2024 GÔM ĐẠI THÀNH. TẤT CẢ QUYỀN ĐƯỢC BẢO LƯU.</p>
          <div className="footer-legal">
            <a href="#">Điều khoản sử dụng</a>
            <a href="#">Chính sách bảo mật</a>
          </div>
        </div>
      </div>

      <style jsx>{`
        .site-footer {
          background-color: var(--primary);
          color: white;
          padding: 4rem 0 2rem;
        }
        .footer-grid {
          display: grid;
          grid-template-columns: 1.5fr 1fr 1fr 1.5fr;
          gap: 3rem;
          margin-bottom: 3rem;
        }
        @media (max-width: 992px) {
          .footer-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 576px) {
          .footer-grid {
            grid-template-columns: 1fr;
          }
        }
        .footer-logo {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }
        .footer-logo-img {
          width: 40px;
          height: 40px;
          object-fit: contain;
        }
        .footer-logo h2 {
          font-size: 1.25rem;
          letter-spacing: 0.05em;
          font-weight: 800;
        }
        .footer-desc {
          font-size: 0.875rem;
          opacity: 0.7;
          line-height: 1.6;
          margin-bottom: 1.5rem;
        }
        .social-links {
          display: flex;
          gap: 1rem;
        }
        .social-links span {
          font-size: 1.25rem;
          width: 40px;
          height: 40px;
          border: 1px solid rgba(255,255,255,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.3s;
        }
        .social-links span:hover {
          background-color: var(--accent);
          border-color: var(--accent);
        }

        .footer-col h3 {
          font-size: 1rem;
          color: var(--accent);
          margin-bottom: 1.5rem;
          letter-spacing: 0.1em;
        }
        .footer-col ul {
          list-style: none;
        }
        .footer-col ul li {
          margin-bottom: 0.75rem;
        }
        .footer-col ul li a {
          font-size: 0.875rem;
          opacity: 0.7;
          transition: opacity 0.2s;
        }
        .footer-col ul li a:hover {
          opacity: 1;
        }

        .newsletter-col p {
          font-size: 0.875rem;
          opacity: 0.7;
          margin-bottom: 1rem;
        }
        .newsletter-form {
          display: flex;
          gap: 0.5rem;
        }
        .newsletter-form input {
          flex: 1;
          background-color: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          padding: 0.65rem 1rem;
          border-radius: 8px;
          color: white;
          outline: none;
        }
        .newsletter-form button {
          background-color: var(--accent);
          color: white;
          border: none;
          padding: 0.65rem 1.25rem;
          border-radius: 8px;
          font-weight: bold;
          cursor: pointer;
        }

        .footer-bottom {
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          opacity: 0.5;
        }
        .footer-legal {
          display: flex;
          gap: 1.5rem;
        }
      `}</style>
    </footer>
  );
}
