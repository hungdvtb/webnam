'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function SpecificationList({ product, currentProduct }) {
  return (
    <div className={styles.specCard}>
      <h4 className={styles.specTitle}>
        <span className="material-symbols-outlined">info</span>
        Thông số chi tiết
      </h4>
      <ul className={styles.specList}>
        {/* Only show entries from the structured "specifications" JSON column */}
        {(() => {
          const specData = currentProduct?.specifications || product?.specifications;
          if (!specData) return null;
          
          let parsed = [];
          try {
            parsed = JSON.parse(specData);
          } catch (e) {
            // Fallback for old multiline text if not yet converted
            parsed = specData.split('\n').filter(l => l.trim()).map(l => {
              const parts = l.split(':');
              return { 
                label: parts[0]?.trim() || 'Thông số', 
                value: parts.slice(1).join(':').trim() || l 
              };
            });
          }

          if (!Array.isArray(parsed)) return null;

          return parsed.map((spec, idx) => (
            <li key={`spec-json-${idx}`} className={styles.specItem}>
              <span className={styles.specLabel}>{spec.label || spec.key || 'Thông số'}</span>
              <span className={styles.specValue}>{spec.value}</span>
            </li>
          ));
        })()}
      </ul>
    </div>
  );
}
