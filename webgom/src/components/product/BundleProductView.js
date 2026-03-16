'use client';

import { useState } from 'react';
import styles from '../../app/product/[slug]/product.module.css';
import Image from 'next/image';
import Link from 'next/link';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';

export default function BundleProductView({ 
  product, 
  displayPrice, 
  formatPrice, 
  getImageUrl,
  images,
  videoUrl,
  activeIndex,
  setActiveIndex,
  bundleItems,
  updateBundleItemQuantity,
  removeBundleItem,
  toggleBundleItem,
  handleAddToCart,
  handleBuyNow,
  additionalInfo
}) {
  const [swappingGroup, setSwappingGroup] = useState(null);

  // Group ALL items by option_title (for swapping)
  const allGroups = bundleItems.reduce((acc, item) => {
    const groupName = item.option_title || item.pivot?.option_title || item.category?.name || 'Thành phần mặc định';
    if (!acc[groupName]) acc[groupName] = [];
    acc[groupName].push(item);
    return acc;
  }, {});

  // Selected items only
  const selectedItems = bundleItems.filter(item => item.selected);
  
  const subtotal = bundleItems.filter(it => it.selected).reduce((acc, it) => acc + (parseFloat(it.price) * (it.qty || 1)), 0);
  const discount = subtotal - displayPrice;

  return (
    <div className={styles.productDetail}>
      {/* 1. HERO SECTION */}
      <section className={styles.bundleHero}>
        {/* Gallery Column */}
        <div className={styles.bundleGallery}>
          <div className={styles.mainDisplay}>
            {images[activeIndex] ? (
              <Image 
                src={getImageUrl(images[activeIndex])}
                alt={product.name}
                fill
                style={{ objectFit: 'cover' }}
                className="transition-transform duration-700 hover:scale-110"
                unoptimized
              />
            ) : (
              <div className="w-full h-full bg-stone/5 flex items-center justify-center">
                <span className="material-symbols-outlined text-4xl text-stone/20">image</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-primary/40 to-transparent"></div>
          </div>
          
          <div className={styles.bundleThumbs}>
            {images.slice(0, 3).map((img, idx) => (
              <div 
                key={idx} 
                className={`${styles.thumbItem} ${activeIndex === idx ? styles.thumbItemActive : ''}`}
                onClick={() => setActiveIndex(idx)}
              >
                <Image 
                  src={getImageUrl(img)}
                  alt={`${product.name} ${idx + 1}`}
                  fill
                  style={{ objectFit: 'cover' }}
                  unoptimized
                />
              </div>
            ))}
            {images.length > 3 && (
              <div className={`${styles.thumbItem} ${styles.thumbMore}`}>
                +{images.length - 3}
              </div>
            )}
          </div>
        </div>

        {/* Info Column */}
        <div className={`${styles.bundleInfo} flex flex-col gap-6`}>
          <div>
            <span className={styles.collectionBadge}>Imperial Artisan Collection</span>
            <h1 className={styles.bundleTitle}>{product.name}</h1>
            <div className={styles.bundlePriceRow}>
              <p className={styles.bundlePrice}>Từ {formatPrice(displayPrice)}</p>
              {discount > 0 && (
                <span className={styles.bundleOldPrice}>{formatPrice(subtotal)}</span>
              )}
            </div>
            
            <div className="mt-6 pt-4 border-t border-stone/10">
              <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2 tracking-wider">
                <span className="material-symbols-outlined text-accent text-sm">description</span>
                THÔNG SỐ KỸ THUẬT
              </h3>
              <SpecificationList product={product} />
            </div>

            <div className={styles.bundleQuote}>
              "Gói trọn tinh hoa gốm sứ Đại Việt, mang lại sự trang trọng và hưng thịnh cho không gian thờ tự của gia đình."
            </div>
          </div>

          {/* Style Choice (Stubbed logic based on design) */}
          <div className={styles.styleChoice}>
            <p className={styles.choiceLabel}>
              <span className="material-symbols-outlined text-accent">palette</span>
              CHỌN PHONG CÁCH MEN:
            </p>
            <div className={styles.choiceGrid}>
              <div className={`${styles.choiceItem} ${styles.choiceItemActive}`}>
                <span className={styles.choiceTitle}>Bộ Men Rạn</span>
                <span className={styles.choiceSub}>Cổ kính & Trang nghiêm</span>
              </div>
              <div className={styles.choiceItem}>
                <span className={styles.choiceTitle}>Bộ Vẽ Vàng</span>
                <span className={styles.choiceSub}>Sang trọng & Quyền quý</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className={styles.actionGrid}>
            <button className={`${styles.btnBundle} ${styles.btnBundlePrimary}`} onClick={handleAddToCart}>
              <span className="material-symbols-outlined">add_shopping_cart</span>
              Thêm cả bộ vào giỏ
            </button>
            <button className={`${styles.btnBundle} ${styles.btnBundleAccent}`} onClick={handleBuyNow}>
              <span className="material-symbols-outlined">shopping_bag</span>
              Đặt hàng ngay
            </button>
            <button className={`${styles.btnBundle} ${styles.btnBundleOutline}`} onClick={() => document.getElementById('bundle-list')?.scrollIntoView({ behavior: 'smooth' })}>
              <span className="material-symbols-outlined">list_alt</span>
              Xem thành phần bộ
            </button>
          </div>

          {/* Trust Badges */}
          <div className={styles.badgeGrid}>
            <div className={styles.badgeItem}>
              <span className="material-symbols-outlined text-accent">verified</span>
              <span className={styles.badgeLabel}>BẢO HÀNH 30 NĂM</span>
            </div>
            <div className={styles.badgeItem}>
              <span className="material-symbols-outlined text-accent">local_shipping</span>
              <span className={styles.badgeLabel}>MIỄN PHÍ GIAO HÀNG</span>
            </div>
            <div className={styles.badgeItem}>
              <span className="material-symbols-outlined text-accent">eco</span>
              <span className={styles.badgeLabel}>GỐM SẠCH 100%</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. KNOWLEDGE & GUIDANCE SECTION (ActionLinks) */}
      <div className="mb-12">
         <ActionLinks additionalInfo={additionalInfo} />
      </div>

      {/* 3. COMPONENT LIST SECTION */}
      <section id="bundle-list" className={styles.componentSection}>
        <div className={styles.sectionHeading}>
          <h3 className={styles.sectionTitle}>Chi Tiết Thành Phần Bộ</h3>
          <div className={styles.sectionLine}></div>
        </div>

        <div className={styles.componentGrid}>
          {selectedItems.map((item) => (
            <div key={item.id} className={styles.itemCard}>
              <div className={styles.itemImage}>
                <Image 
                  src={getImageUrl(item.images?.[0] || item.primary_image)}
                  alt={item.name}
                  fill
                  style={{ objectFit: 'cover' }}
                  unoptimized
                />
              </div>
              <div className={styles.itemDetails}>
                <div>
                  <h4 className={styles.itemName}>{item.name}</h4>
                  <p className={styles.itemSku}>SKU: {item.sku || `DSGV-P-${item.id}`}</p>
                </div>
                <div className={styles.itemBottom}>
                  <div className={styles.miniQty}>
                    <button className={styles.miniBtn} onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) - 1)}>-</button>
                    <input className={styles.miniInput} type="text" readOnly value={String(item.qty || 1).padStart(2, '0')} />
                    <button className={styles.miniBtn} onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) + 1)}>+</button>
                  </div>
                  <p className={styles.itemPrice}>{formatPrice(item.price)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-stone/40 italic text-sm mt-8">
          Bộ sản phẩm bao gồm đầy đủ {selectedItems.length} món vật phẩm thờ tự cao cấp cho ban thờ gia tiên.
        </p>

        {/* 3. DESCRIPTION SECTION */}
        <div className="mt-20 bg-white rounded-xl p-8 border border-stone/10 shadow-sm">
          <h4 className="text-2xl font-bold text-primary mb-6 flex items-center gap-2">
            <span className="material-symbols-outlined text-accent">info</span>
            Mô tả bộ sản phẩm
          </h4>
          <div 
            className="prose max-w-none text-stone/80 leading-relaxed font-body"
            dangerouslySetInnerHTML={{ __html: product.description || 'Đang cập nhật nội dung...' }}
          />
        </div>

        {/* 4. SUMMARY BOX */}
        <div className={styles.summaryBox}>
          <div className={styles.summaryCol}>
            <p className={styles.summaryLabel}>Tạm Tính</p>
            <p className={styles.summaryValue}>{formatPrice(subtotal)}</p>
          </div>
          <div className={`${styles.summaryCol} ${styles.summaryColAccent}`}>
            <p className={styles.summaryLabel}>Ưu Đãi Combo</p>
            <p className={`${styles.summaryValue} ${styles.summaryValueAccent}`}>
              {discount > 0 ? `- ${formatPrice(discount)}` : 'Đã kèm ưu đãi'}
            </p>
          </div>
          <div className={styles.summaryCol}>
            <p className={styles.summaryLabel}>Tổng Cộng Bộ</p>
            <p className={styles.summaryValueTotal}>
              {formatPrice(discount > 0 ? displayPrice : subtotal)}
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}
