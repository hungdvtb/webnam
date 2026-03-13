"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from '../app/products/products.module.css';

export default function CategoryDropdown({ categories, currentCategorySlug }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

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
        {currentCategory ? currentCategory.name : "Danh mục sản phẩm"}
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
          >
            Tất cả sản phẩm
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/products?category=${cat.slug}`}
              className={`${styles.dropdownItem} ${currentCategorySlug === cat.slug ? styles.activeItem : ''}`}
              onClick={() => setIsOpen(false)}
            >
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{cat.name}</span>
                <span className={styles.itemCount}>{cat.products_count || 0}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
