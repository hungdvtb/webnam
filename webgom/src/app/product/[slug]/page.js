import Link from 'next/link';
import { getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import styles from './product.module.css';
import ProductDetailClientShell from '@/components/ProductDetailClientShell';
import { buildProductDescriptionHtml } from '@/lib/productDescription';
import { getPolicyPosts } from '@/lib/policyContent';
import { getServerPublicHost } from '@/lib/serverPublicHost';
import { resolveProductDetailPageTheme } from '@/themes/storefront/productDetailPageThemes';

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

function getSearchParamValue(searchParams, ...keys) {
  for (const key of keys) {
    const rawValue = searchParams?.[key];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalizedValue = String(value || '').trim();

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return '';
}

function getRequestedBundleOptionParams(searchParams) {
  const compactOption = getSearchParamValue(searchParams, 'o', 'bo');
  let requestedBundleOptionUid = getSearchParamValue(searchParams, 'bundle_option_uid', 'option_uid');
  let requestedBundleOptionKey = getSearchParamValue(searchParams, 'bundle_option_key', 'bk', 'option_key');
  let requestedBundleOptionTitle = getSearchParamValue(searchParams, 'bundle_option', 'bundle_option_title', 'bn', 'option');

  if (compactOption) {
    const compactIsUidKey = compactOption.startsWith('uid:');
    const compactIsStructuredKey = compactIsUidKey
      || compactOption.startsWith('post:')
      || compactOption.startsWith('title:');

    if (!requestedBundleOptionKey && compactIsStructuredKey) {
      requestedBundleOptionKey = compactOption;
    }

    if (!requestedBundleOptionUid) {
      requestedBundleOptionUid = compactIsUidKey
        ? compactOption.slice(4).trim()
        : (compactIsStructuredKey ? '' : compactOption);
    }

    if (!requestedBundleOptionKey && !requestedBundleOptionUid && !requestedBundleOptionTitle) {
      requestedBundleOptionTitle = compactOption;
    }
  }

  return {
    requestedBundleOptionUid,
    requestedBundleOptionKey,
    requestedBundleOptionTitle,
  };
}

function getStorefrontRequestContext(searchParams, fallbackPublicHost = '') {
  return {
    publicHost: getSearchParamValue(searchParams, 'public_host', 'publicHost') || fallbackPublicHost,
    siteCode: getSearchParamValue(searchParams, 'site_code', 'siteCode'),
  };
}

export default async function ProductDetailPage({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { slug } = resolvedParams;
  const publicHost = await getServerPublicHost();
  const storefrontContext = getStorefrontRequestContext(resolvedSearchParams, publicHost);
  const {
    requestedBundleOptionUid,
    requestedBundleOptionKey,
    requestedBundleOptionTitle,
  } = getRequestedBundleOptionParams(resolvedSearchParams);
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
    return (
      <div className={styles.productDetail}>
        <main className={`container py-10 ${styles.productPageMain} ${styles.productPageMainCompact}`}>
          <div className={styles.productPageSections}>
            <ProductDetailClientShell
              initialProduct={null}
              slug={slug}
              requestedBundleOptionUid={requestedBundleOptionUid}
              requestedBundleOptionKey={requestedBundleOptionKey}
              requestedBundleOptionTitle={requestedBundleOptionTitle}
              requestedVariantId={requestedVariantId}
              initialRelatedProducts={[]}
              initialRelatedViewAllHref="/products"
              deferFullProduct
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
    getWebProductDetail(slug, storefrontContext),
    getWebRelatedProducts(slug, storefrontContext),
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
  const descriptionHtml = buildProductDescriptionHtml(product?.description || '');
  const relatedViewAllHref = buildRelatedViewAllHref(product, relatedMeta);
  const ProductDetailTheme = resolveProductDetailPageTheme(product?.storefront_theme);

  return (
    <ProductDetailTheme
      product={product}
      requestedBundleOptionUid={requestedBundleOptionUid}
      requestedBundleOptionKey={requestedBundleOptionKey}
      requestedBundleOptionTitle={requestedBundleOptionTitle}
      requestedVariantId={requestedVariantId}
      descriptionHtml={descriptionHtml}
      mainImage={mainImage}
      policyPosts={policyPosts}
      relatedProducts={relatedProducts}
      relatedViewAllHref={relatedViewAllHref}
    />
  );
}

export async function generateMetadata({ params, searchParams }) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const { slug } = resolvedParams;
  const {
    requestedBundleOptionUid: bundleOptionUid,
    requestedBundleOptionKey: bundleOptionKey,
    requestedBundleOptionTitle: bundleOptionTitle,
  } = getRequestedBundleOptionParams(resolvedSearchParams);
  const isBundlePreviewRequest = String(resolvedSearchParams?.bundle_preview || '').trim() === '1';
  const hasBundleOptionRequest = Boolean(
    bundleOptionUid
    || bundleOptionKey
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
    const publicHost = await getServerPublicHost();
    const storefrontContext = getStorefrontRequestContext(resolvedSearchParams, publicHost);
    // Next.js deduplicates fetch() calls with the same URL+options within a render pass,
    // so this reuses the cached response from ProductDetailPage without an extra network hit.
    const product = await getWebProductDetail(slug, storefrontContext);
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
