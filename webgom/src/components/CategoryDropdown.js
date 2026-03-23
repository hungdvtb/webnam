"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import stylesStandard from "../app/products/products.module.css";
import styles2 from "../app/products/layout2.module.css";

export default function CategoryDropdown({ categories, currentCategorySlug, variant = "layout1" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileViewportStyle, setMobileViewportStyle] = useState({});
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const styles = variant === "layout2" ? styles2 : stylesStandard;

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
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !isMobileViewport || typeof window === "undefined") {
      setMobileViewportStyle({});
      return undefined;
    }

    const syncPopupPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      setMobileViewportStyle({
        paddingTop: `${Math.max(12, Math.round(rect.bottom + 8))}px`,
        paddingLeft: `${Math.max(12, Math.round(rect.left))}px`,
        paddingRight: "12px",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
      });
    };

    const previousBodyOverflow = document.body.style.overflow;

    syncPopupPosition();
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", syncPopupPosition);
    window.addEventListener("scroll", syncPopupPosition, true);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("resize", syncPopupPosition);
      window.removeEventListener("scroll", syncPopupPosition, true);
    };
  }, [isOpen, isMobileViewport]);

  const currentCategory = categories.find((cat) => cat.slug === currentCategorySlug);
  const flattenedCategories = [];

  const flatten = (parentId = null, level = 0) => {
    categories
      .filter((cat) => (parentId === null ? !cat.parent_id : cat.parent_id === parentId))
      .forEach((cat) => {
        flattenedCategories.push({ ...cat, level });
        flatten(cat.id, level + 1);
      });
  };

  flatten();

  return (
    <div className={styles.categoryDropdown} ref={dropdownRef}>
      <button
        ref={triggerRef}
        className={`${styles.filterButton} ${isOpen ? styles.filterButtonActive : ""}`}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
        aria-expanded={isOpen}
        aria-controls="products-category-dropdown"
      >
        <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "var(--accent)" }}>
          grid_view
        </span>
        <span className={styles.filterButtonLabel}>
          {currentCategory ? currentCategory.name : "Tất cả sản phẩm"}
        </span>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: "18px",
            transition: "transform 0.3s",
            transform: isOpen ? "rotate(180deg)" : "rotate(0)",
          }}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            className={styles.dropdownBackdrop}
            aria-label="Đóng danh mục sản phẩm"
            onClick={() => setIsOpen(false)}
          />

          <div className={styles.dropdownViewport} style={isMobileViewport ? mobileViewportStyle : undefined}>
            <div id="products-category-dropdown" className={styles.dropdownContent}>
              <div className={styles.dropdownHeader}>
                <div>
                  <p className={styles.dropdownEyebrow}>Danh mục</p>
                  <h3 className={styles.dropdownTitle}>Tất cả sản phẩm</h3>
                </div>
                <button
                  type="button"
                  className={styles.dropdownClose}
                  aria-label="Đóng danh mục sản phẩm"
                  onClick={() => setIsOpen(false)}
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className={styles.dropdownList}>
                <Link
                  href="/products"
                  className={`${styles.dropdownItem} ${!currentCategorySlug ? styles.activeItem : ""}`}
                  onClick={() => setIsOpen(false)}
                  style={{ fontSize: "0.875rem" }}
                >
                  <div className={styles.itemInfo}>
                    <span className={styles.itemLabel}>Tất cả sản phẩm</span>
                  </div>
                </Link>

                {flattenedCategories.map((cat) => (
                  <Link
                    key={cat.id}
                    href={`/products?category=${cat.slug}`}
                    className={`${styles.dropdownItem} ${currentCategorySlug === cat.slug ? styles.activeItem : ""}`}
                    onClick={() => setIsOpen(false)}
                    style={{ fontSize: "0.875rem", paddingLeft: cat.level > 0 ? `${cat.level + 1}rem` : "1rem" }}
                  >
                    <div className={styles.itemInfo}>
                      <span className={styles.itemLabel}>
                        {cat.level > 0 ? "— " : ""}
                        {cat.name}
                      </span>
                      <span className={styles.itemCount}>{cat.products_count || 0}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
