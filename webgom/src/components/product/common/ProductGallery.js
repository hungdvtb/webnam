'use client';

import Image from 'next/image';
import styles from '../../../app/product/[slug]/product.module.css';

export default function ProductGallery({ images, activeIndex, setActiveIndex, getImageUrl, productName, videoUrl }) {
  const activeImage = images[activeIndex] || images[0];

  const getEmbedUrl = (url) => {
    if (!url) return '';
    if (url.includes('embed/')) return url;
    
    let videoId = '';
    if (url.includes('v=')) {
      videoId = url.split('v=')[1]?.split('&')[0];
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0];
    } else if (url.includes('live/')) {
      videoId = url.split('live/')[1]?.split('?')[0];
    }
    
    return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
  };

  return (
    <div className={styles.galleryContainer}>
      <div className={styles.mainImage}>
        {activeIndex === -1 && videoUrl ? (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <iframe
              src={getEmbedUrl(videoUrl)}
              title={productName}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : activeImage ? (
          <Image 
            src={getImageUrl(activeImage)}
            alt={productName}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            style={{ objectFit: 'cover' }}
            priority
            unoptimized
          />
        ) : (
          <div className={styles.imagePlaceholder}>
            <span className="material-symbols-outlined" style={{ fontSize: '64px', color: '#ccc' }}>image</span>
          </div>
        )}
      </div>
      
      <div className={styles.thumbnails}>
        {videoUrl && (
          <button 
            className={`${styles.thumbBtn} ${activeIndex === -1 ? styles.thumbActive : ''} ${styles.videoThumbBtn}`}
            onClick={() => setActiveIndex(-1)}
            type="button"
          >
            <div className={styles.videoThumbContent}>
              <span className="material-symbols-outlined">play_circle</span>
              <span>Video</span>
            </div>
          </button>
        )}
        
        {(images.length > 1 || videoUrl) && images.map((img, idx) => (
          <button 
            key={img.id || idx} 
            className={`${styles.thumbBtn} ${idx === activeIndex ? styles.thumbActive : ''}`}
            onClick={() => setActiveIndex(idx)}
            type="button"
          >
            <Image 
              src={getImageUrl(img)}
              alt={`${productName} thumb ${idx}`}
              fill
              sizes="100px"
              style={{ objectFit: 'cover' }}
              unoptimized
            />
          </button>
        ))}
      </div>
    </div>
  );
}
