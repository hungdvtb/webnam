'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import ProductDetailContent from '@/components/ProductDetailContent';
import RelatedProductsSection from '@/components/product/RelatedProductsSection';
import { getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import config from '@/lib/config';
import { buildProductDescriptionHtml } from '@/lib/productDescription';
import {
  markProductRouteReady,
  logProductTiming,
} from '@/lib/productPerformance';
import {
  readBundleOptionSnapshot,
  readCachedBundleOptionDetail,
} from '@/lib/productPrefetch';
import styles from '@/app/product/[slug]/product.module.css';

const scheduleAfterFirstPaint = (callback) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let cancelled = false;
  let timeoutId = null;
  let idleId = null;

  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  timeoutId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(run, { timeout: 2000 });
      return;
    }

    run();
  }, 700);

  return () => {
    cancelled = true;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId);
    }
  };
};

const buildOptimisticBundleProduct = (snapshot, requestedBundleOptionKey = '', requestedBundleOptionTitle = '', requestedBundleOptionUid = '') => {
  if (!snapshot) {
    return null;
  }

  const primaryImage = snapshot.primary_image
    || (snapshot.main_image ? { url: snapshot.main_image, path: snapshot.main_image } : null);

  return {
    id: snapshot.id,
    slug: snapshot.slug,
    type: 'bundle',
    item_type: 'bundle_option',
    name: snapshot.bundle_option_title || snapshot.name || snapshot.bundle_parent_name || '',
    sku: snapshot.sku || '',
    price: snapshot.bundle_option_total_price ?? snapshot.price ?? 0,
    current_price: snapshot.bundle_option_discounted_price ?? snapshot.current_price ?? snapshot.price ?? 0,
    special_price: snapshot.special_price ?? null,
    primary_image: primaryImage,
    main_image: snapshot.main_image || primaryImage?.url || primaryImage?.path || '',
    images: primaryImage ? [primaryImage] : [],
    category: snapshot.category || null,
    bundle_items: [],
    grouped_items: [],
    bundle_options: [{
      uid: requestedBundleOptionUid || snapshot.bundle_option_uid || '',
      bundle_option_uid: requestedBundleOptionUid || snapshot.bundle_option_uid || '',
      key: requestedBundleOptionKey || snapshot.bundle_option_key || '',
      name: requestedBundleOptionTitle || snapshot.bundle_option_title || snapshot.name || '',
      bundle_option_title: requestedBundleOptionTitle || snapshot.bundle_option_title || '',
      primary_image: primaryImage,
      main_image: snapshot.main_image || primaryImage?.url || '',
      bundle_option_total_price: snapshot.bundle_option_total_price ?? snapshot.price ?? 0,
      bundle_option_discounted_price: snapshot.bundle_option_discounted_price ?? snapshot.current_price ?? snapshot.price ?? 0,
    }],
    specifications: '',
    additional_info: [],
    video_urls: [],
    is_bundle_option_lite: true,
  };
};

