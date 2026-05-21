import Link from 'next/link';
import styles from '../../../app/product/[slug]/product.module.css';

const DISPLAY_TEXT_LIMIT = 72;

function truncateDisplayText(value, maxLength = DISPLAY_TEXT_LIMIT) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, maxLength).trim();
  const lastSpaceIndex = sliced.lastIndexOf(' ');
  const safeSlice = lastSpaceIndex > 24 ? sliced.slice(0, lastSpaceIndex) : sliced;

  return `${safeSlice.replace(/[.,;:!?-]+$/, '')}...`;
}

function normalizeAdditionalInfo(additionalInfo = []) {
  if (!Array.isArray(additionalInfo)) {
    return [];
  }

  return additionalInfo
    .map((item) => {
      const source = typeof item === 'object' && item !== null ? item : {};
      const postId = String(source.post_id || '').trim();
      const postSlug = String(source.post_slug || '').trim();
      const postTitle = String(source.post_title || '').trim();
      const displayText = String(source.display_text || '').trim() || truncateDisplayText(postTitle);

      return {
        title: String(source.title || '').trim(),
        display_text: displayText,
        post_id: postId,
        post_slug: postSlug,
        post_title: postTitle,
      };
    })
    .filter((item) => (item.post_slug || item.post_id) && item.display_text);
}

export default function ActionLinks({ additionalInfo = [] }) {
  const items = normalizeAdditionalInfo(additionalInfo);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={styles.specCard}>
      <h4 className={styles.specTitle}>
        <span className="material-symbols-outlined">library_books</span>
        Kiến thức gốm sứ & Hướng dẫn lựa chọn
      </h4>
      <ul className={styles.specList}>
        {items.map((info, idx) => (
          <li key={`${info.post_slug || info.post_id || idx}-${idx}`} className={styles.specItem}>
            <Link
              href={`/blog/${info.post_slug || info.post_id}`}
              className={styles.specLink}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none' }}
            >
              <span className={styles.specLabel}>{info.title || 'Bài viết gợi ý'}</span>
              <span
                className={styles.specValue}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--gold)' }}
                title={info.post_title || info.display_text}
              >
                {info.display_text}
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#CCC' }}>arrow_forward_ios</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
