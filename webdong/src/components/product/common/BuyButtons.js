'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function BuyButtons({
  onAddToCart,
  onBuyNow,
  addToCartLabel = 'THÊM VÀO GIỎ',
  buyNowLabel = 'MUA NGAY',
  disableUppercase = false,
}) {
  const textTransformStyle = disableUppercase ? { textTransform: 'none' } : undefined;

  return (
    <div className={styles.buyGrid}>
      <button className={styles.btnPrimary} onClick={onAddToCart} style={textTransformStyle}>
        <span className="material-symbols-outlined">add_shopping_cart</span>
        {addToCartLabel}
      </button>
      <button className={styles.btnOutline} onClick={onBuyNow} style={textTransformStyle}>
        <span className="material-symbols-outlined">shopping_bag</span>
        {buyNowLabel}
      </button>
    </div>
  );
}
