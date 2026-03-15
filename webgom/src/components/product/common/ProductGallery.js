'use client';

import Image from 'next/image';
import styles from '../../../app/product/[slug]/product.module.css';

export default function ProductGallery({ images, activeIndex, setActiveIndex, getImageUrl, productName }) {
  const activeImage = images[activeIndex] || images[0];

  return (
    <div className={styles.galleryColumn}>
      <div className={styles.galleryContainer}>
        <div className={styles.mainImage}>
          {activeImage ? (
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
        {images.length > 1 && (
          <div className={styles.thumbnails}>
            {images.slice(0, 4).map((img, idx) => (
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
        )}
      </div>
    </div>
  );
}
