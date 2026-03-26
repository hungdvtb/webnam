'use client';

import { useEffect, useEffectEvent, useRef } from 'react';

const MOBILE_VIEWPORT_MAX = 430;
const MIN_MOBILE_FONT_SIZE = 18.5;
const FONT_STEP = 0.5;
const HEIGHT_TOLERANCE = 1;

function getLineHeightPx(styles) {
  const parsed = Number.parseFloat(styles.lineHeight);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const fontSize = Number.parseFloat(styles.fontSize) || 16;
  return fontSize * 1.08;
}

export default function ResponsiveArticleTitle({ children, className }) {
  const titleRef = useRef(null);

  const fitTitle = useEffectEvent(() => {
    const titleElement = titleRef.current;

    if (!titleElement || typeof window === 'undefined') {
      return;
    }

    const viewportWidth = window.visualViewport?.width || window.innerWidth || 0;

    titleElement.style.fontSize = '';
    titleElement.style.letterSpacing = '';
    titleElement.style.lineHeight = '';

    if (viewportWidth > MOBILE_VIEWPORT_MAX) {
      return;
    }

    let styles = window.getComputedStyle(titleElement);
    let currentFontSize = Number.parseFloat(styles.fontSize) || 24;
    let lineHeight = getLineHeightPx(styles);
    let maxHeight = (lineHeight * 2) + HEIGHT_TOLERANCE;

    if (titleElement.scrollHeight <= maxHeight) {
      return;
    }

    titleElement.style.letterSpacing = '-0.03em';
    styles = window.getComputedStyle(titleElement);
    lineHeight = getLineHeightPx(styles);
    maxHeight = (lineHeight * 2) + HEIGHT_TOLERANCE;

    while (currentFontSize > MIN_MOBILE_FONT_SIZE && titleElement.scrollHeight > maxHeight) {
      currentFontSize = Math.max(MIN_MOBILE_FONT_SIZE, currentFontSize - FONT_STEP);
      titleElement.style.fontSize = `${currentFontSize}px`;
    }

    if (titleElement.scrollHeight > maxHeight) {
      titleElement.style.lineHeight = '1.04';
      maxHeight = (currentFontSize * 1.04 * 2) + HEIGHT_TOLERANCE;

      while (currentFontSize > MIN_MOBILE_FONT_SIZE && titleElement.scrollHeight > maxHeight) {
        currentFontSize = Math.max(MIN_MOBILE_FONT_SIZE, currentFontSize - FONT_STEP);
        titleElement.style.fontSize = `${currentFontSize}px`;
      }
    }
  });

  useEffect(() => {
    const handleResize = () => {
      window.requestAnimationFrame(() => fitTitle());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    if (document.fonts?.ready) {
      document.fonts.ready.then(handleResize).catch(() => {});
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [fitTitle]);

  return (
    <h1 ref={titleRef} className={className}>
      {children}
    </h1>
  );
}
