"use client";

import Link from "next/link";

const DEFAULT_DESCRIPTION =
  "Gìn giữ tinh hoa đất Việt qua từng nét vẽ, mảng men và những tác phẩm gốm sứ thủ công độc bản.";
const DEFAULT_BRAND_TEXT = "GỐM ĐẠI THÀNH";
const DEFAULT_NEWSLETTER_PLACEHOLDER = "Email của bạn";

const isExternalUrl = (value = "") => /^https?:\/\//i.test(String(value).trim());

const FooterLink = ({ href, children }) => {
  const resolvedHref = String(href || "#").trim() || "#";

  if (isExternalUrl(resolvedHref)) {
    return (
      <a href={resolvedHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <Link href={resolvedHref}>{children}</Link>;
};

export default function Footer({ config = {} }) {
  const brandText = String(config?.brandText || "").trim() || DEFAULT_BRAND_TEXT;
  const logoUrl = String(config?.logoUrl || "").trim() || "/logo-dai-thanh.png";
  const description = String(config?.description || "").trim() || DEFAULT_DESCRIPTION;
  const hotline = String(config?.hotline || "").trim();
  const email = String(config?.email || "").trim();
  const address = String(config?.address || "").trim();
  const newsletterPlaceholder =
    String(config?.newsletterPlaceholder || "").trim() || DEFAULT_NEWSLETTER_PLACEHOLDER;
  const copyrightText =
    String(config?.copyrightText || "").trim() ||
    `© ${new Date().getFullYear()} ${brandText}. Tất cả quyền được bảo lưu.`;
  const groups = Array.isArray(config?.groups) ? config.groups : [];

  return (
    <footer className="site-footer">
      <div className="container footer-content">
        <div className="footer-grid">
          <div className="footer-col about-col">
            <div className="footer-logo">
              <img src={logoUrl} alt={brandText} className="footer-logo-img" />
              <h2>{brandText}</h2>
            </div>

            <p className="footer-desc">{description}</p>

            <div className="footer-contact">
              {hotline ? (
                <a href={`tel:${hotline}`} className="footer-contact-item">
                  <span className="material-symbols-outlined">call</span>
                  {hotline}
                </a>
              ) : null}

              {email ? (
                <a href={`mailto:${email}`} className="footer-contact-item">
                  <span className="material-symbols-outlined">mail</span>
                  {email}
                </a>
              ) : null}

              {address ? (
                <div className="footer-contact-item footer-address">
                  <span className="material-symbols-outlined">location_on</span>
                  <span>{address}</span>
                </div>
              ) : null}
            </div>
          </div>

          {groups.map((group) => (
            <div className="footer-col footer-nav-col" key={group.id}>
              <h3>{group.title}</h3>
              <ul>
                {(group.items || []).map((item) => (
                  <li key={item.id}>
                    <FooterLink href={item.link}>{item.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="footer-col newsletter-col">
            <h3>BẢN TIN</h3>
            <p>Nhận thông tin về các bộ sưu tập mới nhất và ưu đãi đặc quyền.</p>
            <div className="newsletter-form">
              <input type="email" placeholder={newsletterPlaceholder} />
              <button type="button">GỬI</button>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>{copyrightText}</p>
          <div className="footer-legal">
            {hotline ? <a href={`tel:${hotline}`}>Hotline</a> : null}
            {email ? <a href={`mailto:${email}`}>Email</a> : null}
          </div>
        </div>
      </div>

      <style jsx>{`
        .site-footer {
          background-color: var(--primary);
          color: white;
          padding: 4rem 0 2rem;
        }

        .footer-content {
          position: relative;
        }

        .footer-grid {
          display: grid;
          grid-template-columns: 1.5fr repeat(3, 1fr) 1.25fr;
          gap: 3rem;
          margin-bottom: 3rem;
        }

        @media (max-width: 1200px) {
          .footer-grid {
            grid-template-columns: 1.3fr repeat(2, 1fr);
          }

          .newsletter-col {
            grid-column: span 3;
          }
        }

        @media (max-width: 992px) {
          .footer-grid {
            grid-template-columns: 1fr 1fr;
          }

          .newsletter-col {
            grid-column: auto;
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
          width: 48px;
          height: 48px;
          object-fit: contain;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.95);
          padding: 4px;
        }

        .footer-logo h2 {
          font-size: 1.25rem;
          letter-spacing: 0.05em;
          font-weight: 800;
          text-transform: uppercase;
        }

        .footer-desc {
          font-size: 0.875rem;
          opacity: 0.8;
          line-height: 1.7;
          margin-bottom: 1.25rem;
        }

        .footer-contact {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .footer-contact-item {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          font-size: 0.875rem;
          opacity: 0.85;
          transition: opacity 0.2s ease;
          min-width: 0;
        }

        .footer-contact-item:hover {
          opacity: 1;
        }

        .footer-address {
          align-items: flex-start;
        }

        .footer-col h3 {
          font-size: 1rem;
          color: var(--accent);
          margin-bottom: 1.5rem;
          letter-spacing: 0.1em;
        }

        .footer-col ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .footer-col ul li {
          margin-bottom: 0.75rem;
        }

        .footer-col ul li :global(a) {
          display: inline-block;
          font-size: 0.875rem;
          opacity: 0.8;
          line-height: 1.55;
          word-break: break-word;
          transition: opacity 0.2s;
        }

        .footer-col ul li :global(a:hover) {
          opacity: 1;
        }

        .newsletter-col p {
          font-size: 0.875rem;
          opacity: 0.8;
          margin-bottom: 1rem;
          line-height: 1.7;
        }

        .newsletter-form {
          display: flex;
          gap: 0.5rem;
        }

        .newsletter-form input {
          flex: 1;
          background-color: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
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
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 2rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          opacity: 0.65;
          flex-wrap: wrap;
        }

        .footer-legal {
          display: flex;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        @media (max-width: 767px) {
          .site-footer {
            padding: 3rem 0 2rem;
          }

          .footer-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
          }

          .about-col,
          .newsletter-col {
            grid-column: 1 / -1;
          }

          .footer-col {
            min-width: 0;
            padding: 1rem;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(12px);
          }

          .footer-logo {
            margin-bottom: 1rem;
          }

          .footer-logo h2 {
            font-size: 1.08rem;
            line-height: 1.25;
          }

          .footer-desc {
            margin-bottom: 1rem;
            font-size: 0.92rem;
            line-height: 1.65;
          }

          .footer-contact {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.75rem;
          }

          .footer-contact-item {
            min-height: 48px;
            padding: 0.75rem 0.85rem;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.06);
            font-size: 0.86rem;
            line-height: 1.45;
          }

          .footer-contact-item :global(.material-symbols-outlined) {
            font-size: 18px !important;
            flex-shrink: 0;
          }

          .footer-address {
            grid-column: 1 / -1;
          }

          .footer-col h3 {
            margin-bottom: 0.9rem;
            font-size: 0.92rem;
            letter-spacing: 0.08em;
          }

          .footer-col ul {
            display: flex;
            flex-direction: column;
            gap: 0.65rem;
          }

          .footer-col ul li {
            margin-bottom: 0;
          }

          .footer-col ul li :global(a) {
            display: block;
            padding: 0.1rem 0;
            font-size: 0.9rem;
            opacity: 0.88;
          }

          .footer-nav-col {
            align-self: stretch;
          }

          .footer-nav-col ul {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.65rem;
          }

          .footer-nav-col ul li :global(a) {
            display: flex;
            align-items: flex-start;
            min-height: 54px;
            padding: 0.75rem 0.8rem;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.04);
            line-height: 1.4;
          }

          .newsletter-col p {
            margin-bottom: 0.9rem;
            font-size: 0.9rem;
            line-height: 1.65;
          }

          .newsletter-form {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 0.65rem;
            align-items: stretch;
          }

          .newsletter-form input {
            min-width: 0;
            font-size: 0.9rem;
          }

          .newsletter-form button {
            min-width: 88px;
          }

          .footer-bottom {
            justify-content: center;
            text-align: center;
            gap: 0.85rem;
            padding-top: 1.5rem;
            font-size: 0.58rem;
            line-height: 1.7;
          }

          .footer-bottom p {
            width: 100%;
          }

          .footer-legal {
            justify-content: center;
            gap: 1rem;
            width: 100%;
          }
        }

        @media (max-width: 479px) {
          .site-footer {
            padding: 2.75rem 0 1.75rem;
          }

          .footer-grid {
            grid-template-columns: 1fr;
            gap: 0.9rem;
          }

          .footer-col {
            padding: 0.95rem;
            border-radius: 14px;
          }

          .footer-logo {
            align-items: center;
            gap: 0.7rem;
          }

          .footer-nav-col ul {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 0.55rem;
          }

          .footer-nav-col ul li :global(a) {
            min-height: 50px;
            padding: 0.72rem 0.75rem;
            font-size: 0.84rem;
          }

          .footer-contact {
            grid-template-columns: 1fr;
          }

          .footer-contact-item,
          .footer-address {
            grid-column: auto;
          }

          .newsletter-form {
            grid-template-columns: 1fr;
          }

          .newsletter-form button {
            width: 100%;
          }
        }

        @media (max-width: 359px) {
          .footer-nav-col ul {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </footer>
  );
}
