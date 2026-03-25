'use client';

import { useEffect } from 'react';
import {
  buildGalleryStageMarkup,
  decodeGalleryPayload,
  normalizeGalleryItems,
} from '@/lib/blogMediaGallery';

function hydrateGallery(galleryElement) {
  if (!galleryElement) {
    return;
  }

  const items = normalizeGalleryItems(decodeGalleryPayload(galleryElement.getAttribute('data-gallery-payload')));

  if (!items.length) {
    return;
  }

  const stage = galleryElement.querySelector('[data-gallery-stage]');
  const thumbs = Array.from(galleryElement.querySelectorAll('[data-gallery-index]'));

  const setActiveIndex = (index) => {
    const nextIndex = Number.isInteger(index) && items[index] ? index : 0;
    const nextItem = items[nextIndex] || items[0];

    if (stage) {
      stage.innerHTML = buildGalleryStageMarkup(nextItem);
    }

    galleryElement.setAttribute('data-gallery-active-index', String(nextIndex));

    thumbs.forEach((thumb, thumbIndex) => {
      const isActive = thumbIndex === nextIndex;
      thumb.classList.toggle('is-active', isActive);
      thumb.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  thumbs.forEach((thumb) => {
    thumb.onclick = () => {
      setActiveIndex(Number(thumb.getAttribute('data-gallery-index') || 0));
    };
  });

  setActiveIndex(Number(galleryElement.getAttribute('data-gallery-active-index') || 0));
}

export default function BlogMediaGalleryEnhancer({ contentKey }) {
  useEffect(() => {
    const galleries = Array.from(document.querySelectorAll('.bdt-content .bdt-media-gallery'));
    galleries.forEach(hydrateGallery);
  }, [contentKey]);

  return null;
}
