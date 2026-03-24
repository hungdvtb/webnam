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
import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Breadcrumb from './common/Breadcrumb';

function BundleActionPopup({
  configName,
  onClose,
  onViewDetails,
  onAddToCart,
  onBuyNow
}) {
  useEffect(() => {
    if (!configName || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [configName, onClose]);

  if (!configName || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className={styles.bundleActionOverlay} onClick={onClose}>
      <div className={styles.bundleActionModal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.bundleActionHeader}>
          <div>
            <p className={styles.bundleActionEyebrow}>Chọn cấu hình bộ</p>
            <h3 className={styles.bundleActionTitle}>{configName}</h3>
          </div>
          <button type="button" onClick={onClose} className={styles.bundleActionClose} aria-label="Đóng popup cấu hình bộ">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className={styles.bundleActionBody}>
          <button type="button" onClick={onViewDetails} className={styles.bundleActionTop}>
            <span className="material-symbols-outlined">tune</span>
            Xem chi tiết và tùy chỉnh thành phần bộ
          </button>

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
    </div>,
    document.body
  );
}

function BundleActionCard({
  configName,
  onViewDetails,
  onAddToCart,
  onBuyNow,
  compact = false
}) {
  if (!configName) {
    return null;
  }

  return (
    <div className={`${styles.bundleActionContent} ${compact ? styles.bundleActionContentCompact : ''}`}>
      <p className={styles.bundleActionEyebrow}>Chá»n cáº¥u hÃ¬nh bá»™</p>
      <h3 className={styles.bundleActionTitle}>{configName}</h3>
      <button type="button" onClick={onViewDetails} className={styles.bundleActionTop}>
        <span className="material-symbols-outlined">tune</span>
        Xem chi tiáº¿t vÃ  tÃ¹y chá»‰nh thÃ nh pháº§n bá»™
      </button>
      <div className={styles.bundleActionGrid}>
        <button type="button" onClick={onAddToCart} className={styles.bundleActionPrimary}>
          <span className="material-symbols-outlined">add_shopping_cart</span>
          ThÃªm vÃ o giá»
        </button>
        <button type="button" onClick={onBuyNow} className={styles.bundleActionSecondary}>
          <span className="material-symbols-outlined">shopping_bag</span>
          Mua ngay
        </button>
      </div>
    </div>
  );
}

function InlineBundleActionPopover({ configName, onViewDetails, onAddToCart, onBuyNow }) {
  if (!configName) {
    return null;
  }

  return (
    <div className={styles.bundleActionPopover}>
      <div className={styles.bundleActionContent}>
        <p className={styles.bundleActionEyebrow}>Chọn cấu hình bộ</p>
        <h3 className={styles.bundleActionTitle}>{configName}</h3>
        <button type="button" onClick={onViewDetails} className={styles.bundleActionTop}>
          <span className="material-symbols-outlined">tune</span>
          Xem chi tiết và tùy chỉnh thành phần bộ
        </button>
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

function MobileBundleActionPopover({ configName, onViewDetails, onAddToCart, onBuyNow }) {
  if (!configName) {
    return null;
  }

  return (
    <div
      className={styles.bundleActionMobileDock}
      data-bundle-config-wrapper="true"
      data-config-name={configName}
    >
      <div className={`${styles.bundleActionContent} ${styles.bundleActionContentCompact}`}>
        <p className={styles.bundleActionEyebrow}>{'Ch\u1ECDn c\u1EA5u h\u00ECnh b\u1ED9'}</p>
        <h3 className={styles.bundleActionTitle}>{configName}</h3>
        <button type="button" onClick={onViewDetails} className={styles.bundleActionTop}>
          <span className="material-symbols-outlined">tune</span>
          <span className={styles.bundleActionTopText}>
            <span>{'Xem chi tiết'}</span>
            <span>{'& tùy chỉnh thành phần bộ'}</span>
          </span>
        </button>
        <div className={styles.bundleActionGrid}>
          <button type="button" onClick={onAddToCart} className={styles.bundleActionPrimary}>
            <span className="material-symbols-outlined">add_shopping_cart</span>
            {'Th\u00EAm v\u00E0o gi\u1ECF'}
          </button>
          <button type="button" onClick={onBuyNow} className={styles.bundleActionSecondary}>
            <span className="material-symbols-outlined">shopping_bag</span>
            {'Mua ngay'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  restoreBundleItem,
  switchBundleConfiguration,
  resetBundleItems,
  handleAddToCart,
  handleAddBundleConfig,
  handleBuyNow,
  handleBuyTabConfig,
  handleBuyBundleConfig,
  quantity,
  setQuantity,
  additionalInfo
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState(null);
  const [bundleActionConfig, setBundleActionConfig] = useState('');
  const [hoveredBundleConfig, setHoveredBundleConfig] = useState('');
  const [isMobileBundleViewport, setIsMobileBundleViewport] = useState(false);
  // Active tab in the detail section (separate from upper config selector)
  const [activeTab, setActiveTab] = useState(null);

  const bundleMobileGalleryImages = useMemo(() => {
    const sourceImages = Array.isArray(images) ? images : [];
    const seenSources = new Set();

    const isRenderableGallerySource = (value) => {
      const normalized = String(value || '').trim();

      if (!normalized || normalized === '/' || normalized === '#' || /^javascript:/i.test(normalized)) {
        return false;
      }

      if (normalized.includes('placehold.co/800')) {
        return false;
      }

      return true;
    };

    const cleanedImages = sourceImages.filter((image) => {
      const resolvedSource = getImageUrl(image);

      if (!isRenderableGallerySource(resolvedSource) || seenSources.has(resolvedSource)) {
        return false;
      }

      seenSources.add(resolvedSource);
      return true;
    });

    return cleanedImages.length > 0 ? cleanedImages : sourceImages;
  }, [getImageUrl, images]);

  const getCompactConfigLabel = (configName) => {
    const normalized = String(configName || '').replace(/\s+/g, ' ').trim();
    const shortened = normalized
      .replace(/^b(?:a|à)n\s*th(?:o|ờ)\s*/i, '')
      .replace(/^k(?:i|í)ch\s*th(?:u|ư)ớc\s*/i, '')
      .replace(/^size\s*/i, '')
      .trim();

    return shortened || normalized;
  };

  // Extract unique configurations (tabs)
  const configurations = useMemo(() => {
    const titles = bundleItems
      .map(item => item.option_title || item.pivot?.option_title || '')
      .filter(title => title !== '');
    return Array.from(new Set(titles));
  }, [bundleItems]);

  // Initialise activeTab to first config
  useEffect(() => {
    if (configurations.length > 0 && !activeTab) {
      setActiveTab(configurations[0]);
    }
  }, [configurations, activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncViewport = () => setIsMobileBundleViewport(mediaQuery.matches);

    syncViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport);
      return () => mediaQuery.removeEventListener('change', syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  // Items of the active tab (including removed ones for placeholder)
  const tabItems = useMemo(() => {
    if (!activeTab) return bundleItems.filter(i => !i.option_title);
    return bundleItems.filter(i => (i.option_title || i.pivot?.option_title) === activeTab);
  }, [bundleItems, activeTab]);

  // Original tab items from product data (for full-combo check)
  const originalTabItems = useMemo(() => {
    const src = product.bundle_items || product.grouped_items || [];
    if (!activeTab) return src.filter(i => !i.option_title && !i.pivot?.option_title);
    return src.filter(i => (i.option_title || i.pivot?.option_title) === activeTab);
  }, [product, activeTab]);

  // Is full combo? All tab items present and qty >= default qty
  const isFullCombo = useMemo(() => {
    if (tabItems.length === 0) return false;
    return tabItems.every(item => {
      if (item.removed) return false;
      const origItem = originalTabItems.find(o => o.id === item.id);
      const defaultQty = origItem?.pivot?.quantity || 1;
      return (item.qty || 1) >= defaultQty;
    });
  }, [tabItems, originalTabItems]);

  // Subtotal of tab items (active items only)
  const tabSubtotal = useMemo(() =>
    tabItems
      .filter(i => !i.removed)
      .reduce((acc, i) => acc + parseFloat(i.price || 0) * (i.qty || 1), 0),
    [tabItems]
  );

  // Full combo subtotal (sum of all tab items at their default qty × price)
  const fullComboSubtotal = useMemo(() =>
    tabItems.reduce((acc, i) => {
      const origItem = originalTabItems.find(o => o.id === i.id);
      const defaultQty = origItem?.pivot?.quantity || 1;
      return acc + parseFloat(i.price || 0) * defaultQty;
    }, 0),
    [tabItems, originalTabItems]
  );

  const DISCOUNT_RATE = 0.10;
  const tabDiscountAmount = isFullCombo ? Math.round(tabSubtotal * DISCOUNT_RATE) : 0;
  const tabFinalPrice = tabSubtotal - tabDiscountAmount;

  // For upper info section: selectedItems (all configs) for top-level displayPrice
  const selectedItems = bundleItems.filter(item => item.selected && !item.removed);
  const subtotal = selectedItems.reduce((acc, it) => acc + (parseFloat(it.price || 0) * (it.qty || 1)), 0);

  // Use global displayPrice from parent (already computed from all selected items)
  const infoDiscount = subtotal - displayPrice;

  // activeConfig for the upper config buttons
  const activeConfig = useMemo(() => {
    for (const config of configurations) {
      const itemsInConfig = bundleItems.filter(item => (item.option_title || item.pivot?.option_title) === config);
      if (itemsInConfig.every(item => item.selected && !item.removed)) return config;
    }
    return null;
  }, [bundleItems, configurations]);

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

  // Handle tab change: update bundleItems selection state
  const handleTabChange = (tabName) => {
    setActiveTab(tabName);
    if (switchBundleConfiguration) switchBundleConfiguration(tabName);
  };

  const activeBundlePopover = bundleActionConfig || (!isMobileBundleViewport ? hoveredBundleConfig : '');

  useEffect(() => {
    if (!bundleActionConfig) return undefined;

    const handlePointerDown = (event) => {
      const wrapper = event.target.closest('[data-bundle-config-wrapper="true"]');
      if (!wrapper || wrapper.dataset.configName !== bundleActionConfig) {
        setBundleActionConfig('');
        setHoveredBundleConfig('');
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setBundleActionConfig('');
        setHoveredBundleConfig('');
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
  }, [bundleActionConfig]);

  const handleBundleMouseEnter = (configName) => {
    if (!isMobileBundleViewport && !bundleActionConfig) {
      setHoveredBundleConfig(configName);
    }
  };

  const handleBundleMouseLeave = (configName) => {
    if (!isMobileBundleViewport && !bundleActionConfig && hoveredBundleConfig === configName) {
      setHoveredBundleConfig('');
    }
  };

  const handleOpenBundleActions = (configName) => {
    handleTabChange(configName);

    if (isMobileBundleViewport) {
      setHoveredBundleConfig('');
      setBundleActionConfig((currentConfig) => currentConfig === configName ? '' : configName);
      return;
    }

    setHoveredBundleConfig(configName);
    setBundleActionConfig((currentConfig) => currentConfig === configName ? '' : configName);
  };

  const closeBundleActions = () => {
    setBundleActionConfig('');
    setHoveredBundleConfig('');
  };

  const handleViewBundleDetails = () => {
    if (activeBundlePopover) {
      handleTabChange(activeBundlePopover);
    }
    closeBundleActions();
    document.getElementById('bundle-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handlePopupAddToCart = (event) => {
    if (!activeBundlePopover || !handleAddBundleConfig) return;
    handleAddBundleConfig(activeBundlePopover, event);
    closeBundleActions();
  };

  const handlePopupBuyNow = () => {
    if (!activeBundlePopover || !handleBuyBundleConfig) return;
    handleBuyBundleConfig(activeBundlePopover);
    closeBundleActions();
  };

  return (
    <div className={styles.bundleView}>
      <div className={styles.bundleBreadcrumb}>
        <Breadcrumb product={product} />
      </div>
      <div className="flex flex-col gap-12">
        <div className={styles.mainGrid}>
          {/* Gallery */}
          <div className={styles.galleryColumn}>
            <div className={styles.bundleGalleryDesktopOnly}>
              <ProductGallery
                images={images}
                videoUrl={videoUrl}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                getImageUrl={getImageUrl}
                productName={product.name}
              />
            </div>

            <div className={`${styles.bundleGalleryMobileOnly} ${styles.configurableMediaShell}`}>
              <ProductGallery
                images={bundleMobileGalleryImages}
                videoUrl={videoUrl}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                getImageUrl={getImageUrl}
                productName={product.name}
                showSingleThumbnail
              />
            </div>
          </div>

          {/* Info */}
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

              {/* Related bundles */}
              {(() => {
                const relatedLinks = product.related_products || product.linked_products || [];
                const related = relatedLinks.filter(p => p.pivot?.link_type === 'related' || p.pivot === undefined || !p.pivot);
                const uniqueOptions = Array.from(new Map(related.map(b => [b.id, b])).values());
                if (uniqueOptions.length === 0) return null;
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
                              {displayImg
                                ? <Image src={getImageUrl(displayImg)} alt={txt} fill sizes="30px" unoptimized style={{ objectFit: 'cover' }} />
                                : <span className={`material-symbols-outlined ${styles.relatedOptionFallback}`}>image</span>
                              }
                            </div>
                            <span className={`${styles.relatedOptionText} ${isSelected ? styles.relatedOptionTextActive : ''}`}>{txt}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Config selector (upper) */}
              {configurations.length > 0 && (
                <div className={styles.configOptionsCard}>
                  {product.bundle_title && (
                    <h4 className={styles.configOptionsTitle}>
                      <span className={`material-symbols-outlined ${styles.relatedOptionsIcon}`}>tune</span>
                      {product.bundle_title}
                    </h4>
                  )}
                  <div className={styles.configOptionsGrid}>
                    {configurations.map(config => {
                      const isActive = activeConfig === config || activeBundlePopover === config;
                      const compactLabel = getCompactConfigLabel(config);

                      return (
                        <div
                          key={config}
                          className={styles.configOptionWrap}
                          data-bundle-config-wrapper="true"
                          data-config-name={config}
                          onMouseEnter={() => handleBundleMouseEnter(config)}
                          onMouseLeave={() => handleBundleMouseLeave(config)}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenBundleActions(config)}
                            className={`${styles.configOptionBtn} ${isActive ? styles.configOptionBtnActive : ''}`}
                            aria-expanded={activeBundlePopover === config}
                            aria-pressed={isActive}
                            title={config}
                          >
                            <span className={styles.configOptionLabelDesktop}>{config}</span>
                            <span className={styles.configOptionLabelMobile}>{compactLabel}</span>
                          </button>
                          {!isMobileBundleViewport && activeBundlePopover === config ? (
                            <InlineBundleActionPopover
                              configName={config}
                              onViewDetails={handleViewBundleDetails}
                              onAddToCart={handlePopupAddToCart}
                              onBuyNow={handlePopupBuyNow}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isMobileBundleViewport && activeBundlePopover ? (
                <MobileBundleActionPopover
                  configName={activeBundlePopover}
                  onViewDetails={handleViewBundleDetails}
                  onAddToCart={handlePopupAddToCart}
                  onBuyNow={handlePopupBuyNow}
                />
              ) : null}

              {/* Price */}
              <div className={styles.priceContainer}>
                <div className="flex items-center gap-4">
                  <div className={styles.currentPrice}>{formatPrice(displayPrice)}</div>
                  {infoDiscount > 0 && <span className={styles.originalPrice}>{formatPrice(subtotal)}</span>}
                </div>
                {infoDiscount > 0 && <p className={styles.savingsText}>Tiết kiệm {formatPrice(infoDiscount)} khi mua trọn bộ</p>}
                <p className={styles.priceMeta}>Số lượng món: {selectedItems.length} | Đã bao gồm phí bảo hiểm vận chuyển</p>
              </div>

              {/* Summary card */}
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
                    <span className={styles.customizeBundleBtnText}>
                    Xem chi tiết & tùy chỉnh thành phần bên dưới
                    </span>
                  </button>
                </div>
              </div>

              <SpecificationList product={product} />
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

        {/* ===== Chi tiết thành phần bộ ===== */}
        <div id="bundle-list" className="pt-16 border-t border-stone/10" style={{ marginTop: '10px' }}>
          <div className="text-center" style={{ marginBottom: '10px' }}>
            <h2 className="text-3xl font-display font-bold text-primary italic" style={{ marginBottom: '10px' }}>Chi tiết thành phần bộ</h2>
            <div className="w-20 h-1 bg-accent mx-auto rounded-full"></div>
            <p className="text-stone/50 max-w-2xl mx-auto" style={{ marginTop: '10px' }}>
              Tùy chỉnh số lượng hoặc thay đổi từng món theo từng cấu hình để phù hợp nhu cầu của Quý khách.
            </p>
          </div>

          <div className="max-w-5xl mx-auto" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* === Tab bar === */}
            {configurations.length > 0 && (
              <div className={builderStyles.tabBar}>
                {configurations.map(config => (
                  <button
                    key={config}
                    className={`${builderStyles.tabBtn} ${activeTab === config ? builderStyles.tabBtnActive : ''}`}
                    onClick={() => handleTabChange(config)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {activeTab === config ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    {config}
                    {/* Green dot if full combo */}
                    {(() => {
                      const cfgItems = bundleItems.filter(i => (i.option_title || i.pivot?.option_title) === config);
                      const origSrc = product.bundle_items || product.grouped_items || [];
                      const origCfg = origSrc.filter(i => (i.option_title || i.pivot?.option_title) === config);
                      const full = cfgItems.every(item => {
                        if (item.removed) return false;
                        const o = origCfg.find(x => x.id === item.id);
                        return (item.qty || 1) >= (o?.pivot?.quantity || 1);
                      });
                      return cfgItems.length > 0 && full
                        ? <span className={builderStyles.tabFullDot} title="Đủ điều kiện giảm giá"></span>
                        : null;
                    })()}
                  </button>
                ))}
              </div>
            )}

            {/* === Top Action Bar === */}
            {tabItems.length > 0 && (
              <div className={builderStyles.topActionBar}>
                {isFullCombo ? (
                  <div className={builderStyles.discountBannerInline}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
                    <span>Bạn đang mua trọn bộ — Ưu đãi giảm <strong>{(DISCOUNT_RATE * 100).toFixed(0)}%</strong>!</span>
                  </div>
                ) : (
                  <div className={builderStyles.discountHintInline}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>info</span>
                    <span>Mua đủ <strong>{tabItems.length} món</strong> nhận ưu đãi giảm {(DISCOUNT_RATE * 100).toFixed(0)}%</span>
                  </div>
                )}

                <div className={builderStyles.quickSummaryTopInline}>
                  <div className={builderStyles.quickSummaryPrice}>
                    <span className={builderStyles.quickSummaryLabel}>Thanh toán:</span>
                    <span className={builderStyles.quickSummaryValue}>{formatPrice(tabFinalPrice)}</span>
                  </div>
                  {handleBuyTabConfig && tabItems.some(i => !i.removed) && (
                    <button
                      className={builderStyles.buyTabBtnSmall}
                      onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>shopping_cart_checkout</span>
                      Mua ngay
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* === Table === */}
            {tabItems.length > 0 ? (
              <>
                {/* Header */}
                <div className={builderStyles.tableHeader}>
                  <div className={builderStyles.colStt}>STT</div>
                  <div className={builderStyles.colImg}></div>
                  <div className={builderStyles.colName}>Sản phẩm</div>
                  <div className={builderStyles.colPrice}>Đơn giá</div>
                  <div className={builderStyles.colQty}>Số lượng</div>
                  <div className={builderStyles.colTotal}>Thành tiền</div>
                  <div className={builderStyles.colActions}></div>
                </div>

                {/* Rows */}
                <div className={builderStyles.tableBody}>
                  {tabItems.map((item, idx) => {
                    if (item.removed) {
                      // Placeholder row
                      return (
                        <div key={item.id} className={`${builderStyles.tableRow} ${builderStyles.tableRowRemoved}`}>
                          <div className={builderStyles.colStt}>
                            <span className={builderStyles.sttBadge} style={{ opacity: 0.3 }}>{idx + 1}</span>
                          </div>
                          <div className={builderStyles.colImg}>
                            <div className={`${builderStyles.tableImgWrap} ${builderStyles.tableImgEmpty}`}>
                              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#ccc' }}>image_not_supported</span>
                            </div>
                          </div>
                          <div className={builderStyles.colName}>
                            <p className={builderStyles.removedLabel}>Vị trí đã xóa</p>
                            <span className={builderStyles.variantHint}>Chọn sản phẩm thay thế cho vị trí này</span>
                          </div>
                          <div className={builderStyles.colPrice}><span className={builderStyles.unitPrice}>—</span></div>
                          <div className={builderStyles.colQty}><span className={builderStyles.unitPrice}>—</span></div>
                          <div className={builderStyles.colTotal}><span className={builderStyles.unitPrice}>—</span></div>
                          <div className={builderStyles.colActions}>
                            <button
                              className={builderStyles.restoreBtn}
                              onClick={() => restoreBundleItem ? restoreBundleItem(item.id) : null}
                              title="Khôi phục sản phẩm"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>restart_alt</span>
                              Khôi phục
                            </button>
                            <button
                              className={builderStyles.selectSlotBtn}
                              onClick={() => openSelectionModal(item)}
                              title="Chọn sản phẩm khác"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span>
                              Chọn lại
                            </button>
                          </div>
                        </div>
                      );
                    }

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

                        {/* Name + change button inline */}
                        <div className={builderStyles.colName}>
                          <div className={builderStyles.nameRow}>
                            <p className={builderStyles.itemName}>{item.name}</p>
                            <button
                              className={builderStyles.inlineChangeBtn}
                              onClick={() => openSelectionModal(item)}
                              title="Thay sản phẩm khác"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>swap_horiz</span>
                              Đổi
                            </button>
                          </div>
                          {item.sku && <span className={builderStyles.variantHint}>SKU: {item.sku}</span>}
                        </div>

                        {/* Unit price */}
                        <div className={builderStyles.colPrice}>
                          <span className={builderStyles.unitPrice}>{formatPrice(item.price)}</span>
                        </div>

                        {/* Qty +/- */}
                        <div className={builderStyles.colQty}>
                          <div className={builderStyles.qtyControl}>
                            <button className={builderStyles.qtyBtn}
                              onClick={() => updateBundleItemQuantity(item.id, (item.qty || 1) - 1)}
                              disabled={(item.qty || 1) <= 1}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove</span>
                            </button>
                            <span className={builderStyles.qtyDisplay}>{item.qty || 1}</span>
                            <button className={builderStyles.qtyBtn}
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

                        {/* Delete */}
                        <div className={builderStyles.colActions}>
                          <button className={builderStyles.deleteBtn}
                            onClick={() => removeBundleItem(item.id)}
                            title="Xóa khỏi combo"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Summary footer */}
                <div className={builderStyles.tableFooter}>
                  {/* Left part: Reset button only (aligned to the top row) */}
                  <div className={builderStyles.footerLeft}>
                    {resetBundleItems && (
                      <button className={builderStyles.resetBtn} onClick={resetBundleItems}>
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>restart_alt</span>
                        Khôi phục mặc định
                      </button>
                    )}
                  </div>

                  {/* Right part: Summary rows starting with total items count */}
                  <div className={builderStyles.footerRight}>
                    <div className={builderStyles.summaryRow}>
                      <span className={builderStyles.summaryLabelSub}>
                        Tổng {tabItems.filter(i => !i.removed).length} món ({activeTab || 'bộ hiện tại'}):
                      </span>
                      {/* Empty span to satisfy space-between row layout */}
                      <span></span>
                    </div>
                    <div className={builderStyles.summaryRow}>
                      <span className={builderStyles.summaryLabelSub}>Tạm tính:</span>
                      <span className={builderStyles.summarySubtotal}>{formatPrice(tabSubtotal)}</span>
                    </div>
                    {isFullCombo && tabDiscountAmount > 0 && (
                      <div className={builderStyles.summaryRow}>
                        <span className={builderStyles.summaryLabelDiscount}>
                          Giảm {(DISCOUNT_RATE * 100).toFixed(0)}% (trọn bộ):
                        </span>
                        <span className={builderStyles.summaryDiscount}>- {formatPrice(tabDiscountAmount)}</span>
                      </div>
                    )}
                    <div className={`${builderStyles.summaryRow} ${builderStyles.grandTotalRow}`}>
                      <span className={builderStyles.grandTotalLabel}>Bộ này thanh toán:</span>
                      <span className={builderStyles.grandTotal}>{formatPrice(tabFinalPrice)}</span>
                    </div>
                    {/* Mua bộ này */}
                    {handleBuyTabConfig && tabItems.some(i => !i.removed) && (
                      <button
                        className={builderStyles.buyTabBtn}
                        onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>shopping_cart_checkout</span>
                        Mua bộ {activeTab || 'này'} ngay
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-20 bg-stone/5 rounded-3xl border border-dashed border-stone/20">
                <span className="material-symbols-outlined text-4xl text-stone/20 mb-4">inventory_2</span>
                <p className="text-stone/40 italic mb-4">Chưa có thành phần nào cho cấu hình này.</p>
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
    </div>
  );
}
