'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './ProductGallery.module.css';
import { resolveVideoEmbedUrl, resolveVideoThumbnailUrl } from '@/lib/media';
import { logProductTiming, logProductTimingOnce } from '@/lib/productPerformance';

const MOBILE_MEDIA_QUERY = '(max-width: 768px)';
const SWIPE_AXIS_LOCK_THRESHOLD = 12;
const MOBILE_SWIPE_TRIGGER_THRESHOLD = 48;
const DESKTOP_DRAG_TRIGGER_RATIO = 0.18;
const DESKTOP_DRAG_TRIGGER_MIN_PX = 84;
const DESKTOP_DRAG_TRIGGER_MAX_PX = 140;
const EDGE_DRAG_RESISTANCE = 0.32;
const TRACK_TRANSITION = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
const EMPTY_SWIPE_STATE = {
  pointerId: null,
  startX: 0,
  startY: 0,
  deltaX: 0,
  deltaY: 0,
  lockedAxis: null,
  interactionType: null,
  startIndex: 0,
};

function clampImageIndex(index, imageCount) {
  if (imageCount <= 0) {
    return 0;
  }

  const numericIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
  return Math.min(Math.max(numericIndex, 0), imageCount - 1);
}

function resolveDisplayIndex(activeIndex, imageCount, hasVideo) {
  if (imageCount <= 0) {
    return hasVideo ? buildVideoDisplayIndex(resolveVideoActiveIndex(activeIndex)) : 0;
  }

  if (Number(activeIndex) < 0 && hasVideo) {
    return buildVideoDisplayIndex(resolveVideoActiveIndex(activeIndex));
  }

  return clampImageIndex(activeIndex, imageCount);
}

function resolveVideoActiveIndex(activeIndex) {
  const numericIndex = Number(activeIndex);
  return Number.isFinite(numericIndex) && numericIndex < 0
    ? Math.max(0, Math.abs(numericIndex) - 1)
    : 0;
}

function buildVideoDisplayIndex(videoIndex = 0) {
  return -1 - Math.max(0, Number(videoIndex) || 0);
}

