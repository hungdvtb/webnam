"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import stylesStandard from "../app/products/products.module.css";
import styles2 from "../app/products/layout2.module.css";

const SORT_OPTIONS = [
  { value: "popular", label: "Phổ biến nhất" },
  { value: "newest", label: "Mới nhất" },
  { value: "price_asc", label: "Giá: Thấp đến cao" },
  { value: "price_desc", label: "Giá: Cao đến thấp" },
];

export default function SortSelect({ currentSort, variant = "layout1" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const viewportRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const styles = variant === "layout2" ? styles2 : stylesStandard;
  const selectedSort = SORT_OPTIONS.find((option) => option.value === (currentSort || "popular")) || SORT_OPTIONS[0];

  const handleSortChange = (event) => {
    const newSort = event.target.value;
    const params = new URLSearchParams(searchParams.toString());

    params.set("sort", newSort);
    params.delete("page");

    router.push(`/products?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (variant === "layout2" || typeof window === "undefined") {
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
  }, [variant]);

  useEffect(() => {
    if (variant === "layout2") {
      return undefined;
    }

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
  }, [variant]);

  useEffect(() => {
    if (variant === "layout2" || !isOpen || !isMobileViewport || typeof window === "undefined") {
      return undefined;
    }

    const viewport = viewportRef.current;

    const syncPopupPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();

      if (!rect || !viewport) {
        return;
      }

      viewport.style.paddingTop = `${Math.max(12, Math.round(rect.bottom + 8))}px`;
      viewport.style.paddingLeft = `${Math.max(12, Math.round(rect.left))}px`;
      viewport.style.paddingRight = "12px";
      viewport.style.paddingBottom = "calc(env(safe-area-inset-bottom, 0px) + 96px)";
    };

    const previousBodyOverflow = document.body.style.overflow;

    syncPopupPosition();
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", syncPopupPosition);
    window.addEventListener("scroll", syncPopupPosition, true);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (viewport) {
        viewport.style.paddingTop = "";
        viewport.style.paddingLeft = "";
        viewport.style.paddingRight = "";
        viewport.style.paddingBottom = "";
      }
      window.removeEventListener("resize", syncPopupPosition);
      window.removeEventListener("scroll", syncPopupPosition, true);
    };
  }, [isMobileViewport, isOpen, variant]);

  const buildSortHref = (value) => {
    const params = new URLSearchParams(searchParams.toString());

    params.set("sort", value);
    params.delete("page");

    const query = params.toString();
    return query ? `/products?${query}` : "/products";
  };

  if (variant !== "layout2") {
    return (
      <div className={`${styles.categoryDropdown} ${styles.sortDropdown}`} ref={dropdownRef}>
        <button
          ref={triggerRef}
          className={`${styles.filterButton} ${isOpen ? styles.filterButtonActive : ""}`}
          onClick={() => setIsOpen((currentValue) => !currentValue)}
          type="button"
          aria-expanded={isOpen}
          aria-controls="products-sort-dropdown"
        >
          <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "var(--accent)" }}>
            swap_vert
          </span>
          <span className={styles.filterButtonLabel}>{selectedSort.label}</span>
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
              aria-label="Đóng sắp xếp sản phẩm"
              onClick={() => setIsOpen(false)}
            />

            <div ref={viewportRef} className={styles.dropdownViewport}>
              <div id="products-sort-dropdown" className={styles.dropdownContent}>
                <div className={styles.dropdownHeader}>
                  <div>
                    <p className={styles.dropdownEyebrow}>Sắp xếp</p>
                    <h3 className={styles.dropdownTitle}>Thứ tự hiển thị</h3>
                  </div>
                  <button
                    type="button"
                    className={styles.dropdownClose}
                    aria-label="Đóng sắp xếp sản phẩm"
                    onClick={() => setIsOpen(false)}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className={styles.dropdownList}>
                  {SORT_OPTIONS.map((option) => (
                    <Link
                      key={option.value}
                      href={buildSortHref(option.value)}
                      className={`${styles.dropdownItem} ${option.value === selectedSort.value ? styles.activeItem : ""}`}
                      onClick={() => setIsOpen(false)}
                    >
                      <div className={styles.itemInfo}>
                        <span className={styles.itemLabel}>{option.label}</span>
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

  return (
    <div className={variant === "layout2" ? styles.sortContainer : styles.sortSelect}>
      {variant !== "layout2" && (
        <span className={styles.sortLabel}>{"S\u1eafp x\u1ebfp:"}</span>
      )}
      <select
        defaultValue={currentSort || "popular"}
        onChange={handleSortChange}
        className={variant === "layout2" ? styles.sortSelect : styles.selectInput}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
