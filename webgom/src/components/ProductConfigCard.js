"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import styles2 from '../app/products/layout2.module.css';

export default function ProductConfigCard({ availableFilters, currentAttrs }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleAttrChange = (code, value) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(`attrs[${code}]`, value);
    } else {
      params.delete(`attrs[${code}]`);
    }
    params.delete('page'); // Reset to page 1
    router.push(`/products?${params.toString()}`, { scroll: false });
  };

  const setMode = (mode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', mode);
    router.push(`/products?${params.toString()}`, { scroll: false });
  };

  const currentMode = searchParams.get('mode') || 'full';

  return (
    <div className={styles2.configSection}>
      <div className={styles2.configGrid}>
        {/* Step 01: Pick First Attribute if available */}
        <div className={styles2.configItem}>
          <div className={styles2.configLabel}>
            <span className={styles2.configNumber}>01</span>
            {availableFilters?.[0]?.name || "CHỌN KÍCH THƯỚC"}
          </div>
          <select 
            className={styles2.configSelect}
            value={currentAttrs[availableFilters?.[0]?.code] || ''}
            onChange={(e) => handleAttrChange(availableFilters[0].code, e.target.value)}
          >
            <option value="">Tất cả</option>
            {availableFilters?.[0]?.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Step 02: Pick Second Attribute if available */}
        <div className={styles2.configItem}>
          <div className={styles2.configLabel}>
            <span className={styles2.configNumber}>02</span>
            {availableFilters?.[1]?.name || "CHỌN DÒNG MEN"}
          </div>
          <select 
            className={styles2.configSelect}
            value={currentAttrs[availableFilters?.[1]?.code] || ''}
            onChange={(e) => handleAttrChange(availableFilters[1].code, e.target.value)}
          >
            <option value="">Tất cả</option>
            {availableFilters?.[1]?.options?.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Step 03: Special Needs Toggle */}
        <div className={styles2.configItem}>
          <div className={styles2.configLabel}>
            <span className={styles2.configNumber}>03</span>
            CHỌN NHU CẦU
          </div>
          <div className={styles2.toggleContainer}>
            <button 
              type="button"
              onClick={() => setMode('full')}
              className={`${styles2.toggleBtn} ${currentMode === 'full' ? styles2.toggleBtnActive : ''}`}
            >
              Mua trọn bộ
            </button>
            <button 
              type="button"
              onClick={() => setMode('retail')}
              className={`${styles2.toggleBtn} ${currentMode === 'retail' ? styles2.toggleBtnActive : ''}`}
            >
              Mua lẻ sản phẩm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