export default function ProductGallery({
  images,
  activeIndex,
  setActiveIndex,
  getImageUrl,
  productName,
  videoUrl,
  videoUrls,
  primaryDisplayImage = null,
  showSingleThumbnail = false,
  priorityFirstImage = true,
  deferVideoThumbnails = true,
}) {
  const normalizedImages = Array.isArray(images) ? images.filter(Boolean) : [];
  const normalizedVideoUrls = (Array.isArray(videoUrls) && videoUrls.length > 0 ? videoUrls : [videoUrl])
    .map((url) => String(url || '').trim())
    .filter((url, index, collection) => url && collection.indexOf(url) === index)
    .filter((url) => Boolean(resolveVideoEmbedUrl(url)));
  const activeVideoIndex = Math.min(resolveVideoActiveIndex(activeIndex), Math.max(normalizedVideoUrls.length - 1, 0));
  const activeVideoUrl = normalizedVideoUrls[activeVideoIndex] || '';
  const embedUrl = resolveVideoEmbedUrl(activeVideoUrl);
  const hasVideo = normalizedVideoUrls.length > 0;
  const galleryImages = normalizedImages.length > 0 ? normalizedImages : [{ id: '__fallback-media__', __fallback: true }];
  const requestedDisplayIndex = resolveDisplayIndex(activeIndex, normalizedImages.length, hasVideo);
  const primaryDisplayImageSignature = primaryDisplayImage
    ? String(primaryDisplayImage.id || getImageUrl(primaryDisplayImage))
    : '';

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const [displayIndex, setDisplayIndex] = useState(requestedDisplayIndex);
  const [isPrimaryDisplayOverrideActive, setIsPrimaryDisplayOverrideActive] = useState(
    Boolean(primaryDisplayImage) && requestedDisplayIndex === 0,
  );
  const [canRenderVideoThumbnails, setCanRenderVideoThumbnails] = useState(!deferVideoThumbnails);

  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const thumbRefs = useRef(new Map());
  const swipeStateRef = useRef({ ...EMPTY_SWIPE_STATE });
  const displayIndexRef = useRef(requestedDisplayIndex);
  const stageWidthRef = useRef(1);
  const dragFrameRef = useRef(null);
  const settleFrameRef = useRef(null);
  const pendingDragOffsetRef = useRef(0);
  const pendingTransitionRef = useRef(null);

  const isShowingVideo = hasVideo && (displayIndex < 0 || normalizedImages.length === 0);
  const totalMediaItems = galleryImages.length + normalizedVideoUrls.length;
  const showThumbnailStrip = totalMediaItems > 1 || (showSingleThumbnail && totalMediaItems === 1);
  const desktopThumbColumns = Math.max(1, Math.min(totalMediaItems, 5));
  const desktopThumbSize = totalMediaItems <= 1
    ? '8rem'
    : totalMediaItems === 2
      ? '7.25rem'
      : totalMediaItems <= 4
        ? '6.25rem'
        : '5.5rem';
  const canDragMedia = !isShowingVideo && normalizedImages.length > 1;
  const canDesktopDragImages = canDragMedia && !isMobileViewport;
  const currentImageIndex = clampImageIndex(displayIndex >= 0 ? displayIndex : 0, galleryImages.length);
  const currentImage = galleryImages[currentImageIndex] || galleryImages[0];
  const isPrimaryDisplayOverrideVisible = Boolean(primaryDisplayImage)
    && isPrimaryDisplayOverrideActive
    && currentImageIndex === 0;
  const currentDisplayImage = isPrimaryDisplayOverrideVisible ? primaryDisplayImage : currentImage;
  const previousImage = currentImageIndex > 0 ? galleryImages[currentImageIndex - 1] : null;
  const nextImage = currentImageIndex < galleryImages.length - 1 ? galleryImages[currentImageIndex + 1] : null;
  const activeThumbIndex = isShowingVideo || isPrimaryDisplayOverrideVisible ? -1 : currentImageIndex;

  const resolveGalleryImageSrc = (image) => (
    image?.__fallback ? getImageUrl(null) : getImageUrl(image)
  );

  const clearDragAnimationFrame = () => {
    if (dragFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
  };

  const clearSettleAnimationFrame = () => {
    if (settleFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(settleFrameRef.current);
      settleFrameRef.current = null;
    }
  };

  const applyTrackOffset = (nextOffset) => {
    pendingDragOffsetRef.current = nextOffset;

    if (trackRef.current) {
      trackRef.current.style.setProperty('--product-media-track-offset', `${nextOffset}px`);
    }
  };

  const scheduleTrackOffset = (nextOffset) => {
    pendingDragOffsetRef.current = nextOffset;

    if (typeof window === 'undefined') {
      applyTrackOffset(nextOffset);
      return;
    }

    if (dragFrameRef.current !== null) {
      return;
    }

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      applyTrackOffset(pendingDragOffsetRef.current);
    });
  };

  const setTrackOffsetImmediately = (nextOffset) => {
    clearDragAnimationFrame();
    applyTrackOffset(nextOffset);
  };

  const settleTrackOffset = (nextOffset, transitionState) => {
    pendingTransitionRef.current = transitionState;
    clearSettleAnimationFrame();
    setTrackTransitionEnabled(true);

    if (!trackRef.current || typeof window === 'undefined') {
      setTrackOffsetImmediately(nextOffset);
      return;
    }

    trackRef.current.getBoundingClientRect();

    settleFrameRef.current = window.requestAnimationFrame(() => {
      settleFrameRef.current = null;
      applyTrackOffset(nextOffset);
    });
  };

  const setTrackTransitionEnabled = (enabled) => {
    if (trackRef.current) {
      trackRef.current.style.transition = enabled ? TRACK_TRANSITION : 'none';
    }
  };

  const resetSwipeState = () => {
    swipeStateRef.current = { ...EMPTY_SWIPE_STATE };
    setIsDraggingMedia(false);
  };

  const clearGestureMotion = () => {
    pendingTransitionRef.current = null;
    clearSettleAnimationFrame();
    setTrackTransitionEnabled(false);
    setTrackOffsetImmediately(0);
    resetSwipeState();
  };

  const measureStageWidth = (element = stageRef.current) => {
    const nextWidth = element?.getBoundingClientRect?.().width || 1;
    stageWidthRef.current = nextWidth;
    return nextWidth;
  };

  const getSwipeTriggerThreshold = (width) => {
    if (isMobileViewport) {
      return MOBILE_SWIPE_TRIGGER_THRESHOLD;
    }

    return Math.min(
      Math.max(width * DESKTOP_DRAG_TRIGGER_RATIO, DESKTOP_DRAG_TRIGGER_MIN_PX),
      DESKTOP_DRAG_TRIGGER_MAX_PX,
    );
  };

  const getPointerInteractionType = (event) => {
    if (
      !canDragMedia
      || event.isPrimary === false
      || (typeof event.button === 'number' && event.button > 0)
    ) {
      return null;
    }

    const pointerType = String(event.pointerType || '').toLowerCase();

    if (isMobileViewport) {
      return pointerType === 'mouse' ? null : 'touch';
    }

    return pointerType === '' || pointerType === 'mouse' ? 'mouse' : null;
  };

  const getVisualDragOffset = (deltaX, imageIndex) => {
    const atFirstImage = imageIndex === 0;
    const atLastImage = imageIndex === galleryImages.length - 1;
    const isDraggingPastStart = atFirstImage && deltaX > 0;
    const isDraggingPastEnd = atLastImage && deltaX < 0;

    return (isDraggingPastStart || isDraggingPastEnd)
      ? deltaX * EDGE_DRAG_RESISTANCE
      : deltaX;
  };

  const getCommittedSwipeIndex = (direction, fromIndex = currentImageIndex) => {
    if (direction === 'next') {
      return Math.min(fromIndex + 1, galleryImages.length - 1);
    }

    return Math.max(fromIndex - 1, 0);
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
    if (typeof window === 'undefined') {
      return undefined;
    }

    measureStageWidth();

    if (!stageRef.current || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      measureStageWidth();
    });

    resizeObserver.observe(stageRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isMobileViewport, totalMediaItems]);

  useEffect(() => {
    if (!canDragMedia) {
      clearGestureMotion();
    }
  }, [canDragMedia]);

  useEffect(() => {
    if (!primaryDisplayImage || requestedDisplayIndex !== 0) {
      setIsPrimaryDisplayOverrideActive(false);
      return;
    }

    setIsPrimaryDisplayOverrideActive(true);
  }, [primaryDisplayImage, primaryDisplayImageSignature, requestedDisplayIndex]);

  useEffect(() => {
    if (requestedDisplayIndex === displayIndexRef.current) {
      return;
    }

    clearGestureMotion();
    displayIndexRef.current = requestedDisplayIndex;
    setDisplayIndex(requestedDisplayIndex);
  }, [requestedDisplayIndex]);

  useLayoutEffect(() => {
    setTrackTransitionEnabled(false);
    setTrackOffsetImmediately(0);
  }, [displayIndex, isShowingVideo]);

  useEffect(() => (
    () => {
      clearDragAnimationFrame();
      clearSettleAnimationFrame();
    }
  ), []);

  useEffect(() => {
    if (!deferVideoThumbnails || typeof window === 'undefined') {
      setCanRenderVideoThumbnails(true);
      return undefined;
    }

    let timeoutId = null;
    let idleId = null;
    const renderThumbnails = () => setCanRenderVideoThumbnails(true);

    timeoutId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(renderThumbnails, { timeout: 1200 });
        return;
      }

      renderThumbnails();
    }, 250);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [deferVideoThumbnails]);

  useEffect(() => {
    if (!isMobileViewport || !showThumbnailStrip || typeof window === 'undefined') {
      return undefined;
    }

    const activeThumbKey = isShowingVideo ? `video-${activeVideoIndex}` : `image-${Math.max(activeThumbIndex, 0)}`;
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
  }, [activeThumbIndex, activeVideoIndex, isMobileViewport, isShowingVideo, showThumbnailStrip]);

  const setThumbRef = (key) => (node) => {
    if (node) {
      thumbRefs.current.set(key, node);
      return;
    }

    thumbRefs.current.delete(key);
  };

  const handlePointerDown = (event) => {
    const interactionType = getPointerInteractionType(event);

    if (!interactionType) {
      return;
    }

    clearGestureMotion();
    measureStageWidth(event.currentTarget);

    if (typeof event.currentTarget?.setPointerCapture === 'function' && event.pointerId != null) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore pointer capture failures and continue with drag handling.
      }
    }

    swipeStateRef.current = {
      pointerId: event.pointerId ?? 1,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      deltaY: 0,
      lockedAxis: null,
      interactionType,
      startIndex: currentImageIndex,
    };
  };

  const handlePointerMove = (event) => {
    const swipeState = swipeStateRef.current;

    if (
      !canDragMedia
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

    if (swipeState.lockedAxis !== 'x') {
      return;
    }

    scheduleTrackOffset(getVisualDragOffset(swipeState.deltaX, swipeState.startIndex));

    if (event.cancelable) {
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

    if (typeof event?.currentTarget?.releasePointerCapture === 'function' && event.pointerId != null) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released; ignore.
      }
    }

    if (swipeState.lockedAxis !== 'x') {
      resetSwipeState();
      return;
    }

    const direction = swipeState.deltaX < 0 ? 'next' : 'previous';
    const baseIndex = swipeState.startIndex;
    const nextIndex = getCommittedSwipeIndex(direction, baseIndex);
    const didSwipeToAnotherImage = nextIndex !== baseIndex;
    const nextStageWidth = stageWidthRef.current || measureStageWidth(event?.currentTarget);
    const swipeTriggerThreshold = getSwipeTriggerThreshold(nextStageWidth || 1);

    setIsDraggingMedia(false);

    if (Math.abs(swipeState.deltaX) >= swipeTriggerThreshold && didSwipeToAnotherImage) {
      settleTrackOffset(
        direction === 'next' ? -(nextStageWidth || 1) : (nextStageWidth || 1),
        { type: 'commit', nextIndex },
      );
    } else {
      settleTrackOffset(0, { type: 'reset' });
    }

    resetSwipeState();
  };

  const handleTrackTransitionEnd = (event) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return;
    }

    const pendingTransition = pendingTransitionRef.current;

    if (!pendingTransition) {
      return;
    }

    pendingTransitionRef.current = null;
    setTrackTransitionEnabled(false);

    if (pendingTransition.type === 'commit') {
      displayIndexRef.current = pendingTransition.nextIndex;
      setDisplayIndex(pendingTransition.nextIndex);
      setActiveIndex(pendingTransition.nextIndex);
      return;
    }

    setTrackOffsetImmediately(0);
  };

  const handleMediaSelect = (nextIndex) => {
    clearGestureMotion();
    setIsPrimaryDisplayOverrideActive(false);

    if (nextIndex < 0 && hasVideo) {
      displayIndexRef.current = nextIndex;
      setDisplayIndex(nextIndex);
      setActiveIndex(nextIndex);
      return;
    }

    const resolvedNextIndex = clampImageIndex(nextIndex, galleryImages.length);
    displayIndexRef.current = resolvedNextIndex;
    setDisplayIndex(resolvedNextIndex);
    setActiveIndex(resolvedNextIndex);
  };

  const stageClassName = [
    styles.productMediaStage,
    isShowingVideo ? styles.productMediaStageVideo : '',
    canDragMedia ? styles.productMediaStageSwipeable : '',
    canDesktopDragImages ? styles.productMediaStageDesktopDraggable : '',
    canDragMedia && isDraggingMedia ? styles.productMediaStageDragging : '',
  ].filter(Boolean).join(' ');
  const railStyle = {
    '--product-media-thumb-columns': desktopThumbColumns,
    '--product-media-thumb-size-desktop': desktopThumbSize,
  };

  const renderImageSlide = (image, key, hidden = false) => (
    <div
      key={key}
      className={`${styles.productMediaVisual} ${image ? '' : styles.productMediaVisualEmpty}`.trim()}
      data-product-gallery-slide={hidden ? 'adjacent' : 'active'}
      aria-hidden={hidden ? 'true' : undefined}
    >
      {image ? (
        <div className={styles.productMediaVisualFrame}>
          <Image
            src={resolveGalleryImageSrc(image)}
            alt={productName}
            fill
            sizes="(max-width: 767px) 100vw, (max-width: 1279px) 52vw, 620px"
            className={styles.productMediaImage}
            priority={priorityFirstImage && !hidden}
            loading={priorityFirstImage && !hidden ? undefined : 'lazy'}
            draggable={false}
            unoptimized
            onLoad={() => {
              if (!hidden) {
                logProductTimingOnce(
                  `render-image:${productName}:${resolveGalleryImageSrc(image)}`,
                  'render-image',
                  { productName, imageIndex: currentImageIndex }
                );
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={styles.productMediaGallery}>
      <div
        ref={stageRef}
        className={stageClassName}
        data-product-gallery-stage="true"
        data-product-gallery-mode={isShowingVideo ? 'video' : 'image'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishSwipe}
        onPointerCancel={finishSwipe}
      >
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
              onLoad={() => logProductTiming('load-video', { productName, videoIndex: activeVideoIndex })}
            />
          </div>
        ) : currentDisplayImage ? (
          <div className={styles.productMediaViewport}>
            <div
              ref={trackRef}
              className={styles.productMediaTrack}
              data-product-gallery-track="true"
              onTransitionEnd={handleTrackTransitionEnd}
            >
              {renderImageSlide(previousImage, `prev-${currentImageIndex - 1}`, true)}
              {renderImageSlide(currentDisplayImage, `current-${currentImageIndex}`)}
              {renderImageSlide(nextImage, `next-${currentImageIndex + 1}`, true)}
            </div>
          </div>
        ) : (
          <div className={styles.productMediaPlaceholder}>
            <span className="material-symbols-outlined" aria-hidden="true">image</span>
            <p>Đang cập nhật media sản phẩm</p>
          </div>
        )}
      </div>

      {showThumbnailStrip ? (
        <div
          className={styles.productMediaRail}
          style={railStyle}
          data-product-gallery-rail="true"
          role="tablist"
          aria-label="Thư viện media sản phẩm"
        >
          {hasVideo ? normalizedVideoUrls.map((candidateVideoUrl, videoIndex) => {
            const candidateThumbnailUrl = resolveVideoThumbnailUrl(candidateVideoUrl);
            const isActiveVideo = isShowingVideo && activeVideoIndex === videoIndex;
            const videoDisplayIndex = buildVideoDisplayIndex(videoIndex);

            return (
              <button
                key={`${candidateVideoUrl}-${videoIndex}`}
                type="button"
                ref={setThumbRef(`video-${videoIndex}`)}
                className={`${styles.productMediaThumb} ${styles.productMediaThumbVideo} ${isActiveVideo ? styles.productMediaThumbActive : ''}`}
                data-product-gallery-thumb={`video-${videoIndex}`}
                data-active={isActiveVideo ? 'true' : 'false'}
                onClick={() => handleMediaSelect(videoDisplayIndex)}
                aria-pressed={isActiveVideo}
                aria-label={`Xem video YouTube ${videoIndex + 1}`}
              >
                {candidateThumbnailUrl && canRenderVideoThumbnails ? (
                  <div className={styles.productMediaThumbPoster}>
                    <Image
                      src={candidateThumbnailUrl}
                      alt={`${productName} video ${videoIndex + 1} thumbnail`}
                      fill
                      sizes="88px"
                      className={styles.productMediaThumbImage}
                      draggable={false}
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
              </button>
            );
          }) : null}

          {galleryImages.map((image, index) => {
            const isActive = index === activeThumbIndex;

            return (
              <button
                key={image.id || `${resolveGalleryImageSrc(image)}-${index}`}
                type="button"
                ref={setThumbRef(`image-${index}`)}
                className={`${styles.productMediaThumb} ${isActive ? styles.productMediaThumbActive : ''}`}
                data-product-gallery-thumb={String(index)}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => handleMediaSelect(index)}
                aria-pressed={isActive}
                aria-label={`Xem \u1ea3nh ${index + 1}`}
              >
                <div className={styles.productMediaThumbPoster}>
                  <Image
                    src={resolveGalleryImageSrc(image)}
                    alt={`${productName} \u1ea3nh ${index + 1}`}
                    fill
                    sizes="88px"
                    className={styles.productMediaThumbImage}
                    draggable={false}
                    unoptimized
                  />
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
