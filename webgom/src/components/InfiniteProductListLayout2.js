"use client";

import Link from 'next/link';
import Image from 'next/image';
import styles from '../app/products/layout2.module.css';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';
import { resolveImageObjectUrl } from '@/lib/media';
import { buildProductCardKey, buildProductDetailHref } from '@/lib/productLinks';

const FALLBACK_PRODUCT_IMAGE = '/logo-dai-thanh.png';
const FALLBACK_PRODUCT_ALT = 'Sản phẩm gốm sứ';
const BESTSELLER_LABEL = 'Bán chạy';
const ADD_TO_CART_LABEL = 'Giỏ hàng';
const EMPTY_PRODUCTS_MESSAGE = 'Không tìm thấy sản phẩm nào phù hợp với yêu cầu của bạn.';

export default function InfiniteProductListLayout2({ initialData }) {
  const products = initialData?.data || [];
  const { addToCart } = useCart();

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => {
          const productHref = buildProductDetailHref(product);
          const productCardKey = buildProductCardKey(product);
          const displayPrice = product.current_price ?? product.price ?? 0;

          return (
            <div key={productCardKey} className={styles.productCard}>
              <div className={styles.imageArea}>
                <Link href={productHref} className={styles.imageLink}>
                  <Image
                    src={resolveImageObjectUrl(product.primary_image, 'medium', FALLBACK_PRODUCT_IMAGE)}
                    alt={product.name || FALLBACK_PRODUCT_ALT}
                    fill
                    className={styles.image}
                    sizes="(max-width: 767px) 50vw, (max-width: 1200px) 50vw, 25vw"
                    unoptimized
                  />
                </Link>
                {product.is_new && <div className={styles.badge}>{BESTSELLER_LABEL}</div>}

              </div>

              <div className={styles.cardBody}>
                <Link href={productHref} className={styles.productLink}>
                  <h3 className={styles.productName}>{product.name}</h3>
                </Link>

                <div className={styles.footer}>
                  <p className={styles.price}>
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(displayPrice)}
                  </p>

                  <div className={styles.actions}>
                    <button
                      className={styles.cartAction}
                      onClick={(event) => {
                        event.preventDefault();
                        addToCart(product, 1);
                        const card = event.currentTarget.closest(`.${styles.productCard}`);
                        const imgSrc = card?.querySelector('img')?.src || FALLBACK_PRODUCT_IMAGE;
                        flyToCart(event, imgSrc);
                      }}
                    >
                      <span className={`material-symbols-outlined ${styles.cartActionIcon}`}>add_shopping_cart</span>
                      {ADD_TO_CART_LABEL}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {products.length === 0 && (
        <div className={styles.emptyState}>
          <span className={`material-symbols-outlined ${styles.emptyStateIcon}`}>search_off</span>
          <p className={styles.emptyStateText}>{EMPTY_PRODUCTS_MESSAGE}</p>
        </div>
      )}
    </>
  );
}
