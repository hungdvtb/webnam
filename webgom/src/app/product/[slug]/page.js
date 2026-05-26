import Link from 'next/link';
import { getWebProductBundleOptionDetail, getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import styles from './product.module.css';
import ProductDetailContent from '@/components/ProductDetailContent';
import ProductDetailClientShell from '@/components/ProductDetailClientShell';
import ProductDetailTabs from '@/components/ProductDetailTabs';
import RelatedProductsSection from '@/components/product/RelatedProductsSection';
import { buildProductDescriptionHtml } from '@/lib/productDescription';
import { getPolicyPosts } from '@/lib/policyContent';
import { ProductAnalyticsTracker } from '@/components/common/WebAnalyticsTracker';

function buildRelatedViewAllHref(product, relatedMeta) {
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
}

export default async function ProductDetailPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { slug } = resolvedParams;
  const requestedBundleOptionUid = String(resolvedSearchParams?.bundle_option_uid || '').trim();
  const requestedBundleOptionKey = String(resolvedSearchParams?.bundle_option_key || '').trim();
  const requestedBundleOptionTitle = String(resolvedSearchParams?.bundle_option || '').trim();
  const isBundlePreviewRequest = String(resolvedSearchParams?.bundle_preview || '').trim() === '1';
  const requestedVariantId = Number.parseInt(
    String(resolvedSearchParams?.variant_id || '').trim(),
    10,
  ) || 0;
  const isBundleOptionRequest = Boolean(requestedBundleOptionUid || requestedBundleOptionKey || requestedBundleOptionTitle);

  let product = null;
  let relatedProducts = [];
  let relatedMeta = null;
  let policyPosts = [];

  if (isBundleOptionRequest || isBundlePreviewRequest) {
    let initialBundleProduct = null;
    let initialRelatedProducts = [];
    let initialRelatedViewAllHref = '/products';
    let shouldDeferFullProduct = true;

    if (isBundleOptionRequest) {
      try {
        initialBundleProduct = await getWebProductBundleOptionDetail(slug, {
          bundle_option_uid: requestedBundleOptionUid,
          bundle_option_key: requestedBundleOptionKey,
          bundle_option: requestedBundleOptionTitle,
        });
      } catch (error) {
        console.error('Failed to fetch initial bundle option detail:', error);
      }
    } else if (isBundlePreviewRequest) {
      const [previewProductResult, previewRelatedResult] = await Promise.allSettled([
        getWebProductDetail(slug),
        getWebRelatedProducts(slug),
      ]);

      if (previewProductResult.status === 'fulfilled') {
        initialBundleProduct = previewProductResult.value;
        shouldDeferFullProduct = false;
      } else {
        console.error('Failed to fetch initial bundle preview detail:', previewProductResult.reason);
      }

      if (previewRelatedResult.status === 'fulfilled') {
        initialRelatedProducts = previewRelatedResult.value?.items || [];
        initialRelatedViewAllHref = buildRelatedViewAllHref(
          previewProductResult.status === 'fulfilled' ? previewProductResult.value : null,
          previewRelatedResult.value?.meta || null,
        );
      } else {
        console.error('Failed to fetch initial bundle preview related products:', previewRelatedResult.reason);
      }
    }

    return (
      <div className={styles.productDetail}>
        <main className={`container py-10 ${styles.productPageMain} ${styles.productPageMainCompact}`}>
          <div className={styles.productPageSections}>
            <ProductDetailClientShell
              initialProduct={initialBundleProduct}
              slug={slug}
              requestedBundleOptionUid={requestedBundleOptionUid}
              requestedBundleOptionKey={requestedBundleOptionKey}
              requestedBundleOptionTitle={requestedBundleOptionTitle}
              requestedVariantId={requestedVariantId}
              initialRelatedProducts={initialRelatedProducts}
              initialRelatedViewAllHref={initialRelatedViewAllHref}
              deferFullProduct={shouldDeferFullProduct}
              stripBundlePreviewParam={isBundlePreviewRequest}
              enableDeferredProductAnalytics
            />
          </div>
        </main>
      </div>
    );
  }

  // Fetch product detail and related products concurrently to minimize SSR latency
  const [productResult, relatedResult, policyResult] = await Promise.allSettled([
    getWebProductDetail(slug),
    getWebRelatedProducts(slug),
    getPolicyPosts(),
  ]);

  if (productResult.status === 'rejected') {
    console.error('Failed to fetch product detail:', productResult.reason);
    return (
      <div className="container py-20 text-center">
        <h2 className="text-2xl font-bold">Sản phẩm không tồn tại</h2>
        <p className="mt-4">Rất tiếc, chúng tôi không tìm thấy sản phẩm bạn yêu cầu.</p>
        <Link href="/products" className="btn-primary mt-8 inline-block">
          Quay lại cửa hàng
        </Link>
      </div>
    );
  }

  product = productResult.value;

  if (relatedResult.status === 'fulfilled') {
    relatedProducts = relatedResult.value?.items || [];
    relatedMeta = relatedResult.value?.meta || null;
  } else {
    console.error('Failed to fetch related products:', relatedResult.reason);
  }

  if (policyResult.status === 'fulfilled') {
    policyPosts = policyResult.value || [];
  } else {
    console.error('Failed to fetch product policy posts:', policyResult.reason);
  }

  const images = product.images || [];
  const mainImage = images.find((img) => img.is_primary) || images[0];
  const productPageGapClass =
    product?.type === 'simple' ? styles.productPageMainSimple : styles.productPageMainCompact;
  const descriptionHtml = buildProductDescriptionHtml(product?.description || '');
  const relatedViewAllHref = buildRelatedViewAllHref(product, relatedMeta);

  return (
    <div className={styles.productDetail}>
      <ProductAnalyticsTracker product={product} />
      <main className={`container py-10 ${styles.productPageMain} ${productPageGapClass}`}>
        <div className={styles.productPageSections}>
          <ProductDetailContent
            product={product}
            requestedBundleOptionUid={requestedBundleOptionUid}
            requestedBundleOptionKey={requestedBundleOptionKey}
            requestedBundleOptionTitle={requestedBundleOptionTitle}
            requestedVariantId={requestedVariantId}
          />

          <ProductDetailTabs
            descriptionHtml={descriptionHtml}
            mainImage={mainImage}
            policyPosts={policyPosts}
          />

          <RelatedProductsSection
            relatedProducts={relatedProducts}
            viewAllHref={relatedViewAllHref}
            currentProduct={product}
          />
        </div>
      </main>
    </div>
  );
}

