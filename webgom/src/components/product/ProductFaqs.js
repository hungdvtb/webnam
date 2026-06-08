'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWebProductFaqs } from '@/lib/api';
import {
  resolveImageObjectUrl,
  resolveVideoEmbedUrl,
  resolveVideoThumbnailUrl,
} from '@/lib/media';
import styles from '@/app/product/[slug]/product.module.css';

const ANSWER_PREVIEW_CHARS = 220;
const ANSWER_PREVIEW_LINES = 4;
const SWIPE_THRESHOLD = 48;
const HIDDEN_FAQ_STATUSES = new Set(['hidden', 'inactive', 'disabled', 'draft', 'false', '0']);

const toText = (value) => (
  value === null || value === undefined
    ? ''
    : (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value).trim()
      : '')
);

const parseJsonArray = (value) => {
  if (typeof value !== 'string' || !/^\s*[\[{]/.test(value)) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch {
    return null;
  }
};

const normalizeFaqImages = (images) => {
  const parsedImages = parseJsonArray(images);
  const rawImages = parsedImages || images;

  if (Array.isArray(rawImages)) {
    return rawImages.filter(Boolean);
  }

  if (rawImages && typeof rawImages === 'object') {
    return [rawImages];
  }

  const imageUrl = toText(rawImages);
  return imageUrl ? [imageUrl] : [];
};

const getFaqImageUrl = (image, preferred = 'large') => (
  resolveImageObjectUrl(image, preferred, '') || resolveImageObjectUrl(image, 'large', '')
);

const toSortOrder = (value, fallback) => {
  const order = Number(value);
  return Number.isFinite(order) ? order : fallback;
};

const normalizeFaqStatus = (value) => {
  if (value === false) {
    return 'hidden';
  }

  if (value === true || value === null || value === undefined) {
    return 'visible';
  }

  return toText(value).toLowerCase() || 'visible';
};

const getFaqVideoUrl = (item = {}) => {
  const candidates = [
    item.youtube_url,
    item.youtubeUrl,
    item.youtube,
    item.video_url,
    item.videoUrl,
    item.video,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const nestedUrl = toText(
        candidate.url
        || candidate.video_url
        || candidate.videoUrl
        || candidate.youtube_url
        || candidate.youtubeUrl
        || candidate.src
      );

      if (nestedUrl) {
        return nestedUrl;
      }
    }

    const videoUrl = toText(candidate);
    if (videoUrl) {
      return videoUrl;
    }
  }

  return '';
};

const answerNeedsToggle = (answer) => {
  if (!answer) {
    return false;
  }

  const lineCount = answer.split(/\r\n|\r|\n/).length;
  return answer.length > ANSWER_PREVIEW_CHARS || lineCount > ANSWER_PREVIEW_LINES;
};

const normalizeFaqPayload = (payload) => {
  const rawItems = Array.isArray(payload?.items)
    ? payload.items
    : (Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []));

  return rawItems
    .map((item, index) => {
      const sortOrder = toSortOrder(item?.sort_order ?? item?.sortOrder, index + 1);
      const id = item?.id ?? `${sortOrder}-${toText(item?.question).slice(0, 32) || index}`;

      return {
        id,
        question: toText(item?.question),
        answer: toText(item?.answer),
        images: normalizeFaqImages(item?.images),
        youtube_url: getFaqVideoUrl(item),
        status: normalizeFaqStatus(item?.status),
        sort_order: sortOrder,
      };
    })
    .filter((item) => !HIDDEN_FAQ_STATUSES.has(item.status) && item.question)
    .sort((first, second) => (
      first.sort_order - second.sort_order
      || String(first.id).localeCompare(String(second.id), 'vi')
    ));
};

const getDefaultOpenFaqIds = (items) => (
  items.reduce((openMap, item) => {
    openMap[item.id] = true;
    return openMap;
  }, {})
);

