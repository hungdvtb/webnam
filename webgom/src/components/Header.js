"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";

const DEFAULT_BRAND_TITLE = "G\u1ed1m \u0110\u1ea1i Th\u00e0nh";
const DEFAULT_SEARCH_PLACEHOLDER = "B\u1ea1n c\u1ea7n t\u00ecm ki\u1ebfm s\u1ea3n ph\u1ea9m g\u00ec?";
const DEFAULT_NAV_ITEMS = [
  { id: "header-default-products", title: "S\u1ea3n ph\u1ea9m", url: "/products" },
  { id: "header-default-about", title: "V\u1ec1 ch\u00fang t\u00f4i", url: "/about" },
  { id: "header-default-blog", title: "Ki\u1ebfn th\u1ee9c g\u1ed1m", url: "/blog" },
  { id: "header-default-stores", title: "H\u1ec7 th\u1ed1ng c\u1eeda h\u00e0ng", url: "/stores" },
];
const MOBILE_NAV_META = [
  {
    labelKeys: ["san pham"],
    hrefKeys: ["/products", "/san-pham"],
    icon: "inventory_2",
    shortLabel: "S\u1ea3n ph\u1ea9m",
    activePrefixes: ["/products", "/product", "/san-pham"],
  },
  {
    labelKeys: ["ve chung toi"],
    hrefKeys: ["/about"],
    icon: "groups_2",
    shortLabel: "Gi\u1edbi thi\u1ec7u",
    activePrefixes: ["/about"],
  },
  {
    labelKeys: ["kien thuc gom"],
    hrefKeys: ["/blog"],
    icon: "menu_book",
    shortLabel: "Ki\u1ebfn th\u1ee9c",
    activePrefixes: ["/blog"],
  },
  {
    labelKeys: ["he thong cua hang"],
    hrefKeys: ["/stores", "/he-thong-cua-hang"],
    icon: "location_on",
    shortLabel: "Showroom",
    activePrefixes: ["/stores", "/he-thong-cua-hang"],
  },
];
const MOBILE_ORDER_ITEM = {
  id: "mobile-nav-order",
  href: "/cart",
  title: "\u0110\u1eb7t h\u00e0ng",
  shortLabel: "\u0110\u1eb7t h\u00e0ng",
  icon: "shopping_bag",
  activePrefixes: ["/cart", "/dat-hang", "/checkout", "/cam-on", "/order-success", "/order-history"],
};

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

