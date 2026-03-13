"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import config from '@/lib/config';
import styles from '../app/products/products.module.css';

export default function InfiniteProductList({ initialData, category = '', sort = 'newest', search = '' }) {
  const [products, setProducts] = useState(initialData.data || []);
  const [page, setPage] = useState(initialData.current_page || 1);
  const [hasMore, setHasMore] = useState(!!initialData.next_page_url);
  const [loading, setLoading] = useState(false);
  const observer = useRef();

  // Reset when filters change
  useEffect(() => {
    setProducts(initialData.data || []);
    setPage(initialData.current_page || 1);
    setHasMore(!!initialData.next_page_url);
  }, [initialData, category, sort, search]);

  const loadMoreProducts = useCallback(async () => {
    if (loading || !hasMore) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page,
        category: category || '',
        sort: sort || 'newest',
        search: search || '',
        per_page: 20
      });

      const response = await fetch(`${config.apiUrl}/web-api/products?${params.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'X-Site-Code': config.siteCode,
        }
      });

      if (!response.ok) throw new Error('Failed to fetch');

      const newData = await response.json();
      
      setProducts(prev => {
        // Prevent duplicates
        const existingIds = new Set(prev.map(p => p.id));
        const uniqueNew = newData.data.filter(p => !existingIds.has(p.id));
        return [...prev, ...uniqueNew];
      });
      
      setHasMore(!!newData.next_page_url);
    } catch (error) {
      console.error("Error loading more products:", error);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [page, category, sort, search, loading, hasMore]);

  const lastElementRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => prevPage + 1);
      }
    }, { threshold: 0.1 });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  useEffect(() => {
    if (page > 1) {
      loadMoreProducts();
    }
  }, [page, loadMoreProducts]);

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product, index) => (
          <div 
            key={product.id} 
            className={styles.productCard}
          >
            <Link href={`/product/${product.slug}`} className={styles.imageWrapper}>
              {product.primary_image ? (
                <Image 
                  src={product.primary_image.url.startsWith('http') 
                    ? product.primary_image.url 
                    : `${config.storageUrl}/${product.primary_image.path.startsWith('/') ? product.primary_image.path.substring(1) : product.primary_image.path}`}
                  alt={product.name}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  style={{ objectFit: 'cover' }}
                  unoptimized
                />
              ) : (
                <div className={styles.imagePlaceholder}>
                  <span className="material-symbols-outlined" style={{ fontSize: '48px', color: '#ccc' }}>image</span>
                </div>
              )}
              {product.is_new && <span className={styles.badge}>MỚI</span>}
            </Link>
            <div className={styles.productInfo}>
              <p className={styles.productCategory}>{product.category?.name || 'Bát Tràng Premium'}</p>
              <Link href={`/product/${product.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <h3 className={styles.productName}>{product.name}</h3>
              </Link>
              <div className={styles.rating}>
                {[...Array(5)].map((_, i) => (
                  <span key={i} className="material-symbols-outlined">star</span>
                ))}
                <span className={styles.reviewCount}>(24)</span>
              </div>
              <div className={styles.cardFooter}>
                <span className={styles.price}>
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}
                </span>
                <button className={styles.cartBtn}>
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_shopping_cart</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {products.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '5rem 2rem', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', marginBottom: '1rem' }}>search_off</span>
          <p style={{ fontSize: '18px' }}>Không tìm thấy sản phẩm nào phù hợp với yêu cầu của bạn.</p>
          <p style={{ fontSize: '14px', marginTop: '0.5rem' }}>Hãy thử đổi từ khóa khác hoặc xóa bộ lọc.</p>
        </div>
      )}

      {/* Pagination / Load More Sentinel */}
      <div 
        ref={lastElementRef}
        className={styles.pagination} 
        style={{ visibility: (hasMore && products.length > 0) ? 'visible' : 'hidden', minHeight: '100px' }}
      >
        <div className={styles.loader}>
          <div className={styles.spinner}></div>
          <div className={styles.spinnerActive}></div>
        </div>
        <p className={styles.paginationText}>Xem thêm sản phẩm</p>
      </div>

      {!hasMore && products.length > 0 && (
        <div className={styles.pagination} style={{ marginTop: '2rem' }}>
          <p className={styles.paginationText} style={{ opacity: 0.4 }}>Đã hiển thị tất cả sản phẩm</p>
        </div>
      )}
    </>
  );
}
