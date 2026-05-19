'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import InfiniteProductList from '@/components/InfiniteProductList';
import InfiniteProductListLayout2 from '@/components/InfiniteProductListLayout2';
import { getWebCategory, getWebProducts } from '@/lib/api';
import { buildProductCardKey } from '@/lib/productLinks';
import styles from '../../app/product/[slug]/product.module.css';

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';
const PRODUCTS_PER_PAGE = 60;
const SECTION_TITLE = 'Có thể bạn cũng cần';

const subscribeMobileViewport = (callback) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  mediaQuery.addEventListener('change', callback);

  return () => {
    mediaQuery.removeEventListener('change', callback);
  };
};

const getMobileViewportSnapshot = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia(MOBILE_MEDIA_QUERY).matches
);

const getServerMobileViewportSnapshot = () => false;

const normalizeText = (value = '') => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const normalizeComparableValue = (value = '') => normalizeText(value)
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const parseAttributeValue = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(parseAttributeValue);
  }

  if (value && typeof value === 'object') {
    return parseAttributeValue(value.value ?? value.label ?? value.name ?? '');
  }

  const rawValue = String(value ?? '').trim();
  if (!rawValue) {
    return [];
  }

  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        return parsed.flatMap(parseAttributeValue);
      }
    } catch {
      // Keep the raw value below.
    }
  }

  return [rawValue];
};

const getAttributeEntries = (product = {}) => {
  const source = Array.isArray(product?.attribute_values)
    ? product.attribute_values
    : (Array.isArray(product?.attributeValues) ? product.attributeValues : []);

  return source.flatMap((entry = {}) => {
    const attribute = entry.attribute || {};
    const code = String(entry.attribute_code || entry.code || attribute.code || '').trim();
    const name = String(entry.attribute_name || entry.name || attribute.name || '').trim();
    const values = parseAttributeValue(entry.value ?? entry.label ?? entry.name);

    return values.map((value) => ({
      key: normalizeComparableValue(code || name),
      label: normalizeComparableValue(`${code} ${name}`),
      value: normalizeComparableValue(value),
    })).filter((item) => item.key && item.value);
  });
};

const isHighPriorityAttribute = (entry) => {
  const label = entry?.label || '';

  if (label.includes('men') || label.includes('loai men') || label.includes('chat men') || label.includes('glaze')) {
    return 80;
  }

  if (
    label.includes('phan khuc')
    || label.includes('tam gia')
    || label.includes('muc gia')
    || label.includes('khoang gia')
    || label.includes('segment')
  ) {
    return 60;
  }

  return 6;
};

const getPrimaryCategorySlug = (product = {}) => {
  const directSlug = String(product?.category?.slug || '').trim();
  if (directSlug) {
    return directSlug;
  }

  const categories = Array.isArray(product?.categories) ? product.categories : [];
  return String(categories.find((category) => category?.slug)?.slug || '').trim();
};

const isCurrentProduct = (candidate = {}, currentProduct = {}) => {
  const currentId = String(currentProduct?.id || '').trim();
  const currentSlug = String(currentProduct?.slug || '').trim();
  const candidateId = String(candidate?.id || '').trim();
  const candidateSlug = String(candidate?.slug || '').trim();

  return Boolean(
    (currentId && candidateId && currentId === candidateId)
    || (currentSlug && candidateSlug && currentSlug === candidateSlug)
  );
};

const mergeProductPages = (existingProducts, nextProducts, currentProduct) => {
  const productsByKey = new Map();

  [...existingProducts, ...nextProducts].forEach((product) => {
    if (!product || isCurrentProduct(product, currentProduct)) {
      return;
    }

    productsByKey.set(buildProductCardKey(product), product);
  });

  return Array.from(productsByKey.values());
};

const scoreProduct = (product, currentProduct, currentAttributes) => {
  const productAttributes = getAttributeEntries(product);
  let score = 0;

  if (normalizeText(product?.type) === normalizeText(currentProduct?.type)) {
    score += 4;
  }

  currentAttributes.forEach((currentAttribute) => {
    const hasMatch = productAttributes.some((entry) => (
      entry.key === currentAttribute.key && entry.value === currentAttribute.value
    ));

    if (hasMatch) {
      score += isHighPriorityAttribute(currentAttribute);
    }
  });

  return score;
};

const prioritizeProducts = (products, currentProduct, currentAttributes) => products
  .map((product, index) => ({
    product,
    index,
    score: scoreProduct(product, currentProduct, currentAttributes),
  }))
  .sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.index - right.index;
  })
  .map((entry) => entry.product);

