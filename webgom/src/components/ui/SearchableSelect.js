'use client';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

export default function SearchableSelect({ name, placeholder, value, options, onChange, disabled, required, className }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true); // capture scrolls anywhere
    } else {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    }
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    function handleClickOutside(event) {
      // Check if click is outside both the trigger wrapper and the portal dropdown
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
          setIsOpen(false);
          setSearch('');
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sort options alphabetically A-Z ignoring common prefixes
  const sortedOptions = useMemo(() => {
    if (!options) return [];
    
    const getSortName = (name) => {
      if (!name) return '';
      return name.replace(/^(Tỉnh|Thành phố|Quận|Huyện|Thị xã|Phường|Xã|Thị trấn)\s+/i, '').trim();
    };

    return [...options].sort((a, b) => {
      const nameA = getSortName(a.label);
      const nameB = getSortName(b.label);
      return nameA.localeCompare(nameB, 'vi');
    });
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return sortedOptions;
    const normalizedSearch = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return sortedOptions.filter(opt => {
      const normalizedLabel = opt.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return normalizedLabel.includes(normalizedSearch);
    });
  }, [sortedOptions, search]);

  const selectedLabel = useMemo(() => {
    const selected = options?.find(opt => opt.value === value);
    return selected ? selected.label : '';
  }, [value, options]);

  const handleSelect = (val) => {
    setIsOpen(false);
    setSearch('');
    // Mock event object for existing onChange handlers
    if (onChange) {
      onChange({ target: { name, value: val } });
    }
  };

  const portalContent = (
    <div 
      ref={dropdownRef}
      style={{
        position: 'absolute', 
        top: `${dropdownPos.top}px`, 
        left: `${dropdownPos.left}px`, 
        width: `${dropdownPos.width}px`, 
        zIndex: 999999,
        backgroundColor: '#fff', 
        border: '1px solid #e5e7eb', 
        borderRadius: '4px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        overscrollBehavior: 'contain'
      }}
    >
      <div style={{ padding: '8px', borderBottom: '1px solid #f3f4f6', backgroundColor: '#fff', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: '4px', padding: '8px 10px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#9ca3af', marginRight: '6px' }}>search</span>
          <input 
            type="text" 
            autoFocus
            placeholder="Tìm kiếm nhanh..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', backgroundColor: 'transparent', border: 'none', outline: 'none', fontSize: '14px', fontFamily: 'inherit' }}
          />
        </div>
      </div>
      <ul style={{ 
        maxHeight: '60vh', // Khoảng 60% màn hình
        overflowY: 'auto', 
        margin: 0, 
        padding: '4px 0', 
        listStyle: 'none' 
      }}>
        {filteredOptions.length > 0 ? (
          filteredOptions.map((opt) => (
            <li
              key={opt.value}
              onClick={() => handleSelect(opt.value)}
              style={{
                padding: '12px 14px', fontSize: '14px', cursor: 'pointer',
                backgroundColor: opt.value === value ? '#fdf8f0' : 'transparent',
                color: opt.value === value ? '#b68f54' : '#374151',
                fontWeight: opt.value === value ? '600' : 'normal',
                transition: 'background-color 0.15s'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = opt.value === value ? '#fdf8f0' : '#f9fafb'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = opt.value === value ? '#fdf8f0' : 'transparent'}
            >
              {opt.label}
            </li>
          ))
        ) : (
          <li style={{ padding: '16px', fontSize: '14px', color: '#6b7280', textAlign: 'center' }}>
            Không tìm thấy kết quả
          </li>
        )}
      </ul>
    </div>
  );

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      {required && (
        <input 
          type="text" 
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', zIndex: -1 }} 
          required 
          value={value || ''} 
          readOnly 
        />
      )}
      
      <div 
        onClick={(e) => {
          if (!disabled) {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        className={className}
        style={{
          display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          paddingRight: '8px'
        }}
      >
        <span style={{ color: selectedLabel ? 'inherit' : '#9ca3af', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {selectedLabel || placeholder}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#9ca3af', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>
          expand_more
        </span>
      </div>

      {isOpen && !disabled && mounted && createPortal(portalContent, document.body)}
    </div>
  );
}
