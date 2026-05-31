'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getWebProductReviews,
  likeWebProductReview,
  submitWebProductReview,
} from '@/lib/api';
import styles from '@/app/product/[slug]/product.module.css';
import { REVIEW_SECTION_ID, REVIEW_SUMMARY_EVENT } from './ProductRatingSummary';

const EMPTY_DISTRIBUTION = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
const STAR_PATH = 'M12 2.5l2.93 5.94 6.56.95-4.75 4.63 1.12 6.54L12 17.48l-5.86 3.08 1.12-6.54-4.75-4.63 6.56-.95L12 2.5z';

function StarSvg({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}

function normalizeSummary(product, apiSummary = null) {
  const source = apiSummary || product?.review_summary || {};
  const distribution = { ...EMPTY_DISTRIBUTION, ...(source.distribution || product?.rating_distribution || {}) };
  const average = Number(source.average_rating ?? product?.average_rating ?? 0);
  const total = Number(source.total_reviews ?? product?.review_count ?? 0);

  return {
    average_rating: Number.isFinite(average) ? Math.max(0, Math.min(5, average)) : 0,
    total_reviews: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0,
    distribution,
  };
}

function renderStars(rating, className = '') {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));

  return (
    <span className={`${styles.reviewStars} ${className}`.trim()} aria-label={`${value.toFixed(1)}/5`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fillPercent = Math.max(0, Math.min(100, (value - (star - 1)) * 100));
        const isFull = fillPercent >= 99.5;
        const isEmpty = fillPercent <= 0.5;

        return (
          <span key={star} className={styles.reviewStarFrame} aria-hidden="true">
            {isFull ? (
              <StarSvg className={`${styles.reviewStarIcon} ${styles.reviewStarFull}`} />
            ) : isEmpty ? (
              <StarSvg className={`${styles.reviewStarIcon} ${styles.reviewStarBase}`} />
            ) : (
              <>
                <StarSvg className={`${styles.reviewStarIcon} ${styles.reviewStarBase}`} />
                <span className={styles.reviewStarFill} style={{ width: `${fillPercent}%` }}>
                  <StarSvg className={styles.reviewStarIcon} />
                </span>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

function maskPhoneNumbers(value) {
  return String(value || '').replace(/(?<!\d)(\+?84|0)\d{8,10}(?!\d)/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 9) {
      return match;
    }

    return `${digits.slice(0, 3)}${'*'.repeat(Math.max(3, digits.length - 6))}${digits.slice(-3)}`;
  });
}

function formatReviewDate(value) {
  if (!value) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function getReviewScrollOffset() {
  if (typeof document === 'undefined') {
    return 100;
  }

  const stickyHeader = document.querySelector('.mobile-sticky-header-shell');
  const stickyHeaderHeight = Math.round(
    stickyHeader?.getBoundingClientRect?.().height || stickyHeader?.offsetHeight || 0,
  );

  return stickyHeaderHeight > 0 ? stickyHeaderHeight + 12 : 100;
}

function scrollToReviewNode(targetNode, behavior = 'smooth') {
  if (typeof window === 'undefined' || !targetNode) {
    return;
  }

  const top = Math.max(
    0,
    Math.round(window.scrollY + targetNode.getBoundingClientRect().top - getReviewScrollOffset()),
  );

  window.scrollTo({ top, behavior });
}

const initialForm = {
  rating: 5,
  customer_name: '',
  comment: '',
};

export default function ProductReviews({ product }) {
  const productId = product?.id;
  const reviewsSectionRef = useRef(null);
  const reviewListAnchorRef = useRef(null);
  const reviewListRef = useRef(null);
  const pendingReviewListScrollRef = useRef(false);
  const [summary, setSummary] = useState(() => normalizeSummary(product));
  const [reviews, setReviews] = useState([]);
  const [reviewMeta, setReviewMeta] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [reviewListMinHeight, setReviewListMinHeight] = useState(0);
  const [activeRating, setActiveRating] = useState(0);
  const [reviewPage, setReviewPage] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [replyForms, setReplyForms] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const publishSummary = (nextSummary) => {
    if (typeof window === 'undefined' || !productId) {
      return;
    }

    window.dispatchEvent(new CustomEvent(REVIEW_SUMMARY_EVENT, {
      detail: {
        productId,
        summary: nextSummary,
      },
    }));
  };

  const scrollToReviewList = useCallback((behavior = 'smooth') => {
    scrollToReviewNode(reviewListAnchorRef.current || reviewsSectionRef.current, behavior);
  }, []);

  const lockReviewListHeight = useCallback(() => {
    const listHeight = Math.ceil(reviewListRef.current?.getBoundingClientRect?.().height || 0);
    setReviewListMinHeight(listHeight > 0 ? listHeight : 0);
  }, []);

  const prepareReviewPageChange = useCallback(() => {
    pendingReviewListScrollRef.current = true;
    lockReviewListHeight();
    scrollToReviewList('auto');
  }, [lockReviewListHeight, scrollToReviewList]);

  const loadReviews = (page = reviewPage, rating = activeRating) => {
    if (!productId) {
      return;
    }

    setLoading(true);
    getWebProductReviews(productId, {
      page,
      per_page: 10,
      ...(rating ? { rating } : {}),
    })
      .then((payload) => {
        const nextSummary = normalizeSummary(product, payload?.summary);
        setSummary(nextSummary);
        setReviews(Array.isArray(payload?.reviews) ? payload.reviews : []);
        setReviewMeta({
          current_page: payload?.meta?.current_page || 1,
          last_page: payload?.meta?.last_page || 1,
          total: payload?.meta?.total || 0,
        });
        publishSummary(nextSummary);
      })
      .catch(() => {
        setErrorMessage('Không thể tải đánh giá. Vui lòng thử lại sau.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReviews(reviewPage, activeRating);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, reviewPage, activeRating]);

  useEffect(() => {
    if (typeof window === 'undefined' || loading || !pendingReviewListScrollRef.current) {
      return undefined;
    }

    let timeoutId = null;
    const frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        scrollToReviewList('auto');
        pendingReviewListScrollRef.current = false;
        setReviewListMinHeight(0);
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [loading, reviewMeta.current_page, reviews.length, scrollToReviewList]);

  const goToReviewPage = useCallback((nextPage) => {
    if (loading) {
      return;
    }

    const lastPage = Math.max(1, Number(reviewMeta.last_page) || 1);
    const targetPage = Math.max(1, Math.min(lastPage, Number(nextPage) || 1));

    if (targetPage === reviewPage) {
      return;
    }

    prepareReviewPageChange();
    setLoading(true);
    setReviewPage(targetPage);
  }, [loading, prepareReviewPageChange, reviewMeta.last_page, reviewPage]);

  const submitReview = (event) => {
    event.preventDefault();
    setStatusMessage('');
    setErrorMessage('');

    if (!String(form.comment || '').trim()) {
      setErrorMessage('Vui lòng nhập nội dung bình luận.');
      return;
    }

    if (!String(form.customer_name || '').trim()) {
      setErrorMessage('Vui lòng nhập tên của bạn.');
      return;
    }

    setSubmitting(true);
    submitWebProductReview(productId, {
      rating: form.rating,
      customer_name: form.customer_name,
      comment: form.comment,
    })
      .then((payload) => {
        setStatusMessage(payload?.message || 'Cảm ơn bạn. Đánh giá sẽ hiển thị sau khi được duyệt.');
        setForm(initialForm);
        setReviewPage(1);
        loadReviews(1, activeRating);
      })
      .catch((error) => {
        setErrorMessage(error?.message || 'Không thể gửi đánh giá. Vui lòng thử lại.');
      })
      .finally(() => setSubmitting(false));
  };

  const submitReply = (reviewId) => {
    const reply = replyForms[reviewId] || {};
    setStatusMessage('');
    setErrorMessage('');

    if (!String(reply.comment || '').trim()) {
      setErrorMessage('Vui lòng nhập nội dung phản hồi.');
      return;
    }

    if (!String(reply.customer_name || '').trim()) {
      setErrorMessage('Vui lòng nhập tên của bạn.');
      return;
    }

    submitWebProductReview(productId, {
      parent_id: reviewId,
      customer_name: reply.customer_name,
      comment: reply.comment,
    })
      .then((payload) => {
        setStatusMessage(payload?.message || 'Cảm ơn bạn. Phản hồi sẽ hiển thị sau khi được duyệt.');
        setReplyForms((current) => ({
          ...current,
          [reviewId]: { open: false, customer_name: '', comment: '' },
        }));
        loadReviews(reviewPage, activeRating);
      })
      .catch((error) => {
        setErrorMessage(error?.message || 'Không thể gửi phản hồi. Vui lòng thử lại.');
      });
  };

  const likeReview = (reviewId) => {
    likeWebProductReview(reviewId)
      .then((payload) => {
        setReviews((currentReviews) => currentReviews.map((review) => {
          if (review.id !== reviewId) {
            return review;
          }

          return {
            ...review,
            is_liked: true,
            helpful_count: Number(payload?.helpful_count ?? review.helpful_count ?? 0),
          };
        }));
      })
      .catch(() => {
        setErrorMessage('Không thể like đánh giá lúc này.');
      });
  };

  const setReplyFormValue = (reviewId, key, value) => {
    setReplyForms((current) => ({
      ...current,
      [reviewId]: {
        open: true,
        customer_name: '',
        comment: '',
        ...(current[reviewId] || {}),
        [key]: value,
      },
    }));
  };

  const totalReviews = summary.total_reviews || 0;
  const reviewListStyle = reviewListMinHeight > 0 ? { minHeight: `${reviewListMinHeight}px` } : undefined;

  return (
    <section ref={reviewsSectionRef} id={REVIEW_SECTION_ID} className={styles.reviewsSection}>
      <div className={styles.reviewsPanel}>
        <div className={styles.reviewsHeader}>
          <div>
            <p className={styles.reviewsEyebrow}>Đánh giá & bình luận</p>
            <h2 className={styles.reviewsTitle}>Khách hàng nói về sản phẩm</h2>
          </div>
          <div className={styles.reviewsAverageBox}>
            <strong>{summary.average_rating.toFixed(1)}</strong>
            <span>/5</span>
            {renderStars(summary.average_rating)}
            <small>{totalReviews} lượt đánh giá</small>
          </div>
        </div>

        <div className={styles.reviewStatsGrid}>
          <div className={styles.reviewBars}>
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = Number(summary.distribution?.[rating] || 0);
              const percent = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;

              return (
                <button
                  key={rating}
                  type="button"
                  className={`${styles.reviewBarRow} ${activeRating === rating ? styles.reviewBarRowActive : ''}`}
                  onClick={() => {
                    setReviewPage(1);
                    setActiveRating((current) => (current === rating ? 0 : rating));
                  }}
                >
                  <span>{rating}</span>
                  <span className="material-symbols-outlined">star</span>
                  <span className={styles.reviewBarTrack}>
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <strong>{count}</strong>
                </button>
              );
            })}
          </div>

          <form className={styles.reviewForm} onSubmit={submitReview}>
            <div className={styles.reviewFormStars}>
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, rating }))}
                  className={rating <= form.rating ? styles.reviewStarButtonActive : ''}
                  aria-label={`Chọn ${rating} sao`}
                >
                  <span className="material-symbols-outlined">star</span>
                </button>
              ))}
            </div>

            <div className={styles.reviewNameRow}>
              <input
                type="text"
                value={form.customer_name}
                onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))}
                placeholder="Tên của bạn"
                maxLength={80}
              />
            </div>

            <textarea
              value={form.comment}
              onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
              placeholder="Nhập nội dung bình luận..."
              maxLength={3000}
              rows={4}
            />
            <div className={styles.reviewFormFooter}>
              <span>{form.comment.length}/3000</span>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Đang gửi...' : 'Gửi đánh giá'}
              </button>
            </div>
          </form>
        </div>

        {statusMessage ? <p className={styles.reviewStatusMessage}>{statusMessage}</p> : null}
        {errorMessage ? <p className={styles.reviewErrorMessage}>{errorMessage}</p> : null}

        <div className={styles.reviewFilterRow}>
          <button
            type="button"
            className={!activeRating ? styles.reviewFilterActive : ''}
            onClick={() => {
              setReviewPage(1);
              setActiveRating(0);
            }}
          >
            Tất cả
          </button>
          {[5, 4, 3, 2, 1].map((rating) => (
            <button
              key={rating}
              type="button"
              className={activeRating === rating ? styles.reviewFilterActive : ''}
              onClick={() => {
                setReviewPage(1);
                setActiveRating(rating);
              }}
            >
              {rating} <span className="material-symbols-outlined">star</span>
            </button>
          ))}
        </div>

        <div ref={reviewListAnchorRef} aria-hidden="true" />
        <div ref={reviewListRef} className={styles.reviewList} style={reviewListStyle}>
          {loading ? (
            <p className={styles.reviewEmpty}>Đang tải đánh giá...</p>
          ) : reviews.length === 0 ? (
            <p className={styles.reviewEmpty}>Chưa có đánh giá phù hợp.</p>
          ) : reviews.map((review) => {
            const replyForm = replyForms[review.id] || {};

            return (
              <article key={review.id} className={styles.reviewItem}>
                <div className={styles.reviewAvatar}>{String(review.customer_name || 'K').charAt(0)}</div>
                <div className={styles.reviewBody}>
                  <div className={styles.reviewMetaRow}>
                    <strong>{maskPhoneNumbers(review.customer_name)}</strong>
                    <span>{formatReviewDate(review.created_at)}</span>
                  </div>
                  {renderStars(review.rating)}
                  <p>{maskPhoneNumbers(review.comment)}</p>
                  <div className={styles.reviewActions}>
                    <button
                      type="button"
                      onClick={() => likeReview(review.id)}
                      disabled={review.is_liked}
                    >
                      <span className="material-symbols-outlined">thumb_up</span>
                      {review.helpful_count || 0}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyFormValue(review.id, 'open', !replyForm.open)}
                    >
                      <span className="material-symbols-outlined">reply</span>
                      Trả lời
                    </button>
                  </div>

                  {replyForm.open ? (
                    <div className={styles.replyForm}>
                      <div className={styles.reviewNameRow}>
                        <input
                          type="text"
                          value={replyForm.customer_name || ''}
                          onChange={(event) => setReplyFormValue(review.id, 'customer_name', event.target.value)}
                          placeholder="Tên của bạn"
                          maxLength={80}
                        />
                      </div>
                      <textarea
                        value={replyForm.comment || ''}
                        onChange={(event) => setReplyFormValue(review.id, 'comment', event.target.value)}
                        placeholder="Nhập phản hồi..."
                        rows={3}
                        maxLength={3000}
                      />
                      <button type="button" onClick={() => submitReply(review.id)}>
                        Gửi phản hồi
                      </button>
                    </div>
                  ) : null}

                  {Array.isArray(review.replies) && review.replies.length > 0 ? (
                    <div className={styles.reviewReplies}>
                      {review.replies.map((reply) => (
                        <div key={reply.id} className={styles.reviewReply}>
                          {reply.is_admin_reply ? (
                            <div className={`${styles.reviewAvatar} ${styles.shopReplyAvatar}`}>
                              <img src="/logo-brand.jpg" alt="Gốm Đại Thành" />
                            </div>
                          ) : (
                            <div className={styles.reviewAvatar}>{String(reply.customer_name || 'K').charAt(0)}</div>
                          )}
                          <div>
                            <div className={styles.reviewMetaRow}>
                              <strong>{maskPhoneNumbers(reply.customer_name)}</strong>
                              <span>{formatReviewDate(reply.created_at)}</span>
                            </div>
                            <p>{maskPhoneNumbers(reply.comment)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {reviewMeta.last_page > 1 ? (
          <div className={styles.reviewPagination}>
            <button
              type="button"
              disabled={reviewMeta.current_page <= 1 || loading}
              onClick={(event) => {
                event.currentTarget.blur();
                goToReviewPage(reviewMeta.current_page - 1);
              }}
            >
              Trước
            </button>
            <span>Trang {reviewMeta.current_page}/{reviewMeta.last_page}</span>
            <button
              type="button"
              disabled={reviewMeta.current_page >= reviewMeta.last_page || loading}
              onClick={(event) => {
                event.currentTarget.blur();
                goToReviewPage(reviewMeta.current_page + 1);
              }}
            >
              Sau
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
