import Link from 'next/link';
import Image from 'next/image';
import { getWebProductDetail, getWebRelatedProducts } from '@/lib/api';
import config from '@/lib/config';
import styles from './product.module.css';
import ProductGallery from '@/components/ProductGallery';

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

  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  // We pass product.images directly to the gallery component
  const images = product.images || [];

  // Determine main image for the description section
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

        <div className={styles.mainGrid}>
          {/* Gallery */}
          <div className={styles.galleryColumn}>
            <ProductGallery images={images} productName={product.name} />
          </div>

          {/* Info Section */}
          <div className={styles.infoColumn}>
            <div className={styles.infoWrapper}>
              <div>
                <span className={styles.badge}>Tuyệt Tác Nghệ Nhân</span>
                <h1 className={styles.title}>{product.name}</h1>
                <div className={styles.meta}>
                  <span className={styles.sku}>SKU: <span className={styles.skuValue}>{product.sku}</span></span>
                  <span className={styles.statusDot}></span>
                  <span className={styles.statusText}>
                    {product.stock_quantity > 0 ? 'Còn hàng' : 'Hết hàng'}
                  </span>
                </div>
              </div>

              <div className={styles.priceCard}>
                <div className={styles.price}>{formatPrice(product.price)}</div>
                <p className={styles.priceMeta}>Đã bao gồm VAT và phí bảo hiểm vận chuyển</p>
              </div>

              <div className={styles.specCard}>
                <h4 className={styles.specTitle}>
                  <span className="material-symbols-outlined">info</span>
                  Thông số chi tiết
                </h4>
                <ul className={styles.specList}>
                  {product.specifications && (
                    <li className={styles.specItem} style={{ borderBottom: '1px solid rgba(27, 54, 93, 0.1)', paddingBottom: '1rem', marginBottom: '0.5rem', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span className={styles.specLabel} style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mô tả kỹ thuật</span>
                      <span className={styles.specValue} style={{ whiteSpace: 'pre-line', fontWeight: '500', lineHeight: '1.5' }}>{product.specifications}</span>
                    </li>
                  )}
                  {product.attributeValues?.map((attr) => (
                    <li key={attr.id} className={styles.specItem}>
                      <span className={styles.specLabel}>{attr.attribute?.name}</span>
                      <span className={styles.specValue}>{attr.value}</span>
                    </li>
                  ))}
                  {/* Fallback specs if no attributes and no specifications */}
                  {(!product.attributeValues || product.attributeValues.length === 0) && !product.specifications && (
                    <>
                      <li className={styles.specItem}>
                        <span className={styles.specLabel}>Chất liệu</span>
                        <span className={styles.specValue}>Gốm sứ cao cấp</span>
                      </li>
                      <li className={styles.specItem}>
                        <span className={styles.specLabel}>Xuất xứ</span>
                        <span className={styles.specValue}>Bát Tràng, Việt Nam</span>
                      </li>
                    </>
                  )}
                </ul>
              </div>

              <div className={styles.actionLinks}>
                <div className={styles.actionBtn}>
                  <div className={styles.actionIconBox}>
                    <span className="material-symbols-outlined">verified</span>
                  </div>
                  <div>
                    <div className={styles.actionLabel}>Chứng nhận quốc gia</div>
                    <div className={styles.actionText}>Sản phẩm có Chứng nhận Nghệ nhân quốc gia</div>
                  </div>
                  <span className={`material-symbols-outlined ${styles.actionChevron}`}>arrow_forward_ios</span>
                </div>
                <div className={styles.actionBtn}>
                  <div className={styles.actionIconBox}>
                    <span className="material-symbols-outlined">library_books</span>
                  </div>
                  <div>
                    <div className={styles.actionLabel}>Kiến thức gốm sứ</div>
                    <div className={styles.actionText}>Cách phân biệt các loại men</div>
                  </div>
                  <span className={`material-symbols-outlined ${styles.actionChevron}`}>arrow_forward_ios</span>
                </div>
              </div>

              <div className={styles.quantitySection}>
                <span className={styles.quantityLabel}>SỐ LƯỢNG</span>
                <div className={styles.quantityControl}>
                  <button className={styles.qBtn}><span className="material-symbols-outlined">remove</span></button>
                  <input className={styles.qInput} type="number" defaultValue="1" readOnly />
                  <button className={styles.qBtn}><span className="material-symbols-outlined">add</span></button>
                </div>
              </div>

              <div className={styles.buyGrid}>
                <button className={styles.btnPrimary}>
                  <span className="material-symbols-outlined">add_shopping_cart</span>
                  THÊM VÀO GIỎ
                </button>
                <button className={styles.btnOutline}>
                  <span className="material-symbols-outlined">shopping_bag</span>
                  MUA NGAY
                </button>
              </div>

              <div className={styles.trustBadges}>
                <div className={styles.trustItem}>
                  <span className="material-symbols-outlined">local_shipping</span>
                  VẬN CHUYỂN TOÀN QUỐC
                </div>
                <div className={styles.trustItem}>
                  <span className="material-symbols-outlined">security</span>
                  BẢO HÀNH 10 NĂM
                </div>
                <div className={styles.trustItem}>
                  <span className="material-symbols-outlined">history_edu</span>
                  CAM KẾT CHÍNH HÃNG
                </div>
              </div>
            </div>
          </div>
        </div>

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
