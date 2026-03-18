"use client";

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useCart } from '@/context/CartContext';

export default function Header({ menuItems = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const { cartCount } = useCart();
  const [isBouncing, setIsBouncing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = typeof window !== 'undefined' ? require('next/navigation').useRouter() : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (cartCount > 0) {
      setIsBouncing(true);
      const timer = setTimeout(() => setIsBouncing(false), 300);
      return () => clearTimeout(timer);
    }
  }, [cartCount]);

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
        <Link href="/" className="logo-section" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px', textDecoration: 'none', flexWrap: 'nowrap' }}>
          <div className="logo-img-box" style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
             <img src="/logo-dai-thanh.png" alt="Gốm Đại Thành" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div className="logo-text" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1.5px solid rgba(197, 160, 89, 0.4)', paddingLeft: '12px', flexShrink: 0 }}>
            <h1 className="logo-title" style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: '600', color: 'var(--primary)', margin: '0', whiteSpace: 'nowrap', textTransform: 'uppercase', lineHeight: '1.1', letterSpacing: '0.02em' }}>Gốm Đại Thành</h1>
            <span className="logo-subtitle" style={{ fontFamily: 'var(--font-body)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.3em', color: 'var(--accent)', fontWeight: '600', marginTop: '2px', lineHeight: '1', whiteSpace: 'nowrap' }}>TINH HOA ĐẤT VIỆT</span>
          </div>
        </Link>

        <nav className="main-nav">
          <ul className="nav-list">
            {menuItems.length > 0 ? (
              menuItems.map((item) => (
                <li key={item.id} className="nav-item">
                  <Link href={item.url || '#'} className="nav-link">
                    {item.title}
                  </Link>
                </li>
              ))
            ) : (
              <>
                <li className="nav-item"><Link href="/products" className="nav-link">SẢN PHẨM</Link></li>
                <li className="nav-item"><Link href="/collections" className="nav-link">BỘ SƯU TẬP</Link></li>
                <li className="nav-item"><Link href="/blog" className="nav-link">TIN TỨC</Link></li>
              </>
            )}
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
          
          <Link href="/cart" className={`cart-action ${isBouncing ? 'bounce-cart' : ''}`}>
            <span className="material-symbols-outlined cart-icon" style={{ fontSize: '32px', color: '#1a2c4e', marginRight: '8px' }}>shopping_cart</span>
            <div className="cart-text">
              <span style={{ display: 'block', color: '#3b82f6', fontWeight: '700', fontSize: '15px', lineHeight: '1.2' }}>Giỏ hàng</span>
              <span style={{ display: 'block', color: '#64748b', fontSize: '13px', whiteSpace: 'nowrap', marginTop: '2px' }}>
                Có <strong className={isBouncing ? 'bounce-text' : ''} style={{ color: '#ef4444', transition: 'all 0.3s' }}>{mounted ? cartCount : 0}</strong> sản phẩm
              </span>
            </div>
          </Link>
        </div>
      </div>

      <style jsx>{`
        .site-header {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
          height: 64px;
          padding: 0 24px;
          display: flex;
          align-items: center;
          box-shadow: 0 2px 10px rgba(0,0,0,0.03);
          position: sticky;
          top: 0;
          z-index: 1000;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          gap: 1.5rem;
        }

        .logo-section {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: nowrap !important;
          align-items: center !important;
          gap: 12px !important;
          text-decoration: none;
          color: inherit;
          flex-shrink: 0;
        }

        .logo-img-box {
          width: 40px;
          height: 40px;
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
          padding-left: 12px;
          flex-shrink: 0;
        }

        .logo-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 600;
          color: var(--primary);
          margin: 0;
          white-space: nowrap;
          text-transform: uppercase;
          line-height: 1.1;
          letter-spacing: 0.02em;
        }

        .logo-subtitle {
          font-family: var(--font-body);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.3em;
          color: var(--accent);
          font-weight: 600;
          margin-top: 2px;
          line-height: 1;
          white-space: nowrap;
        }

        .main-nav {
          flex: 1;
        }

        .nav-list {
          display: flex;
          list-style: none;
          gap: 1.5rem;
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
          padding: 6px 16px 6px 36px;
          width: 240px;
          font-size: 13px;
          outline: none;
          transition: width 0.3s;
        }

        .search-input:focus {
          width: 280px;
          background-color: #e2e8f0;
        }

        .cart-action {
          position: relative;
          text-decoration: none;
          display: flex;
          align-items: center;
        }

        .bounce-text {
          display: inline-block;
          animation: badgeBounce 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        :global(.cart-action.bounce-cart span.cart-icon) {
          animation: cartShake 0.4s ease-in-out;
        }

        @keyframes badgeBounce {
          0% { transform: scale(1); }
          50% { transform: scale(1.4); background-color: #d4af37; }
          100% { transform: scale(1); }
        }

        @keyframes cartShake {
          0% { transform: rotate(0deg) scale(1); }
          25% { transform: rotate(-15deg) scale(1.2); }
          50% { transform: rotate(15deg) scale(1.2); }
          75% { transform: rotate(-5deg) scale(1.1); }
          100% { transform: rotate(0deg) scale(1); }
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
