'use client';

import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';

export default function ConfigurableProductView({ 
  product, 
  currentProduct,
  displayPrice, 
  formatPrice, 
  selectedOptions,
  handleOptionSelect,
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
        productName={currentProduct.name}
      />

      <div className={styles.infoColumn}>
        <div className={styles.infoWrapper}>
          <div>
            <span className={styles.badge}>Tuyệt Tác Nghệ Nhân</span>
            <h1 className={styles.title}>{currentProduct.name}</h1>
            <p className={styles.artistTag}>Thiết kế bởi Nghệ nhân Ưu tú Trần Độ - Làng gốm Bát Tràng</p>
            <div className={styles.meta}>
              <span className={styles.sku}>SKU: <span className={styles.skuValue}>{currentProduct.sku}</span></span>
              <span className={styles.statusDot} style={{ backgroundColor: currentProduct.stock_quantity > 0 ? '#10b981' : '#ef4444' }}></span>
              <span className={styles.statusText} style={{ color: currentProduct.stock_quantity > 0 ? '#059669' : '#dc2626' }}>
                {currentProduct.stock_quantity > 0 ? 'Còn hàng' : 'Hết hàng'}
              </span>
            </div>
          </div>

          <div className={styles.priceContainer}>
            <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
            <p className={styles.priceMeta}>Đã bao gồm VAT và phí bảo hiểm vận chuyển</p>
          </div>

          {/* Variants Selection */}
          {product.super_attributes?.length > 0 && (
            <div className={styles.variantsCard}>
              {product.super_attributes.map((attr) => (
                <div key={attr.id} className={styles.variantGroup}>
                  <h4 className={styles.variantLabel}>
                    {attr.name}
                  </h4>
                  <div className={styles.variantOptions}>
                    {attr.options?.map((opt) => {
                      const isActive = selectedOptions[attr.code] === opt.value;
                      const isSwatch = attr.frontend_type === 'swatch' || opt.swatch_value;
                      
                      const isPossible = product.variations?.some(variant => {
                        return Object.entries(selectedOptions).every(([otherCode, otherVal]) => {
                          if (otherCode === attr.code) return true;
                          return variant.attribute_values?.some(av => 
                            (av.attribute?.code === otherCode || av.attribute_id === product.super_attributes.find(a => a.code === otherCode)?.id) 
                            && av.value === otherVal
                          );
                        }) && variant.attribute_values?.some(av => 
                          (av.attribute?.code === attr.code || av.attribute_id === attr.id) && av.value === opt.value
                        );
                      });

                      if (isSwatch) {
                        return (
                          <div key={opt.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', opacity: isPossible ? 1 : 0.3, cursor: isPossible ? 'pointer' : 'not-allowed' }}>
                            <button
                              onClick={() => isPossible && handleOptionSelect(attr.code, opt.value)}
                              className={`${styles.swatchBtn} ${isActive ? styles.swatchActive : ''}`}
                              title={opt.value}
                              disabled={!isPossible}
                            >
                              <span 
                                className={styles.swatchColor}
                                style={{ backgroundColor: opt.swatch_value || '#ccc' }} 
                              />
                            </button>
                            <span style={{ fontSize: '10px', fontWeight: isActive ? '700' : '500', opacity: isActive ? 1 : 0.6 }}>{opt.value}</span>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={opt.id}
                          onClick={() => isPossible && handleOptionSelect(attr.code, opt.value)}
                          className={`${styles.optionBtn} ${isActive ? styles.optionActive : ''}`}
                          disabled={!isPossible}
                          style={{ 
                            opacity: isPossible ? 1 : 0.4, 
                            cursor: isPossible ? 'pointer' : 'not-allowed',
                            textDecoration: isPossible ? 'none' : 'line-through'
                          }}
                        >
                          {opt.value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <SpecificationList product={product} currentProduct={currentProduct} />
          <ActionLinks />
          <QuantitySelector quantity={quantity} setQuantity={setQuantity} />
          <BuyButtons onAddToCart={handleAddToCart} onBuyNow={handleBuyNow} />
          <TrustBadges />
        </div>
      </div>
    </div>
  );
}
