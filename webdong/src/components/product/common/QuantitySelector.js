'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function QuantitySelector({ quantity, setQuantity, statusText = '' }) {
  return (
    <div className={styles.quantitySection}>
      <span className={styles.quantityLabel}>SỐ LƯỢNG</span>
      <div className={styles.quantityControl}>
        <button 
          type="button"
          className={styles.qBtn}
          onClick={() => setQuantity(Math.max(1, quantity - 1))}
          aria-label="Giảm số lượng"
        >
          <span className="material-symbols-outlined">remove</span>
        </button>
        <input 
          className={styles.qInput} 
          type="number" 
          inputMode="numeric"
          min="1"
          aria-label="Số lượng sản phẩm"
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
        />
        <button 
          type="button"
          className={styles.qBtn}
          onClick={() => setQuantity(quantity + 1)}
          aria-label="Tăng số lượng"
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>
      {statusText ? (
        <span className={styles.inlineAvailability}>
          {statusText}
        </span>
      ) : null}
    </div>
  );
}
