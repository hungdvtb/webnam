"use client";

import { useState } from 'react';
import Image from 'next/image';
import config from '@/lib/config';
import styles from '@/app/product/[slug]/product.module.css';

export default function ProductGallery({ images = [], productName }) {
  // Determine which image should be default (primary one first, or just the first one)
  const getImageUrl = (img) => {
    if (!img) return null;
    // Full URL stored directly in image_url field (most common from DB)
    if (img.image_url && img.image_url.startsWith('http')) return img.image_url;
    // Legacy url field
    if (img.url && img.url.startsWith('http')) return img.url;
    // Relative path
    if (img.path && img.path !== 'undefined') {
      const cleanPath = img.path.startsWith('/') ? img.path.substring(1) : img.path;
      return `${config.storageUrl}/${cleanPath}`;
    }
    return null;
  };

  // Filter out images that don't have a valid source
  const validImages = images.filter(img => getImageUrl(img) !== null);

  // Determine which image should be default
  const primaryIndex = validImages.findIndex(img => img.is_primary);
  const [activeIndex, setActiveIndex] = useState(primaryIndex !== -1 ? primaryIndex : 0);
  
  if (validImages.length === 0) {
    return (
      <div className={styles.galleryContainer}>
        <div className={styles.mainImage}>
          <div className={styles.imagePlaceholder}>
            <span className="material-symbols-outlined" style={{ fontSize: '64px', color: '#ccc' }}>image</span>
          </div>
        </div>
      </div>
    );
  }

  const activeImage = validImages[activeIndex] || validImages[0];

  return (
    <div className={styles.galleryContainer}>
      <div className={styles.mainImage}>
        <Image 
          src={getImageUrl(activeImage)}
          alt={productName}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          style={{ objectFit: 'cover' }}
          priority
          key={activeIndex}
          unoptimized
        />
      </div>
      {validImages.length > 1 && (
        <div className={styles.thumbnails}>
          {validImages.slice(0, 4).map((img, idx) => (
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
  );
}
