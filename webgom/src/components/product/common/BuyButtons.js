'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function BuyButtons({ onAddToCart, onBuyNow }) {
  return (
    <div className={styles.buyGrid}>
      <button className={styles.btnPrimary} onClick={onAddToCart}>
        <span className="material-symbols-outlined">add_shopping_cart</span>
        THÊM VÀO GIỎ
      </button>
      <button className={styles.btnOutline} onClick={onBuyNow}>
        <span className="material-symbols-outlined">shopping_bag</span>
        MUA NGAY
      </button>
    </div>
  );
}
