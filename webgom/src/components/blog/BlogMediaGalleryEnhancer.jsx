'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  buildGalleryStageMarkup,
  decodeGalleryPayload,
  normalizeGalleryItems,
  renderMediaGalleryMarkup,
} from '@/lib/blogMediaGallery';

const MIN_ZOOM_SCALE = 1;
const MAX_ZOOM_SCALE = 4;
const DOUBLE_TAP_DELAY_MS = 280;
const DOUBLE_TAP_MAX_DISTANCE = 24;
const TOUCH_MOVE_TAP_CANCEL = 8;
const GALLERY_TRANSITION_MS = 280;
const GALLERY_DRAG_RESET_MS = 180;
const GALLERY_POINTER_LOCK_DISTANCE = 10;
const GALLERY_AXIS_LOCK_RATIO = 1.22;
const GALLERY_SWIPE_MIN_DISTANCE = 44;
const GALLERY_SWIPE_MAX_THRESHOLD = 92;
const GALLERY_SWIPE_DISTANCE_RATIO = 0.16;
const GALLERY_DRAG_LIMIT_RATIO = 0.34;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getWrappedGalleryIndex(index, itemCount) {
  if (!itemCount) {
    return 0;
  }

  const numericIndex = Number.isFinite(index) ? index : 0;
  return ((numericIndex % itemCount) + itemCount) % itemCount;
}

function getSwipeThreshold(width) {
  return Math.min(
    GALLERY_SWIPE_MAX_THRESHOLD,
    Math.max(GALLERY_SWIPE_MIN_DISTANCE, width * GALLERY_SWIPE_DISTANCE_RATIO),
  );
}

function shouldReduceMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function preloadGalleryImages(items) {
  if (typeof window === 'undefined' || typeof window.Image !== 'function') {
    return;
  }

  items.forEach((item) => {
    if (item?.type !== 'image' || !item.src) {
      return;
    }

    const image = new window.Image();
    image.decoding = 'async';
    image.src = item.src;
  });
}

