'use client';

import Image from 'next/image';
import styles from '../../../app/product/[slug]/product.module.css';
import { resolveVideoEmbedUrl } from '@/lib/media';

export default function ProductGallery({
  images,
  activeIndex,
  setActiveIndex,
  getImageUrl,
  productName,
  videoUrl,
  showSingleThumbnail = false
}) {
  const activeImage = images[activeIndex] || images[0];
  const embedUrl = resolveVideoEmbedUrl(videoUrl);
  const hasVideo = Boolean(embedUrl);
  const hasSingleVisual = images.length === 1 && !hasVideo;
  const showThumbnailStrip = images.length > 0 && (showSingleThumbnail || images.length > 1 || hasVideo);

  return (
    <div className={styles.galleryContainer}>
      <div className={`${styles.mainImage} ${activeIndex === -1 && hasVideo ? styles.mainImageVideo : ''}`}>
        {activeIndex === -1 && hasVideo ? (
          <div className={styles.videoEmbedShell}>
            <iframe
              src={embedUrl}
              title={productName}
              className={styles.videoEmbedFrame}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : activeImage ? (
          <Image
            src={getImageUrl(activeImage)}
            alt={productName}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className={styles.galleryImage}
            priority
            unoptimized
          />
        ) : (
          <div className={styles.imagePlaceholder}>
            <span className="material-symbols-outlined" style={{ fontSize: '64px', color: '#ccc' }}>image</span>
          </div>
        )}
      </div>

      {showThumbnailStrip ? (
        <div
          className={styles.thumbnails}
          data-single-thumbnail={showSingleThumbnail && hasSingleVisual ? 'true' : undefined}
        >
          {hasVideo && (
            <button
              className={`${styles.thumbBtn} ${activeIndex === -1 ? styles.thumbActive : ''} ${styles.videoThumbBtn}`}
              onClick={() => setActiveIndex(-1)}
              type="button"
              aria-label="Xem video sản phẩm"
            >
              <div className={styles.videoThumbContent}>
                <span className="material-symbols-outlined">play_circle</span>
                <span>Video</span>
              </div>
            </button>
          )}

          {images.map((img, idx) => (
            <button
              key={img.id || idx}
              className={`${styles.thumbBtn} ${idx === activeIndex ? styles.thumbActive : ''}`}
              onClick={() => setActiveIndex(idx)}
              type="button"
              aria-label={`Xem ảnh ${idx + 1}`}
            >
              <Image
                src={getImageUrl(img)}
                alt={`${productName} thumb ${idx}`}
                fill
                sizes="100px"
                className={styles.thumbImage}
                unoptimized
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
