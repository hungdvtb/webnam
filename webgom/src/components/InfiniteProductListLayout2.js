"use client";

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from '../app/products/layout2.module.css';
import { useCart } from '@/context/CartContext';
import { flyToCart } from '@/utils/flyToCart';
import { resolveImageObjectUrl } from '@/lib/media';
import { calculateFullBundleDiscount } from '@/lib/bundlePricing';
import { buildProductCardKey, buildProductDetailHref } from '@/lib/productLinks';
import { cacheBundleOptionSnapshot, prefetchBundleOptionDetail } from '@/lib/productPrefetch';
import { markProductNavigationClick } from '@/lib/productPerformance';

const FALLBACK_PRODUCT_IMAGE = '/logo-dai-thanh.png';
const FALLBACK_PRODUCT_ALT = 'Sản phẩm gốm sứ';
const ADD_TO_CART_LABEL = 'Giỏ hàng';
const EMPTY_PRODUCTS_MESSAGE = 'Không tìm thấy sản phẩm nào phù hợp với yêu cầu của bạn.';

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

export default function InfiniteProductListLayout2({ initialData }) {
  const products = initialData?.data || [];
  const { addToCart } = useCart();
  const router = useRouter();

  const handleProductIntent = (product, href) => {
    cacheBundleOptionSnapshot(product, href);
    prefetchBundleOptionDetail(product, href);

    try {
      router.prefetch(href);
    } catch {
      // Prefetch is opportunistic.
    }
  };

  const handleProductClick = (product, href) => {
    cacheBundleOptionSnapshot(product, href);
    markProductNavigationClick(product, href);
  };

  return (
    <>
      <div className={styles.productGrid}>
        {products.map((product) => {
          const productHref = buildProductDetailHref(product);
          const productCardKey = buildProductCardKey(product);
          const displayPrice = getDisplayPrice(product);
          const cartOptions = product.item_type === 'bundle_option'
            ? {
                bundle_option_uid: product.bundle_option_uid,
                bundle_option_key: product.bundle_option_key,
                bundle_option_title: product.bundle_option_title,
                bundle_parent_name: product.bundle_parent_name,
                bundle_option_total_price: product.bundle_option_total_price,
                bundle_option_discounted_price: displayPrice,
              }
            : {};

          return (
            <div key={productCardKey} className={styles.productCard}>
              <div className={styles.imageArea}>
                <Link
                  href={productHref}
                  className={styles.imageLink}
                  onPointerEnter={() => handleProductIntent(product, productHref)}
                  onFocus={() => handleProductIntent(product, productHref)}
                  onTouchStart={() => handleProductIntent(product, productHref)}
                  onClick={() => handleProductClick(product, productHref)}
                >
                  <Image
                    src={resolveImageObjectUrl(product.primary_image, 'medium', FALLBACK_PRODUCT_IMAGE)}
                    alt={product.name || FALLBACK_PRODUCT_ALT}
                    fill
                    className={styles.image}
                    sizes="(max-width: 767px) 50vw, (max-width: 1200px) 50vw, 25vw"
                    unoptimized
                  />
                </Link>
              </div>

              <div className={styles.cardBody}>
                <Link
                  href={productHref}
                  className={styles.productLink}
                  onPointerEnter={() => handleProductIntent(product, productHref)}
                  onFocus={() => handleProductIntent(product, productHref)}
                  onTouchStart={() => handleProductIntent(product, productHref)}
                  onClick={() => handleProductClick(product, productHref)}
                >
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
                        addToCart(product, 1, cartOptions, [], displayPrice);
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
