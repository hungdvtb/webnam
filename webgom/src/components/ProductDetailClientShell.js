'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  cacheBundleProductDetail,
  readCachedBundleOptionDetail,
  readPendingBundleProductDetail,
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

const buildRelatedViewAllHref = (product, relatedMeta) => {
  if (relatedMeta?.has_explicit_related) {
    return '/products';
  }

  const fallbackCategorySlug = String(
    relatedMeta?.fallback_category?.slug
    || product?.category?.slug
    || ''
  ).trim();

  return fallbackCategorySlug
    ? `/category/${encodeURIComponent(fallbackCategorySlug)}`
    : '/products';
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

function ProductDetailLoadingSkeleton({ hasError = false }) {
  return (
    <div className={styles.productLoadingShell} aria-live="polite" aria-busy={!hasError}>
      <div className={styles.productLoadingBreadcrumb}>
        <span className={styles.productLoadingLine} />
        <span className={styles.productLoadingLineShort} />
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.galleryColumn}>
          <div className={styles.productLoadingGallery}>
            <div className={styles.productLoadingMedia}>
              <span className="material-symbols-outlined" aria-hidden="true">image</span>
            </div>
            <div className={styles.productLoadingThumbs}>
              {Array.from({ length: 5 }).map((_, index) => (
                <span key={index} className={styles.productLoadingThumb} />
              ))}
            </div>
          </div>
        </div>

        <div className={styles.infoColumn}>
          <div className={styles.productLoadingInfo}>
            <span className={styles.productLoadingTitle} />
            <span className={styles.productLoadingLineWide} />
            <span className={styles.productLoadingLineMedium} />
            <div className={styles.productLoadingActions}>
              <span />
              <span />
            </div>
            {hasError ? (
              <p className={styles.productLoadingError}>
                Khong the tai du lieu san pham. Vui long thu lai.
              </p>
            ) : null}
          </div>
        </div>
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
  stripBundlePreviewParam = false,
  enableDeferredProductAnalytics = false,
}) {
  const [product, setProduct] = useState(initialProduct || null);
  const [relatedProducts, setRelatedProducts] = useState(initialRelatedProducts);
  const [relatedViewAllHref, setRelatedViewAllHref] = useState(initialRelatedViewAllHref);
  const [fullProductReady, setFullProductReady] = useState(!deferFullProduct);
  const [deferredSectionsReady, setDeferredSectionsReady] = useState(!deferFullProduct);
  const [criticalFetchFailed, setCriticalFetchFailed] = useState(false);
  const secondaryLoadStartedRef = useRef(false);
  const hasRequestedBundleOption = Boolean(
    requestedBundleOptionUid
    || requestedBundleOptionKey
    || requestedBundleOptionTitle
  );

  useEffect(() => {
    secondaryLoadStartedRef.current = false;
  }, [requestedBundleOptionKey, requestedBundleOptionTitle, requestedBundleOptionUid, slug]);

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
      return undefined;
    }

    let cancelled = false;
    const cachedDetail = readCachedBundleOptionDetail(
      slug,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
      requestedBundleOptionUid,
    );

    if (!cachedDetail) {
      const pendingDetail = readPendingBundleProductDetail(
        slug,
        requestedBundleOptionKey,
        requestedBundleOptionTitle,
        requestedBundleOptionUid,
      );

      if (pendingDetail) {
        pendingDetail.then((pendingProduct) => {
          if (cancelled || !pendingProduct) {
            return;
          }

          setProduct(pendingProduct);
          if (!hasRequestedBundleOption && !pendingProduct?.is_bundle_option_lite) {
            setFullProductReady(true);
          }
        });
      }

      return () => {
        cancelled = true;
      };
    }

    window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      setProduct(cachedDetail);
      if (!hasRequestedBundleOption && !cachedDetail?.is_bundle_option_lite) {
        setFullProductReady(true);
      }
    }, 0);

    return () => {
      cancelled = true;
    };
  }, [
    hasRequestedBundleOption,
    product,
    requestedBundleOptionKey,
    requestedBundleOptionTitle,
    requestedBundleOptionUid,
    slug,
  ]);

  useEffect(() => {
    if (!deferFullProduct || !slug || product) {
      return undefined;
    }

    const cachedDetail = readCachedBundleOptionDetail(
      slug,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
      requestedBundleOptionUid,
    );

    if (cachedDetail) {
      return undefined;
    }

    const pendingDetail = readPendingBundleProductDetail(
      slug,
      requestedBundleOptionKey,
      requestedBundleOptionTitle,
      requestedBundleOptionUid,
    );

    if (pendingDetail) {
      return undefined;
    }

    let cancelled = false;
    const params = {
      bundle_option_uid: requestedBundleOptionUid,
      bundle_option_key: requestedBundleOptionKey,
      bundle_option: requestedBundleOptionTitle,
    };
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const endpoint = hasRequestedBundleOption
      ? `/web-api/products/${slug}/bundle-option-detail${query.toString() ? `?${query.toString()}` : ''}`
      : `/web-api/products/${slug}`;
    const criticalRequest = hasRequestedBundleOption
      ? getWebProductBundleOptionDetail(slug, params)
      : getWebProductDetail(slug);

    logProductTiming('api-start', {
      endpoint,
      mode: 'critical-bundle-gallery',
    });

    criticalRequest
      .then((criticalProduct) => {
        if (cancelled || !criticalProduct) {
          return;
        }

        setProduct(criticalProduct);
        setCriticalFetchFailed(false);
        cacheBundleProductDetail(
          criticalProduct,
          slug,
          requestedBundleOptionKey,
          requestedBundleOptionTitle,
          requestedBundleOptionUid,
        );

        if (!hasRequestedBundleOption || !criticalProduct?.is_bundle_option_lite) {
          setFullProductReady(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCriticalFetchFailed(true);
          console.error('Failed to fetch critical bundle product detail:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    deferFullProduct,
    hasRequestedBundleOption,
    product,
    requestedBundleOptionKey,
    requestedBundleOptionTitle,
    requestedBundleOptionUid,
    slug,
  ]);

  useEffect(() => {
    if (!deferFullProduct || !slug || !product || secondaryLoadStartedRef.current) {
      return undefined;
    }

    let cancelled = false;
    let fullFetchTimer = null;

    const applyRelatedProducts = (relatedResult, baseProduct) => {
      setRelatedProducts(relatedResult?.items || []);
      setRelatedViewAllHref(buildRelatedViewAllHref(baseProduct, relatedResult?.meta || null));
    };

    const fetchRelatedProducts = () => {
      logProductTiming('api-start', {
        endpoint: `/web-api/products/${slug}/related`,
        mode: 'deferred-related',
      });

      getWebRelatedProducts(slug)
        .then((relatedResult) => {
          if (!cancelled) {
            applyRelatedProducts(relatedResult, product);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch deferred related products:', error);
        });
    };

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

        const fullProduct = productResult.status === 'fulfilled' ? productResult.value : product;

        if (productResult.status === 'fulfilled') {
          setProduct(productResult.value);
          setFullProductReady(true);
          cacheBundleProductDetail(productResult.value, slug);
        } else {
          console.error('Failed to fetch deferred product detail:', productResult.reason);
        }

        if (relatedResult.status === 'fulfilled') {
          applyRelatedProducts(relatedResult.value, fullProduct);
        } else {
          console.error('Failed to fetch deferred related products:', relatedResult.reason);
        }
      });
    };

    const cancelScheduledStart = scheduleAfterFirstPaint(() => {
      secondaryLoadStartedRef.current = true;
      setDeferredSectionsReady(true);

      if (hasRequestedBundleOption) {
        fullFetchTimer = window.setTimeout(fetchFullProduct, 900);
        return;
      }

      fetchRelatedProducts();
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
    hasRequestedBundleOption,
    product,
    slug,
  ]);

  if (!product) {
    return <ProductDetailLoadingSkeleton hasError={criticalFetchFailed} />;
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
