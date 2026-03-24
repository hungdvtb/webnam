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
import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Breadcrumb from './common/Breadcrumb';

const MOBILE_STICKY_CLUSTER_GAP = 8;

const normalizeConfigMediaKey = (configName = '') =>
  String(configName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const getConfigMediaFamilyKey = (configName = '') =>
  String(configName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b\d+(?:[.,]\d+)?m\d*\b/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim();

const getMobileStickyHeaderHeight = () => {
  if (typeof document === 'undefined') {
    return 0;
  }

  const mobileHeaderShell = document.querySelector('.mobile-sticky-header-shell');

  if (mobileHeaderShell) {
    const shellRect = mobileHeaderShell.getBoundingClientRect();
    const shellHeight = Math.round(shellRect.height || mobileHeaderShell.offsetHeight || 0);

    if (shellHeight > 0) {
      return shellHeight;
    }
  }

  const promoBar = document.querySelector('.top-promotion-bar');
  return Math.round(promoBar?.getBoundingClientRect().height || 32);
};

const getMobileStickyPinnedTop = () => getMobileStickyHeaderHeight() + MOBILE_STICKY_CLUSTER_GAP;

const BUNDLE_ITEM_CHANGE_LABEL = 'Đổi kích thước';
const BUNDLE_ITEM_CHANGE_TITLE = 'Đổi kích thước cho sản phẩm trong bộ';

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
  const [isMobileHeroConfigMenuOpen, setIsMobileHeroConfigMenuOpen] = useState(false);
  const [isMobileConfigMenuOpen, setIsMobileConfigMenuOpen] = useState(false);
  const [isMobileStickyClusterActive, setIsMobileStickyClusterActive] = useState(false);
  const [mobileStickyClusterLayout, setMobileStickyClusterLayout] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const bundleListRef = useRef(null);
  const mobileStickyClusterShellRef = useRef(null);
  const mobileStickyClusterRef = useRef(null);

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

  useEffect(() => {
    if (!isMobileBundleViewport) {
      setIsMobileHeroConfigMenuOpen(false);
      setIsMobileConfigMenuOpen(false);
    }
  }, [isMobileBundleViewport]);

  useEffect(() => {
    setIsMobileHeroConfigMenuOpen(false);
    setIsMobileConfigMenuOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!isMobileHeroConfigMenuOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!event.target.closest('[data-bundle-top-config-selector="true"]')) {
        setIsMobileHeroConfigMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileHeroConfigMenuOpen(false);
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
  }, [isMobileHeroConfigMenuOpen]);

  useEffect(() => {
    if (!isMobileConfigMenuOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!event.target.closest('[data-bundle-mobile-config-selector="true"]')) {
        setIsMobileConfigMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileConfigMenuOpen(false);
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
  }, [isMobileConfigMenuOpen]);

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

  // activeConfig for the upper config buttons
  const activeConfig = useMemo(() => {
    for (const config of configurations) {
      const itemsInConfig = bundleItems.filter(item => (item.option_title || item.pivot?.option_title) === config);
      if (itemsInConfig.every(item => item.selected && !item.removed)) return config;
    }
    return null;
  }, [bundleItems, configurations]);

  const activeConfigMedia = useMemo(() => {
    const selectedConfig = activeTab || activeConfig || configurations[0];

    if (!selectedConfig) {
      return null;
    }

    const sourceItems = [
      ...(Array.isArray(bundleItems) ? bundleItems : []),
      ...(product.bundle_items || product.grouped_items || []),
    ];

    const configIndexes = new Map(
      configurations.map((configName, configIndex) => [
        normalizeConfigMediaKey(configName),
        configIndex,
      ])
    );

    const mediaEntries = sourceItems.reduce((entries, item) => {
      const itemConfig = item.option_title || item.pivot?.option_title;
      const slugOrId =
        item.option_post_slug ||
        item.pivot?.option_post_slug ||
        item.option_post_id ||
        item.pivot?.option_post_id;

      if (!itemConfig || !slugOrId) {
        return entries;
      }

      const configKey = normalizeConfigMediaKey(itemConfig);

      if (!configKey || entries.some((entry) => entry.configKey === configKey)) {
        return entries;
      }

      entries.push({
        configName: itemConfig,
        configKey,
        familyKey: getConfigMediaFamilyKey(itemConfig),
        title:
          item.option_post_title ||
          item.pivot?.option_post_title ||
          itemConfig,
        href: `/blog/${encodeURIComponent(String(slugOrId))}`,
      });

      return entries;
    }, []);

    if (mediaEntries.length === 0) {
      return null;
    }

    const selectedConfigKey = normalizeConfigMediaKey(selectedConfig);
    const selectedFamilyKey = getConfigMediaFamilyKey(selectedConfig);
    const selectedConfigIndex = configIndexes.get(selectedConfigKey) ?? Number.MAX_SAFE_INTEGER;

    let matchedConfigPost =
      mediaEntries.find((entry) => entry.configKey === selectedConfigKey) || null;

    if (!matchedConfigPost && selectedFamilyKey) {
      const familyMatches = mediaEntries.filter((entry) => entry.familyKey === selectedFamilyKey);

      if (familyMatches.length > 0) {
        matchedConfigPost = familyMatches.reduce((closestEntry, currentEntry) => {
          if (!closestEntry) {
            return currentEntry;
          }

          const currentDistance = Math.abs(
            (configIndexes.get(currentEntry.configKey) ?? Number.MAX_SAFE_INTEGER) - selectedConfigIndex
          );
          const closestDistance = Math.abs(
            (configIndexes.get(closestEntry.configKey) ?? Number.MAX_SAFE_INTEGER) - selectedConfigIndex
          );

          return currentDistance < closestDistance ? currentEntry : closestEntry;
        }, null);
      }
    }

    if (!matchedConfigPost) {
      matchedConfigPost = mediaEntries[0];
    }

    return {
      configName: selectedConfig,
      title: matchedConfigPost.title || selectedConfig,
      href: matchedConfigPost.href,
    };
  }, [activeConfig, activeTab, bundleItems, configurations, product.bundle_items, product.grouped_items]);

  const hasActiveConfigMedia = Boolean(activeConfigMedia?.href);

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

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (!isMobileBundleViewport) {
      setIsMobileStickyClusterActive(false);
      setMobileStickyClusterLayout({ top: 0, left: 0, width: 0, height: 0 });
      return undefined;
    }

    let frameId = 0;

    const updateStickyState = () => {
      const stickyClusterShell = mobileStickyClusterShellRef.current;
      const stickyCluster = mobileStickyClusterRef.current;
      const bundleList = bundleListRef.current;
      const stickyPinnedTop = getMobileStickyPinnedTop();

      if (!stickyClusterShell || !stickyCluster || !bundleList) {
        setIsMobileStickyClusterActive(false);
        setMobileStickyClusterLayout({ top: 0, left: 0, width: 0, height: 0 });
        return;
      }

      const stickyClusterShellRect = stickyClusterShell.getBoundingClientRect();
      const bundleListRect = bundleList.getBoundingClientRect();
      const stickyClusterHeight = stickyCluster.offsetHeight;
      const canRemainPinned = bundleListRect.bottom > stickyPinnedTop + stickyClusterHeight + 18;
      const nextStickyState = stickyClusterShellRect.top <= stickyPinnedTop + 1 && canRemainPinned;

      setMobileStickyClusterLayout((currentValue) => {
        const nextValue = {
          top: stickyPinnedTop,
          left: Math.round(stickyClusterShellRect.left),
          width: Math.round(stickyClusterShellRect.width),
          height: Math.round(stickyClusterHeight),
        };

        return (
          currentValue.top === nextValue.top &&
          currentValue.left === nextValue.left &&
          currentValue.width === nextValue.width &&
          currentValue.height === nextValue.height
        )
          ? currentValue
          : nextValue;
      });

      setIsMobileStickyClusterActive((currentValue) =>
        currentValue === nextStickyState ? currentValue : nextStickyState
      );
    };

    const requestStickyUpdate = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateStickyState();
      });
    };

    updateStickyState();
    window.addEventListener('scroll', requestStickyUpdate, { passive: true });
    window.addEventListener('resize', requestStickyUpdate);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener('scroll', requestStickyUpdate);
      window.removeEventListener('resize', requestStickyUpdate);
      setMobileStickyClusterLayout({ top: 0, left: 0, width: 0, height: 0 });
    };
  }, [isMobileBundleViewport, activeTab, isFullCombo, tabFinalPrice, tabItems.length]);

  // For upper info section: selectedItems (all configs) for top-level displayPrice
  const selectedItems = bundleItems.filter(item => item.selected && !item.removed);
  const subtotal = selectedItems.reduce((acc, it) => acc + (parseFloat(it.price || 0) * (it.qty || 1)), 0);

  // Use global displayPrice from parent (already computed from all selected items)
  const infoDiscount = subtotal - displayPrice;

  const isConfigEligibleForDiscount = (configName) => {
    const cfgItems = bundleItems.filter((item) => (item.option_title || item.pivot?.option_title) === configName);
    const origSrc = product.bundle_items || product.grouped_items || [];
    const origCfg = origSrc.filter((item) => (item.option_title || item.pivot?.option_title) === configName);

    return cfgItems.length > 0 && cfgItems.every((item) => {
      if (item.removed) return false;
      const originalItem = origCfg.find((candidate) => candidate.id === item.id);
      return (item.qty || 1) >= (originalItem?.pivot?.quantity || 1);
    });
  };

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

  const scrollToBundleDetailControls = ({ behavior = 'smooth' } = {}) => {
    const detailSection = bundleListRef.current;
    const stickyClusterShell = mobileStickyClusterShellRef.current;

    if (typeof window === 'undefined') {
      return;
    }

    if (!isMobileBundleViewport || !stickyClusterShell) {
      detailSection?.scrollIntoView({ behavior, block: 'start' });
      return;
    }

    const stickyPinnedTop = getMobileStickyPinnedTop();
    const shellTop = window.scrollY + stickyClusterShell.getBoundingClientRect().top;
    const targetTop = Math.max(0, Math.round(shellTop - stickyPinnedTop));

    window.scrollTo({ top: targetTop, behavior });
  };

  const handleViewBundleDetails = () => {
    if (activeBundlePopover) {
      handleTabChange(activeBundlePopover);
    }
    closeBundleActions();

    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToBundleDetailControls({ behavior: 'smooth' });
      });
    });
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

  const mobileStickyClusterShellStyle =
    isMobileBundleViewport && isMobileStickyClusterActive && mobileStickyClusterLayout.height > 0
      ? { height: `${mobileStickyClusterLayout.height}px` }
      : undefined;

  const mobileStickyClusterStyle =
    isMobileBundleViewport && isMobileStickyClusterActive && mobileStickyClusterLayout.width > 0
      ? {
          top: `${mobileStickyClusterLayout.top}px`,
          left: `${mobileStickyClusterLayout.left}px`,
          width: `${mobileStickyClusterLayout.width}px`,
          maxWidth: `${mobileStickyClusterLayout.width}px`,
        }
      : undefined;

  const renderBundleConfigGrid = () => {
    if (configurations.length === 0) {
      return null;
    }

    const selectedConfig = activeTab || configurations[0];
    const mobileConfigHint = `${configurations.length} c\u1EA5u h\u00ECnh`;

    return (
      <div
        className={builderStyles.mobileConfigRailCard}
        data-bundle-mobile-config-selector="true"
      >
        <div className={builderStyles.mobileConfigRailHeader}>
          <span className={builderStyles.mobileConfigRailTitle}>{'Ch\u1ECDn c\u1EA5u h\u00ECnh b\u1ED9'}</span>
          <span className={builderStyles.mobileConfigRailMeta}>{mobileConfigHint}</span>
        </div>

        <div className={builderStyles.mobileConfigDropdown}>
          <div className={builderStyles.mobileConfigDropdownRow}>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isMobileConfigMenuOpen}
              className={`${builderStyles.mobileConfigDropdownTrigger} ${isMobileConfigMenuOpen ? builderStyles.mobileConfigDropdownTriggerOpen : ''}`}
              onClick={() => setIsMobileConfigMenuOpen((currentValue) => !currentValue)}
            >
              <span className={builderStyles.mobileConfigDropdownValueWrap}>
                <span className={builderStyles.mobileConfigDropdownEyebrow}>{'\u0110ang ch\u1ECDn'}</span>
                <span className={builderStyles.mobileConfigDropdownValue}>{selectedConfig}</span>
              </span>

              <span className={builderStyles.mobileConfigDropdownActions}>
                <span className={`material-symbols-outlined ${builderStyles.mobileConfigDropdownArrow}`}>
                  {isMobileConfigMenuOpen ? 'expand_less' : 'expand_more'}
                </span>
              </span>
            </button>

            {hasActiveConfigMedia ? (
              <Link
                href={activeConfigMedia.href}
                className={`${builderStyles.configMediaLink} ${builderStyles.mobileConfigMediaLink}`}
                title={activeConfigMedia.title ? `Xem media: ${activeConfigMedia.title}` : 'Xem media'}
                aria-label={`Xem media cho ${activeConfigMedia.configName}`}
              >
                <span className="material-symbols-outlined">perm_media</span>
                <span className={builderStyles.configMediaLinkText}>Xem media</span>
              </Link>
            ) : null}
          </div>

          {isMobileConfigMenuOpen ? (
            <div className={builderStyles.mobileConfigDropdownMenu} role="listbox" aria-label="Danh s\u00E1ch c\u1EA5u h\u00ECnh b\u1ED9">
              {configurations.map((config) => {
                const isSelected = activeTab === config;
                const isDiscountReady = isConfigEligibleForDiscount(config);

                return (
                  <button
                    key={config}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${builderStyles.mobileConfigDropdownOption} ${isSelected ? builderStyles.mobileConfigDropdownOptionActive : ''}`}
                    onClick={() => {
                      handleTabChange(config);
                      setIsMobileConfigMenuOpen(false);
                    }}
                  >
                    <span className={builderStyles.mobileConfigDropdownOptionMain}>
                      <span className={builderStyles.mobileConfigDropdownOptionTitle}>{config}</span>
                      {isSelected ? (
                        <span className={builderStyles.mobileConfigDropdownOptionHint}>{'\u0110ang ch\u1ECDn'}</span>
                      ) : null}
                    </span>

                    <span className={builderStyles.mobileConfigDropdownOptionMeta}>
                      {isDiscountReady ? (
                    <span className={builderStyles.tabFullDot} title="Đủ điều kiện giảm giá"></span>
                      ) : null}
                      <span className="material-symbols-outlined">
                        {isSelected ? 'check_circle' : 'chevron_right'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {tabItems.length > 0 ? (
          <div className={builderStyles.mobileConfigSummaryRow}>
            <div className={builderStyles.mobileConfigCheckoutRow}>
              <div className={builderStyles.mobileConfigCheckoutBox}>
                <div className={builderStyles.mobileConfigCheckoutInfo}>
                  <span className={builderStyles.mobileConfigCheckoutLabel}>Thanh toán</span>
                  <span className={builderStyles.mobileConfigCheckoutValue}>
                    {formatPrice(tabFinalPrice)}
                  </span>
                </div>

                <span
                  className={`${builderStyles.mobileConfigOfferChip} ${
                    isFullCombo
                      ? builderStyles.mobileConfigOfferChipActive
                      : builderStyles.mobileConfigOfferChipHint
                  }`}
                >
                  <span className="material-symbols-outlined">
                    {isFullCombo ? 'local_offer' : 'info'}
                  </span>
                  <span>
                    {isFullCombo
                      ? `Giảm giá ${(DISCOUNT_RATE * 100).toFixed(0)}% khi mua trọn bộ`
                      : `Đủ ${tabItems.length} món: -${(DISCOUNT_RATE * 100).toFixed(0)}%`}
                  </span>
                </span>
              </div>

              {handleBuyTabConfig && tabItems.some((item) => !item.removed) ? (
                <button
                  type="button"
                  className={builderStyles.mobileConfigBuyBtn}
                  onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    shopping_cart_checkout
                  </span>
                  Mua ngay
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderMobileHeroConfigSelector = () => {
    if (configurations.length === 0) {
      return null;
    }

    const selectedConfig = activeBundlePopover || activeConfig || configurations[0];

    return (
      <div
        className={styles.configOptionsMobileDropdown}
        data-bundle-top-config-selector="true"
      >
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isMobileHeroConfigMenuOpen}
          className={`${styles.configOptionsMobileTrigger} ${isMobileHeroConfigMenuOpen ? styles.configOptionsMobileTriggerOpen : ''}`}
          onClick={() => setIsMobileHeroConfigMenuOpen((currentValue) => !currentValue)}
        >
          <span className={styles.configOptionsMobileTriggerCopy}>
            <span className={styles.configOptionsMobileTriggerEyebrow}>{'Đang chọn'}</span>
            <span className={styles.configOptionsMobileTriggerValue}>{selectedConfig}</span>
          </span>

          <span className={`material-symbols-outlined ${styles.configOptionsMobileTriggerArrow}`}>
            {isMobileHeroConfigMenuOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {isMobileHeroConfigMenuOpen ? (
          <div
            className={styles.configOptionsMobileMenu}
            role="listbox"
            aria-label={product.bundle_title || 'Danh sách cấu hình bộ'}
          >
            {configurations.map((config) => {
              const isActive = activeConfig === config || activeBundlePopover === config;

              return (
                <button
                  key={config}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`${styles.configOptionsMobileOption} ${isActive ? styles.configOptionsMobileOptionActive : ''}`}
                  onClick={() => {
                    handleOpenBundleActions(config);
                    setIsMobileHeroConfigMenuOpen(false);
                  }}
                >
                  <span className={styles.configOptionsMobileOptionCopy}>
                    <span className={styles.configOptionsMobileOptionTitle}>{config}</span>
                    {isActive ? (
                      <span className={styles.configOptionsMobileOptionHint}>{'Đang chọn'}</span>
                    ) : null}
                  </span>

                  <span className={styles.configOptionsMobileOptionMeta}>
                    <span className={styles.configOptionsMobileOptionDot}></span>
                    <span className={`material-symbols-outlined ${styles.configOptionsMobileOptionIcon}`}>
                      {isActive ? 'check_circle' : 'chevron_right'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderStickyBundleDetailControls = () => (
    <>
      {renderBundleConfigGrid()}

      {tabItems.length > 0 && (
        <div className={builderStyles.topActionBar}>
          {isFullCombo ? (
            <div className={builderStyles.discountBannerInline}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
              <span>
                {'\u0042\u1ea1n \u0111ang mua tr\u1ecdn b\u1ed9 \u2014 \u01afu \u0111\u00e3i gi\u1ea3m '}
                <strong>{(DISCOUNT_RATE * 100).toFixed(0)}%</strong>
                !
              </span>
            </div>
          ) : (
            <div className={builderStyles.discountHintInline}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>info</span>
              <span>
                {'Mua \u0111\u1ee7 '}
                <strong>{tabItems.length} {'m\u00f3n'}</strong>
                {' nh\u1eadn \u01b0u \u0111\u00e3i gi\u1ea3m '}
                {(DISCOUNT_RATE * 100).toFixed(0)}%
              </span>
            </div>
          )}

          <div className={builderStyles.quickSummaryTopInline}>
            <div className={builderStyles.quickSummaryPrice}>
              <span className={builderStyles.quickSummaryLabel}>{'Thanh to\u00e1n:'}</span>
              <span className={builderStyles.quickSummaryValue}>{formatPrice(tabFinalPrice)}</span>
            </div>
            {handleBuyTabConfig && tabItems.some((item) => !item.removed) && (
              <button
                className={builderStyles.buyTabBtnSmall}
                onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>shopping_cart_checkout</span>
                {'Mua ngay'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );

  const renderBundleDetailControls = () => (
    <>
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
                  ? <span className={builderStyles.tabFullDot} title="Äá»§ Ä‘iá»u kiá»‡n giáº£m giÃ¡"></span>
                  : null;
              })()}
            </button>
          ))}
        </div>
      )}

      {tabItems.length > 0 && (
              <div className={`${builderStyles.topActionBar} ${hasActiveConfigMedia ? builderStyles.topActionBarWithMedia : ''}`}>
                {isFullCombo ? (
                  <div className={builderStyles.discountBannerInline}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
                    <span>Báº¡n Ä‘ang mua trá»n bá»™ â€” Æ¯u Ä‘Ã£i giáº£m <strong>{(DISCOUNT_RATE * 100).toFixed(0)}%</strong>!</span>
                  </div>
          ) : (
            <div className={builderStyles.discountHintInline}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>info</span>
                    <span>Mua Ä‘á»§ <strong>{tabItems.length} mÃ³n</strong> nháº­n Æ°u Ä‘Ã£i giáº£m {(DISCOUNT_RATE * 100).toFixed(0)}%</span>
                  </div>
                )}

                {hasActiveConfigMedia ? (
                  <Link
                    href={activeConfigMedia.href}
                    className={`${builderStyles.configMediaLink} ${builderStyles.topActionMediaLink}`}
                    title={activeConfigMedia.title ? `Xem media: ${activeConfigMedia.title}` : 'Xem media'}
                    aria-label={`Xem media cho ${activeConfigMedia.configName}`}
                  >
                    <span className="material-symbols-outlined">perm_media</span>
                    <span className={builderStyles.configMediaLinkText}>Xem media</span>
                  </Link>
                ) : null}

                <div className={builderStyles.quickSummaryTopInline}>
                  <div className={builderStyles.quickSummaryPrice}>
                    <span className={builderStyles.quickSummaryLabel}>Thanh toÃ¡n:</span>
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
    </>
  );

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
                  {isMobileBundleViewport ? renderMobileHeroConfigSelector() : (
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
                  )}
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
                    onClick={() => scrollToBundleDetailControls({ behavior: 'smooth' })}
                    className={styles.customizeBundleBtn}
                  >
                    <span className="material-symbols-outlined">tune</span>
                    <span className={styles.customizeBundleBtnText}>
                      <span>Xem chi tiết & tùy chỉnh</span>
                      <span>thành phần bên dưới</span>
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
        <div
          id="bundle-list"
          ref={bundleListRef}
          className="pt-16 border-t border-stone/10"
          style={{ marginTop: '10px' }}
        >
          <div className="text-center" style={{ marginBottom: '10px' }}>
            <h2 className="text-3xl font-display font-bold text-primary italic" style={{ marginBottom: '10px' }}>Chi tiết thành phần bộ</h2>
            <div className="w-20 h-1 bg-accent mx-auto rounded-full"></div>
            <p className="text-stone/50 max-w-2xl mx-auto" style={{ marginTop: '10px' }}>
              Tùy chỉnh số lượng hoặc thay đổi từng món theo từng cấu hình để phù hợp nhu cầu của Quý khách.
            </p>
          </div>

          <div className="max-w-5xl mx-auto" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            <div
              ref={mobileStickyClusterShellRef}
              className={builderStyles.mobileStickyClusterShell}
              style={mobileStickyClusterShellStyle}
            >
              <div
                ref={mobileStickyClusterRef}
                className={`${builderStyles.mobileStickyCluster} ${isMobileBundleViewport && isMobileStickyClusterActive ? builderStyles.mobileStickyClusterHidden : ''}`}
              >
                <div className={builderStyles.tabBarGridWrap}>
                  {renderBundleConfigGrid()}
                </div>

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
              <div className={`${builderStyles.topActionBar} ${hasActiveConfigMedia ? builderStyles.topActionBarWithMedia : ''}`}>
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

                {hasActiveConfigMedia ? (
                  <Link
                    href={activeConfigMedia.href}
                    className={`${builderStyles.configMediaLink} ${builderStyles.topActionMediaLink}`}
                    title={activeConfigMedia.title ? `Xem media: ${activeConfigMedia.title}` : 'Xem media'}
                    aria-label={`Xem media cho ${activeConfigMedia.configName}`}
                  >
                    <span className="material-symbols-outlined">perm_media</span>
                    <span className={builderStyles.configMediaLinkText}>Xem media</span>
                  </Link>
                ) : null}

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
              </div>
            </div>

            {isMobileBundleViewport && isMobileStickyClusterActive && mobileStickyClusterLayout.width > 0 && (
              <div
                className={`${builderStyles.mobileStickyCluster} ${builderStyles.mobileStickyClusterFloating}`}
                style={mobileStickyClusterStyle}
              >
                {renderStickyBundleDetailControls()}
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
                    if (isMobileBundleViewport) {
                      return (
                        <div key={item.id} className={`${builderStyles.tableRow} ${builderStyles.tableRowMobileCompact}`}>
                          <div className={builderStyles.colStt}>
                            <span className={builderStyles.sttBadge}>{idx + 1}</span>
                          </div>

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

                          <div className={builderStyles.mobileItemContent}>
                            <div className={builderStyles.colName}>
                              <div className={builderStyles.nameRow}>
                                <p className={builderStyles.itemName}>{item.name}</p>
                                <button
                                  className={builderStyles.inlineChangeBtn}
                                  onClick={() => openSelectionModal(item)}
                                  title={BUNDLE_ITEM_CHANGE_TITLE}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>swap_horiz</span>
                                  {BUNDLE_ITEM_CHANGE_LABEL}
                                </button>
                              </div>
                              {item.sku && <span className={builderStyles.variantHint}>SKU: {item.sku}</span>}
                            </div>

                            <div className={builderStyles.mobileItemBottom}>
                              <div className={builderStyles.mobilePriceStack}>
                                <div className={builderStyles.mobilePriceLine}>
                                  <span className={builderStyles.mobileMetaLabel}>{'\u0110\u01A1n gi\u00E1'}</span>
                                  <span className={builderStyles.unitPrice}>{formatPrice(item.price)}</span>
                                </div>
                                <div className={builderStyles.mobilePriceLine}>
                                  <span className={builderStyles.mobileMetaLabel}>{'Th\u00E0nh ti\u1EC1n'}</span>
                                  <span className={builderStyles.lineTotal}>{formatPrice(lineTotal)}</span>
                                </div>
                              </div>

                              <div className={builderStyles.mobileControlStack}>
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

                                <div className={builderStyles.colActions}>
                                  <button
                                    className={builderStyles.deleteBtn}
                                    onClick={() => removeBundleItem(item.id)}
                                    title={'X\u00F3a kh\u1ECFi combo'}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

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
                              title={BUNDLE_ITEM_CHANGE_TITLE}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>swap_horiz</span>
                              {BUNDLE_ITEM_CHANGE_LABEL}
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
