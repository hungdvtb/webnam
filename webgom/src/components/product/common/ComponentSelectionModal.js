'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { getWebProducts, fetchFromApi } from '@/lib/api';
import styles from '../builder.module.css';

export default function ComponentSelectionModal({ 
  isOpen, 
  onClose, 
  onSelect, 
  currentSlot, 
  getImageUrl, 
  formatPrice 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');

  const fetchItems = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      let items = [];
      if (currentSlot?.type === 'configurable' && !searchTerm) {
          const res = await fetchFromApi(`/web-api/products/${currentSlot.slug}`);
          items = (res.data.linked_products || []).filter(p => p.pivot?.link_type === 'super_link');
      } else {
          const params = {
              q: searchTerm,
              per_page: 10
          };
          if (currentSlot?.category_id && activeCategory !== 'all') {
              params.category_id = currentSlot.category_id;
          }
          const res = await getWebProducts(params);
          items = res.data || [];
      }
      setProducts(items);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isOpen, currentSlot, searchTerm, activeCategory]);

  useEffect(() => {
    const timeoutId = setTimeout(fetchItems, 300);
    return () => clearTimeout(timeoutId);
  }, [fetchItems]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <h2>Chọn linh kiện thay thế</h2>
            <p>Đang tùy chỉnh: {currentSlot?.name}</p>
          </div>
          <button onClick={onClose} className={styles.closeBtn}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Search & Filter */}
        <div className={styles.searchSection}>
          <div className={styles.searchBox}>
            <span className={`material-symbols-outlined ${styles.searchIcon}`}>search</span>
            <input 
              type="text" 
              placeholder="Tìm kiếm sản phẩm hoặc biến thể..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select 
            value={activeCategory}
            onChange={(e) => setActiveCategory(e.target.value)}
            className={styles.categorySelect}
          >
            <option value="all">Tất cả danh mục</option>
            {currentSlot?.category?.name && (
                <option value="current">{currentSlot.category.name}</option>
            )}
          </select>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {loading ? (
            <div className={styles.loaderWrapper}>
              <div className={styles.loader}></div>
              <p style={{ color: '#c5a065', fontWeight: 900 }}>ĐANG TÌM KIẾM...</p>
            </div>
          ) : products.length > 0 ? (
            products.map((item) => (
              <div 
                key={item.id} 
                className={styles.productRow}
                onClick={() => onSelect(item)}
              >
                <div className={styles.imgWrapper}>
                  <Image 
                    src={getImageUrl(item.images?.[0] || item.primary_image || { path: item.main_image })}
                    alt={item.name}
                    fill
                    style={{ objectFit: 'cover' }}
                    unoptimized
                  />
                </div>
                <div className={styles.productInfo}>
                  <h4>{item.name}</h4>
                  <p>SKU: {item.sku} | {item.stock_quantity > 0 ? 'Còn hàng' : 'Hết hàng'}</p>
                  <span className={styles.priceTag}>{formatPrice(item.price)}</span>
                </div>
                <button className={styles.selectBtn}>Chọn ngay</button>
              </div>
            ))
          ) : (
            <div className={styles.emptyState}>
              <span className="material-symbols-outlined">inventory_2</span>
              <p>Không tìm thấy sản phẩm nào phù hợp.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
           <button onClick={onClose} className={styles.footerBtn}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
