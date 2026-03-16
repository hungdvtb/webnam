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
import { useState, useMemo } from 'react';

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
  switchBundleConfiguration,
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

  // Extract unique configurations
  const configurations = useMemo(() => {
    const titles = bundleItems
      .map(item => item.option_title || item.pivot?.option_title || '')
      .filter(title => title !== '');
    return Array.from(new Set(titles));
  }, [bundleItems]);

  const activeConfig = useMemo(() => {
    // A config is "active" if all items in it are selected
    for (const config of configurations) {
      const itemsInConfig = bundleItems.filter(item => (item.option_title || item.pivot?.option_title) === config);
      if (itemsInConfig.every(item => item.selected)) return config;
    }
    return null;
  }, [bundleItems, configurations]);

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

            {/* Configuration Selector */}
            {configurations.length > 0 && (
              <div className="bg-stone/5 p-4 rounded-2xl border border-stone/10">
                {product.bundle_title && (
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-stone/40 mb-3">{product.bundle_title}</h4>
                )}
                <div className="flex flex-wrap gap-2">
                  {configurations.map(config => (
                    <button
                      key={config}
                      onClick={() => switchBundleConfiguration(config)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${activeConfig === config
                          ? 'bg-accent border-accent text-white shadow-lg shadow-accent/20 scale-105'
                          : 'bg-white border-stone/10 text-stone hover:border-accent/30'
                        }`}
                    >
                      {config}
                    </button>
                  ))}
                </div>
              </div>
            )}

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

      {/* Slots Section */}
      <div id="bundle-list" className="mt-16 pt-16 border-t border-stone/10">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-display font-bold text-primary mb-4 italic">Chi tiết thành phần bộ</h2>
          <div className="w-20 h-1 bg-accent mx-auto rounded-full"></div>
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
                  <h4>{item.name}</h4>
                </div>

                <div className={builderStyles.slotPriceFormula}>
                  <div className="flex items-center flex-nowrap whitespace-nowrap gap-1.5">
                    <span className="text-[15px] font-black text-stone/40">
                      {formatPrice(item.price)}
                    </span>
                    <span className="text-[14px] font-black text-stone/20">×</span>
                    <input 
                      type="number" 
                      min="1"
                      value={item.qty || 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        updateBundleItemQuantity(item.id, Math.max(1, val));
                      }}
                      className={builderStyles.qtyFormulaInput}
                    />
                    <span className="text-[15px] font-black text-stone/40">=</span>
                    <span className="text-[15px] font-black text-[#c5a065]">
                      {formatPrice(parseFloat(item.price) * (item.qty || 1))}
                    </span>
                  </div>
                </div>

                <div className={builderStyles.slotActions}>
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
            <div className="text-center py-20 bg-stone/5 rounded-3xl border border-dashed border-stone/20">
              <span className="material-symbols-outlined text-4xl text-stone/20 mb-4">inventory_2</span>
              <p className="text-stone/40 italic">Chưa có thành phần nào được chọn trong bộ.</p>
            </div>
          )}
        </div>
      </div>

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