const preserveOpenFaqIds = (current, items) => {
  const itemIds = new Set(items.map((item) => String(item.id)));
  const hasCurrentOpenItem = Object.entries(current || {}).some(([id, isOpen]) => (
    isOpen === true && itemIds.has(String(id))
  ));

  return hasCurrentOpenItem ? current : getDefaultOpenFaqIds(items);
};

const toPositiveId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const getFaqProductIds = (product) => {
  const candidates = [
    product?.id,
    product?.product_id,
    product?.productId,
    product?.faq_product_id,
    product?.faqProductId,
    product?.selected_product_id,
    product?.selectedProductId,
    product?.variant_id,
    product?.variantId,
    product?.default_variant_id,
    product?.defaultVariantId,
    product?.parent_product_id,
    product?.parentProductId,
    product?.base_product_id,
    product?.baseProductId,
  ];
  const seen = new Set();

  return candidates
    .map(toPositiveId)
    .filter((id) => {
      if (!id || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });
};

const fetchNormalizedProductFaqs = async (productIds) => {
  let lastError = null;
  let hasSuccessfulResponse = false;

  for (const lookupProductId of productIds) {
    try {
      const payload = await getWebProductFaqs(lookupProductId);
      hasSuccessfulResponse = true;
      const faqs = normalizeFaqPayload(payload);

      if (faqs.length > 0) {
        return faqs;
      }
    } catch (error) {
      lastError = error;
      // Try the next known product id, for example a parent product id.
    }
  }

  if (!hasSuccessfulResponse && lastError) {
    throw lastError;
  }

  return [];
};

const formatFaqLoadError = () => (
  'Không thể tải hỏi đáp sản phẩm. Vui lòng thử lại sau ít phút.'
);

const withAutoplay = (embedUrl) => {
  if (!embedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(embedUrl);
    parsedUrl.searchParams.set('autoplay', '1');
    return parsedUrl.toString();
  } catch {
    return embedUrl.includes('?') ? `${embedUrl}&autoplay=1` : `${embedUrl}?autoplay=1`;
  }
};

export default function ProductFaqs({ product, compact = false }) {
  const faqProductIds = useMemo(() => getFaqProductIds(product), [product]);
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [openFaqIds, setOpenFaqIds] = useState({});
  const [expandedAnswers, setExpandedAnswers] = useState({});
  const [lightbox, setLightbox] = useState(null);
  const [videoModal, setVideoModal] = useState(null);
  const touchStartXRef = useRef(null);
  const faqHistoryActiveRef = useRef(false);

  const totalFaqs = faqs.length;

  const refreshFaqs = useCallback(async ({ resetOpen = false, clearBeforeLoad = false } = {}) => {
    if (faqProductIds.length === 0) {
      setFaqs([]);
      setOpenFaqIds({});
      setErrorMessage('');
      setLoading(false);
      return [];
    }

    setLoading(true);
    setErrorMessage('');
    if (clearBeforeLoad) {
      setFaqs([]);
    }

    try {
      const nextFaqs = await fetchNormalizedProductFaqs(faqProductIds);
      setFaqs(nextFaqs);
      setErrorMessage('');

      if (resetOpen) {
        setOpenFaqIds(getDefaultOpenFaqIds(nextFaqs));
      } else {
        setOpenFaqIds((current) => preserveOpenFaqIds(current, nextFaqs));
      }

      return nextFaqs;
    } catch (error) {
      setFaqs([]);
      setErrorMessage(formatFaqLoadError(error));
      if (resetOpen) {
        setOpenFaqIds({});
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, [faqProductIds]);

  const openFaqModal = useCallback(() => {
    setOpenFaqIds(getDefaultOpenFaqIds(faqs));
    setExpandedAnswers({});
    setLightbox(null);
    setVideoModal(null);
    setIsOpen(true);
    void refreshFaqs({ resetOpen: true, clearBeforeLoad: true });

    if (typeof window !== 'undefined' && !faqHistoryActiveRef.current) {
      window.history.pushState(
        { ...(window.history.state || {}), productFaqModal: true },
        '',
        window.location.href
      );
      faqHistoryActiveRef.current = true;
    }
  }, [faqs, refreshFaqs]);

  const closeFaqModal = useCallback(({ fromHistory = false } = {}) => {
    setLightbox(null);
    setVideoModal(null);
    setIsOpen(false);

    if (faqHistoryActiveRef.current) {
      faqHistoryActiveRef.current = false;

      if (!fromHistory && typeof window !== 'undefined') {
        window.history.back();
      }
    }
  }, []);

  useEffect(() => {
    if (faqProductIds.length === 0) {
      setFaqs([]);
      setOpenFaqIds({});
      setErrorMessage('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage('');

    fetchNormalizedProductFaqs(faqProductIds)
      .then((nextFaqs) => {
        if (cancelled) return;
        setFaqs(nextFaqs);
        setOpenFaqIds((current) => preserveOpenFaqIds(current, nextFaqs));
        setExpandedAnswers({});
        setErrorMessage('');
      })
      .catch((error) => {
        if (!cancelled) {
          setFaqs([]);
          setOpenFaqIds({});
          setErrorMessage(formatFaqLoadError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [faqProductIds]);

  useEffect(() => {
    const overlayOpen = isOpen || Boolean(lightbox) || Boolean(videoModal);
    if (!overlayOpen || typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, lightbox, videoModal]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }

      if (lightbox) {
        setLightbox(null);
        return;
      }

      if (videoModal) {
        setVideoModal(null);
        return;
      }

      if (isOpen) {
        closeFaqModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeFaqModal, isOpen, lightbox, videoModal]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handlePopState = () => {
      if (!faqHistoryActiveRef.current) {
        return;
      }

      closeFaqModal({ fromHistory: true });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [closeFaqModal]);

  const modalTitle = useMemo(() => {
    if (loading) {
      return 'Đang tải hỏi đáp';
    }

    if (errorMessage) {
      return 'Chưa tải được hỏi đáp';
    }

    return totalFaqs > 0 ? `${totalFaqs} câu hỏi` : 'Chưa có câu hỏi';
  }, [errorMessage, loading, totalFaqs]);

  const toggleFaq = (faqId) => {
    setOpenFaqIds((current) => ({
      ...current,
      [faqId]: current[faqId] !== true,
    }));
  };

  const toggleAnswer = (faqId) => {
    setExpandedAnswers((current) => ({
      ...current,
      [faqId]: !current[faqId],
    }));
  };

  const openImageLightbox = (images, index) => {
    const normalizedImages = normalizeFaqImages(images);
    if (normalizedImages.length === 0) {
      return;
    }

    setLightbox({
      images: normalizedImages,
      index: Math.max(0, Math.min(index, normalizedImages.length - 1)),
      zoom: 1,
    });
  };

  const moveLightbox = (direction) => {
    setLightbox((current) => {
      if (!current) return current;
      const length = current.images.length;
      if (length <= 1) return current;

      return {
        ...current,
        index: (current.index + direction + length) % length,
        zoom: 1,
      };
    });
  };

  const setLightboxZoom = (nextZoom) => {
    setLightbox((current) => (
      current ? { ...current, zoom: Math.max(1, Math.min(2.5, nextZoom)) } : current
    ));
  };

  const handleLightboxTouchStart = (event) => {
    touchStartXRef.current = event.changedTouches?.[0]?.clientX ?? null;
  };

  const handleLightboxTouchEnd = (event) => {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches?.[0]?.clientX ?? null;
    touchStartXRef.current = null;

    if (startX === null || endX === null) {
      return;
    }

    const deltaX = endX - startX;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) {
      return;
    }

    moveLightbox(deltaX < 0 ? 1 : -1);
  };

  if (!isOpen && faqProductIds.length === 0) {
    return null;
  }

  const currentLightboxImage = lightbox?.images?.[lightbox.index] || null;
  const currentLightboxUrl = getFaqImageUrl(currentLightboxImage, 'large');

  return (
    <>
      <section
        className={compact ? styles.faqEntrySectionInline : styles.faqEntrySection}
        aria-label="Hỏi đáp khách hàng"
      >
        <button
          type="button"
          className={`${styles.faqEntryButton} ${compact ? styles.faqEntryButtonInline : ''}`.trim()}
          onClick={openFaqModal}
        >
          {!compact ? <span className={styles.faqEntryIcon} aria-hidden="true">?</span> : null}
          <span className={styles.faqEntryCopy}>
            <strong>{compact ? 'Hỏi đáp khách hàng' : '❓ Hỏi đáp khách hàng'}</strong>
            {!compact ? <small>{modalTitle}</small> : null}
          </span>
          {!compact ? (
            <span className="material-symbols-outlined" aria-hidden="true">open_in_full</span>
          ) : null}
        </button>
      </section>

      {isOpen ? (
        <div className={styles.faqModalOverlay} role="dialog" aria-modal="true" aria-label="Hỏi đáp khách hàng">
          <button
            type="button"
            className={styles.faqModalBackdrop}
            aria-label="Đóng hỏi đáp"
            onClick={() => closeFaqModal()}
          />
          <div className={styles.faqModalPanel}>
            <div className={styles.faqModalHeader}>
              <div>
                <p className={styles.faqModalEyebrow}>Hỏi đáp theo sản phẩm</p>
                <h2>Hỏi đáp khách hàng</h2>
                <span>{modalTitle}</span>
              </div>
              <button
                type="button"
                className={styles.faqCloseButton}
                onClick={() => closeFaqModal()}
                aria-label="Đóng hỏi đáp"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className={styles.faqModalBody}>
              {loading ? (
                <div className={styles.faqModalState}>Đang tải câu trả lời...</div>
              ) : errorMessage ? (
                <div className={`${styles.faqModalState} ${styles.faqModalStateStack}`} role="alert">
                  <span>{errorMessage}</span>
                  <button
                    type="button"
                    className={styles.faqRetryButton}
                    onClick={() => refreshFaqs({ resetOpen: true, clearBeforeLoad: true })}
                  >
                    Thử lại
                  </button>
                </div>
              ) : faqs.length === 0 ? (
                <div className={styles.faqModalState}>Sản phẩm này chưa có hỏi đáp.</div>
              ) : faqs.map((faq, faqIndex) => {
                const faqImages = normalizeFaqImages(faq.images);
                const answer = String(faq.answer || '').trim();
                const isFaqOpen = openFaqIds[faq.id] === true;
                const isAnswerExpanded = Boolean(expandedAnswers[faq.id]);
                const shouldToggleAnswer = answerNeedsToggle(answer);
                const videoThumb = resolveVideoThumbnailUrl(faq.youtube_url);
                const videoEmbed = resolveVideoEmbedUrl(faq.youtube_url);

                return (
                  <article
                    key={faq.id}
                    className={`${styles.faqAccordionItem} ${isFaqOpen ? styles.faqAccordionItemActive : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.faqQuestionButton}
                      onClick={() => toggleFaq(faq.id)}
                      aria-expanded={isFaqOpen}
                    >
                      <span className={styles.faqQuestionIcon}>{faqIndex + 1}</span>
                      <span>{faq.question}</span>
                      <span className="material-symbols-outlined" aria-hidden="true">
                        {isFaqOpen ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>

                    {isFaqOpen ? (
                      <div className={styles.faqAnswerWrap}>
                        <div className={styles.faqAnswerIcon}>
                          <span className="material-symbols-outlined">support_agent</span>
                        </div>
                        <div className={styles.faqAnswerBody}>
                          {answer ? (
                            <p className={`${styles.faqAnswerText} ${!isAnswerExpanded && shouldToggleAnswer ? styles.faqAnswerTextCollapsed : ''}`}>
                              {answer}
                            </p>
                          ) : (
                            <p className={styles.faqAnswerText}>Shop đang cập nhật câu trả lời.</p>
                          )}
                          {shouldToggleAnswer ? (
                            <button
                              type="button"
                              className={styles.faqReadMoreButton}
                              onClick={() => toggleAnswer(faq.id)}
                            >
                              {isAnswerExpanded ? 'Thu gọn' : 'Xem thêm'}
                            </button>
                          ) : null}

                          {(faqImages.length > 0 || videoEmbed) ? (
                            <div className={styles.faqMediaRow}>
                              {faqImages.map((image, imageIndex) => {
                                const thumbUrl = getFaqImageUrl(image, 'thumbnail');
                                return (
                                  <button
                                    key={`${thumbUrl}-${imageIndex}`}
                                    type="button"
                                    className={styles.faqImageThumb}
                                    onClick={() => openImageLightbox(faqImages, imageIndex)}
                                  >
                                    {thumbUrl ? <img src={thumbUrl} alt="" loading="lazy" /> : null}
                                  </button>
                                );
                              })}

                              {videoEmbed ? (
                                <button
                                  type="button"
                                  className={styles.faqVideoThumb}
                                  onClick={() => setVideoModal({ embedUrl: videoEmbed, title: faq.question })}
                                >
                                  {videoThumb ? <img src={videoThumb} alt="" loading="lazy" /> : null}
                                  <span className={styles.faqVideoPlay}>
                                    <span className="material-symbols-outlined">play_arrow</span>
                                  </span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div
          className={styles.faqLightboxOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh hỏi đáp"
          onTouchStart={handleLightboxTouchStart}
          onTouchEnd={handleLightboxTouchEnd}
        >
          <button
            type="button"
            className={styles.faqLightboxBackdrop}
            aria-label="Đóng ảnh"
            onClick={() => setLightbox(null)}
          />
          <div className={styles.faqLightboxToolbar}>
            <span>{lightbox.index + 1}/{lightbox.images.length}</span>
            <button type="button" onClick={() => setLightboxZoom(lightbox.zoom - 0.25)} aria-label="Thu nhỏ ảnh">
              <span className="material-symbols-outlined">remove</span>
            </button>
            <button type="button" onClick={() => setLightboxZoom(lightbox.zoom + 0.25)} aria-label="Phóng to ảnh">
              <span className="material-symbols-outlined">add</span>
            </button>
            <button type="button" onClick={() => setLightbox(null)} aria-label="Đóng ảnh">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          {lightbox.images.length > 1 ? (
            <>
              <button
                type="button"
                className={`${styles.faqLightboxNav} ${styles.faqLightboxPrev}`}
                onClick={() => moveLightbox(-1)}
                aria-label="Ảnh trước"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                className={`${styles.faqLightboxNav} ${styles.faqLightboxNext}`}
                onClick={() => moveLightbox(1)}
                aria-label="Ảnh sau"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </>
          ) : null}
          <div className={styles.faqLightboxStage}>
            {currentLightboxUrl ? (
              <img
                src={currentLightboxUrl}
                alt=""
                style={{ transform: `scale(${lightbox.zoom})` }}
                onDoubleClick={() => setLightboxZoom(lightbox.zoom > 1 ? 1 : 2)}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {videoModal ? (
        <div className={styles.faqVideoOverlay} role="dialog" aria-modal="true" aria-label="Video hỏi đáp">
          <button
            type="button"
            className={styles.faqModalBackdrop}
            aria-label="Đóng video"
            onClick={() => setVideoModal(null)}
          />
          <div className={styles.faqVideoPanel}>
            <div className={styles.faqVideoHeader}>
              <strong>{videoModal.title}</strong>
              <button type="button" onClick={() => setVideoModal(null)} aria-label="Đóng video">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <iframe
              src={withAutoplay(videoModal.embedUrl)}
              title={videoModal.title || 'Video hỏi đáp'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
