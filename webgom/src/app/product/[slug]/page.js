import Link from 'next/link';
import Image from 'next/image';
import { getWebProductBundleOptionDetail, getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import config from '@/lib/config';
import styles from './product.module.css';
import ProductDetailContent from '@/components/ProductDetailContent';
import ProductDetailClientShell from '@/components/ProductDetailClientShell';
import RelatedProductsSection from '@/components/product/RelatedProductsSection';
import { buildProductDescriptionHtml } from '@/lib/productDescription';

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
  const requestedVariantId = Number.parseInt(
    String(resolvedSearchParams?.variant_id || '').trim(),
    10,
  ) || 0;
  const isBundleOptionRequest = Boolean(requestedBundleOptionUid || requestedBundleOptionKey || requestedBundleOptionTitle);

  let product = null;
  let relatedProducts = [];
  let relatedMeta = null;

  if (isBundleOptionRequest) {
    try {
      product = await getWebProductBundleOptionDetail(slug, {
        bundle_option_uid: requestedBundleOptionUid,
        bundle_option_key: requestedBundleOptionKey,
        bundle_option: requestedBundleOptionTitle,
      });
    } catch (error) {
      console.error('Failed to fetch lightweight bundle option detail:', error);
      product = null;
    }

    if (!product) {
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

    const productPageGapClass =
      product?.type === 'simple' ? styles.productPageMainSimple : styles.productPageMainCompact;

    return (
      <div className={styles.productDetail}>
        <main className={`container py-10 ${styles.productPageMain} ${productPageGapClass}`}>
          <div className={styles.productPageSections}>
            <ProductDetailClientShell
              initialProduct={product}
              slug={slug}
              requestedBundleOptionUid={requestedBundleOptionUid}
              requestedBundleOptionKey={requestedBundleOptionKey}
              requestedBundleOptionTitle={requestedBundleOptionTitle}
              requestedVariantId={requestedVariantId}
              deferFullProduct={Boolean(product?.is_bundle_option_lite)}
            />
          </div>
        </main>
      </div>
    );
  }

  // Fetch product detail and related products concurrently to minimize SSR latency
  const [productResult, relatedResult] = await Promise.allSettled([
    getWebProductDetail(slug),
    getWebRelatedProducts(slug),
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

  const images = product.images || [];
  const mainImage = images.find((img) => img.is_primary) || images[0];
  const productPageGapClass =
    product?.type === 'simple' ? styles.productPageMainSimple : styles.productPageMainCompact;
  const descriptionHtml = buildProductDescriptionHtml(product?.description || '');
  const hasDescription = Boolean(descriptionHtml.trim());
  const relatedViewAllHref = buildRelatedViewAllHref(product, relatedMeta);

  return (
    <div className={styles.productDetail}>
      <main className={`container py-10 ${styles.productPageMain} ${productPageGapClass}`}>
        <div className={styles.productPageSections}>
          <ProductDetailContent
            product={product}
            requestedBundleOptionUid={requestedBundleOptionUid}
            requestedBundleOptionKey={requestedBundleOptionKey}
            requestedBundleOptionTitle={requestedBundleOptionTitle}
            requestedVariantId={requestedVariantId}
          />

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
                  />
                </div>
              )}
            </div>
          </div>

          <RelatedProductsSection
            relatedProducts={relatedProducts}
            viewAllHref={relatedViewAllHref}
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
  const hasBundleOptionRequest = Boolean(
    bundleOptionUid
    || String(resolvedSearchParams?.bundle_option_key || '').trim()
    || bundleOptionTitle
  );

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
