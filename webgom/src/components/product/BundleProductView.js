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
import { Fragment, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Breadcrumb from './common/Breadcrumb';
import {
  BUNDLE_DISCOUNT_RATE,
  buildBundleSnapshot,
  createBundleCartEntry,
  evaluateBundleSelection,
  getBundleOptionTitle,
} from '@/lib/bundlePricing';
import { resolveImageObjectUrl, resolveVideoEmbedUrl } from '@/lib/media';
import { buildBundleComponentDetailHref } from '@/lib/productLinks';
import { logProductTimingOnce } from '@/lib/productPerformance';

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

const normalizeGalleryVideoUrls = (items = [], fallbackUrl = '') => {
  const sourceItems = Array.isArray(items) ? items : [items];
  const urls = sourceItems
    .map((item) => String(typeof item === 'object' ? (item?.url || item?.video_url || '') : item || '').trim())
    .filter(Boolean);
  const legacyUrl = String(fallbackUrl || '').trim();

  if (urls.length === 0 && legacyUrl) {
    urls.push(legacyUrl);
  }

  return urls.filter((url, index, collection) => (
    collection.indexOf(url) === index && Boolean(resolveVideoEmbedUrl(url))
  ));
};

const sentenceCaseButtonStyle = { textTransform: 'none' };
const BUNDLE_WORKSPACE_STATE_KEY = '__webgomBundleWorkspace';
const BUNDLE_DETAIL_SCROLL_REQUEST_EVENT = 'webgom:bundle-detail-scroll-request';


const BUNDLE_ITEM_CHANGE_LABEL = 'Đổi mẫu, size';
const BUNDLE_ITEM_CHANGE_TITLE = 'Đổi mẫu, size cho sản phẩm trong bộ';

const getBundleWorkspacePageKey = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return `${window.location.pathname}${window.location.search}`;
};

