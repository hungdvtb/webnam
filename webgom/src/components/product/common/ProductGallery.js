'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from '../../../app/product/[slug]/product.module.css';
import { resolveVideoEmbedUrl, resolveVideoThumbnailUrl } from '@/lib/media';

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';
const SWIPE_AXIS_LOCK_THRESHOLD = 12;
const SWIPE_TRIGGER_THRESHOLD = 48;
const EMPTY_SWIPE_STATE = {
  pointerId: null,
  startX: 0,
  startY: 0,
  deltaX: 0,
  deltaY: 0,
  lockedAxis: null,
};

export default function ProductGallery({
  images,
  activeIndex,
  setActiveIndex,
  getImageUrl,
  productName,
  videoUrl,
  showSingleThumbnail = false,
}) {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const swipeStateRef = useRef({ ...EMPTY_SWIPE_STATE });
  const thumbRefs = useRef(new Map());
  const embedUrl = resolveVideoEmbedUrl(videoUrl);
  const videoThumbnailUrl = resolveVideoThumbnailUrl(videoUrl);
  const hasVideo = Boolean(embedUrl);
  const activeImage = activeIndex >= 0 ? (images[activeIndex] || images[0]) : images[0];
  const totalMediaItems = images.length + (hasVideo ? 1 : 0);
  const showThumbnailStrip = totalMediaItems > 1 || (showSingleThumbnail && totalMediaItems === 1);
  const isShowingVideo = hasVideo && (activeIndex === -1 || images.length === 0);
  const mediaSummary = isShowingVideo
    ? 'Video YouTube'
    : images.length > 0
      ? `\u1ea2nh ${Math.min(activeIndex + 1, images.length)} / ${images.length}`
      : 'Media s\u1ea3n ph\u1ea9m';
  const canSwipeImages = isMobileViewport && !isShowingVideo && images.length > 1;

  const resetSwipeState = () => {
    swipeStateRef.current = { ...EMPTY_SWIPE_STATE };
    setIsDraggingMedia(false);
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const syncViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };

    syncViewport();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport);

      return () => {
        mediaQuery.removeEventListener('change', syncViewport);
      };
    }

    mediaQuery.addListener(syncViewport);

    return () => {
      mediaQuery.removeListener(syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!canSwipeImages) {
      swipeStateRef.current = { ...EMPTY_SWIPE_STATE };
    }
  }, [canSwipeImages]);

  useEffect(() => {
    if (!isMobileViewport || !showThumbnailStrip || typeof window === 'undefined') {
      return undefined;
    }

    const activeThumbKey = isShowingVideo ? 'video' : `image-${Math.max(activeIndex, 0)}`;
    const activeThumb = thumbRefs.current.get(activeThumbKey);

    if (!activeThumb) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      activeThumb.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeIndex, isMobileViewport, isShowingVideo, showThumbnailStrip]);

  const setThumbRef = (key) => (node) => {
    if (node) {
      thumbRefs.current.set(key, node);
      return;
    }

    thumbRefs.current.delete(key);
  };

  const commitSwipe = (direction) => {
    if (!canSwipeImages) {
      return;
    }

    const currentIndex = Math.min(Math.max(activeIndex, 0), images.length - 1);
    const nextIndex = direction === 'next'
      ? Math.min(currentIndex + 1, images.length - 1)
      : Math.max(currentIndex - 1, 0);

    if (nextIndex !== currentIndex) {
      setActiveIndex(nextIndex);
    }
  };

  const handlePointerDown = (event) => {
    if (
      !canSwipeImages
      || event.isPrimary === false
      || (typeof event.button === 'number' && event.button > 0)
    ) {
      return;
    }

    swipeStateRef.current = {
      pointerId: event.pointerId ?? 1,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      deltaY: 0,
      lockedAxis: null,
    };
  };

  const handlePointerMove = (event) => {
    const swipeState = swipeStateRef.current;

    if (
      !canSwipeImages
      || swipeState.pointerId === null
      || (event.pointerId != null && swipeState.pointerId !== event.pointerId)
    ) {
      return;
    }

    swipeState.deltaX = event.clientX - swipeState.startX;
    swipeState.deltaY = event.clientY - swipeState.startY;

    if (!swipeState.lockedAxis) {
      if (
        Math.abs(swipeState.deltaX) < SWIPE_AXIS_LOCK_THRESHOLD
        && Math.abs(swipeState.deltaY) < SWIPE_AXIS_LOCK_THRESHOLD
      ) {
        return;
      }

      swipeState.lockedAxis = Math.abs(swipeState.deltaX) > Math.abs(swipeState.deltaY) ? 'x' : 'y';

      if (swipeState.lockedAxis === 'x') {
        setIsDraggingMedia(true);
      }
    }

    if (swipeState.lockedAxis === 'x' && event.cancelable) {
      event.preventDefault();
    }
  };

  const finishSwipe = (event) => {
    const swipeState = swipeStateRef.current;

    if (
      swipeState.pointerId === null
      || (event?.pointerId != null && swipeState.pointerId !== event.pointerId)
    ) {
      return;
    }

    if (swipeState.lockedAxis === 'x' && Math.abs(swipeState.deltaX) >= SWIPE_TRIGGER_THRESHOLD) {
      commitSwipe(swipeState.deltaX < 0 ? 'next' : 'previous');
    }

    resetSwipeState();
  };

  const stageClassName = [
    styles.productMediaStage,
    isShowingVideo ? styles.productMediaStageVideo : '',
    canSwipeImages ? styles.productMediaStageSwipeable : '',
    canSwipeImages && isDraggingMedia ? styles.productMediaStageDragging : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.productMediaGallery}>
      <div
        className={stageClassName}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishSwipe}
        onPointerCancel={finishSwipe}
      >
        <div
          className={styles.productMediaBadge}
          data-media-kind={isShowingVideo ? 'video' : 'image'}
        >
          {mediaSummary}
        </div>

        {isShowingVideo ? (
          <div className={styles.productMediaVideoShell}>
            <iframe
              src={embedUrl}
              title={`${productName} video`}
              className={styles.productMediaVideoFrame}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : activeImage ? (
          <div className={styles.productMediaVisual}>
            <Image
              src={getImageUrl(activeImage)}
              alt={productName}
              fill
              sizes="(max-width: 767px) 100vw, (max-width: 1279px) 52vw, 620px"
              className={styles.productMediaImage}
              priority
              unoptimized
            />
          </div>
        ) : (
          <div className={styles.productMediaPlaceholder}>
            <span className="material-symbols-outlined" aria-hidden="true">image</span>
            <p>\u0110ang c\u1eadp nh\u1eadt media s\u1ea3n ph\u1ea9m</p>
          </div>
        )}
      </div>

      {showThumbnailStrip ? (
        <div className={styles.productMediaRail} role="tablist" aria-label="Th\u01b0 vi\u1ec7n media s\u1ea3n ph\u1ea9m">
          {hasVideo ? (
            <button
              type="button"
              ref={setThumbRef('video')}
              className={`${styles.productMediaThumb} ${styles.productMediaThumbVideo} ${isShowingVideo ? styles.productMediaThumbActive : ''}`}
              onClick={() => setActiveIndex(-1)}
              aria-pressed={isShowingVideo}
              aria-label="Xem video YouTube"
            >
              {videoThumbnailUrl ? (
                <div className={styles.productMediaThumbPoster}>
                  <Image
                    src={videoThumbnailUrl}
                    alt={`${productName} video thumbnail`}
                    fill
                    sizes="88px"
                    className={styles.productMediaThumbImage}
                    unoptimized
                  />
                </div>
              ) : (
                <div className={styles.productMediaThumbFallback}>
                  <span className="material-symbols-outlined" aria-hidden="true">smart_display</span>
                </div>
              )}

              <span className={styles.productMediaThumbVideoOverlay}>
                <span className="material-symbols-outlined" aria-hidden="true">play_circle</span>
              </span>
              <span className={styles.productMediaThumbLabel}>Video</span>
            </button>
          ) : null}

          {images.map((image, index) => {
            const isActive = index === activeIndex;

            return (
              <button
                key={image.id || `${getImageUrl(image)}-${index}`}
                type="button"
                ref={setThumbRef(`image-${index}`)}
                className={`${styles.productMediaThumb} ${isActive ? styles.productMediaThumbActive : ''}`}
                onClick={() => setActiveIndex(index)}
                aria-pressed={isActive}
                aria-label={`Xem \u1ea3nh ${index + 1}`}
              >
                <div className={styles.productMediaThumbPoster}>
                  <Image
                    src={getImageUrl(image)}
                    alt={`${productName} \u1ea3nh ${index + 1}`}
                    fill
                    sizes="88px"
                    className={styles.productMediaThumbImage}
                    unoptimized
                  />
                </div>
                <span className={`${styles.productMediaThumbLabel} ${styles.productMediaThumbImageLabel}`}>
                  \u1ea2nh {index + 1}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
