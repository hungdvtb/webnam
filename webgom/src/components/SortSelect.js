"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import stylesStandard from '../app/products/products.module.css';
import styles2 from '../app/products/layout2.module.css';

export default function SortSelect({ currentSort, variant = 'layout1' }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const styles = variant === 'layout2' ? styles2 : stylesStandard;

  const handleSortChange = (e) => {
    const newSort = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', newSort);
    params.delete('page'); // Reset to page 1 on sort change
    
    router.push(`/products?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={variant === 'layout2' ? styles.sortContainer : styles.sortSelect}>
      {variant !== 'layout2' && <span style={{ fontSize: '14px', opacity: 0.6 }}>Sắp xếp:</span>}
      <select 
        defaultValue={currentSort || 'popular'} 
        onChange={handleSortChange}
        className={variant === 'layout2' ? styles.sortSelect : styles.selectInput}
      >
        <option value="popular">Phổ biến nhất</option>
        <option value="newest">Mới nhất</option>
        <option value="price_asc">Giá: Thấp đến Cao</option>
        <option value="price_desc">Giá: Cao đến Thấp</option>
      </select>
    </div>
  );
}
