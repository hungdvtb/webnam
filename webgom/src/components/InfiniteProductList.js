"use client";

import Link from 'next/link';
import Image from 'next/image';
import styles from '../app/products/products.module.css';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';
import { resolveImageObjectUrl } from '@/lib/media';
import { calculateFullBundleDiscount } from '@/lib/bundlePricing';
import { buildProductCardKey, buildProductDetailHref } from '@/lib/productLinks';

const FALLBACK_PRODUCT_IMAGE = '/logo-dai-thanh.png';
const FALLBACK_PRODUCT_ALT = 'Sản phẩm gốm sứ';
const EMPTY_PRODUCTS_MESSAGE = 'Không tìm thấy sản phẩm nào phù hợp với yêu cầu của bạn.';
const EMPTY_PRODUCTS_HINT = 'Hãy thử đổi từ khóa khác hoặc xóa bộ lọc.';

const getDisplayPrice = (product = {}) => {
  if (product.item_type === 'bundle_option') {
    const bundleTotal = Number(product.bundle_option_total_price ?? product.price ?? 0);

    if (Number.isFinite(bundleTotal) && bundleTotal > 0) {
      return calculateFullBundleDiscount(bundleTotal).finalSubtotal;
    }

    return product.bundle_option_discounted_price ?? product.current_price ?? product.price ?? 0;
  }

  return product.current_price ?? product.price ?? 0;
};

export default function InfiniteProductList({ initialData }) {
  const products = initialData?.data || [];
  const { addToCart } = useCart();

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => {
          const productHref = buildProductDetailHref(product);
          const productCardKey = buildProductCardKey(product);
          const displayPrice = getDisplayPrice(product);
          const cartOptions = product.item_type === 'bundle_option'
            ? {
                bundle_option_key: product.bundle_option_key,
                bundle_option_title: product.bundle_option_title,
                bundle_parent_name: product.bundle_parent_name,
                bundle_option_total_price: product.bundle_option_total_price,
                bundle_option_discounted_price: displayPrice,
              }
            : {};

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
              </Link>

              <div className={styles.productInfo}>
                <Link href={productHref} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <h3 className={styles.productName}>{product.name}</h3>
                </Link>

                <div className={styles.cardFooter}>
                  <span className={styles.price}>
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(displayPrice)}
                  </span>
                  <button
                    className={styles.cartBtn}
                    onClick={(event) => {
                      event.preventDefault();
                      addToCart(product, 1, cartOptions, [], displayPrice);
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
          <p style={{ fontSize: '18px' }}>{EMPTY_PRODUCTS_MESSAGE}</p>
          <p style={{ fontSize: '14px', marginTop: '0.5rem' }}>{EMPTY_PRODUCTS_HINT}</p>
        </div>
      )}
    </>
  );
}
