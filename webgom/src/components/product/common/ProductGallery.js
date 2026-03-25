'use client';

import Image from 'next/image';
import styles from '../../../app/product/[slug]/product.module.css';
import { resolveVideoEmbedUrl, resolveVideoThumbnailUrl } from '@/lib/media';

export default function ProductGallery({
  images,
  activeIndex,
  setActiveIndex,
  getImageUrl,
  productName,
  videoUrl,
  showSingleThumbnail = false,
}) {
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
      ? `Ảnh ${Math.min(activeIndex + 1, images.length)} / ${images.length}`
      : 'Media sản phẩm';

  return (
    <div className={styles.productMediaGallery}>
      <div className={`${styles.productMediaStage} ${isShowingVideo ? styles.productMediaStageVideo : ''}`}>
        <div className={styles.productMediaBadge}>{mediaSummary}</div>

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
            <p>Đang cập nhật media sản phẩm</p>
          </div>
        )}
      </div>

      {showThumbnailStrip ? (
        <div className={styles.productMediaRail} role="tablist" aria-label="Thư viện media sản phẩm">
          {hasVideo ? (
            <button
              type="button"
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
                className={`${styles.productMediaThumb} ${isActive ? styles.productMediaThumbActive : ''}`}
                onClick={() => setActiveIndex(index)}
                aria-pressed={isActive}
                aria-label={`Xem ảnh ${index + 1}`}
              >
                <div className={styles.productMediaThumbPoster}>
                  <Image
                    src={getImageUrl(image)}
                    alt={`${productName} ảnh ${index + 1}`}
                    fill
                    sizes="88px"
                    className={styles.productMediaThumbImage}
                    unoptimized
                  />
                </div>
                <span className={styles.productMediaThumbLabel}>Ảnh {index + 1}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
