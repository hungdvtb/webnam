'use client';

import styles from '../../app/product/[slug]/product.module.css';
import builderStyles from './builder.module.css';
import Image from 'next/image';
import Link from 'next/link';
import ProductGallery from './common/ProductGallery';
import TrustBadges from './common/TrustBadges';
import QuantitySelector from './common/QuantitySelector';
import BuyButtons from './common/BuyButtons';
import SpecificationList from './common/SpecificationList';
import ActionLinks from './common/ActionLinks';
import ComponentSelectionModal from './common/ComponentSelectionModal';
import { useState, useMemo } from 'react';
import Breadcrumb from './common/Breadcrumb';

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
  resetBundleItems,
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
  const subtotal = selectedItems.reduce((acc, it) => acc + (parseFloat(it.price || 0) * (it.qty || 1)), 0);
  const discount = subtotal - displayPrice;

  // Extract unique configurations
  const configurations = useMemo(() => {
    const titles = bundleItems
      .map(item => item.option_title || item.pivot?.option_title || '')
      .filter(title => title !== '');
    return Array.from(new Set(titles));
  }, [bundleItems]);

  const activeConfig = useMemo(() => {
    for (const config of configurations) {
      const itemsInConfig = bundleItems.filter(item => (item.option_title || item.pivot?.option_title) === config);
      if (itemsInConfig.every(item => item.selected)) return config;
    }
    return null;
  }, [bundleItems, configurations]);

  return (
    <>
      <Breadcrumb product={product} />
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
              <div className={styles.titleSection}>
                <h1 className={styles.title}>{product.name}</h1>
                <div className={styles.meta}>
                  <span className={styles.sku}>Mã bộ: <span className={styles.skuValue}>{product.sku || `COMBO-${product.id}`}</span></span>
                  <span className={styles.statusDot} style={{ backgroundColor: '#10b981' }}></span>
                  <span className={styles.statusText} style={{ color: '#059669' }}>Sẵn sàng giao ngay</span>
                </div>
              </div>

              {/* Related Bundles */}
              {(() => {
                const relatedLinks = product.related_products || product.linked_products || [];
                const related = relatedLinks.filter(p => p.pivot?.link_type === 'related' || p.pivot === undefined || !p.pivot);
                const uniqueOptions = Array.from(new Map(related.map(b => [b.id, b])).values());
                if (uniqueOptions.length > 0) {
                  return (
                    <div className={styles.relatedOptionsCard}>
                      <h4 className={styles.relatedOptionsTitle}>
                        <span className={`material-symbols-outlined ${styles.relatedOptionsIcon}`}>view_cozy</span>
                        Lựa Chọn Mẫu Khác
                      </h4>
                      <div className={styles.relatedOptionsGrid}>
                        {uniqueOptions.map(bundle => {
                          const isSelected = bundle.id === product.id;
                          const txt = bundle.pivot?.option_title || bundle.option_title || bundle.bundle_title || bundle.name;
                          const displayImg = bundle.primary_image || bundle.images?.[0] || (bundle.main_image ? { path: bundle.main_image } : null);
                          return (
                            <Link href={`/product/${bundle.slug}`} key={bundle.id}
                              className={`${styles.relatedOptionBtn} ${isSelected ? styles.relatedOptionBtnActive : ''}`}
                              title={bundle.name}
                            >
                              <div className={styles.relatedOptionImgWrap}>
                                {displayImg ? (
                                  <Image src={getImageUrl(displayImg)} alt={txt} fill sizes="30px" unoptimized style={{ objectFit: 'cover' }} />
                                ) : (
                                  <span className={`material-symbols-outlined ${styles.relatedOptionFallback}`}>image</span>
                                )}
                              </div>
                              <span className={`${styles.relatedOptionText} ${isSelected ? styles.relatedOptionTextActive : ''}`}>{txt}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Configuration Selector */}
              {configurations.length > 0 && (
                <div className={styles.configOptionsCard}>
                  {product.bundle_title && (
                    <h4 className={styles.configOptionsTitle}>
                      <span className={`material-symbols-outlined ${styles.relatedOptionsIcon}`}>tune</span>
                      {product.bundle_title}
                    </h4>
                  )}
                  <div className={styles.configOptionsGrid}>
                    {configurations.map(config => (
                      <button key={config} onClick={() => switchBundleConfiguration(config)}
                        className={`${styles.configOptionBtn} ${activeConfig === config ? styles.configOptionBtnActive : ''}`}
                      >
                        {config}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Price */}
              <div className={styles.priceContainer}>
                <div className="flex items-center gap-4">
                  <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
                  {discount > 0 && <span className={styles.originalPrice}>{formatPrice(subtotal)}</span>}
                </div>
                {discount > 0 && <p className={styles.savingsText}>Tiết kiệm {formatPrice(discount)} khi mua trọn bộ</p>}
                <p className={styles.priceMeta}>Số lượng món: {selectedItems.length} | Đã bao gồm phí bảo hiểm vận chuyển</p>
              </div>

              {/* Bundle Summary Card */}
              <div className={styles.specCard}>
                <h4 className={styles.specTitle}>
                  <span className="material-symbols-outlined">view_list</span>
                  Tóm tắt thành phần bộ
                </h4>
                <div className="mt-3">
                  <button
                    onClick={() => document.getElementById('bundle-list')?.scrollIntoView({ behavior: 'smooth' })}
                    className={styles.customizeBundleBtn}
                  >
                    <span className="material-symbols-outlined">tune</span>
                    Xem chi tiết & tùy chỉnh thành phần bên dưới
                  </button>
                </div>
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

        {/* ===== Chi tiết thành phần bộ ===== */}
        <div id="bundle-list" className="mt-16 pt-16 border-t border-stone/10">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-display font-bold text-primary mb-4 italic">Chi tiết thành phần bộ</h2>
            <div className="w-20 h-1 bg-accent mx-auto rounded-full"></div>
            <p className="text-stone/50 mt-4 max-w-2xl mx-auto text-center">
              Quý khách có thể tùy chỉnh số lượng hoặc thay đổi từng món trong bộ để phù hợp với nhu cầu.
            </p>
          </div>

          <div className="max-w-5xl mx-auto mt-8">
            {selectedItems.length > 0 ? (
              <>
                {/* Table header */}
                <div className={builderStyles.tableHeader}>
                  <div className={builderStyles.colStt}>STT</div>
                  <div className={builderStyles.colImg}></div>
                  <div className={builderStyles.colName}>Sản phẩm</div>
                  <div className={builderStyles.colPrice}>Đơn giá</div>
                  <div className={builderStyles.colQty}>Số lượng</div>
                  <div className={builderStyles.colTotal}>Thành tiền</div>
                  <div className={builderStyles.colActions}></div>
                </div>

                {/* Table rows */}
                <div className={builderStyles.tableBody}>
                  {selectedItems.map((item, idx) => {
                    const lineTotal = parseFloat(item.price || 0) * (item.qty || 1);
                    return (
                      <div key={item.id} className={builderStyles.tableRow}>
                        {/* STT */}
                        <div className={builderStyles.colStt}>
                          <span className={builderStyles.sttBadge}>{idx + 1}</span>
                        </div>

                        {/* Image */}
                        <div className={builderStyles.colImg}>
                          <div className={builderStyles.tableImgWrap}>
                            <Image
                              src={getImageUrl(item.images?.[0] || item.primary_image || { path: item.main_image })}
                              alt={item.name}
                              fill
                              style={{ objectFit: 'cover' }}
                              unoptimized
                            />
                          </div>
                        </div>

                        {/* Name */}
                        <div className={builderStyles.colName}>
                          <p className={builderStyles.itemName}>{item.name}</p>
                          {item.sku && <span className={builderStyles.variantHint}>SKU: {item.sku}</span>}
                          {item.option_title && <span className={builderStyles.configBadge}>{item.option_title}</span>}
                        </div>

                        {/* Unit price */}
                        <div className={builderStyles.colPrice}>
                          <span className={builderStyles.unitPrice}>{formatPrice(item.price)}</span>
                        </div>

                        {/* Qty +/- */}
                        <div className={builderStyles.colQty}>
                          <div className={builderStyles.qtyControl}>
                            <button
                              className={builderStyles.qtyBtn}
                              onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) - 1)}
                              disabled={(item.qty || 1) <= 1}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove</span>
                            </button>
                            <span className={builderStyles.qtyDisplay}>{item.qty || 1}</span>
                            <button
                              className={builderStyles.qtyBtn}
                              onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) + 1)}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                            </button>
                          </div>
                        </div>

                        {/* Line total */}
                        <div className={builderStyles.colTotal}>
                          <span className={builderStyles.lineTotal}>{formatPrice(lineTotal)}</span>
                        </div>

                        {/* Actions */}
                        <div className={builderStyles.colActions}>
                          <button className={builderStyles.changeBtn} onClick={() => openSelectionModal(item)} title="Thay đổi sản phẩm">
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>swap_horiz</span>
                            Thay đổi
                          </button>
                          {!item.pivot?.is_required && (
                            <button className={builderStyles.deleteBtn} onClick={() => removeBundleItem(item.id)} title="Xóa khỏi combo">
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Summary footer */}
                <div className={builderStyles.tableFooter}>
                  <div className={builderStyles.footerLeft}>
                    {resetBundleItems && (
                      <button className={builderStyles.resetBtn} onClick={resetBundleItems}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restart_alt</span>
                        Khôi phục mặc định
                      </button>
                    )}
                  </div>
                  <div className={builderStyles.footerRight}>
                    <div className={builderStyles.summaryRow}>
                      <span className={builderStyles.summaryLabel}>Tổng {selectedItems.length} món:</span>
                      <span className={builderStyles.summarySubtotal}>{formatPrice(subtotal)}</span>
                    </div>
                    {discount > 0 && (
                      <div className={builderStyles.summaryRow}>
                        <span className={builderStyles.summaryLabelDiscount}>Giảm giá combo:</span>
                        <span className={builderStyles.summaryDiscount}>- {formatPrice(discount)}</span>
                      </div>
                    )}
                    <div className={`${builderStyles.summaryRow} ${builderStyles.grandTotalRow}`}>
                      <span className={builderStyles.grandTotalLabel}>Tổng thanh toán:</span>
                      <span className={builderStyles.grandTotal}>{formatPrice(displayPrice)}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-20 bg-stone/5 rounded-3xl border border-dashed border-stone/20">
                <span className="material-symbols-outlined text-4xl text-stone/20 mb-4">inventory_2</span>
                <p className="text-stone/40 italic mb-4">Chưa có thành phần nào được chọn trong bộ.</p>
                {resetBundleItems && (
                  <button className={builderStyles.resetBtn} onClick={resetBundleItems}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>restart_alt</span>
                    Khôi phục mặc định
                  </button>
                )}
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
    </>
  );
}
