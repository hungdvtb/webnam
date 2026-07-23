import ProductDetailContent from '@/components/ProductDetailContent';
import ProductDetailTabs from '@/components/ProductDetailTabs';
import ProductReviews from '@/components/product/ProductReviews';
import RelatedProductsSection from '@/components/product/RelatedProductsSection';
import { ProductAnalyticsTracker } from '@/components/common/WebAnalyticsTracker';
import styles from '@/app/product/[slug]/product.module.css';

export default function BaseProductDetailPageTheme({
  product,
  requestedBundleOptionUid = '',
  requestedBundleOptionKey = '',
  requestedBundleOptionTitle = '',
  requestedVariantId = 0,
  descriptionHtml,
  mainImage,
  policyPosts = [],
  relatedProducts = [],
  relatedViewAllHref = '/products',
  variant = 'simple',
}) {
  const productPageGapClass =
    product?.type === 'simple' ? styles.productPageMainSimple : styles.productPageMainCompact;

  return (
    <div className={styles.productDetail} data-storefront-theme={`giao-dien-so-2-${variant}`}>
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

          <ProductReviews product={product} />

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
