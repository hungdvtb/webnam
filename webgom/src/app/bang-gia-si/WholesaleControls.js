"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./wholesale.module.css";

const SEARCH_HISTORY_KEY = "webgom_wholesale_search_history";

const SORT_OPTIONS = [
  { value: "popular", label: "Ưu tiên hiển thị" },
  { value: "newest", label: "Mới cập nhật" },
  { value: "price_asc", label: "Giá sỉ tăng dần" },
  { value: "price_desc", label: "Giá sỉ giảm dần" },
];

const normalizeText = (value = "") => String(value || "").trim();

const normalizeHistoryEntry = (value = "") => normalizeText(value).replace(/\s+/g, " ");

const isExternalHref = (value = "") => /^(https?:|mailto:|tel:|zalo:)/i.test(String(value || "").trim());

const readSearchHistory = () => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .map(normalizeHistoryEntry)
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
};

const persistSearchHistory = (entries) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries.slice(0, 8)));
};

const flattenCategories = (categories = []) => {
  const byParent = new Map();

  categories.forEach((category) => {
    const parentId = category?.parent_id ?? null;
    const entries = byParent.get(parentId) || [];
    entries.push(category);
    byParent.set(parentId, entries);
  });

  const result = [];
  const walk = (parentId = null, level = 0) => {
    (byParent.get(parentId) || []).forEach((category) => {
      result.push({ ...category, level });
      walk(category.id, level + 1);
    });
  };

  walk(null, 0);

  if (result.length === 0) {
    categories.forEach((category) => result.push({ ...category, level: 0 }));
  }

  return result;
};

