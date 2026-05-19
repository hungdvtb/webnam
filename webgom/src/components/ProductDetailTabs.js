'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import config from '@/lib/config';
import { getPolicyPosts } from '@/lib/policyContent';
import BlogArticleContent from '@/components/blog/BlogArticleContent';
import styles from '@/app/product/[slug]/product.module.css';

const DESCRIPTION_TAB = 'description';
const POLICY_TAB = 'policy';
const PRODUCT_INFO_SCROLL_EVENT = 'webgom:product-info-section-request';
const DESCRIPTION_SECTION_ID = 'description-section';
const PRODUCT_INFO_POLICY_SECTION_BY_ID = {
  'doi-tra': 'refund-policy-section',
  'kiem-hang': 'inspection-policy-section',
  'giao-hang': 'shipping-policy-section',
  'bao-hanh': 'warranty-policy-section',
};
const PRODUCT_INFO_POLICY_ID_BY_SECTION = Object.entries(PRODUCT_INFO_POLICY_SECTION_BY_ID).reduce(
  (result, [policyId, sectionId]) => ({
    ...result,
    [sectionId]: policyId,
  }),
  {},
);
const DESCRIPTION_LABEL = 'M\u00f4 t\u1ea3 chi ti\u1ebft';
const POLICY_LABEL = 'Ch\u00ednh s\u00e1ch b\u00e1n h\u00e0ng';
const EMPTY_DESCRIPTION = '\u0110ang c\u1eadp nh\u1eadt n\u1ed9i dung...';
const LOADING_POLICIES = '\u0110ang t\u1ea3i n\u1ed9i dung ch\u00ednh s\u00e1ch...';
const EMPTY_POLICIES = 'Ch\u01b0a c\u00f3 n\u1ed9i dung ch\u00ednh s\u00e1ch \u0111\u1ec3 hi\u1ec3n th\u1ecb.';

function resolveImageSrc(image) {
  if (!image || (!image.url && !image.path)) {
    return '';
  }

  if (image.url) {
    if (image.url.startsWith('http') || image.url.startsWith('/')) {
      return image.url;
    }
  }

  if (!image.path) {
    return '';
  }

  return `${config.storageUrl}/${image.path}`;
}

function getProductInfoScrollOffset() {
  if (typeof document === 'undefined') {
    return 88;
  }

  const stickyHeader = document.querySelector('.mobile-sticky-header-shell');
  const stickyHeaderHeight = Math.round(
    stickyHeader?.getBoundingClientRect?.().height || stickyHeader?.offsetHeight || 0,
  );

  return stickyHeaderHeight > 0 ? stickyHeaderHeight + 10 : 88;
}

function scrollToProductSectionId(sectionId = '') {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const targetNode = document.getElementById(sectionId);

  if (!targetNode) {
    return false;
  }

  const targetTop = Math.max(
    0,
    Math.round(window.scrollY + targetNode.getBoundingClientRect().top - getProductInfoScrollOffset()),
  );

  window.scrollTo({ top: targetTop, behavior: 'smooth' });
  return true;
}

