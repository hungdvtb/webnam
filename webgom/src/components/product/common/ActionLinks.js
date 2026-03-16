import Link from 'next/link';
import styles from '../../../app/product/[slug]/product.module.css';

export default function ActionLinks({ additionalInfo = [] }) {
  if (!additionalInfo || additionalInfo.length === 0) {
    return (
      <div className={styles.specCard}>
        <h4 className={styles.specTitle}>
          <span className="material-symbols-outlined">verified_user</span>
          Kiến thức gốm sứ & Hướng dẫn lựa chọn
        </h4>
        <ul className={styles.specList}>
          <li className={styles.specItem}>
            <span className={styles.specLabel}>Chứng nhận nghệ nhân</span>
            <span className={styles.specValue}>Nghệ nhân quốc gia</span>
          </li>
          <li className={styles.specItem}>
            <span className={styles.specLabel}>Kiến thức gốm sứ</span>
            <span className={styles.specValue}>Đang cập nhật...</span>
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.specCard}>
      <h4 className={styles.specTitle}>
        <span className="material-symbols-outlined">library_books</span>
        Kiến thức gốm sứ & Hướng dẫn lựa chọn
      </h4>
      <ul className={styles.specList}>
        {additionalInfo.map((info, idx) => (
          <li key={idx} className={styles.specItem}>
            <Link 
              href={`/blog/${info.post_id}`} 
              className={styles.specLink}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none' }}
            >
              <span className={styles.specLabel}>{info.title}</span>
              <span className={styles.specValue} style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--gold)' }}>
                {info.post_title}
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#CCC' }}>arrow_forward_ios</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
