"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";

const DEFAULT_BRAND_TITLE = "G\u1ed1m \u0110\u1ea1i Th\u00e0nh";
const DEFAULT_SEARCH_PLACEHOLDER = "B\u1ea1n c\u1ea7n t\u00ecm ki\u1ebfm s\u1ea3n ph\u1ea9m g\u00ec?";

const isExternalUrl = (value = "") => /^https?:\/\//i.test(String(value).trim());

const toComparableText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .replace(/\u0110/g, "D")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const normalizeBrandTitle = (value = "") => {
  const trimmed = String(value || "").trim();

  if (!trimmed) return DEFAULT_BRAND_TITLE;

  return toComparableText(trimmed) === "gom dai thanh" ? DEFAULT_BRAND_TITLE : trimmed;
};

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
  brandText = DEFAULT_BRAND_TITLE,
  logoUrl = "",
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const { cartCount } = useCart();
  const router = useRouter();

  const resolvedBrandTitle = normalizeBrandTitle(brandText);
  const resolvedLogoUrl = String(logoUrl || "").trim() || "/logo-dai-thanh.png";
  const resolvedSearchPlaceholder =
    String(searchPlaceholder || "").trim() || DEFAULT_SEARCH_PLACEHOLDER;

  const handleSearch = (event) => {
    if ((event.type === "keydown" && event.key === "Enter") || event.type === "click") {
      if (searchQuery.trim()) {
        router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      }
    }
  };

  return (
    <header className="site-header">
      <div className="container header-content">
        <Link
          href="/"
          className="logo-section"
          aria-label={resolvedBrandTitle}
        >
          <span className="logo-img-box">
            <Image
              src={resolvedLogoUrl}
              alt={resolvedBrandTitle}
              className="logo-img"
              width={56}
              height={56}
              sizes="56px"
              unoptimized
            />
          </span>
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
                  <Link href="/products" className="nav-link">
                    {"S\u1ea3n ph\u1ea9m"}
                  </Link>
                </li>
                <li className="nav-item">
                  <Link href="/blog" className="nav-link">
                    {"Tin t\u1ee9c"}
                  </Link>
                </li>
                <li className="nav-item">
                  <Link href="/stores" className="nav-link">
                    {"C\u1eeda h\u00e0ng"}
                  </Link>
                </li>
              </>
            )}
          </ul>
        </nav>

        <div className="actions-section">
          <div className="search-bar">
            <span className="material-symbols-outlined search-icon" onClick={handleSearch}>
              search
            </span>
            <input
              type="text"
              placeholder={resolvedSearchPlaceholder}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearch}
              className="search-input"
            />
          </div>

          <Link href="/cart" className="cart-action">
            <span
              key={`cart-icon-${cartCount}`}
              className={`material-symbols-outlined cart-icon ${cartCount > 0 ? "cart-icon-bounce" : ""}`}
            >
              shopping_cart
            </span>
            <div className="cart-text">
              <span className="cart-title">{"Gi\u1ecf h\u00e0ng"}</span>
              <span className="cart-subtitle">
                {"C\u00f3"}{" "}
                <strong
                  key={`cart-count-${cartCount}`}
                  className={cartCount > 0 ? "bounce-text" : undefined}
                  suppressHydrationWarning
                >
                  {cartCount}
                </strong>{" "}
                {"s\u1ea3n ph\u1ea9m"}
              </span>
            </div>
          </Link>
        </div>
      </div>

      <style jsx>{`
        .site-header {
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(197, 160, 89, 0.16);
          min-height: 78px;
          padding: 0 clamp(16px, 2.2vw, 24px);
          display: flex;
          align-items: center;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
          position: sticky;
          top: 0;
          z-index: 1000;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          min-height: 78px;
          gap: clamp(0.75rem, 1.8vw, 1.5rem);
        }

        .logo-section {
          --brand-logo-size: 56px;
          display: flex;
          align-items: center;
          text-decoration: none;
          color: inherit;
          flex-shrink: 0;
        }

        .logo-img-box {
          width: var(--brand-logo-size);
          height: var(--brand-logo-size);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
          background: linear-gradient(180deg, #ffffff 0%, #f9f3ea 100%);
          border: 1px solid rgba(197, 160, 89, 0.18);
          border-radius: 12px;
          box-shadow: 0 8px 18px rgba(27, 44, 78, 0.08);
          transition: transform 0.25s ease, box-shadow 0.25s ease;
        }

        .logo-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .logo-section:hover .logo-img-box {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(27, 44, 78, 0.12);
        }

        .main-nav {
          flex: 1;
          min-width: 0;
        }

        .nav-list {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          list-style: none;
          gap: clamp(1rem, 1.3vw, 1.5rem);
          margin: 0;
          padding: 0;
        }

        .nav-link {
          font-size: 16px;
          font-weight: 800;
          color: #1a2c4e;
          text-decoration: none;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          transition: color 0.2s;
          white-space: nowrap;
        }

        .nav-link:hover {
          color: var(--accent);
        }

        .actions-section {
          display: flex;
          align-items: center;
          gap: clamp(0.85rem, 1.4vw, 1.5rem);
          flex-shrink: 0;
          min-width: 0;
        }

        .search-bar {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 0;
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
          width: clamp(190px, 18vw, 250px);
          font-size: 13px;
          outline: none;
          transition: width 0.3s ease, background-color 0.3s ease;
          min-width: 0;
        }

        .search-input:focus {
          width: clamp(220px, 21vw, 290px);
          background-color: #e2e8f0;
        }

        .cart-action {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          text-decoration: none;
          color: inherit;
          flex-shrink: 0;
        }

        .cart-icon {
          font-size: 32px;
          color: #1a2c4e;
          margin-right: 0;
        }

        .cart-text {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          line-height: 1.1;
        }

        .cart-title {
          display: block;
          color: #3b82f6;
          font-weight: 700;
          font-size: 15px;
          line-height: 1.2;
          white-space: nowrap;
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

        .cart-icon-bounce {
          animation: cartShake 0.4s ease-in-out;
        }

        @keyframes badgeBounce {
          0% {
            transform: scale(1);
          }

          50% {
            transform: scale(1.4);
          }

          100% {
            transform: scale(1);
          }
        }

        @keyframes cartShake {
          0% {
            transform: rotate(0deg) scale(1);
          }

          25% {
            transform: rotate(-15deg) scale(1.2);
          }

          50% {
            transform: rotate(15deg) scale(1.2);
          }

          75% {
            transform: rotate(-5deg) scale(1.1);
          }

          100% {
            transform: rotate(0deg) scale(1);
          }
        }

        @media (max-width: 1024px) {
          .main-nav {
            display: none;
          }

          .header-content {
            gap: 1rem;
          }

          .search-input {
            width: clamp(160px, 32vw, 220px);
          }

          .search-input:focus {
            width: clamp(180px, 36vw, 240px);
          }
        }

        @media (max-width: 768px) {
          .site-header {
            min-height: 72px;
          }

          .header-content {
            min-height: 72px;
          }

          .logo-section {
            --brand-logo-size: 50px;
          }

          .actions-section {
            gap: 0.75rem;
          }

          .search-input {
            width: 160px;
          }

          .search-input:focus {
            width: 180px;
          }

          .cart-subtitle {
            display: none;
          }
        }

        @media (max-width: 640px) {
          .site-header {
            padding: 12px 16px;
          }

          .header-content {
            min-height: auto;
            flex-wrap: wrap;
            row-gap: 0.75rem;
          }

          .logo-section {
            --brand-logo-size: 46px;
            flex: 1 1 100%;
          }

          .actions-section {
            width: 100%;
            flex: 1 1 100%;
            justify-content: space-between;
          }

          .search-bar {
            flex: 1 1 auto;
          }

          .search-input,
          .search-input:focus {
            width: 100%;
          }

          .cart-text {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
