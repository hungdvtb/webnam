'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { getWebProducts, fetchFromApi } from '@/lib/api';
import styles from '../builder.module.css';

const isOptionOutOfStock = (item = {}) => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  if (item.status === false || item.is_in_stock === false || item.isInStock === false) {
    return true;
  }

  const stockStatus = String(item.stock_status || item.inventory_status || '').trim().toLowerCase();
  if (stockStatus === 'out_of_stock' || stockStatus === 'out of stock') {
    return true;
  }

  if (item.sold_out === true || item.soldOut === true) {
    return true;
  }

  const stockQuantity = Number(item.stock_quantity);
  return Number.isFinite(stockQuantity) && stockQuantity === 0;
};

export default function ComponentSelectionModal({
  isOpen,
  onClose,
  onSelect,
  currentSlot,
  getImageUrl,
  formatPrice,
  allowSearch = true,
  mobilePresentation = 'modal',
  title = 'Chọn sản phẩm thay thế',
  subtitlePrefix = 'Đang thay thế:',
}) {
  const [mode, setMode] = useState('variants');
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

  const fetchVariants = useCallback(async () => {
    const identifier = currentSlot?.base_product_slug
      || currentSlot?.base_product_id
      || currentSlot?.slug
      || currentSlot?.id;

    if (!isOpen || !identifier) {
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetchFromApi(`/web-api/products/${identifier}`);
      const data = response || {};
      const linkedVariants = (data.linked_products || []).filter(
        (product) => product?.pivot?.link_type === 'super_link'
      );

      if (linkedVariants.length > 0) {
        setVariants(linkedVariants);
      } else if (Array.isArray(data.variations) && data.variations.length > 0) {
        setVariants(data.variations);
      } else if (data.id) {
        setVariants([data]);
      } else {
        setErrorMsg(`API không trả về thông tin sản phẩm: ${JSON.stringify(data)}`);
        setVariants([]);
      }
    } catch (error) {
      console.error(error);
      setErrorMsg(`Lỗi khi gọi API biến thể: ${error.message || 'Unknown error'}`);
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [currentSlot, isOpen]);

  const fetchSearch = useCallback(async () => {
    if (!isOpen || !allowSearch) {
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const params = {
        search: searchTerm || currentSlot?.name || '',
        per_page: 12,
        allow_variants: 1,
      };
      const response = await getWebProducts(params);
      setSearchResults(Array.isArray(response.data) ? response.data : (response.data?.data || []));
    } catch (error) {
      console.error(error);
      setErrorMsg(`Lỗi khi tìm kiếm: ${error.message || 'Unknown error'}`);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, [allowSearch, currentSlot, isOpen, searchTerm]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setMode('variants');
    setSearchTerm('');
    setVariants([]);
    setSearchResults([]);
    fetchVariants();
  }, [fetchVariants, isOpen, currentSlot?.bundle_item_uid, currentSlot?.base_product_id, currentSlot?.base_product_slug]);

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

  useEffect(() => {
    if (mode !== 'search' || !isOpen || !allowSearch) {
      return undefined;
    }

    const timer = setTimeout(fetchSearch, 300);
    return () => clearTimeout(timer);
  }, [allowSearch, fetchSearch, isOpen, mode, searchTerm]);

  useEffect(() => {
    if (mode === 'search' && isOpen && allowSearch && searchResults.length === 0 && !loading) {
      fetchSearch();
    }
  }, [allowSearch, fetchSearch, isOpen, loading, mode, searchResults.length]);

  if (!isOpen) {
    return null;
  }

  const displayItems = mode === 'search' && allowSearch ? searchResults : variants;

  return (
    <div
      className={`${styles.modalOverlay} ${mobilePresentation === 'sheet' ? styles.modalOverlaySheet : ''}`}
      style={mobileTopOffset > 0 ? { '--bundle-mobile-modal-offset': `${mobileTopOffset}px` } : undefined}
      onClick={handleClose}
    >
      <div
        className={`${styles.modalContent} ${mobilePresentation === 'sheet' ? styles.modalContentSheet : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        {mobilePresentation === 'sheet' ? (
          <div className={styles.modalSheetHandleWrap} aria-hidden="true">
            <span className={styles.modalSheetHandle}></span>
          </div>
        ) : null}

        <div className={styles.modalHeader}>
          <div>
            <h2>{title}</h2>
            <p>{subtitlePrefix} <strong>{currentSlot?.name}</strong></p>
          </div>
          <button type="button" onClick={handleClose} className={styles.closeBtn}>
            <span className="material-symbols-outlined">close</span>
            <span className={styles.closeBtnLabel}>Đóng</span>
          </button>
        </div>

        {allowSearch ? (
          <div className={styles.modalTabs}>
            <button
              type="button"
              className={`${styles.modalTab} ${mode === 'variants' ? styles.modalTabActive : ''}`}
              onClick={() => setMode('variants')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
              Biến thể cùng loại
            </button>
            <button
              type="button"
              className={`${styles.modalTab} ${mode === 'search' ? styles.modalTabActive : ''}`}
              onClick={() => setMode('search')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>search</span>
              Tìm sản phẩm khác
            </button>
          </div>
        ) : null}

        {allowSearch && mode === 'search' ? (
          <div className={styles.searchSection}>
            <div className={styles.searchBox}>
              <span className={`material-symbols-outlined ${styles.searchIcon}`}>search</span>
              <input
                type="text"
                placeholder={`Tìm thay thế cho "${currentSlot?.name}"...`}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                autoFocus
              />
            </div>
          </div>
        ) : null}

        <div className={styles.modalBody}>
          {loading ? (
            <div className={styles.loaderWrapper}>
              <div className={styles.loader}></div>
              <p className={styles.loaderText}>ĐANG TÌM KIẾM...</p>
            </div>
          ) : displayItems.length > 0 ? (
            <div className={styles.productGrid}>
              {displayItems.map((item) => {
                const currentProductId = currentSlot?.selected_product_id
                  || currentSlot?.pivot?.variant_id
                  || currentSlot?.id;
                const isCurrent = Number(item.id) === Number(currentProductId);
                const isDisabled = !isCurrent && isOptionOutOfStock(item);
                const showStockState = item.stock_quantity !== undefined
                  || item.status !== undefined
                  || item.is_in_stock !== undefined
                  || item.isInStock !== undefined
                  || Boolean(item.stock_status)
                  || Boolean(item.inventory_status)
                  || Boolean(item.sold_out)
                  || Boolean(item.soldOut);

                return (
                  <div
                    key={item.id || item.slug || item.sku}
                    className={[
                      styles.productCard,
                      isCurrent ? styles.productCardActive : '',
                      isDisabled ? styles.productCardDisabled : '',
                    ].filter(Boolean).join(' ')}
                    onClick={isDisabled ? undefined : () => handleSelectItem(item)}
                    aria-disabled={isDisabled}
                  >
                    {isCurrent ? (
                      <span className={styles.currentBadge}>Đang dùng</span>
                    ) : null}
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
                      <p className={styles.productCardPrice}>{formatPrice(item.current_price ?? item.price ?? 0)}</p>
                      {showStockState ? (
                        <span className={isDisabled ? styles.outStock : styles.inStock}>
                          {isDisabled ? '● Hết hàng' : '● Sẵn sàng giao ngay'}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={`${styles.productCardSelectBtn} ${isDisabled ? styles.productCardSelectBtnDisabled : ''}`}
                      disabled={isDisabled}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                      {isCurrent ? 'Giữ nguyên' : isDisabled ? 'Hết hàng' : 'Chọn'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span className="material-symbols-outlined">inventory_2</span>
              {errorMsg ? (
                <p className={styles.emptyStateError}>
                  {errorMsg}
                </p>
              ) : (
                <p className={styles.emptyStateMessage}>
                  {mode === 'variants'
                    ? 'Không có biến thể nào khác cho sản phẩm này.'
                    : 'Không tìm thấy sản phẩm phù hợp.'}
                </p>
              )}
              {allowSearch && mode === 'variants' && !errorMsg ? (
                <button
                  type="button"
                  className={styles.switchModeBtn}
                  onClick={() => setMode('search')}
                >
                  Tìm sản phẩm khác →
                </button>
              ) : null}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <span className={styles.modalResultCount}>
            {displayItems.length} kết quả
          </span>
          <button type="button" onClick={handleClose} className={styles.footerBtn}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
