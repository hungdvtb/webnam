"use client";

import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/context/CartContext';

export default function Header({ menuItems = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const { cartCount } = useCart();
  const router = typeof window !== 'undefined' ? require('next/navigation').useRouter() : null;

  const handleSearch = (e) => {
    if ((e.type === 'keydown' && e.key === 'Enter') || e.type === 'click') {
      if (searchQuery.trim()) {
        router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      }
    }
  };

  return (
    <header className="site-header">
      <div className="container header-content">
        {/* Logo Section */}
        <Link href="/" className="logo-section" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '15px', textDecoration: 'none', flexWrap: 'nowrap' }}>
          <div className="logo-img-box" style={{ width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
             <svg className="logo-icon" fill="#1B365D" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
                <path clipRule="evenodd" d="M24 4H42V17.3333V30.6667H24V44H6V30.6667V17.3333H24V4Z" fillRule="evenodd"></path>
             </svg>
          </div>
          <div className="logo-text" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1.5px solid rgba(197, 160, 89, 0.4)', paddingLeft: '15px', flexShrink: 0 }}>
            <h1 className="logo-title" style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: '700', color: 'var(--primary)', margin: '0', whiteSpace: 'nowrap', textTransform: 'uppercase', lineHeight: '1', letterSpacing: '0.05em' }}>Di Sản Gốm Việt</h1>
            <span className="logo-subtitle" style={{ fontFamily: 'var(--font-body)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.4em', color: 'var(--accent)', fontWeight: '600', marginTop: '4px', lineHeight: '1', whiteSpace: 'nowrap' }}>TINH HOA ĐẤT VIỆT</span>
          </div>
        </Link>

        <nav className="main-nav">
          <ul className="nav-list">
            <li className="nav-item"><Link href="/products" className="nav-link">SẢN PHẨM</Link></li>
            <li className="nav-item"><Link href="/collections" className="nav-link">BỘ SƯU TẬP</Link></li>
            <li className="nav-item"><Link href="/artists" className="nav-link">NGHỆ NHÂN</Link></li>
            <li className="nav-item"><Link href="/stories" className="nav-link">CÂU CHUYỆN</Link></li>
          </ul>
        </nav>

        {/* Right Section: Search & Cart */}
        <div className="actions-section">
          <div className="search-bar">
            <span 
              className="material-symbols-outlined search-icon" 
              onClick={handleSearch}
              style={{ cursor: 'pointer' }}
            >
              search
            </span>
            <input 
              type="text" 
              placeholder="Bạn cần tìm kiếm sản phẩm gì?" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              className="search-input"
            />
          </div>
          
          <Link href="/cart" className="cart-action">
            <span className="material-symbols-outlined">shopping_bag</span>
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </Link>
        </div>
      </div>

      <style jsx>{`
        .site-header {
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--border);
          padding: 1.5rem 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.02);
          position: sticky;
          top: 0;
          z-index: 1000;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2rem;
        }

        .logo-section {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          align-items: center !important;
          gap: 1.5rem !important;
          text-decoration: none;
          color: inherit;
          padding: 8px 0;
          min-width: max-content;
        }

        .logo-img-box {
          width: 65px;
          height: 65px;
          display: flex !important;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          transition: transform 0.3s ease;
          flex-shrink: 0;
        }

        .logo-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .logo-section:hover .logo-img-box {
          transform: translateY(-2px);
        }

        .logo-text {
          display: flex !important;
          flex-direction: column !important;
          justify-content: center;
          border-left: 2px solid rgba(197, 160, 89, 0.4);
          padding-left: 1.5rem;
          flex-shrink: 0;
        }

        .logo-title {
          font-family: var(--font-display);
          font-size: 28px;
          font-weight: 700;
          color: var(--primary);
          margin: 0;
          white-space: nowrap;
          text-transform: uppercase;
          line-height: 1.1;
          letter-spacing: 0.03em;
        }

        .logo-subtitle {
          font-family: var(--font-body);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.45em;
          color: var(--accent);
          font-weight: 600;
          margin-top: 4px;
          line-height: 1;
          white-space: nowrap;
        }

        .main-nav {
          flex: 1;
        }

        .nav-list {
          display: flex;
          list-style: none;
          gap: 2rem;
          margin: 0;
          padding: 0;
        }

        .nav-link {
          font-size: 14px;
          font-weight: 700;
          color: #1a2c4e;
          text-decoration: none;
          letter-spacing: 0.05em;
          transition: color 0.2s;
        }

        .nav-link:hover {
          color: var(--accent);
        }

        .actions-section {
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .search-bar {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon {
          position: absolute;
          left: 12px;
          color: #94a3b8;
          font-size: 20px !important;
        }

        .search-input {
          background-color: #f1f5f9;
          border: none;
          border-radius: 20px;
          padding: 8px 16px 8px 40px;
          width: 280px;
          font-size: 14px;
          outline: none;
          transition: width 0.3s;
        }

        .search-input:focus {
          width: 320px;
          background-color: #e2e8f0;
        }

        .cart-action {
          position: relative;
          color: #1a2c4e;
          text-decoration: none;
          display: flex;
          align-items: center;
        }

        .cart-badge {
          position: absolute;
          top: 0;
          right: 0;
          background-color: var(--accent);
          color: var(--white);
          font-size: 10px;
          font-weight: 700;
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
        }

        @media (max-width: 1024px) {
          .main-nav {
            display: none;
          }
          .search-input {
            width: 180px;
          }
          .search-input:focus {
             width: 220px;
          }
        }
      `}</style>
    </header>
  );
}
