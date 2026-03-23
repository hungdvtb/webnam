import Link from 'next/link';
import Image from 'next/image';
import { getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import config from '@/lib/config';
import styles from './product.module.css';
import ProductDetailContent from '@/components/ProductDetailContent';
import RelatedProductsSection from '@/components/product/RelatedProductsSection';

export default async function ProductDetailPage({ params }) {
  const resolvedParams = await params;
  const { slug } = resolvedParams;

  let product = null;
  let relatedProducts = [];

  try {
    product = await getWebProductDetail(slug);
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

  try {
    relatedProducts = await getWebRelatedProducts(slug);
  } catch (error) {
    console.error("Failed to fetch related products:", error);
    relatedProducts = [];
  }

  // Determine main image for the description section
  const images = product.images || [];
  const mainImage = images.find(img => img.is_primary) || images[0];

  const parseVideoLinks = (html) => {
    if (!html) return '';
    // Comprehensive regex for YouTube and Facebook links
    return html.replace(/(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|facebook\.com\/(?:watch\/\?v=|.*\/videos\/|video\.php\?v=))[^\s<"']+)/gi, (match, url, offset, fullString) => {
        // Only skip if it's an attribute value (src, href)
        const before = fullString.substring(Math.max(0, offset - 10), offset).toLowerCase();
        if (before.includes('src=') || before.includes('href=')) {
            return match;
        }
        
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const idMatch = url.match(/(?:\/watch\?v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
            if (idMatch) {
                return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="https://www.youtube.com/embed/${idMatch[1]}" allowfullscreen="true" frameborder="0" style="width:100%; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
            }
        } else if (url.includes('facebook.com')) {
            const fbEmbed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
            return `<div class="video-container" style="display:flex; justify-content:center; margin: 2.5rem 0;"><iframe class="ql-video" src="${fbEmbed}" allowfullscreen="true" frameborder="0" style="width:800px; max-width:100%; aspect-ratio:16/9; border-radius:12px; box-shadow: 0 15px 45px rgba(0,0,0,0.15);"></iframe></div>`;
        }
        return match;
    });
  };

  return (
    <div className={styles.productDetail}>
      <main className="container py-10">


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
              dangerouslySetInnerHTML={{ __html: parseVideoLinks(product.description) || 'Đang cập nhật nội dung...' }}
            />
            {mainImage && (mainImage.url || mainImage.path) && (
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
        <RelatedProductsSection relatedProducts={relatedProducts} />
        {false && (
        <div className={`${styles.relatedSection} ${!hasRelatedProducts ? styles.relatedSectionEmpty : ''}`}>
            <div className={styles.relatedHeader}>
              <div>
                <h3 className={styles.relatedTitle}>Sản phẩm tương tự</h3>
                <p className={styles.relatedSub}>Gợi ý những tác phẩm cùng phong cách dành cho bạn</p>
              </div>
              <Link href="/products" className={styles.viewAll}>
                Xem tất cả <span className="material-symbols-outlined">arrow_forward</span>
              </Link>
            </div>
            <div className={`${styles.relatedGrid} ${!hasRelatedProducts ? styles.relatedGridLoading : ''}`}>
              {hasRelatedProducts ? relatedProducts.map((rel) => {
                const imageSrc = getRelatedImageSrc(rel);
                const { ratingValue, ratingCount } = getRelatedRatingMeta(rel);

                return (
                  <Link key={rel.id} href={`/product/${rel.slug || rel.id}`} className={styles.relatedCard}>
                    <div className={styles.relImage}>
                      {imageSrc ? (
                        <Image
                          src={imageSrc}
                          alt={rel.name}
                          fill
                          sizes="(max-width: 768px) 42vw, (max-width: 1200px) 50vw, 25vw"
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
                      {(ratingValue > 0 || ratingCount > 0) && (
                        <div className={styles.relRating}>
                          <div className={styles.relRatingStars}>
                            {renderRelatedStars(ratingValue)}
                          </div>
                          {ratingCount > 0 && <span className={styles.relRatingCount}>({ratingCount})</span>}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              }) : relatedSkeletons.map((skeletonIndex) => (
                <div
                  key={`related-skeleton-${skeletonIndex}`}
                  className={`${styles.relatedCard} ${styles.relatedSkeletonCard}`}
                  aria-hidden="true"
                >
                  <div className={`${styles.relImage} ${styles.relatedSkeletonImage}`} />
                  <div className={styles.relInfo}>
                    <div className={styles.relatedSkeletonLine} />
                    <div className={`${styles.relatedSkeletonLine} ${styles.relatedSkeletonLineShort}`} />
                    <div className={styles.relatedSkeletonRating} />
                    <div className={`${styles.relatedSkeletonLine} ${styles.relatedSkeletonPrice}`} />
                  </div>
                </div>
              ))}
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
      title: `${product.name} | GỐM ĐẠI THÀNH`,
      description: product.meta_description || product.description?.substring(0, 160),
    };
  } catch (error) {
    return {
      title: 'Sản phẩm | GỐM ĐẠI THÀNH'
    };
  }
}
