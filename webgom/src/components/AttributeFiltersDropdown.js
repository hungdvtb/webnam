"use client";

import { useState, useEffect, useRef } from 'react';
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
    setOpenDropdown(openDropdown === code ? null : code);
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
                      height: '48px', 
                      backgroundColor: isPriceSortActive ? '#F5EFDF' : '#FFFFFF', 
                      justifyContent: 'space-between', 
                      padding: '0 1rem',
                      borderColor: isPriceSortActive ? '#9C845A' : 'rgba(27, 54, 93, 0.15)'
                    }}
                    onClick={() => toggleDropdown('price_sort')}
                  >
                    <span style={{ fontSize: '13px', fontWeight: isPriceSortActive ? '700' : '500', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sortLabel}
                    </span>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isPriceSortActive && (
                        <Link
                          href={`/products?${(() => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.delete('sort');
                            return params.toString();
                          })()}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#C5A059',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            backgroundColor: 'white',
                            border: '1px solid rgba(197, 160, 89, 0.3)',
                          }}
                          title="Hủy sắp xếp"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: '14px', fontWeight: 'bold' }}>close</span>
                        </Link>
                      )}
                      <span className="material-symbols-outlined" style={{ 
                        fontSize: '20px', 
                        transition: 'transform 0.3s',
                        transform: openDropdown === 'price_sort' ? 'rotate(180deg)' : 'rotate(0)'
                      }}>
                        expand_more
                      </span>
                    </div>
                  </button>

                  {openDropdown === 'price_sort' && (
                    <div className={styles2.dropdownMenu} style={{ width: '100%' }}>
                      <div className={styles2.dropdownList}>
                        <Link
                          href={`/products?${(() => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.set('sort', 'price_asc');
                            return params.toString();
                          })()}`}
                          className={`${styles2.dropdownOption} ${currentSort === 'price_asc' ? styles2.activeOption : ''}`}
                          onClick={() => setOpenDropdown(null)}
                        >
                          Giá: Thấp đến cao
                        </Link>
                        <Link
                          href={`/products?${(() => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.set('sort', 'price_asc'); // Wait, should be price_desc
                            params.set('sort', 'price_desc');
                            return params.toString();
                          })()}`}
                          className={`${styles2.dropdownOption} ${currentSort === 'price_desc' ? styles2.activeOption : ''}`}
                          onClick={() => setOpenDropdown(null)}
                        >
                          Giá: Cao đến thấp
                        </Link>
                        <Link
                          href={`/products?${(() => {
                            const params = new URLSearchParams(searchParams.toString());
                            params.delete('sort');
                            return params.toString();
                          })()}`}
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
            : filter.options?.find(opt => opt.value === currentAttrs[filter.code])?.label || 'Tất cả';

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
                    height: '48px', 
                    backgroundColor: isActive ? '#F5EFDF' : '#FFFFFF', 
                    justifyContent: 'space-between', 
                    padding: '0 1rem',
                    borderColor: isActive ? '#9C845A' : 'rgba(27, 54, 93, 0.15)'
                  }}
                  onClick={() => toggleDropdown(filter.code)}
                >
                  <span style={{ fontSize: '13px', fontWeight: isActive ? '700' : '500', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isActive ? selectedLabel : `Tất cả ${filter.name}`}
                  </span>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isActive && (
                      <Link
                        href={`/products?${(() => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.delete(`attrs[${filter.code}]`);
                          return params.toString();
                        })()}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#C5A059',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          backgroundColor: 'white',
                          border: '1px solid rgba(197, 160, 89, 0.3)',
                        }}
                        title="Hủy lọc"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '14px', fontWeight: 'bold' }}>close</span>
                      </Link>
                    )}
                    <span className="material-symbols-outlined" style={{ 
                      fontSize: '20px', 
                      transition: 'transform 0.3s',
                      transform: openDropdown === filter.code ? 'rotate(180deg)' : 'rotate(0)'
                    }}>
                      expand_more
                    </span>
                  </div>
                </button>

                {openDropdown === filter.code && (
                  <div className={styles2.dropdownMenu} style={{ width: '100%' }}>
                    <div className={styles2.dropdownList}>
                      <Link
                        href={`/products?${(() => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.delete(`attrs[${filter.code}]`);
                          return params.toString();
                        })()}`}
                        className={`${styles2.dropdownOption} ${!isActive ? styles2.activeOption : ''}`}
                        onClick={() => setOpenDropdown(null)}
                      >
                        Tất cả
                      </Link>
                      {filter.options?.map(opt => {
                        const isOptionActive = currentAttrs[filter.code] === opt.value;
                        const params = new URLSearchParams(searchParams.toString());
                        params.set(`attrs[${filter.code}]`, opt.value);

                        return (
                          <Link
                            key={opt.value}
                            href={`/products?${params.toString()}`}
                            className={`${styles2.dropdownOption} ${isOptionActive ? styles2.activeOption : ''}`}
                            onClick={() => setOpenDropdown(null)}
                          >
                            <span className={styles2.optLabel}>{opt.label}</span>
                            <span className={styles2.optCount}>({opt.count})</span>
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

        {/* Third column in mockup: Choice of view mode */}
        <div className={styles2.configItem}>
            <div className={styles2.configLabel}>
                <span className={styles2.configNumber}>{(filters.length + 1).toString().padStart(2, '0')}</span>
                <span>CHỌN NHU CẦU</span>
            </div>
            <div className={styles2.toggleContainer}>
              <button 
                className={styles2.toggleBtn}
                disabled
              >
                Mua trọn bộ
              </button>
              <button 
                className={`${styles2.toggleBtn} ${styles2.toggleBtnActive}`}
              >
                Mua lẻ sản phẩm
              </button>
            </div>
        </div>

      </div>
    </div>
  );
}
