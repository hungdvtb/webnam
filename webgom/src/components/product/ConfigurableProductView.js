'use client';

import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';

import Breadcrumb from './common/Breadcrumb';

export default function ConfigurableProductView({
  product,
  currentProduct,
  displayPrice,
  formatPrice,
  selectedOptions,
  handleOptionSelect,
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
            productName={currentProduct.name}
          />
        </div>

        <div className={styles.infoColumn}>
          <div className={styles.infoWrapper}>
            <div className={styles.titleSection}>

              <h1 className={styles.title}>{currentProduct.name}</h1>

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
                {product.super_attributes.map((attr) => {
                  // Filter options that are possible with current selections of OTHER attributes
                  const validOptions = (attr.options || []).filter(opt => {
                    return product.variations?.some(variant => {
                      // Check if this variant matches all OTHER selected options and has stock
                      const othersMatch = Object.entries(selectedOptions).every(([otherCode, otherValue]) => {
                        if (otherCode === attr.code) return true;
                        return variant.attribute_values?.some(av =>
                          (av.attribute?.code === otherCode || av.attribute_id === product.super_attributes.find(a => a.code === otherCode)?.id)
                          && av.value === otherValue
                        );
                      });

                      // Check if this variant matches the option being filtered
                      const thisMatches = variant.attribute_values?.some(av =>
                        (av.attribute?.code === attr.code || av.attribute_id === attr.id) && av.value === opt.value
                      );

                      return othersMatch && thisMatches && variant.stock_quantity > 0;
                    });
                  });

                  // If no valid options for this attribute group, don't render it at all
                  if (validOptions.length === 0) return null;

                  return (
                    <div key={attr.id} className={styles.variantGroup}>
                      <h4 className={styles.variantLabel}>
                        {attr.name}
                      </h4>
                      <div className={styles.variantOptions}>
                        {validOptions.map((opt) => {
                          const isActive = selectedOptions[attr.code] === opt.value;
                          const isSwatch = attr.frontend_type === 'swatch' || opt.swatch_value;

                          if (isSwatch) {
                            return (
                              <div key={opt.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                                <button
                                  onClick={() => handleOptionSelect(attr.code, opt.value)}
                                  className={`${styles.swatchBtn} ${isActive ? styles.swatchActive : ''}`}
                                  title={opt.value}
                                >
                                  <span
                                    className={styles.swatchColor}
                                    style={{ backgroundColor: opt.swatch_value || '#ccc' }}
                                  />
                                </button>
                                <span style={{ fontSize: '10px', fontWeight: isActive ? '700' : '500' }}>{opt.value}</span>
                              </div>
                            );
                          }

                          return (
                            <button
                              key={opt.id}
                              onClick={() => handleOptionSelect(attr.code, opt.value)}
                              className={`${styles.optionBtn} ${isActive ? styles.optionActive : ''}`}
                            >
                              {opt.value}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <SpecificationList product={product} currentProduct={currentProduct} />
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
