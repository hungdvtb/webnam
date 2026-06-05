"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { resolveVideoEmbedUrl } from "@/lib/media";
import styles from "./wholesale.module.css";

export default function WholesaleGalleryButton({
  productName = "Sản phẩm",
  images = [],
  videoHref = "",
}) {
  const [activeDialog, setActiveDialog] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const validImages = images.filter((image) => image?.src);
  const videoEmbedUrl = resolveVideoEmbedUrl(videoHref);
  const activeImage = validImages[activeIndex] || validImages[0] || null;
  const isImageOpen = activeDialog === "images";
  const isVideoOpen = activeDialog === "video";
  const hasImages = validImages.length > 0;
  const hasVideo = Boolean(videoEmbedUrl);

  useEffect(() => {
    if (!activeDialog) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setActiveDialog("");
    };
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDialog]);

  if (!hasImages && !hasVideo) {
    return <span className={styles.mediaEmpty}>-</span>;
  }

  return (
    <>
      <div className={styles.mediaActions}>
        {hasImages ? (
          <button
            type="button"
            className={styles.mediaActionButton}
            onClick={() => {
              setActiveIndex(0);
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
            onClick={() => setActiveDialog("video")}
            title="Xem video"
            aria-label={`Xem video ${productName}`}
          >
            <span className="material-symbols-outlined" aria-hidden="true">play_circle</span>
            <span>Xem video</span>
          </button>
        ) : null}
      </div>

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
            </div>

            {validImages.length > 1 ? (
              <div className={styles.galleryThumbs}>
                {validImages.map((image, index) => (
                  <button
                    key={`${image.src}-${index}`}
                    type="button"
                    className={`${styles.galleryThumb} ${index === activeIndex ? styles.galleryThumbActive : ""}`}
                    onClick={() => setActiveIndex(index)}
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
              <iframe
                src={videoEmbedUrl}
                title={`Video ${productName}`}
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
                allowFullScreen
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
