"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import styles from "@/app/page.module.css";

const FALLBACK_BANNER = "/banner-store.png";
const MIN_SWIPE_PX = 42;
const SWIPE_THRESHOLD_RATIO = 0.18;

const FALLBACK_SLIDES = [
  {
    slug: "gom-dai-thanh",
    name: "Gốm Đại Thành",
    href: "/products",
    bannerSrc: FALLBACK_BANNER,
    eyebrow: "Bộ sưu tập tuyển chọn",
    heroDescription:
      "Khám phá các danh mục gốm sứ nổi bật với bố cục tối ưu cho mobile, dễ lướt và dễ chọn mẫu.",
  },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createEmptyGesture() {
  return {
    pointerId: null,
    startX: 0,
    startY: 0,
    deltaX: 0,
    swiping: false,
  };
}

export default function HomeMobileHero({ bannerCategories = [] }) {
  const slides = bannerCategories.length ? bannerCategories : FALLBACK_SLIDES;
  const viewportRef = useRef(null);
  const gestureRef = useRef(createEmptyGesture());
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const selectIndex = (nextIndex) => {
    setActiveIndex(clamp(nextIndex, 0, slides.length - 1));
  };

  const commitSwipe = (direction) => {
    setActiveIndex((currentIndex) => clamp(currentIndex + direction, 0, slides.length - 1));
  };

  const finishSwipe = (deltaX) => {
    const viewportWidth = viewportRef.current?.clientWidth || 0;
    const swipeThreshold = Math.max(MIN_SWIPE_PX, viewportWidth * SWIPE_THRESHOLD_RATIO);

    if (Math.abs(deltaX) >= swipeThreshold) {
      commitSwipe(deltaX < 0 ? 1 : -1);
    }

    setDragOffset(0);
    setIsDragging(false);
    gestureRef.current = createEmptyGesture();
  };

  const handlePointerDown = (event) => {
    if (slides.length <= 1) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      deltaX: 0,
      swiping: false,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (gestureRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - gestureRef.current.startX;
    const deltaY = event.clientY - gestureRef.current.startY;

    gestureRef.current.deltaX = deltaX;

    if (!gestureRef.current.swiping) {
      const movedMostlyHorizontal = Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) + 6;

      if (!movedMostlyHorizontal) {
        return;
      }

      gestureRef.current.swiping = true;
      setIsDragging(true);
    }

    const atFirstSlide = activeIndex === 0 && deltaX > 0;
    const atLastSlide = activeIndex === slides.length - 1 && deltaX < 0;
    const resistedOffset = atFirstSlide || atLastSlide ? deltaX * 0.35 : deltaX;

    setDragOffset(resistedOffset);
  };

  const releasePointerCapture = (event) => {
    if (gestureRef.current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gestureRef.current.swiping) {
      finishSwipe(gestureRef.current.deltaX);
      return;
    }

    setDragOffset(0);
    setIsDragging(false);
    gestureRef.current = createEmptyGesture();
  };

  return (
    <div className={styles.mobileHeroFrame}>
      <div
        ref={viewportRef}
        className={styles.mobileHeroViewport}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointerCapture}
        onPointerCancel={releasePointerCapture}
      >
        <div
          className={styles.mobileHeroTrack}
          style={{
            transform: `translate3d(calc(${-activeIndex * 100}% + ${dragOffset}px), 0, 0)`,
            transition: isDragging ? "none" : "transform 480ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {slides.map((category, index) => (
            <article key={`${category.slug}-${index}`} className={styles.mobileHeroSlide}>
              <Image
                src={category.bannerSrc || FALLBACK_BANNER}
                alt={category.name}
                fill
                sizes="100vw"
                className={styles.mobileHeroImage}
                priority={index === 0}
              />
              <div className={styles.mobileHeroOverlay} />

              <div className={styles.mobileHeroContent}>
                <div className={styles.mobileHeroBadgeRow}>
                  <span className={styles.mobileHeroEyebrow}>{category.eyebrow}</span>
                </div>

                <h2 className={styles.mobileHeroTitle}>{category.name}</h2>
                <p className={styles.mobileHeroDescription}>{category.heroDescription}</p>

                <Link href={category.href || "/products"} className={styles.mobileHeroCta}>
                  Khám phá
                  <span className="material-symbols-outlined">arrow_forward</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>

      {slides.length > 1 ? (
        <div className={styles.mobileHeroFooter}>
          <div className={styles.mobileHeroDots}>
            {slides.map((slide, index) => (
              <button
                key={slide.slug || index}
                type="button"
                className={`${styles.mobileHeroDot} ${index === activeIndex ? styles.mobileHeroDotActive : ""}`}
                onClick={() => selectIndex(index)}
                aria-label={`Xem banner danh mục ${slide.name}`}
                aria-pressed={index === activeIndex}
              />
            ))}
          </div>

          <p className={styles.mobileHeroCounter}>
            {String(activeIndex + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
