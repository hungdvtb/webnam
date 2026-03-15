'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function TrustBadges() {
  return (
    <div className={styles.trustBadges}>
      <div className={styles.trustItem}>
        <span className="material-symbols-outlined">local_shipping</span>
        VẬN CHUYỂN TOÀN QUỐC
      </div>
      <div className={styles.trustItem}>
        <span className="material-symbols-outlined">security</span>
        BẢO HÀNH 10 NĂM
      </div>
      <div className={styles.trustItem}>
        <span className="material-symbols-outlined">history_edu</span>
        CAM KẾT CHÍNH HÃNG
      </div>
    </div>
  );
}
