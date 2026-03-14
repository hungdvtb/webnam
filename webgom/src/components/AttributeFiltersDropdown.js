"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import styles2 from '../app/products/layout2.module.css';

export default function AttributeFiltersDropdown({ filters, currentAttrs }) {
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
    <div className={styles2.attributeFilters} ref={dropdownRef} style={{ marginBottom: '2.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
      {filters.map(filter => {
        if (filter.type === 'price_range') {
          return (
            <div key={filter.code} className={styles2.filterGroup}>
              <div className={styles2.filterDropdownBtn} style={{ cursor: 'default', borderStyle: 'dashed' }}>
                <span>{filter.name}: <strong>{new Intl.NumberFormat('vi-VN').format(filter.min)} - {new Intl.NumberFormat('vi-VN').format(filter.max)}</strong></span>
              </div>
            </div>
          );
        }

        const isActive = !!currentAttrs[filter.code];
        const selectedLabel = Array.isArray(currentAttrs[filter.code]) 
          ? `${currentAttrs[filter.code].length} đã chọn`
          : filter.options?.find(opt => opt.value === currentAttrs[filter.code])?.label || filter.name;

        return (
          <div key={filter.code} className={styles2.filterGroup}>
            <button
              type="button"
              className={`${styles2.filterDropdownBtn} ${isActive ? styles2.active : ''}`}
              onClick={() => toggleDropdown(filter.code)}
            >
              <span>{filter.name}: <strong style={{ color: isActive ? '#1B365D' : 'inherit' }}>{isActive ? selectedLabel : 'Tất cả'}</strong></span>
              <span className="material-symbols-outlined" style={{ 
                fontSize: '18px', 
                transition: 'transform 0.3s',
                transform: openDropdown === filter.code ? 'rotate(180deg)' : 'rotate(0)'
              }}>
                expand_more
              </span>
            </button>

            {openDropdown === filter.code && (
              <div className={styles2.dropdownMenu}>
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
        );
      })}
    </div>
  );
}