export default function ProductDetailTabs({
  descriptionHtml = '',
  mainImage = null,
  policyPosts = [],
  lazyImage = false,
}) {
  const [activeTab, setActiveTab] = useState(DESCRIPTION_TAB);
  const [activePolicyId, setActivePolicyId] = useState('');
  const [fetchedPolicies, setFetchedPolicies] = useState([]);
  const [policyStatus, setPolicyStatus] = useState('idle');
  const policyRequestStartedRef = useRef(false);
  const pendingProductInfoScrollRef = useRef('');

  const policies = useMemo(() => {
    const sourcePolicies = Array.isArray(policyPosts) && policyPosts.length > 0
      ? policyPosts
      : fetchedPolicies;

    return sourcePolicies.map((policy) => ({
      ...policy,
      sectionId: PRODUCT_INFO_POLICY_SECTION_BY_ID[policy.id] || '',
    }));
  }, [fetchedPolicies, policyPosts]);

  const loadPoliciesIfNeeded = useCallback(() => {
    if (policies.length > 0 || policyRequestStartedRef.current) {
      return;
    }

    policyRequestStartedRef.current = true;
    setPolicyStatus('loading');

    getPolicyPosts()
      .then((items) => {
        setFetchedPolicies(items);
        setPolicyStatus('ready');
      })
      .catch(() => {
        setPolicyStatus('error');
      });
  }, [policies.length]);

  const safeDescriptionHtml = useMemo(() => {
    const normalizedDescription = typeof descriptionHtml === 'string' ? descriptionHtml.trim() : '';
    return normalizedDescription || EMPTY_DESCRIPTION;
  }, [descriptionHtml]);

  const imageSrc = resolveImageSrc(mainImage);
  const showPolicies = activeTab === POLICY_TAB;
  const activePolicy = useMemo(() => {
    if (policies.length === 0) {
      return null;
    }

    return policies.find((policy) => policy.id === activePolicyId) || policies[0];
  }, [activePolicyId, policies]);
  const activePolicyContent = typeof activePolicy?.content === 'string' ? activePolicy.content.trim() : '';

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleProductInfoScrollRequest = (event) => {
      const sectionId = String(event?.detail?.sectionId || '').trim();

      if (!sectionId) {
        return;
      }

      if (sectionId === DESCRIPTION_SECTION_ID) {
        if (typeof event.detail?.respond === 'function') {
          event.detail.respond({ success: true });
        }

        pendingProductInfoScrollRef.current = sectionId;
        setActiveTab(DESCRIPTION_TAB);
        return;
      }

      const policyId = PRODUCT_INFO_POLICY_ID_BY_SECTION[sectionId];

      if (!policyId) {
        return;
      }

      if (typeof event.detail?.respond === 'function') {
        event.detail.respond({ success: true });
      }

      pendingProductInfoScrollRef.current = sectionId;
      setActivePolicyId(policyId);
      setActiveTab(POLICY_TAB);
      loadPoliciesIfNeeded();
    };

    window.addEventListener(PRODUCT_INFO_SCROLL_EVENT, handleProductInfoScrollRequest);

    return () => {
      window.removeEventListener(PRODUCT_INFO_SCROLL_EVENT, handleProductInfoScrollRequest);
    };
  }, [loadPoliciesIfNeeded]);

  useEffect(() => {
    const sectionId = pendingProductInfoScrollRef.current;

    if (!sectionId || typeof window === 'undefined') {
      return undefined;
    }

    if (sectionId === DESCRIPTION_SECTION_ID && activeTab !== DESCRIPTION_TAB) {
      return undefined;
    }

    const pendingPolicyId = PRODUCT_INFO_POLICY_ID_BY_SECTION[sectionId];

    if (pendingPolicyId) {
      if (activeTab !== POLICY_TAB || activePolicy?.id !== pendingPolicyId) {
        return undefined;
      }

      if (policies.length === 0 && policyStatus === 'loading') {
        return undefined;
      }
    }

    const frameId = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (scrollToProductSectionId(sectionId)) {
          pendingProductInfoScrollRef.current = '';
        }
      }, 40);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activePolicy?.id, activeTab, policies.length, policyStatus]);

  return (
    <div className={styles.tabsSection}>
      <div className={styles.tabHeader} role="tablist" aria-label={'Th\u00f4ng tin s\u1ea3n ph\u1ea9m'}>
        <button
          type="button"
          role="tab"
          aria-selected={!showPolicies}
          className={`${styles.tabButton} ${!showPolicies ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab(DESCRIPTION_TAB)}
        >
          {DESCRIPTION_LABEL}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showPolicies}
          className={`${styles.tabButton} ${showPolicies ? styles.tabButtonActive : ''}`}
          onClick={() => {
            setActiveTab(POLICY_TAB);
            loadPoliciesIfNeeded();
          }}
        >
          {POLICY_LABEL}
        </button>
      </div>

      <div className={styles.tabContent}>
        {!showPolicies ? (
          <div id={DESCRIPTION_SECTION_ID} className={styles.productInfoAnchor}>
            <div
              className={styles.descBody}
              dangerouslySetInnerHTML={{ __html: safeDescriptionHtml }}
            />
            {imageSrc ? (
              <div className={styles.descImage}>
                <Image
                  src={imageSrc}
                  alt={DESCRIPTION_LABEL}
                  fill
                  unoptimized
                  sizes="(max-width: 768px) 100vw, 80vw"
                  style={{ objectFit: 'cover' }}
                  loading={lazyImage ? 'lazy' : undefined}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.policyTabPanel}>
            {policyStatus === 'loading' && policies.length === 0 ? (
              <p className={styles.policyStatus}>{LOADING_POLICIES}</p>
            ) : null}

            {policies.length > 0 ? (
              <>
                <div className={styles.policyPicker} role="tablist" aria-label="Danh m\u1ee5c ch\u00ednh s\u00e1ch">
                  {policies.map((policy) => {
                    const isActivePolicy = activePolicy?.id === policy.id;

                    return (
                      <button
                        key={policy.id || policy.postSlug}
                        type="button"
                        role="tab"
                        aria-selected={isActivePolicy}
                        className={`${styles.policyCard} ${isActivePolicy ? styles.policyCardActive : ''}`}
                        onClick={() => setActivePolicyId(policy.id)}
                      >
                        <span className={styles.policyCardIconWrap} aria-hidden="true">
                          <span className="material-symbols-outlined">
                            {policy.icon || 'article'}
                          </span>
                        </span>
                        <span className={styles.policyCardCopy}>
                          <span className={styles.policyCardTitle}>{policy.title || policy.label}</span>
                        </span>
                        <span className={styles.policyCardAction} aria-hidden="true">
                          <span className="material-symbols-outlined">chevron_right</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <section
                  id={activePolicy?.sectionId || undefined}
                  className={`${styles.policyDetail} ${styles.productInfoAnchor}`}
                >
                  {activePolicyContent ? (
                    <BlogArticleContent
                      html={activePolicyContent}
                      className={styles.policyArticle}
                      contentKey={`product-policy:${activePolicy?.id || activePolicy?.postSlug || ''}:${activePolicyContent.length}`}
                    />
                  ) : (
                    <p className={styles.policyStatus}>{EMPTY_POLICIES}</p>
                  )}
                </section>
              </>
            ) : policyStatus !== 'loading' ? (
              <p className={styles.policyStatus}>{EMPTY_POLICIES}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
