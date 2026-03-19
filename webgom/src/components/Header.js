"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";

const isExternalUrl = (value = "") => /^https?:\/\//i.test(String(value).trim());

const renderNavLink = (item) => {
  const href = String(item?.url || item?.link || "#").trim() || "#";
  const label = String(item?.title || item?.label || "").trim();

  if (!label) return null;

  if (isExternalUrl(href)) {
    return (
      <a href={href} className="nav-link" target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className="nav-link">
      {label}
    </Link>
  );
};

export default function Header({
  menuItems = [],
  brandText = "GỐM ĐẠI THÀNH",
  logoUrl = "",
  searchPlaceholder = "Bạn cần tìm kiếm sản phẩm gì?",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const { cartCount } = useCart();
  const [isBouncing, setIsBouncing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const resolvedBrandText = String(brandText || "").trim() || "GỐM ĐẠI THÀNH";
  const resolvedLogoUrl = String(logoUrl || "").trim() || "/logo-dai-thanh.png";
  const resolvedSearchPlaceholder =
    String(searchPlaceholder || "").trim() || "Bạn cần tìm kiếm sản phẩm gì?";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (cartCount > 0) {
      setIsBouncing(true);
      const timer = setTimeout(() => setIsBouncing(false), 300);
      return () => clearTimeout(timer);
    }
  }, [cartCount]);

  const handleSearch = (e) => {
    if ((e.type === "keydown" && e.key === "Enter") || e.type === "click") {
      if (searchQuery.trim()) {
        router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      }
    }
  };

  return (
    <header className="site-header">
      <div className="container header-content">
        <Link href="/" className="logo-section">
          <div className="logo-img-box">
            <img src={resolvedLogoUrl} alt={resolvedBrandText} className="logo-img" />
          </div>
          <div className="logo-text">
            <h1 className="logo-title">{resolvedBrandText}</h1>
            <span className="logo-subtitle">TINH HOA ĐẤT VIỆT</span>
          </div>
        </Link>

        <nav className="main-nav">
          <ul className="nav-list">
            {menuItems.length > 0 ? (
              menuItems.map((item) => (
                <li key={item.id || item.url || item.link} className="nav-item">
                  {renderNavLink(item)}
                </li>
              ))
            ) : (
              <>
                <li className="nav-item">
                  <Link href="/products" className="nav-link">SẢN PHẨM</Link>
                </li>
                <li className="nav-item">
                  <Link href="/blog" className="nav-link">TIN TỨC</Link>
                </li>
                <li className="nav-item">
                  <Link href="/stores" className="nav-link">CỬA HÀNG</Link>
                </li>
              </>
            )}
          </ul>
        </nav>

        <div className="actions-section">
          <div className="search-bar">
            <span className="material-symbols-outlined search-icon" onClick={handleSearch}>search</span>
            <input
              type="text"
              placeholder={resolvedSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              className="search-input"
            />
          </div>

          <Link href="/cart" className={`cart-action ${isBouncing ? "bounce-cart" : ""}`}>
            <span className="material-symbols-outlined cart-icon">shopping_cart</span>
            <div className="cart-text">
              <span className="cart-title">Giỏ hàng</span>
              <span className="cart-subtitle">
                Có <strong className={isBouncing ? "bounce-text" : ""}>{mounted ? cartCount : 0}</strong> sản phẩm
              </span>
            </div>
          </Link>
        </div>
      </div>

      <style jsx>{`
        .site-header {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          height: 64px;
          padding: 0 24px;
          display: flex;
          align-items: center;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
          position: sticky;
          top: 0;
          z-index: 1000;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          gap: 1.5rem;
        }

        .logo-section {
          display: flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
          color: inherit;
          flex-shrink: 0;
        }

        .logo-img-box {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          transition: transform 0.3s ease;
          flex-shrink: 0;
          background: #fff;
          border-radius: 8px;
        }

        .logo-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .logo-section:hover .logo-img-box {
          transform: translateY(-2px);
        }

        .logo-text {
          display: flex;
          flex-direction: column;
          justify-content: center;
          border-left: 2px solid rgba(197, 160, 89, 0.4);
          padding-left: 12px;
          flex-shrink: 0;
        }

        .logo-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 600;
          color: var(--primary);
          margin: 0;
          white-space: nowrap;
          text-transform: uppercase;
          line-height: 1.1;
          letter-spacing: 0.02em;
        }

        .logo-subtitle {
          font-family: var(--font-body);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3em;
          color: var(--accent);
          font-weight: 600;
          margin-top: 2px;
          line-height: 1;
          white-space: nowrap;
        }

        .main-nav {
          flex: 1;
        }

        .nav-list {
          display: flex;
          list-style: none;
          gap: 1.5rem;
          margin: 0;
          padding: 0;
        }

        .nav-link {
          font-size: 14px;
          font-weight: 700;
          color: #1a2c4e;
          text-decoration: none;
          letter-spacing: 0.05em;
          transition: color 0.2s;
        }

        .nav-link:hover {
          color: var(--accent);
        }

        .actions-section {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .search-bar {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon {
          position: absolute;
          left: 12px;
          color: #94a3b8;
          font-size: 20px !important;
          cursor: pointer;
        }

        .search-input {
          background-color: #f1f5f9;
          border: none;
          border-radius: 20px;
          padding: 6px 16px 6px 36px;
          width: 240px;
          font-size: 13px;
          outline: none;
          transition: width 0.3s;
        }

        .search-input:focus {
          width: 280px;
          background-color: #e2e8f0;
        }

        .cart-action {
          position: relative;
          text-decoration: none;
          display: flex;
          align-items: center;
          color: inherit;
        }

        .cart-icon {
          font-size: 32px;
          color: #1a2c4e;
          margin-right: 8px;
        }

        .cart-title {
          display: block;
          color: #3b82f6;
          font-weight: 700;
          font-size: 15px;
          line-height: 1.2;
        }

        .cart-subtitle {
          display: block;
          color: #64748b;
          font-size: 13px;
          white-space: nowrap;
          margin-top: 2px;
        }

        .bounce-text {
          display: inline-block;
          animation: badgeBounce 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        :global(.cart-action.bounce-cart span.cart-icon) {
          animation: cartShake 0.4s ease-in-out;
        }

        @keyframes badgeBounce {
          0% { transform: scale(1); }
          50% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }

        @keyframes cartShake {
          0% { transform: rotate(0deg) scale(1); }
          25% { transform: rotate(-15deg) scale(1.2); }
          50% { transform: rotate(15deg) scale(1.2); }
          75% { transform: rotate(-5deg) scale(1.1); }
          100% { transform: rotate(0deg) scale(1); }
        }

        @media (max-width: 1024px) {
          .main-nav {
            display: none;
          }

          .search-input {
            width: 180px;
          }

          .search-input:focus {
            width: 220px;
          }
        }
      `}</style>
    </header>
  );
}