const toUpperNavLabel = (value = "") => String(value || "").toLocaleUpperCase("vi-VN");
const normalizePath = (value = "") => {
  const trimmed = String(value || "").trim();

  if (!trimmed) return "/";
  if (isExternalUrl(trimmed) || /^(mailto:|tel:|zalo:)/i.test(trimmed)) return trimmed;

  const [pathOnly] = trimmed.split(/[?#]/);
  const normalized = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly.replace(/^\/+/, "")}`;

  return normalized || "/";
};
const getMobileMenuMeta = (item = {}) => {
  const label = toComparableText(item?.title || item?.label || "");
  const href = normalizePath(item?.url || item?.link || "#");

  return (
    MOBILE_NAV_META.find(
      (entry) =>
        entry.labelKeys.some((key) => label.includes(key)) ||
        entry.hrefKeys.includes(href)
    ) || {
      icon: "apps",
      shortLabel: String(item?.title || item?.label || "Menu").trim() || "Menu",
      activePrefixes: [href],
    }
  );
};
const buildMobileMenuItems = (items = []) =>
  [
    ...items.slice(0, 4).map((item, index) => {
      const meta = getMobileMenuMeta(item);

      return {
        id: String(item?.id ?? `mobile-nav-${index + 1}`),
        href: String(item?.url || item?.link || "#").trim() || "#",
        title: String(item?.title || item?.label || meta.shortLabel).trim() || meta.shortLabel,
        shortLabel: meta.shortLabel,
        icon: meta.icon,
        activePrefixes: meta.activePrefixes,
      };
    }),
    MOBILE_ORDER_ITEM,
  ];
const isMobileMenuItemActive = (pathname, item) => {
  const currentPath = normalizePath(pathname);

  return item.activePrefixes.some((prefix) => {
    const normalizedPrefix = normalizePath(prefix);

    if (!normalizedPrefix || normalizedPrefix === "#") {
      return false;
    }

    if (normalizedPrefix === "/") {
      return currentPath === "/";
    }

    return currentPath === normalizedPrefix || currentPath.startsWith(`${normalizedPrefix}/`);
  });
};

const flattenProductCategories = (categories = []) => {
  const flattened = [];

  const walk = (parentId = null, level = 0) => {
    categories
      .filter((category) => (parentId === null ? !category?.parent_id : category?.parent_id === parentId))
      .forEach((category) => {
        flattened.push({
          id: category?.id,
          name: String(category?.name || "").trim(),
          slug: String(category?.slug || "").trim(),
          level,
          count: Number(category?.products_count || 0),
        });
        walk(category?.id, level + 1);
      });
  };

  walk();

  return flattened.filter((category) => category.name && category.slug);
};

const renderNavLink = (item) => {
  const href = String(item?.url || item?.link || "#").trim() || "#";
  const label = String(item?.title || item?.label || "").trim();
  const displayLabel = toUpperNavLabel(label);

  if (!displayLabel) return null;

  if (isExternalUrl(href)) {
    return (
      <a href={href} className="nav-link" target="_blank" rel="noopener noreferrer">
        {displayLabel}
      </a>
    );
  }

  return (
    <Link href={href} className="nav-link">
      {displayLabel}
    </Link>
  );
};

export default function Header({
  menuItems = [],
  brandText = DEFAULT_BRAND_TITLE,
  logoUrl = "",
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
  productCategories = [],
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileProductsMenuOpen, setIsMobileProductsMenuOpen] = useState(false);
  const [currentMobileCategorySlug, setCurrentMobileCategorySlug] = useState("");
  const { cartCount } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const mobileProductsMenuRef = useRef(null);
  const mobileProductsToggleRef = useRef(null);
  const cartBadgeLabel = cartCount > 99 ? "99+" : cartCount;
  const navigationItems = menuItems.length > 0 ? menuItems : DEFAULT_NAV_ITEMS;
  const mobileMenuItems = buildMobileMenuItems(navigationItems);
  const flattenedProductCategories = flattenProductCategories(productCategories);

  const resolvedBrandTitle = normalizeBrandTitle(brandText);
  const resolvedLogoUrl = String(logoUrl || "").trim() || "/logo-dai-thanh.png";
  const resolvedSearchPlaceholder =
    String(searchPlaceholder || "").trim() || DEFAULT_SEARCH_PLACEHOLDER;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);

    syncViewport();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);

      return () => mediaQuery.removeEventListener("change", syncViewport);
    }

    mediaQuery.addListener(syncViewport);

    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileProductsMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;

      if (
        mobileProductsMenuRef.current?.contains(target) ||
        mobileProductsToggleRef.current?.contains(target)
      ) {
        return;
      }

      setIsMobileProductsMenuOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsMobileProductsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileProductsMenuOpen]);

  useEffect(() => {
    setIsMobileProductsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextCategorySlug = new URLSearchParams(window.location.search).get("category") || "";
    setCurrentMobileCategorySlug(nextCategorySlug);
  }, [pathname, isMobileProductsMenuOpen]);

  const handleSearch = (event) => {
    if ((event.type === "keydown" && event.key === "Enter") || event.type === "click") {
      if (searchQuery.trim()) {
        router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      }
    }
  };

  const toggleMobileProductsMenu = () => {
    setIsMobileProductsMenuOpen((currentValue) => !currentValue);
  };

  return (
    <>
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

        {!isMobileViewport && (
          <nav className="main-nav">
            <ul className="nav-list">
              {navigationItems.map((item) => (
                  <li key={item.id || item.url || item.link} className="nav-item">
                    {renderNavLink(item)}
                  </li>
                ))}
            </ul>
          </nav>
        )}

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

          <Link
            href="/cart"
            className="cart-action"
            aria-label={`Giỏ hàng, có ${cartCount} sản phẩm`}
          >
            <span className="cart-icon-wrap">
              <span
                key={`cart-icon-${cartCount}`}
                className={`material-symbols-outlined cart-icon ${cartCount > 0 ? "cart-icon-bounce" : ""}`}
              >
                shopping_cart
              </span>
              {cartCount > 0 && (
                <span
                  key={`cart-badge-${cartCount}`}
                  className={`cart-badge ${cartCount > 99 ? "cart-badge-wide" : ""}`}
                  suppressHydrationWarning
                >
                  {cartBadgeLabel}
                </span>
              )}
            </span>
            {!isMobileViewport && (
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
            )}
          </Link>
        </div>
        </div>

      </header>

      {mobileMenuItems.length > 0 && (
        <>
          {isMobileProductsMenuOpen && (
            <button
              className="mobile-products-backdrop"
              type="button"
              aria-label="Dong danh muc san pham"
              onClick={() => setIsMobileProductsMenuOpen(false)}
            />
          )}

          {flattenedProductCategories.length > 0 && (
            <div
              id="mobile-products-sheet"
              ref={mobileProductsMenuRef}
              className={`mobile-products-sheet ${isMobileProductsMenuOpen ? "mobile-products-sheet-open" : ""}`}
              aria-hidden={!isMobileProductsMenuOpen}
            >
              <div className="mobile-products-sheet__header">
                <div>
                  <p className="mobile-products-sheet__eyebrow">Danh muc nhanh</p>
                  <h3 className="mobile-products-sheet__title">Danh mục sản phẩm</h3>
                </div>
                <button
                  type="button"
                  className="mobile-products-sheet__close"
                  aria-label="Dong danh muc san pham"
                  onClick={() => setIsMobileProductsMenuOpen(false)}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="mobile-products-sheet__list">
                <Link
                  href="/products"
                  className={`mobile-products-link ${normalizePath(pathname) === "/products" && !currentMobileCategorySlug ? "mobile-products-link-active" : ""}`}
                  onClick={() => setIsMobileProductsMenuOpen(false)}
                >
                  <span className="mobile-products-link__name">Tất cả sản phẩm</span>
                  <span className="material-symbols-outlined mobile-products-link__arrow">chevron_right</span>
                </Link>

                {flattenedProductCategories.map((category) => {
                  const isCategoryActive =
                    normalizePath(pathname) === "/products" &&
                    currentMobileCategorySlug === category.slug;

                  return (
                    <Link
                      key={category.id || category.slug}
                      href={`/products?category=${category.slug}`}
                      className={`mobile-products-link ${isCategoryActive ? "mobile-products-link-active" : ""}`}
                      onClick={() => setIsMobileProductsMenuOpen(false)}
                      style={{ paddingLeft: `${16 + (category.level * 14)}px` }}
                    >
                      <span className="mobile-products-link__name">
                        {category.level > 0 ? "— " : ""}
                        {category.name}
                      </span>
                      <span className="mobile-products-link__count">{category.count}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <nav className="mobile-bottom-nav" aria-label="Dieu huong nhanh tren di dong">
            <div className="mobile-bottom-nav__inner">
              {mobileMenuItems.map((item) => {
                const isProductsTrigger = item.id === "header-default-products" || item.shortLabel === "Sản phẩm";
                const isActive = isProductsTrigger
                  ? isMobileProductsMenuOpen || isMobileMenuItemActive(pathname, item)
                  : isMobileMenuItemActive(pathname, item);
                const className = `mobile-bottom-item ${isActive ? "mobile-bottom-item-active" : ""}`;

                const content = (
                  <span className="mobile-bottom-item__content">
                    <span
                      className={`mobile-bottom-item__icon-wrap ${
                        isActive ? "mobile-bottom-item__icon-wrap-active" : ""
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined mobile-bottom-item__icon ${
                          isActive ? "mobile-bottom-item__icon-active" : ""
                        }`}
                      >
                        {item.icon}
                      </span>
                    </span>
                    <span className="mobile-bottom-item__label-wrap">
                      <span className="mobile-bottom-item__label">{item.shortLabel}</span>
                    </span>
                  </span>
                );

                if (isProductsTrigger && flattenedProductCategories.length > 0) {
                  return (
                    <button
                      key={item.id}
                      ref={mobileProductsToggleRef}
                      type="button"
                      className={`${className} mobile-bottom-item-button`}
                      title={item.title}
                      aria-expanded={isMobileProductsMenuOpen}
                      aria-controls="mobile-products-sheet"
                      onClick={toggleMobileProductsMenu}
                    >
                      {content}
                    </button>
                  );
                }

                if (isExternalUrl(item.href)) {
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      className={className}
                      title={item.title}
                      aria-current={isActive ? "page" : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {content}
                    </a>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={className}
                    title={item.title}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}

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

        .cart-icon-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .cart-badge {
          position: absolute;
          top: -6px;
          right: -10px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.96);
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.02em;
          box-shadow: 0 6px 14px rgba(220, 38, 38, 0.24);
          animation: badgePop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        .cart-badge-wide {
          min-width: 24px;
          padding: 0 6px;
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

        @keyframes badgePop {
          0% {
            transform: scale(0.72);
            opacity: 0.72;
          }

          72% {
            transform: scale(1.12);
            opacity: 1;
          }

          100% {
            transform: scale(1);
            opacity: 1;
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
            position: relative;
            top: auto;
            z-index: auto;
            min-height: 72px;
          }

          .header-content {
            min-height: 72px;
            flex-wrap: nowrap;
          }

          .logo-section {
            --brand-logo-size: 50px;
          }

          .actions-section {
            flex: 1 1 auto;
            min-width: 0;
            gap: 0.75rem;
          }

          .search-bar {
            flex: 1 1 auto;
            min-width: 0;
          }

          .search-input {
            width: 100%;
          }

          .search-input:focus {
            width: 100%;
          }

          .cart-subtitle {
            display: none;
          }
        }

        @media (max-width: 640px) {
          .site-header {
            min-height: 68px;
            padding: 10px 12px;
          }

          .header-content {
            min-height: 68px;
            flex-wrap: nowrap;
            gap: 0.625rem;
          }

          .logo-section {
            --brand-logo-size: 42px;
            flex: 0 0 auto;
          }

          .actions-section {
            flex: 1 1 auto;
            width: auto;
            justify-content: flex-end;
            min-width: 0;
            gap: 0.625rem;
          }

          .search-bar {
            flex: 1 1 auto;
            min-width: 0;
          }

          .search-input,
          .search-input:focus {
            width: 100%;
            min-width: 0;
            font-size: 12px;
            padding: 6px 14px 6px 34px;
          }

          .cart-text {
            display: none;
          }

          .cart-action {
            flex: 0 0 auto;
          }

          .cart-icon {
            font-size: 29px;
          }

          .cart-badge {
            top: -5px;
            right: -8px;
            min-width: 17px;
            height: 17px;
            padding: 0 4px;
            font-size: 9px;
          }

          .cart-badge-wide {
            min-width: 22px;
            padding: 0 5px;
          }
        }

        @media (max-width: 420px) {
          .site-header {
            padding: 8px 10px;
          }

          .header-content {
            gap: 0.5rem;
          }

          .logo-section {
            --brand-logo-size: 38px;
          }

          .logo-img-box {
            border-radius: 10px;
          }

          .actions-section {
            gap: 0.5rem;
          }

          .search-input,
          .search-input:focus {
            padding: 6px 12px 6px 32px;
          }

          .search-icon {
            left: 10px;
            font-size: 18px !important;
          }

          .cart-icon {
            font-size: 27px;
          }

          .cart-badge {
            right: -7px;
          }
        }
      `}</style>
      <style jsx>{`
        .mobile-products-backdrop,
        .mobile-products-sheet {
          display: none;
        }

        .mobile-bottom-nav {
          display: none;
        }

        @media (max-width: 767px) {
          .mobile-products-backdrop {
            position: fixed;
            inset: 0;
            z-index: 993;
            display: block;
            border: 0;
            background: rgba(15, 23, 42, 0.08);
            padding: 0;
            cursor: default;
          }

          .mobile-products-sheet {
            position: fixed;
            left: 12px;
            right: auto;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 86px);
            z-index: 996;
            display: block;
            width: min(calc(100vw - 24px), 296px);
            max-height: none;
            padding: 12px;
            border: 1px solid rgba(197, 160, 89, 0.18);
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.98);
            backdrop-filter: blur(20px);
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
            overflow: visible;
            opacity: 0;
            transform: translateY(16px) scale(0.98);
            pointer-events: none;
            transition:
              opacity 180ms ease,
              transform 220ms ease;
          }

          .mobile-products-sheet-open {
            opacity: 1;
            transform: translateY(0) scale(1);
            pointer-events: auto;
          }

          .mobile-products-sheet__header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.75rem;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(226, 232, 240, 0.9);
          }

          .mobile-products-sheet__eyebrow {
            margin: 0 0 3px;
            color: #b58a3c;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .mobile-products-sheet__title {
            margin: 0;
            color: #1a2c4e;
            font-size: 15px;
            font-weight: 800;
            line-height: 1.25;
          }

          .mobile-products-sheet__close {
            width: 30px;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: 999px;
            background: #f8fafc;
            color: #334155;
            flex-shrink: 0;
          }

          .mobile-products-sheet__close :global(.material-symbols-outlined) {
            font-size: 18px !important;
          }

          .mobile-products-sheet__list {
            display: flex;
            flex-direction: column;
            gap: 5px;
            margin-top: 10px;
            overflow: visible;
          }

          .mobile-products-link {
            width: 100%;
            min-height: 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 10px 12px;
            border-radius: 12px;
            background: #fff;
            color: #1f2a44;
            text-decoration: none;
            box-shadow: inset 0 0 0 1px rgba(226, 232, 240, 0.9);
            transition:
              background-color 180ms ease,
              color 180ms ease,
              box-shadow 180ms ease,
              transform 180ms ease;
          }

          .mobile-products-link:active {
            transform: scale(0.985);
          }

          .mobile-products-link-active {
            background: linear-gradient(180deg, rgba(248, 243, 233, 0.94) 0%, rgba(255, 255, 255, 0.98) 100%);
            color: #1a2c4e;
            box-shadow: inset 0 0 0 1px rgba(197, 160, 89, 0.26);
          }

          .mobile-products-link__name {
            min-width: 0;
            font-size: 12px;
            font-weight: 700;
            line-height: 1.3;
          }

          .mobile-products-link__count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 22px;
            padding: 0 7px;
            border-radius: 999px;
            background: #f8f3e9;
            color: #946d26;
            font-size: 10px;
            font-weight: 800;
            flex-shrink: 0;
          }

          .mobile-products-link__arrow {
            color: #94a3b8;
            font-size: 16px !important;
            flex-shrink: 0;
          }

          .mobile-bottom-nav {
            position: fixed;
            inset: auto 0 0;
            z-index: 995;
            display: block;
            padding: 0 10px calc(env(safe-area-inset-bottom, 0px) + 10px);
            pointer-events: none;
          }

          .mobile-bottom-nav__inner {
            max-width: var(--max-width);
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            align-items: stretch;
            gap: 6px;
            padding: 8px 8px;
            border: 1px solid rgba(197, 160, 89, 0.14);
            border-radius: 20px 20px 0 0;
            background: rgba(255, 255, 255, 0.97);
            backdrop-filter: blur(18px);
            box-shadow: 0 -12px 30px rgba(15, 23, 42, 0.12);
            pointer-events: auto;
          }

          .mobile-bottom-item {
            box-sizing: border-box;
            width: 100%;
            min-width: 0;
            display: flex;
            align-items: stretch;
            justify-content: stretch;
            min-height: 64px;
            padding: 0;
            border: 0;
            background: transparent;
            color: #44546d;
            text-decoration: none;
            text-align: center;
            transition:
              background-color 180ms ease,
              color 180ms ease,
              border-color 180ms ease,
              transform 180ms ease,
              box-shadow 180ms ease;
          }

          .mobile-bottom-item-button {
            border: 0;
            background: transparent;
            font: inherit;
            appearance: none;
            cursor: pointer;
          }

          .mobile-bottom-item__content {
            box-sizing: border-box;
            width: 100%;
            min-width: 0;
            min-height: 64px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 7px 3px 6px;
            border: 1px solid transparent;
            border-radius: 14px;
            background: transparent;
            transition:
              background-color 180ms ease,
              border-color 180ms ease,
              box-shadow 180ms ease,
              color 180ms ease;
          }

          .mobile-bottom-item:hover .mobile-bottom-item__content,
          .mobile-bottom-item:focus-visible .mobile-bottom-item__content {
            color: #1a2c4e;
            border-color: rgba(197, 160, 89, 0.16);
            background: rgba(26, 44, 78, 0.05);
            outline: none;
          }

          .mobile-bottom-item-active .mobile-bottom-item__content {
            color: #1a2c4e;
            border-color: rgba(197, 160, 89, 0.22);
            background: linear-gradient(180deg, rgba(248, 243, 233, 0.9) 0%, rgba(255, 255, 255, 0.98) 100%);
            box-shadow: inset 0 0 0 1px rgba(197, 160, 89, 0.14);
          }

          .mobile-bottom-item__icon-wrap {
            box-sizing: border-box;
            width: 24px;
            min-width: 24px;
            height: 24px;
            flex: 0 0 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            border-radius: 999px;
            background: rgba(26, 44, 78, 0.06);
            transition: background-color 180ms ease, color 180ms ease;
          }

          .mobile-bottom-item__icon {
            display: block;
            font-size: 15px !important;
            line-height: 1;
          }

          .mobile-bottom-item__icon-wrap-active {
            background: rgba(197, 160, 89, 0.18);
            color: var(--accent);
          }

          .mobile-bottom-item__icon-active {
            color: var(--accent);
            font-variation-settings: "FILL" 1, "wght" 500, "GRAD" 0, "opsz" 24;
          }

          .mobile-bottom-item__label-wrap {
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 18px;
            flex: 0 0 18px;
          }

          .mobile-bottom-item__label {
            display: block;
            max-width: 100%;
            font-size: 8px;
            font-weight: 700;
            line-height: 1.15;
            text-align: center;
            white-space: nowrap;
            margin: 0;
            padding: 0;
          }

          :global(body) {
            padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 92px);
          }
        }

        @media (max-width: 420px) {
          .mobile-products-sheet {
            left: 8px;
            width: min(calc(100vw - 16px), 282px);
            bottom: calc(env(safe-area-inset-bottom, 0px) + 82px);
            padding: 11px;
          }

          .mobile-products-sheet__title {
            font-size: 14px;
          }

          .mobile-products-link {
            min-height: 38px;
            padding: 9px 11px;
            border-radius: 12px;
          }

          .mobile-products-link__name {
            font-size: 11.5px;
          }

          .mobile-bottom-nav {
            padding: 0 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
          }

          .mobile-bottom-nav__inner {
            gap: 4px;
            padding: 8px 7px;
          }

          .mobile-bottom-item,
          .mobile-bottom-item__content {
            min-height: 60px;
          }

          .mobile-bottom-item__content {
            gap: 4px;
            padding: 6px 2px 5px;
          }

          .mobile-bottom-item__icon-wrap {
            width: 22px;
            height: 22px;
            min-width: 22px;
            flex-basis: 22px;
          }

          .mobile-bottom-item__icon {
            font-size: 14px !important;
          }

          .mobile-bottom-item__label-wrap {
            min-height: 16px;
            flex-basis: 16px;
          }

          .mobile-bottom-item__label {
            font-size: 7.1px;
          }
        }
      `}</style>
    </>
  );
}
