'use client';

import { useEffect, useMemo, useState } from 'react';
import ProductDetailContent from '@/components/ProductDetailContent';
import ProductDetailTabs from '@/components/ProductDetailTabs';
import RelatedProductsSection from '@/components/product/RelatedProductsSection';
import { ProductAnalyticsTracker } from '@/components/common/WebAnalyticsTracker';
import { getWebProductBundleOptionDetail, getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
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

  const snapshotImages = Array.isArray(snapshot.images) ? snapshot.images.filter(Boolean) : [];
  const primaryImage = snapshot.primary_image
    || snapshotImages.find((image) => Boolean(image?.is_primary))
    || snapshotImages[0]
    || (snapshot.main_image ? { url: snapshot.main_image, path: snapshot.main_image } : null);
  const videoUrls = Array.isArray(snapshot.video_urls)
    ? snapshot.video_urls.filter(Boolean)
    : (snapshot.video_url ? [snapshot.video_url] : []);
  const hasRequestedOption = Boolean(
    requestedBundleOptionUid
    || requestedBundleOptionKey
    || requestedBundleOptionTitle
    || snapshot.bundle_option_uid
    || snapshot.bundle_option_key
    || snapshot.bundle_option_title
  );

  return {
    id: snapshot.id,
    slug: snapshot.slug,
    type: 'bundle',
    item_type: hasRequestedOption ? 'bundle_option' : (snapshot.item_type || 'product'),
    name: hasRequestedOption
      ? (snapshot.bundle_option_title || snapshot.name || snapshot.bundle_parent_name || '')
      : (snapshot.name || snapshot.bundle_parent_name || ''),
    sku: snapshot.sku || '',
    price: snapshot.bundle_option_total_price ?? snapshot.price ?? 0,
    current_price: snapshot.bundle_option_discounted_price ?? snapshot.current_price ?? snapshot.price ?? 0,
    special_price: snapshot.special_price ?? null,
    primary_image: primaryImage,
    main_image: snapshot.main_image || primaryImage?.url || primaryImage?.path || '',
    images: snapshotImages.length > 0 ? snapshotImages : (primaryImage ? [primaryImage] : []),
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
    video_url: snapshot.video_url || videoUrls[0] || '',
    video_urls: videoUrls,
    is_bundle_option_lite: true,
    is_bundle_shell: !hasRequestedOption,
  };
};

function DeferredDescription({ product, descriptionReady }) {
  const descriptionHtml = useMemo(
    () => buildProductDescriptionHtml(product?.description || ''),
    [product?.description],
  );
  const images = Array.isArray(product?.images) ? product.images : [];
  const mainImage = images.find((img) => img.is_primary) || images[0];

  if (!descriptionReady) {
    return null;
  }

  return (
    <ProductDetailTabs
      descriptionHtml={descriptionHtml}
      mainImage={mainImage}
      lazyImage
    />
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
  stripBundlePreviewParam = false,
  enableDeferredProductAnalytics = false,
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
    if (!stripBundlePreviewParam || typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has('bundle_preview')) {
      return;
    }

    url.searchParams.delete('bundle_preview');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [stripBundlePreviewParam]);

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

    let cancelled = false;
    let fullFetchTimer = null;
    const hasRequestedBundleOption = Boolean(
      requestedBundleOptionUid
      || requestedBundleOptionKey
      || requestedBundleOptionTitle
    );
    const hasInitialBundleOptionDetail = hasRequestedBundleOption && Boolean(initialProduct);
    const fetchFullProduct = () => {
      if (cancelled) {
        return;
      }

      logProductTiming('api-start', {
        endpoint: `/web-api/products/${slug}`,
        mode: 'deferred-full-bundle',
      });

      Promise.allSettled([
        getWebProductDetail(slug),
        getWebRelatedProducts(slug),
      ]).then(([productResult, relatedResult]) => {
        if (cancelled) {
          return;
        }

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
    };

    const cancelScheduledStart = scheduleAfterFirstPaint(() => {
      setDeferredSectionsReady(true);

      if (hasInitialBundleOptionDetail) {
        fullFetchTimer = window.setTimeout(fetchFullProduct, 900);
        return;
      }

      if (!hasRequestedBundleOption) {
        fetchFullProduct();
        return;
      }

      const params = {
        bundle_option_uid: requestedBundleOptionUid,
        bundle_option_key: requestedBundleOptionKey,
        bundle_option: requestedBundleOptionTitle,
      };
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });

      logProductTiming('api-start', {
        endpoint: `/web-api/products/${slug}/bundle-option-detail?${query.toString()}`,
        mode: 'deferred-lite-bundle-option',
      });

      getWebProductBundleOptionDetail(slug, params)
        .then((liteProduct) => {
          if (!cancelled && liteProduct) {
            setProduct(liteProduct);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch deferred bundle option detail:', error);
        })
        .finally(() => {
          if (cancelled || typeof window === 'undefined') {
            return;
          }

          fullFetchTimer = window.setTimeout(fetchFullProduct, 900);
        });
    });

    return () => {
      cancelled = true;
      cancelScheduledStart();
      if (fullFetchTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(fullFetchTimer);
      }
    };
  }, [
    deferFullProduct,
    initialProduct,
    requestedBundleOptionKey,
    requestedBundleOptionTitle,
    requestedBundleOptionUid,
    slug,
  ]);

  if (!product) {
    return (
      <div className={styles.tabsSection}>
        <div className={styles.tabContent}>Đang mở trang sản phẩm...</div>
      </div>
    );
  }

  const productContentKey = [
    product?.id || slug,
    requestedBundleOptionKey || requestedBundleOptionTitle || '',
    requestedBundleOptionUid || '',
  ].join(':');

  return (
    <>
      {enableDeferredProductAnalytics && fullProductReady ? <ProductAnalyticsTracker product={product} /> : null}

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
          currentProduct={product}
        />
      ) : null}
    </>
  );
}
