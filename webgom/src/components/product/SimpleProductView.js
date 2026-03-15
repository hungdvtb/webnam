'use client';

import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';

export default function SimpleProductView({ 
  product, 
  displayPrice, 
  formatPrice, 
  getImageUrl,
  images,
  activeIndex,
  setActiveIndex,
  quantity,
  setQuantity,
  handleAddToCart,
  handleBuyNow
}) {
  return (
    <div className={styles.mainGrid}>
      <ProductGallery 
        images={images}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        getImageUrl={getImageUrl}
        productName={product.name}
      />

      <div className={styles.infoColumn}>
        <div className={styles.infoWrapper}>
          <div>
            <span className={styles.badge}>Tuyệt Tác Nghệ Nhân</span>
            <h1 className={styles.title}>{product.name}</h1>
            <p className={styles.artistTag}>Thiết kế bởi Nghệ nhân Ưu tú Trần Độ - Làng gốm Bát Tràng</p>
            <div className={styles.meta}>
              <span className={styles.sku}>SKU: <span className={styles.skuValue}>{product.sku}</span></span>
              <span className={styles.statusDot} style={{ backgroundColor: product.stock_quantity > 0 ? '#10b981' : '#ef4444' }}></span>
              <span className={styles.statusText} style={{ color: product.stock_quantity > 0 ? '#059669' : '#dc2626' }}>
                {product.stock_quantity > 0 ? 'Còn hàng' : 'Hết hàng'}
              </span>
            </div>
          </div>

          <div className={styles.priceContainer}>
            <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
            <p className={styles.priceMeta}>Đã bao gồm VAT và phí bảo hiểm vận chuyển</p>
          </div>

          <SpecificationList product={product} />
          <ActionLinks />
          <QuantitySelector quantity={quantity} setQuantity={setQuantity} />
          <BuyButtons onAddToCart={handleAddToCart} onBuyNow={handleBuyNow} />
          <TrustBadges />
        </div>
      </div>
    </div>
  );
}
