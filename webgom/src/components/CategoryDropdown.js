"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import stylesStandard from '../app/products/products.module.css';
import styles2 from '../app/products/layout2.module.css';

export default function CategoryDropdown({ categories, currentCategorySlug, variant = 'layout1' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  const styles = variant === 'layout2' ? styles2 : stylesStandard;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentCategory = categories.find(cat => cat.slug === currentCategorySlug);

  return (
    <div className={styles.categoryDropdown} ref={dropdownRef}>
      <button
        className={`${styles.filterButton} ${isOpen ? styles.active : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--accent)' }}>grid_view</span>
        {currentCategory ? currentCategory.name : "Tất cả sản phẩm"}
        <span className="material-symbols-outlined" style={{
          fontSize: '18px',
          transition: 'transform 0.3s',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0)'
        }}>
          expand_more
        </span>
      </button>

      {isOpen && (
        <div className={styles.dropdownContent}>
          <Link 
            href="/products" 
            className={`${styles.dropdownItem} ${!currentCategorySlug ? styles.activeItem : ''}`}
            onClick={() => setIsOpen(false)}
            style={{ fontSize: '0.875rem' }}
          >
            Tất cả sản phẩm
          </Link>
          {(() => {
            const renderOptions = (parentId = null, level = 0) => {
              return categories
                .filter(cat => (parentId === null ? !cat.parent_id : cat.parent_id === parentId))
                .map(cat => (
                  <Link 
                    key={cat.id}
                    href={`/products?category=${cat.slug}`}
                    className={`${styles.dropdownItem} ${currentCategorySlug === cat.slug ? styles.activeItem : ''}`}
                    onClick={() => setIsOpen(false)}
                    style={{ fontSize: '0.875rem', paddingLeft: level > 0 ? `${level * 1.5 + 1}rem` : '1rem' }}
                  >
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{level > 0 ? '— ' : ''}{cat.name}</span>
                      <span className={styles.itemCount}>{cat.products_count || 0}</span>
                    </div>
                    {categories.some(c => c.parent_id === cat.id) && (
                      <div className="ml-auto opacity-20">
                         {renderOptions(cat.id, level + 1)}
                      </div>
                    )}
                  </Link>
                ));
            };
            // Note: The recursive call inside Link is NOT ideal for standard dropdowns 
            // but let's just flatten the list with indentation for better UX
            const flattened = [];
            const flatten = (parentId = null, level = 0) => {
              categories
                .filter(cat => (parentId === null ? !cat.parent_id : cat.parent_id === parentId))
                .forEach(cat => {
                  flattened.push({ ...cat, level });
                  flatten(cat.id, level + 1);
                });
            };
            flatten();
            return flattened.map(cat => (
              <Link 
                key={cat.id}
                href={`/products?category=${cat.slug}`}
                className={`${styles.dropdownItem} ${currentCategorySlug === cat.slug ? styles.activeItem : ''}`}
                onClick={() => setIsOpen(false)}
                style={{ fontSize: '0.875rem', paddingLeft: cat.level > 0 ? `${cat.level * 1 + 1}rem` : '1rem' }}
              >
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{cat.level > 0 ? '— ' : ''}{cat.name}</span>
                  <span className={styles.itemCount}>{cat.products_count || 0}</span>
                </div>
              </Link>
            ));
          })()}
       </div>
      )}
    </div>
  );
}
