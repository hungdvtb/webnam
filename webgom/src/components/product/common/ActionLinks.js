'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function ActionLinks() {
  return (
    <div className={styles.actionLinks}>
      <div className={styles.actionBtn}>
        <div className={styles.actionIconBox}>
          <span className="material-symbols-outlined">verified</span>
        </div>
        <div>
          <div className={styles.actionLabel}>Chứng nhận quốc gia</div>
          <div className={styles.actionText}>Sản phẩm có Chứng nhận Nghệ nhân quốc gia</div>
        </div>
        <span className={`material-symbols-outlined ${styles.actionChevron}`}>arrow_forward_ios</span>
      </div>
      <div className={styles.actionBtn}>
        <div className={styles.actionIconBox}>
          <span className="material-symbols-outlined">library_books</span>
        </div>
        <div>
          <div className={styles.actionLabel}>Kiến thức gốm sứ</div>
          <div className={styles.actionText}>Cách phân biệt các loại men</div>
        </div>
        <span className={`material-symbols-outlined ${styles.actionChevron}`}>arrow_forward_ios</span>
      </div>
    </div>
  );
}