function setPointerCapture(target, pointerId) {
  if (!target || pointerId == null || typeof target.setPointerCapture !== 'function') {
    return false;
  }

  try {
    target.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

function releasePointerCapture(target, pointerId) {
  if (!target || pointerId == null || typeof target.releasePointerCapture !== 'function') {
    return;
  }

  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already be released.
  }
}

function getTouchPoint(touch) {
  return {
    x: touch?.clientX || 0,
    y: touch?.clientY || 0,
  };
}

function getTouchDistance(touches) {
  if (!touches || touches.length < 2) {
    return 0;
  }

  const first = touches[0];
  const second = touches[1];
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function getTouchCenter(touches) {
  if (!touches || touches.length < 2) {
    return { x: 0, y: 0 };
  }

  const first = touches[0];
  const second = touches[1];

  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function clampZoomTransform(transform, rect) {
  const scale = clampNumber(transform?.scale || MIN_ZOOM_SCALE, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);

  if (!rect || scale <= MIN_ZOOM_SCALE) {
    return {
      scale: MIN_ZOOM_SCALE,
      x: 0,
      y: 0,
    };
  }

  const minX = rect.width * (1 - scale);
  const minY = rect.height * (1 - scale);

  return {
    scale,
    x: clampNumber(transform?.x || 0, minX, 0),
    y: clampNumber(transform?.y || 0, minY, 0),
  };
}

function scaleTransformAroundPoint(currentTransform, nextScale, point, rect) {
  const currentScale = currentTransform?.scale || MIN_ZOOM_SCALE;
  const normalizedScale = clampNumber(nextScale, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);

  if (!rect || normalizedScale <= MIN_ZOOM_SCALE) {
    return {
      scale: MIN_ZOOM_SCALE,
      x: 0,
      y: 0,
    };
  }

  const ratio = normalizedScale / currentScale;
  const nextTransform = {
    scale: normalizedScale,
    x: point.x - (ratio * (point.x - (currentTransform?.x || 0))),
    y: point.y - (ratio * (point.y - (currentTransform?.y || 0))),
  };

  return clampZoomTransform(nextTransform, rect);
}

function useBlogImageZoom({ enabled }) {
  const containerNodeRef = useRef(null);
  const [containerNode, setContainerNodeState] = useState(null);
  const gestureRef = useRef({
    lastPoint: null,
    lastCenter: null,
    lastDistance: 0,
    tapStart: null,
    tapMoved: false,
    lastTapAt: 0,
    lastTapPoint: null,
    pointerId: null,
    pointerPoint: null,
  });
  const [transform, setTransform] = useState({
    scale: MIN_ZOOM_SCALE,
    x: 0,
    y: 0,
  });
  const transformRef = useRef(transform);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const setContainerNode = useCallback((node) => {
    containerNodeRef.current = node;
    setContainerNodeState(node);
  }, []);

  const setNextTransform = useCallback((nextTransform) => {
    const rect = containerNodeRef.current?.getBoundingClientRect();
    const normalizedTransform = clampZoomTransform(nextTransform, rect);

    transformRef.current = normalizedTransform;
    setTransform(normalizedTransform);
  }, []);

  const resetTransform = useCallback(() => {
    gestureRef.current = {
      lastPoint: null,
      lastCenter: null,
      lastDistance: 0,
      tapStart: null,
      tapMoved: false,
      lastTapAt: 0,
      lastTapPoint: null,
      pointerId: null,
      pointerPoint: null,
    };

    setNextTransform({
      scale: MIN_ZOOM_SCALE,
      x: 0,
      y: 0,
    });
  }, [setNextTransform]);

  const zoomAtClientPoint = useCallback((nextScale, clientPoint = null) => {
    const rect = containerNodeRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const point = clientPoint
      ? {
        x: clientPoint.x - rect.left,
        y: clientPoint.y - rect.top,
      }
      : {
        x: rect.width / 2,
        y: rect.height / 2,
      };

    setNextTransform(scaleTransformAroundPoint(transformRef.current, nextScale, point, rect));
  }, [setNextTransform]);

  const zoomIn = useCallback(() => {
    zoomAtClientPoint(transformRef.current.scale * 1.35);
  }, [zoomAtClientPoint]);

  const zoomOut = useCallback(() => {
    zoomAtClientPoint(transformRef.current.scale / 1.35);
  }, [zoomAtClientPoint]);

  const toggleZoomAtPoint = useCallback((clientPoint = null) => {
    if (transformRef.current.scale > MIN_ZOOM_SCALE + 0.01) {
      resetTransform();
      return;
    }

    zoomAtClientPoint(2.4, clientPoint);
  }, [resetTransform, zoomAtClientPoint]);

  const handleTouchStart = useCallback((event) => {
    if (!enabled) {
      return;
    }

    const touches = event.touches || [];
    const gesture = gestureRef.current;

    if (touches.length === 2) {
      gesture.lastCenter = getTouchCenter(touches);
      gesture.lastDistance = getTouchDistance(touches);
      gesture.tapMoved = true;
      return;
    }

    if (touches.length !== 1) {
      return;
    }

    const point = getTouchPoint(touches[0]);
    gesture.lastPoint = point;
    gesture.tapStart = point;
    gesture.tapMoved = false;
    gesture.lastCenter = null;
    gesture.lastDistance = 0;
  }, [enabled]);

  const handleTouchMove = useCallback((event) => {
    if (!enabled) {
      return;
    }

    const touches = event.touches || [];
    const gesture = gestureRef.current;

    if (touches.length === 2) {
      const rect = containerNodeRef.current?.getBoundingClientRect();
      const currentDistance = getTouchDistance(touches);
      const currentCenter = getTouchCenter(touches);

      if (!rect || !currentDistance) {
        return;
      }

      if (!gesture.lastDistance) {
        gesture.lastDistance = currentDistance;
        gesture.lastCenter = currentCenter;
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const scaledTransform = scaleTransformAroundPoint(
        transformRef.current,
        transformRef.current.scale * (currentDistance / gesture.lastDistance),
        {
          x: currentCenter.x - rect.left,
          y: currentCenter.y - rect.top,
        },
        rect,
      );

      setNextTransform({
        ...scaledTransform,
        x: scaledTransform.x + (currentCenter.x - gesture.lastCenter.x),
        y: scaledTransform.y + (currentCenter.y - gesture.lastCenter.y),
      });

      gesture.lastCenter = currentCenter;
      gesture.lastDistance = currentDistance;
      gesture.tapMoved = true;
      return;
    }

    if (touches.length !== 1) {
      return;
    }

    const point = getTouchPoint(touches[0]);
    const currentTransform = transformRef.current;

    if (
      gesture.tapStart
      && (
        Math.abs(point.x - gesture.tapStart.x) > TOUCH_MOVE_TAP_CANCEL
        || Math.abs(point.y - gesture.tapStart.y) > TOUCH_MOVE_TAP_CANCEL
      )
    ) {
      gesture.tapMoved = true;
    }

    if (currentTransform.scale > MIN_ZOOM_SCALE) {
      const lastPoint = gesture.lastPoint || point;

      if (event.cancelable) {
        event.preventDefault();
      }

      setNextTransform({
        ...currentTransform,
        x: currentTransform.x + (point.x - lastPoint.x),
        y: currentTransform.y + (point.y - lastPoint.y),
      });
    }

    gesture.lastPoint = point;
  }, [enabled, setNextTransform]);

  const handleTouchEnd = useCallback((event) => {
    if (!enabled) {
      return;
    }

    const gesture = gestureRef.current;
    const remainingTouches = event.touches?.length || 0;

    if (remainingTouches === 1) {
      const point = getTouchPoint(event.touches[0]);
      gesture.lastPoint = point;
      gesture.tapStart = point;
      gesture.tapMoved = true;
      gesture.lastCenter = null;
      gesture.lastDistance = 0;
      return;
    }

    if (remainingTouches > 1) {
      return;
    }

    if (!gesture.tapMoved && gesture.tapStart) {
      const now = Date.now();
      const isDoubleTap = (
        now - gesture.lastTapAt <= DOUBLE_TAP_DELAY_MS
        && gesture.lastTapPoint
        && Math.hypot(
          gesture.lastTapPoint.x - gesture.tapStart.x,
          gesture.lastTapPoint.y - gesture.tapStart.y,
        ) <= DOUBLE_TAP_MAX_DISTANCE
      );

      if (isDoubleTap) {
        toggleZoomAtPoint(gesture.tapStart);
        gesture.lastTapAt = 0;
        gesture.lastTapPoint = null;
      } else {
        gesture.lastTapAt = now;
        gesture.lastTapPoint = gesture.tapStart;
      }
    }

    gesture.lastPoint = null;
    gesture.lastCenter = null;
    gesture.lastDistance = 0;
    gesture.tapStart = null;
    gesture.tapMoved = false;
  }, [enabled, toggleZoomAtPoint]);

  useEffect(() => {
    if (!enabled || !containerNode || typeof containerNode.addEventListener !== 'function') {
      return undefined;
    }

    const passiveOptions = { passive: true };
    const activeOptions = { passive: false };

    containerNode.addEventListener('touchstart', handleTouchStart, passiveOptions);
    containerNode.addEventListener('touchmove', handleTouchMove, activeOptions);
    containerNode.addEventListener('touchend', handleTouchEnd, passiveOptions);
    containerNode.addEventListener('touchcancel', handleTouchEnd, passiveOptions);

    return () => {
      containerNode.removeEventListener('touchstart', handleTouchStart, passiveOptions);
      containerNode.removeEventListener('touchmove', handleTouchMove, activeOptions);
      containerNode.removeEventListener('touchend', handleTouchEnd, passiveOptions);
      containerNode.removeEventListener('touchcancel', handleTouchEnd, passiveOptions);
    };
  }, [containerNode, enabled, handleTouchEnd, handleTouchMove, handleTouchStart]);

  const handlePointerDown = useCallback((event) => {
    if (
      !enabled
      || transformRef.current.scale <= MIN_ZOOM_SCALE + 0.01
      || event.isPrimary === false
      || (typeof event.button === 'number' && event.button > 0)
    ) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    if (typeof event.currentTarget?.setPointerCapture === 'function' && event.pointerId != null) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the browser has already released it.
      }
    }

    gestureRef.current.pointerId = event.pointerId ?? 1;
    gestureRef.current.pointerPoint = {
      x: event.clientX,
      y: event.clientY,
    };
  }, [enabled]);

  const handlePointerMove = useCallback((event) => {
    const gesture = gestureRef.current;

    if (
      !enabled
      || gesture.pointerId === null
      || (event.pointerId != null && gesture.pointerId !== event.pointerId)
      || transformRef.current.scale <= MIN_ZOOM_SCALE + 0.01
    ) {
      return;
    }

    const lastPoint = gesture.pointerPoint || { x: event.clientX, y: event.clientY };

    if (event.cancelable) {
      event.preventDefault();
    }

    setNextTransform({
      ...transformRef.current,
      x: transformRef.current.x + (event.clientX - lastPoint.x),
      y: transformRef.current.y + (event.clientY - lastPoint.y),
    });

    gesture.pointerPoint = {
      x: event.clientX,
      y: event.clientY,
    };
  }, [enabled, setNextTransform]);

  const handlePointerEnd = useCallback((event) => {
    const gesture = gestureRef.current;

    if (gesture.pointerId === null || (event?.pointerId != null && gesture.pointerId !== event.pointerId)) {
      return;
    }

    if (typeof event?.currentTarget?.releasePointerCapture === 'function' && event.pointerId != null) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released.
      }
    }

    gesture.pointerId = null;
    gesture.pointerPoint = null;
  }, []);

  const handleWheel = useCallback((event) => {
    if (!enabled) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
    zoomAtClientPoint(transformRef.current.scale * factor, {
      x: event.clientX,
      y: event.clientY,
    });
  }, [enabled, zoomAtClientPoint]);

  const handleDoubleClick = useCallback((event) => {
    if (!enabled) {
      return;
    }

    toggleZoomAtPoint({
      x: event.clientX,
      y: event.clientY,
    });
  }, [enabled, toggleZoomAtPoint]);

  return {
    setContainerNode,
    transform,
    isZoomed: transform.scale > MIN_ZOOM_SCALE + 0.01,
    canZoomIn: transform.scale < MAX_ZOOM_SCALE - 0.01,
    canZoomOut: transform.scale > MIN_ZOOM_SCALE + 0.01,
    resetTransform,
    zoomIn,
    zoomOut,
    viewportHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onWheel: handleWheel,
      onDoubleClick: handleDoubleClick,
    },
  };
}

