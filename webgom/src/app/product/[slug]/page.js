import Link from 'next/link';
import Image from 'next/image';
import { getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import config from '@/lib/config';
import styles from './product.module.css';
import ProductDetailContent from '@/components/ProductDetailContent';

export default async function ProductDetailPage({ params }) {
  const resolvedParams = await params;
  const { slug } = resolvedParams;

  let product = null;
  let relatedProducts = [];

  try {
    [product, relatedProducts] = await Promise.all([
      getWebProductDetail(slug),
      getWebRelatedProducts(slug)
    ]);
  } catch (error) {
    console.error("Failed to fetch product detail:", error);
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

  // Determine main image for the description section
  const images = product.images || [];
  const mainImage = images.find(img => img.is_primary) || images[0];

  return (
    <div className={styles.productDetail}>
      <main className="container py-10">
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb}>
          <Link href="/">Trang chủ</Link>
          <span className={styles.separator}>/</span>
          <Link href="/products">Cửa hàng</Link>
          {product.category && (
            <>
              <span className={styles.separator}>/</span>
              <Link href={`/category/${product.category.slug}`}>{product.category.name}</Link>
            </>
          )}
          <span className={styles.separator}>/</span>
          <span>{product.name}</span>
        </nav>

        {/* Dynamic Product Content (Gallery + Info + Variants) */}
        <ProductDetailContent product={product} />

        {/* Detailed Tabs Section */}
        <div className={styles.tabsSection}>
          <div className={styles.tabHeader}>
            <h3 className={styles.tabTitle}>Mô tả chi tiết</h3>
          </div>
          <div className={styles.tabContent}>
            <h3 className={styles.descTitle}>Tinh hoa đất và lửa</h3>
            <div 
              className={styles.descBody}
              dangerouslySetInnerHTML={{ __html: product.description || 'Đang cập nhật nội dung...' }}
            />
            {mainImage && (
              <div className={styles.descImage}>
                <Image 
                  src={mainImage.url && mainImage.url.startsWith('http') ? mainImage.url : `${config.storageUrl}/${mainImage.path}`}
                  alt="Mô tả sản phẩm"
                  fill
                  sizes="(max-width: 768px) 100vw, 80vw"
                  style={{ objectFit: 'cover' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div className={styles.relatedSection}>
            <div className={styles.relatedHeader}>
              <div>
                <h3 className={styles.relatedTitle}>Vật phẩm tương tự</h3>
                <p className={styles.relatedSub}>Gợi ý những tác phẩm cùng phong cách dành cho bạn</p>
              </div>
              <Link href="/products" className={styles.viewAll}>
                Xem tất cả <span className="material-symbols-outlined">arrow_forward</span>
              </Link>
            </div>
            <div className={styles.relatedGrid}>
              {relatedProducts.map((rel) => {
                const displayImage = rel.primary_image;
                return (
                  <Link key={rel.id} href={`/product/${rel.slug}`} className={styles.relatedCard}>
                    <div className={styles.relImage}>
                      {displayImage ? (
                        <Image 
                          src={displayImage.url && displayImage.url.startsWith('http') ? displayImage.url : `${config.storageUrl}/${displayImage.path}`}
                          alt={rel.name}
                          fill
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                          style={{ objectFit: 'cover' }}
                        />
                      ) : (
                        <div className={styles.imagePlaceholder}>
                          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#ccc' }}>image</span>
                        </div>
                      )}
                    </div>
                    <div className={styles.relInfo}>
                      <h4 className={styles.relTitle}>{rel.name}</h4>
                      <div className={styles.relPriceRow}>
                        <span className={styles.relPrice}>{formatPrice(rel.price)}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const { slug } = resolvedParams;

  try {
    const product = await getWebProductDetail(slug);
    return {
      title: `${product.name} | Di Sản Gốm Việt`,
      description: product.meta_description || product.description?.substring(0, 160),
    };
  } catch (error) {
    return {
      title: 'Sản phẩm | Di Sản Gốm Việt'
    };
  }
}
