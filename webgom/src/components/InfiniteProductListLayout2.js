"use client";

import Link from 'next/link';
import Image from 'next/image';
import config from '@/lib/config';
import styles from '../app/products/layout2.module.css';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';

export default function InfiniteProductListLayout2({ initialData }) {
  const products = initialData?.data || [];
  const { addToCart } = useCart();

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => (
          <div key={product.id} className={styles.productCard}>
            <div className={styles.imageArea}>
              <Link href={`/product/${product.slug || product.id}`}>
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
                      className={styles.image}
                      sizes="(max-width: 479px) 100vw, (max-width: 767px) 50vw, (max-width: 1200px) 50vw, 25vw"
                      unoptimized
                    />
                  );
                })()}
              </Link>
              {product.is_new && <div className={styles.badge}>Bán chạy</div>}
            </div>

            <div className={styles.cardBody}>
              <span className={styles.categoryTag}>{product.category?.name || 'Gốm Sứ'}</span>
              <Link href={`/product/${product.slug || product.id}`} style={{ textDecoration: 'none' }}>
                <h3 className={styles.productName}>{product.name}</h3>
              </Link>

              <div className={styles.footer}>
                <p className={styles.price}>
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(product.price)}
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.cartAction}
                    onClick={(event) => {
                      event.preventDefault();
                      addToCart(product, 1);
                      const card = event.currentTarget.closest(`.${styles.productCard}`);
                      const imgSrc = card?.querySelector('img')?.src || '/logo-dai-thanh.png';
                      flyToCart(event, imgSrc);
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

      {products.length === 0 && (
        <div style={{ textAlign: 'center', padding: '5rem 2rem', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', marginBottom: '1rem' }}>search_off</span>
          <p style={{ fontSize: '18px', fontFamily: 'Playfair Display, serif' }}>Không tìm thấy sản phẩm nào phù hợp.</p>
        </div>
      )}
    </>
  );
}
