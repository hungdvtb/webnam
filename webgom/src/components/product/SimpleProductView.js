'use client';

import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';
import Breadcrumb from './common/Breadcrumb';

export default function SimpleProductView({
  product,
  displayPrice,
  formatPrice,
  getImageUrl,
  images,
  videoUrl,
  activeIndex,
  setActiveIndex,
  quantity,
  setQuantity,
  handleAddToCart,
  handleBuyNow,
  additionalInfo
}) {
  return (
    <div className={styles.simpleView}>
      <div className={styles.simpleBreadcrumbShell}>
        <Breadcrumb product={product} />
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.galleryColumn}>
          <ProductGallery
            images={images}
            videoUrl={videoUrl}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
            getImageUrl={getImageUrl}
            productName={product.name}
            showSingleThumbnail
          />
        </div>

        <div className={styles.infoColumn}>
          <div className={`${styles.infoWrapper} ${styles.simpleInfoWrapper}`}>
            <section className={styles.simpleHeroCard}>
              <div className={styles.titleSection}>
                <div className={styles.simpleTitleRow}>
                  <h1 className={styles.title}>{product.name}</h1>
                </div>
                {product?.sku ? (
                  <p className={styles.simpleMobileSku}>
                    Mã sản phẩm: <span>{product.sku}</span>
                  </p>
                ) : null}
              </div>

              <div className={styles.priceContainer}>
                <div className={styles.priceRow}>
                  <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
                  <button
                    type="button"
                    className={styles.quickCartButton}
                    onClick={handleAddToCart}
                    aria-label="Thêm sản phẩm vào giỏ hàng"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">shopping_cart</span>
                  </button>
                </div>
                <p className={styles.priceMeta}>Đã bao gồm VAT và phí bảo hiểm vận chuyển</p>
              </div>
            </section>

            <div className={styles.simpleDetailStack}>
              <SpecificationList product={product} />
              <ActionLinks additionalInfo={additionalInfo} />
              <TrustBadges />
            </div>

            <div className={`${styles.actionSectionMB} ${styles.simpleMobileActionSection}`}>
              <QuantitySelector
                quantity={quantity}
                setQuantity={setQuantity}
                statusText="Sẵn sàng giao ngay"
              />
              <BuyButtons onAddToCart={handleAddToCart} onBuyNow={handleBuyNow} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
