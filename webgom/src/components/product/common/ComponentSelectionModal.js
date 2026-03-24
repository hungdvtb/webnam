'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { getWebProducts, fetchFromApi } from '@/lib/api';
import styles from '../builder.module.css';

/**
 * ComponentSelectionModal
 * 
 * Two-mode modal:
 *  - "variants" tab: shows variants of the same parent product (fetched via API)
 *  - "search"   tab: general search across all products
 */
export default function ComponentSelectionModal({ 
  isOpen, 
  onClose, 
  onSelect, 
  currentSlot, 
  getImageUrl, 
  formatPrice 
}) {
  const [mode, setMode] = useState('variants');  // 'variants' | 'search'
  const [searchTerm, setSearchTerm] = useState('');
  const [variants, setVariants] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [mobileTopOffset, setMobileTopOffset] = useState(0);
  const savedScrollTopRef = useRef(0);

  const restorePageScrollPosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const targetTop = savedScrollTopRef.current || 0;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: targetTop, behavior: 'auto' });
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    restorePageScrollPosition();
  }, [onClose, restorePageScrollPosition]);

  const handleSelectItem = useCallback((item) => {
    onSelect(item);
    restorePageScrollPosition();
  }, [onSelect, restorePageScrollPosition]);

  // Load variants of current slot's parent product
  const fetchVariants = useCallback(async () => {
    const identifier = currentSlot?.slug || currentSlot?.id;
    if (!isOpen || !identifier) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchFromApi(`/web-api/products/${identifier}`);
      const data = res || {};
      // For configurable products: linked_products with super_link
      const linked = (data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
      if (linked.length > 0) {
        setVariants(linked);
      } else if (data.variations?.length > 0) {
        // Already has variations array
        setVariants(data.variations);
      } else if (data.id) {
        // Simple product — show itself as only option
        setVariants([data]);
      } else {
        setErrorMsg("API không trả về thông tin sản phẩm: " + JSON.stringify(data));
        setVariants([]);
      }
    } catch (e) {
      console.error(e);
      setErrorMsg("Lỗi khi gọi API biến thể: " + e.message + " | slug: " + currentSlot.slug);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, currentSlot]);

  // Load search results
  const fetchSearch = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = { search: searchTerm || currentSlot?.name || '', per_page: 12, allow_variants: 1 };
      const res = await getWebProducts(params);
      setSearchResults(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (e) {
      console.error(e);
      setErrorMsg("Lỗi khi tìm kiếm: " + e.message);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, searchTerm, currentSlot]);

  // Reset when slot changes
  useEffect(() => {
    if (isOpen) {
      setMode('variants');
      setSearchTerm('');
      setVariants([]);
      setSearchResults([]);
      fetchVariants();
    }
  }, [isOpen, currentSlot?.id]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      setMobileTopOffset(0);
      return undefined;
    }

    savedScrollTopRef.current = window.scrollY || window.pageYOffset || 0;

    const syncMobileTopOffset = () => {
      const isMobileViewport = window.matchMedia('(max-width: 768px)').matches;

      if (!isMobileViewport) {
        setMobileTopOffset(0);
        return;
      }

      const mobileHeaderShell = document.querySelector('.mobile-sticky-header-shell');
      const shellRect = mobileHeaderShell?.getBoundingClientRect();
      const shellHeight = Math.round(shellRect?.height || mobileHeaderShell?.offsetHeight || 0);
      setMobileTopOffset(shellHeight > 0 ? shellHeight + 14 : 96);
    };

    syncMobileTopOffset();
    window.addEventListener('resize', syncMobileTopOffset);

    return () => {
      window.removeEventListener('resize', syncMobileTopOffset);
    };
  }, [isOpen]);

  // Re-fetch search when searchTerm changes
  useEffect(() => {
    if (mode !== 'search' || !isOpen) return;
    const t = setTimeout(fetchSearch, 300);
    return () => clearTimeout(t);
  }, [mode, searchTerm, fetchSearch]);

  // Initial search load when switching to search tab
  useEffect(() => {
    if (mode === 'search' && isOpen && searchResults.length === 0 && !loading) {
      fetchSearch();
    }
  }, [mode]);

  if (!isOpen) return null;

  const displayItems = mode === 'variants' ? variants : searchResults;

  return (
    <div
      className={styles.modalOverlay}
      style={mobileTopOffset > 0 ? { '--bundle-mobile-modal-offset': `${mobileTopOffset}px` } : undefined}
      onClick={handleClose}
    >
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <h2>Chọn sản phẩm thay thế</h2>
            <p>Đang thay thế: <strong>{currentSlot?.name}</strong></p>
          </div>
          <button type="button" onClick={handleClose} className={styles.closeBtn}>
            <span className="material-symbols-outlined">close</span>
            <span className={styles.closeBtnLabel}>Đóng</span>
          </button>
        </div>

        {/* Mode tabs */}
        <div className={styles.modalTabs}>
          <button
            className={`${styles.modalTab} ${mode === 'variants' ? styles.modalTabActive : ''}`}
            onClick={() => setMode('variants')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
            Biến thể cùng loại
          </button>
          <button
            className={`${styles.modalTab} ${mode === 'search' ? styles.modalTabActive : ''}`}
            onClick={() => setMode('search')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>search</span>
            Tìm sản phẩm khác
          </button>
        </div>

        {/* Search bar (only in search mode) */}
        {mode === 'search' && (
          <div className={styles.searchSection}>
            <div className={styles.searchBox}>
              <span className={`material-symbols-outlined ${styles.searchIcon}`}>search</span>
              <input
                type="text"
                placeholder={`Tìm thay thế cho "${currentSlot?.name}"...`}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className={styles.modalBody}>
          {loading ? (
            <div className={styles.loaderWrapper}>
              <div className={styles.loader}></div>
              <p style={{ color: '#c5a065', fontWeight: 900, margin: 0 }}>ĐANG TÌM KIẾM...</p>
            </div>
          ) : displayItems.length > 0 ? (
            <div className={styles.productGrid}>
              {displayItems.map(item => {
                const isCurrent = item.id === currentSlot?.id ||
                  item.id === currentSlot?.pivot?.variant_id;
                return (
                  <div
                    key={item.id}
                    className={`${styles.productCard} ${isCurrent ? styles.productCardActive : ''}`}
                    onClick={() => handleSelectItem(item)}
                  >
                    {isCurrent && (
                      <span className={styles.currentBadge}>Đang dùng</span>
                    )}
                    <div className={styles.productCardImg}>
                      <Image
                        src={getImageUrl(item.images?.[0] || item.primary_image || { path: item.main_image })}
                        alt={item.name}
                        fill
                        style={{ objectFit: 'cover' }}
                        unoptimized
                      />
                    </div>
                    <div className={styles.productCardInfo}>
                      <p className={styles.productCardName}>{item.name}</p>
                      {item.sku && (
                        <p className={styles.productCardSku}>SKU: {item.sku}</p>
                      )}
                      <p className={styles.productCardPrice}>{formatPrice(item.price || 0)}</p>
                      {item.stock_quantity !== undefined && (
                        <span className={styles.inStock}>
                          ● Sẵn sàng giao ngay
                        </span>
                      )}
                    </div>
                    <button type="button" className={styles.productCardSelectBtn}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                      {isCurrent ? 'Giữ nguyên' : 'Chọn'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span className="material-symbols-outlined">inventory_2</span>
              {errorMsg ? (
                <p style={{ color: '#dc2626', fontWeight: 600, padding: 10, background: '#fee2e2', borderRadius: 8 }}>
                  {errorMsg}
                </p>
              ) : (
                <p style={{ color: '#555', fontWeight: 600 }}>
                  {mode === 'variants'
                    ? 'Không có biến thể nào khác cho sản phẩm này.'
                    : 'Không tìm thấy sản phẩm phù hợp.'}
                </p>
              )}
              {mode === 'variants' && !errorMsg && (
                <button
                  type="button"
                  className={styles.switchModeBtn}
                  onClick={() => setMode('search')}
                >
                  Tìm sản phẩm khác →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <span style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>
            {displayItems.length} kết quả
          </span>
          <button type="button" onClick={handleClose} className={styles.footerBtn}>Đóng</button>
        </div>
      </div>
    </div>
  );
}

