"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import config from '@/lib/config';
import styles from '../app/products/layout2.module.css';
import { useCart } from '@/context/CartContext';

export default function InfiniteProductListLayout2({ initialData, category = '', sort = 'popular', search = '', initialAttrs = {} }) {
  const [products, setProducts] = useState(initialData.data || []);
  const [page, setPage] = useState(initialData.current_page || 1);
  const [hasMore, setHasMore] = useState(initialData.current_page < initialData.last_page);
  const [loading, setLoading] = useState(false);
  const [attrs, setAttrs] = useState(initialAttrs);
  const { addToCart } = useCart();
  const observer = useRef();

  // Reset when filters change
  useEffect(() => {
    setProducts(initialData.data || []);
    setPage(initialData.current_page || 1);
    setHasMore(initialData.current_page < initialData.last_page);
    setAttrs(initialAttrs);
  }, [initialData, category, sort, search, initialAttrs]);

  const loadMoreProducts = useCallback(async () => {
    if (loading || !hasMore) return;
    
    setLoading(true);
    try {
      const urlParams = new URLSearchParams({
        page: page.toString(),
        category: category || '',
        sort: sort || 'popular',
        search: search || '',
        per_page: '24'
      });

      // Add attrs to URL
      Object.entries(attrs).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach(v => urlParams.append(`attrs[${key}][]`, v));
        } else {
          urlParams.append(`attrs[${key}]`, value);
        }
      });

      const response = await fetch(`${config.apiUrl}/web-api/products?${urlParams.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'X-Site-Code': config.siteCode,
        }
      });

      if (!response.ok) throw new Error('Failed to fetch');

      const newData = await response.json();
      
      setProducts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const uniqueNew = newData.data.filter(p => !existingIds.has(p.id));
        return [...prev, ...uniqueNew];
      });
      
      setHasMore(newData.current_page < newData.last_page);
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
        {products.map((product) => (
          <div key={product.id} className={styles.productCard}>
            <div className={styles.imageArea}>
              <Link href={`/product/${product.slug}`}>
                {(() => {
                  const img = product.primary_image;
                  let src = 'https://placehold.co/400';
                  if (img) {
                    if (img.url && img.url.startsWith('http')) src = img.url;
                    else if (img.path && img.path !== 'undefined' && img.path !== 'null') {
                      const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
                      src = `${config.storageUrl}/${cleanPath}`;
                    } else if (img.url) src = img.url;
                  }
                  return (
                    <Image 
                      src={src}
                      alt={product.name}
                      fill
                      className={styles.image}
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                      unoptimized
                    />
                  );
                })()}
              </Link>
              {product.is_new && <div className={styles.badge}>Bán chạy</div>}
            </div>
            
            <div className={styles.cardBody}>
              <span className={styles.categoryTag}>{product.category?.name || 'Gốm Sứ'}</span>
              <Link href={`/product/${product.slug}`} style={{ textDecoration: 'none' }}>
                <h3 className={styles.productName}>{product.name}</h3>
              </Link>
              
              <div className={styles.footer}>
                <p className={styles.price}>
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}
                </p>
                <div className={styles.actions}>
                  <button 
                    className={styles.cartAction}
                    onClick={(e) => {
                      e.preventDefault();
                      addToCart(product, 1);
                      alert('Đã thêm sản phẩm vào giỏ hàng!');
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add_shopping_cart</span>
                    Giỏ hàng
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {products.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '5rem 2rem', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', marginBottom: '1rem' }}>search_off</span>
          <p style={{ fontSize: '18px', fontFamily: 'Playfair Display, serif' }}>Không tìm thấy sản phẩm nào phù hợp.</p>
        </div>
      )}

      {/* Infinite Scroll Trigger */}
      <div 
        ref={lastElementRef}
        className={styles.loader}
        style={{ visibility: hasMore ? 'visible' : 'hidden' }}
      >
        <div className={styles.spinner}></div>
        <p style={{ fontSize: '12px', fontWeight: 'bold', color: '#C5A059', textTransform: 'uppercase' }}>Đang tải thêm...</p>
      </div>
      
      {!hasMore && products.length > 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 0', opacity: 0.3 }}>
          <p style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase' }}>Đã hiển thị tất cả sản phẩm</p>
        </div>
      )}
    </>
  );
}
