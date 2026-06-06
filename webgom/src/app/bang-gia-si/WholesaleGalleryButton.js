"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { resolveVideoEmbedUrl, resolveVideoThumbnailUrl } from "@/lib/media";
import styles from "./wholesale.module.css";

const normalizeVideoItem = (item, index = 0) => {
  const href = typeof item === "string"
    ? item
    : (item?.href || item?.url || item?.video_url || item?.videoUrl || item?.src || "");
  const embedUrl = resolveVideoEmbedUrl(href);

  if (!embedUrl) {
    return null;
  }

  return {
    href,
    embedUrl,
    title: item?.title || `Video ${index + 1}`,
    thumbnailSrc: item?.thumbnailSrc || item?.thumbnail_url || item?.thumbnailUrl || resolveVideoThumbnailUrl(href),
  };
};

export default function WholesaleGalleryButton({
  productName = "Sản phẩm",
  images = [],
  videoItems = [],
  videoHref = "",
  trigger = "buttons",
  triggerClassName = "",
  triggerAriaLabel = "",
  children = null,
}) {
  const [activeDialog, setActiveDialog] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const validImages = images.filter((image) => image?.src);
  const validVideos = [...videoItems, ...(videoHref ? [{ href: videoHref }] : [])]
    .map(normalizeVideoItem)
    .filter(Boolean)
    .filter((item, index, source) => (
      source.findIndex((candidate) => candidate.embedUrl === item.embedUrl) === index
    ));
  const activeImage = validImages[activeImageIndex] || validImages[0] || null;
  const activeVideo = validVideos[activeVideoIndex] || validVideos[0] || null;
  const isImageOpen = activeDialog === "images";
  const isVideoOpen = activeDialog === "video";
  const hasImages = validImages.length > 0;
  const hasVideo = validVideos.length > 0;
  const imageCount = validImages.length;
  const videoCount = validVideos.length;

  const showPreviousImage = useCallback(() => {
    setActiveImageIndex((current) => (current <= 0 ? imageCount - 1 : current - 1));
  }, [imageCount]);

  const showNextImage = useCallback(() => {
    setActiveImageIndex((current) => (current >= imageCount - 1 ? 0 : current + 1));
  }, [imageCount]);

  const openDefaultMedia = () => {
    if (hasImages) {
      setActiveImageIndex(0);
      setActiveDialog("images");
      return;
    }

    if (hasVideo) {
      setActiveVideoIndex(0);
      setActiveDialog("video");
    }
  };

  useEffect(() => {
    if (!activeDialog) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setActiveDialog("");
      if (activeDialog === "images" && imageCount > 1 && event.key === "ArrowLeft") showPreviousImage();
      if (activeDialog === "images" && imageCount > 1 && event.key === "ArrowRight") showNextImage();
    };
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDialog, imageCount, showNextImage, showPreviousImage]);

  if (!hasImages && !hasVideo && trigger !== "custom") {
    return <span className={styles.mediaEmpty}>-</span>;
  }

  return (
    <>
      {trigger === "custom" ? (
        hasImages || hasVideo ? (
          <button
            type="button"
            className={triggerClassName}
            onClick={openDefaultMedia}
            aria-label={triggerAriaLabel || `Xem hinh anh va video ${productName}`}
          >
            {children}
          </button>
        ) : (
          <span className={triggerClassName}>{children}</span>
        )
      ) : null}

      {trigger !== "custom" ? (
      <div className={styles.mediaActions}>
        {hasImages ? (
          <button
            type="button"
            className={styles.mediaActionButton}
            onClick={() => {
              setActiveImageIndex(0);
              setActiveDialog("images");
            }}
            title="Xem ảnh"
            aria-label={`Xem ảnh ${productName}`}
          >
            <span className="material-symbols-outlined" aria-hidden="true">photo_library</span>
            <span>Xem ảnh</span>
          </button>
        ) : null}

        {hasVideo ? (
          <button
            type="button"
            className={styles.mediaActionButton}
            onClick={() => {
              setActiveVideoIndex(0);
              setActiveDialog("video");
            }}
            title="Xem video"
            aria-label={`Xem video ${productName}`}
          >
            <span className="material-symbols-outlined" aria-hidden="true">play_circle</span>
            <span>Xem video</span>
          </button>
        ) : null}
      </div>
      ) : null}

      {isImageOpen ? (
        <div className={styles.galleryOverlay} role="dialog" aria-modal="true" aria-label={`Hình ảnh ${productName}`}>
          <button type="button" className={styles.galleryBackdrop} aria-label="Đóng hình ảnh" onClick={() => setActiveDialog("")} />
          <section className={styles.galleryDialog}>
            <header className={styles.galleryHeader}>
              <div>
                <p>Hình ảnh sản phẩm</p>
                <h2>{productName}</h2>
              </div>
              <button type="button" className={styles.galleryClose} aria-label="Đóng hình ảnh" onClick={() => setActiveDialog("")}>
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </header>

            <div className={styles.galleryStage}>
              {activeImage ? (
                <Image
                  src={activeImage.src}
                  alt={activeImage.alt || productName}
                  width={960}
                  height={720}
                  sizes="(max-width: 760px) 92vw, 760px"
                  unoptimized
                  className={styles.galleryMainImage}
                />
              ) : null}

              {imageCount > 1 ? (
                <>
                  <button
                    type="button"
                    className={`${styles.galleryNavButton} ${styles.galleryNavButtonPrevious}`}
                    onClick={showPreviousImage}
                    aria-label="Xem ảnh trước"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.galleryNavButton} ${styles.galleryNavButtonNext}`}
                    onClick={showNextImage}
                    aria-label="Xem ảnh sau"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                  </button>
                  <span className={styles.galleryCounter}>{activeImageIndex + 1} / {imageCount}</span>
                </>
              ) : null}
            </div>

            {validImages.length > 1 || hasVideo ? (
              <div className={styles.galleryThumbs}>
                {validImages.map((image, index) => (
                  <button
                    key={`${image.src}-${index}`}
                    type="button"
                    className={`${styles.galleryThumb} ${index === activeImageIndex ? styles.galleryThumbActive : ""}`}
                    onClick={() => setActiveImageIndex(index)}
                    aria-label={`Xem ảnh ${index + 1}`}
                  >
                    <Image
                      src={image.src}
                      alt={image.alt || productName}
                      width={84}
                      height={84}
                      sizes="84px"
                      unoptimized
                    />
                  </button>
                ))}
                {validVideos.map((video, index) => (
                  <button
                    key={`${video.embedUrl}-from-image-${index}`}
                    type="button"
                    className={`${styles.galleryThumb} ${styles.videoThumb}`}
                    onClick={() => {
                      setActiveVideoIndex(index);
                      setActiveDialog("video");
                    }}
                    aria-label={`Xem video ${index + 1}`}
                  >
                    {video.thumbnailSrc ? (
                      <Image
                        src={video.thumbnailSrc}
                        alt={video.title || `${productName} video ${index + 1}`}
                        width={84}
                        height={84}
                        sizes="84px"
                        unoptimized
                      />
                    ) : (
                      <span className={`material-symbols-outlined ${styles.videoThumbIcon}`} aria-hidden="true">play_circle</span>
                    )}
                    <span className={styles.videoThumbLabel}>Video {index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {isVideoOpen ? (
        <div className={styles.galleryOverlay} role="dialog" aria-modal="true" aria-label={`Video ${productName}`}>
          <button type="button" className={styles.galleryBackdrop} aria-label="Đóng video" onClick={() => setActiveDialog("")} />
          <section className={`${styles.galleryDialog} ${styles.videoDialog}`}>
            <header className={styles.galleryHeader}>
              <div>
                <p>Video sản phẩm</p>
                <h2>{productName}</h2>
              </div>
              <button type="button" className={styles.galleryClose} aria-label="Đóng video" onClick={() => setActiveDialog("")}>
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </header>

            <div className={styles.videoStage}>
              {activeVideo ? (
                <iframe
                  src={activeVideo.embedUrl}
                  title={activeVideo.title || `Video ${productName}`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
                  allowFullScreen
                />
              ) : null}
            </div>

            {videoCount > 1 ? (
              <div className={styles.galleryThumbs}>
                {validVideos.map((video, index) => (
                  <button
                    key={`${video.embedUrl}-${index}`}
                    type="button"
                    className={`${styles.galleryThumb} ${styles.videoThumb} ${index === activeVideoIndex ? styles.galleryThumbActive : ""}`}
                    onClick={() => setActiveVideoIndex(index)}
                    aria-label={`Xem video ${index + 1}`}
                  >
                    {video.thumbnailSrc ? (
                      <Image
                        src={video.thumbnailSrc}
                        alt={video.title || `${productName} video ${index + 1}`}
                        width={84}
                        height={84}
                        sizes="84px"
                        unoptimized
                      />
                    ) : (
                      <span className={`material-symbols-outlined ${styles.videoThumbIcon}`} aria-hidden="true">play_circle</span>
                    )}
                    <span className={styles.videoThumbLabel}>Video {index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
