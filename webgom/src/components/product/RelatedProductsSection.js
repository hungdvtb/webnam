'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { resolveImageObjectUrl } from '@/lib/media';
import styles from '../../app/product/[slug]/product.module.css';

function getRelatedImageSrc(relatedProduct) {
  const candidates = [
    relatedProduct?.primary_image,
    relatedProduct?.images?.[0],
    relatedProduct?.main_image ? { path: relatedProduct.main_image } : null,
  ];

  for (const candidate of candidates) {
    const resolved = resolveImageObjectUrl(candidate, '');
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function getRelatedRatingMeta(relatedProduct) {
  const ratingValue = Number(
    relatedProduct?.average_rating ??
    relatedProduct?.rating_average ??
    relatedProduct?.avg_rating ??
    relatedProduct?.rating ??
    0
  );
  const ratingCount = Number(
    relatedProduct?.review_count ??
    relatedProduct?.reviews_count ??
    relatedProduct?.rating_count ??
    relatedProduct?.total_reviews ??
    0
  );

  return {
    ratingValue: Number.isFinite(ratingValue) ? Math.max(0, Math.min(5, ratingValue)) : 0,
    ratingCount: Number.isFinite(ratingCount) ? Math.max(0, ratingCount) : 0
  };
}

function renderRelatedStars(ratingValue) {
  return Array.from({ length: 5 }, (_, index) => {
    const starIndex = index + 1;
    let icon = 'star_outline';

    if (ratingValue >= starIndex) icon = 'star';
    else if (ratingValue >= starIndex - 0.5) icon = 'star_half';

    return (
      <span key={`related-star-${index}`} className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    );
  });
}

function getRailStep(railElement) {
  if (!railElement) return 0;

  const firstCard = railElement.querySelector(`.${styles.relatedCard}`);
  const computed = window.getComputedStyle(railElement);
  const gap = parseFloat(computed.columnGap || computed.gap || '0');

  if (firstCard) {
    return (firstCard.getBoundingClientRect().width + gap) * 2;
  }

  return railElement.clientWidth;
}

export default function RelatedProductsSection({ relatedProducts = [] }) {
  const railRef = useRef(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(relatedProducts.length > 2);

  const hasRelatedProducts = relatedProducts.length > 0;
  const showArrows = relatedProducts.length > 2;
  const relatedSkeletons = Array.from({ length: 4 }, (_, index) => index);

  useEffect(() => {
    const railElement = railRef.current;
    if (!railElement) return undefined;

    const syncScrollState = () => {
      const maxScrollLeft = Math.max(0, railElement.scrollWidth - railElement.clientWidth - 2);
      setCanScrollPrev(railElement.scrollLeft > 4);
      setCanScrollNext(railElement.scrollLeft < maxScrollLeft);
    };

    syncScrollState();
    railElement.addEventListener('scroll', syncScrollState, { passive: true });
    window.addEventListener('resize', syncScrollState);

    return () => {
      railElement.removeEventListener('scroll', syncScrollState);
      window.removeEventListener('resize', syncScrollState);
    };
  }, [relatedProducts.length]);

  const handleArrowClick = (direction) => {
    const railElement = railRef.current;
    if (!railElement) return;

    railElement.scrollBy({
      left: getRailStep(railElement) * direction,
      behavior: 'smooth'
    });
  };

  return (
    <div className={`${styles.relatedSection} ${!hasRelatedProducts ? styles.relatedSectionEmpty : ''}`}>
      <div className={styles.relatedHeader}>
        <div>
          <h3 className={styles.relatedTitle}>Sản phẩm tương tự</h3>
          <p className={styles.relatedSub}>Gợi ý những tác phẩm cùng phong cách dành cho bạn</p>
        </div>
        <Link href="/products" className={styles.viewAll}>
          Xem tất cả <span className="material-symbols-outlined">arrow_forward</span>
        </Link>
      </div>

      <div className={styles.relatedCarousel}>
        {showArrows && (
          <>
            <button
              type="button"
              className={`${styles.relatedArrow} ${styles.relatedArrowLeft} ${!canScrollPrev ? styles.relatedArrowDisabled : ''}`}
              onClick={() => handleArrowClick(-1)}
              aria-label="Xem sản phẩm tương tự trước đó"
              disabled={!canScrollPrev}
            >
              <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
            </button>
            <button
              type="button"
              className={`${styles.relatedArrow} ${styles.relatedArrowRight} ${!canScrollNext ? styles.relatedArrowDisabled : ''}`}
              onClick={() => handleArrowClick(1)}
              aria-label="Xem thêm sản phẩm tương tự"
              disabled={!canScrollNext}
            >
              <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          </>
        )}

        <div
          ref={railRef}
          className={`${styles.relatedGrid} ${!hasRelatedProducts ? styles.relatedGridLoading : ''}`}
        >
          {hasRelatedProducts ? relatedProducts.map((relatedProduct) => {
            const imageSrc = getRelatedImageSrc(relatedProduct);
            const { ratingValue, ratingCount } = getRelatedRatingMeta(relatedProduct);

            return (
              <Link
                key={relatedProduct.id}
                href={`/product/${relatedProduct.slug || relatedProduct.id}`}
                className={styles.relatedCard}
              >
                <div className={styles.relImage}>
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={relatedProduct.name}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 50vw, 25vw"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <div className={styles.relatedImagePlaceholder}>
                      <span className="material-symbols-outlined" aria-hidden="true">image</span>
                    </div>
                  )}
                </div>
                <div className={styles.relInfo}>
                  <h4 className={styles.relTitle}>{relatedProduct.name}</h4>
                  <div className={styles.relPriceRow}>
                    <span className={styles.relPrice}>
                      {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(relatedProduct.price)}
                    </span>
                  </div>
                  {(ratingValue > 0 || ratingCount > 0) && (
                    <div className={styles.relRating}>
                      <div className={styles.relRatingStars}>
                        {renderRelatedStars(ratingValue)}
                      </div>
                      {ratingCount > 0 && <span className={styles.relRatingCount}>({ratingCount})</span>}
                    </div>
                  )}
                </div>
              </Link>
            );
          }) : relatedSkeletons.map((skeletonIndex) => (
            <div
              key={`related-skeleton-${skeletonIndex}`}
              className={`${styles.relatedCard} ${styles.relatedSkeletonCard}`}
              aria-hidden="true"
            >
              <div className={`${styles.relImage} ${styles.relatedSkeletonImage}`} />
              <div className={styles.relInfo}>
                <div className={styles.relatedSkeletonLine} />
                <div className={`${styles.relatedSkeletonLine} ${styles.relatedSkeletonLineShort}`} />
                <div className={styles.relatedSkeletonRating} />
                <div className={`${styles.relatedSkeletonLine} ${styles.relatedSkeletonPrice}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