export default function MobileCategoryProductsSection({
  currentProduct,
  viewAllHref = '/products',
}) {
  const sectionRef = useRef(null);
  const isMobileViewport = useSyncExternalStore(
    subscribeMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loadState, setLoadState] = useState({
    status: 'idle',
    products: [],
    layout: 'layout_1',
    error: '',
    loadedAll: false,
  });

  const categorySlug = useMemo(() => getPrimaryCategorySlug(currentProduct), [currentProduct]);
  const currentAttributes = useMemo(() => getAttributeEntries(currentProduct), [currentProduct]);
  const productsData = useMemo(() => ({
    data: loadState.products,
  }), [loadState.products]);
  const sectionHref = categorySlug ? `/category/${encodeURIComponent(categorySlug)}` : viewAllHref;
  const ProductList = loadState.layout === 'layout_2' ? InfiniteProductListLayout2 : InfiniteProductList;
  const isLoading = loadState.status === 'loading' || loadState.status === 'idle';
  const hasProducts = loadState.products.length > 0;

  useEffect(() => {
    if (!isMobileViewport || shouldLoad || !categorySlug) {
      return undefined;
    }

    const sectionElement = sectionRef.current;
    if (!sectionElement) {
      return undefined;
    }

    if (typeof IntersectionObserver !== 'function') {
      const fallbackTimer = window.setTimeout(() => {
        setShouldLoad(true);
      }, 0);

      return () => window.clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, {
      rootMargin: '700px 0px',
      threshold: 0.01,
    });

    observer.observe(sectionElement);

    return () => observer.disconnect();
  }, [categorySlug, isMobileViewport, shouldLoad]);

  useEffect(() => {
    if (!isMobileViewport || !shouldLoad || !categorySlug) {
      return undefined;
    }

    let cancelled = false;
    const loadTimer = window.setTimeout(async () => {
      setLoadState((previousState) => ({
        ...previousState,
        status: previousState.products.length > 0 ? 'ready' : 'loading',
        error: '',
      }));

      try {
        const [firstPageResult, categoryResult] = await Promise.allSettled([
          getWebProducts({
            category: categorySlug,
            sort: 'popular',
            page: 1,
            per_page: PRODUCTS_PER_PAGE,
          }),
          getWebCategory(categorySlug),
        ]);

        if (cancelled) {
          return;
        }

        if (firstPageResult.status === 'rejected') {
          throw firstPageResult.reason;
        }

        const firstPage = firstPageResult.value;
        const layout = categoryResult.status === 'fulfilled' && categoryResult.value?.display_layout === 'layout_2'
          ? 'layout_2'
          : 'layout_1';
        const firstProducts = prioritizeProducts(
          mergeProductPages([], Array.isArray(firstPage?.data) ? firstPage.data : [], currentProduct),
          currentProduct,
          currentAttributes,
        );
        const lastPage = Number(firstPage?.last_page || 1);

        setLoadState({
          status: 'ready',
          products: firstProducts,
          layout,
          error: '',
          loadedAll: lastPage <= 1,
        });

        let mergedProducts = firstProducts;
        for (let page = 2; page <= lastPage; page += 1) {
          const pageData = await getWebProducts({
            category: categorySlug,
            sort: 'popular',
            page,
            per_page: PRODUCTS_PER_PAGE,
          });

          if (cancelled) {
            return;
          }

          mergedProducts = prioritizeProducts(
            mergeProductPages(mergedProducts, Array.isArray(pageData?.data) ? pageData.data : [], currentProduct),
            currentProduct,
            currentAttributes,
          );

          setLoadState({
            status: 'ready',
            products: mergedProducts,
            layout,
            error: '',
            loadedAll: page >= lastPage,
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error('Failed to load mobile category suggestions:', error);
        setLoadState((previousState) => ({
          ...previousState,
          status: 'error',
          error: 'Không tải được danh sách sản phẩm gợi ý.',
          loadedAll: true,
        }));
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [categorySlug, currentAttributes, currentProduct, isMobileViewport, shouldLoad]);

  if (!categorySlug) {
    return null;
  }

  return (
    <section ref={sectionRef} className={styles.relatedMobileSection} data-testid="mobile-category-products-section">
      <div className={styles.relatedMobileHeader}>
        <div className={styles.relatedMobileHeading}>
          <h3 className={styles.relatedMobileTitle}>{SECTION_TITLE}</h3>
        </div>
        <Link href={sectionHref} className={styles.relatedMobileViewAll}>
          Xem tất cả <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
        </Link>
      </div>

      {isLoading && !hasProducts ? (
        <div className={styles.relatedMobileSkeletonGrid} aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={`mobile-related-skeleton-${index}`} className={styles.relatedMobileSkeletonCard}>
              <div className={styles.relatedMobileSkeletonImage} />
              <div className={styles.relatedMobileSkeletonBody}>
                <span />
                <span />
                <strong />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {hasProducts ? (
        <div className={styles.relatedMobileProducts}>
          <ProductList initialData={productsData} />
          {!loadState.loadedAll ? (
            <div className={styles.relatedMobileLoadingMore} role="status" aria-live="polite">
              Đang tải thêm sản phẩm...
            </div>
          ) : null}
        </div>
      ) : null}

      {loadState.status === 'error' && !hasProducts ? (
        <p className={styles.relatedMobileStatus}>{loadState.error}</p>
      ) : null}

      {loadState.status === 'ready' && !hasProducts ? (
        <p className={styles.relatedMobileStatus}>Chưa có sản phẩm khác trong cùng danh mục.</p>
      ) : null}
    </section>
  );
}
