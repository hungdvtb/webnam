'use client';

import Link from 'next/link';
import styles from '../../../app/product/[slug]/product.module.css';

export default function Breadcrumb({ product }) {
  if (!product) return null;

  return (
    <nav className={styles.breadcrumb}>
      <Link href="/">Trang chủ</Link>
      <span className="material-symbols-outlined" style={{ fontSize: '14px', opacity: 0.4 }}>chevron_right</span>
      <Link href="/products">Cửa hàng</Link>
      {product.category && (
        <>
          <span className="material-symbols-outlined" style={{ fontSize: '14px', opacity: 0.4 }}>chevron_right</span>
          <Link href={`/category/${product.category.slug}`}>{product.category.name}</Link>
        </>
      )}
      <span className="material-symbols-outlined" style={{ fontSize: '14px', opacity: 0.4 }}>chevron_right</span>
      <span className={styles.breadcrumbCurrent}>{product.name}</span>
    </nav>
  );
}
