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
    <>
      <Breadcrumb product={product} />
      <div className={styles.mainGrid}>
        <div className={styles.galleryColumn}>
          <ProductGallery
            images={images}
            videoUrl={videoUrl}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
            getImageUrl={getImageUrl}
            productName={product.name}
          />
        </div>

        <div className={styles.infoColumn}>
          <div className={styles.infoWrapper}>
            <div className={styles.titleSection}>

              <h1 className={styles.title}>{product.name}</h1>

              <div className={styles.meta}>
                <span className={styles.sku}>SKU: <span className={styles.skuValue}>{product.sku}</span></span>
                <span className={styles.statusDot} style={{ backgroundColor: '#10b981' }}></span>
                <span className={styles.statusText} style={{ color: '#059669' }}>
                  Sẵn sàng giao ngay
                </span>
              </div>
            </div>

            <div className={styles.priceContainer}>
              <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
              <p className={styles.priceMeta}>Đã bao gồm VAT và phí bảo hiểm vận chuyển</p>
            </div>

            <SpecificationList product={product} />
            <ActionLinks additionalInfo={additionalInfo} />

            <div className={styles.actionSectionMB}>
              <QuantitySelector quantity={quantity} setQuantity={setQuantity} />
              <BuyButtons onAddToCart={handleAddToCart} onBuyNow={handleBuyNow} />
            </div>

            <TrustBadges />
          </div>
        </div>
      </div>
    </>
  );
}