export async function generateMetadata({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { slug } = resolvedParams;
  const bundleOptionUid = String(resolvedSearchParams?.bundle_option_uid || '').trim();
  const bundleOptionTitle = String(resolvedSearchParams?.bundle_option || '').trim();
  const isBundlePreviewRequest = String(resolvedSearchParams?.bundle_preview || '').trim() === '1';
  const hasBundleOptionRequest = Boolean(
    bundleOptionUid
    || String(resolvedSearchParams?.bundle_option_key || '').trim()
    || bundleOptionTitle
  );

  if (isBundlePreviewRequest) {
    return {
      title: 'Sản phẩm bộ | GỐM ĐẠI THÀNH',
    };
  }

  if (hasBundleOptionRequest) {
    return {
      title: `${bundleOptionTitle || 'Cấu hình bộ'} | GỐM ĐẠI THÀNH`,
    };
  }

  try {
    // Next.js deduplicates fetch() calls with the same URL+options within a render pass,
    // so this reuses the cached response from ProductDetailPage without an extra network hit.
    const product = await getWebProductDetail(slug);
    const seoTitle = String(product.meta_title || '').trim();
    const seoDescription = product.meta_description || product.description?.substring(0, 160);
    const seoKeywords = String(product.meta_keywords || '').trim();

    return {
      title: `${seoTitle || product.name} | GỐM ĐẠI THÀNH`,
      description: seoDescription,
      keywords: seoKeywords || undefined,
    };
  } catch (error) {
    return {
      title: 'Sản phẩm | GỐM ĐẠI THÀNH',
    };
  }
}
