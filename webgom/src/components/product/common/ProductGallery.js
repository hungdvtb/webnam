'use client';

import Image from 'next/image';
import styles from '../../../app/product/[slug]/product.module.css';

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
  const hasSingleVisual = images.length === 1 && !videoUrl;
  const showThumbnailStrip = images.length > 0 && (showSingleThumbnail || images.length > 1 || Boolean(videoUrl));

  const getEmbedUrl = (url) => {
    if (!url) return '';

    const appendPlayerParams = (rawUrl) => {
      try {
        const parsedUrl = new URL(rawUrl);
        parsedUrl.searchParams.set('playsinline', '1');
        parsedUrl.searchParams.set('controls', '1');
        parsedUrl.searchParams.set('fs', '1');
        parsedUrl.searchParams.set('rel', '0');
        parsedUrl.searchParams.set('modestbranding', '1');
        parsedUrl.searchParams.set('enablejsapi', '1');

        if (typeof window !== 'undefined') {
          parsedUrl.searchParams.set('origin', window.location.origin);
        }

        return parsedUrl.toString();
      } catch {
        return rawUrl;
      }
    };

    if (url.includes('embed/')) {
      return appendPlayerParams(url);
    }

    let videoId = '';
    if (url.includes('v=')) {
      videoId = url.split('v=')[1]?.split('&')[0];
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0];
    } else if (url.includes('live/')) {
      videoId = url.split('live/')[1]?.split('?')[0];
    }

    return videoId
      ? appendPlayerParams(`https://www.youtube.com/embed/${videoId}`)
      : appendPlayerParams(url);
  };

  return (
    <div className={styles.galleryContainer}>
      <div className={`${styles.mainImage} ${activeIndex === -1 && videoUrl ? styles.mainImageVideo : ''}`}>
        {activeIndex === -1 && videoUrl ? (
          <div className={styles.videoEmbedShell}>
            <iframe
              src={getEmbedUrl(videoUrl)}
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
          {videoUrl && (
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