function DeferredDescription({ product, descriptionReady }) {
  const descriptionHtml = useMemo(
    () => buildProductDescriptionHtml(product?.description || ''),
    [product?.description],
  );
  const hasDescription = Boolean(descriptionHtml.trim());
  const images = Array.isArray(product?.images) ? product.images : [];
  const mainImage = images.find((img) => img.is_primary) || images[0];

  if (!descriptionReady) {
    return null;
  }

  return (
    <div className={styles.tabsSection}>
      <div className={styles.tabHeader}>
        <h3 className={styles.tabTitle}>Mô tả chi tiết</h3>
      </div>
      <div className={styles.tabContent}>
        <div
          className={styles.descBody}
          dangerouslySetInnerHTML={{
            __html: hasDescription ? descriptionHtml : 'Đang cập nhật nội dung...',
          }}
        />
        {mainImage && (mainImage.url || mainImage.path) && (
          <div className={styles.descImage}>
            <Image
              src={
                mainImage.url && mainImage.url.startsWith('http')
                  ? mainImage.url
                  : `${config.storageUrl}/${mainImage.path}`
              }
              alt="Mô tả sản phẩm"
              fill
              sizes="(max-width: 768px) 100vw, 80vw"
              style={{ objectFit: 'cover' }}
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductDetailClientShell({
  initialProduct,
  slug,
  requestedBundleOptionKey = '',
  requestedBundleOptionTitle = '',
  requestedVariantId = 0,
  initialRelatedProducts = [],
  initialRelatedViewAllHref = '/products',
  deferFullProduct = false,
  requestedBundleOptionUid = '',
}) {
  const [product, setProduct] = useState(initialProduct || null);
  const [relatedProducts, setRelatedProducts] = useState(initialRelatedProducts);
  const [relatedViewAllHref, setRelatedViewAllHref] = useState(initialRelatedViewAllHref);
  const [fullProductReady, setFullProductReady] = useState(!deferFullProduct);
  const [deferredSectionsReady, setDeferredSectionsReady] = useState(!deferFullProduct);

  useEffect(() => {
    markProductRouteReady({
      slug,
      productId: initialProduct?.id ?? null,
      isLite: Boolean(initialProduct?.is_bundle_option_lite),
    });
  }, [initialProduct?.id, initialProduct?.is_bundle_option_lite, slug]);

  useEffect(() => {
    if (product || typeof window === 'undefined') {
      return;
    }

    let cancelled = false;
    const applyCachedProduct = (nextProduct) => {
      window.setTimeout(() => {
        if (!cancelled) {
          setProduct(nextProduct);
        }
      }, 0);
    };

    const cachedDetail = readCachedBundleOptionDetail(
      slug,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
      requestedBundleOptionUid,
    );

    if (cachedDetail) {
      applyCachedProduct(cachedDetail);
      return () => {
        cancelled = true;
      };
    }

    const snapshot = readBundleOptionSnapshot(
      slug,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
      requestedBundleOptionUid,
    );
    const optimisticProduct = buildOptimisticBundleProduct(
      snapshot,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
      requestedBundleOptionUid,
    );

    if (optimisticProduct) {
      applyCachedProduct(optimisticProduct);
    }

    return () => {
      cancelled = true;
    };
  }, [product, requestedBundleOptionKey, requestedBundleOptionTitle, requestedBundleOptionUid, slug]);

  useEffect(() => {
    if (!deferFullProduct || !slug) {
      return undefined;
    }

    return scheduleAfterFirstPaint(() => {
      setDeferredSectionsReady(true);
      logProductTiming('api-start', {
        endpoint: `/web-api/products/${slug}`,
        mode: 'deferred-full-bundle',
      });

      Promise.allSettled([
        getWebProductDetail(slug),
        getWebRelatedProducts(slug),
      ]).then(([productResult, relatedResult]) => {
        if (productResult.status === 'fulfilled') {
          setProduct(productResult.value);
          setFullProductReady(true);
        } else {
          console.error('Failed to fetch deferred product detail:', productResult.reason);
        }

        if (relatedResult.status === 'fulfilled') {
          setRelatedProducts(relatedResult.value?.items || []);

          const hasExplicitRelated = Boolean(relatedResult.value?.meta?.has_explicit_related);
          const fallbackCategorySlug = String(
            relatedResult.value?.meta?.fallback_category?.slug
            || productResult.value?.category?.slug
            || ''
          ).trim();
          setRelatedViewAllHref(
            hasExplicitRelated
              ? '/products'
              : (fallbackCategorySlug ? `/category/${encodeURIComponent(fallbackCategorySlug)}` : '/products')
          );
        } else {
          console.error('Failed to fetch deferred related products:', relatedResult.reason);
        }
      });
    });
  }, [deferFullProduct, slug]);

  if (!product) {
    return (
      <div className={styles.tabsSection}>
        <div className={styles.tabContent}>Đang mở trang sản phẩm...</div>
      </div>
    );
  }

  const productContentKey = [
    product?.id || slug,
    product?.is_bundle_option_lite ? 'lite' : 'full',
    requestedBundleOptionKey || requestedBundleOptionTitle || '',
    requestedBundleOptionUid || '',
  ].join(':');

  return (
    <>
      <ProductDetailContent
        key={productContentKey}
        product={product}
        requestedBundleOptionUid={requestedBundleOptionUid}
        requestedBundleOptionKey={requestedBundleOptionKey}
        requestedBundleOptionTitle={requestedBundleOptionTitle}
        requestedVariantId={requestedVariantId}
      />

      <DeferredDescription
        product={product}
        descriptionReady={deferredSectionsReady && fullProductReady}
      />

      {deferredSectionsReady ? (
        <RelatedProductsSection
          relatedProducts={relatedProducts}
          viewAllHref={relatedViewAllHref}
        />
      ) : null}
    </>
  );
}
