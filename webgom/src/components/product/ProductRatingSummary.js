'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from '@/app/product/[slug]/product.module.css';

const REVIEW_SECTION_ID = 'product-review-section';
const REVIEW_SUMMARY_EVENT = 'webgom:reviews-summary-updated';
const STAR_PATH = 'M12 2.5l2.93 5.94 6.56.95-4.75 4.63 1.12 6.54L12 17.48l-5.86 3.08 1.12-6.54-4.75-4.63 6.56-.95L12 2.5z';

function StarSvg({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}

function normalizeSummary(product) {
  const summary = product?.review_summary || {};
  const average = Number(summary.average_rating ?? product?.average_rating ?? 0);
  const total = Number(summary.total_reviews ?? product?.review_count ?? product?.reviews_count ?? 0);

  return {
    average: Number.isFinite(average) ? Math.max(0, Math.min(5, average)) : 0,
    total: Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0,
  };
}

function scrollToReviews() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const target = document.getElementById(REVIEW_SECTION_ID);
  if (!target) {
    return;
  }

  const stickyHeader = document.querySelector('.mobile-sticky-header-shell');
  const offset = Math.round(stickyHeader?.getBoundingClientRect?.().height || 88) + 12;
  const top = Math.max(0, Math.round(window.scrollY + target.getBoundingClientRect().top - offset));

  window.scrollTo({ top, behavior: 'smooth' });
}

export default function ProductRatingSummary({ product }) {
  const initialSummary = useMemo(() => normalizeSummary(product), [product]);
  const [summary, setSummary] = useState(initialSummary);

  useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleSummaryUpdate = (event) => {
      if (Number(event.detail?.productId) !== Number(product?.id)) {
        return;
      }

      setSummary(normalizeSummary({
        average_rating: event.detail?.summary?.average_rating,
        review_count: event.detail?.summary?.total_reviews,
      }));
    };

    window.addEventListener(REVIEW_SUMMARY_EVENT, handleSummaryUpdate);
    return () => window.removeEventListener(REVIEW_SUMMARY_EVENT, handleSummaryUpdate);
  }, [product?.id]);

  return (
    <button
      type="button"
      className={styles.ratingJump}
      onClick={scrollToReviews}
      aria-label="Xem đánh giá và bình luận sản phẩm"
    >
      <span className={styles.ratingJumpStars} aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => {
          const value = Math.max(0, Math.min(5, Number(summary.average) || 0));
          const fillPercent = Math.max(0, Math.min(100, (value - (star - 1)) * 100));
          const isFull = fillPercent >= 99.5;
          const isEmpty = fillPercent <= 0.5;

          return (
            <span key={star} className={styles.reviewStarFrame}>
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
      <span className={styles.ratingJumpScore}>{summary.average.toFixed(1)}</span>
      <span className={styles.ratingJumpCount}>{summary.total} đánh giá</span>
    </button>
  );
}

export { REVIEW_SECTION_ID, REVIEW_SUMMARY_EVENT };
