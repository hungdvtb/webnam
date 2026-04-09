"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  branchContainsSlug,
  buildCategoryTree,
  flattenCategoryBranch,
  getSelectedParentIdForSlug,
  orderRootCategories,
} from "@/lib/categoryNavigation";
import stylesStandard from "../app/products/products.module.css";
import styles2 from "../app/products/layout2.module.css";

export default function CategoryDropdown({ categories, currentCategorySlug, variant = "layout1" }) {
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileViewportStyle, setMobileViewportStyle] = useState({});
  const [selectedParentId, setSelectedParentId] = useState(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownViewportRef = useRef(null);
  const dropdownListRef = useRef(null);
  const styles = variant === "layout2" ? styles2 : stylesStandard;
  const categoryTree = buildCategoryTree(categories);
  const orderedMobileParents = orderRootCategories(categoryTree, selectedParentId);

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
    setSelectedParentId(getSelectedParentIdForSlug(buildCategoryTree(categories), currentCategorySlug));
  }, [categories, currentCategorySlug]);

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

  useEffect(() => {
    if (!isOpen || !isMobileViewport || !selectedParentId || typeof window === "undefined") {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      dropdownViewportRef.current?.scrollTo({
        top: 0,
        behavior: "smooth",
      });
      dropdownListRef.current?.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isOpen, isMobileViewport, selectedParentId]);

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

  const buildCategoryHref = (categorySlug) => {
    const params = new URLSearchParams(searchParams?.toString() || "");

    if (categorySlug) {
      params.set("category", categorySlug);
    } else {
      params.delete("category");
    }

    params.delete("page");

    const query = params.toString();
    return query ? `/products?${query}` : "/products";
  };

  const handleMobileParentSelect = (parentId) => {
    setSelectedParentId((currentParentId) => (currentParentId === parentId ? null : parentId));
  };

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

          <div
            ref={dropdownViewportRef}
            className={styles.dropdownViewport}
            style={isMobileViewport ? mobileViewportStyle : undefined}
          >
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

              <div ref={dropdownListRef} className={styles.dropdownList}>
                <Link
                  href={buildCategoryHref("")}
                  className={`${styles.dropdownItem} ${!currentCategorySlug ? styles.activeItem : ""}`}
                  onClick={() => setIsOpen(false)}
                  style={{ fontSize: "0.875rem" }}
                >
                  <div className={styles.itemInfo}>
                    <span className={styles.itemLabel}>Tất cả sản phẩm</span>
                  </div>
                </Link>

                {!isMobileViewport &&
                  flattenedCategories.map((category) => (
                    <Link
                      key={category.id}
                      href={buildCategoryHref(category.slug)}
                      className={`${styles.dropdownItem} ${
                        currentCategorySlug === category.slug ? styles.activeItem : ""
                      }`}
                      onClick={() => setIsOpen(false)}
                      style={{
                        fontSize: "0.875rem",
                        paddingLeft: category.level > 0 ? `${category.level + 1}rem` : "1rem",
                      }}
                    >
                      <div className={styles.itemInfo}>
                        <span className={styles.itemLabel}>
                          {category.level > 0 ? "- " : ""}
                          {category.name}
                        </span>
                        <span className={styles.itemCount}>{category.products_count || 0}</span>
                      </div>
                    </Link>
                  ))}

                {isMobileViewport &&
                  orderedMobileParents.map((parentCategory) => {
                    const hasChildren =
                      Array.isArray(parentCategory.children) && parentCategory.children.length > 0;
                    const isExpanded = hasChildren && parentCategory._nodeKey === selectedParentId;
                    const isBranchActive = branchContainsSlug(parentCategory, currentCategorySlug);
                    const flattenedChildren = hasChildren
                      ? flattenCategoryBranch(parentCategory.children)
                      : [];

                    if (!hasChildren) {
                      return (
                        <Link
                          key={parentCategory._nodeKey}
                          href={buildCategoryHref(parentCategory.slug)}
                          className={`${styles.dropdownItem} ${
                            currentCategorySlug === parentCategory.slug ? styles.activeItem : ""
                          }`}
                          onClick={() => setIsOpen(false)}
                        >
                          <div className={styles.itemInfo}>
                            <span className={styles.itemLabel}>{parentCategory.name}</span>
                          </div>
                        </Link>
                      );
                    }

                    return (
                      <div key={parentCategory._nodeKey} className={styles.mobileCategoryGroup}>
                        <button
                          type="button"
                          className={`${styles.dropdownItem} ${styles.mobileCategoryParentButton} ${
                            isExpanded || isBranchActive ? styles.activeItem : ""
                          }`}
                          onClick={() => handleMobileParentSelect(parentCategory._nodeKey)}
                          aria-expanded={isExpanded}
                        >
                          <div className={styles.itemInfo}>
                            <span className={styles.itemLabel}>{parentCategory.name}</span>
                            <span className={styles.mobileCategoryParentMeta}>
                              <span
                                className={`material-symbols-outlined ${styles.mobileCategoryArrow} ${
                                  isExpanded ? styles.mobileCategoryArrowExpanded : ""
                                }`}
                              >
                                expand_more
                              </span>
                            </span>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className={styles.mobileCategoryChildren}>
                            {flattenedChildren.map((childCategory) => (
                              <Link
                                key={childCategory._nodeKey}
                                href={buildCategoryHref(childCategory.slug)}
                                className={`${styles.dropdownItem} ${styles.mobileCategoryChildItem} ${
                                  currentCategorySlug === childCategory.slug ? styles.activeItem : ""
                                }`}
                                onClick={() => setIsOpen(false)}
                                style={{ paddingLeft: `${1 + childCategory.level * 0.85}rem` }}
                              >
                                <div className={styles.itemInfo}>
                                  <span className={styles.itemLabel}>{childCategory.name}</span>
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
