"use client";

import Link from 'next/link';
import Image from 'next/image';
import config from '@/lib/config';
import styles from '../app/products/products.module.css';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';

export default function InfiniteProductList({ initialData }) {
  const products = initialData?.data || [];
  const { addToCart } = useCart();

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => (
          <div key={product.id} className={styles.productCard}>
            <Link href={`/product/${product.slug || product.id}`} className={styles.imageWrapper}>
              {(() => {
                const img = product.primary_image;
                let src = 'https://placehold.co/400';

                if (img) {
                  if (img.image_url && img.image_url.startsWith('http')) src = img.image_url;
                  else if (img.url && img.url.startsWith('http')) src = img.url;
                  else if (img.path && img.path !== 'undefined' && img.path !== 'null') {
                    const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
                    src = `${config.storageUrl}/${cleanPath}`;
                  } else if (img.url) {
                    src = img.url;
                  }
                }

                return (
                  <Image
                    src={src}
                    alt={product.name}
                    fill
                    sizes="(max-width: 359px) 100vw, (max-width: 767px) 50vw, (max-width: 1200px) 33vw, 25vw"
                    style={{ objectFit: 'cover' }}
                    unoptimized
                  />
                );
              })()}
              {product.is_new && <span className={styles.badge}>Mới</span>}
            </Link>
            <div className={styles.productInfo}>
              <p className={styles.productCategory}>{product.category?.name || 'Bát Tràng Premium'}</p>
              <Link href={`/product/${product.slug || product.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <h3 className={styles.productName}>{product.name}</h3>
              </Link>
              <div className={styles.rating}>
                {[...Array(5)].map((_, index) => (
                  <span key={index} className="material-symbols-outlined">star</span>
                ))}
                <span className={styles.reviewCount}>(24)</span>
              </div>
              <div className={styles.cardFooter}>
                <span className={styles.price}>
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}
                </span>
                <button
                  className={styles.cartBtn}
                  onClick={(event) => {
                    event.preventDefault();
                    addToCart(product, 1);
                    const card = event.currentTarget.closest(`.${styles.productCard}`);
                    const imgSrc = card?.querySelector('img')?.src || '/logo-dai-thanh.png';
                    flyToCart(event, imgSrc);
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_shopping_cart</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {products.length === 0 && (
        <div style={{ textAlign: 'center', padding: '5rem 2rem', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', marginBottom: '1rem' }}>search_off</span>
          <p style={{ fontSize: '18px' }}>Không tìm thấy sản phẩm nào phù hợp với yêu cầu của bạn.</p>
          <p style={{ fontSize: '14px', marginTop: '0.5rem' }}>Hãy thử đổi từ khóa khác hoặc xóa bộ lọc.</p>
        </div>
      )}
    </>
  );
}
