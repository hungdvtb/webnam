"use client";

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from '../app/products/products.module.css';
import { useCart } from '@/context/CartContext';
import { resolveImageObjectUrl } from '@/lib/media';
import { calculateFullBundleDiscount } from '@/lib/bundlePricing';
import { buildProductCardKey, buildProductDetailHref } from '@/lib/productLinks';
import { cacheBundleOptionSnapshot, prefetchBundleOptionDetail } from '@/lib/productPrefetch';
import { markProductNavigationClick } from '@/lib/productPerformance';
import CategoryVariantQuickAdd from './CategoryVariantQuickAdd';

const FALLBACK_PRODUCT_IMAGE = '/logo-dai-thanh.png';
const FALLBACK_PRODUCT_ALT = 'Sản phẩm gốm sứ';
const EMPTY_PRODUCTS_MESSAGE = 'Không tìm thấy sản phẩm nào phù hợp với yêu cầu của bạn.';
const EMPTY_PRODUCTS_HINT = 'Hãy thử đổi từ khóa khác hoặc xóa bộ lọc.';

const getDisplayPrice = (product = {}) => {
  if (product.item_type === 'bundle_option') {
    const explicitPrice = Number(product.bundle_option_discounted_price ?? product.current_price ?? 0);
    if (Number.isFinite(explicitPrice) && explicitPrice > 0) {
      return explicitPrice;
    }

    const bundleTotal = Number(product.bundle_option_total_price ?? product.price ?? 0);

    if (Number.isFinite(bundleTotal) && bundleTotal > 0) {
      return calculateFullBundleDiscount(bundleTotal).finalSubtotal;
    }

    return product.price ?? 0;
  }

  return product.current_price ?? product.price ?? 0;
};

export default function InfiniteProductList({ initialData }) {
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
            <div key={productCardKey} className={styles.productCard} data-product-card="true">
              <Link
                href={productHref}
                className={styles.imageWrapper}
                onPointerEnter={() => handleProductIntent(product, productHref)}
                onFocus={() => handleProductIntent(product, productHref)}
                onTouchStart={() => handleProductIntent(product, productHref)}
                onClick={() => handleProductClick(product, productHref)}
              >
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
                <Link
                  href={productHref}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                  onPointerEnter={() => handleProductIntent(product, productHref)}
                  onFocus={() => handleProductIntent(product, productHref)}
                  onTouchStart={() => handleProductIntent(product, productHref)}
                  onClick={() => handleProductClick(product, productHref)}
                >
                  <h3 className={styles.productName}>{product.name}</h3>
                </Link>
                <div className={styles.cardFooter}>
                  <span className={styles.price}>
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(displayPrice)}
                  </span>
                  <CategoryVariantQuickAdd
                    product={product}
                    addToCart={addToCart}
                    displayPrice={displayPrice}
                    cartOptions={cartOptions}
                    buttonClassName={styles.cartBtn}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add_shopping_cart</span>
                  </CategoryVariantQuickAdd>
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
