'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../../app/product/[slug]/product.module.css';
import ProductGallery from './common/ProductGallery';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import TrustBadges from './common/TrustBadges';

import Breadcrumb from './common/Breadcrumb';

function VariantActionPopover({ variantLabel, onAddToCart, onBuyNow }) {
  if (!variantLabel) {
    return null;
  }

  return (
    <div className={`${styles.bundleActionPopover} ${styles.variantActionPopover}`}>
      <div className={styles.bundleActionContent}>
        <p className={styles.bundleActionEyebrow}>Chọn phân loại</p>
        <h3 className={styles.bundleActionTitle}>{variantLabel}</h3>
        <div className={styles.bundleActionGrid}>
          <button type="button" onClick={onAddToCart} className={styles.bundleActionPrimary}>
            <span className="material-symbols-outlined">add_shopping_cart</span>
            Thêm vào giỏ
          </button>
          <button type="button" onClick={onBuyNow} className={styles.bundleActionSecondary}>
            <span className="material-symbols-outlined">shopping_bag</span>
            Mua ngay
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConfigurableProductView({
  product,
  currentProduct,
  displayPrice,
  formatPrice,
  hasStructuredVariantAttributes,
  selectedOptions,
  handleOptionSelect,
  handleVariantSelect,
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
  const [variantActionId, setVariantActionId] = useState(null);
  const pendingStructuredOpenRef = useRef(false);
  const isConcreteVariant = currentProduct?.id && currentProduct.id !== product?.id;

  const getFallbackVariantLabel = (variant) => {
    const variantName = String(variant?.name || '').trim();
    const baseName = String(product?.name || '').trim();

    if (variantName && baseName && variantName.toLowerCase().startsWith(baseName.toLowerCase())) {
      const suffix = variantName.slice(baseName.length).replace(/^[-–—:\s]+/, '').trim();
      if (suffix) {
        return suffix;
      }
    }

    return variant?.sku || `Biến thể #${variant?.id || ''}`.trim();
  };

  useEffect(() => {
    if (!variantActionId) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const wrapper = event.target.closest('[data-variant-action-wrapper="true"]');
      if (!wrapper || wrapper.dataset.variantId !== String(variantActionId)) {
        setVariantActionId(null);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setVariantActionId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [variantActionId]);

  useEffect(() => {
    if (pendingStructuredOpenRef.current) {
      if (isConcreteVariant) {
        setVariantActionId(currentProduct.id);
      }
      pendingStructuredOpenRef.current = false;
      return;
    }

    if (!isConcreteVariant) {
      setVariantActionId(null);
    }
  }, [currentProduct?.id, isConcreteVariant]);

  const handleOptionChoose = (attrCode, value) => {
    pendingStructuredOpenRef.current = true;
    handleOptionSelect(attrCode, value);
  };

  const handleFallbackVariantChoose = (variantId) => {
    pendingStructuredOpenRef.current = false;
    handleVariantSelect(variantId);
    setVariantActionId((currentId) => (currentId === variantId ? null : variantId));
  };

  const toggleStructuredVariantActions = () => {
    if (!isConcreteVariant) {
      return;
    }

    setVariantActionId((currentId) => (currentId === currentProduct.id ? null : currentProduct.id));
  };

  const handleVariantPopupAddToCart = (event) => {
    handleAddToCart(event);
    setVariantActionId(null);
  };

  const handleVariantPopupBuyNow = (event) => {
    handleBuyNow(event);
    setVariantActionId(null);
  };

  return (
    <div className={styles.configurableView}>
      <Breadcrumb product={product} />
      <div className={styles.mainGrid}>
        <div className={styles.galleryColumn}>
          <div className={styles.configurableMediaShell}>
            <ProductGallery
              images={images}
              videoUrl={videoUrl}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              getImageUrl={getImageUrl}
              productName={currentProduct.name}
              showSingleThumbnail
            />
          </div>
        </div>

        <div className={styles.infoColumn}>
          <div className={styles.infoWrapper}>
            <div className={styles.titleSection}>

              <h1 className={styles.title}>{product.name}</h1>
              {currentProduct?.sku ? (
                <p className={styles.configurableMobileSku}>
                  Mã sản phẩm: <span>{currentProduct.sku}</span>
                </p>
              ) : null}

              <div className={styles.meta}>
                <span className={styles.sku}>SKU: <span className={styles.skuValue}>{currentProduct.sku}</span></span>
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

            {/* Variants Selection */}
            {hasStructuredVariantAttributes ? (
              <div className={styles.variantsCard}>
                {product.super_attributes.map((attr) => {
                  // Filter options that are possible with current selections of OTHER attributes
                  const validOptions = (attr.options || []).filter(opt => {
                    return product.variations?.some(variant => {
                      // Check if this variant matches all OTHER selected options
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

                      return othersMatch && thisMatches;
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
                                  type="button"
                                  onClick={() => handleOptionChoose(attr.code, opt.value)}
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
                              type="button"
                              onClick={() => handleOptionChoose(attr.code, opt.value)}
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

                {isConcreteVariant ? (
                  <div
                    className={styles.variantActionRow}
                    data-variant-action-wrapper="true"
                    data-variant-id={currentProduct.id}
                  >
                    <button
                      type="button"
                      onClick={toggleStructuredVariantActions}
                      className={`${styles.configOptionBtn} ${variantActionId === currentProduct.id ? styles.configOptionBtnActive : ''}`}
                      aria-expanded={variantActionId === currentProduct.id}
                    >
                      {getFallbackVariantLabel(currentProduct)}
                      <span className={styles.variantActionMeta}>{currentProduct.sku}</span>
                    </button>
                    {variantActionId === currentProduct.id ? (
                      <VariantActionPopover
                        variantLabel={getFallbackVariantLabel(currentProduct)}
                        onAddToCart={handleVariantPopupAddToCart}
                        onBuyNow={handleVariantPopupBuyNow}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.variantsCard}>
                <div className={styles.variantGroup}>
                  <h4 className={styles.variantLabel}>Chọn phân loại</h4>
                  <div className={styles.variantList}>
                    {(product.variations || []).map((variant) => {
                      const isActive = currentProduct?.id === variant.id;
                      return (
                        <div
                          key={variant.id}
                          className={styles.variantCardWrap}
                          data-variant-action-wrapper="true"
                          data-variant-id={variant.id}
                        >
                          <button
                            type="button"
                            onClick={() => handleFallbackVariantChoose(variant.id)}
                            className={`${styles.variantCard} ${isActive ? styles.variantCardActive : ''}`}
                            aria-expanded={variantActionId === variant.id}
                          >
                            <div>
                              <div className={styles.variantCardName}>{getFallbackVariantLabel(variant)}</div>
                              <div className={styles.variantCardMeta}>{variant.sku}</div>
                            </div>
                            <div className={styles.variantCardPrice}>{formatPrice(variant.current_price ?? variant.price)}</div>
                          </button>
                          {variantActionId === variant.id ? (
                            <VariantActionPopover
                              variantLabel={getFallbackVariantLabel(variant)}
                              onAddToCart={handleVariantPopupAddToCart}
                              onBuyNow={handleVariantPopupBuyNow}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <SpecificationList product={product} currentProduct={currentProduct} />
            <ActionLinks additionalInfo={additionalInfo} />

            <div className={styles.actionSectionMB}>
              <QuantitySelector
                quantity={quantity}
                setQuantity={setQuantity}
                statusText="Sẵn sàng giao ngay"
              />
              <BuyButtons onAddToCart={handleAddToCart} onBuyNow={handleBuyNow} />
            </div>

            <TrustBadges />
          </div>
        </div>
      </div>
    </div>
  );
}

