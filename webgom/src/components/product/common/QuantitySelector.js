'use client';

import styles from '../../../app/product/[slug]/product.module.css';

export default function QuantitySelector({ quantity, setQuantity }) {
  return (
    <div className={styles.quantitySection}>
      <span className={styles.quantityLabel}>SỐ LƯỢNG</span>
      <div className={styles.quantityControl}>
        <button 
          className={styles.qBtn}
          onClick={() => setQuantity(Math.max(1, quantity - 1))}
        >
          <span className="material-symbols-outlined">remove</span>
        </button>
        <input 
          className={styles.qInput} 
          type="number" 
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
        />
        <button 
          className={styles.qBtn}
          onClick={() => setQuantity(quantity + 1)}
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>
    </div>
  );
}