function DropdownChevron({ className = '', openClassName = '', isOpen = false }) {
  return (
    <span className={`${className} ${isOpen ? openClassName : ''}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 20 20" focusable="false">
        <path
          d="M5.25 7.75 10 12.5l4.75-4.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

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
  videoUrls,
  activeIndex,
  setActiveIndex,
  activeBundleConfig,
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
  const [showBundleDetailSection, setShowBundleDetailSection] = useState(false);
  // Active tab in the detail section (separate from upper config selector)
  const [manualActiveTab, setManualActiveTab] = useState(null);
  const [isMobileHeroConfigMenuOpen, setIsMobileHeroConfigMenuOpen] = useState(false);
  const [isMobileConfigMenuOpen, setIsMobileConfigMenuOpen] = useState(false);
  const galleryAnchorRef = useRef(null);
  const gallerySectionRef = useRef(null);
  const desktopGalleryRef = useRef(null);
  const mobileGalleryRef = useRef(null);
  const bundleListRef = useRef(null);
  const pendingBundleWorkspaceRestoreRef = useRef(null);
  const bundleWorkspaceRestoreTimersRef = useRef([]);
  const closeMobileHeroConfigMenu = () => setIsMobileHeroConfigMenuOpen(false);
  const closeMobileConfigMenu = () => setIsMobileConfigMenuOpen(false);
  const clearBundleWorkspaceRestoreTimers = useCallback(() => {
    if (typeof window === 'undefined') {
      bundleWorkspaceRestoreTimersRef.current = [];
      return;
    }

    bundleWorkspaceRestoreTimersRef.current.forEach((timer) => {
      if (!timer) {
        return;
      }

      if (timer.type === 'raf') {
        window.cancelAnimationFrame(timer.id);
        return;
      }

      window.clearTimeout(timer.id);
    });

    bundleWorkspaceRestoreTimersRef.current = [];
  }, []);
  const cancelBundleWorkspaceRestore = useCallback(() => {
    pendingBundleWorkspaceRestoreRef.current = null;
    clearBundleWorkspaceRestoreTimers();
  }, [clearBundleWorkspaceRestoreTimers]);
  const stopDropdownEventPropagation = (event) => {
    event.stopPropagation();
  };
  const shouldHandleDropdownOptionSelection = (event) => {
    if (!event) {
      return true;
    }

    if (event.detail === 0) {
      return true;
    }

    const clientX = Number(event.clientX ?? event.nativeEvent?.clientX);
    const clientY = Number(event.clientY ?? event.nativeEvent?.clientY);
    const rect = event.currentTarget?.getBoundingClientRect?.();

    if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return true;
    }

    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  };

  const getBundleImageSrc = (item) => {
    const candidates = [
      item?.selected_variant?.primary_image,
      item?.selected_variant?.images?.[0],
      item?.primary_image,
      item?.images?.[0],
      item?.selected_variant?.main_image ? { path: item.selected_variant.main_image } : null,
      item?.main_image ? { path: item.main_image } : null,
    ];

    for (const candidate of candidates) {
      const resolved = resolveImageObjectUrl(candidate, 'medium', '');
      if (resolved) {
        return resolved;
      }
    }

    return getImageUrl(item?.primary_image || item?.images?.[0] || { path: item?.main_image });
  };

  const saveBundleWorkspaceState = (configName = resolvedActiveTab) => {
    if (typeof window === 'undefined') {
      return;
    }

    const pageKey = getBundleWorkspacePageKey();

    if (!pageKey) {
      return;
    }

    const currentHistoryState = (
      window.history?.state
      && typeof window.history.state === 'object'
      && !Array.isArray(window.history.state)
    )
      ? window.history.state
      : {};

    try {
      window.history.replaceState(
        {
          ...currentHistoryState,
          [BUNDLE_WORKSPACE_STATE_KEY]: {
            pageKey,
            activeTab: String(configName || '').trim(),
            scrollY: Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0)),
          },
        },
        '',
        window.location.href,
      );
    } catch (error) {
      console.warn('Failed to save bundle workspace state.', error);
    }
  };

  const handleBundleItemLinkClick = (item) => {
    saveBundleWorkspaceState(getBundleOptionTitle(item) || resolvedActiveTab);
  };

  const renderBundleItemImage = (item) => {
    const href = buildBundleComponentDetailHref(item);
    const imageAlt = item?.name || 'Sản phẩm thành phần';
    const imageNode = (
      <div className={builderStyles.tableImgWrap}>
        <Image
          src={getBundleImageSrc(item)}
          alt={imageAlt}
          fill
          unoptimized
          style={{ objectFit: 'cover' }}
 
        />
      </div>
    );

    if (!href) {
      return imageNode;
    }

    return (
      <Link
        href={href}
        className={builderStyles.tableImgLink}
        title={`Xem chi tiết ${imageAlt}`}
        aria-label={`Xem chi tiết ${imageAlt}`}
        onClick={() => handleBundleItemLinkClick(item)}
        prefetch={false}
      >
        {imageNode}
      </Link>
    );
  };

  const renderBundleItemName = (item) => {
    const href = buildBundleComponentDetailHref(item);
    const itemName = item?.name || '';
    const detailTitle = `Xem chi tiết ${itemName}`;

    if (!href || !itemName) {
      return <p className={builderStyles.itemName}>{itemName}</p>;
    }

    return (
      <Link
        href={href}
        className={builderStyles.itemNameLink}
        title={detailTitle}
        aria-label={detailTitle}
        onClick={() => handleBundleItemLinkClick(item)}
        prefetch={false}
      >
        <p className={builderStyles.itemName}>{itemName}</p>
      </Link>
    );
  };

  const activeBundleOptionDisplay = useMemo(() => {
    const bundleOptions = Array.isArray(product?.bundle_options) ? product.bundle_options : [];
    const sourceBundleItems = Array.isArray(bundleItems) ? bundleItems : [];
    const selectedConfig = String(
      activeBundleConfig
      || manualActiveTab
      || bundleOptions[0]?.bundle_option_title
      || bundleOptions[0]?.title
      || bundleOptions[0]?.name
      || ''
    ).trim();

    if (!selectedConfig || bundleOptions.length === 0) {
      return null;
    }

    const selectedConfigKey = normalizeConfigMediaKey(selectedConfig);
    const selectedFamilyKey = getConfigMediaFamilyKey(selectedConfig);
    const matchedOption = bundleOptions.find((option) => {
      const optionTitle = String(
        option?.bundle_option_title
        || option?.title
        || option?.name
        || ''
      ).trim();

      return normalizeConfigMediaKey(optionTitle) === selectedConfigKey;
    }) || null;
    const matchedItems = sourceBundleItems.filter((item) => {
      const itemTitle = String(
        item?.option_title
        || item?.pivot?.option_title
        || item?.bundle_option_title
        || ''
      ).trim();
      const itemKey = normalizeConfigMediaKey(itemTitle);
      const itemFamilyKey = getConfigMediaFamilyKey(itemTitle);

      return itemKey === selectedConfigKey || (
        selectedFamilyKey
        && itemFamilyKey
        && itemFamilyKey === selectedFamilyKey
      );
    });

    if (!matchedOption && matchedItems.length === 0) {
      return null;
    }

    const firstItemWithOptionImage = matchedItems.find((item) => (
      item?.option_image || item?.pivot?.option_image || item?.option_image_url || item?.pivot?.option_image_url
    ));
    const firstItemWithOptionVideo = matchedItems.find((item) => (
      item?.option_video_url || item?.pivot?.option_video_url
    ));
    const optionVideoUrls = normalizeGalleryVideoUrls(
      matchedOption?.video_urls
      || matchedOption?.videos
      || matchedOption?.option_video_urls
      || matchedOption?.option_videos
      || [],
      matchedOption?.video_url
      || matchedOption?.option_video_url
      || firstItemWithOptionVideo?.option_video_url
      || firstItemWithOptionVideo?.pivot?.option_video_url
      || ''
    );
    const optionImage = matchedOption?.primary_image
      || matchedOption?.option_image
      || firstItemWithOptionImage?.option_image
      || firstItemWithOptionImage?.pivot?.option_image
      || (firstItemWithOptionImage?.option_image_url ? { url: firstItemWithOptionImage.option_image_url } : null)
      || (firstItemWithOptionImage?.pivot?.option_image_url ? { url: firstItemWithOptionImage.pivot.option_image_url } : null)
      || null;

    return {
      name: String(
        matchedOption?.name
        || matchedOption?.bundle_option_title
        || selectedConfig
      ).trim() || selectedConfig,
      primaryImage: optionImage,
      videoUrls: optionVideoUrls,
    };
  }, [activeBundleConfig, bundleItems, manualActiveTab, product?.bundle_options]);

  const bundleHeroProductName = activeBundleOptionDisplay?.name || product.name;
  const currentGalleryVideoUrls = useMemo(() => {
    const optionVideoUrls = normalizeGalleryVideoUrls(activeBundleOptionDisplay?.videoUrls || []);

    return optionVideoUrls.length > 0
      ? optionVideoUrls
      : normalizeGalleryVideoUrls(videoUrls, videoUrl);
  }, [activeBundleOptionDisplay?.videoUrls, videoUrl, videoUrls]);
  const hasCurrentGalleryVideo = currentGalleryVideoUrls.length > 0;

  const bundleMobileGalleryImages = useMemo(() => {
    const sourceImages = Array.isArray(images) ? images : [];
    const optionImage = activeBundleOptionDisplay?.primaryImage || null;
    const optionImageUrl = resolveImageObjectUrl(optionImage, 'large', '');
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

    if (optionImageUrl) {
      seenSources.add(optionImageUrl);
    }

    const cleanedImages = sourceImages.filter((image) => {
      const resolvedSource = getImageUrl(image);

      if (!isRenderableGallerySource(resolvedSource) || seenSources.has(resolvedSource)) {
        return false;
      }

      seenSources.add(resolvedSource);
      return true;
    });

    if (optionImageUrl) {
      return [optionImage, ...(cleanedImages.length > 0 ? cleanedImages : sourceImages)];
    }

    return cleanedImages.length > 0 ? cleanedImages : sourceImages;
  }, [activeBundleOptionDisplay?.primaryImage, getImageUrl, images]);

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

  const resolvedActiveTab = useMemo(() => {
    if (configurations.length === 0) {
      return null;
    }

    if (activeBundleConfig && configurations.includes(activeBundleConfig)) {
      return activeBundleConfig;
    }

    if (manualActiveTab && configurations.includes(manualActiveTab)) {
      return manualActiveTab;
    }

    return configurations[0];
  }, [activeBundleConfig, configurations, manualActiveTab]);

  useEffect(() => {
    if (configurations.length === 0) {
      return;
    }

    logProductTimingOnce(
      `render-option:${product?.id || ''}:${configurations.length}`,
      'render-option',
      {
        productId: product?.id,
        optionCount: configurations.length,
        activeConfig: resolvedActiveTab,
        isLite: Boolean(product?.is_bundle_option_lite),
      }
    );
  }, [configurations.length, product?.id, product?.is_bundle_option_lite, resolvedActiveTab]);

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
    if (showBundleDetailSection || typeof window === 'undefined') {
      return undefined;
    }

    let timeoutId = null;
    let idleId = null;
    const revealDetails = () => setShowBundleDetailSection(true);

    timeoutId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(revealDetails, { timeout: 1600 });
        return;
      }

      revealDetails();
    }, 500);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [showBundleDetailSection]);

  useEffect(() => {
    setIsMobileHeroConfigMenuOpen(false);
    setIsMobileConfigMenuOpen(false);
  }, [resolvedActiveTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const savedWorkspaceState = window.history?.state?.[BUNDLE_WORKSPACE_STATE_KEY];
    const currentPageKey = getBundleWorkspacePageKey();

    if (!savedWorkspaceState || savedWorkspaceState.pageKey !== currentPageKey) {
      return undefined;
    }

    pendingBundleWorkspaceRestoreRef.current = {
      activeTab: String(savedWorkspaceState.activeTab || '').trim(),
      scrollY: Math.max(0, Number(savedWorkspaceState.scrollY) || 0),
    };

    return () => {
      clearBundleWorkspaceRestoreTimers();
    };
  }, [clearBundleWorkspaceRestoreTimers]);

  useEffect(() => {
    const pendingWorkspaceState = pendingBundleWorkspaceRestoreRef.current;

    if (!pendingWorkspaceState || typeof window === 'undefined') {
      return undefined;
    }

    const desiredActiveTab = pendingWorkspaceState.activeTab;

    if (bundleItems.length === 0) {
      return undefined;
    }

    if (
      desiredActiveTab
      && configurations.includes(desiredActiveTab)
      && desiredActiveTab !== resolvedActiveTab
    ) {
      setManualActiveTab(desiredActiveTab);
      if (switchBundleConfiguration) {
        switchBundleConfiguration(desiredActiveTab);
      }
      return undefined;
    }

    clearBundleWorkspaceRestoreTimers();

    const applySavedScrollPosition = () => {
      window.scrollTo(0, pendingWorkspaceState.scrollY);
    };

    const outerAnimationFrame = window.requestAnimationFrame(() => {
      applySavedScrollPosition();

      const innerAnimationFrame = window.requestAnimationFrame(() => {
        applySavedScrollPosition();
      });

      bundleWorkspaceRestoreTimersRef.current.push({
        type: 'raf',
        id: innerAnimationFrame,
      });
    });
    const firstTimeout = window.setTimeout(applySavedScrollPosition, 120);
    const secondTimeout = window.setTimeout(applySavedScrollPosition, 320);

    bundleWorkspaceRestoreTimersRef.current.push(
      { type: 'raf', id: outerAnimationFrame },
      { type: 'timeout', id: firstTimeout },
      { type: 'timeout', id: secondTimeout },
    );

    pendingBundleWorkspaceRestoreRef.current = null;

    return () => {
      clearBundleWorkspaceRestoreTimers();
    };
  }, [bundleItems.length, clearBundleWorkspaceRestoreTimers, configurations, resolvedActiveTab, switchBundleConfiguration]);

  useEffect(() => {
    if ((!isMobileHeroConfigMenuOpen && !isMobileConfigMenuOpen) || typeof document === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileHeroConfigMenuOpen(false);
        setIsMobileConfigMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileConfigMenuOpen, isMobileHeroConfigMenuOpen]);

  const sourceBundleItems = useMemo(
    () => product.bundle_items || product.grouped_items || [],
    [product.bundle_items, product.grouped_items]
  );

  // Items of the active tab (including removed ones for placeholder)
  const tabItems = useMemo(() => {
    if (!resolvedActiveTab) return bundleItems.filter((item) => !getBundleOptionTitle(item));
    return bundleItems.filter((item) => getBundleOptionTitle(item) === resolvedActiveTab);
  }, [bundleItems, resolvedActiveTab]);

  const bundleEvaluationsByConfig = useMemo(() => {
    const evaluationMap = new Map();
    const configKeys = configurations.length > 0 ? configurations : [''];

    configKeys.forEach((configName) => {
      const currentItems = bundleItems
        .filter((item) => {
          if (item.removed) return false;

          const itemConfig = getBundleOptionTitle(item);

          if (configName) {
            return !itemConfig || itemConfig === configName;
          }

          return item.selected;
        })
        .map((item, index) => createBundleCartEntry(item, index));
      const snapshotItems = buildBundleSnapshot(sourceBundleItems, configName);

      evaluationMap.set(
        configName,
        evaluateBundleSelection(currentItems, snapshotItems, { discountRate: BUNDLE_DISCOUNT_RATE })
      );
    });

    return evaluationMap;
  }, [bundleItems, configurations, sourceBundleItems]);

  const activeEvaluationKey = resolvedActiveTab || configurations[0] || '';
  const activeBundleEvaluation = bundleEvaluationsByConfig.get(activeEvaluationKey)
    || evaluateBundleSelection([], [], { discountRate: BUNDLE_DISCOUNT_RATE });
  const isFullCombo = Boolean(activeBundleEvaluation.isFullBundle);
  const tabSubtotal = activeBundleEvaluation.currentSubtotal || 0;
  const tabDiscountAmount = activeBundleEvaluation.comboDiscountAmount || 0;
  const tabFinalPrice = activeBundleEvaluation.finalSubtotal || tabSubtotal;
  const bundleRequirementCount = activeBundleEvaluation.expectedCount || tabItems.length;

  useEffect(() => {
    if (!showBundleDetailSection) {
      return;
    }

    logProductTimingOnce(
      `render-bundle-config:${product?.id || ''}:${resolvedActiveTab || ''}:${tabItems.length}`,
      'render-bundle-components',
      {
        productId: product?.id,
        activeConfig: resolvedActiveTab,
        itemCount: tabItems.length,
        isLite: Boolean(product?.is_bundle_option_lite),
      }
    );
  }, [product?.id, product?.is_bundle_option_lite, resolvedActiveTab, showBundleDetailSection, tabItems.length]);

  // activeConfig for the upper config buttons
  const activeConfig = useMemo(() => {
    for (const config of configurations) {
      const itemsInConfig = bundleItems.filter((item) => getBundleOptionTitle(item) === config);
      if (itemsInConfig.every((item) => item.selected && !item.removed)) return config;
    }
    return null;
  }, [bundleItems, configurations]);

  const activeConfigMedia = useMemo(() => {
    const selectedConfig = resolvedActiveTab || activeConfig || configurations[0];

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
  }, [activeConfig, bundleItems, configurations, product.bundle_items, product.grouped_items, resolvedActiveTab]);

  const hasActiveConfigMedia = Boolean(activeConfigMedia?.href);

  // Subtotal of tab items (active items only)
  // Full combo subtotal (sum of all tab items at their default qty × price)
  const DISCOUNT_RATE = BUNDLE_DISCOUNT_RATE;
  // For upper info section: selectedItems (all configs) for top-level displayPrice
  const selectedItems = bundleItems.filter(item => item.selected && !item.removed);
  const subtotal = selectedItems.reduce((acc, it) => acc + (parseFloat(it.price || 0) * (it.qty || 1)), 0);

  // Use global displayPrice from parent (already computed from all selected items)
  const infoDiscount = subtotal - displayPrice;

  const isConfigEligibleForDiscount = (configName) => {
    return Boolean(bundleEvaluationsByConfig.get(configName)?.eligibleDiscount);
  };

  const openSelectionModal = (slot) => {
    setActiveSlot(slot);
    setIsModalOpen(true);
  };

  const handleSelectComponent = (newProduct) => {
    if (activeSlot) {
      updateBundleItemProduct(activeSlot.bundle_item_uid || activeSlot.id, newProduct);
    }
    setIsModalOpen(false);
  };

  // Handle tab change: update bundleItems selection state
  const handleTabChange = (tabName) => {
    setManualActiveTab(tabName);
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

  const scrollToBundleDetailControls = useCallback(({ behavior = 'smooth' } = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    cancelBundleWorkspaceRestore();

    const performScroll = () => {
      const detailSection = bundleListRef.current;

      if (!detailSection) {
        return;
      }

      const stickyOffset = isMobileBundleViewport ? getMobileStickyHeaderHeight() + 8 : 0;
      const targetTop = Math.max(
        0,
        Math.round(window.scrollY + detailSection.getBoundingClientRect().top - stickyOffset)
      );

      window.scrollTo({ top: targetTop, behavior });
    };

    if (!showBundleDetailSection) {
      setShowBundleDetailSection(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(performScroll);
      });
      return;
    }

    performScroll();
  }, [cancelBundleWorkspaceRestore, isMobileBundleViewport, showBundleDetailSection]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleBundleDetailScrollRequest = (event) => {
      const respond = typeof event.detail?.respond === 'function' ? event.detail.respond : null;

      scrollToBundleDetailControls({ behavior: 'smooth' });
      respond?.({ handled: true });
    };

    window.addEventListener(BUNDLE_DETAIL_SCROLL_REQUEST_EVENT, handleBundleDetailScrollRequest);

    return () => {
      window.removeEventListener(BUNDLE_DETAIL_SCROLL_REQUEST_EVENT, handleBundleDetailScrollRequest);
    };
  }, [scrollToBundleDetailControls]);

  const scrollToBundleGallery = ({ mediaType = 'image', behavior = 'smooth' } = {}) => {
    if (typeof window === 'undefined') {
      return;
    }

    setActiveIndex(mediaType === 'video' ? -1 : 0);

    const isVisibleElement = (element) => {
      if (!element || typeof element.getBoundingClientRect !== 'function') {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const computedStyle = typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(element)
        : null;

      return (
        rect.width > 1
        && rect.height > 1
        && computedStyle?.display !== 'none'
        && computedStyle?.visibility !== 'hidden'
      );
    };

    const findVisibleGalleryTarget = () => {
      const isMobileViewportNow = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 768px)').matches
        : isMobileBundleViewport;
      const preferredRoots = isMobileViewportNow
        ? [mobileGalleryRef.current, gallerySectionRef.current]
        : [desktopGalleryRef.current, gallerySectionRef.current];

      for (const root of preferredRoots) {
        if (!root) {
          continue;
        }

        const stage = root.querySelector?.(
          `[data-product-gallery-stage="true"][data-product-gallery-mode="${mediaType}"]`
        ) || root.querySelector?.('[data-product-gallery-stage="true"]');
        const target = stage || root;

        if (isVisibleElement(target)) {
          return { target, isMobileViewportNow };
        }
      }

      const visibleStage = Array.from(document.querySelectorAll(
        `[data-bundle-gallery-root="true"] [data-product-gallery-stage="true"][data-product-gallery-mode="${mediaType}"], `
        + '[data-bundle-gallery-root="true"] [data-product-gallery-stage="true"]'
      ))
        .find(isVisibleElement);

      if (visibleStage) {
        return { target: visibleStage, isMobileViewportNow };
      }

      const fallbackTarget = [galleryAnchorRef.current, gallerySectionRef.current].find(isVisibleElement);

      return fallbackTarget ? { target: fallbackTarget, isMobileViewportNow } : null;
    };

    const scrollWhenGalleryIsReady = () => {
      const visibleGallery = findVisibleGalleryTarget();

      if (!visibleGallery) {
        return;
      }

      const stickyOffset = visibleGallery.isMobileViewportNow ? getMobileStickyHeaderHeight() + 12 : 12;
      const targetTop = Math.max(
        0,
        Math.round(window.scrollY + visibleGallery.target.getBoundingClientRect().top - stickyOffset)
      );

      window.scrollTo({ top: targetTop, behavior });
    };

    const runScrollAttempts = (attempt = 0) => {
      scrollWhenGalleryIsReady();

      if (attempt >= 2) {
        return;
      }

      window.requestAnimationFrame(() => runScrollAttempts(attempt + 1));
    };

    window.requestAnimationFrame(() => runScrollAttempts());
    window.setTimeout(scrollWhenGalleryIsReady, 120);
  };

  const renderGalleryJumpButtons = ({ mobile = false } = {}) => (
    <div
      className={[
        mobile ? builderStyles.mobileGalleryJumpActions : builderStyles.galleryJumpActions,
        !hasCurrentGalleryVideo ? builderStyles.galleryJumpActionsSingle : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className={mobile ? builderStyles.mobileGalleryJumpBtn : builderStyles.galleryJumpBtn}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          scrollToBundleGallery({ mediaType: 'image' });
        }}
      >
        <span className="material-symbols-outlined">image</span>
        <span>Xem ảnh</span>
      </button>

      {hasCurrentGalleryVideo ? (
        <button
          type="button"
          className={mobile ? builderStyles.mobileGalleryJumpBtn : builderStyles.galleryJumpBtn}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            scrollToBundleGallery({ mediaType: 'video' });
          }}
        >
          <span className="material-symbols-outlined">play_circle</span>
          <span>Xem video</span>
        </button>
      ) : null}
    </div>
  );

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

  const handleMobileHeroConfigSelection = (configName) => {
    handleTabChange(configName);
    closeBundleActions();
    setIsMobileHeroConfigMenuOpen(false);

    if (typeof window === 'undefined' || !isMobileBundleViewport) {
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

  const renderBundleConfigGrid = () => {
    if (configurations.length === 0) {
      return null;
    }

    const selectedConfig = resolvedActiveTab || configurations[0];
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

        <div
          className={`${builderStyles.mobileConfigDropdown} ${isMobileConfigMenuOpen ? builderStyles.mobileConfigDropdownOpen : ''}`}
        >
          {isMobileConfigMenuOpen ? (
            <div
              className={builderStyles.mobileConfigDropdownBackdrop}
              aria-hidden="true"
              onPointerDown={closeMobileConfigMenu}
            />
          ) : null}

          <div className={builderStyles.mobileConfigDropdownRow}>
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isMobileConfigMenuOpen}
              className={`${builderStyles.mobileConfigDropdownTrigger} ${isMobileConfigMenuOpen ? builderStyles.mobileConfigDropdownTriggerOpen : ''}`}
              onPointerDown={stopDropdownEventPropagation}
              onClick={() => setIsMobileConfigMenuOpen((currentValue) => !currentValue)}
            >
              <span className={builderStyles.mobileConfigDropdownValueWrap}>
                <span className={builderStyles.mobileConfigDropdownValue}>{selectedConfig}</span>
              </span>

              <span className={builderStyles.mobileConfigDropdownActions}>
                <DropdownChevron
                  className={builderStyles.mobileConfigDropdownArrow}
                  openClassName={builderStyles.mobileConfigDropdownArrowOpen}
                  isOpen={isMobileConfigMenuOpen}
                />
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
            <div
              className={builderStyles.mobileConfigDropdownMenu}
              role="listbox"
              aria-label="Danh s\u00E1ch c\u1EA5u h\u00ECnh b\u1ED9"
              onPointerDown={stopDropdownEventPropagation}
              onClick={stopDropdownEventPropagation}
            >
              {configurations.map((config, index) => {
                const isSelected = resolvedActiveTab === config;
                const isDiscountReady = isConfigEligibleForDiscount(config);

                return (
                  <Fragment key={config}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${builderStyles.mobileConfigDropdownOption} ${isSelected ? builderStyles.mobileConfigDropdownOptionActive : ''}`}
                    onClick={(event) => {
                      if (!shouldHandleDropdownOptionSelection(event)) {
                        return;
                      }
                      handleTabChange(config);
                      closeMobileConfigMenu();
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
                  {index < configurations.length - 1 ? (
                    <div
                      className={builderStyles.mobileConfigDropdownSpacer}
                      aria-hidden="true"
                      onPointerDown={stopDropdownEventPropagation}
                      onClick={stopDropdownEventPropagation}
                    />
                  ) : null}
                  </Fragment>
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
                      : `Đủ ${bundleRequirementCount} món: -${(DISCOUNT_RATE * 100).toFixed(0)}%`}
                  </span>
                </span>

              {handleBuyTabConfig && tabItems.some((item) => !item.removed) ? (
                <button
                  type="button"
                  className={builderStyles.mobileConfigBuyBtn}
                  onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
                  style={sentenceCaseButtonStyle}
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

        {tabItems.length > 0 ? renderGalleryJumpButtons({ mobile: true }) : null}
      </div>
    );
  };

  const renderMobileHeroConfigSelector = () => {
    if (configurations.length === 0) {
      return null;
    }

    const selectedConfig = resolvedActiveTab || activeConfig || configurations[0];

    return (
      <div
        className={`${styles.configOptionsMobileDropdown} ${isMobileHeroConfigMenuOpen ? styles.configOptionsMobileDropdownOpen : ''}`}
        data-bundle-top-config-selector="true"
      >
        {isMobileHeroConfigMenuOpen ? (
          <div
            className={styles.configOptionsMobileBackdrop}
            aria-hidden="true"
            onPointerDown={closeMobileHeroConfigMenu}
          />
        ) : null}

        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isMobileHeroConfigMenuOpen}
          className={`${styles.configOptionsMobileTrigger} ${isMobileHeroConfigMenuOpen ? styles.configOptionsMobileTriggerOpen : ''}`}
          onPointerDown={stopDropdownEventPropagation}
          onClick={() => setIsMobileHeroConfigMenuOpen((currentValue) => !currentValue)}
        >
          <span className={styles.configOptionsMobileTriggerCopy}>
            <span className={styles.configOptionsMobileTriggerValue}>{selectedConfig}</span>
          </span>

          <DropdownChevron
            className={styles.configOptionsMobileTriggerArrow}
            openClassName={styles.configOptionsMobileTriggerArrowOpen}
            isOpen={isMobileHeroConfigMenuOpen}
          />
        </button>

        {isMobileHeroConfigMenuOpen ? (
          <div
            className={styles.configOptionsMobileMenu}
            role="listbox"
            onPointerDown={stopDropdownEventPropagation}
            onClick={stopDropdownEventPropagation}
            aria-label={product.bundle_title || 'Danh sách cấu hình bộ'}
          >
            {configurations.map((config, index) => {
              const isActive = selectedConfig === config;

              return (
                <Fragment key={config}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`${styles.configOptionsMobileOption} ${isActive ? styles.configOptionsMobileOptionActive : ''}`}
                  onClick={(event) => {
                    if (!shouldHandleDropdownOptionSelection(event)) {
                      return;
                    }
                    handleMobileHeroConfigSelection(config);
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
                {index < configurations.length - 1 ? (
                  <div
                    className={styles.configOptionsMobileSpacer}
                    aria-hidden="true"
                    onPointerDown={stopDropdownEventPropagation}
                    onClick={stopDropdownEventPropagation}
                  />
                ) : null}
                </Fragment>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderBundleDetailControls = () => (
    <>
      {configurations.length > 0 && (
        <div className={builderStyles.tabBar}>
          {configurations.map(config => (
            <button
              key={config}
              className={`${builderStyles.tabBtn} ${resolvedActiveTab === config ? builderStyles.tabBtnActive : ''}`}
              onClick={() => handleTabChange(config)}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {resolvedActiveTab === config ? 'radio_button_checked' : 'radio_button_unchecked'}
              </span>
              {config}
              {(() => {
                const full = isConfigEligibleForDiscount(config);
                return full
                  ? <span className={builderStyles.tabFullDot} title="Äá»§ Ä‘iá»u kiá»‡n giáº£m giÃ¡"></span>
                  : null;
              })()}
            </button>
          ))}
        </div>
      )}

      {tabItems.length > 0 && (
              <div className={`${builderStyles.topActionBar} ${builderStyles.topActionBarWithMedia}`}>
                {isFullCombo ? (
                  <div className={builderStyles.discountBannerInline}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
                    <span>Báº¡n Ä‘ang mua trá»n bá»™ â€” Æ¯u Ä‘Ã£i giáº£m <strong>{(DISCOUNT_RATE * 100).toFixed(0)}%</strong>!</span>
                  </div>
          ) : (
            <div className={builderStyles.discountHintInline}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>info</span>
                    <span>Mua Ä‘á»§ <strong>{bundleRequirementCount} mÃ³n</strong> nháº­n Æ°u Ä‘Ã£i giáº£m {(DISCOUNT_RATE * 100).toFixed(0)}%</span>
                  </div>
                )}

                {renderGalleryJumpButtons()}

                <div className={builderStyles.quickSummaryTopInline}>
                  <div className={builderStyles.quickSummaryPrice}>
                    <span className={builderStyles.quickSummaryLabel}>Thanh toÃ¡n:</span>
              <span className={builderStyles.quickSummaryValue}>{formatPrice(tabFinalPrice)}</span>
            </div>
            {handleBuyTabConfig && tabItems.some(i => !i.removed) && (
              <button
                className={builderStyles.buyTabBtnSmall}
                onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
                style={sentenceCaseButtonStyle}
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
      <div className={styles.bundlePageSections}>
        <div className={styles.mainGrid}>
          {/* Gallery */}
          <div
            id="bundle-product-gallery"
            className={styles.galleryColumn}
            ref={gallerySectionRef}
            data-bundle-gallery-root="true"
          >
            <span
              ref={galleryAnchorRef}
              data-bundle-gallery-anchor="true"
              aria-hidden="true"
              style={{ display: 'block', height: 1, marginBottom: -1, scrollMarginTop: '96px' }}
            />
            <div className={styles.bundleGalleryDesktopOnly} ref={desktopGalleryRef}>
              <ProductGallery
                images={bundleMobileGalleryImages}
                videoUrl={currentGalleryVideoUrls[0] || ''}
                videoUrls={currentGalleryVideoUrls}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                getImageUrl={getImageUrl}
                productName={bundleHeroProductName}
                priorityFirstImage
              />
            </div>

            <div className={`${styles.bundleGalleryMobileOnly} ${styles.configurableMediaShell}`} ref={mobileGalleryRef}>
              <ProductGallery
                images={bundleMobileGalleryImages}
                videoUrl={currentGalleryVideoUrls[0] || ''}
                videoUrls={currentGalleryVideoUrls}
                activeIndex={activeIndex}
                setActiveIndex={setActiveIndex}
                getImageUrl={getImageUrl}
                productName={bundleHeroProductName}
                showSingleThumbnail
                priorityFirstImage={false}
              />
            </div>
          </div>

          {/* Info */}
          <div className={styles.infoColumn}>
            <div className={styles.infoWrapper}>
              <div className={styles.titleSection}>
                <h1 className={styles.title}>{bundleHeroProductName}</h1>
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
                        const displayImgSrc = getBundleImageSrc(bundle);
                        return (
                          <Link href={`/product/${bundle.slug}`} key={bundle.id}
                            className={`${styles.relatedOptionBtn} ${isSelected ? styles.relatedOptionBtnActive : ''}`}
                            title={bundle.name}
                          >
                            <div className={styles.relatedOptionImgWrap}>
                              {displayImgSrc
                                ? <Image src={displayImgSrc} alt={txt} fill unoptimized sizes="30px" style={{ objectFit: 'cover' }} />
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
                <BuyButtons
                  onAddToCart={handleAddToCart}
                  onBuyNow={handleBuyNow}
                  addToCartLabel="Thêm vào giỏ"
                  buyNowLabel="Mua ngay"
                  disableUppercase
                />
              </div>

              <TrustBadges />
            </div>
          </div>
        </div>

        {/* ===== Chi tiết thành phần bộ ===== */}
        <div
          id="bundle-list"
          ref={bundleListRef}
          className={`${styles.bundleDetailSection} pt-16 border-t border-stone/10`}
        >
          {showBundleDetailSection ? (
            <>
          <div className="text-center" style={{ marginBottom: '10px' }}>
            <h2
              className="font-display font-bold text-primary italic"
              style={{
                marginBottom: '10px',
                fontSize: isMobileBundleViewport ? '18px' : '30px',
                lineHeight: isMobileBundleViewport ? '1.25' : undefined,
              }}
            >
              Chi tiết thành phần bộ
            </h2>
            <div className="w-20 h-1 bg-accent mx-auto rounded-full"></div>
            <p
              className="text-stone/50 max-w-2xl mx-auto"
              style={{
                marginTop: '10px',
                fontSize: isMobileBundleViewport ? '14px' : '18px',
                lineHeight: isMobileBundleViewport ? '1.5' : undefined,
              }}
            >
              Tùy chỉnh số lượng hoặc thay đổi từng món theo từng cấu hình để phù hợp nhu cầu của Quý khách.
            </p>
          </div>

          <div className="max-w-5xl mx-auto" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            <div className={builderStyles.mobileStickyCluster}>
              <div className={builderStyles.tabBarGridWrap}>
                {renderBundleConfigGrid()}
              </div>

              {/* === Tab bar === */}
            {configurations.length > 0 && (
              <div className={builderStyles.tabBar}>
                {configurations.map(config => (
                  <button
                    key={config}
                    className={`${builderStyles.tabBtn} ${resolvedActiveTab === config ? builderStyles.tabBtnActive : ''}`}
                    onClick={() => handleTabChange(config)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {resolvedActiveTab === config ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    {config}
                    {/* Green dot if full combo */}
                    {(() => {
                      const full = isConfigEligibleForDiscount(config);
                      return full
                        ? <span className={builderStyles.tabFullDot} title="Đủ điều kiện giảm giá"></span>
                        : null;
                    })()}
                  </button>
                ))}
              </div>
            )}

              {/* === Top Action Bar === */}
            {tabItems.length > 0 && (
              <div className={`${builderStyles.topActionBar} ${builderStyles.topActionBarWithMedia}`}>
                {isFullCombo ? (
                  <div className={builderStyles.discountBannerInline}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_offer</span>
                    <span>Bạn đang mua trọn bộ — Ưu đãi giảm <strong>{(DISCOUNT_RATE * 100).toFixed(0)}%</strong>!</span>
                  </div>
                ) : (
                  <div className={builderStyles.discountHintInline}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>info</span>
                    <span>Mua đủ <strong>{bundleRequirementCount} món</strong> nhận ưu đãi giảm {(DISCOUNT_RATE * 100).toFixed(0)}%</span>
                  </div>
                )}

                {renderGalleryJumpButtons()}

                <div className={builderStyles.quickSummaryTopInline}>
                  <div className={builderStyles.quickSummaryPrice}>
                    <span className={builderStyles.quickSummaryLabel}>Thanh toán:</span>
                    <span className={builderStyles.quickSummaryValue}>{formatPrice(tabFinalPrice)}</span>
                  </div>
                  {handleBuyTabConfig && tabItems.some(i => !i.removed) && (
                    <button
                      className={builderStyles.buyTabBtnSmall}
                      onClick={() => handleBuyTabConfig(tabItems, tabFinalPrice)}
                      style={sentenceCaseButtonStyle}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>shopping_cart_checkout</span>
                      Mua ngay
                    </button>
                  )}
                </div>
              </div>
            )}
            </div>

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
                    const itemKey = item.bundle_item_uid || item.id;

                    if (item.removed) {
                      if (isMobileBundleViewport) {
                        return (
                          <div
                            key={itemKey}
                            className={`${builderStyles.tableRow} ${builderStyles.tableRowRemoved} ${builderStyles.tableRowMobileCompact} ${builderStyles.tableRowRemovedCompact}`}
                          >
                            <div className={builderStyles.colStt}>
                              <span className={builderStyles.sttBadge} style={{ opacity: 0.3 }}>{idx + 1}</span>
                            </div>
                            <div className={builderStyles.colImg}>
                              <div className={`${builderStyles.tableImgWrap} ${builderStyles.tableImgEmpty}`}>
                                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ccc' }}>image_not_supported</span>
                              </div>
                            </div>
                            <div className={`${builderStyles.mobileItemContent} ${builderStyles.mobileRemovedContent}`}>
                              <div className={builderStyles.colName}>
                                <p className={builderStyles.removedLabel}>Vị trí đã xóa</p>
                                <span className={builderStyles.variantHint}>Chọn sản phẩm thay thế cho vị trí này</span>
                              </div>
                              <div className={`${builderStyles.mobileItemBottom} ${builderStyles.mobileRemovedBottom}`}>
                                <div className={`${builderStyles.mobilePriceStack} ${builderStyles.mobileRemovedMeta}`}>
                                  <div className={builderStyles.mobilePriceLine}>
                                    <span className={builderStyles.mobileMetaLabel}>Thành tiền</span>
                                    <span className={builderStyles.removedMetaValue}>—</span>
                                  </div>
                                </div>
                                <div className={`${builderStyles.mobileControlStack} ${builderStyles.mobileRemovedActions}`}>
                                  <button
                                    className={builderStyles.restoreBtn}
                                    onClick={() => restoreBundleItem ? restoreBundleItem(item.bundle_item_uid || item.id) : null}
                                    title="Khôi phục sản phẩm"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>restart_alt</span>
                                    Khôi phục
                                  </button>
                                  <button
                                    className={builderStyles.selectSlotBtn}
                                    onClick={() => openSelectionModal(item)}
                                    title="Chọn sản phẩm khác"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>add</span>
                                    Chọn lại
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Placeholder row
                      return (
                        <div key={itemKey} className={`${builderStyles.tableRow} ${builderStyles.tableRowRemoved}`}>
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
                              onClick={() => restoreBundleItem ? restoreBundleItem(item.bundle_item_uid || item.id) : null}
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
                        <div key={itemKey} className={`${builderStyles.tableRow} ${builderStyles.tableRowMobileCompact}`}>
                          <div className={builderStyles.colStt}>
                            <span className={builderStyles.sttBadge}>{idx + 1}</span>
                          </div>

                          <div className={builderStyles.colImg}>
                            {renderBundleItemImage(item)}
                          </div>

                          <div className={builderStyles.mobileItemContent}>
                            <div className={builderStyles.colName}>
                              <div className={builderStyles.nameRow}>
                                {renderBundleItemName(item)}
                                <button
                                  className={builderStyles.inlineChangeBtn}
                                  onClick={() => openSelectionModal(item)}
                                  title={BUNDLE_ITEM_CHANGE_TITLE}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>swap_horiz</span>
                                  {BUNDLE_ITEM_CHANGE_LABEL}
                                </button>
                              </div>
                            </div>

                            <div className={builderStyles.mobileItemBottom}>
                              <div className={builderStyles.mobilePriceStack}>
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
                                      onClick={() => updateBundleItemQuantity(item.bundle_item_uid || item.id, (item.qty || 1) - 1)}
                                      disabled={(item.qty || 1) <= 1}
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove</span>
                                    </button>
                                    <span className={builderStyles.qtyDisplay}>{item.qty || 1}</span>
                                    <button
                                      className={builderStyles.qtyBtn}
                                      onClick={() => updateBundleItemQuantity(item.bundle_item_uid || item.id, (item.qty || 1) + 1)}
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                                    </button>
                                  </div>
                                </div>

                                <div className={builderStyles.colActions}>
                                  <button
                                    className={builderStyles.deleteBtn}
                                    onClick={() => removeBundleItem(item.bundle_item_uid || item.id)}
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
                      <div key={itemKey} className={builderStyles.tableRow}>
                        {/* STT */}
                        <div className={builderStyles.colStt}>
                          <span className={builderStyles.sttBadge}>{idx + 1}</span>
                        </div>

                        {/* Image */}
                        <div className={builderStyles.colImg}>
                          {renderBundleItemImage(item)}
                        </div>

                        {/* Name + change button inline */}
                        <div className={builderStyles.colName}>
                          <div className={builderStyles.nameRow}>
                            {renderBundleItemName(item)}
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
                              onClick={() => updateBundleItemQuantity(item.bundle_item_uid || item.id, (item.qty || 1) - 1)}
                              disabled={(item.qty || 1) <= 1}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove</span>
                            </button>
                            <span className={builderStyles.qtyDisplay}>{item.qty || 1}</span>
                            <button className={builderStyles.qtyBtn}
                              onClick={() => updateBundleItemQuantity(item.bundle_item_uid || item.id, (item.qty || 1) + 1)}
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
                            onClick={() => removeBundleItem(item.bundle_item_uid || item.id)}
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
                        Tổng {tabItems.filter(i => !i.removed).length} món ({resolvedActiveTab || 'bộ hiện tại'}):
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
                        style={sentenceCaseButtonStyle}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>shopping_cart_checkout</span>
                        Mua bộ {resolvedActiveTab || 'này'} ngay
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
            </>
          ) : (
            <div style={{ minHeight: 1 }} aria-hidden="true" />
          )}
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
