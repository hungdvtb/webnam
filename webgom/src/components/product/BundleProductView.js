'use client';

import styles from '../../app/product/[slug]/product.module.css';
import builderStyles from './builder.module.css';
import Image from 'next/image';
import ProductGallery from './common/ProductGallery';
import TrustBadges from './common/TrustBadges';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import ComponentSelectionModal from './common/ComponentSelectionModal';
import { useState } from 'react';

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
  updateBundleItemProduct,
  removeBundleItem,
  handleAddToCart,
  handleBuyNow,
  quantity,
  setQuantity,
  additionalInfo
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);

  const openSelectionModal = (slot) => {
    setActiveSlot(slot);
    setIsModalOpen(true);
  };

  const handleSelectComponent = (newProduct) => {
    if (activeSlot) {
      updateBundleItemProduct(activeSlot.id, newProduct);
    }
    setIsModalOpen(false);
  };

  const selectedItems = bundleItems.filter(item => item.selected);
  const subtotal = selectedItems.reduce((acc, it) => acc + (parseFloat(it.price) * (it.qty || 1)), 0);
  const discount = subtotal - displayPrice;

  return (
    <div className="flex flex-col gap-12">
      <div className={styles.mainGrid}>
        {/* Gallery Column */}
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

        {/* Info Column */}
        <div className={styles.infoColumn}>
          <div className={styles.infoWrapper}>
            <div>
              <span className={styles.badgeTag}>Product Combo / Bộ đồ thờ</span>
              <h1 className={styles.title}>{product.name}</h1>
              
              <div className={styles.meta}>
                <span className={styles.sku}>Mã bộ: <span className={styles.skuValue}>{product.sku || `COMBO-${product.id}`}</span></span>
                <span className={styles.statusDot} style={{ backgroundColor: '#10b981' }}></span>
                <span className={styles.statusText} style={{ color: '#059669' }}>Sẵn sàng giao ngay</span>
              </div>
            </div>

            <div className={styles.priceContainer}>
              <div className="flex items-center gap-4">
                <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
                {discount > 0 && (
                  <span className={styles.originalPrice}>{formatPrice(subtotal)}</span>
                )}
              </div>
              {discount > 0 && (
                <p className={styles.savingsText}>
                  Tiết kiệm {formatPrice(discount)} khi mua trọn bộ
                </p>
              )}
              <p className={styles.priceMeta}>Số lượng món: {selectedItems.length} | Đã bao gồm phí bảo hiểm vận chuyển</p>
            </div>

            {/* Bundle Components Preview (Compact) */}
            <div className={styles.variantsCard}>
              <h4 className={styles.variantLabel}>Tóm tắt thành phần bộ</h4>
              <div className="flex flex-wrap gap-2 py-2">
                {selectedItems.slice(0, 5).map(item => (
                  <div key={item.id} className="text-[11px] bg-stone/5 px-2 py-1 rounded border border-stone/10 text-primary flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px] text-accent">check_circle</span>
                    {item.name} (x{item.qty})
                  </div>
                ))}
                {selectedItems.length > 5 && (
                  <div className="text-[11px] bg-stone/5 px-2 py-1 rounded border border-stone/10 text-stone/40">
                    +{selectedItems.length - 5} vật phẩm khác...
                  </div>
                )}
              </div>
              <button 
                onClick={() => document.getElementById('bundle-list')?.scrollIntoView({ behavior: 'smooth' })}
                className="text-[11px] text-accent font-bold mt-2 hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">visibility</span>
                Xem chi tiết & tùy chỉnh thành phần bên dưới
              </button>
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

      {/* 2. COMPONENT LIST SECTION (The specific bundle part) */}
      <section id="bundle-list" className={styles.componentSection}>
        <div className={styles.sectionHeading}>
          <h3 className={styles.sectionTitle}>Chi Tiết Thành Phần Bộ</h3>
          <div className={styles.sectionLine}></div>
          <p className="text-stone/50 mt-4 max-w-2xl mx-auto text-center">
            Quý khách có thể tùy chỉnh số lượng hoặc thay đổi từng món trong bộ để phù hợp với nhu cầu.
          </p>
        </div>

        <div className="max-w-5xl mx-auto flex flex-col gap-6 mt-12">
          {selectedItems.length > 0 ? (
            selectedItems.map((item, idx) => (
              <div key={item.id} className={builderStyles.slotCard}>
                <div className={builderStyles.slotIndex}>{idx + 1}</div>
                
                <div className={builderStyles.slotImg}>
                   <Image 
                      src={getImageUrl(item.images?.[0] || item.primary_image || { path: item.main_image })}
                      alt={item.name}
                      fill
                      style={{ objectFit: 'cover' }}
                      unoptimized
                    />
                </div>

                <div className={builderStyles.slotDetails}>
                    <div className="flex flex-wrap gap-2 mb-2">
                       {item.option_title && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-[#c5a065] bg-[#c5a06512] px-2 py-0.5 rounded border border-[#c5a06533]">
                            {item.option_title}
                          </span>
                       )}
                       {item.type === 'configurable' && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-[#1b365d] bg-[#1b365d12] px-2 py-0.5 rounded border border-[#1b365d33]">
                            Tùy chỉnh biến thể
                          </span>
                       )}
                    </div>
                    <h4>{item.name}</h4>
                    <span className={builderStyles.slotPrice}>{formatPrice(item.price)}</span>
                    <p className="text-[10px] text-stone/40 uppercase mt-2">SKU: {item.sku}</p>
                </div>

                <div className={builderStyles.slotActions}>
                    <div className={builderStyles.qtyRow}>
                       <button className={builderStyles.qtyBtn} onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) - 1)} disabled={(item.qty || 1) <= 1}>
                          <span className="material-symbols-outlined text-[18px]">remove</span>
                       </button>
                       <input className={builderStyles.qtyInput} type="text" readOnly value={item.qty || 1} />
                       <button className={builderStyles.qtyBtn} onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) + 1)}>
                          <span className="material-symbols-outlined text-[18px]">add</span>
                       </button>
                    </div>

                    <div className="flex gap-2">
                       <button className={builderStyles.actionBtn} onClick={() => openSelectionModal(item)}>
                          <span className="material-symbols-outlined text-[18px]">cached</span>
                          Thay đổi
                       </button>
                       {!item.pivot?.is_required && (
                          <button 
                             onClick={() => removeBundleItem(item.id)}
                             className="size-10 flex items-center justify-center rounded-xl border border-stone/10 text-stone/20 hover:text-red-500 transition-colors"
                          >
                             <span className="material-symbols-outlined">delete</span>
                          </button>
                        )}
                    </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-20 text-center bg-white rounded-3xl border border-stone/10 border-dashed">
               <span className="material-symbols-outlined text-stone/20 text-7xl mb-4">inventory_2</span>
               <p className="text-stone/40 font-bold uppercase tracking-widest">Bộ sản phẩm trống</p>
            </div>
          )}
        </div>
        
        {/* SUMMARY BOX */}
        <div className={styles.summaryBox}>
          <div className={styles.summaryCol}>
            <p className={styles.summaryLabel}>Tạm Tính Bộ</p>
            <p className={styles.summaryValue}>{formatPrice(subtotal)}</p>
          </div>
          <div className={`${styles.summaryCol} ${styles.summaryColAccent}`}>
            <p className={styles.summaryLabel}>Ưu Đãi Đặc Biệt</p>
            <p className={`${styles.summaryValue} ${styles.summaryValueAccent}`}>
              {discount > 0 ? `- ${formatPrice(discount)}` : 'Giá cực hấp dẫn'}
            </p>
          </div>
          <div className={styles.summaryCol}>
            <p className={styles.summaryLabel}>Tổng Cộng Bộ</p>
            <p className={styles.summaryValueTotal}>
              {formatPrice(displayPrice)}
            </p>
          </div>
        </div>

        <div className="mt-12 flex justify-center">
             <button className={`${styles.btnBundle} ${styles.btnBundlePrimary}`} onClick={handleAddToCart} style={{ maxWidth: '440px' }}>
                <span className="material-symbols-outlined">add_shopping_cart</span>
                Thêm toàn bộ {selectedItems.length} món vào giỏ hàng
             </button>
        </div>
      </section>

      <ComponentSelectionModal 
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            onSelect={handleSelectComponent}
            currentSlot={activeSlot}
            getImageUrl={getImageUrl}
            formatPrice={formatPrice}
      />
    </div>
  );
}
