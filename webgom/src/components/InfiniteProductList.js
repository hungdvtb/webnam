"use client";

import Link from 'next/link';
import Image from 'next/image';
import styles from '../app/products/products.module.css';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';
import { resolveImageObjectUrl } from '@/lib/media';
import { buildProductCardKey, buildProductDetailHref } from '@/lib/productLinks';

const FALLBACK_PRODUCT_IMAGE = '/logo-dai-thanh.png';
const FALLBACK_PRODUCT_ALT = 'S\u1ea3n ph\u1ea9m g\u1ed1m s\u1ee9';

export default function InfiniteProductList({ initialData }) {
  const products = initialData?.data || [];
  const { addToCart } = useCart();

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => {
          const productHref = buildProductDetailHref(product);
          const productCardKey = buildProductCardKey(product);

          return (
            <div key={productCardKey} className={styles.productCard}>
              <Link href={productHref} className={styles.imageWrapper}>
                <Image
                  src={resolveImageObjectUrl(product.primary_image, 'medium', FALLBACK_PRODUCT_IMAGE)}
                  alt={product.name || FALLBACK_PRODUCT_ALT}
                  fill
                  sizes="(max-width: 359px) 100vw, (max-width: 767px) 50vw, (max-width: 1200px) 33vw, 25vw"
                  style={{ objectFit: 'cover' }}
                  unoptimized
                />
                {product.is_new && <span className={styles.badge}>M\u1edbi</span>}
              </Link>

              <div className={styles.productInfo}>
                <Link href={productHref} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <h3 className={styles.productName}>{product.name}</h3>
                </Link>

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
                      const imgSrc = card?.querySelector('img')?.src || FALLBACK_PRODUCT_IMAGE;
                      flyToCart(event, imgSrc);
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_shopping_cart</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {products.length === 0 && (
        <div style={{ textAlign: 'center', padding: '5rem 2rem', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: '64px', marginBottom: '1rem' }}>search_off</span>
          <p style={{ fontSize: '18px' }}>Kh\u00f4ng t\u00ecm th\u1ea5y s\u1ea3n ph\u1ea9m n\u00e0o ph\u00f9 h\u1ee3p v\u1edbi y\u00eau c\u1ea7u c\u1ee7a b\u1ea1n.</p>
          <p style={{ fontSize: '14px', marginTop: '0.5rem' }}>H\u00e3y th\u1eed \u0111\u1ed5i t\u1eeb kh\u00f3a kh\u00e1c ho\u1eb7c x\u00f3a b\u1ed9 l\u1ecdc.</p>
        </div>
      )}
    </>
  );
}
