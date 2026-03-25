"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import styles2 from '../app/products/layout2.module.css';

export default function AttributeFiltersDropdown({ filters, currentAttrs, currentSort }) {
  const [openDropdown, setOpenDropdown] = useState(null);
  const dropdownRef = useRef(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleDropdown = (code) => {
    setOpenDropdown((currentCode) => (currentCode === code ? null : code));
  };

  const buildHref = (mutateParams) => {
    const params = new URLSearchParams(searchParams.toString());
    mutateParams(params);
    const query = params.toString();
    return query ? `/products?${query}` : '/products';
  };

  return (
    <div className={styles2.configSection} ref={dropdownRef}>
      <div className={styles2.configGrid}>
        {filters.map((filter, index) => {
          if (filter.type === 'price_range' || filter.code === 'price') {
            const isPriceSortActive = currentSort === 'price_asc' || currentSort === 'price_desc';
            let sortLabel = 'Sắp xếp giá';

            if (currentSort === 'price_asc') sortLabel = 'Giá: Thấp đến cao';
            if (currentSort === 'price_desc') sortLabel = 'Giá: Cao đến thấp';

            return (
              <div key="price_sort" className={styles2.configItem}>
                <div className={styles2.configLabel}>
                  <span className={styles2.configNumber}>{(index + 1).toString().padStart(2, '0')}</span>
                  <span>SẮP XẾP GIÁ TIỀN</span>
                </div>

                <div className={styles2.filterGroup} style={{ width: '100%' }}>
                  <button
                    type="button"
                    className={`${styles2.filterDropdownBtn} ${isPriceSortActive ? styles2.filterDropdownBtnActive : ''}`}
                    style={{
                      width: '100%',
                      backgroundColor: isPriceSortActive ? '#F5EFDF' : '#FFFFFF',
                      borderColor: isPriceSortActive ? '#9C845A' : 'rgba(27, 54, 93, 0.15)',
                    }}
                    onClick={() => toggleDropdown('price_sort')}
                  >
                    <span className={styles2.dropdownBtnLabel} style={{ fontWeight: isPriceSortActive ? '700' : '500' }}>
                      {sortLabel}
                    </span>

                    <div className={styles2.dropdownBtnControls}>
                      {isPriceSortActive && (
                        <Link
                          href={buildHref((params) => params.delete('sort'))}
                          className={styles2.dropdownBtnClear}
                          title="Hủy sắp xếp"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          <span className={`material-symbols-outlined ${styles2.dropdownBtnClearIcon}`}>close</span>
                        </Link>
                      )}

                      <span
                        className={`material-symbols-outlined ${styles2.dropdownBtnArrow}`}
                        style={{
                          transition: 'transform 0.3s',
                          transform: openDropdown === 'price_sort' ? 'rotate(180deg)' : 'rotate(0)',
                        }}
                      >
                        expand_more
                      </span>
                    </div>
                  </button>

                  {openDropdown === 'price_sort' && (
                    <div className={styles2.dropdownMenu} style={{ width: '100%' }}>
                      <div className={styles2.dropdownList}>
                        <Link
                          href={buildHref((params) => params.set('sort', 'price_asc'))}
                          className={`${styles2.dropdownOption} ${currentSort === 'price_asc' ? styles2.activeOption : ''}`}
                          onClick={() => setOpenDropdown(null)}
                        >
                          Giá: Thấp đến cao
                        </Link>

                        <Link
                          href={buildHref((params) => params.set('sort', 'price_desc'))}
                          className={`${styles2.dropdownOption} ${currentSort === 'price_desc' ? styles2.activeOption : ''}`}
                          onClick={() => setOpenDropdown(null)}
                        >
                          Giá: Cao đến thấp
                        </Link>

                        <Link
                          href={buildHref((params) => params.delete('sort'))}
                          className={styles2.dropdownOption}
                          onClick={() => setOpenDropdown(null)}
                        >
                          Mặc định
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          const isActive = !!currentAttrs[filter.code];
          const selectedLabel = Array.isArray(currentAttrs[filter.code])
            ? `${currentAttrs[filter.code].length} đã chọn`
            : filter.options?.find((option) => option.value === currentAttrs[filter.code])?.label || 'Tất cả';

          return (
            <div key={filter.code} className={styles2.configItem}>
              <div className={styles2.configLabel}>
                <span className={styles2.configNumber}>{(index + 1).toString().padStart(2, '0')}</span>
                <span>CHỌN {filter.name.toUpperCase()}</span>
              </div>

              <div className={styles2.filterGroup} style={{ width: '100%' }}>
                <button
                  type="button"
                  className={`${styles2.filterDropdownBtn} ${isActive ? styles2.filterDropdownBtnActive : ''}`}
                  style={{
                    width: '100%',
                    backgroundColor: isActive ? '#F5EFDF' : '#FFFFFF',
                    borderColor: isActive ? '#9C845A' : 'rgba(27, 54, 93, 0.15)',
                  }}
                  onClick={() => toggleDropdown(filter.code)}
                >
                  <span className={styles2.dropdownBtnLabel} style={{ fontWeight: isActive ? '700' : '500' }}>
                    {isActive ? selectedLabel : `Tất cả ${filter.name}`}
                  </span>

                  <div className={styles2.dropdownBtnControls}>
                    {isActive && (
                      <Link
                        href={buildHref((params) => params.delete(`attrs[${filter.code}]`))}
                        className={styles2.dropdownBtnClear}
                        title="Hủy lọc"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <span className={`material-symbols-outlined ${styles2.dropdownBtnClearIcon}`}>close</span>
                      </Link>
                    )}

                    <span
                      className={`material-symbols-outlined ${styles2.dropdownBtnArrow}`}
                      style={{
                        transition: 'transform 0.3s',
                        transform: openDropdown === filter.code ? 'rotate(180deg)' : 'rotate(0)',
                      }}
                    >
                      expand_more
                    </span>
                  </div>
                </button>

                {openDropdown === filter.code && (
                  <div className={styles2.dropdownMenu} style={{ width: '100%' }}>
                    <div className={styles2.dropdownList}>
                      <Link
                        href={buildHref((params) => params.delete(`attrs[${filter.code}]`))}
                        className={`${styles2.dropdownOption} ${!isActive ? styles2.activeOption : ''}`}
                        onClick={() => setOpenDropdown(null)}
                      >
                        Tất cả
                      </Link>

                      {filter.options?.map((option) => {
                        const isOptionActive = currentAttrs[filter.code] === option.value;

                        return (
                          <Link
                            key={option.value}
                            href={buildHref((params) => params.set(`attrs[${filter.code}]`, option.value))}
                            className={`${styles2.dropdownOption} ${isOptionActive ? styles2.activeOption : ''}`}
                            onClick={() => setOpenDropdown(null)}
                          >
                            <span className={styles2.optLabel}>{option.label}</span>
                            <span className={styles2.optCount}>({option.count})</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div className={styles2.configItem}>
          <div className={styles2.configLabel}>
            <span className={styles2.configNumber}>{(filters.length + 1).toString().padStart(2, '0')}</span>
            <span>CHỌN NHU CẦU</span>
          </div>

          <div className={styles2.toggleContainer}>
            <button className={styles2.toggleBtn} disabled>
              Mua trọn bộ
            </button>
            <button className={`${styles2.toggleBtn} ${styles2.toggleBtnActive}`}>
              Mua lẻ sản phẩm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
