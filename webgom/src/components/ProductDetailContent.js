'use client';

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import config from '@/lib/config';
import styles from '../app/product/[slug]/product.module.css';

export default function ProductDetailContent({ product }) {
  const [selectedOptions, setSelectedOptions] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);

  // Initialize selected options
  useEffect(() => {
    if (product?.super_attributes?.length > 0) {
      const initialOptions = {};
      product.super_attributes.forEach(attr => {
        // Try to find the value this main product has for this attribute
        const val = product.attribute_values?.find(av => av.attribute_id === attr.id)?.value;
        if (val) {
          initialOptions[attr.code] = val;
        } else if (attr.options?.length > 0) {
          initialOptions[attr.code] = attr.options[0].value;
        }
      });
      setSelectedOptions(initialOptions);
    }
  }, [product]);

  // Find the matching variant
  const matchingVariant = useMemo(() => {
    if (!product?.variations || product.variations.length === 0) return null;

    return product.variations.find(variant => {
      return Object.entries(selectedOptions).every(([attrCode, selectedValue]) => {
        return variant.attribute_values?.some(av => 
          av.attribute?.code === attrCode && av.value === selectedValue
        );
      });
    });
  }, [product, selectedOptions]);

  const currentProduct = matchingVariant || product;

  // Use variant images if they exist, otherwise use parent images
  const images = useMemo(() => {
    return (currentProduct.images && currentProduct.images.length > 0) 
      ? currentProduct.images 
      : (product.images || []);
  }, [currentProduct, product.images]);

  const getImageUrl = (img) => {
    if (!img) return null;
    if (img.url && img.url.startsWith('http')) return img.url;
    if (img.path && img.path !== 'undefined') {
      const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
      return `${config.storageUrl}/${cleanPath}`;
    }
    return null;
  };

  const activeImage = images[activeIndex] || images[0];

  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  const handleOptionSelect = (attrCode, value) => {
    setSelectedOptions(prev => ({
      ...prev,
      [attrCode]: value
    }));
    setActiveIndex(0); // Reset gallery to first image of the variant
  };

  return (
    <div className={styles.mainGrid}>
      {/* Gallery Column */}
      <div className={styles.galleryColumn}>
        <div className={styles.galleryContainer}>
          <div className={styles.mainImage}>
            {activeImage ? (
              <Image 
                src={getImageUrl(activeImage)}
                alt={currentProduct.name}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
                priority
                unoptimized
              />
            ) : (
              <div className={styles.imagePlaceholder}>
                <span className="material-symbols-outlined" style={{ fontSize: '64px', color: '#ccc' }}>image</span>
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className={styles.thumbnails}>
              {images.slice(0, 4).map((img, idx) => (
                <button 
                  key={img.id || idx} 
                  className={`${styles.thumbBtn} ${idx === activeIndex ? styles.thumbActive : ''}`}
                  onClick={() => setActiveIndex(idx)}
                  type="button"
                >
                  <Image 
                    src={getImageUrl(img)}
                    alt={`${currentProduct.name} thumb ${idx}`}
                    fill
                    sizes="100px"
                    style={{ objectFit: 'cover' }}
                    unoptimized
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Info Column */}
      <div className={styles.infoColumn}>
        <div className={styles.infoWrapper}>
          <div>
            <span className={styles.badge}>Tuyệt Tác Nghệ Nhân</span>
            <h1 className={styles.title}>{currentProduct.name}</h1>
            <div className={styles.meta}>
              <span className={styles.sku}>SKU: <span className={styles.skuValue}>{currentProduct.sku}</span></span>
              <span className={styles.statusDot} style={{ backgroundColor: currentProduct.stock_quantity > 0 ? '#10b981' : '#ef4444' }}></span>
              <span className={styles.statusText} style={{ color: currentProduct.stock_quantity > 0 ? '#059669' : '#dc2626' }}>
                {currentProduct.stock_quantity > 0 ? 'Còn hàng' : 'Hết hàng'}
              </span>
            </div>
          </div>

          <div className={styles.priceCard}>
            <div className={styles.price}>{formatPrice(currentProduct.price)}</div>
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
                            <span style={{ fontSize: '10px', fontWeight: isActive ? '700' : '500', opacity: isActive ? 1 : 0.6 }}>{opt.value}</span>
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
              ))}
            </div>
          )}

          <div className={styles.specCard}>
            <h4 className={styles.specTitle}>
              <span className="material-symbols-outlined">info</span>
              Thông số chi tiết
            </h4>
            <ul className={styles.specList}>
              {currentProduct.specifications && (
                <li className={styles.specItem} style={{ borderBottom: '1px solid rgba(27, 54, 93, 0.1)', paddingBottom: '1rem', marginBottom: '0.5rem', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <span className={styles.specLabel} style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mô tả kỹ thuật</span>
                  <span className={styles.specValue} style={{ whiteSpace: 'pre-line', fontWeight: '500', lineHeight: '1.5' }}>{currentProduct.specifications}</span>
                </li>
              )}
              {currentProduct.attribute_values?.map((attr) => (
                <li key={attr.id} className={styles.specItem}>
                  <span className={styles.specLabel}>{attr.attribute?.name}</span>
                  <span className={styles.specValue}>{attr.value}</span>
                </li>
              ))}
              {/* Fallback specs */}
              {(!currentProduct.attribute_values || currentProduct.attribute_values.length === 0) && !currentProduct.specifications && (
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
              <button 
                className={styles.qBtn}
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <input 
                className={styles.qInput} 
                type="number" 
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              />
              <button 
                className={styles.qBtn}
                onClick={() => setQuantity(quantity + 1)}
              >
                <span className="material-symbols-outlined">add</span>
              </button>
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
  );
}