export function WholesaleSearchForm({
  currentSearch = "",
  className = "",
}) {
  const router = useRouter();
  const pathname = usePathname() || "/bang-gia-si";
  const searchParams = useSearchParams();
  const searchBoxRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState(currentSearch);
  const [searchHistory, setSearchHistory] = useState([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const normalizedSearchTerm = normalizeHistoryEntry(searchTerm).toLowerCase();
  const filteredSearchHistory = searchHistory.filter((entry) => (
    !normalizedSearchTerm || entry.toLowerCase().includes(normalizedSearchTerm)
  ));

  const updateQuery = useCallback((updates = {}, { replace = false } = {}) => {
    const params = new URLSearchParams(searchParams?.toString() || "");

    Object.entries(updates).forEach(([key, value]) => {
      const normalizedValue = normalizeText(value);

      if (normalizedValue) {
        params.set(key, normalizedValue);
      } else {
        params.delete(key);
      }
    });

    if (!Object.prototype.hasOwnProperty.call(updates, "page")) {
      params.delete("page");
    }

    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;

    if (replace) {
      router.replace(href, { scroll: false });
    } else {
      router.push(href, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  const addToSearchHistory = useCallback((value) => {
    const normalized = normalizeHistoryEntry(value);

    if (!normalized) {
      return;
    }

    setSearchHistory((current) => {
      const updated = [normalized, ...current.filter((entry) => entry !== normalized)].slice(0, 8);
      persistSearchHistory(updated);
      return updated;
    });
  }, []);

  const removeHistoryEntry = (entry) => {
    setSearchHistory((current) => {
      const updated = current.filter((item) => item !== entry);
      persistSearchHistory(updated);
      return updated;
    });
  };

  useEffect(() => {
    setSearchHistory(readSearchHistory());
  }, []);

  useEffect(() => {
    setSearchTerm(currentSearch);
  }, [currentSearch]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) {
        setShowSearchHistory(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const nextSearch = normalizeHistoryEntry(searchTerm);

    if (nextSearch === normalizeHistoryEntry(currentSearch)) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      updateQuery({ search: nextSearch }, { replace: true });
    }, nextSearch ? 320 : 0);

    return () => window.clearTimeout(timerId);
  }, [currentSearch, searchTerm, updateQuery]);

  const submitSearch = (event) => {
    event.preventDefault();
    const nextSearch = normalizeHistoryEntry(searchTerm);
    addToSearchHistory(nextSearch);
    setShowSearchHistory(false);
    updateQuery({ search: nextSearch });
  };

  const selectHistoryEntry = (entry) => {
    setSearchTerm(entry);
    addToSearchHistory(entry);
    setShowSearchHistory(false);
    updateQuery({ search: entry });
  };

  const clearSearch = () => {
    setSearchTerm("");
    setShowSearchHistory(false);
    updateQuery({ search: "" });
  };

  return (
    <form className={`${styles.searchForm} ${className}`} onSubmit={submitSearch} ref={searchBoxRef}>
      <span className={`material-symbols-outlined ${styles.searchIcon}`} aria-hidden="true">search</span>
      <input
        type="search"
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
        onFocus={() => setShowSearchHistory(true)}
        placeholder="Tìm nhanh sản phẩm"
        className={styles.searchInput}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {searchTerm ? (
        <button type="button" className={styles.clearSearchButton} onClick={clearSearch} aria-label="Xóa tìm kiếm">
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      ) : null}

      {showSearchHistory && filteredSearchHistory.length > 0 ? (
        <div className={styles.searchHistoryPanel} role="dialog" aria-label="Lịch sử tìm kiếm">
          <div className={styles.searchHistoryHeader}>
            <span>Lịch sử tìm kiếm</span>
            <button
              type="button"
              onClick={() => {
                setSearchHistory([]);
                persistSearchHistory([]);
              }}
            >
              Xóa
            </button>
          </div>
          {filteredSearchHistory.map((entry) => (
            <div key={entry} className={styles.searchHistoryItem}>
              <button type="button" onClick={() => selectHistoryEntry(entry)}>
                <span className="material-symbols-outlined" aria-hidden="true">history</span>
                <span>{entry}</span>
              </button>
              <button type="button" onClick={() => removeHistoryEntry(entry)} aria-label={`Xóa ${entry}`}>
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}

export default function WholesaleControls({
  categories = [],
  currentCategorySlug = "",
  currentSearch = "",
  currentSort = "popular",
  total = 0,
  contactHref = "",
  showSearch = true,
}) {
  const router = useRouter();
  const pathname = usePathname() || "/bang-gia-si";
  const searchParams = useSearchParams();
  const flattenedCategories = useMemo(() => flattenCategories(categories), [categories]);
  const parentCategories = useMemo(
    () => categories.filter((category) => !category?.parent_id),
    [categories],
  );

  const selectedSort = SORT_OPTIONS.find((option) => option.value === currentSort) || SORT_OPTIONS[0];

  const updateQuery = useCallback((updates = {}, { replace = false } = {}) => {
    const params = new URLSearchParams(searchParams?.toString() || "");

    Object.entries(updates).forEach(([key, value]) => {
      const normalizedValue = normalizeText(value);

      if (normalizedValue) {
        params.set(key, normalizedValue);
      } else {
        params.delete(key);
      }
    });

    if (!Object.prototype.hasOwnProperty.call(updates, "page")) {
      params.delete("page");
    }

    const query = params.toString();
    const href = query ? `${pathname}?${query}` : pathname;

    if (replace) {
      router.replace(href, { scroll: false });
    } else {
      router.push(href, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  return (
    <section
      className={`${styles.controlsSection} ${!showSearch ? styles.controlsSectionNoSearch : ""}`}
      data-wholesale-sticky-layer="controls"
      aria-label="Bộ lọc bảng giá sỉ"
    >
      <div className={styles.controlsSummary}>
        <span className="material-symbols-outlined" aria-hidden="true">inventory_2</span>
        <strong>{new Intl.NumberFormat("vi-VN").format(total)}</strong>
        <span>sản phẩm trong bảng</span>
      </div>

      {showSearch ? <WholesaleSearchForm currentSearch={currentSearch} /> : null}

      <label className={styles.selectWrap}>
        <span>Danh mục</span>
        <select
          value={currentCategorySlug}
          onChange={(event) => updateQuery({ category: event.target.value })}
          className={styles.categorySelect}
        >
          <option value="">Tất cả sản phẩm</option>
          {flattenedCategories.map((category) => (
            <option key={category.id || category.slug} value={category.slug}>
              {"--".repeat(category.level || 0)} {category.name}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.selectWrap}>
        <span>Sắp xếp</span>
        <select
          value={selectedSort.value}
          onChange={(event) => updateQuery({ sort: event.target.value })}
          className={styles.categorySelect}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <a
        href={contactHref || "#wholesale-policy"}
        className={styles.quoteButton}
        target={isExternalHref(contactHref) ? "_blank" : undefined}
        rel={isExternalHref(contactHref) ? "noreferrer" : undefined}
      >
        <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
        Liên hệ đặt hàng
      </a>

      {parentCategories.length > 0 ? (
        <div className={styles.categoryChips} aria-label="Danh mục nhanh">
          <button
            type="button"
            className={`${styles.categoryChip} ${!currentCategorySlug ? styles.categoryChipActive : ""}`}
            onClick={() => updateQuery({ category: "" })}
          >
            Tất cả
          </button>
          {parentCategories.map((category) => (
            <button
              key={category.id || category.slug}
              type="button"
              className={`${styles.categoryChip} ${currentCategorySlug === category.slug ? styles.categoryChipActive : ""}`}
              onClick={() => updateQuery({ category: category.slug })}
              title={category.name}
            >
              {category.name}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
