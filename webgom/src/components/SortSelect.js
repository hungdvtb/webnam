"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import stylesStandard from "../app/products/products.module.css";
import styles2 from "../app/products/layout2.module.css";

const SORT_OPTIONS = [
  { value: "popular", label: "Ph\u1ed5 bi\u1ebfn nh\u1ea5t" },
  { value: "newest", label: "M\u1edbi nh\u1ea5t" },
  { value: "price_asc", label: "Gi\u00e1: Th\u1ea5p \u0111\u1ebfn cao" },
  { value: "price_desc", label: "Gi\u00e1: Cao \u0111\u1ebfn th\u1ea5p" },
];

const SORT_DIALOG_CLOSE_LABEL = "\u0110\u00f3ng s\u1eafp x\u1ebfp s\u1ea3n ph\u1ea9m";
const SORT_DIALOG_LABEL = "S\u1eafp x\u1ebfp s\u1ea3n ph\u1ea9m";
const SORT_DIALOG_EYEBROW = "S\u1eafp x\u1ebfp";
const SORT_DIALOG_TITLE = "Th\u1ee9 t\u1ef1 hi\u1ec3n th\u1ecb";
const SORT_LABEL = "S\u1eafp x\u1ebfp:";

export default function SortSelect({ currentSort, variant = "layout1" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const viewportRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileViewportStyle, setMobileViewportStyle] = useState({});
  const styles = variant === "layout2" ? styles2 : stylesStandard;
  const selectedSort = SORT_OPTIONS.find((option) => option.value === (currentSort || "popular")) || SORT_OPTIONS[0];

  const pushSort = (newSort) => {
    const params = new URLSearchParams(searchParams.toString());

    params.set("sort", newSort);
    params.delete("page");

    const query = params.toString();
    router.push(query ? `/products?${query}` : "/products", { scroll: false });
  };

  const handleSortChange = (event) => {
    pushSort(event.target.value);
  };

  const handleOptionSelect = (value) => {
    setIsOpen(false);
    pushSort(value);
  };

  useEffect(() => {
    setMounted(true);
  }, []);

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
      if (dropdownRef.current?.contains(event.target) || viewportRef.current?.contains(event.target)) {
        return;
      }

      setIsOpen(false);
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
      setMobileViewportStyle({});
      return undefined;
    }

    const syncPopupPosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      setMobileViewportStyle({
        paddingTop: `${Math.max(12, Math.round(rect.bottom + 12))}px`,
        paddingRight: "12px",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        paddingLeft: "12px",
      });
    };

    const previousBodyOverflow = document.body.style.overflow;

    syncPopupPosition();
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", syncPopupPosition);
    window.addEventListener("scroll", syncPopupPosition, true);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      setMobileViewportStyle({});
      window.removeEventListener("resize", syncPopupPosition);
      window.removeEventListener("scroll", syncPopupPosition, true);
    };
  }, [isMobileViewport, isOpen, variant]);

  const dropdownPanel = (
    <>
      <button
        type="button"
        className={isMobileViewport ? styles.sortDialogBackdrop : styles.dropdownBackdrop}
        aria-label={SORT_DIALOG_CLOSE_LABEL}
        onClick={() => setIsOpen(false)}
      />

      <div
        ref={viewportRef}
        className={isMobileViewport ? styles.sortDialogViewport : styles.dropdownViewport}
        style={isMobileViewport ? mobileViewportStyle : undefined}
      >
        <div
          id="products-sort-dropdown"
          className={isMobileViewport ? styles.sortDialogContent : styles.dropdownContent}
          role={isMobileViewport ? "dialog" : undefined}
          aria-modal={isMobileViewport ? "true" : undefined}
          aria-label={isMobileViewport ? SORT_DIALOG_LABEL : undefined}
          aria-labelledby={isMobileViewport ? "products-sort-dialog-title" : undefined}
        >
          <div className={styles.dropdownHeader}>
            <div>
              <p className={styles.dropdownEyebrow}>{SORT_DIALOG_EYEBROW}</p>
              <h3
                id={isMobileViewport ? "products-sort-dialog-title" : undefined}
                className={styles.dropdownTitle}
              >
                {SORT_DIALOG_TITLE}
              </h3>
            </div>
            <button
              type="button"
              className={styles.dropdownClose}
              aria-label={SORT_DIALOG_CLOSE_LABEL}
              onClick={() => setIsOpen(false)}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className={styles.dropdownList}>
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.dropdownItem} ${styles.dropdownAction} ${
                  option.value === selectedSort.value ? styles.activeItem : ""
                }`}
                onClick={() => handleOptionSelect(option.value)}
              >
                <div className={styles.itemInfo}>
                  <span className={styles.itemLabel}>{option.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );

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

        {isOpen && (isMobileViewport && mounted ? createPortal(dropdownPanel, document.body) : dropdownPanel)}
      </div>
    );
  }

  return (
    <div className={variant === "layout2" ? styles.sortContainer : styles.sortSelect}>
      {variant !== "layout2" && (
        <span className={styles.sortLabel}>{SORT_LABEL}</span>
      )}
      <select
        value={currentSort || "popular"}
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
