'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function TrustBadges() {
  return (
    <div className={styles.specCard}>
      <h4 className={styles.specTitle}>
        <span className="material-symbols-outlined">security</span>
        Dịch vụ & Tin cậy
      </h4>
      <ul className={styles.specList}>
        <li className={styles.specItem}>
          <span className={styles.specLabel}>Giao hàng</span>
          <span className={styles.specValue}>Vận chuyển toàn quốc</span>
        </li>
        <li className={styles.specItem}>
          <span className={styles.specLabel}>Bảo hành</span>
          <span className={styles.specValue}>30 năm</span>
        </li>
        <li className={styles.specItem}>
          <span className={styles.specLabel}>Cam kết</span>
          <span className={styles.specValue}>100% Gốm Bát Tràng</span>
        </li>
      </ul>
    </div>
  );
}