function hydrateGallery(galleryElement, openImageLightbox) {
  if (!galleryElement) {
    return undefined;
  }

  const items = normalizeGalleryItems(decodeGalleryPayload(galleryElement.getAttribute('data-gallery-payload')));

  if (!items.length) {
    return undefined;
  }

  const stage = galleryElement.querySelector('[data-gallery-stage]');
  const thumbs = Array.from(galleryElement.querySelectorAll('[data-gallery-index]'));
  let activeIndex = getWrappedGalleryIndex(
    Number(galleryElement.getAttribute('data-gallery-active-index') || 0),
    items.length,
  );
  let transitionTimer = null;
  let dragResetTimer = null;
  let suppressClickTimer = null;
  let suppressNextClick = false;
  let pointerGesture = null;

  preloadGalleryImages(items);

  const clearTransitionState = () => {
    if (!stage) {
      return;
    }

    if (transitionTimer) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }

    stage.classList.remove('is-transitioning');
    stage.style.removeProperty('height');
    stage.style.removeProperty('--bdt-gallery-enter-x');
    stage.style.removeProperty('--bdt-gallery-exit-x');
  };

  const clearDragVisual = () => {
    if (!stage) {
      return;
    }

    if (dragResetTimer) {
      window.clearTimeout(dragResetTimer);
      dragResetTimer = null;
    }

    stage.classList.remove('is-dragging', 'is-drag-reset');
    stage.style.removeProperty('--bdt-gallery-drag-offset');
  };

  const resetDragVisual = () => {
    if (!stage) {
      return;
    }

    if (dragResetTimer) {
      window.clearTimeout(dragResetTimer);
    }

    stage.classList.add('is-drag-reset');
    stage.style.setProperty('--bdt-gallery-drag-offset', '0px');
    dragResetTimer = window.setTimeout(() => {
      clearDragVisual();
    }, GALLERY_DRAG_RESET_MS);
  };

  const renderStage = (item, options = {}) => {
    if (!stage || !item) {
      return;
    }

    const nextMarkup = buildGalleryStageMarkup(item);

    if (!nextMarkup) {
      return;
    }

    const shouldAnimate = Boolean(options.animate)
      && !shouldReduceMotion()
      && Boolean(stage.innerHTML.trim());

    if (!shouldAnimate) {
      clearTransitionState();
      clearDragVisual();
      stage.innerHTML = nextMarkup;
      return;
    }

    const previousMarkup = stage.innerHTML;
    const rect = stage.getBoundingClientRect();

    if (!previousMarkup.trim() || !rect.height) {
      clearTransitionState();
      clearDragVisual();
      stage.innerHTML = nextMarkup;
      return;
    }

    const direction = options.direction >= 0 ? 1 : -1;
    const outgoingLayer = document.createElement('div');
    const incomingLayer = document.createElement('div');

    clearTransitionState();
    clearDragVisual();

    stage.style.height = `${rect.height}px`;
    stage.style.setProperty('--bdt-gallery-enter-x', direction > 0 ? '18%' : '-18%');
    stage.style.setProperty('--bdt-gallery-exit-x', direction > 0 ? '-18%' : '18%');
    stage.classList.add('is-transitioning');

    outgoingLayer.className = 'bdt-media-gallery-transition-layer is-exit';
    incomingLayer.className = 'bdt-media-gallery-transition-layer is-enter';
    outgoingLayer.innerHTML = previousMarkup;
    incomingLayer.innerHTML = nextMarkup;
    stage.replaceChildren(outgoingLayer, incomingLayer);

    transitionTimer = window.setTimeout(() => {
      stage.innerHTML = nextMarkup;
      clearTransitionState();
    }, GALLERY_TRANSITION_MS);
  };

  const updateThumbs = (nextIndex, options = {}) => {
    thumbs.forEach((thumb, thumbIndex) => {
      const isActive = thumbIndex === nextIndex;
      thumb.classList.toggle('is-active', isActive);
      thumb.setAttribute('aria-pressed', isActive ? 'true' : 'false');

      if (isActive && options.scrollThumb && typeof thumb.scrollIntoView === 'function') {
        thumb.scrollIntoView({
          behavior: shouldReduceMotion() ? 'auto' : 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    });
  };

  const setActiveIndex = (index, options = {}) => {
    const nextIndex = options.wrap
      ? getWrappedGalleryIndex(index, items.length)
      : (Number.isInteger(index) && items[index] ? index : 0);
    const nextItem = items[nextIndex] || items[0];
    const previousIndex = activeIndex;
    const direction = options.direction || (nextIndex >= previousIndex ? 1 : -1);

    if (nextIndex === activeIndex && !options.force) {
      updateThumbs(nextIndex, { scrollThumb: options.scrollThumb });
      return;
    }

    activeIndex = nextIndex;
    renderStage(nextItem, {
      animate: options.animate,
      direction,
    });
    galleryElement.setAttribute('data-gallery-active-index', String(nextIndex));
    updateThumbs(nextIndex, { scrollThumb: options.scrollThumb });
  };

  thumbs.forEach((thumb) => {
    thumb.onclick = () => {
      setActiveIndex(Number(thumb.getAttribute('data-gallery-index') || 0), {
        animate: true,
        scrollThumb: true,
      });
    };
  });

  if (stage) {
    const suppressClickAfterDrag = () => {
      suppressNextClick = true;

      if (suppressClickTimer) {
        window.clearTimeout(suppressClickTimer);
      }

      suppressClickTimer = window.setTimeout(() => {
        suppressNextClick = false;
        suppressClickTimer = null;
      }, 140);
    };

    const finishPointerGesture = (event) => {
      if (!pointerGesture) {
        return null;
      }

      const gesture = pointerGesture;
      pointerGesture = null;

      if (gesture.hasPointerCapture) {
        releasePointerCapture(stage, gesture.pointerId);
      }

      if (event?.currentTarget && event.currentTarget !== stage && gesture.hasPointerCapture) {
        releasePointerCapture(event.currentTarget, gesture.pointerId);
      }

      return gesture;
    };

    const handlePointerDown = (event) => {
      if (
        items.length < 2
        || event.isPrimary === false
        || (typeof event.button === 'number' && event.button > 0)
        || !event.target?.closest?.('.bdt-media-gallery-stage-image-wrap')
      ) {
        return;
      }

      const currentItem = items[activeIndex] || items[0];

      if (currentItem?.type !== 'image') {
        return;
      }

      clearDragVisual();
      pointerGesture = {
        pointerId: event.pointerId ?? 1,
        pointerType: event.pointerType || '',
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        horizontal: false,
        vertical: false,
        hasPointerCapture: false,
      };

      if (event.pointerType === 'mouse') {
        if (event.cancelable) {
          event.preventDefault();
        }

        pointerGesture.hasPointerCapture = setPointerCapture(stage, pointerGesture.pointerId);
      }
    };

    const handlePointerMove = (event) => {
      if (!pointerGesture || pointerGesture.pointerId !== (event.pointerId ?? 1)) {
        return;
      }

      const gesture = pointerGesture;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;

      if (!gesture.horizontal && !gesture.vertical) {
        if (absY > GALLERY_POINTER_LOCK_DISTANCE && absY > absX * GALLERY_AXIS_LOCK_RATIO) {
          gesture.vertical = true;
          finishPointerGesture(event);
          clearDragVisual();
          return;
        }

        if (absX > GALLERY_POINTER_LOCK_DISTANCE && absX > absY * GALLERY_AXIS_LOCK_RATIO) {
          gesture.horizontal = true;
          gesture.hasPointerCapture = gesture.hasPointerCapture
            || setPointerCapture(stage, gesture.pointerId);
          stage.classList.add('is-dragging');
        } else {
          return;
        }
      }

      if (!gesture.horizontal) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const width = stage.getBoundingClientRect().width || 1;
      const dragLimit = width * GALLERY_DRAG_LIMIT_RATIO;
      const offset = Math.sign(deltaX) * Math.min(absX * 0.72, dragLimit);
      stage.style.setProperty('--bdt-gallery-drag-offset', `${offset}px`);
    };

    const handlePointerEnd = (event) => {
      if (!pointerGesture || pointerGesture.pointerId !== (event.pointerId ?? 1)) {
        return;
      }

      const gesture = finishPointerGesture(event);

      if (!gesture?.horizontal) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const deltaX = (event.clientX || gesture.lastX) - gesture.startX;
      const deltaY = (event.clientY || gesture.lastY) - gesture.startY;
      const width = stage.getBoundingClientRect().width || 1;
      const threshold = getSwipeThreshold(width);
      suppressClickAfterDrag();

      if (Math.abs(deltaX) >= threshold && Math.abs(deltaX) > Math.abs(deltaY) * GALLERY_AXIS_LOCK_RATIO) {
        const direction = deltaX < 0 ? 1 : -1;
        clearDragVisual();
        setActiveIndex(activeIndex + direction, {
          animate: true,
          direction,
          scrollThumb: true,
          wrap: true,
        });
      } else {
        resetDragVisual();
      }
    };

    const handlePointerCancel = (event) => {
      if (!pointerGesture || pointerGesture.pointerId !== (event.pointerId ?? 1)) {
        return;
      }

      const gesture = finishPointerGesture(event);

      if (gesture?.horizontal) {
        resetDragVisual();
      }
    };

    const handleClickCapture = (event) => {
      if (!suppressNextClick) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = false;
    };

    stage.addEventListener('pointerdown', handlePointerDown);
    stage.addEventListener('pointermove', handlePointerMove);
    stage.addEventListener('pointerup', handlePointerEnd);
    stage.addEventListener('pointercancel', handlePointerCancel);
    stage.addEventListener('lostpointercapture', handlePointerCancel);
    stage.addEventListener('click', handleClickCapture, true);

    stage.ondblclick = (event) => {
      const target = event.target;

      if (!target?.closest?.('.bdt-media-gallery-stage-image-wrap')) {
        return;
      }

      const activeIndex = Number(galleryElement.getAttribute('data-gallery-active-index') || 0);
      const activeItem = items[activeIndex] || items[0];

      if (activeItem?.type !== 'image' || !activeItem.src) {
        return;
      }

      event.preventDefault();
      openImageLightbox({
        src: activeItem.src,
        alt: activeItem.alt || 'Anh bai viet',
      });
    };

    stage.__bdtGalleryPointerCleanup = () => {
      if (pointerGesture?.hasPointerCapture) {
        releasePointerCapture(stage, pointerGesture.pointerId);
      }

      pointerGesture = null;
      stage.removeEventListener('pointerdown', handlePointerDown);
      stage.removeEventListener('pointermove', handlePointerMove);
      stage.removeEventListener('pointerup', handlePointerEnd);
      stage.removeEventListener('pointercancel', handlePointerCancel);
      stage.removeEventListener('lostpointercapture', handlePointerCancel);
      stage.removeEventListener('click', handleClickCapture, true);
    };
  }

  setActiveIndex(activeIndex, { force: true });

  return () => {
    if (transitionTimer) {
      window.clearTimeout(transitionTimer);
    }

    if (dragResetTimer) {
      window.clearTimeout(dragResetTimer);
    }

    if (suppressClickTimer) {
      window.clearTimeout(suppressClickTimer);
    }

    if (stage) {
      stage.__bdtGalleryPointerCleanup?.();
      delete stage.__bdtGalleryPointerCleanup;
      stage.ondblclick = null;
      clearTransitionState();
      clearDragVisual();
    }

    thumbs.forEach((thumb) => {
      thumb.onclick = null;
    });
  };
}

function upgradeRawGalleryElement(galleryElement, index) {
  if (!galleryElement || galleryElement.classList.contains('bdt-media-gallery')) {
    return galleryElement;
  }

  const items = normalizeGalleryItems(decodeGalleryPayload(galleryElement.getAttribute('data-gallery-payload')));
  const galleryMarkup = renderMediaGalleryMarkup(items, `client-${index}`);

  if (!galleryMarkup) {
    galleryElement.remove();
    return null;
  }

  const template = document.createElement('template');
  template.innerHTML = galleryMarkup;
  const replacement = template.content.firstElementChild;

  if (!replacement) {
    galleryElement.remove();
    return null;
  }

  galleryElement.replaceWith(replacement);
  return replacement;
}

function BlogImageLightbox({ image, onClose }) {
  const {
    setContainerNode,
    transform,
    isZoomed,
    canZoomIn,
    canZoomOut,
    resetTransform,
    zoomIn,
    zoomOut,
    viewportHandlers,
  } = useBlogImageZoom({ enabled: Boolean(image?.src) });

  useEffect(() => {
    resetTransform();
  }, [image?.src, resetTransform]);

  useEffect(() => {
    if (!image?.src || typeof document === 'undefined') {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [image?.src, onClose]);

  if (!image?.src) {
    return null;
  }

  const zoomStyle = {
    transform: `matrix(${transform.scale}, 0, 0, ${transform.scale}, ${transform.x}, ${transform.y})`,
    transformOrigin: 'top left',
    transition: isZoomed ? 'none' : 'transform 180ms ease-out',
  };

  return (
    <div
      className="bdt-media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Xem anh bai viet"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="bdt-media-lightbox-close"
        aria-label="Dong xem anh"
        onClick={onClose}
      >
        <span className="material-symbols-outlined" aria-hidden="true">close</span>
      </button>

      <div className="bdt-media-lightbox-tools" aria-label="Dieu khien zoom">
        <button
          type="button"
          className="bdt-media-lightbox-tool"
          aria-label="Phong to anh"
          onClick={zoomIn}
          disabled={!canZoomIn}
        >
          <span className="material-symbols-outlined" aria-hidden="true">zoom_in</span>
        </button>
        <button
          type="button"
          className="bdt-media-lightbox-tool"
          aria-label="Thu nho anh"
          onClick={zoomOut}
          disabled={!canZoomOut}
        >
          <span className="material-symbols-outlined" aria-hidden="true">zoom_out</span>
        </button>
        <button
          type="button"
          className="bdt-media-lightbox-tool"
          aria-label="Dat lai zoom"
          onClick={resetTransform}
          disabled={!canZoomOut}
        >
          <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span>
        </button>
      </div>

      <div className="bdt-media-lightbox-stage">
        <div
          ref={setContainerNode}
          className={`bdt-media-lightbox-viewport${isZoomed ? ' is-zoomed' : ''}`}
          {...viewportHandlers}
        >
          <Image
            src={image.src}
            alt={image.alt || 'Anh bai viet'}
            fill
            unoptimized
            sizes="100vw"
            className="bdt-media-lightbox-image"
            style={zoomStyle}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

function BlogMediaGalleryStyles() {
  return (
    <style>{`
      .bdt-content .bdt-media-gallery {
        margin: clamp(1.15rem, 2.3vw, 1.6rem) 0;
        padding: clamp(0.45rem, 0.9vw, 0.6rem);
        border-radius: 1.15rem;
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 234, 223, 0.92));
        box-shadow: 0 14px 30px rgba(27, 54, 93, 0.08);
      }

      .bdt-content .ql-bdt-media-gallery {
        display: none !important;
      }

      .bdt-content .bdt-media-gallery-main {
        position: relative;
        width: 100%;
        overflow: hidden;
        border-radius: 1.1rem;
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.42), transparent 35%),
          linear-gradient(135deg, #ece4d7, #f4efe7);
        touch-action: pan-y;
        --bdt-gallery-drag-offset: 0px;
      }

      .bdt-content .bdt-media-gallery-stage-image-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.46);
        cursor: zoom-in;
        touch-action: pan-y;
        transform: translate3d(0, 0, 0);
        will-change: transform;
      }

      .bdt-content .bdt-media-gallery-main.is-dragging .bdt-media-gallery-stage-image-wrap {
        cursor: grabbing;
        transform: translate3d(var(--bdt-gallery-drag-offset), 0, 0);
        transition: none;
      }

      .bdt-content .bdt-media-gallery-main.is-drag-reset .bdt-media-gallery-stage-image-wrap {
        transition: transform ${GALLERY_DRAG_RESET_MS}ms ease-out;
      }

      .bdt-content .bdt-media-gallery-stage-image {
        display: block;
        width: 100%;
        max-width: none;
        height: 100% !important;
        margin: 0;
        border-radius: 0;
        object-fit: cover;
        object-position: center;
        user-select: none;
        -webkit-user-drag: none;
      }

      .bdt-content .bdt-media-gallery-stage-video {
        position: relative;
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        background: #0f172a;
      }

      .bdt-content .bdt-media-gallery-stage-video iframe {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
      }

      .bdt-content .bdt-media-gallery-main.is-transitioning {
        overflow: hidden;
      }

      .bdt-content .bdt-media-gallery-transition-layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: hidden;
      }

      .bdt-content .bdt-media-gallery-transition-layer > .bdt-media-gallery-stage-image-wrap,
      .bdt-content .bdt-media-gallery-transition-layer > .bdt-media-gallery-stage-video {
        width: 100%;
        height: 100%;
        aspect-ratio: auto;
      }

      .bdt-content .bdt-media-gallery-transition-layer.is-enter {
        animation: bdtGalleryEnter ${GALLERY_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      .bdt-content .bdt-media-gallery-transition-layer.is-exit {
        animation: bdtGalleryExit ${GALLERY_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both;
      }

      @keyframes bdtGalleryEnter {
        from {
          opacity: 0.28;
          transform: translate3d(var(--bdt-gallery-enter-x), 0, 0) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }

      @keyframes bdtGalleryExit {
        from {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        to {
          opacity: 0;
          transform: translate3d(var(--bdt-gallery-exit-x), 0, 0) scale(0.985);
        }
      }

      .bdt-content .bdt-media-gallery-thumbs {
        display: flex;
        gap: 0.65rem;
        margin-top: 0.7rem;
        padding-bottom: 0.15rem;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: rgba(197, 160, 89, 0.55) transparent;
      }

      .bdt-content .bdt-media-gallery-thumbs::-webkit-scrollbar {
        height: 6px;
      }

      .bdt-content .bdt-media-gallery-thumbs::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(197, 160, 89, 0.55);
      }

      .bdt-content .bdt-media-gallery-thumb {
        display: flex;
        flex: 0 0 108px;
        flex-direction: column;
        gap: 0.38rem;
        padding: 0;
        border: 1px solid rgba(197, 160, 89, 0.18);
        border-radius: 0.95rem;
        background: rgba(255, 255, 255, 0.92);
        color: #1B365D;
        transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
        overflow: hidden;
        cursor: pointer;
      }

      .bdt-content .bdt-media-gallery-thumb:hover {
        transform: translateY(-2px);
        border-color: rgba(27, 54, 93, 0.28);
        box-shadow: 0 12px 20px rgba(27, 54, 93, 0.08);
      }

      .bdt-content .bdt-media-gallery-thumb.is-active {
        border-color: rgba(197, 160, 89, 0.92);
        box-shadow: 0 0 0 2px rgba(197, 160, 89, 0.22);
      }

      .bdt-content .bdt-media-gallery-thumb-frame {
        position: relative;
        display: block;
        width: 100%;
        aspect-ratio: 1 / 1;
        overflow: hidden;
        background: rgba(27, 54, 93, 0.06);
      }

      .bdt-content .bdt-media-gallery-thumb-frame img {
        display: block;
        width: 100%;
        max-width: none;
        height: 100% !important;
        margin: 0;
        border-radius: 0;
        object-fit: cover;
        object-position: center;
      }

      .bdt-content .bdt-media-gallery-thumb-play {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 2rem;
        text-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
        pointer-events: none;
      }

      .bdt-content .bdt-media-gallery-thumb-label {
        display: block;
        padding: 0 0.7rem 0.7rem;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-align: center;
        text-transform: uppercase;
        color: rgba(27, 54, 93, 0.72);
      }

      @media (min-width: 701px) {
        .bdt-content .bdt-media-gallery-main {
          width: 50%;
          margin-inline: auto;
        }

        .bdt-content .bdt-media-gallery-thumbs {
          width: 50%;
          margin-inline: auto;
          justify-content: center;
        }
      }

      .bdt-media-lightbox {
        position: fixed;
        inset: 0;
        z-index: 1300;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: rgba(8, 12, 20, 0.94);
      }

      .bdt-media-lightbox-stage {
        position: relative;
        width: min(96vw, 980px);
        height: min(92vh, 980px);
        overflow: hidden;
      }

      .bdt-media-lightbox-viewport {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        touch-action: none;
        cursor: zoom-in;
      }

      .bdt-media-lightbox-viewport.is-zoomed {
        cursor: grab;
      }

      .bdt-media-lightbox-viewport.is-zoomed:active {
        cursor: grabbing;
      }

      .bdt-media-lightbox-image {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center;
        transform-origin: top left;
        will-change: transform;
        user-select: none;
        -webkit-user-drag: none;
      }

      .bdt-media-lightbox-close,
      .bdt-media-lightbox-tool {
        position: absolute;
        z-index: 2;
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        cursor: pointer;
        backdrop-filter: blur(10px);
        box-shadow: 0 12px 28px rgba(8, 12, 20, 0.24);
      }

      .bdt-media-lightbox-close {
        top: 1rem;
        right: 1rem;
      }

      .bdt-media-lightbox-tools {
        position: absolute;
        left: 50%;
        bottom: 1rem;
        z-index: 2;
        display: flex;
        gap: 0.55rem;
        transform: translateX(-50%);
      }

      .bdt-media-lightbox-tool {
        position: static;
      }

      .bdt-media-lightbox-close:hover,
      .bdt-media-lightbox-tool:hover {
        background: rgba(255, 255, 255, 0.18);
      }

      .bdt-media-lightbox-tool:disabled {
        cursor: default;
        opacity: 0.42;
      }

      .bdt-media-lightbox-close .material-symbols-outlined,
      .bdt-media-lightbox-tool .material-symbols-outlined {
        font-size: 1.35rem;
      }

      @media (max-width: 600px) {
        .bdt-content .bdt-media-gallery {
          border-radius: 1.08rem;
          padding: 0.48rem;
        }

        .bdt-content .bdt-media-gallery-main {
          border-radius: 0.9rem;
        }

        .bdt-content .bdt-media-gallery-thumb {
          flex-basis: 92px;
          border-radius: 0.82rem;
        }

        .bdt-content .bdt-media-gallery-thumb-label {
          padding: 0 0.55rem 0.55rem;
          font-size: 0.66rem;
        }

        .bdt-media-lightbox {
          padding: 0.75rem;
        }

        .bdt-media-lightbox-stage {
          width: 100%;
          height: min(88vh, 100vw);
        }

        .bdt-media-lightbox-close,
        .bdt-media-lightbox-tool {
          width: 40px;
          height: 40px;
        }

        .bdt-media-lightbox-close {
          top: 0.75rem;
          right: 0.75rem;
        }

        .bdt-media-lightbox-tools {
          bottom: 0.75rem;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .bdt-content .bdt-media-gallery-transition-layer.is-enter,
        .bdt-content .bdt-media-gallery-transition-layer.is-exit,
        .bdt-content .bdt-media-gallery-main.is-drag-reset .bdt-media-gallery-stage-image-wrap {
          animation: none;
          transition: none;
        }
      }
    `}</style>
  );
}

export default function BlogMediaGalleryEnhancer({ contentKey }) {
  const [lightboxImage, setLightboxImage] = useState(null);
  const openImageLightbox = useCallback((image) => {
    setLightboxImage(image);
  }, []);
  const closeImageLightbox = useCallback(() => {
    setLightboxImage(null);
  }, []);

  useEffect(() => {
    const rawGalleries = Array.from(document.querySelectorAll('.bdt-content .ql-bdt-media-gallery[data-gallery-payload]'));
    rawGalleries.forEach((gallery, index) => {
      upgradeRawGalleryElement(gallery, index);
    });

    const galleries = Array.from(document.querySelectorAll('.bdt-content .bdt-media-gallery'));
    const cleanups = galleries
      .map((gallery) => hydrateGallery(gallery, openImageLightbox))
      .filter(Boolean);

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [contentKey, openImageLightbox]);

  return (
    <>
      <BlogMediaGalleryStyles />
      <BlogImageLightbox image={lightboxImage} onClose={closeImageLightbox} />
    </>
  );
}
